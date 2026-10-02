// The as-run log (M76): one row per playout process run -- what aired, how it was fed, why it ended.
//
// Every incident analysis on this channel began by reconstructing "what was on air at 19:38" from
// container logs: the boundary storm of 2026-09-04, the 19:38 fallback-bridge relapse, the Play now
// failure of 2026-10-01. Those logs are gone after every redeploy, and the only structured traces were
// the playout.process.start/exit log lines and the playout_runtime singleton, which holds the present
// and nothing before it. The playout writes this table (apps/worker/src/as-run.ts); the Live status tab
// and GET /api/as-run read it. This module is the shared vocabulary and the read-side rules.

/** What the process put on air; the playout's own target kinds plus "fallback" for a fallback tier or the operator's Fallback. */
export type AsRunTargetKind = "asset" | "insert" | "fallback" | "live" | "standby" | "reconnect";

/** How the programme reached ffmpeg. "pair" is a separate video and audio input (YouTube since 2.1). */
export type AsRunInputKind = "local" | "remote" | "pair" | "live" | "slate";

/** Why the run ended; "" while it is on air. */
export type AsRunEndReason =
  | ""
  | "natural-end"
  | "duration-bound"
  | "switch"
  | "skip"
  | "operator-restart"
  | "feed-watchdog"
  | "scheduled-reconnect"
  | "crash-loop-reset"
  | "destination-missing"
  | "stopped"
  | "failed"
  | "process-gone";

export type AsRunRecord = {
  id: string;
  /** ISO, UTC: the moment the playout spawned the process (the start time playout.process.exit measures from). */
  startedAt: string;
  /** ISO, UTC; "" while the run is on air. */
  endedAt: string;
  targetKind: AsRunTargetKind;
  assetId: string;
  /** The title as the runtime showed it on air, so a renamed or deleted asset still reads as it aired. */
  title: string;
  sourceId: string;
  /** The block's pool, only when the pool's rotation picked the item (scheduled_match from its sources). */
  poolId: string;
  /** The schedule block on air when the run started, "" outside any block. */
  blockId: string;
  /** The playout's selectionReasonCode (scheduled_match, global_fallback, operator_insert, ...). */
  reasonCode: string;
  queueKind: string;
  inputKind: AsRunInputKind;
  formatId: string;
  formatCandidate: string;
  /** The item's known duration in whole seconds, 0 when unknown (a slate, a live input, an unprobed item). */
  plannedSeconds: number;
  /** Whole seconds between start and end, 0 while on air. For "process-gone" an upper bound. */
  airedSeconds: number;
  endReason: AsRunEndReason;
  /** The exit code or the signal, "" while on air and for a process nobody saw exit. */
  exitCode: string;
};

/**
 * How long the as-run log keeps a row. A constant, not a setting: 90 days covers a release cycle with
 * its soak and lets one weekday be compared with the same weekday months back, and at a few hundred
 * starts a day (the storm days included) that is tens of thousands of rows of about 300 bytes. Rows
 * older than this are deleted in the same write that adds a start, the way audit_events is pruned in
 * the write that appends to it.
 */
export const AS_RUN_RETENTION_DAYS = 90;

/** The window a read without `from` covers, back from `to`. */
export const AS_RUN_DEFAULT_WINDOW_HOURS = 24;

/** Rows a read returns without `limit`, and the hard cap on what `limit` may ask for. */
export const AS_RUN_DEFAULT_LIMIT = 200;
export const AS_RUN_MAX_LIMIT = 1000;

export type AsRunWindow = {
  fromIso: string;
  toIso: string;
  limit: number;
};

/**
 * The read window from the API's query parameters: ISO timestamps, `to` defaulting to now and `from` to
 * 24 hours before `to`, `limit` capped at AS_RUN_MAX_LIMIT. A read returns the runs that OVERLAP the
 * window (started before its end, ended after its start or still on air), so `from = to = 19:38` is the
 * question this table exists for: what was on air at 19:38.
 */
export function resolveAsRunWindow(args: {
  from?: string | null;
  to?: string | null;
  limit?: string | null;
  nowMs: number;
}): { ok: true; window: AsRunWindow } | { ok: false; message: string } {
  // new Date() of a number outside the Date range is Invalid Date, which toISOString would throw on.
  const representable = (ms: number) => Number.isFinite(new Date(ms).getTime());
  const toMs = args.to ? Date.parse(args.to) : args.nowMs;
  if (!representable(toMs)) {
    return { ok: false, message: "to must be an ISO timestamp." };
  }
  const fromMs = args.from ? Date.parse(args.from) : toMs - AS_RUN_DEFAULT_WINDOW_HOURS * 3_600_000;
  if (!representable(fromMs)) {
    return { ok: false, message: "from must be an ISO timestamp." };
  }
  if (fromMs > toMs) {
    return { ok: false, message: "from must not be later than to." };
  }
  const requestedLimit = args.limit ? Number(args.limit) : AS_RUN_DEFAULT_LIMIT;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    return { ok: false, message: "limit must be a positive whole number." };
  }
  return {
    ok: true,
    window: {
      fromIso: new Date(fromMs).toISOString(),
      toIso: new Date(toMs).toISOString(),
      limit: Math.min(requestedLimit, AS_RUN_MAX_LIMIT)
    }
  };
}

