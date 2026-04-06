#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="stream247-runtime-$RANDOM"
PORT="${STREAM247_RUNTIME_PARITY_PORT:-3005}"
WORKDIR="$(pwd)"
TMP_DIR="$(mktemp -d)"
ENV_FILE="$TMP_DIR/.env"
OVERRIDE_FILE="$TMP_DIR/docker-compose.override.yml"
ROOT_ENV_FILE="$WORKDIR/.env"
ROOT_ENV_BACKUP="$TMP_DIR/root.env.backup"
COOKIE_JAR="$TMP_DIR/cookies.txt"
CHANNEL_TIMEZONE="${STREAM247_RUNTIME_PARITY_TIMEZONE:-Europe/Berlin}"
OWNER_EMAIL="${STREAM247_RUNTIME_PARITY_OWNER_EMAIL:-owner@example.com}"
OWNER_PASSWORD="${STREAM247_RUNTIME_PARITY_OWNER_PASSWORD:-stream247-runtime-pass}"
PRIMARY_OUTPUT_DIR="$TMP_DIR/output/primary"
SECONDARY_OUTPUT_DIR="$TMP_DIR/output/secondary"
PRIMARY_OUTPUT_FILE="$PRIMARY_OUTPUT_DIR/primary.flv"
SECONDARY_OUTPUT_FILE="$SECONDARY_OUTPUT_DIR/secondary.flv"
FIXTURE_DIR="$TMP_DIR/fixtures"
MEDIA_DIR="$TMP_DIR/media"
POSTGRES_DIR="$TMP_DIR/postgres"
REDIS_DIR="$TMP_DIR/redis"
BASE_URL="http://127.0.0.1:${PORT}"
PROGRAM_A_FILE="runtime-program-a.mp4"
PROGRAM_B_FILE="runtime-program-b.mp4"
AUDIO_BED_FILE="runtime-audio-bed.mp4"
CUE_INSERT_FILE="runtime-cue-insert.mp4"
SECONDARY_DESTINATION_NAME="Runtime Secondary Output"
POOL_NAME="Runtime Parity Pool"
BLOCK_TITLE="Runtime Parity Block"
DAY_OF_WEEK="$(TZ="$CHANNEL_TIMEZONE" date +%w)"
CURRENT_HOUR="$(TZ="$CHANNEL_TIMEZONE" date +%H)"
CURRENT_MINUTE="$(TZ="$CHANNEL_TIMEZONE" date +%M)"
START_MINUTE_OF_DAY="$((10#$CURRENT_HOUR * 60 + 10#$CURRENT_MINUTE))"

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

api_get() {
  local path="$1"
  curl -fsS -b "$COOKIE_JAR" "${BASE_URL}${path}"
}

api_post() {
  local path="$1"
  local payload="$2"
  curl -fsS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H "Content-Type: application/json" -X POST -d "$payload" "${BASE_URL}${path}"
}

api_put() {
  local path="$1"
  local payload="$2"
  curl -fsS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H "Content-Type: application/json" -X PUT -d "$payload" "${BASE_URL}${path}"
}

dump_failure_context() {
  echo
  echo "Runtime parity smoke failed. Runtime context:"
  compose ps || true
  echo
  api_get "/api/broadcast/state" 2>/dev/null | jq . || true
  echo
  psql_query "SELECT id, status, connector_kind, enabled, last_synced_at FROM sources WHERE id = 'source-local-library';" || true
  echo
  psql_query "SELECT id, status, discovered_assets, ready_assets, error_message FROM source_sync_runs WHERE source_id = 'source-local-library' ORDER BY finished_at DESC LIMIT 5;" || true
  echo
  psql_query "SELECT id, source_id, title, status, include_in_programming, path FROM assets WHERE source_id = 'source-local-library' ORDER BY title;" || true
  echo
  psql_query "SELECT id, name, source_ids, insert_asset_id, audio_lane_asset_id, audio_lane_volume_percent FROM pools ORDER BY name;" || true
  echo
  psql_query "SELECT id, title, day_of_week, start_minute_of_day, duration_minutes, pool_id, cuepoint_asset_id, cuepoint_offsets_seconds FROM schedule_blocks ORDER BY title;" || true
  echo
  psql_query "SELECT status, current_asset_id, current_title, selection_reason_code, current_destination_id, queue_version, insert_status, cuepoint_last_asset_id, live_bridge_status, live_bridge_input_type, live_bridge_input_url FROM playout_runtime LIMIT 1;" || true
  echo
  ls -lah "$PRIMARY_OUTPUT_DIR" "$SECONDARY_OUTPUT_DIR" || true
  echo
  compose logs --tail 80 worker || true
  echo
  compose logs --tail 80 playout || true
  echo
  compose logs --tail 40 web || true
  echo
  compose logs --tail 20 fixtures || true
}

