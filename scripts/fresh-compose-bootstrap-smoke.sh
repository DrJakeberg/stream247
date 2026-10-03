#!/usr/bin/env bash
set -euo pipefail

# Two passes over a fresh stack, one after the other.
#
#   env pass    every value pinned in an env file — the stack an operator gets from a filled-in
#               .env. This is the pass this script has always made.
#   guide pass  the stack docs/getting-started.md section 4 promises: no .env at all, the app
#               secret generated on first boot, the bundled PostgreSQL on the compose defaults.
#
# The guide pass exists because that promise was written down in M52, checked by hand once, and
# then repeated in the README, the wizard and the guide with nothing keeping it true. This smoke
# always wrote a full env file, so a change that broke the no-.env start — a variable that became
# required, a secret written somewhere that is not the mounted volume — would have passed every
# gate and failed for the first person who followed the page. M64 closes that: the page says
# "/ redirects to /setup" and "the secret is at data/media/.stream247-app-secret, owner-only", and
# both sentences are now assertions.
#
# Neither pass takes anything from where it is started: not the checkout's .env or ./data (each
# pass has a stand-in checkout below), and not the caller's shell (see CLEARED_FROM_CALLER).

PROJECT_NAME="stream247-fresh-$RANDOM"
GUIDE_PROJECT_NAME="${PROJECT_NAME}-guide"
PORT="${STREAM247_FRESH_COMPOSE_PORT:-3002}"
BASE_URL="http://127.0.0.1:${PORT}"
WORKDIR="$(pwd)"
TMP_DIR="$(mktemp -d)"
# Each pass gets a stand-in for a fresh checkout and uses it as its compose project directory, so
# the compose file's "./data/media", "./data/postgres" and its optional ".env" all resolve in there
# and never in the checkout this script runs from. A developer's own .env and ./data are not read,
# not written and not in the way.
#
# The env pass did not always work like this. The compose file hands ".env" to the containers by
# that relative name, so the pass used to copy its env file over the checkout's .env and move a
# backup back afterwards. cp follows a symlink and mv replaces one: with .env kept as a link to a
# file outside the tree, a single run wrote the smoke's env file through the link into its target
# and left a regular file where the link had been. Measured in the M64 review on a stand-in
# checkout, no incident. A file that is never touched needs no restore that can get it wrong.
ENV_DIR="$TMP_DIR/env"
ENV_FILE="$ENV_DIR/.env"
ENV_SECRET_FILE="$ENV_DIR/data/media/.stream247-app-secret"
GUIDE_DIR="$TMP_DIR/guide"
GUIDE_SECRET_FILE="$GUIDE_DIR/data/media/.stream247-app-secret"
PORT_OVERRIDE_FILE="$TMP_DIR/docker-compose.port.yml"
WEB_IMAGE="${STREAM247_FRESH_COMPOSE_WEB_IMAGE:-stream247-web:test}"
WORKER_IMAGE="${STREAM247_FRESH_COMPOSE_WORKER_IMAGE:-stream247-worker:test}"
PLAYOUT_IMAGE="${STREAM247_FRESH_COMPOSE_PLAYOUT_IMAGE:-$WORKER_IMAGE}"

PASS_LABEL="env"
ACTIVE_COMPOSE="compose_env"

# What both passes are cleared of before Compose runs: every variable the compose file
# interpolates, and Compose's own COMPOSE_* switches. Compose takes a value from the process
# environment before it looks at an env file or a default in the compose file, so whatever the
# caller happens to have exported would otherwise decide what a pass tests. Measured in the M64
# review: TRAEFIK_HOST from the shell landed in the rendered config, COMPOSE_PROFILES=proxy put
# traefik (host ports 80 and 443) into the guide pass, and POSTGRES_PASSWORD=wrongpw turned the
# guide pass red after 80 s at the runtime services although the guide was true — while a caller
# exporting the matching values would have hidden a broken compose default. CI and the release
# workflow export none of them; this is for the developer shell.
#
# The names are read from the compose file rather than listed here, so a variable added there is
# cleared without anyone remembering this script.
CLEARED_FROM_CALLER=()
while IFS= read -r name; do
  CLEARED_FROM_CALLER+=(-u "$name")
