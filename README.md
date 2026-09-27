# tailr

A small web UI for tailing Docker container logs. One Rust binary, no database, an image under 2 MB.

<p align="center">
  <img src="demo/demo.gif" alt="tailr demo" width="800">
</p>

- Live logs of a container, a whole compose project or any containers you pick, merged by time
- Log levels from JSON, logfmt and plain text, configurable per container
- Search with match navigation, over loaded lines or the whole history
- Click a trace id to see that trace across all containers
- Colors, pretty-printed JSON, copy a line as it was logged
- Keeps history across container restarts and handles 100k+ lines smoothly

## Quick start

```yaml
services:
  tailr:
    image: ghcr.io/pabiadzinski/tailr:latest
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: unless-stopped
```

Open http://localhost:8080. Images are built for `linux/amd64` and `linux/arm64`.

> [!WARNING]
> tailr is meant for local use: there is no authentication, so keep the port on localhost.

## Usage

- **Sidebar:** click a container, or a project name to see all its containers in one view. ⌘/Ctrl+click adds or removes a container.
- **Search:** Enter / Shift+Enter jump between matches, the funnel shows only matching lines, Alt+Enter searches the whole history. `/` focuses the search, Esc clears it.
- **Traces:** click a trace id in a line, or paste one into "Find trace ID". Recognized as `trace_id`, `traceId`, `trace-id` or `trace.id`.
- **Lines:** click a JSON line to expand it, hover a line to copy it.

## Configuration

Settings are command line options or environment variables (`tailr --help`):

| Option | Variable | Default | |
|---|---|---|---|
| `--host` | `TAILR_HOST` | `0.0.0.0` | Address to listen on |
| `--port` | `PORT` | `8080` | HTTP port |
| `--config` | `TAILR_CONFIG` | `tailr.toml` | Rules file |
| `--level-key`, `--error`, `--warn`, `--info`, `--debug`, `--stderr` | `TAILR_LEVEL_KEY`, `TAILR_ERROR`, … | | Rule for all containers |

### Log levels

The level comes from a `level`, `lvl`, `severity` or `log_level` key, otherwise from the first level word in the line (`ERROR`, `WARN`, …). Lines on stderr without a level count as errors.

Change this for all containers with options or variables, for example `TAILR_STDERR=""` to stop treating stderr as errors. For rules per container, mount a rules file as `/tailr.toml`:

```toml
[[rule]]
container = "myapp-api-*"   # glob on the container name; omit to match all
level_key = "severity"      # key that holds the level
error = '^\[E\]'            # case-insensitive regex, also warn, info, debug
stderr = ""                 # level for stderr lines without one; "" turns it off
```

Later rules override earlier ones, and options override the file. Regexes use the Rust [`regex`](https://docs.rs/regex) syntax. Invalid rules stop tailr at startup.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
