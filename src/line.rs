use std::{borrow::Cow, sync::LazyLock};

use regex::Regex;
use serde::Serialize;
use serde_json::{Map, Value};

use crate::rules::Detector;

const MESSAGE_KEYS: [&str; 3] = ["msg", "message", "text"];
const TIME_KEYS: [&str; 4] = ["time", "ts", "timestamp", "@timestamp"];
/// JSON keys that hold a trace id, compared case-insensitively.
const TRACE_KEYS: [&str; 4] = ["trace_id", "traceid", "trace-id", "trace.id"];

static SGR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b\[[0-9;]*m").unwrap());
static TRACE_KV: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i-u)\btrace[_.-]?id["']?\s*[=:]\s*["']?([0-9a-z][0-9a-z-]{7,})"#).unwrap()
});

#[derive(Serialize, Debug, PartialEq)]
pub struct Line<'a> {
    ts: &'a str,
    level: &'static str,
    plain: Cow<'a, str>,
    segs: Option<Vec<Segment>>,
    json: Option<JsonLayout>,
    trace: Option<String>,
}

/// Style class and length of the next piece of `plain`, in UTF-16 units as JS strings count them.
type Segment = (String, usize);

/// Which keys of the JSON in `plain` to show as the message and as fields, in order.
#[derive(Serialize, Debug, PartialEq)]
struct JsonLayout {
    msg: Option<&'static str>,
    fields: Vec<String>,
}

/// Message without ANSI escape codes.
pub fn strip_ansi(msg: &str) -> Cow<'_, str> {
    SGR.replace_all(msg, "")
}

pub fn parse<'a>(ts: &'a str, stderr: bool, msg: &'a str, detector: &Detector) -> Line<'a> {
    let (plain, segs) = if msg.contains('\x1b') {
        let (plain, segs) = ansi(msg);
        (Cow::Owned(plain), Some(segs))
    } else {
        (Cow::Borrowed(msg), None)
    };
    let obj = json_object(&plain);
    let level = detector.level(obj.as_ref(), &plain, stderr);
    let trace = trace_id(obj.as_ref(), &plain);
    let json = obj.map(|o| json_layout(o, &detector.keys));
    let segs = if json.is_some() { None } else { segs };
    Line { ts, level, plain, segs, json, trace }
}

/// Level of a raw message, without building the rest of the line.
pub fn level(stderr: bool, msg: &str, detector: &Detector) -> &'static str {
    let plain = strip_ansi(msg);
    detector.level(json_object(&plain).as_ref(), &plain, stderr)
}

fn json_object(plain: &str) -> Option<Map<String, Value>> {
    if plain.starts_with('{') && plain.ends_with('}') { serde_json::from_str(plain).ok() } else { None }
}

fn trace_id(obj: Option<&Map<String, Value>>, plain: &str) -> Option<String> {
    match obj {
        Some(o) => o
            .iter()
            .find(|(k, _)| TRACE_KEYS.iter().any(|t| t.eq_ignore_ascii_case(k)))
            .and_then(|(_, v)| v.as_str())
            .map(String::from),
        None => TRACE_KV.captures(plain).map(|c| c[1].to_string()),
    }
}

fn json_layout(obj: Map<String, Value>, level_keys: &[String]) -> JsonLayout {
    let msg = MESSAGE_KEYS.into_iter().find(|k| obj.get(*k).is_some_and(|v| !v.is_null()));
    let fields = obj
        .into_iter()
        .map(|(k, _)| k)
        .filter(|k| !MESSAGE_KEYS.contains(&k.as_str()) && !TIME_KEYS.contains(&k.as_str()) && !level_keys.contains(k))
        .collect();
    JsonLayout { msg, fields }
}

#[derive(Default)]
struct Style {
    bold: bool,
    dim: bool,
    italic: bool,
    under: bool,
    fg: Option<u32>,
}

impl Style {
    fn apply(&mut self, params: &str) {
        let mut codes = params.split(';').map(|p| p.parse::<u32>().unwrap_or(0));
        while let Some(code) = codes.next() {
            match code {
                0 => *self = Style::default(),
                1 => self.bold = true,
                2 => self.dim = true,
                3 => self.italic = true,
                4 => self.under = true,
                22 => {
                    self.bold = false;
                    self.dim = false;
                }
                39 => self.fg = None,
                n @ (30..=37 | 90..=97) => self.fg = Some(n),
                38 | 48 => {
                    if codes.next() == Some(5) {
                        codes.next();
                    } else {
                        codes.nth(2);
                    }
                }
                _ => {}
            }
        }
    }

