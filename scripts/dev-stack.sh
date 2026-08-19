#!/usr/bin/env bash
#
# Long-lived development stack.
#
# The smoke scripts each bring a stack up, run one thing and tear it down, which costs about a
# minute per iteration and leaves nothing to look at afterwards. This one stays up.
#
# It also runs *without* the worker, playout and uplink containers by default, and that is the
# point rather than a shortcut: those are what continuously rewrite heartbeats and readiness, which
# is exactly why /live could not be snapshot-tested. With nothing mutating runtime state, the whole
# UI — including the live surface — renders identically on every load. Use `--with-runtime` when the
# behaviour under test *is* the playout loop.
#
#   scripts/dev-stack.sh up               start (or reuse) the stack and seed the fixture
#   scripts/dev-stack.sh up --with-runtime  also start worker/playout/uplink
#   scripts/dev-stack.sh seed             re-apply the fixture to a running stack
#   scripts/dev-stack.sh status           URL, health, container states
#   scripts/dev-stack.sh logs [service]   follow logs
#   scripts/dev-stack.sh reset            wipe data and start clean
#   scripts/dev-stack.sh down             stop and remove

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_NAME="${DEV_STACK_PROJECT:-stream247-dev}"
PORT="${DEV_STACK_PORT:-3020}"
STATE_DIR="${DEV_STACK_STATE_DIR:-$ROOT_DIR/.dev-stack}"
ENV_FILE="$STATE_DIR/.env"
OVERRIDE_FILE="$STATE_DIR/docker-compose.override.yml"
COOKIE_JAR="$STATE_DIR/cookies.txt"
BASE_URL="http://127.0.0.1:${PORT}"

# shellcheck source=lib/dev-fixture.sh
. "$ROOT_DIR/scripts/lib/dev-fixture.sh"

require() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }; }
require docker
require curl
require jq

RUNTIME_SERVICES="worker playout uplink relay"
SERVICES="postgres redis web"

write_config() {
  mkdir -p "$STATE_DIR/media" "$STATE_DIR/postgres" "$STATE_DIR/redis"

  cat >"$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
APP_URL=${BASE_URL}
APP_SECRET=stream247-dev-stack-secret-0123456789
POSTGRES_DB=stream247
POSTGRES_USER=stream247
POSTGRES_PASSWORD=stream247
DATABASE_URL=postgresql://stream247:stream247@postgres:5432/stream247
REDIS_URL=redis://redis:6379
STREAM247_WEB_IMAGE=stream247-web:test
STREAM247_WORKER_IMAGE=stream247-worker:test
STREAM247_PLAYOUT_IMAGE=stream247-worker:test
STREAM_OUTPUT_URL=/tmp/stream-output
STREAM_OUTPUT_KEY=dev.flv
TRAEFIK_HOST=stream247.local
TRAEFIK_ACME_EMAIL=devnull@example.com
CHANNEL_TIMEZONE=Europe/Berlin
MEDIA_LIBRARY_ROOT=/app/data/media
EOF

  cat >"$OVERRIDE_FILE" <<EOF
services:
  web:
    # Compose *merges* these lists rather than replacing them, so every one needs !override:
    #  - ports: otherwise the base file's 3000:3000 is published too and collides with whatever
    #    already holds that port.
    #  - env_file: the base points at the repo's own .env, which carries real credentials. Without
    #    the override the container reads those instead of the dev values and fails to reach its
    #    database. e2e-smoke.sh solves this by overwriting the repo .env and restoring it on exit;
    #    pointing the directive elsewhere leaves the developer's file untouched.
    ports: !override
      - "127.0.0.1:${PORT}:3000"
    env_file: !override
      - ${ENV_FILE}
    volumes:
      - ${STATE_DIR}/media:/app/data/media
  worker:
    env_file: !override
      - ${ENV_FILE}
    volumes:
      - ${STATE_DIR}/media:/app/data/media
  playout:
    env_file: !override
      - ${ENV_FILE}
    volumes:
      - ${STATE_DIR}/media:/app/data/media
  uplink:
    env_file: !override
      - ${ENV_FILE}
  postgres:
    env_file: !override
      - ${ENV_FILE}
    volumes:
      - ${STATE_DIR}/postgres:/var/lib/postgresql/data
  redis:
    volumes:
      - ${STATE_DIR}/redis:/data
EOF
}

compose() {
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" \
    -f docker-compose.yml -f "$OVERRIDE_FILE" "$@"
}

wait_for_web() {
  local attempt
  for attempt in $(seq 1 60); do
    if curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Web did not become reachable at ${BASE_URL}." >&2
  compose ps
  return 1
}

cmd_up() {
  local with_runtime=0
  [ "${1:-}" = "--with-runtime" ] && with_runtime=1

  write_config

  local services="$SERVICES"
  [ "$with_runtime" -eq 1 ] && services="$SERVICES $RUNTIME_SERVICES"

  # shellcheck disable=SC2086
  compose up -d $services
  wait_for_web

  rm -f "$COOKIE_JAR"
  seed_dev_fixture "$BASE_URL" "$COOKIE_JAR"

  echo ""
  echo "Dev stack is up at ${BASE_URL}"
  if [ "$with_runtime" -eq 1 ]; then
    echo "Runtime containers are running: readiness and heartbeats will keep changing."
  else
    echo "Runtime containers are stopped, so the UI renders deterministically."
  fi
}

cmd_seed() { wait_for_web && rm -f "$COOKIE_JAR" && seed_dev_fixture "$BASE_URL" "$COOKIE_JAR"; }
cmd_status() {
  echo "URL: ${BASE_URL}"
  curl -fsS "${BASE_URL}/api/ready" >/dev/null 2>&1 && echo "Readiness: ok" || echo "Readiness: not ready"
  compose ps --format "table {{.Service}}\t{{.Status}}" 2>/dev/null || true
}
cmd_logs() { compose logs -f "${1:-}"; }
cmd_down() { [ -f "$ENV_FILE" ] && compose down -v >/dev/null 2>&1 || true; echo "Dev stack removed."; }
# Postgres writes its data directory as its own user. Under rootless Docker that lands on a subuid
# the invoking user cannot remove, so the cleanup runs inside a container where the ownership lines
# up. Removing the contents rather than the directory keeps the bind-mount target in place.
cmd_purge_state() {
  if [ -d "$STATE_DIR" ]; then
    docker run --rm -v "$STATE_DIR:/state" alpine:3 sh -c 'rm -rf /state/postgres /state/redis /state/media' >/dev/null 2>&1 || true
    rm -rf "$STATE_DIR" 2>/dev/null || true
  fi
}

cmd_reset() { cmd_down; cmd_purge_state; cmd_up "$@"; }

case "${1:-up}" in
  up) shift || true; cmd_up "$@" ;;
  seed) cmd_seed ;;
  status) cmd_status ;;
  logs) shift || true; cmd_logs "$@" ;;
  reset) shift || true; cmd_reset "$@" ;;
  down) cmd_down ;;
  *) echo "Usage: $0 {up [--with-runtime]|seed|status|logs [service]|reset|down}" >&2; exit 1 ;;
esac
