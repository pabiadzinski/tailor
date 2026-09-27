use std::{
    borrow::Cow,
    convert::Infallible,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::sse::{Event, KeepAlive, Sse},
};
use bollard::{Docker, container::LogOutput, query_parameters::LogsOptions};
use futures_util::{Stream, StreamExt, future::join_all, stream};
use serde::{Deserialize, Serialize};

use crate::{
    api::AppState,
    line::{self, Line},
    rules::Detector,
};

#[derive(Deserialize)]
pub struct LogsQuery {
    c: String,
    tail: Option<u32>,
    after: Option<String>,
}

/// Position of a line in one container's log: the n-th line with timestamp ts.
#[derive(Default, Clone, Debug, PartialEq, PartialOrd)]
struct Cursor {
    ts: String,
    n: usize,
}

impl Cursor {
    fn parse(s: &str) -> Option<Self> {
        let (ts, n) = s.rsplit_once(' ')?;
        Some(Self { ts: ts.to_string(), n: n.parse().ok()? })
    }

    fn advance(&mut self, ts: &str) {
        if ts == self.ts {
            self.n += 1;
        } else {
            ts.clone_into(&mut self.ts);
            self.n = 1;
        }
    }
}

/// One container of the stream. After a resume, `replay` is the position already sent: lines up to it are skipped.
struct Source {
    name: String,
    detector: Detector,
    pos: Cursor,
    replay: Option<Cursor>,
}

impl Source {
    /// Advances past a line; false if the line was sent before.
    fn advance(&mut self, ts: &str) -> bool {
        self.pos.advance(ts);
        if self.replay.as_ref().is_some_and(|r| self.pos <= *r) {
            return false;
        }
        self.replay = None;
        true
    }

    /// Position of the last line sent.
    fn sent(&self) -> &Cursor {
        self.replay.as_ref().unwrap_or(&self.pos)
    }

    /// Starts counting again from the beginning of the log, skipping everything already sent.
    fn rewind(&mut self) {
        let sent = std::mem::take(&mut self.pos);
        let sent = self.replay.take().unwrap_or(sent);
        self.replay = (!sent.ts.is_empty()).then_some(sent);
    }

    fn since(&self) -> Option<i64> {
        self.replay.as_ref().and_then(|c| unix_seconds(&c.ts))
    }
}

/// Resume token: the last sent position of every source, in request order.
fn cursor_id(sources: &[Source]) -> String {
    let part = |c: &Cursor| if c.ts.is_empty() { String::new() } else { format!("{} {}", c.ts, c.n) };
    sources.iter().map(|s| part(s.sent())).collect::<Vec<_>>().join(",")
}

fn parse_cursor_id(id: &str, n: usize) -> Vec<Option<Cursor>> {
    let mut parts = id.split(',');
    (0..n).map(|_| parts.next().and_then(Cursor::parse)).collect()
}

/// A parsed line with the index of its container in the request.
#[derive(Serialize)]
pub struct Tagged<'a> {
    pub c: usize,
    #[serde(flatten)]
    pub line: Line<'a>,
}

fn line_event(sources: &mut [Source], i: usize, stderr: bool, raw: &str) -> Option<Event> {
    let (ts, msg) = split_ts(raw);
    if !sources[i].advance(ts) {
        return None;
    }
    let line = line::parse(ts, stderr, msg, &sources[i].detector);
    Event::default().id(cursor_id(sources)).json_data(Tagged { c: i, line }).ok()
}

fn fail_event(sources: &[Source], i: usize, e: impl ToString) -> Event {
    let msg = e.to_string();
    let msg = if sources.len() > 1 { format!("{}: {msg}", sources[i].name) } else { msg };
    Event::default().event("fail").data(msg)
}

pub fn output(out: &LogOutput) -> (bool, Cow<'_, str>) {
    let (stderr, bytes) = match out {
        LogOutput::StdErr { message } => (true, message),
        LogOutput::StdOut { message } | LogOutput::Console { message } | LogOutput::StdIn { message } => (false, message),
    };
    (stderr, String::from_utf8_lossy(bytes))
}

pub fn options(follow: bool, since: i64, tail: String) -> LogsOptions {
    LogsOptions { follow, stdout: true, stderr: true, timestamps: true, since: since as i32, tail, ..Default::default() }
}

/// Lines already in the log: the last `tail` ones, or everything since the resume point.
async fn backlog(docker: &Docker, source: &Source, tail: u32) -> Result<Vec<(bool, String)>, bollard::errors::Error> {
    let opts = match source.since() {
        Some(since) => options(false, since, "all".into()),
        None => options(false, 0, tail.to_string()),
    };
    let mut lines = Vec::new();
    let mut logs = docker.logs(&source.name, Some(opts));
    while let Some(item) = logs.next().await {
        let out = item?;
        let (stderr, text) = output(&out);
        lines.extend(text.lines().filter(|l| !l.is_empty()).map(|l| (stderr, l.to_string())));
    }
    Ok(lines)
}

