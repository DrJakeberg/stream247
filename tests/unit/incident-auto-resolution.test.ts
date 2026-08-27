import { describe, expect, it } from "vitest";
import {
  INCIDENT_AREA_STABLE_MS,
  INCIDENT_BACKLOG_GRACE_MS,
  measureIncidentAreaHealth,
  planIncidentResolutions
} from "../../apps/worker/src/incident-classes.js";

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0);
const minutes = (value: number) => value * 60_000;
const days = (value: number) => value * 24 * 60 * 60_000;
const at = (offsetMs: number) => new Date(NOW - offsetMs).toISOString();

function incident(fingerprint: string, updatedOffsetMs: number, status: "open" | "resolved" = "open") {
  return { fingerprint, status, updatedAt: at(updatedOffsetMs) };
}

describe("incident area health", () => {
  const base = {
    nowMs: NOW,
    programFeedMode: true,
    relayEnabled: true,
    lastWorkerCycleAt: at(minutes(0.2)),
    playout: {
      status: "running" as const,
      heartbeatAt: at(minutes(0.2)),
      programFeedStatus: "fresh" as const,
      uplinkStatus: "running" as const,
      uplinkStartedAt: at(minutes(45)),
      uplinkHeartbeatAt: at(minutes(0.2))
    }
  };

  it("reads playout health off the program feed when the programme is produced as one", () => {
    expect(measureIncidentAreaHealth(base)).toContain("playout");
    expect(measureIncidentAreaHealth({ ...base, playout: { ...base.playout, programFeedStatus: "stale" } })).not.toContain(
      "playout"
    );
  });

  it("falls back to the playout process itself when there is no program feed", () => {
    const direct = { ...base, programFeedMode: false, playout: { ...base.playout, programFeedStatus: "" as const } };
    expect(measureIncidentAreaHealth(direct)).toContain("playout");
    expect(measureIncidentAreaHealth({ ...direct, playout: { ...direct.playout, status: "failed" } })).not.toContain("playout");
  });

  it("counts an uplink as healthy only once the current process has stood for the whole window", () => {
    expect(measureIncidentAreaHealth(base)).toContain("uplink");
    const justRestarted = { ...base, playout: { ...base.playout, uplinkStartedAt: at(minutes(2)) } };
    expect(measureIncidentAreaHealth(justRestarted)).not.toContain("uplink");
  });

  it("treats a switched-off relay as an uplink that is not failing", () => {
    const off = { ...base, relayEnabled: false, playout: { ...base.playout, uplinkStatus: "idle" as const, uplinkStartedAt: "" } };
    expect(measureIncidentAreaHealth(off)).toContain("uplink");
  });

  it("needs a recent worker cycle before the worker area counts as healthy", () => {
    expect(measureIncidentAreaHealth(base)).toContain("worker");
    expect(measureIncidentAreaHealth({ ...base, lastWorkerCycleAt: at(minutes(30)) })).not.toContain("worker");
  });
});

describe("incident auto-resolution", () => {
  it("waits for the area to be quiet for the whole stability window", () => {
    const recent = planIncidentResolutions({
      incidents: [incident("playout.feed-audio", minutes(3))],
      healthyAreas: ["playout"],
      nowMs: NOW
    });
    expect(recent).toEqual([]);

    const settled = planIncidentResolutions({
      incidents: [incident("playout.feed-audio", INCIDENT_AREA_STABLE_MS + minutes(1))],
      healthyAreas: ["playout"],
      nowMs: NOW
    });
    expect(settled.map((entry) => entry.fingerprint)).toEqual(["playout.feed-audio"]);
    expect(settled[0]?.reason).toBe("recovered");
  });

  it("does not resolve anything while the area is not measurably healthy", () => {
    const plan = planIncidentResolutions({
      incidents: [incident("uplink.encoder-stall.rtmp-primary", days(30))],
      healthyAreas: ["playout", "worker"],
      nowMs: NOW
    });
    expect(plan).toEqual([]);
  });

  it("keeps one fresh event in an area from closing the older ones behind it", () => {
    const plan = planIncidentResolutions({
      incidents: [incident("playout.feed-audio", days(20)), incident("playout.ffmpeg.exit", minutes(1))],
      healthyAreas: ["playout"],
      nowMs: NOW
    });
    expect(plan).toEqual([]);
  });

  it("does not let a routine ffmpeg stderr line hold a whole area open", () => {
    // `line.toLowerCase().includes("error")` is what raises these, and a healthy encode prints
    // "Error while decoding stream" over a single corrupt packet often enough that treating it as
    // proof the area is unwell would keep the list frozen on a channel that is perfectly fine.
    const plan = planIncidentResolutions({
      incidents: [incident("playout.feed-audio", days(20)), incident("playout.ffmpeg.stderr", minutes(1))],
      healthyAreas: ["playout"],
      nowMs: NOW
    });
    expect(plan.map((entry) => entry.fingerprint)).toEqual(["playout.feed-audio"]);
  });

  it("still waits out a noisy family's own repeats before closing it", () => {
    const plan = planIncidentResolutions({
      incidents: [incident("uplink.ffmpeg.stderr", minutes(2))],
      healthyAreas: ["uplink"],
      nowMs: NOW
    });
    expect(plan).toEqual([]);
  });

  it("never touches an incident that describes a lasting state", () => {
    const plan = planIncidentResolutions({
      incidents: [incident("system.volume.low", days(40)), incident("playout.no-asset", days(40))],
      healthyAreas: ["playout", "uplink", "worker", "system", "source", "twitch"],
      nowMs: NOW
    });
    expect(plan).toEqual([]);
  });

  it("leaves incidents that are already resolved alone", () => {
    const plan = planIncidentResolutions({
      incidents: [incident("playout.feed-audio", days(40), "resolved")],
      healthyAreas: ["playout"],
      nowMs: NOW
    });
    expect(plan).toEqual([]);
  });

  it("closes the retired per-asset rows once they are past the backlog grace", () => {
    const stillYoung = planIncidentResolutions({
      incidents: [incident("playout.ffmpeg.exit.asset_source_e2au8vv3_v27", days(2))],
      healthyAreas: ["playout"],
      nowMs: NOW
    });
    expect(stillYoung).toEqual([]);

    const backlog = planIncidentResolutions({
      incidents: [incident("playout.ffmpeg.exit.asset_source_e2au8vv3_v27", INCIDENT_BACKLOG_GRACE_MS + days(1))],
      healthyAreas: ["playout"],
      nowMs: NOW
    });
    expect(backlog.map((entry) => entry.reason)).toEqual(["backlog"]);
    expect(backlog[0]?.message).toContain("past event");
  });

  it("leaves a fingerprint it cannot classify open rather than guessing", () => {
    const plan = planIncidentResolutions({
      incidents: [incident("something.from.a.newer.build", days(90))],
      healthyAreas: ["playout", "uplink", "worker", "system", "source", "twitch"],
      nowMs: NOW
    });
    expect(plan).toEqual([]);
  });

  it("says in the resolution note that nobody looked at it", () => {
    const plan = planIncidentResolutions({
      incidents: [incident("worker.loop.crashed", days(50))],
      healthyAreas: ["worker"],
      nowMs: NOW
    });
    expect(plan[0]?.message).toMatch(/automatically/i);
  });
});
