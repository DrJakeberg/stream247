import { describe, expect, it, vi } from "vitest";
import { fetchTwitchLiveStatus, parseTwitchLiveStatusPayload } from "../../apps/worker/src/twitch-live-status";

describe("twitch live status helpers", () => {
  it("parses live Helix stream payloads with viewer counts", () => {
    expect(
      parseTwitchLiveStatusPayload({
        data: [{ type: "live", viewer_count: 87, started_at: "2026-04-22T10:00:00.000Z" }]
      })
    ).toEqual({
      liveStatus: "live",
      viewerCount: 87,
      startedAt: "2026-04-22T10:00:00.000Z"
    });
  });

  it("parses empty Helix stream payloads as offline", () => {
    expect(
      parseTwitchLiveStatusPayload({
        data: []
      })
    ).toEqual({
      liveStatus: "offline",
      viewerCount: 0,
      startedAt: ""
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
        new Response(JSON.stringify({ data: [{ type: "live", viewer_count: 19, started_at: "2026-04-22T10:00:00.000Z" }] }), {
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
      viewerCount: 19,
      startedAt: "2026-04-22T10:00:00.000Z"
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://id.twitch.tv/oauth2/token");
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://api.twitch.tv/helix/streams?user_id=broadcaster-1");
  });

  it("looks the stream up by login when the broadcast channel is not the connected account", async () => {
    // With a broadcast-channel split the only identifier the workspace holds for the watched
    // channel is its login; the stored broadcaster id belongs to the moderator account, whose
    // stream status is not the one anybody asked about.
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "app-token" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    await expect(
      fetchTwitchLiveStatus({
        broadcasterLogin: "jimpanse247",
        clientId: "client-id",
        clientSecret: "client-secret",
        fetchImpl
      })
    ).resolves.toEqual({
      liveStatus: "offline",
      viewerCount: 0,
      startedAt: ""
    });

    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://api.twitch.tv/helix/streams?user_login=jimpanse247");
  });
});