done < <(grep -o '\${[A-Za-z_][A-Za-z0-9_]*' "$WORKDIR/docker-compose.yml" | cut -c3- | sort -u)
# A grep that silently finds nothing would leave both passes open again without a word.
if [ "${#CLEARED_FROM_CALLER[@]}" -eq 0 ]; then
  echo "fresh-compose smoke found no variables in $WORKDIR/docker-compose.yml; run it from the repository root." >&2
  rmdir "$TMP_DIR" 2>/dev/null || true
  exit 1
fi
while IFS= read -r name; do
  CLEARED_FROM_CALLER+=(-u "$name")
done < <(compgen -e COMPOSE_ || true)

# The env pass names its env file although it already is the project directory's .env. If Compose
# ever stopped reading that file for interpolation, the image tags would fall back to the compose
# file's released ones and the pass would go green on images nobody handed it.
compose_env() {
  env "${CLEARED_FROM_CALLER[@]}" \
    docker compose --project-name "$PROJECT_NAME" --project-directory "$ENV_DIR" --env-file "$ENV_FILE" \
    -f "$WORKDIR/docker-compose.yml" -f "$PORT_OVERRIDE_FILE" "$@"
}

# The image tags are the only values handed to the guide pass, and they are set here after the
# clearing rather than read from a file: the candidate images under test are the harness's
# business, everything else has to come from the compose file's own defaults or the pass proves
# nothing.
compose_guide() {
  env "${CLEARED_FROM_CALLER[@]}" \
    STREAM247_WEB_IMAGE="$WEB_IMAGE" STREAM247_WORKER_IMAGE="$WORKER_IMAGE" STREAM247_PLAYOUT_IMAGE="$PLAYOUT_IMAGE" \
    docker compose --project-name "$GUIDE_PROJECT_NAME" --project-directory "$GUIDE_DIR" \
    -f "$WORKDIR/docker-compose.yml" -f "$PORT_OVERRIDE_FILE" "$@"
}

cleanup() {
  compose_env down -v >/dev/null 2>&1 || true
  compose_guide down -v >/dev/null 2>&1 || true
  # The containers write into the bind mounts as their own users: PostgreSQL chowns its data
  # directory to the postgres uid, and on a rootful daemon everything under data/ is root's. The
  # chmod and rm below run as the invoking user and cannot touch any of that, and they fail
  # quietly — every run of this script left its postgres directory behind in /tmp, one per run,
  # until the next reboot. So the files are removed from inside a container first, with the image
  # the stack has just used; --pull never keeps a cleanup from reaching for the network when the
  # run died before the stack was ever pulled.
  docker run --rm --pull never --network none -v "$TMP_DIR:/smoke" postgres:16-alpine \
    find /smoke -mindepth 1 -delete >/dev/null 2>&1 || true
  chmod -R 0777 "$TMP_DIR" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR" >/dev/null 2>&1 || true
}

trap cleanup EXIT

# Said up front: without curl every HTTP assertion below would spend its whole window and then
# report "no answer", which reads like a dead stack.
if ! command -v curl >/dev/null 2>&1; then
  echo "fresh-compose smoke needs curl for its redirect and status assertions." >&2
  exit 1
fi

ok() {
  echo "ok   [${PASS_LABEL} pass] $*"
}

fail() {
  echo "FAIL [${PASS_LABEL} pass] $*" >&2
  "$ACTIVE_COMPOSE" ps >&2 || true
  "$ACTIVE_COMPOSE" logs --tail=40 web >&2 || true
  exit 1
}

wait_for_web() {
  for _ in $(seq 1 40); do
    if wget -qO- "${BASE_URL}/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
}

# Asked repeatedly, not once. The wait above ends as soon as web answers its health check, and the
# runtime containers restart on their own while a fresh install has nothing to play — so a single
# reading can land in a restart window and report a healthy service as missing. That is what turned
# this smoke red on CI while it passed on every developer machine. The assertion itself is
# unchanged: all four must be running, this only stops demanding it in one particular instant.
require_runtime_services() {
  local running=""
  for _ in $(seq 1 30); do
    running="$("$ACTIVE_COMPOSE" ps --services --status running 2>/dev/null || true)"

    if printf '%s\n' "$running" | grep -q '^worker$' &&
      printf '%s\n' "$running" | grep -q '^relay$' &&
      printf '%s\n' "$running" | grep -q '^playout$' &&
      printf '%s\n' "$running" | grep -q '^uplink$'; then
      return 0
    fi

    sleep 2
  done

  echo "Runtime services never all reported running. Last reading:" >&2
  printf '%s\n' "$running" >&2
  return 1
}