    fn class(&self) -> String {
        let fg = self.fg.map(|n| format!("a-{n}"));
        let flags = [(self.bold, "a-bold"), (self.dim, "a-dim"), (self.italic, "a-italic"), (self.under, "a-under")];
        let names = flags.iter().filter(|(on, _)| *on).map(|(_, name)| *name).chain(fg.as_deref());
        names.collect::<Vec<_>>().join(" ")
    }
}

fn utf16_len(s: &str) -> usize {
    if s.is_ascii() { s.len() } else { s.encode_utf16().count() }
}

fn ansi(s: &str) -> (String, Vec<Segment>) {
    let mut plain = String::with_capacity(s.len());
    let mut segs = Vec::new();
    let mut style = Style::default();
    let mut push = |style: &Style, text: &str| {
        if !text.is_empty() {
            plain.push_str(text);
            segs.push((style.class(), utf16_len(text)));
        }
    };
    let mut last = 0;
    for m in SGR.find_iter(s) {
        push(&style, &s[last..m.start()]);
        style.apply(&m.as_str()[2..m.len() - 1]);
        last = m.end();
    }
    push(&style, &s[last..]);
    (plain, segs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::Rules;

    fn seg(class: &str, len: usize) -> Segment {
        (class.to_string(), len)
    }

    fn layout(msg: Option<&'static str>, fields: &[&str]) -> Option<JsonLayout> {
        Some(JsonLayout { msg, fields: fields.iter().map(|f| f.to_string()).collect() })
    }

    #[test]
    fn test_ansi() {
        let cases = [
            ("plain", "plain", vec![seg("", 5)]),
            ("\x1b[31merror\x1b[0m done", "error done", vec![seg("a-31", 5), seg("", 5)]),
            ("\x1b[1;32mok\x1b[22m green", "ok green", vec![seg("a-bold a-32", 2), seg("a-32", 6)]),
            ("\x1b[1;4mx", "x", vec![seg("a-bold a-under", 1)]),
            ("\x1b[38;5;208mx\x1b[39my", "xy", vec![seg("", 1), seg("", 1)]),
            ("\x1b[38;2;1;2;3;1mb", "b", vec![seg("a-bold", 1)]),
            ("\x1b[4m\x1b[mz", "z", vec![seg("", 1)]),
            ("\x1b[31mпривет🙂\x1b[0m!", "привет🙂!", vec![seg("a-31", 8), seg("", 1)]),
        ];
        for (input, plain, segs) in cases {
            assert_eq!(ansi(input), (plain.to_string(), segs), "input: {input:?}");
        }
    }

    #[test]
    fn test_parse() {
        let detector = Rules::compile(vec![]).unwrap().for_container("any");
        let line = |level, plain: &'static str, segs, json| Line { ts: "t", level, plain: plain.into(), segs, json, trace: None };
        let json_line = r#"{"time":"x","level":"warn","msg":"retry","job":7,"tags":["a"]}"#;
        let json_bogus = r#"{"level":"bogus","message":"an ERROR here"}"#;
        let json_null_msg = r#"{"msg":null,"text":"hi","a":1}"#;
        let cases = [
            (false, "level=INFO msg=\"done\" err=<nil>", line("info", "level=INFO msg=\"done\" err=<nil>", None, None)),
            (false, "\x1b[31merror\x1b[0m boom", line("error", "error boom", Some(vec![seg("a-31", 5), seg("", 5)]), None)),
            (false, json_line, line("warn", json_line, None, layout(Some("msg"), &["job", "tags"]))),
            (false, json_bogus, line("error", json_bogus, None, layout(Some("message"), &[]))),
            (false, json_null_msg, line("", json_null_msg, None, layout(Some("text"), &["a"]))),
            (false, "{not json}", line("", "{not json}", None, None)),
            (true, "something happened", line("error", "something happened", None, None)),
            (true, "level=info started", line("info", "level=info started", None, None)),
        ];
        for (stderr, input, want) in cases {
            assert_eq!(parse("t", stderr, input, &detector), want, "input: {input:?}");
        }
    }

    #[test]
    fn test_trace_id() {
        let detector = Rules::compile(vec![]).unwrap().for_container("any");
        let cases = [
            ("level=info msg=ok trace_id=4bf92f3577b34da6 span=1", Some("4bf92f3577b34da6")),
            ("traceId: 0af7651916cd43dd8448eb211c80319c done", Some("0af7651916cd43dd8448eb211c80319c")),
            (r#"{"msg":"ok","traceID":"abc12345-def6"}"#, Some("abc12345-def6")),
            (r#"{"msg":"ok","trace_id":42}"#, None),
            ("trace_id=short", None),
            ("no trace here", None),
        ];
        for (input, want) in cases {
            assert_eq!(parse("t", false, input, &detector).trace.as_deref(), want, "input: {input:?}");
        }
    }
}
