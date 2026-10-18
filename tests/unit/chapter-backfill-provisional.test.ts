import { describe, expect, it } from "vitest";
import { CHAPTER_PROBE_RECHECK_CAP, CHAPTER_PROBE_SETTLED_LEVEL, isRecordingAnswerPossible } from "@stream247/core";
import { decideAssetChapterProbeWrite } from "@stream247/db";
import {
  DEFAULT_CHAPTER_EMPTY_RECHECK_SECONDS,
  DEFAULT_CHAPTER_PROVISIONAL_RECHECK_SECONDS,
  getChapterBackfillConfig,
  parseYtDlpChapterProbe,
  probeAssetChapters,
  selectChapterBackfillCandidates,
  type ChapterBackfillAsset,
  type ChapterBackfillSource
} from "../../apps/worker/src/chapter-backfill.js";

// M108. On the DUT 2026-10-06, 41 of 46 Twitch archives held one chapter at offset 0, filled by
// probes that ran while the VOD was still being recorded: yt-dlp names one chapter after the VOD's
// current game whenever Twitch returns no chapter list. The backfill treated any stored chapters as
// final, so "Just Chatting" stayed on air for a VOD that had moved on to another game.

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const COOLDOWN_MS = 30 * 60 * 1000;
const EMPTY_RECHECK_MS = DEFAULT_CHAPTER_EMPTY_RECHECK_SECONDS * 1000;
const PROVISIONAL_MS = DEFAULT_CHAPTER_PROVISIONAL_RECHECK_SECONDS * 1000;

const sources: ChapterBackfillSource[] = [
  { id: "src_twitch", connectorKind: "twitch-channel", enabled: true },
  { id: "src_yt", connectorKind: "youtube-channel", enabled: true }
];

const wardogs = JSON.stringify([{ offsetSeconds: 0, categoryName: "WARDOGS", title: "WARDOGS" }]);
const twoGames = JSON.stringify([
  { offsetSeconds: 0, categoryName: "Just Chatting", title: "Just Chatting" },
  { offsetSeconds: 3600, categoryName: "WARDOGS", title: "WARDOGS" }
]);

/** A Twitch archive whose probe stored `chaptersJson` `ageMs` ago. */
function probed(
  id: string,
  ageMs: number,
  overrides: Partial<ChapterBackfillAsset> = {}
): ChapterBackfillAsset {
  return {
    id,
    sourceId: "src_twitch",
    path: `https://www.twitch.tv/videos/${id}`,
    chaptersJson: wardogs,
    chaptersProbeStatus: "ok",
    chaptersProbedAt: new Date(NOW - ageMs).toISOString(),
    chaptersProbeSettleLevel: 1,
    ...overrides
  };
}

function select(assets: ChapterBackfillAsset[], budget = 10, provisionalRecheckMs = PROVISIONAL_MS) {
  return selectChapterBackfillCandidates({
    assets,
    sources,
    budget,
    failureCooldownMs: COOLDOWN_MS,
    emptyResultRecheckMs: EMPTY_RECHECK_MS,
    provisionalRecheckMs,
    nowMs: NOW
  }).map((candidate) => candidate.assetId);
}

describe("a probe-filled single chapter at offset 0 of a Twitch archive is provisional", () => {
  it("is probed again once the provisional interval has passed", () => {
    expect(select([probed("a_due", PROVISIONAL_MS + 60_000)])).toEqual(["a_due"]);
  });

  it("is not probed again before the interval has passed", () => {
    expect(select([probed("a_recent", PROVISIONAL_MS - 60_000)])).toEqual([]);
  });

  it("waits hours, not the week an empty answer waits", () => {
    expect(PROVISIONAL_MS).toBeLessThanOrEqual(6 * HOUR_MS);
    expect(PROVISIONAL_MS).toBeGreaterThan(COOLDOWN_MS);
  });

  it("covers lists probed before M108, which carry no settle level", () => {
    expect(select([probed("a_legacy", PROVISIONAL_MS + 1, { chaptersProbeSettleLevel: undefined })])).toEqual(["a_legacy"]);
  });

  it("hands the write what the asset held when it was selected, for the compare-and-swap", () => {
    const [candidate] = selectChapterBackfillCandidates({
      assets: [probed("a_due", PROVISIONAL_MS + 1)],
      sources,
      budget: 1,
      failureCooldownMs: COOLDOWN_MS,
      emptyResultRecheckMs: EMPTY_RECHECK_MS,
      provisionalRecheckMs: PROVISIONAL_MS,
      nowMs: NOW
    });
    expect(candidate?.selectedWith).toEqual({ chaptersJson: wardogs, chaptersProbeStatus: "ok" });
  });
});

