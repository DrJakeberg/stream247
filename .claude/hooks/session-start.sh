#!/usr/bin/env bash
# Prepares a cloud container for a session: the Docker daemon for the integration tests
# (`postgres:16-alpine`) and the workspace dependencies. Local sessions skip it; there Docker
# runs as a system service and `pnpm install` is the developer's call.
set -uo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
log=/tmp/stream247-session-start.log

if ! docker info >/dev/null 2>&1 && command -v dockerd >/dev/null 2>&1; then
  run=""
  [ "$(id -u)" -eq 0 ] || run="sudo -n"
  $run dockerd >>"$log" 2>&1 &
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi
if docker info >/dev/null 2>&1; then
  echo "session-start: docker is up"
else
  echo "session-start: docker is not available (see $log); run the checks one by one (AGENTS.md, Validation)"
fi

# The same install as CI (`.github/workflows/ci.yml`).
if pnpm install --frozen-lockfile=false >>"$log" 2>&1; then
  echo "session-start: pnpm install done"
else
  echo "session-start: pnpm install failed (see $log)"
fi
exit 0
