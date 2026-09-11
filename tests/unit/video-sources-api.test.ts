import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireApiRoles, mockAppendAuditEvent, mockList, mockUpsert, mockDelete } = vi.hoisted(() => ({
  mockRequireApiRoles: vi.fn(),
  mockAppendAuditEvent: vi.fn(),
  mockList: vi.fn(),
  mockUpsert: vi.fn(),
  mockDelete: vi.fn()
}));

vi.mock("@/lib/server/auth", () => ({ requireApiRoles: mockRequireApiRoles }));
vi.mock("@/lib/server/state", () => ({ appendAuditEvent: mockAppendAuditEvent }));
vi.mock("@stream247/db", () => ({
  listOverlayVideoSourceRecords: mockList,
  upsertOverlayVideoSourceRecord: mockUpsert,
  deleteOverlayVideoSourceRecord: mockDelete
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

import { PUT } from "../../apps/web/app/api/overlay/video-sources/route";

function putRequest(body: Record<string, unknown>): never {
  return new Request("http://localhost/api/overlay/video-sources", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }) as never;
}

// Push ingest custody at the route: the publish key is generated server-side, returned exactly
// once — in the response that created it — and never travels with a listing again.

describe("video sources API push ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiRoles.mockResolvedValue(null);
    mockList.mockResolvedValue([]);
    mockUpsert.mockResolvedValue(undefined);
  });

  it("issues a publish key exactly once when a push source is created", async () => {
    const response = await PUT(putRequest({ name: "Studio Camera", ingestKind: "push" }));
    const payload = (await response.json()) as { publishKey?: string; videoSources: unknown[] };

    expect(response.status).toBe(200);
    expect(payload.publishKey).toBeTruthy();
    expect(payload.publishKey!.length).toBeGreaterThanOrEqual(24);

    // The stored value is exactly the returned one, and the source stores no feed URL.
    expect(mockUpsert).toHaveBeenCalledWith(
      { id: "studio-camera", name: "Studio Camera" },
      expect.objectContaining({ ingestKind: "push", managedPublishKey: payload.publishKey, clearManagedUrl: true })
    );
  });

  it("keeps the stored key on a plain push re-save and rotates only on request", async () => {
    mockList.mockResolvedValue([
      { id: "studio-camera", name: "Studio Camera", urlPresent: false, ingestKind: "push", publishKeyPresent: true, updatedAt: "" }
    ]);

    const resave = await PUT(putRequest({ id: "studio-camera", name: "Studio Camera", ingestKind: "push" }));
    expect(((await resave.json()) as { publishKey?: string }).publishKey).toBeUndefined();
    expect(mockUpsert).toHaveBeenCalledWith(
      { id: "studio-camera", name: "Studio Camera" },
      expect.not.objectContaining({ managedPublishKey: expect.anything() })
    );

    const rotate = await PUT(putRequest({ id: "studio-camera", name: "Studio Camera", ingestKind: "push", rotatePublishKey: true }));
    const rotated = (await rotate.json()) as { publishKey?: string };
    expect(rotated.publishKey).toBeTruthy();
  });

  it("refuses a feed address on a push source", async () => {
    const response = await PUT(
      putRequest({ name: "Studio Camera", ingestKind: "push", url: "rtsp://camera.example/stream" })
    );
    expect(response.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("clears the publish key when a source is switched back to a fetched address", async () => {
    await PUT(putRequest({ id: "studio-camera", name: "Studio Camera", ingestKind: "pull", url: "rtsp://camera.example/stream" }));
    expect(mockUpsert).toHaveBeenCalledWith(
      { id: "studio-camera", name: "Studio Camera" },
      expect.objectContaining({ ingestKind: "pull", clearPublishKey: true, managedUrl: "rtsp://camera.example/stream" })
    );
  });

  it("leaves the stored kind alone when the request does not name one", async () => {
    await PUT(putRequest({ id: "studio-camera", name: "Studio Camera" }));
    const options = mockUpsert.mock.calls[0][1] as Record<string, unknown> | undefined;
    expect(options?.ingestKind).toBeUndefined();
    expect(options?.clearPublishKey).toBeUndefined();
  });
});
