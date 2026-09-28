// How a remote video page becomes something ffmpeg can open, and what happens when YouTube stops
// offering the format we asked for.
//
// Until 2.1 every page was resolved with `yt-dlp --format best --get-url`. `best` means ONE file that
// carries picture and sound. Measured on the DUT 2026-09-28: YouTube no longer offers such a file for
// these uploads ("YouTube is forcing SABR streaming for this client"); over the eleven assets of the
// YouTube source `best` resolved 0 of 11, while split tracks resolved 11 of 11 (all 299+140). So the
// resolver now walks an ordered list of candidates, and a YouTube programme may arrive as a PAIR:
// a video-only URL and an audio-only URL that playout opens as two ffmpeg inputs.
//
// Two fallbacks, on purpose separate:
//   - resolve time: yt-dlp says "Requested format is not available" -> try the next candidate at once;
//   - play time:    a candidate that resolved but failed to open (403, dead URL) is skipped for that
//                   asset for a while, so the next attempt starts one candidate further down.
// Any other resolve error (video removed, private, network) fails fast: every candidate would hit it.

export type PlayableFormatCandidate = {
  // Stable id for logs and the play-time skip list.
  id: string;
  // yt-dlp format selector.
  selector: string;
};

export type ResolvedPlayableMedia = {
  // What ffmpeg opens as input 0: the combined file, or the video track of a pair.
  input: string;
  // The audio track of a pair; "" when `input` carries its own sound.
  audioInput: string;
  // yt-dlp's format id, e.g. "299+140" or "18"; "" for inputs that were not resolved by yt-dlp.
  formatId: string;
  // Which candidate produced it; "" for inputs that were not resolved by yt-dlp.
  candidateId: string;
};

// H.264 + AAC first: cheapest to decode and closest to what the encoder writes. The height cap keeps
// the decode at or below the 1080p output. The combined file comes after the split candidates because
// YouTube offers it only intermittently (itag 18: 3 of 11 on 2026-09-28) and then only at 360p.
export const YOUTUBE_FORMAT_CANDIDATES: readonly PlayableFormatCandidate[] = [
  { id: "split-h264-aac", selector: "bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]" },
  { id: "split-any", selector: "bv*[height<=1080]+ba" },
  { id: "combined", selector: "b" },
  { id: "split-any-height", selector: "bv*+ba" }
];

// Everything that is not YouTube keeps the pre-2.1 behaviour: Twitch and the other sites yt-dlp
// resolves still offer a combined stream.
export const DEFAULT_FORMAT_CANDIDATES: readonly PlayableFormatCandidate[] = [{ id: "best", selector: "best" }];

// A candidate that failed at play time is skipped for this long, then tried again: YouTube assigns
// its experiments per request, so a format that failed an hour ago may well work now.
export const PLAY_FAILURE_SKIP_MS = 30 * 60_000;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

export function isYouTubeVideoUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") {
    return url.pathname.length > 1;
  }
  if (!YOUTUBE_HOSTS.has(host)) {
    return false;
  }
  return url.pathname === "/watch" || url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/live/");
}

/**
 * Split the override on "|" -- but only outside [...] filters and quotes, where yt-dlp's regex
 * filters (`[format_note~='(a|b)']`) use it. Found by the M68 review: a plain split tore such a
 * selector in two.
 */
