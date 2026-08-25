import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAPTER_BACKFILL_PER_CYCLE,
  buildChaptersJsonFromFfprobeOutput,
  buildChaptersJsonFromYtDlpProbe,
  getChapterBackfillConfig,
  probeAssetChapters,
  selectChapterBackfillCandidates,
  type ChapterBackfillAsset,
  type ChapterBackfillSource
} from "../../apps/worker/src/chapter-backfill.js";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const COOLDOWN_MS = 30 * 60 * 1000;

const sources: ChapterBackfillSource[] = [
  { id: "src_yt_playlist", connectorKind: "youtube-playlist", enabled: true },
  { id: "src_yt_channel", connectorKind: "youtube-channel", enabled: true },
  { id: "src_twitch_channel", connectorKind: "twitch-channel", enabled: true },
  { id: "src_twitch_vod", connectorKind: "twitch-vod", enabled: true },
  { id: "src_direct", connectorKind: "direct-media", enabled: true },
  { id: "src_local", connectorKind: "local-library", enabled: true },
  { id: "src_yt_disabled", connectorKind: "youtube-playlist", enabled: false }
];

function makeAsset(overrides: Partial<ChapterBackfillAsset> & Pick<ChapterBackfillAsset, "id" | "sourceId">): ChapterBackfillAsset {
  return {
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
    nowMs
  });
}

describe("chapter backfill candidate selection", () => {
  it("selects only assets from chapter-capable, enabled sources and maps the probe kind", () => {
    const candidates = select([
      makeAsset({ id: "a_yt", sourceId: "src_yt_playlist" }),
      makeAsset({ id: "a_yt2", sourceId: "src_yt_channel" }),
      makeAsset({ id: "a_tw", sourceId: "src_twitch_channel" }),
      makeAsset({ id: "a_vod", sourceId: "src_twitch_vod" }),
      makeAsset({ id: "a_direct", sourceId: "src_direct" }),
      makeAsset({ id: "a_local", sourceId: "src_local" }),
      makeAsset({ id: "a_disabled", sourceId: "src_yt_disabled" }),
      makeAsset({ id: "a_orphan", sourceId: "src_gone" })
    ]);

    expect(candidates.map((candidate) => candidate.assetId)).toEqual(["a_yt", "a_yt2", "a_tw", "a_direct"]);
    // YouTube chapter titles are free text; only Twitch chapter titles name the game/category.
    expect(candidates.map((candidate) => [candidate.probe, candidate.chapterTitleNamesCategory])).toEqual([
      ["yt-dlp", false],
      ["yt-dlp", false],
      ["yt-dlp", true],
      ["ffprobe", false]
    ]);
  });

  it("never selects an asset that already has chapters — operator edits and prior fills stay untouched", () => {
    const edited = JSON.stringify([{ offsetSeconds: 60, categoryName: "Music", title: "Operator cut" }]);
    const candidates = select([
      makeAsset({ id: "a_edited", sourceId: "src_yt_playlist", chaptersJson: edited }),
      makeAsset({ id: "a_empty", sourceId: "src_yt_playlist" })
    ]);
    expect(candidates.map((candidate) => candidate.assetId)).toEqual(["a_empty"]);
  });

  it("never re-fetches after a successful probe, even when the source had no chapters", () => {
    const candidates = select([
      makeAsset({ id: "a_probed", sourceId: "src_yt_playlist", chaptersProbeStatus: "ok", chaptersProbedAt: "2026-08-01T00:00:00.000Z" }),
      makeAsset({ id: "a_fresh", sourceId: "src_yt_playlist" })
    ]);
    expect(candidates.map((candidate) => candidate.assetId)).toEqual(["a_fresh"]);
  });

  it("holds a failed probe for the cooldown and retries once it expires", () => {
    const failedRecently = makeAsset({
      id: "a_failed",
      sourceId: "src_yt_playlist",
      chaptersProbeStatus: "failed",
      chaptersProbedAt: new Date(NOW - COOLDOWN_MS + 60_000).toISOString()
    });
    expect(select([failedRecently])).toEqual([]);

    const cooledDown = makeAsset({
      id: "a_failed",
      sourceId: "src_yt_playlist",
      chaptersProbeStatus: "failed",
      chaptersProbedAt: new Date(NOW - COOLDOWN_MS - 60_000).toISOString()
    });
    expect(select([cooledDown]).map((candidate) => candidate.assetId)).toEqual(["a_failed"]);

    // An unreadable timestamp cannot prove the failure was recent, so the asset stays retryable.
    const corruptTimestamp = makeAsset({
      id: "a_corrupt",
      sourceId: "src_yt_playlist",
      chaptersProbeStatus: "failed",
      chaptersProbedAt: "not-a-date"
    });
    expect(select([corruptTimestamp]).map((candidate) => candidate.assetId)).toEqual(["a_corrupt"]);
  });

  it("spends at most the per-cycle budget, never-probed assets before retries", () => {
    const assets = [
      makeAsset({
        id: "a_retry_old",
        sourceId: "src_yt_playlist",
        chaptersProbeStatus: "failed",
        chaptersProbedAt: new Date(NOW - 3 * COOLDOWN_MS).toISOString()
      }),
      makeAsset({ id: "a_new_1", sourceId: "src_yt_playlist" }),
      makeAsset({ id: "a_new_2", sourceId: "src_direct" }),
      makeAsset({
        id: "a_retry_older",
        sourceId: "src_twitch_channel",
        chaptersProbeStatus: "failed",
        chaptersProbedAt: new Date(NOW - 4 * COOLDOWN_MS).toISOString()
      })
    ];

    expect(select(assets, 3).map((candidate) => candidate.assetId)).toEqual(["a_new_1", "a_new_2", "a_retry_older"]);
    expect(select(assets, 0)).toEqual([]);
  });
});

