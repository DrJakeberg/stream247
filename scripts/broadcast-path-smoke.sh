#!/usr/bin/env bash
# The production path, end to end, with the relay on (M98, audit U15).
#
# Every other smoke runs the playout without the relay, so the path the DUT actually airs through --
# playout -> rolling HLS program feed -> uplink -> RTMP ingest -- had no check before a release
# candidate reached the DUT. This script starts the compose stack the way .env.production.example
# configures it (STREAM247_RELAY_ENABLED=1, STREAM247_UPLINK_INPUT_MODE=hls), points the primary output
# at a local RTMP sink, and checks:
#
#   1. Over 60 s, program.m3u8's MEDIA-SEQUENCE grows and the bytes the sink received from the uplink
#      grow.
#   2. Mutation run: with the uplink stopped, the same measurement fails. A check that cannot fail
#      proves nothing; this one is shown to fail on exactly the fault it exists for.
#   3. A broken source (M75): three items of one source on a stub that answers 404, refuses the
#      connection or hangs open `playout.source-breaker.opened`; once the stub is healthy and the
#      cooldown has run out, a clean probe closes it (`playout.source-breaker.closed`).
#   4. A network outage (M82): the playout loses its way out for 90 s (`docker network disconnect`).
#      Expected: `playout.probe.network_outage` lines, no breaker, no quarantine; once reconnected the
#      remote items probe cleanly and one goes on air.
#
# "The way out" is a second, internal compose network (`outside`) on a documentation range,
# 198.51.100.0/24 (RFC 5737). The sink and the stub live only there; the playout and the uplink join it
# next to the default network. Two reasons it is a public-looking range and not a container name: the
# outage check (apps/worker/src/probe-network-outage.ts) skips private and single-label hosts as "no
# public publish host to ask", and disconnecting only this network keeps PostgreSQL reachable, so the
# playout's cycles keep running through the outage the way they do on the DUT when its uplink to the
# internet drops.
#
# Why the remote items are YouTube-shaped URLs on the stub: a direct-media URL is never probed (it is
# passed to ffmpeg as is, resolvePlayableMedia in apps/worker/src/index.ts), so it can neither fail a
# probe nor feed the breaker. Only URLs the playout resolves through yt-dlp are probed; the stub serves
# `/youtube.com/watch?v=...`, which yt-dlp's generic extractor resolves to the stub's own mp4. The
# items belong to a direct-media source whose own URL does not validate, so the worker's sync keeps the
# stored rows ("asset preserved") instead of replacing them with a single item.
#
# The breaker's cooldown is 30 minutes (SOURCE_BREAKER_BASE_COOLDOWN_SECONDS). The script moves the
# stored opening time back instead of waiting: the half-open trial is decided by the playout from that
# stored time alone (sourceBreakerPhase), so this is the state the playout reaches after a real wait.
set -euo pipefail

PROJECT_NAME="stream247-broadcast-$RANDOM"
PORT="${STREAM247_BROADCAST_SMOKE_PORT:-3006}"
WORKDIR="$(pwd)"
TMP_DIR="$(mktemp -d)"
ENV_FILE="$TMP_DIR/.env"
OVERRIDE_FILE="$TMP_DIR/docker-compose.override.yml"
ROOT_ENV_FILE="$WORKDIR/.env"
ROOT_ENV_BACKUP="$TMP_DIR/root.env.backup"
COOKIE_JAR="$TMP_DIR/cookies.txt"
CHANNEL_TIMEZONE="${STREAM247_BROADCAST_SMOKE_TIMEZONE:-Europe/Berlin}"
OWNER_EMAIL="owner@example.com"
OWNER_PASSWORD="stream247-broadcast-pass"
FIXTURE_DIR="$TMP_DIR/fixtures"
MEDIA_DIR="$TMP_DIR/media"
POSTGRES_DIR="$TMP_DIR/postgres"
SINK_DIR="$TMP_DIR/sink"
FEED_PLAYLIST="$MEDIA_DIR/.stream247-program-feed/program.m3u8"
BASE_URL="http://127.0.0.1:${PORT}"
SINK_IP="198.51.100.10"
STUB_IP="198.51.100.20"
OUTSIDE_SUBNET="198.51.100.0/24"
# Seconds each measurement runs; the acceptance names 60.
MEASURE_SECONDS="${STREAM247_BROADCAST_SMOKE_MEASURE_SECONDS:-60}"
# How long the playout is cut off; the acceptance names 90.
OUTAGE_SECONDS="${STREAM247_BROADCAST_SMOKE_OUTAGE_SECONDS:-90}"
# Phases to run, for local iteration: all, path (1 and 2 only) or sources (3 and 4 only).
PHASES="${STREAM247_BROADCAST_SMOKE_PHASES:-all}"

