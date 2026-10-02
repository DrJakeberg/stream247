import { describe, expect, it } from "vitest";
import {
  getChannelStatusKind,
  getChannelStatusLabel,
  getChannelUpdateNotice,
  getViewerChannelStatusLabel,
  getViewerChannelStatusLine
} from "../../apps/web/lib/channel-status";

// The public channel page rendered the playout's own status value straight to viewers: "running",
// "reconnecting", "degraded", "switching". Those are the words the process uses about itself, and
// several of them alarm without being actionable — "degraded" still means a picture is going out.
// A viewer can act on three answers; the rest is the channel's business.

describe("what a viewer is told", () => {
  it("says the channel is on air while it is playing", () => {
    for (const status of ["running", "switching"]) {
      expect(getChannelStatusLabel(status)).toBe("On air");
    }
  });

  it("still says on air when the channel is merely degraded", () => {
    // Degraded is an internal quality judgement. From the sofa there is a picture.
    expect(getChannelStatusLabel("degraded")).toBe("On air");
  });

  it("says it is starting up while it works its way back", () => {
    for (const status of ["starting", "recovering", "reconnecting"]) {
      expect(getChannelStatusLabel(status)).toBe("Starting up");
    }
  });

  it("says off air when there is nothing to watch", () => {
    for (const status of ["idle", "standby", "failed"]) {
      expect(getChannelStatusLabel(status)).toBe("Off air");
    }
  });

  it("lands an unrecognised status on off air rather than showing it raw", () => {
    // An older or newer worker may report something this build has never heard of. It must not
    // reach the page unmapped, which is the failure this replaces.
    expect(getChannelStatusLabel("some_future_state")).toBe("Off air");
    expect(getChannelStatusLabel("")).toBe("Off air");
  });

  it("never leaks an internal status word", () => {
    const internal = [
      "idle",
      "starting",
      "running",
      "switching",
      "degraded",
      "recovering",
      "failed",
      "standby",
      "reconnecting"
    ];

    for (const status of internal) {
      expect(internal).not.toContain(getChannelStatusLabel(status));
    }
  });
});

describe("telling a viewer their page is slow", () => {
  it("says nothing while updates are arriving normally", () => {
    // The normal case is not worth a line; the page said "Live updates connected" regardless.
    expect(getChannelUpdateNotice("en", true)).toBe("");
    expect(getChannelUpdateNotice("de", true)).toBe("");
  });

  it("describes the effect rather than the mechanism when they are not", () => {
    // Was "Polling fallback active", which names the transport a viewer has no use for.
    expect(getChannelUpdateNotice("en", false)).toBe("Updating every few seconds");
    expect(getChannelUpdateNotice("de", false)).toBe("Aktualisiert sich alle paar Sekunden");
  });
});

// M80: the same three answers, split. The admin (control room, status rail, asset page) keeps its
// English words whatever the channel speaks; the public page gets them from the catalogue.
describe("the status in the channel language", () => {
  const ALL = ["running", "switching", "degraded", "starting", "recovering", "reconnecting", "idle", "standby", "failed", "", "x"];

  it("gives viewers the catalogue's words and the admin its own English", () => {
    expect(ALL.map((status) => getViewerChannelStatusLabel("en", status))).toEqual(ALL.map((status) => getChannelStatusLabel(status)));
    expect(["running", "starting", "failed"].map((status) => getViewerChannelStatusLabel("de", status))).toEqual([
      "Auf Sendung",
      "Startet gerade",
      "Gerade nicht auf Sendung"
    ]);
    // The admin label does not take a language at all: a German channel's operator reads English.
    expect(getChannelStatusLabel.length).toBe(1);
  });

  it("maps every status to one of three kinds, unknown ones to off air", () => {
    expect(ALL.map(getChannelStatusKind)).toEqual([
      "onAir",
      "onAir",
      "onAir",
      "startingUp",
      "startingUp",
      "startingUp",
      "offAir",
      "offAir",
      "offAir",
      "offAir",
      "offAir"
    ]);
  });

  it("describes the state in a line of the viewer's words, never the playout's own message", () => {
    expect(["running", "reconnecting", "failed"].map((status) => getViewerChannelStatusLine("en", status))).toEqual([
      "Playing now.",
      "The stream is starting, back in a moment.",
      "The channel is off air right now."
    ]);
    expect(["running", "reconnecting", "failed"].map((status) => getViewerChannelStatusLine("de", status))).toEqual([
      "Läuft gerade.",
      "Der Stream startet, gleich geht’s weiter.",
      "Der Kanal ist gerade nicht auf Sendung."
    ]);
  });
});
