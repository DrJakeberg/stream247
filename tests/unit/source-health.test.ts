import { describe, expect, it } from "vitest";
import {
  SOURCE_BARREN_RUN_ALERT_THRESHOLD,
  countBarrenSyncRuns,
  describeElapsed,
  describeSourceHealth,
  type SourceSyncRunView
} from "@stream247/core";

// What the source page could not say on 2026-08-27.
//
// The Twitch source stopped being able to list its archive. The channel spent hours on the filler
// slate. The sources page said "Ingestion failed" -- no time, no count, no consequence -- and the
// truth (a run every 30 seconds, each one finding nothing) sat unread in source_sync_runs.
//
// These are the sentences that were missing, tested as sentences, because the failure was that the
// data was present and unreadable rather than absent.

const minute = 60_000;
const nowMs = Date.parse("2026-08-27T20:00:00.000Z");

function run(overrides: Partial<SourceSyncRunView> & { minutesAgo: number }): SourceSyncRunView {
  const at = new Date(nowMs - overrides.minutesAgo * minute).toISOString();
  return {
    status: "success",
    startedAt: at,
    finishedAt: at,
    discoveredAssets: 49,
    errorMessage: "",
    ...overrides
  };
}

const noReferences = { poolNames: [], blockNames: [] };

describe("how long ago, in words", () => {
  it("says it in spoken English rather than a stored timestamp", () => {
    expect(describeElapsed(4 * minute)).toBe("4 minutes ago");
    expect(describeElapsed(minute)).toBe("1 minute ago");
    expect(describeElapsed(3 * 60 * minute)).toBe("3 hours ago");
    expect(describeElapsed(50 * 60 * minute)).toBe("2 days ago");
  });

  it("never says 'just now', because the wording baseline has to be able to substitute it", () => {
    // Every age this module can produce ends in " ago", so one VOLATILE pattern in
    // tests/e2e/wording-baseline.spec.ts covers all of them. A second shape that did not end that
    // way would rot the recorded surfaces an hour after each recording.
    expect(describeElapsed(0)).toBe("less than a minute ago");
    expect(describeElapsed(59_000)).toBe("less than a minute ago");
  });

  it("says nothing at all when it has no usable instant", () => {
    expect(describeElapsed(Number.NaN)).toBe("");
    expect(describeElapsed(-1)).toBe("less than a minute ago");
  });
});

describe("counting the drought", () => {
  it("counts only the unbroken run of checks that found nothing", () => {
    expect(
      countBarrenSyncRuns([
        run({ minutesAgo: 1, status: "skipped", discoveredAssets: 0 }),
        run({ minutesAgo: 2, status: "error", discoveredAssets: 0 }),
        run({ minutesAgo: 3, discoveredAssets: 12 }),
        run({ minutesAgo: 4, status: "skipped", discoveredAssets: 0 })
      ])
    ).toBe(2);
  });

  it("is zero while the newest check delivered, however bad the history", () => {
    expect(
      countBarrenSyncRuns([run({ minutesAgo: 1, discoveredAssets: 3 }), run({ minutesAgo: 2, status: "error", discoveredAssets: 0 })])
    ).toBe(0);
  });

  it("treats a success that discovered nothing as barren, because the channel cannot tell the difference", () => {
    expect(countBarrenSyncRuns([run({ minutesAgo: 1, status: "success", discoveredAssets: 0 })])).toBe(1);
  });

  it("has nothing to count without runs", () => {
    expect(countBarrenSyncRuns([])).toBe(0);
  });
});

