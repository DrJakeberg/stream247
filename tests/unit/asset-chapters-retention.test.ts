import { describe, expect, it } from "vitest";
import { chooseStoredAssetChaptersJson } from "@stream247/db";

const ingestedChapters = JSON.stringify([
  { offsetSeconds: 0, categoryName: "Just Chatting", title: "Just Chatting" },
  { offsetSeconds: 600, categoryName: "Elden Ring", title: "Elden Ring" }
]);

const editedChapters = JSON.stringify([{ offsetSeconds: 300, categoryName: "Music", title: "Operator cut" }]);

describe("chapter retention across re-ingest", () => {
  it("fills chapters when the stored list is empty", () => {
    expect(chooseStoredAssetChaptersJson("[]", ingestedChapters)).toBe(ingestedChapters);
    expect(chooseStoredAssetChaptersJson(undefined, ingestedChapters)).toBe(ingestedChapters);
  });

  it("never overwrites a non-empty stored list — operator edits survive every sync", () => {
    expect(chooseStoredAssetChaptersJson(editedChapters, ingestedChapters)).toBe(editedChapters);
  });

  it("treats corrupt stored JSON as empty so ingest can repair it", () => {
    // A stored value that no longer parses cannot carry an operator's intent; refilling from the
    // source is strictly better than keeping bytes nobody can read.
    expect(chooseStoredAssetChaptersJson("{broken", ingestedChapters)).toBe(ingestedChapters);
  });

  it("stays empty when neither side has chapters — the rollback shape", () => {
    expect(chooseStoredAssetChaptersJson(undefined, undefined)).toBe("[]");
    expect(chooseStoredAssetChaptersJson("[]", "[]")).toBe("[]");
  });
});
