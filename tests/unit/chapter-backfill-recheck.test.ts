import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAPTER_EMPTY_RECHECK_SECONDS,
  getChapterBackfillConfig,
  selectChapterBackfillCandidates,
  type ChapterBackfillAsset,
  type ChapterBackfillSource
} from "../../apps/worker/src/chapter-backfill.js";

const NOW = Date.parse("2026-08-28T12:00:00.000Z");
const COOLDOWN_MS = 30 * 60 * 1000;
const RECHECK_MS = DEFAULT_CHAPTER_EMPTY_RECHECK_SECONDS * 1000;

const sources: ChapterBackfillSource[] = [
  { id: "src_yt", connectorKind: "youtube-playlist", enabled: true },
  { id: "src_twitch", connectorKind: "twitch-channel", enabled: true }
];

function makeAsset(overrides: Partial<ChapterBackfillAsset> & Pick<ChapterBackfillAsset, "id">): ChapterBackfillAsset {
  return {
    sourceId: "src_yt",
    path: `https://example.com/${overrides.id}.mp4`,
    chaptersJson: "[]",
    chaptersProbeStatus: "",
    chaptersProbedAt: "",
    ...overrides
  };
}

function select(assets: ChapterBackfillAsset[], budget = 10, nowMs = NOW) {
  return selectChapterBackfillCandidates({
    assets,
    sources,
    budget,
    failureCooldownMs: COOLDOWN_MS,
    emptyResultRecheckMs: RECHECK_MS,
    nowMs
  }).map((candidate) => candidate.assetId);
}

/** An asset whose probe came back valid but carried no chapters, `ageMs` ago. */
function probedEmpty(id: string, ageMs: number, sourceId = "src_yt"): ChapterBackfillAsset {
  return makeAsset({
    id,
    sourceId,
    chaptersProbeStatus: "ok",
    chaptersProbedAt: new Date(NOW - ageMs).toISOString()
  });
}

// B1: a valid probe that returned no chapters wrote chaptersProbeStatus "ok", an absorbing state.
// A rate limit, a geo- or subscriber-restricted variant and a yt-dlp extractor regression all
// produce exactly that answer, and there was no re-probe path and no reset in the UI — so the
// asset went on air with the wrong category and title forever. Note the asymmetry it created:
// "failed" healed through the cooldown, "ok" never healed at all.
describe("an empty chapter probe result is provisional, not final", () => {
  it("does not re-probe an empty result straight away", () => {
    expect(select([probedEmpty("a_recent", RECHECK_MS - 60_000)])).toEqual([]);
  });

  it("re-probes an empty result once the recheck interval has passed", () => {
    expect(select([probedEmpty("a_due", RECHECK_MS + 60_000)])).toEqual(["a_due"]);
  });

  it("waits far longer than the failure cooldown before spending budget on a recheck", () => {
    expect(RECHECK_MS).toBeGreaterThan(COOLDOWN_MS * 10);
    expect(select([probedEmpty("a_cooled", COOLDOWN_MS * 2)])).toEqual([]);
  });

  it("treats an unreadable probe timestamp as due, the same way a failure does", () => {
    expect(select([makeAsset({ id: "a_corrupt", chaptersProbeStatus: "ok", chaptersProbedAt: "not-a-date" })])).toEqual([
      "a_corrupt"
    ]);
  });
});

describe("operator edits still win over any recheck", () => {
  it("never selects an asset that has chapters, however old the probe", () => {
    const edited = JSON.stringify([{ offsetSeconds: 0, categoryName: "Just Chatting", title: "Operator cut" }]);
    const asset = makeAsset({
      id: "a_edited",
      sourceId: "src_twitch",
      chaptersJson: edited,
      chaptersProbeStatus: "ok",
      chaptersProbedAt: new Date(NOW - 100 * RECHECK_MS).toISOString()
    });

    expect(select([asset])).toEqual([]);
  });
});

describe("recheck budget invariants", () => {
  it("never exceeds the per-cycle budget", () => {
    const due = [probedEmpty("a1", 2 * RECHECK_MS), probedEmpty("a2", 3 * RECHECK_MS), probedEmpty("a3", 4 * RECHECK_MS)];
    expect(select(due, 2)).toHaveLength(2);
    expect(select(due, 0)).toEqual([]);
  });

  it("puts never-probed assets and failure retries ahead of rechecks", () => {
    const assets = [
      probedEmpty("a_recheck", 5 * RECHECK_MS),
      makeAsset({
        id: "a_retry",
        chaptersProbeStatus: "failed",
        chaptersProbedAt: new Date(NOW - 4 * COOLDOWN_MS).toISOString()
      }),
      makeAsset({ id: "a_new" })
    ];

    // A backlog of rechecks must never starve a newly ingested asset of its first probe.
    expect(select(assets, 3)).toEqual(["a_new", "a_retry", "a_recheck"]);
    expect(select(assets, 1)).toEqual(["a_new"]);
  });

  it("rechecks the least recently probed asset first", () => {
    expect(select([probedEmpty("a_newer", 2 * RECHECK_MS), probedEmpty("a_older", 9 * RECHECK_MS)], 1)).toEqual([
      "a_older"
    ]);
  });
});

describe("recheck configuration", () => {
  it("defaults to an interval much longer than the failure cooldown", () => {
    const config = getChapterBackfillConfig({});
    expect(config.emptyResultRecheckMs).toBe(DEFAULT_CHAPTER_EMPTY_RECHECK_SECONDS * 1000);
    expect(config.emptyResultRecheckMs).toBeGreaterThan(config.failureCooldownMs);
  });

  it("is operator-tunable and rejects nonsense", () => {
    expect(getChapterBackfillConfig({ CHAPTER_BACKFILL_EMPTY_RECHECK_SECONDS: "3600" }).emptyResultRecheckMs).toBe(3_600_000);
    expect(getChapterBackfillConfig({ CHAPTER_BACKFILL_EMPTY_RECHECK_SECONDS: "nope" }).emptyResultRecheckMs).toBe(
      DEFAULT_CHAPTER_EMPTY_RECHECK_SECONDS * 1000
    );
  });

  // 0 turns rechecks off entirely, for an operator who would rather pay nothing for them.
  it("treats zero as never recheck", () => {
    expect(getChapterBackfillConfig({ CHAPTER_BACKFILL_EMPTY_RECHECK_SECONDS: "0" }).emptyResultRecheckMs).toBe(0);
    expect(
      selectChapterBackfillCandidates({
        assets: [probedEmpty("a_old", 100 * RECHECK_MS)],
        sources,
        budget: 5,
        failureCooldownMs: COOLDOWN_MS,
        emptyResultRecheckMs: 0,
        nowMs: NOW
      })
    ).toEqual([]);
  });

  // The backfill runs awaited on the reconciliation cycle; rechecks share the same budget, so
  // they cannot push the worst case past the cycle-await ceiling.
  it("leaves the per-cycle probe budget untouched", () => {
    expect(getChapterBackfillConfig({ CHAPTER_BACKFILL_EMPTY_RECHECK_SECONDS: "60" }).perCycleBudget).toBe(
      getChapterBackfillConfig({}).perCycleBudget
    );
  });
});
