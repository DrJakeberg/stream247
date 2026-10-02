import { sortProgrammingAssets, type ProgrammingOrderAsset } from "./programming-asset-order.js";

// How a pool walks its items (M73). Owner decision 2026-10-01: a pool with several sources alternates
// between them, Twitch -> YouTube -> Twitch ..., and each source plays its own items oldest first.
//
// Until then a pool was ONE list in the M72 order plus ONE stored pointer (the last started item).
// Measured on the DUT that day, pool "TwitchYoutube" held a Twitch channel (46 archives of 5-11 h) and a
// YouTube channel (11 videos of 4-60 min). One date-sorted list plays the sources as blocks, so a YouTube
// item came back only after all 46 archives, 10 to 21 days of airtime. And the single pointer had to be
// found in the FILTERED list: when it was not there the selection fell back to the head. It was not there
// on every operator or chat Skip (the skipped item is the pointer, and it is filtered out), on quarantine,
// a VOD-cache cooldown, an operator exclusion or a vanished asset, so a Skip restarted the pool at its
// oldest item instead of moving on.
//
// The rotation therefore keeps one position per source (`pools.source_cursors`) next to the pointer, and
// positions an item in its source's FULL ordered list, eligible or not. An item that cannot play right now
// is stepped over; it is never a reason to start again from the head.
//
// Every place that walks a pool uses this one function (worker selection and queue, lookahead, schedule
// preview, materialized week), so what the operator is shown is what the worker picks. It is pure and
// deterministic: no clock, no randomness, and the order depends only on the comparator, never on the
// order the database returned the rows in.
//
// The source circuit breaker (M75, source-circuit-breaker.ts) reaches the rotation as a gate: an open
// source is a lane with nothing eligible, so the alternation goes on with the other sources, and a
// half-open source gives one item per walk, its trial, before the lane closes again for the rest of it.

export type PoolRotationPool = {
  sourceIds: readonly string[];
  cursorAssetId?: string;
  sourceCursors?: Readonly<Record<string, string>>;
};

/** What a pool stores about its position: the last started item, and the last started item per source. */
export type PoolRotationState = {
  cursorAssetId: string;
  sourceCursors: Record<string, string>;
  /**
   * Half-open sources that already gave their one trial item in this walk. Never stored: the worker
   * stores the pointer and the map only, and the next cycle's walk starts from the breaker as it is then.
   */
  spentTrialSourceIds?: string[];
};

/**
 * What the source circuit breaker lets the rotation take (`sourceBreakerGate`). Held sources give
 * nothing; trial sources give one item per walk, the first the rotation reaches, so a source that is
 * still broken costs one probe, not one per alternation step of the queue.
 */
export type PoolRotationSourceGate = {
  heldSourceIds: readonly string[];
  trialSourceIds: readonly string[];
};

export type PoolRotationPick<T> = {
  asset: T;
  sourceId: string;
  /** The state once this item has started, which is what the worker stores. */
  state: PoolRotationState;
};

export type PoolRotation<T> = {
  /** The next item after `state`, or null when no source of the pool has an eligible item. */
  next(state: PoolRotationState): PoolRotationPick<T> | null;
  /** The state once `assetId` has started; an id outside the pool's sources moves only the pointer. */
  start(state: PoolRotationState, assetId: string): PoolRotationState;
};

/**
 * The stored per-source positions, read defensively: anything but a JSON object of non-empty strings
 * contributes nothing. A broken value costs each source its position (it restarts at its oldest item),
 * never the pool.
 */
export function parsePoolSourceCursors(value: unknown): Record<string, string> {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value || "{}");
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const cursors: Record<string, string> = {};
  for (const [sourceId, assetId] of Object.entries(parsed as Record<string, unknown>)) {
    if (sourceId && sourceId !== "__proto__" && typeof assetId === "string" && assetId) {
      cursors[sourceId] = assetId;
    }
  }
  return cursors;
}

export function poolRotationStateOf(pool: Pick<PoolRotationPool, "cursorAssetId" | "sourceCursors">): PoolRotationState {
  return {
    cursorAssetId: pool.cursorAssetId ?? "",
    sourceCursors: parsePoolSourceCursors(pool.sourceCursors ?? {})
  };
}

