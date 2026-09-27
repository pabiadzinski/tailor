FROM rust:1-alpine AS build
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src
COPY src src
COPY static static
RUN touch src/main.rs && cargo build --release

FROM scratch
COPY --from=build /app/target/release/tailr /tailr
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/tailr"]
