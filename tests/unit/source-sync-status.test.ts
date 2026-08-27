import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOURCE_SYNC_STATUS_LABELS,
  buildPreservedAssetsNote,
  describeSourceSyncStatus
} from "../../apps/worker/src/source-sync-scope.js";

// B2: the sync learned to preserve assets, but the status write did not learn about it. Both a
// wiped source and a preserved one reported "Ingestion failed", which are opposite situations:
// one needs the operator now, the other resolves itself on the next cycle.
describe("describeSourceSyncStatus", () => {
  it("reports a healthy sync as ready with the count it ingested", () => {
    expect(describeSourceSyncStatus({ sourceId: "s", ingestFailed: false, incomingAssetCount: 12, storedAssetCount: 11 })).toEqual({
      status: "Ready",
      assetsPreserved: false,
      effectiveAssetCount: 12
    });
  });

  it("distinguishes a failed sync that kept its archive from one that has nothing", () => {
    const preserved = describeSourceSyncStatus({
      sourceId: "s",
      ingestFailed: true,
      incomingAssetCount: 0,
      storedAssetCount: 49
    });
    const empty = describeSourceSyncStatus({
      sourceId: "s",
      ingestFailed: true,
      incomingAssetCount: 0,
      storedAssetCount: 0
    });

    expect(preserved.status).toBe("Ingestion failed (assets preserved)");
    expect(preserved.assetsPreserved).toBe(true);
    // The count that matters is what is still playable, not the zero this cycle collected.
    expect(preserved.effectiveAssetCount).toBe(49);

    expect(empty.status).toBe("Ingestion failed");
    expect(empty.assetsPreserved).toBe(false);
    expect(empty.effectiveAssetCount).toBe(0);
    expect(preserved.status).not.toBe(empty.status);
  });

  it("also flags the soft failure where a populated source suddenly listed nothing", () => {
    expect(
      describeSourceSyncStatus({ sourceId: "s", ingestFailed: false, incomingAssetCount: 0, storedAssetCount: 49 })
    ).toEqual({ status: "Ingestion failed (assets preserved)", assetsPreserved: true, effectiveAssetCount: 49 });
  });

  it("lets a connector supply its own wording without changing the rule", () => {
    expect(
      describeSourceSyncStatus(
        { sourceId: "s", ingestFailed: true, incomingAssetCount: 0, storedAssetCount: 3 },
        { ready: "Ready", empty: "Empty", preserved: "Scan failed (assets preserved)" }
      ).status
    ).toBe("Scan failed (assets preserved)");
  });

  it("defaults to the connector wording", () => {
    expect(DEFAULT_SOURCE_SYNC_STATUS_LABELS.preserved).toBe("Ingestion failed (assets preserved)");
  });
});

describe("buildPreservedAssetsNote", () => {
  it("says how many items are still on air and that the next cycle retries", () => {
    expect(buildPreservedAssetsNote(49)).toBe(
      "This sync produced no usable listing, so the 49 stored item(s) were kept and stay playable. The next sync retries."
    );
  });

  it("is honest when there was nothing to keep", () => {
    expect(buildPreservedAssetsNote(0)).toBe(
      "This sync produced no usable listing. There were no stored items to keep. The next sync retries."
    );
  });
});
