import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Every browser spec runs in a gate.
 *
 * CI runs browser specs in exactly two places: `pnpm test:e2e:smoke`, which runs the E2E_SPECS
 * default of scripts/e2e-smoke.sh, and `./scripts/design-baseline.sh`, which runs its
 * DESIGN_BASELINE_SPEC default. A spec in neither list only runs when someone remembers it exists.
 * tests/e2e/program-screenshot.spec.ts was such a spec. Its April reference image outlived five months
 * of Program changes; by the time anyone ran it, it described a page that no longer existed, and its
 * coverage had long since moved into the design baseline. It was retired on 2026-10-01 (see M44 in
 * PLANS.md).
 *
 * A new spec therefore belongs in one of the two lists. If it does not belong there, it does not
 * belong in tests/e2e either.
 */

const ROOT = process.cwd();
const SPEC_PATH = /tests\/e2e\/[\w.-]+\.spec\.ts/g;

function read(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

/** The spec paths inside a `${VAR:-default}` expansion, for every expansion of VAR in the file. */
function defaultSpecs(relativePath: string, variable: string) {
  const expansion = new RegExp(`\\$\\{${variable}:-([^}]*)\\}`, "g");
  const specs = [...read(relativePath).matchAll(expansion)].flatMap((match) => match[1].match(SPEC_PATH) ?? []);
  expect(specs, `${relativePath} has no \${${variable}:-...} default naming a spec`).not.toHaveLength(0);
  return specs;
}

describe("e2e spec gates", () => {
  it("CI still runs both e2e entry points", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/run: pnpm test:e2e:smoke\b/);
    expect(ci).toMatch(/run: \.\/scripts\/design-baseline\.sh\b/);
    expect(read("package.json")).toContain('"test:e2e:smoke": "bash ./scripts/e2e-smoke.sh"');
  });

  it("every tests/e2e spec is run by one of them", () => {
    const gated = new Set([
      ...defaultSpecs("scripts/e2e-smoke.sh", "E2E_SPECS"),
      ...defaultSpecs("scripts/design-baseline.sh", "DESIGN_BASELINE_SPEC")
    ]);
    const specs = readdirSync(path.join(ROOT, "tests/e2e"))
      .filter((name) => name.endsWith(".spec.ts"))
      .map((name) => `tests/e2e/${name}`);

    expect(specs.filter((spec) => !gated.has(spec))).toEqual([]);
  });

  it("every gated spec exists", () => {
    const specs = new Set(readdirSync(path.join(ROOT, "tests/e2e")).map((name) => `tests/e2e/${name}`));
    const gated = [
      ...defaultSpecs("scripts/e2e-smoke.sh", "E2E_SPECS"),
      ...defaultSpecs("scripts/design-baseline.sh", "DESIGN_BASELINE_SPEC")
    ];

    expect(gated.filter((spec) => !specs.has(spec))).toEqual([]);
  });
});
