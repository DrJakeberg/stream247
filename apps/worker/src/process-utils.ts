import { spawn } from "node:child_process";

export type ExecFileTextOptions = {
  timeoutMs?: number;
  killProcessGroup?: boolean;
  forceKillAfterMs?: number;
  maxBufferBytes?: number;
};

/**
 * Why execFileText failed, next to the unchanged message: a caller can tell a program that ran and said no
 * (`exit`) from one that never answered (`timeout`, `spawn`) or was ended by a signal (`exit` with a null
 * code), which local-durations.ts retries (review finding R14).
 */
export class ExecFileTextError extends Error {
  readonly kind: "timeout" | "spawn" | "exit" | "overflow";
  readonly exitCode: number | null;
  readonly signal: string | null;

  constructor(message: string, kind: ExecFileTextError["kind"], exitCode: number | null = null, signal: string | null = null) {
    super(message);
    this.kind = kind;
    this.exitCode = exitCode;
    this.signal = signal;
  }
}

export function execFileText(file: string, args: string[], options: ExecFileTextOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const maxBufferBytes = options.maxBufferBytes ?? 1024 * 1024 * 20;
    const child = spawn(file, args, {
      detached: options.killProcessGroup === true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let settled = false;
    let timedOut = false;
    let bufferOverflowed = false;
    let capturedStdoutBytes = 0;
    let capturedStderrBytes = 0;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let forceKillHandle: NodeJS.Timeout | undefined;
    let spawnErrorMessage = "";
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const clearKillTimers = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (forceKillHandle) {
        clearTimeout(forceKillHandle);
      }
    };

    const terminateChild = (signal: NodeJS.Signals) => {
      try {
        if (options.killProcessGroup && child.pid) {
          process.kill(-child.pid, signal);
          return;
        }
      } catch {
        // Fall through to best-effort child kill below.
      }

      try {
        child.kill(signal);
      } catch {
        // Ignore kill races during teardown.
      }
    };

    const appendOutput = (target: "stdout" | "stderr", chunk: Buffer | string) => {
      const text = chunk.toString();
      const nextBytes = Buffer.byteLength(text);
      if (target === "stdout") {
        capturedStdoutBytes += nextBytes;
        if (capturedStdoutBytes <= maxBufferBytes) {
          stdoutChunks.push(text);
        }
      } else {
        capturedStderrBytes += nextBytes;
        if (capturedStderrBytes <= maxBufferBytes) {
          stderrChunks.push(text);
        }
      }

      if (!bufferOverflowed && capturedStdoutBytes + capturedStderrBytes > maxBufferBytes) {
        bufferOverflowed = true;
        terminateChild("SIGKILL");
      }
    };

    child.stdout?.on("data", (chunk) => {
      appendOutput("stdout", chunk);
    });

    child.stderr?.on("data", (chunk) => {
      appendOutput("stderr", chunk);
    });

    child.on("error", (error) => {
      spawnErrorMessage = error.message;
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearKillTimers();

      const stdoutText = stdoutChunks.join("").trim();
      const stderrText = stderrChunks.join("").trim();

      if (bufferOverflowed) {
        reject(new ExecFileTextError(`Command exceeded the ${String(maxBufferBytes)} byte output limit and was terminated.`, "overflow"));
        return;
      }

      if (timedOut) {
        reject(
          new ExecFileTextError(
            `Command timed out after ${String(options.timeoutMs)}ms and terminated ${
              options.killProcessGroup ? "its process group" : "the child process"
            }.${stderrText ? ` ${stderrText}` : ""}`,
            "timeout"
          )
        );
        return;
      }

      if (spawnErrorMessage) {
        reject(new ExecFileTextError(stderrText || spawnErrorMessage, "spawn"));
        return;
      }

      if (code !== 0) {
        reject(new ExecFileTextError(stderrText || `Command exited with code ${String(code ?? signal ?? "unknown")}.`, "exit", code, signal));
        return;
      }

      resolve(stdoutText);
    });

    if ((options.timeoutMs ?? 0) > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        if (options.killProcessGroup) {
          terminateChild("SIGKILL");
          return;
        }

        terminateChild("SIGTERM");
        forceKillHandle = setTimeout(() => {
          terminateChild("SIGKILL");
        }, Math.max(0, options.forceKillAfterMs ?? 1_000));
        forceKillHandle.unref?.();
      }, options.timeoutMs);
      timeoutHandle.unref?.();
    }
  });
}

/**
 * Node has already reported this child's end: an exit code or a signal, or a negative code for a spawn that
 * failed (which emits 'error' and never 'exit'). A listener for 'exit' attached now never runs, so whoever
 * waits for one waits for good (M105, playout stop deadline).
 */
export function hasChildExited(child: { exitCode: number | null; signalCode: NodeJS.Signals | null }): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export type StallGuardResult<T> =
  | { status: "completed"; value: T }
  | { status: "failed"; error: unknown }
  | { status: "stalled" };

/**
 * Runs an async cycle but never blocks longer than `stallMs`. If the cycle
 * neither resolves nor rejects within that window it is reported as "stalled"
 * so the caller can recover (e.g. restart the process) instead of hanging
 * forever on an unbounded await (such as a yt-dlp/fetch network stall).
 */
export async function runWithStallGuard<T>(
  run: () => Promise<T>,
  stallMs: number
): Promise<StallGuardResult<T>> {
  let timer: NodeJS.Timeout | undefined;
  const stall = new Promise<StallGuardResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ status: "stalled" }), stallMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([
      run().then(
        (value): StallGuardResult<T> => ({ status: "completed", value }),
        (error): StallGuardResult<T> => ({ status: "failed", error })
      ),
      stall
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
