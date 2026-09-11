"use client";

import { useRef, useState } from "react";
import {
  overlayScale,
  resolvePlacementPercent,
  resolvePlacementPixelBox,
  resolvePlacementSafeArea,
  type OverlayPlacementView
} from "@stream247/core";
import {
  intersectDesignBoxes,
  PLACEMENT_KEY_STEP_COARSE_DESIGN_PX,
  PLACEMENT_KEY_STEP_DESIGN_PX,
  placementSnapTargets,
  snapMovedBox,
  snapResizedBox,
  type DesignBox,
  type ResizeEdge,
  type SnapTargets
} from "@/lib/overlay-placement-drag";

/**
 * Direct manipulation on top of the frame the broadcast renderer drew.
 *
 * This layer draws no overlay of its own. It sits above the renderer's SVG and draws nothing but
 * outlines, grips and guides — the studio drew its own HTML imitation of the picture once and
 * disagreed with it on the safe area, the clamps and the scale all at once, and that imitation was
 * deleted. So while a panel is being dragged only an outline moves, locally and immediately; on
 * release the percents are committed and the renderer draws the real frame again. The last good
 * frame stays on screen until the new one arrives.
 *
 * The coordinate chain, in one place and in this order:
 *
 *   pointer (client px)
 *     - container origin      -> container px
 *     / preview scale         -> output px      (the size the channel actually encodes)
 *     / overlayScale(width)   -> design px      (the 1920x1080 grid the renderer is written in)
 *     snap, in design px
 *     * overlayScale(width)   -> output px
 *     resolvePlacementPercent -> percent        (the renderer's own inverse)
 */

export type PlacementTarget = {
  id: string;
  label: string;
  placement: OverlayPlacementView;
  /** A logo or image drawn with fit: contain keeps the shape it has while it is resized. */
  lockAspect?: boolean;
};

type DragState = {
  id: string;
  pointerId: number;
  edges: ResizeEdge[];
  origin: DesignBox;
  startX: number;
  startY: number;
  box: DesignBox;
  guides: SnapTargets;
};

const GRIPS: Array<{ edges: ResizeEdge[]; name: string }> = [
  { edges: ["left", "top"], name: "nw" },
  { edges: ["top"], name: "n" },
  { edges: ["right", "top"], name: "ne" },
  { edges: ["right"], name: "e" },
  { edges: ["right", "bottom"], name: "se" },
  { edges: ["bottom"], name: "s" },
  { edges: ["left", "bottom"], name: "sw" },
  { edges: ["left"], name: "w" }
];

function round(value: number): number {
  return Math.round(value);
}

/** "x 120 · y 840 · 1180 × 220" — the box in design pixels, the unit the sidebar also reads in. */
export function describeDesignBox(box: DesignBox): string {
  return `x ${String(round(box.left))} · y ${String(round(box.top))} · ${String(round(box.width))} × ${String(round(box.height))}`;
}

