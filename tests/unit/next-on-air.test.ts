import { describe, expect, it } from "vitest";
import {
  buildOverlaySceneLayout,
  buildOverlayScenePayload,
  buildOverlayTextLinesFromScenePayload,
  formatChatNextReply,
  getScheduleOccurrenceRunKey,
  type ScheduleBlock,
  type ScheduleOccurrence
} from "@stream247/core";
import {
  nextOnAirCardText,
  predictNextOnAir,
  scheduleOccurrenceAt,
  type NextOnAirPlayout,
  type NextOnAirSources
} from "../../apps/worker/src/next-on-air.js";
import { buildChatProgrammeInfo, type ChatPlayoutRow } from "../../apps/worker/src/chat-programme-info.js";
import { layoutTexts, storedDefaults } from "./viewer-language-helpers";

/**
 * M107 (owner, 2026-10-06): the on-air Next card names the video that airs next, as !next does.
 *
 * Before, the card named the next schedule block (its first video and its window, "16:00-00:00") while !next
 * named the playout's next queue item, so during a long archive the picture and the chat contradicted each
 * other. One prediction (apps/worker/src/next-on-air.ts) now serves both.
 *
 * The channel: Tuesday 2026-10-06 in Europe/Berlin (CEST, UTC+2). The weekly "TwitchYoutube" block runs
 * 10:00-16:00 from the day pool, "Evening" 16:00-24:00 from the evening pool. It is 14:00 on the wall clock.
 */

const TIME_ZONE = "Europe/Berlin";
const NOW = new Date("2026-10-06T12:00:00.000Z");
const at = (wallClock: string) => new Date(`2026-10-06T${wallClock}:00.000+02:00`);

function block(overrides: Partial<ScheduleBlock>): ScheduleBlock {
  return { id: "block", title: "Block", categoryName: "Retro", dayOfWeek: 2, startMinuteOfDay: 0, durationMinutes: 60, sourceName: "Twitch", ...overrides };
}

const WEEK: ScheduleBlock[] = [
  block({ id: "day", title: "TwitchYoutube", startMinuteOfDay: 10 * 60, durationMinutes: 6 * 60, poolId: "pool-day" }),
  block({ id: "evening", title: "Evening", startMinuteOfDay: 16 * 60, durationMinutes: 8 * 60, poolId: "pool-evening" })
];
// A one-off 15:00-15:30 today (M93): it takes the air at its start and gives it back at its end (M105).
const ONE_OFF = block({
  id: "special",
  title: "Special",
  startMinuteOfDay: 15 * 60,
  durationMinutes: 30,
  poolId: "pool-special",
  validFrom: "2026-10-06",
  validUntil: "2026-10-06"
});

const ASSETS: Record<string, { title: string; durationSeconds: number }> = {
  archive: { title: "Long Archive", durationSeconds: 4 * 3600 },
  short: { title: "Short Clip", durationSeconds: 3600 },
  unknown: { title: "No Length", durationSeconds: 0 },
  dayNext: { title: "Day Pool Next", durationSeconds: 1800 },
  evening: { title: "Evening Opener", durationSeconds: 1800 },
  special: { title: "Special Pick", durationSeconds: 1800 },
  insert: { title: "Station Ident", durationSeconds: 300 },
  moved: { title: "Moved Up By The Operator", durationSeconds: 1800 },
  playNow: { title: "Operator Pick", durationSeconds: 2 * 3600 },
  loop: { title: "Fallback Loop", durationSeconds: 300 }
};

/** The run the playout cycle records (cuepointWindowKey) for the block on air at a wall-clock time. */
function runAt(wallClock: string, blocks: ScheduleBlock[] = WEEK): string {
  const occurrence = scheduleOccurrenceAt(blocks, at(wallClock), TIME_ZONE);
  return occurrence ? getScheduleOccurrenceRunKey(occurrence) : "";
}

