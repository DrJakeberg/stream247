import { describe, expect, it } from "vitest";
import { resolveBadgeContent } from "../../apps/web/components/ui/Badge";

describe("ui primitives", () => {
  it("does not render badge content for empty or placeholder values", () => {
    expect(resolveBadgeContent("")).toBeNull();
    expect(resolveBadgeContent("   ")).toBeNull();
    expect(resolveBadgeContent("[]")).toBeNull();
  });

  it("keeps visible badge content when text is present", () => {
    expect(resolveBadgeContent("Ready")).toBe("Ready");
    expect(resolveBadgeContent(0)).toBe(0);
  });
});
