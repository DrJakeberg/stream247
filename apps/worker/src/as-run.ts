// The playout's side of the as-run log (M76): which row a start writes, how an exit completes it, and
// the write queue that keeps both off the playout's critical path. Decided without I/O so the mapping
// is a table test; index.ts only hands in the facts it already logs as playout.process.start/exit.
//
// Why a table at all: every incident analysis on this channel (the boundary storm of 2026-09-04, the
// 19:38 fallback-bridge relapse, the Play now failure of 2026-10-01) began by reconstructing what was on
// air from container logs, which every redeploy throws away.

import type { ChildProcess } from "node:child_process";
import type { AsRunEndReason, AsRunInputKind, AsRunRecord, AsRunTargetKind } from "@stream247/core";

export function asRunTargetKindOf(args: {
  hasAsset: boolean;
  liveBridge: boolean;
  reasonCode: string;
  fallbackTier: string;
  lifecycleStatus: string;
  /** The playout's overrideMode: a Pin and the operator's Fallback both select as operator_override. */
  overrideMode: string;
}): AsRunTargetKind {
  // The same order as the playout's own playoutTargetKind: a live bridge wins over an asset.
  if (args.liveBridge) {
    return "live";
  }
  if (args.hasAsset) {
    if (args.reasonCode === "operator_insert" || args.reasonCode === "scheduled_insert") {
      return "insert";
    }
    // The fallback tiers, including the bridge that covers a failed resolve (playout-recovery.ts): the
    // relapse of 19:38 was a fallback on air where a programme should have been, and the row must say so.
    // The operator's Fallback is one too; only overrideMode tells it from a Pin of the same asset.
    if (
      args.fallbackTier === "global-fallback" ||
      args.fallbackTier === "generic-fallback" ||
      (args.reasonCode === "operator_override" && args.overrideMode === "fallback")
    ) {
      return "fallback";
    }
    return "asset";
  }
  return args.lifecycleStatus === "reconnecting" ? "reconnect" : "standby";
}

/**
 * How the programme reached ffmpeg, from what ffmpeg was actually given. An audio lane replaces a pair's
 * audio track, so such a start opened the video alone and reads "remote".
 */
export function asRunInputKindOf(args: { targetKind: AsRunTargetKind; input: string; audioInput: string }): AsRunInputKind {
  if (args.targetKind === "live") {
    return "live";
  }
  if (args.targetKind === "standby" || args.targetKind === "reconnect" || args.input === "") {
    return "slate";
  }
  if (args.audioInput !== "") {
    return "pair";
  }
  // A cached archive or a library file is a path; everything the resolve hands back remotely is a URL.
  return /^[a-z][a-z0-9+.-]*:/i.test(args.input) && !/^file:/i.test(args.input) ? "remote" : "local";
}

/**
 * The block on air when the run started, and its pool only when the pool's rotation picked the item: a
 * fallback, an insert, a Pin or a Move next, or a graceful handoff from the previous block aired inside
 * the block but was not the pool's pick, and naming the pool there would send an analysis to the wrong
 * rotation. The source alone does not say so: on the DUT nearly every asset comes from the
 * TwitchYoutube pool's sources, so the generic fallback that bridges a failed resolve is usually
 * another item from the pool's own source. scheduled_match is the one selection the rotation makes.
 */
export function asRunScheduleContextOf(args: {
  blockId: string;
  blockPoolId: string;
  poolSourceIds: readonly string[];
  assetSourceId: string;
  reasonCode: string;
}): { blockId: string; poolId: string } {
  const poolPick =
    args.reasonCode === "scheduled_match" && args.assetSourceId !== "" && args.poolSourceIds.includes(args.assetSourceId);
  return { blockId: args.blockId, poolId: args.blockPoolId && poolPick ? args.blockPoolId : "" };
}

/**
 * The playout stops for "restart-requested" whenever the web asked for a restart, and the web asks for
 * one for very different things: a Restart, a Skip (operator or chat vote), a Pin, a Play now, a
 * fallback. Decided where the stop is made, from the running item and the item the request selected.
 */
export type AsRunStopIntent = "" | "skip" | "switch" | "operator-restart";

export function asRunRestartIntentOf(args: {
  runningAssetId: string;
  skipAssetId: string;
  /** What the cycle starts next; "" for a slate. */
  nextAssetId: string;
  /**
   * Without the relay every restart request puts the reconnect slate on air first
   * (shouldShowReconnectSlate), in place of what the selection had picked: a Restart's own item, a Pin's,
   * the Fallback's. This is that pick, "" when no slate came first. Read from the slate instead, every
   * Restart, Hard reload, Recover outputs and Force reconnect of direct mode was recorded as a switch.
   */
  selectedBeforeSlateAssetId: string;
}): AsRunStopIntent {
  if (args.runningAssetId !== "" && args.runningAssetId === args.skipAssetId) {
    return "skip";
  }
  const requestedAssetId = args.selectedBeforeSlateAssetId || args.nextAssetId;
  return requestedAssetId !== args.runningAssetId ? "switch" : "operator-restart";
}