/** The worker's picks, reduced to one item per pool: what selectPoolAsset would answer. */
function sources(picks: Record<string, string | null> = {}): NextOnAirSources {
  const pools: Record<string, string | null> = { "pool-day": "dayNext", "pool-evening": "evening", "pool-special": "special", ...picks };
  return {
    asset: (assetId) => ASSETS[assetId] ?? null,
    pickForBlock: (target: ScheduleOccurrence) => {
      const assetId = target.poolId ? pools[target.poolId] : null;
      return assetId ? { assetId, title: ASSETS[assetId]!.title } : null;
    },
    // The card's title for a block: its pool's next video (the worker's lookahead), else the block's name.
    blockTitle: (target) => {
      const assetId = target.poolId ? pools[target.poolId] : null;
      return assetId ? ASSETS[assetId]!.title : target.title;
    }
  };
}

/** A one-hour clip on air since 13:30 (it ends at 14:30), the day pool's next item queued. */
function playing(overrides: Partial<NextOnAirPlayout> = {}): NextOnAirPlayout {
  return {
    playing: true,
    queueKind: "asset",
    currentAssetId: "short",
    processStartedAt: at("13:30").toISOString(),
    nextAssetId: "dayNext",
    nextTitle: "Day Pool Next",
    manualNextAssetId: "",
    insertAssetId: "",
    insertStatus: "",
    overrideAssetId: "",
    overrideUntil: "",
    // The cycle has recorded the day block's run, as at every cycle since 10:00.
    cuepointWindowKey: runAt("13:30"),
    ...overrides
  };
}

function predict(
  playout: NextOnAirPlayout,
  options: { blocks?: ScheduleBlock[]; picks?: Record<string, string | null>; now?: Date } = {}
) {
  return predictNextOnAir({
    playout,
    now: options.now ?? NOW,
    timeZone: TIME_ZONE,
    scheduleBlocks: options.blocks ?? WEEK,
    sources: sources(options.picks)
  });
}

const item = (assetId: string, startsAt: Date | null) => ({ kind: "item", assetId, title: ASSETS[assetId]!.title, startsAt });

