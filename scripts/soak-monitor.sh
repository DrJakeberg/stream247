#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

HOURS=24
INTERVAL=60
FOLLOW_WEB=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --hours)
      HOURS="$2"
      shift 2
      ;;
    --interval-seconds)
      INTERVAL="$2"
      shift 2
      ;;
    --follow-web)
      FOLLOW_WEB=1
      shift
      ;;
    *)
      echo "Usage: scripts/soak-monitor.sh [--hours 24] [--interval-seconds 60] [--follow-web]"
      exit 1
      ;;
  esac
done

# Tolerance knobs (overridable via env). A clean-exit feed-handoff uplink restart
# (uplinkUnplannedRestarts +1) is treated as a benign warning when the rest of the
# readiness sample is healthy; a runaway delta still fails the soak. Single-sample
# uplink/destination not-ready blips are tolerated up to the configured count of
# consecutive samples.
SOAK_UPLINK_RESTART_RUNAWAY_DELTA="${SOAK_UPLINK_RESTART_RUNAWAY_DELTA:-20}"
TOLERATE_UPLINK_NOTREADY_SAMPLES="${SOAK_TOLERATE_UPLINK_NOTREADY_SAMPLES:-1}"
TOLERATE_DEST_NOTREADY_SAMPLES="${SOAK_TOLERATE_DEST_NOTREADY_SAMPLES:-1}"
TOLERATE_FEED_STALE_DURING_PLAYOUT_TRANSIENT_SAMPLES="${SOAK_TOLERATE_FEED_STALE_DURING_PLAYOUT_TRANSIENT_SAMPLES:-1}"
# A readiness fetch that fails outright (curl error: DNS, TLS, reset) is a network sample, not an app
# sample. A one-minute path interruption killed a 24 h soak at its 58th minute on 2026-09-05; the
# channel itself healed in 70 s. Tolerate a short run of them, fail on a longer one.
TOLERATE_FETCH_FAILED_SAMPLES="${SOAK_TOLERATE_FETCH_FAILED_SAMPLES:-2}"
# Outage window. Every night at 23:31 UTC the DUT loses its path to Twitch for one to three minutes and
# the stack heals itself; two 24 h soaks on v2.0.0 died on it (21 h 07 min, 23 h 51 min) without any
# application fault, and no 24 h window can avoid that minute. So a run of failed samples no longer ends
# the soak on its own: it opens an outage, and the soak goes on as long as the stack is healthy again
# within this many seconds of the first bad sample. Each healed outage is logged (`outage-recovered`)
# and counted in the completion line, so a pass with outages never reads like a clean one. Longer than
# this, and the soak fails (`outage-exceeded`). A crash loop, a runaway restart count and a container
# restart are never carried by the window. 0 restores the strict per-sample rules above exactly.
OUTAGE_TOLERANCE_SECONDS="${SOAK_OUTAGE_TOLERANCE_SECONDS:-300}"
export SOAK_UPLINK_RESTART_RUNAWAY_DELTA

# Seconds since the epoch. SOAK_CLOCK_FILE lets the tests drive time: their sleep advances the file,
# which is the only way to exercise a five-minute window without waiting five minutes.
now_epoch() {
  if [ -n "${SOAK_CLOCK_FILE:-}" ]; then
    cat "$SOAK_CLOCK_FILE"
  else
    date +%s
  fi
}

if [ -z "${CHECK_BASE_URL:-}" ] && [ "$FOLLOW_WEB" -ne 1 ] && [ ! -f ".env" ]; then
  echo "Missing .env. Copy .env.example first, set CHECK_BASE_URL to the public base URL, or pass --follow-web."
  exit 1
fi

if [ "$FOLLOW_WEB" -eq 1 ] && [ -n "${CHECK_BASE_URL:-}" ]; then
  echo "--follow-web measures the web container's own address: unset CHECK_BASE_URL or drop --follow-web."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required."
  exit 1
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  CONTAINER_RESTART_MONITORING=1
else
  CONTAINER_RESTART_MONITORING=0
fi