describe("what the source page should say", () => {
  it("reports a healthy source with its time and its count", () => {
    const report = describeSourceHealth({
      lastSyncedAt: new Date(nowMs - 4 * minute).toISOString(),
      runs: [run({ minutesAgo: 4, discoveredAssets: 49 })],
      storedAssetCount: 49,
      ...noReferences,
      nowMs
    });

    expect(report.headline).toBe("Last checked 4 minutes ago, found 49 videos.");
    expect(report.barrenRuns).toBe(0);
    expect(report.alerting).toBe(false);
    expect(report.impact).toBe("");
  });

  it("counts one video as one video", () => {
    const report = describeSourceHealth({
      lastSyncedAt: new Date(nowMs - minute).toISOString(),
      runs: [run({ minutesAgo: 1, discoveredAssets: 1 })],
      storedAssetCount: 1,
      ...noReferences,
      nowMs
    });

    expect(report.headline).toBe("Last checked 1 minute ago, found 1 video.");
  });

  it("says a source has never been checked instead of showing an empty timestamp", () => {
    const report = describeSourceHealth({ lastSyncedAt: "", runs: [], storedAssetCount: 0, ...noReferences, nowMs });

    expect(report.headline).toBe("Never checked yet.");
    expect(report.alerting).toBe(false);
  });

  it("falls back to the source's own last-synced stamp when its runs have aged out of the table", () => {
    // source_sync_runs keeps 250 rows for the whole workspace, so a quiet source loses its history.
    const report = describeSourceHealth({
      lastSyncedAt: new Date(nowMs - 2 * 60 * minute).toISOString(),
      runs: [],
      storedAssetCount: 8,
      ...noReferences,
      nowMs
    });

    expect(report.headline).toBe("Last checked 2 hours ago.");
  });

  it("names the drought, when it started, and that the stored videos survive it", () => {
    const report = describeSourceHealth({
      lastSyncedAt: new Date(nowMs - minute).toISOString(),
      runs: [
        run({ minutesAgo: 1, status: "skipped", discoveredAssets: 0 }),
        run({ minutesAgo: 6, status: "skipped", discoveredAssets: 0 }),
        run({ minutesAgo: 12, status: "skipped", discoveredAssets: 0 }),
        run({ minutesAgo: 18, discoveredAssets: 49 })
      ],
      storedAssetCount: 49,
      ...noReferences,
      nowMs
    });

    expect(report.headline).toBe(
      "Nothing came back the last 3 times, the first of them 12 minutes ago. The stored videos are being kept."
    );
    expect(report.barrenRuns).toBe(3);
    expect(report.alerting).toBe(true);
  });

  it("says a failed check failed, rather than calling it empty", () => {
    const report = describeSourceHealth({
      lastSyncedAt: new Date(nowMs - 2 * minute).toISOString(),
      runs: [run({ minutesAgo: 2, status: "error", discoveredAssets: 0, errorMessage: "HTTP 503" })],
      storedAssetCount: 49,
      ...noReferences,
      nowMs
    });

    expect(report.headline).toBe("The last check failed 2 minutes ago. The stored videos are being kept.");
    expect(report.alerting).toBe(false);
  });

  it("keeps the plural of a failing streak", () => {
    const report = describeSourceHealth({
      lastSyncedAt: new Date(nowMs - minute).toISOString(),
      runs: [
        run({ minutesAgo: 1, status: "error", discoveredAssets: 0 }),
        run({ minutesAgo: 5, status: "error", discoveredAssets: 0 }),
        run({ minutesAgo: 9, status: "skipped", discoveredAssets: 0 })
      ],
      storedAssetCount: 49,
      ...noReferences,
      nowMs
    });

    expect(report.headline).toBe("The last 3 checks failed, the first of them 9 minutes ago. The stored videos are being kept.");
  });

  it("does not promise stored videos it does not have", () => {
    const report = describeSourceHealth({
      lastSyncedAt: new Date(nowMs - minute).toISOString(),
      runs: [
        run({ minutesAgo: 1, status: "skipped", discoveredAssets: 0 }),
        run({ minutesAgo: 4, status: "skipped", discoveredAssets: 0 }),
        run({ minutesAgo: 7, status: "skipped", discoveredAssets: 0 })
      ],
      storedAssetCount: 0,
      ...noReferences,
      nowMs
    });

    expect(report.headline).toBe(
      "Nothing came back the last 3 times, the first of them 7 minutes ago. Nothing is stored for it either."
    );
  });

  it("starts alerting at the threshold and not before", () => {
    const barren = (count: number) =>
      describeSourceHealth({
        lastSyncedAt: new Date(nowMs - minute).toISOString(),
        runs: Array.from({ length: count }, (_, index) => run({ minutesAgo: index + 1, status: "skipped", discoveredAssets: 0 })),
        storedAssetCount: 49,
        ...noReferences,
        nowMs
      }).alerting;

    expect(SOURCE_BARREN_RUN_ALERT_THRESHOLD).toBe(3);
    expect(barren(SOURCE_BARREN_RUN_ALERT_THRESHOLD - 1)).toBe(false);
    expect(barren(SOURCE_BARREN_RUN_ALERT_THRESHOLD)).toBe(true);
  });
});