describe("what airs next: the prediction", () => {
  it("is the queue's next item when the item on air ends inside its block, from its expected end", () => {
    expect(predict(playing())).toEqual(item("dayNext", at("14:30")));
  });

  it("is the next block's pick when the item on air runs past the block's end (items are not cut at weekly boundaries)", () => {
    // The owner's case: a four-hour archive from 13:30 ends at 17:30, in the evening block.
    expect(predict(playing({ currentAssetId: "archive" }))).toEqual(item("evening", at("17:30")));
  });

  it("is a dated block's first pick, at its start, when it takes the air before the item on air ends", () => {
    expect(predict(playing({ currentAssetId: "archive" }), { blocks: [...WEEK, ONE_OFF] })).toEqual(item("special", at("15:00")));
  });

  it("lets the item play on past a dated block that has nothing to take the air with", () => {
    // The takeover waits (review of M105), and the weekly block coming back at 15:30 is no change of run.
    expect(predict(playing({ currentAssetId: "archive" }), { blocks: [...WEEK, ONE_OFF], picks: { "pool-special": null } })).toEqual(
      item("evening", at("17:30"))
    );
  });

  it("is a pending Play now / Insert, which cuts whatever is on air, without a time", () => {
    expect(predict(playing({ insertAssetId: "insert", insertStatus: "pending" }))).toEqual(item("insert", null));
    // Also while nothing plays.
    expect(predict(playing({ playing: false, insertAssetId: "insert", insertStatus: "pending" }))).toEqual(item("insert", null));
  });

  it("is, after an insert, the item the schedule resumes with", () => {
    const insertOnAir = playing({ queueKind: "insert", currentAssetId: "insert", processStartedAt: at("13:58").toISOString() });
    expect(predict(insertOnAir)).toEqual(item("dayNext", at("14:03")));
    // An active insert is on air, not pending: the row's insert fields name the item on air.
    expect(predict({ ...insertOnAir, insertAssetId: "insert", insertStatus: "pending" })).toEqual(item("dayNext", at("14:03")));
  });

  it("is the operator's Move next at the item's end, whatever block is current then", () => {
    const moved = playing({ currentAssetId: "archive", nextAssetId: "moved", nextTitle: ASSETS.moved!.title, manualNextAssetId: "moved" });
    expect(predict(moved)).toEqual(item("moved", at("17:30")));
  });

  it("is today's next block, with its card title, when nothing plays", () => {
    const prediction = predict(playing({ playing: false, currentAssetId: "", processStartedAt: "" }));
    expect(prediction).toMatchObject({ kind: "block", title: "Evening Opener", block: { blockId: "evening", startTime: "16:00" } });
  });

  it("has no time when the length of the item on air is unknown, and names the queue's next item", () => {
    expect(predict(playing({ currentAssetId: "unknown" }))).toEqual(item("dayNext", null));
    expect(predict(playing({ processStartedAt: "" }))).toEqual(item("dayNext", null));
    // A Live Bridge runs until the operator releases it.
    expect(predict(playing({ queueKind: "live", currentAssetId: "" }))).toEqual(item("dayNext", null));
    // Past its planned end the item ends any moment, but not at a time worth printing.
    expect(predict(playing({ processStartedAt: at("12:00").toISOString() }))).toEqual(item("dayNext", null));
  });

  it("never names the item on air: a row from the cycle before it started is stepped over", () => {
    // The row still says "dayNext" is next while "dayNext" already plays; the day pool's pick is then
    // something else, or, before the pool has stored its position, the same item, and so the next block.
    const stale = playing({ currentAssetId: "dayNext", processStartedAt: at("13:50").toISOString(), nextAssetId: "dayNext", nextTitle: "Day Pool Next" });
    expect(predict(stale, { picks: { "pool-day": "short" } })).toEqual(item("short", at("14:20")));
    expect(predict(stale)).toMatchObject({ kind: "block", title: "Evening Opener" });
  });

  it("falls back to today's next block when no item can be predicted, and to nothing after the last one", () => {
    const empty = playing({ currentAssetId: "archive", nextAssetId: "", nextTitle: "" });
    expect(predict(empty, { picks: { "pool-evening": null } })).toMatchObject({ kind: "block", block: { blockId: "evening" } });
    expect(predict(playing({ playing: false }), { blocks: [] })).toEqual({ kind: "none" });
  });

  // Review of M107: the operator's arms come before the schedule in the worker, so they do here.
  it("names no video while a Pin or Temporary fallback holds the air, but today's next block", () => {
    // The clip on air pinned until 14:45: the override arm starts it again when it ends at 14:30, and the
    // pool's next video was named at 14:30 instead.
    const pinned = playing({ overrideAssetId: "short", overrideUntil: at("14:45").toISOString() });
    expect(predict(pinned)).toMatchObject({ kind: "block", title: "Evening Opener", block: { blockId: "evening" } });
    // A Temporary fallback is the same override with a short looping item: the time moved on every loop.
    const fallbackLoop = playing({
      currentAssetId: "loop",
      processStartedAt: at("13:58").toISOString(),
      overrideAssetId: "loop",
      overrideUntil: at("14:58").toISOString()
    });
    expect(predict(fallbackLoop)).toMatchObject({ kind: "block", block: { blockId: "evening" } });
    // A Play now pending under a Pin is dropped as preempted: not next either.
    expect(predict({ ...pinned, insertAssetId: "playNow", insertStatus: "pending" })).toMatchObject({ kind: "block" });
    // Run out, the override holds nothing.
    expect(predict(playing({ overrideAssetId: "short", overrideUntil: at("13:59").toISOString() }))).toEqual(item("dayNext", at("14:30")));
  });

  it("lets a Play now on air run across a dated block's start: nothing cuts it, the block current at its end picks", () => {
    const blocks = [...WEEK, ONE_OFF];
    // Two hours from 13:45, past the one-off 15:00-15:30, ending at 15:45 in the day block again.
    const playNow = playing({
      queueKind: "insert",
      currentAssetId: "playNow",
      processStartedAt: at("13:45").toISOString(),
      insertAssetId: "playNow",
      insertStatus: "active"
    });
    expect(predict(playNow, { blocks })).toEqual(item("dayNext", at("15:45")));
    // Also in the cycle that starts it, whose row still says "pending".
    expect(predict({ ...playNow, insertStatus: "pending" }, { blocks })).toEqual(item("dayNext", at("15:45")));
    // Ending inside the one-off, the one-off's pool picks at its end.
    expect(predict({ ...playNow, processStartedAt: at("13:20").toISOString() }, { blocks })).toEqual(item("special", at("15:20")));
    // A scheduled item in the same place is cut at 15:00.
    expect(predict({ ...playNow, queueKind: "asset", insertAssetId: "", insertStatus: "" }, { blocks })).toEqual(item("special", at("15:00")));
  });

  it("judges a dated block's start against the run the cycle recorded, as the worker does", () => {
    const blocks = [...WEEK, ONE_OFF];
    const now = at("15:10");
    // 15:10, the one-off has started but its pool has nothing to take the air with (a pick still
    // downloading, a source the breaker holds): the archive plays on, the cycle records the day block's run
    // again, and the day block coming back at 15:30 cuts nothing. It was named at 15:30.
    const waiting = playing({ currentAssetId: "archive" });
    expect(predict(waiting, { blocks, picks: { "pool-special": null }, now })).toEqual(item("evening", at("17:30")));
    // With a pick, the next cycle cuts to it: next, without a time.
    expect(predict(waiting, { blocks, now })).toEqual(item("special", null));
    // Cut at 15:05, the cycle recorded the one-off's run: the day block takes the air back at 15:30.
    const cut = playing({
      currentAssetId: "special",
      processStartedAt: at("15:05").toISOString(),
      nextAssetId: "",
      nextTitle: "",
      cuepointWindowKey: runAt("15:05", blocks)
    });
    expect(predict(cut, { blocks, now })).toEqual(item("dayNext", at("15:30")));
    // In the seconds before that cycle writes its run, its pick on air says the cut has happened.
    expect(predict({ ...cut, cuepointWindowKey: runAt("13:30") }, { blocks, now })).toEqual(item("dayNext", at("15:30")));
  });

  it("names the video on air when the next block's pool starts it again, and never titles a block card with it", () => {
    // The evening pool shares a source with the day pool and has the archive next (its own position never
    // moved past it): the worker starts the archive again at 17:30, so that is what airs.
    expect(predict(playing({ currentAssetId: "archive" }), { picks: { "pool-evening": "archive" } })).toEqual(item("archive", at("17:30")));
    // Falling back to the next block (here: no length, nothing queued), its card is not titled with the video
    // on air ("Next: <what is on air> · 16:00-00:00") but with the block's name.
    const noLength = playing({ currentAssetId: "archive", processStartedAt: "", nextAssetId: "", nextTitle: "" });
    expect(predict(noLength, { picks: { "pool-evening": "archive" } })).toMatchObject({ kind: "block", title: "Evening" });
  });
});