# Every docker call that asks the daemon is bounded (M111). With socket activation (docker.socket, the apt
# packaging of the DUT) a call made while dockerd is stopped or starting waits for the next dockerd instead of
# failing, and a monitor stuck in such a call takes no samples: an off-air period with dockerd down would
# never reach the outage window. A call that does not answer in time reads like a failed one ("unknown",
# or a failed lookup), so the samples go on. Without coreutils' timeout the calls stay unbounded.
DOCKER_TIMEOUT_SECONDS="${SOAK_DOCKER_TIMEOUT_SECONDS:-10}"
docker_bounded() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "$DOCKER_TIMEOUT_SECONDS" docker "$@"
  else
    docker "$@"
  fi
}

# Why a bounded docker call ($1, its arguments) gave no answer ($2, its exit code), for the log.
docker_call_failed() {
  if [ "$2" -eq 124 ]; then
    printf "docker did not answer within %ss (docker %s)" "$DOCKER_TIMEOUT_SECONDS" "$1"
  else
    printf "docker %s failed with exit %s" "$1" "$2"
  fi
}

# --follow-web (M111): a stack that does not publish web's port on the host (the DUT's Portainer stack) is
# measured at the web container's address on the stack network, read from docker, not from the operator.
# web listens on 3000 inside its container (docker-compose.yml).
WEB_PORT=3000
WEB_ADDRESS=""

# Prints "<address> <network>" of the compose project's running web container (the directory above scripts/
# and COMPOSE_PROJECT_NAME, as for the restart counts), on the project's own network when it is on several.
# Fails with the reason on stdout when docker does not answer, there is no such container or it has no address.
web_container_address() {
  web_rc=0
  web_ids="$(docker_bounded compose ps -q web 2>/dev/null)" || web_rc=$?
  if [ "$web_rc" -ne 0 ]; then
    docker_call_failed "compose ps -q web" "$web_rc"
    return 1
  fi
  web_id="$(printf "%s\n" "$web_ids" | head -n 1)"
  if [ -z "$web_id" ]; then
    printf "no running web container (docker compose ps -q web is empty here, COMPOSE_PROJECT_NAME=%s)" "${COMPOSE_PROJECT_NAME:-unset}"
    return 1
  fi
  web_networks="$(docker_bounded inspect --format 'project={{index .Config.Labels "com.docker.compose.project"}} {{range $name, $net := .NetworkSettings.Networks}}{{$name}}={{$net.IPAddress}} {{end}}' "$web_id" 2>/dev/null)" || web_rc=$?
  if [ "$web_rc" -ne 0 ]; then
    docker_call_failed "inspect ${web_id}" "$web_rc"
    return 1
  fi
  # One "network=address" per line; a network without an IPv4 address ("name=") is no way in.
  web_pairs="$(printf "%s\n" $web_networks | grep -v -e '^project=' -e '=$' || true)"
  web_project="$(printf "%s\n" $web_networks | sed -n 's/^project=//p' | head -n 1)"
  web_pick="$(printf "%s\n" "$web_pairs" | grep "^${web_project}_" | head -n 1 || true)"
  if [ -z "$web_pick" ]; then
    web_pick="$(printf "%s\n" "$web_pairs" | head -n 1)"
  fi
  if [ -z "$web_pick" ]; then
    printf "web container %s has no address on any network" "$web_id"
    return 1
  fi
  printf "%s %s" "${web_pick#*=}" "${web_pick%%=*}"
}

CHECK_BASE_URL="${CHECK_BASE_URL:-}"
if [ "$FOLLOW_WEB" -eq 1 ]; then
  if [ "$CONTAINER_RESTART_MONITORING" -ne 1 ]; then
    echo "Cannot follow the web container: --follow-web needs docker compose."
    exit 1
  fi
  if ! web_lookup="$(web_container_address)"; then
    echo "Cannot follow the web container: ${web_lookup}."
    exit 1
  fi
  WEB_ADDRESS="${web_lookup%% *}"
  WEB_NETWORK="${web_lookup#* }"
  CHECK_BASE_URL="http://${WEB_ADDRESS}:${WEB_PORT}"
fi
APP_URL="$(printf "%s" "${CHECK_BASE_URL:-$(sed -n 's/^APP_URL=//p' .env | tail -n 1)}" | sed 's#/*$##')"
if [ -z "$APP_URL" ]; then
  APP_URL="http://localhost:3000"
fi

SESSION_COOKIE="${SESSION_COOKIE:-}"

LOG_DIR="${ROOT_DIR}/logs"
mkdir -p "$LOG_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${LOG_DIR}/soak-${TIMESTAMP}.log"