/**
 * A Skip normally reaches the playout as a restart request (above). Until M89 its flag could be lost: a
 * cycle already in flight ended with a write that cleared restartRequestedAt, and a cycle can run for up
 * to a minute (the queue scan awaits one remote resolve). The skip hold still took the item out of the
 * selection, so the next cycle moved off it as a plain switch, and the row read `switch` for an
 * operator's Skip (Skip ending a Pin included) or an applied chat vote (combination review). The cycle's
 * writes now clear only the flag they read (decideCycleEndRestartFlag); this stays for any switch that
 * reaches a skipped item without the flag. The item a switch stops while an active skip hold names it was
 * skipped; a Remove next hold (its own field since M89) names an item that is not on air.
 */
export function asRunSwitchIntentOf(args: { runningAssetId: string; skipAssetId: string }): AsRunStopIntent {
  return args.runningAssetId !== "" && args.runningAssetId === args.skipAssetId ? "skip" : "";
}

/** The planned stop reasons index.ts passes to stopPlayoutProcess, and what each means for the run. */
const PLANNED_END_REASONS: Record<string, AsRunEndReason> = {
  switch: "switch",
  "duration-bound": "duration-bound",
  "feed-stalled": "feed-watchdog",
  "feed-audio-stalled": "feed-watchdog",
  "scheduled-reconnect": "scheduled-reconnect",
  "crash-loop-reset": "crash-loop-reset",
  "destination-missing": "destination-missing"
};

export function asRunEndReasonOf(args: {
  plannedReason: string;
  stopIntent: AsRunStopIntent;
  naturalBoundary: boolean;
  exitedCleanly: boolean;
}): AsRunEndReason {
  if (args.plannedReason === "") {
    // Nobody asked it to stop: EOF of an item, a slate or live input that ended on its own, or a failure.
    return args.naturalBoundary ? "natural-end" : args.exitedCleanly ? "stopped" : "failed";
  }
  if (args.plannedReason === "restart-requested") {
    return args.stopIntent || "operator-restart";
  }
  // A switch that takes a skipped item off air (asRunSwitchIntentOf); every other switch is a switch.
  if (args.plannedReason === "switch" && args.stopIntent === "skip") {
    return "skip";
  }
  // A stop reason added later without a mapping still reads as a deliberate stop, never as a failure.
  return PLANNED_END_REASONS[args.plannedReason] ?? "stopped";
}

export function buildAsRunStartRecord(args: {
  id: string;
  startedAtMs: number;
  targetKind: AsRunTargetKind;
  asset: { id: string; sourceId: string; durationSeconds?: number } | null;
  title: string;
  blockId: string;
  poolId: string;
  reasonCode: string;
  queueKind: string;
  input: string;
  audioInput: string;
  formatId: string;
  formatCandidate: string;
}): AsRunRecord {
  const duration = Number(args.asset?.durationSeconds ?? 0);
  return {
    id: args.id,
    startedAt: new Date(args.startedAtMs).toISOString(),
    endedAt: "",
    targetKind: args.targetKind,
    assetId: args.asset?.id ?? "",
    title: args.title,
    sourceId: args.asset?.sourceId ?? "",
    poolId: args.poolId,
    blockId: args.blockId,
    reasonCode: args.reasonCode,
    queueKind: args.queueKind,
    inputKind: asRunInputKindOf({ targetKind: args.targetKind, input: args.input, audioInput: args.audioInput }),
    formatId: args.formatId,
    formatCandidate: args.formatCandidate,
    plannedSeconds: args.asset && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
    airedSeconds: 0,
    endReason: "",
    exitCode: ""
  };
}

export type AsRunEnd = Pick<AsRunRecord, "endedAt" | "airedSeconds" | "endReason" | "exitCode">;

/**
 * The exit facts as one completion. `startedAtMs` and `exitedAtMs` are the instants the exit handler's
 * ranForMs is the difference of, so a row's aired seconds and the playout.process.exit line agree to the
 * rounding (the DUT check after deploy compares them).
 */
export function buildAsRunEnd(args: {
  startedAtMs: number;
  exitedAtMs: number;
  plannedReason: string;
  stopIntent: AsRunStopIntent;
  naturalBoundary: boolean;
  exitCode: number | null;
  exitSignal: string | null;
}): AsRunEnd {
  return {
    endedAt: new Date(args.exitedAtMs).toISOString(),
    airedSeconds: Math.max(0, Math.round((args.exitedAtMs - args.startedAtMs) / 1000)),
    endReason: asRunEndReasonOf({
      plannedReason: args.plannedReason,
      stopIntent: args.stopIntent,
      naturalBoundary: args.naturalBoundary,
      exitedCleanly: args.exitCode === 0 && !args.exitSignal
    }),
    exitCode: String(args.exitCode ?? args.exitSignal ?? "")
  };
}

/**
 * A spawn that failed (ENOENT, EAGAIN, EACCES) never ran: nothing aired, and the error code stands where
 * an exit code would, so the row reads "Failed (exit ENOENT)".
 */
