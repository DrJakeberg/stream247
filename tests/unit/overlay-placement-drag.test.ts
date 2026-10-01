import { describe, expect, it } from "vitest";
import {
  intersectDesignBoxes,
  PLACEMENT_GRID_DESIGN_PX,
  PLACEMENT_SNAP_THRESHOLD_DESIGN_PX,
  placementSnapTargets,
  snapMovedBox,
  snapResizedBox,
  type DesignBox
} from "@/lib/overlay-placement-drag";

/**
 * The arithmetic between the pointer and the percent box.
 *
 * All of it in design pixels, because that is the only unit the operator's numbers mean anything
 * in: the grid is 8 design pixels because the renderer's own spacing is, and the snap threshold is
 * 6 because at preview scale 0.4 a pointer is only accurate to +/-2.5 design pixels — a threshold
 * below that would be a coin toss.
 *
 * Kept out of the React component on purpose. A pointer handler cannot be measured; this can.
 */

const SAFE: DesignBox = { left: 72, top: 56, width: 1776, height: 968 };
const FRAME = { width: 1920, height: 1080 };

function box(left: number, top: number, width: number, height: number): DesignBox {
  return { left, top, width, height };
}

describe("placement snapping", () => {
  it("offers the safe area, the frame edge, and every neighbour's edges and centres", () => {
    const targets = placementSnapTargets(SAFE, FRAME, [box(400, 200, 200, 100)]);

    // Frame edges and centre.
    expect(targets.x).toContain(0);
    expect(targets.x).toContain(1920);
    expect(targets.x).toContain(960);
    // Safe area.
    expect(targets.x).toContain(72);
    expect(targets.x).toContain(1848);
    // The neighbour: left, centre, right.
    expect(targets.x).toContain(400);
    expect(targets.x).toContain(500);
    expect(targets.x).toContain(600);
    expect(targets.y).toContain(200);
    expect(targets.y).toContain(250);
    expect(targets.y).toContain(300);
  });

  it("snaps a move to the 8-pixel grid, and the modifier turns it off", () => {
    const targets = placementSnapTargets(SAFE, FRAME, []);

    const snapped = snapMovedBox(box(403, 197, 200, 100), targets, { free: false });
    expect(snapped.box.left % PLACEMENT_GRID_DESIGN_PX).toBe(0);
    expect(snapped.box.top % PLACEMENT_GRID_DESIGN_PX).toBe(0);
    expect(snapped.box.left).toBe(400);
    expect(snapped.box.top).toBe(200);
    // The size never changes on a move.
    expect(snapped.box.width).toBe(200);
    expect(snapped.box.height).toBe(100);

    const free = snapMovedBox(box(403, 197, 200, 100), targets, { free: true });
    expect(free.box).toEqual(box(403, 197, 200, 100));
    expect(free.guides.x).toEqual([]);
  });

  it("prefers a neighbour's edge over the grid, inside the threshold, and reports the guide", () => {
    const neighbour = box(405, 300, 200, 100);
    const targets = placementSnapTargets(SAFE, FRAME, [neighbour]);

    // 403 is 3 from the neighbour's left edge at 405 and 3 from the grid line at 400. The edge
    // wins: aligning with a panel is what the operator is trying to do; the grid is the fallback.
    const snapped = snapMovedBox(box(403, 600, 200, 100), targets, { free: false });
    expect(snapped.box.left).toBe(405);
    expect(snapped.guides.x).toContain(405);
  });

  it("ignores an edge further away than the threshold", () => {
    const targets = placementSnapTargets(SAFE, FRAME, [box(500, 300, 200, 100)]);
    const distance = PLACEMENT_SNAP_THRESHOLD_DESIGN_PX + 2;
    const snapped = snapMovedBox(box(500 + distance, 600, 200, 100), targets, { free: false });
    expect(snapped.box.left).not.toBe(500);
    expect(snapped.box.left % PLACEMENT_GRID_DESIGN_PX).toBe(0);
  });

  it("snaps a dragged right edge without moving the left one", () => {
    const targets = placementSnapTargets(SAFE, FRAME, []);
    const resized = snapResizedBox(box(400, 200, 203, 100), ["right"], targets, { free: false });
    expect(resized.box.left).toBe(400);
    expect(resized.box.width).toBe(200);
  });

  it("keeps the aspect ratio when the layer asks for it", () => {
    const targets = placementSnapTargets(SAFE, FRAME, []);
    // A 2:1 logo dragged 100 wider: the height follows, and the corner being dragged stays put.
    const resized = snapResizedBox(box(400, 200, 400, 200), ["right", "bottom"], targets, {
      free: true,
      aspect: 2
    });
    expect(resized.box.width / resized.box.height).toBeCloseTo(2, 6);

    const grown = snapResizedBox(box(400, 200, 600, 200), ["right", "bottom"], targets, {
      free: true,
      aspect: 2
    });
    expect(grown.box.width).toBe(600);
    expect(grown.box.height).toBe(300);
    expect(grown.box.left).toBe(400);
    expect(grown.box.top).toBe(200);
  });

  it("never lets a resize collapse the box past nothing", () => {
    const targets = placementSnapTargets(SAFE, FRAME, []);
    const resized = snapResizedBox(box(400, 200, -50, -20), ["left", "top"], targets, { free: true });
    expect(resized.box.width).toBeGreaterThan(0);
    expect(resized.box.height).toBeGreaterThan(0);
  });
});

describe("overlap", () => {
  it("returns the shared rectangle, and nothing when the boxes only touch", () => {
    expect(intersectDesignBoxes(box(0, 0, 100, 100), box(50, 50, 100, 100))).toEqual(box(50, 50, 50, 50));
    expect(intersectDesignBoxes(box(0, 0, 100, 100), box(100, 0, 100, 100))).toBeNull();
    expect(intersectDesignBoxes(box(0, 0, 100, 100), box(200, 200, 10, 10))).toBeNull();
  });

  it("reports a logo lying fully on a panel, because that is allowed and still worth naming", () => {
    expect(intersectDesignBoxes(box(72, 800, 1180, 220), box(1000, 850, 120, 120))).toEqual(
      box(1000, 850, 120, 120)
    );
  });
});
