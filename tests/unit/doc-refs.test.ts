import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ADMIN_RUNBOOKS, describeAdminRunbooks } from "../../apps/web/lib/admin-runbooks";

/**
 * No rule file or doc points at a file that does not exist.
 *
 * `AGENTS.md` once made every session read `docs/full-product-reset-audit.md` for months after M49
 * had deleted it, and `docs/architecture.md` named a source file under a path it never had. This test
 * reads every backticked repo path in the files below and fails on one that is missing, so a rename
 * or a deletion has to take its references along.
 *
 * Checked: `AGENTS.md`, `PLANS.md` with the two files it points to since M121 (`planning/dut-checks.md`,
 * `planning/milestone-notes.md`), `README.md`, `CONTRIBUTING.md` and `docs/*.md`. Not checked: the
 * archive under `planning/archive/`, which records history as it was, and `CHANGELOG.md`, whose
 * release sections describe the tree of their release.
 *
 * A path exists when git knows it (tracked, or new and not ignored) and it is on disk. Until the
 * 2026-10-05 review the test asked the disk alone, so it depended on gitignored build output: a
 * reference to `apps/worker/dist/reset-owner-password.js` was red on any checkout whose worker build
 * predated M91 and green only because `pnpm validate` builds before it tests, and a stale ignored copy
 * could hide a deleted tracked file. Build output is now checked through its source file.
 */

const ROOT = process.cwd();

/** Paths that appear in the docs but exist only at run time, inside a container or data volume. */
const RUNTIME_PATHS = new Set(["data/app/state.json"]);

const TOP_LEVEL_DIR = /^(apps|packages|docs|scripts|tests|docker|planning|\.github)\//;
const FILE_EXTENSION = /\.(md|ts|tsx|mts|mjs|cjs|js|json|ya?ml|sh|sql|css|Dockerfile|example|toml)$/;
const PATH_CHARACTERS = /^[A-Za-z0-9_.@\-/[\]]+$/;

