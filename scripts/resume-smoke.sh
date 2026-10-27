#!/usr/bin/env bash
#
# M124 (PLANS.md M77): an item cut part-way continues where it was cut, on the real stack.
#
# A pool of two 5:30 local files. Once the first has aired more than two minutes, the playout container is
# killed (SIGKILL: ffmpeg dies with it and no exit handler runs, as at a redeploy, a repin or a host
# restart) and started again. The run that comes up must be the same item, started 10 s before the last
# position a playout cycle recorded (resume_points), and it must stay on air. The run the kill left open is
# closed as process-gone at the boot, as before.
#
# Mutation check, by hand: with the resume pick removed from choosePlaybackCandidate the run after the boot
# is the pool's next file from 0, and this fails at "the same item".
set -euo pipefail

PROJECT_NAME="stream247-resume-$RANDOM"
PORT="${STREAM247_RESUME_SMOKE_PORT:-3004}"
WORKDIR="$(pwd)"
TMP_DIR="$(mktemp -d)"
ENV_FILE="$TMP_DIR/.env"
OVERRIDE_FILE="$TMP_DIR/docker-compose.override.yml"
ROOT_ENV_FILE="$WORKDIR/.env"
ROOT_ENV_BACKUP="$TMP_DIR/root.env.backup"
CHANNEL_TIMEZONE="${STREAM247_RESUME_SMOKE_TIMEZONE:-Europe/Berlin}"
DAY_OF_WEEK="$(TZ="$CHANNEL_TIMEZONE" date +%w)"
OUTPUT_NAME="resume.flv"
FIXTURE_SECONDS=330
# More than the 2 minutes an item must have aired to be continued, and well short of 2 minutes before its end.
KILL_AFTER_POSITION=140

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

seed_schedule() {
  local updated_at
  updated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  compose exec -T postgres psql -U stream247 -d stream247 <<EOF
BEGIN;
DELETE FROM schedule_blocks;
DELETE FROM pools WHERE id = 'pool_resume_smoke';
INSERT INTO pools (id, name, source_ids, playback_mode, cursor_asset_id, insert_asset_id, insert_every_items, items_since_insert, updated_at)
VALUES ('pool_resume_smoke', 'Resume Smoke Pool', '["source-local-library"]', 'round-robin', '', '', 0, 0, '${updated_at}');
INSERT INTO schedule_blocks (id, title, category_name, day_of_week, start_hour, start_minute_of_day, duration_minutes, show_id, pool_id, source_name)
VALUES ('block_resume_smoke', 'Resume Smoke', 'Smoke', ${DAY_OF_WEEK}, 0, 0, 1440, '', 'pool_resume_smoke', 'Local Media Library');
COMMIT;
EOF
}

generate_fixture() {
  local output_path="$1"
  local hex_color="$2"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=${hex_color}:s=640x360:r=30" \
    -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" \
    -shortest -t "$FIXTURE_SECONDS" \
    -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
    -c:a aac -b:a 96k \
    "$output_path"
}

dump_failure_context() {
  echo
  echo "Resume smoke failed. Runtime context:"
  compose ps || true
  echo
  psql_query "SELECT status, current_asset_id, selection_reason_code, process_started_at, current_start_offset_seconds, resume_points, message FROM playout_runtime LIMIT 1;" || true
  echo
  psql_query "SELECT id, cursor_asset_id FROM pools WHERE id = 'pool_resume_smoke';" || true
  echo
  psql_query "SELECT id, title, status, duration_seconds, path FROM assets WHERE source_id = 'source-local-library' ORDER BY title ASC;" || true
  echo
  psql_query "SELECT started_at, ended_at, asset_id, reason_code, input_kind, start_offset_seconds, aired_seconds, end_reason FROM as_run_log ORDER BY started_at ASC;" || true
  echo
  compose logs --tail 80 playout || true
  echo
  compose logs --tail 30 worker || true
}

fail() {
  dump_failure_context
  echo "$1" >&2
  exit 1
}

require_command docker
# shellcheck source=lib/ffmpeg-fallback.sh
. "$(dirname "$0")/lib/ffmpeg-fallback.sh"
require_command wget

mkdir -p "$TMP_DIR/media" "$TMP_DIR/postgres" "$TMP_DIR/output"
enable_ffmpeg_fallback "$TMP_DIR"

generate_fixture "$TMP_DIR/media/resume-a.mp4" "0x124f7a"
generate_fixture "$TMP_DIR/media/resume-b.mp4" "0x7a3d12"

cat >"$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
APP_URL=http://127.0.0.1:${PORT}
APP_SECRET=stream247-resume-smoke-0123456789abcdef
POSTGRES_DB=stream247
POSTGRES_USER=stream247
POSTGRES_PASSWORD=stream247
DATABASE_URL=postgresql://stream247:stream247@postgres:5432/stream247
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
    ports: !override
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

# Both files discovered, with their probed length (M96): the 2-minute rule needs it.
for _ in $(seq 1 60); do
  ready="$(psql_query "SELECT count(*) FROM assets WHERE source_id = 'source-local-library' AND status = 'ready' AND duration_seconds > 300;" 2>/dev/null || true)"
  if [ "${ready:-0}" -ge 2 ]; then
    break
  fi
  sleep 2
