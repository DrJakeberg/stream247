"use client";

import {
  OVERLAY_SCENE_CUSTOM_LAYER_KINDS,
  OVERLAY_SCENE_CUSTOM_TEXT_FONT_MODES,
  OVERLAY_SCENE_CUSTOM_WIDGET_DATA_KEYS,
  OVERLAY_SCENE_LAYERS,
  OVERLAY_PANEL_ANCHORS,
  OVERLAY_SCENE_PRESETS,
  OVERLAY_SURFACE_STYLES,
  OVERLAY_TYPOGRAPHY_PRESETS,
  OVERLAY_TITLE_SCALES,
  buildOverlayScenePayload,
  describeOverlaySceneFrameSupport,
  resolveOverlayHeadlineForQueueKind,
  type OverlayQueueKind,
  type OverlaySceneCustomMediaFit,
  type OverlaySceneCustomTextAlign,
  type OverlaySceneCustomTextFontMode,
  type OverlaySceneCustomTextTone,
  type OverlaySceneCustomWidgetDataKey,
  type OverlaySceneCustomLayerKind,
  type OverlaySceneLayerKind
} from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { OverlaySceneCanvas } from "@/components/overlay-scene-canvas";
import type { OverlayScenePresetRecord, OverlaySettingsRecord } from "@/lib/server/state";

type OverlayPreviewSeed = {
  timeZone: string;
  currentTitle: string;
  currentCategory: string;
  currentSourceName: string;
  nextTitle: string;
  nextTimeLabel: string;
  queueTitles: string[];
};

type OverlayDraftCustomLayer = OverlaySettingsRecord["customLayers"][number];

function createSceneCustomLayerId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultCustomLayer(kind: OverlaySceneCustomLayerKind): OverlayDraftCustomLayer {
  const id = createSceneCustomLayerId();

  if (kind === "text") {
    return {
      id,
      kind,
      name: "Text Layer",
      enabled: true,
      xPercent: 4,
      yPercent: 10,
      widthPercent: 34,
      heightPercent: 16,
      opacityPercent: 100,
      text: "Fresh scene copy",
      secondaryText: "",
      textTone: "headline",
      textAlign: "left",
      useAccent: false,
      fontMode: "preset",
      customFontFamily: ""
    };
  }

  if (kind === "logo") {
    return {
      id,
      kind,
      name: "Logo Layer",
      enabled: true,
      xPercent: 76,
      yPercent: 8,
      widthPercent: 16,
      heightPercent: 12,
      opacityPercent: 100,
      url: "",
      altText: "",
      fit: "contain"
    };
  }

  if (kind === "image") {
    return {
      id,
      kind,
      name: "Image Layer",
      enabled: true,
      xPercent: 62,
      yPercent: 10,
      widthPercent: 28,
      heightPercent: 24,
      opacityPercent: 100,
      url: "",
      altText: "",
      fit: "cover"
    };
  }

  if (kind === "widget") {
    return {
      id,
      kind,
      name: "Widget Layer",
      enabled: true,
      xPercent: 56,
      yPercent: 8,
      widthPercent: 38,
      heightPercent: 28,
      opacityPercent: 100,
      url: "",
      title: "Widget frame",
      widgetMode: "embed",
      widgetDataKey: "current"
    };
  }

  return {
    id,
    kind: "embed",
    name: "Embed Layer",
    enabled: true,
    xPercent: 56,
    yPercent: 8,
    widthPercent: 38,
    heightPercent: 28,
    opacityPercent: 100,
    url: "",
    title: "Embed frame"
  };
}

function overlaySignature(overlay: OverlaySettingsRecord): string {
  return JSON.stringify({
    enabled: overlay.enabled,
    channelName: overlay.channelName,
    headline: overlay.headline,
    insertHeadline: overlay.insertHeadline,
    standbyHeadline: overlay.standbyHeadline,
    reconnectHeadline: overlay.reconnectHeadline,
    replayLabel: overlay.replayLabel,
    brandBadge: overlay.brandBadge,
    scenePreset: overlay.scenePreset,
    insertScenePreset: overlay.insertScenePreset,
    standbyScenePreset: overlay.standbyScenePreset,
    reconnectScenePreset: overlay.reconnectScenePreset,
    accentColor: overlay.accentColor,
    surfaceStyle: overlay.surfaceStyle,
    panelAnchor: overlay.panelAnchor,
    titleScale: overlay.titleScale,
    typographyPreset: overlay.typographyPreset,
    showClock: overlay.showClock,
    showNextItem: overlay.showNextItem,
    showScheduleTeaser: overlay.showScheduleTeaser,
    showCurrentCategory: overlay.showCurrentCategory,
    showSourceLabel: overlay.showSourceLabel,
    showQueuePreview: overlay.showQueuePreview,
    queuePreviewCount: overlay.queuePreviewCount,
    layerOrder: overlay.layerOrder,
    disabledLayers: overlay.disabledLayers,
    customLayers: overlay.customLayers,
    emergencyBanner: overlay.emergencyBanner,
    tickerText: overlay.tickerText
  });
}

