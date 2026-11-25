import { describe, expect, it, vi } from "vitest";
import type { ScenePreviewRequest } from "../../apps/web/lib/scene-preview-request";

// M127: the studio preview draws one frame at a time, and the remote pictures of a frame used to be
// fetched inside that one slot. A picture whose host never answers then held every other user's
// preview behind it for the whole fetch deadline, request after request.

// Any odd width stands for a frame whose picture host never answers.
const STALLED_WIDTH = 641;
let active = 0;
let peak = 0;

vi.mock("@stream247/overlay-render", () => {
  const prepareSceneLayout = vi.fn((request: ScenePreviewRequest) =>
    request.width % 2 === 1 ? new Promise(() => undefined) : Promise.resolve({ type: "div", props: {} })
  );
  const renderPreparedSceneSvg = vi.fn(async (_layout: unknown, request: ScenePreviewRequest) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return `<svg width="${request.width}"/>`;
  });
  return {
    loadSceneRendererFonts: vi.fn(async () => []),
    prepareSceneLayout,
    renderPreparedSceneSvg,
    // What the real one is: the picture fetch, then satori.
    renderSceneSvg: vi.fn(async (request: ScenePreviewRequest, fonts: unknown, options: unknown) =>
      renderPreparedSceneSvg(await prepareSceneLayout(request), request, fonts, options)
    )
  };
});

function scene(width: number): ScenePreviewRequest {
  return { width, height: 360, payload: {} as ScenePreviewRequest["payload"] };
}

describe("studio preview queue (M127)", () => {
  it("does not hold other previews while one frame's pictures are still being fetched", async () => {
    const { renderScenePreviewSvg, peakConcurrentScenePreviewRenders } = await import(
      "../../apps/web/lib/server/scene-preview-renderer"
    );

    let stalledSettled = false;
    void renderScenePreviewSvg(scene(STALLED_WIDTH), { userId: "viewer-a" }).finally(() => {
      stalledSettled = true;
    });

    const others = Promise.all([
      renderScenePreviewSvg(scene(640), { userId: "operator-b" }),
      renderScenePreviewSvg(scene(700), { userId: "operator-b" })
    ]);
    const outcome = await Promise.race([
      others,
      new Promise<"stalled">((resolve) => setTimeout(() => resolve("stalled"), 100))
    ]);

    expect(outcome).toEqual(['<svg width="640"/>', '<svg width="700"/>']);
    expect(stalledSettled).toBe(false);
    // satori itself still runs one frame at a time.
    expect(peak).toBe(1);
    expect(peakConcurrentScenePreviewRenders()).toBe(1);
  });

  it("bounds the frames holding fetched pictures: one per user, two in all, and drops abandoned waits", async () => {
    vi.resetModules();
    const overlayRender = await import("@stream247/overlay-render");
    const { renderScenePreviewSvg, waitingScenePreviewRequests, ScenePreviewAbortedError } = await import(
      "../../apps/web/lib/server/scene-preview-renderer"
    );
    const preparedWidths = () =>
      vi.mocked(overlayRender.prepareSceneLayout).mock.calls.map(([request]) => request.width);

    void renderScenePreviewSvg(scene(641), { userId: "viewer-a" });
    const abandon = new AbortController();
    const sameUser = renderScenePreviewSvg(scene(650), { userId: "viewer-a", signal: abandon.signal });
    void renderScenePreviewSvg(scene(643), { userId: "viewer-c" });
    const thirdUser = renderScenePreviewSvg(scene(660), { userId: "operator-d" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // viewer-a's second frame waits for its first; operator-d waits because both slots are taken.
    expect(preparedWidths()).not.toContain(650);
    expect(preparedWidths()).not.toContain(660);
    expect(waitingScenePreviewRequests()).toBe(2);

    abandon.abort();
    await expect(sameUser).rejects.toBeInstanceOf(ScenePreviewAbortedError);
    expect(waitingScenePreviewRequests()).toBe(1);
    expect(preparedWidths()).not.toContain(650);
    void thirdUser.catch(() => undefined);
  });
});
