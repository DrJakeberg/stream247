import { describe, expect, it } from "vitest";
import { overlayNextTimeLabel } from "@stream247/core";

/**
 * One time format for "up next", because there was one concept and two implementations.
 *
 * apps/web/lib/server/state.ts wrote `${startTime} to ${endTime}` and apps/worker/src/index.ts
 * wrote `${startTime}-${endTime}`, for the same block of the same schedule. So the studio said
 * "20:00 to 22:00" and the channel said "20:00-22:00", and whichever an operator read, the other
 * was what viewers saw.
 *
 * The broadcast wins: the studio preview exists to show what airs, so it is the preview that had to
 * move. Same class of fault as the overlay mode that ran text on air while the studio drew a scene
 * — one concept, two implementations, and nothing making them agree.
 */
describe("next block time label", () => {
  it("writes the block's times the way the broadcast writes them", () => {
    expect(overlayNextTimeLabel({ startTime: "20:00", endTime: "22:00" })).toBe("20:00-22:00");
  });

  it("says so plainly when there is no next block", () => {
    expect(overlayNextTimeLabel(null)).toBe("No next block configured");
    expect(overlayNextTimeLabel(undefined)).toBe("No next block configured");
  });

  it("does not invent a range out of half a block", () => {
    // A schedule row with a missing end is a row to be honest about, not one to render as "20:00-".
    expect(overlayNextTimeLabel({ startTime: "20:00", endTime: "" })).toBe("No next block configured");
    expect(overlayNextTimeLabel({ startTime: "", endTime: "22:00" })).toBe("No next block configured");
  });
});

describe("nobody writes the label themselves any more", () => {
  const sources = [
    "apps/web/lib/server/state.ts",
    "apps/web/app/(admin)/overlay-studio/page.tsx",
    "apps/worker/src/index.ts"
  ];

  it("leaves the formatting to the one function", async () => {
    const { readFileSync } = await import("node:fs");
    for (const path of sources) {
      const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
      // The payload assignment specifically. The pages' own prose may still say "20:00 to 22:00" —
      // that is a sentence a reader reads, not a string the channel broadcasts.
      const inline = source
        .split("\n")
        .filter((line) => line.includes("nextTimeLabel") && /startTime|endTime/.test(line));
      expect({ path, inline }).toEqual({ path, inline: [] });
    }
  });

  it("keeps the one string that says there is nothing next", async () => {
    const { readFileSync } = await import("node:fs");
    for (const path of sources) {
      const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
      expect({ path, repeated: source.includes('"No next block configured"') }).toEqual({
        path,
        repeated: false
      });
    }
  });
});
