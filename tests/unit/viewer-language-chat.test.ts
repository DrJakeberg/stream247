import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createDefaultChatGameSettings,
  formatChatGameInfoReply,
  formatChatGameNoRoomReply,
  formatChatSkipPausedReply,
  formatPresenceClampReply,
  getChatGameDefinition,
  viewerText,
  type ChatGameId,
  type ChatGameSettings
} from "@stream247/core";
import { buildEngagementOverlayViewFromSkipVote, buildEngagementOverlayViewFromVoteSession } from "../../apps/worker/src/chat-control";
import { ChatGameRuntime, buildChatGameOverlayViewFromRuntimeRecord } from "../../apps/worker/src/chat-game";
import { parseTwitchIrcMessage } from "../../apps/worker/src/twitch-engagement";
import { expectNoEnglish } from "./viewer-language-helpers";

/**
 * Every viewer surface in both languages (M80), part two: the poll and skip panels, the chat game
 * boards, and every line the chat bot says. English stays what it was; the poll and skip panels
 * were German on every channel before M80 and are now English on an English channel. Command words
 * (!game, the game ids, stop, !1, !skip) are what the bot listens for and stay as they are.
 */

const NOW = new Date("2026-02-01T21:30:00.000Z");

describe("the poll and the skip campaign", () => {
  const poll = {
    status: "open" as const,
    closesAt: new Date(NOW.getTime() + 40_000).toISOString(),
    options: [
      { token: "!1", title: "Retro Night", votes: 2 },
      { token: "!2", title: "Late Show", votes: 1 }
    ]
  };
  const campaign = (votes: number, votesNeeded: number) => ({
    assetId: "asset_1",
    skipCommand: "skip",
    votes,
    votesNeeded,
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString()
  });

  it("asks in German on a German channel, with the same words as before M80 and a fixed plural", () => {
    const vote = buildEngagementOverlayViewFromVoteSession(poll, NOW, "de")!;
    expect([vote.headline, vote.hint]).toEqual(["Was läuft als Nächstes?", "Schreib !1, !2 in den Chat"]);
    const skip = buildEngagementOverlayViewFromSkipVote(campaign(1, 1), NOW, "de")!;
    expect([skip.headline, skip.options[0]!.token, skip.options[0]!.title, skip.hint]).toEqual([
      "Überspringen?",
      "!skip",
      "Weiter zum nächsten Video",
      // Was "1 von 1 Stimmen".
      "1 von 1 Stimme"
    ]);
    expect(buildEngagementOverlayViewFromSkipVote(campaign(2, 3), NOW, "de")!.hint).toBe("2 von 3 Stimmen");
    expectNoEnglish([vote.headline, vote.hint, skip.headline, skip.options[0]!.title, skip.hint]);
  });

  it("asks in English on an English channel — and when the language is unknown", () => {
    for (const locale of ["en", undefined, "fr"]) {
      const vote = buildEngagementOverlayViewFromVoteSession(poll, NOW, locale)!;
      expect([vote.headline, vote.hint]).toEqual(["What plays next?", "Type !1, !2 in chat"]);
      const skip = buildEngagementOverlayViewFromSkipVote(campaign(2, 3), NOW, locale)!;
      expect([skip.headline, skip.options[0]!.title, skip.hint]).toEqual(["Skip?", "Move on to the next video", "2 of 3 votes"]);
    }
  });
});

