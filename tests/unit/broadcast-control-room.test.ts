import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const broadcastControlRoomSource = readFileSync(
  path.join(process.cwd(), "apps/web/components/broadcast-control-room.tsx"),
  "utf8"
);

describe("broadcast control room", () => {
  it("links the active moderation presence chip to the moderation workspace", () => {
    expect(broadcastControlRoomSource).toContain('href={buildWorkspaceHref("live", "moderation")}');
    expect(broadcastControlRoomSource).toContain("snapshot.presence.active");
    expect(broadcastControlRoomSource).toContain('label={`Here ${snapshot.presence.remainingMinutes}m`}');
  });
});
