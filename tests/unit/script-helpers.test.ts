import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The scripts share one copy of their helpers (M130).
 *
 * psql_query sat in four smoke scripts and the two env readers in two scripts, and the copies drifted. They
 * now live in scripts/lib/script-helpers.sh. This fails when a script under scripts/ defines one of them
 * itself again, so the next copy is caught before it can drift.
 */

const ROOT = process.cwd();
const LIB = "scripts/lib/script-helpers.sh";
const SHARED = ["psql_query", "read_env_value", "normalize_env_value"];
const USERS = [
  "scripts/broadcast-path-smoke.sh",
  "scripts/portainer-stack-check.sh",
  "scripts/queue-continuity-smoke.sh",
  "scripts/release-preflight.sh",
  "scripts/resume-smoke.sh",
  "scripts/runtime-parity-smoke.sh"
];

function shellScripts(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      return shellScripts(relative);
    }
    return entry.name.endsWith(".sh") ? [relative] : [];
  });
}

function definitions(source: string, name: string) {
  const pattern = new RegExp(`^\\s*(?:function\\s+${name}\\b|${name}\\s*\\(\\s*\\))`, "m");
  return pattern.test(source);
}

describe("shared script helpers", () => {
  it("the library defines every shared helper", () => {
    const lib = readFileSync(path.join(ROOT, LIB), "utf8");
    for (const name of SHARED) {
      expect(definitions(lib, name), name).toBe(true);
    }
  });

  it("no other script under scripts/ defines a shared helper itself", () => {
    const copies = shellScripts("scripts")
      .filter((file) => file !== LIB)
      .flatMap((file) => {
        const source = readFileSync(path.join(ROOT, file), "utf8");
        return SHARED.filter((name) => definitions(source, name)).map((name) => `${file}: ${name}`);
      });
    expect(copies).toEqual([]);
  });

  it("the detector sees a copy in either function syntax", () => {
    expect(definitions("x\npsql_query() {\n  :\n}\n", "psql_query")).toBe(true);
    expect(definitions("  function read_env_value {\n  :\n}\n", "read_env_value")).toBe(true);
    expect(definitions('value="$(normalize_env_value "$1")"\n', "normalize_env_value")).toBe(false);
  });

  it("every script that uses a shared helper sources the library", () => {
    for (const file of USERS) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source, file).toMatch(/^\. ".*\/lib\/script-helpers\.sh"$/m);
    }
  });

  it("the env readers work under plain sh, as release-preflight.sh runs them", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "stream247-script-helpers-"));
    try {
      const envFile = path.join(tempDir, "test.env");
      writeFileSync(envFile, "OTHER=1\n  APP_URL= \"https://example.test\" \nAPP_URL=second\n");
      const output = execFileSync(
        "sh",
        ["-c", '. "$1" && normalize_env_value "$(read_env_value APP_URL "$2")"', "sh", LIB, envFile],
        { cwd: ROOT, encoding: "utf8" }
      );
      expect(output).toBe("https://example.test");
      expect(() =>
        execFileSync("sh", ["-c", '. "$1" && read_env_value MISSING "$2"', "sh", LIB, envFile], {
          cwd: ROOT,
          stdio: "ignore"
        })
      ).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
