import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const broadcastControlRoomSource = readFileSync(
  path.join(process.cwd(), "apps/web/components/broadcast-control-room.tsx"),
  "utf8"
);

const playoutActionFormSource = readFileSync(path.join(process.cwd(), "apps/web/components/playout-action-form.tsx"), "utf8");

describe("broadcast control room", () => {
  // M74: Resume schedule cancels a Play now or Insert that waits for or holds the air, so the button is
  // live for those too, not only while a Pin or Fallback runs.
  it("enables Resume schedule while an insert is pending or active", () => {
    expect(broadcastControlRoomSource).toContain("insertStatus={snapshot.playout.insertStatus}");
    expect(playoutActionFormSource).toContain(
      'disabled={isPending || (props.overrideMode === "schedule" && props.insertStatus !== "pending" && props.insertStatus !== "active")}'
    );
  });

  it("links the active moderation presence chip to the moderation workspace", () => {
    expect(broadcastControlRoomSource).toContain('href={buildWorkspaceHref("live", "moderation")}');
    expect(broadcastControlRoomSource).toContain("snapshot.presence.active");
    expect(broadcastControlRoomSource).toContain('label={`Here ${snapshot.presence.remainingMinutes}m`}');
  });
});
