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
    break
  fi

  attempts=$((attempts + 1))
  sleep 2
done

if [ "$attempts" -ge 20 ]; then
  echo "Smoke test failed: health endpoint did not become ready."
  exit 1
fi

# The overlay preview, checked in the built image rather than in `pnpm dev`.
#
# The studio now draws its preview with the broadcast renderer, which means the web image carries a
# layout engine and a font it never needed before. Both fail in ways that only show up here: a
# standalone build that did not carry the engine's payload along, and a runner stage without the
# font package. Neither is visible in development, where the whole workspace is on disk.

# The font the preview is drawn with. Unauthenticated by design, so this is a real end-to-end
# answer: 200 plus a TrueType signature means ttf-dejavu is installed in the runner stage and the
# renderer's own resolver found it.
font_head="$(wget -qO- "http://127.0.0.1:3000/api/scenes/preview/font?face=regular" | head -c 4 | od -An -tx1 | tr -d ' \n')"
if [ "$font_head" != "00010000" ]; then
  echo "Smoke test failed: the preview font endpoint did not return a TrueType file (first bytes: '$font_head')."
  echo "The runner stage is probably missing ttf-dejavu, so the studio preview would draw in the wrong typeface."
  exit 1
fi

# The renderer actually drawing something.
#
# It has to be a real render, not just a route that loads: satori builds its layout engine on the
# first render rather than when it is imported, so a bundle that lost the engine's payload imports
# perfectly and fails the first time an operator opens the scene editor. The self-check draws a
# scene compiled into the build — no parameters, no workspace state, one render per process — which
# is exactly the production-shaped question this image cannot answer any other way.
if ! wget -qO- http://127.0.0.1:3000/api/scenes/preview | grep -q '"renderer":"ok"'; then
  echo "Smoke test failed: the overlay renderer could not draw a frame in this image."
  echo "Most likely the standalone build did not carry satori's bundled layout engine, or the"
  echo "runner stage has no font. Response was:"
  wget -qO- http://127.0.0.1:3000/api/scenes/preview || true
  exit 1
fi

# And the render endpoint itself refuses an unsigned request. No database is running behind this
# container, so an authorised render cannot be reached — but the route answers before it looks
# anything up, which keeps this a check on the route rather than on Postgres.
preview_status="$(wget -q -O /dev/null -S --method=POST --header='content-type: application/json' \
  --body-data='{"payload":{}}' http://127.0.0.1:3000/api/scenes/preview 2>&1 | awk '/HTTP\// { print $2 }' | tail -n 1)"
if [ "$preview_status" != "401" ]; then
  echo "Smoke test failed: POST /api/scenes/preview answered $preview_status, expected 401."
  exit 1
fi

exit 0
