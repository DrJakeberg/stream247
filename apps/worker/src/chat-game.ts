// Runtime for chat-driven games.
//
// Owns the active game instance in the worker: it turns broadcast-channel chat messages into game
// inputs, applies them in arrival order, and tracks what needs flushing to Postgres. The rules
// themselves are pure functions in packages/core/chat-game.ts; this file is only the moving parts —
// which game is active, which state the round is in, and when that state changed.
//
// Inputs are applied synchronously inside the IRC data handler, one message at a time, so a burst
// of emotes between two rendered frames moves the snake several cells in exactly the order chat
// sent them. That is correct for a game that only ever moves on input: the render cadence samples
// the game, it does not pace it.

import {
  chatGameSettingsKey,
  getChatGameDefinition,
  normalizeChatGameSettings,
  resolveChatGameInput,
  type ChatGameSettings,
  type ChatGameState,
  type OverlayGameView
} from "@stream247/core";
import type { OverlaySceneCustomLayer } from "@stream247/core";
import type { ChatGameRuntimeRecord } from "@stream247/db";

/** The overlay fields a chat-started game has to be able to switch on. */
export type ChatGameLayerProvisioningInput = {
  enabled: boolean;
  customLayers: OverlaySceneCustomLayer[];
};

// Where a game panel lands when chat, not the studio, put it there. Deliberately identical to the
// studio's own "Chat Game" default (apps/web/lib/overlay-studio-defaults.ts): a round started from
// chat must be the same object the operator would have created by hand, so they can move it,
// rename it, or switch it off afterwards exactly as usual.
const CHAT_GAME_LAYER_DEFAULTS = {
  name: "Chat Game",
  xPercent: 60,
  yPercent: 10,
  widthPercent: 30,
  heightPercent: 44,
  opacityPercent: 100,
  allowOutsideSafeArea: false
} as const;

/**
 * The overlay a chat-started game needs, from the overlay there is.
 *
 * The game only runs while the published overlay is on *and* some enabled layer of kind "game"
 * exists (see reconcileChatGame). A fresh install has neither: overlay.enabled is false and
 * customLayers is empty, so every direction emote the room sent was resolved against a runtime
 * that had no settings and no state, and did nothing. That is not a state a viewer can fix and not
 * one an operator can guess, so starting a game from chat provisions it.
 *
 * An existing game layer is re-enabled rather than duplicated — the operator's placement is their
 * decision, and a second panel would draw two boards. Pure, so the worker can persist the result
 * in one write and the rule is testable without a database.
 */
export function resolveChatGameLayerProvisioning(
  overlay: ChatGameLayerProvisioningInput
): ChatGameLayerProvisioningInput {
  const existing = overlay.customLayers.findIndex((layer) => layer.kind === "game");
  if (existing >= 0) {
    const customLayers = overlay.customLayers.map((layer, index) =>
      index === existing ? { ...layer, enabled: true } : layer
    );
    return { enabled: true, customLayers };
  }

  return {
    enabled: true,
    customLayers: [
      ...overlay.customLayers,
      { id: `game-${Date.now().toString(36)}`, kind: "game", enabled: true, ...CHAT_GAME_LAYER_DEFAULTS }
    ]
  };
}

/**
 * The overlay after chat ended a round: the game layers switch off, everything else is untouched.
 *
 * The layer is kept rather than deleted so the operator's placement survives the next "!snake",
 * and overlay.enabled is left alone — chat started the game, it did not publish the overlay, so
 * it has no business switching the whole overlay off again.
 */
export function resolveChatGameLayerTeardown(
  overlay: ChatGameLayerProvisioningInput
): ChatGameLayerProvisioningInput {
  return {
    enabled: overlay.enabled,
    customLayers: overlay.customLayers.map((layer) => (layer.kind === "game" ? { ...layer, enabled: false } : layer))
  };
}

export type ChatGameRuntimeOptions = {
  /** Seed for fresh rounds, injected so tests get deterministic boards. */
  seed?: () => number;
  onEvent?: (event: string, fields: Record<string, unknown>) => void;
};

export type ChatGameSyncArgs = {
  /** Whether the game should run at all: an enabled game layer exists in the live scene. */
  active: boolean;
  settings: Partial<ChatGameSettings> | null;
  /**
   * The persisted round, offered when the runtime has nothing for these settings. A restarted
   * worker adopts the round the room is playing instead of wiping it.
   */
  restore?: ChatGameRuntimeRecord | null;
};

export class ChatGameRuntime {
  private readonly options: ChatGameRuntimeOptions;
  private settings: ChatGameSettings | null = null;
  private settingsKey = "";
  private state: ChatGameState | null = null;
  private dirty = false;