describe("the Next card", () => {
  const card = (playout: NextOnAirPlayout, locale: string) =>
    nextOnAirCardText({ prediction: predict(playout), locale, timeZone: TIME_ZONE, now: NOW });

  it("gives a video the time it is expected to start, in the channel zone, never a block's window", () => {
    expect(card(playing({ currentAssetId: "archive" }), "en")).toEqual({ nextTitle: "Evening Opener", nextTimeLabel: "about 17:30" });
    expect(card(playing({ currentAssetId: "archive" }), "de")).toEqual({ nextTitle: "Evening Opener", nextTimeLabel: "ca. 17:30" });
  });

  it("gives a video without a known start no time at all", () => {
    expect(card(playing({ currentAssetId: "unknown" }), "en")).toEqual({ nextTitle: "Day Pool Next", nextTimeLabel: "" });
  });

  it("keeps a block's window and how soon it starts while nothing plays", () => {
    const idle = playing({ playing: false });
    expect(card(idle, "en")).toEqual({ nextTitle: "Evening Opener", nextTimeLabel: "16:00-00:00 · in 2 h" });
    expect(card(idle, "de")).toEqual({ nextTitle: "Evening Opener", nextTimeLabel: "16:00–00:00 · in 2 Std." });
  });

  it("says nothing is scheduled when there is no next item and no next block", () => {
    const none = nextOnAirCardText({ prediction: { kind: "none" }, locale: "de", timeZone: TIME_ZONE, now: NOW });
    expect(none).toEqual({ nextTitle: "", nextTimeLabel: "Noch nichts geplant" });
  });
});