describe("lists that are never re-probed", () => {
  const old = 100 * PROVISIONAL_MS;

  it("a probe-filled list of several chapters from a finished VOD", () => {
    expect(select([probed("a_multi", old, { chaptersJson: twoGames })])).toEqual([]);
  });

  it("an operator-edited list: the edit resets the status to empty", () => {
    expect(select([probed("a_edited", old, { chaptersProbeStatus: "", chaptersProbedAt: "" })])).toEqual([]);
  });

  it("a single chapter of a source whose chapter titles are free text (YouTube)", () => {
    expect(select([probed("a_yt", old, { sourceId: "src_yt" })])).toEqual([]);
  });

  it("a single chapter that does not start at 0", () => {
    const late = JSON.stringify([{ offsetSeconds: 120, categoryName: "WARDOGS", title: "WARDOGS" }]);
    expect(select([probed("a_late", old, { chaptersJson: late })])).toEqual([]);
  });

  it("any list while provisional rechecks are switched off (0)", () => {
    expect(select([probed("a_due", old), probed("a_live", old, { chaptersJson: twoGames, chaptersProbeSettleLevel: 0 })], 10, 0)).toEqual(
      []
    );
  });
});

describe("a list probed while the VOD was still being recorded", () => {
  it("is provisional whatever its shape", () => {
    expect(select([probed("a_live_multi", PROVISIONAL_MS + 1, { chaptersJson: twoGames, chaptersProbeSettleLevel: 0 })])).toEqual([
      "a_live_multi"
    ]);
  });

  it("still waits out the interval", () => {
    expect(select([probed("a_live", HOUR_MS, { chaptersProbeSettleLevel: 0 })])).toEqual([]);
  });
});

// Review of 2026-10-06: an empty answer of a VOD still being recorded waited the week an empty answer
// of a finished VOD waits.
describe("an empty answer taken while the VOD was still being recorded", () => {
  const emptyWhileRecording = (id: string, ageMs: number, overrides: Partial<ChapterBackfillAsset> = {}) =>
    probed(id, ageMs, { chaptersJson: "[]", chaptersProbeSettleLevel: 0, ...overrides });

  it("is asked again after the provisional interval, not after a week", () => {
    expect(select([emptyWhileRecording("a_due", PROVISIONAL_MS + 1)])).toEqual(["a_due"]);
    expect(select([emptyWhileRecording("a_recent", PROVISIONAL_MS - 60_000)])).toEqual([]);
  });

  it("waits the week once a finished VOD answered empty, on a free-text source, or with the interval off", () => {
    expect(select([emptyWhileRecording("a_finished", PROVISIONAL_MS + 1, { chaptersProbeSettleLevel: 1 })])).toEqual([]);
    expect(select([emptyWhileRecording("a_yt", PROVISIONAL_MS + 1, { sourceId: "src_yt" })])).toEqual([]);
    expect(select([emptyWhileRecording("a_off", PROVISIONAL_MS + 1)], 10, 0)).toEqual([]);
    expect(select([emptyWhileRecording("a_week", EMPTY_RECHECK_MS + 1, { chaptersProbeSettleLevel: 1 })])).toEqual(["a_week"]);
  });
});

