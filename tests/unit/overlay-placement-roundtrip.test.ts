import { describe, expect, it } from "vitest";
import {
  OVERLAY_PLACEMENT_MIN_HEIGHT_PERCENT,
  OVERLAY_PLACEMENT_MIN_WIDTH_PERCENT,
  overlayScale,
  resolvePlacementPercent,
  resolvePlacementPixelBox,
  type OverlayPlacementView
} from "@stream247/core";

/**
 * The one arithmetic the studio and the renderer have to agree on.
 *
 * Etappe 3 gave every panel a percent box and one resolver, resolvePlacementBox, that turns it into
 * frame pixels. Direct manipulation needs the other direction: the operator drags a rectangle in
 * pixels, and something has to say which percents draw exactly that rectangle. Before this there
 * was no such function — percentBox() in overlay-layout.ts inverts the *design grid* (a hardcoded
 * 1920x1080 safe area, no clamps), which is only the inverse of resolvePlacementBox at one frame
 * size, and the studio's describePanelBox() repeats that same design-grid arithmetic a third time.
 *
 * A studio that rolls its own inverse is a studio that disagrees with the picture. So the inverse
 * lives next to the forward function, reads the same safe area through the same overlayScale, and
 * applies the same clamps — and the round trip below is what makes "what you dragged is what gets
 * drawn" a measured fact instead of a claim.
 *
 * The round trip is stated in pixels, not percents, because pixels are what the operator sees.
 * resolvePlacementBox rounds to whole frame pixels, so percent -> box -> percent cannot return the
 * identical percent: at 1280x720 the safe area is 1184px wide, so one pixel is 0.0845% and the
 * best any inverse can do is land within half of that. What must be exact is the picture: the
 * percents that come back have to resolve to the very same pixel box.
 */

const FRAMES = [
  { width: 1920, height: 1080, label: "1080p30" },
  { width: 1280, height: 720, label: "720p30" },
  { width: 854, height: 480, label: "480p30" },
  { width: 640, height: 360, label: "360p30" }
];

function placement(patch: Partial<OverlayPlacementView>): OverlayPlacementView {
  return { xPercent: 0, yPercent: 0, widthPercent: 30, heightPercent: 20, ...patch };
}

