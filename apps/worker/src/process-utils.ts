import { spawn } from "node:child_process";

export type ExecFileTextOptions = {
  timeoutMs?: number;
  killProcessGroup?: boolean;
  forceKillAfterMs?: number;
  maxBufferBytes?: number;
};

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
        reject(new Error(`Command exceeded the ${String(maxBufferBytes)} byte output limit and was terminated.`));
        return;
      }

      if (timedOut) {
        reject(
          new Error(
            `Command timed out after ${String(options.timeoutMs)}ms and terminated ${
              options.killProcessGroup ? "its process group" : "the child process"
            }.${stderrText ? ` ${stderrText}` : ""}`
          )
        );
        return;
      }

      if (spawnErrorMessage) {
        reject(new Error(stderrText || spawnErrorMessage));
        return;
      }

      if (code !== 0) {
        reject(new Error(stderrText || `Command exited with code ${String(code ?? signal ?? "unknown")}.`));
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
