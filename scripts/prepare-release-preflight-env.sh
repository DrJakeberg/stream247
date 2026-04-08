#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SOURCE_ENV_FILE="${1:-$ROOT_DIR/.env.production.example}"

if [ ! -f "$SOURCE_ENV_FILE" ]; then
  echo "Missing source env file: $SOURCE_ENV_FILE" >&2
  exit 1
fi

TARGET_ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/stream247-release-preflight-env.XXXXXX")"
cp "$SOURCE_ENV_FILE" "$TARGET_ENV_FILE"

replace_or_append_env() {
  key="$1"
  value="$2"
  file_path="$3"
  temp_file="$(mktemp "${TMPDIR:-/tmp}/stream247-release-preflight-edit.XXXXXX")"

  awk -v key="$key" -v value="$value" '
    BEGIN {
      replaced = 0
    }
    $0 ~ "^[[:space:]]*" key "=" {
      print key "=" value
      replaced = 1
      next
    }
    {
      print
    }
    END {
      if (!replaced) {
        print key "=" value
      }
    }
  ' "$file_path" > "$temp_file"

  mv "$temp_file" "$file_path"
}

replace_or_append_env "APP_URL" "https://stream247-ci.test" "$TARGET_ENV_FILE"
replace_or_append_env "APP_SECRET" "ci-release-preflight-secret-0123456789" "$TARGET_ENV_FILE"
replace_or_append_env "POSTGRES_PASSWORD" "ci-release-preflight-db-password" "$TARGET_ENV_FILE"
replace_or_append_env "DATABASE_URL" "postgresql://stream247:ci-release-preflight-db-password@postgres:5432/stream247" "$TARGET_ENV_FILE"
replace_or_append_env "TRAEFIK_HOST" "stream247-ci.test" "$TARGET_ENV_FILE"
replace_or_append_env "TRAEFIK_ACME_EMAIL" "ops@stream247-ci.test" "$TARGET_ENV_FILE"

printf '%s\n' "$TARGET_ENV_FILE"
