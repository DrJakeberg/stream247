import { describe, expect, it } from "vitest";
import { chooseStoredAssetSyncFields } from "@stream247/db";

// M72. On the DUT (2026-10-01) every source sync rewrote created_at to "now" and no listing carried a
// publish date, so the pool order key was the same for a whole source and pools played alphabetically.
const firstSeen = "2026-09-01T08:00:00.000Z";
const syncNow = "2026-10-01T12:00:00.000Z";

describe("sync-owned asset fields across re-ingest", () => {
  it("keeps the first-seen created_at; only a new row takes the sync's now", () => {
    expect(chooseStoredAssetSyncFields({ createdAt: firstSeen }, { createdAt: syncNow }).createdAt).toBe(firstSeen);
    expect(chooseStoredAssetSyncFields(undefined, { createdAt: syncNow }).createdAt).toBe(syncNow);
    // A stored empty value carries no first-seen date, so the sync fills it.
    expect(chooseStoredAssetSyncFields({ createdAt: "" }, { createdAt: syncNow }).createdAt).toBe(syncNow);
  });

  it("fills published_at once and never moves it, because approximate YouTube dates drift every sync", () => {
    expect(
      chooseStoredAssetSyncFields({ createdAt: firstSeen, publishedAt: "" }, { createdAt: syncNow, publishedAt: "2026-07-01T00:00:00.000Z" })
        .publishedAt
    ).toBe("2026-07-01T00:00:00.000Z");
    expect(
      chooseStoredAssetSyncFields(
        { createdAt: firstSeen, publishedAt: "2026-07-01T00:00:00.000Z" },
        { createdAt: syncNow, publishedAt: "2026-07-02T00:00:00.000Z" }
      ).publishedAt
    ).toBe("2026-07-01T00:00:00.000Z");
    // A listing without a date does not erase the one already stored.
    expect(
      chooseStoredAssetSyncFields({ createdAt: firstSeen, publishedAt: "2026-07-01T00:00:00.000Z" }, { createdAt: syncNow }).publishedAt
    ).toBe("2026-07-01T00:00:00.000Z");
    expect(chooseStoredAssetSyncFields(undefined, { createdAt: syncNow }).publishedAt).toBe("");
  });

  it("takes the listing's duration when it has one and never resets a known duration to 0", () => {
    expect(chooseStoredAssetSyncFields({ durationSeconds: 3600 }, { createdAt: syncNow, durationSeconds: 3700 }).durationSeconds).toBe(3700);
    expect(chooseStoredAssetSyncFields({ durationSeconds: 3600 }, { createdAt: syncNow, durationSeconds: 0 }).durationSeconds).toBe(3600);
    expect(chooseStoredAssetSyncFields({ durationSeconds: 3600 }, { createdAt: syncNow }).durationSeconds).toBe(3600);
    expect(chooseStoredAssetSyncFields(undefined, { createdAt: syncNow }).durationSeconds).toBe(0);
    expect(chooseStoredAssetSyncFields({ durationSeconds: 0 }, { createdAt: syncNow, durationSeconds: Number.NaN }).durationSeconds).toBe(0);
  });
});