describe("lists stored before M108", () => {
  // Nobody noted whether their VOD was still being recorded, so a missing level reads 0 and every
  // such list is asked once more, the longer ones included (review of 2026-10-06).
  it("are provisional whatever their shape", () => {
    expect(select([probed("a_legacy_multi", PROVISIONAL_MS + 1, { chaptersJson: twoGames, chaptersProbeSettleLevel: undefined })])).toEqual([
      "a_legacy_multi"
    ]);
  });
});

describe("termination", () => {
  it("stops once the list has settled", () => {
    expect(select([probed("a_settled", 100 * PROVISIONAL_MS, { chaptersProbeSettleLevel: CHAPTER_PROBE_SETTLED_LEVEL })])).toEqual([]);
  });

  it("keeps a single chapter provisional below the settled level", () => {
    expect(select([probed("a_two", PROVISIONAL_MS + 1, { chaptersProbeSettleLevel: CHAPTER_PROBE_SETTLED_LEVEL - 1 })])).toEqual([
      "a_two"
    ]);
  });
});

describe("the recheck cap", () => {
  const old = 100 * PROVISIONAL_MS;

  it("settles a provisional list whose counted rechecks reached the cap", () => {
    expect(select([probed("a_below", old, { chaptersProbeRechecks: CHAPTER_PROBE_RECHECK_CAP - 1 })])).toEqual(["a_below"]);
    expect(select([probed("a_capped", old, { chaptersProbeRechecks: CHAPTER_PROBE_RECHECK_CAP })])).toEqual([]);
    expect(
      select([probed("a_capped_multi", old, { chaptersJson: twoGames, chaptersProbeSettleLevel: 0, chaptersProbeRechecks: CHAPTER_PROBE_RECHECK_CAP })])
    ).toEqual([]);
  });

  it("leaves the first probe of an empty row and the empty-answer rechecks alone", () => {
    const capped = { chaptersJson: "[]", chaptersProbeRechecks: CHAPTER_PROBE_RECHECK_CAP };
    expect(select([probed("a_new", 0, { ...capped, chaptersProbeStatus: "", chaptersProbedAt: "" })])).toEqual(["a_new"]);
    expect(select([probed("a_week", EMPTY_RECHECK_MS + 1, capped)])).toEqual(["a_week"]);
    expect(select([probed("a_recording", PROVISIONAL_MS + 1, { ...capped, chaptersProbeSettleLevel: 0 })])).toEqual(["a_recording"]);
  });
});

