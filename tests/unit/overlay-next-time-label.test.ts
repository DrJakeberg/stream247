import { describe, expect, it } from "vitest";
import { OVERLAY_NO_NEXT_BLOCK, overlayNextTimeLabel } from "@stream247/core";

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
  /**
   * Every file that mentions the label at all, not the three I happened to remember. Adversarial
   * review showed the first version of this waved through the multi-line form — which is the exact
   * shape the worker's live-bridge site had the week before — because the assignment and the times
   * sat on different lines, and it never looked at scene-preview-request.ts.
   *
   * This is a source-text guard and it knows it: a hoisted `const label = ...` far from the
   * assignment, or a different wording for the fallback, still slips past. What holds behaviourally
   * is that one function decides the format; this only makes reintroducing a second one awkward
   * enough to notice in review.
   */
  const sources = [
    "apps/web/app/(admin)/overlay-studio/page.tsx",
    "apps/web/components/overlay-settings-form.tsx",
    "apps/web/lib/scene-preview-request.ts",
    "apps/web/lib/server/scene-preview-renderer.ts",
    "apps/web/lib/server/state.ts",
    "apps/worker/src/index.ts"
  ];

  /** The lines within five either side of one that mentions the label. */
  function windowsAround(source: string): string[] {
    const lines = source.split("\n");
    const windows: string[] = [];
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index]!.includes("nextTimeLabel")) {
        continue;
      }
      windows.push(lines.slice(Math.max(0, index - 5), index + 6).join("\n"));
    }
    return windows;
  }

  it("leaves the formatting to the one function, wherever the label is mentioned", async () => {
    const { readFileSync } = await import("node:fs");
    for (const path of sources) {
      const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
      const offenders = windowsAround(source).filter((window) => /startTime|endTime/.test(window));
      // The pages' own prose may still say "20:00 to 22:00" — that is a sentence a reader reads,
      // not a string the channel broadcasts. What may not happen is a time being built beside the
      // payload field it feeds.
      expect({ path, offenders: offenders.length }).toEqual({ path, offenders: 0 });
    }
  });

  it("keeps the one string that says there is nothing next", async () => {
    const { readFileSync } = await import("node:fs");
    for (const path of sources) {
      const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
      expect({ path, repeated: source.includes(OVERLAY_NO_NEXT_BLOCK) }).toEqual({ path, repeated: false });
    }
  });

  it("covers every file that mentions the label, so a new one cannot appear unwatched", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(new URL(`../../${dir}`, import.meta.url))) {
        if (entry === "node_modules" || entry === "dist" || entry === ".next") continue;
        const path = `${dir}/${entry}`;
        if (statSync(new URL(`../../${path}`, import.meta.url)).isDirectory()) {
          walk(path);
        } else if (/\.tsx?$/.test(entry) && readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").includes("nextTimeLabel")) {
          found.push(path);
        }
      }
    };
    walk("apps");
    expect(found.sort()).toEqual([...sources].sort());
  });
});
