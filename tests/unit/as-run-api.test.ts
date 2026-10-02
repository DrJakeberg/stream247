import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireApiRoles, mockListAsRunRecords, mockDbListAsRunRecords } = vi.hoisted(() => ({
  mockRequireApiRoles: vi.fn(),
  mockListAsRunRecords: vi.fn(),
  mockDbListAsRunRecords: vi.fn()
}));

// For the real state helper below: the database read is the only thing replaced.
vi.mock("@stream247/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stream247/db")>()),
  listAsRunRecords: mockDbListAsRunRecords
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
  listAsRunRecords: mockListAsRunRecords
}));

import { GET as readAsRun } from "../../apps/web/app/api/as-run/route";

const request = (query = "") => new Request(`http://localhost/api/as-run${query}`) as unknown as Parameters<typeof readAsRun>[0];

// M76: the as-run log over HTTP, for the runbook and for anyone scripting an incident analysis.
describe("GET /api/as-run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockRequireApiRoles.mockResolvedValue(null);
    mockListAsRunRecords.mockResolvedValue([]);
  });

  it("is for everyone who may see the live status, and reads nothing for anyone else", async () => {
    mockRequireApiRoles.mockResolvedValue(new Response(null, { status: 401 }));
    const response = await readAsRun(request());
    expect(mockRequireApiRoles).toHaveBeenCalledWith(["owner", "admin", "operator", "moderator", "viewer"]);
    expect(response.status).toBe(401);
    expect(mockListAsRunRecords).not.toHaveBeenCalled();
  });

  it("reads the last 24 hours by default, newest first as the store returns them", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-01T17:38:00.000Z"), toFake: ["Date"] });
    const response = await readAsRun(request());
    expect(mockListAsRunRecords).toHaveBeenCalledWith({
      fromIso: "2026-09-30T17:38:00.000Z",
      toIso: "2026-10-01T17:38:00.000Z",
      limit: 200
    });
    expect(await response.json()).toEqual({
      from: "2026-09-30T17:38:00.000Z",
      to: "2026-10-01T17:38:00.000Z",
      limit: 200,
      truncated: false,
      records: []
    });
  });

  it("answers what was on air at one moment, caps the rows and says when a page is full", async () => {
    mockListAsRunRecords.mockImplementation(async (window: { limit: number }) =>
      Array.from({ length: window.limit }, (_, index) => ({ id: `asrun_${index}` }))
    );
    const response = await readAsRun(request("?from=2026-10-01T19:38:00%2B02:00&to=2026-10-01T17:38:00Z&limit=99999"));
    expect(mockListAsRunRecords).toHaveBeenCalledWith({
      fromIso: "2026-10-01T17:38:00.000Z",
      toIso: "2026-10-01T17:38:00.000Z",
      limit: 1000
    });
    const body = (await response.json()) as { truncated: boolean; records: unknown[] };
    expect(body.truncated).toBe(true);
    expect(body.records).toHaveLength(1000);
  });

  it("refuses a window it cannot read, without touching the database", async () => {
    for (const query of ["?from=yesterday", "?to=2026-10-01T00:00:00Z&from=2026-10-02T00:00:00Z", "?limit=0", "?limit=abc"]) {
      const response = await readAsRun(request(query));
      expect(response.status).toBe(400);
    }
    expect(mockListAsRunRecords).not.toHaveBeenCalled();
  });
});

describe("the Live status tab shows the as-run log", () => {
  const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8").replace(/\s+/g, " ");

  it("reads the last 24 hours on the status tab", () => {
    const page = read("apps/web/app/(admin)/dashboard/page.tsx");
    expect(page).toContain("const asRunLog = await readRecentAsRunLog();");
    expect(page).toContain(
      "<AsRunLogPanel blocks={state.scheduleBlocks} limit={asRunLog.limit} nowMs={asRunLog.nowMs} pools={state.pools} records={asRunLog.records} sources={state.sources} timeZone={getWorkspaceTimeZone(state)} />"
    );
  });

  it("hands the tab null records instead of an error when the database does not answer", async () => {
    const { readRecentAsRunLog } = await vi.importActual<typeof import("../../apps/web/lib/server/state")>(
      "../../apps/web/lib/server/state"
    );
    vi.useFakeTimers({ now: Date.parse("2026-10-01T17:38:00.000Z"), toFake: ["Date"] });
    mockDbListAsRunRecords.mockResolvedValueOnce([{ id: "asrun_1" }]);
    expect(await readRecentAsRunLog()).toEqual({ records: [{ id: "asrun_1" }], limit: 200, nowMs: Date.parse("2026-10-01T17:38:00.000Z") });
    expect(mockDbListAsRunRecords).toHaveBeenCalledWith({
      fromIso: "2026-09-30T17:38:00.000Z",
      toIso: "2026-10-01T17:38:00.000Z",
      limit: 200
    });
    mockDbListAsRunRecords.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    expect(await readRecentAsRunLog()).toMatchObject({ records: null, limit: 200 });
    vi.useRealTimers();
  });

  // The live-status control budget (tests/e2e/control-density.spec.ts) does not move: a table, no controls.
  it("renders a read-only table with no control in it, and says so when it is empty or unreadable", () => {
    const panel = read("apps/web/components/as-run-log-panel.tsx");
    expect(panel).not.toMatch(/<(a|button|input|select|textarea|form)\b|role="button"|href=/);
    expect(panel).toContain('<table className="table">');
    for (const header of ["Start", "End", "What aired", "How", "Why it ended", "Planned / aired"]) {
      expect(panel).toContain(`<th>${header}</th>`);
    }
    expect(panel).toContain("{props.records === null ? (");
    expect(panel).toContain("Nothing aired in the last 24 hours");
  });
});
