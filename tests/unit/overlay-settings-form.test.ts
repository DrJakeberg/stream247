import { normalizeOverlaySceneCustomLayers } from "@stream247/core";
import { describe, expect, it } from "vitest";
import { createDefaultCustomLayer } from "../../apps/web/lib/overlay-studio-defaults";

describe("overlay settings form widget defaults", () => {
  it("starts fresh widget layers without a metadata label override", () => {
    const widget = createDefaultCustomLayer("widget");

    expect(widget).toEqual(
      expect.objectContaining({
        kind: "widget",
        title: "",
        widgetMode: "embed",
        widgetDataKey: "current"
      })
    );

    const [metadataWidget] = normalizeOverlaySceneCustomLayers([
      {
        ...widget,
        widgetMode: "metadata"
      }
    ]);

    expect(metadataWidget).toEqual(
      expect.objectContaining({
        kind: "widget",
        widgetMode: "metadata",
        widgetDataKey: "current",
        title: ""
      })
    );
  });
});
