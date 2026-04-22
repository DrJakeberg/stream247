import { describe, expect, it } from "vitest";
import {
  buildAssetDisplayTitle,
  buildAssetMetadataTitlePrefix,
  getShowProfileCategoryOptions,
  isReplayTitlePrefix,
  normalizeHashtagChip,
  parseAssetHashtagsJson,
  REPLAY_TITLE_PREFIX
} from "../../apps/web/lib/asset-metadata";

describe("asset metadata helpers", () => {
  it("normalizes hashtag chips and deduplicates parsed hashtag JSON", () => {
    expect(normalizeHashtagChip(" #vod replay ")).toBe("vodreplay");
    expect(parseAssetHashtagsJson(JSON.stringify(["stream247", "#stream247", " vod replay ", ""]))).toEqual([
      "stream247",
      "vodreplay"
    ]);
  });

  it("detects replay prefixes and preserves non-replay legacy prefixes", () => {
    expect(isReplayTitlePrefix("Replay:")).toBe(true);
    expect(isReplayTitlePrefix(" replay ")).toBe(true);
    expect(isReplayTitlePrefix("LIVE")).toBe(false);
    expect(buildAssetMetadataTitlePrefix({ replayEnabled: true, existingPrefix: "LIVE" })).toBe(REPLAY_TITLE_PREFIX);
    expect(buildAssetMetadataTitlePrefix({ replayEnabled: false, existingPrefix: "Replay:" })).toBe("");
    expect(buildAssetMetadataTitlePrefix({ replayEnabled: false, existingPrefix: "LIVE" })).toBe("LIVE");
  });

  it("builds display titles and show-profile category options safely", () => {
    expect(
      buildAssetDisplayTitle({
        titlePrefix: "Replay:",
        title: "Runtime block"
      })
    ).toBe("Replay: Runtime block");

    expect(
      getShowProfileCategoryOptions([
        { categoryName: "Replay" },
        { categoryName: " Just Chatting " },
        { categoryName: "Replay" },
        { categoryName: "" }
      ])
    ).toEqual(["Just Chatting", "Replay"]);
  });
});
