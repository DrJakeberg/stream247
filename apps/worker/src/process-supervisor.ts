// A frozen process restarts (M114, owner's choice A).
//
// Since M103 a worker, playout or uplink process exits after failing its own healthcheck for five
// minutes, but only while its event loop still runs: a process with a blocked event loop, or one that
// was stopped (SIGSTOP), never reaches that check, and Compose does not restart an "unhealthy"
// container. So the container's command is now a small supervisor that runs the real process as its
// child. The child sends a heartbeat over the IPC channel from a timer on its own event loop; when
// none has arrived for `FROZEN_AFTER_MS`, the supervisor kills the child with SIGKILL (which a stopped
// process cannot ignore either), writes a marker for the next process and exits, so the restart
// policy (`unless-stopped`) starts the container again. No Docker socket and no new dependency.
//
// What this does not cover: `docker pause` freezes the supervisor as well, and the relay image has
// nothing to run a supervisor with (the relay watch in relay-watch.ts reports it instead).

import { fork, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** No heartbeat for this long and the child counts as frozen: the M103 self-restart bound. */
export const FROZEN_AFTER_MS = 5 * 60_000;
/** How often the child sends its heartbeat. */
export const SUPERVISOR_HEARTBEAT_INTERVAL_MS = 10_000;
/** How often the supervisor looks at the last heartbeat. */
export const SUPERVISOR_CHECK_INTERVAL_MS = 5_000;
/** Set in the child's environment, so it knows a supervisor listens. */
export const SUPERVISED_ENV = "STREAM247_SUPERVISED";
export const SUPERVISOR_HEARTBEAT_MESSAGE = "stream247.heartbeat";

export type FrozenVerdict = { frozen: boolean; silentForMs: number };

/**
 * Tracks the child's heartbeats. The start counts as the first one, so a child that never sends one
 * (it hangs while loading) is frozen after the same bound.
 */
export class FrozenChildWatch {
  private lastBeatMs: number;

  constructor(
    startedAtMs: number,
    private readonly frozenAfterMs: number = FROZEN_AFTER_MS
  ) {
    this.lastBeatMs = startedAtMs;
  }

  beat(nowMs: number): void {
    this.lastBeatMs = Math.max(this.lastBeatMs, nowMs);
  }

  check(nowMs: number): FrozenVerdict {
    const silentForMs = Math.max(0, nowMs - this.lastBeatMs);
    return { frozen: silentForMs >= this.frozenAfterMs, silentForMs };
  }
}

/** The supervisor's exit code for a child that ended by itself: its own code, or 128 + the signal. */
export function exitCodeForChild(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) {
    return code;
  }
  const signals: Partial<Record<NodeJS.Signals, number>> = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };
  return signal && signals[signal] ? 128 + (signals[signal] as number) : 1;
}

export type FrozenRestartMarker = { mode: string; silentForMs: number; killedAt: string };

/**
 * Where the supervisor leaves a note for the next process. `docker restart` and the restart policy
 * keep the container's filesystem, so the next process finds it and can raise the incident; the
 * supervisor itself has no database connection.
 */
export function frozenMarkerPath(mode: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.STREAM247_SUPERVISOR_MARKER_DIR || tmpdir(), `stream247-frozen-${mode}.json`);
}

export function writeFrozenMarker(markerPath: string, marker: FrozenRestartMarker): void {
  try {
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, JSON.stringify(marker));
  } catch {
    // Best-effort: the restart matters more than the note about it.
  }
}

/** Reads and removes the marker; null when there is none or it does not read. */
export function takeFrozenMarker(markerPath: string): FrozenRestartMarker | null {
  let raw: string;
  try {
    raw = readFileSync(markerPath, "utf8");
  } catch {
    return null;
  }
  rmSync(markerPath, { force: true });
  try {
    const parsed = JSON.parse(raw) as Partial<FrozenRestartMarker>;
    if (typeof parsed.mode !== "string" || typeof parsed.silentForMs !== "number" || typeof parsed.killedAt !== "string") {
      return null;
    }
    return { mode: parsed.mode, silentForMs: parsed.silentForMs, killedAt: parsed.killedAt };
  } catch {
    return null;
  }
}

