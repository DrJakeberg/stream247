import { describe, expect, it } from "vitest";
import {
  TWITCH_IDENTITY_SCOPES,
  findMissingTwitchIdentityScopes,
  twitchFailureDowngradesStatus
} from "@stream247/core";

/**
 * The rule both connection slots share.
 *
 * The broadcaster slot already refused to downgrade a working connection; the identity slot did
 * not, and one stray second callback was enough to mark a healthy connection broken and silently
 * stop metadata sync, moderation sync and event registration. The two slots now answer the same
 * question, so the difference that matters is stated once: which *kind* of failure this is.
 */
describe("the Twitch connection failure rule", () => {
  it("leaves a connected slot alone when a fresh connect attempt is rejected", () => {
    // A double-clicked connect button, a stale tab, a late second callback: none of these are
    // evidence about the token already stored, so none of them may take the connection down.
    expect(twitchFailureDowngradesStatus({ currentStatus: "connected", kind: "connect-attempt" })).toBe(false);
  });

  it("still records a rejected connect attempt when nothing is connected yet", () => {
    // The first attempt failing is the operator's only signal that it failed, so it must land.
    expect(twitchFailureDowngradesStatus({ currentStatus: "not-connected", kind: "connect-attempt" })).toBe(true);
    expect(twitchFailureDowngradesStatus({ currentStatus: "error", kind: "connect-attempt" })).toBe(true);
  });

  it("downgrades a connected slot when the failure is about the stored connection itself", () => {
    // A revoked or expired token — the shape a worker refresh reports as a 401 — is evidence
    // about the existing connection, not about an attempt. Protecting the status here would
    // leave the dashboard claiming a connection that cannot do any work.
    expect(twitchFailureDowngradesStatus({ currentStatus: "connected", kind: "existing-connection" })).toBe(true);
  });
});

describe("the Twitch identity scopes", () => {
  it("names every scope a fresh connect asks for", () => {
    // The heal path promotes a stored token back to connected. "Good enough" has to mean "as
    // capable as reconnecting would make it", or healing would re-enable a sync that then fails.
    expect(TWITCH_IDENTITY_SCOPES).toContain("chat:read");
    expect(TWITCH_IDENTITY_SCOPES).toContain("chat:edit");
    expect(TWITCH_IDENTITY_SCOPES).toContain("moderator:manage:chat_settings");
    expect(TWITCH_IDENTITY_SCOPES).toContain("channel:manage:broadcast");
  });

  it("reports nothing missing when the token carries the full grant", () => {
    expect(findMissingTwitchIdentityScopes([...TWITCH_IDENTITY_SCOPES])).toEqual([]);
    // Twitch returns the grant in its own order and the comparison must not care.
    expect(findMissingTwitchIdentityScopes([...TWITCH_IDENTITY_SCOPES].reverse())).toEqual([]);
  });

  it("names the scopes a partial grant is missing", () => {
    // The emote-only switch is the moderation scope; naming it is what tells an operator why a
    // reconnect is unavoidable rather than leaving them to guess.
    const granted = TWITCH_IDENTITY_SCOPES.filter((scope) => scope !== "moderator:manage:chat_settings");
    expect(findMissingTwitchIdentityScopes(granted)).toEqual(["moderator:manage:chat_settings"]);
  });

  it("ignores surrounding whitespace and empty entries in the reported grant", () => {
    const granted = TWITCH_IDENTITY_SCOPES.map((scope) => ` ${scope} `).concat("", "   ");
    expect(findMissingTwitchIdentityScopes(granted)).toEqual([]);
  });
});
