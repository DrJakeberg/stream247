import { promises as fs } from "node:fs";
import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEV_FALLBACK_APP_SECRET,
  getAppSecretFilePath,
  resolveAppSecret
} from "../../packages/db/src/app-secret.js";

// Each test gets its own directory, so the module-level cache keyed by file path can never leak a
// secret from one test into the next.
let dir = "";

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "stream247-app-secret-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function productionEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    APP_SECRET_FILE: path.join(dir, "app-secret"),
    ...overrides
  };
}

describe("getAppSecretFilePath", () => {
  it("defaults to a dotfile on the shared media data volume", () => {
    expect(getAppSecretFilePath({})).toBe("/app/data/media/.stream247-app-secret");
    expect(getAppSecretFilePath({ MEDIA_LIBRARY_ROOT: "/srv/data" })).toBe("/srv/data/.stream247-app-secret");
  });

  it("honours an explicit APP_SECRET_FILE override", () => {
    expect(getAppSecretFilePath({ APP_SECRET_FILE: "/run/secrets/app" })).toBe("/run/secrets/app");
  });
});

describe("resolveAppSecret", () => {
  it("prefers the environment secret and never touches the data directory", async () => {
    const env = productionEnv({ APP_SECRET: "operator-provided-secret-0123456789ab" });

    expect(resolveAppSecret(env)).toBe("operator-provided-secret-0123456789ab");
    await expect(fs.stat(env.APP_SECRET_FILE as string)).rejects.toThrow();
  });

  it("generates a strong secret on first boot and persists it with owner-only permissions", () => {
    const env = productionEnv();

    const secret = resolveAppSecret(env);

    expect(secret.length).toBeGreaterThanOrEqual(43);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    const filePath = env.APP_SECRET_FILE as string;
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    expect(resolveAppSecret(env)).toBe(secret);
  });

  it("reads the secret persisted by an earlier boot instead of generating a new one", async () => {
    const persisted = "persisted-by-a-previous-boot-0123456789ab";
    const env = productionEnv();
    await fs.writeFile(env.APP_SECRET_FILE as string, `${persisted}\n`, { mode: 0o600 });

    expect(resolveAppSecret(env)).toBe(persisted);
  });

  it("lets the environment take back over from a persisted secret", async () => {
    // The rollback path: an install that generated a secret can still pin one via env, and the
    // pinned value must win without the persisted file being consulted or rewritten.
    const env = productionEnv();
    await fs.writeFile(env.APP_SECRET_FILE as string, "persisted-by-a-previous-boot-0123456789ab\n", { mode: 0o600 });

    expect(resolveAppSecret({ ...env, APP_SECRET: "pinned-by-the-operator-0123456789abcdef" })).toBe(
      "pinned-by-the-operator-0123456789abcdef"
    );
  });

  it("still refuses a weak or published env secret in production", () => {
    // The pre-existing guarantee: a configured-but-weak value is worse than an absent one, because
    // it looks like a secret while being guessable. Generation must not soften this.
    expect(() => resolveAppSecret(productionEnv({ APP_SECRET: DEV_FALLBACK_APP_SECRET }))).toThrow(/production/);
    expect(() => resolveAppSecret(productionEnv({ APP_SECRET: "short" }))).toThrow(/at least 32/);
  });

  it("refuses to run production on the development fallback when persistence is unavailable", async () => {
    // A path through a regular file cannot be created by any uid, unlike a permission problem,
    // which root (the container user) would not notice.
    const blocker = path.join(dir, "blocker");
    await fs.writeFile(blocker, "not a directory");

    expect(() => resolveAppSecret(productionEnv({ APP_SECRET_FILE: path.join(blocker, "app-secret") }))).toThrow(
      /APP_SECRET/
    );
  });

  it("refuses to silently replace a corrupted persisted secret", async () => {
    // Overwriting would rotate the key underneath every session and encrypted credential; the
    // operator has to decide whether to delete the file or pin a value via env.
    const env = productionEnv();
    await fs.writeFile(env.APP_SECRET_FILE as string, "short\n", { mode: 0o600 });

    expect(() => resolveAppSecret(env)).toThrow(/too short/);
  });

  it("falls back to the development constant outside production when persistence is unavailable", async () => {
    // `pnpm dev` on a host without the data volume keeps its previous deterministic behaviour.
    const blocker = path.join(dir, "blocker");
    await fs.writeFile(blocker, "not a directory");

    expect(resolveAppSecret({ NODE_ENV: "test", APP_SECRET_FILE: path.join(blocker, "app-secret") })).toBe(
      DEV_FALLBACK_APP_SECRET
    );
  });
});