function checkedFiles() {
  const docs = readdirSync(path.join(ROOT, "docs"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/${name}`);
  return [
    "AGENTS.md",
    "PLANS.md",
    "planning/dut-checks.md",
    "planning/milestone-notes.md",
    "README.md",
    "CONTRIBUTING.md",
    ...docs
  ];
}

/**
 * The repo paths among the backticked spans of one Markdown text. A span counts as a path when it
 * starts with a top-level directory of the repo, or holds a slash and ends in a file extension, or
 * is a capitalised root file such as `CHANGELOG.md`. A `:line` suffix or `#anchor` is dropped.
 * Absolute paths, URLs, globs and placeholders (`<tag>`) are not repo paths and are skipped.
 */
function backtickedRepoPaths(markdown: string) {
  const found: Array<{ line: number; path: string }> = [];
  markdown.split("\n").forEach((text, index) => {
    // A code span opens and closes with the same number of backticks, so `` `docs/x.md` `` quotes
    // a backticked path literally (an example) and is not itself a reference.
    for (const match of text.matchAll(/(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g)) {
      const candidate = match[2]
        .trim()
        .replace(/#.*$/, "")
        .replace(/:\d+(-\d+)?(,\d+(-\d+)?)*$/, "");
      if (!PATH_CHARACTERS.test(candidate) || candidate.startsWith("/") || candidate.includes("//")) {
        continue;
      }
      const isPath =
        TOP_LEVEL_DIR.test(candidate) ||
        (candidate.includes("/") && FILE_EXTENSION.test(candidate)) ||
        (/^[A-Z][A-Za-z_-]*\.md$/.test(candidate));
      if (isPath) {
        found.push({ line: index + 1, path: candidate });
      }
    }
  });
  return found;
}

/** Every file git knows (tracked, or untracked and not ignored) and every directory above one. */
function repoIndex(files: string[]): Set<string> {
  const index = new Set<string>();
  for (const file of files) {
    index.add(file);
    for (let dir = path.posix.dirname(file); dir !== "."; dir = path.posix.dirname(dir)) {
      index.add(dir);
    }
  }
  return index;
}

function gitRepoIndex(): Set<string> {
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  // `--cached` still lists a tracked file deleted from the working tree, so the disk has the last word.
  return repoIndex(listed.split("\0").filter((file) => file !== "" && existsSync(path.join(ROOT, file))));
}

/**
 * Whether a reference names something in the repo. Build output (`apps/<x>/dist`, `apps/<x>/dist/<name>.js`)
 * is not in git; it counts when the source it is built from (`apps/<x>/src`, `apps/<x>/src/<name>.ts`) is.
 */
function resolvesInRepo(reference: string, index: Set<string>): boolean {
  const normalized = path.posix.normalize(reference).replace(/\/$/, "");
  if (index.has(normalized)) {
    return true;
  }
  const built = normalized.match(/^((?:apps|packages)\/[^/]+)\/dist(?:\/(.+)\.js)?$/);
  if (built === null) {
    return false;
  }
  if (built[2] === undefined) {
    return index.has(`${built[1]}/src`);
  }
  return [".ts", ".tsx", ".mts"].some((extension) => index.has(`${built[1]}/src/${built[2]}${extension}`));
}

function missingReferences(relativeFile: string, index: Set<string>) {
  const markdown = readFileSync(path.join(ROOT, relativeFile), "utf8");
  return backtickedRepoPaths(markdown)
    .filter(({ path: reference }) => !RUNTIME_PATHS.has(reference))
    .filter(
      ({ path: reference }) =>
        !resolvesInRepo(reference, index) &&
        !resolvesInRepo(path.posix.join(path.posix.dirname(relativeFile), reference), index)
    )
    .map(({ line, path: reference }) => `${relativeFile}:${line} \`${reference}\``);
}

/** Where the web app's own text lives; a doc it names reaches the operator on a page or in an error. */
const WEB_SOURCE_DIRS = ["apps/web/app", "apps/web/components", "apps/web/lib"];
const WEB_SOURCE_FILE = /\.(ts|tsx|css)$/;

function webSourceFiles(relativeDir: string): string[] {
  return readdirSync(path.join(ROOT, relativeDir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === ".next" ? [] : webSourceFiles(relative);
    }
    return WEB_SOURCE_FILE.test(entry.name) ? [relative] : [];
  });
}

/**
 * Every `docs/<name>.md` the web source names, with `file:line`, that does not exist. Until M129 the
 * Runbooks line in Admin settings pointed the operator at three docs that were never written.
 */
function missingWebDocReferences(index: Set<string>) {
  return WEB_SOURCE_DIRS.flatMap(webSourceFiles).flatMap((relativeFile) =>
    readFileSync(path.join(ROOT, relativeFile), "utf8")
      .split("\n")
      .flatMap((text, lineIndex) =>
        [...text.matchAll(/\bdocs\/[\w.-]+\.md\b/g)]
          .filter((match) => !resolvesInRepo(match[0], index))
          .map((match) => `${relativeFile}:${lineIndex + 1} \`${match[0]}\``)
      )
  );
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("doc references", () => {
  it("recognises repo paths and skips what is not one", () => {
    const sample = [
      "Read `AGENTS.md` and `docs/operations.md:12`, then `apps/web`.",
      "Not paths: `pnpm validate`, `/root/stream247`, `https://x.y/z.md`, `~/logs/soak-<stamp>.log`, `v2.2.0`.",
      "Anchored: `docs/deployment.md#upgrading`, glob `docs/*.md`, quoted `` `docs/quoted.md` ``."
    ].join("\n");

    expect(backtickedRepoPaths(sample).map((entry) => entry.path)).toEqual([
      "AGENTS.md",
      "docs/operations.md",
      "apps/web",
      "docs/deployment.md"
    ]);
  });

  it("reports a missing path with its file and line", () => {
    expect(backtickedRepoPaths("one\nsee `docs/nope.md`")).toEqual([{ line: 2, path: "docs/nope.md" }]);
  });

  it("counts what git knows, not what lies on disk, and build output through its source", () => {
    const index = repoIndex(["apps/worker/src/reset-owner-password.ts", "docs/operations.md"]);

    expect(resolvesInRepo("apps/worker", index)).toBe(true);
    expect(resolvesInRepo("docs/operations.md", index)).toBe(true);
    expect(resolvesInRepo("apps/worker/dist/reset-owner-password.js", index)).toBe(true);
    expect(resolvesInRepo("apps/worker/dist", index)).toBe(true);
    expect(resolvesInRepo("apps/web/dist", index)).toBe(false);
    // Built (or left over from an old build) on this disk, but from no source in the repo.
    expect(resolvesInRepo("apps/worker/dist/index.js", index)).toBe(false);
    expect(resolvesInRepo("docs/deployment.md", index)).toBe(false);
  });

  const index = gitRepoIndex();
  it.each(checkedFiles())("%s names only files that exist", (relativeFile) => {
    expect(missingReferences(relativeFile, index)).toEqual([]);
  });

  it("web source names only docs that exist", () => {
    expect(missingWebDocReferences(index)).toEqual([]);
  });

  it("Admin settings renders the Runbooks line from the checked list", () => {
    const settingsPage = readFileSync(path.join(ROOT, "apps/web/app/(admin)/settings/page.tsx"), "utf8");
    expect(settingsPage).toContain("{describeAdminRunbooks()}");
    expect(describeAdminRunbooks()).toBe(
      'See "Safe Upgrade Flow" and "Release Channels And Tags" in docs/deployment.md, and "Backup And Restore" in docs/operations.md.'
    );
    expect(describeAdminRunbooks()).not.toMatch(/[*`]/);
  });

  it.each(ADMIN_RUNBOOKS)("the Runbooks line names $doc with its heading $heading", ({ doc, heading }) => {
    expect(resolvesInRepo(doc, index)).toBe(true);
    const markdown = readFileSync(path.join(ROOT, doc), "utf8");
    expect(markdown).toMatch(new RegExp(`^#{2,4} ${escapeRegExp(heading)}\\s*$`, "m"));
  });
});