export function splitFormatOverride(override: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (const char of override) {
    if (quote) {
      if (char === quote) {
        quote = "";
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth = Math.max(0, depth - 1);
    } else if (char === "|" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * The candidate list for a page URL. `override` is STREAM247_YOUTUBE_PLAYBACK_FORMATS: yt-dlp
 * selectors separated by "|" (outside brackets and quotes), tried in order. An empty or blank
 * override keeps the built-in list.
 */
export function resolveFormatCandidates(url: string, override = ""): PlayableFormatCandidate[] {
  if (!isYouTubeVideoUrl(url)) {
    return [...DEFAULT_FORMAT_CANDIDATES];
  }
  const custom = splitFormatOverride(override);
  if (custom.length === 0) {
    return [...YOUTUBE_FORMAT_CANDIDATES];
  }
  return custom.map((selector, index) => ({ id: `custom-${index + 1}`, selector }));
}

/**
 * Drop the candidates that failed at play time for this asset. If that would leave nothing, all
 * of them come back: trying a format that failed before beats giving the asset up.
 */
export function orderCandidatesAfterPlayFailures(
  candidates: readonly PlayableFormatCandidate[],
  failedCandidateIds: ReadonlySet<string>
): PlayableFormatCandidate[] {
  const remaining = candidates.filter((candidate) => !failedCandidateIds.has(candidate.id));
  return remaining.length > 0 ? remaining : [...candidates];
}

// Printed fields, one per line, in this order. `%(…)j` prints JSON, "NA" when the field is absent:
// a combined format has `url` and no `requested_formats`; a pair has it the other way round.
export const RESOLVE_PRINT_TEMPLATES = [
  "%(format_id)s",
  "%(requested_formats.:.vcodec)j",
  "%(requested_formats.:.acodec)j",
  "%(requested_formats.:.url)j",
  "%(url)s"
] as const;

export function buildResolveArgs(url: string, selector: string): string[] {
  const args = ["--no-warnings", "--no-playlist", "--format", selector];
  for (const template of RESOLVE_PRINT_TEMPLATES) {
    args.push("--print", template);
  }
  args.push(url);
  return args;
}

function parseJsonList(line: string | undefined): string[] | null {
  if (!line || line === "NA") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(line);
    return Array.isArray(parsed) ? parsed.map((entry) => (typeof entry === "string" ? entry : "")) : null;
  } catch {
    return null;
  }
}

function hasCodec(codec: string | undefined): boolean {
  return Boolean(codec) && codec !== "none";
}

function isHttpUrl(value: string | undefined): value is string {
  return Boolean(value) && (value!.startsWith("https://") || value!.startsWith("http://"));
}

/**
 * Turn the printed lines into ffmpeg inputs. A pair is split by codec, not by position: yt-dlp
 * lists video before audio today, but that is its convention, not a promise. Throws when the
 * output does not name a usable input, so the caller can move on instead of starting ffmpeg on "NA".
 */
export function parseResolveOutput(stdout: string, candidateId: string): ResolvedPlayableMedia {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  // yt-dlp prints the fields once per video; with --no-playlist that is once. Take the last block so
  // a stray line before it cannot shift the fields.
  const block = lines.slice(-RESOLVE_PRINT_TEMPLATES.length);
  if (block.length < RESOLVE_PRINT_TEMPLATES.length) {
    throw new Error(`yt-dlp printed ${block.length} of ${RESOLVE_PRINT_TEMPLATES.length} expected fields.`);
  }
  const [formatId, vcodecLine, acodecLine, urlsLine, urlLine] = block;
  const vcodecs = parseJsonList(vcodecLine);
  const acodecs = parseJsonList(acodecLine);
  const urls = parseJsonList(urlsLine);

  if (urls && urls.length > 0) {
    const parts = urls.map((url, index) => ({ url, vcodec: vcodecs?.[index], acodec: acodecs?.[index] }));
    const video = parts.find((part) => hasCodec(part.vcodec) && isHttpUrl(part.url));
    const audio = parts.find((part) => part !== video && hasCodec(part.acodec) && isHttpUrl(part.url));
    if (video && audio) {
      return { input: video.url, audioInput: hasCodec(video.acodec) ? "" : audio.url, formatId: formatId ?? "", candidateId };
    }
    if (video && hasCodec(video.acodec)) {
      return { input: video.url, audioInput: "", formatId: formatId ?? "", candidateId };
    }
    throw new Error(`yt-dlp returned format ${formatId ?? "?"} without a usable video track.`);
  }

  if (isHttpUrl(urlLine)) {
    return { input: urlLine, audioInput: "", formatId: formatId ?? "", candidateId };
  }
  throw new Error(`yt-dlp returned format ${formatId ?? "?"} without a URL.`);
}

export function isFormatUnavailableError(message: string): boolean {
  return /requested format is not available/i.test(message);
}

// A selector yt-dlp cannot parse (a typo in STREAM247_YOUTUBE_PLAYBACK_FORMATS). It concerns that
// candidate only, so the resolver skips it instead of failing the item.
export function isInvalidFormatSpecError(message: string): boolean {
  return /invalid (format|filter) specification/i.test(message);
}
