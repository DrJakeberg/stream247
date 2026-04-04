"use client";

import {
  OVERLAY_SCENE_LAYERS,
  OVERLAY_PANEL_ANCHORS,
  OVERLAY_SCENE_PRESETS,
  OVERLAY_SURFACE_STYLES,
  OVERLAY_TITLE_SCALES,
  type OverlayQueueKind,
  type OverlaySceneLayerKind
} from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { OverlaySceneCanvas } from "@/components/overlay-scene-canvas";
import type { OverlaySettingsRecord } from "@/lib/server/state";

type OverlayPreviewSeed = {
  timeZone: string;
  currentTitle: string;
  currentCategory: string;
  currentSourceName: string;
  nextTitle: string;
  nextTimeLabel: string;
  queueTitles: string[];
};

function overlaySignature(overlay: OverlaySettingsRecord): string {
  return JSON.stringify({
    enabled: overlay.enabled,
    channelName: overlay.channelName,
    headline: overlay.headline,
    replayLabel: overlay.replayLabel,
    brandBadge: overlay.brandBadge,
    scenePreset: overlay.scenePreset,
    accentColor: overlay.accentColor,
    surfaceStyle: overlay.surfaceStyle,
    panelAnchor: overlay.panelAnchor,
    titleScale: overlay.titleScale,
    showClock: overlay.showClock,
    showNextItem: overlay.showNextItem,
    showScheduleTeaser: overlay.showScheduleTeaser,
    showCurrentCategory: overlay.showCurrentCategory,
    showSourceLabel: overlay.showSourceLabel,
    showQueuePreview: overlay.showQueuePreview,
    queuePreviewCount: overlay.queuePreviewCount,
    layerOrder: overlay.layerOrder,
    emergencyBanner: overlay.emergencyBanner,
    tickerText: overlay.tickerText
  });
}

export function OverlaySettingsForm(props: {
  liveOverlay: OverlaySettingsRecord;
  draftOverlay: OverlaySettingsRecord;
  hasUnpublishedChanges: boolean;
  basedOnUpdatedAt: string;
  preview: OverlayPreviewSeed;
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [previewMode, setPreviewMode] = useState<OverlayQueueKind>("asset");
  const [draft, setDraft] = useState<OverlaySettingsRecord>(props.draftOverlay);
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

  const previewSubtitle =
    previewMode === "insert"
      ? "Manual bumper between regular programming."
      : previewMode === "reconnect"
        ? "Controlled reconnect while the channel stays branded."
        : previewMode === "standby"
          ? "Waiting for the next scheduled item."
          : draft.headline;

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
            <OverlaySceneCanvas
              currentCategory={props.preview.currentCategory}
              currentSourceName={props.preview.currentSourceName}
              currentTitle={previewCurrentTitle}
              modeSubtitle={previewSubtitle}
              nextTimeLabel={props.preview.nextTimeLabel}
              nextTitle={previewNextTitle}
              overlay={draft}
              queueTitles={props.preview.queueTitles}
              sceneMode={previewMode}
              timeZone={props.preview.timeZone}
            />
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
                        <span className="subtle">Position {index + 1}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <p className="subtle">
            Inserts and scheduled reconnects can automatically switch to dedicated live scene variants without changing your main preset.
          </p>

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
          <div className="subtle">Published {props.liveOverlay.updatedAt || "never"}</div>
        </div>
        <div className="item">
          <span className="label">Draft scene</span>
          <strong>{draft.scenePreset}</strong>
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