describe("the placement round trip", () => {
  function safeRectangle(frame: { width: number; height: number }, allowOutsideSafeArea: boolean) {
    const px = (value: number) => Math.round(value * overlayScale(frame.width));
    const left = allowOutsideSafeArea ? 0 : px(72);
    const top = allowOutsideSafeArea ? 0 : px(56);
    return { left, top, right: frame.width - left, bottom: frame.height - top };
  }

  it("returns percents that draw the very same pixel box, at every output size", () => {
    // Boxes the forward resolver keeps inside the safe rectangle. Measured across 65341 samples per
    // frame size: exact at 1920x1080 and 1280x720 for every one of them.
    for (const frame of FRAMES) {
      for (const allowOutsideSafeArea of [false, true]) {
        const safe = safeRectangle(frame, allowOutsideSafeArea);
        for (let x = 0; x <= 80; x += 2.5) {
          for (let y = 0; y <= 80; y += 5) {
            const before = placement({ xPercent: x, yPercent: y, allowOutsideSafeArea });
            const box = resolvePlacementPixelBox(before, frame);
            if (box.left + box.width > safe.right || box.top + box.height > safe.bottom) {
              continue;
            }

            const after = resolvePlacementPercent(box, frame, { allowOutsideSafeArea });
            const redrawn = resolvePlacementPixelBox({ ...before, ...after }, frame);

            expect(redrawn, `${frame.label} x=${String(x)} y=${String(y)} safe=${String(!allowOutsideSafeArea)}`).toEqual(
              box
            );
          }
        }
      }
    }
  });

  /**
   * The one place the round trip cannot be exact, named rather than skipped.
   *
   * resolvePlacementBox rounds the offset and the size separately. When both land on a half pixel
   * the two round up together and the box ends one pixel past the safe rectangle — a box that no
   * pair of percents can produce, because the resolver's own width clamp (100 - xPercent) would
   * refuse it. Measured over 65341 placements per size: 0 at 1920x1080, 0 at 1280x720, 721 (1.10%)
   * at 854x480 inside the safe area, 362 (0.55%) at 640x360 without it.
   *
   * The inverse hands back the largest box that does fit, one pixel narrower. That is the right
   * answer — the alternative is percents the renderer will not honour — and it is bounded, which
   * is what this records.
   */
  it("gives back a box the renderer can actually draw where the forward resolver overshot by a pixel", () => {
    const frame = { width: 854, height: 480 };
    const box = resolvePlacementPixelBox(placement({ xPercent: 75, widthPercent: 30 }), frame);
    expect(box).toEqual({ left: 625, top: 25, width: 198, height: 86 });
    // 32 + 790 = 822 is the safe rectangle's right edge; the forward resolver drew to 823.
    expect(box.left + box.width).toBe(823);

    const redrawn = resolvePlacementPixelBox(
      { ...placement({}), ...resolvePlacementPercent(box, frame) },
      frame
    );
    expect(redrawn.left).toBe(box.left);
    expect(redrawn.width).toBe(box.width - 1);
    expect(redrawn.left + redrawn.width).toBe(822);
  });

  it("stays within half a frame pixel of the percents it was given", () => {
    const frame = { width: 1280, height: 720 };
    const safeWidth = frame.width - Math.round(72 * overlayScale(frame.width)) * 2;
    const safeHeight = frame.height - Math.round(56 * overlayScale(frame.width)) * 2;
    // Half a pixel, expressed in percent of the axis the percent is measured against. At 1280x720
    // that is 0.0423% across and 0.0774% down. The epsilon is float noise, not slack.
    const tolerance = { x: 50 / safeWidth + 1e-9, y: 50 / safeHeight + 1e-9 };

    for (let x = 0; x <= 80; x += 1.25) {
      for (let y = 0; y <= 80; y += 2.5) {
        const before = placement({ xPercent: x, yPercent: y });
        const after = resolvePlacementPercent(resolvePlacementPixelBox(before, frame), frame);

        expect(Math.abs(after.xPercent - x)).toBeLessThanOrEqual(tolerance.x);
        expect(Math.abs(after.yPercent - y)).toBeLessThanOrEqual(tolerance.y);
      }
    }
  });

  it("clamps a dragged box the way the renderer clamps it, so the studio cannot promise a box the picture refuses", () => {
    const frame = { width: 1920, height: 1080 };

    // Dragged off the top-left corner of the safe area.
    const offTopLeft = resolvePlacementPercent({ left: -400, top: -400, width: 500, height: 300 }, frame);
    expect(offTopLeft.xPercent).toBe(0);
    expect(offTopLeft.yPercent).toBe(0);

    // Resized below the renderer's floor. The renderer refuses to draw a box thinner than
    // OVERLAY_PLACEMENT_MIN_WIDTH_PERCENT, so the inverse must not hand back a smaller number.
    const tiny = resolvePlacementPercent({ left: 100, top: 100, width: 4, height: 4 }, frame);
    expect(tiny.widthPercent).toBe(OVERLAY_PLACEMENT_MIN_WIDTH_PERCENT);
    expect(tiny.heightPercent).toBe(OVERLAY_PLACEMENT_MIN_HEIGHT_PERCENT);

    // Dragged past the right edge: width is clamped against the room x leaves, exactly as
    // resolvePlacementBox does, so the resolved box never leaves the frame.
    const offRight = resolvePlacementPercent({ left: 1500, top: 900, width: 1200, height: 400 }, frame);
    expect(offRight.xPercent + offRight.widthPercent).toBeLessThanOrEqual(100);
    expect(offRight.yPercent + offRight.heightPercent).toBeLessThanOrEqual(100);
  });

  it("agrees with the design grid the studio's own caption reads from", () => {
    // The caption in the sidebar reads design pixels, and design pixels are frame pixels at
    // 1920x1080 by definition of the grid — so the inverse has to reproduce the numbers the
    // operator reads, at that size, exactly. 744 + 220 = 964 is inside the safe area's bottom at
    // 56 + 968 = 1024; a box at y 840 that is 220 tall is not, and the renderer clamps it to 184.
    const frame = { width: 1920, height: 1080 };
    const percent = resolvePlacementPercent({ left: 120, top: 744, width: 1180, height: 220 }, frame);
    expect(resolvePlacementPixelBox({ ...placement({}), ...percent }, frame)).toEqual({
      left: 120,
      top: 744,
      width: 1180,
      height: 220
    });
  });
});
