import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  INCIDENT_AREA_STABLE_MS,
  INCIDENT_BACKLOG_GRACE_MS,
  INCIDENT_FAMILIES,
  RETIRED_INCIDENT_FINGERPRINTS,
  buildIncidentFingerprint,
  classifyIncidentFingerprint,
  classifyIncidentReference,
  measureIncidentAreaHealth,
  planIncidentResolutions
} from "../../apps/worker/src/incident-classes.js";

// The failure this module exists for, measured on the running DUT on 2026-08-27: 50+ open
// incidents, 40+ of them "critical", the oldest from 5 July -- every one of them a past event that
// nothing ever closed. A list in that state is worse than no list: the one thing that is broken
// right now is invisible between forty corpses.

const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");

/** Every `fingerprint: <expr>` literal the worker actually reports under. */
function collectReportedFingerprints(): string[] {
  const found = new Set<string>();
  for (const match of workerSource.matchAll(/fingerprint:\s*(.+)/g)) {
    const expression = (match[1] ?? "").trim().replace(/,$/, "");
    for (const literal of expression.matchAll(/"([^"]+)"/g)) {
      found.add(literal[1] ?? "");
    }
    for (const template of expression.matchAll(/`([^`]+)`/g)) {
      // `uplink.no-progress.${running.key}` -> the family prefix in front of the first slot.
      const raw = template[1] ?? "";
      const prefix = raw.split("${")[0] ?? "";
      found.add(prefix.replace(/\.$/, ""));
    }
  }
  return [...found].filter((entry) => entry !== "");
}

describe("incident family registry", () => {
  it("classifies every fingerprint the worker reports under", () => {
    const unregistered = collectReportedFingerprints().filter(
      (fingerprint) => classifyIncidentReference(fingerprint) === null
    );
    expect(unregistered).toEqual([]);
  });

  it("gives every family a kind, an area and a written reason", () => {
    for (const family of INCIDENT_FAMILIES) {
      expect(["state", "event"]).toContain(family.kind);
      expect(family.area).toBeTruthy();
      expect(family.why.length).toBeGreaterThan(20);
    }
  });

  it("keeps the conditions that describe a lasting state out of the event class", () => {
    for (const fingerprint of [
      "disk.watermark.exhausted",
      "system.volume.low",
      "playout.no-asset",
      "playout.output.missing",
      "uplink.output.missing",
      "twitch.metadata.waiting-for-broadcaster",
      "twitch.refresh.failed",
      "source.local-library.empty"
    ]) {
      expect(classifyIncidentFingerprint(fingerprint)?.kind).toBe("state");
    }
  });

  it("marks the finished events that nothing ever closed", () => {
    for (const fingerprint of [
      "playout.feed-audio",
      "playout.feed-stall",
      "playout.ffmpeg.exit",
      "playout.ffmpeg.stderr",
      "playout.start.failed",
      "playout.switch.failed",
      "uplink.ffmpeg.stderr",
      "uplink.process.exit",
      "uplink.no-progress.rtmp-primary",
      "uplink.discontinuity-storm.rtmp-primary",
      "uplink.encoder-stall.rtmp-primary",
      "uplink.destination-stall.rtmp-primary",
      "worker.loop.crashed",
      "playout.loop.stalled"
    ]) {
      expect(classifyIncidentFingerprint(fingerprint)?.kind).toBe("event");
    }
  });

  it("routes the loop watchdog of each runtime mode to its own area", () => {
    expect(classifyIncidentFingerprint("worker.loop.crashed")?.area).toBe("worker");
    expect(classifyIncidentFingerprint("playout.loop.crashed")?.area).toBe("playout");
    expect(classifyIncidentFingerprint("uplink.loop.stalled")?.area).toBe("uplink");
  });

  it("keeps one entry per ffmpeg exit instead of one per asset", () => {
    // `playout.ffmpeg.exit.<assetId>` produced a new row per asset, which is how a single
    // recurring cause filled the list with dozens of separate critical entries.
    expect(buildIncidentFingerprint("playout.ffmpeg.exit")).toBe("playout.ffmpeg.exit");
    expect(workerSource).not.toContain("playout.ffmpeg.exit.${");
    expect(classifyIncidentFingerprint("playout.ffmpeg.exit")?.keyed).toBe(false);
  });

  it("still keys the families whose key names a bounded, configured thing", () => {
    expect(buildIncidentFingerprint("uplink.encoder-stall", "rtmp-primary")).toBe("uplink.encoder-stall.rtmp-primary");
    expect(classifyIncidentFingerprint("playout.destination.destination-backup.failed")?.area).toBe("playout");
    expect(classifyIncidentFingerprint("source.youtube.src-42")?.kind).toBe("state");
  });

  it("remembers the per-asset shape as retired so old rows can still be recognised", () => {
    expect(RETIRED_INCIDENT_FINGERPRINTS.some((entry) => entry.prefix === "playout.ffmpeg.exit.")).toBe(true);
  });

  it("runs the resolution pass from the worker cycle", () => {
    expect(workerSource).toContain("await resolveFinishedIncidents(await readAppState());");
    expect(workerSource).toContain('logRuntimeEvent("incident.auto_resolved"');
  });

  it("keeps the two thresholds out of managed configuration", () => {
    // The stability window and the backlog grace are the honesty threshold of a reporting surface,
    // not plant tuning. A managed field would let someone set them to nothing and restore the
    // lying list this work removes.
    expect(INCIDENT_AREA_STABLE_MS).toBe(600_000);
    expect(INCIDENT_BACKLOG_GRACE_MS).toBe(604_800_000);
    const managedSource = readFileSync(path.join(process.cwd(), "packages/core/src/managed-runtime.ts"), "utf8");
    expect(managedSource).not.toContain("incidentAreaStable");
  });
});
