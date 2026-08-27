import { describe, expect, it } from "vitest";
import {
  INCIDENT_AREA_STABLE_MS,
  INCIDENT_BACKLOG_GRACE_MS,
  measureIncidentAreaHealth,
  planIncidentResolutions
} from "../../apps/worker/src/incident-classes.js";

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0);
const minutes = (value: number) => value * 60_000;
const hours = (value: number) => value * 3_600_000;
const days = (value: number) => value * 24 * 60 * 60_000;
const at = (offsetMs: number) => new Date(NOW - offsetMs).toISOString();

function incident(
  fingerprint: string,
  updatedOffsetMs: number,
  status: "open" | "resolved" = "open",
  message = ""
) {
  // Same createdAt as updatedAt: a one-off, which is the shape most of these cases are about.
  return { fingerprint, status, updatedAt: at(updatedOffsetMs), createdAt: at(updatedOffsetMs), message };
}

/** An incident whose family has been coming back for `spanMs` and last fired `quietMs` ago. */
function recurring(fingerprint: string, quietMs: number, spanMs: number) {
  return {
    fingerprint,
    status: "open",
    updatedAt: at(quietMs),
    createdAt: at(quietMs + spanMs),
    message: ""
  };
}

describe("incident area health", () => {
  const base = {
    nowMs: NOW,
    programFeedMode: true,
    uplinkInputMode: "hls",
    relayEnabled: true,
    lastWorkerCycleAt: at(minutes(0.2)),
    programFeedStaleMs: minutes(1),
    uplinkWatchdogMs: { stallMs: 45_000, graceMs: 60_000, noProgressRestartMs: 300_000 },
    uplinkDestinationsHealthy: true,
    playout: {
      status: "running" as const,
      heartbeatAt: at(minutes(0.2)),
      programFeedStatus: "fresh" as const,
      programFeedUpdatedAt: at(minutes(0.1)),
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

  it("does not believe a frozen 'fresh' left behind by a dead playout", () => {
    // programFeedStatus is only ever written by the playout and uplink processes. The worker, which
    // runs the resolution pass, never recomputes it -- so if both stop, the last "fresh" sits in the
    // database forever. Without a self-ageing anchor beside it the worker would declare playout
    // permanently healthy and close the very incidents that say playout died.
    const frozen = {
      ...base,
      playout: {
        ...base.playout,
        heartbeatAt: at(hours(10)),
        programFeedStatus: "fresh" as const,
        programFeedUpdatedAt: at(hours(10))
      }
    };
    expect(measureIncidentAreaHealth(frozen)).not.toContain("playout");
    expect(
      planIncidentResolutions({
        incidents: [incident("playout.loop.crashed", hours(10)), incident("playout.start.failed", hours(10))],
        healthyAreas: measureIncidentAreaHealth(frozen),
        nowMs: NOW
      })
    ).toEqual([]);
  });

  it("needs the playlist itself to be recent, not only the status word", () => {
    const staleMtime = { ...base, playout: { ...base.playout, programFeedUpdatedAt: at(minutes(20)) } };
    expect(measureIncidentAreaHealth(staleMtime)).not.toContain("playout");
  });

  it("needs a live playout heartbeat in feed mode too, not only in direct mode", () => {
    const noHeartbeat = { ...base, playout: { ...base.playout, heartbeatAt: at(minutes(30)) } };
    expect(measureIncidentAreaHealth(noHeartbeat)).not.toContain("playout");
  });

  it("falls back to the playout process itself when there is no program feed", () => {
    const direct = {
      ...base,
      programFeedMode: false,
      uplinkInputMode: "rtmp",
      playout: { ...base.playout, programFeedStatus: "" as const, programFeedUpdatedAt: "" }
    };
    expect(measureIncidentAreaHealth(direct)).toContain("playout");
    expect(measureIncidentAreaHealth({ ...direct, playout: { ...direct.playout, status: "failed" } })).not.toContain("playout");
  });

  it("counts an uplink as healthy only once the current process has stood for the whole window", () => {
    expect(measureIncidentAreaHealth(base)).toContain("uplink");
    const justRestarted = { ...base, playout: { ...base.playout, uplinkStartedAt: at(minutes(2)) } };
    expect(measureIncidentAreaHealth(justRestarted)).not.toContain("uplink");
  });

  it("refuses to call a running uplink healthy while its input is not fresh", () => {
    // The documented 65-minute outage: in hls mode canBlameUplinkForStall disables every stall
    // watchdog once the feed is not fresh, so nothing restarts the uplink, uplinkStartedAt ages past
    // the window, and the cycle tail still writes status "running" with a fresh heartbeat. Uptime
    // therefore proves nothing here -- the channel was dark for all 65 minutes.
    const darkChannel = {
      ...base,
      playout: {
        ...base.playout,
        programFeedStatus: "stale" as const,
        programFeedUpdatedAt: at(minutes(20)),
        uplinkStartedAt: at(minutes(65))
      }
    };
    expect(measureIncidentAreaHealth(darkChannel)).not.toContain("uplink");
    expect(
      planIncidentResolutions({
        incidents: [
          incident("uplink.no-progress.rtmp-primary", minutes(65)),
          incident("uplink.process.exit", minutes(65))
        ],
        healthyAreas: measureIncidentAreaHealth(darkChannel),
        nowMs: NOW
      })
    ).toEqual([]);
  });

  it("waits out the operator's own watchdog windows before uptime counts as progress", () => {
    // Uptime only proves out_time advanced because the stall and no-progress watchdogs would have
    // restarted the process otherwise. Both are managed and can be raised to hours, so the required
    // uptime has to be at least as long as they are.
    const slowWatchdogs = {
      ...base,
      uplinkWatchdogMs: { stallMs: 45_000, graceMs: 60_000, noProgressRestartMs: 3 * 3_600_000 },
      playout: { ...base.playout, uplinkStartedAt: at(minutes(45)) }
    };
    expect(measureIncidentAreaHealth(slowWatchdogs)).not.toContain("uplink");
  });

  it("does not call the uplink healthy while a destination is in error", () => {
    expect(measureIncidentAreaHealth({ ...base, uplinkDestinationsHealthy: false })).not.toContain("uplink");
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

  it("keeps what the incident said, because resolving overwrites the message", () => {
    // resolveIncident replaces the stored message with the resolution note, so a note that did not
    // carry the original would delete the only record of what actually happened in July.
    const plan = planIncidentResolutions({
      incidents: [incident("playout.ffmpeg.exit", days(50), "open", "FFmpeg exited with code 255. Asset asset_x.")],
      healthyAreas: ["playout"],
      nowMs: NOW
    });
    expect(plan[0]?.message).toContain("FFmpeg exited with code 255. Asset asset_x.");
    expect(plan[0]?.message).toContain("Closed automatically");
  });

  it("demands more quiet from a fault that keeps coming back than from a one-off", () => {
    // upsertIncident keeps created_at across a reopen, so the distance between first and last
    // report is how long this family has been recurring. A fault on a 15-minute cycle would
    // otherwise be closed in every gap and reported again in every burst -- the list green for ten
    // minutes out of every fifteen while the channel keeps falling over.
    const flapping = planIncidentResolutions({
      incidents: [recurring("playout.switch.failed", minutes(12), hours(2))],
      healthyAreas: ["playout"],
      nowMs: NOW
    });
    expect(flapping).toEqual([]);

    // Same age, no history of recurrence: a genuine one-off closes on the base window.
    const oneOff = planIncidentResolutions({
      incidents: [recurring("playout.switch.failed", minutes(12), 0)],
      healthyAreas: ["playout"],
      nowMs: NOW
    });
    expect(oneOff.map((entry) => entry.fingerprint)).toEqual(["playout.switch.failed"]);
  });

  it("closes a long-recurring fault once it has been quiet longer than the cap", () => {
    // Without a cap, a month-long recurrence would demand a month of silence and the list would
    // never recover from a bad week.
    const plan = planIncidentResolutions({
      incidents: [recurring("uplink.encoder-stall.rtmp-primary", days(9), days(40))],
      healthyAreas: ["uplink"],
      nowMs: NOW
    });
    expect(plan.map((entry) => entry.fingerprint)).toEqual(["uplink.encoder-stall.rtmp-primary"]);
  });

  it("still clears the retired backlog, whose entries recurred for weeks in July", () => {
    const plan = planIncidentResolutions({
      incidents: [recurring("playout.ffmpeg.exit.asset_source_e2au8vv3_v27", days(38), days(15))],
      healthyAreas: ["playout"],
      nowMs: NOW
    });
    expect(plan.map((entry) => entry.reason)).toEqual(["backlog"]);
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
