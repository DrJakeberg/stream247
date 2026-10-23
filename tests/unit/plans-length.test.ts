import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `PLANS.md` stays short enough to read in full, as `AGENTS.md` asks of every session.
 *
 * M84 cut it from about 5,000 lines to under 300; by M120 it had grown back to 907, mostly milestone
 * notes and DUT checks. M121 moved those to `planning/milestone-notes.md` and `planning/dut-checks.md`.
 * This keeps the M84 limit from drifting again: when it fails, move history out, do not raise the number.
 */
describe("PLANS.md length (M84, M121)", () => {
  it("is under 300 lines", () => {
    const lines = readFileSync(path.join(process.cwd(), "PLANS.md"), "utf8").split("\n").length - 1;
    expect(lines).toBeLessThan(300);
  });
});
