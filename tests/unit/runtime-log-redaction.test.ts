import { afterEach, describe, expect, it, vi } from "vitest";
import { logRuntimeEvent } from "../../apps/worker/src/runtime-log";

/**
 * The runtime log is one of the two sinks a secret reached on 2026-09-01T23:31Z (the other is the
 * incident store). Redaction lives in the sink, not in the caller, so this asserts the sink: any
 * string anywhere in the payload comes out redacted, and the event name and non-strings survive.
 */
describe("logRuntimeEvent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never writes a stream key, wherever it sits in the payload", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logRuntimeEvent("uplink.ffmpeg.stderr", {
      message: "[fifo @ 0x1] Error opening rtmp://live.twitch.tv/app/live_123456_AbCdEfGhIjKlMnOpQrStUv",
      args: ["-f", "flv", "rtmps://a.rtmp.youtube.com/live2/abcd-efgh-ijkl"],
      attempt: 3
    });
    expect(info).toHaveBeenCalledTimes(1);
    const written = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(written.event).toBe("uplink.ffmpeg.stderr");
    expect(written.attempt).toBe(3);
    expect(written.message).toBe("[fifo @ 0x1] Error opening rtmp://live.twitch.tv/app/<redacted>");
    expect(written.args).toEqual(["-f", "flv", "rtmps://a.rtmp.youtube.com/live2/<redacted>"]);
    expect(JSON.stringify(written)).not.toMatch(/live_123456|abcd-efgh/);
  });
});
