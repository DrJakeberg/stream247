import { buildOverlayTextLines, resolveOverlayScenePresetForQueueKind } from "@stream247/core";
import { describe, expect, it } from "vitest";

describe("overlay scene resolution", () => {
  it("keeps the configured scene for regular assets", () => {
    expect(resolveOverlayScenePresetForQueueKind("split-now-next", "asset")).toBe("split-now-next");
  });

  it("switches inserts to the bumper scene", () => {
    expect(resolveOverlayScenePresetForQueueKind("replay-lower-third", "insert")).toBe("bumper-board");
  });

  it("switches reconnects to the reconnect scene", () => {
    expect(resolveOverlayScenePresetForQueueKind("minimal-chip", "reconnect")).toBe("reconnect-board");
  });
});

describe("overlay text lines", () => {
  it("builds insert copy for the bumper scene", () => {
    expect(
      buildOverlayTextLines({
        scenePreset: "bumper-board",
        replayLabel: "Replay stream",
        headline: "Insert on air",
        nowTitle: "Channel ID",
        nextTitle: "Main program returns",
        queueTitles: ["Main program returns", "Later item"],
        showQueuePreview: true
      })
    ).toEqual([
      "Replay stream",
      "Insert on air",
      "Insert: Channel ID",
      "Next: Main program returns",
      "After this: Main program returns · Later item"
    ]);
  });

  it("builds reconnect copy for the reconnect scene", () => {
    expect(
      buildOverlayTextLines({
        scenePreset: "reconnect-board",
        replayLabel: "Replay stream",
        headline: "Scheduled reconnect in progress",
        nowTitle: "Ignored",
        nextTitle: "Archive Hour",
        queueTitles: ["Archive Hour"],
        showQueuePreview: true
      })
    ).toEqual([
      "Replay stream",
      "Scheduled reconnect in progress",
      "Resuming with: Archive Hour",
      "Queue: Archive Hour"
    ]);
  });
});
