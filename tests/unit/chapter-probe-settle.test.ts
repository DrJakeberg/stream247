import { describe, expect, it } from "vitest";
import {
  CHAPTER_PROBE_RECHECK_CAP,
  CHAPTER_PROBE_SETTLED_LEVEL,
  DEFAULT_CHAPTER_PROBE_SETTLE_LEVEL,
  isProvisionalProbedChapterList,
  isRecordingAnswerPossible,
  normalizeChapterProbeRechecks,
  normalizeChapterProbeSettleLevel,
  resolveChapterProbeAnswer,
  TWITCH_MAX_BROADCAST_SECONDS,
  type AssetChapter
} from "@stream247/core";
import { decideAssetChapterProbeWrite } from "@stream247/db";

// M108: how a probe answer moves a Twitch archive's chapter list towards settled, and how the
// database applies it against the row as it is inside the write lock.

const justChatting: AssetChapter[] = [{ offsetSeconds: 0, categoryName: "Just Chatting", title: "Just Chatting" }];
const wardogs: AssetChapter[] = [{ offsetSeconds: 0, categoryName: "WARDOGS", title: "WARDOGS" }];
const twoGames: AssetChapter[] = [...justChatting, { offsetSeconds: 3600, categoryName: "WARDOGS", title: "WARDOGS" }];
const threeGames: AssetChapter[] = [...twoGames, { offsetSeconds: 9000, categoryName: "Minecraft", title: "Minecraft" }];

function answer(stored: AssetChapter[], settleLevel: number, reply: AssetChapter[], recording = false) {
  return resolveChapterProbeAnswer({ stored, settleLevel, answer: reply, recording });
}

const minecraft: AssetChapter[] = [{ offsetSeconds: 0, categoryName: "Minecraft", title: "Minecraft" }];

function provisional(after: { chapters: AssetChapter[]; settleLevel: number }) {
  return isProvisionalProbedChapterList(after.chapters, after.settleLevel);
}

describe("the first answer", () => {
  it("fills an empty list, one finished answer, or a recording one", () => {
    expect(answer([], 1, wardogs)).toEqual({ chapters: wardogs, settleLevel: 1 });
    expect(answer([], 1, wardogs, true)).toEqual({ chapters: wardogs, settleLevel: 0 });
  });

  it("leaves an empty list empty on an empty answer, at level 0 while the VOD is still being recorded", () => {
    expect(answer([], 1, [])).toEqual({ chapters: [], settleLevel: 1 });
    // Review of 2026-10-06: the recording state was dropped here, so the archive waited the week an
    // empty answer of a finished VOD waits.
    expect(answer([], 1, [], true)).toEqual({ chapters: [], settleLevel: 0 });
    expect(answer([], 0, [])).toEqual({ chapters: [], settleLevel: 1 });
  });

  it("reads a missing level as a list nobody knows was taken after the recording", () => {
    expect(DEFAULT_CHAPTER_PROBE_SETTLE_LEVEL).toBe(0);
    expect(normalizeChapterProbeSettleLevel(undefined)).toBe(0);
    expect(normalizeChapterProbeSettleLevel(null)).toBe(0);
    expect(normalizeChapterProbeSettleLevel(2)).toBe(2);
    expect(normalizeChapterProbeSettleLevel(9)).toBe(CHAPTER_PROBE_SETTLED_LEVEL);
    expect(isProvisionalProbedChapterList(twoGames, undefined)).toBe(true);
  });
});

