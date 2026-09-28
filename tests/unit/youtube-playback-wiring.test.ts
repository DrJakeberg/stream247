import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// M68 (2.1). getFfmpegCommand and the playout cycle live in apps/worker/src/index.ts, which cannot be
// imported in a unit test (it starts the worker), so the wiring the pure modules depend on is pinned
// here against the source text, the way incident-classes.test.ts does it.
const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");

function functionBody(name: string): string {
  const start = workerSource.indexOf(`function ${name}(`);
  expect(start, `function ${name} not found`).toBeGreaterThan(-1);
  const next = workerSource.indexOf("\nfunction ", start + 1);
  const nextAsync = workerSource.indexOf("\nasync function ", start + 1);
  const ends = [next, nextAsync].filter((index) => index > -1);
  return workerSource.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
}

describe("YouTube playback wiring", () => {
  // The 2.0 resolve that found a format for 0 of 11 YouTube assets on 2026-09-28.
  it("no longer resolves playback with --format best --get-url", () => {
    expect(workerSource).not.toMatch(/"--format",\s*"best",\s*"--get-url"/);
    expect(functionBody("resolvePlayableMedia")).toContain("buildResolveArgs(");
  });

  it("walks the candidates inside one time budget and moves on only for an unavailable format", () => {
    const body = functionBody("resolvePlayableMedia");
    expect(body).toContain("PLAYABLE_INPUT_RESOLVE_TIMEOUT_MS");
    expect(body).toContain("isFormatUnavailableError(");
    expect(body).toContain("orderCandidatesAfterPlayFailures(");
  });

  it("opens a pair's audio track as an input BEFORE any filter or map", () => {
    const body = functionBody("getFfmpegCommand");
    const audioInput = body.indexOf("buildFfmpegInputArgs({ input: programAudioInput");
    expect(audioInput).toBeGreaterThan(-1);
    for (const later of ['"-filter_complex"', '"-vf"', '"-map"']) {
      expect(body.indexOf(later), `${later} must come after the audio input`).toBeGreaterThan(audioInput);
    }
  });

  it("maps the pair's audio as mandatory input 1 and never next to an audio lane", () => {
    const body = functionBody("getFfmpegCommand");
    expect(body).toContain('const separateProgramAudio = !audioLane && Boolean(programAudioInput);');
    expect(body).toContain('const audioMap = audioLane || separateProgramAudio ? "1:a:0" : "0:a?";');
    expect(body).toContain("const sceneInputIndex = audioLane || separateProgramAudio ? 2 : 1;");
    // Every audio map in the programme command goes through audioMap (or the PiP mix).
    expect(body).not.toMatch(/audioLane \? "1:a:0" : "0:a\?"/);
  });

  it("records a candidate that failed to open, so the next resolve tries another format", () => {
    expect(workerSource).toMatch(/queueProbeCache\.delete\(lastAssetId\);[\s\S]{0,400}recordPlayFailedCandidate\(lastAssetId, lastFormatCandidateId\)/);
    expect(functionBody("resolveAssetPlaybackInput")).toContain("getPlayFailedCandidateIds(asset.id)");
  });
});