/**
 * The child's side: send a heartbeat while a supervisor listens. The timer runs on the event loop
 * it vouches for, so a blocked loop or a stopped process stops the heartbeats. Unref'd: it never
 * keeps a finished process alive.
 */
export function startSupervisorHeartbeat(
  env: NodeJS.ProcessEnv = process.env,
  intervalMs: number = SUPERVISOR_HEARTBEAT_INTERVAL_MS
): NodeJS.Timeout | null {
  if (env[SUPERVISED_ENV] !== "1" || typeof process.send !== "function") {
    return null;
  }
  const send = () => {
    try {
      process.send?.(SUPERVISOR_HEARTBEAT_MESSAGE);
    } catch {
      // The channel is gone: the supervisor ended, and this process ends with the container.
    }
  };
  send();
  const timer = setInterval(send, intervalMs);
  timer.unref();
  return timer;
}

function log(event: string, fields: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.info(JSON.stringify({ ts: new Date().toISOString(), component: "worker", event, ...fields }));
}

export type SupervisorOptions = {
  /** The script the child runs, e.g. apps/worker/dist/index.js. */
  childScript: string;
  /** The child's arguments, e.g. ["playout"]. */
  args: string[];
  mode: string;
  env?: NodeJS.ProcessEnv;
  frozenAfterMs?: number;
  checkIntervalMs?: number;
  /** Called once with the supervisor's exit code; the entry point exits with it. */
  onExit: (code: number) => void;
};

/** Runs the child and ends (through `onExit`) when the child ends or freezes. Returns the child. */
export function runSupervisor(options: SupervisorOptions): ChildProcess {
  const env = options.env ?? process.env;
  const frozenAfterMs = options.frozenAfterMs ?? FROZEN_AFTER_MS;
  const markerPath = frozenMarkerPath(options.mode, env);
  const child = fork(options.childScript, options.args, {
    env: { ...env, [SUPERVISED_ENV]: "1" },
    stdio: ["inherit", "inherit", "inherit", "ipc"]
  });
  const watch = new FrozenChildWatch(Date.now(), frozenAfterMs);
  let done = false;
  let killedFrozen = false;
  let timer: NodeJS.Timeout | undefined;
  // `docker stop` signals PID 1 (tini), which passes it to the supervisor: hand it on and end with
  // the child, so its own shutdown path runs as before.
  const forwarded: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"];
  const forward = (signal: NodeJS.Signals) => {
    child.kill(signal);
  };

  const finish = (code: number) => {
    if (done) {
      return;
    }
    done = true;
    clearInterval(timer);
    for (const signal of forwarded) {
      process.removeListener(signal, forward);
    }
    options.onExit(code);
  };

  child.on("message", (message) => {
    if (message === SUPERVISOR_HEARTBEAT_MESSAGE) {
      watch.beat(Date.now());
    }
  });
  child.on("exit", (code, signal) => {
    finish(killedFrozen ? 1 : exitCodeForChild(code, signal));
  });
  child.on("error", (error) => {
    log("worker.supervisor.child_error", { mode: options.mode, error: error.message });
    finish(1);
  });

  timer = setInterval(() => {
    const verdict = watch.check(Date.now());
    if (!verdict.frozen || killedFrozen) {
      return;
    }
    killedFrozen = true;
    log("worker.supervisor.frozen", { mode: options.mode, silentForMs: verdict.silentForMs, frozenAfterMs });
    writeFrozenMarker(markerPath, { mode: options.mode, silentForMs: verdict.silentForMs, killedAt: new Date().toISOString() });
    child.kill("SIGKILL");
  }, options.checkIntervalMs ?? SUPERVISOR_CHECK_INTERVAL_MS);

  for (const signal of forwarded) {
    process.on(signal, forward);
  }

  return child;
}
