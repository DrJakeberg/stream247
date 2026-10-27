import { createHmac } from "node:crypto";
import { resolveAppSecret } from "@stream247/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { buildWorkspaceHref } from "../workspace-navigation";
import { findTeamGrantForTwitchUser, findUserById, readAppState, type AppState, type UserRecord, type UserRole } from "./state";

const sessionCookieName = "stream247_session";
const twoFactorChallengeMaxAgeSeconds = 60 * 5;

// Sessions are stateless HMACs, so an unbounded lifetime means a leaked cookie is valid forever.
const sessionMaxAgeSeconds = (() => {
  const parsed = Number.parseInt(process.env.SESSION_MAX_AGE_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 24 * 60 * 60;
})();

function getAuthSecret(): string {
  // Resolution lives in @stream247/db so sessions here and the managed-config encryption there
  // sign and encrypt with the same secret. The guarantees are unchanged in shape: production
  // refuses the publicly known development fallback and any weak env value. What changed with M52
  // is that an absent env value no longer refuses to start — a strong secret is generated on first
  // boot and persisted on the data volume, and env keeps priority as the rollback path.
  return resolveAppSecret();
}

// Shared with the container reset command since M91; the format is defined in @stream247/db.
export { hashPassword, verifyPassword } from "@stream247/db";

function signValue(value: string): string {
  return createHmac("sha256", getAuthSecret()).update(value).digest("hex");
}

/**
 * The password a session is bound to (M117): the local owner's stored hash, as the sign-in reads it, and
 * nothing for a Twitch sign-in. A session carries a stamp of it, so changing or resetting the password
 * ends every session signed in with the old one.
 */
export function sessionPasswordHash(user: Pick<UserRecord, "authProvider" | "passwordHash">, state: Pick<AppState, "owner">): string {
  return user.authProvider === "local" ? user.passwordHash || state.owner?.passwordHash || "" : "";
}

function passwordStamp(passwordHash: string): string {
  return signValue(`password:${passwordHash}`).slice(0, 16);
}

export function buildSessionValue(userId: string, passwordHash: string): string {
  const payload = `${userId}:${Date.now()}:${passwordStamp(passwordHash)}`;
  return `${payload}:${signValue(payload)}`;
}

export function parseSessionValue(value: string | undefined): { userId: string; passwordStamp: string } | null {
  if (!value) {
    return null;
  }

  // userId:issuedAt:passwordStamp:signature. A cookie from before M117 has no stamp and is refused,
  // so an update signs everyone out once.
  const parts = value.split(":");
  if (parts.length !== 4) {
    return null;
  }

  const signature = parts.pop();
  const payload = parts.join(":");

  if (!signature || signValue(payload) !== signature) {
    return null;
  }

  // The issue timestamp was always part of the signed payload but was never checked, so a session
  // cookie stayed valid indefinitely and could not be aged out.
  const [userId, issuedAtText, stamp] = parts;
  const issuedAt = Number(issuedAtText);
  if (!userId || !stamp || !Number.isFinite(issuedAt) || Date.now() - issuedAt > sessionMaxAgeSeconds * 1000) {
    return null;
  }

  return { userId, passwordStamp: stamp };
}

/**
 * The role a Twitch sign-in holds now (M125), from the current state and not from the role stored at
 * sign-in: owner while its Twitch id is the bound broadcaster, otherwise its current team grant, and
 * null without either. So lowering, removing or rebinding takes effect on the member's next request.
 */
export function currentTwitchRole(user: Pick<UserRecord, "twitchUserId" | "twitchLogin">, state: AppState): UserRole | null {
  const twitchUserId = user.twitchUserId ?? "";
  if (twitchUserId && state.twitch.broadcasterId !== "" && state.twitch.broadcasterId === twitchUserId) {
    return "owner";
  }
  return findTeamGrantForTwitchUser(state, twitchUserId, user.twitchLogin ?? "")?.role ?? null;
}

/** The user a session cookie names, or null when it is invalid, expired, signed in with an older password, or a Twitch sign-in that lost its access. */
export function resolveSessionUser(value: string | undefined, state: AppState): UserRecord | null {
  const session = parseSessionValue(value);
  if (!session) {
    return null;
  }
  const user = findUserById(state, session.userId);
  if (!user || passwordStamp(sessionPasswordHash(user, state)) !== session.passwordStamp) {
    return null;
  }
  if (user.authProvider !== "twitch") {
    return user;
  }
  const role = currentTwitchRole(user, state);
  return role ? { ...user, role } : null;
}

export function buildTwoFactorChallengeValue(userId: string): string {
  const payload = `${userId}:${Date.now()}`;
  return `${payload}:${signValue(payload)}`;
}

export function parseTwoFactorChallengeValue(value: string | undefined): { userId: string; issuedAt: number } | null {
  if (!value) {
    return null;
  }

  const parts = value.split(":");
  if (parts.length < 3) {
    return null;
  }

  const signature = parts.pop();
  const issuedAtText = parts.pop();
  const userId = parts.join(":");
  const payload = `${userId}:${issuedAtText}`;

  if (!signature || signValue(payload) !== signature) {
    return null;
  }

  const issuedAt = Number(issuedAtText);
  if (!userId || !Number.isFinite(issuedAt)) {
    return null;
  }

  if (Date.now() - issuedAt > twoFactorChallengeMaxAgeSeconds * 1000) {
    return null;
  }

  return {
    userId,
    issuedAt
  };
}

/** The session cookie's value from a Cookie header, for code that runs after the request scope (an open event stream). */
export function sessionCookieFromHeader(cookieHeader: string | null): string | undefined {
  for (const part of (cookieHeader ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === sessionCookieName) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

/** The user id of a well-signed, unexpired session cookie, without a database read; the password stamp is checked by getAuthenticatedUser. */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return parseSessionValue(cookieStore.get(sessionCookieName)?.value)?.userId ?? null;
}

export async function getAuthenticatedUser(): Promise<UserRecord | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(sessionCookieName)?.value;
  if (!parseSessionValue(value)) {
    return null;
  }
  return resolveSessionUser(value, await readAppState());
}

export async function requireAuthenticatedUser(): Promise<UserRecord> {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireRoles(roles: UserRole[]): Promise<UserRecord> {
  const user = await requireAuthenticatedUser();
  if (!roles.includes(user.role)) {
    redirect(buildWorkspaceHref("live"));
  }
  return user;
}

/** passwordHash is sessionPasswordHash(user, state), with the new hash right after a password change. */
export async function setSessionCookie(userId: string, passwordHash: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, buildSessionValue(userId, passwordHash), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(sessionCookieName);
}

export async function requireApiAuth(): Promise<NextResponse | null> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  return null;
}

export async function requireApiRoles(roles: UserRole[]): Promise<NextResponse | null> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  if (!roles.includes(user.role)) {
    return NextResponse.json({ message: "Insufficient permissions." }, { status: 403 });
  }

  return null;
}
