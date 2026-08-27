import { NextResponse } from "next/server";
import { buildRelayRollbackEnvLines } from "@stream247/core";
import { readRelayInternalKey } from "@stream247/db";
import { getAuthenticatedUser, requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent } from "@/lib/server/state";
import { consumeRateLimit, RELAY_ACCESS_REVEAL_RATE_LIMIT } from "@/lib/server/rate-limit";

// The emergency rollback lines for the programme path (M57 stage 2, Etappe E).
//
// Since the relay checks credentials, the two documented rollback paths only work when the
// configured URLs carry the internal relay key — and that key is generated into the database and
// deliberately never printed, which left the documented emergency path unusable. This route is the
// one place it comes back out, and everything about it is shaped by that:
//
//   * POST, not GET. Revealing a credential is an action an operator takes on purpose. A GET would
//     be prefetchable, linkable, bookmarkable and would land in every access log as a URL that
//     returns a secret.
//   * The value is never part of a page render. The settings page ships nothing but the button, so
//     the key is absent from the server-rendered HTML, from the wording baseline, and from any
//     listing — exactly like the source publish keys.
//   * Owner/admin only, checked before anything reads the key.
//   * One audit line per reveal, naming the actor and never the value.
//   * Rate limited per account, so a stolen session can neither mine it nor drown the audit trail.
//   * Every failure answers the same way and carries no part of the key or of the underlying error.

function unavailable(): Response {
  // One shape for "no key to give you", whether the store has none yet or could not be reached.
  // Nothing here narrows down which, and nothing here carries the key or a driver error string.
  return NextResponse.json(
    {
      ok: false,
      message: "The relay access lines are not available right now. Try again once the workspace database is reachable."
    },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}

export async function POST(): Promise<Response> {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  // The role check already established there is a session; this only names it for the trail.
  const user = await getAuthenticatedUser();
  const actor = user?.email || user?.id || "an unnamed session";

  const limit = consumeRateLimit(`relay-access-reveal:${user?.id || actor}`, RELAY_ACCESS_REVEAL_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, message: "Too many attempts. Wait a few minutes before showing these again." },
      {
        status: 429,
        headers: { "cache-control": "no-store", "retry-after": String(limit.retryAfterSeconds) }
      }
    );
  }

  let lines: string[] = [];
  try {
    lines = buildRelayRollbackEnvLines(await readRelayInternalKey());
  } catch {
    return unavailable();
  }

  if (lines.length === 0) {
    return unavailable();
  }

  // Written before the answer leaves, so a reveal is on the record even if the client never sees
  // the response.
  await appendAuditEvent(
    "relay.internal_key.revealed",
    `${actor} showed the relay access lines for the programme rollback.`
  );

  return NextResponse.json({ ok: true, lines }, { headers: { "cache-control": "no-store" } });
}