// The backfill and the database, one probe interval after another: what the selection picks is
// answered and written through the same decision updateAssetChapterProbeRecords takes in the lock.
describe("rechecks of a source that never answers properly end", () => {
  const START = Date.parse("2026-10-10T00:00:00.000Z");
  const STEP_MS = PROVISIONAL_MS + 60_000;
  const LONG_AGO = "2026-10-01T00:00:00.000Z";
  const justChatting = JSON.stringify([{ offsetSeconds: 0, categoryName: "Just Chatting", title: "Just Chatting" }]);
  const minecraft = JSON.stringify([{ offsetSeconds: 0, categoryName: "Minecraft", title: "Minecraft" }]);
  type Reply = { failed: true } | { failed?: false; chaptersJson: string; recording?: boolean };

  function run(
    start: ChapterBackfillAsset,
    createdAt: string,
    reply: (probe: number, probedAt: string) => Reply,
    steps = 60,
    stepMs = STEP_MS
  ) {
    let row = { ...start };
    let probes = 0;
    const probeTimesMs: number[] = [];
    for (let step = 1; step <= steps; step += 1) {
      const nowMs = START + step * stepMs;
      const [candidate] = selectChapterBackfillCandidates({
        assets: [row],
        sources,
        budget: 1,
        failureCooldownMs: COOLDOWN_MS,
        emptyResultRecheckMs: EMPTY_RECHECK_MS,
        provisionalRecheckMs: PROVISIONAL_MS,
        nowMs
      });
      if (!candidate) {
        continue;
      }
      probes += 1;
      probeTimesMs.push(nowMs);
      const probedAt = new Date(nowMs).toISOString();
      const answer = reply(probes, probedAt);
      const base = { id: row.id, chaptersProbedAt: probedAt, selectedWith: candidate.selectedWith };
      const write = decideAssetChapterProbeWrite(
        {
          chaptersJson: row.chaptersJson ?? "[]",
          chaptersProbeStatus: row.chaptersProbeStatus ?? "",
          chaptersProbeSettleLevel: row.chaptersProbeSettleLevel ?? 0,
          chaptersProbeRechecks: row.chaptersProbeRechecks,
          createdAt
        },
        answer.failed
          ? { ...base, chaptersProbeStatus: "failed" }
          : { ...base, chaptersProbeStatus: "ok", chaptersJson: answer.chaptersJson, recording: answer.recording }
      );
      if (write) {
        row = { ...row, ...write };
      }
    }
    return { probes, row, probeTimesMs };
  }

  const stale = (id: string, overrides: Partial<ChapterBackfillAsset> = {}) =>
    probed(id, 0, { chaptersProbedAt: new Date(START).toISOString(), chaptersProbeRechecks: 0, ...overrides });

  it("a single chapter whose rechecks keep failing", () => {
    const { probes, row } = run(stale("a_failing"), LONG_AGO, () => ({ failed: true }));
    expect(probes).toBe(CHAPTER_PROBE_RECHECK_CAP);
    expect(row).toMatchObject({ chaptersJson: wardogs, chaptersProbeStatus: "ok", chaptersProbeSettleLevel: 1 });
  });

  it("a list stored before M108: its first recheck right after the upgrade, the cap ten hours later", () => {
    // Its probe time is days old, so the first worker cycle after the repin rechecks it; the other
    // five counted rechecks wait a full interval each. No list reaches the cap sooner (DUT check).
    const cycleMs = 10 * 60 * 1000;
    const before = probed("a_before_m108", 0, { chaptersProbedAt: LONG_AGO, chaptersProbeSettleLevel: 0 });
    const { probes, row, probeTimesMs } = run(before, LONG_AGO, () => ({ failed: true }), 24 * 6, cycleMs);
    expect(probes).toBe(CHAPTER_PROBE_RECHECK_CAP);
    expect(row).toMatchObject({ chaptersJson: wardogs, chaptersProbeStatus: "ok", chaptersProbeRechecks: CHAPTER_PROBE_RECHECK_CAP });
    const first = probeTimesMs[0] ?? Number.NaN;
    const last = probeTimesMs[probeTimesMs.length - 1] ?? Number.NaN;
    expect(first).toBe(START + cycleMs);
    expect(last - first).toBeGreaterThanOrEqual(5 * PROVISIONAL_MS);
    expect(last - first).toBeLessThanOrEqual(5 * (PROVISIONAL_MS + cycleMs));
  });

  it("a single chapter whose rechecks keep coming back empty", () => {
    const { probes, row } = run(stale("a_empty"), LONG_AGO, () => ({ chaptersJson: "[]" }));
    expect(probes).toBe(CHAPTER_PROBE_RECHECK_CAP);
    expect(row).toMatchObject({ chaptersJson: wardogs, chaptersProbeSettleLevel: 1 });
  });

  it("a list taken while recording whose rechecks keep coming back empty or shorter", () => {
    const start = stale("a_shorter", { chaptersJson: twoGames, chaptersProbeSettleLevel: 0 });
    const { probes, row } = run(start, LONG_AGO, (probe) => ({ chaptersJson: probe % 2 === 0 ? "[]" : minecraft }));
    expect(probes).toBe(CHAPTER_PROBE_RECHECK_CAP);
    expect(row).toMatchObject({ chaptersJson: twoGames, chaptersProbeSettleLevel: 0 });
  });

  it("not counting recording answers and failures within the recording window", () => {
    const createdAt = new Date(START).toISOString();
    let probesInWindow = 0;
    const start = stale("a_live", { chaptersJson: twoGames, chaptersProbeSettleLevel: 0 });
    const { probes } = run(start, createdAt, (probe, probedAt) => {
      if (!isRecordingAnswerPossible({ listedAt: createdAt, probedAt })) {
        return { failed: true };
      }
      probesInWindow += 1;
      return probe % 2 === 0 ? { failed: true } : { chaptersJson: twoGames, recording: true };
    });
    expect(probesInWindow).toBeGreaterThan(CHAPTER_PROBE_RECHECK_CAP);
    expect(probes - probesInWindow).toBe(CHAPTER_PROBE_RECHECK_CAP);
  });

  it("but not a normal chain: the stand-in confirmed, a list taken while recording confirmed", () => {
    const confirmed = run(stale("a_single"), LONG_AGO, () => ({ chaptersJson: wardogs }));
    expect(confirmed.probes).toBe(1);
    expect(confirmed.row).toMatchObject({ chaptersProbeSettleLevel: CHAPTER_PROBE_SETTLED_LEVEL, chaptersProbeRechecks: 1 });
    const final = run(stale("a_multi", { chaptersJson: twoGames, chaptersProbeSettleLevel: 0 }), LONG_AGO, () => ({ chaptersJson: twoGames }));
    expect(final.probes).toBe(1);
    expect(final.row).toMatchObject({ chaptersJson: twoGames, chaptersProbeSettleLevel: 1, chaptersProbeRechecks: 1 });
  });

  it("nor the longest chain, three replacements with an empty answer before each", () => {
    const replies = ["[]", wardogs, "[]", minecraft, "[]", justChatting];
    const start = stale("a_chain", { chaptersJson: justChatting, chaptersProbeSettleLevel: 0 });
    const { probes, row } = run(start, LONG_AGO, (probe) => ({ chaptersJson: replies[probe - 1] ?? "[]" }));
    expect(probes).toBe(CHAPTER_PROBE_RECHECK_CAP);
    expect(row).toMatchObject({ chaptersJson: justChatting, chaptersProbeSettleLevel: CHAPTER_PROBE_SETTLED_LEVEL });
  });
});