# curl here, not the wget used for the health wait: wget cannot report a redirect without
# following it, and the redirect is the assertion. Asked until it holds or the window closes, for
# the same reason as the runtime services — /api/health answers 200 as soon as the web process
# serves, database reachable or not, so the first page that needs a database round trip can still
# be ahead of it. The expectation is a shell pattern over "<status> <redirect target>".
LAST_HTTP_ANSWER=""
expect_http() {
  local url="$1" expected="$2"
  for _ in $(seq 1 15); do
    LAST_HTTP_ANSWER="$(curl -s -o /dev/null --max-time 10 -w '%{http_code} %{redirect_url}' "$url" 2>/dev/null || true)"
    LAST_HTTP_ANSWER="${LAST_HTTP_ANSWER% }"
    # shellcheck disable=SC2254
    case "$LAST_HTTP_ANSWER" in
      $expected) return 0 ;;
    esac
    sleep 2
  done
  return 1
}

# Getting Started, sections 3 and 4: a fresh install has one door. "/" sends the browser to the
# wizard, and the wizard answers without a session because no owner exists yet to hold one.
assert_setup_is_the_front_door() {
  expect_http "${BASE_URL}/" "30[1-8] ${BASE_URL}/setup" ||
    fail "\"/\" does not redirect to /setup on a fresh install (got: ${LAST_HTTP_ANSWER:-no answer})"
  ok "\"/\" redirects to /setup (${LAST_HTTP_ANSWER%% *})"

  expect_http "${BASE_URL}/setup" "200" ||
    fail "/setup does not answer 200 on a fresh install (got: ${LAST_HTTP_ANSWER:-no answer})"
  ok "/setup answers 200 without a session"
}

# The env pass gets its data directories made here, by the invoking user, as this script has always
# done for it. The guide pass gets none: there Docker creates them on first start, which is what
# happens on the checkout of someone following the guide.
mkdir -p "$ENV_DIR/data/media" "$ENV_DIR/data/postgres" "$ENV_DIR/docker" "$GUIDE_DIR/docker"
# The one file of the checkout the compose file mounts by relative path. Without it Docker creates
# a directory of that name and the relay dies on its config.
cp "$WORKDIR/docker/mediamtx.yml" "$ENV_DIR/docker/mediamtx.yml"
cp "$WORKDIR/docker/mediamtx.yml" "$GUIDE_DIR/docker/mediamtx.yml"

cat >"$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
APP_URL=http://127.0.0.1:${PORT}
APP_SECRET=stream247-compose-smoke-0123456789abcdef
POSTGRES_DB=stream247
POSTGRES_USER=stream247
POSTGRES_PASSWORD=stream247
DATABASE_URL=postgresql://stream247:stream247@postgres:5432/stream247
STREAM247_WEB_IMAGE=${WEB_IMAGE}
STREAM247_WORKER_IMAGE=${WORKER_IMAGE}
STREAM247_PLAYOUT_IMAGE=${PLAYOUT_IMAGE}
TRAEFIK_HOST=stream247.local
TRAEFIK_ACME_EMAIL=devnull@example.com
CHANNEL_TIMEZONE=Europe/Berlin
MEDIA_LIBRARY_ROOT=/app/data/media
STREAM247_RELAY_ENABLED=1
STREAM247_RELAY_OUTPUT_URL=rtmp://relay:1935/live/program
STREAM247_RELAY_INPUT_URL=rtmp://relay:1935/live/program
EOF

# Both passes override the port and nothing else. The volumes are the compose file's own relative
# paths, isolated by the project directory instead of being rewritten here — the path the guide
# names for the secret is one of them.
#
# The env pass used to rewrite every volume in this file, one service at a time, and uplink was
# missing from the list: it kept the base file's "./data/media", so every run made Docker create
# data/media inside the checkout (root's, on a rootful daemon) and the uplink of that stack did not
# share the feed directory with its playout, which no real stack does. A list that does not exist
# cannot be one service short.
cat >"$PORT_OVERRIDE_FILE" <<EOF
services:
  web:
    # !override replaces the base compose port list instead of appending to it. Without it the
    # stack also tries to publish the base file's "3000:3000", so every smoke run fails with
    # "port is already allocated" whenever anything else holds host port 3000.
    ports: !override
      - "127.0.0.1:${PORT}:3000"
EOF

# ---------------------------------------------------------------------------------------------
# env pass
# ---------------------------------------------------------------------------------------------

