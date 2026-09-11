#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

HOURS=24
INTERVAL=60

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
    *)
      echo "Usage: scripts/soak-monitor.sh [--hours 24] [--interval-seconds 60]"
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

if [ -z "${CHECK_BASE_URL:-}" ] && [ ! -f ".env" ]; then
  echo "Missing .env. Copy .env.example first, or set CHECK_BASE_URL to the public base URL."
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

CHECK_BASE_URL="${CHECK_BASE_URL:-}"
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

container_restart_count() {
  service="$1"
  if [ "$CONTAINER_RESTART_MONITORING" -ne 1 ]; then
    printf "unknown"
    return 0
  fi

  container_id="$(docker compose ps -q "$service" 2>/dev/null | head -n 1 || true)"
  if [ -z "$container_id" ]; then
    printf "unknown"
    return 0
  fi

  count="$(docker inspect --format '{{.RestartCount}}' "$container_id" 2>/dev/null || true)"
  case "$count" in
    ''|*[!0-9]*)
      printf "unknown"
      ;;
    *)
      printf "%s" "$count"
      ;;
  esac
}

collect_container_restart_counts() {
  printf "web=%s worker=%s playout=%s" \
    "$(container_restart_count web)" \
    "$(container_restart_count worker)" \
    "$(container_restart_count playout)"
}

restart_count_for_service() {
  service="$1"
  counts="$2"
  printf "%s\n" "$counts" | tr ' ' '\n' | sed -n "s/^${service}=//p" | tail -n 1
}

BASELINE_CONTAINER_RESTART_COUNTS="$(collect_container_restart_counts)"
export BASELINE_CONTAINER_RESTART_COUNTS
echo "Baseline container restarts: ${BASELINE_CONTAINER_RESTART_COUNTS}" | tee -a "$LOG_FILE"

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

check_container_restarts() {
  current_counts="$(collect_container_restart_counts)"
  issues=""

  for service in web worker playout; do
    baseline_count="$(restart_count_for_service "$service" "$BASELINE_CONTAINER_RESTART_COUNTS")"
    current_count="$(restart_count_for_service "$service" "$current_counts")"
    case "${baseline_count}:${current_count}" in
      *[!0-9:]*|:*|*:)
        continue
        ;;
    esac
    delta=$((current_count - baseline_count))
    if [ "$delta" -gt 0 ]; then
      issues="${issues}${issues:+, }${service}Restarts=${current_count}(+${delta})"
    fi
  done

  if [ -n "$issues" ]; then
    echo "$issues" >&2
    return 1
  fi

  echo "containerRestarts=${current_counts}"
}

CLASSIFIER_MODULE="${ROOT_DIR}/scripts/lib/soak-readiness-classifier.cjs"

# check_readiness exits 0 (ok), 1 (hard fail — exit soak now, no window carries it), 2 (transient —
# caller tracks consecutive count per kind on stderr), 3 (the fetch itself failed) or 4 (fail the
# outage window may carry). Always writes the log-friendly line on stdout.
check_readiness() {
  if ! response="$(curl -fsS "${APP_URL}/api/system/readiness" 2>&1)"; then
    printf "fetch-failed: %s\n" "$(printf "%s" "$response" | head -n 1)" >&2
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
# rules would say about this particular sample.
outage_fail_if_exceeded() {
  if [ "$OUTAGE_TOLERANCE_SECONDS" -gt 0 ] && [ "$outage_elapsed" -gt "$OUTAGE_TOLERANCE_SECONDS" ]; then
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

# The loop runs past the end while an outage is open: a soak that ends mid-outage has not shown the
# stack healed, so it waits for the outcome — recovered, or failed at the window's ceiling.
while [ "$(now_epoch)" -lt "$END_TIME" ] || [ -n "$outage_started_at" ]; do
  NOW="$(date -Iseconds)"

  readiness_err_file="$(mktemp 2>/dev/null || printf "/tmp/.soak-readiness-err.%s" "$$")"
  set +e
  readiness_line="$(check_readiness 2> "$readiness_err_file")"
  readiness_rc=$?
  set -e
  readiness_stderr="$(cat "$readiness_err_file" 2>/dev/null || true)"
  rm -f "$readiness_err_file"

  if [ "$readiness_rc" -eq 0 ]; then
    # Healthy sample — close a running outage and reset transient counters.
    outage_note_healthy_sample
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

  if container_restart_line="$(check_container_restarts 2>&1)"; then
    :
  else
    echo "${NOW} container-restart-check-failed ${container_restart_line}" | tee -a "$LOG_FILE"
    exit 1
  fi

  echo "${NOW} ${readiness_line} ${incidents_line} ${container_restart_line}" | tee -a "$LOG_FILE"
  sleep "$INTERVAL"
done

echo "$(date -Iseconds) soak-monitor-complete outages=${outage_count} outageSecondsMax=${outage_seconds_max} outageSecondsTotal=${outage_seconds_total}" | tee -a "$LOG_FILE"