cleanup() {
  compose down -v >/dev/null 2>&1 || true
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

# Keeps the response body and names the request on failure (the same helper as runtime-parity-smoke.sh).
api_call() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"
  local response status body
  if [ "$method" = "GET" ]; then
    response="$(curl -sS -b "$COOKIE_JAR" -w $'\n%{http_code}' "${BASE_URL}${path}")" || return 1
  else
    response="$(curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H "Content-Type: application/json" \
      -X "$method" -d "$payload" -w $'\n%{http_code}' "${BASE_URL}${path}")" || return 1
  fi
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  if [ "${status:-0}" -ge 400 ]; then
    echo "API ${method} ${path} answered ${status}: ${body}" >&2
    return 1
  fi
  printf '%s' "$body"
}

api_post() {
  api_call POST "$1" "$2"
}

log() {
  echo "[broadcast-smoke $(date -u +%H:%M:%S)] $*"
}

dump_failure_context() {
  echo
  echo "Broadcast path smoke failed. Runtime context:"
  compose ps -a || true
  echo
  psql_query "SELECT status, current_asset_id, current_title, selection_reason_code, uplink_status, uplink_last_exit_reason FROM playout_runtime LIMIT 1;" || true
  echo
  psql_query "SELECT source_id, state, failed_asset_ids, opened_at, cooldown_seconds, last_error FROM source_breakers;" || true
  echo
  psql_query "SELECT id, source_id, status, playback_probe_failures, playback_probe_error FROM assets WHERE path LIKE 'http%' ORDER BY id;" || true
  echo
  head -n 8 "$FEED_PLAYLIST" 2>/dev/null || echo "no program feed playlist at $FEED_PLAYLIST"
  echo
  compose logs --tail 120 playout || true
  echo
  compose logs --tail 60 uplink || true
  echo
  compose logs --tail 30 worker || true
  echo
  compose logs --tail 30 sink || true
  echo
  compose logs --tail 30 stub || true
}

fail() {
  dump_failure_context
  echo "Broadcast path smoke failed: $*" >&2
  exit 1
}

# +faststart: the stub answers no Range requests, so an mp4 with its index at the end is read over HTTP
# as garbage (measured: AAC decode errors on every packet and a feed that all but stopped).
generate_video_fixture() {
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=$2:s=1280x720:r=30" \
    -f lavfi -i "sine=frequency=$3:sample_rate=44100" \
    -t "$4" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "$1"
}

# MEDIA-SEQUENCE of the program feed, read where the playout writes it (the media volume is a bind mount
# here). Empty when there is no playlist yet.
feed_media_sequence() {
  sed -n 's/^#EXT-X-MEDIA-SEQUENCE:\([0-9][0-9]*\).*/\1/p' "$FEED_PLAYLIST" 2>/dev/null | head -n 1
}

# Bytes the sink has written, over every connection the uplink made. Empty while it has written none.
sink_bytes_received() {
  find "$SINK_DIR" -type f -name '*.flv' -printf '%s\n' 2>/dev/null | awk '{ total += $1 } END { if (total > 0) print total }'
}

