import { describe, expect, it } from "vitest";
import { shouldRefuseEmptyAssetReplacement } from "@stream247/db";

// replaceAssetsForSourceIds is a `DELETE ... WHERE source_id = ANY(...)` followed by re-inserting
// whatever the caller collected. Its only guard was `sourceIds.length === 0`; the asset list was
// never looked at, so any caller that computed a delete list and an insert list separately could
// hand it an empty insert list and empty a populated source. Every wipe in this repo's history had
// that shape. This is the layer that refuses it even when a caller gets it wrong.
describe("shouldRefuseEmptyAssetReplacement", () => {
  it("refuses to empty a source that currently holds assets", () => {
    expect(
      shouldRefuseEmptyAssetReplacement({ incomingAssetCount: 0, storedAssetCount: 49, allowEmptyReplacement: false })
    ).toBe(true);
  });

  // Emptying a source is legitimate — an operator really did remove the last file — but it has to
  // be stated, not inferred from a list that may simply have failed to be built.
  it("allows an empty replacement when the caller opts in explicitly", () => {
    expect(
      shouldRefuseEmptyAssetReplacement({ incomingAssetCount: 0, storedAssetCount: 49, allowEmptyReplacement: true })
    ).toBe(false);
  });

  it("never interferes with a source that is already empty", () => {
    expect(
      shouldRefuseEmptyAssetReplacement({ incomingAssetCount: 0, storedAssetCount: 0, allowEmptyReplacement: false })
    ).toBe(false);
  });

  // Deliberately not a percentage threshold: a source shrinking from 49 to 1 is a normal
  // playlist edit, and a rule that blocked it would leave stale rows on air forever.
  it("never blocks a shrinking but non-empty result", () => {
    expect(
      shouldRefuseEmptyAssetReplacement({ incomingAssetCount: 1, storedAssetCount: 49, allowEmptyReplacement: false })
    ).toBe(false);
  });
});
