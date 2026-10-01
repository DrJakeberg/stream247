import { describe, expect, it } from "vitest";
import { normalizeSourceRecords } from "@stream247/db";

// Regression guard for a fresh install that never came up.
//
// `sources.connector_kind` is NOT NULL, and passing an explicit null bypasses the column default.
// Legacy state files predate the field, so a state carrying them aborted the first write and left
// persistence in "error" for the life of the deployment — the workspace could not be bootstrapped
// at all. Nothing in the unit or integration suites covered it, because both start from
// defaultState(), which has the field.

function sourceState(sources: unknown[]) {
  return { sources: normalizeSourceRecords(sources as never) };
}

describe("legacy source normalisation", () => {
  it("never leaves connectorKind unset", () => {
    const [source] = sourceState([{ id: "s1", name: "Whatever", type: "Something" }]).sources;

    expect(source?.connectorKind).toBeTruthy();
  });

  it("keeps an explicit connector kind", () => {
    const [source] = sourceState([{ id: "s1", name: "Local", type: "Filesystem scan", connectorKind: "direct-media" }]).sources;

    expect(source?.connectorKind).toBe("direct-media");
  });

  it("infers from the type instead of labelling everything local", () => {
    // Mislabelling a remote source as local would make the worker try to scan it off disk.
    const cases: [string, string, string][] = [
      ["Twitch VOD sync", "Twitch Archive", "twitch-vod"],
      ["Twitch channel sync", "Twitch Live", "twitch-channel"],
      ["Managed ingestion", "YouTube Playlist", "youtube-playlist"],
      ["YouTube channel", "Uploads", "youtube-channel"],
      ["Direct media URL", "CDN drop", "direct-media"],
      ["Filesystem scan", "Local Media Library", "local-library"]
    ];

    for (const [type, name, expected] of cases) {
      const [source] = sourceState([{ id: "s1", name, type }]).sources;
      expect(source?.connectorKind, `${type} / ${name}`).toBe(expected);
    }
  });

  it("falls back to the column default for an unrecognisable source", () => {
    const [source] = sourceState([{ id: "s1", name: "", type: "" }]).sources;

    expect(source?.connectorKind).toBe("local-library");
  });

  it("normalises the exact shape that broke bootstrap", () => {
    // Taken from a real legacy data/app/state.json: no connectorKind on any entry.
    const normalized = sourceState([
      { id: "source-youtube", name: "YouTube Playlist", type: "Managed ingestion", status: "Ready" },
      { id: "source-twitch", name: "Twitch Archive", type: "Twitch VOD sync", status: "Ready" },
      { id: "source-fallback", name: "Fallback Loop", type: "Filesystem scan", status: "Standby" }
    ]);

    expect(normalized.sources).toHaveLength(3);
    for (const source of normalized.sources) {
      expect(source.connectorKind, source.id).toBeTruthy();
    }
  });
});
