// Twitch emotes, from the IRC tag to the picture the broadcast draws.
//
// Twitch never sends emote *pictures*: a PRIVMSG carries the literal text a viewer typed plus an
// `emotes` tag naming which ranges of that text are emotes and which emote each range is. Without
// reading that tag there is no reliable way to tell "Kappa" the emote from "Kappa" the word, which
// is why the on-air chat panel drew emote codes as plain text.
//
// Everything here is pure and string-only. The picture itself is fetched by whatever rasterises
// the layout, from an unauthenticated CDN — no token, no scope, and in particular nothing that
// would need broadcaster rights.

/** One emote occurrence: which emote, and which code-point range of the message it covers. */
export type ChatEmoteOccurrence = {
  id: string;
  /** Inclusive, zero-based, counted in code points — Twitch's own convention. */
  start: number;
  end: number;
};

/** A message split for drawing: literal text, or a picture to place inline. */
export type ChatMessageSegment =
  | { kind: "text"; text: string }
  | { kind: "emote"; id: string; url: string };

/**
 * The CDN address of an emote picture.
 *
 * v2 URLs are public and unauthenticated: they need no client id, no token, and no relationship to
 * the channel — a moderator account can render exactly the same picture a broadcaster could. The
 * dark theme matches the overlay's own surfaces, and 1.0 is the 28px asset, which is already larger
 * than the 19px chat line the panel draws.
 */
export function chatEmoteImageUrl(id: string, scale: "1.0" | "2.0" | "3.0" = "1.0"): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/${scale}`;
}

// An emote id is an opaque token from Twitch. Real ids are numeric, but follower and modifier
// emotes use forms like "emotesv2_9f2a..." and "301234567_TK", so the guard is a character class
// rather than a number check — wide enough for what Twitch sends, narrow enough that nothing that
// ends up in a URL can carry a path separator or a scheme.
const EMOTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Reads the `emotes` IRC tag: `25:0-4,12-16/1902:6-10`.
 *
 * Returned in message order rather than tag order — the tag groups by emote, the renderer needs to
 * walk the message left to right. Malformed entries are dropped one by one: this parses text from
 * the network on the socket path, so a single bad range must cost that range and nothing else.
 */
export function parseTwitchEmoteTag(tag: string): ChatEmoteOccurrence[] {
  const occurrences: ChatEmoteOccurrence[] = [];

  for (const group of String(tag ?? "").split("/")) {
    const separator = group.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const id = group.slice(0, separator);
    if (!EMOTE_ID_PATTERN.test(id)) {
      continue;
    }

    for (const range of group.slice(separator + 1).split(",")) {
      const match = /^(\d{1,4})-(\d{1,4})$/.exec(range);
      if (!match) {
        continue;
      }
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (end < start) {
        continue;
      }
      occurrences.push({ id, start, end });
    }
  }

  return occurrences.sort((left, right) => left.start - right.start);
}

/**
 * Splits a message into the text and emote pieces the overlay draws.
 *
 * Positions are code-point indices, not UTF-16 indices: Twitch counts an astral character such as
 * an emoji as one position, and slicing the raw string would put every emote after it two
 * characters off. Overlapping or out-of-range occurrences are skipped rather than trusted, because
 * the tag and the text arrive as two independent fields of the same hostile line.
 *
 * Returns a single text segment when there are no emotes, so callers can always render from
 * segments alone.
 */
export function buildChatMessageSegments(
  message: string,
  occurrences: ChatEmoteOccurrence[]
): ChatMessageSegment[] {
  const points = [...String(message ?? "")];
  const segments: ChatMessageSegment[] = [];
  let cursor = 0;

  for (const occurrence of occurrences) {
    if (occurrence.start < cursor || occurrence.end >= points.length) {
      continue;
    }
    if (occurrence.start > cursor) {
      segments.push({ kind: "text", text: points.slice(cursor, occurrence.start).join("") });
    }
    segments.push({ kind: "emote", id: occurrence.id, url: chatEmoteImageUrl(occurrence.id) });
    cursor = occurrence.end + 1;
  }

  if (cursor < points.length) {
    segments.push({ kind: "text", text: points.slice(cursor).join("") });
  }

  return segments;
}
