import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAppSecretFilePath } from "../../packages/db/src/app-secret.js";
import { deriveSetupWizardSteps, type SetupWizardStateSlice } from "../../apps/web/lib/server/setup-wizard.js";
import { TWITCH_ACCOUNT_COUNT_SENTENCE, TWITCH_DEVELOPER_CONSOLE_URL } from "../../apps/web/lib/twitch-account-texts.js";

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

/** Every `VARIABLE_NAME` in the first column of the section-4 table. */
function environmentTableVariables(): string[] {
  const names: string[] = [];
  for (const line of section(4).split("\n")) {
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
    expect(section(4)).toContain("`data/media/.stream247-app-secret`");

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
    expect(titles).toHaveLength(7);

    const start = section(5);
    let cursor = 0;
    for (const title of titles) {
      const found = start.indexOf(title, cursor);
      expect(found, `wizard step "${title}" in section 5, after the previous step`).toBeGreaterThanOrEqual(0);
      cursor = found + title.length;
    }
  });

  it("is linked from the README", () => {
    expect(read("README.md")).toContain("](docs/getting-started.md)");
  });
});

// M92 "Getting started a stranger can follow" (planning/research/ux-install.md I3, I4, I5).
describe("getting-started guide from an empty host (M92)", () => {
  /** One paragraph per array entry, with its line breaks folded into single spaces. */
  const paragraphs = (text: string) => text.split(/\n\s*\n/).map((paragraph) => paragraph.replace(/\s+/g, " ").trim());

  it("I4: gets the files the compose file reads from a release tag, by clone or by download", () => {
    const getFiles = section(1);
    expect(getFiles).toMatch(/^1\. Get the files\n/);
    expect(getFiles).toContain("git clone --depth 1 --branch vX.Y.Z https://github.com/DrJakeberg/stream247.git");

    // Everything the compose file bind-mounts from the repository (not the data/ it creates itself) has
    // to be downloaded, under the same relative path, from the same tag as the compose file.
    const repoMounts = [...compose.matchAll(/^\s*- \.\/((?!data\/)[^:]+):/gm)].map((match) => match[1]);
    expect(repoMounts).toEqual(["docker/mediamtx.yml"]);
    const downloads = [...getFiles.matchAll(/curl -fsSL -o (\S+) "https:\/\/raw\.githubusercontent\.com\/DrJakeberg\/stream247\/\$TAG\/(\S+)"/g)];
    const downloaded = new Map(downloads.map((match) => [match[2], match[1]]));
    for (const file of ["docker-compose.yml", ...repoMounts]) {
      expect(downloaded.get(file), `${file} downloaded to its own path`).toBe(file);
      expect(existsSync(path.join(rootDir, file)), file).toBe(true);
    }
    for (const file of downloaded.keys()) {
      expect(existsSync(path.join(rootDir, file)), `downloaded ${file} exists in the repository`).toBe(true);
    }
    expect(getFiles).toContain("mkdir -p stream247/docker");
  });

  it("I4: links the Twitch developer console in the guide and in setup step 3", () => {
    expect(TWITCH_DEVELOPER_CONSOLE_URL).toBe("https://dev.twitch.tv/console/apps");
    expect(section(3)).toContain(`<${TWITCH_DEVELOPER_CONSOLE_URL}>`);
    expect(guide.match(/dev\.twitch\.tv\/console/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    const setupPage = read("apps/web/app/setup/page.tsx");
    const stepThree = setupPage.slice(setupPage.indexOf('active === "twitch-app"'), setupPage.indexOf('active === "twitch-connect"'));
    expect(stepThree).toContain("href={TWITCH_DEVELOPER_CONSOLE_URL}");
  });

  it("I4: has a numbered stream-key step that names where the key comes from and where it goes", () => {
    const streamKey = section(7);
    expect(streamKey).toMatch(/^7\. Stream key\n/);
    const steps = [...streamKey.slice(streamKey.indexOf("\n")).matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));
    expect(steps).toEqual([1, 2, 3, 4]);
    expect(streamKey).toContain("broadcast channel");
    // Since M99 the form lives in Studio → Output, and the wizard asks for the key itself.
    expect(streamKey).toContain("`Studio → Output → Output destinations`");
    expect(streamKey).toContain("*Where the stream goes*");
    expect(streamKey).toContain("*Managed stream key*");
    // The names it gives are the ones the screens show.
    expect(read("apps/web/app/(admin)/output/page.tsx")).toContain('title="Output destinations"');
    expect(read("apps/web/app/(admin)/output/page.tsx")).toContain("<summary>Change this destination</summary>");
    expect(read("apps/web/lib/server/setup-wizard.ts")).toContain('title: "Where the stream goes"');
    expect(read("apps/web/components/destination-settings-form.tsx")).toContain("Managed stream key<InfoTip");
    expect(read("packages/db/src/index.ts")).toContain('name: "Primary Twitch Output"');
    expect(read("apps/web/lib/server/onboarding.ts")).toContain('title: "Live destination"');
    expect(streamKey).toContain("*Live destination*");
    // And the readiness note in section 6 sends the reader to it, not to media and programme.
    expect(section(6)).toContain("(sections 7 and 8)");
  });

  it("I5: says how many Twitch accounts are needed in the same sentence as the wizard", () => {
    expect(paragraphs(section(2))).toContain(TWITCH_ACCOUNT_COUNT_SENTENCE);
    expect(read("apps/web/app/setup/page.tsx")).toContain("{TWITCH_ACCOUNT_COUNT_SENTENCE}");
    // The sentence it replaced told the reader the opposite of what the wizard allows.
    expect(guide).not.toContain("make it simpler");
  });
});

/** The first `## X.Y.Z` heading of a changelog; `## X.Y.Z-rc.N` and other headings do not count. */
function newestReleaseVersion(changelog: string): string | undefined {
  return changelog.match(/^## (\d+\.\d+\.\d+)(?= |$)/m)?.[1];
}

// I3: the compose file a stranger downloads from a release tag has to start that release. The release
// commit sets the image defaults by hand; this turns a release commit that forgets them red.
describe("compose image defaults follow the newest release (M92, I3)", () => {
  it("pins web, worker, playout and uplink to the newest non-rc version in CHANGELOG.md", () => {
    const newestRelease = newestReleaseVersion(read("CHANGELOG.md"));
    expect(newestRelease, "a `## X.Y.Z` heading in CHANGELOG.md").toBeTruthy();

    const defaults = [...compose.matchAll(/image: \$\{STREAM247_[A-Z]+_IMAGE:-ghcr\.io\/drjakeberg\/stream247-([a-z]+):v([^}]+)\}/g)].map(
      (match) => ({ image: match[1], tag: match[2] })
    );
    // web, worker, playout, and the uplink running the worker image.
    expect(defaults.map((entry) => entry.image)).toEqual(["web", "worker", "playout", "worker"]);
    for (const entry of defaults) {
      expect(entry.tag, `compose default of stream247-${entry.image}`).toBe(newestRelease);
    }
  });

  it("skips release candidates when it looks for the newest release", () => {
    const sample = "# Changelog\n\n## 2.3.0-rc.1 - 2026-11-01\n\n## 2.2.0 - 2026-10-02\n";
    expect(newestReleaseVersion(sample)).toBe("2.2.0");
    expect(newestReleaseVersion("# Changelog\n\n## Unreleased\n\n## 2.0.0-rc.6 - 2026-09-07\n")).toBeUndefined();
  });
});
