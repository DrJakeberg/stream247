#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DEFAULT_ENV_FILE="$ROOT_DIR/.env.production.example"

DRY_RUN=0
ENV_FILE="$DEFAULT_ENV_FILE"
STACK_LABEL_KEY="${PORTAINER_STACK_LABEL_KEY:-com.docker.compose.project}"

usage() {
  cat <<'EOF'
Usage: scripts/portainer-stack-check.sh [--dry-run] [--env-file <path>]

Read-only verification for the DT Portainer-managed Stream247 stack.

Required environment variables for a real check:
  PORTAINER_URL
  PORTAINER_API_KEY
  PORTAINER_ENVIRONMENT_ID
  PORTAINER_STACK_NAME

Options:
  --dry-run         Resolve expected image refs and digests only.
  --env-file PATH   Use a different pinned env file instead of .env.production.example.
  --help            Show this help text.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      if [ -z "$ENV_FILE" ]; then
        echo "Missing value for --env-file" >&2
        exit 1
      fi
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

read_env_value() {
  local key="$1"
  local file_path="$2"
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*" key "=" {
      line = $0
      sub("^[[:space:]]*" key "=", "", line)
      print line
      found = 1
      exit
    }
    END {
      if (!found) {
        exit 1
      }
    }
  ' "$file_path"
}

normalize_env_value() {
  local value
  value="$(printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

  case "$value" in
    \"*\")
      value="${value#\"}"
      value="${value%\"}"
      ;;
    \'*\')
      value="${value#\'}"
      value="${value%\'}"
      ;;
  esac

  printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

extract_image_repo() {
  local image_ref="$1"
  local last_segment="${image_ref##*/}"
  if [ "${last_segment#*:}" != "$last_segment" ]; then
    printf '%s\n' "${image_ref%:*}"
  else
    printf '%s\n' "$image_ref"
  fi
}

urlencode() {
  jq -rn --arg value "$1" '$value|@uri'
}

resolve_manifest_digest() {
  docker buildx imagetools inspect "$1" --format '{{json .}}' | jq -r '.manifest.digest'
}

portainer_api_get() {
  local path="$1"
  shift
  curl -fsS --get \
    -H "X-API-Key: ${PORTAINER_API_KEY}" \
    "$PORTAINER_URL$path" \
    "$@"
}

require_command docker
require_command jq
require_command curl

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

declare -A EXPECTED_IMAGES=()
declare -A EXPECTED_DIGESTS=()
declare -A SERVICE_ENV_KEYS=()

SERVICE_ENV_KEYS["web"]="STREAM247_WEB_IMAGE"
SERVICE_ENV_KEYS["worker"]="STREAM247_WORKER_IMAGE"
SERVICE_ENV_KEYS["uplink"]="STREAM247_WORKER_IMAGE"
SERVICE_ENV_KEYS["playout"]="STREAM247_PLAYOUT_IMAGE"
SERVICE_ENV_KEYS["relay"]="STREAM247_RELAY_IMAGE"

echo "Portainer stack check"
echo "Pinned env file: $ENV_FILE"
echo "Stack label key: $STACK_LABEL_KEY"

for service in web worker uplink playout relay; do
  env_key="${SERVICE_ENV_KEYS[$service]}"
  raw_value="$(read_env_value "$env_key" "$ENV_FILE")"
  normalized_value="$(normalize_env_value "$raw_value")"

  if [ -z "$normalized_value" ]; then
    echo "Pinned env file has a blank value for $env_key" >&2
    exit 1
  fi

  EXPECTED_IMAGES["$service"]="$normalized_value"
  EXPECTED_DIGESTS["$service"]="$(resolve_manifest_digest "$normalized_value")"
  printf 'expected %-7s %s @ %s\n' \
    "$service" \
    "${EXPECTED_IMAGES[$service]}" \
    "${EXPECTED_DIGESTS[$service]}"
done

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run only. No Portainer API calls were made."
  exit 0
fi

: "${PORTAINER_URL:?PORTAINER_URL is required}"
: "${PORTAINER_API_KEY:?PORTAINER_API_KEY is required}"
: "${PORTAINER_ENVIRONMENT_ID:?PORTAINER_ENVIRONMENT_ID is required}"
: "${PORTAINER_STACK_NAME:?PORTAINER_STACK_NAME is required}"

PORTAINER_URL="${PORTAINER_URL%/}"

filters="$(jq -nc --arg label "${STACK_LABEL_KEY}=${PORTAINER_STACK_NAME}" '{label:[$label]}')"
containers_json="$(
  portainer_api_get \
    "/api/endpoints/${PORTAINER_ENVIRONMENT_ID}/docker/containers/json" \
    --data-urlencode "all=1" \
    --data-urlencode "filters=${filters}"
)"

