#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

TARGET_VERSION="${1:-}"
if [ -z "$TARGET_VERSION" ]; then
  echo "Usage: scripts/upgrade-rehearsal.sh <target-version>"
  echo "Example: scripts/upgrade-rehearsal.sh 1.0.0"
  exit 1
fi

if [ ! -f ".env" ]; then
  echo "Missing .env. Copy .env.example first."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required."
  exit 1
fi

sanitize_url() {
  printf "%s" "$1" | sed 's#/*$##'
}

normalize_release_tag() {
  case "$1" in
  v*)
    printf "%s" "$1"
    ;;
  *)
    printf "v%s" "$1"
    ;;
  esac
}

extract_env_value() {
  key="$1"
  sed -n "s/^${key}=//p" .env | tail -n 1
}

registry_image_exists() {
  image="$1"
  tag="$2"
  docker manifest inspect "ghcr.io/drjakeberg/${image}:${tag}" >/dev/null 2>&1
}

resolve_rehearsal_image_tag() {
  target_release_tag="$1"

  if [ -n "${UPGRADE_REHEARSAL_IMAGE_TAG:-}" ]; then
    printf "%s" "$UPGRADE_REHEARSAL_IMAGE_TAG"
    return 0
  fi

  if registry_image_exists stream247-web "$target_release_tag" &&
    registry_image_exists stream247-worker "$target_release_tag" &&
    registry_image_exists stream247-playout "$target_release_tag"; then
    printf "%s" "$target_release_tag"
    return 0
  fi

  if source_sha="$(git rev-parse --short=7 HEAD 2>/dev/null)"; then
    printf "main-%s" "$source_sha"
    return 0
  fi

  printf "%s" "$target_release_tag"
}

CHECK_BASE_URL="${CHECK_BASE_URL:-}"
APP_URL="$(sanitize_url "${CHECK_BASE_URL:-$(extract_env_value APP_URL)}")"
if [ -z "$APP_URL" ]; then
  APP_URL="http://localhost:3000"
fi

TARGET_RELEASE_TAG="$(normalize_release_tag "$TARGET_VERSION")"
REHEARSAL_IMAGE_TAG="$(resolve_rehearsal_image_tag "$TARGET_RELEASE_TAG")"

tmp_env="$(mktemp)"
trap 'rm -f "$tmp_env"' EXIT
cp .env "$tmp_env"

set_image_tag() {
  key="$1"
  image="$2"
  if grep -q "^${key}=" "$tmp_env"; then
    sed -i "s#^${key}=.*#${key}=ghcr.io/drjakeberg/${image}:${REHEARSAL_IMAGE_TAG}#" "$tmp_env"
  else
    printf "%s=%s\n" "$key" "ghcr.io/drjakeberg/${image}:${REHEARSAL_IMAGE_TAG}" >>"$tmp_env"
  fi
}

set_image_tag STREAM247_WEB_IMAGE stream247-web
set_image_tag STREAM247_WORKER_IMAGE stream247-worker
set_image_tag STREAM247_PLAYOUT_IMAGE stream247-playout

export COMPOSE_ENV_FILES="$tmp_env"

has_local_media_fixture() {
  media_root="${UPGRADE_REHEARSAL_MEDIA_ROOT:-data/media}"
  [ -d "$media_root" ] || return 1
  find "$media_root" -type f \( -name "*.mp4" -o -name "*.mov" -o -name "*.mkv" -o -name "*.webm" \) | head -n 1 | grep -q .
}

ensure_local_media_fixture() {
  if [ "${UPGRADE_REHEARSAL_SEED_LOCAL_MEDIA:-1}" != "1" ] || has_local_media_fixture; then
    return 0
  fi

  if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg is required to seed an empty rehearsal media library." >&2
    echo "Set UPGRADE_REHEARSAL_SEED_LOCAL_MEDIA=0 to disable fixture seeding when real media already exists." >&2
    exit 1
  fi

  media_root="${UPGRADE_REHEARSAL_MEDIA_ROOT:-data/media}"
  fixture_dir="$media_root/rehearsal"
  fixture_path="$fixture_dir/rehearsal-program.mp4"
  mkdir -p "$fixture_dir"
  echo "Seeding empty rehearsal media library with ${fixture_path}..."
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=0x0f172a:s=1280x720:r=30" \
    -f lavfi -i "sine=frequency=440:sample_rate=44100" \
    -t 12 \
    -c:v libx264 -pix_fmt yuv420p \
    -c:a aac -b:a 128k \
    "$fixture_path"
}

read_readiness_field() {
  endpoint="$1"
  expression="$2"
  response="$(curl -fsS "$endpoint" 2>/dev/null || true)"
  if [ -z "$response" ]; then
    return 1
  fi

  printf "%s" "$response" | node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync(0, 'utf8'));
    const value = ${expression};
    if (value === undefined || value === null) process.exit(1);
    process.stdout.write(String(value));
  "
}