export function OverlaySettingsForm(props: {
  liveOverlay: OverlaySettingsRecord;
  draftOverlay: OverlaySettingsRecord;
  scenePresets: OverlayScenePresetRecord[];
  hasUnpublishedChanges: boolean;
  basedOnUpdatedAt: string;
  preview: OverlayPreviewSeed;
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [previewMode, setPreviewMode] = useState<OverlayQueueKind>("asset");
  const [draft, setDraft] = useState<OverlaySettingsRecord>(props.draftOverlay);
  const [scenePresets, setScenePresets] = useState<OverlayScenePresetRecord[]>(props.scenePresets);
  const [presetName, setPresetName] = useState("");
  const [presetDescription, setPresetDescription] = useState("");
  const router = useRouter();
  const hasLocalChanges = overlaySignature(draft) !== overlaySignature(props.draftOverlay);
  const canPublish = hasLocalChanges || props.hasUnpublishedChanges;
  const canReset = hasLocalChanges || props.hasUnpublishedChanges;

  const setDraftField = <K extends keyof OverlaySettingsRecord>(key: K, value: OverlaySettingsRecord[K]) => {
    setDraft((current) => ({
      ...current,
      [key]: value
    }));
  };

  const addCustomLayer = (kind: OverlaySceneCustomLayerKind) => {
    setDraft((current) => ({
      ...current,
      customLayers: [...current.customLayers, createDefaultCustomLayer(kind)]
    }));
  };

  const updateCustomLayer = (id: string, updater: (layer: OverlayDraftCustomLayer) => OverlayDraftCustomLayer) => {
    setDraft((current) => ({
      ...current,
      customLayers: current.customLayers.map((layer) => (layer.id === id ? updater(layer) : layer))
    }));
  };

  const removeCustomLayer = (id: string) => {
    setDraft((current) => ({
      ...current,
      customLayers: current.customLayers.filter((layer) => layer.id !== id)
    }));
  };

  const moveCustomLayer = (id: string, direction: -1 | 1) => {
    setDraft((current) => {
      const nextLayers = [...current.customLayers];
      const index = nextLayers.findIndex((layer) => layer.id === id);
      if (index === -1) {
        return current;
      }

      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= nextLayers.length) {
        return current;
      }

      [nextLayers[index], nextLayers[targetIndex]] = [nextLayers[targetIndex], nextLayers[index]];
      return {
        ...current,
        customLayers: nextLayers
      };
    });
  };

  const moveLayer = (kind: OverlaySceneLayerKind, direction: -1 | 1) => {
    setDraft((current) => {
      const nextOrder = [...current.layerOrder];
      const index = nextOrder.indexOf(kind);
      if (index === -1) {
        return current;
      }

      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= nextOrder.length) {
        return current;
      }

      [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
      return {
        ...current,
        layerOrder: nextOrder
      };
    });
  };

  const toggleLayerVisibility = (kind: OverlaySceneLayerKind) => {
    setDraft((current) => ({
      ...current,
      disabledLayers: current.disabledLayers.includes(kind)
        ? current.disabledLayers.filter((entry) => entry !== kind)
        : [...current.disabledLayers, kind]
    }));
  };

  const previewSubtitle =
    resolveOverlayHeadlineForQueueKind(draft.headline, previewMode, {
      insertHeadline: draft.insertHeadline,
      standbyHeadline: draft.standbyHeadline,
      reconnectHeadline: draft.reconnectHeadline
    });

  const previewCurrentTitle =
    previewMode === "asset"
      ? props.preview.currentTitle
      : previewMode === "insert"
        ? "Channel ID"
        : previewMode === "reconnect"
          ? "Scheduled reconnect"
          : "Replay standby";

  const previewNextTitle =
    previewMode === "reconnect" ? props.preview.currentTitle : props.preview.nextTitle || "Programming resumes shortly";
  const previewPayload = buildOverlayScenePayload({
    overlay: draft,
    queueKind: previewMode,
    target: "browser",
    currentTitle: previewCurrentTitle,
    currentCategory: props.preview.currentCategory,
    currentSourceName: props.preview.currentSourceName,
    nextTitle: previewNextTitle,
    nextTimeLabel: props.preview.nextTimeLabel,
    queueTitles: props.preview.queueTitles,
    modeSubtitle: previewSubtitle,
    timeZone: props.preview.timeZone
  });

  const saveScenePreset = () => {
    setError("");
    setMessage("");

    startTransition(async () => {
      const response = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          name: presetName,
          description: presetDescription,
          draft
        })
      });

      const payload = (await response.json()) as {
        message?: string;
        presets?: OverlayScenePresetRecord[];
      };
      if (!response.ok) {
        setError(payload.message ?? "Could not save scene preset.");
        return;
      }

      setScenePresets(payload.presets ?? []);
      setPresetName("");
      setPresetDescription("");
      setMessage(payload.message ?? "Scene preset saved.");
    });
  };

  const applyScenePreset = (presetId: string) => {
    setError("");
    setMessage("");

    startTransition(async () => {
      const response = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          presetId
        })
      });

      const payload = (await response.json()) as {
        message?: string;
        presets?: OverlayScenePresetRecord[];
        studioState?: {
          draftOverlay?: OverlaySettingsRecord;
        };
      };
      if (!response.ok) {
        setError(payload.message ?? "Could not apply scene preset.");
        return;
      }

      if (payload.studioState?.draftOverlay) {
        setDraft(payload.studioState.draftOverlay);
      }
      setScenePresets(payload.presets ?? []);
      setMessage(payload.message ?? "Scene preset applied to draft.");
      router.refresh();
    });
  };

  const deleteScenePreset = (presetId: string) => {
    setError("");
    setMessage("");

    startTransition(async () => {
      const response = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          presetId
        })
      });

      const payload = (await response.json()) as {
        message?: string;
        presets?: OverlayScenePresetRecord[];
      };
      if (!response.ok) {
        setError(payload.message ?? "Could not delete scene preset.");
        return;
      }

      setScenePresets(payload.presets ?? []);
      setMessage(payload.message ?? "Scene preset deleted.");
    });
  };

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setMessage("");

        startTransition(async () => {
          const response = await fetch("/api/overlay", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draft)
          });

          const payload = (await response.json()) as { message?: string; draftOverlay?: OverlaySettingsRecord };
          if (!response.ok) {
            setError(payload.message ?? "Could not save overlay settings.");
            return;
          }

          if (payload.draftOverlay) {
            setDraft(payload.draftOverlay);
          }
          setMessage(payload.message ?? "Overlay settings updated.");
          router.refresh();
        });
      }}
    >
      <div className="scene-designer-grid">
        <div className="scene-designer-preview">
          <div className="scene-preview-toolbar">
            <span className="label">Scene Preview</span>
            <select onChange={(event) => setPreviewMode(event.target.value as OverlayQueueKind)} value={previewMode}>
              <option value="asset">Regular asset</option>
              <option value="insert">Insert / bumper</option>
              <option value="standby">Standby</option>
              <option value="reconnect">Reconnect</option>
            </select>
          </div>
          <div className="scene-preview-shell">
            <OverlaySceneCanvas payload={previewPayload} />
          </div>
        </div>

        <div className="scene-designer-sidebar">
          <div className="toggle-row">
            <input
              checked={draft.enabled}
              id="overlay-enabled"
              name="enabled"
              onChange={(event) => setDraftField("enabled", event.target.checked)}
              type="checkbox"
            />
            <label htmlFor="overlay-enabled">Enable browser-source overlay</label>
          </div>

          <div className="form-grid">
            <label>
              <span className="label">Channel name</span>
              <input onChange={(event) => setDraftField("channelName", event.target.value)} required value={draft.channelName} />
            </label>
            <label>
              <span className="label">Headline</span>
              <input onChange={(event) => setDraftField("headline", event.target.value)} required value={draft.headline} />
            </label>
            <label>
              <span className="label">Insert headline</span>
              <input onChange={(event) => setDraftField("insertHeadline", event.target.value)} required value={draft.insertHeadline} />
            </label>
            <label>
              <span className="label">Standby headline</span>
              <input onChange={(event) => setDraftField("standbyHeadline", event.target.value)} required value={draft.standbyHeadline} />
            </label>
            <label>
              <span className="label">Reconnect headline</span>
              <input onChange={(event) => setDraftField("reconnectHeadline", event.target.value)} required value={draft.reconnectHeadline} />
            </label>
            <label>
              <span className="label">Replay label</span>
              <input onChange={(event) => setDraftField("replayLabel", event.target.value)} required value={draft.replayLabel} />
            </label>
            <label>
              <span className="label">Brand badge</span>
              <input onChange={(event) => setDraftField("brandBadge", event.target.value)} placeholder="e.g. Archive Channel" value={draft.brandBadge} />
            </label>
            <label>
              <span className="label">Accent color</span>
              <input onChange={(event) => setDraftField("accentColor", event.target.value)} required value={draft.accentColor} />
            </label>
            <label>
              <span className="label">Ticker text</span>
              <input onChange={(event) => setDraftField("tickerText", event.target.value)} placeholder="Optional lower ticker line" value={draft.tickerText} />
            </label>
          </div>

          <label>
            <span className="label">Active scene preset</span>
            <select onChange={(event) => setDraftField("scenePreset", event.target.value as OverlaySettingsRecord["scenePreset"])} value={draft.scenePreset}>
              {OVERLAY_SCENE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <div className="preset-grid">
            {OVERLAY_SCENE_PRESETS.map((preset) => (
              <button
                className={`preset-card${preset.id === draft.scenePreset ? " preset-card-active" : ""}`}
                key={preset.id}
                onClick={() => setDraftField("scenePreset", preset.id)}
                type="button"
              >
                <strong>{preset.label}</strong>
                <div className="subtle">{preset.description}</div>
              </button>
            ))}
          </div>

          <div className="form-grid">
            <label>
              <span className="label">Insert scene preset</span>
              <select
                onChange={(event) => setDraftField("insertScenePreset", event.target.value as OverlaySettingsRecord["insertScenePreset"])}
                value={draft.insertScenePreset}
              >
                {OVERLAY_SCENE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <span className="subtle">Used for manual and automatic inserts between regular programming.</span>
            </label>
            <label>
              <span className="label">Standby scene preset</span>
              <select
                onChange={(event) => setDraftField("standbyScenePreset", event.target.value as OverlaySettingsRecord["standbyScenePreset"])}
                value={draft.standbyScenePreset}
              >
                {OVERLAY_SCENE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <span className="subtle">Used while the stream is on air but waiting for the next playable item.</span>
            </label>
            <label>
              <span className="label">Reconnect scene preset</span>
              <select
                onChange={(event) => setDraftField("reconnectScenePreset", event.target.value as OverlaySettingsRecord["reconnectScenePreset"])}
                value={draft.reconnectScenePreset}
              >
                {OVERLAY_SCENE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <span className="subtle">Used during controlled reconnect windows and output resets.</span>
            </label>
          </div>

          <div className="form-grid">
            <label>
              <span className="label">Surface style</span>
              <select onChange={(event) => setDraftField("surfaceStyle", event.target.value as OverlaySettingsRecord["surfaceStyle"])} value={draft.surfaceStyle}>
                {OVERLAY_SURFACE_STYLES.map((style) => (
                  <option key={style.id} value={style.id}>
                    {style.label}
                  </option>
                ))}
              </select>
              <span className="subtle">{OVERLAY_SURFACE_STYLES.find((style) => style.id === draft.surfaceStyle)?.description}</span>
            </label>
            <label>
              <span className="label">Panel anchor</span>
              <select onChange={(event) => setDraftField("panelAnchor", event.target.value as OverlaySettingsRecord["panelAnchor"])} value={draft.panelAnchor}>
                {OVERLAY_PANEL_ANCHORS.map((anchor) => (
                  <option key={anchor.id} value={anchor.id}>
                    {anchor.label}
                  </option>
                ))}
              </select>
              <span className="subtle">{OVERLAY_PANEL_ANCHORS.find((anchor) => anchor.id === draft.panelAnchor)?.description}</span>
            </label>
            <label>
              <span className="label">Title scale</span>
              <select onChange={(event) => setDraftField("titleScale", event.target.value as OverlaySettingsRecord["titleScale"])} value={draft.titleScale}>
                {OVERLAY_TITLE_SCALES.map((scale) => (
                  <option key={scale.id} value={scale.id}>
                    {scale.label}
                  </option>
                ))}
              </select>
              <span className="subtle">{OVERLAY_TITLE_SCALES.find((scale) => scale.id === draft.titleScale)?.description}</span>
            </label>
            <label>
              <span className="label">Typography preset</span>
              <select
                onChange={(event) => setDraftField("typographyPreset", event.target.value as OverlaySettingsRecord["typographyPreset"])}
                value={draft.typographyPreset}
              >
                {OVERLAY_TYPOGRAPHY_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <span className="subtle">{OVERLAY_TYPOGRAPHY_PRESETS.find((preset) => preset.id === draft.typographyPreset)?.description}</span>
            </label>
          </div>

          <div className="list">
            <div className="item">
              <span className="label">Scene layer order</span>
              <div className="subtle">Top to bottom render order inside the current scene preset.</div>
              <div className="list" style={{ marginTop: 12 }}>
                {draft.layerOrder.map((layerKind, index) => {
                  const layer = OVERLAY_SCENE_LAYERS.find((entry) => entry.id === layerKind);
                  return (
                    <div className="item" key={layerKind}>
                      <strong>{layer?.label || layerKind}</strong>
                      <div className="subtle">{layer?.description}</div>
                      <div className="inline-form" style={{ marginTop: 8 }}>
                        <button className="button secondary" onClick={() => moveLayer(layerKind, -1)} type="button">
                          Move up
                        </button>
                        <button className="button secondary" onClick={() => moveLayer(layerKind, 1)} type="button">
                          Move down
                        </button>
                        <button className="button secondary" onClick={() => toggleLayerVisibility(layerKind)} type="button">
                          {draft.disabledLayers.includes(layerKind) ? "Show layer" : "Hide layer"}
                        </button>
                        <span className="subtle">Position {index + 1}</span>
                        <span className="subtle">{draft.disabledLayers.includes(layerKind) ? "Hidden" : "Visible"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <p className="subtle">
            Asset, insert, standby, and reconnect modes can now each resolve to different scene presets without changing the main live scene.
          </p>

          <div className="list">
            <div className="item">
              <span className="label">Positioned layers</span>
              <div className="subtle">
                Add custom text, logo, image, website, or widget layers on top of the preset layout. Text layers can switch to safe local font
                stacks, metadata widgets can read from the canonical scene payload, and browser frames remain limited by each provider&apos;s iframe
                and CSP rules.
              </div>
              <div className="inline-form" style={{ marginTop: 12 }}>
                {OVERLAY_SCENE_CUSTOM_LAYER_KINDS.map((layerKind) => (
                  <button
                    className="button secondary"
                    disabled={isPending}
                    key={layerKind.id}
                    onClick={() => addCustomLayer(layerKind.id)}
                    type="button"
                  >
                    Add {layerKind.label}
                  </button>
                ))}
              </div>
              <div className="list" style={{ marginTop: 12 }}>
                {draft.customLayers.length > 0 ? (
                  draft.customLayers.map((layer, index) => (
                    <div className="item" key={layer.id}>
                      <div className="inline-form" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <strong>{layer.name}</strong>
                          <div className="subtle">
                            {OVERLAY_SCENE_CUSTOM_LAYER_KINDS.find((entry) => entry.id === layer.kind)?.description || "Custom scene layer"}
                          </div>
                        </div>
                        <div className="inline-form">
                          <button className="button secondary" onClick={() => moveCustomLayer(layer.id, -1)} type="button">
                            Move up
                          </button>
                          <button className="button secondary" onClick={() => moveCustomLayer(layer.id, 1)} type="button">
                            Move down
                          </button>
                          <button className="button secondary" onClick={() => removeCustomLayer(layer.id)} type="button">
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="form-grid" style={{ marginTop: 12 }}>
                        <label>
                          <span className="label">Layer name</span>
                          <input onChange={(event) => updateCustomLayer(layer.id, (current) => ({ ...current, name: event.target.value }))} value={layer.name} />
                        </label>
                        <label className="toggle-row">
                          <input
                            checked={layer.enabled}
                            onChange={(event) => updateCustomLayer(layer.id, (current) => ({ ...current, enabled: event.target.checked }))}
                            type="checkbox"
                          />
                          <span>Layer enabled</span>
                        </label>
                        <label>
                          <span className="label">Opacity (%)</span>
                          <input
                            max={100}
                            min={5}
                            onChange={(event) =>
                              updateCustomLayer(layer.id, (current) => ({
                                ...current,
                                opacityPercent: Number(event.target.value) || current.opacityPercent
                              }))
                            }
                            type="number"
                            value={layer.opacityPercent}
                          />
                        </label>
                        <label>
                          <span className="label">X position (%)</span>
                          <input
                            max={90}
                            min={0}
                            onChange={(event) =>
                              updateCustomLayer(layer.id, (current) => ({
                                ...current,
                                xPercent: Number(event.target.value) || 0
                              }))
                            }
                            type="number"
                            value={layer.xPercent}
                          />
                        </label>
                        <label>
                          <span className="label">Y position (%)</span>
                          <input
                            max={90}
                            min={0}
                            onChange={(event) =>
                              updateCustomLayer(layer.id, (current) => ({
                                ...current,
                                yPercent: Number(event.target.value) || 0
                              }))
                            }
                            type="number"
                            value={layer.yPercent}
                          />
                        </label>
                        <label>
                          <span className="label">Width (%)</span>
                          <input
                            max={100}
                            min={10}
                            onChange={(event) =>
                              updateCustomLayer(layer.id, (current) => ({
                                ...current,
                                widthPercent: Number(event.target.value) || current.widthPercent
                              }))
                            }
                            type="number"
                            value={layer.widthPercent}
                          />
                        </label>
                        <label>
                          <span className="label">Height (%)</span>
                          <input
                            max={100}
                            min={8}
                            onChange={(event) =>
                              updateCustomLayer(layer.id, (current) => ({
                                ...current,
                                heightPercent: Number(event.target.value) || current.heightPercent
                              }))
                            }
                            type="number"
                            value={layer.heightPercent}
                          />
                        </label>
                        <span className="subtle">Position {index + 1}</span>
                      </div>

                      {layer.kind === "text" ? (
                        <div className="form-grid" style={{ marginTop: 12 }}>
                          <label>
                            <span className="label">Text content</span>
                            <input
                              onChange={(event) =>
                                updateCustomLayer(layer.id, (current) =>
                                  current.kind === "text" ? { ...current, text: event.target.value } : current
                                )
                              }
                              value={layer.text}
                            />
                          </label>
                          <label>
                            <span className="label">Secondary text</span>
                            <input
                              onChange={(event) =>
                                updateCustomLayer(layer.id, (current) =>
                                  current.kind === "text" ? { ...current, secondaryText: event.target.value } : current
                                )
                              }
                              value={layer.secondaryText}
                            />
                          </label>
                          <label>
                            <span className="label">Text tone</span>
                            <select
                              onChange={(event) =>
                                updateCustomLayer(layer.id, (current) =>
                                  current.kind === "text"
                                    ? { ...current, textTone: event.target.value as OverlaySceneCustomTextTone }
                                    : current
                                )
                              }
                              value={layer.textTone}
                            >
                              <option value="headline">Headline</option>
                              <option value="body">Body</option>
                              <option value="caption">Caption</option>
                            </select>
                          </label>
                          <label>
                            <span className="label">Text align</span>
                            <select
                              onChange={(event) =>
                                updateCustomLayer(layer.id, (current) =>
                                  current.kind === "text"
                                    ? { ...current, textAlign: event.target.value as OverlaySceneCustomTextAlign }
                                    : current
                                )
                              }
                              value={layer.textAlign}
                            >
                              <option value="left">Left</option>
                              <option value="center">Center</option>
                              <option value="right">Right</option>
                            </select>
                          </label>
                          <label className="toggle-row">
                            <input
                              checked={layer.useAccent}
                              onChange={(event) =>
                                updateCustomLayer(layer.id, (current) =>
                                  current.kind === "text" ? { ...current, useAccent: event.target.checked } : current
                                )
                              }
                              type="checkbox"
                            />
                            <span>Use accent color</span>
                          </label>
                          <label>
                            <span className="label">Text font</span>
                            <select
                              onChange={(event) =>
                                updateCustomLayer(layer.id, (current) =>
                                  current.kind === "text"
                                    ? { ...current, fontMode: event.target.value as OverlaySceneCustomTextFontMode }
                                    : current
                                )
                              }
                              value={layer.fontMode}
                            >
                              {OVERLAY_SCENE_CUSTOM_TEXT_FONT_MODES.map((mode) => (
                                <option key={mode.id} value={mode.id}>
                                  {mode.label}
                                </option>
                              ))}
                            </select>
                            <span className="subtle">
                              {OVERLAY_SCENE_CUSTOM_TEXT_FONT_MODES.find((mode) => mode.id === layer.fontMode)?.description}
                            </span>
                          </label>
                          {layer.fontMode === "custom-local" ? (
                            <label>
                              <span className="label">Custom local font stack</span>
                              <input
                                onChange={(event) =>
                                  updateCustomLayer(layer.id, (current) =>
                                    current.kind === "text" ? { ...current, customFontFamily: event.target.value } : current
                                  )
                                }
                                placeholder="Aptos, Segoe UI, Helvetica Neue"
                                value={layer.customFontFamily}
                              />
                              <span className="subtle">
                                Stream247 does not download remote fonts. This stack only resolves when those font families already exist on the
                                browser host or worker image.
                              </span>
                            </label>
                          ) : null}
                        </div>
                      ) : null}

                      {layer.kind === "logo" || layer.kind === "image" ? (
                        <div className="form-grid" style={{ marginTop: 12 }}>
                          <label>
                            <span className="label">Asset URL</span>
                            <input
                              onChange={(event) =>
                                updateCustomLayer(layer.id, (current) =>
                                  current.kind === "logo" || current.kind === "image" ? { ...current, url: event.target.value } : current
                                )
                              }
                              placeholder="https://example.com/asset.png or /logo.svg"
                              value={layer.url}
                            />
                          </label>
                          <label>
                            <span className="label">Alt text</span>
                            <input
                              onChange={(event) =>
                                updateCustomLayer(layer.id, (current) =>
                                  current.kind === "logo" || current.kind === "image" ? { ...current, altText: event.target.value } : current
                                )
                              }
                              value={layer.altText}
                            />
                          </label>
                          <label>
                            <span className="label">Fit</span>
                            <select
                              onChange={(event) =>
                                updateCustomLayer(layer.id, (current) =>
                                  current.kind === "logo" || current.kind === "image"
                                    ? { ...current, fit: event.target.value as OverlaySceneCustomMediaFit }
                                    : current
                                )
                              }
                              value={layer.fit}
                            >
                              <option value="contain">Contain</option>
                              <option value="cover">Cover</option>
                            </select>
                          </label>
                        </div>
                      ) : null}

                      {layer.kind === "embed" || layer.kind === "widget" ? (
                        <div className="form-grid" style={{ marginTop: 12 }}>
                          {layer.kind === "widget" ? (
                            <label>
                              <span className="label">Widget mode</span>
                              <select
                                onChange={(event) =>
                                  updateCustomLayer(layer.id, (current) =>
                                    current.kind === "widget"
                                      ? { ...current, widgetMode: event.target.value === "metadata" ? "metadata" : "embed" }
                                      : current
                                  )
                                }
                                value={layer.widgetMode}
                              >
                                <option value="embed">Browser widget frame</option>
                                <option value="metadata">Scene data card</option>
                              </select>
                              <span className="subtle">
                                Metadata cards render from the canonical Scene Studio payload. Browser widget frames still depend on provider iframe
                                support.
                              </span>
                            </label>
                          ) : null}
                          {layer.kind === "widget" && layer.widgetMode === "metadata" ? (
                            <>
                              <label>
                                <span className="label">Scene data</span>
                                <select
                                  onChange={(event) =>
                                    updateCustomLayer(layer.id, (current) =>
                                      current.kind === "widget"
                                        ? { ...current, widgetDataKey: event.target.value as OverlaySceneCustomWidgetDataKey }
                                        : current
                                    )
                                  }
                                  value={layer.widgetDataKey}
                                >
                                  {OVERLAY_SCENE_CUSTOM_WIDGET_DATA_KEYS.map((entry) => (
                                    <option key={entry.id} value={entry.id}>
                                      {entry.label}
                                    </option>
                                  ))}
                                </select>
                                <span className="subtle">
                                  {OVERLAY_SCENE_CUSTOM_WIDGET_DATA_KEYS.find((entry) => entry.id === layer.widgetDataKey)?.description}
                                </span>
                              </label>
                              <label>
                                <span className="label">Widget label override</span>
                                <input
                                  onChange={(event) =>
                                    updateCustomLayer(layer.id, (current) =>
                                      current.kind === "widget" ? { ...current, title: event.target.value } : current
                                    )
                                  }
                                  placeholder="Optional label override"
                                  value={layer.title}
                                />
                              </label>
                              <div className="subtle" style={{ gridColumn: "1 / -1" }}>
                                This widget stays inside the published Scene Studio contract and mirrors browser plus on-air scene data without a
                                third-party iframe.
                              </div>
                            </>
                          ) : null}
                          {layer.kind === "embed" || (layer.kind === "widget" && layer.widgetMode === "embed") ? (
                            <>
                          <label>
                            <span className="label">Embed URL</span>
                            <input
                              onChange={(event) =>
                                updateCustomLayer(layer.id, (current) =>
                                  current.kind === "embed" || current.kind === "widget" ? { ...current, url: event.target.value } : current
                                )
                              }
                              placeholder="https://example.com/embed"
                              value={layer.url}
                            />
                            <span className="subtle">
                              {describeOverlaySceneFrameSupport(layer.url).badgeLabel} · {describeOverlaySceneFrameSupport(layer.url).providerLabel}
                            </span>
                          </label>
                          <label>
                            <span className="label">Frame title</span>
                            <input
                              onChange={(event) =>
                                updateCustomLayer(layer.id, (current) =>
                                  current.kind === "embed" || current.kind === "widget" ? { ...current, title: event.target.value } : current
                                )
                              }
                              value={layer.title}
                            />
                          </label>
                          <div className="subtle" style={{ gridColumn: "1 / -1" }}>
                            {describeOverlaySceneFrameSupport(layer.url).guidance}
                          </div>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="subtle">No positioned layers yet. Add one when you need custom text, logos, stills, or embed-safe widgets.</div>
                )}
              </div>
            </div>
          </div>

          <div className="list">
            <div className="item">
              <span className="label">Scene preset library</span>
              <div className="subtle">Save the current draft as a reusable scene preset, then re-apply it later without rebuilding every control by hand.</div>
              <div className="form-grid" style={{ marginTop: 12 }}>
                <label>
                  <span className="label">Preset name</span>
                  <input onChange={(event) => setPresetName(event.target.value)} placeholder="e.g. Prime Time Replay" value={presetName} />
                </label>
                <label>
                  <span className="label">Description</span>
                  <input
                    onChange={(event) => setPresetDescription(event.target.value)}
                    placeholder="Optional note for operators"
                    value={presetDescription}
                  />
                </label>
              </div>
              <div className="inline-form" style={{ marginTop: 12 }}>
                <button className="button secondary" disabled={isPending || presetName.trim() === ""} onClick={saveScenePreset} type="button">
                  {isPending ? "Saving..." : "Save draft as preset"}
                </button>
              </div>
              <div className="list" style={{ marginTop: 12 }}>
                {scenePresets.length > 0 ? (
                  scenePresets.map((preset) => (
                    <div className="item" key={preset.id}>
                      <strong>{preset.name}</strong>
                      <div className="subtle">{preset.description || "No description provided."}</div>
                      <div className="subtle">
                        Asset {preset.overlay.scenePreset} · Insert {preset.overlay.insertScenePreset} · Standby {preset.overlay.standbyScenePreset} · Reconnect{" "}
                        {preset.overlay.reconnectScenePreset}
                      </div>
                      <div className="subtle">
                        Typography {preset.overlay.typographyPreset} · {preset.overlay.customLayers.length} positioned layer
                        {preset.overlay.customLayers.length === 1 ? "" : "s"}
                      </div>
                      <div className="subtle">Updated {preset.updatedAt || "unknown"}</div>
                      <div className="inline-form" style={{ marginTop: 8 }}>
                        <button className="button secondary" disabled={isPending} onClick={() => applyScenePreset(preset.id)} type="button">
                          Apply to draft
                        </button>
                        <button className="button secondary" disabled={isPending} onClick={() => deleteScenePreset(preset.id)} type="button">
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="subtle">No saved scene presets yet.</div>
                )}
              </div>
            </div>
          </div>

          <label>
            <span className="label">Emergency banner</span>
            <input
              onChange={(event) => setDraftField("emergencyBanner", event.target.value)}
              placeholder="Optional urgent message"
              value={draft.emergencyBanner}
            />
          </label>

          <div className="form-grid">
            <label className="toggle-row">
              <input checked={draft.showClock} onChange={(event) => setDraftField("showClock", event.target.checked)} type="checkbox" />
              <span>Show clock</span>
            </label>
            <label className="toggle-row">
              <input checked={draft.showNextItem} onChange={(event) => setDraftField("showNextItem", event.target.checked)} type="checkbox" />
              <span>Show next item</span>
            </label>
            <label className="toggle-row">
              <input
                checked={draft.showScheduleTeaser}
                onChange={(event) => setDraftField("showScheduleTeaser", event.target.checked)}
                type="checkbox"
              />
              <span>Show schedule teaser</span>
            </label>
            <label className="toggle-row">
              <input
                checked={draft.showCurrentCategory}
                onChange={(event) => setDraftField("showCurrentCategory", event.target.checked)}
                type="checkbox"
              />
              <span>Show current category</span>
            </label>
            <label className="toggle-row">
              <input checked={draft.showSourceLabel} onChange={(event) => setDraftField("showSourceLabel", event.target.checked)} type="checkbox" />
              <span>Show source label</span>
            </label>
            <label className="toggle-row">
              <input checked={draft.showQueuePreview} onChange={(event) => setDraftField("showQueuePreview", event.target.checked)} type="checkbox" />
              <span>Show queue preview</span>
            </label>
            <label>
              <span className="label">Queue preview count</span>
              <input
                max={5}
                min={1}
                onChange={(event) => setDraftField("queuePreviewCount", Number(event.target.value) || 1)}
                type="number"
                value={draft.queuePreviewCount}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="scene-status-grid">
        <div className="item">
          <span className="label">Live scene</span>
          <strong>{props.liveOverlay.scenePreset}</strong>
          <div className="subtle">
            Asset headline {props.liveOverlay.headline} · Insert {props.liveOverlay.insertHeadline} · Standby {props.liveOverlay.standbyHeadline} ·
            Reconnect {props.liveOverlay.reconnectHeadline}
          </div>
          <div className="subtle">
            Typography {props.liveOverlay.typographyPreset} · {props.liveOverlay.customLayers.length} positioned layer
            {props.liveOverlay.customLayers.length === 1 ? "" : "s"}
          </div>
          <div className="subtle">
            Asset {props.liveOverlay.scenePreset} · Insert {props.liveOverlay.insertScenePreset} · Standby {props.liveOverlay.standbyScenePreset} · Reconnect{" "}
            {props.liveOverlay.reconnectScenePreset}
          </div>
          <div className="subtle">Published {props.liveOverlay.updatedAt || "never"}</div>
        </div>
        <div className="item">
          <span className="label">Draft scene</span>
          <strong>{draft.scenePreset}</strong>
          <div className="subtle">
            Asset headline {draft.headline} · Insert {draft.insertHeadline} · Standby {draft.standbyHeadline} · Reconnect {draft.reconnectHeadline}
          </div>
          <div className="subtle">
            Typography {draft.typographyPreset} · {draft.customLayers.length} positioned layer{draft.customLayers.length === 1 ? "" : "s"}
          </div>
          <div className="subtle">
            Asset {draft.scenePreset} · Insert {draft.insertScenePreset} · Standby {draft.standbyScenePreset} · Reconnect {draft.reconnectScenePreset}
          </div>
          <div className="subtle">Draft saved {props.draftOverlay.updatedAt || "not yet saved"}</div>
        </div>
        <div className="item">
          <span className="label">Publish status</span>
          <strong>{canPublish ? "Pending changes" : "Live and draft match"}</strong>
          <div className="subtle">Draft is based on live scene updated at {props.basedOnUpdatedAt || "unknown"}.</div>
        </div>
      </div>

      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <div className="inline-form">
        <button className="button secondary" disabled={isPending || !hasLocalChanges} type="submit">
          {isPending ? "Saving..." : "Save draft"}
        </button>
        <button
          className="button"
          disabled={isPending || !canPublish}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(async () => {
              const response = await fetch("/api/overlay", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "publish", draft })
              });

              const payload = (await response.json()) as { message?: string; draftOverlay?: OverlaySettingsRecord };
              if (!response.ok) {
                setError(payload.message ?? "Could not publish scene changes.");
                return;
              }

              if (payload.draftOverlay) {
                setDraft(payload.draftOverlay);
              }
              setMessage(payload.message ?? "Scene changes published live.");
              router.refresh();
            });
          }}
          type="button"
        >
          {isPending ? "Publishing..." : "Publish live"}
        </button>
        <button
          className="button secondary"
          disabled={isPending || !canReset}
          onClick={() => {
            setError("");
            setMessage("");
            startTransition(async () => {
              const response = await fetch("/api/overlay", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "reset" })
              });

              const payload = (await response.json()) as { message?: string; draftOverlay?: OverlaySettingsRecord };
              if (!response.ok) {
                setError(payload.message ?? "Could not reset the scene draft.");
                return;
              }

              if (payload.draftOverlay) {
                setDraft(payload.draftOverlay);
              }
              setMessage(payload.message ?? "Draft reset to the live scene.");
              router.refresh();
            });
          }}
          type="button"
        >
          {isPending ? "Resetting..." : "Reset to live"}
        </button>
      </div>
    </form>
  );
}
