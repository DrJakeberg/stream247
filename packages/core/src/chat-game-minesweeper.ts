// Minesweeper as a chat game.
//
// The whole room plays one board: anyone can call a coordinate ("b3") and the cell is dug the
// moment the message arrives. Digging a mine ends the round for everyone, clearing every safe
// cell wins it — the classic rules, unchanged, because the audience already knows them.
//
// Everything here is pure and deterministic. The mines are placed by the state's own seed on the
// first dig — never under it, so the round cannot end on input one — and no clock exists anywhere:
// an untouched board stays untouched forever, exactly like every game on this framework.

import {
  chatGameColumnLabel,
  nextChatGameSeed,
  type ChatGameCell,
  type ChatGameDefinition,
  type ChatGameInput,
  type ChatGameRenderCell,
  type ChatGameRenderModel,
  type ChatGameSettings
} from "./chat-game.js";

export type MinesweeperGameState = {
  phase: "playing" | "over";
  /** Only meaningful once the phase is "over": a cleared board, or a dug mine. */
  won: boolean;
  /** False until the first dig commits the layout; the mines depend on where that dig lands. */
  minesPlaced: boolean;
  mines: ChatGameCell[];
  revealed: ChatGameCell[];
  /** The most recent dig — on a lost round, the mine that ended it. */
  lastDig: ChatGameCell | null;
  /** Revealed safe cells, which is what the game-over card reports. */
  score: number;
  /** Deterministic PRNG cursor for the mine layout, advanced when the board commits. */
  seed: number;
};

/**
 * Mine density around fourteen percent — the classic beginner-to-intermediate band. Derived from
 * the grid, so the operator's one grid choice also sets the difficulty; the floor keeps the
 * smallest allowed grid a game of judgement rather than a coin flip.
 */
export function minesweeperMineCount(settings: ChatGameSettings): number {
  return Math.max(4, Math.round(settings.gridWidth * settings.gridHeight * 0.14));
}

function cellKey(cell: ChatGameCell): string {
  return `${String(cell.x)},${String(cell.y)}`;
}

function isOnGrid(cell: ChatGameCell, settings: ChatGameSettings): boolean {
  return cell.x >= 0 && cell.x < settings.gridWidth && cell.y >= 0 && cell.y < settings.gridHeight;
}

function listNeighbours(cell: ChatGameCell, settings: ChatGameSettings): ChatGameCell[] {
  const neighbours: ChatGameCell[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const next = { x: cell.x + dx, y: cell.y + dy };
      if (isOnGrid(next, settings)) {
        neighbours.push(next);
      }
    }
  }
  return neighbours;
}

function countAdjacentMines(cell: ChatGameCell, mineKeys: Set<string>, settings: ChatGameSettings): number {
  return listNeighbours(cell, settings).filter((neighbour) => mineKeys.has(cellKey(neighbour))).length;
}

function createInitialMinesweeperState(settings: ChatGameSettings, seed: number): MinesweeperGameState {
  return {
    phase: "playing",
    won: false,
    minesPlaced: false,
    mines: [],
    revealed: [],
    lastDig: null,
    score: 0,
    seed: seed & 0x7fffffff
  };
}

/**
 * Commits the board: mines land on seed-chosen cells, never on the first dig. Choosing by index
 * among the remaining free cells makes the layout a pure function of seed and first dig — both
 * containers and every test agree on it without sharing a Math.random.
 */
function placeMines(
  settings: ChatGameSettings,
  firstDig: ChatGameCell,
  seed: number
): { mines: ChatGameCell[]; seed: number } {
  const free: ChatGameCell[] = [];
  for (let y = 0; y < settings.gridHeight; y += 1) {
    for (let x = 0; x < settings.gridWidth; x += 1) {
      if (x !== firstDig.x || y !== firstDig.y) {
        free.push({ x, y });
      }
    }
  }

  const mines: ChatGameCell[] = [];
  let cursor = seed;
  const count = Math.min(minesweeperMineCount(settings), free.length - 1);
  for (let index = 0; index < count; index += 1) {
    cursor = nextChatGameSeed(cursor);
    mines.push(free.splice(cursor % free.length, 1)[0]!);
  }

  return { mines, seed: cursor };
}

