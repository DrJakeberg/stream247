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

/** The `RuntimeMode` union, which is what `${mode}` in a fingerprint template can be. */
const RUNTIME_MODES = ["worker", "playout", "uplink"];

/**
 * Every fingerprint the worker actually reports under.
 *
 * The first version of this scanner took `raw.split("${")[0]` as the family prefix, which is empty
 * for a template that BEGINS with an interpolation -- and it then dropped empty entries. The two
 * loop-watchdog sites are written exactly that way (`` `${mode}.loop.stalled` ``), so the guard that
 * exists to prove every reporting site is classified silently skipped the two whose incidents are
 * the loudest thing in the list. A leading slot is now either expanded, when the values are an
 * enumerable union we know, or surfaced as an unresolvable marker that no registry entry can match.
 */
export function collectReportedFingerprints(source: string): string[] {
  const found = new Set<string>();

  for (const match of source.matchAll(/fingerprint:\s*(.+)/g)) {
    const expression = (match[1] ?? "").trim().replace(/,$/, "");

    for (const literal of expression.matchAll(/"([^"]+)"/g)) {
      found.add(literal[1] ?? "");
    }

    for (const template of expression.matchAll(/`([^`]+)`/g)) {
      const raw = template[1] ?? "";
      if (!raw.startsWith("${")) {
        // `uplink.no-progress.${running.key}` -> the family prefix in front of the first slot.
        found.add((raw.split("${")[0] ?? "").replace(/\.$/, ""));
        continue;
      }

      const closing = raw.indexOf("}");
      const slot = closing === -1 ? "" : raw.slice(2, closing);
      const tail = closing === -1 ? "" : raw.slice(closing + 1);
      if (slot === "mode") {
        for (const mode of RUNTIME_MODES) {
          found.add(`${mode}${tail}`);
        }
        continue;
      }

      // Anything else that leads with a slot cannot be resolved from the source alone. Reported as
      // a marker rather than dropped, so the classification check goes red and someone decides.
      found.add(`unresolvable-leading-slot:${raw}`);
    }
  }

  return [...found].filter((entry) => entry !== "");
}

describe("the scan that forces every reporting site to decide", () => {
  it("sees the loop watchdogs, whose templates begin with the interpolation", () => {
    const found = collectReportedFingerprints(workerSource);
    expect(found).toContain("worker.loop.stalled");
    expect(found).toContain("playout.loop.crashed");
    expect(found).toContain("uplink.loop.crashed");
  });

  it("goes red on a leading slot it cannot resolve instead of dropping it", () => {
    const invented = 'fingerprint: `${somethingNew}.foo.bar`\n';
    const found = collectReportedFingerprints(invented);
    expect(found).toHaveLength(1);
    expect(found.every((entry) => classifyIncidentReference(entry) === null)).toBe(true);
  });

  it("still reads plain literals and trailing-slot templates", () => {
    const source = 'fingerprint: "playout.feed-audio"\nfingerprint: `uplink.encoder-stall.${key}`\n';
    expect(collectReportedFingerprints(source).sort()).toEqual(["playout.feed-audio", "uplink.encoder-stall"]);
  });
});

describe("incident family registry", () => {
  it("classifies every fingerprint the worker reports under", () => {
    const unregistered = collectReportedFingerprints(workerSource).filter(
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

  it("hands the pass every signal the health rules need", () => {
    // Each of these was a demonstrated false "healthy" before it was passed: the frozen feed status
    // without its mtime allowance, the running uplink without its input mode, and uptime weighed
    // against watchdog windows an operator can raise to hours.
    expect(workerSource).toContain("uplinkInputMode: STREAM247_UPLINK_INPUT_MODE");
    expect(workerSource).toContain("programFeedStaleMs:");
    expect(workerSource).toContain("uplinkWatchdogMs: getUplinkStallOptions(process.env, state.managedConfig)");
    expect(workerSource).toContain("uplinkDestinationsHealthy:");
  });

  it("measures uplink uptime from the youngest running process", () => {
    expect(workerSource).toContain("pickUplinkGroupStartedAt(getRunningUplinkProcesses().map((entry) => entry.startedAt))");
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
