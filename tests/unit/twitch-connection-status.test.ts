import { describe, expect, it } from "vitest";
import { describeTwitchConnection } from "../../apps/web/components/twitch-connection-status";

const connected = {
  status: "connected",
  accessToken: "identity-token",
  broadcasterLogin: "jimpanse247",
  broadcasterId: "3141"
};

/**
 * What the Twitch card says, in words rather than in status codes.
 *
 * The card used to print the stored status value straight onto the page, so an operator whose
 * connection had been wrongly marked broken read the single word "error" and a raw upstream
 * message. Neither told them the thing that actually mattered: that three features had gone quiet
 * behind that one word, and whether they had to do anything about it.
 */
describe("describing the Twitch connection", () => {
  it("names the account when the connection is working", () => {
    expect(describeTwitchConnection(connected)).toEqual({
      label: "Connected",
      detail: "Broadcaster jimpanse247",
      consequence: ""
    });
  });

  it("falls back to the account number when no login was stored", () => {
    expect(describeTwitchConnection({ ...connected, broadcasterLogin: "" }).detail).toBe("Broadcaster 3141");
  });

  it("says the connection is coming back when the stored access is still there", () => {
    // The measured shape: status error, token fine. The operator needs to know it repairs itself
    // so they do not go hunting for a fix that is already running.
    const described = describeTwitchConnection({ ...connected, status: "error" });

    expect(described.label).toBe("Recovering");
    expect(described.detail).toContain("still on file");
    expect(described.detail).toContain("on its own");
    // The whole point of the incident: the features that go quiet were never named anywhere.
    expect(described.consequence).toContain("emote-only");
  });

  it("asks for a reconnect when the sign-in stored nothing to recover from", () => {
    // No token means no measurement can save this one, so the card has to ask for the one action
    // that will.
    const described = describeTwitchConnection({ ...connected, status: "error", accessToken: "" });

    expect(described.label).toBe("Not connected");
    expect(described.detail).toContain("Connect the account again");
    expect(described.consequence).toContain("emote-only");
  });

  it("stays quiet about consequences when nothing was ever connected", () => {
    // A workspace that has not linked Twitch yet has not lost anything, so listing what is
    // paused would read as a fault report for a setup step nobody has reached.
    expect(describeTwitchConnection({ status: "not-connected", accessToken: "", broadcasterLogin: "", broadcasterId: "" })).toEqual({
      label: "Not connected",
      detail: "No Twitch account is linked yet.",
      consequence: ""
    });
  });

  it("never puts a stored status value on the page", () => {
    // "not-connected" would trip the wording gate the moment it reached a recorded surface, and
    // "error" told an operator nothing. Neither may leak through this helper.
    const surfaces = ["connected", "error", "not-connected", "something-new"].flatMap((status) => {
      const described = describeTwitchConnection({ ...connected, status });
      return [described.label, described.detail, described.consequence];
    });

    for (const text of surfaces) {
      expect(text).not.toContain("not-connected");
      expect(text.toLowerCase()).not.toMatch(/\berror\b/);
    }
  });
});