/**
 * Reveals the dug cell and, from every cell that touches no mine, its whole neighbourhood — the
 * classic cascade, stopping at the numbered frontier. Iterative so a large open board cannot
 * recurse past the stack.
 */
function floodReveal(
  start: ChatGameCell,
  mineKeys: Set<string>,
  alreadyRevealed: Set<string>,
  settings: ChatGameSettings
): ChatGameCell[] {
  const gained: ChatGameCell[] = [];
  const seen = new Set(alreadyRevealed);
  const queue: ChatGameCell[] = [start];
  seen.add(cellKey(start));

  while (queue.length > 0) {
    const cell = queue.shift()!;
    gained.push(cell);
    if (countAdjacentMines(cell, mineKeys, settings) > 0) {
      continue;
    }
    for (const neighbour of listNeighbours(cell, settings)) {
      const key = cellKey(neighbour);
      if (!seen.has(key) && !mineKeys.has(key)) {
        seen.add(key);
        queue.push(neighbour);
      }
    }
  }

  return gained;
}

function applyMinesweeperInput(
  state: MinesweeperGameState,
  input: ChatGameInput,
  settings: ChatGameSettings
): MinesweeperGameState {
  // A finished round waits for chat: the next accepted coordinate starts the new round and is
  // consumed by the restart, exactly like the snake's game-over card.
  if (state.phase === "over") {
    return createInitialMinesweeperState(settings, nextChatGameSeed(state.seed));
  }

  // A direction is not a minesweeper move; the resolver never produces one while this game is
  // active, so this is pure defence for direct callers.
  if (!("cell" in input)) {
    return state;
  }

  const cell = input.cell;
  if (!isOnGrid(cell, settings)) {
    return state;
  }

  const revealedKeys = new Set(state.revealed.map(cellKey));
  // Digging an already open cell moves nothing — the message was chat talking about the board,
  // not playing it, so the state stays identical and nothing is persisted.
  if (revealedKeys.has(cellKey(cell))) {
    return state;
  }

  // The first dig commits the board, never onto itself: a round that can end on its opening move
  // is not a game, it is a lottery drawn against the room.
  const committed = state.minesPlaced ? { mines: state.mines, seed: state.seed } : placeMines(settings, cell, state.seed);
  const mineKeys = new Set(committed.mines.map(cellKey));

  if (mineKeys.has(cellKey(cell))) {
    return {
      ...state,
      minesPlaced: true,
      mines: committed.mines,
      seed: committed.seed,
      lastDig: cell,
      phase: "over",
      won: false
    };
  }

  const revealed = [...state.revealed, ...floodReveal(cell, mineKeys, revealedKeys, settings)];
  const cleared = revealed.length === settings.gridWidth * settings.gridHeight - committed.mines.length;

  return {
    ...state,
    minesPlaced: true,
    mines: committed.mines,
    seed: committed.seed,
    revealed,
    lastDig: cell,
    score: revealed.length,
    phase: cleared ? "over" : "playing",
    won: cleared
  };
}

function renderMinesweeperModel(state: MinesweeperGameState, settings: ChatGameSettings): ChatGameRenderModel {
  const mineKeys = new Set(state.mines.map(cellKey));
  const cells: ChatGameRenderCell[] = state.revealed.map((cell) => {
    const count = countAdjacentMines(cell, mineKeys, settings);
    // A zero stays unlabeled: the open area reads as terrain, the numbers read as the frontier.
    return count > 0 ? { x: cell.x, y: cell.y, kind: "revealed" as const, label: String(count) } : { x: cell.x, y: cell.y, kind: "revealed" as const };
  });

  // The mines stay the game's secret until the round is decided; then they are the story of how
  // it ended — or, on a cleared board, of everything the room dug around.
  if (state.phase === "over") {
    for (const mine of state.mines) {
      cells.push({ x: mine.x, y: mine.y, kind: "mine" });
    }
  }

  const safeTotal =
    settings.gridWidth * settings.gridHeight -
    (state.minesPlaced ? state.mines.length : minesweeperMineCount(settings));

  return {
    gameId: "minesweeper",
    gridWidth: settings.gridWidth,
    gridHeight: settings.gridHeight,
    cells,
    // Viewer-facing only: this text is burned into the broadcast, so it names what the audience
    // does, never the machinery behind it.
    headline: "Chat plays Minesweeper",
    statusLine:
      state.phase === "over"
        ? `${state.won ? "Board cleared" : "Game over"} · Score ${String(state.score)}`
        : `Cleared ${String(state.score)} of ${String(safeTotal)}`,
    hintLine:
      state.phase === "over"
        ? "Send a cell like b3 to start the next round"
        : `Dig with column and row like b3 — a to ${chatGameColumnLabel(settings.gridWidth - 1)}, 1 to ${String(settings.gridHeight)}`,
    showCoordinates: true,
    phase: state.phase
  };
}

