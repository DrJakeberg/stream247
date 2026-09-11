import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Which ffmpeg input the ticker strip is, guarded where the arithmetic actually lives.
 *
 * The filter builders are pure and tested, but they are handed an index rather than deriving one.
 * The derivation is in apps/worker/src/index.ts, which no test can import because it starts a
 * worker, and it is the part that breaks silently: an off-by-one makes ffmpeg abort at graph init
 * or composite the wrong stream, and the overlay mode is baked in for the life of the process, so
 * the whole programme is lost either way.
 *
 * The rule the three builders share is that the strip is the LAST input, after the scene pipe and
 * after any live picture-in-picture, so that neither of those indices moves when a ticker appears
 * or is cleared. These assertions read the source, as relay-presence, incident-classes and the
 * overlay-mode wiring test already do.
 */
const workerSource = readFileSync(new URL("../../apps/worker/src/index.ts", import.meta.url), "utf8");

describe("ticker crawl wiring", () => {
  it("puts the strip after the picture-in-picture, which is after the scene pipe", () => {
    expect(workerSource).toContain("stripInputIndex: (attachLive && liveSource ? pipInputIndex : sceneInputIndex) + 1");
    expect(workerSource).toContain("const pipInputIndex = sceneInputIndex + 1;");
  });

  it("pushes the strip input after every other input, in that order", () => {
    const scene = workerSource.indexOf('`pipe:${ON_AIR_SCENE_PIPE_FD}`');
    const pip = workerSource.indexOf("command.push(...liveSource.inputArgs);");
    const strip = workerSource.indexOf("command.push(...tickerStripInputArgs(tickerCrawl, output.fps));");
    expect(scene).toBeGreaterThan(0);
    expect(pip).toBeGreaterThan(scene);
    expect(strip).toBeGreaterThan(pip);
  });

  it("keeps the bridge and the standby slate at the indices their own graphs use", () => {
    // The live bridge takes the programme and the scene pipe, so the strip is 2. The standby slate
    // takes the slate, its audio and the scene pipe, so the strip is 3 — which is why its scene
    // overlay reads [2:v] and not [1:v].
    expect(workerSource).toContain("sceneInputIndex: 1,\n        ticker: tickerCrawl ? { ...tickerCrawl, stripInputIndex: 2, fps: output.fps } : null");
    expect(workerSource).toContain("sceneInputIndex: 2,\n        ticker: tickerCrawl ? { ...tickerCrawl, stripInputIndex: 3, fps: output.fps } : null");
  });

  it("sets the crawl before the first frame and drops it outside scene mode", () => {
    const set = workerSource.indexOf("activeTickerCrawl = args.overlayEnabled ? await prepareTickerCrawl(outputSettings) : null;");
    const frame = workerSource.indexOf("const initialSceneFrame = args.overlayEnabled ? await prepareSceneRendererFrame(outputSettings) : null;");
    expect(set).toBeGreaterThan(0);
    expect(frame).toBeGreaterThan(set);
    expect(workerSource).toContain('if (overlayMode !== "scene") {\n    activeTickerCrawl = null;\n  }');
  });
});

describe("ticker crawl failure is not silent", () => {
  it("raises an incident when the strip does not render, and resolves it when it does", () => {
    // Every sibling failure in this start path raises one. This one wrote a log line into container
    // stdout and nothing else, and the fallback is quiet enough to hide: the band still draws and
    // the line still appears, standing still instead of running.
    expect(workerSource).toContain('fingerprint: "playout.ticker-strip.failed"');
    expect(workerSource).toContain('await resolveIncident("playout.ticker-strip.failed"');
  });

  it("puts the strip in place with a rename, never a partial file", () => {
    // Measured: a zero-byte strip makes ffmpeg exit cleanly; a PARTIAL one wedges it spinning at
    // 100% CPU with -t ignored, no frames and no exit.
    expect(workerSource).toContain("await fs.rename(`${tickerStripPath}.tmp`, tickerStripPath);");
  });
});

describe("a ticker edit that has not reached the screen", () => {
  it("is checked where the payload is written, not on the render tick", () => {
    // The payload only changes on the reconciliation cycle; an incident write every two seconds
    // would be a cost for nothing.
    expect(workerSource).toContain("currentScenePayload = payload;\n  await reportTickerCrawlStaleness(payload);");
  });

  it("compares the line the process is moving against the line that is configured", () => {
    expect(workerSource).toContain("crawlLine: activeTickerCrawl?.line ?? \"\"");
    expect(workerSource).toContain("payloadLine: overlayTickerLine(payload)");
  });

  it("says so, and stops saying so when the next programme picks the change up", () => {
    expect(workerSource).toContain('fingerprint: "overlay.ticker-stale"');
    expect(workerSource).toContain('await resolveIncident("overlay.ticker-stale"');
  });
})

describe("the stale check does not tax the write lock", () => {
  it("only resolves when it has actually raised", () => {
    // resolveIncident takes the global serialized write lock, the one every state mutation
    // contends for. Resolving unconditionally would take it on every reconciliation cycle, for
    // ever, for a zero-row update, on a channel with no ticker configured at all.
    expect(workerSource).toContain("if (tickerStaleReported) {");
    expect(workerSource).toContain("tickerStaleReported = false;");
    expect(workerSource).toContain("tickerStaleReported = true;");
  });
});
