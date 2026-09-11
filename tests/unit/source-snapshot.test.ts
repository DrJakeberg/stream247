import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSourceSnapshotIntervalSeconds } from "@stream247/core";
import {
  SOURCE_SNAPSHOT_FAILURE_INCIDENT_THRESHOLD,
  buildSourceSnapshotArgs,
  captureSourceSnapshot,
  deriveSourceFrameStatus,
  getSourceSnapshotDirectory,
  getSourceSnapshotPath,
  getSourceSnapshotTempPath,
  resolveSourceSnapshotTimeoutMs,
  selectEvictableSourceFrames,
  shouldRaiseSourceSnapshotIncident,
  shouldStartSourceCapture,
  summarizeSourceFeed
} from "../../apps/worker/src/source-snapshot";
import { getLoopStallTimeoutMs } from "../../apps/worker/src/cycle-budget";

describe("source snapshot interval", () => {
  it("defaults to five seconds and resolves managed before env", () => {
    expect(resolveSourceSnapshotIntervalSeconds(null, {})).toBe(5);
    expect(resolveSourceSnapshotIntervalSeconds({ sourceSnapshotIntervalSeconds: "10" }, {})).toBe(10);
    expect(
      resolveSourceSnapshotIntervalSeconds(
        { sourceSnapshotIntervalSeconds: "10" },
        { STREAM247_SOURCE_SNAPSHOT_INTERVAL_SECONDS: "30" }
      )
    ).toBe(10);
    expect(resolveSourceSnapshotIntervalSeconds(null, { STREAM247_SOURCE_SNAPSHOT_INTERVAL_SECONDS: "30" })).toBe(30);
  });

  it("rejects garbage per source instead of letting it poison the fallback chain", () => {
    expect(resolveSourceSnapshotIntervalSeconds({ sourceSnapshotIntervalSeconds: "fast" }, {})).toBe(5);
    expect(
      resolveSourceSnapshotIntervalSeconds(
        { sourceSnapshotIntervalSeconds: "" },
        { STREAM247_SOURCE_SNAPSHOT_INTERVAL_SECONDS: "0" }
      )
    ).toBe(5);
    // Clamped to sane bounds: sub-second sampling multiplies capture processes for a 1fps overlay.
    expect(resolveSourceSnapshotIntervalSeconds({ sourceSnapshotIntervalSeconds: "1" }, {})).toBe(2);
    expect(resolveSourceSnapshotIntervalSeconds({ sourceSnapshotIntervalSeconds: "9999" }, {})).toBe(300);
  });
});

describe("capture spawn policy", () => {
  it("keeps the execFile timeout under the cycle stall budget whatever the env says", () => {
    const envs: NodeJS.ProcessEnv[] = [{}, { STREAM247_LOOP_STALL_TIMEOUT_SECONDS: "60" }];
    for (const env of envs) {
      const timeout = resolveSourceSnapshotTimeoutMs(env);
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThan(getLoopStallTimeoutMs(env));
    }
  });

  it("starts a capture only when due and never while one is in flight", () => {
    expect(shouldStartSourceCapture({ nowMs: 10_000, lastStartedAtMs: 0, intervalMs: 5000, inFlight: false })).toBe(true);
    expect(shouldStartSourceCapture({ nowMs: 4000, lastStartedAtMs: 0, intervalMs: 5000, inFlight: false })).toBe(true);
    expect(shouldStartSourceCapture({ nowMs: 4000, lastStartedAtMs: 1000, intervalMs: 5000, inFlight: false })).toBe(false);
    expect(shouldStartSourceCapture({ nowMs: 60_000, lastStartedAtMs: 1000, intervalMs: 5000, inFlight: true })).toBe(false);
  });

  it("asks ffmpeg for exactly one frame, over TCP for RTSP feeds, writing to the temp path", () => {
    const args = buildSourceSnapshotArgs({ url: "rtsp://cam.local/stream", targetPath: "/tmp/frame.png.tmp" });
    expect(args).toContain("-rtsp_transport");
    expect(args[args.length - 1]).toBe("/tmp/frame.png.tmp");
    expect(args.join(" ")).toContain("-frames:v 1");

    const httpArgs = buildSourceSnapshotArgs({ url: "https://cam.example/stream.m3u8", targetPath: "/x.png.tmp" });
    expect(httpArgs).not.toContain("-rtsp_transport");
  });
});