ensure_bootstrapped_workspace() {
  endpoint="${APP_URL}/api/system/readiness"
  initialized="$(read_readiness_field "$endpoint" "data.initialized" || true)"
  if [ "$initialized" = "true" ]; then
    return 0
  fi

  owner_email="${UPGRADE_REHEARSAL_OWNER_EMAIL:-rehearsal-owner@example.com}"
  owner_password="${UPGRADE_REHEARSAL_OWNER_PASSWORD:-stream247-rehearsal-pass}"
  echo "Bootstrapping rehearsal workspace owner..."
  OWNER_EMAIL="$owner_email" OWNER_PASSWORD="$owner_password" PAYLOAD_PATH="$tmp_env.bootstrap.json" node -e '
    const fs = require("fs");
    const payload = {
      email: process.env.OWNER_EMAIL,
      password: process.env.OWNER_PASSWORD
    };
    fs.writeFileSync(process.env.PAYLOAD_PATH, JSON.stringify(payload));
  '
  response_path="$tmp_env.bootstrap.response.json"

  status="$(
    curl -sS -o "$response_path" \
      -w "%{http_code}" \
      -H "Content-Type: application/json" \
      -X POST \
      --data-binary "@$tmp_env.bootstrap.json" \
      "${APP_URL}/api/setup/bootstrap" || true
  )"
  rm -f "$tmp_env.bootstrap.json"

  if [ "$status" != "200" ] && [ "$status" != "409" ]; then
    echo "Workspace bootstrap failed with HTTP ${status}." >&2
    cat "$response_path" >&2 || true
    rm -f "$response_path"
    return 1
  fi
  rm -f "$response_path"
}

echo "Running upgrade rehearsal against ${TARGET_VERSION}..."
echo "Resolved release tag: ${TARGET_RELEASE_TAG}"
if [ -n "${UPGRADE_REHEARSAL_IMAGE_TAG:-}" ]; then
  echo "Using rehearsal artifact source: explicit image tag ${REHEARSAL_IMAGE_TAG}"
elif [ "$REHEARSAL_IMAGE_TAG" = "$TARGET_RELEASE_TAG" ]; then
  echo "Using rehearsal artifact source: published release tag ${REHEARSAL_IMAGE_TAG}"
else
  echo "Using rehearsal artifact source: pre-release main snapshot ${REHEARSAL_IMAGE_TAG}"
fi
echo "Using temporary image pins from ${tmp_env}"

ensure_local_media_fixture

echo "Pulling target images..."
docker compose --env-file "$tmp_env" pull

echo "Recreating services..."
docker compose --env-file "$tmp_env" up -d

wait_for_json_ok() {
  endpoint="$1"
  label="$2"
  attempts=60
  while [ "$attempts" -gt 0 ]; do
    response="$(curl -fsS "$endpoint" 2>/dev/null || true)"
    if [ -n "$response" ]; then
      if printf "%s" "$response" | node -e '
        const fs = require("fs");
        const raw = fs.readFileSync(0, "utf8");
        const data = JSON.parse(raw);
        if (data.status === "ok" || data.status === "degraded") process.exit(0);
        process.exit(1);
      '; then
        return 0
      fi
    fi
    attempts=$((attempts - 1))
    sleep 5
  done

  echo "${label} did not become reachable in time."
  return 1
}

wait_for_broadcast_readiness() {
  endpoint="$1"
  attempts=60
  while [ "$attempts" -gt 0 ]; do
    response="$(curl -fsS "$endpoint" 2>/dev/null || true)"
    if [ -n "$response" ]; then
      if printf "%s" "$response" | node -e '
        const fs = require("fs");
        const raw = fs.readFileSync(0, "utf8");
        const data = JSON.parse(raw);
        if ((data.status === "ok" || data.status === "degraded") && data.broadcastReady === true) {
          process.exit(0);
        }
        process.exit(1);
      '; then
        return 0
      fi
    fi
    attempts=$((attempts - 1))
    sleep 5
  done

  echo "Readiness endpoint did not become broadcast-ready enough for rehearsal checks."
  return 1
}

wait_for_json_ok "${APP_URL}/api/health" "Health endpoint"
ensure_bootstrapped_workspace
wait_for_broadcast_readiness "${APP_URL}/api/system/readiness"

echo "Capturing current readiness snapshot..."
curl -fsS "${APP_URL}/api/system/readiness" | node -e '
  const fs = require("fs");
  const raw = fs.readFileSync(0, "utf8");
  const data = JSON.parse(raw);
  console.log(`status=${data.status}`);
  console.log(`broadcastReady=${String(data.broadcastReady)}`);
  console.log(`worker=${data.services?.worker ?? "unknown"}`);
  console.log(`playout=${data.services?.playout ?? "unknown"}`);
  console.log(`destination=${data.services?.destination ?? "unknown"}`);
  console.log(`selectionReasonCode=${data.playout?.selectionReasonCode ?? ""}`);
  console.log(`fallbackTier=${data.playout?.fallbackTier ?? ""}`);
  console.log(`crashLoopDetected=${String(data.playout?.crashLoopDetected ?? false)}`);
'

echo "Upgrade rehearsal completed for ${TARGET_VERSION}."
echo "Next:"
echo "1. Review /ops for incidents or drift."
echo "2. If this is a release candidate, run scripts/soak-monitor.sh --hours 24"
echo "3. Roll back by restoring prior pinned tags and rerunning docker compose up -d if needed."
