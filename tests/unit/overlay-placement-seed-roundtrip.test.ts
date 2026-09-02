import { describe, expect, it } from "vitest";
import {
  deriveDefaultPlacements,
  normalizeOverlayScenePanelPlacements,
  OVERLAY_PANEL_IDS,
  resolvePlacementPixelBox
} from "@stream247/core";

/**
 * Taking hold of a panel must not move it.
 *
 * deriveDefaultPlacements exists to say where the flex flow already puts each panel, so that the
 * first act of placing one changes nothing on air. The store then clamps what it is given. If the
 * clamp is tighter than the seed, the promise is broken in the least visible way possible: the
 * studio shows the panel where it was, the operator saves, and the picture moves.
 *
 * Found by dragging. The clock's seed is x 91.6% and the next card's is y 90.7%, both past the
 * store's cap of 90, so both panels jumped the moment they were touched — the clock by 28 design
 * pixels, the next card by 8. The other four seeds were inside the cap, which is why nobody had
 * seen it.
 */
describe("placing a panel does not move it", () => {
  const CHAT_POSITIONS = ["bottom-left", "bottom-right", "top-left", "top-right"];

  it("survives the store's clamps for every panel, anchor and chat corner", () => {
    for (const anchor of ["bottom", "center"]) {
      for (const chatPosition of CHAT_POSITIONS) {
        for (const vote of [false, true]) {
          const seeds = deriveDefaultPlacements(anchor, chatPosition, { vote });
          const stored = normalizeOverlayScenePanelPlacements(
            Object.fromEntries(
              OVERLAY_PANEL_IDS.map((id) => [id, { ...seeds[id], opacityPercent: 100, allowOutsideSafeArea: false }])
            )
          );

          for (const id of OVERLAY_PANEL_IDS) {
            const before = resolvePlacementPixelBox(
              { ...seeds[id], opacityPercent: 100, allowOutsideSafeArea: false },
              { width: 1920, height: 1080 }
            );
            const after = resolvePlacementPixelBox(stored[id]!, { width: 1920, height: 1080 });
            expect(after, `${id} @ ${anchor}/${chatPosition}${vote ? "/vote" : ""}`).toEqual(before);
          }
        }
      }
    }
  });

  it("keeps a panel anchored to the right edge there, rather than at the cap", () => {
    // The clock is 149 design pixels wide against a 1776-pixel safe area, so its left edge is at
    // 91.6% by arithmetic, not by carelessness. A cap of 90 is a cap on where small panels may sit,
    // which is not what a position cap is for.
    const clock = deriveDefaultPlacements("bottom")["clock"];
    expect(clock.xPercent).toBeGreaterThan(90);

    const stored = normalizeOverlayScenePanelPlacements({ clock: { ...clock, opacityPercent: 100 } });
    expect(stored.clock?.xPercent).toBe(clock.xPercent);

    // And it still ends at the safe area's right edge, which is the whole point of its box.
    const box = resolvePlacementPixelBox(stored.clock!, { width: 1920, height: 1080 });
    expect(box.left + box.width).toBe(72 + 1776);
  });
});
