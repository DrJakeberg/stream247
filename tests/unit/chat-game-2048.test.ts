import { describe, expect, it } from "vitest";
import {
  GAME_2048_DEFINITION,
  createDefaultChatGameSettings,
  resolveChatGameInput,
  type ChatGameSettings,
  type Game2048State
} from "@stream247/core";

/**
 * 2048 for chat: the exact emote map that steers the snake slides the tiles, one accepted message,
 * one move. The board is always four by four — the tiles carry numbers, and numbers need cells big
 * enough to read on a broadcast frame. These tests pin the slide-and-merge rules, the seeded tile
 * spawn, the end of a round, and the determinism promise of the framework.
 */

const SETTINGS: ChatGameSettings = createDefaultChatGameSettings();

/** A mid-round state with every tile placed by the test, not by the seed. Row-major, 0 is empty. */
function playingState(tiles: number[], overrides: Partial<Game2048State> = {}): Game2048State {
  return { phase: "playing", tiles, score: 0, seed: 7, ...overrides };
}

function row(state: Game2048State, y: number): number[] {
  return state.tiles.slice(y * 4, y * 4 + 4);
}

describe("2048 determinism", () => {
  it("produces the same end state for the same seed and the same move sequence", () => {
    const run = () => {
      let state = GAME_2048_DEFINITION.createInitialState(SETTINGS, 42);
      for (const direction of ["left", "up", "right", "down", "left", "down"] as const) {
        state = GAME_2048_DEFINITION.applyInput(state, { direction }, SETTINGS);
      }
      return JSON.stringify(state);
    };

    expect(run()).toBe(run());
  });

  it("starts every round with exactly two starter tiles on the board", () => {
    for (const seed of [0, 1, 42, 999]) {
      const state = GAME_2048_DEFINITION.createInitialState(SETTINGS, seed);
      const tiles = state.tiles.filter((value) => value > 0);

      expect(state.tiles).toHaveLength(16);
      expect(tiles).toHaveLength(2);
      expect(tiles.every((value) => value === 2 || value === 4)).toBe(true);
      expect(state.score).toBe(0);
    }
  });
});