describe("a recheck of a provisional list", () => {
  it("settles a single chapter when a second finished answer agrees: one recheck for a single-game archive", () => {
    const after = answer(wardogs, 1, wardogs);
    expect(after).toEqual({ chapters: wardogs, settleLevel: CHAPTER_PROBE_SETTLED_LEVEL });
    expect(provisional(after)).toBe(false);
  });

  it("replaces the stand-in with a longer list, which is then final", () => {
    const after = answer(justChatting, 1, twoGames);
    expect(after.chapters).toEqual(twoGames);
    expect(provisional(after)).toBe(false);
  });

  // Review of 2026-10-06: an empty answer counted as one, so two of them (a throttled hour, a broken
  // extractor) made the stand-in final.
  it("never wipes a stored list on an empty answer, and an empty answer neither confirms nor counts", () => {
    const first = answer(wardogs, 1, []);
    expect(first).toEqual({ chapters: wardogs, settleLevel: 1 });
    const second = answer(first.chapters, first.settleLevel, []);
    expect(second).toEqual({ chapters: wardogs, settleLevel: 1 });
    expect(provisional(second)).toBe(true);
    expect(answer(second.chapters, second.settleLevel, wardogs).settleLevel).toBe(CHAPTER_PROBE_SETTLED_LEVEL);
  });

  it("takes a different single chapter as the newer word, and stops after the bounded number of them", () => {
    const first = answer(justChatting, 1, wardogs);
    expect(first.chapters).toEqual(wardogs);
    expect(provisional(first)).toBe(true);
    const second = answer(first.chapters, first.settleLevel, justChatting);
    expect(second.settleLevel).toBe(CHAPTER_PROBE_SETTLED_LEVEL);
    expect(provisional(second)).toBe(false);
  });

  it("keeps a longer stored list over a shorter answer", () => {
    expect(answer(twoGames, 1, wardogs)).toEqual({ chapters: twoGames, settleLevel: 1 });
  });
});

describe("a list taken while the VOD was still being recorded", () => {
  it("keeps the list provisional whatever it holds, and takes the longer answers as they come", () => {
    const early = answer([], 1, justChatting, true);
    const later = answer(early.chapters, early.settleLevel, twoGames, true);
    expect(later).toEqual({ chapters: twoGames, settleLevel: 0 });
    expect(provisional(later)).toBe(true);
    const finished = answer(later.chapters, later.settleLevel, threeGames);
    expect(finished).toEqual({ chapters: threeGames, settleLevel: 1 });
    expect(provisional(finished)).toBe(false);
  });

  it("does not let an answer taken while recording count towards settling a single chapter", () => {
    const recorded = answer([], 1, wardogs, true);
    const firstFinished = answer(recorded.chapters, recorded.settleLevel, wardogs);
    expect(firstFinished.settleLevel).toBe(1);
    expect(provisional(firstFinished)).toBe(true);
    const secondFinished = answer(firstFinished.chapters, firstFinished.settleLevel, wardogs);
    expect(secondFinished.settleLevel).toBe(CHAPTER_PROBE_SETTLED_LEVEL);
  });

  // Review of 2026-10-06: the stream switched to Minecraft after this list was taken, and the first
  // answer after its end was yt-dlp's stand-in (Twitch had not computed the chapters yet). Kept, it
  // raised the level, and the two-chapter list became final without the Minecraft chapter.
  it("stays provisional on an empty or shorter finished answer until one confirms or replaces it", () => {
    for (const degraded of [[], minecraft]) {
      const kept = answer(twoGames, 0, degraded);
      expect(kept).toEqual({ chapters: twoGames, settleLevel: 0 });
      expect(provisional(kept)).toBe(true);
    }
    const whole = answer(twoGames, 0, threeGames);
    expect(whole).toEqual({ chapters: threeGames, settleLevel: 1 });
    expect(provisional(whole)).toBe(false);
    const confirmed = answer(twoGames, 0, twoGames);
    expect(confirmed).toEqual({ chapters: twoGames, settleLevel: 1 });
    expect(provisional(confirmed)).toBe(false);
  });
});