TOTAL_SECONDS=$((HOURS * 3600))
END_TIME=$(( $(now_epoch) + TOTAL_SECONDS ))

echo "Starting soak monitor for ${HOURS}h at ${APP_URL}" | tee -a "$LOG_FILE"
echo "Writing log to ${LOG_FILE}" | tee -a "$LOG_FILE"
if [ "$FOLLOW_WEB" -eq 1 ]; then
  echo "Following the web container: address=${WEB_ADDRESS} network=${WEB_NETWORK}, read again on a refused connection" | tee -a "$LOG_FILE"
fi

service_container_id() {
  docker_bounded compose ps -q "$1" 2>/dev/null | head -n 1 || true
}

container_restart_count() {
  service="$1"
  if [ "$CONTAINER_RESTART_MONITORING" -ne 1 ]; then
    printf "unknown"
    return 0
  fi

  container_id="$(service_container_id "$service")"
  if [ -z "$container_id" ]; then
    printf "unknown"
    return 0
  fi

  count="$(docker_bounded inspect --format '{{.RestartCount}}' "$container_id" 2>/dev/null || true)"
  case "$count" in
    ''|*[!0-9]*)
      printf "unknown"
      ;;
    *)
      printf "%s" "$count"
      ;;
  esac
}

# Every long-running service of docker-compose.yml, in one list for the baseline and the check (M95).
# Without uplink and relay, an uplink that crashed and came back inside one sample passed a 24 h soak.
# A service that does not run here (the relay with relay mode off) reads "unknown" and is skipped.
SOAK_RESTART_SERVICES="web worker playout uplink relay"

# When the service's container last started (State.StartedAt). RestartCount counts only the restart policy's
# restarts: a Docker daemon restart starts every container again and leaves it at 0, so the restart check
# never saw the one of 2026-10-18 22:15 UTC (M111). The start time moves on every start.
container_started_at() {
  if [ "$CONTAINER_RESTART_MONITORING" -ne 1 ]; then
    printf "unknown"
    return 0
  fi
  container_id="$(service_container_id "$1")"
  started=""
  if [ -n "$container_id" ]; then
    started="$(docker_bounded inspect --format '{{.State.StartedAt}}' "$container_id" 2>/dev/null || true)"
  fi
  case "$started" in
    ''|*' '*|0001-*)
      printf "unknown"
      ;;
    *)
      printf "%s" "$started"
      ;;
  esac
}

# "service=value" for every service of the list, each value read by the function named in $1.
collect_per_service() {
  values=""
  for service in $SOAK_RESTART_SERVICES; do
    values="${values}${values:+ }${service}=$("$1" "$service")"
  done
  printf "%s" "$values"
}

collect_container_restart_counts() {
  collect_per_service container_restart_count
}

collect_container_starts() {
  collect_per_service container_started_at
}

service_value() {
  service="$1"
  counts="$2"
  printf "%s\n" "$counts" | tr ' ' '\n' | sed -n "s/^${service}=//p" | tail -n 1
}

BASELINE_CONTAINER_RESTART_COUNTS="$(collect_container_restart_counts)"
export BASELINE_CONTAINER_RESTART_COUNTS
echo "Baseline container restarts: ${BASELINE_CONTAINER_RESTART_COUNTS}" | tee -a "$LOG_FILE"
BASELINE_CONTAINER_STARTS="$(collect_container_starts)"
echo "Baseline container starts: ${BASELINE_CONTAINER_STARTS}" | tee -a "$LOG_FILE"

BASELINE_UPLINK_UNPLANNED_RESTARTS="$(
  curl -fsS "${APP_URL}/api/system/readiness" 2>/dev/null | node -e '
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(0, "utf8"));
      console.log(Number(data.uplink?.unplannedRestartCount ?? 0));
    } catch {
      console.log(0);
    }
  ' 2>/dev/null || echo 0
)"
export BASELINE_UPLINK_UNPLANNED_RESTARTS
echo "Baseline uplink unplanned restarts: ${BASELINE_UPLINK_UNPLANNED_RESTARTS}" | tee -a "$LOG_FILE"

