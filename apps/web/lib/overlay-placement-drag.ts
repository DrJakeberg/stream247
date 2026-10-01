// The arithmetic between the pointer and the percent box.
//
// Everything here is in DESIGN pixels — the 1920x1080 grid the renderer's own spacing is written
// in. The pointer arrives in container pixels, is divided by the preview scale to reach output
// pixels, and divided again by overlayScale to reach these. Snapping has to happen here rather
// than in output pixels because the numbers that matter are the renderer's: an 8-pixel grid is
// the renderer's gutter, not a fraction of whatever size the channel happens to encode at.
//
// Deliberately free of React and of the DOM. A pointer handler cannot be measured; this can, and
// tests/unit/overlay-placement-drag.test.ts does.

export type DesignBox = { left: number; top: number; width: number; height: number };

/**
 * The grid a dragged box lands on, in design pixels.
 *
 * Eight, because that is the renderer's own unit: every gap, padding and radius in
 * overlay-layout.ts is a multiple of it at scale 1. A finer grid would let a panel sit one pixel
 * off an edge it was meant to align with, which is the thing an operator cannot see in a preview
 * and can see on air.
 */
export const PLACEMENT_GRID_DESIGN_PX = 8;

/**
 * How close an edge has to be before it pulls, in design pixels.
 *
 * Six. The preview is shown at roughly 0.4 of the output size, so one screen pixel of pointer
 * movement is about 2.5 design pixels: a threshold much below that would fire or not fire
 * depending on which physical pixel the mouse landed on, which reads as the studio being flaky.
 */
export const PLACEMENT_SNAP_THRESHOLD_DESIGN_PX = 6;

/** One arrow key. One design pixel — the finest thing the operator can ask for. */
export const PLACEMENT_KEY_STEP_DESIGN_PX = 1;

/** Shift and an arrow key: one grid cell, so the keyboard and the mouse land on the same lines. */
export const PLACEMENT_KEY_STEP_COARSE_DESIGN_PX = PLACEMENT_GRID_DESIGN_PX;

/** The smallest box a drag may produce before the renderer's own percent floors take over. */
const MIN_DESIGN_SIZE = 8;

export type SnapTargets = { x: number[]; y: number[] };

export type ResizeEdge = "left" | "right" | "top" | "bottom";

function unique(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value * 100) / 100))];
}

/**
 * Every line a dragged box is allowed to stick to.
 *
 * The safe-area rectangle and the frame edge, because those are the two boundaries the picture
 * has; the frame's centre lines, because centring is the most common thing anybody wants; and for
 * each other panel on the frame its two edges and its centre, because aligning with a neighbour is
 * what "designing a layout" mostly consists of.
 */
export function placementSnapTargets(
  safe: DesignBox,
  frame: { width: number; height: number },
  neighbours: DesignBox[]
): SnapTargets {
  const x = [0, frame.width, frame.width / 2, safe.left, safe.left + safe.width, safe.left + safe.width / 2];
  const y = [0, frame.height, frame.height / 2, safe.top, safe.top + safe.height, safe.top + safe.height / 2];

  for (const neighbour of neighbours) {
    x.push(neighbour.left, neighbour.left + neighbour.width / 2, neighbour.left + neighbour.width);
    y.push(neighbour.top, neighbour.top + neighbour.height / 2, neighbour.top + neighbour.height);
  }

  return { x: unique(x), y: unique(y) };
}

/**
 * The line one coordinate should land on, or null.
 *
 * An edge beats the grid whenever it is within the threshold: the grid is the fallback for
 * "somewhere around here", the edge is the operator saying "line this up with that". `free` is the
 * modifier key, and turns both off — the same escape hatch OBS gives.
 */
