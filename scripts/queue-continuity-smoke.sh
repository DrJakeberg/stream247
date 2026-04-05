#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="stream247-queue-$RANDOM"
PORT="${STREAM247_QUEUE_SMOKE_PORT:-3003}"
WORKDIR="$(pwd)"
TMP_DIR="$(mktemp -d)"
ENV_FILE="$TMP_DIR/.env"
OVERRIDE_FILE="$TMP_DIR/docker-compose.override.yml"
ROOT_ENV_FILE="$WORKDIR/.env"
ROOT_ENV_BACKUP="$TMP_DIR/root.env.backup"
CHANNEL_TIMEZONE="${STREAM247_QUEUE_SMOKE_TIMEZONE:-Europe/Berlin}"
# Seed the schedule in the same timezone the worker uses to resolve active blocks.
DAY_OF_WEEK="$(TZ="$CHANNEL_TIMEZONE" date +%w)"
OUTPUT_NAME="continuity.flv"

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

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

compose() {
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f docker-compose.yml -f "$OVERRIDE_FILE" "$@"
}

psql_query() {
  compose exec -T postgres psql -U stream247 -d stream247 -At -F '|' -c "$1"
}

seed_queue_state() {
  local updated_at
  updated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  compose exec -T postgres psql -U stream247 -d stream247 <<EOF
BEGIN;
DELETE FROM schedule_blocks;
DELETE FROM pools WHERE id = 'pool_queue_smoke';
INSERT INTO pools (
  id,
  name,
  source_ids,
  playback_mode,
  cursor_asset_id,
  insert_asset_id,
  insert_every_items,
  items_since_insert,
  updated_at
)
VALUES (
  'pool_queue_smoke',
  'Queue Smoke Pool',
  '["source-local-library"]',
  'round-robin',
  '',
  '',
  0,
  0,
  '${updated_at}'
);
INSERT INTO schedule_blocks (
  id,
  title,
  category_name,
  day_of_week,
  start_hour,
  start_minute_of_day,
  duration_minutes,
  show_id,
  pool_id,
  source_name
)
VALUES (
  'block_queue_smoke',
  'Queue Smoke',
  'Smoke',
  ${DAY_OF_WEEK},
  0,
  0,
  1440,
  '',
  'pool_queue_smoke',
  'Local Media Library'
);
COMMIT;
EOF
}

wait_for_initial_runtime() {
  for _ in $(seq 1 45); do
    sync_runs="$(psql_query "SELECT count(*) FROM source_sync_runs WHERE source_id = 'source-local-library';" 2>/dev/null || true)"
    source_rows="$(psql_query "SELECT count(*) FROM sources WHERE id = 'source-local-library';" 2>/dev/null || true)"
    if [ "${sync_runs:-0}" -ge 1 ] && [ "${source_rows:-0}" -ge 1 ]; then
      return 0
    fi
    sleep 2
  done

  echo "Initial worker runtime did not finish local-library bootstrap in time." >&2
  exit 1
}

generate_fixture() {
  local output_path="$1"
  local hex_color="$2"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=${hex_color}:s=1280x720:r=30" \
    -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" \
    -shortest -t 12 \
    -c:v libx264 -pix_fmt yuv420p \
    -c:a aac -b:a 128k \
    "$output_path"
}

dump_failure_context() {
  echo
  echo "Queue continuity smoke failed. Runtime context:"
  compose ps || true
  echo
  psql_query "SELECT id, status, connector_kind, enabled, last_synced_at FROM sources WHERE id = 'source-local-library';" || true
  echo
  psql_query "SELECT id, status, discovered_assets, ready_assets, error_message FROM source_sync_runs WHERE source_id = 'source-local-library' ORDER BY finished_at DESC LIMIT 5;" || true
  echo
  psql_query "SELECT status, current_asset_id, current_title, queue_version, transition_state, selection_reason_code, fallback_tier, crash_loop_detected, message, coalesce(json_array_length(queue_items::json), 0) FROM playout_runtime LIMIT 1;" || true
  echo
  psql_query "SELECT id, cursor_asset_id, items_since_insert FROM pools WHERE id = 'pool_queue_smoke';" || true
  echo
  psql_query "SELECT id, day_of_week, start_minute_of_day, duration_minutes, pool_id, source_name FROM schedule_blocks WHERE id = 'block_queue_smoke';" || true
  echo
  psql_query "SELECT id, title, status, include_in_programming, path FROM assets WHERE source_id = 'source-local-library' ORDER BY title ASC;" || true
  echo
  compose exec -T worker sh -lc 'ls -la /app/data/media || true' || true
  echo
  compose logs --tail 40 worker || true
  echo
  compose logs --tail 40 playout || true
}

require_command docker
require_command ffmpeg
require_command wget

mkdir -p "$TMP_DIR/media" "$TMP_DIR/postgres" "$TMP_DIR/redis" "$TMP_DIR/output"

generate_fixture "$TMP_DIR/media/continuity-a.mp4" "0x124f7a"
generate_fixture "$TMP_DIR/media/continuity-b.mp4" "0x7a3d12"

