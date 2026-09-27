use axum::{
    extract::{Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use bollard::Docker;
use futures_util::{StreamExt, future::join_all};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

use crate::{
    api::AppState,
    line,
    logs::{Tagged, container_names, options, output, split_ts},
};

const MAX_RESULTS: usize = 5000;

#[derive(Deserialize)]
pub struct SearchQuery {
    c: String,
    q: String,
}

#[derive(Serialize)]
struct Results<'a> {
    total: usize,
    lines: Vec<Tagged<'a>>,
}

/// Searches the whole log of the given containers and returns the most recent matches, sorted by time.
pub async fn search(State(app): State<AppState>, Query(q): Query<SearchQuery>) -> Response {
    let re = match search_regex(&q.q) {
        Ok(re) => re,
        Err(e) => return (StatusCode::BAD_REQUEST, e).into_response(),
    };
    let names = container_names(&q.c);
    let found = join_all(names.iter().map(|name| matches(&app.docker, name, &re))).await;
    let mut hits = Vec::new();
    for (i, result) in found.into_iter().enumerate() {
        match result {
            Ok(lines) => hits.extend(lines.into_iter().map(|(stderr, raw)| (i, stderr, raw))),
            Err(e) => return (StatusCode::BAD_GATEWAY, format!("{}: {e}", names[i])).into_response(),
        }
    }
    hits.sort_by(|a, b| split_ts(&a.2).0.cmp(split_ts(&b.2).0));
    let total = hits.len();
    hits.drain(..total.saturating_sub(MAX_RESULTS));

    let detectors: Vec<_> = names.iter().map(|name| app.rules.for_container(name)).collect();
    let lines = hits
        .iter()
        .map(|(i, stderr, raw)| {
            let (ts, msg) = split_ts(raw);
            Tagged { c: *i, line: line::parse(ts, *stderr, msg, &detectors[*i]) }
        })
        .collect();
    let body = serde_json::to_string(&Results { total, lines }).unwrap_or_default();
    ([(header::CONTENT_TYPE, "application/json")], body).into_response()
}

async fn matches(docker: &Docker, name: &str, re: &Regex) -> Result<Vec<(bool, String)>, bollard::errors::Error> {
    let mut found = Vec::new();
    let mut logs = docker.logs(name, Some(options(false, 0, "all".into())));
    while let Some(item) = logs.next().await {
        let out = item?;
        let (stderr, text) = output(&out);
        for raw in text.lines() {
            if re.is_match(&line::strip_ansi(split_ts(raw).1)) {
                found.push((stderr, raw.to_string()));
            }
        }
    }
    Ok(found)
}

/// Same syntax as the search box: `/pattern/flags` is a regex, anything else a case-insensitive literal.
fn search_regex(q: &str) -> Result<Regex, String> {
    let as_regex = q
        .strip_prefix('/')
        .and_then(|rest| rest.rsplit_once('/'))
        .filter(|(pattern, flags)| !pattern.is_empty() && flags.chars().all(|c| c.is_ascii_lowercase()));
    let (pattern, ignore_case) = match as_regex {
        Some((pattern, flags)) => (pattern.to_string(), flags.contains('i')),
        None if q.trim().is_empty() => return Err("empty query".into()),
        None => (regex::escape(q.trim()), true),
    };
    RegexBuilder::new(&pattern).case_insensitive(ignore_case).build().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_regex() {
        let cases: [(&str, &str, bool); 7] = [
            ("needle", "a NEEDLE here", true),
            ("a.b", "axb", false),
            ("a.b", "a.b", true),
            ("/job (done|failed)/", "job failed", true),
            ("/Job/", "job", false),
            ("/Job/i", "job", true),
            ("/ok/", "/ok/", true),
        ];
        for (q, text, want) in cases {
            assert_eq!(search_regex(q).unwrap().is_match(text), want, "q: {q:?}, text: {text:?}");
        }
        assert!(search_regex("  ").is_err());
        assert!(search_regex("/(/").is_err());
    }
}
