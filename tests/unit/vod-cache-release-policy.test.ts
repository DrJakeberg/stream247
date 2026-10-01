import { describe, expect, it } from "vitest";
import type { ScheduleBlock } from "@stream247/core";
import { collectUpcomingPoolIds, shouldKeepFinishedVodCache } from "../../apps/worker/src/vod-cache-release-policy";

/**
 * M62: the cache used to delete every replay the moment it finished playing and download it again
 * when it came round — 2.38, 14.51, 4.04 and 9.47 GB released and re-fetched on one day. A replay
 * whose pool feeds a block starting within the retention horizon stays on disk.
 */
const block = (over: Partial<ScheduleBlock>): ScheduleBlock => ({
  id: "b", title: "Block", categoryName: "Talk", dayOfWeek: 5, startMinuteOfDay: 600, durationMinutes: 120, sourceName: "Pool", poolId: "pool-a", ...over
});

describe("collectUpcomingPoolIds", () => {
  it("takes the pools of blocks that start later today within the horizon", () => {
    // Friday 2026-09-04, 09:00: a block at 10:00 on Fridays is inside a 6 h horizon; one at 18:00 is not.
    const ids = collectUpcomingPoolIds({
      blocks: [block({ id: "soon", startMinuteOfDay: 600, poolId: "pool-a" }), block({ id: "late", startMinuteOfDay: 1080, poolId: "pool-late" })],
      date: "2026-09-04", time: "09:00", horizonMinutes: 6 * 60
    });
    expect(ids).toEqual(new Set(["pool-a"]));
  });
  it("crosses midnight into tomorrow's blocks when the horizon does", () => {
    // Friday 23:00 with a 4 h horizon reaches Saturday 02:00; a Saturday block at 01:00 counts, one at 05:00 does not.
    const ids = collectUpcomingPoolIds({
      blocks: [block({ id: "sat-early", dayOfWeek: 6, startMinuteOfDay: 60, poolId: "pool-night" }), block({ id: "sat-late", dayOfWeek: 6, startMinuteOfDay: 300, poolId: "pool-morning" })],
      date: "2026-09-04", time: "23:00", horizonMinutes: 4 * 60
    });
    expect(ids).toEqual(new Set(["pool-night"]));
  });
  it("counts the block that is on air right now — its pool keeps drawing until it ends", () => {
    const ids = collectUpcomingPoolIds({ blocks: [block({ startMinuteOfDay: 480, durationMinutes: 180, poolId: "pool-now" })], date: "2026-09-04", time: "09:00", horizonMinutes: 60 });
    expect(ids).toEqual(new Set(["pool-now"]));
  });
});

describe("shouldKeepFinishedVodCache", () => {
  const pools = [{ id: "pool-a", sourceIds: ["src-1"] }, { id: "pool-b", sourceIds: ["src-2"] }];
  it("keeps a replay whose source feeds an upcoming pool", () => {
    expect(shouldKeepFinishedVodCache({ assetSourceId: "src-1", pools, upcomingPoolIds: new Set(["pool-a"]) })).toBe(true);
  });
  it("releases a replay nothing upcoming draws from", () => {
    expect(shouldKeepFinishedVodCache({ assetSourceId: "src-2", pools, upcomingPoolIds: new Set(["pool-a"]) })).toBe(false);
    expect(shouldKeepFinishedVodCache({ assetSourceId: "src-1", pools, upcomingPoolIds: new Set() })).toBe(false);
  });
});
