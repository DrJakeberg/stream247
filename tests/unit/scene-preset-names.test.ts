import { describe, expect, it } from "vitest";
import { OVERLAY_SCENE_PRESETS, OVERLAY_TYPOGRAPHY_PRESETS } from "@stream247/core";
import { describeScenePreset, describeTypographyPreset } from "@/lib/scene-preset-names";

describe("naming a scene preset", () => {
  it("uses the name the picker already shows", () => {
    expect(describeScenePreset("replay-lower-third")).toBe("Replay Lower Third");
    expect(describeScenePreset("bumper-board")).toBe("Bumper Board");
  });

  it("has a name for every preset that exists", () => {
    for (const preset of OVERLAY_SCENE_PRESETS) {
      const label = describeScenePreset(preset.id);
      expect(label).toBe(preset.label);
      expect(label).not.toContain("-");
    }
  });

  it("falls back to the id rather than showing nothing", () => {
    // A preset removed from the table but still stored on a channel should still say something.
    expect(describeScenePreset("gone-from-the-table")).toBe("gone-from-the-table");
    expect(describeScenePreset("")).toBe("");
    expect(describeScenePreset(undefined)).toBe("");
  });
});

describe("naming a typography preset", () => {
  it("has a name for every preset the picker offers", () => {
    for (const preset of OVERLAY_TYPOGRAPHY_PRESETS) {
      const label = describeTypographyPreset(preset.id);
      expect(label).toBe(preset.label);
      expect(label).not.toContain("-");
    }
  });

  it("falls back to the id and says nothing for nothing", () => {
    expect(describeTypographyPreset("gone-from-the-table")).toBe("gone-from-the-table");
    expect(describeTypographyPreset("")).toBe("");
    expect(describeTypographyPreset(undefined)).toBe("");
  });
});
