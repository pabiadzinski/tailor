use std::collections::HashMap;

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use bollard::query_parameters::ListContainersOptions;
use futures_util::{StreamExt, future::join_all};
use serde::Deserialize;

use crate::{
    api::{App, AppState},
    line,
    logs::{options, output, split_ts, unix_now},
};

const WINDOW_SECS: i64 = 300;

#[derive(Deserialize)]
pub struct ErrorsQuery {
    /// Unix time the counters were last cleared.
    since: Option<i64>,
}

/// Number of error lines in the last five minutes, or since the counters were cleared, per running container.
pub async fn errors(
    State(app): State<AppState>,
    Query(q): Query<ErrorsQuery>,
) -> Result<Json<HashMap<String, usize>>, (StatusCode, String)> {
    let list = app
        .docker
        .list_containers(None::<ListContainersOptions>)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    let names: Vec<String> = list
        .into_iter()
        .filter_map(|c| c.names?.into_iter().next())
        .map(|n| n.trim_start_matches('/').to_string())
        .collect();
    let since = (unix_now() - WINDOW_SECS).max(q.since.unwrap_or(0));
    let counts = join_all(names.iter().map(|name| count(&app, name, since))).await;
    Ok(Json(names.into_iter().zip(counts).filter(|(_, n)| *n > 0).collect()))
}

async fn count(app: &App, name: &str, since: i64) -> usize {
    let detector = app.rules.for_container(name);
    let mut logs = app.docker.logs(name, Some(options(false, since, "all".into())));
    let mut n = 0;
    while let Some(Ok(out)) = logs.next().await {
        let (stderr, text) = output(&out);
        n += text.lines().filter(|raw| line::level(stderr, split_ts(raw).1, &detector) == "error").count();
    }
    n
}