# Called after every healthy sample, in this shell (it keeps state): sets container_restart_line, and fails
# when a service's RestartCount rose above its baseline. A `docker restart` (the relay watchdog's, M114) sets
# RestartCount back to 0, so a later restart of the restart policy stayed below the old baseline and passed
# unseen (M126). A count below the baseline is logged once, with both counts, and the baseline becomes 0:
# Docker only ever sets the count back to 0, so a count above 0 at that sample is already a restart of the
# restart policy and fails the soak as any restart does. The start itself is logged by check_container_starts.
check_container_restarts() {
  current_counts="$(collect_container_restart_counts)"
  issues=""
  next_counts=""

  for service in $SOAK_RESTART_SERVICES; do
    baseline_count="$(service_value "$service" "$BASELINE_CONTAINER_RESTART_COUNTS")"
    current_count="$(service_value "$service" "$current_counts")"
    case "${baseline_count}:${current_count}" in
      *[!0-9:]*|:*|*:)
        next_counts="${next_counts}${next_counts:+ }${service}=${baseline_count}"
        continue
        ;;
    esac
    if [ "$current_count" -lt "$baseline_count" ]; then
      echo "${NOW} container-restart-count-reset service=${service} baseline=${baseline_count} restartCount=${current_count}" | tee -a "$LOG_FILE"
      baseline_count=0
    fi
    next_counts="${next_counts}${next_counts:+ }${service}=${baseline_count}"
    delta=$((current_count - baseline_count))
    if [ "$delta" -gt 0 ]; then
      issues="${issues}${issues:+, }${service}Restarts=${current_count}(+${delta})"
    fi
  done
  BASELINE_CONTAINER_RESTART_COUNTS="$next_counts"

  if [ -n "$issues" ]; then
    container_restart_line="$issues"
    return 1
  fi

  container_restart_line="containerRestarts=${current_counts}"
}

# Called after every healthy sample, and once more when an outage ends the soak, in this shell (it keeps
# state). Never before a sample or while an outage runs: the failure path asks docker nothing but the one
# bounded lookup of --follow-web, as before M111, so a slow or absent daemon cannot hold the samples back.
# A start time that moved means the container
# was started again: every service at once is a Docker daemon restart (on 2026-10-18 an upgrade of
# containerd.io restarted the daemon, and the channel was back on air 16 s later), a part of them a hand
# (docker restart, a recreate) or the restart policy, whose rise the restart check fails anyway. Neither
# fails the soak on its own: the readiness samples and the outage window judge the air, as for any outage.
# Each is logged once, with the new start time, and counted in the completion line, so a pass across one
# never reads like a clean one. A service that reads "unknown" for a moment (the daemon still down) keeps
# its baseline.
docker_restart_count=0
containers_started_again_count=0
check_container_starts() {
  current_starts="$(collect_container_starts)"
  next_starts=""
  moved=""
  moved_at=""
  unmoved=0
  for entry in $current_starts; do
    service="${entry%%=*}"
    started="${entry#*=}"
    baseline_started="$(service_value "$service" "$BASELINE_CONTAINER_STARTS")"
    if [ "$started" = "unknown" ]; then
      next_starts="${next_starts}${next_starts:+ }${service}=${baseline_started:-unknown}"
      continue
    fi
    next_starts="${next_starts}${next_starts:+ }${entry}"
    case "$baseline_started" in
      ''|unknown)
        continue
        ;;
    esac
    if [ "$started" = "$baseline_started" ]; then
      unmoved=$((unmoved + 1))
    else
      moved="${moved}${moved:+,}${service}"
      moved_at="${moved_at:-$started}"
    fi
  done
  BASELINE_CONTAINER_STARTS="$next_starts"

  if [ -z "$moved" ]; then
    return 0
  fi
  if [ "$unmoved" -eq 0 ]; then
    docker_restart_count=$((docker_restart_count + 1))
    echo "${NOW} docker-daemon-restart startedAt=${moved_at} services=${moved}" | tee -a "$LOG_FILE"
  else
    containers_started_again_count=$((containers_started_again_count + 1))
    echo "${NOW} container-started-again startedAt=${moved_at} services=${moved}" | tee -a "$LOG_FILE"
  fi
}

CLASSIFIER_MODULE="${ROOT_DIR}/scripts/lib/soak-readiness-classifier.cjs"

