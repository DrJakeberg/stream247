# shellcheck shell=bash
#
# Containerised ffmpeg fallback for the smoke scripts.
#
# The scripts only use ffmpeg to synthesise fixtures (a colour source plus a tone, and an HLS
# repackage of it). That does not justify depending on the host having ffmpeg -- and on the GitHub
# hosted runners `apt-get install ffmpeg` has repeatedly failed outright, taking CI with it.
#
# The worker image built earlier in the same CI job already ships ffmpeg, so when the host has none
# we shadow `ffmpeg` with a shell function that runs it in that image. Shell functions take
# precedence over PATH lookups, so every existing call site keeps working untouched.
#
# Call `enable_ffmpeg_fallback <work_dir>` after the work directory exists. The directory is mounted
# at the same path inside the container, so the absolute paths the scripts already pass resolve
# identically on both sides.

enable_ffmpeg_fallback() {
  local work_dir="$1"
  local image="${SMOKE_FFMPEG_IMAGE:-stream247-worker:test}"

  if command -v ffmpeg >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "Neither ffmpeg nor docker is available; cannot generate media fixtures." >&2
    return 1
  fi

  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "ffmpeg is not installed and the fallback image '$image' is not present." >&2
    echo "Build it first (docker build -f docker/worker.Dockerfile -t $image .) or set SMOKE_FFMPEG_IMAGE." >&2
    return 1
  fi

  echo "ffmpeg not found on PATH; using $image instead."

  # Deliberately no --user. The two Docker modes map identities in opposite directions: under
  # rootless Docker container root maps to the invoking user (so root writes as us), while under
  # rootful Docker --user 1000 maps to host uid 1000. Pinning either one breaks the other, and
  # --user under rootless lands on a subuid with no write access to the mount. Running as the
  # container's default user works in both. Fixtures are only ever read afterwards, and cleanup
  # succeeds regardless of file owner because the caller owns the parent directory.
  ffmpeg() {
    docker run --rm \
      -v "${_STREAM247_FFMPEG_WORK_DIR}:${_STREAM247_FFMPEG_WORK_DIR}" \
      -w "${_STREAM247_FFMPEG_WORK_DIR}" \
      --entrypoint ffmpeg \
      "${_STREAM247_FFMPEG_IMAGE}" "$@"
  }

  _STREAM247_FFMPEG_WORK_DIR="$work_dir"
  _STREAM247_FFMPEG_IMAGE="$image"
  export _STREAM247_FFMPEG_WORK_DIR _STREAM247_FFMPEG_IMAGE
}
