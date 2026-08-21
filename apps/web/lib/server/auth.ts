import { scryptSync, timingSafeEqual, randomBytes, createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { buildWorkspaceHref } from "../workspace-navigation";
import { findUserById, readAppState, type UserRecord, type UserRole } from "./state";

const sessionCookieName = "stream247_session";
const twoFactorChallengeMaxAgeSeconds = 60 * 5;

// Sessions are stateless HMACs, so an unbounded lifetime means a leaked cookie is valid forever.
const sessionMaxAgeSeconds = (() => {
  const parsed = Number.parseInt(process.env.SESSION_MAX_AGE_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 24 * 60 * 60;
})();

const DEV_AUTH_SECRET = "stream247-dev-secret";
const MIN_AUTH_SECRET_LENGTH = 32;

function getAuthSecret(): string {
  const configured = process.env.APP_SECRET || "";

  // This project is source-available: the development fallback is a publicly known constant, so
  // silently using it in production lets anyone forge a session cookie for any user id. Fail loudly
  // instead of degrading to a value that only looks like a secret.
  if (process.env.NODE_ENV === "production") {
    if (!configured) {
      throw new Error("APP_SECRET must be set in production; refusing to sign sessions with the development fallback.");
    }

    if (configured === DEV_AUTH_SECRET || configured.length < MIN_AUTH_SECRET_LENGTH) {
      throw new Error(
        `APP_SECRET must be a unique value of at least ${MIN_AUTH_SECRET_LENGTH} characters in production.`
      );
    }
  }

  return configured || DEV_AUTH_SECRET;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [salt, storedHash] = encoded.split(":");

  if (!salt || !storedHash) {
    return false;
  }

  const derivedHash = scryptSync(password, salt, 64);
  const storedBuffer = Buffer.from(storedHash, "hex");

  if (derivedHash.length !== storedBuffer.length) {
    return false;
  }

  return timingSafeEqual(derivedHash, storedBuffer);
}

function signValue(value: string): string {
  return createHmac("sha256", getAuthSecret()).update(value).digest("hex");
}

export function buildSessionValue(userId: string): string {
  const payload = `${userId}:${Date.now()}`;
  return `${payload}:${signValue(payload)}`;
}

export function parseSessionValue(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const parts = value.split(":");
  if (parts.length < 3) {
    return null;
  }

  const signature = parts.pop();
  const payload = parts.join(":");

  if (!signature || signValue(payload) !== signature) {
    return null;
  }

  // The issue timestamp was always part of the signed payload but was never checked, so a session
  // cookie stayed valid indefinitely and could not be aged out.
  const issuedAt = Number(parts[parts.length - 1]);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > sessionMaxAgeSeconds * 1000) {
    return null;
  }

  return parts[0] ?? null;
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

export async function getAuthenticatedUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return parseSessionValue(cookieStore.get(sessionCookieName)?.value);
}

export async function getAuthenticatedUser(): Promise<UserRecord | null> {
  const userId = await getAuthenticatedUserId();
  const state = await readAppState();
  return findUserById(state, userId);
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

export async function setSessionCookie(userId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, buildSessionValue(userId), {
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