describe("priority and budget", () => {
  it("puts never-probed assets and failure retries ahead of provisional rechecks", () => {
    const assets = [
      probed("a_provisional", 50 * PROVISIONAL_MS),
      probed("a_retry", 4 * COOLDOWN_MS, { chaptersJson: "[]", chaptersProbeStatus: "failed" }),
      probed("a_new", 0, { chaptersJson: "[]", chaptersProbeStatus: "", chaptersProbedAt: "" })
    ];
    expect(select(assets, 3)).toEqual(["a_new", "a_retry", "a_provisional"]);
    expect(select(assets, 2)).toEqual(["a_new", "a_retry"]);
  });

  it("orders provisional and empty rechecks together, oldest probe first", () => {
    const assets = [
      probed("a_provisional_newer", 3 * PROVISIONAL_MS),
      probed("a_empty", EMPTY_RECHECK_MS + HOUR_MS, { chaptersJson: "[]" }),
      probed("a_provisional_older", EMPTY_RECHECK_MS + 2 * HOUR_MS)
    ];
    expect(select(assets, 3)).toEqual(["a_provisional_older", "a_empty", "a_provisional_newer"]);
    expect(select(assets, 1)).toEqual(["a_provisional_older"]);
  });

  it("never exceeds the per-cycle budget", () => {
    const due = Array.from({ length: 6 }, (_, index) => probed(`a_${String(index)}`, (index + 2) * PROVISIONAL_MS));
    expect(select(due, 3)).toHaveLength(3);
    expect(select(due, 0)).toEqual([]);
  });
});

// Shaped like the answer the DUT returned on 2026-10-06 for three archives (chapters
// [(0, 26400, 'WARDOGS')], is_live false, was_live true): no "moments", so the extractor named one
// chapter after the game and yt-dlp stretched it from 0 to the end. The id is invented.
const fallbackPayload = JSON.stringify({
  id: "v2580000001",
  duration: 26400,
  is_live: false,
  was_live: true,
  live_status: "was_live",
  chapters: [{ start_time: 0, end_time: 26400, title: "WARDOGS" }]
});

