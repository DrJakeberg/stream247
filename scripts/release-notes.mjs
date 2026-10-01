#!/usr/bin/env node
// Prints the CHANGELOG.md section of one version: the text a GitHub release carries.
//
//   node scripts/release-notes.mjs 2.1.0 > release-notes.md
//
// The release workflow published images for every tag but created no GitHub release, so the
// Releases page stopped at v1.5.17 (2026-06-14) while forty tags followed it, v2.0.0 among them
// (noticed by the owner on 2026-10-01). The workflow now creates the release from this output, and
// a version without a CHANGELOG section fails the step instead of publishing an empty release.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The section of `version` in a changelog whose sections start with `## <version> - <date>`,
 * heading included, up to the next `## ` heading. Returns "" when the version has no section.
 * The match is on the whole version, so "2.1.0" does not pick up "2.1.0-rc.1".
 */
export function extractReleaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const isHeadingOf = (line) => {
    const match = /^## (\S+)(\s|$)/.exec(line);
    return Boolean(match) && match[1] === version;
  };
  const start = lines.findIndex(isHeadingOf);
  if (start < 0) {
    return "";
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^## /.test(lines[index])) {
      end = index;
      break;
    }
  }
  return `${lines.slice(start, end).join("\n").trim()}\n`;
}

/** A tag such as v2.1.0-rc.2 is a pre-release; v2.1.0 is not. */
export function isPrereleaseVersion(version) {
  return version.includes("-");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const version = (process.argv[2] ?? "").replace(/^v/, "");
  if (!version) {
    console.error("usage: release-notes.mjs <version>");
    process.exit(2);
  }
  const changelogPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "CHANGELOG.md");
  const notes = extractReleaseNotes(readFileSync(changelogPath, "utf8"), version);
  if (!notes) {
    console.error(`CHANGELOG.md has no section "## ${version} - ...".`);
    process.exit(1);
  }
  process.stdout.write(notes);
}
