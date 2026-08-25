// Chat-driven games for the on-air overlay.
//
// A game here is a pure state machine: settings describe the rules, applyInput folds one accepted
// chat input into the state, and renderModel projects the state into what the overlay draws.
// There is deliberately no tick, no timer, and no clock anywhere in the contract — a game advances
// exactly when chat acts and never because time passed. That is the product decision (the snake
// moves one cell per accepted input, full stop), and it is also what makes the native renderer's
// one-frame-per-second cadence sufficient: a frame only changes when an input changed the state.
//
// The worker feeds inputs from the broadcast-channel chat and persists the state; the playout
// container re-derives the render model from that state. Both sides share only what is in this
// file, so everything in it must stay pure and JSON-serialisable.

// Game modules import types and the seed helper from this file; this file imports their
// definitions for the registry. The cycle is safe: the game modules finish evaluating before this
// module's body runs, and the only value they take from here is a hoisted function they call at
// play time, never during evaluation.
import { GAME_2048_DEFINITION, type Game2048State } from "./chat-game-2048.js";
import { MINESWEEPER_GAME_DEFINITION, type MinesweeperGameState } from "./chat-game-minesweeper.js";

export type ChatGameId = "snake" | "minesweeper" | "2048";

export type ChatGameDirection = "up" | "down" | "left" | "right";

/** One emote per direction. The emote is the whole input vocabulary of a game round. */
export type ChatGameEmoteMap = Record<ChatGameDirection, string>;

export type ChatGameSettings = {
  gameId: ChatGameId;
  gridWidth: number;
  gridHeight: number;
  emoteMap: ChatGameEmoteMap;
};

export type ChatGameOptionDefinition = {
  id: ChatGameId;
  label: string;
  description: string;
  /** Which chat vocabulary the game listens to: the emote map, or grid coordinates like "b3". */
  input: "emotes" | "cells";
  /** Whether the operator's grid settings shape this game's board, or the game fixes its own. */
  usesGrid: boolean;
};

export const CHAT_GAMES: ChatGameOptionDefinition[] = [
  {
    id: "snake",
    label: "Snake",
    description: "Chat steers a snake across a grid, one cell per emote. Food grows it, walls and its own body end the round.",
    input: "emotes",
    usesGrid: true
  },
  {
    id: "minesweeper",
    label: "Minesweeper",
    description:
      "Chat digs cells by typing coordinates like b3. Numbers count the mines around a cell; clear every safe cell to win the round.",
    input: "cells",
    usesGrid: true
  },
  {
    id: "2048",
    label: "2048",
    description:
      "Chat slides numbered tiles with the four direction emotes on its own four by four board. Equal tiles merge; the round ends when no move is left.",
    input: "emotes",
    usesGrid: false
  }
];

export const CHAT_GAME_DIRECTIONS: ChatGameDirection[] = ["up", "down", "left", "right"];

// Bounds on the playfield. Below the minimum a round is over in a handful of inputs; above the
// maximum the cells become unreadable at broadcast resolution.
const MIN_GRID_WIDTH = 8;
const MAX_GRID_WIDTH = 32;
const MIN_GRID_HEIGHT = 6;
const MAX_GRID_HEIGHT = 18;

export function createDefaultChatGameSettings(): ChatGameSettings {
  return {
    gameId: "snake",
    gridWidth: 16,
    gridHeight: 9,
    // Arrow emoji without variation selectors, so the stored value is exactly what Twitch delivers
    // when someone types the plain character. Operators replace these with channel emotes.
    emoteMap: { up: "⬆", down: "⬇", left: "⬅", right: "➡" }
  };
}

