import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  INCIDENT_OPERATOR_ACTIONS,
  describeHeartbeatRestartAction,
  describeIncidentOperatorAction,
  describeSourceHealth,
  findIncidentOperatorAction
} from "@stream247/core";

// M90, U10/U11 (planning/research/ux-install.md): a critical incident card said what was wrong and
// not what to press. Every critical fingerprint now has one operator action in the catalogue in
// packages/core/src/incident-actions.ts; this file proves there is no critical reporting site
// without one.

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const workerSource = read("apps/worker/src/index.ts");
const dbSource = read("packages/db/src/index.ts");

const RUNTIME_MODES = ["worker", "playout", "uplink"];

type ReportedFingerprint = { fingerprint: string; keyed: boolean; severity: string; line: number; file: string };

/**
 * Every `fingerprint:` literal in a reporting source with the severity written in the same incident
 * object. The upsert objects list `severity:` a few lines above `fingerprint:`; the search stops at
 * the previous `fingerprint:` so it can never borrow another incident's severity.
 */
function collectFingerprintsWithSeverity(source: string, file: string): ReportedFingerprint[] {
  const found: ReportedFingerprint[] = [];

  for (const match of source.matchAll(/fingerprint:\s*(.+)/g)) {
    const at = match.index ?? 0;
    const before = source.slice(Math.max(0, at - 1500), at);
    const lastFingerprint = before.lastIndexOf("fingerprint:");
    const window = lastFingerprint === -1 ? before : before.slice(lastFingerprint);
    const severityMatch = [...window.matchAll(/severity:\s*([^\n]+)/g)].at(-1);
    const severity = (severityMatch?.[1] ?? "").trim();
    const line = source.slice(0, at).split("\n").length;
    const expression = (match[1] ?? "").trim().replace(/,$/, "");

    for (const literal of expression.matchAll(/"([^"]+)"/g)) {
      found.push({ fingerprint: literal[1] ?? "", keyed: false, severity, line, file });
    }

    for (const template of expression.matchAll(/`([^`]+)`/g)) {
      const raw = template[1] ?? "";
      if (raw.startsWith("${mode}")) {
        for (const mode of RUNTIME_MODES) {
          found.push({ fingerprint: `${mode}${raw.slice("${mode}".length)}`, keyed: false, severity, line, file });
        }
        continue;
      }
      found.push({ fingerprint: (raw.split("${")[0] ?? "").replace(/\.$/, ""), keyed: true, severity, line, file });
    }
  }

  return found;
}

// Every worker module that writes incidents, not only index.ts: a critical site added elsewhere must
// not escape the scan. (The registries in incident-classes.ts name fingerprints without writing them.)
const workerFiles = readdirSync(path.join(process.cwd(), "apps/worker/src"))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => `apps/worker/src/${name}`)
  .filter((file) => read(file).includes("upsertIncident("));
const reported = [
  ...workerFiles.flatMap((file) => collectFingerprintsWithSeverity(read(file), file)),
  ...collectFingerprintsWithSeverity(dbSource, "packages/db/src/index.ts")
];
const critical = reported.filter((entry) => entry.severity.includes('"critical"'));

describe("every critical incident has an operator action", () => {
  it("finds the critical reporting sites (the scan is not vacuous)", () => {
    const names = new Set(critical.map((entry) => entry.fingerprint));
    for (const expected of [
      "playout.crash-loop",
      "playout.ffmpeg.exit",
      "playout.start.failed",
      "playout.switch.failed",
      "disk.watermark.exhausted",
      "system.volume.low",
      "twitch.refresh.failed",
      "twitch.reconnect.required",
      "worker.loop.stalled",
      "uplink.loop.crashed",
      "secrets.key-mismatch",
      "schema.drift",
      "source"
    ]) {
      expect(names, expected).toContain(expected);
    }
    // Every reporting site states its severity right in the incident object.
    expect(reported.filter((entry) => entry.severity === "")).toEqual([]);
  });

  it("maps each critical fingerprint to exactly one catalogue entry", () => {
    const missing = critical
      .filter((entry) => {
        const probe = entry.keyed ? `${entry.fingerprint}.some-key` : entry.fingerprint;
        return findIncidentOperatorAction(probe) === null;
      })
      .map((entry) => `${entry.file}:${entry.line} ${entry.fingerprint}`);
    expect(missing).toEqual([]);

    for (const entry of INCIDENT_OPERATOR_ACTIONS) {
      const probe = entry.keyed ? `${entry.fingerprint}.some-key` : entry.fingerprint;
      const matches = INCIDENT_OPERATOR_ACTIONS.filter((other) =>
        other.keyed ? probe.startsWith(`${other.fingerprint}.`) : probe === other.fingerprint
      );
      expect(matches, entry.fingerprint).toHaveLength(1);
    }
  });

  it("names something to press or run in every action", () => {
    for (const entry of INCIDENT_OPERATOR_ACTIONS) {
      expect(entry.action, entry.fingerprint).toMatch(/Live → |Program → |Admin → |`docker |Reconnect|Free space|Put back/);
      expect(entry.action, entry.fingerprint).not.toMatch(/Manual intervention/i);
    }
  });

  it("keys a source family by its id and leaves unknown fingerprints alone", () => {
    expect(describeIncidentOperatorAction("source.youtube-channel.source-abc")).toContain("Program → Sources");
    expect(describeIncidentOperatorAction("source")).toBe("");
    expect(describeIncidentOperatorAction("overlay.ticker-stale")).toBe("");
    expect(describeHeartbeatRestartAction("worker")).toContain("`docker compose restart worker`");
    expect(describeHeartbeatRestartAction("playout")).toContain("`docker compose restart playout`");
  });

  it("the crash-loop incident says what to do, not only that someone must", () => {
    const at = workerSource.indexOf('fingerprint: "playout.crash-loop"');
    const object = workerSource.slice(workerSource.lastIndexOf("upsertIncident({", at), at);
    expect(object).not.toContain("Manual intervention is required");
    expect(object).toContain('describeIncidentOperatorAction("playout.crash-loop")');
  });
});

