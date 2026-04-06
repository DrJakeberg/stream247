import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireApiRoles,
  mockAppendAuditEvent,
  mockReadAppState,
  mockUpdateAssetCollectionMemberships,
  mockUpdateAssetCurationRecords
} = vi.hoisted(() => ({
  mockRequireApiRoles: vi.fn(),
  mockAppendAuditEvent: vi.fn(),
  mockReadAppState: vi.fn(),
  mockUpdateAssetCollectionMemberships: vi.fn(),
  mockUpdateAssetCurationRecords: vi.fn()
}));

vi.mock("@/lib/server/auth", () => ({
  requireApiRoles: mockRequireApiRoles
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  }
}));

vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent,
  readAppState: mockReadAppState,
  updateAssetCollectionMemberships: mockUpdateAssetCollectionMemberships,
  updateAssetCurationRecords: mockUpdateAssetCurationRecords
}));

import { PUT } from "../../apps/web/app/api/assets/route";
import { POST as bulkUpdateAssets } from "../../apps/web/app/api/assets/bulk/route";

describe("asset API safety regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiRoles.mockResolvedValue(null);
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockUpdateAssetCollectionMemberships.mockResolvedValue(undefined);
    mockUpdateAssetCurationRecords.mockResolvedValue(undefined);
  });

  it("updates only curation fields for single-asset edits", async () => {
    mockReadAppState.mockResolvedValue({
      assetCollections: [],
      assets: [
        {
          id: "asset_1",
          sourceId: "source_1",
          title: "Fresh worker title",
          path: "/tmp/fresh-worker-path.mp4",
          folderPath: "worker/folder",
          tags: ["fresh"],
          status: "ready",
          includeInProgramming: true,
          externalId: "external-1",
          categoryName: "Archive",
          durationSeconds: 1200,
          publishedAt: "2026-04-05T10:00:00.000Z",
          fallbackPriority: 5,
          isGlobalFallback: false,
          createdAt: "2026-04-05T10:00:00.000Z",
          updatedAt: "2026-04-05T10:00:00.000Z"
        }
      ]
    });

    const response = await PUT(
      new Request("http://localhost/api/assets", {
        method: "PUT",
        body: JSON.stringify({
          id: "asset_1",
          includeInProgramming: false,
          folderPath: "manual/folder",
          tags: ["featured", "archive"]
        }),
        headers: {
          "content-type": "application/json"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mockUpdateAssetCurationRecords).toHaveBeenCalledTimes(1);
    const payload = mockUpdateAssetCurationRecords.mock.calls[0]?.[0]?.[0];
    expect(payload).toMatchObject({
      id: "asset_1",
      includeInProgramming: false,
      isGlobalFallback: false,
      fallbackPriority: 5,
      folderPath: "manual/folder",
      tags: ["featured", "archive"]
    });
    expect(payload).not.toHaveProperty("title");
    expect(payload).not.toHaveProperty("path");
    expect(payload).not.toHaveProperty("status");
  });

  it("uses append-tags curation updates without rewriting whole asset rows", async () => {
    mockReadAppState.mockResolvedValue({
      assetCollections: [],
      assets: [
        {
          id: "asset_1",
          sourceId: "source_1",
          title: "Fresh worker title",
          path: "/tmp/fresh-worker-path.mp4",
          folderPath: "worker/folder",
          tags: ["fresh"],
          status: "ready",
          includeInProgramming: true,
          externalId: "external-1",
          categoryName: "Archive",
          durationSeconds: 1200,
          publishedAt: "2026-04-05T10:00:00.000Z",
          fallbackPriority: 5,
          isGlobalFallback: false,
          createdAt: "2026-04-05T10:00:00.000Z",
          updatedAt: "2026-04-05T10:00:00.000Z"
        }
      ]
    });

    const response = await bulkUpdateAssets(
      new Request("http://localhost/api/assets/bulk", {
        method: "POST",
        body: JSON.stringify({
          action: "append_tags",
          assetIds: ["asset_1"],
          tags: ["library"]
        }),
        headers: {
          "content-type": "application/json"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mockUpdateAssetCurationRecords).toHaveBeenCalledTimes(1);
    const payload = mockUpdateAssetCurationRecords.mock.calls[0]?.[0]?.[0];
    expect(payload).toMatchObject({
      id: "asset_1",
      appendTags: ["library"]
    });
    expect(payload).not.toHaveProperty("title");
    expect(payload).not.toHaveProperty("path");
    expect(payload).not.toHaveProperty("status");
  });

  it("updates curated-set membership without rewriting asset rows", async () => {
    mockReadAppState.mockResolvedValue({
      assetCollections: [
        {
          id: "collection_1",
          name: "Weekend starters",
          description: "",
          color: "#0e6d5a",
          assetIds: [],
          createdAt: "2026-04-06T10:00:00.000Z",
          updatedAt: "2026-04-06T10:00:00.000Z"
        }
      ],
      assets: [
        {
          id: "asset_1",
          sourceId: "source_1",
          title: "Fresh worker title",
          path: "/tmp/fresh-worker-path.mp4",
          folderPath: "worker/folder",
          tags: ["fresh"],
          status: "ready",
          includeInProgramming: true,
          externalId: "external-1",
          categoryName: "Archive",
          durationSeconds: 1200,
          publishedAt: "2026-04-05T10:00:00.000Z",
          fallbackPriority: 5,
          isGlobalFallback: false,
          createdAt: "2026-04-05T10:00:00.000Z",
          updatedAt: "2026-04-05T10:00:00.000Z"
        }
      ]
    });

    const response = await bulkUpdateAssets(
      new Request("http://localhost/api/assets/bulk", {
        method: "POST",
        body: JSON.stringify({
          action: "add_to_curated_set",
          assetIds: ["asset_1"],
          collectionId: "collection_1"
        }),
        headers: {
          "content-type": "application/json"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mockUpdateAssetCollectionMemberships).toHaveBeenCalledTimes(1);
    expect(mockUpdateAssetCollectionMemberships).toHaveBeenCalledWith([
      expect.objectContaining({
        collectionId: "collection_1",
        assetIds: ["asset_1"],
        mode: "append"
      })
    ]);
    expect(mockUpdateAssetCurationRecords).not.toHaveBeenCalled();
  });
});
