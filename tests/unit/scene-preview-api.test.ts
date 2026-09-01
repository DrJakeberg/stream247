import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireApiRoles, mockGetAuthenticatedUserId } = vi.hoisted(() => ({
  mockRequireApiRoles: vi.fn(),
  mockGetAuthenticatedUserId: vi.fn()
}));

vi.mock("@/lib/server/auth", () => ({
  requireApiRoles: mockRequireApiRoles,
  getAuthenticatedUserId: mockGetAuthenticatedUserId
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

import { POST } from "../../apps/web/app/api/scenes/preview/route";

function previewRequest(body: Record<string, unknown>): never {
  return new Request("http://localhost/api/scenes/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }) as never;
}

const samplePayload = {
  scene: {
    surfaceStyle: "glass",
    panelAnchor: "bottom",
    titleScale: "balanced",
    typographyPreset: "studio-sans",
    resolvedPresetId: "lower-third",
    customLayers: []
  },
  channelName: "3JC Retro",
  accentColor: "#6ee7ff",
  brandLine: "STREAM247",
  heroLabel: "Now playing",
  heroTitle: "Advent of Code 2025",
  heroBody: "Recorded live",
  metaLine: "Programming",
  nextLabel: "Up next",
  nextTitle: "Retro Night",
  nextTimeLabel: "21:30",
  queueTitles: ["Prime time replay"],
  tickerText: "",
  emergencyBanner: "",
  timeZone: "Europe/Berlin"
};

/**
 * The studio preview endpoint.
 *
 * The studio used to draw its own imitation of the overlay in HTML, which disagreed with the
 * broadcast on safe area, clamp limits and which images exist at all — so it showed the operator
 * positions that do not survive going on air. This route ends that by handing the preview to the
 * renderer that actually draws the broadcast.
 */
describe("scene preview API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedUserId.mockResolvedValue("user-1");
    mockRequireApiRoles.mockResolvedValue(null);
  });

  it("renders the draft through the broadcast renderer and answers with SVG", async () => {
    const response = await POST(previewRequest({ payload: samplePayload }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");

    const svg = await response.text();
    expect(svg.startsWith("<svg")).toBe(true);
    // Broadcast geometry, so the operator is looking at the frame that goes out.
    expect(svg).toContain('viewBox="0 0 1920 1080"');
    // satori positions every word itself, so the title arrives as separate <text> runs at
    // pre-computed coordinates rather than as one string.
    expect(svg).toContain(">Advent<");
    expect(svg).toContain(">Code<");
  }, 30_000);

  it("guards the preview with the same roles as the scene payload route", async () => {
    await POST(previewRequest({ payload: samplePayload }));

    expect(mockRequireApiRoles).toHaveBeenCalledWith(["owner", "admin", "operator", "moderator", "viewer"]);
  }, 30_000);

  it("refuses an unsigned request before it reaches the database", async () => {
    mockGetAuthenticatedUserId.mockResolvedValue(null);

    const response = await POST(previewRequest({ payload: samplePayload }));

    expect(response.status).toBe(401);
    // The image smoke test leans on this: it runs the web image with no Postgres behind it, so a
    // 401 (rather than a 500 from a database that is not there) is what proves the route module —
    // satori and its bundled layout engine included — actually loaded in the built image.
    expect(mockRequireApiRoles).not.toHaveBeenCalled();
  });

  it("passes a role refusal straight through", async () => {
    mockRequireApiRoles.mockResolvedValue(
      new Response(JSON.stringify({ message: "Insufficient permissions." }), { status: 403 })
    );

    const response = await POST(previewRequest({ payload: samplePayload }));

    expect(response.status).toBe(403);
  });

  it("leaves the glyph outlines to the page instead of shipping them per frame", async () => {
    const response = await POST(previewRequest({ payload: samplePayload }));
    const svg = await response.text();

    // Embedded outlines turn a frame from kilobytes into tens of kilobytes, every keystroke in the
    // scene editor. The SVG is inlined into a page that already declares the same faces, so the
    // glyphs are on the client before the first preview is ever requested.
    expect(svg).not.toContain("@font-face");
    expect(svg).not.toContain("font/ttf");
    // satori lower-cases the family name it emits. CSS family matching is case-insensitive, so the
    // page's @font-face for "Stream247 Sans" still answers it — but anything comparing the string
    // has to expect what is actually written.
    expect(svg).toContain('font-family="stream247 sans"');
    expect(svg.length).toBeLessThan(20_000);
  }, 30_000);

  it("never runs two renders at once", async () => {
    // This machine encodes a 24/7 channel while it serves the studio. A scene editor that fires a
    // render per keystroke must not be able to take a core per keystroke with it.
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => POST(previewRequest({ payload: samplePayload })))
    );

    for (const response of responses) {
      expect(response.status).toBe(200);
    }

    const { peakConcurrentScenePreviewRenders } = await import("../../apps/web/app/api/scenes/preview/route");
    expect(peakConcurrentScenePreviewRenders()).toBe(1);
  }, 60_000);

  it("answers 400 rather than rendering when the body carries no scene", async () => {
    const response = await POST(previewRequest({ payload: null }));

    expect(response.status).toBe(400);
  });
});
