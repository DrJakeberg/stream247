import { describe, expect, it } from "vitest";
import {
  buildOverlaySceneMetadataWidgetContent,
  type OverlayScenePayload,
  type OverlaySceneCustomWidgetDataKey
} from "@stream247/core";

/**
 * Text that can be burned into the broadcast has a different audience from text on an admin page.
 *
 * The overlay fills gaps with fallback strings whenever the runtime has not yet said what is
 * playing, and on a channel that runs continuously those gaps happen. They used to read "Queue
 * preview pending", "Playout will add queue detail once it is confirmed." and "Current block
 * unavailable" — the names of internal components, addressed to an operator, in front of whoever
 * happens to be watching.
 *
 * The check runs over an empty payload, which is exactly the case that produces them.
 */

const OPERATOR_WORDS = [
  "playout",
  "runtime",
  "worker",
  "uplink",
  "queue preview",
  "payload",
  "snapshot",
  "metadata",
  "configured",
  "unavailable",
  "not available"
];

const EMPTY_PAYLOAD = {
  queueTitles: [] as string[]
} as unknown as OverlayScenePayload;

const KEYS: OverlaySceneCustomWidgetDataKey[] = ["current", "next", "queue"];

describe("wording that can end up on air", () => {
  it("says something a viewer can read when the runtime has told it nothing", () => {
    for (const widgetDataKey of KEYS) {
      const content = buildOverlaySceneMetadataWidgetContent({ payload: EMPTY_PAYLOAD, widgetDataKey });

      expect(content.label, `${widgetDataKey} label`).toBeTruthy();
      expect(content.title, `${widgetDataKey} title`).toBeTruthy();
    }
  });

  it("keeps operator vocabulary out of every fallback", () => {
    const offenders: string[] = [];

    for (const widgetDataKey of KEYS) {
      const content = buildOverlaySceneMetadataWidgetContent({ payload: EMPTY_PAYLOAD, widgetDataKey });

      for (const text of [content.label, content.title, content.body, content.secondary]) {
        const value = String(text || "");
        if (OPERATOR_WORDS.some((word) => value.toLowerCase().includes(word))) {
          offenders.push(`${widgetDataKey}: ${value}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
