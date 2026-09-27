.PHONY: help dev run demo flood down test e2e lint record kill

COMPOSE := docker compose -f demo/compose.yaml
FLOOD := $(COMPOSE) --profile flood

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-8s\033[0m %s\n", $$1, $$2}'

dev: demo run ## Recreate demo stack and run tailr on :8080

run: kill ## Run tailr with demo rules on :8080
	TAILR_CONFIG=demo/tailr.toml cargo run

demo: ## Recreate demo log generators
	$(COMPOSE) up -d --force-recreate

flood: ## Start high-rate log generator
	$(FLOOD) up -d flood

down: ## Stop demo stack
	$(FLOOD) down

test: ## Run tests
	cargo test

e2e: ## Run browser tests against fixture containers
	cd e2e && npm ci --silent && npx playwright install chromium && npx playwright test

lint: ## Clippy with warnings as errors
	cargo clippy --all-targets -- -D warnings

record: ## Record demo/demo.gif from a fresh demo stack (needs ffmpeg, gifsicle)
	$(COMPOSE) up -d --force-recreate
	@sleep 40
	cd e2e && node record-demo.js

kill: ## Stop a running dev server
	@pkill -f 'target/debu[g]/tailr' || true
