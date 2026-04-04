#!/usr/bin/env bash
set -euo pipefail

POSTGRES_CONTAINER="stream247-fresh-db-$RANDOM"
WEB_CONTAINER="stream247-fresh-web-$RANDOM"
NETWORK_NAME="stream247-fresh-net-$RANDOM"
PORT="${STREAM247_FRESH_DB_SMOKE_PORT:-3001}"

cleanup() {
  docker rm -f "$WEB_CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
}

trap cleanup EXIT

docker network create "$NETWORK_NAME" >/dev/null

docker run -d \
  --name "$POSTGRES_CONTAINER" \
  --network "$NETWORK_NAME" \
  -e POSTGRES_DB=stream247 \
  -e POSTGRES_USER=stream247 \
  -e POSTGRES_PASSWORD=stream247 \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$POSTGRES_CONTAINER" pg_isready -U stream247 -d stream247 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker run -d \
  --name "$WEB_CONTAINER" \
  --network "$NETWORK_NAME" \
  -p "${PORT}:3000" \
  -e NODE_ENV=production \
  -e APP_URL="http://127.0.0.1:${PORT}" \
  -e APP_SECRET="stream247-fresh-db-smoke" \
  -e DATABASE_URL="postgresql://stream247:stream247@${POSTGRES_CONTAINER}:5432/stream247" \
  stream247-web:test >/dev/null

for _ in $(seq 1 30); do
  if wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 2
done

echo "Fresh DB bootstrap smoke failed."
docker logs "$WEB_CONTAINER" || true
docker logs "$POSTGRES_CONTAINER" || true
exit 1
