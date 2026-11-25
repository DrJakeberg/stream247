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
    // M120: and while a skip hold, a Remove next or a Move next is in effect (operator-holds.ts).
    expect(broadcastControlRoomSource).toContain(
      "resumeEnabled={Number.isFinite(incidentNowMs) && resumeHasSomethingToClear(snapshot.playout, incidentNowMs)}"
    );
    expect(playoutActionFormSource.replace(/\s+/g, " ")).toContain(
      'disabled={ isPending || (props.overrideMode === "schedule" && props.insertStatus !== "pending" && props.insertStatus !== "active" && !props.resumeEnabled) }'
    );
  });

  // M129 (suggestion 23): the Live workspace header is the page's one header; the control room no longer
  // repeats it with a second hero and a metric rail that duplicated the shared top strip.
  it("renders no page header of its own", () => {
    expect(broadcastControlRoomSource).not.toContain("AdminPageHeader");
    expect(broadcastControlRoomSource).not.toContain("Operate the live 24/7");
    expect(broadcastControlRoomSource).toContain('<div className="stack-form live-control">');
  });
});
