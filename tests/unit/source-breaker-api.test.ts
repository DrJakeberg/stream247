import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireApiRoles, mockAppendAuditEvent, mockReadAppState, mockCloseSourceBreakerRecord, mockResolveIncident } =
  vi.hoisted(() => ({
    mockRequireApiRoles: vi.fn(),
    mockAppendAuditEvent: vi.fn(),
    mockReadAppState: vi.fn(),
    mockCloseSourceBreakerRecord: vi.fn(),
    mockResolveIncident: vi.fn()
  }));

vi.mock("@/lib/server/auth", () => ({
  requireApiRoles: mockRequireApiRoles
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" }
      });
    }
  }
}));

vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent,
  closeSourceBreakerRecord: mockCloseSourceBreakerRecord,
  readAppState: mockReadAppState,
  resolveIncident: mockResolveIncident
}));

import { POST as closeBreaker } from "../../apps/web/app/api/sources/breaker/route";

const YOUTUBE = "source_jjwuu0f3";
const request = (body: unknown) =>
  new Request("http://localhost/api/sources/breaker", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }) as unknown as Parameters<typeof closeBreaker>[0];

// M75: the operator's "close breaker now" on the source page.
describe("close source breaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiRoles.mockResolvedValue(null);
    mockReadAppState.mockResolvedValue({ sources: [{ id: YOUTUBE, name: "YouTube channel" }] });
    mockCloseSourceBreakerRecord.mockResolvedValue({
      sourceId: YOUTUBE,
      state: "open",
      failedAssetIds: ["y1", "y2", "y3"],
      openedAt: "2026-09-28T10:02:00.000Z",
      cooldownSeconds: 1800,
      lastError: "Requested format is not available",
      updatedAt: "2026-09-28T10:02:00.000Z"
    });
  });

  it("is for owners and admins only: it puts a source back on air that the playout took off", async () => {
    mockRequireApiRoles.mockResolvedValue(new Response(null, { status: 403 }));
    const response = await closeBreaker(request({ id: YOUTUBE }));
    expect(mockRequireApiRoles).toHaveBeenCalledWith(["owner", "admin"]);
    expect(response.status).toBe(403);
    expect(mockCloseSourceBreakerRecord).not.toHaveBeenCalled();
  });

  it("closes an open breaker, resolves its incident and leaves an audit row", async () => {
    const response = await closeBreaker(request({ id: YOUTUBE }));
    expect(response.status).toBe(200);
    expect(mockCloseSourceBreakerRecord).toHaveBeenCalledWith(YOUTUBE, expect.any(String));
    expect(mockResolveIncident).toHaveBeenCalledWith(`playout.source-breaker.${YOUTUBE}`, expect.stringContaining("closed by an operator"));
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("source.breaker.closed", expect.stringContaining("2026-09-28T10:02:00.000Z"));
  });

  it("refuses what there is nothing to close, an unknown source and a missing id, writing nothing", async () => {
    mockCloseSourceBreakerRecord.mockResolvedValue(null);
    expect((await closeBreaker(request({ id: YOUTUBE }))).status).toBe(409);
    expect((await closeBreaker(request({ id: "source_gone" }))).status).toBe(404);
    expect((await closeBreaker(request({}))).status).toBe(400);
    expect(mockResolveIncident).not.toHaveBeenCalled();
    expect(mockAppendAuditEvent).not.toHaveBeenCalled();
  });
});

describe("source pages show the breaker", () => {
  const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

  it("renders the detail panel only while the breaker holds the source, with the close action for owner and admin", () => {
    const page = read("apps/web/app/(admin)/sources/[id]/page.tsx").replace(/\s+/g, " ");
    expect(page).toContain("const breaker = health.breaker;");
    expect(page).toContain("{breaker ? (");
    expect(page).toContain('const mayCloseBreaker = user?.role === "owner" || user?.role === "admin";');
    expect(page).toContain("{mayCloseBreaker ? <SourceBreakerCloseForm sourceId={source.id} /> : null}");
    for (const shown of ["breaker.openedAt", "breaker.retryAt", "breaker.lastError"]) {
      expect(page).toContain(shown);
    }
  });

  // M75 review: the Needs-attention panel sends the operator to the pools, which a hold does not need.
  it("draws the week lens with the breaker but leaves held pools out of Needs attention", () => {
    const page = read("apps/web/app/(admin)/schedule/page.tsx").replace(/\s+/g, " ");
    expect(page).toContain("<ProgramWeekLens assets={state.assets} days={materializedWeek} pools={state.pools} sourceGate={sourceGate} />");
    // Since M91 the list is computed by findUnplayableWeekBlocks, which readiness shares.
    expect(page).toContain("const emptyWeekBlocks = findUnplayableWeekBlocks(state, materializedWeek);");
    const onboarding = read("apps/web/lib/server/onboarding.ts").replace(/\s+/g, " ");
    const start = onboarding.indexOf("export function findUnplayableWeekBlocks(");
    const needsAttention = onboarding.slice(start, onboarding.indexOf("/** A source that can deliver", start));
    expect(start).toBeGreaterThan(-1);
    expect(needsAttention).toContain("return !poolHasPlayableAsset({ pool, assets: state.assets });");
    expect(needsAttention).not.toContain("sourceGate");
  });

  it("adds one line to the source list while the breaker holds the source", () => {
    const list = read("apps/web/components/admin-workspace-sections.tsx").replace(/\s+/g, " ");
    expect(list).toContain("{snapshot.breaker ? (");
    expect(list).toContain("formatSourceBreakerTime(snapshot.breaker.retryAt)");
    // The last error too, as the operations runbook says (found missing by the M75 review).
    expect(list).toContain("{snapshot.breaker.lastError ? ` Last error: ${snapshot.breaker.lastError}` : null}");
  });
});
