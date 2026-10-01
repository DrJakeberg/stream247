import { describe, expect, it } from "vitest";
import {
  AUDIT_EVENT_PROTECTED_PATTERN,
  isProtectedAuditEventType,
  selectRetainedAuditEvents
} from "@stream247/core";

/**
 * What the audit trail may not lose, measured against what actually fills it.
 *
 * Every entry competed for one window of 500, newest first, so the trail was only ever as long as
 * the noisiest thing writing to it. Measured on the live channel: 142 entries over 31 hours, of
 * which 100 were `uplink.cycle` and `worker.cycle` — 70% reconciliation chatter. At that rate the
 * window fills in about four days, and from then on a sign-in or a permission grant is pushed out
 * by an uplink reconnecting.
 *
 * So a second window is kept for the entries an audit trail exists for: authentication,
 * authorisation, credentials, where the stream is sent, and destructive deletions. Deliberately not
 * "every operator action" — protecting everything protects nothing, and skipping an item or
 * publishing an overlay is operations, not audit.
 *
 * The rule is one pattern, used by the SQL that prunes and by this predicate, so the two cannot
 * drift into disagreeing about what is protected.
 */
const NOISE = [
  "uplink.cycle",
  "worker.cycle",
  "chat.vote.undecided",
  "chat.game.started",
  "chat.request",
  "chat.skip",
  "moderation.checkin",
  "playout.skip.current",
  "playout.override.asset",
  "asset.updated",
  "asset.metadata.updated",
  "overlay.published",
  "overlay.draft_saved",
  "pool.updated",
  "show.updated",
  "source.updated"
];

const PROTECTED = [
  "auth.twitch",
  "team.grant",
  "setup.completed",
  "settings.managed-config.updated",
  "settings.twitch-app.updated",
  "destination.created",
  "destination.deleted",
  "overlay.video_source_key_issued",
  "twitch.connected",
  "twitch.error",
  "twitch.broadcaster.error",
  "incident.acknowledged",
  "incident.resolved",
  "source.deleted",
  "pool.deleted",
  "show.deleted",
  "asset-collection.deleted",
  "overlay.video_source_deleted",
  // Written with an underscore rather than a dot, like the one above it. Both are deletions.
  "overlay.preset_deleted"
];

describe("audit trail retention", () => {
  it("protects a sign-in, a grant, a credential, a destination and a deletion", () => {
    for (const type of PROTECTED) {
      expect({ type, protected: isProtectedAuditEventType(type) }).toEqual({ type, protected: true });
    }
  });

  it("does not protect the traffic that fills the window", () => {
    for (const type of NOISE) {
      expect({ type, protected: isProtectedAuditEventType(type) }).toEqual({ type, protected: false });
    }
  });

  it("uses one pattern, so the pruning SQL and this predicate cannot disagree", () => {
    const pattern = new RegExp(AUDIT_EVENT_PROTECTED_PATTERN);
    for (const type of [...PROTECTED, ...NOISE]) {
      expect({ type, sql: pattern.test(type) }).toEqual({ type, sql: isProtectedAuditEventType(type) });
    }
  });

  it("is a pattern Postgres can read as well as JavaScript", () => {
    // POSIX regular expressions have no lookaround and no non-greedy quantifiers. Keeping the
    // pattern to anchors, alternation and literal dots is what lets `type ~ $pattern` mean the same
    // thing in the database as it does here.
    expect(AUDIT_EVENT_PROTECTED_PATTERN).not.toMatch(/\(\?[=!<]/);
    expect(AUDIT_EVENT_PROTECTED_PATTERN).not.toMatch(/[*+?]\?/);
  });

  it("says nothing about an empty or unknown type", () => {
    expect(isProtectedAuditEventType("")).toBe(false);
    expect(isProtectedAuditEventType("something.entirely.new")).toBe(false);
  });
});

describe("which entries survive the cut", () => {
  const event = (type: string, index: number) => ({ id: `e${String(index)}`, type });

  it("keeps the newest of everything, and the newest of what matters, in one list", () => {
    // Newest first, as the store holds them: three protected entries buried under noise.
    const events = [
      ...Array.from({ length: 10 }, (_value, index) => event("uplink.cycle", index)),
      event("auth.twitch", 10),
      ...Array.from({ length: 10 }, (_value, index) => event("worker.cycle", index + 11)),
      event("team.grant", 21),
      event("destination.deleted", 22)
    ];
    const kept = selectRetainedAuditEvents(events, { general: 5, protected: 10 });

    // The five newest of everything, plus every protected entry that fell outside them.
    expect(kept.map((entry) => entry.id)).toEqual(["e0", "e1", "e2", "e3", "e4", "e10", "e21", "e22"]);
  });

  it("keeps the input's order, so the trail still reads newest first", () => {
    const events = [event("auth.twitch", 0), event("uplink.cycle", 1), event("team.grant", 2)];
    expect(selectRetainedAuditEvents(events, { general: 1, protected: 10 }).map((entry) => entry.id)).toEqual([
      "e0",
      "e2"
    ]);
  });

  it("bounds the protected window too, so nothing can grow without end", () => {
    const events = Array.from({ length: 20 }, (_value, index) => event("auth.twitch", index));
    expect(selectRetainedAuditEvents(events, { general: 2, protected: 5 })).toHaveLength(5);
  });

  it("changes nothing when everything already fits", () => {
    const events = [event("auth.twitch", 0), event("uplink.cycle", 1)];
    expect(selectRetainedAuditEvents(events, { general: 500, protected: 500 })).toEqual(events);
  });
});
