import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * No rule file or doc points at a file that does not exist.
 *
 * `AGENTS.md` once made every session read `docs/full-product-reset-audit.md` for months after M49
 * had deleted it, and `docs/architecture.md` named a source file under a path it never had. This test
 * reads every backticked repo path in the files below and fails on one that is missing, so a rename
 * or a deletion has to take its references along.
 *
 * Checked: `AGENTS.md`, `PLANS.md`, `README.md`, `CONTRIBUTING.md` and `docs/*.md`. Not checked: the
 * archive under `planning/archive/`, which records history as it was, and `CHANGELOG.md`, whose
 * release sections describe the tree of their release.
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
  return ["AGENTS.md", "PLANS.md", "README.md", "CONTRIBUTING.md", ...docs];
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

function missingReferences(relativeFile: string) {
  const markdown = readFileSync(path.join(ROOT, relativeFile), "utf8");
  return backtickedRepoPaths(markdown)
    .filter(({ path: reference }) => !RUNTIME_PATHS.has(reference))
    .filter(
      ({ path: reference }) =>
        !existsSync(path.join(ROOT, reference)) &&
        !existsSync(path.join(ROOT, path.dirname(relativeFile), reference))
    )
    .map(({ line, path: reference }) => `${relativeFile}:${line} \`${reference}\``);
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

  it.each(checkedFiles())("%s names only files that exist", (relativeFile) => {
    expect(missingReferences(relativeFile)).toEqual([]);
  });
});