function clampGridDimension(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * Problems with an emote→direction mapping, written for the operator editing it.
 *
 * An emote must be a single chat token: matching is per whitespace-separated token of the message,
 * so an emote containing a space could never match anything. Duplicates are compared
 * case-insensitively — Twitch emote codes are case-sensitive, but two mappings that differ only in
 * case are far more likely a typo than an intentional control scheme.
 */
export function listChatGameEmoteMapIssues(map: Partial<ChatGameEmoteMap> | null | undefined): string[] {
  const issues: string[] = [];
  const seen = new Map<string, ChatGameDirection>();

  for (const direction of CHAT_GAME_DIRECTIONS) {
    const value = String(map?.[direction] ?? "").trim();
    if (!value) {
      issues.push(`The ${direction} emote is empty.`);
      continue;
    }
    if (/\s/.test(value)) {
      issues.push(`The ${direction} emote contains whitespace and could never match a chat token.`);
      continue;
    }
    const key = value.toLowerCase();
    const existing = seen.get(key);
    if (existing) {
      issues.push(`The ${direction} emote repeats the ${existing} emote.`);
      continue;
    }
    seen.set(key, direction);
  }

  return issues;
}

export function isChatGameEmoteMapValid(map: Partial<ChatGameEmoteMap> | null | undefined): boolean {
  return listChatGameEmoteMapIssues(map).length === 0;
}

/**
 * Normalises whatever a client or an old database row sent into playable settings.
 *
 * The emote map falls back as a whole: patching individual invalid entries would silently produce
 * a control scheme the operator never chose, so a broken map becomes the default map instead.
 */
export function normalizeChatGameSettings(value: Partial<ChatGameSettings> | null | undefined): ChatGameSettings {
  const defaults = createDefaultChatGameSettings();
  const rawMap = value?.emoteMap;
  const trimmedMap: ChatGameEmoteMap = {
    up: String(rawMap?.up ?? "").trim(),
    down: String(rawMap?.down ?? "").trim(),
    left: String(rawMap?.left ?? "").trim(),
    right: String(rawMap?.right ?? "").trim()
  };

  const requestedGameId = value?.gameId;
  return {
    gameId: requestedGameId && CHAT_GAMES.some((game) => game.id === requestedGameId) ? requestedGameId : defaults.gameId,
    gridWidth: clampGridDimension(value?.gridWidth, MIN_GRID_WIDTH, MAX_GRID_WIDTH, defaults.gridWidth),
    gridHeight: clampGridDimension(value?.gridHeight, MIN_GRID_HEIGHT, MAX_GRID_HEIGHT, defaults.gridHeight),
    emoteMap: isChatGameEmoteMapValid(trimmedMap) ? trimmedMap : defaults.emoteMap
  };
}

/**
 * Identity of the rules a round is being played under. When this changes, the running round is
 * meaningless — a 16x9 snake makes no sense on a 12x6 grid — so the worker starts a fresh one.
 */
export function chatGameSettingsKey(settings: ChatGameSettings): string {
  return JSON.stringify([
    settings.gameId,
    settings.gridWidth,
    settings.gridHeight,
    settings.emoteMap.up,
    settings.emoteMap.down,
    settings.emoteMap.left,
    settings.emoteMap.right
  ]);
}

/**
 * Resolves one chat message to at most one direction.
 *
 * Matching is exact per whitespace token — Twitch delivers emote codes as literal message text and
 * codes are case-sensitive, so "kappa" must not trigger a "Kappa" mapping. A message that contains
 * several configured emotes still counts once, for its first one in reading order: one message,
 * one input, no way to multiply moves by pasting.
 */
export function resolveChatGameDirection(message: string, map: ChatGameEmoteMap): ChatGameDirection | null {
  for (const token of message.split(/\s+/)) {
    if (!token) {
      continue;
    }
    for (const direction of CHAT_GAME_DIRECTIONS) {
      if (token === map[direction]) {
        return direction;
      }
    }
  }

  return null;
}

/**
 * The label of a grid column, for coordinate-driven games: 0 → "a", 25 → "z", 26 → "aa". The grid
 * allows up to 32 columns, so the label can grow past a single letter, exactly like it does in a
 * spreadsheet — which is the mental model chat already has for "b3".
 */
export function chatGameColumnLabel(index: number): string {
  let value = index + 1;
  let out = "";
  while (value > 0) {
    out = String.fromCharCode(97 + ((value - 1) % 26)) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

function parseChatGameColumnLetters(letters: string): number {
  let value = 0;
  for (const letter of letters) {
    value = value * 26 + (letter.charCodeAt(0) - 96);
  }
  return value - 1;
}

/**
 * Resolves one chat message to at most one grid cell.
 *
 * A coordinate is a column label and a 1-based row, "b3", matched per whitespace token and
 * case-insensitively — unlike emote codes, coordinates are not chat vocabulary with meaning of
 * their own, so "B3" refusing to dig would read as the game being broken. A message with several
 * coordinates counts once, for its first one that is on the grid: one message, one dig.
 */
export function resolveChatGameCell(message: string, settings: ChatGameSettings): ChatGameCell | null {
  for (const token of message.split(/\s+/)) {
    const match = /^([a-z]{1,2})([1-9][0-9]?)$/.exec(token.toLowerCase());
    if (!match) {
      continue;
    }
    const x = parseChatGameColumnLetters(match[1]!);
    const y = Number(match[2]) - 1;
    if (x < settings.gridWidth && y < settings.gridHeight) {
      return { x, y };
    }
  }

  return null;
}

/**
 * Resolves one chat message into the active game's input, or null when the message is not an
 * input at all. This is the single dispatch point between chat vocabularies: emote-driven games
 * share the configured map, coordinate-driven games read grid cells — and no game ever sees the
 * other vocabulary, so a coordinate can never move the snake.
 */
export function resolveChatGameInput(message: string, settings: ChatGameSettings): ChatGameInput | null {
  const inputKind = CHAT_GAMES.find((game) => game.id === settings.gameId)?.input ?? "emotes";
  if (inputKind === "cells") {
    const cell = resolveChatGameCell(message, settings);
    return cell ? { cell } : null;
  }

  const direction = resolveChatGameDirection(message, settings.emoteMap);
  return direction ? { direction } : null;
}

/**
 * One accepted chat message, resolved into a move. Emote-driven games receive a direction,
 * coordinate-driven games receive a cell; a game handed the other variant treats it as no move
 * at all and returns its state unchanged.
 */
export type ChatGameInput = { direction: ChatGameDirection } | { cell: ChatGameCell };

export type ChatGameCellKind =
  | "snake-head"
  | "snake-body"
  | "food"
  // Minesweeper: a dug cell, and a mine shown once the round is decided.
  | "revealed"
  | "mine"
  // 2048: a numbered tile; the strong variant marks the tiles the round is building towards.
  | "tile"
  | "tile-strong";

export type ChatGameRenderCell = {
  x: number;
  y: number;
  kind: ChatGameCellKind;
  /** Text drawn inside the cell — a mine count, a tile value. Omitted for purely graphic cells. */
  label?: string;
};

/**
 * Everything the overlay needs to draw a game, and nothing else. The renderer must not reach into
 * game state — a second game only has to produce this shape to appear on air.
 */
export type ChatGameRenderModel = {
  gameId: ChatGameId;
  gridWidth: number;
  gridHeight: number;
  cells: ChatGameRenderCell[];
  /** Panel heading, viewer-facing. */
  headline: string;
  /** Current standing, viewer-facing: the score, or the end of a round. */
  statusLine: string;
  /** How to play, built from the configured emotes so it is always literally true. */
  hintLine: string;
  /** Asks the panel to draw column letters and row numbers, for games steered by coordinates. */
  showCoordinates?: boolean;
  phase: "playing" | "over";
};

/**
 * The framework contract. Three pure functions over a serialisable state — deliberately nothing
 * else: no tick, no timer hook, no clock parameter. A game that needs time-driven behaviour does
 * not fit this framework, and that is by design.
 */
export type ChatGameDefinition<TState> = {
  id: ChatGameId;
  createInitialState(settings: ChatGameSettings, seed: number): TState;
  applyInput(state: TState, input: ChatGameInput, settings: ChatGameSettings): TState;
  renderModel(state: TState, settings: ChatGameSettings): ChatGameRenderModel;
  /** Revives a persisted state, or null when it does not fit the settings. Never throws. */
  parseState(raw: unknown, settings: ChatGameSettings): TState | null;
};

export type ChatGameCell = { x: number; y: number };

export type SnakeGameState = {
  phase: "playing" | "over";
  /** Head first. */
  snake: ChatGameCell[];
  /** Where the last accepted move went; reversing into the neck is rejected against this. */
  heading: ChatGameDirection;
  food: ChatGameCell;
  score: number;
  /** Deterministic PRNG cursor for food placement, advanced on every spawn. */
  seed: number;
};

// Plain 31-bit linear congruential generator. Every random-looking decision in a game — food
// placement, mine layout, tile spawns — needs to be deterministic from the state, because both
// containers and every test must agree on the board without sharing a Math.random.
export function nextChatGameSeed(seed: number): number {
  return (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
}

const nextSeed = nextChatGameSeed;

const DIRECTION_DELTAS: Record<ChatGameDirection, ChatGameCell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

const OPPOSITE_DIRECTION: Record<ChatGameDirection, ChatGameDirection> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left"
};

/**
 * Places food on a free cell, chosen by index among the free cells so the walk terminates and the
 * same seed always lands on the same cell. Returns null when the snake fills the board.
 */
function spawnFood(snake: ChatGameCell[], settings: ChatGameSettings, seed: number): { food: ChatGameCell; seed: number } | null {
  const occupied = new Set(snake.map((cell) => `${String(cell.x)},${String(cell.y)}`));
  const free: ChatGameCell[] = [];
  for (let y = 0; y < settings.gridHeight; y += 1) {
    for (let x = 0; x < settings.gridWidth; x += 1) {
      if (!occupied.has(`${String(x)},${String(y)}`)) {
        free.push({ x, y });
      }
    }
  }

  if (free.length === 0) {
    return null;
  }

  const advanced = nextSeed(seed);
  return { food: free[advanced % free.length]!, seed: advanced };
}

function createInitialSnakeState(settings: ChatGameSettings, seed: number): SnakeGameState {
  // Three cells in the middle row, head to the right. Long enough that the no-reversal rule is in
  // force from the first input, short enough that the board is open.
  const headX = Math.floor(settings.gridWidth / 2);
  const y = Math.floor(settings.gridHeight / 2);
  const snake: ChatGameCell[] = [
    { x: headX, y },
    { x: Math.max(0, headX - 1), y },
    { x: Math.max(0, headX - 2), y }
  ];

  const spawned = spawnFood(snake, settings, seed & 0x7fffffff);
  return {
    phase: "playing",
    snake,
    heading: "right",
    // spawnFood only returns null on a full board, which a three-cell snake cannot produce on the
    // smallest allowed grid; the fallback exists so the type holds without a throw in pure code.
    food: spawned?.food ?? { x: 0, y: 0 },
    score: 0,
    seed: spawned?.seed ?? nextSeed(seed & 0x7fffffff)
  };
}

function applySnakeInput(state: SnakeGameState, input: ChatGameInput, settings: ChatGameSettings): SnakeGameState {
  // A finished round waits for chat, not for a timer: the next input starts the new round and is
  // consumed by the restart. Nothing else can leave the "over" phase, so the "game over, score N"
  // card stays up exactly until the room plays again.
  if (state.phase === "over") {
    return createInitialSnakeState(settings, nextSeed(state.seed));
  }

  // A cell input is not a snake move; in production the resolver never produces one while the
  // snake is active, so this is pure defence for direct callers.
  if (!("direction" in input)) {
    return state;
  }

  // Reversing into the neck would be an instant self-collision every time, so the classic rule
  // applies: the opposite of the current heading is not a move. The message was still one accepted
  // emote — it just steers nowhere, exactly like pressing "back" in any snake.
  if (input.direction === OPPOSITE_DIRECTION[state.heading] && state.snake.length > 1) {
    return state;
  }

  const delta = DIRECTION_DELTAS[input.direction];
  const head = state.snake[0]!;
  const next = { x: head.x + delta.x, y: head.y + delta.y };

  // Walls end the round. The board the viewers see is the whole game, so there is no wrapping.
  if (next.x < 0 || next.x >= settings.gridWidth || next.y < 0 || next.y >= settings.gridHeight) {
    return { ...state, phase: "over", heading: input.direction };
  }

  const eating = next.x === state.food.x && next.y === state.food.y;

  // Self-collision, with the classic exception: the tail cell is vacated by this same move unless
  // the snake grows, so moving into it is legal when not eating.
  const body = eating ? state.snake : state.snake.slice(0, -1);
  if (body.some((cell) => cell.x === next.x && cell.y === next.y)) {
    return { ...state, phase: "over", heading: input.direction };
  }

  const snake = [next, ...(eating ? state.snake : state.snake.slice(0, -1))];

  if (!eating) {
    return { ...state, snake, heading: input.direction };
  }

  const spawned = spawnFood(snake, settings, state.seed);
  if (!spawned) {
    // The snake fills the board: there is nothing left to play for, so the round ends here with
    // the food left where it was eaten. renderModel never draws food in the "over" phase.
    return { ...state, snake, heading: input.direction, score: state.score + 1, phase: "over" };
  }

  return {
    ...state,
    snake,
    heading: input.direction,
    score: state.score + 1,
    food: spawned.food,
    seed: spawned.seed
  };
}

function renderSnakeModel(state: SnakeGameState, settings: ChatGameSettings): ChatGameRenderModel {
  const cells: ChatGameRenderCell[] = state.snake.map((cell, index) => ({
    x: cell.x,
    y: cell.y,
    kind: index === 0 ? "snake-head" : "snake-body"
  }));

  if (state.phase === "playing") {
    cells.push({ x: state.food.x, y: state.food.y, kind: "food" });
  }

  const map = settings.emoteMap;
  return {
    gameId: "snake",
    gridWidth: settings.gridWidth,
    gridHeight: settings.gridHeight,
    cells,
    // Viewer-facing only: this text is burned into the broadcast, so it names what the audience
    // does, never the machinery behind it.
    headline: "Chat plays Snake",
    statusLine: state.phase === "over" ? `Game over · Score ${String(state.score)}` : `Score ${String(state.score)}`,
    hintLine:
      state.phase === "over"
        ? "Send any arrow emote to start the next round"
        : `Steer with ${map.up} ${map.down} ${map.left} ${map.right} in chat`,
    phase: state.phase
  };
}

function isChatGameCellOnGrid(value: unknown, settings: ChatGameSettings): value is ChatGameCell {
  if (!value || typeof value !== "object") {
    return false;
  }
  const cell = value as Record<string, unknown>;
  return (
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    (cell.x as number) >= 0 &&
    (cell.x as number) < settings.gridWidth &&
    (cell.y as number) >= 0 &&
    (cell.y as number) < settings.gridHeight
  );
}

/**
 * Revives a persisted snake state. Anything that does not fit the current settings — a resized
 * grid, a truncated JSON blob, a snake with a gap in it — yields null and the caller starts a
 * fresh round, because continuing a corrupted round would render impossible positions on air.
 */
function parseSnakeState(raw: unknown, settings: ChatGameSettings): SnakeGameState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const state = raw as Record<string, unknown>;
  if (state.phase !== "playing" && state.phase !== "over") {
    return null;
  }
  if (!CHAT_GAME_DIRECTIONS.includes(state.heading as ChatGameDirection)) {
    return null;
  }
  if (!Array.isArray(state.snake) || state.snake.length === 0) {
    return null;
  }
  if (!state.snake.every((cell) => isChatGameCellOnGrid(cell, settings))) {
    return null;
  }
  if (!isChatGameCellOnGrid(state.food, settings)) {
    return null;
  }
  // Adjacent segments must touch: a snake with a gap is not a snake state, it is corruption.
  const snake = state.snake as ChatGameCell[];
  for (let index = 1; index < snake.length; index += 1) {
    const gap = Math.abs(snake[index]!.x - snake[index - 1]!.x) + Math.abs(snake[index]!.y - snake[index - 1]!.y);
    if (gap !== 1) {
      return null;
    }
  }
  if (!Number.isInteger(state.score) || (state.score as number) < 0) {
    return null;
  }
  if (!Number.isInteger(state.seed) || (state.seed as number) < 0) {
    return null;
  }

  return {
    phase: state.phase,
    snake: snake.map((cell) => ({ x: cell.x, y: cell.y })),
    heading: state.heading as ChatGameDirection,
    food: { x: (state.food as ChatGameCell).x, y: (state.food as ChatGameCell).y },
    score: state.score as number,
    seed: state.seed as number
  };
}

export const SNAKE_GAME_DEFINITION: ChatGameDefinition<SnakeGameState> = {
  id: "snake",
  createInitialState: createInitialSnakeState,
  applyInput: applySnakeInput,
  renderModel: renderSnakeModel,
  parseState: parseSnakeState
};

/** Any game's state, for the callers that thread state through a definition without opening it. */
export type ChatGameState = SnakeGameState | MinesweeperGameState | Game2048State;

// The one place that maps a game id to its definition. A future game adds its id to ChatGameId,
// registers here, and inherits the whole intake, persistence, and rendering path unchanged.
//
// The casts erase each definition's own state type. That is sound in practice because a
// definition only ever receives states it created or parsed itself — parseState rejects foreign
// shapes, and the worker keys every call on the same settings.gameId that selected the
// definition. TypeScript cannot see that pairing, so it is asserted here, in the one place the
// pairing is made.
const CHAT_GAME_DEFINITIONS: { [K in ChatGameId]: ChatGameDefinition<ChatGameState> } = {
  snake: SNAKE_GAME_DEFINITION as ChatGameDefinition<ChatGameState>,
  minesweeper: MINESWEEPER_GAME_DEFINITION as ChatGameDefinition<ChatGameState>,
  "2048": GAME_2048_DEFINITION as ChatGameDefinition<ChatGameState>
};

export function getChatGameDefinition(gameId: ChatGameId): ChatGameDefinition<ChatGameState> {
  return CHAT_GAME_DEFINITIONS[gameId];
}
