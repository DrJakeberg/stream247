import { describe, expect, it } from "vitest";
import {
  MINESWEEPER_GAME_DEFINITION,
  createDefaultChatGameSettings,
  resolveChatGameInput,
  type ChatGameCell,
  type ChatGameSettings,
  type MinesweeperGameState
} from "@stream247/core";

/**
 * Minesweeper for chat: every dig is a coordinate called in chat ("b3"), the board is seeded from
 * the runtime state, and nothing else ever changes it. These tests pin the rule set — the safe
 * first dig, the flood reveal, both ways a round ends, and the input-consuming restart — plus the
 * determinism promise every game on this framework makes: same seed, same digs, same board.
 */

const SETTINGS: ChatGameSettings = createDefaultChatGameSettings();

/** A mid-round state with every mine placed by the test, not by the seed. */
function playingState(overrides: Partial<MinesweeperGameState> = {}): MinesweeperGameState {
  return {
    phase: "playing",
    won: false,
    minesPlaced: true,
    mines: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 15, y: 8 }
    ],
    revealed: [{ x: 8, y: 4 }],
    lastDig: { x: 8, y: 4 },
    score: 1,
    seed: 7,
    ...overrides
  };
}

function revealedKeys(state: MinesweeperGameState): Set<string> {
  return new Set(state.revealed.map((cell) => `${String(cell.x)},${String(cell.y)}`));
}

describe("minesweeper determinism", () => {
  it("produces the same end state for the same seed and the same dig sequence", () => {
    const digs: ChatGameCell[] = [
      { x: 8, y: 4 },
      { x: 2, y: 1 },
      { x: 12, y: 7 },
      { x: 5, y: 5 }
    ];

    const run = () => {
      let state = MINESWEEPER_GAME_DEFINITION.createInitialState(SETTINGS, 42);
      for (const cell of digs) {
        state = MINESWEEPER_GAME_DEFINITION.applyInput(state, { cell }, SETTINGS);
      }
      return JSON.stringify(state);
    };

    expect(run()).toBe(run());
  });

  it("starts with no mines: the board commits itself only on the first dig", () => {
    const state = MINESWEEPER_GAME_DEFINITION.createInitialState(SETTINGS, 1);

    expect(state.minesPlaced).toBe(false);
    expect(state.mines).toEqual([]);
    expect(state.revealed).toEqual([]);
    expect(state.score).toBe(0);
  });

  it("never places a mine under the first dig, whatever the seed", () => {
    for (const seed of [0, 1, 7, 99, 12345]) {
      const fresh = MINESWEEPER_GAME_DEFINITION.createInitialState(SETTINGS, seed);
      const dug = MINESWEEPER_GAME_DEFINITION.applyInput(fresh, { cell: { x: 3, y: 3 } }, SETTINGS);

      expect(dug.phase).toBe("playing");
      expect(dug.minesPlaced).toBe(true);
      expect(dug.mines.some((mine) => mine.x === 3 && mine.y === 3)).toBe(false);
      expect(dug.score).toBeGreaterThan(0);
    }
  });
});

describe("minesweeper digging", () => {
  it("rejects a dig on an already revealed cell without changing anything", () => {
    const state = playingState();
    const next = MINESWEEPER_GAME_DEFINITION.applyInput(state, { cell: { x: 8, y: 4 } }, SETTINGS);

    expect(next).toBe(state);
  });

  it("rejects a dig outside the grid without changing anything", () => {
    const state = playingState();

    expect(MINESWEEPER_GAME_DEFINITION.applyInput(state, { cell: { x: 99, y: 0 } }, SETTINGS)).toBe(state);
    expect(MINESWEEPER_GAME_DEFINITION.applyInput(state, { cell: { x: -1, y: 2 } }, SETTINGS)).toBe(state);
  });

  it("rejects a direction input, which is not a minesweeper move at all", () => {
    const state = playingState();

    expect(MINESWEEPER_GAME_DEFINITION.applyInput(state, { direction: "up" }, SETTINGS)).toBe(state);
  });

  it("flood-reveals from an open cell up to the numbered frontier", () => {
    // All mines in the top-left corner: digging the far corner must cascade across the open
    // board and stop at the cells that border a mine, which come out numbered.
    const state = playingState({ revealed: [], lastDig: null, score: 0 });
    const next = MINESWEEPER_GAME_DEFINITION.applyInput(state, { cell: { x: 15, y: 0 } }, SETTINGS);

    const keys = revealedKeys(next);
    expect(keys.size).toBeGreaterThan(50);
    expect(keys.has("0,0")).toBe(false);
    expect(keys.has("1,0")).toBe(false);
    expect(next.score).toBe(keys.size);
  });

  it("ends the round on a mine and keeps the score for the game-over card", () => {
    const state = playingState({ score: 5 });
    const next = MINESWEEPER_GAME_DEFINITION.applyInput(state, { cell: { x: 0, y: 0 } }, SETTINGS);

    expect(next.phase).toBe("over");
    expect(next.won).toBe(false);
    expect(next.score).toBe(5);
    expect(next.lastDig).toEqual({ x: 0, y: 0 });
  });

  it("wins the round when the last safe cell is dug", () => {
    const mines = playingState().mines;
    const mineKeys = new Set(mines.map((cell) => `${String(cell.x)},${String(cell.y)}`));
    const safe: ChatGameCell[] = [];
    for (let y = 0; y < SETTINGS.gridHeight; y += 1) {
      for (let x = 0; x < SETTINGS.gridWidth; x += 1) {
        if (!mineKeys.has(`${String(x)},${String(y)}`)) {
          safe.push({ x, y });
        }
      }
    }
    const last = safe[safe.length - 1]!;
    const state = playingState({
      revealed: safe.slice(0, -1),
      score: safe.length - 1,
      lastDig: null
    });

    const next = MINESWEEPER_GAME_DEFINITION.applyInput(state, { cell: last }, SETTINGS);

    expect(next.phase).toBe("over");
    expect(next.won).toBe(true);
    expect(next.score).toBe(safe.length);
  });
});

