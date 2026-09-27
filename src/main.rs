mod api;
mod config;
mod errors;
mod events;
mod line;
mod logs;
mod rules;
mod search;

use std::{future::IntoFuture, sync::Arc};

use axum::{Router, routing::get};
use clap::Parser;
use bollard::Docker;
use tokio::signal::unix::{SignalKind, signal};

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[tokio::main]
async fn main() {
    let args = config::Args::parse();
    let addr = format!("{}:{}", args.host, args.port);
    let rules = args.rules();
    let docker = Docker::connect_with_defaults().expect("failed to connect to docker");
    docker.ping().await.expect("docker is not reachable");

    let app = Router::new()
        .route("/api/containers", get(api::containers))
        .route("/api/logs", get(logs::logs))
        .route("/api/events", get(events::events))
        .route("/api/search", get(search::search))
        .route("/api/errors", get(errors::errors))
        .fallback(api::asset)
        .with_state(Arc::new(api::App {
            docker,
            rules,
        }));

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("tailr {VERSION} listening on http://{addr}");
    tokio::select! {
        r = axum::serve(listener, app).into_future() => r.unwrap(),
        _ = shutdown_signal() => {}
    }
}

async fn shutdown_signal() {
    let mut term = signal(SignalKind::terminate()).expect("failed to install SIGTERM handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
}
