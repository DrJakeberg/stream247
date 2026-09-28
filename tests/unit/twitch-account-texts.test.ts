import { describe, expect, it } from "vitest";
import { resolveTwitchAccounts, type TwitchAccountsInput } from "../../packages/core/src/twitch-accounts";
import { getTwitchAccountsTexts, type TwitchAccountsTextExtras } from "../../apps/web/lib/twitch-account-texts";

// The reference install, 2026-09-28: channel jimpanse247, bot 3JakeC, owner never connected.
const referenceInput: TwitchAccountsInput = {
  channelSetting: { managed: "jimpanse247", env: "" },
  expectedBotSetting: { managed: "", env: "" },
  bot: { status: "connected", login: "3jakec", id: "144919385" },
  owner: { status: "not-connected", login: "", hasToken: false, error: "" },
  channelUserId: "1473383386"
};

const extras: TwitchAccountsTextExtras = {
  liveStatus: "live",
  viewerCount: 3,
  botConnectedAt: "2026-09-01T22:27:00.000Z",
  lastBotRejection: null,
  lastOwnerRejection: null
};

function textsFor(input: Partial<TwitchAccountsInput> = {}, more: Partial<TwitchAccountsTextExtras> = {}) {
  return getTwitchAccountsTexts(resolveTwitchAccounts({ ...referenceInput, ...input }), { ...extras, ...more });
}

function allText(value: unknown): string {
  return JSON.stringify(value);
}

describe("Twitch accounts panel wording", () => {
  it("names both accounts by their role on the reference install", () => {
    const texts = textsFor();
    expect(texts.modeLine).toEqual({ tone: "ok", text: "Split setup: broadcast channel jimpanse247 · bot account 3jakec." });
    expect(texts.channel.title).toBe("Broadcast channel");
    expect(texts.bot.title).toBe("Bot account");
    expect(texts.bot.statusText).toBe("Connected as 3jakec.");
    expect(texts.bot.subtitle).toContain("jimpanse247's chat");
  });

  // The 2.0 status card said "Broadcaster 3jakec"; nothing may call the bot the broadcaster again.
  it("never calls the bot account the broadcaster", () => {
    expect(allText(textsFor())).not.toMatch(/broadcaster 3jakec/i);
    expect(allText(textsFor({ owner: { status: "connected", login: "3jakec", hasToken: true, error: "" } }))).not.toMatch(
      /broadcaster 3jakec/i
    );
  });

  it("points the live check at the broadcast channel, not at the bot", () => {
    const texts = textsFor();
    expect(texts.channel.liveText).toBe("Live · 3 viewers");
    expect(texts.channel.liveHint).toBe("Check whether the stream is live on twitch.tv/jimpanse247 — never on the bot account's channel.");
  });

  it("shows the channel owner connection with what waits for it", () => {
    const owner = textsFor().channel.owner!;
    expect(owner.statusText).toBe("Not connected.");
    expect(owner.action).toBe("connect");
    expect(owner.hint).toContain("as jimpanse247");
    expect(owner.needs.map((entry) => entry.label)).toEqual([
      "Title and category",
      "Twitch schedule",
      "Sub alerts",
      "Cheer alerts",
      "Channel-points alerts"
    ]);
    expect(owner.needs.every((entry) => !entry.available && entry.statusText.startsWith("Waiting"))).toBe(true);
  });

  it("lists what already runs through the bot", () => {
    const runs = textsFor().bot.runs;
    expect(runs.map((entry) => entry.label)).toContain("Chat rail");
    expect(runs.map((entry) => entry.label)).toContain("Follow alerts");
    expect(runs.every((entry) => entry.available)).toBe(true);
  });

  it("drops the owner block when one account does everything", () => {
    const texts = textsFor({ channelSetting: { managed: "3jakec", env: "" } });
    expect(texts.modeLine.text).toBe("Single account: 3jakec is the broadcast channel and the bot account.");
    expect(texts.channel.owner).toBeNull();
  });

  it("warns when the channel is only assumed to be the bot's own", () => {
    const texts = textsFor({ channelSetting: { managed: "", env: "" } });
    expect(texts.modeLine.tone).toBe("warn");
    expect(texts.modeLine.text).toContain("assumes the bot account's own channel (3jakec)");
    expect(texts.channel.sourceText).toBe("Not set — assumed to be the bot account's own channel.");
  });

  it("warns when the connected bot is not the configured one", () => {
    const texts = textsFor({ expectedBotSetting: { managed: "otherbot", env: "" } });
    expect(texts.bot.warning).toBe("Connected as 3jakec, but the bot account is set to otherbot. Connect again as otherbot.");
  });

  it("shows a refused attempt only when it is newer than the working connection", () => {
    const refused = { at: "2026-09-28T10:00:00.000Z", message: "Twitch authorised jimpanse247, which is the broadcast channel itself." };
    expect(textsFor({}, { lastBotRejection: refused }).bot.lastRejection).toContain("which is the broadcast channel itself");
    expect(textsFor({}, { lastBotRejection: { ...refused, at: "2026-08-01T00:00:00.000Z" } }).bot.lastRejection).toBe("");
  });
});

describe("wording fixes from the M69 review", () => {
  it("does not claim a split while no bot account is connected", () => {
    const texts = textsFor({ bot: { status: "not-connected", login: "", id: "" } });
    expect(texts.modeLine).toEqual({ tone: "warn", text: "Broadcast channel jimpanse247 · bot account not connected yet — connect it below." });
  });

  it("shows Off, not Active, for features the runtime switches turned off", () => {
    const texts = textsFor({}, { runtime: { chat: true, chatGames: true, alerts: false, cheerAlerts: true, channelPointsAlerts: true } });
    const follow = texts.bot.runs.find((entry) => entry.label === "Follow alerts")!;
    expect(follow).toMatchObject({ state: "off", available: false });
    expect(follow.statusText).toContain("Studio → Engagement");
    expect(texts.bot.runs.find((entry) => entry.label === "Chat rail")!.state).toBe("active");
  });

  it("drops a refused owner attempt once a later owner connection worked", () => {
    const refused = { at: "2026-09-28T10:00:00.000Z", message: "Twitch authorised 3jakec, but the broadcast channel is jimpanse247." };
    const owner = { status: "connected", login: "jimpanse247", hasToken: true, error: "" };
    expect(textsFor({ owner }, { lastOwnerRejection: refused, ownerConnectedAt: "2026-09-28T10:05:00.000Z" }).channel.owner!.lastRejection).toBe("");
    expect(textsFor({}, { lastOwnerRejection: refused }).channel.owner!.lastRejection).toContain("3jakec");
  });

  it("says where the bot account login comes from", () => {
    expect(textsFor({ expectedBotSetting: { managed: "", env: "3jakec" } }).bot.sourceText).toBe(
      "Bot account login from TWITCH_BOT_LOGIN — saving a value here overrides it."
    );
    expect(textsFor().bot.sourceText).toBe("No bot account login set — any account may connect as bot.");
  });
});
