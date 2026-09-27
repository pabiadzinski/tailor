use std::{collections::HashMap, convert::Infallible};

use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use bollard::query_parameters::EventsOptions;
use futures_util::{Stream, StreamExt};

use crate::api::AppState;

pub async fn events(State(app): State<AppState>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let filters = HashMap::from([
        ("type".to_string(), vec!["container".to_string()]),
        (
            "event".to_string(),
            ["create", "start", "die", "destroy", "rename", "pause", "unpause"]
                .map(String::from)
                .to_vec(),
        ),
    ]);
    let stream = app
        .docker
        .events(Some(EventsOptions {
            filters: Some(filters),
            ..Default::default()
        }))
        .filter_map(|e| async move {
            let e = e.ok()?;
            let actor = e.actor.unwrap_or_default();
            let data = serde_json::json!({
                "action": e.action,
                "id": actor.id,
                "name": actor.attributes.and_then(|mut a| a.remove("name")),
            });
            Some(Ok(Event::default().json_data(data).ok()?))
        });
    Sse::new(stream).keep_alive(KeepAlive::default())
}
