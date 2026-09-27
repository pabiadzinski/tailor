use std::sync::LazyLock;

use regex::{Regex, RegexBuilder};
use serde::Deserialize;
use serde_json::{Map, Value};

#[derive(Deserialize, Debug, PartialEq, Default, clap::Args)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    #[arg(skip)]
    pub container: Option<String>,
    /// Key that holds the level in JSON and key=value lines
    #[arg(long, env = "TAILR_LEVEL_KEY", value_name = "KEY")]
    pub level_key: Option<String>,
    /// Regex for error lines, case-insensitive
    #[arg(long, env = "TAILR_ERROR", value_name = "REGEX")]
    pub error: Option<String>,
    /// Regex for warning lines, case-insensitive
    #[arg(long, env = "TAILR_WARN", value_name = "REGEX")]
    pub warn: Option<String>,
    /// Regex for info lines, case-insensitive
    #[arg(long, env = "TAILR_INFO", value_name = "REGEX")]
    pub info: Option<String>,
    /// Regex for debug lines, case-insensitive
    #[arg(long, env = "TAILR_DEBUG", value_name = "REGEX")]
    pub debug: Option<String>,
    /// Level for stderr lines without one; empty turns it off
    #[arg(long, env = "TAILR_STDERR", value_name = "LEVEL")]
    pub stderr: Option<String>,
}

const LEVELS: [(&str, &[&str]); 4] = [
    ("error", &["error", "err", "fatal", "panic", "crit", "critical", "emerg", "alert"]),
    ("warn", &["warn", "warning", "wrn"]),
    ("info", &["info", "inf", "notice"]),
    ("debug", &["debug", "dbg", "trace", "trc"]),
];
const DEFAULT_KEYS: [&str; 4] = ["level", "lvl", "severity", "log_level"];

static DEFAULT_LEVELS: LazyLock<[Regex; 4]> =
    LazyLock::new(|| LEVELS.map(|(_, words)| Regex::new(&format!(r"(?i-u)\b(?:{})\b", words.join("|"))).unwrap()));

fn level_alias(s: &str) -> Option<&'static str> {
    LEVELS
        .iter()
        .find(|(_, words)| words.iter().any(|w| w.eq_ignore_ascii_case(s)))
        .map(|(name, _)| *name)
}

pub struct Rules(Vec<CompiledRule>);

struct CompiledRule {
    container: Option<Regex>,
    level_key: Option<String>,
    levels: [Option<Regex>; 4],
    stderr: Option<&'static str>,
}

impl Rules {
    pub fn compile(rules: Vec<Rule>) -> Result<Self, String> {
        let regex = |p: &str, ci: bool| RegexBuilder::new(p).case_insensitive(ci).build().map_err(|e| e.to_string());
        let level = |name: &str, p: Option<String>| {
            p.map(|p| match p.as_str() {
                "" => Err(format!("{name}: empty regex")),
                p => regex(p, true).map_err(|e| format!("{name}: {e}")),
            })
            .transpose()
        };
        rules
            .into_iter()
            .map(|r| {
                Ok(CompiledRule {
                    container: r.container.map(|g| regex(&glob(&g), false)).transpose()?,
                    level_key: r.level_key,
                    levels: [
                        level("error", r.error)?,
                        level("warn", r.warn)?,
                        level("info", r.info)?,
                        level("debug", r.debug)?,
                    ],
                    stderr: r.stderr.map(|s| stderr_level(&s)).transpose()?,
                })
            })
            .collect::<Result<_, _>>()
            .map(Self)
    }