/// Streams the logs of one or more containers as SSE, merged by time.
///
/// First the backlog of every container is fetched and sent sorted by timestamp, then each container
/// is followed live from where its backlog ended. Every event id is a resume token; the browser sends
/// it back as Last-Event-ID when it reconnects.
pub async fn logs(
    State(app): State<AppState>,
    Query(q): Query<LogsQuery>,
    headers: HeaderMap,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let started = unix_now();
    let names = container_names(&q.c);
    let last_event_id = headers.get("last-event-id").and_then(|v| v.to_str().ok());
    let resume = parse_cursor_id(last_event_id.or(q.after.as_deref()).unwrap_or(""), names.len());
    let mut sources: Vec<Source> = names
        .iter()
        .zip(resume)
        .map(|(name, replay)| Source {
            name: name.to_string(),
            detector: app.rules.for_container(name),
            pos: Cursor::default(),
            replay,
        })
        .collect();

    let tail = q.tail.unwrap_or(500);
    let backlogs = join_all(sources.iter().map(|s| backlog(&app.docker, s, tail))).await;
    let mut events = vec![Event::default().retry(Duration::from_secs(1))];
    let mut lines = Vec::new();
    let mut live = Vec::new();
    for (i, backlog) in backlogs.into_iter().enumerate() {
        match backlog {
            Ok(b) => {
                lines.extend(b.into_iter().map(|(stderr, raw)| (i, stderr, raw)));
                live.push(i);
            }
            Err(e) => events.push(fail_event(&sources, i, e)),
        }
    }
    lines.sort_by(|a, b| split_ts(&a.2).0.cmp(split_ts(&b.2).0));
    events.extend(lines.iter().filter_map(|(i, stderr, raw)| line_event(&mut sources, *i, *stderr, raw)));

    for s in &mut sources {
        s.rewind();
    }
    let follows = live.into_iter().map(|i| {
        let opts = options(true, sources[i].since().unwrap_or(started), "all".into());
        app.docker.logs(&sources[i].name, Some(opts)).map(move |item| (i, item)).boxed()
    });
    let followed = stream::select_all(follows).flat_map(move |(i, item)| {
        let events: Vec<Event> = match item {
            Ok(out) => {
                let (stderr, text) = output(&out);
                text.lines()
                    .filter(|l| !l.is_empty())
                    .filter_map(|raw| line_event(&mut sources, i, stderr, raw))
                    .collect()
            }
            Err(e) => vec![fail_event(&sources, i, e)],
        };
        stream::iter(events)
    });

    let end = stream::once(async { Event::default().event("end").data("") });
    let all = stream::iter(events).chain(followed).chain(end).map(Ok);
    Sse::new(all).keep_alive(KeepAlive::default())
}

pub fn unix_now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

/// Container names from a comma-separated list.
pub fn container_names(list: &str) -> Vec<&str> {
    list.split(',').filter(|n| !n.is_empty()).collect()
}

pub fn split_ts(line: &str) -> (&str, &str) {
    let line = line.strip_suffix('\r').unwrap_or(line);
    match line.split_once(' ') {
        Some((ts, msg)) if ts.len() >= 20 && ts.ends_with('Z') => (ts, msg),
        _ => ("", line),
    }
}

// days_from_civil: https://howardhinnant.github.io/date_algorithms.html
fn unix_seconds(ts: &str) -> Option<i64> {
    let num = |r: std::ops::Range<usize>| ts.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, min, s) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let (y, m) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + d - 1;
    let days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    Some(days * 86400 + h * 3600 + min * 60 + s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::Rules;

    fn source(replay: Option<&str>) -> Source {
        Source {
            name: "c".into(),
            detector: Rules::compile(vec![]).unwrap().for_container("c"),
            pos: Cursor::default(),
            replay: replay.and_then(Cursor::parse),
        }
    }

    #[test]
    fn test_split_ts() {
        let cases = [
            ("2026-09-27T10:00:00.123456789Z hello world", ("2026-09-27T10:00:00.123456789Z", "hello world")),
            ("2026-09-27T10:00:00.123456789Z ", ("2026-09-27T10:00:00.123456789Z", "")),
            ("2026-09-27T10:00:00Z msg\r", ("2026-09-27T10:00:00Z", "msg")),
            ("no timestamp here", ("", "no timestamp here")),
            ("", ("", "")),
        ];
        for (input, want) in cases {
            assert_eq!(split_ts(input), want, "input: {input:?}");
        }
    }

    #[test]
    fn test_unix_seconds() {
        let cases = [
            ("1970-01-01T00:00:00Z", Some(0)),
            ("2026-09-27T10:00:00.123456789Z", Some(1790503200)),
            ("2000-02-29T23:59:59Z", Some(951868799)),
            ("1999-12-31T00:00:00Z", Some(946598400)),
            ("garbage", None),
        ];
        for (input, want) in cases {
            assert_eq!(unix_seconds(input), want, "input: {input:?}");
        }
    }

    #[test]
    fn test_source_advance() {
        let cases: [(Option<&str>, Vec<bool>); 3] = [
            (None, vec![true, true, true, true, true, true]),
            (Some("t2 2"), vec![false, false, false, true, true, true]),
            (Some("t9 1"), vec![false, false, false, false, false, false]),
        ];
        for (replay, want) in cases {
            let mut s = source(replay);
            let got: Vec<bool> = ["t1", "t2", "t2", "t2", "t1", "t3"].iter().map(|ts| s.advance(ts)).collect();
            assert_eq!(got, want, "replay: {replay:?}");
        }
    }

    #[test]
    fn test_rewind() {
        let mut s = source(None);
        s.advance("t1");
        s.advance("t2");
        s.rewind();
        let got: Vec<bool> = ["t1", "t2", "t3"].iter().map(|ts| s.advance(ts)).collect();
        assert_eq!(got, [false, false, true]);

        let mut s = source(Some("t5 1"));
        s.advance("t1");
        s.rewind();
        assert_eq!(s.replay, Cursor::parse("t5 1"));

        let mut s = source(None);
        s.rewind();
        assert_eq!(s.replay, None);
    }

    #[test]
    fn test_cursor_id() {
        let mut sources = vec![source(None), source(Some("t2 1")), source(None)];
        sources[0].advance("t1");
        sources[0].advance("t1");
        assert_eq!(cursor_id(&sources), "t1 2,t2 1,");
        let parsed = parse_cursor_id("t1 2,,x", 4);
        assert_eq!(parsed, [Cursor::parse("t1 2"), None, None, None]);
    }
}
