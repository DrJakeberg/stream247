import { File as NodeFile } from "node:buffer";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireApiRoles,
  mockAppendAuditEvent,
  mockReadAppState,
  mockUpdateSourceFieldRecords,
  mockUpsertSourceRecord,
  mockDeleteSourceRecordAndAssets,
  mockMkdir,
  mockCreateWriteStream,
  mockUnlink,
  mockStatfs,
  writtenFiles,
  reservedUploadPaths
} = vi.hoisted(() => ({
  mockRequireApiRoles: vi.fn(),
  mockAppendAuditEvent: vi.fn(),
  mockReadAppState: vi.fn(),
  mockUpdateSourceFieldRecords: vi.fn(),
  mockUpsertSourceRecord: vi.fn(),
  mockDeleteSourceRecordAndAssets: vi.fn(),
  mockMkdir: vi.fn(),
  mockCreateWriteStream: vi.fn(),
  mockUnlink: vi.fn(),
  mockStatfs: vi.fn(),
  writtenFiles: new Map<string, Buffer>(),
  reservedUploadPaths: new Set<string>()
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
  createWriteStream: mockCreateWriteStream,
  promises: {
    mkdir: mockMkdir,
    unlink: mockUnlink,
    statfs: mockStatfs
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
    mockUnlink.mockResolvedValue(undefined);
    // 100 GiB volume, 50 GiB free.
    mockStatfs.mockResolvedValue({ bsize: 4096, blocks: (100 * 1024 ** 3) / 4096, bavail: (50 * 1024 ** 3) / 4096 });
    writtenFiles.clear();
    reservedUploadPaths.clear();
    mockCreateWriteStream.mockImplementation((filePath: string) => {
      const stream = new PassThrough();
      const chunks: Buffer[] = [];

      if (reservedUploadPaths.has(filePath)) {
        queueMicrotask(() => {
          stream.emit("error", Object.assign(new Error("exists"), { code: "EEXIST" }));
        });
        return stream;
      }

      reservedUploadPaths.add(filePath);
      queueMicrotask(() => {
        stream.emit("open", 3);
      });
      stream.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on("finish", () => {
        writtenFiles.set(filePath, Buffer.concat(chunks));
      });
      return stream;
    });
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

  it("sanitizes invisible characters from source edits", async () => {
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
          id: "source_1\u200B",
          name: "Edited\u200B source",
          connectorKind: "youtube-channel",
          externalUrl: "https://youtube.com/@ed\u200Bited",
          enabled: false
        }),
        headers: {
          "content-type": "application/json"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mockUpdateSourceFieldRecords).toHaveBeenCalledWith([
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

  const localLibraryState = {
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
    ],
    managedConfig: {}
  };

  function uploadRequest(
    name: string,
    chunks: string[],
    options: { subfolder?: string; contentLength?: number | null } = {}
  ): Request {
    const bytes = chunks.reduce((total, chunk) => total + Buffer.byteLength(chunk), 0);
    const headers = new Headers({ "x-upload-name": encodeURIComponent(name), "x-upload-subfolder": encodeURIComponent(options.subfolder ?? "") });
    if (options.contentLength !== null) {
      headers.set("content-length", String(options.contentLength ?? bytes));
    }
    // Built by hand: a real Request recomputes Content-Length, and the route must be tested against a lying one too.
    return {
      headers,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(Buffer.from(chunk));
          }
          controller.close();
        }
      })
    } as unknown as Request;
  }

  it("marks the local library for rescan without whole-row source upserts", async () => {
    mockReadAppState.mockResolvedValue(localLibraryState);

    const response = await uploadLibraryMedia(uploadRequest("clip.mp4", ["file-bytes"], { subfolder: "uploads" }));

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

  it("M125: streams the request body to disk chunk by chunk, never through formData", async () => {
    mockReadAppState.mockResolvedValue(localLibraryState);
    const request = uploadRequest("concert.mp4", ["chunk-a", "chunk-b", "chunk-c"], { subfolder: "uploads" });
    const formDataSpy = vi.fn(async () => {
      throw new Error("formData buffers the whole body in memory");
    });
    Object.defineProperty(request, "formData", { value: formDataSpy });

    const response = await uploadLibraryMedia(request);

    expect(response.status).toBe(200);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(mockCreateWriteStream).toHaveBeenCalledWith(expect.stringMatching(/uploads\/concert\.mp4$/), { flags: "wx" });
    const [[storedPath]] = mockCreateWriteStream.mock.calls;
    expect(writtenFiles.get(storedPath)).toEqual(Buffer.from("chunk-achunk-bchunk-c"));
  });

  it("keeps duplicate upload names collision-safe, without reading the body before the name is reserved", async () => {
    mockReadAppState.mockResolvedValue(localLibraryState);

    expect((await uploadLibraryMedia(uploadRequest("clip.mp4", ["alpha"], { subfolder: "uploads" }))).status).toBe(200);
    expect((await uploadLibraryMedia(uploadRequest("clip.mp4", ["beta"], { subfolder: "uploads" }))).status).toBe(200);
    expect(mockCreateWriteStream).toHaveBeenCalledTimes(3);

    const firstPath = String(mockCreateWriteStream.mock.calls[0]?.[0]);
    const collisionPath = String(mockCreateWriteStream.mock.calls[1]?.[0]);
    const retryPath = String(mockCreateWriteStream.mock.calls[2]?.[0]);

    expect(collisionPath).toBe(firstPath);
    expect(retryPath).not.toBe(firstPath);
    expect(retryPath).toMatch(/uploads\/clip-[a-f0-9]{8}\.mp4$/);
    expect(writtenFiles.get(firstPath)).toEqual(Buffer.from("alpha"));
    expect(writtenFiles.get(retryPath)).toEqual(Buffer.from("beta"));
  });

  it("M125: refuses with 507 before writing when the upload would leave less free than the disk watermark", async () => {
    mockReadAppState.mockResolvedValue(localLibraryState);
    // 100 GiB volume, 10.5 GiB free: a 1 GiB file would leave 9.5 GiB, under the default 10 %.
    mockStatfs.mockResolvedValue({ bsize: 4096, blocks: (100 * 1024 ** 3) / 4096, bavail: (10.5 * 1024 ** 3) / 4096 });

    const response = await uploadLibraryMedia(uploadRequest("big.mp4", ["x"], { contentLength: 1024 ** 3 }));

    expect(response.status).toBe(507);
    expect(((await response.json()) as { message: string }).message).toContain("Not enough space on the media volume");
    expect(mockCreateWriteStream).not.toHaveBeenCalled();
  });

  it("M125: refuses an upload without a size, and discards one longer or shorter than it declared", async () => {
    mockReadAppState.mockResolvedValue(localLibraryState);

    expect((await uploadLibraryMedia(uploadRequest("clip.mp4", ["abc"], { contentLength: null }))).status).toBe(400);
    expect(mockCreateWriteStream).not.toHaveBeenCalled();

    const longer = await uploadLibraryMedia(uploadRequest("long.mp4", ["0123456789"], { contentLength: 4 }));
    expect(longer.status).toBe(400);
    const shorter = await uploadLibraryMedia(uploadRequest("short.mp4", ["01"], { contentLength: 4 }));
    expect(shorter.status).toBe(400);
    expect(mockUnlink).toHaveBeenCalledWith(expect.stringMatching(/long\.mp4$/));
    expect(mockUnlink).toHaveBeenCalledWith(expect.stringMatching(/short\.mp4$/));
    expect(mockUpdateSourceFieldRecords).not.toHaveBeenCalled();
  });

  it("refuses a file type the library scan would ignore", async () => {
    mockReadAppState.mockResolvedValue(localLibraryState);
    const response = await uploadLibraryMedia(uploadRequest("notes.txt", ["x"]));
    expect(response.status).toBe(400);
    expect(mockCreateWriteStream).not.toHaveBeenCalled();
  });
});