// Trimmed from a real `yt-dlp --dump-single-json` YouTube payload: float chapter offsets, noise
// keys the mapping must ignore, and free-text chapter titles that must not become categories.
const youtubeProbeFixture = JSON.stringify({
  id: "dQw4w9WgXcQ",
  title: "Full council VOD — March session",
  webpage_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  duration: 5400,
  categories: ["Gaming"],
  formats: [{ format_id: "251", ext: "webm" }],
  timestamp: 1755600000,
  chapters: [
    { start_time: 0.0, end_time: 213.0, title: "Intro" },
    { start_time: 213.0, end_time: 1200.5, title: "Act 1 — The Setup" },
    { start_time: 1200.5, end_time: 5400.0, title: "Act 2" }
  ]
});

const twitchProbeFixture = JSON.stringify({
  id: "v2222222222",
  title: "Marathon rerun",
  chapters: [
    { start_time: 0, end_time: 600, title: "Just Chatting" },
    { start_time: 600, end_time: 7200, title: "Elden Ring" }
  ]
});

// `ffprobe -show_chapters -print_format json` reports offsets as decimal strings and titles
// under tags.title.
const ffprobeFixture = JSON.stringify({
  chapters: [
    { id: 0, time_base: "1/1000", start: 0, start_time: "0.000000", end: 1500000, end_time: "1500.000000", tags: { title: "Opening" } },
    { id: 1, time_base: "1/1000", start: 1500000, start_time: "1500.000000", end: 3000000, end_time: "3000.000000", tags: { title: "Main act" } }
  ]
});

describe("probe output mapping", () => {
  it("maps a YouTube yt-dlp payload to title-only chapters with floored offsets", () => {
    const chaptersJson = buildChaptersJsonFromYtDlpProbe(youtubeProbeFixture, { chapterTitleNamesCategory: false });
    expect(JSON.parse(chaptersJson)).toEqual([
      { offsetSeconds: 0, categoryName: "", title: "Intro" },
      { offsetSeconds: 213, categoryName: "", title: "Act 1 — The Setup" },
      { offsetSeconds: 1200, categoryName: "", title: "Act 2" }
    ]);
  });

  it("maps a Twitch yt-dlp payload with chapter titles doubling as category candidates", () => {
    const chaptersJson = buildChaptersJsonFromYtDlpProbe(twitchProbeFixture, { chapterTitleNamesCategory: true });
    expect(JSON.parse(chaptersJson)).toEqual([
      { offsetSeconds: 0, categoryName: "Just Chatting", title: "Just Chatting" },
      { offsetSeconds: 600, categoryName: "Elden Ring", title: "Elden Ring" }
    ]);
  });

  it("maps embedded ffprobe chapters (string offsets, tags.title) to title-only chapters", () => {
    const chaptersJson = buildChaptersJsonFromFfprobeOutput(ffprobeFixture);
    expect(JSON.parse(chaptersJson)).toEqual([
      { offsetSeconds: 0, categoryName: "", title: "Opening" },
      { offsetSeconds: 1500, categoryName: "", title: "Main act" }
    ]);
  });

  it("normalises a payload without chapters to the empty list — the rollback shape", () => {
    expect(buildChaptersJsonFromYtDlpProbe(JSON.stringify({ id: "x" }), { chapterTitleNamesCategory: false })).toBe("[]");
    expect(buildChaptersJsonFromFfprobeOutput(JSON.stringify({}))).toBe("[]");
  });
});