generate_video_fixture() {
  local output_path="$1"
  local hex_color="$2"
  local frequency="$3"
  local duration="$4"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=${hex_color}:s=1280x720:r=30" \
    -f lavfi -i "sine=frequency=${frequency}:sample_rate=44100" \
    -t "$duration" \
    -c:v libx264 -pix_fmt yuv420p \
    -c:a aac -b:a 128k \
    "$output_path"
}

generate_hls_fixture() {
  local source_path="$1"
  local manifest_path="$2"
  ffmpeg -hide_banner -loglevel error -y \
    -i "$source_path" \
    -c:v copy \
    -c:a copy \
    -f hls \
    -hls_time 2 \
    -hls_list_size 0 \
    -hls_playlist_type vod \
    "$manifest_path"
}

wait_for_http() {
  for _ in $(seq 1 40); do
    if curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  dump_failure_context
  echo "Timed out waiting for the runtime parity stack to become healthy." >&2
  exit 1
}

wait_for_fixture_server() {
  for _ in $(seq 1 30); do
    if compose exec -T web sh -lc "wget -qO- http://fixtures:8000/bridge.m3u8 >/dev/null" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  dump_failure_context
  echo "Timed out waiting for the fixture HTTP server." >&2
  exit 1
}

wait_for_local_library_assets() {
  local minimum_ready_assets="$1"
  for _ in $(seq 1 40); do
    sync_runs="$(psql_query "SELECT count(*) FROM source_sync_runs WHERE source_id = 'source-local-library';" 2>/dev/null || true)"
    source_rows="$(psql_query "SELECT count(*) FROM sources WHERE id = 'source-local-library';" 2>/dev/null || true)"
    ready_assets="$(psql_query "SELECT count(*) FROM assets WHERE source_id = 'source-local-library' AND status = 'ready';" 2>/dev/null || true)"
    if [ "${sync_runs:-0}" -ge 1 ] && [ "${source_rows:-0}" -ge 1 ] && [ "${ready_assets:-0}" -ge "$minimum_ready_assets" ]; then
      return 0
    fi
    sleep 2
  done

  dump_failure_context
  echo "Timed out waiting for the local media library to finish scanning runtime parity fixtures." >&2
  exit 1
}

wait_for_runtime_ready() {
  local program_a_asset_id="$1"
  local program_b_asset_id="$2"
  local audio_asset_id="$3"
  for _ in $(seq 1 36); do
    snapshot="$(api_get "/api/broadcast/state" || true)"
    if printf '%s' "$snapshot" | jq -e \
      --arg program_a "$program_a_asset_id" \
      --arg program_b "$program_b_asset_id" \
      --arg audio_asset "$audio_asset_id" \
      '(.destinations | map(select(.active)) | length) >= 2
       and .audioLane.active == true
       and .audioLane.assetId == $audio_asset
       and (.playout.currentAssetId == $program_a or .playout.currentAssetId == $program_b)' >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  dump_failure_context
  echo "Runtime parity smoke did not observe scheduled playback with active multi-output and audio lane state." >&2
  exit 1
}

wait_for_output_files() {
  for _ in $(seq 1 24); do
    if [ -s "$PRIMARY_OUTPUT_FILE" ] && [ -s "$SECONDARY_OUTPUT_FILE" ]; then
      return 0
    fi
    sleep 3
  done

  dump_failure_context
  echo "Runtime parity smoke did not observe non-empty primary and secondary output files." >&2
  exit 1
}

wait_for_cuepoint_insert() {
  local cue_asset_id="$1"
  for _ in $(seq 1 24); do
    snapshot="$(api_get "/api/broadcast/state" || true)"
    if printf '%s' "$snapshot" | jq -e \
      --arg cue_asset "$cue_asset_id" \
      '.cuepoints.firedCount >= 1 and .cuepoints.lastAssetId == $cue_asset and (.cuepoints.lastTriggeredAt | length) > 0' >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  dump_failure_context
  echo "Runtime parity smoke did not observe a cuepoint-driven insert." >&2
  exit 1
}

wait_for_live_bridge_active() {
  for _ in $(seq 1 24); do
    snapshot="$(api_get "/api/broadcast/state" || true)"
    if printf '%s' "$snapshot" | jq -e \
      '.liveBridge.status == "active" and .playout.selectionReasonCode == "live_bridge"' >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  dump_failure_context
  echo "Runtime parity smoke did not observe an active Live Bridge takeover." >&2
  exit 1
}

