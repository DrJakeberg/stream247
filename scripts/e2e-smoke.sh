#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="stream247-e2e-$RANDOM"
PORT="${STREAM247_E2E_PORT:-3004}"
WORKDIR="$(pwd)"
TMP_DIR="$(mktemp -d)"
ENV_FILE="$TMP_DIR/.env"
OVERRIDE_FILE="$TMP_DIR/docker-compose.override.yml"
ROOT_ENV_FILE="$WORKDIR/.env"
ROOT_ENV_BACKUP="$TMP_DIR/root.env.backup"
OUTPUT_DIR="$TMP_DIR/output"

cleanup() {
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f docker-compose.yml -f "$OVERRIDE_FILE" down -v >/dev/null 2>&1 || true
  if [ -f "$ROOT_ENV_BACKUP" ]; then
    mv "$ROOT_ENV_BACKUP" "$ROOT_ENV_FILE"
  else
    rm -f "$ROOT_ENV_FILE"
  fi
  chmod -R 0777 "$TMP_DIR" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR" >/dev/null 2>&1 || true
}

trap cleanup EXIT

mkdir -p "$TMP_DIR/media" "$TMP_DIR/postgres" "$TMP_DIR/redis" "$OUTPUT_DIR/primary" "$OUTPUT_DIR/secondary-a" "$OUTPUT_DIR/secondary-b"

cat >"$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
APP_URL=http://127.0.0.1:${PORT}
APP_SECRET=stream247-e2e-secret
POSTGRES_DB=stream247
POSTGRES_USER=stream247
POSTGRES_PASSWORD=stream247
DATABASE_URL=postgresql://stream247:stream247@postgres:5432/stream247
REDIS_URL=redis://redis:6379
STREAM247_WEB_IMAGE=stream247-web:test
STREAM247_WORKER_IMAGE=stream247-worker:test
STREAM247_PLAYOUT_IMAGE=stream247-worker:test
STREAM_OUTPUT_URL=/tmp/stream-output/primary
STREAM_OUTPUT_KEY=primary.flv
TRAEFIK_HOST=stream247.local
TRAEFIK_ACME_EMAIL=devnull@example.com
CHANNEL_TIMEZONE=Europe/Berlin
MEDIA_LIBRARY_ROOT=/app/data/media
EOF

cat >"$OVERRIDE_FILE" <<EOF
services:
  web:
    ports:
      - "127.0.0.1:${PORT}:3000"
    volumes:
      - ${TMP_DIR}/media:/app/data/media
  worker:
    volumes:
      - ${TMP_DIR}/media:/app/data/media
  playout:
    volumes:
      - ${TMP_DIR}/media:/app/data/media
      - ${OUTPUT_DIR}:/tmp/stream-output
  postgres:
    volumes:
      - ${TMP_DIR}/postgres:/var/lib/postgresql/data
  redis:
    volumes:
      - ${TMP_DIR}/redis:/data
EOF

if [ -f "$ROOT_ENV_FILE" ]; then
  cp "$ROOT_ENV_FILE" "$ROOT_ENV_BACKUP"
fi

cp "$ENV_FILE" "$ROOT_ENV_FILE"

docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f docker-compose.yml -f "$OVERRIDE_FILE" up -d

for _ in $(seq 1 40); do
  if wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

wget -qO- "http://127.0.0.1:${PORT}/api/system/readiness" >/dev/null

PLAYWRIGHT_BASE_URL="http://127.0.0.1:${PORT}" \
E2E_OWNER_EMAIL="${E2E_OWNER_EMAIL:-owner@example.com}" \
E2E_OWNER_PASSWORD="${E2E_OWNER_PASSWORD:-stream247-owner-pass}" \
E2E_SECONDARY_OUTPUT_ROOT="/tmp/stream-output" \
pnpm dlx @playwright/test@1.56.1 test tests/e2e/admin-smoke.spec.ts --config=playwright.config.ts --reporter=line
