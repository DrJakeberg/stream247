import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TWITCH_METADATA_WAITING_MESSAGE } from "@stream247/core";
import { getBroadcastChannelConnectionNotice } from "../../apps/web/components/twitch-connect-panel";

describe("the broadcast-channel entry in the connection panel", () => {
  it("shows nothing without a split — a second connection would only raise questions", () => {
    expect(getBroadcastChannelConnectionNotice({ mode: "identity", broadcastChannelLogin: "" })).toBeNull();
  });

  it("explains the waiting state fully, not just the button", () => {
    const notice = getBroadcastChannelConnectionNotice({
      mode: "waiting-for-broadcaster",
      broadcastChannelLogin: "jimpanse247"
    });

    expect(notice?.title).toBe("Connect broadcast channel");
    // The entry must keep carrying the whole story: which account has to do the connecting and
    // with which scopes. The connect button only helps someone signed in to Twitch as that
    // account — everyone else needs to know why their click will be rejected.
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

  it("wires the waiting state to the broadcaster connect route and the connected state to disconnect", () => {
    // Source contract in the style of oauth-render-safety: the affordances must point at the
    // broadcaster-slot routes, not at the identity connect — that link stores into the wrong slot.
    const source = readFileSync(
      path.resolve(import.meta.dirname, "../../apps/web/components/twitch-connect-panel.tsx"),
      "utf8"
    );

    expect(source).toContain("/api/integrations/twitch/connect-broadcaster");
    expect(source).toContain("/api/integrations/twitch/disconnect-broadcaster");
  });
});
