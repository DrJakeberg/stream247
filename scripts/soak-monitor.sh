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
export SOAK_UPLINK_RESTART_RUNAWAY_DELTA

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
END_TIME=$(( $(date +%s) + TOTAL_SECONDS ))

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

# check_readiness exits 0 (ok), 1 (fatal — exit soak now), or 2 (transient — caller
# tracks consecutive count per kind on stderr). Always writes the log-friendly line
# on stdout.
check_readiness() {
  response="$(curl -fsS "${APP_URL}/api/system/readiness")"
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
    process.stdout.write(result.line + "\n");
    if (result.kind === "ok") {
      process.exit(0);
    }
    if (result.kind === "transient") {
      process.stderr.write("transient:" + result.transientKinds.join(",") + "\n");
      process.exit(2);
    }
    process.exit(1);
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

while [ "$(date +%s)" -lt "$END_TIME" ]; do
  NOW="$(date -Iseconds)"

  readiness_err_file="$(mktemp 2>/dev/null || printf "/tmp/.soak-readiness-err.%s" "$$")"
  set +e
  readiness_line="$(check_readiness 2> "$readiness_err_file")"
  readiness_rc=$?
  set -e
  readiness_stderr="$(cat "$readiness_err_file" 2>/dev/null || true)"
  rm -f "$readiness_err_file"

  if [ "$readiness_rc" -eq 0 ]; then
    # Healthy sample — reset transient counters.
    consec_uplink_notready=0
    consec_dest_notready=0
  elif [ "$readiness_rc" -eq 2 ]; then
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
      echo "${NOW} readiness-check-failed-consecutive ${exceeded_reason} ${readiness_line}" | tee -a "$LOG_FILE"
      exit 1
    fi
    # Log the transient sample (kept in log for forensics) and continue.
    echo "${NOW} readiness-transient-tolerated ${readiness_line}" | tee -a "$LOG_FILE"
    sleep "$INTERVAL"
    continue
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

echo "$(date -Iseconds) soak-monitor-complete" | tee -a "$LOG_FILE"
