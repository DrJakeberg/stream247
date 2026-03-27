#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f ".env" ]; then
  echo "Missing .env. Copy .env.example first."
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

echo "Running release preflight for Stream247..."

for key in APP_URL APP_SECRET POSTGRES_PASSWORD DATABASE_URL; do
  if ! grep -q "^${key}=" .env; then
    echo "Missing required setting in .env: ${key}"
    exit 1
  fi
done

echo "Checking image pinning policy..."
if grep -Eq '^STREAM247_(WEB|WORKER|PLAYOUT)_IMAGE=.*:latest$' .env; then
  echo "Production preflight failed: image tags still point to :latest."
  echo "Pin explicit release tags before production rollout."
  exit 1
fi

echo "Checking Compose configuration..."
docker compose config >/dev/null

echo "Checking application validation..."
PATH="/home/benjamin/.local/n/bin:/home/benjamin/.local/bin:$PATH" pnpm validate

echo "Release preflight succeeded."
echo "Next recommended steps:"
echo "1. Run scripts/upgrade-rehearsal.sh <target-version>"
echo "2. Run scripts/soak-monitor.sh --hours 24"
echo "3. Tag and publish only after both pass"
