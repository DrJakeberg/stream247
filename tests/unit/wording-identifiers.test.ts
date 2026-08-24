import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * No stored identifiers in text people read.
 *
 * This started as a shell one-liner run by hand, and it worked: it found
 * "scheduled_match" on five pages, "replay-lower-third" where the picker says "Replay Lower Third",
 * "dev-source" where a source name belongs. Thirty-four leaks down to none.
 *
 * It is a test now because of how it went wrong. Separating identifiers from ordinary hyphenated
 * English needs a list of exceptions, that list lived in the command, and I kept adding to it as I
 * went — including "worker-side" and "local-library", which were not English at all but sentences
 * describing our architecture to an operator. The scan then reported zero and was right about what
 * it had been told to look for. A filter that accumulates exceptions quietly becomes the blind spot
 * it was written to remove.
 *
 * So the exceptions live here, each one a compound a person would say out loud, and adding to them
 * is a change someone can see.
 */

const SNAPSHOT_DIR = path.join(process.cwd(), "tests/e2e/wording-baseline.spec.ts-snapshots");

/** Shapes that only ever come from a database column or a config key. */
const IDENTIFIER = /\b(?:[a-z]+_[a-z_]+|[a-z]+-[a-z-]+|[a-z]+[A-Z][a-zA-Z]+)\b/g;

/** Placeholders this baseline substitutes for values that legitimately vary. */
const PLACEHOLDER = /<(timestamp|time|version|digest|id|age|runtime)>/g;

/**
 * Ordinary English that happens to carry a hyphen. Every entry is a phrase someone would say;
 * none of them names a component, a table, or a process.
 */
const ENGLISH_COMPOUNDS = new Set([
  "auto-selected",
  "backup-and-restore",
  "broadcast-style",
  "browser-based",
  "channel-point",
  "chatter-participation",
  "check-in",
  "curated-set",
  "dual-card",
  "embed-safe",
  "emote-only",
  "fresh-boot",
  "in-stream",
  "lower-third",
  "now-playing",
  "off-air",
  "on-air",
  "on-stream",
  "one-off",
  "per-destination",
  "programming-facing",
  "re-apply",
  "read-only",
  "round-robin",
  "self-hosted",
  "sign-in",
  "stream-output",
  "two-factor",
  "viewer-facing",
  "workspace-wide"
]);

function readSnapshots(): Array<{ surface: string; text: string }> {
  return readdirSync(SNAPSHOT_DIR)
    .filter((file) => file.endsWith(".txt"))
    .map((file) => ({
      surface: file.replace("-chromium-linux.txt", ""),
      text: readFileSync(path.join(SNAPSHOT_DIR, file), "utf8")
    }));
}

describe("no stored identifiers in text people read", () => {
  it("has snapshots to check", () => {
    // Guards the failure mode where an empty directory reads as a clean sweep.
    expect(readSnapshots().length).toBeGreaterThanOrEqual(10);
  });

  it("finds none across every recorded surface", () => {
    const offenders: string[] = [];

    for (const { surface, text } of readSnapshots()) {
      for (const match of text.replace(PLACEHOLDER, "").matchAll(IDENTIFIER)) {
        const token = match[0].toLowerCase();
        if (!ENGLISH_COMPOUNDS.has(token)) {
          offenders.push(`${surface}: ${match[0]}`);
        }
      }
    }

    expect([...new Set(offenders)]).toEqual([]);
  });

  it("keeps the exception list honest", () => {
    // Every exception must still appear somewhere, or it is a rule nobody needs that will one day
    // wave through something real. Underscores are never English.
    const all = readSnapshots()
      .map(({ text }) => text.toLowerCase())
      .join("\n");

    for (const compound of ENGLISH_COMPOUNDS) {
      expect(compound, `${compound} is no longer on any surface`).toSatisfy((value: string) =>
        all.includes(value)
      );
      expect(compound).not.toContain("_");
    }
  });
});
