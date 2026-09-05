import { describe, expect, it } from "vitest";
import { createDefaultModerationConfig, escapeRegExp, resolveModeratorCheckIn } from "@stream247/core";

describe("escapeRegExp", () => {
  it("escapes every RegExp metacharacter", () => {
    const escaped = escapeRegExp(".*+?^${}()|[]\\");

    expect(() => new RegExp(escaped)).not.toThrow();
    expect(new RegExp(`^${escaped}$`).test(".*+?^${}()|[]\\")).toBe(true);
  });

  it("leaves ordinary text matchable", () => {
    expect(new RegExp(`^${escapeRegExp("checkin")}$`, "i").test("CHECKIN")).toBe(true);
  });

  it("makes a metacharacter literal instead of a pattern", () => {
    // Unescaped, "a.c" would match "abc"; escaped it must not.
    expect(new RegExp(`^${escapeRegExp("a.c")}$`).test("abc")).toBe(false);
    expect(new RegExp(`^${escapeRegExp("a.c")}$`).test("a.c")).toBe(true);
  });
});

describe("resolveModeratorCheckIn with operator-supplied commands", () => {
  const baseArgs = {
    actor: "mod_user",
    now: new Date("2026-08-18T12:00:00.000Z")
  };

  it("still matches a normal command", () => {
    const config = { ...createDefaultModerationConfig(), enabled: true, command: "checkin", requirePrefix: true };

    const result = resolveModeratorCheckIn({ ...baseArgs, input: "!checkin 30", config });

    expect(result).not.toBeNull();
  });

  it("does not throw on a command containing RegExp metacharacters", () => {
    // Before escaping, `new RegExp("^!check(in(?:\\s+(\\d+))?$")` threw inside the IRC data
    // handler, where nothing caught it, and the worker process died.
    for (const command of ["check(in", "check[in", "check*in", "check+in", "check\\in", "check?in"]) {
      const config = { ...createDefaultModerationConfig(), enabled: true, command, requirePrefix: true };

      expect(() => resolveModeratorCheckIn({ ...baseArgs, input: "!whatever", config })).not.toThrow();
    }
  });

  it("matches a command with metacharacters literally", () => {
    const config = { ...createDefaultModerationConfig(), enabled: true, command: "check(in", requirePrefix: true };

    const result = resolveModeratorCheckIn({ ...baseArgs, input: "!check(in 15", config });

    expect(result).not.toBeNull();
  });

  it("does not let a command act as a wildcard against arbitrary chat", () => {
    const config = { ...createDefaultModerationConfig(), enabled: true, command: ".*", requirePrefix: true };

    expect(resolveModeratorCheckIn({ ...baseArgs, input: "!anything at all", config })).toBeNull();
  });
});