describe("the chat game boards", () => {
  const settings: ChatGameSettings = createDefaultChatGameSettings();

  function boards(locale: string) {
    const out: Record<string, string[]> = {};
    for (const gameId of ["snake", "minesweeper", "2048"] as ChatGameId[]) {
      const gameSettings = { ...settings, gameId };
      const definition = getChatGameDefinition(gameId);
      const state = definition.createInitialState(gameSettings, 7);
      const playing = definition.renderModel(state, gameSettings, locale);
      const over = definition.renderModel({ ...state, phase: "over", won: false } as typeof state, gameSettings, locale);
      out[gameId] = [playing.headline, playing.statusLine, playing.hintLine, over.statusLine, over.hintLine];
      if (gameId === "minesweeper") {
        out.cleared = [definition.renderModel({ ...state, phase: "over", won: true } as typeof state, gameSettings, locale).statusLine];
      }
    }
    return out;
  }

  it("keeps the English panels exactly as they were", () => {
    expect(boards("en")).toEqual({
      snake: ["Chat plays Snake", "Score 0", "Steer with ⬆ ⬇ ⬅ ➡ in chat", "Game over · Score 0", "Send any arrow emote to start the next round"],
      minesweeper: [
        "Chat plays Minesweeper",
        expect.stringMatching(/^Cleared 0 of \d+$/),
        "Dig with column and row like b3 — a to p, 1 to 9",
        "Game over · Score 0",
        "Send a cell like b3 to start the next round"
      ],
      cleared: ["Board cleared · Score 0"],
      "2048": [
        "Chat plays 2048",
        "Score 0",
        "Merge with ⬆ ⬇ ⬅ ➡ in chat",
        "Game over · Score 0",
        "Send any arrow emote to start the next round"
      ]
    });
  });

  it("draws every panel in German", () => {
    const german = boards("de");
    expect(german).toEqual({
      snake: ["Chat spielt Snake", "0 Punkte", "Steuere mit ⬆ ⬇ ⬅ ➡ im Chat", "Vorbei · 0 Punkte", "Schick ein Pfeil-Emote für die nächste Runde"],
      minesweeper: [
        "Chat spielt Minesweeper",
        // Was "0 von N offen", which German reads as "N still to do".
        expect.stringMatching(/^0\/\d+ geschafft$/),
        "Deck ein Feld auf: Spalte und Zeile wie b3 – a bis p, 1 bis 9",
        "Vorbei · 0 Punkte",
        "Schick ein Feld wie b3 für die nächste Runde"
      ],
      cleared: ["Geschafft · 0 Punkte"],
      "2048": ["Chat spielt 2048", "0 Punkte", "Schieb mit ⬆ ⬇ ⬅ ➡ im Chat", "Vorbei · 0 Punkte", "Schick ein Pfeil-Emote für die nächste Runde"]
    });
    expectNoEnglish(Object.values(german).flat());
  });

  it("is drawn in the payload's language by the playout container, from the same stored round", () => {
    const runtime = new ChatGameRuntime({ seed: () => 11 });
    runtime.sync({ active: true, settings });
    const record = JSON.parse(JSON.stringify(runtime.getRuntimeRecord()));
    expect(buildChatGameOverlayViewFromRuntimeRecord(record, "de")!.headline).toBe("Chat spielt Snake");
    expect(buildChatGameOverlayViewFromRuntimeRecord(record)!.headline).toBe("Chat plays Snake");
  });
});