describe("the yt-dlp probe payload", () => {
  it("reads the no-chapter-list stand-in as one chapter at 0 from a finished VOD", () => {
    expect(parseYtDlpChapterProbe(fallbackPayload, { chapterTitleNamesCategory: true })).toEqual({
      chaptersJson: wardogs,
      recording: false
    });
  });

  it("reads is_live true as a VOD still being recorded", () => {
    const live = JSON.stringify({ ...JSON.parse(fallbackPayload), is_live: true, live_status: "is_live" });
    expect(parseYtDlpChapterProbe(live, { chapterTitleNamesCategory: true }).recording).toBe(true);
    const liveStatusOnly = JSON.stringify({ chapters: [], live_status: "is_live" });
    expect(parseYtDlpChapterProbe(liveStatusOnly, { chapterTitleNamesCategory: true }).recording).toBe(true);
  });

  it("reads a missing or null is_live as finished, so an unknown state cannot keep an asset provisional", () => {
    expect(parseYtDlpChapterProbe(JSON.stringify({ chapters: [] }), { chapterTitleNamesCategory: true }).recording).toBe(false);
    expect(parseYtDlpChapterProbe(JSON.stringify({ is_live: null }), { chapterTitleNamesCategory: true }).recording).toBe(false);
    expect(parseYtDlpChapterProbe(JSON.stringify({ is_live: "true" }), { chapterTitleNamesCategory: true }).recording).toBe(false);
  });

  it("passes the recording state through the probe result", async () => {
    const config = getChapterBackfillConfig({});
    const candidate = {
      assetId: "a1",
      path: "https://www.twitch.tv/videos/2580000001",
      probe: "yt-dlp",
      chapterTitleNamesCategory: true,
      selectedWith: { chaptersJson: "[]", chaptersProbeStatus: "" }
    } as const;
    const live = JSON.stringify({ ...JSON.parse(fallbackPayload), is_live: true });
    expect(await probeAssetChapters(candidate, config, async () => live)).toEqual({
      status: "ok",
      chaptersJson: wardogs,
      recording: true
    });
  });
});

describe("provisional recheck configuration", () => {
  it("defaults to two hours", () => {
    expect(DEFAULT_CHAPTER_PROVISIONAL_RECHECK_SECONDS).toBe(7200);
    expect(getChapterBackfillConfig({}).provisionalRecheckMs).toBe(7_200_000);
  });

  it("is operator-tunable, keeps 0 as off and rejects nonsense", () => {
    expect(getChapterBackfillConfig({ CHAPTER_BACKFILL_PROVISIONAL_RECHECK_SECONDS: "3600" }).provisionalRecheckMs).toBe(3_600_000);
    expect(getChapterBackfillConfig({ CHAPTER_BACKFILL_PROVISIONAL_RECHECK_SECONDS: "0" }).provisionalRecheckMs).toBe(0);
    expect(getChapterBackfillConfig({ CHAPTER_BACKFILL_PROVISIONAL_RECHECK_SECONDS: "-5" }).provisionalRecheckMs).toBe(7_200_000);
    expect(getChapterBackfillConfig({ CHAPTER_BACKFILL_PROVISIONAL_RECHECK_SECONDS: " " }).provisionalRecheckMs).toBe(7_200_000);
  });

  it("leaves the per-cycle budget and the empty recheck untouched", () => {
    const tuned = getChapterBackfillConfig({ CHAPTER_BACKFILL_PROVISIONAL_RECHECK_SECONDS: "60" });
    expect(tuned.perCycleBudget).toBe(getChapterBackfillConfig({}).perCycleBudget);
    expect(tuned.emptyResultRecheckMs).toBe(EMPTY_RECHECK_MS);
  });
});
