import { describe, expect, it, vi } from "vitest";
import { createTwitchUserIdResolver } from "../../apps/worker/src/twitch-broadcast-channel";

function okUsersResponse(id: string) {
  return new Response(JSON.stringify({ data: [{ id }] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("resolving the broadcast channel's user id", () => {
  it("looks the id up by login and caches it for the process lifetime", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okUsersResponse("42"));
    const resolver = createTwitchUserIdResolver();

    await expect(
      resolver.resolve({ login: "jimpanse247", accessToken: "token", clientId: "client", fetchImpl })
    ).resolves.toBe("42");
    await expect(
      resolver.resolve({ login: "Jimpanse247", accessToken: "token", clientId: "client", fetchImpl })
    ).resolves.toBe("42");

    // The mapping cannot change while the login exists, so the second call — even differently
    // cased — must not spend another request on it.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.twitch.tv/helix/users?login=jimpanse247");
  });

  it("does not cache a failed lookup, so a fixed setting takes effect next cycle", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(okUsersResponse("42"));
    const resolver = createTwitchUserIdResolver();

    await expect(
      resolver.resolve({ login: "jimpanse247", accessToken: "token", clientId: "client", fetchImpl })
    ).rejects.toThrow("returned no user");
    await expect(
      resolver.resolve({ login: "jimpanse247", accessToken: "token", clientId: "client", fetchImpl })
    ).resolves.toBe("42");
  });

  it("reports an http failure with its status instead of guessing", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 503 }));
    const resolver = createTwitchUserIdResolver();

    await expect(
      resolver.resolve({ login: "jimpanse247", accessToken: "token", clientId: "client", fetchImpl })
    ).rejects.toThrow("failed with status 503");
  });

  it("refuses an empty login outright", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const resolver = createTwitchUserIdResolver();

    await expect(resolver.resolve({ login: "  ", accessToken: "token", clientId: "client", fetchImpl })).rejects.toThrow(
      "empty login"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