# One measurement over MEASURE_SECONDS: both counters must grow. Prints what it saw; returns 1 when
# either did not grow, without dumping context (the mutation run expects that).
measure_path() {
  local seq_before seq_after bytes_before bytes_after verdict=0
  seq_before="$(feed_media_sequence)"
  bytes_before="$(sink_bytes_received)"
  sleep "$MEASURE_SECONDS"
  seq_after="$(feed_media_sequence)"
  bytes_after="$(sink_bytes_received)"
  log "MEDIA-SEQUENCE ${seq_before:-none} -> ${seq_after:-none} over ${MEASURE_SECONDS}s; sink bytes ${bytes_before:-none} -> ${bytes_after:-none}"
  if [ -z "$seq_before" ] || [ -z "$seq_after" ] || [ "$seq_after" -le "$seq_before" ]; then
    log "program.m3u8 MEDIA-SEQUENCE did not grow."
    verdict=1
  fi
  if [ -z "$bytes_before" ] || [ -z "$bytes_after" ] || [ "$bytes_after" -le "$bytes_before" ]; then
    log "the uplink output (bytes the sink received) did not grow."
    verdict=1
  fi
  return "$verdict"
}

# Waits until the bytes the sink receives are rising, i.e. the uplink is on air.
wait_for_uplink_publishing() {
  local previous="" current
  for _ in $(seq 1 60); do
    current="$(sink_bytes_received)"
    if [ -n "$current" ] && [ -n "$previous" ] && [ "$current" -gt "$previous" ] && [ "$previous" -gt 0 ]; then
      return 0
    fi
    previous="$current"
    sleep 5
  done
  fail "the uplink never started publishing to the sink."
}

wait_for_feed() {
  for _ in $(seq 1 60); do
    if [ -n "$(feed_media_sequence)" ]; then
      return 0
    fi
    sleep 5
  done
  fail "the playout never wrote $FEED_PLAYLIST."
}

wait_for_http() {
  for _ in $(seq 1 60); do
    if curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  fail "the web app never answered /api/health."
}

wait_for_local_library_assets() {
  for _ in $(seq 1 60); do
    ready="$(psql_query "SELECT count(*) FROM assets WHERE source_id = 'source-local-library' AND status = 'ready';" 2>/dev/null || true)"
    if [ "${ready:-0}" -ge 2 ]; then
      return 0
    fi
    sleep 2
  done
  fail "the local library never reported both program fixtures ready."
}

# Lines of one playout runtime event since a moment (docker's --since), optionally about one source.
playout_events_since() {
  local since="$1" event="$2" source_id="${3:-}"
  compose logs --no-color --no-log-prefix --since "$since" playout 2>/dev/null \
    | grep -F "\"event\":\"${event}\"" \
    | { if [ -n "$source_id" ]; then grep -F "\"sourceId\":\"${source_id}\""; else cat; fi; } || true
}

wait_for_playout_event() {
  local since="$1" event="$2" source_id="$3" attempts="$4"
  for _ in $(seq 1 "$attempts"); do
    if [ -n "$(playout_events_since "$since" "$event" "$source_id")" ]; then
      return 0
    fi
    sleep 5
  done
  fail "no ${event} for ${source_id} within $((attempts * 5))s."
}

# A direct-media source whose own URL does not validate (no media extension): the sync marks it invalid
# and preserves whatever items are stored for it, so the items this script inserts stay put.
create_stub_source() {
  local name="$1"
  api_post "/api/sources" "$(jq -nc --arg name "$name" --arg url "http://${STUB_IP}:8000/${name// /-}" \
    '{name: $name, connectorKind: "direct-media", externalUrl: $url}')" >/dev/null
  psql_query "SELECT id FROM sources WHERE name = '${name}' LIMIT 1;"
}

insert_stub_asset() {
  local id="$1" source_id="$2" url="$3"
  psql_query "INSERT INTO assets (id, source_id, title, path, status, include_in_programming, external_id, created_at, updated_at)
    VALUES ('${id}', '${source_id}', '${id}', '${url}', 'ready', true, '${id}', to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'), to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'));" >/dev/null
}

