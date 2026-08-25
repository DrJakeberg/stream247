import { describe, expect, it } from "vitest";
import {
  TWITCH_BROADCASTER_SLOT_SCOPES,
  evaluateBroadcasterConnectLogin,
  isBroadcastChannelSplit,
  isValidTwitchLogin,
  resolveBroadcastChannelLogin,
  resolveTwitchMetadataSyncGate
} from "@stream247/core";

const disconnectedBroadcaster = { status: "not-connected", broadcasterLogin: "", accessToken: "" };

describe("the broadcast channel setting", () => {
  it("accepts the Twitch login shape and nothing else", () => {
    expect(isValidTwitchLogin("jimpanse247")).toBe(true);
    expect(isValidTwitchLogin("  jimpanse247  ")).toBe(true);
    expect(isValidTwitchLogin("a_1B")).toBe(true);
    expect(isValidTwitchLogin("")).toBe(false);
    expect(isValidTwitchLogin("abc")).toBe(false);
    expect(isValidTwitchLogin("x".repeat(26))).toBe(false);
    expect(isValidTwitchLogin("evil.com/x")).toBe(false);
    expect(isValidTwitchLogin("name with space")).toBe(false);
  });

  it("falls back to the connected identity when empty — the rollback path", () => {
    expect(resolveBroadcastChannelLogin({ configuredLogin: "", identityLogin: "3jakec" })).toBe("3jakec");
  });

  it("treats an invalid configured value like an empty one", () => {
    // Joining a malformed channel or linking to it would be worse than the old single-account
    // behaviour, so a broken setting must not be able to make anything worse than before.
    expect(resolveBroadcastChannelLogin({ configuredLogin: "evil.com/x", identityLogin: "3jakec" })).toBe("3jakec");
  });

  it("uses the configured broadcast channel when one is set", () => {
    expect(resolveBroadcastChannelLogin({ configuredLogin: "jimpanse247", identityLogin: "3jakec" })).toBe(
      "jimpanse247"
    );
  });

  it("does not consider a case difference a split", () => {
    expect(isBroadcastChannelSplit({ configuredLogin: "Jimpanse247", identityLogin: "jimpanse247" })).toBe(false);
    expect(isBroadcastChannelSplit({ configuredLogin: "jimpanse247", identityLogin: "3jakec" })).toBe(true);
  });
});

describe("the metadata sync gate", () => {
  it("keeps writing through the identity when there is no split", () => {
    expect(
      resolveTwitchMetadataSyncGate({
        configuredLogin: "",
        identityLogin: "3jakec",
        broadcasterConnection: disconnectedBroadcaster
      })
    ).toEqual({ mode: "identity" });
  });

  it("waits instead of writing to the identity's channel when the split is configured", () => {
    // This is the acceptance-relevant behaviour: with only the moderator connected, no Helix
    // metadata write may target the moderator's own channel.
    expect(
      resolveTwitchMetadataSyncGate({
        configuredLogin: "jimpanse247",
        identityLogin: "3jakec",
        broadcasterConnection: disconnectedBroadcaster
      })
    ).toEqual({ mode: "waiting-for-broadcaster", broadcastChannelLogin: "jimpanse247" });
  });

  it("uses the broadcaster connection once it matches the broadcast channel", () => {
    expect(
      resolveTwitchMetadataSyncGate({
        configuredLogin: "jimpanse247",
        identityLogin: "3jakec",
        broadcasterConnection: { status: "connected", broadcasterLogin: "Jimpanse247", accessToken: "token" }
      })
    ).toEqual({ mode: "broadcaster", broadcastChannelLogin: "jimpanse247" });
  });

  it("keeps waiting when the broadcaster connection is for some other channel", () => {
    // Writing to a third channel would be wrong in exactly the way writing to the identity was.
    expect(
      resolveTwitchMetadataSyncGate({
        configuredLogin: "jimpanse247",
        identityLogin: "3jakec",
        broadcasterConnection: { status: "connected", broadcasterLogin: "someoneelse", accessToken: "token" }
      })
    ).toEqual({ mode: "waiting-for-broadcaster", broadcastChannelLogin: "jimpanse247" });
  });

  it("keeps waiting when the broadcaster connection has no usable token", () => {
    expect(
      resolveTwitchMetadataSyncGate({
        configuredLogin: "jimpanse247",
        identityLogin: "3jakec",
        broadcasterConnection: { status: "connected", broadcasterLogin: "jimpanse247", accessToken: "" }
      })
    ).toEqual({ mode: "waiting-for-broadcaster", broadcastChannelLogin: "jimpanse247" });
  });

  it("flips from waiting to broadcaster the moment the connect flow stores its record", () => {
    // The acceptance criterion "connecting later flips metadata sync on without a restart" in
    // gate terms: the same inputs, differing only by the record the OAuth callback writes.
    const channel = { configuredLogin: "jimpanse247", identityLogin: "3jakec" };

    expect(
      resolveTwitchMetadataSyncGate({ ...channel, broadcasterConnection: disconnectedBroadcaster }).mode
    ).toBe("waiting-for-broadcaster");
    expect(
      resolveTwitchMetadataSyncGate({
        ...channel,
        broadcasterConnection: { status: "connected", broadcasterLogin: "jimpanse247", accessToken: "stored-token" }
      }).mode
    ).toBe("broadcaster");
  });
});

describe("the broadcaster connect verdict", () => {
  const channel = { configuredLogin: "jimpanse247", identityLogin: "3jakec" };

  it("requests only the two metadata scopes for the slot", () => {
    expect(TWITCH_BROADCASTER_SLOT_SCOPES).toEqual(["channel:manage:broadcast", "channel:manage:schedule"]);
  });

  it("accepts the broadcast channel owner, ignoring case", () => {
    expect(evaluateBroadcasterConnectLogin({ ...channel, authenticatedLogin: "Jimpanse247" })).toEqual({
      ok: true,
      broadcastChannelLogin: "jimpanse247"
    });
  });

  it("rejects the identity account — the likeliest wrong sign-in — and names both accounts", () => {
    const verdict = evaluateBroadcasterConnectLogin({ ...channel, authenticatedLogin: "3jakec" });

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("wrong-account");
      expect(verdict.message).toContain("3jakec");
      expect(verdict.message).toContain("jimpanse247");
    }
  });

  it("rejects any third account the same way", () => {
    const verdict = evaluateBroadcasterConnectLogin({ ...channel, authenticatedLogin: "someoneelse" });

    expect(verdict).toMatchObject({ ok: false, reason: "wrong-account" });
  });

  it("rejects a connect without a configured split — there is no slot to fill", () => {
    expect(
      evaluateBroadcasterConnectLogin({ configuredLogin: "", identityLogin: "3jakec", authenticatedLogin: "3jakec" })
    ).toMatchObject({ ok: false, reason: "no-split" });
  });
});
