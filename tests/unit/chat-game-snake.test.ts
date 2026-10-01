import { describe, expect, it } from "vitest";
import {
  SNAKE_GAME_DEFINITION,
  createDefaultChatGameSettings,
  type ChatGameSettings,
  type SnakeGameState
} from "@stream247/core";

/**
 * The snake is steered entirely by chat: one accepted input, one cell of movement, and nothing
 * else ever moves it. These tests pin the whole rule set — movement, growth, both ways to die,
 * and the input-consuming restart — against hand-built states, because a game whose rules drift
 * silently is indistinguishable from a broken one to the audience playing it.
 */

const SETTINGS: ChatGameSettings = createDefaultChatGameSettings();

/** A mid-round state with every position chosen by the test, not by the seed. */
function playingState(overrides: Partial<SnakeGameState> = {}): SnakeGameState {
  return {
    phase: "playing",
    snake: [
      { x: 5, y: 4 },
      { x: 4, y: 4 },
      { x: 3, y: 4 }
    ],
    heading: "right",
    food: { x: 12, y: 2 },
    score: 0,
    seed: 7,
    ...overrides
  };
}

describe("snake movement", () => {
  it("moves exactly one cell per accepted input", () => {
    const next = SNAKE_GAME_DEFINITION.applyInput(playingState(), { direction: "up" }, SETTINGS);

    expect(next.snake[0]).toEqual({ x: 5, y: 3 });
    expect(next.snake).toHaveLength(3);
    expect(next.heading).toBe("up");
  });

  it("applies a burst of inputs in arrival order, one cell each", () => {
    let state = playingState();
    for (const direction of ["up", "up", "right", "down"] as const) {
      state = SNAKE_GAME_DEFINITION.applyInput(state, { direction }, SETTINGS);
    }

    // (5,4) -> (5,3) -> (5,2) -> (6,2) -> (6,3): four inputs, four cells, in order.
    expect(state.snake[0]).toEqual({ x: 6, y: 3 });
    expect(state.phase).toBe("playing");
  });

  it("ignores a reversal into its own neck instead of dying to it", () => {
    const state = playingState();
    const next = SNAKE_GAME_DEFINITION.applyInput(state, { direction: "left" }, SETTINGS);

    expect(next).toBe(state);
  });
});

describe("snake growth", () => {
  it("grows by one cell and scores when the head lands on food", () => {
    const state = playingState({ food: { x: 6, y: 4 } });
    const next = SNAKE_GAME_DEFINITION.applyInput(state, { direction: "right" }, SETTINGS);

    expect(next.snake).toHaveLength(4);
    expect(next.score).toBe(1);
    expect(next.phase).toBe("playing");
  });

  it("respawns food on a cell the snake does not occupy", () => {
    const state = playingState({ food: { x: 6, y: 4 } });
    const next = SNAKE_GAME_DEFINITION.applyInput(state, { direction: "right" }, SETTINGS);

    expect(next.snake.some((cell) => cell.x === next.food.x && cell.y === next.food.y)).toBe(false);
    expect(next.food.x).toBeGreaterThanOrEqual(0);
    expect(next.food.x).toBeLessThan(SETTINGS.gridWidth);
    expect(next.food.y).toBeGreaterThanOrEqual(0);
    expect(next.food.y).toBeLessThan(SETTINGS.gridHeight);
  });
});

describe("snake collisions", () => {
  it("ends the round at a wall and keeps the score for the game-over card", () => {
    const state = playingState({
      snake: [
        { x: 0, y: 4 },
        { x: 1, y: 4 },
        { x: 2, y: 4 }
      ],
      heading: "left",
      score: 3
    });
    const next = SNAKE_GAME_DEFINITION.applyInput(state, { direction: "left" }, SETTINGS);

    expect(next.phase).toBe("over");
    expect(next.score).toBe(3);
    expect(next.snake).toEqual(state.snake);
  });

  it("ends the round when the head bites the body", () => {
    // Head (2,2) arrived from below; "right" walks into (3,2), which is body, not tail.
    const state = playingState({
      snake: [
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 3, y: 3 },
        { x: 3, y: 2 },
        { x: 4, y: 2 }
      ],
      heading: "up"
    });
    const next = SNAKE_GAME_DEFINITION.applyInput(state, { direction: "right" }, SETTINGS);

    expect(next.phase).toBe("over");
  });

  it("allows chasing its own tail, because the tail vacates in the same move", () => {
    const state = playingState({
      snake: [
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 3, y: 3 },
        { x: 3, y: 2 }
      ],
      heading: "up"
    });
    const next = SNAKE_GAME_DEFINITION.applyInput(state, { direction: "right" }, SETTINGS);

    expect(next.phase).toBe("playing");
    expect(next.snake[0]).toEqual({ x: 3, y: 2 });
  });
});

describe("snake round lifecycle", () => {
  it("holds the game-over state until the next input, which restarts instead of moving", () => {
    const over = playingState({ phase: "over", score: 9 });
    const next = SNAKE_GAME_DEFINITION.applyInput(over, { direction: "up" }, SETTINGS);

    expect(next.phase).toBe("playing");
    expect(next.score).toBe(0);
    expect(next.snake).toHaveLength(3);
    // The restart consumed the input: the fresh snake has not moved anywhere yet.
    expect(next.snake[0]).toEqual({ x: Math.floor(SETTINGS.gridWidth / 2), y: Math.floor(SETTINGS.gridHeight / 2) });
  });

  it("creates the same round from the same seed, so both containers agree on the board", () => {
    const first = SNAKE_GAME_DEFINITION.createInitialState(SETTINGS, 42);
    const second = SNAKE_GAME_DEFINITION.createInitialState(SETTINGS, 42);

    expect(first).toEqual(second);
    expect(first.snake.some((cell) => cell.x === first.food.x && cell.y === first.food.y)).toBe(false);
  });
});

describe("persisted snake state revival", () => {
  it("revives its own serialised state byte for byte", () => {
    const state = playingState({ score: 5 });
    const revived = SNAKE_GAME_DEFINITION.parseState(JSON.parse(JSON.stringify(state)), SETTINGS);

    expect(revived).toEqual(state);
  });

  it("rejects a state that no longer fits the grid instead of rendering impossible positions", () => {
    const state = playingState({ snake: [{ x: 15, y: 4 }, { x: 14, y: 4 }, { x: 13, y: 4 }] });
    const shrunk: ChatGameSettings = { ...SETTINGS, gridWidth: 12 };

    expect(SNAKE_GAME_DEFINITION.parseState(JSON.parse(JSON.stringify(state)), shrunk)).toBeNull();
  });

  it("rejects a snake with a gap in it", () => {
    const state = playingState({ snake: [{ x: 5, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 }] });

    expect(SNAKE_GAME_DEFINITION.parseState(JSON.parse(JSON.stringify(state)), SETTINGS)).toBeNull();
  });

  it("rejects shapes that are not a snake state at all", () => {
    expect(SNAKE_GAME_DEFINITION.parseState(null, SETTINGS)).toBeNull();
    expect(SNAKE_GAME_DEFINITION.parseState("snake", SETTINGS)).toBeNull();
    expect(SNAKE_GAME_DEFINITION.parseState({ phase: "sleeping" }, SETTINGS)).toBeNull();
  });
});
