import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeIncidentAge, describeOpenIncidentOverflow } from "../../apps/web/lib/incident-age.js";

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0);
const at = (offsetMs: number) => new Date(NOW - offsetMs).toISOString();
const minutes = (value: number) => value * 60_000;
const hours = (value: number) => value * 3_600_000;
const days = (value: number) => value * 86_400_000;

describe("how long an incident has been standing", () => {
  it("leads with when it was last reported, because that is what says whether it is current", () => {
    expect(describeIncidentAge({ createdAt: at(days(40)), updatedAt: at(minutes(4)), nowMs: NOW })).toBe(
      "Last reported 4m ago · first seen 40d 0h ago"
    );
  });

  it("says it once when the incident has only ever been reported once", () => {
    const stamp = at(hours(3));
    expect(describeIncidentAge({ createdAt: stamp, updatedAt: stamp, nowMs: NOW })).toBe("Reported 3h 00m ago");
  });

  it("does not pretend to know an age it was not given", () => {
    expect(describeIncidentAge({ createdAt: "", updatedAt: "", nowMs: NOW })).toBe("");
    expect(describeIncidentAge({ createdAt: "not a date", updatedAt: "not a date", nowMs: NOW })).toBe("");
    // The control room measures against the snapshot's own timestamp; an unparseable one must
    // produce no line rather than "NaNd NaNh ago".
    expect(describeIncidentAge({ createdAt: at(days(2)), updatedAt: at(days(2)), nowMs: Number.NaN })).toBe("");
  });

  it("rounds a fresh incident to something readable rather than to zero", () => {
    expect(describeIncidentAge({ createdAt: at(2_000), updatedAt: at(2_000), nowMs: NOW })).toBe("Reported <1m ago");
  });
});

describe("open incidents beyond the ones listed", () => {
  it("stays quiet while everything open is on screen", () => {
    expect(describeOpenIncidentOverflow(4, 4)).toBe("");
    expect(describeOpenIncidentOverflow(4, 2)).toBe("");
  });

  it("says how many are not shown, so a long list is never silently cut", () => {
    expect(describeOpenIncidentOverflow(4, 12)).toBe("8 further open incidents are not shown here.");
    expect(describeOpenIncidentOverflow(4, 5)).toBe("1 further open incident is not shown here.");
  });
});

describe("the surfaces that show open incidents", () => {
  const dashboardSource = readFileSync(path.join(process.cwd(), "apps/web/app/(admin)/dashboard/page.tsx"), "utf8");
  const controlRoomSource = readFileSync(path.join(process.cwd(), "apps/web/components/broadcast-control-room.tsx"), "utf8");
  const serverStateSource = readFileSync(path.join(process.cwd(), "apps/web/lib/server/state.ts"), "utf8");

  it("tells the operator how old each open entry is", () => {
    expect(serverStateSource).toContain("describeIncidentAge");
    expect(dashboardSource).toContain("incident.ageLabel");
    expect(controlRoomSource).toContain("describeIncidentAge");
  });

  it("admits when more are open than fit on the panel", () => {
    expect(serverStateSource).toContain("describeOpenIncidentOverflow");
    expect(dashboardSource).toContain("incidentPanel.overflow");
    expect(controlRoomSource).toContain("describeOpenIncidentOverflow");
  });

  it("keeps the clock out of the render, so both panels stay pure", () => {
    // eslint's react-hooks/purity rule is the enforcer; this states the intent next to the code
    // that has to keep satisfying it.
    expect(dashboardSource).not.toContain("Date.now()");
    expect(controlRoomSource).not.toContain("Date.now()");
    expect(controlRoomSource).toContain("new Date(snapshot.generatedAt).getTime()");
  });
});