create_pool() {
  local name="$1" source_id="$2"
  api_post "/api/pools" "$(jq -nc --arg name "$name" --arg source "$source_id" '{name: $name, sourceIds: [$source]}')" >/dev/null
  psql_query "SELECT id FROM pools WHERE name = '${name}' LIMIT 1;"
}

# Every block of this run carries the same pool, so switching what airs is one UPDATE.
air_pool() {
  psql_query "UPDATE schedule_blocks SET pool_id = '$1';" >/dev/null
}

# A Pin of a local item for phases 3 and 4. The playout probes a pool's next items only while one of the
# pool's own items or an operator item is on air (poolQueueScanned in apps/worker/src/index.ts); while a
# fallback covers a failed pick it probes nothing, so a pool of nothing but broken items would only ever
# report its first item. Pinned, the queue walks the scheduled pool from its stored position and probes
# its items one per cycle, which is how a broken source is met on air: ahead of time, behind a healthy item.
pin_local_item() {
  local asset_id
  asset_id="$(psql_query "SELECT id FROM assets WHERE source_id = 'source-local-library' AND path LIKE '%/broadcast-program-a.mp4' LIMIT 1;")"
  [ -n "$asset_id" ] || fail "could not resolve the local item to pin."
  api_post "/api/broadcast/actions" "$(jq -nc --arg asset "$asset_id" '{type: "override", assetId: $asset, minutes: 60}')" >/dev/null
  for _ in $(seq 1 24); do
    if [ "$(psql_query "SELECT current_asset_id || '|' || selection_reason_code FROM playout_runtime LIMIT 1;" 2>/dev/null || true)" = "${asset_id}|operator_override" ]; then
      return 0
    fi
    sleep 5
  done
  fail "the pinned local item never went on air."
}

require_command curl
require_command docker
require_command jq
# shellcheck source=lib/ffmpeg-fallback.sh
. "$(dirname "$0")/lib/ffmpeg-fallback.sh"

mkdir -p "$FIXTURE_DIR" "$MEDIA_DIR" "$POSTGRES_DIR" "$SINK_DIR"
enable_ffmpeg_fallback "$TMP_DIR"
touch "$COOKIE_JAR"

generate_video_fixture "$MEDIA_DIR/broadcast-program-a.mp4" "0x124f7a" "330" "20"
generate_video_fixture "$MEDIA_DIR/broadcast-program-b.mp4" "0x7a3d12" "550" "20"
generate_video_fixture "$FIXTURE_DIR/clip.mp4" "0x2a6b3c" "440" "20"

# The stub source. By the `v` parameter: `404-*` answers 404, `hang-*` never answers, anything else
# serves clip.mp4 as video/mp4. Port 8001 refuses connections until the healed flag exists. Once
# /fixtures/healed exists every request is served and 8001 listens too.
cat >"$FIXTURE_DIR/stub.py" <<'EOF'
import http.server, os, threading, time, urllib.parse

HEALED = "/fixtures/healed"
CLIP = "/fixtures/clip.mp4"

