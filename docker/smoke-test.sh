#!/bin/sh
set -eu

IMAGE_TAG="${1:-stream247-web:test}"
CONTAINER_NAME="stream247-smoke"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

trap cleanup EXIT

docker run -d --name "$CONTAINER_NAME" -p 3000:3000 "$IMAGE_TAG"

attempts=0
until [ "$attempts" -ge 20 ]
do
  if wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    exit 0
  fi

  attempts=$((attempts + 1))
  sleep 2
done

echo "Smoke test failed: health endpoint did not become ready."
exit 1