function isCellRecordOnGrid(value: unknown, settings: ChatGameSettings): value is ChatGameCell {
  if (!value || typeof value !== "object") {
    return false;
  }
  const cell = value as Record<string, unknown>;
  return (
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    isOnGrid({ x: cell.x as number, y: cell.y as number }, settings)
  );
}

function areCellsDistinct(cells: ChatGameCell[]): boolean {
  return new Set(cells.map(cellKey)).size === cells.length;
}

/**
 * Revives a persisted minesweeper state. Anything no sequence of legal digs could have produced —
 * a revealed mine, a score that disagrees with the revealed cells, a board dug before it was
 * committed — yields null and the caller starts a fresh round, because continuing a corrupted
 * round would render an impossible board on air.
 */
function parseMinesweeperState(raw: unknown, settings: ChatGameSettings): MinesweeperGameState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const state = raw as Record<string, unknown>;
  if (state.phase !== "playing" && state.phase !== "over") {
    return null;
  }
  if (typeof state.won !== "boolean" || (state.phase === "playing" && state.won)) {
    return null;
  }
  if (typeof state.minesPlaced !== "boolean") {
    return null;
  }
  if (!Array.isArray(state.mines) || !state.mines.every((cell) => isCellRecordOnGrid(cell, settings))) {
    return null;
  }
  if (!Array.isArray(state.revealed) || !state.revealed.every((cell) => isCellRecordOnGrid(cell, settings))) {
    return null;
  }

  const mines = (state.mines as ChatGameCell[]).map((cell) => ({ x: cell.x, y: cell.y }));
  const revealed = (state.revealed as ChatGameCell[]).map((cell) => ({ x: cell.x, y: cell.y }));
  if (!areCellsDistinct(mines) || !areCellsDistinct(revealed)) {
    return null;
  }
  // An uncommitted board has neither mines nor holes; a committed one has mines but not only mines.
  const totalCells = settings.gridWidth * settings.gridHeight;
  if (state.minesPlaced) {
    if (mines.length === 0 || mines.length >= totalCells) {
      return null;
    }
  } else if (mines.length > 0 || revealed.length > 0) {
    return null;
  }
  const mineKeys = new Set(mines.map(cellKey));
  if (revealed.some((cell) => mineKeys.has(cellKey(cell)))) {
    return null;
  }
  if (state.lastDig !== null && !isCellRecordOnGrid(state.lastDig, settings)) {
    return null;
  }
  if (!Number.isInteger(state.score) || state.score !== revealed.length) {
    return null;
  }
  if (!Number.isInteger(state.seed) || (state.seed as number) < 0) {
    return null;
  }

  return {
    phase: state.phase,
    won: state.won,
    minesPlaced: state.minesPlaced,
    mines,
    revealed,
    lastDig: state.lastDig === null ? null : { x: (state.lastDig as ChatGameCell).x, y: (state.lastDig as ChatGameCell).y },
    score: state.score as number,
    seed: state.seed as number
  };
}

export const MINESWEEPER_GAME_DEFINITION: ChatGameDefinition<MinesweeperGameState> = {
  id: "minesweeper",
  createInitialState: createInitialMinesweeperState,
  applyInput: applyMinesweeperInput,
  renderModel: renderMinesweeperModel,
  parseState: parseMinesweeperState
};
