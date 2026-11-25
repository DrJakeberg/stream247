import { describe, expect, it } from "vitest";
import { isProtectedAuditEventType } from "@stream247/core";
import type { AuditEvent } from "@stream247/db";
import {
  classifyAuditEventType,
  describeAuditOverflow,
  isNotableAuditEvent,
  OUTSIDER_WRITABLE_AUDIT_TYPES,
  partitionNotableAuditEvents,
  summariseAuditActivity
} from "../../apps/web/lib/audit-activity";

function event(type: string, createdAt = "2026-08-01T10:00:00.000Z"): AuditEvent {
  return { id: `audit-${type}-${createdAt}`, type, message: `${type} happened`, createdAt };
}

describe("audit activity classification", () => {
  it("treats access and credential families as security", () => {
    for (const type of [
      "auth.twitch",
      "relay.internal_key.revealed",
      "relay.publish_rejected",
      "team.grant",
      "destination.created",
      "destination.deleted"
    ]) {
      expect(classifyAuditEventType(type), type).toBe("security");
    }
  });

  it("picks the account-linkage and key-issuing entries out of otherwise routine families", () => {
    // `twitch.` is mostly schedule and EventSub reconciliation; matching the family wholesale would
    // bury exactly the entries this panel exists to surface.
    for (const type of [
      "setup.completed",
      "twitch.connected",
      "twitch.broadcaster.connected",
      "twitch.broadcaster.disconnected",
      "overlay.video_source_key_issued"
    ]) {
      expect(classifyAuditEventType(type), type).toBe("security");
    }

    for (const type of ["twitch.eventsub.sync", "twitch.schedule.sync.failed", "overlay.published"]) {
      expect(classifyAuditEventType(type), type).not.toBe("security");
    }
  });

  it("treats every type the retention rule protects as security, so screen and pruning agree", () => {
    for (const type of [
      "auth.password.changed",
      "incident.acknowledged",
      "source.deleted",
      "overlay.video_source_deleted",
      "settings.managed-config.updated",
      "settings.twitch-app.updated",
      "twitch.error",
      "twitch.broadcaster.error"
    ]) {
      expect(isProtectedAuditEventType(type), type).toBe(true);
      expect(classifyAuditEventType(type), type).toBe("security");
    }
  });

  it("keeps the relay watch's chatter out of the security list", () => {
    // Since M126 the `relay.` family is mostly the watchdog and reachability transitions; matching
    // it wholesale would bury a revealed ingest key under relay reconnects.
    for (const type of ["relay.watchdog.restart", "relay.watchdog.hold", "relay.reachable", "relay.unreachable"]) {
      expect(classifyAuditEventType(type), type).toBe("activity");
    }
  });

  it("separates configuration changes from access changes", () => {
    for (const type of [
      "settings.encoder.updated",
      "settings.instance.updated",
      "settings.operations.updated",
      "moderation.updated"
    ]) {
      expect(classifyAuditEventType(type), type).toBe("configuration");
    }
  });

  it("leaves catalog and playout traffic as ordinary activity", () => {
    for (const type of [
      "asset.updated",
      "pool.created",
      "playout.skip.current",
      "source.sync.requested",
      "moderation.checkin"
    ]) {
      expect(classifyAuditEventType(type), type).toBe("activity");
    }
  });

  it("keeps overlay draft traffic out of the notable panel", () => {
    // Measured, not assumed: on the dev database on 2026-09-01 the entire retained trail was these
    // three types — 50/25/25 and nothing else. Promoting `overlay.` wholesale would have made the
    // notable panel 100% draft saves, which is the failure this classification exists to avoid.
    for (const type of ["overlay.engagement.updated", "overlay.draft_saved", "overlay.draft_reset"]) {
      expect(classifyAuditEventType(type), type).toBe("activity");
    }

    expect(classifyAuditEventType("overlay.video_source_key_issued")).toBe("security");
  });

  it("classifies unknown and malformed types as activity rather than dropping them", () => {
    expect(classifyAuditEventType("")).toBe("activity");
    expect(classifyAuditEventType("something.new")).toBe("activity");
    // Casing and padding come from whatever wrote the row, not from a schema.
    expect(classifyAuditEventType("  AUTH.TWITCH  ")).toBe("security");
  });

  it("marks anything that is not ordinary activity as notable", () => {
    expect(isNotableAuditEvent(event("relay.publish_rejected"))).toBe(true);
    expect(isNotableAuditEvent(event("settings.watchdogs.updated"))).toBe(true);
    expect(isNotableAuditEvent(event("asset.updated"))).toBe(false);
  });
});