  constructor(options: ChatGameRuntimeOptions = {}) {
    this.options = options;
  }

  private log(event: string, fields: Record<string, unknown>): void {
    this.options.onEvent?.(event, fields);
  }

  isActive(): boolean {
    return this.settings !== null && this.state !== null;
  }

  /**
   * Reconciles the runtime against settings and layer presence. Called from the worker cycle, not
   * from chat: activation, deactivation, and rule changes are operator actions, so they follow the
   * operator's cadence rather than the room's.
   */
  sync(args: ChatGameSyncArgs): { becameInactive: boolean } {
    if (!args.active) {
      const wasActive = this.isActive();
      this.settings = null;
      this.settingsKey = "";
      this.state = null;
      this.dirty = false;
      return { becameInactive: wasActive };
    }

    const settings = normalizeChatGameSettings(args.settings);
    const key = chatGameSettingsKey(settings);
    if (this.state && this.settingsKey === key) {
      return { becameInactive: false };
    }

    const definition = getChatGameDefinition(settings.gameId);

    // Same rules as the persisted round: adopt it. Not marked dirty — memory now equals disk.
    const restored = args.restore && args.restore.settingsKey === key ? definition.parseState(args.restore.state, settings) : null;
    if (restored) {
      this.settings = settings;
      this.settingsKey = key;
      this.state = restored;
      this.dirty = false;
      this.log("chat.game.restored", { gameId: settings.gameId, score: restored.score });
      return { becameInactive: false };
    }

    // New rules or nothing to restore: a fresh round. A settings change mid-round lands here on
    // purpose — a 16x9 snake means nothing on a resized grid or under a remapped control scheme.
    this.settings = settings;
    this.settingsKey = key;
    this.state = definition.createInitialState(settings, (this.options.seed?.() ?? Date.now()) & 0x7fffffff);
    this.dirty = true;
    this.log("chat.game.round_started", { gameId: settings.gameId });
    return { becameInactive: false };
  }

  /**
   * Handles one chat message and reports whether it changed the round.
   *
   * Synchronous and never throws: this runs inside the IRC socket data handler. Only the active
   * game's vocabulary acts — the configured emotes for direction-driven games, coordinates like
   * "b3" for cell-driven ones; everything else is not an input at all. An accepted input that
   * moves nothing (a reversal into the snake's neck, a dig on an open cell) leaves the state
   * identical and reports false, so callers only schedule persistence when something changed.
   */
  handleChatMessage(message: string): boolean {
    try {
      if (!this.settings || !this.state) {
        return false;
      }

      const input = resolveChatGameInput(message, this.settings);
      if (!input) {
        return false;
      }

      const next = getChatGameDefinition(this.settings.gameId).applyInput(this.state, input, this.settings);
      if (next === this.state) {
        return false;
      }

      this.state = next;
      this.dirty = true;
      return true;
    } catch (error) {
      this.log("chat.game.input_failed", {
        error: error instanceof Error ? error.message : "Unknown chat game input failure."
      });
      return false;
    }
  }

  /** True when something changed since the last flush, so callers can skip needless writes. */
  consumeDirty(): boolean {
    const dirty = this.dirty;
    this.dirty = false;
    return dirty;
  }

  /** What to persist for the running round, or null when no game is active. */
  getRuntimeRecord(now = new Date()): ChatGameRuntimeRecord | null {
    if (!this.settings || !this.state) {
      return null;
    }

    return {
      gameId: this.settings.gameId,
      settingsKey: this.settingsKey,
      settings: this.settings,
      state: this.state,
      updatedAt: now.toISOString()
    };
  }
}

/**
 * Projects a persisted round into what the overlay draws. Used by the playout container, which
 * only ever reads: the render model is re-derived from the state, never stored, so the two can
 * never disagree. Returns null — no panel — for an empty, torn, or stale record.
 */
export function buildChatGameOverlayViewFromRuntimeRecord(record: ChatGameRuntimeRecord): OverlayGameView | null {
  if (!record.gameId || !record.settingsKey) {
    return null;
  }

  const settings = normalizeChatGameSettings(record.settings as Partial<ChatGameSettings>);
  // The key is derived from the settings, so a mismatch means the row is torn or from a version
  // whose normalisation disagrees — either way not something to put on air.
  if (chatGameSettingsKey(settings) !== record.settingsKey) {
    return null;
  }

  const definition = getChatGameDefinition(settings.gameId);
  const state = definition.parseState(record.state, settings);
  if (!state) {
    return null;
  }

  return definition.renderModel(state, settings);
}
