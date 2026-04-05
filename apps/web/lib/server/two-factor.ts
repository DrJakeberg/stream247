import { createHmac, randomBytes } from "node:crypto";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const totpPeriodSeconds = 30;
const totpDigits = 6;
const totpDriftSteps = [-1, 0, 1];

function normalizeBase32(value: string): string {
  return value.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += base32Alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

function decodeBase32(value: string): Buffer {
  const normalized = normalizeBase32(value);
  let bits = 0;
  let current = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = base32Alphabet.indexOf(char);
    if (index === -1) {
      continue;
    }

    current = (current << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function counterBuffer(counter: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  return buffer;
}

export function generateTwoFactorSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function buildTwoFactorOtpAuthUri(args: {
  issuer: string;
  accountName: string;
  secret: string;
}): string {
  return `otpauth://totp/${encodeURIComponent(args.issuer)}:${encodeURIComponent(args.accountName)}?secret=${encodeURIComponent(
    normalizeBase32(args.secret)
  )}&issuer=${encodeURIComponent(args.issuer)}&algorithm=SHA1&digits=${totpDigits}&period=${totpPeriodSeconds}`;
}

export function generateTotpCode(secret: string, now = Date.now()): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(now / 1000 / totpPeriodSeconds);
  const digest = createHmac("sha1", key).update(counterBuffer(counter)).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** totpDigits).padStart(totpDigits, "0");
}

export function verifyTotpCode(secret: string, code: string, now = Date.now()): boolean {
  const normalizedCode = code.replace(/\D/g, "");
  if (normalizedCode.length !== totpDigits) {
    return false;
  }

  return totpDriftSteps.some((offset) => generateTotpCode(secret, now + offset * totpPeriodSeconds * 1000) === normalizedCode);
}
