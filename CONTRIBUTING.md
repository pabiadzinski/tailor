# Contributing

You need Rust and Docker; the browser tests also need Node.

```sh
make dev     # start the demo log generators and run tailr on :8080
make test    # unit tests
make e2e     # browser tests (Playwright) against fixture containers in e2e/
make lint    # clippy with warnings as errors
make down    # stop the demo stack
```

`make help` lists everything. `make flood` starts a high-rate log generator, `make record` re-records `demo/demo.gif` (needs ffmpeg and gifsicle).

In debug builds `static/` is read from disk, so frontend changes only need a page reload. Rust changes need a restart (`make run`).

`demo/` is a compose project with fake services writing slog, JSON, nginx, ANSI and a custom format, plus one that crashes periodically.

Pull requests run the unit and browser tests. Every push to `main` publishes `latest`; a `v1.2.3` tag publishes `1.2.3` and `1.2`.

## How it works

The server parses, the browser renders.

- `src/logs.rs` streams one or more containers over SSE: their recent lines merged by timestamp, then each followed live. Event ids are resume positions, so a reconnect continues right after the last line.
- `src/line.rs` turns a raw line into `{ts, level, plain, segs, json, trace}`: text without ANSI codes, style segments over it, the JSON layout and the trace id.
- `src/rules.rs` decides the level; `src/config.rs` reads options and the rules file.
- `src/search.rs` scans whole logs for history search and trace lookup.
- `src/events.rs` forwards Docker events, so the browser notices restarts.
- `static/` is plain ES modules without a build step: `list.js` keeps the buffer and renders a virtualized list, `render.js` builds rows, `stream.js` handles the connection.