// The pointer is the last started item, so it always says where its own source stands, over whatever the
// map holds for that source. 2.1 writes both together, so they agree; they differ only after an older
// writer moved the pointer alone. A pool that ran before the map existed has only the pointer: without
// it, the first pick after the upgrade would move to the next source and forget where the last one was.
// An image older than 2.1 that runs after a rollback also moves only the pointer, so a stale map entry
// that outranked it would replay every archive the older image aired in between once 2.1 is back.
function withPointerPosition(
  state: PoolRotationState,
  pointerSourceId: string | undefined,
  sourceIds: readonly string[]
): Record<string, string> {
  if (!pointerSourceId || !sourceIds.includes(pointerSourceId) || state.sourceCursors[pointerSourceId] === state.cursorAssetId) {
    return state.sourceCursors;
  }
  return { ...state.sourceCursors, [pointerSourceId]: state.cursorAssetId };
}

/** Where each source of the pool stands: the item it continues after (as the rotation reads it). */
export function poolSourcePositions(
  pool: PoolRotationPool,
  assets: readonly Pick<ProgrammingOrderAsset, "id" | "sourceId">[]
): Record<string, string> {
  const state = poolRotationStateOf(pool);
  const pointerSourceId = state.cursorAssetId ? assets.find((asset) => asset.id === state.cursorAssetId)?.sourceId : undefined;
  return withPointerPosition(state, pointerSourceId, pool.sourceIds);
}

type RotationLane<T> = {
  sourceId: string;
  // Every asset of the source that still exists, in the shared order: positions are taken here.
  ordered: T[];
  positionById: Map<string, number>;
  // Which of them may be picked now.
  eligible: boolean[];
  hasEligible: boolean;
};

export function createPoolRotation<T extends ProgrammingOrderAsset>(args: {
  sourceIds: readonly string[];
  assets: readonly T[];
  isEligible: (asset: T) => boolean;
  sourceGate?: PoolRotationSourceGate | null;
}): PoolRotation<T> {
  const heldSourceIds = new Set(args.sourceGate?.heldSourceIds ?? []);
  const trialSourceIds = new Set(args.sourceGate?.trialSourceIds ?? []);
  const assetById = new Map<string, T>();
  for (const asset of args.assets) {
    assetById.set(asset.id, asset);
  }
  const lanes: RotationLane<T>[] = [];
  for (const sourceId of args.sourceIds) {
    if (!sourceId || lanes.some((lane) => lane.sourceId === sourceId)) {
      continue;
    }
    const ordered = sortProgrammingAssets(args.assets.filter((asset) => asset.sourceId === sourceId));
    // Positions stay in the full list, as for any other ineligible item: when the breaker closes, the
    // source carries on after its stored position instead of at its oldest item.
    const held = heldSourceIds.has(sourceId);
    const eligible = ordered.map((asset) => !held && args.isEligible(asset));
    lanes.push({
      sourceId,
      ordered,
      positionById: new Map(ordered.map((asset, index) => [asset.id, index])),
      eligible,
      hasEligible: eligible.includes(true)
    });
  }
  const laneIndexOf = (sourceId: string) => lanes.findIndex((lane) => lane.sourceId === sourceId);

  const laneSourceIds = lanes.map((lane) => lane.sourceId);
  const effectiveCursors = (state: PoolRotationState): Record<string, string> =>
    withPointerPosition(state, assetById.get(state.cursorAssetId)?.sourceId, laneSourceIds);

  // The source the last started item came from. A vanished item is recognised through the per-source
  // map; anything else (no pointer, an item of a source no longer in the pool) is unknown.
  const lastSourceOf = (state: PoolRotationState): string => {
    if (!state.cursorAssetId) {
      return "";
    }
    const cursorAsset = assetById.get(state.cursorAssetId);
    if (cursorAsset) {
      return cursorAsset.sourceId;
    }
    return lanes.find((lane) => state.sourceCursors[lane.sourceId] === state.cursorAssetId)?.sourceId ?? "";
  };

  const isAvailable = (lane: RotationLane<T>, state: PoolRotationState): boolean =>
    lane.hasEligible && !(state.spentTrialSourceIds ?? []).includes(lane.sourceId);

  // Spending is recorded only for a trial source, so a walk without a half-open breaker returns
  // states exactly as before M75.
  const spendTrial = (state: PoolRotationState, sourceId: string): Pick<PoolRotationState, "spentTrialSourceIds"> => {
    const spent = state.spentTrialSourceIds ?? [];
    if (!trialSourceIds.has(sourceId) || spent.includes(sourceId)) {
      return spent.length > 0 ? { spentTrialSourceIds: spent } : {};
    }
    return { spentTrialSourceIds: [...spent, sourceId] };
  };

  const nextLane = (state: PoolRotationState): RotationLane<T> | null => {
    const lastIndex = laneIndexOf(lastSourceOf(state));
    if (lastIndex === -1) {
      return lanes.find((lane) => isAvailable(lane, state)) ?? null;
    }
    // Step `lanes.length` ends on the last source itself: a one-source pool, or a pool whose other
    // sources have nothing to play, stays on that source.
    for (let step = 1; step <= lanes.length; step += 1) {
      const lane = lanes[(lastIndex + step) % lanes.length];
      if (lane && isAvailable(lane, state)) {
        return lane;
      }
    }
    return null;
  };

  const pickInLane = (lane: RotationLane<T>, anchorId: string): T | null => {
    const anchor = anchorId ? lane.positionById.get(anchorId) : undefined;
    if (anchor === undefined) {
      const first = lane.eligible.indexOf(true);
      return first === -1 ? null : lane.ordered[first] ?? null;
    }
    // Step `ordered.length` ends on the anchor itself, which plays again only when nothing else can.
    for (let step = 1; step <= lane.ordered.length; step += 1) {
      const index = (anchor + step) % lane.ordered.length;
      if (lane.eligible[index]) {
        return lane.ordered[index] ?? null;
      }
    }
    return null;
  };

  return {
    next(state) {
      const lane = nextLane(state);
      if (!lane) {
        return null;
      }
      const cursors = effectiveCursors(state);
      const asset = pickInLane(lane, cursors[lane.sourceId] ?? "");
      if (!asset) {
        return null;
      }
      return {
        asset,
        sourceId: lane.sourceId,
        state: {
          cursorAssetId: asset.id,
          sourceCursors: { ...cursors, [lane.sourceId]: asset.id },
          ...spendTrial(state, lane.sourceId)
        }
      };
    },
    start(state, assetId) {
      const cursors = effectiveCursors(state);
      const asset = assetById.get(assetId);
      if (!asset || laneIndexOf(asset.sourceId) === -1) {
        return { cursorAssetId: assetId, sourceCursors: cursors, ...spendTrial(state, "") };
      }
      // An item of a half-open source that starts now is that source's trial.
      return {
        cursorAssetId: asset.id,
        sourceCursors: { ...cursors, [asset.sourceId]: asset.id },
        ...spendTrial(state, asset.sourceId)
      };
    }
  };
}

