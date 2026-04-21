import { describe, expect, it, vi } from "vitest";
import { fetchTwitchLiveStatus, parseTwitchLiveStatusPayload } from "../../apps/worker/src/twitch-live-status";

describe("twitch live status helpers", () => {
  it("parses live Helix stream payloads with viewer counts", () => {
    expect(
      parseTwitchLiveStatusPayload({
        data: [{ type: "live", viewer_count: 87 }]
      })
    ).toEqual({
      liveStatus: "live",
      viewerCount: 87
    });
  });

  it("parses empty Helix stream payloads as offline", () => {
    expect(
      parseTwitchLiveStatusPayload({
        data: []
      })
    ).toEqual({
      liveStatus: "offline",
      viewerCount: 0
    });
  });

  it("requests an app token and then reads the broadcaster stream status", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "app-token" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ type: "live", viewer_count: 19 }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    await expect(
      fetchTwitchLiveStatus({
        broadcasterId: "broadcaster-1",
        clientId: "client-id",
        clientSecret: "client-secret",
        fetchImpl
      })
    ).resolves.toEqual({
      liveStatus: "live",
      viewerCount: 19
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://id.twitch.tv/oauth2/token");
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://api.twitch.tv/helix/streams?user_id=broadcaster-1");
  });
});