export function OverlayPlacementCanvas(props: {
  frame: { width: number; height: number };
  targets: PlacementTarget[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCommit: (id: string, percent: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number }) => void;
  onOverlapChange: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const scale = overlayScale(props.frame.width);
  const designFrame = { width: props.frame.width / scale, height: props.frame.height / scale };

  /** Every target's box in design pixels, resolved by the renderer's own resolver. */
  const designBoxes = new Map<string, DesignBox>();
  for (const target of props.targets) {
    const pixels = resolvePlacementPixelBox(target.placement, props.frame);
    designBoxes.set(target.id, {
      left: pixels.left / scale,
      top: pixels.top / scale,
      width: pixels.width / scale,
      height: pixels.height / scale
    });
  }

  const boxOf = (id: string): DesignBox => designBoxes.get(id) ?? { left: 0, top: 0, width: 0, height: 0 };

  const safeAreaFor = (target: PlacementTarget): DesignBox => {
    const safe = resolvePlacementSafeArea(props.frame, target.placement.allowOutsideSafeArea === true);
    return { left: safe.left / scale, top: safe.top / scale, width: safe.width / scale, height: safe.height / scale };
  };

  const targetsFor = (id: string): SnapTargets => {
    const target = props.targets.find((entry) => entry.id === id);
    const neighbours = props.targets.filter((entry) => entry.id !== id).map((entry) => boxOf(entry.id));
    return placementSnapTargets(target ? safeAreaFor(target) : boxOf(id), designFrame, neighbours);
  };

  /** Design pixels back to percents, through the renderer's inverse. Nothing else may do this. */
  const commit = (id: string, box: DesignBox) => {
    const target = props.targets.find((entry) => entry.id === id);
    props.onCommit(
      id,
      resolvePlacementPercent(
        { left: box.left * scale, top: box.top * scale, width: box.width * scale, height: box.height * scale },
        props.frame,
        { allowOutsideSafeArea: target?.placement.allowOutsideSafeArea === true }
      )
    );
  };

  const describeOverlaps = (id: string, box: DesignBox): string => {
    const hits: string[] = [];
    for (const other of props.targets) {
      if (other.id === id) {
        continue;
      }
      const shared = intersectDesignBoxes(box, boxOf(other.id));
      if (shared) {
        hits.push(`${other.label} (${describeDesignBox(shared)})`);
      }
    }

    return hits.length > 0 ? `Overlapping ${hits.join(", ")}` : "";
  };

  const beginDrag = (event: React.PointerEvent<HTMLElement>, id: string, edges: ResizeEdge[]) => {
    if (event.button !== 0) {
      return;
    }
    // preventDefault stops the browser from starting a text selection across the preview; it also
    // stops the click from moving focus, so the box takes focus itself. It has to have it: the
    // arrow keys are the only way to ask for a single design pixel.
    event.preventDefault();
    event.stopPropagation();
    props.onSelect(id);
    event.currentTarget.closest<HTMLElement>(".placement-box")?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = boxOf(id);
    setDrag({
      id,
      pointerId: event.pointerId,
      edges,
      origin,
      startX: event.clientX,
      startY: event.clientY,
      box: origin,
      guides: { x: [], y: [] }
    });
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const container = containerRef.current;
    if (!drag || !container || event.pointerId !== drag.pointerId) {
      return;
    }

    const rect = container.getBoundingClientRect();
    // container px -> output px -> design px. previewScale is measured, never assumed: the shell is
    // fluid, so at 1440 viewport it is about 0.4 and on a narrow one far less.
    const previewScale = rect.width / props.frame.width;
    const dx = (event.clientX - drag.startX) / previewScale / scale;
    const dy = (event.clientY - drag.startY) / previewScale / scale;
    const free = event.altKey || event.ctrlKey || event.metaKey;
    const target = props.targets.find((entry) => entry.id === drag.id);
    const lines = targetsFor(drag.id);

    let next: { box: DesignBox; guides: SnapTargets };
    if (drag.edges.length === 0) {
      next = snapMovedBox({ ...drag.origin, left: drag.origin.left + dx, top: drag.origin.top + dy }, lines, { free });
    } else {
      const held = new Set(drag.edges);
      const candidate: DesignBox = {
        left: drag.origin.left + (held.has("left") ? dx : 0),
        top: drag.origin.top + (held.has("top") ? dy : 0),
        width: drag.origin.width + (held.has("right") ? dx : 0) - (held.has("left") ? dx : 0),
        height: drag.origin.height + (held.has("bottom") ? dy : 0) - (held.has("top") ? dy : 0)
      };
      // The shape to hold is the one the box has right now, read off the resolved box rather than
      // off the two percents — those measure against different axes and their quotient is not a
      // shape.
      const aspect =
        target?.lockAspect && drag.origin.height > 0 ? drag.origin.width / drag.origin.height : undefined;
      next = snapResizedBox(candidate, drag.edges, lines, { free, aspect });
    }

    setDrag({ ...drag, box: next.box, guides: next.guides });
    props.onOverlapChange(describeOverlaps(drag.id, next.box));
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    commit(drag.id, drag.box);
    setDrag(null);
    props.onOverlapChange("");
  };

  /**
   * Arrow keys, in percent space rather than through the resolved box.
   *
   * Necessary, not fussy. resolvePlacementPixelBox rounds to whole OUTPUT pixels, and at 1280x720
   * one output pixel is 1.5 design pixels — so nudging the *resolved* box by one design pixel and
   * converting back lands on the next drawable pixel, and eight presses then add up to 8.5 design
   * pixels instead of eight. Measured: 0.0285% of drift over one shift-press, half a design pixel.
   * Moving the stored percent by exactly one design pixel's worth keeps eight presses equal to one
   * shift-press, and lets the drawn box stand still on the presses where the output pixel does not
   * change — which is the truth about a 720p frame, not a bug to hide.
   */
  const nudge = (event: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    const step = event.shiftKey ? PLACEMENT_KEY_STEP_COARSE_DESIGN_PX : PLACEMENT_KEY_STEP_DESIGN_PX;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    const shift = delta[event.key];
    const target = props.targets.find((entry) => entry.id === id);
    if (!shift || !target) {
      return;
    }

    event.preventDefault();
    const safe = resolvePlacementSafeArea(props.frame, target.placement.allowOutsideSafeArea === true);
    props.onCommit(id, {
      xPercent: target.placement.xPercent + ((shift[0] * scale) / safe.width) * 100,
      yPercent: target.placement.yPercent + ((shift[1] * scale) / safe.height) * 100,
      widthPercent: target.placement.widthPercent,
      heightPercent: target.placement.heightPercent
    });
  };

  const percent = (value: number, of: number) => `${String((value / of) * 100)}%`;

  return (
    <div className="placement-canvas" ref={containerRef}>
      {drag
        ? [
            ...drag.guides.x.map((line) => (
              <span className="placement-guide placement-guide-x" key={`x${String(line)}`} style={{ left: percent(line, designFrame.width) }} />
            )),
            ...drag.guides.y.map((line) => (
              <span className="placement-guide placement-guide-y" key={`y${String(line)}`} style={{ top: percent(line, designFrame.height) }} />
            ))
          ]
        : null}

      {props.targets.map((target) => {
        const box = drag?.id === target.id ? drag.box : boxOf(target.id);
        const selected = props.selectedId === target.id;
        return (
          <button
            aria-label={`${target.label}: ${describeDesignBox(box)}. Drag to move, arrow keys to nudge.`}
            aria-pressed={selected}
            className="placement-box"
            data-dragging={drag?.id === target.id ? "true" : "false"}
            data-selected={selected ? "true" : "false"}
            key={target.id}
            onKeyDown={(event) => nudge(event, target.id)}
            onPointerCancel={endDrag}
            onPointerDown={(event) => beginDrag(event, target.id, [])}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            style={{
              left: percent(box.left, designFrame.width),
              top: percent(box.top, designFrame.height),
              width: percent(box.width, designFrame.width),
              height: percent(box.height, designFrame.height)
            }}
            type="button"
          >
            {/* The name is drawn for the selected box only. Every box carries it in its aria-label
                either way; drawing six of them at once would put six labels side by side in the
                page's extracted text, where "Now playing" and "Up next" become one camelCase word
                the wording baseline is right to object to. */}
            {selected ? <span className="placement-box-name">{target.label}</span> : null}
            {selected
              ? GRIPS.map((grip) => (
                  <span
                    className={`placement-grip placement-grip-${grip.name}`}
                    key={grip.name}
                    onPointerCancel={endDrag}
                    onPointerDown={(event) => beginDrag(event, target.id, grip.edges)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                  />
                ))
              : null}
          </button>
        );
      })}
    </div>
  );
}