class Handler(http.server.BaseHTTPRequestHandler):
    def answer(self, with_body):
        video = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("v", [""])[0]
        if not os.path.exists(HEALED):
            if video.startswith("404-"):
                self.send_response(404)
                self.end_headers()
                return
            if video.startswith("hang-"):
                time.sleep(3600)
                return
        with open(CLIP, "rb") as handle:
            data = handle.read()
        self.send_response(200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if with_body:
            self.wfile.write(data)

    def do_GET(self):
        self.answer(True)

    def do_HEAD(self):
        self.answer(False)

    def log_message(self, fmt, *args):
        print("stub %s %s" % (self.address_string(), fmt % args), flush=True)

def serve(port):
    http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()

def serve_refused_port_once_healed():
    while not os.path.exists(HEALED):
        time.sleep(1)
    serve(8001)

threading.Thread(target=serve_refused_port_once_healed, daemon=True).start()
serve(8000)
EOF

cat >"$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
APP_URL=${BASE_URL}
APP_SECRET=stream247-broadcast-smoke-0123456789abcdef
POSTGRES_DB=stream247
POSTGRES_USER=stream247
POSTGRES_PASSWORD=stream247
DATABASE_URL=postgresql://stream247:stream247@postgres:5432/stream247
STREAM247_WEB_IMAGE=${STREAM247_WEB_IMAGE:-stream247-web:test}
STREAM247_WORKER_IMAGE=${STREAM247_WORKER_IMAGE:-stream247-worker:test}
STREAM247_PLAYOUT_IMAGE=${STREAM247_PLAYOUT_IMAGE:-stream247-worker:test}
STREAM_OUTPUT_URL=rtmp://${SINK_IP}:1935/live
STREAM_OUTPUT_KEY=broadcast-smoke
TRAEFIK_HOST=stream247.local
TRAEFIK_ACME_EMAIL=devnull@example.com
CHANNEL_TIMEZONE=${CHANNEL_TIMEZONE}
MEDIA_LIBRARY_ROOT=/app/data/media
STREAM247_RELAY_ENABLED=1
STREAM247_RELAY_OUTPUT_URL=rtmp://relay:1935/live/program
STREAM247_RELAY_INPUT_URL=rtmp://relay:1935/live/program
STREAM247_UPLINK_INPUT_MODE=hls
STREAM247_PROGRAM_FEED_DIR=/app/data/media/.stream247-program-feed
STREAM247_PROGRAM_FEED_TARGET_SECONDS=2
STREAM247_PROGRAM_FEED_LIST_SIZE=30
STREAM247_PROGRAM_FEED_FAILOVER_SECONDS=10
STREAM_OUTPUT_WIDTH=1280
STREAM_OUTPUT_HEIGHT=720
STREAM_OUTPUT_FPS=30
EOF

cat >"$OVERRIDE_FILE" <<EOF
networks:
  outside:
    internal: true
    ipam:
      config:
        - subnet: ${OUTSIDE_SUBNET}
services:
  web:
    ports: !override
      - "127.0.0.1:${PORT}:3000"
    volumes:
      - ${MEDIA_DIR}:/app/data/media
  worker:
    volumes:
      - ${MEDIA_DIR}:/app/data/media
  relay:
    # The ingest doors are not part of this test; publishing them would collide with anything else on
    # the runner that holds 1935.
    ports: !reset []
  playout:
    volumes:
      - ${MEDIA_DIR}:/app/data/media
    networks:
      default: {}
      outside: {}
  uplink:
    volumes:
      - ${MEDIA_DIR}:/app/data/media
    networks:
      default: {}
      outside: {}
  postgres:
    volumes:
      - ${POSTGRES_DIR}:/var/lib/postgresql/data
  sink:
    image: \${STREAM247_WORKER_IMAGE}
    entrypoint: ["sh", "-c"]
    command:
      - 'while true; do ffmpeg -hide_banner -loglevel warning -listen 1 -i rtmp://0.0.0.0:1935/live/broadcast-smoke -c copy -f flv "/sink/received-\$\$(date +%s)-\$\$RANDOM.flv"; sleep 1; done'
    volumes:
      - ${SINK_DIR}:/sink
    networks:
      outside:
        ipv4_address: ${SINK_IP}
  stub:
    image: python:3.12-alpine
    command: ["python", "-u", "/fixtures/stub.py"]
    volumes:
      - ${FIXTURE_DIR}:/fixtures:ro
    networks:
      outside:
        ipv4_address: ${STUB_IP}
EOF

if [ -f "$ROOT_ENV_FILE" ]; then
  cp "$ROOT_ENV_FILE" "$ROOT_ENV_BACKUP"
fi
cp "$ENV_FILE" "$ROOT_ENV_FILE"

compose up -d
wait_for_http

api_post "/api/setup/bootstrap" "$(jq -nc --arg email "$OWNER_EMAIL" --arg password "$OWNER_PASSWORD" '{email: $email, password: $password}')" >/dev/null
wait_for_local_library_assets

LOCAL_POOL_ID="$(create_pool "Broadcast Smoke Local" "source-local-library")"
[ -n "$LOCAL_POOL_ID" ] || fail "could not resolve the local pool."

# One whole-day block per weekday, all on one pool: whatever the runner's clock says, a block is on air,
# and no seeded demo block is in the way.
psql_query "DELETE FROM schedule_blocks;" >/dev/null
for day in 0 1 2 3 4 5 6; do
  api_post "/api/schedule/blocks" "$(jq -nc --arg pool "$LOCAL_POOL_ID" --argjson day "$day" \
    '{title: "Broadcast Smoke", categoryName: "Smoke", sourceName: "Broadcast Smoke", poolId: $pool, dayOfWeek: $day, startMinuteOfDay: 0, durationMinutes: 1440}')" >/dev/null
done

wait_for_feed
wait_for_uplink_publishing

if [ "$PHASES" != "sources" ]; then
# --- 1. The path carries the programme --------------------------------------------------------------
log "Phase 1: program feed and uplink output over ${MEASURE_SECONDS}s."
measure_path || fail "the production path did not carry the programme over ${MEASURE_SECONDS}s."

# --- 2. Mutation run: the same check fails with the uplink stopped ----------------------------------
log "Phase 2 (mutation): uplink stopped, the same measurement must fail."
compose stop uplink >/dev/null
if measure_path; then
  fail "the measurement still passed with the uplink stopped, so it cannot detect a dead uplink."
fi
log "Mutation detected: with the uplink stopped the measurement fails."
compose start uplink >/dev/null
wait_for_uplink_publishing
log "Uplink publishing again."
fi

if [ "$PHASES" = "path" ]; then
  log "Broadcast path smoke passed (path phases only)."
  exit 0
fi

# --- 3. A broken source opens its breaker, a clean probe closes it ----------------------------------
log "Phase 3: broken source on the stub (404, refused, hang)."
BROKEN_SOURCE_ID="$(create_stub_source "Broadcast Smoke Broken")"
[ -n "$BROKEN_SOURCE_ID" ] || fail "could not resolve the broken stub source."
insert_stub_asset "smoke-broken-404" "$BROKEN_SOURCE_ID" "http://${STUB_IP}:8000/youtube.com/watch?v=404-a"
insert_stub_asset "smoke-broken-refused" "$BROKEN_SOURCE_ID" "http://${STUB_IP}:8001/youtube.com/watch?v=refused-b"
insert_stub_asset "smoke-broken-hang" "$BROKEN_SOURCE_ID" "http://${STUB_IP}:8000/youtube.com/watch?v=hang-c"
BROKEN_POOL_ID="$(create_pool "Broadcast Smoke Broken" "$BROKEN_SOURCE_ID")"
[ -n "$BROKEN_POOL_ID" ] || fail "could not resolve the broken pool."

pin_local_item
PHASE3_SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
air_pool "$BROKEN_POOL_ID"
wait_for_playout_event "$PHASE3_SINCE" "playout.source-breaker.opened" "$BROKEN_SOURCE_ID" 72
playout_events_since "$PHASE3_SINCE" "playout.source-breaker.opened" "$BROKEN_SOURCE_ID" | head -n 1
FAILED_ITEMS="$(psql_query "SELECT failed_asset_ids FROM source_breakers WHERE source_id = '${BROKEN_SOURCE_ID}';")"
log "Breaker open; failed items: ${FAILED_ITEMS}"
for item in smoke-broken-404 smoke-broken-refused smoke-broken-hang; do
  printf '%s' "$FAILED_ITEMS" | grep -q "\"${item}\"" || fail "the open breaker does not name ${item}: ${FAILED_ITEMS}"
done

# The stub heals, and the 30-minute cooldown is taken as run out (see the header).
touch "$FIXTURE_DIR/healed"
PHASE3_HEAL_SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
psql_query "UPDATE source_breakers SET opened_at = to_char((now() at time zone 'utc') - interval '31 minutes', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') WHERE source_id = '${BROKEN_SOURCE_ID}';" >/dev/null
wait_for_playout_event "$PHASE3_HEAL_SINCE" "playout.source-breaker.closed" "$BROKEN_SOURCE_ID" 48
playout_events_since "$PHASE3_HEAL_SINCE" "playout.source-breaker.closed" "$BROKEN_SOURCE_ID" | head -n 1
log "Breaker closed by a clean probe."

# --- 4. A network outage is not the source's fault ----------------------------------------------------
log "Phase 4: playout cut off from the outside network for ${OUTAGE_SECONDS}s."
REMOTE_SOURCE_ID="$(create_stub_source "Broadcast Smoke Remote")"
[ -n "$REMOTE_SOURCE_ID" ] || fail "could not resolve the remote stub source."
for item in 1 2 3; do
  insert_stub_asset "smoke-remote-${item}" "$REMOTE_SOURCE_ID" "http://${STUB_IP}:8000/youtube.com/watch?v=ok-${item}"
done
REMOTE_POOL_ID="$(create_pool "Broadcast Smoke Remote" "$REMOTE_SOURCE_ID")"
[ -n "$REMOTE_POOL_ID" ] || fail "could not resolve the remote pool."

PLAYOUT_CONTAINER="$(compose ps -q playout)"
OUTSIDE_NETWORK="${PROJECT_NAME}_outside"
PHASE4_SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker network disconnect "$OUTSIDE_NETWORK" "$PLAYOUT_CONTAINER"
# Switched after the cut, so the remote items have never been probed and every probe meets the outage.
air_pool "$REMOTE_POOL_ID"
sleep "$OUTAGE_SECONDS"
docker network connect "$OUTSIDE_NETWORK" "$PLAYOUT_CONTAINER"
log "Playout reconnected."

OUTAGE_LINES="$(playout_events_since "$PHASE4_SINCE" "playout.probe.network_outage" "$REMOTE_SOURCE_ID")"
[ -n "$OUTAGE_LINES" ] || fail "no playout.probe.network_outage line for the remote source during the outage."
log "$(printf '%s\n' "$OUTAGE_LINES" | grep -c .) playout.probe.network_outage line(s); first:"
printf '%s\n' "$OUTAGE_LINES" | head -n 1

# Clean again: the Pin ends, and a remote item resolves and goes on air.
api_post "/api/broadcast/actions" '{"type":"resume"}' >/dev/null
on_air=""
for _ in $(seq 1 48); do
  current="$(psql_query "SELECT current_asset_id FROM playout_runtime LIMIT 1;" 2>/dev/null || true)"
  case "$current" in
    smoke-remote-*)
      on_air="$current"
      break
      ;;
  esac
  sleep 5
