import { describe, expect, it } from "vitest";
import {
  TWITCH_CONNECTION_HEAL_MIN_INTERVAL_MS,
  decideTwitchConnectionHeal,
  validateTwitchAccessToken
} from "../../apps/worker/src/twitch-connection-heal";
import { TWITCH_IDENTITY_SCOPES } from "@stream247/core";

const HOUR = 60 * 60_000;

function validateResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("deciding whether to re-check a stored Twitch token", () => {
  it("re-checks a connection stuck on error while a token is still stored", () => {
    // The state measured on the running install: a fresh, fully scoped token doing real work
    // while the record says the connection is broken. Nothing but a re-check can tell them apart.
    expect(
      decideTwitchConnectionHeal({ status: "error", accessToken: "stored", lastAttemptAt: 0, now: HOUR })
    ).toEqual({ attempt: true });
  });

  it("leaves a healthy connection alone", () => {
    // Re-validating a working connection every cycle would spend Twitch's rate limit to learn
    // something already known. Status is the trigger, not a timer.
    expect(
      decideTwitchConnectionHeal({ status: "connected", accessToken: "stored", lastAttemptAt: 0, now: HOUR })
    ).toEqual({ attempt: false, reason: "not-in-error" });
    expect(
      decideTwitchConnectionHeal({ status: "not-connected", accessToken: "", lastAttemptAt: 0, now: HOUR })
    ).toEqual({ attempt: false, reason: "not-in-error" });
  });

  it("does not ask about a token it does not have", () => {
    // An error with no token is a connection that genuinely never completed. Only a reconnect
    // fixes that, and asking Twitch about an empty string would just burn a request.
    expect(
      decideTwitchConnectionHeal({ status: "error", accessToken: "", lastAttemptAt: 0, now: HOUR })
    ).toEqual({ attempt: false, reason: "no-token" });
  });

  it("holds off until the interval has passed since the last check", () => {
    // The worker cycles far faster than this. Without the interval a permanently dead token
    // would mean one validate call per cycle, forever.
    const lastAttemptAt = HOUR;
    expect(
      decideTwitchConnectionHeal({
        status: "error",
        accessToken: "stored",
        lastAttemptAt,
        now: lastAttemptAt + TWITCH_CONNECTION_HEAL_MIN_INTERVAL_MS - 1
      })
    ).toEqual({ attempt: false, reason: "checked-recently" });

    expect(
      decideTwitchConnectionHeal({
        status: "error",
        accessToken: "stored",
        lastAttemptAt,
        now: lastAttemptAt + TWITCH_CONNECTION_HEAL_MIN_INTERVAL_MS
      })
    ).toEqual({ attempt: true });
  });
});

describe("re-checking the stored token against Twitch", () => {
  it("heals when the token is valid and carries every scope a reconnect would grant", async () => {
    // The honest version of "state from measurement rather than from memory": the connection is
    // connected because Twitch just said the token works, not because a record remembers a click.
    const verdict = await validateTwitchAccessToken("stored", async () =>
      validateResponse({ login: "jimpanse247", user_id: "3141", scopes: [...TWITCH_IDENTITY_SCOPES] })
    );

    expect(verdict).toEqual({
      healthy: true,
      login: "jimpanse247",
      userId: "3141"
    });
  });

  it("refuses to heal a valid token whose grant is short, and names what is missing", async () => {
    // Promoting this to connected would restart a sync that cannot do the work — the emote-only
    // switch would fail on every cycle instead of visibly asking for a reconnect.
    const scopes = TWITCH_IDENTITY_SCOPES.filter((scope) => scope !== "moderator:manage:chat_settings");
    const verdict = await validateTwitchAccessToken("stored", async () =>
      validateResponse({ login: "jimpanse247", user_id: "3141", scopes })
    );

    expect(verdict).toEqual({
      healthy: false,
      reason: "missing-scopes",
      missingScopes: ["moderator:manage:chat_settings"]
    });
  });

  it("reports a rejected token as rejected rather than healing it", async () => {
    // A revoked or expired token is the case the error status is actually for.
    const verdict = await validateTwitchAccessToken("stored", async () =>
      validateResponse({ status: 401, message: "invalid access token" }, false, 401)
    );

    expect(verdict).toEqual({ healthy: false, reason: "rejected", status: 401 });
  });

  it("treats an unreachable Twitch as unknown, not as a broken token", async () => {
    // A network fault says nothing about the token. Reporting it as rejected would turn every
    // outage into a reconnect prompt the operator cannot act on.
    const verdict = await validateTwitchAccessToken("stored", async () => {
      throw new Error("getaddrinfo ENOTFOUND id.twitch.tv");
    });

    expect(verdict).toEqual({ healthy: false, reason: "unreachable", message: "getaddrinfo ENOTFOUND id.twitch.tv" });
  });

  it("asks Twitch with the token in the documented header", async () => {
    let seenUrl = "";
    let seenAuthorization = "";
    await validateTwitchAccessToken("stored-token", async (url, init) => {
      seenUrl = String(url);
      seenAuthorization = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      return validateResponse({ login: "l", user_id: "1", scopes: [...TWITCH_IDENTITY_SCOPES] });
    });

    expect(seenUrl).toBe("https://id.twitch.tv/oauth2/validate");
    expect(seenAuthorization).toBe("OAuth stored-token");
  });
});