describe("the chat bot", () => {
  const config = { defaultMinutes: 30, minMinutes: 5, maxMinutes: 120 };
  const settings = createDefaultChatGameSettings();

  function replies(locale: string | undefined) {
    return [
      formatPresenceClampReply({ commandInput: "!here 1", appliedMinutes: 5, requestedMinutes: 1, clampReason: "minimum", config, locale }),
      formatPresenceClampReply({ commandInput: "!here 999", appliedMinutes: 120, requestedMinutes: 999, clampReason: "maximum", config, locale }),
      formatPresenceClampReply({ commandInput: "!here", appliedMinutes: 30, requestedMinutes: null, clampReason: "default", config, locale }),
      formatPresenceClampReply({ commandInput: "!here 45", appliedMinutes: 45, requestedMinutes: 45, clampReason: "accepted", config, locale }),
      formatChatGameInfoReply({ running: null, settings, locale }),
      formatChatGameInfoReply({ running: { gameId: "snake" }, settings, locale }),
      formatChatGameInfoReply({ running: { gameId: "minesweeper" }, settings, locale }),
      formatChatGameNoRoomReply({ gameId: "2048", layerCount: 12, locale }),
      formatChatSkipPausedReply("insert", locale),
      formatChatSkipPausedReply("fallback", locale),
      formatChatSkipPausedReply("pin", locale),
      // The three the worker writes inline, with the parameters it passes (see the wiring test below).
      viewerText(locale, "chat.game.moderatorOnly", { actor: "retro_fan" }),
      viewerText(locale, "chat.game.stopped"),
      viewerText(locale, "chat.presence.saveFailed", { actor: "mod_anna" })
    ];
  }

  it("says what it always said in English", () => {
    expect(replies("en")).toEqual([
      "received !here 1, minimum is 5; window set to 5 min",
      "received !here 999, maximum is 120; window set to 120 min",
      "received !here, default is 30; window set to 30 min",
      "presence window set to 45 min",
      "No game is running. Start one: !snake !minesweeper !2048 — then steer with ⬆ ⬇ ⬅ ➡, or type a cell like b3 in Minesweeper. !game stop ends a round.",
      "Snake is on air — steer with ⬆ ⬇ ⬅ ➡. Other games: !snake !minesweeper !2048. !game stop ends the round.",
      "Minesweeper is on air — type a cell like b3. Other games: !snake !minesweeper !2048. !game stop ends the round.",
      "No room for the game layer: the studio already has 12 layers. Remove one in the studio, then try !2048 again.",
      "The operator is playing an insert — skip votes are paused until it ends.",
      "The operator has put the fallback on air — skip votes are paused until it ends.",
      "The operator has pinned this item — skip votes are paused until the pin ends.",
      "retro_fan: only a moderator can start or stop a game. Type !game to see what is running.",
      "Game stopped.",
      "@mod_anna your check-in could not be saved — please try again in a moment."
    ]);
    // Callers that do not pass a language — the admin's check-in API — keep English.
    expect(replies(undefined)).toEqual(replies("en"));
  });

  it("says every line in German, with the command words left alone", () => {
    const german = replies("de");
    expect(german).toEqual([
      "!here 1 erhalten, Minimum ist 5; Fenster auf 5 Min. gesetzt",
      "!here 999 erhalten, Maximum ist 120; Fenster auf 120 Min. gesetzt",
      "!here erhalten, Standard ist 30; Fenster auf 30 Min. gesetzt",
      "Anwesenheitsfenster auf 45 Min. gesetzt",
      "Gerade läuft kein Spiel. Starte eins: !snake !minesweeper !2048 – dann steuerst du mit ⬆ ⬇ ⬅ ➡, oder schreib bei Minesweeper ein Feld wie b3. !game stop beendet eine Runde.",
      "Snake läuft gerade – steuere mit ⬆ ⬇ ⬅ ➡. Weitere Spiele: !snake !minesweeper !2048. !game stop beendet die Runde.",
      "Minesweeper läuft gerade – schreib ein Feld wie b3. Weitere Spiele: !snake !minesweeper !2048. !game stop beendet die Runde.",
      "Kein Platz für die Spielebene: Im Studio sind schon 12 Ebenen. Entfern eine im Studio und versuch dann !2048 noch mal.",
      "Die Regie spielt gerade einen Einspieler – Überspringen ist pausiert, bis er vorbei ist.",
      "Die Regie hat das Ersatzprogramm auf Sendung – Überspringen ist pausiert, bis es vorbei ist.",
      "Die Regie hat diesen Beitrag angepinnt – Überspringen ist pausiert, bis der Pin endet.",
      "retro_fan: Nur Mods können ein Spiel starten oder stoppen. Schreib !game, um zu sehen, was gerade läuft.",
      "Spiel beendet.",
      "@mod_anna dein Check-in konnte nicht gespeichert werden – versuch es gleich noch mal."
    ]);
    expectNoEnglish(german);
  });

  it("sends the three inline replies from the catalogue, in the channel language", () => {
    // These three are not behind a formatter this test can call: the worker's entry file starts the
    // worker when imported. So the call sites are read instead — the key, the language and the
    // parameter each one passes — and the wording is pinned above.
    const worker = readFileSync(new URL("../../apps/worker/src/index.ts", import.meta.url), "utf8");
    const bridge = readFileSync(new URL("../../apps/worker/src/twitch-engagement.ts", import.meta.url), "utf8");
    expect(worker).toContain('return viewerText(viewerLanguage(), "chat.game.moderatorOnly", { actor: args.actor });');
    expect(worker).toContain('return viewerText(viewerLanguage(), "chat.game.stopped");');
    expect(bridge).toContain('this.sendChatMessage(viewerText(this.viewerLocale, "chat.presence.saveFailed", { actor: presenceWindow.actor }));');
  });

  it("names a chat message that arrived without any name in the channel language", () => {
    // No display-name tag value and no nick before the "!": nothing to call the author by.
    const line = "@display-name= :!u@u.tmi.twitch.tv PRIVMSG #channel :hello";
    expect(parseTwitchIrcMessage(line, "de")?.actor).toBe("Zuschauer");
    expect(parseTwitchIrcMessage(line)?.actor).toBe("Viewer");
  });
});