function snapCoordinate(value: number, targets: number[], free: boolean): { value: number; guide: number | null } {
  if (free) {
    return { value, guide: null };
  }

  let best: number | null = null;
  let bestDistance = PLACEMENT_SNAP_THRESHOLD_DESIGN_PX;
  for (const target of targets) {
    const distance = Math.abs(value - target);
    if (distance <= bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }

  if (best !== null) {
    return { value: best, guide: best };
  }

  return { value: Math.round(value / PLACEMENT_GRID_DESIGN_PX) * PLACEMENT_GRID_DESIGN_PX, guide: null };
}

/**
 * A box being moved: the size is fixed, so only the offset is snapped.
 *
 * All three of the box's own lines are offered to the snapper — leading edge, centre, trailing
 * edge — and whichever gets closest to a target wins, so a panel can be centred on the frame by
 * dragging it roughly into the middle rather than by arithmetic.
 */
export function snapMovedBox(
  box: DesignBox,
  targets: SnapTargets,
  options: { free: boolean }
): { box: DesignBox; guides: SnapTargets } {
  const axis = (
    start: number,
    size: number,
    lines: number[]
  ): { start: number; guide: number | null } => {
    const candidates: Array<{ offset: number; from: number }> = [
      { offset: 0, from: start },
      { offset: size / 2, from: start + size / 2 },
      { offset: size, from: start + size }
    ];

    let winner: { start: number; guide: number | null } | null = null;
    let winnerDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const snapped = snapCoordinate(candidate.from, lines, options.free);
      if (snapped.guide === null) {
        continue;
      }
      const distance = Math.abs(snapped.value - candidate.from);
      if (distance < winnerDistance) {
        winner = { start: snapped.value - candidate.offset, guide: snapped.guide };
        winnerDistance = distance;
      }
    }

    return winner ?? { start: snapCoordinate(start, [], options.free).value, guide: null };
  };

  const horizontal = axis(box.left, box.width, targets.x);
  const vertical = axis(box.top, box.height, targets.y);

  return {
    box: { left: horizontal.start, top: vertical.start, width: box.width, height: box.height },
    guides: {
      x: horizontal.guide === null ? [] : [horizontal.guide],
      y: vertical.guide === null ? [] : [vertical.guide]
    }
  };
}

/**
 * A box being resized: only the edges the operator has hold of move.
 *
 * `aspect` is width divided by height, set for a logo or image drawn with fit: contain. Those are
 * letterboxed inside their box, so a box of the wrong shape does not stretch the picture — it adds
 * empty margin the operator cannot see in the preview and cannot get rid of later. The height
 * follows the width, and the anchored corner stays where it is.
 */
export function snapResizedBox(
  box: DesignBox,
  edges: ResizeEdge[],
  targets: SnapTargets,
  options: { free: boolean; aspect?: number }
): { box: DesignBox; guides: SnapTargets } {
  const held = new Set(edges);
  let { left, top, width, height } = box;
  const guides: SnapTargets = { x: [], y: [] };

  if (held.has("left")) {
    const snapped = snapCoordinate(left, targets.x, options.free);
    width += left - snapped.value;
    left = snapped.value;
    if (snapped.guide !== null) {
      guides.x.push(snapped.guide);
    }
  } else if (held.has("right")) {
    const snapped = snapCoordinate(left + width, targets.x, options.free);
    width = snapped.value - left;
    if (snapped.guide !== null) {
      guides.x.push(snapped.guide);
    }
  }

  if (held.has("top")) {
    const snapped = snapCoordinate(top, targets.y, options.free);
    height += top - snapped.value;
    top = snapped.value;
    if (snapped.guide !== null) {
      guides.y.push(snapped.guide);
    }
  } else if (held.has("bottom")) {
    const snapped = snapCoordinate(top + height, targets.y, options.free);
    height = snapped.value - top;
    if (snapped.guide !== null) {
      guides.y.push(snapped.guide);
    }
  }

  width = Math.max(MIN_DESIGN_SIZE, width);
  height = Math.max(MIN_DESIGN_SIZE, height);

  if (options.aspect && options.aspect > 0) {
    // The width leads, because that is the axis a wide preview gives the operator most room on.
    const nextHeight = Math.max(MIN_DESIGN_SIZE, width / options.aspect);
    if (held.has("top")) {
      top += height - nextHeight;
    }
    height = nextHeight;
    guides.y = [];
  }

  return { box: { left, top, width, height }, guides };
}

/**
 * The rectangle two boxes share, or null.
 *
 * Overlap is named, not forbidden: a logo is *supposed* to be able to sit on a panel. What the
 * operator needs is to be told, with the rectangle, so an accidental collision is distinguishable
 * from a deliberate one. Boxes that merely touch do not overlap — a zero-area intersection is two
 * panels sitting flush, which is what snapping is for.
 */
export function intersectDesignBoxes(first: DesignBox, second: DesignBox): DesignBox | null {
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.left + first.width, second.left + second.width);
  const bottom = Math.min(first.top + first.height, second.top + second.height);

  if (right <= left || bottom <= top) {
    return null;
  }

  return { left, top, width: right - left, height: bottom - top };
}
