#!/usr/bin/env bash
#
# Builds every image from a pristine checkout, the way CI does.
#
# Why this exists: excluding **/node_modules from the build context fixed the web image and broke
# the worker image in the same commit, and nothing noticed. Both Dockerfiles had been quietly
# relying on the developer's workspace node_modules being copied in by `COPY . .`, so a machine that
# has them keeps building either way. CI builds from a clean tree and would have caught it — but the
# change sat unpushed for twenty-two commits, and by the time it lands the damage is a release.
#
# This is deliberately not part of `pnpm validate`: it clones and does two full image builds, which
# is minutes rather than seconds. Run it before a release, or after touching a Dockerfile,
# .dockerignore, or anything about how dependencies are installed.
#
# It checks HEAD, not the working tree: an uncommitted fix does not count, because CI will not have
# it either.
#
#   scripts/clean-checkout-build.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Cloning HEAD into a clean tree..."
git clone -q --local --no-hardlinks . "$WORK_DIR/repo"

# Proof rather than assumption: a stray node_modules here would hide exactly what this checks.
if find "$WORK_DIR/repo" -maxdepth 3 -name node_modules -not -path "*/.git/*" | grep -q .; then
  echo "The clone contains node_modules; this check cannot tell you anything." >&2
  exit 1
fi

for dockerfile in docker/*.Dockerfile; do
  name="$(basename "$dockerfile" .Dockerfile)"
  echo "Building ${name} from the clean tree..."
  # The Dockerfile from inside the clone, not from the working tree. Passing the local path built
  # an uncommitted Dockerfile against a committed context, which reported success while HEAD was
  # broken — a check that can pass with the fault still in it is worse than no check.
  docker build -q -f "$WORK_DIR/repo/$dockerfile" -t "stream247-${name}:clean-checkout" "$WORK_DIR/repo" >/dev/null
  echo "  ${name}: ok"
done

echo "All images build from a clean checkout."
