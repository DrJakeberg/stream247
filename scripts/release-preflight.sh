#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${RELEASE_PREFLIGHT_ENV_FILE:-.env}"
DEV_ENV_EXAMPLE="$ROOT_DIR/.env.example"
PROD_ENV_EXAMPLE="$ROOT_DIR/.env.production.example"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.example or .env.production.example first."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required."
  exit 1
fi

read_env_value() {
  key="$1"
  file_path="$2"
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

is_placeholder_value() {
  key="$1"
  value="$2"

  if [ -f "$DEV_ENV_EXAMPLE" ] && dev_example_value="$(read_env_value "$key" "$DEV_ENV_EXAMPLE" 2>/dev/null)"; then
    if [ "$value" = "$dev_example_value" ]; then
      return 0
    fi
  fi

  if [ -f "$PROD_ENV_EXAMPLE" ] && prod_example_value="$(read_env_value "$key" "$PROD_ENV_EXAMPLE" 2>/dev/null)"; then
    if [ "$value" = "$prod_example_value" ]; then
      return 0
    fi
  fi

  case "$value" in
    *change-me*|*replace-with-*|replace-me|*example.com*|http://localhost*|https://localhost*|http://127.0.0.1*|https://127.0.0.1*)
      return 0
      ;;
  esac

  return 1
}

require_production_setting() {
  key="$1"

  if ! value="$(read_env_value "$key" "$ENV_FILE" 2>/dev/null)"; then
    echo "Missing required setting in $ENV_FILE: ${key}"
    exit 1
  fi

  if [ -z "$value" ]; then
    echo "Invalid required setting in $ENV_FILE: ${key} is blank."
    exit 1
  fi

  if is_placeholder_value "$key" "$value"; then
    echo "Invalid required setting in $ENV_FILE: ${key} still uses an example or placeholder value."
    exit 1
  fi
}

echo "Running release preflight for Stream247 using $ENV_FILE..."

for key in APP_URL APP_SECRET POSTGRES_PASSWORD DATABASE_URL; do
  require_production_setting "$key"
done

echo "Checking image pinning policy..."
if grep -Eq '^STREAM247_(WEB|WORKER|PLAYOUT)_IMAGE=.*:latest$' "$ENV_FILE"; then
  echo "Production preflight failed: image tags still point to :latest."
  echo "Pin explicit release tags before production rollout."
  exit 1
fi

echo "Checking Compose configuration..."
docker compose --env-file "$ENV_FILE" config >/dev/null

if [ "${RELEASE_PREFLIGHT_SKIP_VALIDATE:-0}" = "1" ]; then
  echo "Skipping application validation because RELEASE_PREFLIGHT_SKIP_VALIDATE=1."
else
  echo "Checking application validation..."
  PATH="/home/benjamin/.local/n/bin:/home/benjamin/.local/bin:$PATH" pnpm validate
fi

echo "Release preflight succeeded."
echo "Next recommended steps:"
echo "1. Run scripts/upgrade-rehearsal.sh <target-version>"
echo "2. Run scripts/soak-monitor.sh --hours 24"
echo "3. Tag and publish only after both pass"
