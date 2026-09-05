import { describe, expect, it, vi } from "vitest";
import { createDefaultChatGameSettings, type SnakeGameState } from "@stream247/core";
import { ChatGameRuntime, buildChatGameOverlayViewFromRuntimeRecord } from "../../apps/worker/src/chat-game";

/**
 * The worker side of the game: chat intake, the activation gate, and the persisted round.
 * The two properties that matter most here are the negative ones — a game that is not on any
 * scene consumes nothing, and a game that nobody steers never changes, no matter how much
 * wall-clock time passes.
 */

const SETTINGS = createDefaultChatGameSettings();

function activeRuntime(): ChatGameRuntime {
  const runtime = new ChatGameRuntime({ seed: () => 11 });
  runtime.sync({ active: true, settings: SETTINGS });
  return runtime;
}

function snakeState(runtime: ChatGameRuntime): SnakeGameState {
  return buildStateFromRecord(runtime);
}

function buildStateFromRecord(runtime: ChatGameRuntime): SnakeGameState {
  const record = runtime.getRuntimeRecord();
  expect(record).not.toBeNull();
  return record!.state as SnakeGameState;
}

describe("chat game intake", () => {
  it("moves one cell per accepted emote message, in arrival order", () => {
    const runtime = activeRuntime();
    const before = snakeState(runtime).snake[0]!;

    expect(runtime.handleChatMessage("⬆")).toBe(true);
    expect(runtime.handleChatMessage("⬆")).toBe(true);
    expect(runtime.handleChatMessage("➡")).toBe(true);

    expect(snakeState(runtime).snake[0]).toEqual({ x: before.x + 1, y: before.y - 2 });
  });

  it("ignores messages that are not a configured emote", () => {
    const runtime = activeRuntime();
    const before = JSON.stringify(snakeState(runtime));

    expect(runtime.handleChatMessage("hello ⬆⬆attached")).toBe(false);
    expect(runtime.handleChatMessage("up")).toBe(false);
    expect(runtime.handleChatMessage("")).toBe(false);

    expect(JSON.stringify(snakeState(runtime))).toBe(before);
  });

  it("consumes nothing while inactive, so a disabled game never touches chat", () => {
    const runtime = new ChatGameRuntime({ seed: () => 11 });

    expect(runtime.handleChatMessage("⬆")).toBe(false);
    expect(runtime.getRuntimeRecord()).toBeNull();
  });

  it("never moves on time: hours without input leave the round byte-identical", () => {
    vi.useFakeTimers();
    try {
      const runtime = activeRuntime();
      const at = new Date("2026-08-25T12:00:00Z");
      const before = JSON.stringify(runtime.getRuntimeRecord(at));

      vi.advanceTimersByTime(6 * 60 * 60 * 1000);

      expect(JSON.stringify(runtime.getRuntimeRecord(at))).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("chat game lifecycle", () => {
  it("adopts the persisted round on restart instead of wiping it", () => {
    const first = activeRuntime();
    first.handleChatMessage("⬆");
    first.handleChatMessage("⬆");
    const persisted = first.getRuntimeRecord()!;

    const restarted = new ChatGameRuntime({ seed: () => 99 });
    restarted.sync({ active: true, settings: SETTINGS, restore: persisted });

    expect(restarted.getRuntimeRecord()!.state).toEqual(persisted.state);
  });

  it("starts a fresh round when the persisted one was played under different rules", () => {
    const first = activeRuntime();
    first.handleChatMessage("⬆");
    const persisted = first.getRuntimeRecord()!;

    const resized = new ChatGameRuntime({ seed: () => 99 });
    resized.sync({ active: true, settings: { ...SETTINGS, gridWidth: 24 }, restore: persisted });

    const state = buildStateFromRecord(resized);
    expect(state.score).toBe(0);
    expect(resized.getRuntimeRecord()!.settingsKey).not.toBe(persisted.settingsKey);
  });

  it("keeps the running round across syncs with unchanged settings", () => {
    const runtime = activeRuntime();
    runtime.handleChatMessage("⬆");
    const before = JSON.stringify(snakeState(runtime));

    runtime.sync({ active: true, settings: SETTINGS });

    expect(JSON.stringify(snakeState(runtime))).toBe(before);
  });

  it("reports deactivation exactly once and drops all state with it", () => {
    const runtime = activeRuntime();
    runtime.handleChatMessage("⬆");

    expect(runtime.sync({ active: false, settings: SETTINGS }).becameInactive).toBe(true);
    expect(runtime.sync({ active: false, settings: SETTINGS }).becameInactive).toBe(false);
    expect(runtime.getRuntimeRecord()).toBeNull();
    expect(runtime.handleChatMessage("⬆")).toBe(false);
  });

  it("marks the state dirty on accepted input and clean after a flush", () => {
    const runtime = activeRuntime();
    expect(runtime.consumeDirty()).toBe(true); // The fresh round itself needs persisting.

    runtime.handleChatMessage("⬆");
    expect(runtime.consumeDirty()).toBe(true);
    expect(runtime.consumeDirty()).toBe(false);
  });
});

describe("chat intake for the other games", () => {
  it("digs minesweeper cells on coordinates and lets emotes pass by untouched", () => {
    const runtime = new ChatGameRuntime({ seed: () => 11 });
    runtime.sync({ active: true, settings: { ...SETTINGS, gameId: "minesweeper" } });

    expect(runtime.handleChatMessage("⬆")).toBe(false);
    expect(runtime.handleChatMessage("hello chat")).toBe(false);
    expect(runtime.handleChatMessage("b3")).toBe(true);
    // The same cell again moves nothing, so nothing is persisted for it.
    runtime.consumeDirty();
    expect(runtime.handleChatMessage("b3")).toBe(false);
    expect(runtime.consumeDirty()).toBe(false);
  });

  it("slides 2048 tiles on the very emote map that steers the snake", () => {
    const runtime = new ChatGameRuntime({ seed: () => 11 });
    runtime.sync({ active: true, settings: { ...SETTINGS, gameId: "2048" } });

    expect(runtime.handleChatMessage("b3")).toBe(false);
    const moved = ["⬆", "⬇", "⬅", "➡"].map((emote) => runtime.handleChatMessage(emote));
    // A fresh board cannot refuse all four directions; which ones move depends on the seed.
    expect(moved).toContain(true);
    expect(runtime.getRuntimeRecord()!.gameId).toBe("2048");
  });
});

describe("the playout-side view of a persisted round", () => {
  it("derives the same render model the worker would draw", () => {
    const runtime = activeRuntime();
    runtime.handleChatMessage("⬆");

    const view = buildChatGameOverlayViewFromRuntimeRecord(JSON.parse(JSON.stringify(runtime.getRuntimeRecord())));

    expect(view).not.toBeNull();
    expect(view!.gridWidth).toBe(SETTINGS.gridWidth);
    expect(view!.cells.filter((cell) => cell.kind === "snake-head")).toHaveLength(1);
    expect(view!.cells.every((cell) => cell.x >= 0 && cell.x < SETTINGS.gridWidth)).toBe(true);
  });

  it("returns no view for an empty or torn record, rather than an impossible board", () => {
    expect(
      buildChatGameOverlayViewFromRuntimeRecord({ gameId: "", settingsKey: "", settings: {}, state: {}, updatedAt: "" })
    ).toBeNull();

    const runtime = activeRuntime();
    const record = runtime.getRuntimeRecord()!;
    expect(buildChatGameOverlayViewFromRuntimeRecord({ ...record, settingsKey: "stale-key" })).toBeNull();
    expect(buildChatGameOverlayViewFromRuntimeRecord({ ...record, state: { phase: "?" } })).toBeNull();
  });
});
