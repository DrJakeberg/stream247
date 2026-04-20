import { buildTwitchMetadataTitle, parseAssetHashtagsJson } from "../../apps/worker/src/twitch-metadata";
import { describe, expect, it } from "vitest";

describe("Twitch metadata title", () => {
  it("combines asset prefix, title, and parsed hashtags within Twitch's title limit", () => {
    const title = buildTwitchMetadataTitle(
      {
        titlePrefix: "LIVE",
        title: "Runtime program",
        hashtagsJson: JSON.stringify(["stream247", "#vod replay", ""])
      },
      "Fallback"
    );

    expect(title).toBe("LIVE Runtime program #stream247 #vodreplay");
  });

  it("ignores invalid hashtag JSON and truncates long titles at 140 characters", () => {
    const title = buildTwitchMetadataTitle(
      {
        titlePrefix: "Prefix",
        title: "x".repeat(200),
        hashtagsJson: "{"
      },
      "Fallback"
    );

    expect(title).toHaveLength(140);
    expect(title.startsWith("Prefix ")).toBe(true);
  });

  it("parses hashtag arrays into prefixed strings", () => {
    expect(parseAssetHashtagsJson(JSON.stringify(["alpha", "#beta", "two words"]))).toEqual(["#alpha", "#beta", "#twowords"]);
  });
});