# check_readiness exits 0 (ok), 1 (hard fail — exit soak now, no window carries it), 2 (transient —
# caller tracks consecutive count per kind on stderr), 3 (the fetch itself failed), 4 (fail the
# outage window may carry) or 5 (the fetch failed to connect, curl 7: nothing listens at the address; the
# caller counts it as 3 unless --follow-web finds web at a new one). Always writes the log-friendly line on
# stdout.
check_readiness() {
  if response="$(curl -fsS "${APP_URL}/api/system/readiness" 2>&1)"; then
    :
  else
    fetch_rc=$?
    printf "fetch-failed: %s\n" "$(printf "%s" "$response" | head -n 1)" >&2
    if [ "$fetch_rc" -eq 7 ]; then
      return 5
    fi
    return 3
  fi
  printf "%s" "$response" | node -e '
    const path = require("path");
    const fs = require("fs");
    const { classifyReadinessSample } = require(process.env.CLASSIFIER_MODULE);
    const raw = fs.readFileSync(0, "utf8");
    const data = JSON.parse(raw);
    const result = classifyReadinessSample(data, {
      baselineUplinkRestarts: Number(process.env.BASELINE_UPLINK_UNPLANNED_RESTARTS ?? "0"),
      runawayThreshold: Number(process.env.SOAK_UPLINK_RESTART_RUNAWAY_DELTA ?? "20")
    });
    if (result.kind === "fail" && result.hard) {
      process.stdout.write(result.line + ", hard=" + result.hardReasons.join("+") + "\n");
      process.exit(1);
    }
    process.stdout.write(result.line + "\n");
    if (result.kind === "ok") {
      process.exit(0);
    }
    if (result.kind === "transient") {
      process.stderr.write("transient:" + result.transientKinds.join(",") + "\n");
      process.exit(2);
    }
    process.exit(4);
  '
}
export CLASSIFIER_MODULE

check_incidents() {
  if [ -z "$SESSION_COOKIE" ]; then
    echo "openCriticalIncidents=skipped(no-session-cookie)"
    return 0
  fi

  response="$(curl -fsS -H "Cookie: ${SESSION_COOKIE}" "${APP_URL}/api/incidents?status=open&severity=critical")"
  printf "%s" "$response" | node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8");
    const data = JSON.parse(raw);
    const incidents = Array.isArray(data.incidents) ? data.incidents : [];
    if (incidents.length > 0) {
      console.error(`openCriticalIncidents=${incidents.length}`);
      process.exit(1);
    }
    console.log("openCriticalIncidents=0");
  '
}

consec_uplink_notready=0
consec_dest_notready=0
consec_playout_transient_stale_feed=0
consec_fetch_failed=0

# Outage window state (see OUTAGE_TOLERANCE_SECONDS). An outage starts at the first bad sample and ends
# at the next healthy one.
outage_started_at=""
outage_samples=0
outage_elapsed=0
outage_count=0
outage_seconds_max=0
outage_seconds_total=0

# Called for every bad sample: opens the outage if none is running and measures how long it has lasted.
outage_note_bad_sample() {
  outage_now="$(now_epoch)"
  if [ -z "$outage_started_at" ]; then
    outage_started_at="$outage_now"
    outage_samples=0
  fi
  outage_samples=$((outage_samples + 1))
  outage_elapsed=$((outage_now - outage_started_at))
}

# True while the window may still carry the running outage.
outage_window_open() {
  [ "$OUTAGE_TOLERANCE_SECONDS" -gt 0 ] && [ "$outage_elapsed" -le "$OUTAGE_TOLERANCE_SECONDS" ]
}

# The hard ceiling: a running outage older than the window fails the soak, whatever the per-sample
# rules would say about this particular sample. The start times are read once more first, so a soak that
# a Docker daemon restart ended says so in its log (the verdict is made; the read cannot delay it).
outage_fail_if_exceeded() {
  if [ "$OUTAGE_TOLERANCE_SECONDS" -gt 0 ] && [ "$outage_elapsed" -gt "$OUTAGE_TOLERANCE_SECONDS" ]; then
    check_container_starts
    echo "${NOW} outage-exceeded elapsed=${outage_elapsed}s tolerance=${OUTAGE_TOLERANCE_SECONDS}s samples=${outage_samples} $1" | tee -a "$LOG_FILE"
    exit 1
  fi
}

