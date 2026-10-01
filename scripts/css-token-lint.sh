#!/usr/bin/env bash
#
# Ratchet on raw colour literals in CSS.
#
# The admin styling carries 185 hand-mixed colour values (26 hex, 159 rgba). That is the actual
# problem behind "the design is inconsistent": the same conceptual colour exists in a dozen
# slightly different mixes, which is how a contrast failure creeps in unnoticed.
#
# Consolidation happens gradually, so this does not demand zero. It pins the current count and
# fails when it goes UP. Every migration step lowers the baseline; nothing is allowed to raise it.
#
# Usage:
#   scripts/css-token-lint.sh            # check against the baseline
#   scripts/css-token-lint.sh --update   # lower the baseline after a migration step

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE_FILE="$ROOT_DIR/scripts/css-token-lint.baseline"
CSS_GLOB_DIR="$ROOT_DIR/apps/web/app"

# The token file is where literals are supposed to live, so it is exempt by design.
TOKENS_FILE="styles/tokens.css"

count_literals() {
  local total=0
  while IFS= read -r file; do
    case "$file" in
      *"$TOKENS_FILE") continue ;;
    esac

    # Comments are stripped first. Prose explaining why a colour was avoided routinely contains
    # the words "rgba()" or a hex value, and counting those makes the lint fire on the very
    # documentation that justifies a change.
    local stripped hex rgba
    stripped="$(sed ':a;N;$!ba;s@/\*[^*]*\*\+\([^/*][^*]*\*\+\)*/@@g' "$file")"
    hex="$(printf '%s' "$stripped" | grep -oE '#[0-9a-fA-F]{3,8}\b' | wc -l | tr -d ' ')"
    rgba="$(printf '%s' "$stripped" | grep -oE 'rgba?\([^)]*\)' | wc -l | tr -d ' ')"
    total=$((total + hex + rgba))
  done < <(find "$CSS_GLOB_DIR" -name '*.css' -type f | sort)
  echo "$total"
}

current="$(count_literals)"

if [ "${1:-}" = "--update" ]; then
  echo "$current" > "$BASELINE_FILE"
  echo "Baseline updated to $current colour literals."
  exit 0
fi

if [ ! -f "$BASELINE_FILE" ]; then
  echo "$current" > "$BASELINE_FILE"
  echo "No baseline found; recorded the current count of $current."
  exit 0
fi

baseline="$(tr -d '[:space:]' < "$BASELINE_FILE")"

if [ "$current" -gt "$baseline" ]; then
  echo "CSS token lint failed: $current raw colour literals, baseline is $baseline." >&2
  echo "" >&2
  echo "New colours belong in apps/web/app/styles/tokens.css and are referenced through a" >&2
  echo "var(--token) alias. If a literal is genuinely unavoidable, raise the baseline in the same" >&2
  echo "commit and say why in the message." >&2
  exit 1
fi

if [ "$current" -lt "$baseline" ]; then
  echo "CSS token lint: $current literals, down from $baseline. Run with --update to lock it in."
  exit 0
fi

echo "CSS token lint: $current colour literals, unchanged from the baseline."
