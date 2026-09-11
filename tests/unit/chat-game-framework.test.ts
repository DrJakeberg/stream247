import { describe, expect, it } from "vitest";
import {
  CHAT_GAMES,
  SNAKE_GAME_DEFINITION,
  chatGameSettingsKey,
  createDefaultChatGameSettings,
  getChatGameDefinition,
  isChatGameEmoteMapValid,
  listChatGameEmoteMapIssues,
  normalizeChatGameSettings,
  resolveChatGameDirection
} from "@stream247/core";

/**
 * The framework's one hard promise: a chat game is input-driven and nothing else. No timer moves
 * it, no clock parameter exists to smuggle time in, and every emote message counts exactly once.
 * Snake is the first game on this contract; every later game inherits exactly what is pinned here.
 */

const SETTINGS = createDefaultChatGameSettings();

describe("the game contract is input-driven only", () => {
  it("exposes no way to advance a game by time", () => {
    // The contract is four pure functions over state and input. If someone adds a tick, this is
    // the test that makes them argue for it: timer-driven movement is the one behaviour the
    // product decision explicitly rules out.
    const keys = Object.keys(SNAKE_GAME_DEFINITION).sort();
    expect(keys).toEqual(["applyInput", "createInitialState", "id", "parseState", "renderModel"]);
  });

  it("keeps state identical while wall-clock time passes without input", async () => {
    const state = SNAKE_GAME_DEFINITION.createInitialState(SETTINGS, 1);
    const before = JSON.stringify(state);

    // There is no API that takes time, so the only thing that could move the snake is a side
    // effect hiding behind the pure facade. Let real time pass and re-render: nothing may differ.
    await new Promise((resolve) => setTimeout(resolve, 25));
    const after = JSON.stringify(state);
    const rendered = SNAKE_GAME_DEFINITION.renderModel(state, SETTINGS);

    expect(after).toBe(before);
    expect(rendered.cells).toEqual(SNAKE_GAME_DEFINITION.renderModel(state, SETTINGS).cells);
  });

  it("registers every listed game", () => {
    for (const game of CHAT_GAMES) {
      expect(getChatGameDefinition(game.id).id).toBe(game.id);
    }
  });
});

describe("emote input resolution", () => {
  it("maps each configured emote to its direction", () => {
    expect(resolveChatGameDirection("⬆", SETTINGS.emoteMap)).toBe("up");
    expect(resolveChatGameDirection("⬇", SETTINGS.emoteMap)).toBe("down");
    expect(resolveChatGameDirection("⬅", SETTINGS.emoteMap)).toBe("left");
    expect(resolveChatGameDirection("➡", SETTINGS.emoteMap)).toBe("right");
  });

  it("ignores everything that is not a configured emote", () => {
    expect(resolveChatGameDirection("hello chat", SETTINGS.emoteMap)).toBeNull();
    expect(resolveChatGameDirection("", SETTINGS.emoteMap)).toBeNull();
    expect(resolveChatGameDirection("up", SETTINGS.emoteMap)).toBeNull();
  });

  it("counts a message once, for its first configured emote", () => {
    // Pasting a row of emotes must not multiply moves: one message is one input.
    expect(resolveChatGameDirection("⬆ ⬆ ⬆", SETTINGS.emoteMap)).toBe("up");
    expect(resolveChatGameDirection("go ⬅ then ➡", SETTINGS.emoteMap)).toBe("left");
  });

  it("matches whole tokens, not substrings, and respects emote-code case", () => {
    const map = { up: "KappaUp", down: "KappaDown", left: "KappaLeft", right: "KappaRight" };

    expect(resolveChatGameDirection("KappaUp", map)).toBe("up");
    expect(resolveChatGameDirection("KappaUpKappaUp", map)).toBeNull();
    expect(resolveChatGameDirection("kappaup", map)).toBeNull();
  });
});

describe("emote map validation", () => {
  it("accepts four distinct non-empty emotes", () => {
    expect(listChatGameEmoteMapIssues(SETTINGS.emoteMap)).toEqual([]);
  });

  it("names each empty direction", () => {
    const issues = listChatGameEmoteMapIssues({ up: "⬆", down: "", left: " ", right: "➡" });

    expect(issues).toHaveLength(2);
    expect(issues.some((issue) => issue.includes("down"))).toBe(true);
    expect(issues.some((issue) => issue.includes("left"))).toBe(true);
  });

  it("rejects two directions sharing one emote", () => {
    expect(isChatGameEmoteMapValid({ up: "⬆", down: "⬆", left: "⬅", right: "➡" })).toBe(false);
  });

  it("treats a case-only difference as a duplicate, because it is almost always a typo", () => {
    expect(isChatGameEmoteMapValid({ up: "Go", down: "go", left: "⬅", right: "➡" })).toBe(false);
  });

  it("rejects an emote containing whitespace, which could never match a chat token", () => {
    expect(isChatGameEmoteMapValid({ up: "two words", down: "⬇", left: "⬅", right: "➡" })).toBe(false);
  });
});

describe("settings normalisation", () => {
  it("clamps the grid to legible broadcast bounds", () => {
    const normalized = normalizeChatGameSettings({ gridWidth: 500, gridHeight: 1 });

    expect(normalized.gridWidth).toBe(32);
    expect(normalized.gridHeight).toBe(6);
  });

  it("falls back to the default map as a whole when the configured one is broken", () => {
    // Patching single entries would produce a control scheme nobody chose; the operator either
    // gets exactly their map or exactly the default, never a blend.
    const normalized = normalizeChatGameSettings({
      emoteMap: { up: "⬆", down: "⬆", left: "⬅", right: "➡" }
    });

    expect(normalized.emoteMap).toEqual(createDefaultChatGameSettings().emoteMap);
  });

  it("changes the settings key when any rule of the round changes", () => {
    const base = chatGameSettingsKey(SETTINGS);

    expect(chatGameSettingsKey(normalizeChatGameSettings({ ...SETTINGS, gridWidth: 20 }))).not.toBe(base);
    expect(
      chatGameSettingsKey(normalizeChatGameSettings({ ...SETTINGS, emoteMap: { ...SETTINGS.emoteMap, up: "hoch" } }))
    ).not.toBe(base);
    expect(chatGameSettingsKey(normalizeChatGameSettings({ ...SETTINGS }))).toBe(base);
  });
});