const AS_RUN_TARGET_LABELS: Record<AsRunTargetKind, string> = {
  asset: "Programme",
  insert: "Insert",
  fallback: "Fallback",
  live: "Live bridge",
  standby: "Standby slate",
  reconnect: "Reconnect slate"
};

const AS_RUN_INPUT_LABELS: Record<AsRunInputKind, string> = {
  local: "Local file",
  remote: "Remote stream",
  pair: "Video+audio pair",
  live: "Live input",
  slate: "Generated slate"
};

const AS_RUN_END_LABELS: Record<Exclude<AsRunEndReason, "">, string> = {
  "natural-end": "Natural end",
  "duration-bound": "Duration bound",
  switch: "Switched",
  skip: "Skipped",
  "operator-restart": "Restarted",
  "feed-watchdog": "Feed watchdog",
  "scheduled-reconnect": "Scheduled reconnect",
  "crash-loop-reset": "Crash-loop reset",
  "destination-missing": "No destination",
  stopped: "Stopped cleanly",
  failed: "Failed",
  "process-gone": "Process gone"
};

export function describeAsRunTargetKind(kind: string): string {
  return AS_RUN_TARGET_LABELS[kind as AsRunTargetKind] ?? kind;
}

export function describeAsRunInputKind(kind: string): string {
  return AS_RUN_INPUT_LABELS[kind as AsRunInputKind] ?? kind;
}

/** "Failed (exit 8)"; a still-open run reads "On air". */
export function describeAsRunEndReason(reason: string, exitCode = ""): string {
  if (reason === "") {
    return "On air";
  }
  const label = AS_RUN_END_LABELS[reason as Exclude<AsRunEndReason, "">] ?? reason;
  return reason === "failed" && exitCode ? `${label} (exit ${exitCode})` : label;
}

/** "1:02:03" or "4:05"; whole seconds, nothing negative. */
export function formatAsRunSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

function formatAsRunUtc(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? `${new Date(ms).toISOString().slice(0, 19).replace("T", " ")} UTC` : "";
}

// The schedule speaks the channel's time zone, so "what was on at 19:38" is usually asked in it; the
// UTC column is what the container logs and the database say.
function formatAsRunChannelTime(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !timeZone || timeZone === "UTC") {
    return "";
  }
  try {
    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).format(new Date(ms));
    return `${clock} ${timeZone}`;
  } catch {
    return "";
  }
}

export type AsRunRowView = {
  id: string;
  start: string;
  startChannel: string;
  end: string;
  endChannel: string;
  title: string;
  kind: string;
  /** Source, pool and block by name, the parts that are known. */
  origin: string;
  /** Input kind, then the format and its candidate when the resolve chose one. */
  input: string;
  ended: string;
  timing: string;
};

/** One table row of the console's as-run view; names come from the caller's state, ids stand in for gone ones. */
export function buildAsRunRowView(
  record: AsRunRecord,
  context: {
    nowMs: number;
    timeZone: string;
    sourceName: (id: string) => string;
    poolName: (id: string) => string;
    blockTitle: (id: string) => string;
  }
): AsRunRowView {
  const onAir = record.endedAt === "";
  const origin = [
    record.sourceId ? context.sourceName(record.sourceId) || record.sourceId : "",
    record.poolId ? `pool ${context.poolName(record.poolId) || record.poolId}` : "",
    record.blockId ? `block ${context.blockTitle(record.blockId) || record.blockId}` : ""
  ].filter(Boolean);
  const format = record.formatId
    ? ` · ${record.formatId}${record.formatCandidate ? ` (${record.formatCandidate})` : ""}`
    : "";
  const aired = onAir ? Math.max(0, (context.nowMs - Date.parse(record.startedAt)) / 1000) : record.airedSeconds;
  const airedText = Number.isFinite(aired) ? `aired ${formatAsRunSeconds(aired)}${onAir ? " so far" : ""}` : "";
  return {
    id: record.id,
    start: formatAsRunUtc(record.startedAt),
    startChannel: formatAsRunChannelTime(record.startedAt, context.timeZone),
    end: onAir ? "On air" : formatAsRunUtc(record.endedAt),
    endChannel: onAir ? "" : formatAsRunChannelTime(record.endedAt, context.timeZone),
    title: record.title || record.assetId || describeAsRunTargetKind(record.targetKind),
    kind: describeAsRunTargetKind(record.targetKind),
    origin: origin.join(" · "),
    input: `${describeAsRunInputKind(record.inputKind)}${format}`,
    ended: describeAsRunEndReason(record.endReason, record.exitCode),
    timing: [record.plannedSeconds > 0 ? `planned ${formatAsRunSeconds(record.plannedSeconds)}` : "", airedText]
      .filter(Boolean)
      .join(" · ")
  };
}
