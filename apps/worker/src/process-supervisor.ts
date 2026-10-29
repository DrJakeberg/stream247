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
import { accessSync, constants, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  private readonly frozenAfterMs: number;

  // Plain fields, no parameter properties: the supervisor test runs this file under Node's type stripping.
  constructor(startedAtMs: number, frozenAfterMs: number = FROZEN_AFTER_MS) {
    this.lastBeatMs = startedAtMs;
    this.frozenAfterMs = frozenAfterMs;
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
 * The marker's directory without STREAM247_SUPERVISOR_MARKER_DIR (M126). /var/tmp lies in the container's
 * writable layer, which a restart keeps; /tmp does too, unless the stack mounts a tmpfs there, and the
 * production stack does in worker, playout and uplink.
 */
export const PERSISTENT_TMP_DIR = "/var/tmp";

/** `persistentDir` when it is a directory this process can write to, else the temp directory. */
export function defaultMarkerDir(persistentDir: string = PERSISTENT_TMP_DIR): string {
  try {
    if (statSync(persistentDir).isDirectory()) {
      accessSync(persistentDir, constants.W_OK | constants.X_OK);
      return persistentDir;
    }
  } catch {
    // Missing or not writable: the temp directory, as before M126.
  }
  return tmpdir();
}

/**
 * Where the supervisor leaves a note for the next process. `docker restart` and the restart policy
 * keep the container's writable layer, so the next process finds it and can raise the incident; the
 * supervisor itself has no database connection. A tmpfs is empty again after the restart, so the
 * default is /var/tmp, not the temp directory; an explicit STREAM247_SUPERVISOR_MARKER_DIR still wins.
 * The supervisor writes and the next process reads through this one function.
 */
export function frozenMarkerPath(
  mode: string,
  env: NodeJS.ProcessEnv = process.env,
  persistentDir: string = PERSISTENT_TMP_DIR
): string {
  return path.join(env.STREAM247_SUPERVISOR_MARKER_DIR || defaultMarkerDir(persistentDir), `stream247-frozen-${mode}.json`);
}

export function writeFrozenMarker(markerPath: string, marker: FrozenRestartMarker): void {
  try {
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, JSON.stringify(marker));
  } catch {
    // Best-effort: the restart matters more than the note about it.
  }
}

/** Removes the marker once its incident is written. */
export function clearFrozenMarker(markerPath: string): void {
  rmSync(markerPath, { force: true });
}

/** Reads and removes the marker; null when there is none or it does not read. */
export function takeFrozenMarker(markerPath: string): FrozenRestartMarker | null {
  const marker = readFrozenMarker(markerPath);
  clearFrozenMarker(markerPath);
  return marker;
}

/** Reads the marker without removing it; null when there is none or it does not read. */
export function readFrozenMarker(markerPath: string): FrozenRestartMarker | null {
  let raw: string;
  try {
    raw = readFileSync(markerPath, "utf8");
  } catch {
    return null;
  }
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
    // Without a callback a closed channel is reported as an 'error' event on `process`, which would
    // reach the uncaught-exception handler; the callback takes it instead. A closed channel means the
    // supervisor ended, and in a container this process ends with it.
    if (!process.connected) {
      return;
    }
    process.send?.(SUPERVISOR_HEARTBEAT_MESSAGE, undefined, {}, () => undefined);
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
  // the child, which ends on it as it did when it was PID 1's child itself.
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