describe("minesweeper round lifecycle", () => {
  it("holds the game-over state until the next input, which restarts instead of digging", () => {
    const over = playingState({ phase: "over", score: 9 });
    const next = MINESWEEPER_GAME_DEFINITION.applyInput(over, { cell: { x: 4, y: 4 } }, SETTINGS);

    expect(next.phase).toBe("playing");
    expect(next.score).toBe(0);
    // The restart consumed the input: the fresh board has not been dug anywhere yet.
    expect(next.minesPlaced).toBe(false);
    expect(next.revealed).toEqual([]);
  });
});

describe("persisted minesweeper state revival", () => {
  it("revives a played round byte for byte", () => {
    let state = MINESWEEPER_GAME_DEFINITION.createInitialState(SETTINGS, 11);
    state = MINESWEEPER_GAME_DEFINITION.applyInput(state, { cell: { x: 6, y: 3 } }, SETTINGS);

    const revived = MINESWEEPER_GAME_DEFINITION.parseState(JSON.parse(JSON.stringify(state)), SETTINGS);

    expect(revived).toEqual(state);
  });

  it("rejects a state whose cells no longer fit the grid", () => {
    const state = playingState({ mines: [{ x: 15, y: 8 }] });
    const shrunk: ChatGameSettings = { ...SETTINGS, gridWidth: 12 };

    expect(MINESWEEPER_GAME_DEFINITION.parseState(JSON.parse(JSON.stringify(state)), shrunk)).toBeNull();
  });

  it("rejects a revealed mine, which no sequence of legal digs can produce", () => {
    const state = playingState({ revealed: [{ x: 0, y: 0 }] });

    expect(MINESWEEPER_GAME_DEFINITION.parseState(JSON.parse(JSON.stringify(state)), SETTINGS)).toBeNull();
  });

  it("rejects a score that disagrees with the revealed cells", () => {
    const state = playingState({ score: 40 });

    expect(MINESWEEPER_GAME_DEFINITION.parseState(JSON.parse(JSON.stringify(state)), SETTINGS)).toBeNull();
  });

  it("rejects shapes that are not a minesweeper state at all", () => {
    expect(MINESWEEPER_GAME_DEFINITION.parseState(null, SETTINGS)).toBeNull();
    expect(MINESWEEPER_GAME_DEFINITION.parseState("boom", SETTINGS)).toBeNull();
    expect(MINESWEEPER_GAME_DEFINITION.parseState({ phase: "digging" }, SETTINGS)).toBeNull();
  });
});

describe("minesweeper render model", () => {
  it("labels revealed cells with their neighbouring mine count and hides the zeroes", () => {
    // (2,0) borders the mine at (1,0); (8,4) sits in the open middle and touches nothing.
    const state = playingState({
      revealed: [
        { x: 2, y: 0 },
        { x: 8, y: 4 }
      ]
    });
    const model = MINESWEEPER_GAME_DEFINITION.renderModel(state, SETTINGS);

    const frontier = model.cells.find((cell) => cell.x === 2 && cell.y === 0);
    expect(frontier?.kind).toBe("revealed");
    expect(frontier?.label).toBe("1");
    const open = model.cells.find((cell) => cell.x === 8 && cell.y === 4);
    expect(open?.kind).toBe("revealed");
    expect(open?.label).toBeUndefined();
  });

  it("keeps the mines hidden while playing and shows them when the round ends", () => {
    const playing = MINESWEEPER_GAME_DEFINITION.renderModel(playingState(), SETTINGS);
    expect(playing.cells.some((cell) => cell.kind === "mine")).toBe(false);

    const over = MINESWEEPER_GAME_DEFINITION.renderModel(playingState({ phase: "over" }), SETTINGS);
    expect(over.cells.filter((cell) => cell.kind === "mine")).toHaveLength(3);
  });

  it("asks the panel for coordinate labels and teaches the move in the hint", () => {
    const model = MINESWEEPER_GAME_DEFINITION.renderModel(playingState(), SETTINGS);

    expect(model.showCoordinates).toBe(true);
    expect(model.hintLine).toContain("b3");
    expect(model.statusLine).toContain("1");
  });
});

describe("coordinate input resolution", () => {
  const settings: ChatGameSettings = { ...SETTINGS, gameId: "minesweeper" };

  it("maps a coordinate token to its cell, case-insensitively", () => {
    expect(resolveChatGameInput("b3", settings)).toEqual({ cell: { x: 1, y: 2 } });
    expect(resolveChatGameInput("B3", settings)).toEqual({ cell: { x: 1, y: 2 } });
    expect(resolveChatGameInput("dig p9 now", settings)).toEqual({ cell: { x: 15, y: 8 } });
  });

  it("counts a message once, for its first coordinate", () => {
    expect(resolveChatGameInput("b3 c4 d5", settings)).toEqual({ cell: { x: 1, y: 2 } });
  });

  it("ignores coordinates outside the grid and everything that is no coordinate", () => {
    expect(resolveChatGameInput("z9", settings)).toBeNull();
    expect(resolveChatGameInput("a99", settings)).toBeNull();
    expect(resolveChatGameInput("hello chat", settings)).toBeNull();
    expect(resolveChatGameInput("⬆", settings)).toBeNull();
  });
});
