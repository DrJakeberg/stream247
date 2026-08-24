import { OVERLAY_SCENE_PRESETS, type OverlayScenePreset } from "@stream247/core";

/**
 * The name a scene preset already has, wherever it is mentioned.
 *
 * The product knows these are called "Replay Lower Third" and "Bumper Board" — the picker that
 * selects them says so. Everywhere they were merely *reported*, they appeared as the id:
 * "Preset replay-lower-third · glass surface", "Asset replay-lower-third · Insert bumper-board".
 * Same value, two vocabularies, depending on whether you were choosing it or reading about it.
 */
export function describeScenePreset(preset: OverlayScenePreset | string | undefined): string {
  const id = String(preset || "");
  if (!id) {
    return "";
  }

  return OVERLAY_SCENE_PRESETS.find((entry) => entry.id === id)?.label ?? id;
}
