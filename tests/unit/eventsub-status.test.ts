import { describe, expect, it } from "vitest";
import { isHealthyEventSubStatus } from "../../apps/worker/src/twitch-eventsub.js";

// Twitch keeps a subscription listed long after it has stopped delivering. The sync used to match
// on type, version, condition and callback alone, so a dead subscription counted as "present": it
// was neither replaced nor removed, the channel silently stopped receiving events, and every health
// surface still reported the subscription as configured.

describe("EventSub subscription health", () => {
  it("treats a delivering subscription as healthy", () => {
    expect(isHealthyEventSubStatus("enabled")).toBe(true);
  });

  it("treats pending verification as healthy", () => {
    // It resolves within seconds. Counting it as dead would create a duplicate on every sync pass
    // for as long as verification is in flight.
    expect(isHealthyEventSubStatus("webhook_callback_verification_pending")).toBe(true);
  });

  it("treats every terminal Twitch status as dead", () => {
    // These are the states Twitch actually parks a broken subscription in.
    for (const status of [
      "webhook_callback_verification_failed",
      "notification_failures_exceeded",
      "authorization_revoked",
      "moderator_removed",
      "user_removed",
      "version_removed",
      "chat_user_banned"
    ]) {
      expect(isHealthyEventSubStatus(status)).toBe(false);
    }
  });

  it("treats an unknown future status as dead rather than assuming it works", () => {
    // Twitch adds statuses over time; a new one is far more likely to mean "broken" than "fine",
    // and recreating a subscription is cheap next to a channel that receives nothing.
    expect(isHealthyEventSubStatus("some_status_added_later")).toBe(false);
  });

  it("does not read a missing status as dead", () => {
    // Absent is not evidence. Reading it as dead would delete and recreate working subscriptions on
    // every sync pass.
    expect(isHealthyEventSubStatus(undefined)).toBe(true);
    expect(isHealthyEventSubStatus("")).toBe(true);
  });
});
