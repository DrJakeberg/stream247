import { describe, expect, it } from "vitest";
import { evaluateBotConnectLogin, resolveTwitchAccounts, type TwitchAccountsInput } from "../../packages/core/src/twitch-accounts";

// The reference install on 2026-09-28: jimpanse247 is the broadcast channel (stream key, viewers),
// 3JakeC the bot/moderator account the app is connected as, the channel owner never connected.
function referenceInstall(overrides: Partial<TwitchAccountsInput> = {}): TwitchAccountsInput {
  return {
    channelSetting: { managed: "jimpanse247", env: "" },
    expectedBotSetting: { managed: "", env: "" },
    bot: { status: "connected", login: "3jakec", id: "144919385" },
    owner: { status: "not-connected", login: "", hasToken: false, error: "" },
    channelUserId: "1473383386",
    ...overrides
  };
}

function capabilityOf(summary: ReturnType<typeof resolveTwitchAccounts>, key: string) {
  const found = summary.capabilities.find((entry) => entry.key === key);
  expect(found, key).toBeDefined();
  return found!;
}

describe("resolving the two Twitch accounts", () => {
  it("names jimpanse247 the channel and 3jakec the bot on the reference install", () => {
    const summary = resolveTwitchAccounts(referenceInstall());
    expect(summary.mode).toBe("split");
    expect(summary.channel).toEqual({ login: "jimpanse247", source: "settings", userId: "1473383386", ignoredSetting: "" });
    expect(summary.bot).toMatchObject({ connected: true, login: "3jakec", id: "144919385", matchesExpected: null });
    expect(summary.owner.status).toBe("not-connected");
  });

  // The confusion this module exists for: the channel's id must never be the bot's id.
  it("never reports the bot's id as the channel's id in a split", () => {
    const summary = resolveTwitchAccounts(referenceInstall({ channelUserId: "" }));
    expect(summary.channel.userId).toBe("");
  });

  it("runs chat and moderation through the bot and waits for the owner for channel writes", () => {
    const summary = resolveTwitchAccounts(referenceInstall());
    for (const key of ["chat", "moderation", "checkins", "chatGames", "followAlerts", "liveStatus", "ownerSignIn"]) {
      expect(capabilityOf(summary, key)).toMatchObject({ available: true, via: "bot", reason: "" });
    }
    for (const key of ["titleCategory", "schedule", "subAlerts", "cheerAlerts", "redemptionAlerts"]) {
      const entry = capabilityOf(summary, key);
      expect(entry.available).toBe(false);
      expect(entry.via).toBeNull();
      expect(entry.reason).toContain("jimpanse247");
    }
  });

  it("hands the channel writes to a connected owner that matches the channel", () => {
    const summary = resolveTwitchAccounts(
      referenceInstall({ owner: { status: "connected", login: "JimPanse247", hasToken: true, error: "" } })
    );
    expect(summary.owner.status).toBe("connected");
    expect(capabilityOf(summary, "titleCategory")).toMatchObject({ available: true, via: "channel-owner" });
  });

  it("flags an owner connection for another account instead of using it", () => {
    const summary = resolveTwitchAccounts(
      referenceInstall({ owner: { status: "connected", login: "3jakec", hasToken: true, error: "" } })
    );
    expect(summary.owner.status).toBe("wrong-account");
    expect(capabilityOf(summary, "schedule").available).toBe(false);
    expect(capabilityOf(summary, "schedule").reason).toMatch(/3jakec, not jimpanse247/);
  });

  it("treats a channel equal to the bot as one account doing everything", () => {
    const summary = resolveTwitchAccounts(referenceInstall({ channelSetting: { managed: "3JakeC", env: "" }, channelUserId: "" }));
    expect(summary.mode).toBe("single-account");
    expect(summary.owner.status).toBe("not-needed");
    expect(summary.channel.userId).toBe("144919385");
    expect(capabilityOf(summary, "titleCategory")).toMatchObject({ available: true, via: "bot" });
  });

  it("says when the channel is only assumed to be the bot's own", () => {
    const summary = resolveTwitchAccounts(referenceInstall({ channelSetting: { managed: "", env: "" }, channelUserId: "" }));
    expect(summary.mode).toBe("unconfirmed");
    expect(summary.channel).toMatchObject({ login: "3jakec", source: "bot-fallback", ignoredSetting: "" });
  });

  it("reports an invalid channel setting as ignored, exactly like the metadata gate ignores it", () => {
    const summary = resolveTwitchAccounts(referenceInstall({ channelSetting: { managed: "jim panse", env: "jimpanse247" } }));
    // managed wins even when invalid (M51 rule), so env is not consulted and the bot is assumed.
    expect(summary.mode).toBe("unconfirmed");
    expect(summary.channel.ignoredSetting).toBe("jim panse");
  });

  it("names the env as the source when only TWITCH_BROADCAST_CHANNEL_LOGIN is set", () => {
    const summary = resolveTwitchAccounts(referenceInstall({ channelSetting: { managed: "", env: "jimpanse247" } }));
    expect(summary.channel.source).toBe("env");
  });

  it("checks the connected bot against the expected bot login", () => {
    expect(resolveTwitchAccounts(referenceInstall({ expectedBotSetting: { managed: "3JakeC", env: "" } })).bot.matchesExpected).toBe(true);
    expect(resolveTwitchAccounts(referenceInstall({ expectedBotSetting: { managed: "", env: "otherbot" } })).bot.matchesExpected).toBe(false);
  });

  it("reports nothing as available without a bot connection, and says what to do", () => {
    const summary = resolveTwitchAccounts(referenceInstall({ bot: { status: "not-connected", login: "", id: "" } }));
    expect(summary.bot.connected).toBe(false);
    expect(capabilityOf(summary, "chat")).toMatchObject({ available: false, reason: "Connect the bot account." });
  });
});

describe("accepting a bot connection", () => {
  const base = { expectedBotLogin: "", broadcastChannelLogin: "jimpanse247", currentBotLogin: "3jakec" };

  it("accepts the bot account", () => {
    expect(evaluateBotConnectLogin({ ...base, authenticatedLogin: "3JakeC" })).toEqual({ ok: true });
  });

  it("refuses another account than the configured bot login, naming both", () => {
    const verdict = evaluateBotConnectLogin({ ...base, expectedBotLogin: "3jakec", authenticatedLogin: "someoneelse" });
    expect(verdict).toMatchObject({ ok: false, reason: "wrong-account" });
    expect(!verdict.ok && verdict.message).toMatch(/someoneelse.*3jakec/);
  });

  // The browser is often signed in to Twitch as the channel; storing it as bot would silently end the split.
  it("refuses the broadcast channel itself while a split is active", () => {
    const verdict = evaluateBotConnectLogin({ ...base, authenticatedLogin: "jimpanse247" });
    expect(verdict).toMatchObject({ ok: false, reason: "is-broadcast-channel" });
    expect(!verdict.ok && verdict.message).toContain("Channel owner connection");
  });

  it("lets a fresh install connect the channel as its one account", () => {
    expect(evaluateBotConnectLogin({ ...base, currentBotLogin: "", authenticatedLogin: "jimpanse247" })).toEqual({ ok: true });
  });
});
