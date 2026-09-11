// 2048 as a chat game.
//
// The exact emote map that steers the snake slides the tiles: one accepted message, one move,
// nothing new for the operator to configure and nothing new for chat to learn. The board is always
// four by four regardless of the configured grid — the tiles carry numbers, and numbers need cells
// large enough to stay readable on a broadcast frame; the operator's grid is the snake's playfield,
// not this one.
//
// Everything here is pure and deterministic: tile spawns come from the state's own seed cursor,
// and no clock exists anywhere — an untouched board stays untouched forever.

import {
  nextChatGameSeed,
  type ChatGameDefinition,
  type ChatGameInput,
  type ChatGameRenderCell,
  type ChatGameRenderModel,
  type ChatGameSettings
} from "./chat-game.js";

export type Game2048State = {
  phase: "playing" | "over";
  /** Row-major four-by-four board; 0 is an empty cell, everything else a tile value. */
  tiles: number[];
  /** Classic scoring: every merge adds the merged tile's value. */
  score: number;
  /** Deterministic PRNG cursor for tile spawns, advanced on every spawn. */
  seed: number;
};

const BOARD_SIZE = 4;
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/**
 * Packs and merges one line towards its front — the shared core of all four directions. Each tile
 * merges at most once per move and pairs resolve nearest the wall first, which is the rule set
 * every 2048 player already carries in their head.
 */
function slideLine(line: number[]): { line: number[]; gain: number } {
  const packed = line.filter((value) => value > 0);
  const out: number[] = [];
  let gain = 0;
  for (let index = 0; index < packed.length; index += 1) {
    if (index + 1 < packed.length && packed[index] === packed[index + 1]) {
      const merged = packed[index]! * 2;
      out.push(merged);
      gain += merged;
      index += 1;
    } else {
      out.push(packed[index]!);
    }
  }
  while (out.length < line.length) {
    out.push(0);
  }
  return { line: out, gain };
}

/** Board indices of each line, ordered so the front of the line is the wall the tiles slide into. */
function listLineIndices(direction: "up" | "down" | "left" | "right"): number[][] {
  const lines: number[][] = [];
  for (let line = 0; line < BOARD_SIZE; line += 1) {
    const indices: number[] = [];
    for (let step = 0; step < BOARD_SIZE; step += 1) {
      indices.push(direction === "left" || direction === "right" ? line * BOARD_SIZE + step : step * BOARD_SIZE + line);
    }
    if (direction === "right" || direction === "down") {
      indices.reverse();
    }
    lines.push(indices);
  }
  return lines;
}

function applyMove(
  tiles: number[],
  direction: "up" | "down" | "left" | "right"
): { tiles: number[]; gain: number; changed: boolean } {
  const next = [...tiles];
  let gain = 0;
  let changed = false;

  for (const indices of listLineIndices(direction)) {
    const slid = slideLine(indices.map((index) => tiles[index]!));
    gain += slid.gain;
    indices.forEach((boardIndex, lineIndex) => {
      if (next[boardIndex] !== slid.line[lineIndex]) {
        changed = true;
      }
      next[boardIndex] = slid.line[lineIndex]!;
    });
  }

  return { tiles: next, gain, changed };
}

/**
 * Spawns one tile on a seed-chosen free cell: a 2 nine times out of ten, otherwise a 4 — the
 * classic odds, drawn from the deterministic cursor instead of a Math.random.
 */
function spawnTile(tiles: number[], seed: number): { tiles: number[]; seed: number } {
  const free: number[] = [];
  tiles.forEach((value, index) => {
    if (value === 0) {
      free.push(index);
    }
  });
  if (free.length === 0) {
    return { tiles, seed };
  }

  const positionSeed = nextChatGameSeed(seed);
  const valueSeed = nextChatGameSeed(positionSeed);
  const next = [...tiles];
  next[free[positionSeed % free.length]!] = valueSeed % 10 === 0 ? 4 : 2;
  return { tiles: next, seed: valueSeed };
}

