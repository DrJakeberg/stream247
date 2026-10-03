import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * The owner password format: `salt:hash`, scrypt with a 16-byte hex salt and a 64-byte key.
 *
 * Lives here rather than in the web app since M91, because the container reset command
 * (`apps/worker/dist/reset-owner-password.js`) writes the same format the sign-in reads.
 */
export const MIN_OWNER_PASSWORD_LENGTH = 10;

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
