import { beforeEach, describe, expect, it, vi } from "vitest";

// M73: a pool edit saves settings only. The route used to spread the pool it had read into the write,
// cursor included, so an edit made while the worker started an item rolled the pool back to the item
// before (updatePoolRecord now ignores those fields too; db-roundtrip proves that against Postgres).
const { mockRequireApiRoles, mockAppendAuditEvent, mockReadAppState, mockUpdatePoolRecord, mockCreatePoolRecord } = vi.hoisted(
  () => ({
    mockRequireApiRoles: vi.fn(),
    mockAppendAuditEvent: vi.fn(),
    mockReadAppState: vi.fn(),
    mockUpdatePoolRecord: vi.fn(),
    mockCreatePoolRecord: vi.fn()
  })
);

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
  createPoolRecord: mockCreatePoolRecord,
  deletePoolRecord: vi.fn(),
  readAppState: mockReadAppState,
  updatePoolRecord: mockUpdatePoolRecord
}));

import { POST, PUT } from "../../apps/web/app/api/pools/route";

function request(method: "POST" | "PUT", body: Record<string, unknown>) {
  return new Request("http://localhost/api/pools", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }) as never;
}

describe("pools API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiRoles.mockResolvedValue(null);
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockUpdatePoolRecord.mockResolvedValue(undefined);
    mockCreatePoolRecord.mockResolvedValue(undefined);
    mockReadAppState.mockResolvedValue({
      sources: [{ id: "source_twitch" }, { id: "source_youtube" }],
      assets: [],
      pools: [
        {
          id: "pool_1",
          name: "TwitchYoutube",
          sourceIds: ["source_twitch", "source_youtube"],
          playbackMode: "round-robin",
          cursorAssetId: "asset_stale",
          sourceCursors: { source_twitch: "asset_stale" },
          insertAssetId: "",
          insertEveryItems: 0,
          itemsSinceInsert: 7,
          audioLaneAssetId: "",
          audioLaneVolumePercent: 100,
          updatedAt: ""
        }
      ]
    });
  });

  it("saves an edit without the position it read", async () => {
    const response = await PUT(request("PUT", { id: "pool_1", name: "Renamed", sourceIds: ["source_twitch"] }));

    expect(response.status).toBe(200);
    expect(mockUpdatePoolRecord).toHaveBeenCalledTimes(1);
    const written = mockUpdatePoolRecord.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written).toMatchObject({ id: "pool_1", name: "Renamed", sourceIds: ["source_twitch"], playbackMode: "round-robin" });
    expect(written).not.toHaveProperty("cursorAssetId");
    expect(written).not.toHaveProperty("sourceCursors");
    expect(written).not.toHaveProperty("itemsSinceInsert");
  });

  it("creates a pool with no position yet", async () => {
    const response = await POST(request("POST", { name: "New", sourceIds: ["source_youtube", "source_twitch"] }));

    expect(response.status).toBe(200);
    expect(mockCreatePoolRecord.mock.calls[0]?.[0]).toMatchObject({
      sourceIds: ["source_youtube", "source_twitch"],
      cursorAssetId: "",
      sourceCursors: {},
      itemsSinceInsert: 0
    });
  });

  it("answers with the new pool's id, so the setup wizard can fill the week with it (M99)", async () => {
    const response = await POST(request("POST", { name: "Programme", sourceIds: ["source_youtube"] }));
    const payload = (await response.json()) as { id?: string };

    expect(response.status).toBe(200);
    expect(payload.id).toMatch(/^pool_[a-z0-9]+$/);
    expect(payload.id).toBe((mockCreatePoolRecord.mock.calls[0]?.[0] as { id: string }).id);
  });
});