describe("whether an answer can come from a VOD still being recorded", () => {
  const listedAt = "2026-10-04T12:00:00.000Z";

  it("only within Twitch's longest broadcast after the archive was first listed", () => {
    expect(TWITCH_MAX_BROADCAST_SECONDS).toBe(48 * 60 * 60);
    expect(isRecordingAnswerPossible({ listedAt, probedAt: "2026-10-06T12:00:00.000Z" })).toBe(true);
    expect(isRecordingAnswerPossible({ listedAt, probedAt: "2026-10-06T12:00:01.000Z" })).toBe(false);
  });

  it("not when either time is unreadable", () => {
    expect(isRecordingAnswerPossible({ listedAt: "", probedAt: "2026-10-04T13:00:00.000Z" })).toBe(false);
    expect(isRecordingAnswerPossible({ listedAt: undefined, probedAt: "2026-10-04T13:00:00.000Z" })).toBe(false);
    expect(isRecordingAnswerPossible({ listedAt, probedAt: "soon" })).toBe(false);
  });
});

const fallbackJson = JSON.stringify(wardogs);
const twoGamesJson = JSON.stringify(twoGames);
const at = "2026-10-06T14:00:00.000Z";
// First listed eight hours before the probe: a "still being recorded" can be true.
const listed = "2026-10-06T06:00:00.000Z";
const probeFilled = { chaptersJson: fallbackJson, chaptersProbeStatus: "ok", chaptersProbeSettleLevel: 1, createdAt: listed };
type Selection = { selectedWith?: { chaptersJson: string; chaptersProbeStatus: "" | "ok" | "failed" }; recording?: boolean };
const recheck: Selection = { selectedWith: { chaptersJson: fallbackJson, chaptersProbeStatus: "ok" } };
const firstProbe: Selection = { selectedWith: { chaptersJson: "[]", chaptersProbeStatus: "" } };

function ok(chaptersJson: string, selection: Selection) {
  return { id: "a", chaptersProbeStatus: "ok" as const, chaptersProbedAt: at, chaptersJson, ...selection };
}

function failed(selection: Selection) {
  return { id: "a", chaptersProbeStatus: "failed" as const, chaptersProbedAt: at, ...selection };
}

function written(chaptersJson: string, chaptersProbeSettleLevel: number, chaptersProbeStatus = "ok", chaptersProbeRechecks = 0) {
  return { chaptersJson, chaptersProbeStatus, chaptersProbedAt: at, chaptersProbeSettleLevel, chaptersProbeRechecks };
}

