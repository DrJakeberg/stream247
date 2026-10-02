import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATABASE_OUTAGE_EXIT_AFTER_MS, DatabaseOutageBudget } from "../../apps/worker/src/database-outage";

describe("DatabaseOutageBudget (M86)", () => {
  it("gives up after five minutes, the owner's bound", () => {
    expect(DATABASE_OUTAGE_EXIT_AFTER_MS).toBe(300_000);
  });

  it("keeps the process running below five minutes of unreachable cycles", () => {
    const budget = new DatabaseOutageBudget();
    const start = 1_000_000;

    // Playout and uplink cycle every 15 s: 20 cycles span 285 s.
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const verdict = budget.recordUnreachable(start + cycle * 15_000);
      expect(verdict.exit).toBe(false);
      expect(verdict.outageMs).toBe(cycle * 15_000);
    }
    expect(budget.recordUnreachable(start + 299_999)).toEqual({ outageMs: 299_999, exit: false });
  });

  it("exits at five minutes of consecutive unreachable cycles", () => {
    const budget = new DatabaseOutageBudget();
    budget.recordUnreachable(0);
    expect(budget.recordUnreachable(300_000)).toEqual({ outageMs: 300_000, exit: true });
    expect(budget.recordUnreachable(330_000).exit).toBe(true);
  });

  it("starts counting again after a cycle reached the database", () => {
    const budget = new DatabaseOutageBudget();
    budget.recordUnreachable(0);
    budget.recordUnreachable(240_000);
    budget.recordReachable();

    expect(budget.recordUnreachable(250_000)).toEqual({ outageMs: 0, exit: false });
    expect(budget.recordUnreachable(540_000).exit).toBe(false);
    expect(budget.recordUnreachable(550_000).exit).toBe(true);
  });

  it("restarts the streak when the clock steps backwards", () => {
    const budget = new DatabaseOutageBudget(1_000);
    budget.recordUnreachable(5_000);
    expect(budget.recordUnreachable(4_000)).toEqual({ outageMs: 0, exit: false });
    expect(budget.recordUnreachable(5_000)).toEqual({ outageMs: 1_000, exit: true });
  });
});

describe("runLoop failed-cycle branch (M86 source pin)", () => {
  const worker = readFileSync(path.resolve(import.meta.dirname, "../../apps/worker/src/index.ts"), "utf8");
  const start = worker.indexOf("async function runLoop(mode: RuntimeMode)");
  const body = worker.slice(start, worker.indexOf("\nconst command = process.argv[2]", start));
  const failedBranch = body.slice(body.indexOf('if (result.status === "failed")'));

  it("writes the incident and the alert inside try blocks", () => {
    expect(start).toBeGreaterThan(-1);
    expect(failedBranch).toMatch(/try \{\s*await upsertIncident\(/);
    expect(failedBranch).toMatch(/try \{\s*await sendAlert\(/);
    expect(failedBranch).not.toMatch(/\n {6}await upsertIncident\(/);
    expect(failedBranch).not.toMatch(/\n {6}await sendAlert\(/);
  });

  it("exits only on the outage budget's verdict", () => {
    const exits = failedBranch.slice(0, failedBranch.indexOf("await waitForNextLoop")).match(/process\.exit\(/g) ?? [];
    expect(exits).toHaveLength(1);
    expect(failedBranch).toMatch(/if \(verdict\.exit\) \{[\s\S]{0,300}?process\.exit\(1\)/);
    expect(body).toContain("databaseOutage.recordReachable()");
  });
});
