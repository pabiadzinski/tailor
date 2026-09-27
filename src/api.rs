use std::sync::Arc;

use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use bollard::{Docker, query_parameters::ListContainersOptions};
use rust_embed::RustEmbed;
use serde::Serialize;

use crate::{VERSION, rules::Rules};

#[derive(RustEmbed)]
#[folder = "static/"]
struct Assets;

pub type AppState = Arc<App>;

pub struct App {
    pub docker: Docker,
    pub rules: Rules,
}

#[derive(Serialize)]
pub struct Container {
    id: String,
    name: String,
    image: String,
    state: String,
    status: String,
    project: Option<String>,
}

pub async fn asset(uri: Uri, headers: HeaderMap) -> Response {
    let path = match uri.path().trim_start_matches('/') {
        "" => "index.html",
        p => p,
    };
    let Some(file) = Assets::get(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let hash: String = file.metadata.sha256_hash().iter().map(|b| format!("{b:02x}")).collect();
    let etag = format!("\"{VERSION}-{hash}\"");
    if headers.get(header::IF_NONE_MATCH).is_some_and(|v| v == etag.as_str()) {
        return StatusCode::NOT_MODIFIED.into_response();
    }
    let mime = file.metadata.mimetype().to_string();
    let body = match path {
        "index.html" => String::from_utf8_lossy(&file.data).replace("{{version}}", VERSION).into_bytes(),
        _ => file.data.into_owned(),
    };
    let headers = [(header::CONTENT_TYPE, mime.as_str()), (header::CACHE_CONTROL, "no-cache"), (header::ETAG, etag.as_str())];
    (headers, body).into_response()
}

pub async fn containers(State(app): State<AppState>) -> Result<Json<Vec<Container>>, (StatusCode, String)> {
    let list = app
        .docker
        .list_containers(Some(ListContainersOptions {
            all: true,
            ..Default::default()
        }))
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let mut out: Vec<Container> = list
        .into_iter()
        .map(|c| Container {
            id: c.id.unwrap_or_default(),
            name: c
                .names
                .and_then(|n| n.into_iter().next())
                .map(|n| n.trim_start_matches('/').to_string())
                .unwrap_or_default(),
            image: c.image.unwrap_or_default(),
            state: c.state.map(|s| s.to_string()).unwrap_or_default(),
            status: c.status.unwrap_or_default(),
            project: c
                .labels
                .and_then(|mut l| l.remove("com.docker.compose.project")),
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(out))
}