# Called for every healthy sample: closes a running outage and records how long it took to heal.
outage_note_healthy_sample() {
  if [ -n "$outage_started_at" ]; then
    outage_elapsed=$(( $(now_epoch) - outage_started_at ))
    outage_count=$((outage_count + 1))
    outage_seconds_total=$((outage_seconds_total + outage_elapsed))
    if [ "$outage_elapsed" -gt "$outage_seconds_max" ]; then
      outage_seconds_max="$outage_elapsed"
    fi
    echo "${NOW} outage-recovered duration=${outage_elapsed}s samples=${outage_samples} tolerance=${OUTAGE_TOLERANCE_SECONDS}s" | tee -a "$LOG_FILE"
    outage_started_at=""
    outage_samples=0
    outage_elapsed=0
  fi
}

# One readiness sample, in this shell: sets readiness_line, readiness_rc and readiness_stderr.
sample_readiness() {
  readiness_err_file="$(mktemp 2>/dev/null || printf "/tmp/.soak-readiness-err.%s" "$$")"
  set +e
  readiness_line="$(check_readiness 2> "$readiness_err_file")"
  readiness_rc=$?
  set -e
  readiness_stderr="$(cat "$readiness_err_file" 2>/dev/null || true)"
  rm -f "$readiness_err_file"
}

# --follow-web, after a refused connection: reads web's address again. A Docker daemon restart hands the
# stack's addresses out anew; on 2026-10-18 web came back as .5 and its old .7 went to worker, and a soak
# that kept asking .7 ended outage-exceeded although the channel was on air again 16 s after the restart.
# True when web moved; APP_URL then points at the new address. Never called for CHECK_BASE_URL.
follow_web_address() {
  if ! web_lookup="$(web_container_address)"; then
    readiness_stderr="${readiness_stderr} web-address-lookup-failed: ${web_lookup}"
    return 1
  fi
  new_web_address="${web_lookup%% *}"
  if [ "$new_web_address" = "$WEB_ADDRESS" ]; then
    return 1
  fi
  echo "${NOW} web-address-changed old=${WEB_ADDRESS} new=${new_web_address} network=${web_lookup#* }" | tee -a "$LOG_FILE"
  WEB_ADDRESS="$new_web_address"
  APP_URL="http://${WEB_ADDRESS}:${WEB_PORT}"
}

