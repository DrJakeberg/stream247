import type { ChatGameCommand } from "@stream247/core";

/**
 * Two cooldowns for chat game commands (M125).
 *
 * With one shared cooldown claimed before the moderator check, any viewer typing "game" every few
 * seconds silenced the moderators' "!game stop": the viewer's line used up the window and the stop
 * that followed was dropped without a word. Info answers and the refusal for non-moderators now
 * share the room's cooldown; a moderator's start or stop has its own, so viewer traffic can never
 * use up what a moderator needs.
 */
export type ChatGameCooldownLane = "room" | "moderator";

export function chatGameCommandLane(command: Pick<ChatGameCommand, "kind">, isModerator: boolean): ChatGameCooldownLane {
  return command.kind !== "info" && isModerator ? "moderator" : "room";
}

export function createChatGameCooldowns(cooldownMs: number) {
  const lastAt: Record<ChatGameCooldownLane, number> = { room: 0, moderator: 0 };
  return {
    /** True and claims the lane when its window is over; false while it still runs. */
    claim(lane: ChatGameCooldownLane, now: number): boolean {
      if (now - lastAt[lane] < cooldownMs) {
        return false;
      }
      lastAt[lane] = now;
      return true;
    }
  };
}