describe("decideAssetChapterProbeWrite", () => {
  it("replaces a probe-filled stand-in with a longer answer", () => {
    expect(decideAssetChapterProbeWrite(probeFilled, ok(twoGamesJson, recheck))).toEqual(written(twoGamesJson, 2, "ok", 1));
  });

  it("keeps the stand-in on the same answer, an empty one or a failed probe", () => {
    expect(decideAssetChapterProbeWrite(probeFilled, ok(fallbackJson, recheck))).toEqual(
      written(fallbackJson, CHAPTER_PROBE_SETTLED_LEVEL, "ok", 1)
    );
    expect(decideAssetChapterProbeWrite(probeFilled, ok("[]", recheck))).toEqual(written(fallbackJson, 1, "ok", 1));
    // A failed recheck is still the probe's list: "ok" stays, only the probe time moves. Listed eight
    // hours before, the VOD may still be recording, so the failure does not count towards the cap.
    expect(decideAssetChapterProbeWrite(probeFilled, failed(recheck))).toEqual(written(fallbackJson, 1));
  });

  it("leaves a row alone that changed after the selection", () => {
    // The operator edited the list while the probe ran: new list, status reset to "".
    const edited = { chaptersJson: JSON.stringify(justChatting), chaptersProbeStatus: "", chaptersProbeSettleLevel: 1, createdAt: listed };
    expect(decideAssetChapterProbeWrite(edited, ok(twoGamesJson, recheck))).toBeNull();
    // Saved the very same list: only the status says it is the operator's now.
    const resaved = { ...probeFilled, chaptersProbeStatus: "" };
    expect(decideAssetChapterProbeWrite(resaved, ok(twoGamesJson, recheck))).toBeNull();
    // An edit landing before the first probe of a never-probed asset.
    const filled = { chaptersJson: twoGamesJson, chaptersProbeStatus: "", chaptersProbeSettleLevel: 1, createdAt: listed };
    expect(decideAssetChapterProbeWrite(filled, ok(fallbackJson, firstProbe))).toBeNull();
    expect(decideAssetChapterProbeWrite(filled, failed(firstProbe))).toBeNull();
  });

  it("never touches an operator-edited or ingest-filled list, even when it was selected with it", () => {
    const operators = { chaptersJson: fallbackJson, chaptersProbeStatus: "", chaptersProbeSettleLevel: 1, createdAt: listed };
    const selected: Selection = { selectedWith: { chaptersJson: fallbackJson, chaptersProbeStatus: "" } };
    expect(decideAssetChapterProbeWrite(operators, ok(twoGamesJson, selected))).toBeNull();
  });

  it("fills an empty list and records a first failure as before", () => {
    const empty = { chaptersJson: "[]", chaptersProbeStatus: "", chaptersProbeSettleLevel: 1, createdAt: listed };
    expect(decideAssetChapterProbeWrite(empty, ok(fallbackJson, { ...firstProbe, recording: true }))).toEqual(
      written(fallbackJson, 0)
    );
    expect(decideAssetChapterProbeWrite(empty, failed(firstProbe))).toEqual(written("[]", 1, "failed"));
  });

  it("believes a recording answer only within Twitch's longest broadcast after the archive was first listed", () => {
    const empty = { chaptersJson: "[]", chaptersProbeStatus: "", chaptersProbeSettleLevel: 1, createdAt: listed };
    const recording = { ...firstProbe, recording: true };
    // An empty answer of a VOD still being recorded stays provisional (level 0), review of 2026-10-06.
    expect(decideAssetChapterProbeWrite(empty, ok("[]", recording))).toEqual(written("[]", 0));
    // Listed three days before the probe: the broadcast is over whatever the preview picture says.
    const old = { ...empty, createdAt: "2026-10-03T14:00:00.000Z" };
    expect(decideAssetChapterProbeWrite(old, ok(fallbackJson, recording))).toEqual(written(fallbackJson, 1));
    expect(decideAssetChapterProbeWrite({ ...empty, createdAt: "" }, ok(fallbackJson, recording))).toEqual(
      written(fallbackJson, 1)
    );
  });

  it("keeps the only-fill-empty rule for a caller without a selection snapshot", () => {
    expect(decideAssetChapterProbeWrite(probeFilled, ok(twoGamesJson, {}))).toEqual(written(fallbackJson, 1));
  });
});

