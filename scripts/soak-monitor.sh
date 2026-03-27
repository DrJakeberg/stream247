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

check_readiness() {
  response="$(curl -fsS "${APP_URL}/api/system/readiness")"
  printf "%s" "$response" | node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8");
    const data = JSON.parse(raw);
    const issues = [];
    if (!(data.status === "ok" || data.status === "degraded")) {
      issues.push(`readiness.status=${data.status}`);
    }
    if (data.services?.worker === "not-ready") {
      issues.push("worker=not-ready");
    }
    if (data.services?.playout === "not-ready") {
      issues.push("playout=not-ready");
    }
    if (data.playout?.crashLoopDetected) {
      issues.push("playout.crashLoopDetected=true");
    }
    if (issues.length > 0) {
      console.error(issues.join(", "));
      process.exit(1);
    }
    console.log([
      `status=${data.status}`,
      `broadcastReady=${String(data.broadcastReady)}`,
      `worker=${data.services?.worker ?? "unknown"}`,
      `playout=${data.services?.playout ?? "unknown"}`,
      `destination=${data.services?.destination ?? "unknown"}`,
      `reason=${data.playout?.selectionReasonCode ?? ""}`,
      `fallback=${data.playout?.fallbackTier ?? ""}`
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

  echo "${NOW} ${readiness_line} ${incidents_line}" | tee -a "$LOG_FILE"
  sleep "$INTERVAL"
done

echo "$(date -Iseconds) soak-monitor-complete" | tee -a "$LOG_FILE"
