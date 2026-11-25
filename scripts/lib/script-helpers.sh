# shellcheck shell=sh
#
# Helpers shared by the smoke, release and stack-check scripts.
#
# Each script used to carry its own copy of these, and the copies drifted (one lost its `local`). They
# live here once; tests/unit/script-helpers.test.ts fails when a script under scripts/ defines one of
# them again. release-preflight.sh runs under plain sh, so everything here stays POSIX sh apart from
# `local`, which dash, busybox ash and bash all accept.
#
# Source it from the script's own location, so the script works from any working directory:
#   . "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib/script-helpers.sh"
# or, in a script that already has ROOT_DIR (the repository root):
#   . "$ROOT_DIR/scripts/lib/script-helpers.sh"

# Prints the raw value of the first `KEY=` line in an env file, as written (quotes and spaces kept).
# Exits 1 when the file has no such line.
# Usage: read_env_value <key> <file>
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

# Prints an env value without surrounding whitespace and one pair of matching quotes.
# Usage: normalize_env_value <raw value>
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

# Runs one SQL statement in the stack's postgres service and prints unaligned rows, fields split by `|`.
# The calling script defines `compose` (its own project name and compose files).
# Usage: psql_query <sql>
psql_query() {
  compose exec -T postgres psql -U stream247 -d stream247 -At -F '|' -c "$1"
}