describe("the on-air payload, the picture and text mode", () => {
  // The call buildWorkerScenePayload makes, with the stored overlay defaults ("split-now-next").
  function payload(playout: NextOnAirPlayout, locale: string) {
    const next = nextOnAirCardText({ prediction: predict(playout), locale, timeZone: TIME_ZONE, now: NOW });
    return buildOverlayScenePayload({
      overlay: storedDefaults(),
      queueKind: "asset",
      target: "on-air-text",
      currentTitle: "Long Archive",
      nextTitle: next.nextTitle,
      nextTimeLabel: next.nextTimeLabel,
      timeZone: TIME_ZONE,
      locale
    });
  }
  const FRAME = { width: 1920, height: 1080, now: NOW };

  it("names the next video under the Next label with its expected start, in English and German", () => {
    const en = payload(playing({ currentAssetId: "archive" }), "en");
    expect([en.nextLabel, en.nextTitle, en.nextTimeLabel]).toEqual(["Next", "Evening Opener", "about 17:30"]);
    const de = payload(playing({ currentAssetId: "archive" }), "de");
    expect([de.nextLabel, de.nextTitle, de.nextTimeLabel]).toEqual(["Als Nächstes", "Evening Opener", "ca. 17:30"]);
  });

  it("draws the heading upper-cased with the time, or the label alone when the start is unknown", () => {
    expect(layoutTexts(buildOverlaySceneLayout({ payload: payload(playing({ currentAssetId: "archive" }), "de") }, FRAME))).toContain(
      "ALS NÄCHSTES · CA. 17:30"
    );
    const unknown = payload(playing({ currentAssetId: "unknown" }), "en");
    expect(unknown.nextTimeLabel).toBe("");
    const texts = layoutTexts(buildOverlaySceneLayout({ payload: unknown }, FRAME));
    expect(texts).toContain("NEXT");
    expect(texts).toContain("Day Pool Next");
    expect(texts.join("\n")).not.toMatch(/NOTHING SCHEDULED/);
  });

  it("writes the same title on text mode's Next line", () => {
    expect(buildOverlayTextLinesFromScenePayload(payload(playing({ currentAssetId: "archive" }), "en"))).toContain("Next: Evening Opener");
    expect(buildOverlayTextLinesFromScenePayload(payload(playing({ currentAssetId: "archive" }), "de"))).toContain(
      "Als Nächstes: Evening Opener"
    );
  });

  it("still says nothing is scheduled when the caller gives no time label at all", () => {
    const bare = buildOverlayScenePayload({
      overlay: storedDefaults(),
      queueKind: "asset",
      target: "on-air-text",
      currentTitle: "Long Archive",
      nextTitle: "",
      locale: "en"
    });
    expect(bare.nextTimeLabel).toBe("Nothing scheduled");
  });
});