/** The item a pool plays next, and the state once it has started. */
export function nextPoolRotationAsset<T extends ProgrammingOrderAsset>(args: {
  pool: PoolRotationPool;
  assets: readonly T[];
  isEligible: (asset: T) => boolean;
  sourceGate?: PoolRotationSourceGate | null;
}): PoolRotationPick<T> | null {
  return createPoolRotation({
    sourceIds: args.pool.sourceIds,
    assets: args.assets,
    isEligible: args.isEligible,
    sourceGate: args.sourceGate
  }).next(poolRotationStateOf(args.pool));
}

/**
 * The next `steps` items, each one started before the next is picked: the same sequence as `steps`
 * single picks with the state stored in between, except that a half-open source gives one item per walk
 * (its trial). Shorter only when nothing is eligible.
 */
export function walkPoolRotation<T extends ProgrammingOrderAsset>(args: {
  pool: PoolRotationPool;
  assets: readonly T[];
  isEligible: (asset: T) => boolean;
  sourceGate?: PoolRotationSourceGate | null;
  steps: number;
  /** Walk from the state once this item has started instead of from the stored state. */
  afterAssetId?: string;
}): PoolRotationPick<T>[] {
  const rotation = createPoolRotation({
    sourceIds: args.pool.sourceIds,
    assets: args.assets,
    isEligible: args.isEligible,
    sourceGate: args.sourceGate
  });
  let state = poolRotationStateOf(args.pool);
  if (args.afterAssetId) {
    state = rotation.start(state, args.afterAssetId);
  }
  const picks: PoolRotationPick<T>[] = [];
  for (let step = 0; step < Math.max(0, Math.floor(args.steps)); step += 1) {
    const pick = rotation.next(state);
    if (!pick) {
      break;
    }
    picks.push(pick);
    state = pick.state;
  }
  return picks;
}
