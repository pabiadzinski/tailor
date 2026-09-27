use std::{fs, io::ErrorKind};

use clap::Parser;
use serde::Deserialize;

use crate::rules::{Rule, Rules};

/// Web UI for tailing Docker container logs.
///
/// Every option can also be set with the environment variable shown next to it.
#[derive(Parser, Debug)]
#[command(version)]
pub struct Args {
    /// Address to listen on
    #[arg(long, env = "TAILR_HOST", default_value = "0.0.0.0")]
    pub host: String,
    /// Port to listen on
    #[arg(long, env = "PORT", default_value_t = 8080)]
    pub port: u16,
    /// Rules file; a missing tailr.toml is ignored, a missing file given here is an error
    #[arg(long, env = "TAILR_CONFIG", value_name = "FILE")]
    config: Option<String>,
    #[command(flatten, next_help_heading = "Rule for all containers, applied after the rules file")]
    rule: Rule,
}

impl Args {
    /// Rules from the file, followed by the rule given in options.
    pub fn rules(self) -> Rules {
        let (path, required) = match self.config {
            Some(p) => (p, true),
            None => ("tailr.toml".to_string(), false),
        };
        let mut rules = load(&path, required);
        if self.rule != Rule::default() {
            rules.push(self.rule);
        }
        Rules::compile(rules).unwrap_or_else(|e| panic!("invalid rule: {e}"))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    #[serde(default)]
    rule: Vec<Rule>,
}

fn load(path: &str, required: bool) -> Vec<Rule> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == ErrorKind::NotFound && !required => String::new(),
        Err(e) => panic!("failed to read {path}: {e}"),
    };
    parse(&text).unwrap_or_else(|e| panic!("invalid {path}: {e}"))
}

fn parse(text: &str) -> Result<Vec<Rule>, toml::de::Error> {
    toml::from_str::<Config>(text).map(|c| c.rule)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse() {
        let api = Rule {
            container: Some("*-api-*".into()),
            level_key: Some("severity".into()),
            error: Some(r"\[E\]".into()),
            ..Default::default()
        };
        let cases: [(&str, Option<Vec<Rule>>); 4] = [
            ("", Some(vec![])),
            (
                "[[rule]]\ncontainer = \"*-api-*\"\nlevel_key = \"severity\"\nerror = '\\[E\\]'\n",
                Some(vec![api]),
            ),
            ("[[rule]]\nlevel = \"x\"\n", None),
            ("[[rule]]\nerror = 1\n", None),
        ];
        for (input, want) in cases {
            assert_eq!(parse(input).ok(), want, "input: {input:?}");
        }
    }

    #[test]
    fn test_args() {
        let cases: [(&[&str], Rule); 3] = [
            (&[], Rule::default()),
            (
                &["--stderr", "", "--error", "^E ", "--level-key", "sev"],
                Rule { stderr: Some("".into()), error: Some("^E ".into()), level_key: Some("sev".into()), ..Default::default() },
            ),
            (&["--port", "9000", "--warn", "W"], Rule { warn: Some("W".into()), ..Default::default() }),
        ];
        for (flags, want) in cases {
            let args = Args::try_parse_from(std::iter::once("tailr").chain(flags.iter().copied())).unwrap();
            assert_eq!(args.rule, want, "flags: {flags:?}");
        }
    }
}