describe("incident messages store no relative time (U10, the writer)", () => {
  const runs = [
    { status: "error", discoveredAssets: 0, startedAt: "2026-10-02T02:50:00.000Z", finishedAt: "2026-10-02T02:50:05.000Z", errorMessage: "HTTP 503" },
    { status: "error", discoveredAssets: 0, startedAt: "2026-10-02T02:45:00.000Z", finishedAt: "2026-10-02T02:45:05.000Z", errorMessage: "HTTP 503" },
    { status: "error", discoveredAssets: 0, startedAt: "2026-10-02T02:40:00.000Z", finishedAt: "2026-10-02T02:40:05.000Z", errorMessage: "HTTP 503" }
  ] as Parameters<typeof describeSourceHealth>[0]["runs"];
  const input = {
    lastSyncedAt: "2026-10-02T02:50:05.000Z",
    runs,
    storedAssetCount: 0,
    poolNames: ["Evening"],
    blockNames: ["Prime time"],
    nowMs: new Date("2026-10-02T03:00:00.000Z").getTime()
  };

  it("the absolute clock the worker writes with names UTC times, never an age", () => {
    const stored = describeSourceHealth({ ...input, clock: "absolute" });
    expect(stored.headline).toBe("The last 3 checks failed, the first of them at 2026-10-02 02:40 UTC. Nothing is stored for it either.");
    expect(`${stored.headline} ${stored.impact}`).not.toMatch(/\bago\b/);
    for (const single of [runs.slice(0, 1), []]) {
      const text = describeSourceHealth({ ...input, runs: single, clock: "absolute" }).headline;
      expect(text).not.toMatch(/\bago\b/);
      expect(text).toContain("UTC");
    }
  });

  it("the page keeps its relative wording", () => {
    expect(describeSourceHealth(input).headline).toBe("The last 3 checks failed, the first of them 20 minutes ago. Nothing is stored for it either.");
  });

  it("the worker's drought incident writer uses the absolute clock", () => {
    const at = workerSource.indexOf("const health = describeSourceHealth({");
    const call = workerSource.slice(at, workerSource.indexOf("});", at));
    expect(call).toContain('clock: "absolute"');
    // And it is the only describeSourceHealth call in the worker, which is where incidents are written.
    expect(workerSource.match(/describeSourceHealth\(/g)).toHaveLength(1);
    expect(workerSource).not.toMatch(/describeElapsed\(/);
  });
});
