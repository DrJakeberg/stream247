import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORMAT_CANDIDATES,
  YOUTUBE_FORMAT_CANDIDATES,
  buildResolveArgs,
  isFormatUnavailableError,
  isYouTubeVideoUrl,
  orderCandidatesAfterPlayFailures,
  parseResolveOutput,
  resolveFormatCandidates
} from "../../apps/worker/src/playable-input";

const VIDEO_URL = "https://rr1---sn-abc.googlevideo.com/videoplayback?itag=299&mime=video%2Fmp4";
const AUDIO_URL = "https://rr1---sn-abc.googlevideo.com/videoplayback?itag=140&mime=audio%2Fmp4";
const COMBINED_URL = "https://rr2---sn-abc.googlevideo.com/videoplayback?itag=18";

// The five printed lines in RESOLVE_PRINT_TEMPLATES order, shaped exactly like yt-dlp 2026.08.19
// printed them on the DUT for j4YdbIbEc9E (URLs shortened).
function pairOutput(order: "video-first" | "audio-first" = "video-first"): string {
  const video = { id: "299", vcodec: "avc1.64002a", acodec: "none", url: VIDEO_URL };
  const audio = { id: "140", vcodec: "none", acodec: "mp4a.40.2", url: AUDIO_URL };
  const parts = order === "video-first" ? [video, audio] : [audio, video];
  return [
    parts.map((part) => part.id).join("+"),
    JSON.stringify(parts.map((part) => part.vcodec)),
    JSON.stringify(parts.map((part) => part.acodec)),
    JSON.stringify(parts.map((part) => part.url)),
    "NA"
  ].join("\n");
}

describe("which URLs are YouTube videos", () => {
  it.each([
    "https://www.youtube.com/watch?v=j4YdbIbEc9E",
    "https://youtube.com/watch?v=j4YdbIbEc9E",
    "https://m.youtube.com/watch?v=j4YdbIbEc9E",
    "https://music.youtube.com/watch?v=j4YdbIbEc9E",
    "https://youtu.be/j4YdbIbEc9E",
    "https://www.youtube.com/shorts/j4YdbIbEc9E",
    "https://www.youtube.com/live/j4YdbIbEc9E"
  ])("%s", (url) => {
    expect(isYouTubeVideoUrl(url)).toBe(true);
  });

  it.each([
    "https://www.twitch.tv/videos/2839507598",
    "https://www.youtube.com/@JimPanse/videos",
    "https://www.youtube.com/playlist?list=PL123",
    "https://youtu.be/",
    "https://notyoutube.com/watch?v=x",
    "/app/data/media/file.mp4",
    "not a url"
  ])("%s is not", (url) => {
    expect(isYouTubeVideoUrl(url)).toBe(false);
  });
});

describe("format candidates", () => {
  it("tries split H.264+AAC first, then any split tracks, then a combined file", () => {
    expect(resolveFormatCandidates("https://www.youtube.com/watch?v=abc").map((candidate) => candidate.id)).toEqual([
      "split-h264-aac",
      "split-any",
      "combined",
      "split-any-height"
    ]);
    expect(YOUTUBE_FORMAT_CANDIDATES[0]!.selector).toBe("bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]");
  });

  // Twitch VODs and everything else yt-dlp resolves keep the pre-2.1 behaviour.
  it("keeps --format best for everything that is not YouTube", () => {
    expect(resolveFormatCandidates("https://www.twitch.tv/videos/2839507598")).toEqual([...DEFAULT_FORMAT_CANDIDATES]);
  });

  it("takes an operator override, separated by |", () => {
    expect(resolveFormatCandidates("https://youtu.be/abc", " 18 | bv*+ba/b ")).toEqual([
      { id: "custom-1", selector: "18" },
      { id: "custom-2", selector: "bv*+ba/b" }
    ]);
    expect(resolveFormatCandidates("https://youtu.be/abc", "  |  ").map((candidate) => candidate.id)[0]).toBe("split-h264-aac");
  });

  it("skips candidates that failed at play time, and brings them all back when none is left", () => {
    const all = resolveFormatCandidates("https://youtu.be/abc");
    expect(orderCandidatesAfterPlayFailures(all, new Set(["split-h264-aac"])).map((candidate) => candidate.id)).toEqual([
      "split-any",
      "combined",
      "split-any-height"
    ]);
    expect(orderCandidatesAfterPlayFailures(all, new Set(all.map((candidate) => candidate.id)))).toEqual(all);
  });
});

describe("resolve arguments", () => {
  it("asks for one selector and prints the fields the parser reads", () => {
    const args = buildResolveArgs("https://youtu.be/abc", "bv*+ba");
    expect(args.slice(0, 4)).toEqual(["--no-warnings", "--no-playlist", "--format", "bv*+ba"]);
    expect(args.filter((arg) => arg === "--print")).toHaveLength(5);
    expect(args.at(-1)).toBe("https://youtu.be/abc");
    // The 2.0 call, which resolved 0 of 11 YouTube assets on 2026-09-28, must not come back.
    expect(args).not.toContain("--get-url");
  });
});

describe("parsing what yt-dlp printed", () => {
  it("splits a pair into a video input and an audio input", () => {
    expect(parseResolveOutput(pairOutput(), "split-h264-aac")).toEqual({
      input: VIDEO_URL,
      audioInput: AUDIO_URL,
      formatId: "299+140",
      candidateId: "split-h264-aac"
    });
  });

  // yt-dlp lists video first by convention only; the codec decides, not the position.
  it("splits by codec, not by position", () => {
    const parsed = parseResolveOutput(pairOutput("audio-first"), "split-any");
    expect(parsed.input).toBe(VIDEO_URL);
    expect(parsed.audioInput).toBe(AUDIO_URL);
  });

  it("reads a combined file as one input", () => {
    const stdout = ["18", "NA", "NA", "NA", COMBINED_URL].join("\n");
    expect(parseResolveOutput(stdout, "combined")).toEqual({
      input: COMBINED_URL,
      audioInput: "",
      formatId: "18",
      candidateId: "combined"
    });
  });

  it("tolerates CRLF and a stray line before the fields", () => {
    const stdout = `[info] something\r\n${pairOutput().replace(/\n/g, "\r\n")}\r\n`;
    expect(parseResolveOutput(stdout, "split-any").audioInput).toBe(AUDIO_URL);
  });

  it("refuses output that names no usable input instead of starting ffmpeg on NA", () => {
    expect(() => parseResolveOutput(["299", "NA", "NA", "NA", "NA"].join("\n"), "x")).toThrow(/without a URL/);
    expect(() => parseResolveOutput("299+140", "x")).toThrow(/expected fields/);
    const audioOnly = ["140", '["none"]', '["mp4a.40.2"]', `["${AUDIO_URL}"]`, "NA"].join("\n");
    expect(() => parseResolveOutput(audioOnly, "x")).toThrow(/without a usable video track/);
  });
});

describe("which resolve errors move on to the next candidate", () => {
  it("moves on only when the format is unavailable", () => {
    expect(
      isFormatUnavailableError(
        "ERROR: [youtube] j4YdbIbEc9E: Requested format is not available. Use --list-formats for a list of available formats"
      )
    ).toBe(true);
    expect(isFormatUnavailableError("ERROR: [youtube] abc: Video unavailable. This video is private")).toBe(false);
    expect(isFormatUnavailableError("Command timed out after 60000ms")).toBe(false);
  });
});
