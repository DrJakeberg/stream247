# shellcheck shell=bash
#
# Deterministic workspace fixture.
#
# Every smoke script builds its own throwaway workspace inline, so nothing shared exists to develop
# against. This creates the same workspace every time, through the app's own API rather than SQL, so
# the seed exercises the real validation paths instead of bypassing them.
#
# Everything is fixed: ids, titles, times, ordering. Nothing derives from the current date or from
# a random id, because the point is that two runs are byte-identical.
#
# Usage: seed_dev_fixture <base_url> <cookie_jar>

seed_dev_fixture() {
  local base_url="$1"
  local cookie_jar="$2"

  local owner_email="${DEV_OWNER_EMAIL:-owner@example.com}"
  local owner_password="${DEV_OWNER_PASSWORD:-stream247-owner-pass}"

  _fixture_post() {
    curl -fsS -b "$cookie_jar" -c "$cookie_jar" \
      -H "Content-Type: application/json" \
      -X POST -d "$2" "${base_url}$1"
  }

  # Bootstrap is idempotent in effect: on an already-initialised workspace it fails and we sign in
  # instead, so `seed` can be re-run without tearing the stack down.
  local credentials
  credentials="$(jq -nc --arg email "$owner_email" --arg password "$owner_password" '{email: $email, password: $password}')"

  if _fixture_post "/api/setup/bootstrap" "$credentials" >/dev/null 2>&1; then
    echo "Owner account created."
  else
    _fixture_post "/api/auth/login" "$credentials" >/dev/null
    echo "Workspace already initialised; signed in."
  fi

  # Idempotent by content, not by early exit: re-running against a seeded workspace should be a
  # no-op rather than duplicating every pool and block.
  # Checks for the fixture's own marker rather than "any pool at all": defaultState() already ships
  # a pool, so a count would report the fixture as present on a completely fresh workspace.
  if curl -fsS -b "$cookie_jar" "${base_url}/api/pools" | jq -e '.pools | any(.name == "Abendprogramm")' >/dev/null 2>&1; then
    echo "Fixture already present; nothing to do."
    return 0
  fi

  # A pool must reference at least one source, so the ids seeded by defaultState() are used.
  _fixture_post "/api/pools" "$(jq -nc '{
    name: "Abendprogramm",
    sourceIds: ["source-local-library"]
  }')" >/dev/null
  _fixture_post "/api/pools" "$(jq -nc '{
    name: "Nachtschleife",
    sourceIds: ["source-local-library", "source-youtube"]
  }')" >/dev/null

  _fixture_post "/api/destinations" "$(jq -nc '{
    name: "Lokales Relay",
    url: "rtmp://relay:1935/live",
    streamKey: "dev-fixture",
    enabled: true
  }')" >/dev/null

  # Blocks on every weekday, including one crossing midnight, so the schedule surfaces have the
  # shape that actually exercises the carry-over logic rather than an empty grid.
  # Blocks must reference an existing pool, and the create response does not return an id, so it is
  # looked up by the name just written.
  local pool_id
  pool_id="$(curl -fsS -b "$cookie_jar" "${base_url}/api/pools" | jq -r '.pools[] | select(.name == "Abendprogramm") | .id' | head -1)"
  if [ -z "$pool_id" ]; then
    echo "Could not resolve the seeded pool id; aborting fixture." >&2
    return 1
  fi

  # The API takes a start minute and a duration, not wall-clock strings.
  local day
  # Days 1-4 only: defaultState() already occupies Friday evening with "Prime Time YouTube
  # Playlist", and the API rejects overlapping blocks.
  for day in 1 2 3 4; do
    _fixture_post "/api/schedule/blocks" "$(jq -nc --argjson day "$day" --arg pool "$pool_id" '{
      title: "Abendprogramm",
      categoryName: "Musik",
      sourceName: "Lokale Bibliothek",
      dayOfWeek: $day,
      poolId: $pool,
      startMinuteOfDay: 1200,
      durationMinutes: 180,
      repeatMode: "single"
    }')" >/dev/null
  done

  # Saturday 23:00 for two hours, i.e. running into Sunday. Keeps the carry-over path represented
  # in the fixture rather than only in unit tests. Saturday is free in the default schedule.
  _fixture_post "/api/schedule/blocks" "$(jq -nc --arg pool "$pool_id" '{
    title: "Nachtschleife",
    categoryName: "Archiv",
    sourceName: "Lokale Bibliothek",
    dayOfWeek: 6,
    poolId: $pool,
    startMinuteOfDay: 1380,
    durationMinutes: 120,
    repeatMode: "single"
  }')" >/dev/null

  echo "Fixture seeded: 2 pools, 1 destination, 5 schedule blocks (one crossing midnight)."
}