done
[ -n "$on_air" ] || fail "no remote item went on air after the network came back."
log "Remote item ${on_air} on air after the outage."

[ -z "$(playout_events_since "$PHASE4_SINCE" "playout.source-breaker.opened" "$REMOTE_SOURCE_ID")" ] \
  || fail "the outage opened the remote source's breaker."
REMOTE_BREAKER="$(psql_query "SELECT state FROM source_breakers WHERE source_id = '${REMOTE_SOURCE_ID}';")"
[ -z "$REMOTE_BREAKER" ] || [ "$REMOTE_BREAKER" = "closed" ] || fail "the remote source's breaker is ${REMOTE_BREAKER}."
COUNTED_FAILURES="$(psql_query "SELECT COALESCE(sum(playback_probe_failures), 0) FROM assets WHERE source_id = '${REMOTE_SOURCE_ID}';")"
[ "$COUNTED_FAILURES" = "0" ] || fail "the outage was counted against the remote items (${COUNTED_FAILURES} probe failures)."
log "No breaker, no quarantine count for the remote source (breaker: ${REMOTE_BREAKER:-none}, probe failures: ${COUNTED_FAILURES})."

# And the path still carries the programme after all of it.
measure_path || fail "the production path did not carry the programme after the outage."

log "Broadcast path smoke passed."