describe("probeAssetChapters", () => {
  const config = getChapterBackfillConfig({});
  const ytCandidate = {
    assetId: "a1",
    path: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    probe: "yt-dlp",
    chapterTitleNamesCategory: false
  } as const;

  it("runs a metadata-only yt-dlp probe and returns the chapters json", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const exec = async (file: string, args: string[]) => {
      calls.push({ file, args });
      return youtubeProbeFixture;
    };

    const result = await probeAssetChapters(ytCandidate, config, exec);
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && JSON.parse(result.chaptersJson)).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("yt-dlp");
    expect(calls[0]?.args).toContain("--dump-single-json");
    expect(calls[0]?.args).toContain("--no-playlist");
    expect(calls[0]?.args).toContain(ytCandidate.path);
  });

  it("runs ffprobe for direct media and asks for chapters only", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const exec = async (file: string, args: string[]) => {
      calls.push({ file, args });
      return ffprobeFixture;
    };

    const result = await probeAssetChapters(
      { assetId: "a2", path: "https://cdn.example.com/movie.mp4", probe: "ffprobe", chapterTitleNamesCategory: false },
      config,
      exec
    );
    expect(result.status).toBe("ok");
    expect(calls[0]?.file).toBe("ffprobe");
    expect(calls[0]?.args).toContain("-show_chapters");
    expect(calls[0]?.args).toContain("https://cdn.example.com/movie.mp4");
  });

  it("reports a failed probe instead of throwing, for both process and parse errors", async () => {
    const processError = await probeAssetChapters(ytCandidate, config, async () => {
      throw new Error("yt-dlp exited with code 1");
    });
    expect(processError).toEqual({ status: "failed", error: "yt-dlp exited with code 1" });

    const parseError = await probeAssetChapters(ytCandidate, config, async () => "not-json{");
    expect(parseError.status).toBe("failed");
  });
});

describe("getChapterBackfillConfig", () => {
  it("defaults to a small per-cycle budget with the vod-cache cooldown", () => {
    const config = getChapterBackfillConfig({});
    expect(config.perCycleBudget).toBe(DEFAULT_CHAPTER_BACKFILL_PER_CYCLE);
    expect(config.perCycleBudget).toBe(3);
    expect(config.failureCooldownMs).toBe(30 * 60 * 1000);
    expect(config.probeTimeoutMs).toBe(30_000);
    expect(config.ytDlpBinary).toBe("yt-dlp");
    expect(config.ffprobeBinary).toBe("ffprobe");
  });

  it("honours the env overrides and lets 0 disable the backfill", () => {
    expect(getChapterBackfillConfig({ CHAPTER_BACKFILL_PER_CYCLE: "1" }).perCycleBudget).toBe(1);
    expect(getChapterBackfillConfig({ CHAPTER_BACKFILL_PER_CYCLE: "0" }).perCycleBudget).toBe(0);
    expect(getChapterBackfillConfig({ CHAPTER_BACKFILL_PER_CYCLE: "junk" }).perCycleBudget).toBe(3);
    expect(
      getChapterBackfillConfig({ CHAPTER_BACKFILL_FAILURE_COOLDOWN_SECONDS: "60" }).failureCooldownMs
    ).toBe(60_000);
  });

  it("caps the budget so a cycle of worst-case probes stays inside the cycle-await ceiling", () => {
    // Default stall budget: ceiling 150s / 30s probes = at most 5 probes per cycle.
    expect(getChapterBackfillConfig({ CHAPTER_BACKFILL_PER_CYCLE: "50" }).perCycleBudget).toBe(5);
    // A tight stall budget shrinks both the probe timeout and the probe count.
    const tight = getChapterBackfillConfig({ CHAPTER_BACKFILL_PER_CYCLE: "50", STREAM247_LOOP_STALL_TIMEOUT_SECONDS: "60" });
    expect(tight.probeTimeoutMs).toBe(30_000);
    expect(tight.perCycleBudget).toBe(1);
  });
});