describe("frame status", () => {
  it("is live while captures keep landing and stale once they stop", () => {
    const intervalMs = 5000;
    expect(deriveSourceFrameStatus({ nowMs: 20_000, lastSuccessAtMs: 18_000, intervalMs })).toBe("live");
    expect(deriveSourceFrameStatus({ nowMs: 20_000, lastSuccessAtMs: 0, intervalMs })).toBe("stale");
    // Three missed intervals of grace: a single slow capture must not blink the layer off air.
    expect(deriveSourceFrameStatus({ nowMs: 20_000, lastSuccessAtMs: 20_000 - intervalMs * 3, intervalMs })).toBe("live");
    expect(deriveSourceFrameStatus({ nowMs: 60_000, lastSuccessAtMs: 10_000, intervalMs })).toBe("stale");
  });
});

describe("failure escalation", () => {
  it("raises the incident only after repeated consecutive failures", () => {
    expect(shouldRaiseSourceSnapshotIncident(SOURCE_SNAPSHOT_FAILURE_INCIDENT_THRESHOLD - 1)).toBe(false);
    expect(shouldRaiseSourceSnapshotIncident(SOURCE_SNAPSHOT_FAILURE_INCIDENT_THRESHOLD)).toBe(true);
    expect(shouldRaiseSourceSnapshotIncident(SOURCE_SNAPSHOT_FAILURE_INCIDENT_THRESHOLD + 5)).toBe(true);
  });
});

describe("snapshot files", () => {
  it("keeps captures in a dot-directory under the media root, ids sanitised", () => {
    expect(getSourceSnapshotDirectory("/media")).toBe("/media/.stream247-source-frames");
    expect(getSourceSnapshotPath("front-desk", "/media")).toBe("/media/.stream247-source-frames/front-desk.png");
    expect(getSourceSnapshotPath("../../etc/passwd", "/media")).not.toContain("..");
    expect(getSourceSnapshotTempPath("front-desk", "/media")).not.toBe(getSourceSnapshotPath("front-desk", "/media"));
  });

  it("offers old frames and every temp leftover to the disk sweep, never a fresh capture", () => {
    const nowMs = 1_000_000;
    const picked = selectEvictableSourceFrames({
      files: [
        { filePath: "/m/.stream247-source-frames/live.png", modifiedAtMs: nowMs - 4000, bytes: 10 },
        { filePath: "/m/.stream247-source-frames/old.png", modifiedAtMs: nowMs - 30 * 60_000, bytes: 10 },
        { filePath: "/m/.stream247-source-frames/left.png.tmp", modifiedAtMs: nowMs - 1000, bytes: 10 }
      ],
      nowMs
    });
    const paths = picked.map((file) => file.filePath);
    expect(paths).toContain("/m/.stream247-source-frames/old.png");
    expect(paths).toContain("/m/.stream247-source-frames/left.png.tmp");
    expect(paths).not.toContain("/m/.stream247-source-frames/live.png");
  });
});

describe("feed summaries", () => {
  it("logs origin and path only — no credentials, no query", () => {
    const summary = summarizeSourceFeed("rtsp://user:secret@cam.local:554/stream?token=abc");
    expect(summary).toContain("cam.local");
    expect(summary).not.toContain("secret");
    expect(summary).not.toContain("user");
    expect(summary).not.toContain("token");
  });

  it("scrubs the feed address out of failed-capture errors and leaves no temp file behind", async () => {
    // /bin/false exits non-zero, and execFile quotes the entire command line — feed URL with
    // embedded credentials included — in its error message. That message feeds logs and
    // incidents, so the address must come out before the result leaves the module.
    const mediaRoot = mkdtempSync(path.join(tmpdir(), "stream247-source-snapshot-"));
    const result = await captureSourceSnapshot({
      url: "rtsp://user:secret@cam.local/stream",
      sourceId: "cam",
      mediaRoot,
      timeoutMs: 5000,
      ffmpegBinary: "/bin/false"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("secret");
      expect(result.error).not.toContain("user:");
    }
    expect(readdirSync(getSourceSnapshotDirectory(mediaRoot))).toEqual([]);
  });
});