describe("the card and !next agree", () => {
  /** The row as the playout writes it while the item plays (packages/db readPlayoutProgrammeTitles). */
  function row(overrides: Partial<ChatPlayoutRow> = {}): ChatPlayoutRow {
    const { playing: _playing, ...fields } = playing({ currentAssetId: "archive" });
    return { ...fields, status: "running", currentTitle: "Long Archive", ...overrides };
  }
  const predictNext = (playout: NextOnAirPlayout) =>
    predictNextOnAir({ playout, now: NOW, timeZone: TIME_ZONE, scheduleBlocks: WEEK, sources: sources() });

  for (const locale of ["en", "de"]) {
    it(`names the same video at the same time, in ${locale}`, () => {
      // The playout cycle's card: the item it plays, the queue it is about to write.
      const { status: _status, currentTitle: _title, ...fields } = row();
      const card = nextOnAirCardText({ prediction: predictNext({ ...fields, playing: true }), locale, timeZone: TIME_ZONE, now: NOW });
      // The bot, asked at the same moment, from the row.
      const info = buildChatProgrammeInfo({ playout: row(), predictNext, timeZone: TIME_ZONE, appUrl: "", locale });

      expect(info.nextTitle).toBe(card.nextTitle);
      expect(info.nextTitle).toBe("Evening Opener");
      expect(info.nextExpectedAt).toBe("17:30");
      expect(card.nextTimeLabel).toContain(info.nextExpectedAt);
      expect(formatChatNextReply("ada", info, locale)).toBe(
        locale === "de" ? "@ada als Nächstes um ca. 17:30: Evening Opener." : "@ada next at about 17:30: Evening Opener."
      );
    });
  }

  it("agree on the next block while nothing plays: the card's title, the block's start", () => {
    const standby = row({ status: "standby", currentTitle: "Replay standby", currentAssetId: "", nextAssetId: "", nextTitle: "" });
    const info = buildChatProgrammeInfo({ playout: standby, predictNext, timeZone: TIME_ZONE, appUrl: "", locale: "en" });
    const { status: _status, currentTitle: _title, ...fields } = standby;
    const card = nextOnAirCardText({ prediction: predictNext({ ...fields, playing: false }), locale: "en", timeZone: TIME_ZONE, now: NOW });
    expect(info).toMatchObject({ nowTitle: "", nextTitle: card.nextTitle, nextStartsAt: "16:00", nextExpectedAt: "" });
    expect(formatChatNextReply("ada", info, "en")).toBe("@ada next at 16:00: Evening Opener.");
  });

  // The worker writes "recovering" for every cycle of a Pin, a Fallback, the automatic global or generic
  // fallback, and the cycle that starts a Move next or a scheduled insert; the card is drawn over that item.
  // !next read it as nothing playing (review of M107).
  const cardAndBot = (playout: ChatPlayoutRow) => {
    const { status: _status, currentTitle: _title, ...fields } = playout;
    return {
      card: nextOnAirCardText({ prediction: predictNext({ ...fields, playing: true }), locale: "en", timeZone: TIME_ZONE, now: NOW }),
      info: buildChatProgrammeInfo({ playout, predictNext, timeZone: TIME_ZONE, appUrl: "", locale: "en" })
    };
  };

  it("agree on the next video under 'recovering' (an automatic fallback, a Move next's first cycle)", () => {
    const { card, info } = cardAndBot(row({ status: "recovering" }));
    expect(card).toEqual({ nextTitle: "Evening Opener", nextTimeLabel: "about 17:30" });
    expect(info).toMatchObject({ nextTitle: card.nextTitle, nextExpectedAt: "17:30" });
    // !now keeps the public page's word for that state: on a short break.
    expect(info.nowTitle).toBe("");
  });

  it("agree on today's next block while a Pin holds the air", () => {
    const { card, info } = cardAndBot(row({ status: "recovering", overrideAssetId: "archive", overrideUntil: at("15:00").toISOString() }));
    expect(card).toEqual({ nextTitle: "Evening Opener", nextTimeLabel: "16:00-00:00 · in 2 h" });
    expect(info).toMatchObject({ nextTitle: card.nextTitle, nextStartsAt: "16:00", nextExpectedAt: "" });
  });
});
