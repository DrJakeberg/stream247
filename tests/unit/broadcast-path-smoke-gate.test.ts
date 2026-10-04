import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The relay-on smoke stays in CI and keeps checking what it was written for (M98, audit U15).
 *
 * The check itself needs the whole compose stack and only runs in the CI job. These assertions guard
 * against the quiet ways it could stop meaning anything: the step dropped from the workflow, the stack
 * started without the relay, the mutation run removed (a measurement that cannot fail proves nothing), or
 * one of the two simulated source failures taken out.
 */

const ROOT = process.cwd();
const SCRIPT = "scripts/broadcast-path-smoke.sh";

function read(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("broadcast path smoke gate", () => {
  it("CI runs it through the package script", () => {
    expect(read(".github/workflows/ci.yml")).toMatch(/run: pnpm test:broadcast-path\b/);
    expect(read("package.json")).toContain(`"test:broadcast-path": "bash ./${SCRIPT}"`);
  });

  it("starts the stack the way production runs it: relay on, uplink reading the HLS program feed", () => {
    const script = read(SCRIPT);
    expect(script).toContain("STREAM247_RELAY_ENABLED=1");
    expect(script).toContain("STREAM247_UPLINK_INPUT_MODE=hls");
    expect(script).toContain("#EXT-X-MEDIA-SEQUENCE");
    expect(script).toMatch(/MEASURE_SECONDS="\$\{STREAM247_BROADCAST_SMOKE_MEASURE_SECONDS:-60\}"/);
  });

  it("keeps the mutation run: with the uplink stopped the same measurement must fail", () => {
    const script = read(SCRIPT);
    const mutation = script.slice(script.indexOf("compose stop uplink"));
    // The measurement must fail, and for the uplink alone (verdict 2): a stalled feed does not count.
    expect(mutation).toMatch(/^compose stop uplink[\s\S]*?measure_path \|\| mutation_verdict=\$\?/);
    expect(mutation).toMatch(/\[ "\$mutation_verdict" -eq 2 \] \|\| fail /);
  });

  it("keeps both simulated source failures, and the full run is the default", () => {
    const script = read(SCRIPT);
    expect(script).toContain('PHASES="${STREAM247_BROADCAST_SMOKE_PHASES:-all}"');
    for (const marker of [
      '"playout.source-breaker.opened"',
      '"playout.source-breaker.closed"',
      'docker network disconnect "$OUTSIDE_NETWORK"',
      '"playout.probe.network_outage"',
      'OUTAGE_SECONDS="${STREAM247_BROADCAST_SMOKE_OUTAGE_SECONDS:-90}"'
    ]) {
      expect(script).toContain(marker);
    }
  });
});