function hasAnyMove(tiles: number[]): boolean {
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const value = tiles[y * BOARD_SIZE + x]!;
      if (value === 0) {
        return true;
      }
      if (x + 1 < BOARD_SIZE && tiles[y * BOARD_SIZE + x + 1] === value) {
        return true;
      }
      if (y + 1 < BOARD_SIZE && tiles[(y + 1) * BOARD_SIZE + x] === value) {
        return true;
      }
    }
  }
  return false;
}

function createInitial2048State(settings: ChatGameSettings, seed: number): Game2048State {
  void settings;
  const empty = new Array<number>(CELL_COUNT).fill(0);
  const first = spawnTile(empty, seed & 0x7fffffff);
  const second = spawnTile(first.tiles, first.seed);
  return { phase: "playing", tiles: second.tiles, score: 0, seed: second.seed };
}

function apply2048Input(state: Game2048State, input: ChatGameInput, settings: ChatGameSettings): Game2048State {
  // A finished round waits for chat: the next accepted emote starts the new round and is consumed
  // by the restart, exactly like the snake's game-over card.
  if (state.phase === "over") {
    return createInitial2048State(settings, nextChatGameSeed(state.seed));
  }

  // A cell is not a 2048 move; the resolver never produces one while this game is active, so this
  // is pure defence for direct callers.
  if (!("direction" in input)) {
    return state;
  }

  const moved = applyMove(state.tiles, input.direction);
  // A slide that moves nothing is not a move — the classic rule. The state stays identical, so
  // nothing spawns and nothing is persisted.
  if (!moved.changed) {
    return state;
  }

  const spawned = spawnTile(moved.tiles, state.seed);
  return {
    phase: hasAnyMove(spawned.tiles) ? "playing" : "over",
    tiles: spawned.tiles,
    score: state.score + moved.gain,
    seed: spawned.seed
  };
}

function render2048Model(state: Game2048State, settings: ChatGameSettings): ChatGameRenderModel {
  const cells: ChatGameRenderCell[] = [];
  state.tiles.forEach((value, index) => {
    if (value === 0) {
      return;
    }
    cells.push({
      x: index % BOARD_SIZE,
      y: Math.floor(index / BOARD_SIZE),
      // From 128 the tile is the story of the round, so it carries the stronger mark.
      kind: value >= 128 ? "tile-strong" : "tile",
      label: String(value)
    });
  });

  const map = settings.emoteMap;
  return {
    gameId: "2048",
    gridWidth: BOARD_SIZE,
    gridHeight: BOARD_SIZE,
    cells,
    // Viewer-facing only: this text is burned into the broadcast, so it names what the audience
    // does, never the machinery behind it.
    headline: "Chat plays 2048",
    statusLine: state.phase === "over" ? `Game over · Score ${String(state.score)}` : `Score ${String(state.score)}`,
    hintLine:
      state.phase === "over"
        ? "Send any arrow emote to start the next round"
        : `Merge with ${map.up} ${map.down} ${map.left} ${map.right} in chat`,
    phase: state.phase
  };
}

/**
 * Revives a persisted 2048 state. Anything that is not sixteen power-of-two tiles with a sane
 * score yields null and the caller starts a fresh round, because continuing a corrupted round
 * would render an impossible board on air.
 */
function parse2048State(raw: unknown, settings: ChatGameSettings): Game2048State | null {
  void settings;
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const state = raw as Record<string, unknown>;
  if (state.phase !== "playing" && state.phase !== "over") {
    return null;
  }
  if (!Array.isArray(state.tiles) || state.tiles.length !== CELL_COUNT) {
    return null;
  }
  const tiles = state.tiles as unknown[];
  const isTileValue = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 && (value === 0 || (value >= 2 && (value & (value - 1)) === 0));
  if (!tiles.every(isTileValue)) {
    return null;
  }
  if (!Number.isInteger(state.score) || (state.score as number) < 0) {
    return null;
  }
  if (!Number.isInteger(state.seed) || (state.seed as number) < 0) {
    return null;
  }

  return {
    phase: state.phase,
    tiles: (tiles as number[]).slice(),
    score: state.score as number,
    seed: state.seed as number
  };
}

export const GAME_2048_DEFINITION: ChatGameDefinition<Game2048State> = {
  id: "2048",
  createInitialState: createInitial2048State,
  applyInput: apply2048Input,
  renderModel: render2048Model,
  parseState: parse2048State
};
