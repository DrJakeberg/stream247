import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deleteStaleTwitchScheduleSegments,
  describeKeptTwitchSegments,
  isTwitchSegmentGone,
  listComparableTwitchSegmentKeys,
  type TwitchSegmentDeleteAnswer
} from "../../apps/worker/src/twitch-schedule-cleanup";

const now = new Date("2026-10-21T12:00:00.000Z");

function segment(key: string, startTime: string) {
  return { key, segmentId: `seg-${key}`, blockId: `block-${key}`, startTime, title: key, syncedAt: "2026-10-20T12:00:00.000Z" };
}

describe("M113: Twitch's answer to a segment delete decides", () => {
  it("counts a 2xx and a 404 as gone, everything else as not", () => {
    expect(isTwitchSegmentGone({ status: 204 })).toBe(true);
    expect(isTwitchSegmentGone({ status: 200 })).toBe(true);
    expect(isTwitchSegmentGone({ status: 404 })).toBe(true);
    for (const status of [400, 401, 403, 429, 500, 503]) {
      expect(isTwitchSegmentGone({ status }), String(status)).toBe(false);
    }
    expect(isTwitchSegmentGone({ error: "timed out after 10000 ms" })).toBe(false);
  });

  it("keeps an upcoming segment Twitch did not delete and drops one that has started", async () => {
    const answers: Record<string, TwitchSegmentDeleteAnswer | Error> = {
      gone: { status: 204 },
      missing: { status: 404 },
      refused: { status: 500 },
      limited: { status: 429 },
      silent: new Error("https://api.twitch.tv/helix/schedule/segment did not answer within 10000 ms"),
      started: { status: 400 }
    };
    const stale = [
      segment("gone", "2026-10-22T18:00:00.000Z"),
      segment("missing", "2026-10-22T19:00:00.000Z"),
      segment("refused", "2026-10-23T18:00:00.000Z"),
      segment("limited", "2026-10-24T18:00:00.000Z"),
      segment("silent", "2026-10-25T18:00:00.000Z"),
      segment("started", "2026-10-21T11:30:00.000Z")
    ];
    const asked: string[] = [];

    const result = await deleteStaleTwitchScheduleSegments({
      stale,
      now,
      deleteSegment: async (entry) => {
        asked.push(entry.segmentId);
        const answer = answers[entry.key];
        if (answer instanceof Error) {
          throw answer;
        }
        return answer;
      }
    });

    // Every stale segment is asked for once, in order, also after a failure.
    expect(asked).toEqual(stale.map((entry) => entry.segmentId));
    expect(result.kept.map((entry) => entry.key)).toEqual(["refused", "limited", "silent"]);
    // The kept record is the stored one, unchanged, so the next sync deletes the same Twitch id.
    expect(result.kept[0]).toBe(stale[2]);
    expect(result.failures).toEqual([
      { key: "refused", segmentId: "seg-refused", reason: "status 500", kept: true },
      { key: "limited", segmentId: "seg-limited", reason: "status 429", kept: true },
      {
        key: "silent",
        segmentId: "seg-silent",
        reason: "https://api.twitch.tv/helix/schedule/segment did not answer within 10000 ms",
        kept: true
      },
      { key: "started", segmentId: "seg-started", reason: "status 400", kept: false }
    ]);
    expect(describeKeptTwitchSegments(result.failures)).toBe(
      "Twitch did not delete 3 old segment(s) of the channel's schedule (status 500, status 429, https://api.twitch.tv/helix/schedule/segment did not answer within 10000 ms), so viewers may still see them. The next schedule sync, within 15 minutes, tries again."
    );
  });

  it("tries a kept segment again on the next sync and lets it go once Twitch deletes it", async () => {
    // A small Twitch: the first delete of each segment fails, the second succeeds.
    const onTwitch = new Set(["seg-a", "seg-b"]);
    const attempts = new Map<string, number>();
    const deleteSegment = async (entry: { segmentId: string }): Promise<TwitchSegmentDeleteAnswer> => {
      const attempt = (attempts.get(entry.segmentId) ?? 0) + 1;
      attempts.set(entry.segmentId, attempt);
      if (attempt === 1) {
        return { status: 503 };
      }
      onTwitch.delete(entry.segmentId);
      return { status: 204 };
    };
    let stored = [segment("a", "2026-10-22T18:00:00.000Z"), segment("b", "2026-10-23T18:00:00.000Z")];

    const first = await deleteStaleTwitchScheduleSegments({ stale: stored, now, deleteSegment });
    stored = first.kept;
    expect(stored.map((entry) => entry.key)).toEqual(["a", "b"]);
    expect(onTwitch.size).toBe(2);

    const second = await deleteStaleTwitchScheduleSegments({ stale: stored, now, deleteSegment });
    expect(second.kept).toEqual([]);
    expect(second.failures).toEqual([]);
    expect(onTwitch.size).toBe(0);
  });

  it("does not count a kept segment as a change of the schedule", () => {
    const desired = ["k1", "k2"];
    const stored = ["k1", "k2", "old"];
    // Without the exclusion the stored keys never equal the plan, and every cycle sends the whole schedule.
    expect(listComparableTwitchSegmentKeys(stored, new Set())).toEqual(stored);
    expect(listComparableTwitchSegmentKeys(stored, new Set(["old"]))).toEqual(desired);
    // A block removed since is a change: its key is not in the kept set, so the sync runs at once.
    expect(listComparableTwitchSegmentKeys([...stored, "k3"], new Set(["old"]))).toEqual([...desired, "k3"]);
  });
});

describe("M113: the worker's schedule sync uses the answer", () => {
  const worker = readFileSync(new URL("../../apps/worker/src/index.ts", import.meta.url), "utf8");
  const sync = worker.slice(worker.indexOf("async function syncTwitchSchedule("), worker.indexOf("async function", worker.indexOf("async function syncTwitchSchedule(") + 10));

  it("deletes through the cleanup, stores the kept segments and raises or closes the warning", () => {
    expect(sync).toContain("const staleCleanup = await deleteStaleTwitchScheduleSegments({");
    expect(sync).toContain("return { status: response.status };");
    expect(sync).toContain("await replaceTwitchScheduleSegments([...nextSegments, ...staleCleanup.kept]);");
    expect(sync).not.toContain("await replaceTwitchScheduleSegments(nextSegments);");
    expect(sync).toContain("twitchSegmentsKeptAfterFailedDelete = new Set(staleCleanup.kept.map((segment) => segment.key));");
    expect(sync).toContain('fingerprint: "twitch.schedule.delete.failed"');
    expect(sync).toContain('await resolveIncident("twitch.schedule.delete.failed",');
    expect(sync).toContain('logRuntimeEvent("twitch.schedule.segment.delete_failed"');
  });

  it("compares the plan with the stored keys minus the kept ones", () => {
    expect(sync).toMatch(
      /const currentKeys = listComparableTwitchSegmentKeys\(\s*args\.state\.twitchScheduleSegments\.map\(\(segment\) => segment\.key\),\s*twitchSegmentsKeptAfterFailedDelete\s*\)\.sort\(\);/
    );
  });
});