if [ "$(printf '%s' "$containers_json" | jq 'length')" -eq 0 ]; then
  echo "No containers were found for stack ${PORTAINER_STACK_NAME}." >&2
  exit 1
fi

failures=0

check_service() {
  local service="$1"
  local expected_image="${EXPECTED_IMAGES[$service]}"
  local expected_digest="${EXPECTED_DIGESTS[$service]}"
  local expected_repo
  expected_repo="$(extract_image_repo "$expected_image")"
  local expected_repo_digest="${expected_repo}@${expected_digest}"

  local matches
  matches="$(printf '%s' "$containers_json" | jq -c --arg service "$service" '
    [ .[] | select(.Labels["com.docker.compose.service"] == $service) ]
  ')"

  local count
  count="$(printf '%s' "$matches" | jq 'length')"
  if [ "$count" -eq 0 ]; then
    echo "FAIL ${service}: no containers found in stack ${PORTAINER_STACK_NAME}" >&2
    failures=$((failures + 1))
    return
  fi

  local index=0
  while [ "$index" -lt "$count" ]; do
    local container_json
    container_json="$(printf '%s' "$matches" | jq -c ".[$index]")"
    local container_name
    container_name="$(printf '%s' "$container_json" | jq -r '.Names[0] | ltrimstr(\"/\")')"
    local container_image
    container_image="$(printf '%s' "$container_json" | jq -r '.Image')"
    local image_id
    image_id="$(printf '%s' "$container_json" | jq -r '.ImageID')"

    if [ -z "$image_id" ] || [ "$image_id" = "null" ]; then
      echo "FAIL ${service}: container ${container_name} has no ImageID" >&2
      failures=$((failures + 1))
      index=$((index + 1))
      continue
    fi

    local image_json
    image_json="$(portainer_api_get "/api/endpoints/${PORTAINER_ENVIRONMENT_ID}/docker/images/$(urlencode "$image_id")/json")"
    local repo_digests
    repo_digests="$(printf '%s' "$image_json" | jq -r '.RepoDigests[]?')"

    if [ -z "$repo_digests" ]; then
      echo "FAIL ${service}: container ${container_name} image ${image_id} exposes no RepoDigests" >&2
      failures=$((failures + 1))
      index=$((index + 1))
      continue
    fi

    if printf '%s\n' "$repo_digests" | grep -Fxq "$expected_repo_digest"; then
      printf 'PASS %-7s %s (%s)\n' "$service" "$container_name" "$expected_repo_digest"
    else
      echo "FAIL ${service}: container ${container_name} uses ${container_image}" >&2
      echo "  expected digest: ${expected_repo_digest}" >&2
      echo "  actual digests:" >&2
      printf '%s\n' "$repo_digests" | sed 's/^/    - /' >&2
      failures=$((failures + 1))
    fi

    index=$((index + 1))
  done
}

for service in web worker uplink playout relay; do
  check_service "$service"
done

if [ "$failures" -gt 0 ]; then
  echo "Portainer stack check failed with ${failures} mismatch(es)." >&2
  exit 1
fi

echo "Portainer stack check passed for ${PORTAINER_STACK_NAME}."
