import { describe, expect, it } from "vitest";
import { TWITCH_METADATA_WAITING_MESSAGE } from "@stream247/core";
import { getBroadcastChannelConnectionNotice } from "../../apps/web/components/twitch-connect-panel";

describe("the broadcast-channel entry in the connection panel", () => {
  it("shows nothing without a split — a second connection would only raise questions", () => {
    expect(getBroadcastChannelConnectionNotice({ mode: "identity", broadcastChannelLogin: "" })).toBeNull();
  });

  it("explains the waiting state fully, because the connect flow itself cannot run yet", () => {
    const notice = getBroadcastChannelConnectionNotice({
      mode: "waiting-for-broadcaster",
      broadcastChannelLogin: "jimpanse247"
    });

    expect(notice?.title).toBe("Connect broadcast channel");
    // The entry must carry the whole story: what is waiting, on which account, with which
    // scopes — the operator cannot click their way to that information while the broadcaster
    // account is inaccessible.
    expect(notice?.detail).toContain(TWITCH_METADATA_WAITING_MESSAGE);
    expect(notice?.detail).toContain("jimpanse247");
    expect(notice?.detail).toContain("channel:manage:broadcast");
    expect(notice?.detail).toContain("channel:manage:schedule");
  });

  it("names the connected broadcaster once metadata sync flows through it", () => {
    const notice = getBroadcastChannelConnectionNotice({
      mode: "broadcaster",
      broadcastChannelLogin: "jimpanse247"
    });

    expect(notice?.title).toBe("Broadcast channel connected");
    expect(notice?.detail).toContain("jimpanse247");
  });
});
