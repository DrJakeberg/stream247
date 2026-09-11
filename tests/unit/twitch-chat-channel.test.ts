import { describe, expect, it } from "vitest";
import { resolveChatConnectionTarget } from "../../apps/worker/src/twitch-engagement";

describe("which chat room the bridge joins", () => {
  it("joins the identity's own room when no broadcast channel is configured", () => {
    expect(resolveChatConnectionTarget({ identityLogin: "3jakec", configuredBroadcastLogin: "" })).toEqual({
      nick: "3jakec",
      channel: "3jakec"
    });
  });

  it("joins the broadcast channel while still authenticating as the identity", () => {
    // The stream key sends video to jimpanse247; the connected account is a moderator there. The
    // bridge must sit in the room the audience is in, but Twitch rejects a connection whose NICK
    // does not match the token's account.
    expect(
      resolveChatConnectionTarget({ identityLogin: "3jakec", configuredBroadcastLogin: "jimpanse247" })
    ).toEqual({
      nick: "3jakec",
      channel: "jimpanse247"
    });
  });

  it("lowercases both, because IRC channel names are lowercase", () => {
    expect(
      resolveChatConnectionTarget({ identityLogin: "ThreeJakeC", configuredBroadcastLogin: "Jimpanse247" })
    ).toEqual({
      nick: "threejakec",
      channel: "jimpanse247"
    });
  });

  it("ignores a malformed configured channel rather than joining a broken room", () => {
    expect(
      resolveChatConnectionTarget({ identityLogin: "3jakec", configuredBroadcastLogin: "evil.com/x" })
    ).toEqual({
      nick: "3jakec",
      channel: "3jakec"
    });
  });
});
