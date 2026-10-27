import { beforeEach, describe, expect, it, vi } from "vitest";

// M125: the readiness projection (audit 3.2) and removing a team grant (audit 3.1).

const { mockReadAppState, mockDeleteGrant, mockAppendAuditEvent, mockRequireApiRoles } = vi.hoisted(() => ({
  mockReadAppState: vi.fn(),
  mockDeleteGrant: vi.fn(),
  mockAppendAuditEvent: vi.fn(),
  mockRequireApiRoles: vi.fn()
}));

vi.mock("@stream247/db", () => ({ getDatabaseHealth: async () => "ok" }));
vi.mock("@/lib/server/sse", () => ({ getActiveSseConnectionCount: () => 0 }));
vi.mock("@/lib/server/state", () => ({
  readAppState: mockReadAppState,
  deleteTeamAccessGrantRecord: mockDeleteGrant,
  appendAuditEvent: mockAppendAuditEvent,
  upsertTeamAccessGrantRecord: vi.fn()
}));
vi.mock("@/lib/server/auth", () => ({
  requireApiRoles: mockRequireApiRoles,
  getAuthenticatedUser: async () => ({ id: "user_owner" })
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  }
}));

import { getSystemReadiness } from "../../apps/web/lib/server/readiness";
import { DELETE as revokeGrant } from "../../apps/web/app/api/team/access/route";

const destination = {
  id: "dest-1",
  name: "Primary",
  provider: "custom-rtmp",
  role: "primary",
  priority: 0,
  enabled: true,
  status: "ready",
  streamKeyPresent: true,
  streamKeySource: "managed",
  rtmpUrl: "rtmp://user:SECRET-PASS@ingest.example.invalid/live",
  notes: "operator note with a password",
  lastError: "last error text",
  failureCount: 3
};

describe("public readiness carries status fields only (audit 3.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never returns the ingest URL, notes, error text or the feed path", async () => {
    mockReadAppState.mockResolvedValue({
      initialized: true,
      owner: {},
      destinations: [destination],
      assets: [],
      twitch: { status: "connected", lastMetadataSyncAt: "", lastScheduleSyncAt: "" },
      playout: { status: "idle", programFeedPlaylistPath: "/app/data/media/.stream247-program-feed/live.m3u8" }
    });
    const readiness = await getSystemReadiness();
    expect(readiness.destination).toEqual({ provider: "custom-rtmp", role: "primary", priority: 0, status: "ready", streamKeyPresent: true });
    const body = JSON.stringify(readiness);
    for (const secret of ["SECRET-PASS", "operator note", "last error text", "live.m3u8", "streamKeySource"]) {
      expect(body).not.toContain(secret);
    }
  });

  it("answers a failed state read with a fixed message, not the database's", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockReadAppState.mockRejectedValue(new Error('password authentication failed for user "stream247" at db.internal:5432'));
    const readiness = await getSystemReadiness();
    expect(JSON.stringify(readiness)).not.toContain("db.internal");
    expect((readiness as { error?: string }).error).toBe("Readiness could not be read. The web container log has the cause.");
    consoleError.mockRestore();
  });
});

describe("removing a team grant (audit 3.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiRoles.mockResolvedValue(null);
    mockReadAppState.mockResolvedValue({
      teamAccessGrants: [{ id: "grant_a", twitchLogin: "member", twitchUserId: "tw-1", role: "admin", createdAt: "", createdBy: "" }]
    });
  });

  function request(body: unknown) {
    return new Request("http://localhost/api/team/access", { method: "DELETE", body: JSON.stringify(body) }) as never;
  }

  it("deletes the grant and writes an audit line", async () => {
    const response = await revokeGrant(request({ id: "grant_a" }));
    expect(response.status).toBe(200);
    expect(mockDeleteGrant).toHaveBeenCalledWith("grant_a");
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("team.revoke", "Removed admin access from Twitch user member.");
  });

  it("answers 404 for an unknown grant and changes nothing", async () => {
    expect((await revokeGrant(request({ id: "grant_x" }))).status).toBe(404);
    expect(mockDeleteGrant).not.toHaveBeenCalled();
  });

  it("is for owner and admin only", async () => {
    mockRequireApiRoles.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await revokeGrant(request({ id: "grant_a" }))).status).toBe(403);
    expect(mockRequireApiRoles).toHaveBeenCalledWith(["owner", "admin"]);
    expect(mockDeleteGrant).not.toHaveBeenCalled();
  });
});
