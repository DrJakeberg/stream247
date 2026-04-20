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

if [ ! -f ".env" ]; then
  echo "Missing .env. Copy .env.example first."
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
    if [ "$delta" -gt 1 ]; then
      issues="${issues}${issues:+, }${service}Restarts=${current_count}(+${delta})"
    fi
  done

  if [ -n "$issues" ]; then
    echo "$issues" >&2
    return 1
  fi

  echo "containerRestarts=${current_counts}"
}

check_readiness() {
  response="$(curl -fsS "${APP_URL}/api/system/readiness")"
  printf "%s" "$response" | node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8");
    const data = JSON.parse(raw);
    const issues = [];
    const playoutDetails = [
      `playoutStatus=${data.playout?.status ?? "unknown"}`,
      `lastExitCode=${data.playout?.lastExitCode ?? ""}`,
      `restartCount=${data.playout?.restartCount ?? "unknown"}`,
      `crashCountWindow=${data.playout?.crashCountWindow ?? "unknown"}`,
      `currentAsset=${data.playout?.currentAssetId ?? ""}`,
      `uplinkStatus=${data.uplink?.status ?? "unknown"}`,
      `uplinkUnplannedRestarts=${data.uplink?.unplannedRestartCount ?? "unknown"}`,
      `programFeed=${data.programFeed?.status ?? "unknown"}`
    ];
    const baselineUplinkUnplannedRestarts = Number(process.env.BASELINE_UPLINK_UNPLANNED_RESTARTS ?? "0");
    const currentUplinkUnplannedRestarts = Number(data.uplink?.unplannedRestartCount ?? 0);
    const programFeedFresh = data.services?.programFeed === "ok" && data.programFeed?.status === "fresh";
    const uplinkHealthy = data.services?.uplink === "ok" && data.uplink?.status === "running";
    const destinationOk = data.services?.destination === "ok";
    const playoutTransient =
      data.playout?.transient === true ||
      (data.services?.playout === "not-ready" &&
        data.playout?.status === "failed" &&
        !data.playout?.crashLoopDetected &&
        programFeedFresh &&
        uplinkHealthy &&
        destinationOk);
    playoutDetails.push(`playoutTransient=${String(playoutTransient)}`);
    if (!(data.status === "ok" || data.status === "degraded")) {
      issues.push(`readiness.status=${data.status}`);
    }
    if (data.broadcastReady !== true && !playoutTransient) {
      issues.push(`broadcastReady=${String(data.broadcastReady)}`);
    }
    if (data.services?.worker === "not-ready") {
      issues.push("worker=not-ready");
    }
    if (data.services?.playout === "not-ready" && !playoutTransient) {
      issues.push("playout=not-ready");
    }
    if (data.services?.uplink === "not-ready") {
      issues.push("uplink=not-ready");
    }
    if (data.services?.programFeed === "not-ready") {
      issues.push("programFeed=not-ready");
    }
    if ((data.services?.destination ?? "unknown") !== "ok") {
      issues.push(`destination=${data.services?.destination ?? "unknown"}`);
    }
    if (data.playout?.crashLoopDetected) {
      issues.push("playout.crashLoopDetected=true");
    }
    if (data.programFeed?.status === "stale" || data.programFeed?.status === "failed") {
      issues.push(`programFeed=${data.programFeed.status}`);
    }
    if (data.uplink?.status === "failed") {
      issues.push("uplink=failed");
    }
    if (currentUplinkUnplannedRestarts > baselineUplinkUnplannedRestarts) {
      issues.push(`uplinkUnplannedRestarts=${currentUplinkUnplannedRestarts}`);
    }
    if (issues.length > 0) {
      console.error([...issues, ...playoutDetails].join(", "));
      process.exit(1);
    }
    console.log([
      `status=${data.status}`,
      `broadcastReady=${String(data.broadcastReady)}`,
      `worker=${data.services?.worker ?? "unknown"}`,
      `playout=${data.services?.playout ?? "unknown"}`,
      `uplink=${data.services?.uplink ?? "unknown"}`,
      `programFeed=${data.services?.programFeed ?? "unknown"}`,
      `destination=${data.services?.destination ?? "unknown"}`,
      `reason=${data.playout?.selectionReasonCode ?? ""}`,
      `fallback=${data.playout?.fallbackTier ?? ""}`,
      `sseConnections=${data.sseConnections ?? "unknown"}`,
      ...playoutDetails
    ].join(" "));
  '
}

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

while [ "$(date +%s)" -lt "$END_TIME" ]; do
  NOW="$(date -Iseconds)"
  if readiness_line="$(check_readiness 2>&1)"; then
    :
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
