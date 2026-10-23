#!/usr/bin/env bash
#
# M121: the tests that run real ffmpeg and ffprobe, required rather than skipped.
#
# `pnpm test` skips them where the host has no ffmpeg, and CI's validate job installs ffmpeg only
# after `pnpm test` (and only optionally: apt on the hosted runners has hung and failed). So they never
# ran in CI. Here a missing tool fails the run (STREAM247_REQUIRE_MEDIA_TOOLS=1). Without host ffmpeg,
# ffmpeg and ffprobe come from the worker image built earlier in the job, through two wrappers on PATH
# that mount the temp directory and the repository at the same paths (as scripts/lib/ffmpeg-fallback.sh
# does for the smoke scripts). The integration file also needs apps/worker/dist (`pnpm build`) and Docker.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

files=(
  tests/unit/local-durations.test.ts
  tests/unit/ticker-crawl-ffmpeg.test.ts
  tests/unit/ticker-crawl-end-to-end.test.ts
  tests/unit/ticker-crawl-coverage.test.ts
  tests/integration/local-durations-worker.test.ts
)

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  image="${SMOKE_FFMPEG_IMAGE:-stream247-worker:test}"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "No host ffmpeg/ffprobe and no image '$image'." >&2
    echo "Build it first (docker build -f docker/worker.Dockerfile -t $image .) or set SMOKE_FFMPEG_IMAGE." >&2
    exit 1
  fi
  temp_dir="${TMPDIR:-/tmp}"
  shim_dir="$(mktemp -d)"
  trap 'rm -rf "$shim_dir"' EXIT
  for tool in ffmpeg ffprobe; do
    cat >"$shim_dir/$tool" <<SHIM
#!/usr/bin/env bash
exec docker run --rm -i -v "$temp_dir:$temp_dir" -v "$repo_root:$repo_root" -w "\$PWD" --entrypoint $tool "$image" "\$@"
SHIM
    chmod +x "$shim_dir/$tool"
  done
  export PATH="$shim_dir:$PATH"
  echo "ffmpeg/ffprobe not on PATH; using $image."
fi

ffmpeg -hide_banner -version | head -n 1
STREAM247_REQUIRE_MEDIA_TOOLS=1 pnpm exec vitest run "${files[@]}"