// M108 gate, 2026-10-06: an empty or shorter answer and a failed probe keep the list and its level,
// so a provisional list of a source that never answers properly was asked every interval forever.
describe("the recheck cap", () => {
  // Listed three days before the probe: the recording window is over.
  const finished = "2026-10-03T14:00:00.000Z";
  const counting = { ...probeFilled, chaptersProbeRechecks: 2, createdAt: finished };
  const multiRecheck: Selection = { selectedWith: { chaptersJson: twoGamesJson, chaptersProbeStatus: "ok" } };
  const multiAtZero = { chaptersJson: twoGamesJson, chaptersProbeStatus: "ok", chaptersProbeSettleLevel: 0, chaptersProbeRechecks: 2 };

  it("is six, room for the longest chain that settles a list and as many answers that say nothing", () => {
    expect(CHAPTER_PROBE_RECHECK_CAP).toBe(6);
    expect(CHAPTER_PROBE_RECHECK_CAP).toBe(2 * CHAPTER_PROBE_SETTLED_LEVEL);
    expect(normalizeChapterProbeRechecks(undefined)).toBe(0);
    expect(normalizeChapterProbeRechecks(null)).toBe(0);
    expect(normalizeChapterProbeRechecks(-3)).toBe(0);
    expect(normalizeChapterProbeRechecks(4)).toBe(4);
    expect(normalizeChapterProbeRechecks(40)).toBe(CHAPTER_PROBE_RECHECK_CAP);
  });

  it("settles a list whose rechecks reached it, whatever its level and shape", () => {
    expect(isProvisionalProbedChapterList(wardogs, 1, CHAPTER_PROBE_RECHECK_CAP - 1)).toBe(true);
    expect(isProvisionalProbedChapterList(wardogs, 1, CHAPTER_PROBE_RECHECK_CAP)).toBe(false);
    expect(isProvisionalProbedChapterList(twoGames, 0, CHAPTER_PROBE_RECHECK_CAP - 1)).toBe(true);
    expect(isProvisionalProbedChapterList(twoGames, 0, CHAPTER_PROBE_RECHECK_CAP)).toBe(false);
  });

  it("counts every finished answer to a recheck: the same, a replacing, an empty and a shorter one", () => {
    expect(decideAssetChapterProbeWrite(counting, ok(fallbackJson, recheck))?.chaptersProbeRechecks).toBe(3);
    expect(decideAssetChapterProbeWrite(counting, ok(twoGamesJson, recheck))?.chaptersProbeRechecks).toBe(3);
    expect(decideAssetChapterProbeWrite(counting, ok("[]", recheck))).toEqual(written(fallbackJson, 1, "ok", 3));
    const shorter = decideAssetChapterProbeWrite({ ...multiAtZero, createdAt: finished }, ok(fallbackJson, multiRecheck));
    expect(shorter).toEqual(written(twoGamesJson, 0, "ok", 3));
  });

  it("counts a failed recheck once the recording window is over", () => {
    expect(decideAssetChapterProbeWrite(counting, failed(recheck))).toEqual(written(fallbackJson, 1, "ok", 3));
    // An unreadable first-listed time cannot bound a recording, so the failure counts.
    expect(decideAssetChapterProbeWrite({ ...counting, createdAt: "" }, failed(recheck))?.chaptersProbeRechecks).toBe(3);
  });

  it("does not count a recording answer or a failure while a recording answer is still possible", () => {
    const recent = { ...multiAtZero, createdAt: listed };
    const recording = { ...multiRecheck, recording: true };
    expect(decideAssetChapterProbeWrite(recent, ok(twoGamesJson, recording))).toEqual(written(twoGamesJson, 0, "ok", 2));
    expect(decideAssetChapterProbeWrite(recent, failed(multiRecheck))).toEqual(written(twoGamesJson, 0, "ok", 2));
    // After the window a recording mark is a stuck preview picture: a finished answer, counted.
    const stuck = decideAssetChapterProbeWrite({ ...multiAtZero, createdAt: finished }, ok(twoGamesJson, recording));
    expect(stuck).toEqual(written(twoGamesJson, 1, "ok", 3));
  });

  it("stops counting at the cap", () => {
    const capped = { ...counting, chaptersProbeRechecks: CHAPTER_PROBE_RECHECK_CAP };
    expect(decideAssetChapterProbeWrite(capped, failed(recheck))?.chaptersProbeRechecks).toBe(CHAPTER_PROBE_RECHECK_CAP);
  });

  it("starts anew when a probe fills an empty list, and leaves first probes and empty rechecks alone", () => {
    // An operator cleared a capped list to hand it back to the backfill.
    const cleared = { chaptersJson: "[]", chaptersProbeStatus: "", chaptersProbeSettleLevel: 1, chaptersProbeRechecks: 6, createdAt: finished };
    expect(decideAssetChapterProbeWrite(cleared, ok(fallbackJson, firstProbe))).toEqual(written(fallbackJson, 1));
    expect(decideAssetChapterProbeWrite(cleared, ok("[]", firstProbe))).toEqual(written("[]", 1));
    expect(decideAssetChapterProbeWrite(cleared, failed(firstProbe))).toEqual(written("[]", 1, "failed", 6));
    const emptyRecheck: Selection = { selectedWith: { chaptersJson: "[]", chaptersProbeStatus: "ok" } };
    const empty = { ...cleared, chaptersProbeStatus: "ok", chaptersProbeRechecks: 0 };
    expect(decideAssetChapterProbeWrite(empty, ok("[]", emptyRecheck))).toEqual(written("[]", 1));
  });
});