wait_for_live_bridge_release() {
  local audio_asset_id="$1"
  for _ in $(seq 1 30); do
    snapshot="$(api_get "/api/broadcast/state" || true)"
    if printf '%s' "$snapshot" | jq -e \
      --arg audio_asset "$audio_asset_id" \
      '.liveBridge.status == "idle"
       and .audioLane.active == true
       and .audioLane.assetId == $audio_asset
       and .playout.selectionReasonCode != "live_bridge"' >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  dump_failure_context
  echo "Runtime parity smoke did not observe Live Bridge release back to scheduled playback." >&2
  exit 1
}

require_command curl
require_command docker
require_command ffmpeg
require_command jq

mkdir -p "$FIXTURE_DIR" "$MEDIA_DIR" "$POSTGRES_DIR" "$REDIS_DIR" "$PRIMARY_OUTPUT_DIR" "$SECONDARY_OUTPUT_DIR"
touch "$COOKIE_JAR"

generate_video_fixture "$MEDIA_DIR/$PROGRAM_A_FILE" "0x124f7a" "330" "12"
generate_video_fixture "$MEDIA_DIR/$PROGRAM_B_FILE" "0x7a3d12" "550" "12"
generate_video_fixture "$MEDIA_DIR/$AUDIO_BED_FILE" "0x245c2b" "220" "30"
generate_video_fixture "$MEDIA_DIR/$CUE_INSERT_FILE" "0x7a124f" "880" "4"
generate_video_fixture "$FIXTURE_DIR/bridge-source.mp4" "0x303030" "440" "20"
generate_hls_fixture "$FIXTURE_DIR/bridge-source.mp4" "$FIXTURE_DIR/bridge.m3u8"

cat >"$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
APP_URL=${BASE_URL}
APP_SECRET=stream247-runtime-smoke
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
CHANNEL_TIMEZONE=${CHANNEL_TIMEZONE}
MEDIA_LIBRARY_ROOT=/app/data/media
EOF

cat >"$OVERRIDE_FILE" <<EOF
services:
  web:
    ports:
      - "127.0.0.1:${PORT}:3000"
    volumes:
      - ${MEDIA_DIR}:/app/data/media
  worker:
    volumes:
      - ${MEDIA_DIR}:/app/data/media
  playout:
    volumes:
      - ${MEDIA_DIR}:/app/data/media
      - ${TMP_DIR}/output:/tmp/stream-output
  postgres:
    volumes:
      - ${POSTGRES_DIR}:/var/lib/postgresql/data
  redis:
    volumes:
      - ${REDIS_DIR}:/data
  fixtures:
    image: python:3.12-alpine
    command: ["sh", "-c", "python -m http.server 8000 -d /fixtures"]
    volumes:
      - ${FIXTURE_DIR}:/fixtures:ro
EOF

if [ -f "$ROOT_ENV_FILE" ]; then
  cp "$ROOT_ENV_FILE" "$ROOT_ENV_BACKUP"
fi

cp "$ENV_FILE" "$ROOT_ENV_FILE"

compose up -d
wait_for_http
wait_for_fixture_server

api_post "/api/setup/bootstrap" "$(jq -nc --arg email "$OWNER_EMAIL" --arg password "$OWNER_PASSWORD" '{email: $email, password: $password}')"
curl -fsS -b "$COOKIE_JAR" "${BASE_URL}/api/system/readiness" >/dev/null

wait_for_local_library_assets 4

PROGRAM_A_ASSET_ID="$(psql_query "SELECT id FROM assets WHERE source_id = 'source-local-library' AND path LIKE '%/${PROGRAM_A_FILE}' LIMIT 1;")"
PROGRAM_B_ASSET_ID="$(psql_query "SELECT id FROM assets WHERE source_id = 'source-local-library' AND path LIKE '%/${PROGRAM_B_FILE}' LIMIT 1;")"
AUDIO_ASSET_ID="$(psql_query "SELECT id FROM assets WHERE source_id = 'source-local-library' AND path LIKE '%/${AUDIO_BED_FILE}' LIMIT 1;")"
CUE_ASSET_ID="$(psql_query "SELECT id FROM assets WHERE source_id = 'source-local-library' AND path LIKE '%/${CUE_INSERT_FILE}' LIMIT 1;")"

if [ -z "$PROGRAM_A_ASSET_ID" ] || [ -z "$PROGRAM_B_ASSET_ID" ] || [ -z "$AUDIO_ASSET_ID" ] || [ -z "$CUE_ASSET_ID" ]; then
  dump_failure_context
  echo "Runtime parity smoke could not resolve one or more local-library assets." >&2
  exit 1
fi

