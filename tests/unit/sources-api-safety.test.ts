import { File as NodeFile } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireApiRoles,
  mockAppendAuditEvent,
  mockReadAppState,
  mockUpdateSourceFieldRecords,
  mockUpsertSourceRecord,
  mockDeleteSourceRecordAndAssets,
  mockMkdir,
  mockAccess,
  mockWriteFile
} = vi.hoisted(() => ({
  mockRequireApiRoles: vi.fn(),
  mockAppendAuditEvent: vi.fn(),
  mockReadAppState: vi.fn(),
  mockUpdateSourceFieldRecords: vi.fn(),
  mockUpsertSourceRecord: vi.fn(),
  mockDeleteSourceRecordAndAssets: vi.fn(),
  mockMkdir: vi.fn(),
  mockAccess: vi.fn(),
  mockWriteFile: vi.fn()
}));

vi.mock("@/lib/server/auth", () => ({
  requireApiRoles: mockRequireApiRoles
}));

vi.mock("@/lib/source-connectors", () => ({
  sourceConnectorDefinitions: [
    { id: "local-library" },
    { id: "direct-media" },
    { id: "youtube-playlist" },
    { id: "youtube-channel" },
    { id: "twitch-vod" },
    { id: "twitch-channel" }
  ]
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
  updateSourceFieldRecords: mockUpdateSourceFieldRecords,
  upsertSourceRecord: mockUpsertSourceRecord,
  deleteSourceRecordAndAssets: mockDeleteSourceRecordAndAssets
}));

vi.mock("node:fs", () => ({
  promises: {
    mkdir: mockMkdir,
    access: mockAccess,
    writeFile: mockWriteFile
  }
}));

import { PUT as updateSource } from "../../apps/web/app/api/sources/route";
import { POST as bulkUpdateSources } from "../../apps/web/app/api/sources/bulk/route";
import { POST as syncSource } from "../../apps/web/app/api/sources/sync/route";
import { POST as uploadLibraryMedia } from "../../apps/web/app/api/library/uploads/route";

describe("source API safety regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.File = NodeFile as typeof File;
    mockRequireApiRoles.mockResolvedValue(null);
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockUpdateSourceFieldRecords.mockResolvedValue(undefined);
    mockUpsertSourceRecord.mockResolvedValue(undefined);
    mockDeleteSourceRecordAndAssets.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockAccess.mockRejectedValue(new Error("missing"));
    mockWriteFile.mockResolvedValue(undefined);
  });

  it("updates only admin-editable fields for source edits", async () => {
    mockReadAppState.mockResolvedValue({
      sources: [
        {
          id: "source_1",
          name: "Worker name",
          type: "YouTube channel",
          connectorKind: "youtube-channel",
          enabled: true,
          status: "Sync queued",
          externalUrl: "https://youtube.com/@worker",
          notes: "Worker updated note",
          lastSyncedAt: "2026-04-05T11:00:00.000Z"
        }
      ]
    });

    const response = await updateSource(
      new Request("http://localhost/api/sources", {
        method: "PUT",
        body: JSON.stringify({
          id: "source_1",
          name: "Edited source",
          connectorKind: "youtube-channel",
          externalUrl: "https://youtube.com/@edited",
          enabled: false
        }),
        headers: {
          "content-type": "application/json"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mockUpdateSourceFieldRecords).toHaveBeenCalledTimes(1);
    expect(mockUpdateSourceFieldRecords.mock.calls[0]?.[0]).toEqual([
      {
        id: "source_1",
        name: "Edited source",
        type: "YouTube channel",
        connectorKind: "youtube-channel",
        enabled: false,
        externalUrl: "https://youtube.com/@edited"
      }
    ]);
  });

  it("bulk updates only the selected sources", async () => {
    mockReadAppState.mockResolvedValue({
      sources: [
        {
          id: "source_1",
          name: "Source One",
          type: "YouTube channel",
          connectorKind: "youtube-channel",
          enabled: true,
          status: "Ready",
          externalUrl: "https://youtube.com/@one",
          notes: "Ready",
          lastSyncedAt: "2026-04-05T10:00:00.000Z"
        },
        {
          id: "source_2",
          name: "Source Two",
          type: "YouTube channel",
          connectorKind: "youtube-channel",
          enabled: true,
          status: "Importing",
          externalUrl: "https://youtube.com/@two",
          notes: "Worker is importing",
          lastSyncedAt: "2026-04-05T10:05:00.000Z"
        }
      ]
    });

    const response = await bulkUpdateSources(
      new Request("http://localhost/api/sources/bulk", {
        method: "POST",
        body: JSON.stringify({
          action: "disable",
          sourceIds: ["source_1"]
        }),
        headers: {
          "content-type": "application/json"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mockUpdateSourceFieldRecords).toHaveBeenCalledTimes(1);
    expect(mockUpdateSourceFieldRecords.mock.calls[0]?.[0]).toEqual([
      {
        id: "source_1",
        enabled: false
      }
    ]);
  });

  it("queues a sync without overwriting unrelated source fields", async () => {
    mockReadAppState.mockResolvedValue({
      sources: [
        {
          id: "source_1",
          name: "Source One",
          type: "YouTube channel",
          connectorKind: "youtube-channel",
          enabled: true,
          status: "Ready",
          externalUrl: "https://youtube.com/@one",
          notes: "Worker is healthy",
          lastSyncedAt: "2026-04-05T10:00:00.000Z"
        }
      ]
    });

    const response = await syncSource(
      new Request("http://localhost/api/sources/sync", {
        method: "POST",
        body: JSON.stringify({ id: "source_1" }),
        headers: {
          "content-type": "application/json"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mockUpdateSourceFieldRecords).toHaveBeenCalledWith([
      {
        id: "source_1",
        status: "Sync queued",
        notes: "Manual re-sync requested. The worker will refresh this source on the next cycle."
      }
    ]);
  });

  it("marks the local library for rescan without whole-row source upserts", async () => {
    mockReadAppState.mockResolvedValue({
      sources: [
        {
          id: "source-local-library",
          name: "Local Library",
          type: "Local media library",
          connectorKind: "local-library",
          enabled: true,
          status: "Ready",
          externalUrl: "",
          notes: "Worker ready",
          lastSyncedAt: "2026-04-05T10:00:00.000Z"
        }
      ]
    });

    const formData = new FormData();
    formData.append("subfolder", "uploads");
    formData.append("files", new Blob([Buffer.from("file-bytes")], { type: "video/mp4" }), "clip.mp4");

    const response = await uploadLibraryMedia(
      new Request("http://localhost/api/library/uploads", {
        method: "POST",
        body: formData
      })
    );

    expect(response.status).toBe(200);
    expect(mockUpdateSourceFieldRecords).toHaveBeenCalledWith([
      {
        id: "source-local-library",
        status: "Sync queued",
        notes: "New local uploads detected. The worker will refresh the local media library on the next cycle."
      }
    ]);
    expect(mockUpsertSourceRecord).not.toHaveBeenCalled();
  });
});