describe("the consequence the incident had no way of showing", () => {
  const droughtRuns = [
    run({ minutesAgo: 1, status: "skipped", discoveredAssets: 0 }),
    run({ minutesAgo: 5, status: "skipped", discoveredAssets: 0 }),
    run({ minutesAgo: 9, status: "skipped", discoveredAssets: 0 })
  ];

  it("names the scheduled blocks the drought reaches, and that they still have something to play", () => {
    const report = describeSourceHealth({
      lastSyncedAt: new Date(nowMs - minute).toISOString(),
      runs: droughtRuns,
      storedAssetCount: 49,
      poolNames: ["Archive rotation"],
      blockNames: ["Nachtschleife", "Tagesprogramm"],
      nowMs
    });

    expect(report.impact).toBe(
      "It feeds Nachtschleife and Tagesprogramm on the schedule, which keep playing the stored videos for now."
    );
  });

  it("says plainly when the blocks it feeds have nothing left -- the hours on the filler slate", () => {
    const report = describeSourceHealth({
      lastSyncedAt: new Date(nowMs - minute).toISOString(),
      runs: droughtRuns,
      storedAssetCount: 0,
      poolNames: ["Archive rotation"],
      blockNames: ["Nachtschleife"],
      nowMs
    });

    expect(report.impact).toBe("It feeds Nachtschleife on the schedule, and that block has nothing left to play.");
  });

  it("still names the pool when no block is scheduled from it", () => {
    const report = describeSourceHealth({
      lastSyncedAt: new Date(nowMs - minute).toISOString(),
      runs: droughtRuns,
      storedAssetCount: 49,
      poolNames: ["Archive rotation"],
      blockNames: [],
      nowMs
    });

    expect(report.impact).toBe("It feeds Archive rotation, which no scheduled block uses right now.");
  });

  it("stays quiet about consequences while the source is delivering", () => {
    const report = describeSourceHealth({
      lastSyncedAt: new Date(nowMs - minute).toISOString(),
      runs: [run({ minutesAgo: 1, discoveredAssets: 49 })],
      storedAssetCount: 49,
      poolNames: ["Archive rotation"],
      blockNames: ["Nachtschleife"],
      nowMs
    });

    expect(report.impact).toBe("");
  });

  it("keeps a long list of blocks readable rather than printing all of them", () => {
    const report = describeSourceHealth({
      lastSyncedAt: new Date(nowMs - minute).toISOString(),
      runs: droughtRuns,
      storedAssetCount: 49,
      poolNames: ["Archive rotation"],
      blockNames: ["Nachtschleife", "Tagesprogramm", "Abendprogramm", "Vormittag", "Spätschicht"],
      nowMs
    });

    expect(report.impact).toBe(
      "It feeds Nachtschleife, Tagesprogramm, Abendprogramm and 2 more on the schedule, which keep playing the stored videos for now."
    );
  });
});