psql_query "UPDATE assets SET include_in_programming = false WHERE id = '${AUDIO_ASSET_ID}';" >/dev/null

api_post "/api/pools" "$(jq -nc \
  --arg name "$POOL_NAME" \
  --arg audio_asset "$AUDIO_ASSET_ID" \
  '{name: $name, sourceIds: ["source-local-library"], audioLaneAssetId: $audio_asset, audioLaneVolumePercent: 60}')" >/dev/null

POOL_ID="$(psql_query "SELECT id FROM pools WHERE name = '${POOL_NAME}';")"
if [ -z "$POOL_ID" ]; then
  dump_failure_context
  echo "Runtime parity smoke could not resolve the created pool." >&2
  exit 1
fi

api_post "/api/destinations" "$(jq -nc \
  --arg name "$SECONDARY_DESTINATION_NAME" \
  --arg rtmp_url "/tmp/stream-output/secondary" \
  --arg stream_key "secondary.flv" \
  '{name: $name, provider: "custom-rtmp", role: "primary", priority: 1, rtmpUrl: $rtmp_url, streamKey: $stream_key, notes: "Runtime parity smoke output"}')" >/dev/null

SECONDARY_DESTINATION_ID="$(psql_query "SELECT id FROM stream_destinations WHERE name = '${SECONDARY_DESTINATION_NAME}';")"
if [ -z "$SECONDARY_DESTINATION_ID" ]; then
  dump_failure_context
  echo "Runtime parity smoke could not resolve the created secondary destination." >&2
  exit 1
fi

api_post "/api/schedule/blocks" "$(jq -nc \
  --arg title "$BLOCK_TITLE" \
  --arg source_name "Runtime Fixtures" \
  --arg pool_id "$POOL_ID" \
  --argjson day_of_week "$DAY_OF_WEEK" \
  --argjson start_minute "$START_MINUTE_OF_DAY" \
  '{title: $title, categoryName: "Smoke", sourceName: $source_name, poolId: $pool_id, dayOfWeek: $day_of_week, startMinuteOfDay: $start_minute, durationMinutes: 20 }')" >/dev/null

BLOCK_ID="$(psql_query "SELECT id FROM schedule_blocks WHERE title = '${BLOCK_TITLE}' ORDER BY id DESC LIMIT 1;")"
if [ -z "$BLOCK_ID" ]; then
  dump_failure_context
  echo "Runtime parity smoke could not resolve the created schedule block." >&2
  exit 1
fi

wait_for_runtime_ready "$PROGRAM_A_ASSET_ID" "$PROGRAM_B_ASSET_ID" "$AUDIO_ASSET_ID"
wait_for_output_files

cuepoint_current_hour="$(TZ="$CHANNEL_TIMEZONE" date +%H)"
cuepoint_current_minute="$(TZ="$CHANNEL_TIMEZONE" date +%M)"
cuepoint_current_second="$(TZ="$CHANNEL_TIMEZONE" date +%S)"
elapsed_since_block_start_seconds="$(( ((10#$cuepoint_current_hour * 60 + 10#$cuepoint_current_minute) - START_MINUTE_OF_DAY) * 60 + 10#$cuepoint_current_second ))"
cuepoint_offset_seconds="$((elapsed_since_block_start_seconds + 15))"

api_put "/api/schedule/blocks" "$(jq -nc \
  --arg id "$BLOCK_ID" \
  --arg title "$BLOCK_TITLE" \
  --arg source_name "Runtime Fixtures" \
  --arg pool_id "$POOL_ID" \
  --arg cue_asset "$CUE_ASSET_ID" \
  --argjson cuepoint_offset_seconds "$cuepoint_offset_seconds" \
  --argjson day_of_week "$DAY_OF_WEEK" \
  --argjson start_minute "$START_MINUTE_OF_DAY" \
  '{id: $id, title: $title, categoryName: "Smoke", sourceName: $source_name, poolId: $pool_id, dayOfWeek: $day_of_week, startMinuteOfDay: $start_minute, durationMinutes: 20, cuepointAssetId: $cue_asset, cuepointOffsetsSeconds: [$cuepoint_offset_seconds] }')" >/dev/null

wait_for_cuepoint_insert "$CUE_ASSET_ID"

api_post "/api/broadcast/actions" '{"type":"bridge_start","inputType":"hls","inputUrl":"http://fixtures:8000/bridge.m3u8","label":"Runtime Bridge"}' >/dev/null
wait_for_live_bridge_active

api_post "/api/broadcast/actions" '{"type":"bridge_release"}' >/dev/null
wait_for_live_bridge_release "$AUDIO_ASSET_ID"
wait_for_output_files

echo "Runtime parity smoke passed."
