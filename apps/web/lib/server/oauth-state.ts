// Single-use OAuth state tokens.
//
// Both Twitch callbacks used to accept any `code` presented to them, with `state` hardcoded to the
// literal flow name ("broadcaster-connect" / "team-login") and never read back. That made the
// broadcaster-connect callback a full workspace takeover: an attacker authorises their own Twitch
// account against the (publicly discoverable) client_id, hands the resulting code to the callback,
// and the server overwrites the workspace's broadcasterId with theirs. Because SSO grants the
// "owner" role to whoever matches state.twitch.broadcasterId, they can then log in as owner.
//
// A state token here is random, single-use, flow-scoped, short-lived, and stored in an HttpOnly
// cookie the attacker cannot set cross-site. A callback that cannot match the cookie is rejected
// before any token exchange happens.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export type OAuthFlowKind = "broadcaster-connect" | "team-login";

const COOKIE_PREFIX = "s247_oauth_state_";
const STATE_TTL_SECONDS = 10 * 60;

function cookieNameFor(kind: OAuthFlowKind): string {
  return `${COOKIE_PREFIX}${kind === "team-login" ? "login" : "connect"}`;
}

export function createOAuthStateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The slice of the Next.js cookie store this module needs. Keeping it explicit lets the state
 * machine be exercised without a request scope.
 */
export type OAuthCookieStore = {
  get: (name: string) => { value: string } | undefined;
  set: (name: string, value: string, options: Record<string, unknown>) => void;
  delete: (name: string) => void;
};

/**
 * Issue a state token and bind it to the caller's browser via an HttpOnly cookie.
 */
export async function issueOAuthState(kind: OAuthFlowKind): Promise<string> {
  return issueOAuthStateIn((await cookies()) as unknown as OAuthCookieStore, kind);
}

export function issueOAuthStateIn(store: OAuthCookieStore, kind: OAuthFlowKind): string {
  const token = createOAuthStateToken();

  store.set(cookieNameFor(kind), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS
  });

  return token;
}

export type OAuthStateVerdict =
  | { ok: true }
  | { ok: false; reason: "missing-state" | "missing-cookie" | "mismatch" };

/**
 * Compare a callback's `state` against the cookie issued when the flow started, then clear the
 * cookie so the token cannot be replayed.
 */
export async function consumeOAuthState(kind: OAuthFlowKind, presented: string | null): Promise<OAuthStateVerdict> {
  return consumeOAuthStateIn((await cookies()) as unknown as OAuthCookieStore, kind, presented);
}

export function consumeOAuthStateIn(
  store: OAuthCookieStore,
  kind: OAuthFlowKind,
  presented: string | null
): OAuthStateVerdict {
  const cookieName = cookieNameFor(kind);
  const expected = store.get(cookieName)?.value ?? "";

  // Always clear, so a failed attempt cannot be retried against the same cookie.
  store.delete(cookieName);

  if (!presented) {
    return { ok: false, reason: "missing-state" };
  }

  if (!expected) {
    return { ok: false, reason: "missing-cookie" };
  }

  return matchesOAuthState(expected, presented) ? { ok: true } : { ok: false, reason: "mismatch" };
}

/**
 * Constant-time comparison of two state tokens. Exported for testing.
 */
export function matchesOAuthState(expected: string, presented: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const presentedBuffer = Buffer.from(presented, "utf8");

  if (expectedBuffer.length !== presentedBuffer.length || expectedBuffer.length === 0) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, presentedBuffer);
}

export function describeOAuthStateFailure(reason: Exclude<OAuthStateVerdict, { ok: true }>["reason"]): string {
  if (reason === "missing-state") {
    return "Twitch callback did not include a state parameter; the request did not originate from this workspace.";
  }

  if (reason === "missing-cookie") {
    return "Twitch callback arrived without a matching state cookie; start the connection from the workspace and complete it in the same browser within 10 minutes.";
  }

  return "Twitch callback state did not match the state issued by this workspace; the request was rejected.";
}
