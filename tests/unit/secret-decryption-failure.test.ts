import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { __decryptSecretStringForTests, hasSecretDecryptionFailed, resetSecretDecryptionFailureForTests } from "@stream247/db";

/**
 * Finding [10] of the codebase review: a ciphertext that fails its auth tag — the shape of a lost
 * or rotated APP_SECRET — decrypted to "" with no signal anywhere, so the install read as
 * unconfigured and the 2FA gate, which checks `twoFactorSecret` for truthiness, was bypassed.
 * A well-formed ciphertext that will not open is a failure, not an empty value, and it is said.
 */
function encryptWith(secret: string, plaintext: string): string {
  // The same derivation the store uses (getEncryptionKey), so this seals exactly what it would.
  const key = scryptSync(secret, "stream247-managed-config", 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), payload.toString("base64url")].join(":");
}

describe("secret decryption failure", () => {
  const original = process.env.APP_SECRET;
  beforeEach(() => resetSecretDecryptionFailureForTests());
  afterEach(() => { process.env.APP_SECRET = original; resetSecretDecryptionFailureForTests(); });

  it("opens a ciphertext made under the current key without raising anything", () => {
    process.env.APP_SECRET = "key-A-key-A-key-A-key-A-key-A-key-A";
    const sealed = encryptWith(process.env.APP_SECRET, "hello");
    expect(__decryptSecretStringForTests(sealed)).toBe("hello");
    expect(hasSecretDecryptionFailed()).toBe(false);
  });

  it("treats a well-formed ciphertext that fails its auth tag as a failure, not an empty value", () => {
    const sealed = encryptWith("key-A-key-A-key-A-key-A-key-A-key-A", "hello");
    process.env.APP_SECRET = "key-B-key-B-key-B-key-B-key-B-key-B";
    expect(__decryptSecretStringForTests(sealed)).toBe("");
    expect(hasSecretDecryptionFailed()).toBe(true);
  });

  it("does not count an empty or malformed value as a key mismatch", () => {
    process.env.APP_SECRET = "key-A-key-A-key-A-key-A-key-A-key-A";
    expect(__decryptSecretStringForTests("")).toBe("");
    expect(__decryptSecretStringForTests("not-a-ciphertext")).toBe("");
    expect(hasSecretDecryptionFailed()).toBe(false);
  });
});
