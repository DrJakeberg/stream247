import { describe, expect, it } from "vitest";
import { buildTwitchWatchUrl } from "@/lib/watch-url";

describe("the watch link on the public channel page", () => {
  it("builds the channel address from the broadcaster login", () => {
    expect(buildTwitchWatchUrl("stream247")).toBe("https://twitch.tv/stream247");
    expect(buildTwitchWatchUrl("  stream247  ")).toBe("https://twitch.tv/stream247");
    expect(buildTwitchWatchUrl("a_1B")).toBe("https://twitch.tv/a_1B");
  });

  it("offers no link rather than a broken one", () => {
    expect(buildTwitchWatchUrl("")).toBe("");
    expect(buildTwitchWatchUrl(undefined)).toBe("");
    expect(buildTwitchWatchUrl("abc")).toBe("");
    expect(buildTwitchWatchUrl("x".repeat(26))).toBe("");
  });

  it("refuses anything that would leave the channel address", () => {
    // The value comes from stored configuration and ends up in an href, so the shapes that would
    // turn a channel link into something else are worth naming rather than assuming away.
    for (const login of [
      "evil.com/x",
      "name?next=/admin",
      "name#fragment",
      "../../admin",
      "name with space",
      "javascript:alert(1)",
      "//evil.com"
    ]) {
      expect(buildTwitchWatchUrl(login)).toBe("");
    }
  });
});
