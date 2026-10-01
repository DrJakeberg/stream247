import { NextResponse } from "next/server";
import { buildRelayRollbackEnvLines } from "@stream247/core";
import { readRelayInternalKeyIfPresent } from "@stream247/db";
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
//   * Owner/admin only, checked before anything reads the key, and fail-closed on an unidentifiable
//     session — a reveal nobody can be named for is not a reveal worth performing.
//   * READ-ONLY. It uses readRelayInternalKeyIfPresent, never the self-generating reader: a reveal
//     that minted or replaced the key would hand out a value no already-running container holds,
//     and every relay read and publish would start failing until each one restarted — during the
//     very incident this button exists for.
//   * One audit line per reveal, naming the actor and never the value.
//   * Rate limited per account. That bounds repeated harvesting; it does NOT make the audit line
//     durable, because appendAuditEvent keeps only the newest 100 entries and roughly thirty other
//     routes write into the same ring unthrottled, so an actor can still push their own reveal out
//     of the trail with ordinary settings traffic. Fixing that means changing the audit mechanic
//     itself, which is out of scope here and stated rather than implied.
//   * Every failure answers the same way and carries no part of the key or of the underlying error.
//
// Accepted, and deliberately not fixed here: the 401/403 answers come from requireApiRoles and
// therefore carry no `cache-control` header of their own, and an operator with a second privileged
// account can get a second bucket. Both are hygiene, not the boundary this route defends.

function unavailable(): Response {
  // One shape for "no key to give you": none stored yet, one this APP_SECRET can no longer read, or
  // a store that could not be reached at all. Nothing here narrows down which, and nothing here
  // carries the key or a driver error string.
  return NextResponse.json(
    {
      ok: false,
      message:
        "No relay access lines are available. Either no key is stored yet, or it cannot be read with the current app secret."
    },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}

export async function POST(): Promise<Response> {
  const unauthorized = await requireApiRoles(["owner", "admin"]);
  if (unauthorized) {
    return unauthorized;
  }

  // The role check established there is a session; this reads it again to name the actor. If that
  // second read comes back empty — the account was deleted or demoted between the two — fail
  // closed. Carrying on would hand out the key against an "unnamed session" audit line and collapse
  // every such caller into one shared rate-limit bucket.
  const user = await getAuthenticatedUser();
  const actor = user?.email || user?.id || "";
  if (!user || !actor) {
    return NextResponse.json(
      { ok: false, message: "Insufficient permissions." },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }

  const limit = consumeRateLimit(`relay-access-reveal:${user.id || actor}`, RELAY_ACCESS_REVEAL_RATE_LIMIT);
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
    lines = buildRelayRollbackEnvLines(await readRelayInternalKeyIfPresent());
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
