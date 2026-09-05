"use client";

import { CHAT_GAMES, listChatGameEmoteMapIssues, type ChatGameDirection, type ChatGameId } from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";
import type { ChatGameSettingsRecord } from "@stream247/db";

const DIRECTION_LABELS: Record<ChatGameDirection, string> = {
  up: "Up emote",
  down: "Down emote",
  left: "Left emote",
  right: "Right emote"
};

export function ChatGameSettingsForm({ chatGame }: { chatGame: ChatGameSettingsRecord }) {
  const [gameId, setGameId] = useState<ChatGameId>(chatGame.gameId);
  const [gridWidth, setGridWidth] = useState(String(chatGame.gridWidth));
  const [gridHeight, setGridHeight] = useState(String(chatGame.gridHeight));
  const [emoteMap, setEmoteMap] = useState({ ...chatGame.emoteMap });
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { pushToast } = useToast();

  const activeGame = CHAT_GAMES.find((game) => game.id === gameId) ?? CHAT_GAMES[0]!;

  // Validated as the operator types, so a duplicate or empty emote is visible before saving —
  // the server rejects the same problems, this just says so earlier. A game steered by
  // coordinates never blocks on the emote map it does not use.
  const emoteIssues = activeGame.input === "emotes" ? listChatGameEmoteMapIssues(emoteMap) : [];

  async function save() {
    const response = await fetch("/api/chat-game/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, gridWidth: Number(gridWidth), gridHeight: Number(gridHeight), emoteMap })
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      const nextError = payload.message ?? "Could not update chat game settings.";
      setError(nextError);
      pushToast({ title: "Could not save chat game settings", description: nextError, tone: "error" });
      return;
    }

    pushToast({
      title: "Chat game settings saved",
      description: payload.message ?? "The game will use the new rules from the next round.",
      tone: "success"
    });
    router.refresh();
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        startTransition(() => void save());
      }}
    >
      <div className="list">
        <div className="item">
          <span className="label">Chat game</span>
          <div className="subtle">
            The game moves only when chat sends the mapped emotes — one accepted message, one move. It appears on
            air wherever a scene has an enabled Chat Game layer, which a moderator can add from chat with !snake,
            !minesweeper, or !2048 without opening Scene Studio.
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label>
              <span className="label label-with-info">
                Game
                <InfoTip text="Which game chat plays on the Chat Game layer. Snake and 2048 listen for the four direction emotes, Minesweeper for cell names like b3; switching games ends the running round and starts a fresh one." />
              </span>
              <select onChange={(event) => setGameId(event.target.value as ChatGameId)} value={gameId}>
                {CHAT_GAMES.map((game) => (
                  <option key={game.id} value={game.id}>
                    {game.label}
                  </option>
                ))}
              </select>
              <span className="subtle">{activeGame.description}</span>
            </label>
            {/* A game with a fixed board would silently ignore these, so they fold away instead. */}
            {activeGame.usesGrid ? (
              <label>
                <span className="label label-with-info">
                  Grid width (cells)
                  <InfoTip text="How many cells wide the board is, from 8 to 32. More columns give the snake room to run and Minesweeper more letters to dig (a, b, … up to af), but every cell gets smaller on air; a change mid-round starts a new round." />
                </span>
                <input max={32} min={8} onChange={(event) => setGridWidth(event.target.value)} type="number" value={gridWidth} />
              </label>
            ) : null}
            {activeGame.usesGrid ? (
              <label>
                <span className="label label-with-info">
                  Grid height (cells)
                  <InfoTip text="How many cells tall the board is, from 6 to 18. Rows are the numbers in a Minesweeper coordinate, counted from 1; taller boards make every cell smaller on air, and a change mid-round starts a new round." />
                </span>
                <input max={18} min={6} onChange={(event) => setGridHeight(event.target.value)} type="number" value={gridHeight} />
              </label>
            ) : null}
          </div>
        </div>

        {/* Shown only for games chat steers by emotes; a coordinate game has no use for the map. */}
        {activeGame.input === "emotes" ? (
          <div className="item">
            <span className="label">Emote controls</span>
            <div className="subtle">
              One emote per direction, exactly as chat would type it. Four distinct values are required; changing
              them mid-round starts a fresh round under the new controls.
            </div>
            <div className="form-grid" style={{ marginTop: 12 }}>
              {(Object.keys(DIRECTION_LABELS) as ChatGameDirection[]).map((direction) => (
                <label key={direction}>
                  <span className="label label-with-info">
                    {DIRECTION_LABELS[direction]}
                    <InfoTip
                      text={`When chat writes this emote on its own between spaces — capitals count, so Kappa and kappa differ — the message is one move ${direction}; a message carrying several controls counts only the first.`}
                    />
                  </span>
                  <input
                    onChange={(event) => setEmoteMap((current) => ({ ...current, [direction]: event.target.value }))}
                    value={emoteMap[direction]}
                  />
                </label>
              ))}
            </div>
            {emoteIssues.length > 0 ? <p className="danger">{emoteIssues.join(" ")}</p> : null}
          </div>
        ) : null}
      </div>

      {error ? <p className="danger">{error}</p> : null}
      <button
        className="button"
        disabled={isPending || emoteIssues.length > 0}
        title="Save the chat game settings."
        type="submit"
      >
        {isPending ? "Saving..." : "Save chat game settings"}
      </button>
    </form>
  );
}
