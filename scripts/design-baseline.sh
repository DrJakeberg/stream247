#!/usr/bin/env bash
#
# Visual baseline runner.
#
# Runs against the development stack (scripts/dev-stack.sh), not the e2e smoke stack, for two
# reasons that both matter for pixel comparisons:
#
#  - The dev stack leaves worker/playout/uplink stopped, so nothing rewrites heartbeats or
#    readiness while the screenshots are taken. The e2e stack runs them, which is what made the
#    live surfaces flaky in the first place.
#  - It seeds a fixed workspace, so the pages under test have real content instead of empty states.
#
# Playwright itself runs inside the official image so the renderer is identical everywhere.
# Snapshots captured on a developer machine did not match a GitHub runner at the same Chromium
# version, because the installed fonts and fontconfig differ.
#
#   scripts/design-baseline.sh            verify against the current snapshots
#   scripts/design-baseline.sh --update   regenerate them
#
# A stack already running on DEV_STACK_PORT is reused; otherwise one is started and left up.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${DEV_STACK_PORT:-3020}"
BASE_URL="http://127.0.0.1:${PORT}"
IMAGE="${E2E_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.56.1-noble}"
SPEC="${DESIGN_BASELINE_SPEC:-tests/e2e/design-baseline.spec.ts}"

EXTRA_ARGS=""
[ "${1:-}" = "--update" ] && EXTRA_ARGS="--update-snapshots"

if ! curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1; then
  echo "No dev stack on ${BASE_URL}; starting one."
  DEV_STACK_PORT="$PORT" ./scripts/dev-stack.sh up >/dev/null
else
  echo "Reusing the dev stack on ${BASE_URL}."
  # Re-seeding is a no-op when the fixture is already present, and repairs a wiped workspace.
  DEV_STACK_PORT="$PORT" ./scripts/dev-stack.sh seed >/dev/null
fi

echo "Running ${SPEC} in ${IMAGE}"

# shellcheck disable=SC2086
docker run --rm --network host \
  -v "$ROOT_DIR:$ROOT_DIR" -w "$ROOT_DIR" \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e PLAYWRIGHT_BASE_URL="$BASE_URL" \
  -e E2E_OWNER_EMAIL="${DEV_OWNER_EMAIL:-owner@example.com}" \
  -e E2E_OWNER_PASSWORD="${DEV_OWNER_PASSWORD:-stream247-owner-pass}" \
  "$IMAGE" \
  ./node_modules/.bin/playwright test "$SPEC" \
    --config=playwright.config.ts --reporter=line $EXTRA_ARGS
