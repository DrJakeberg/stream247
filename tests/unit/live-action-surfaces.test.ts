import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(path.join(process.cwd(), "apps/web/app/(admin)/dashboard/page.tsx"), "utf8");
const broadcastControlRoomSource = readFileSync(path.join(process.cwd(), "apps/web/components/broadcast-control-room.tsx"), "utf8");

describe("live action surfaces", () => {
  it("keeps playout mutation controls off the dashboard", () => {
    expect(dashboardSource).not.toContain("PlayoutActionForm");
    expect(dashboardSource).toContain("Use Live control for skip, fallback, restart, override, replay, and Live Bridge actions.");
  });

  it("keeps the playout action form on the live control surface", () => {
    expect(broadcastControlRoomSource).toContain("PlayoutActionForm");
    expect(broadcastControlRoomSource).toContain('<span className="label">Actions</span>');
  });
});
