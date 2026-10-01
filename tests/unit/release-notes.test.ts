import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractReleaseNotes, isPrereleaseVersion } from "../../scripts/release-notes.mjs";

const SAMPLE = [
  "# Changelog",
  "",
  "## 2.1.0 - 2026-10-02",
  "",
  "The release.",
  "",
  "### Fixed",
  "",
  "- One thing.",
  "",
  "## 2.1.0-rc.2 - 2026-10-01",
  "",
  "- Candidate two.",
  "",
  "## 2.0.0 - 2026-09-09",
  "",
  "- Major."
].join("\n");

describe("release notes from the changelog", () => {
  it("returns one version's section with its heading, up to the next version", () => {
    expect(extractReleaseNotes(SAMPLE, "2.1.0")).toBe(
      ["## 2.1.0 - 2026-10-02", "", "The release.", "", "### Fixed", "", "- One thing.", ""].join("\n")
    );
    expect(extractReleaseNotes(SAMPLE, "2.0.0")).toBe("## 2.0.0 - 2026-09-09\n\n- Major.\n");
  });

  it("matches the whole version, so a release does not take a candidate's section", () => {
    expect(extractReleaseNotes(SAMPLE, "2.1.0-rc.2")).toBe("## 2.1.0-rc.2 - 2026-10-01\n\n- Candidate two.\n");
    expect(extractReleaseNotes(SAMPLE, "2.1.0")).not.toContain("Candidate two");
    expect(extractReleaseNotes(SAMPLE, "2.1")).toBe("");
  });

  it("returns nothing for a version without a section, which fails the workflow step", () => {
    expect(extractReleaseNotes(SAMPLE, "9.9.9")).toBe("");
  });

  it("calls a tag with a suffix a pre-release", () => {
    expect(isPrereleaseVersion("2.1.0-rc.2")).toBe(true);
    expect(isPrereleaseVersion("2.1.0")).toBe(false);
  });

  it("finds the section of the version in package.json in the real changelog", () => {
    const root = process.cwd();
    const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version as string;
    const notes = extractReleaseNotes(readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), version);
    expect(notes.startsWith(`## ${version} - `)).toBe(true);
  });
});

describe("release workflow", () => {
  const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/release.yml"), "utf8");

  it("creates the GitHub release from the changelog after the images are published", () => {
    // Until 2026-10-01 the workflow published images only; the Releases page stopped at v1.5.17.
    expect(workflow).toContain("contents: write");
    const publish = workflow.indexOf("Publish tested playout release tags");
    const release = workflow.indexOf("Publish the GitHub release");
    expect(publish).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(publish);
    const step = workflow.slice(release);
    expect(step).toContain('node scripts/release-notes.mjs "$version" > release-notes.md');
    expect(step).toContain("gh release create");
    expect(step).toContain("--verify-tag");
    expect(step).toContain("--prerelease");
  });
});