done
[ "${ready:-0}" -ge 2 ] || fail "Expected two ready local files with their length, found ${ready:-0}."

seed_schedule

# The pool's first pick on air, and a position past two minutes recorded by the playout's own cycles.
asset_on_air=""
position=0
for _ in $(seq 1 80); do
  row="$(psql_query "SELECT current_asset_id, selection_reason_code, resume_points FROM playout_runtime LIMIT 1;" 2>/dev/null || true)"
  IFS='|' read -r current_asset_id reason_code resume_points <<<"$row"
  if [ "$reason_code" = "scheduled_match" ] && [ -n "$current_asset_id" ]; then
    asset_on_air="$current_asset_id"
    position="$(printf '%s' "$resume_points" | python3 -c '
import json, sys
points = json.loads(sys.stdin.read() or "[]")
match = [p for p in points if p.get("poolId") == "pool_resume_smoke" and p.get("assetId") == sys.argv[1]]
print(match[0]["positionSeconds"] if match else 0)' "$current_asset_id")"
    if [ "${position:-0}" -ge "$KILL_AFTER_POSITION" ]; then
      break
    fi
  fi
  sleep 5
done
[ -n "$asset_on_air" ] || fail "The pool's first item never went on air."
[ "${position:-0}" -ge "$KILL_AFTER_POSITION" ] || fail "No recorded position past ${KILL_AFTER_POSITION}s (last: ${position:-0})."
cursor="$(psql_query "SELECT cursor_asset_id FROM pools WHERE id = 'pool_resume_smoke';")"
[ "$cursor" = "$asset_on_air" ] || fail "The pool's position ($cursor) does not name the item on air ($asset_on_air)."
echo "On air: $asset_on_air, last recorded position ${position}s. Killing the playout container."

killed_at="$(date -u +"%Y-%m-%dT%H:%M:%S")"
compose kill -s SIGKILL playout
# The position left behind is the one the last cycle wrote; read it again after the kill.
position="$(psql_query "SELECT resume_points FROM playout_runtime LIMIT 1;" | python3 -c '
import json, sys
points = json.loads(sys.stdin.read() or "[]")
match = [p for p in points if p.get("poolId") == "pool_resume_smoke" and p.get("assetId") == sys.argv[1]]
print(match[0]["positionSeconds"] if match else 0)' "$asset_on_air")"
[ "${position:-0}" -ge "$KILL_AFTER_POSITION" ] || fail "The kill left no position for $asset_on_air (found ${position:-0})."
sleep 5
compose up -d playout

resumed_row=""
for _ in $(seq 1 30); do
  resumed_row="$(psql_query "SELECT id, asset_id, reason_code, input_kind, start_offset_seconds FROM as_run_log WHERE started_at > '${killed_at}' AND target_kind = 'asset' ORDER BY started_at ASC LIMIT 1;" 2>/dev/null || true)"
  if [ -n "$resumed_row" ]; then
    break
  fi
  sleep 3
done
[ -n "$resumed_row" ] || fail "No run started after the playout came back."
IFS='|' read -r resumed_id resumed_asset resumed_reason resumed_input resumed_offset <<<"$resumed_row"
[ "$resumed_asset" = "$asset_on_air" ] || fail "The run after the boot is $resumed_asset, not the same item $asset_on_air."
[ "$resumed_reason" = "scheduled_match" ] || fail "The continued item started as $resumed_reason, not as the pool's pick."
[ "$resumed_input" = "local" ] || fail "The continued item played from $resumed_input, not from the file."
expected_offset=$((position - 10))
[ "${resumed_offset:-0}" -eq "$expected_offset" ] || fail "The item continued at ${resumed_offset}s, expected ${expected_offset}s (10 s before ${position}s)."

gone="$(psql_query "SELECT count(*) FROM as_run_log WHERE asset_id = '${asset_on_air}' AND end_reason = 'process-gone' AND started_at < '${killed_at}';")"
[ "${gone:-0}" -ge 1 ] || fail "The run the kill left open was not closed as process-gone."

# It stays on air from there, and the runtime says where it started.
sleep 25
row="$(psql_query "SELECT status, current_asset_id, current_start_offset_seconds FROM playout_runtime LIMIT 1;")"
IFS='|' read -r status current_asset_id current_offset <<<"$row"
[ "$status" = "running" ] || fail "Playout is $status after the continued start, not running."
[ "$current_asset_id" = "$asset_on_air" ] || fail "The item on air is $current_asset_id, not the continued $asset_on_air."
[ "$current_offset" = "$expected_offset" ] || fail "The runtime says the process started at ${current_offset}s, not ${expected_offset}s."
still_open="$(psql_query "SELECT ended_at FROM as_run_log WHERE id = '${resumed_id}';")"
[ -z "$still_open" ] || fail "The continued run ended already (${still_open})."
compose logs playout 2>/dev/null | grep -q '"playout.resume.start"' || fail "No playout.resume.start line in the playout log."

echo "Resume smoke passed: ${asset_on_air} cut at ${position}s by a container kill, continued at ${resumed_offset}s."