cat >"$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
APP_URL=http://127.0.0.1:${PORT}
APP_SECRET=stream247-queue-smoke
POSTGRES_DB=stream247
POSTGRES_USER=stream247
POSTGRES_PASSWORD=stream247
DATABASE_URL=postgresql://stream247:stream247@postgres:5432/stream247
REDIS_URL=redis://redis:6379
STREAM247_WEB_IMAGE=stream247-web:test
STREAM247_WORKER_IMAGE=stream247-worker:test
STREAM247_PLAYOUT_IMAGE=stream247-worker:test
STREAM_OUTPUT_URL=/tmp/stream-output
STREAM_OUTPUT_KEY=${OUTPUT_NAME}
TRAEFIK_HOST=stream247.local
TRAEFIK_ACME_EMAIL=devnull@example.com
CHANNEL_TIMEZONE=${CHANNEL_TIMEZONE}
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
      - ${TMP_DIR}/output:/tmp/stream-output
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

compose up -d

for _ in $(seq 1 40); do
  if wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

wait_for_initial_runtime

initial_ready_assets="$(psql_query "SELECT count(*) FROM assets WHERE source_id = 'source-local-library' AND status = 'ready';")"
if [ "${initial_ready_assets:-0}" -lt 2 ]; then
  dump_failure_context
  echo "Expected local-library bootstrap to discover at least two ready assets but found ${initial_ready_assets:-0}." >&2
  exit 1
fi

seed_queue_state

ready_assets="$(psql_query "SELECT count(*) FROM assets WHERE source_id = 'source-local-library' AND status = 'ready';")"
if [ "${ready_assets:-0}" -lt 2 ]; then
  dump_failure_context
  echo "Expected at least two ready local-library assets but found ${ready_assets:-0}." >&2
  exit 1
fi

seeded_pool="$(psql_query "SELECT count(*) FROM pools WHERE id = 'pool_queue_smoke';")"
seeded_blocks="$(psql_query "SELECT count(*) FROM schedule_blocks WHERE id = 'block_queue_smoke';")"
if [ "${seeded_pool:-0}" -ne 1 ] || [ "${seeded_blocks:-0}" -ne 1 ]; then
  dump_failure_context
  echo "Expected queue smoke pool and schedule block to be present after seeding." >&2
  exit 1
fi

seen_assets=""
observed_queue_change=0
queue_version_baseline=""
observed_rows=""
success=0

for _ in $(seq 1 24); do
  runtime_row="$(psql_query "SELECT status, current_asset_id, queue_version, crash_loop_detected, coalesce(json_array_length(queue_items::json), 0), message FROM playout_runtime LIMIT 1;")"
  IFS='|' read -r status current_asset_id queue_version crash_loop_detected queue_size message <<<"$runtime_row"
  observed_rows="${observed_rows}${status}|${current_asset_id}|${queue_version}|${queue_size}|${message}"$'\n'

  if [ "$status" = "failed" ] || [ "$status" = "degraded" ]; then
    dump_failure_context
    echo "Playout entered unhealthy state: ${status} (${message})" >&2
    exit 1
  fi

  if [ "$crash_loop_detected" = "t" ]; then
    dump_failure_context
    echo "Playout crash-loop protection activated during queue continuity smoke." >&2
    exit 1
  fi

  if [ -n "$queue_version" ] && [ "$queue_version" != "0" ]; then
    if [ -z "$queue_version_baseline" ]; then
      queue_version_baseline="$queue_version"
    elif [ "$queue_version" != "$queue_version_baseline" ]; then
      observed_queue_change=1
    fi
  fi

  if [ -n "$current_asset_id" ]; then
    case "|$seen_assets|" in
      *"|$current_asset_id|"*) ;;
      *)
        seen_assets="${seen_assets:+$seen_assets|}$current_asset_id"
        ;;
    esac
  fi

  unique_assets="$(printf '%s\n' "$seen_assets" | tr '|' '\n' | sed '/^$/d' | wc -l | tr -d ' ')"
  if [ "$unique_assets" -ge 2 ] && [ "$observed_queue_change" -eq 1 ] && [ "${queue_size:-0}" -ge 1 ]; then
    success=1
    break
  fi

  sleep 5
done

if [ "$success" -ne 1 ]; then
  dump_failure_context
  printf '\nObserved runtime rows:\n%s' "$observed_rows"
  echo "Queue continuity smoke did not observe two distinct current assets plus a queue version change." >&2
  exit 1
fi

final_runtime_row="$(psql_query "SELECT status, process_pid, current_destination_id FROM playout_runtime LIMIT 1;")"
IFS='|' read -r final_status final_pid final_destination_id <<<"$final_runtime_row"

if [ "${final_status}" != "running" ] || [ "${final_pid:-0}" -le 0 ] || [ -z "${final_destination_id}" ]; then
  dump_failure_context
  echo "Expected queue continuity smoke to end with an active playout process and destination." >&2
  exit 1
fi

echo "Queue continuity smoke passed."
