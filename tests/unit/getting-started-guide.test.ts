import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAppSecretFilePath } from "../../packages/db/src/app-secret.js";
import { deriveSetupWizardSteps, type SetupWizardStateSlice } from "../../apps/web/lib/server/setup-wizard.js";

// docs/getting-started.md is the page a new operator follows line by line, and a page like that
// goes stale without anything turning red: a variable is renamed in the example file, a compose
// profile is dropped, a wizard step gets a new title, and the guide keeps naming the old one.
// The fresh-compose smoke proves the guide's central path against a running stack; this file keeps
// the things the guide NAMES pointing at things that exist, without Docker.

const rootDir = path.resolve(__dirname, "../..");
const read = (relativePath: string) => readFileSync(path.join(rootDir, relativePath), "utf8");

const guide = read("docs/getting-started.md");
const compose = read("docker-compose.yml");
const productionExample = read(".env.production.example");
const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

/** The body of one numbered section, from its "## N." heading to the next "## " heading. */
function section(number: number): string {
  const start = guide.search(new RegExp(`^## ${number}\\. `, "m"));
  expect(start, `section ${number} of the guide`).toBeGreaterThanOrEqual(0);
  const rest = guide.slice(start + 3);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Every `VARIABLE_NAME` in the first column of the section-3 table. */
function environmentTableVariables(): string[] {
  const names: string[] = [];
  for (const line of section(3).split("\n")) {
    if (!line.startsWith("|") || /^\|\s*-+/.test(line) || line.startsWith("| Variable")) {
      continue;
    }
    const firstColumn = line.split("|")[1] ?? "";
    for (const match of firstColumn.matchAll(/`([A-Z][A-Z0-9_]+)`/g)) {
      names.push(match[1]);
    }
  }
  return names;
}

describe("getting-started guide", () => {
  it("names only environment variables the production example file knows", () => {
    const names = environmentTableVariables();

    // A parser that silently finds nothing would make this test pass on an empty list.
    expect(names).toEqual(expect.arrayContaining(["APP_URL", "APP_SECRET", "POSTGRES_PASSWORD", "DATABASE_URL"]));
    expect(names.length).toBeGreaterThanOrEqual(9);

    for (const name of names) {
      // Commented or not: the guide tells the reader to leave some of them unset, and the example
      // keeps exactly those as a commented line.
      expect(productionExample, `${name} in .env.production.example`).toMatch(new RegExp(`^#?\\s*${name}=`, "m"));
    }
  });

  it("prints commands that refer to things that exist", () => {
    expect(guide).toContain("cp .env.production.example .env");
    expect(existsSync(path.join(rootDir, ".env.production.example"))).toBe(true);

    const composeProfiles = new Set(
      [...compose.matchAll(/^\s*profiles:\s*\[([^\]]*)\]/gm)].flatMap((match) =>
        match[1].split(",").map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
      )
    );
    const guideProfiles = [...guide.matchAll(/docker compose --profile ([a-z0-9-]+)/g)].map((match) => match[1]);
    expect(guideProfiles).toContain("proxy");
    for (const profile of guideProfiles) {
      expect(composeProfiles.has(profile), `compose profile "${profile}"`).toBe(true);
    }

    const guideScripts = [...guide.matchAll(/`pnpm ([a-z0-9:-]+)`/g)].map((match) => match[1]);
    expect(guideScripts).toContain("test:fresh-compose");
    for (const script of guideScripts) {
      expect(packageJson.scripts[script], `package.json script "${script}"`).toBeTruthy();
    }

    const guideFiles = [...guide.matchAll(/`((?:docs\/[a-z0-9-]+|README)\.md)`/g)].map((match) => match[1]);
    expect(guideFiles.length).toBeGreaterThan(0);
    for (const file of guideFiles) {
      expect(existsSync(path.join(rootDir, file)), file).toBe(true);
    }
  });

  it("promises a start without a .env that the compose file and the code can keep", () => {
    // Optional .env: one "required: false" for every env_file block, or one service refuses to
    // start on a checkout that has none.
    const envFileBlocks = compose.match(/^\s*env_file:\s*$/gm) ?? [];
    const optionalEnvFiles = compose.match(/^\s*- path: \.env\n\s*required: false$/gm) ?? [];
    expect(envFileBlocks.length).toBeGreaterThanOrEqual(4);
    expect(optionalEnvFiles.length).toBe(envFileBlocks.length);

    // "The bundled PostgreSQL configures itself": the compose defaults and the code's default
    // connection string have to describe the same database.
    const composeDefault = (name: string) => compose.match(new RegExp(`\\$\\{${name}:-([^}]+)\\}`))?.[1];
    const user = composeDefault("POSTGRES_USER");
    const password = composeDefault("POSTGRES_PASSWORD");
    const database = composeDefault("POSTGRES_DB");
    expect(user && password && database).toBeTruthy();
    expect(read("packages/db/src/index.ts")).toContain(`postgresql://${user}:${password}@postgres:5432/${database}`);

    // The secret path the guide names is the code's default path, seen through the bind mount that
    // web, worker, playout and uplink all carry.
    const containerPath = getAppSecretFilePath({});
    expect(containerPath).toBe("/app/data/media/.stream247-app-secret");
    expect((compose.match(/^\s*- \.\/data\/media:\/app\/data\/media$/gm) ?? []).length).toBe(4);
    expect(section(3)).toContain("`data/media/.stream247-app-secret`");

    // And the smoke that proves it looks in the same place.
    const smoke = read("scripts/fresh-compose-bootstrap-smoke.sh");
    expect(smoke).toContain("data/media/.stream247-app-secret");
    expect(smoke).toContain("--project-directory");
  });

  it("is proven by a smoke that takes nothing from the checkout or the caller's shell", () => {
    // What the running smoke cannot say about itself. Both properties were measured against a
    // stand-in checkout (a symlinked .env, a shell exporting a wrong POSTGRES_PASSWORD); this only
    // keeps the construction from being taken out again without a test noticing.
    const smoke = read("scripts/fresh-compose-bootstrap-smoke.sh");
    const composeCalls = smoke.match(/^\s+docker compose .*$/gm) ?? [];
    expect(composeCalls).toHaveLength(2);
    for (const call of composeCalls) {
      expect(call).toContain("--project-directory");
    }
    expect((smoke.match(/^\s+env "\$\{CLEARED_FROM_CALLER\[@\]\}" \\$/gm) ?? []).length).toBe(2);
    // The checkout's own .env is neither read nor written: no pass may name it.
    expect(smoke).not.toMatch(/\$\{?WORKDIR\}?\/\.env/);
  });

  it("lists the wizard steps under the names and in the order the wizard shows", () => {
    // The titles do not depend on the state; a fresh install is simply the state the guide's reader
    // is in. Nothing is configured, so the managed config is empty rather than spelled out.
    const freshInstall = {
      owner: null,
      managedConfig: {},
      twitch: { status: "not-connected", broadcasterLogin: "" }
    } as unknown as SetupWizardStateSlice;
    const titles = deriveSetupWizardSteps(freshInstall, {}).map((step) => step.title);
    expect(titles).toHaveLength(5);

    const start = section(4);
    let cursor = 0;
    for (const title of titles) {
      const found = start.indexOf(title, cursor);
      expect(found, `wizard step "${title}" in section 4, after the previous step`).toBeGreaterThanOrEqual(0);
      cursor = found + title.length;
    }
  });

  it("is linked from the README", () => {
    expect(read("README.md")).toContain("](docs/getting-started.md)");
  });
});
