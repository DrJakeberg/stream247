import { describe, expect, it } from "vitest";
import { resolveVodDownloadTimeoutMs, VOD_DOWNLOAD_TIMEOUT_CEILING_MS } from "../../apps/worker/src/vod-download-timeout";

/**
 * M62: a download may take at least as long as the content lasts. The fixed two-hour limit killed a
 * 7.2 GB download of a five-hour VOD at 11:17 on 2026-09-04 and left the .part frozen; the replay
 * then aired from Twitch directly. The configured value stays the floor for short content.
 */
describe("resolveVodDownloadTimeoutMs", () => {
  it("keeps the configured limit for content shorter than it", () => {
    expect(resolveVodDownloadTimeoutMs({ configuredMs: 7_200_000, durationSeconds: 2470 })).toBe(7_200_000);
  });
  it("gives a long VOD at least its own running time", () => {
    // 5 h 13 min of content: the limit follows the content, not the clock on the wall.
    expect(resolveVodDownloadTimeoutMs({ configuredMs: 7_200_000, durationSeconds: 18_780 })).toBe(18_780_000);
  });
  it("never exceeds the ceiling, whatever the duration says", () => {
    expect(resolveVodDownloadTimeoutMs({ configuredMs: 7_200_000, durationSeconds: 400_000 })).toBe(VOD_DOWNLOAD_TIMEOUT_CEILING_MS);
  });
  it("falls back to the configured limit when the duration is unknown or nonsense", () => {
    expect(resolveVodDownloadTimeoutMs({ configuredMs: 7_200_000, durationSeconds: 0 })).toBe(7_200_000);
    expect(resolveVodDownloadTimeoutMs({ configuredMs: 7_200_000, durationSeconds: Number.NaN })).toBe(7_200_000);
    expect(resolveVodDownloadTimeoutMs({ configuredMs: 7_200_000, durationSeconds: -5 })).toBe(7_200_000);
  });
});
