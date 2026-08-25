// The one place APP_SECRET is resolved.
//
// The secret signs session cookies and derives the key that encrypts managed credentials, so web,
// worker, playout, and uplink must all agree on it. Historically that meant a hand-written env
// value; since M52 a fresh install generates one on first boot and persists it on the shared data
// volume, where every service container can read the same file. The env variable keeps absolute
// priority — that is the rollback path for existing installs and the pin for operators who manage
// secrets externally.

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The published development fallback. This project is source-available, so this constant is public
 * knowledge: anyone holding it can forge a session cookie and decrypt managed credentials. It may
 * only ever be used outside production, and production must refuse it loudly.
 */
export const DEV_FALLBACK_APP_SECRET = "stream247-dev-secret";

export const MIN_APP_SECRET_LENGTH = 32;

// 48 random bytes come out as 64 base64url characters — comfortably above the minimum, and in an
// alphabet that survives .env files and shell quoting if an operator ever copies it out.
const GENERATED_SECRET_BYTES = 48;

// One filesystem read per process, not one per session check: the persisted secret cannot change
// while the process runs (rotation means restarting anyway), so caching by path is safe.
const persistedSecretByPath = new Map<string, string>();

type EnvLike = Record<string, string | undefined>;

/**
 * Where the generated secret lives. The media library root is the one volume every service
 * container already mounts, and it has precedent for app-internal dotfiles (the program feed lives
 * in a dot-directory there). APP_SECRET_FILE exists for deployments that prefer a dedicated
 * secrets volume — and for tests, which point it at a temp directory.
 */
export function getAppSecretFilePath(env: EnvLike = process.env): string {
  const explicit = (env.APP_SECRET_FILE || "").trim();
  if (explicit) {
    return explicit;
  }

  return path.join(env.MEDIA_LIBRARY_ROOT || "/app/data/media", ".stream247-app-secret");
}

function readPersistedSecret(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function assertPersistedSecretUsable(filePath: string, value: string): void {
  // A truncated or hand-mangled file must not be silently replaced: overwriting would rotate the
  // key underneath every live session and every encrypted credential. Surface it and let the
  // operator delete the file (accepting the rotation) or pin a value via env.
  if (value.length < MIN_APP_SECRET_LENGTH) {
    throw new Error(
      `Persisted app secret at ${filePath} is too short to trust. Delete the file to generate a new secret, or set APP_SECRET to take over.`
    );
  }
}

function readOrCreatePersistedSecret(filePath: string): string {
  const cached = persistedSecretByPath.get(filePath);
  if (cached) {
    return cached;
  }

  const existing = readPersistedSecret(filePath);
  if (existing !== null) {
    assertPersistedSecretUsable(filePath, existing);
    persistedSecretByPath.set(filePath, existing);
    return existing;
  }

  // First boot. Several containers start together and all reach this point; the exclusive-create
  // flag makes exactly one of them the writer, and everyone else adopts the winner's value.
  const candidate = randomBytes(GENERATED_SECRET_BYTES).toString("base64url");
  mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    writeFileSync(filePath, `${candidate}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const winner = readPersistedSecret(filePath) ?? "";
    assertPersistedSecretUsable(filePath, winner);
    persistedSecretByPath.set(filePath, winner);
    return winner;
  }

  persistedSecretByPath.set(filePath, candidate);
  return candidate;
}

/**
 * The effective app secret, in precedence order: env override, then the persisted generated
 * secret, then — outside production only — the development constant.
 */
export function resolveAppSecret(env: EnvLike = process.env): string {
  const configured = (env.APP_SECRET || "").trim();
  const production = env.NODE_ENV === "production";

  if (configured) {
    // The pre-M52 guarantee, unchanged: a value that is set but weak or publicly known is worse
    // than an absent one, because it looks like a secret while being guessable.
    if (production && (configured === DEV_FALLBACK_APP_SECRET || configured.length < MIN_APP_SECRET_LENGTH)) {
      throw new Error(
        `APP_SECRET must be a unique value of at least ${MIN_APP_SECRET_LENGTH} characters in production.`
      );
    }
    return configured;
  }

  try {
    return readOrCreatePersistedSecret(getAppSecretFilePath(env));
  } catch (error) {
    if (production) {
      // What must stay forbidden is the hardcoded fallback; a generated, persisted, strong secret
      // is fine. So production without env and without a working data volume cannot start.
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `APP_SECRET is not set and no secret could be persisted at ${getAppSecretFilePath(env)} (${message}). Refusing the development fallback in production.`
      );
    }

    // `pnpm dev` on a host without the data volume keeps its previous deterministic behaviour.
    return DEV_FALLBACK_APP_SECRET;
  }
}