export function buildAsRunSpawnFailedEnd(args: { failedAtMs: number; errorCode: string }): AsRunEnd {
  return {
    endedAt: new Date(args.failedAtMs).toISOString(),
    airedSeconds: 0,
    endReason: "failed",
    exitCode: args.errorCode || "spawn"
  };
}

export type AsRunExitContext = { plannedReason: string; stopIntent: AsRunStopIntent; naturalBoundary: boolean };

/**
 * Completes the run's row from the child's own events, attached right after the spawn. ffmpeg's main
 * exit handler in index.ts is attached only after the start's runtime, incident and destination writes
 * have been awaited: an ffmpeg that dies during them emits "exit" with nobody listening, and a spawn that
 * fails emits "error" and never "exit" (Node's ChildProcess, checked with a missing binary). Completed
 * from that handler, both rows stayed "On air" until the next start closed them as process-gone, with
 * the time until that start as aired seconds instead of a failure. `exitedAtMs()` is the instant the row
 * ends at (0 before), which the exit handler's ranForMs measures to, so the two still agree.
 */
export function watchAsRunEnd(
  child: Pick<ChildProcess, "pid" | "on">,
  args: {
    log: AsRunLog;
    id: string;
    startedAtMs: number;
    /** Read when the exit is seen: the planned stop reason, the restart intent, a natural boundary. */
    exitContext: (code: number | null, signal: NodeJS.Signals | null) => AsRunExitContext;
    now?: () => number;
  }
): { exitedAtMs: () => number } {
  const now = args.now ?? Date.now;
  let exitedAtMs = 0;
  child.on("exit", (code, signal) => {
    const atMs = now();
    exitedAtMs = atMs;
    // Built inside the queue's try: a throwing context is logged, never thrown into the exit.
    args.log.end(args.id, () =>
      buildAsRunEnd({
        startedAtMs: args.startedAtMs,
        exitedAtMs: atMs,
        ...args.exitContext(code, signal),
        exitCode: code,
        exitSignal: signal
      })
    );
  });
  child.on("error", (error: NodeJS.ErrnoException) => {
    // A failed kill() lands here too, and that process may still be on air; only a spawn that failed
    // leaves the child without a pid.
    if (child.pid !== undefined || exitedAtMs !== 0) {
      return;
    }
    const atMs = now();
    exitedAtMs = atMs;
    args.log.end(args.id, () => buildAsRunSpawnFailedEnd({ failedAtMs: atMs, errorCode: String(error?.code ?? "") }));
  });
  return { exitedAtMs: () => exitedAtMs };
}

export type AsRunStore = {
  /** Closes every row still open at `record.startedAt` as process-gone, inserts the row, prunes old rows. */
  start: (record: AsRunRecord) => Promise<unknown>;
  /** Completes the row unless something already closed it. */
  end: (id: string, end: AsRunEnd) => Promise<unknown>;
  /** Closes every open row as process-gone at `endedAtIso`. */
  closeOpen: (endedAtIso: string) => Promise<unknown>;
};

export type AsRunLog = {
  /** The playout process came up: whatever a previous process left on air is gone. */
  boot: (bootIso: string) => void;
  /** Queues the start row; returns the id the exit completes, or "" when the row could not be built. */
  start: (build: () => AsRunRecord) => string;
  end: (id: string, build: () => AsRunEnd) => void;
  /** Resolves when every queued write has been tried. Tests only; the playout never waits for it. */
  settled: () => Promise<void>;
};

/**
 * Best-effort, ordered, and never in the playout's way. Every write goes onto one promise chain: the
 * caller does not await it, so a slow or unreachable database adds nothing to a switch, and the chain
 * keeps a process that dies within milliseconds from completing its row before the row exists. A failed
 * write is logged as as_run.write_failed and the chain goes on; nothing here throws to the caller, which
 * is the playout cycle or ffmpeg's exit handler.
 */
export function createAsRunLog(store: AsRunStore, log: (event: string, fields: Record<string, unknown>) => void): AsRunLog {
  let chain: Promise<void> = Promise.resolve();
  const fail = (write: string, error: unknown, id = "") => {
    try {
      log("as_run.write_failed", { write, id, error: error instanceof Error ? error.message : String(error) });
    } catch {
      // A logger that throws must not take the playout with it either.
    }
  };
  const enqueue = (write: string, id: string, run: () => Promise<unknown>) => {
    chain = chain.then(run).then(
      () => undefined,
      (error: unknown) => fail(write, error, id)
    );
  };

  return {
    boot(bootIso) {
      enqueue("boot", "", () => store.closeOpen(bootIso));
    },
    start(build) {
      let record: AsRunRecord;
      try {
        record = build();
      } catch (error) {
        fail("start", error);
        return "";
      }
      enqueue("start", record.id, () => store.start(record));
      return record.id;
    },
    end(id, build) {
      if (!id) {
        return;
      }
      let end: AsRunEnd;
      try {
        end = build();
      } catch (error) {
        fail("end", error, id);
        return;
      }
      enqueue("end", id, () => store.end(id, end));
    },
    settled() {
      return chain;
    }
  };
}