compose_env up -d

wait_for_web

require_runtime_services || fail "worker, relay, playout and uplink are not all running"
ok "worker, relay, playout and uplink are running"

wget -qO- "${BASE_URL}/api/system/readiness" >/dev/null
ok "/api/system/readiness answers"

assert_setup_is_the_front_door

# The other half of the guide's APP_SECRET row: a value in the env is used as it is, and nothing
# is generated next to it. A file appearing here would mean two secrets exist for one install.
if [ -e "$ENV_SECRET_FILE" ]; then
  fail "a secret file was generated although APP_SECRET is set in the env"
fi
ok "APP_SECRET from the env is used, no secret file was generated"

# Down before the guide pass comes up, not left to the exit trap: the relay publishes its ingest
# ports (1935, 8890/udp) on the host under their real numbers, so two stacks cannot stand next to
# each other.
compose_env down -v >/dev/null 2>&1 || fail "the env pass stack did not shut down"

# ---------------------------------------------------------------------------------------------
# guide pass
# ---------------------------------------------------------------------------------------------

PASS_LABEL="guide"
ACTIVE_COMPOSE="compose_guide"

if [ -e "$GUIDE_DIR/.env" ]; then
  fail "the stand-in checkout has a .env; the guide pass would prove nothing"
fi

# Compose warns here that TRAEFIK_HOST and TRAEFIK_ACME_EMAIL are not set. That is what an operator
# without a .env sees as well, the guide says so, and it is left on the screen for that reason.
compose_guide up -d

wait_for_web

expect_http "${BASE_URL}/api/health" "200" ||
  fail "web never answered /api/health without a .env (got: ${LAST_HTTP_ANSWER:-no answer})"
ok "the stack boots without a .env: /api/health answers 200"

require_runtime_services || fail "worker, relay, playout and uplink are not all running without a .env"
ok "worker, relay, playout and uplink are running"

assert_setup_is_the_front_door

# Asked after /setup has answered: that page resolves the app secret itself, so from here on the
# file has been written by whichever service got there first, and waiting for it is not needed.
#
# Nobody reads the file here. On a rootful daemon it is root's and this script is not, and its
# content is the one thing a CI log must never show. That it exists where the guide says, is closed
# to everyone but its owner, and is long enough to be a secret can all be told from the outside.
if [ ! -e "$GUIDE_SECRET_FILE" ]; then
  fail "no generated secret at data/media/.stream247-app-secret"
fi
ok "the app secret was generated at data/media/.stream247-app-secret"

SECRET_MODE="$(stat -c '%a' "$GUIDE_SECRET_FILE" 2>/dev/null || stat -f '%Lp' "$GUIDE_SECRET_FILE")"
if [ "$SECRET_MODE" != "600" ]; then
  fail "the generated secret file has mode ${SECRET_MODE}, the guide says owner-only (600)"
fi
ok "the secret file is owner-only (mode ${SECRET_MODE})"

# 32 characters is the minimum the app accepts as a secret; plus the trailing newline.
SECRET_BYTES="$(stat -c '%s' "$GUIDE_SECRET_FILE" 2>/dev/null || stat -f '%z' "$GUIDE_SECRET_FILE")"
if [ "$SECRET_BYTES" -lt 33 ]; then
  fail "the generated secret file holds ${SECRET_BYTES} bytes, too short to be a secret"
fi
ok "the secret file holds a full-length secret (${SECRET_BYTES} bytes)"

# Getting Started, section 8, on the one state this smoke can reach — up, nothing configured.
# /api/system/readiness answers 200 and says no in its body; /api/ready is the one that fails
# closed, and stays 503 until an owner exists.
READINESS_BODY="$(curl -fsS --max-time 10 "${BASE_URL}/api/system/readiness" 2>/dev/null || true)"
case "$READINESS_BODY" in
  *'"broadcastReady":false'*) ;;
  *) fail "/api/system/readiness did not answer 200 with broadcastReady false (got: ${READINESS_BODY:0:200})" ;;
esac
ok "/api/system/readiness answers 200 and reports broadcastReady false"

expect_http "${BASE_URL}/api/ready" "503" ||
  fail "/api/ready does not answer 503 before an owner exists (got: ${LAST_HTTP_ANSWER:-no answer})"
ok "/api/ready answers 503 until the workspace is initialised"

echo "fresh-compose smoke passed: env pass and guide pass"