describe("audit activity summary", () => {
  it("counts each category and reports the edges of the retained window", () => {
    const summary = summariseAuditActivity([
      event("auth.twitch", "2026-08-03T10:00:00.000Z"),
      event("relay.internal_key.revealed", "2026-08-02T10:00:00.000Z"),
      event("settings.encoder.updated", "2026-08-01T10:00:00.000Z"),
      event("asset.updated", "2026-07-30T10:00:00.000Z")
    ]);

    expect(summary.total).toBe(4);
    expect(summary.securityCount).toBe(2);
    expect(summary.configurationCount).toBe(1);
    expect(summary.completeSince).toBe("2026-07-30T10:00:00.000Z");
    expect(summary.oldestCreatedAt).toBe("2026-07-30T10:00:00.000Z");
    expect(summary.newestCreatedAt).toBe("2026-08-03T10:00:00.000Z");
  });

  it("puts the complete-since edge at the end of the general window, not at the oldest protected entry", () => {
    const summary = summariseAuditActivity(
      [
        event("asset.updated", "2026-08-03T10:00:00.000Z"),
        event("asset.updated", "2026-08-02T10:00:00.000Z"),
        event("auth.twitch", "2026-06-01T10:00:00.000Z")
      ],
      2
    );

    expect(summary.completeSince).toBe("2026-08-02T10:00:00.000Z");
    expect(summary.oldestCreatedAt).toBe("2026-06-01T10:00:00.000Z");
  });

  it("survives an empty trail", () => {
    expect(summariseAuditActivity([])).toEqual({
      total: 0,
      securityCount: 0,
      configurationCount: 0,
      completeSince: "",
      oldestCreatedAt: "",
      newestCreatedAt: ""
    });
  });

  it("does not depend on the input already being sorted", () => {
    const summary = summariseAuditActivity([
      event("asset.updated", "2026-07-30T10:00:00.000Z"),
      event("auth.twitch", "2026-08-03T10:00:00.000Z")
    ]);

    expect(summary.oldestCreatedAt).toBe("2026-07-30T10:00:00.000Z");
    expect(summary.newestCreatedAt).toBe("2026-08-03T10:00:00.000Z");
  });
});

describe("audit overflow notice", () => {
  it("says nothing when the panel shows everything", () => {
    expect(describeAuditOverflow(12, 12)).toBe("");
    expect(describeAuditOverflow(0, 0)).toBe("");
  });

  it("names what the cap is hiding, because an audit list read as complete is a wrong conclusion", () => {
    expect(describeAuditOverflow(60, 61)).toBe("1 older retained entry is not shown here.");
    expect(describeAuditOverflow(60, 500)).toBe("440 older retained entries are not shown here.");
  });
});

describe("entries an outsider can write", () => {
  it("cannot push a real sign-in below the notable row cap", () => {
    // 200 refused publishes (twenty minutes at the relay throttle) and a burst of callback errors,
    // newest first, with one real sign-in older than all of them.
    const flood: AuditEvent[] = [];
    for (let index = 0; index < 200; index += 1) {
      const at = new Date(Date.UTC(2026, 10, 25, 12, 0, 0) - index * 6_000).toISOString();
      flood.push({ ...event("relay.publish_rejected", at), id: `reject-${index}` });
      if (index < 50) {
        flood.push({ ...event("twitch.error", at), id: `twitch-${index}` });
      }
    }
    const signIn = { ...event("auth.signin", "2026-11-25T08:00:00.000Z"), id: "signin" };
    const notable = [...flood, signIn].filter(isNotableAuditEvent);

    const { listed, folded } = partitionNotableAuditEvents(notable);

    expect(listed.slice(0, 60).map((entry) => entry.id)).toContain("signin");
    expect(folded.map((group) => [group.type, group.count])).toEqual([
      ["relay.publish_rejected", 200],
      ["twitch.error", 50]
    ]);
    expect(folded[0]?.newestCreatedAt).toBe("2026-11-25T12:00:00.000Z");
  });

  it("folds only types that are written from unauthenticated paths, and all of them stay security", () => {
    expect([...OUTSIDER_WRITABLE_AUDIT_TYPES].sort()).toEqual([
      "relay.publish_rejected",
      "twitch.broadcaster.error",
      "twitch.error"
    ]);
    for (const type of OUTSIDER_WRITABLE_AUDIT_TYPES) {
      expect(classifyAuditEventType(type), type).toBe("security");
    }
    const { listed, folded } = partitionNotableAuditEvents([event("relay.internal_key.revealed"), event("team.grant")]);
    expect(listed).toHaveLength(2);
    expect(folded).toEqual([]);
  });
});
