import { describe, expect, it } from "vitest";
import { redactSecrets, redactSecretsDeep } from "@stream247/core";

/**
 * Measured on the running channel on 2026-09-01T23:31Z: an ffmpeg stderr line carrying the Twitch
 * stream key in its RTMP URL was written verbatim into the runtime log and into incidents.message,
 * where the GUI shows it. Whoever holds that key can broadcast on the channel. These are the forms
 * a secret takes on its way into text; every one of them must come out as "<redacted>" with the
 * host and the path shape still readable, so the operator can still see WHERE it failed.
 */
describe("redactSecrets", () => {
  it("hides the stream key in an RTMP publish URL but keeps the host and app", () => {
    expect(redactSecrets("[fifo @ 0x1] Error opening rtmp://live.twitch.tv/app/live_123456_AbCdEfGhIjKlMnOpQrStUv")).toBe(
      "[fifo @ 0x1] Error opening rtmp://live.twitch.tv/app/<redacted>"
    );
    expect(redactSecrets("rtmps://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop-qrst")).toBe(
      "rtmps://a.rtmp.youtube.com/live2/<redacted>"
    );
    expect(redactSecrets("rtmp://relay:1935/live/program")).toBe("rtmp://relay:1935/live/<redacted>");
  });

  it("hides key-shaped query parameters on any scheme, SRT included", () => {
    expect(redactSecrets("srt://ingest.example:9000?streamid=publish/abc123&passphrase=hunter2&latency=200")).toBe(
      "srt://ingest.example:9000?streamid=<redacted>&passphrase=<redacted>&latency=200"
    );
    expect(redactSecrets("https://api.example/v1?token=eyJhbGciOi.abc&Key=xyz")).toBe(
      "https://api.example/v1?token=<redacted>&Key=<redacted>"
    );
  });

  it("hides userinfo passwords, webhook tokens and bearer tokens", () => {
    expect(redactSecrets("https://user:s3cret@host.example/path")).toBe("https://user:<redacted>@host.example/path");
    expect(redactSecrets("https://discord.com/api/webhooks/123456789012345678/AbC-dEf_GhI")).toBe(
      "https://discord.com/api/webhooks/123456789012345678/<redacted>"
    );
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnop123 rejected")).toBe("Authorization: Bearer <redacted> rejected");
    expect(redactSecrets("OAuth abcdefghijklmnop123")).toBe("OAuth <redacted>");
  });

  it("hides a bare Twitch stream key even outside a URL", () => {
    expect(redactSecrets("key was live_123456_AbCdEfGhIjKlMnOpQrStUv today")).toBe("key was <redacted> today");
  });

  it("leaves ordinary text and ordinary URLs alone, and is idempotent", () => {
    const plain = [
      "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0",
      "/app/data/media/.stream247-program-feed/segment-1788276775553-7.ts",
      "[mpegts @ 0x777ac9783600] DTS 128090 < 1523283590 out of order",
      "https://example.com/videos/clip.mp4?t=42"
    ];
    for (const text of plain) {
      expect(redactSecrets(text)).toBe(text);
    }
    const once = redactSecrets("rtmp://live.twitch.tv/app/live_1_abcdefghijklmnopqrstuv");
    expect(redactSecrets(once)).toBe(once);
  });

  it("walks objects and arrays and leaves non-strings untouched", () => {
    expect(
      redactSecretsDeep({
        event: "uplink.process.start",
        outputUrl: "rtmp://live.twitch.tv/app/live_1_abcdefghijklmnopqrstuv",
        args: ["-i", "srt://h:1?passphrase=pw"],
        pid: 42,
        nested: { ok: true, note: null }
      })
    ).toEqual({
      event: "uplink.process.start",
      outputUrl: "rtmp://live.twitch.tv/app/<redacted>",
      args: ["-i", "srt://h:1?passphrase=<redacted>"],
      pid: 42,
      nested: { ok: true, note: null }
    });
  });
});