# The loop runs past the end while an outage is open: a soak that ends mid-outage has not shown the
# stack healed, so it waits for the outcome — recovered, or failed at the window's ceiling.
while [ "$(now_epoch)" -lt "$END_TIME" ] || [ -n "$outage_started_at" ]; do
  NOW="$(date -Iseconds)"

  sample_readiness
  if [ "$readiness_rc" -eq 5 ] && [ "$FOLLOW_WEB" -eq 1 ] && follow_web_address; then
    # The same sample, taken again at web's new address.
    sample_readiness
  fi
  if [ "$readiness_rc" -eq 5 ]; then
    readiness_rc=3
  fi

  if [ "$readiness_rc" -eq 0 ]; then
    # Healthy sample — close a running outage and reset transient counters.
    outage_note_healthy_sample
    check_container_starts
    consec_fetch_failed=0
    consec_uplink_notready=0
    consec_dest_notready=0
  elif [ "$readiness_rc" -eq 2 ]; then
    outage_note_bad_sample
    outage_fail_if_exceeded "${readiness_line}"
    # Transient: uplink and/or destination not-ready, and/or programFeed stale during an
    # active playoutTransient recovery. Increment per-kind counters and only exit when
    # the tolerated count is exceeded.
    exit_now=0
    exceeded_reason=""
    case "$readiness_stderr" in
      *uplink*)
        consec_uplink_notready=$((consec_uplink_notready + 1))
        if [ "$consec_uplink_notready" -gt "$TOLERATE_UPLINK_NOTREADY_SAMPLES" ]; then
          exit_now=1
          exceeded_reason="${exceeded_reason}${exceeded_reason:+, }uplink=not-ready(consecutive=${consec_uplink_notready})"
        fi
        ;;
      *)
        consec_uplink_notready=0
        ;;
    esac
    case "$readiness_stderr" in
      *destination*)
        consec_dest_notready=$((consec_dest_notready + 1))
        if [ "$consec_dest_notready" -gt "$TOLERATE_DEST_NOTREADY_SAMPLES" ]; then
          exit_now=1
          exceeded_reason="${exceeded_reason}${exceeded_reason:+, }destination(consecutive=${consec_dest_notready})"
        fi
        ;;
      *)
        consec_dest_notready=0
        ;;
    esac
    case "$readiness_stderr" in
      *playoutTransientStaleFeed*)
        consec_playout_transient_stale_feed=$((consec_playout_transient_stale_feed + 1))
        if [ "$consec_playout_transient_stale_feed" -gt "$TOLERATE_FEED_STALE_DURING_PLAYOUT_TRANSIENT_SAMPLES" ]; then
          exit_now=1
          exceeded_reason="${exceeded_reason}${exceeded_reason:+, }playoutTransientStaleFeed(consecutive=${consec_playout_transient_stale_feed})"
        fi
        ;;
      *)
        consec_playout_transient_stale_feed=0
        ;;
    esac
    if [ "$exit_now" -eq 1 ]; then
      if outage_window_open; then
        echo "${NOW} outage-tolerated elapsed=${outage_elapsed}s/${OUTAGE_TOLERANCE_SECONDS}s ${exceeded_reason} ${readiness_line}" | tee -a "$LOG_FILE"
        sleep "$INTERVAL"
        continue
      fi
      echo "${NOW} readiness-check-failed-consecutive ${exceeded_reason} ${readiness_line}" | tee -a "$LOG_FILE"
      exit 1
    fi
    # Log the transient sample (kept in log for forensics) and continue.
    echo "${NOW} readiness-transient-tolerated ${readiness_line}" | tee -a "$LOG_FILE"
    sleep "$INTERVAL"
    continue
  elif [ "$readiness_rc" -eq 3 ]; then
    outage_note_bad_sample
    outage_fail_if_exceeded "fetch-failed ${readiness_stderr}"
    consec_fetch_failed=$((consec_fetch_failed + 1))
    if [ "$consec_fetch_failed" -gt "$TOLERATE_FETCH_FAILED_SAMPLES" ]; then
      if outage_window_open; then
        echo "${NOW} outage-tolerated elapsed=${outage_elapsed}s/${OUTAGE_TOLERANCE_SECONDS}s fetch-failed(consecutive=${consec_fetch_failed}) ${readiness_stderr}" | tee -a "$LOG_FILE"
        sleep "$INTERVAL"
        continue
      fi
      echo "${NOW} readiness-fetch-failed-consecutive ${consec_fetch_failed} ${readiness_stderr}" | tee -a "$LOG_FILE"
      exit 1
    fi
    echo "${NOW} readiness-fetch-failed-tolerated ${consec_fetch_failed}/${TOLERATE_FETCH_FAILED_SAMPLES} ${readiness_stderr}" | tee -a "$LOG_FILE"
    sleep "$INTERVAL"
    continue
  elif [ "$readiness_rc" -eq 4 ]; then
    # A fail the outage window may carry — anything but a crash loop or a runaway restart count.
    outage_note_bad_sample
    outage_fail_if_exceeded "${readiness_line}"
    if outage_window_open; then
      echo "${NOW} outage-tolerated elapsed=${outage_elapsed}s/${OUTAGE_TOLERANCE_SECONDS}s ${readiness_line}" | tee -a "$LOG_FILE"
      sleep "$INTERVAL"
      continue
    fi
    echo "${NOW} readiness-check-failed ${readiness_line}" | tee -a "$LOG_FILE"
    exit 1
  else
    echo "${NOW} readiness-check-failed ${readiness_line}" | tee -a "$LOG_FILE"
    exit 1
  fi

  if incidents_line="$(check_incidents 2>&1)"; then
    :
  else
    echo "${NOW} incident-check-failed ${incidents_line}" | tee -a "$LOG_FILE"
    exit 1
  fi

  if check_container_restarts; then
    :
  else
    echo "${NOW} container-restart-check-failed ${container_restart_line}" | tee -a "$LOG_FILE"
    exit 1
  fi

  echo "${NOW} ${readiness_line} ${incidents_line} ${container_restart_line}" | tee -a "$LOG_FILE"
  sleep "$INTERVAL"
done

echo "$(date -Iseconds) soak-monitor-complete outages=${outage_count} outageSecondsMax=${outage_seconds_max} outageSecondsTotal=${outage_seconds_total} dockerRestarts=${docker_restart_count} containersStartedAgain=${containers_started_again_count}" | tee -a "$LOG_FILE"
