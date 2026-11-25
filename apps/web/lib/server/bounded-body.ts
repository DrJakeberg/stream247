// Bounded request bodies for the routes an anonymous caller reaches before any session check (M127):
// sign-in, the one-time-code step, first-run setup, the relay's credential check and the EventSub
// callback. request.json() and request.text() buffer whatever arrives, and neither Next.js nor the
// bundled proxy caps a route handler's body, so one client could make the web process hold hundreds of
// megabytes per request before the rate limit, the state read or the signature check ever ran.
//
// The limits are fixed, not settings: every legitimate body on these routes is a few hundred bytes,
// and Twitch's EventSub notifications stay well below the larger one.

/** Sign-in, one-time code, first-run setup and relay auth: a few short fields each. */
export const PREAUTH_BODY_LIMIT_BYTES = 16 * 1024;

/** The EventSub callback: Twitch's notification envelope, with room for a cheer or redemption text. */
export const EVENTSUB_BODY_LIMIT_BYTES = 64 * 1024;

/**
 * The body as UTF-8 text, or null when it is larger than `maxBytes`. A declared Content-Length above
 * the limit is refused before a byte is read; otherwise the stream is counted as it arrives and
 * cancelled as soon as it passes the limit, so a chunked body without a length is cut off too.
 */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    return null;
  }
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // The same decoding request.text() applies: replacement characters for invalid bytes, BOM dropped.
  return new TextDecoder().decode(bytes);
}

/** The answer for an oversized body on routes whose refusals may say why. */
export function bodyTooLargeResponse(): Response {
  return new Response(JSON.stringify({ message: "The request is too large." }), {
    status: 413,
    headers: { "content-type": "application/json" }
  });
}
