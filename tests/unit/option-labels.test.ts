import { describe, expect, it } from "vitest";
import { humanizeOptionValue } from "@/lib/option-labels";

describe("readable option text", () => {
  it("reads a stored value as words", () => {
    expect(humanizeOptionValue("bottom-left")).toBe("Bottom left");
    expect(humanizeOptionValue("top_right")).toBe("Top right");
    expect(humanizeOptionValue("quiet")).toBe("Quiet");
    expect(humanizeOptionValue("card")).toBe("Card");
  });

  it("changes presentation and nothing else", () => {
    // The limit is the point. Nothing in the codebase says how "flood" differs from "active", so
    // this stops short of naming it — a confident label would be a guess wearing a fact's clothes.
    expect(humanizeOptionValue("flood")).toBe("Flood");
    expect(humanizeOptionValue("flood").toLowerCase()).toBe("flood");
  });

  it("returns nothing for nothing", () => {
    expect(humanizeOptionValue("")).toBe("");
    expect(humanizeOptionValue("   ")).toBe("");
    expect(humanizeOptionValue("-")).toBe("");
  });
});