    pub fn for_container(&self, name: &str) -> Detector {
        let mut keys = DEFAULT_KEYS.map(String::from).to_vec();
        let mut levels = DEFAULT_LEVELS.clone();
        let mut stderr = "error";
        for r in self.0.iter().filter(|r| r.container.as_ref().is_none_or(|c| c.is_match(name))) {
            if let Some(k) = &r.level_key {
                keys = vec![k.clone()];
            }
            if let Some(s) = r.stderr {
                stderr = s;
            }
            for (dst, src) in levels.iter_mut().zip(&r.levels) {
                if let Some(re) = src {
                    *dst = re.clone();
                }
            }
        }
        let alt = keys.iter().map(|k| regex::escape(k)).collect::<Vec<_>>().join("|");
        let kv = Regex::new(&format!(r#"(?i-u)(?:^|\s)(?:{alt})="?([a-z]+)"#)).unwrap();
        Detector { keys, kv, levels, stderr }
    }
}

/// Level for stderr lines without a detected level; "" turns it off.
fn stderr_level(s: &str) -> Result<&'static str, String> {
    if s.is_empty() {
        return Ok("");
    }
    level_alias(s).ok_or_else(|| format!("stderr: unknown level {s:?}"))
}

fn glob(g: &str) -> String {
    format!("^{}$", regex::escape(g).replace(r"\*", ".*").replace(r"\?", "."))
}

pub struct Detector {
    pub keys: Vec<String>,
    stderr: &'static str,
    kv: Regex,
    levels: [Regex; 4],
}

impl Detector {
    /// Level by the first of: JSON level key, `key=value`, leftmost level word, stderr fallback.
    pub fn level(&self, json: Option<&Map<String, Value>>, plain: &str, stderr: bool) -> &'static str {
        let from_json = json.and_then(|o| self.keys.iter().find_map(|k| o.get(k)?.as_str())).and_then(level_alias);
        let level = from_json.unwrap_or_else(|| self.detect(plain));
        if level.is_empty() && stderr { self.stderr } else { level }
    }

    fn detect(&self, s: &str) -> &'static str {
        let head = &s[..s.floor_char_boundary(200)];
        if head.contains('=')
            && let Some(level) = self.kv.captures(head).and_then(|c| level_alias(&c[1]))
        {
            return level;
        }
        self.levels
            .iter()
            .zip(LEVELS)
            .filter_map(|(re, (name, _))| re.find(head).map(|m| (m.start(), name)))
            .min_by_key(|&(at, _)| at)
            .map_or("", |(_, name)| name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect() {
        let rules = Rules::compile(vec![
            Rule { container: Some("legacy-*".into()), error: Some(r"^\[E\]".into()), ..Default::default() },
            Rule { container: Some("json-?".into()), level_key: Some("sev".into()), ..Default::default() },
            Rule { container: Some("codes".into()), error: Some(r"\bE\d{4}\b".into()), ..Default::default() },
        ])
        .unwrap();
        let cases = [
            ("api", "level=INFO msg=\"done\" err=<nil>", "info"),
            ("api", "2026 INFO something ERROR later", "info"),
            ("api", "WARN: disk almost full", "warn"),
            ("api", "code E1234 failed", ""),
            ("codes", "code E1234 failed", "error"),
            ("api", "[E] boom", ""),
            ("api", "nothing here", ""),
            ("api", "level=bogus but ERROR", "error"),
            ("api", "level=wrn x", "warn"),
            ("legacy-1", "[E] boom", "error"),
            ("legacy-1", "level=debug [E] boom", "debug"),
            ("json-1", "sev=warning x", "warn"),
            ("json-1", "sev=info level=error", "info"),
            ("json-12", "sev=info level=error", "error"),
        ];
        for (container, line, want) in cases {
            let got = rules.for_container(container).detect(line);
            assert_eq!(got, want, "container: {container}, line: {line:?}");
        }
    }

    #[test]
    fn test_level() {
        let rule = |container: &str, stderr: &str| Rule {
            container: Some(container.into()),
            stderr: Some(stderr.into()),
            ..Default::default()
        };
        let rules = Rules::compile(vec![rule("quiet", ""), rule("soft", "warning")]).unwrap();
        let json: Map<String, Value> = serde_json::from_str(r#"{"level":"warn","msg":"ERROR here"}"#).unwrap();
        let cases = [
            ("any", Some(&json), "ERROR here", false, "warn"),
            ("any", None, "boom", true, "error"),
            ("any", None, "boom", false, ""),
            ("quiet", None, "boom", true, ""),
            ("quiet", None, "level=error boom", true, "error"),
            ("soft", None, "boom", true, "warn"),
        ];
        for (container, json, plain, stderr, want) in cases {
            let got = rules.for_container(container).level(json, plain, stderr);
            assert_eq!(got, want, "container: {container}, plain: {plain:?}, stderr: {stderr}");
        }
    }

    #[test]
    fn test_compile_error() {
        let cases = [
            Rule { error: Some("(unclosed".into()), ..Default::default() },
            Rule { warn: Some("".into()), ..Default::default() },
            Rule { stderr: Some("loud".into()), ..Default::default() },
        ];
        for rule in cases {
            let desc = format!("{rule:?}");
            assert!(Rules::compile(vec![rule]).is_err(), "rule: {desc}");
        }
    }
}
