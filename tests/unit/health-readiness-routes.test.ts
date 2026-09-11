import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const healthRoute = readFileSync(path.join(repoRoot, "apps/web/app/api/health/route.ts"), "utf8");
const readyRoute = readFileSync(path.join(repoRoot, "apps/web/app/api/ready/route.ts"), "utf8");
const composeFile = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8");
const smokeTest = readFileSync(path.join(repoRoot, "docker/smoke-test.sh"), "utf8");
const upgradeRehearsal = readFileSync(path.join(repoRoot, "scripts/upgrade-rehearsal.sh"), "utf8");

// Until 1.5.19 there was only /api/health and it returned 200 unconditionally, so a deployment with
// Postgres unreachable passed every gate. These tests pin the split so the two roles cannot quietly
// collapse back into one endpoint.

describe("liveness endpoint", () => {
  it("does not gate on any status, so a process that serves stays live", () => {
    expect(healthRoute).not.toContain("status: ");
    expect(healthRoute).not.toContain("503");
  });

  it("is what the container healthcheck and the image smoke test use", () => {
    // The smoke test boots the web image with no database at all; making this fail closed would
    // mean the image could never pass its own smoke test.
    expect(composeFile).toContain("http://127.0.0.1:3000/api/health");
    expect(smokeTest).toContain("/api/health");
    expect(smokeTest).not.toContain("/api/ready");
  });
});

describe("readiness endpoint", () => {
  it("fails closed when persistence is unreachable", () => {
    expect(readyRoute).toContain("503");
    expect(readyRoute).toContain('services.persistence === "ok"');
  });

  it("also requires an initialised workspace", () => {
    expect(readyRoute).toContain("readiness.initialized");
  });

  it("is what the deployment gate uses", () => {
    expect(upgradeRehearsal).toContain("/api/ready");
  });

  it("does not fail on a merely degraded broadcast", () => {
    // A degraded broadcast is something to alert on, not a reason to roll a deployment back.
    expect(readyRoute).not.toContain("broadcastReady");
  });
});
