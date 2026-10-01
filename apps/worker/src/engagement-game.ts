import {
  resolveEngagementGameModeForActiveChatters,
  type EngagementGameMode,
  type EngagementGameRuntime,
  type EngagementSettings
} from "@stream247/core";
import { ActiveChatterRoster } from "./active-chatters.js";

const MODE_SWITCH_HYSTERESIS_MS = 30_000;

type EngagementChatActivity = {
  actor: string;
  createdAt: string;
};

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export class EngagementGameTracker {
  private currentMode: EngagementGameMode | "" = "";
  private candidateMode: EngagementGameMode | "__off" | "" = "";
  private candidateSince = 0;
  private modeChangedAt = "";
  private lastSnapshotKey = "";

  /**
   * The roster is shared with the skip vote (see active-chatters.ts): the count this snapshot
   * reports is the count the skip threshold divides by, and this is where the window reaches it.
   */
  constructor(private readonly activeChatters: ActiveChatterRoster = new ActiveChatterRoster()) {}

  recordChatMessage(activity: EngagementChatActivity): void {
    this.activeChatters.recordSeen(activity.actor, toTimestamp(activity.createdAt));
  }

  getSnapshot(settings: Partial<EngagementSettings> | null | undefined, now = new Date()): EngagementGameRuntime {
    const nowMs = now.getTime();
    this.activeChatters.applySettings(settings);

    const activeChatterCount = this.activeChatters.countActive(nowMs);
    const targetMode = resolveEngagementGameModeForActiveChatters(settings, activeChatterCount);

    if (targetMode === this.currentMode) {
      this.candidateMode = "";
      this.candidateSince = 0;
    } else if (!this.currentMode && targetMode) {
      this.currentMode = targetMode;
      this.modeChangedAt = now.toISOString();
      this.candidateMode = "";
      this.candidateSince = 0;
    } else if (!targetMode) {
      if (this.candidateMode === "__off") {
        if (nowMs - this.candidateSince >= MODE_SWITCH_HYSTERESIS_MS) {
          this.currentMode = "";
          this.modeChangedAt = now.toISOString();
          this.candidateMode = "";
          this.candidateSince = 0;
        }
      } else {
        this.candidateMode = "__off";
        this.candidateSince = nowMs;
      }
    } else if (this.candidateMode !== targetMode) {
      this.candidateMode = targetMode;
      this.candidateSince = nowMs;
    } else if (nowMs - this.candidateSince >= MODE_SWITCH_HYSTERESIS_MS) {
      this.currentMode = targetMode;
      this.modeChangedAt = now.toISOString();
      this.candidateMode = "";
      this.candidateSince = 0;
    }

    return {
      mode: this.currentMode,
      activeChatterCount,
      modeChangedAt: this.modeChangedAt,
      updatedAt: now.toISOString()
    };
  }

  isSnapshotChanged(snapshot: EngagementGameRuntime): boolean {
    const nextKey = JSON.stringify({
      mode: snapshot.mode,
      activeChatterCount: snapshot.activeChatterCount,
      modeChangedAt: snapshot.modeChangedAt
    });
    if (nextKey === this.lastSnapshotKey) {
      return false;
    }

    this.lastSnapshotKey = nextKey;
    return true;
  }
}