describe("2048 sliding and merging", () => {
  it("merges one pair and spawns exactly one new tile", () => {
    const state = playingState([
      2, 2, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0
    ]);
    const next = GAME_2048_DEFINITION.applyInput(state, { direction: "left" }, SETTINGS);

    expect(next.tiles[0]).toBe(4);
    expect(next.score).toBe(4);
    // The merged pair became one tile; the move spawned one more.
    expect(next.tiles.filter((value) => value > 0)).toHaveLength(2);
  });

  it("merges each tile at most once per move", () => {
    const state = playingState([
      2, 2, 2, 2,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0
    ]);
    const next = GAME_2048_DEFINITION.applyInput(state, { direction: "left" }, SETTINGS);

    expect(row(next, 0).slice(0, 2)).toEqual([4, 4]);
    expect(next.score).toBe(8);
  });

  it("merges towards the wall the tiles slide into", () => {
    const state = playingState([
      2, 2, 2, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0
    ]);
    const next = GAME_2048_DEFINITION.applyInput(state, { direction: "left" }, SETTINGS);

    expect(row(next, 0).slice(0, 2)).toEqual([4, 2]);
  });

  it("adds every merged tile to the score", () => {
    const state = playingState([
      2, 2, 4, 4,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0
    ]);
    const next = GAME_2048_DEFINITION.applyInput(state, { direction: "left" }, SETTINGS);

    expect(row(next, 0).slice(0, 2)).toEqual([4, 8]);
    expect(next.score).toBe(12);
  });

  it("rejects a move that changes nothing, without spawning a tile", () => {
    const state = playingState([
      2, 4, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0
    ]);
    const next = GAME_2048_DEFINITION.applyInput(state, { direction: "left" }, SETTINGS);

    expect(next).toBe(state);
  });

  it("rejects a cell input, which is not a 2048 move at all", () => {
    const state = playingState([2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    expect(GAME_2048_DEFINITION.applyInput(state, { cell: { x: 1, y: 1 } }, SETTINGS)).toBe(state);
  });
});

describe("2048 round lifecycle", () => {
  it("ends the round when the spawned tile leaves no legal move", () => {
    // Row 0 packs left and frees exactly one cell; the spawn fills it with a 2 or a 4, and every
    // neighbour of that cell is 8 or higher, so the board is dead whichever value the seed picks.
    const state = playingState([
      0, 8, 16, 8,
      16, 8, 32, 16,
      8, 16, 8, 32,
      16, 8, 16, 8
    ]);
    const next = GAME_2048_DEFINITION.applyInput(state, { direction: "left" }, SETTINGS);

    expect(next.phase).toBe("over");
    expect(next.tiles.every((value) => value > 0)).toBe(true);
  });

  it("holds the game-over state until the next input, which restarts instead of moving", () => {
    const over = playingState([2, 4, 8, 16, 32, 64, 128, 256, 2, 4, 8, 16, 32, 64, 128, 256], {
      phase: "over",
      score: 900
    });
    const next = GAME_2048_DEFINITION.applyInput(over, { direction: "up" }, SETTINGS);

    expect(next.phase).toBe("playing");
    expect(next.score).toBe(0);
    // The restart consumed the input: a fresh board with its two starter tiles, unmoved.
    expect(next.tiles.filter((value) => value > 0)).toHaveLength(2);
  });
});

describe("persisted 2048 state revival", () => {
  it("revives a played round byte for byte", () => {
    let state = GAME_2048_DEFINITION.createInitialState(SETTINGS, 11);
    state = GAME_2048_DEFINITION.applyInput(state, { direction: "left" }, SETTINGS);
    state = GAME_2048_DEFINITION.applyInput(state, { direction: "down" }, SETTINGS);

    const revived = GAME_2048_DEFINITION.parseState(JSON.parse(JSON.stringify(state)), SETTINGS);

    expect(revived).toEqual(state);
  });

  it("rejects a board that is not sixteen power-of-two tiles", () => {
    expect(GAME_2048_DEFINITION.parseState(playingState([2, 4]), SETTINGS)).toBeNull();
    expect(
      GAME_2048_DEFINITION.parseState(playingState([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), SETTINGS)
    ).toBeNull();
    expect(
      GAME_2048_DEFINITION.parseState(playingState([-2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), SETTINGS)
    ).toBeNull();
  });

  it("rejects shapes that are not a 2048 state at all", () => {
    expect(GAME_2048_DEFINITION.parseState(null, SETTINGS)).toBeNull();
    expect(GAME_2048_DEFINITION.parseState("tiles", SETTINGS)).toBeNull();
    expect(GAME_2048_DEFINITION.parseState({ phase: "playing", tiles: "full" }, SETTINGS)).toBeNull();
  });
});

describe("2048 render model", () => {
  it("draws every tile with its value and plays on its own four by four board", () => {
    const state = playingState([
      2, 0, 0, 0,
      0, 64, 0, 0,
      0, 0, 128, 0,
      0, 0, 0, 2048
    ]);
    const model = GAME_2048_DEFINITION.renderModel(state, SETTINGS);

    expect(model.gridWidth).toBe(4);
    expect(model.gridHeight).toBe(4);
    expect(model.cells).toHaveLength(4);
    expect(model.cells.find((cell) => cell.x === 0 && cell.y === 0)?.label).toBe("2");
    // The big tiles are the story of the round, so they carry the stronger mark.
    expect(model.cells.find((cell) => cell.x === 1 && cell.y === 1)?.kind).toBe("tile");
    expect(model.cells.find((cell) => cell.x === 2 && cell.y === 2)?.kind).toBe("tile-strong");
    expect(model.cells.find((cell) => cell.x === 3 && cell.y === 3)?.label).toBe("2048");
  });

  it("names the configured emotes in the hint and the score in both phases", () => {
    const playing = GAME_2048_DEFINITION.renderModel(playingState([2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { score: 36 }), SETTINGS);
    for (const emote of Object.values(SETTINGS.emoteMap)) {
      expect(playing.hintLine).toContain(emote);
    }
    expect(playing.statusLine).toContain("36");

    const over = GAME_2048_DEFINITION.renderModel(
      playingState([2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { phase: "over", score: 36 }),
      SETTINGS
    );
    expect(over.statusLine).toContain("Game over");
    expect(over.statusLine).toContain("36");
  });
});

describe("direction input resolution for 2048", () => {
  const settings: ChatGameSettings = { ...SETTINGS, gameId: "2048" };

  it("reuses the snake emote map unchanged", () => {
    expect(resolveChatGameInput("⬆", settings)).toEqual({ direction: "up" });
    expect(resolveChatGameInput("➡ ⬅", settings)).toEqual({ direction: "right" });
  });

  it("ignores coordinates and plain words", () => {
    expect(resolveChatGameInput("b3", settings)).toBeNull();
    expect(resolveChatGameInput("up", settings)).toBeNull();
  });
});
