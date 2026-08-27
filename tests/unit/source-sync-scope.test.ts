import { describe, expect, it } from "vitest";
import {
  decideSourceAssetReplacement,
  decideSourceDroughtIncident,
  selectReplaceableSourceIds
} from "../../apps/worker/src/source-sync-scope.js";
import { SOURCE_BARREN_RUN_ALERT_THRESHOLD, type SourceSyncRunView } from "@stream247/core";

describe("decideSourceAssetReplacement", () => {
  it("replaces a source that ingested normally", () => {
    expect(
      decideSourceAssetReplacement({
        sourceId: "src_a",
        ingestFailed: false,
        incomingAssetCount: 12,
        storedAssetCount: 11
      })
    ).toBe("replace");
  });

  // The v1.5.31 on-air failure: a transient yt-dlp error on one Twitch source pushed zero assets
  // for it, but the source id stayed in the wholesale delete list. Every asset of that source —
  // including the one currently on air — was deleted, the pool went empty, the selector fell to
  // global_fallback and cut the running programme with a silent stopPlayoutProcess("switch").
  it("keeps stored assets when the ingest threw", () => {
    expect(
      decideSourceAssetReplacement({
        sourceId: "src_a",
        ingestFailed: true,
        incomingAssetCount: 0,
        storedAssetCount: 40
      })
    ).toBe("keep-ingest-failed");
  });

  it("keeps stored assets when a previously populated source suddenly returns nothing", () => {
    expect(
      decideSourceAssetReplacement({
        sourceId: "src_a",
        ingestFailed: false,
        incomingAssetCount: 0,
        storedAssetCount: 40
      })
    ).toBe("keep-empty-result");
  });

  it("still allows a genuinely empty source to stay empty", () => {
    expect(
      decideSourceAssetReplacement({
        sourceId: "src_new",
        ingestFailed: false,
        incomingAssetCount: 0,
        storedAssetCount: 0
      })
    ).toBe("replace");
  });

  it("never keeps stale rows when the ingest returned content", () => {
    expect(
      decideSourceAssetReplacement({
        sourceId: "src_a",
        ingestFailed: false,
        incomingAssetCount: 1,
        storedAssetCount: 40
      })
    ).toBe("replace");
  });
});

describe("selectReplaceableSourceIds", () => {
  it("scopes the wholesale delete to the sources that actually ingested", () => {
    expect(
      selectReplaceableSourceIds([
        { sourceId: "ok", ingestFailed: false, incomingAssetCount: 3, storedAssetCount: 3 },
        { sourceId: "threw", ingestFailed: true, incomingAssetCount: 0, storedAssetCount: 7 },
        { sourceId: "empty-now", ingestFailed: false, incomingAssetCount: 0, storedAssetCount: 7 },
        { sourceId: "fresh", ingestFailed: false, incomingAssetCount: 0, storedAssetCount: 0 }
      ])
    ).toEqual(["ok", "fresh"]);
  });

  // A failure on one source must not stop a healthy sibling from being refreshed.
  it("isolates sources from each other", () => {
    expect(
      selectReplaceableSourceIds([
        { sourceId: "a", ingestFailed: true, incomingAssetCount: 0, storedAssetCount: 5 },
        { sourceId: "b", ingestFailed: false, incomingAssetCount: 9, storedAssetCount: 9 }
      ])
    ).toEqual(["b"]);
  });

  it("returns an empty list when every source failed", () => {
    expect(
      selectReplaceableSourceIds([
        { sourceId: "a", ingestFailed: true, incomingAssetCount: 0, storedAssetCount: 5 },
        { sourceId: "b", ingestFailed: true, incomingAssetCount: 0, storedAssetCount: 5 }
      ])
    ).toEqual([]);
  });
});

// The half of the 2026-08-27 outage the asset-preserve fix did not address.
//
// A Twitch listing that comes back empty without throwing takes the success path: the run is
// written as "skipped" with zero discovered assets, and the sync then calls
// resolveIncident(`source.<kind>.<id>`) -- actively CLOSING the one entry that could have told
// anyone. So the source row said "Ingestion failed" while the incident list said nothing at all,
// for hours, with the channel on the filler slate.
//
// A source that has stopped delivering is a STATE in the sense of incident-classes.ts: it is true
// or not true right now, and the next delivering run is what ends it. It therefore reuses the
// existing `source.<kind>.<id>` fingerprint rather than adding one -- a source that throws and a
// source that answers with nothing are the same open question for the operator, and two
// fingerprints would put the same source in the list twice.

function barren(count: number): SourceSyncRunView[] {
  return Array.from({ length: count }, (_, index) => ({
    status: "skipped",
    startedAt: new Date(1_800_000_000_000 - index * 30_000).toISOString(),
    finishedAt: new Date(1_800_000_000_000 - index * 30_000).toISOString(),
    discoveredAssets: 0
  }));
}

const delivered: SourceSyncRunView = {
  status: "success",
  startedAt: new Date(1_800_000_000_000).toISOString(),
  finishedAt: new Date(1_800_000_000_000).toISOString(),
  discoveredAssets: 49
};

describe("decideSourceDroughtIncident", () => {
  it("closes the entry as soon as a check delivers again", () => {
    expect(decideSourceDroughtIncident({ runs: [delivered, ...barren(9)], storedAssetCount: 49, referencedByPool: true })).toEqual({
      action: "resolve",
      barrenRuns: 0
    });
  });

  it("stays silent while a single empty listing is still a blip", () => {
    expect(decideSourceDroughtIncident({ runs: barren(1), storedAssetCount: 49, referencedByPool: true })).toEqual({
      action: "leave",
      barrenRuns: 1
    });
  });

  it("does not resolve the entry the throw path opened while the source is still barren", () => {
    // The regression this replaces: the old code resolved unconditionally on any non-throwing run,
    // so an empty listing wiped out an entry raised by the previous cycle's genuine failure.
    expect(decideSourceDroughtIncident({ runs: barren(2), storedAssetCount: 49, referencedByPool: true }).action).toBe("leave");
  });

  it("reports once the drought reaches the threshold", () => {
    expect(
      decideSourceDroughtIncident({
        runs: barren(SOURCE_BARREN_RUN_ALERT_THRESHOLD),
        storedAssetCount: 49,
        referencedByPool: true
      })
    ).toEqual({ action: "report", barrenRuns: SOURCE_BARREN_RUN_ALERT_THRESHOLD });
  });

  it("reports a source nothing plays from yet, as long as it used to deliver", () => {
    expect(decideSourceDroughtIncident({ runs: barren(4), storedAssetCount: 12, referencedByPool: false }).action).toBe("report");
  });

  it("reports an empty source that a pool depends on, because that is the dark channel", () => {
    expect(decideSourceDroughtIncident({ runs: barren(4), storedAssetCount: 0, referencedByPool: true }).action).toBe("report");
  });

  it("leaves a source alone that has nothing and that nothing plays from", () => {
    // A configured-but-unused source with an empty archive is not an incident, it is a setting.
    // Reporting it would put a permanently open entry in the list that no action can ever close --
    // which is the exact failure mode M58 removed.
    expect(decideSourceDroughtIncident({ runs: barren(40), storedAssetCount: 0, referencedByPool: false }).action).toBe("leave");
  });

  it("has nothing to say about a source that has never run", () => {
    expect(decideSourceDroughtIncident({ runs: [], storedAssetCount: 0, referencedByPool: true })).toEqual({
      action: "leave",
      barrenRuns: 0
    });
  });
});
