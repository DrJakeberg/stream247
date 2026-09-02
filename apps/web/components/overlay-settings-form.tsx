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
  MAX_NAMED_OVERLAY_SCENES,
  OVERLAY_PANEL_IDS,
  buildOverlayScenePayload,
  deriveDefaultPlacements,
  describeOverlaySceneFrameSupport,
  resolveActiveOverlayNamedSceneId,
  resolveOverlayHeadlineForQueueKind,
  resolveOverlayNamedSceneCustomLayers,
  resolvePlacementPixelBox,
  type OverlayNamedScene,
  type OverlayPanelId,
  type OverlayQueueKind,
  type OverlayScenePanelPlacement,
  type OverlaySceneCustomMediaFit,
  type OverlaySceneCustomTextAlign,
  type OverlaySceneCustomTextFontMode,
  type OverlaySceneCustomTextTone,
  type OverlaySceneCustomLayerKind,
  type OverlaySceneCustomWidgetDataKey,
  type OverlaySceneLayerKind
} from "@stream247/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { OverlayPlacementCanvas, type PlacementTarget } from "@/components/overlay-placement-canvas";
import { OverlayRenderPreview } from "@/components/overlay-render-preview";
import { useToast } from "@/components/ui/Toast";
import { buildOverlayPublishReviewSections, type OverlayPublishReviewSection } from "@/lib/overlay-publish-review";
import { createDefaultCustomLayer } from "@/lib/overlay-studio-defaults";
import type { OverlayScenePresetRecord, OverlaySettingsRecord } from "@/lib/server/state";
import { describeScenePreset, describeTypographyPreset } from "@/lib/scene-preset-names";

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
    // The scene list, not the projected layer array: `customLayers` is derived from these two, so
    // signing it as well would count one edit twice and let a rounding difference in the
    // projection read as an unsaved change.
    scenes: overlay.scenes,
    activeSceneId: overlay.activeSceneId,
    customLayers: overlay.customLayers,
    panelPlacements: overlay.panelPlacements,
    emergencyBanner: overlay.emergencyBanner,
    tickerText: overlay.tickerText
  });
}

/**
 * What each of the renderer's own panels is called where an operator can see it.
 *
 * Not the internal ids and not the layer names from the visibility list: these are the six things
 * an operator points at on the picture, and "Now playing" is what they call the lower third.
 */
const OVERLAY_PANEL_LABELS: { id: OverlayPanelId; label: string; hint: string }[] = [
  { id: "hero", label: "Now playing", hint: "The lower third: label, title, and the line under it." },
  { id: "next", label: "Up next", hint: "The small card in the right rail, when no vote is running." },
  { id: "vote", label: "Vote panel", hint: "Takes the rail's corner while chat is voting." },
  { id: "chat", label: "Chat", hint: "Fits as many of the newest messages as its height holds." },
  { id: "clock", label: "Clock", hint: "Channel time, top right." },
  { id: "banner", label: "Emergency banner", hint: "Only on air while the banner has text." }
];

/** The design grid. Design pixels are frame pixels at this size, which is what makes it the grid. */
const DESIGN_FRAME = { width: 1920, height: 1080 };

/**
 * The box in design pixels, for the caption under each panel's name.
 *
 * Percentages are what is stored, because they survive an output size change; pixels are what an
 * operator recognises on the picture. This says the same thing the four number fields say, in one
 * readable line, so a folded panel still tells you where it is.
 *
 * Resolved by the renderer's own resolver rather than by repeating its arithmetic here. The
 * hand-written version this replaces had the safe-area margins, the origin and the clamps written
 * out a second time, so a caption could disagree with the picture — and did, for any box the
 * renderer clamps.
 */
function describePanelBox(placement: OverlayScenePanelPlacement): string {
  const box = resolvePlacementPixelBox(placement, DESIGN_FRAME);
  return (
    `x ${String(box.left)} · y ${String(box.top)} · ` +
    `${String(box.width)} × ${String(box.height)} · ` +
    `${String(placement.opacityPercent)}% opacity`
  );
}

function ScenePublishReviewDialog(props: {
  open: boolean;
  sections: OverlayPublishReviewSection[];
  isPending: boolean;
  onClose: () => void;
  onPublish: () => void;
}) {
  if (!props.open) {
    return null;
  }

  return (
    <div aria-modal="true" className="studio-dialog-backdrop" role="dialog">
      <section className="studio-dialog">
        <div className="studio-dialog-header">
          <div>
            <span className="label">Publish review</span>
            <h3>Review scene changes before publishing</h3>
          </div>
          <button aria-label="Close publish review" className="button secondary" onClick={props.onClose} type="button">
            Close
          </button>
        </div>
        <div className="studio-dialog-body">
          {props.sections.length > 0 ? (
            props.sections.map((section) => (
              <div className="item" key={section.title}>
                <strong>{section.title}</strong>
                <ul className="studio-review-list">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <div className="item">
              <strong>No pending changes</strong>
              <div className="subtle">Live and draft already match.</div>
            </div>
          )}
        </div>
        <div className="studio-dialog-actions">
          <button className="button secondary" onClick={props.onClose} type="button">
            Keep editing
          </button>
          <button className="button" disabled={props.isPending || props.sections.length === 0} onClick={props.onPublish} type="button">
            {props.isPending ? "Publishing..." : "Publish live"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function OverlaySettingsForm(props: {
  liveOverlay: OverlaySettingsRecord;
  draftOverlay: OverlaySettingsRecord;
  scenePresets: OverlayScenePresetRecord[];
  hasUnpublishedChanges: boolean;
  basedOnUpdatedAt: string;
  preview: OverlayPreviewSeed;
  /** Stored external video sources a source layer can link to. Name and presence only. */
  videoSources?: Array<{ id: string; name: string; urlPresent: boolean }>;
  /**
   * Which corner the chat panel is set to, from the engagement settings that own it. Only used to
   * seed the chat panel's first box from where the flow currently puts it; the scene never stores
   * the corner itself.
   */
  chatPosition?: string;
  /**
   * The size this channel actually encodes, from the output profile.
   *
   * Not 1920x1080 unless the profile says so. overlayScale has a floor at 0.35 and every dimension
   * is rounded, so at 1280x720 the safe band is 646px of 720 where at 1920x1080 it is 968 of 1080 —
   * the picture is genuinely different, and a preview at the wrong size would put the drag handles
   * somewhere the broadcast does not.
   */
  outputSize: { width: number; height: number };
}) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [previewMode, setPreviewMode] = useState<OverlayQueueKind>("asset");
  const [draft, setDraft] = useState<OverlaySettingsRecord>(props.draftOverlay);
  const [scenePresets, setScenePresets] = useState<OverlayScenePresetRecord[]>(props.scenePresets);
  const [presetName, setPresetName] = useState("");
  const [presetDescription, setPresetDescription] = useState("");
  const [isPublishReviewOpen, setIsPublishReviewOpen] = useState(false);
  // Which box on the preview the operator has hold of, as "panel:<id>" or "layer:<id>". Selecting
  // one opens the sidebar at it, so the number fields stay available as the exact way to say what
  // a drag can only approximate.
  const [selectedPlacementId, setSelectedPlacementId] = useState("");
  const [placementFoldOpen, setPlacementFoldOpen] = useState(false);
  const [overlapNotice, setOverlapNotice] = useState("");
  // Bumped on every drop and every arrow key, so the preview renders that change at once instead of
  // waiting out the settle beat that exists for typing.
  const [placementRevision, setPlacementRevision] = useState(0);
  const router = useRouter();
  const { pushToast } = useToast();
  const hasLocalChanges = overlaySignature(draft) !== overlaySignature(props.draftOverlay);
  const canPublish = hasLocalChanges || props.hasUnpublishedChanges;
  const canReset = hasLocalChanges || props.hasUnpublishedChanges;
  const reviewSections = buildOverlayPublishReviewSections(props.liveOverlay, draft);
  const emergencyBannerActive = Boolean(draft.emergencyBanner.trim() || props.liveOverlay.emergencyBanner.trim());

  const setDraftField = <K extends keyof OverlaySettingsRecord>(key: K, value: OverlaySettingsRecord[K]) => {
    setDraft((current) => ({
      ...current,
      [key]: value
    }));
  };

  // --- Named scenes --------------------------------------------------------
  //
  // The scene in the picker is the scene the draft is ABOUT: editing it and putting it on air are
  // the same act, one publish apart. Offering a separate "edit this one, keep that one live" axis
  // would duplicate the draft/live split this form already has and give four states where the
  // operator can only reason about two.
  const scenes = draft.scenes.length > 0 ? draft.scenes : [];
  const selectedScene = scenes.find((scene) => scene.id === draft.activeSceneId) ?? scenes[0];

  /** Replaces the scene list and keeps the projected layer array in step with the server's. */
  const applyScenes = (nextScenes: OverlayNamedScene[], nextActiveSceneId?: string) => {
    setDraft((current) => {
      const activeSceneId = resolveActiveOverlayNamedSceneId(nextScenes, nextActiveSceneId ?? current.activeSceneId);
      return {
        ...current,
        scenes: nextScenes,
        activeSceneId,
        // The same projection the API and the store compute, so the preview draws the frame that
        // will actually go on air rather than whatever the form last held.
        customLayers: resolveOverlayNamedSceneCustomLayers(nextScenes, activeSceneId)
      };
    });
  };

  const updateSelectedScene = (updater: (scene: OverlayNamedScene) => OverlayNamedScene) => {
    setDraft((current) => {
      const nextScenes = current.scenes.map((scene) => (scene.id === current.activeSceneId ? updater(scene) : scene));
      return {
        ...current,
        scenes: nextScenes,
        customLayers: resolveOverlayNamedSceneCustomLayers(nextScenes, current.activeSceneId)
      };
    });
  };

  const addScene = () => {
    const id = `scene-${Date.now().toString(36)}`;
    applyScenes([...scenes, { id, name: `Scene ${String(scenes.length + 1)}`, customLayers: [], sourceId: "" }], id);
  };

  const duplicateScene = () => {
    if (!selectedScene) {
      return;
    }
    const id = `scene-${Date.now().toString(36)}`;
    applyScenes(
      [...scenes, { ...selectedScene, id, name: `${selectedScene.name} copy`.slice(0, 60) }],
      id
    );
  };

  const removeScene = () => {
    // Never down to zero: a channel with the overlay switched on must have a scene to draw.
    if (scenes.length <= 1 || !selectedScene) {
      return;
    }
    applyScenes(scenes.filter((scene) => scene.id !== selectedScene.id), "");
  };

  // Taking hold of a panel seeds its box from where the flow already puts it, so the first save
  // moves nothing: the operator sees the numbers for the panel's current position and changes the
  // ones they mean to. Letting go removes the entry entirely, which puts the panel back in the flow
  // rather than leaving it pinned to whatever it was last dragged to.
  const togglePanelPlacement = (id: OverlayPanelId) => {
    setDraft((current) => {
      const next = { ...current.panelPlacements };
      if (next[id]) {
        delete next[id];
        return { ...current, panelPlacements: next };
      }
      const seed = deriveDefaultPlacements(current.panelAnchor, props.chatPosition)[id];
      return { ...current, panelPlacements: { ...next, [id]: { ...seed, opacityPercent: seed.opacityPercent ?? 100, allowOutsideSafeArea: seed.allowOutsideSafeArea ?? false } } };
    });
  };

  const updatePanelPlacement = (id: OverlayPanelId, patch: Partial<OverlayScenePanelPlacement>) => {
    setDraft((current) => {
      const existing = current.panelPlacements[id];
      if (!existing) {
        return current;
      }
      return { ...current, panelPlacements: { ...current.panelPlacements, [id]: { ...existing, ...patch } } };
    });
  };

  // --- Direct manipulation -------------------------------------------------
  //
  // Dragging a panel that is still in the flow places it, seeded from where the flow put it, and
  // then applies the drag. Making the operator find a checkbox first is the complaint this whole
  // stage exists to answer: "I cannot move the fields."
  const placePanelFromCanvas = (id: OverlayPanelId, patch: Partial<OverlayScenePanelPlacement>) => {
    setDraft((current) => {
      const seed = current.panelPlacements[id] ?? {
        ...deriveDefaultPlacements(current.panelAnchor, props.chatPosition)[id],
        opacityPercent: 100,
        allowOutsideSafeArea: false
      };
      return {
        ...current,
        panelPlacements: { ...current.panelPlacements, [id]: { ...seed, ...patch } as OverlayScenePanelPlacement }
      };
    });
  };

  const addCustomLayer = (kind: OverlaySceneCustomLayerKind) => {
    updateSelectedScene((scene) => ({ ...scene, customLayers: [...scene.customLayers, createDefaultCustomLayer(kind)] }));
  };

  const updateCustomLayer = (id: string, updater: (layer: OverlayDraftCustomLayer) => OverlayDraftCustomLayer) => {
    updateSelectedScene((scene) => ({
      ...scene,
      customLayers: scene.customLayers.map((layer) => (layer.id === id ? updater(layer) : layer))
    }));
  };

  const removeCustomLayer = (id: string) => {
    updateSelectedScene((scene) => ({ ...scene, customLayers: scene.customLayers.filter((layer) => layer.id !== id) }));
  };

  const moveCustomLayer = (id: string, direction: -1 | 1) => {
    updateSelectedScene((scene) => {
      const nextLayers = [...scene.customLayers];
      const index = nextLayers.findIndex((layer) => layer.id === id);
      if (index === -1) {
        return scene;
      }

      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= nextLayers.length) {
        return scene;
      }

      [nextLayers[index], nextLayers[targetIndex]] = [nextLayers[targetIndex], nextLayers[index]];
      return { ...scene, customLayers: nextLayers };
    });
  };

  const toggleDraftEmergencyBanner = () => {
    setDraft((current) => ({
      ...current,
      emergencyBanner: current.emergencyBanner.trim()
        ? ""
        : current.emergencyBanner || props.liveOverlay.emergencyBanner || "Emergency update in progress"
    }));
  };

  async function saveDraft() {
    const response = await fetch("/api/overlay", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft)
    });

    const payload = (await response.json()) as { message?: string; draftOverlay?: OverlaySettingsRecord };
    if (!response.ok) {
      const nextError = payload.message ?? "Could not save overlay settings.";
      setError(nextError);
      pushToast({
        title: "Could not save the scene draft",
        description: nextError,
        tone: "error"
      });
      return;
    }

    if (payload.draftOverlay) {
      setDraft(payload.draftOverlay);
    }
    pushToast({
      title: "Scene draft saved",
      description: payload.message ?? "Scene draft updated.",
      tone: "success"
    });
    router.refresh();
  }

  async function publishLive() {
    const response = await fetch("/api/overlay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish", draft })
    });

    const payload = (await response.json()) as { message?: string; draftOverlay?: OverlaySettingsRecord };
    if (!response.ok) {
      const nextError = payload.message ?? "Could not publish scene changes.";
      setError(nextError);
      pushToast({
        title: "Could not publish the scene",
        description: nextError,
        tone: "error"
      });
      return;
    }

    if (payload.draftOverlay) {
      setDraft(payload.draftOverlay);
    }
    setIsPublishReviewOpen(false);
    pushToast({
      title: "Scene published live",
      description: payload.message ?? "Scene changes are now live.",
      tone: "success"
    });
    router.refresh();
  }

  async function resetDraft() {
    const response = await fetch("/api/overlay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset" })
    });

    const payload = (await response.json()) as { message?: string; draftOverlay?: OverlaySettingsRecord };
    if (!response.ok) {
      const nextError = payload.message ?? "Could not reset the scene draft.";
      setError(nextError);
      pushToast({
        title: "Could not reset the scene draft",
        description: nextError,
        tone: "error"
      });
      return;
    }

    if (payload.draftOverlay) {
      setDraft(payload.draftOverlay);
    }
    setIsPublishReviewOpen(false);
    pushToast({
      title: "Scene draft reset",
      description: payload.message ?? "Draft reset to the live scene.",
      tone: "success"
    });
    router.refresh();
  }

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
    previewMode === "reconnect" ? props.preview.currentTitle : props.preview.nextTitle || "Program resumes shortly";
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

  /**
   * The panels and layers the preview frame actually draws, as boxes on that frame.
   *
   * Only what is on the picture gets a handle. The vote and chat panels are never drawn in the
   * studio preview — the renderer builds them from a live engagement and a live chat, neither of
   * which the preview payload carries — so they get a box only once the operator has placed one
   * from the sidebar, rather than a handle hovering over nothing. Embed and widget layers never
   * get one at all: satori cannot run an iframe, so those exist only on the browser overlay.
   */
  const placementTargets: PlacementTarget[] = [
    ...OVERLAY_PANEL_IDS.filter((id) => {
      if (draft.panelPlacements[id]) {
        return true;
      }
      if (id === "hero" || id === "clock") {
        return true;
      }
      if (id === "next") {
        return Boolean(previewNextTitle);
      }
      if (id === "banner") {
        return Boolean(draft.emergencyBanner.trim());
      }
      return false;
    }).map((id) => ({
      id: `panel:${id}`,
      label: OVERLAY_PANEL_LABELS.find((panel) => panel.id === id)?.label ?? id,
      placement:
        draft.panelPlacements[id] ?? deriveDefaultPlacements(draft.panelAnchor, props.chatPosition)[id]
    })),
    ...draft.customLayers
      .filter((layer) => layer.enabled && ["logo", "image", "text"].includes(layer.kind))
      .map((layer) => ({
        id: `layer:${layer.id}`,
        label: layer.name,
        placement: layer,
        // A logo drawn with fit: contain is letterboxed inside its box, so a box of the wrong
        // shape adds margin the operator cannot see here and cannot remove later. The ratio itself
        // is taken from the resolved box at the moment the drag starts, not from the two percents:
        // those are measured against different axes, so their quotient is not a shape.
        lockAspect: (layer.kind === "logo" || layer.kind === "image") && layer.fit === "contain"
      }))
  ];

  const commitPlacement = (
    id: string,
    percent: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number }
  ) => {
    const round = (value: number) => Math.round(value * 100) / 100;
    const patch = {
      xPercent: round(percent.xPercent),
      yPercent: round(percent.yPercent),
      widthPercent: round(percent.widthPercent),
      heightPercent: round(percent.heightPercent)
    };

    if (id.startsWith("panel:")) {
      placePanelFromCanvas(id.slice("panel:".length) as OverlayPanelId, patch);
    } else {
      updateCustomLayer(id.slice("layer:".length), (current) => ({ ...current, ...patch }));
    }

    setPlacementRevision((current) => current + 1);
  };

  const selectPlacement = (id: string) => {
    setSelectedPlacementId(id);
    if (id.startsWith("panel:")) {
      setPlacementFoldOpen(true);
    }
    // The sidebar jumps to what was just clicked. Not focus — focus belongs to the box on the
    // preview, which is the thing the arrow keys move.
    if (typeof document !== "undefined") {
      requestAnimationFrame(() => {
        document.getElementById(`placement-${id.replace(":", "-")}`)?.scrollIntoView({ block: "nearest" });
      });
    }
  };

  const saveScenePreset = () => {
    setError("");

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
        const nextError = payload.message ?? "Could not save scene preset.";
        setError(nextError);
        pushToast({
          title: "Could not save the scene preset",
          description: nextError,
          tone: "error"
        });
        return;
      }

      setScenePresets(payload.presets ?? []);
      setPresetName("");
      setPresetDescription("");
      pushToast({
        title: "Scene preset saved",
        description: payload.message ?? "The current draft is now reusable.",
        tone: "success"
      });
    });
  };

  const applyScenePreset = (presetId: string) => {
    setError("");

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
        const nextError = payload.message ?? "Could not apply scene preset.";
        setError(nextError);
        pushToast({
          title: "Could not apply the scene preset",
          description: nextError,
          tone: "error"
        });
        return;
      }

      if (payload.studioState?.draftOverlay) {
        setDraft(payload.studioState.draftOverlay);
      }
      setScenePresets(payload.presets ?? []);
      pushToast({
        title: "Scene preset applied",
        description: payload.message ?? "The preset has been loaded into the draft.",
        tone: "success"
      });
      router.refresh();
    });
  };

  const deleteScenePreset = (presetId: string) => {
    setError("");

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
        const nextError = payload.message ?? "Could not delete scene preset.";
        setError(nextError);
        pushToast({
          title: "Could not delete the scene preset",
          description: nextError,
          tone: "error"
        });
        return;
      }

      setScenePresets(payload.presets ?? []);
      pushToast({
        title: "Scene preset deleted",
        description: payload.message ?? "The preset has been removed from the library.",
        tone: "success"
      });
    });
  };

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        startTransition(() => void saveDraft());
      }}
    >
      <div className={`scene-workspace-toolbar${emergencyBannerActive ? " scene-workspace-toolbar-alert" : ""}`}>
        <div>
          <span className="label">Scene draft</span>
          <strong>{canPublish ? "Pending changes" : "Live and draft match"}</strong>
          <div className="subtle">Draft is based on live scene updated at {props.basedOnUpdatedAt || "unknown"}.</div>
        </div>
        <div className="inline-form">
          <button className="button secondary" onClick={toggleDraftEmergencyBanner} title="Toggle the draft emergency banner." type="button">
            {draft.emergencyBanner.trim() ? "Clear emergency banner" : "Activate emergency banner"}
          </button>
          <button
            className="button secondary"
            disabled={isPending || !hasLocalChanges}
            title={hasLocalChanges ? "Save the current draft changes." : "There are no local draft changes to save yet."}
            type="submit"
          >
            {isPending ? "Saving..." : "Save draft"}
          </button>
          <button
            className="button"
            disabled={isPending || !canPublish}
            onClick={() => setIsPublishReviewOpen(true)}
            title={canPublish ? "Review the draft diff before publishing." : "Live and draft already match."}
            type="button"
          >
            Review changes
          </button>
          <button
            className="button secondary"
            disabled={isPending || !canReset}
            onClick={() => {
              setError("");
              startTransition(() => void resetDraft());
            }}
            title={canReset ? "Reset the draft back to the live scene." : "The draft already matches the live scene."}
            type="button"
          >
            {isPending ? "Resetting..." : "Reset to live"}
          </button>
        </div>
      </div>

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
          {/*
            One preview, drawn by the renderer that goes on air. The studio used to draw its own
            HTML imitation of the overlay next to this one; it used a 5% safe area where the
            renderer uses 3.75% by 5.19%, allowed panel sizes and opacities the renderer clamps
            away, and at 1280x720 drew every panel half again as large as the broadcast. It is gone.
            What is shown here is the same drawing the playout puts on the picture.
          */}
          <figure className="scene-preview-figure">
            <figcaption className="label">
              As it goes on air, at {props.outputSize.width}x{props.outputSize.height}
            </figcaption>
            <div
              className="scene-preview-shell scene-preview-shell-render"
              style={{ aspectRatio: `${String(props.outputSize.width)} / ${String(props.outputSize.height)}` }}
            >
              <OverlayRenderPreview
                height={props.outputSize.height}
                immediateRevision={placementRevision}
                payload={previewPayload}
                width={props.outputSize.width}
              />
              <OverlayPlacementCanvas
                frame={props.outputSize}
                onCommit={commitPlacement}
                onOverlapChange={setOverlapNotice}
                onSelect={selectPlacement}
                selectedId={selectedPlacementId}
                targets={placementTargets}
              />
            </div>
          </figure>
          <p className="subtle">
            {overlapNotice
              ? overlapNotice
              : "Drag a box to move it, drag a handle to resize, arrow keys to nudge by one pixel and shift for eight. Hold Alt to ignore the grid and the guides."}
          </p>
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
            <label htmlFor="overlay-enabled">Enable overlay output</label>
          </div>

          {/*
            The scene list. Deliberately a select rather than one control per scene: a row of
            buttons would make this page's control count grow with the number of scenes, which is
            the pattern the control-density budget exists to keep out.
          */}
          <div className="form-grid">
            <label>
              <span className="label">Scene</span>
              <select
                onChange={(event) => applyScenes(scenes, event.target.value)}
                value={selectedScene?.id ?? ""}
              >
                {scenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Scene name</span>
              <input
                onChange={(event) => updateSelectedScene((scene) => ({ ...scene, name: event.target.value }))}
                value={selectedScene?.name ?? ""}
              />
            </label>
            <label>
              <span className="label">Scene video source</span>
              <select
                onChange={(event) => updateSelectedScene((scene) => ({ ...scene, sourceId: event.target.value }))}
                value={selectedScene?.sourceId ?? ""}
              >
                <option value="">Not linked to a source</option>
                {(props.videoSources ?? []).map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                    {source.urlPresent ? "" : " — no feed stored yet"}
                  </option>
                ))}
              </select>
            </label>
            <div className="inline-form" style={{ gridColumn: "1 / -1" }}>
              <button
                className="button secondary"
                disabled={scenes.length >= MAX_NAMED_OVERLAY_SCENES}
                onClick={addScene}
                type="button"
              >
                Add scene
              </button>
              <button
                className="button secondary"
                disabled={scenes.length >= MAX_NAMED_OVERLAY_SCENES}
                onClick={duplicateScene}
                type="button"
              >
                Duplicate scene
              </button>
              <button className="button secondary" disabled={scenes.length <= 1} onClick={removeScene} type="button">
                Delete scene
              </button>
            </div>
            <div className="subtle" style={{ gridColumn: "1 / -1" }}>
              The scene you pick here is the one being edited and the one that goes on air when you publish. A
              linked video source fills in for any source layer in this scene that names none, so a duplicated
              scene can be pointed at another camera in one step. If that source is later removed, the scene keeps
              the name but the layer falls back to the still picture, exactly as an unlinked layer does.
            </div>
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

          {/*
            The cards below are the only way to choose this now. A select offering the same six
            presets sat directly above them — one choice, two controls, and the select could only
            list the names while the cards say what each one does.
          */}
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

          {/*
            Eight layers, three buttons each: twenty-four of this page's seventy-nine controls were
            here, permanently open, for a task done rarely and never in a hurry. Each layer already
            states its position and whether it is visible, so folding the group away costs the
            reordering buttons and no information.
          */}
          <div className="list">
            <details className="disclosure item">
              <summary>Scene layer order</summary>
              <div className="subtle" style={{ marginTop: 8 }}>
                Top to bottom render order inside the current scene preset.
              </div>
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
            </details>
          </div>

          <p className="subtle">
            Asset, insert, standby, and reconnect modes can now each resolve to different scene presets without changing the main live scene.
          </p>

          <div className="list">
            <div className="item">
              {/* Controlled, so clicking a box on the preview can open the fold at the panel it
                  belongs to. The number fields stay: a drag says "about here", the fields say
                  exactly where, and an operator setting up a channel wants both. */}
              <details onToggle={(event) => setPlacementFoldOpen(event.currentTarget.open)} open={placementFoldOpen}>
                <summary>
                  <span className="label">Panel placement</span>
                  <span className="subtle">
                    {" "}
                    {Object.keys(draft.panelPlacements).length > 0
                      ? `${String(Object.keys(draft.panelPlacements).length)} panel${Object.keys(draft.panelPlacements).length === 1 ? "" : "s"} placed`
                      : "Every panel where the layout puts it"}
                  </span>
                </summary>
                <div className="subtle" style={{ marginTop: 8 }}>
                  The panels the overlay draws itself take the same box a positioned layer takes: x, y, width and height as
                  percentages of the safe area, plus opacity. A panel you have not placed stays exactly where the layout puts
                  it, so nothing on air moves until you move it. Placing one seeds its box from where it already is.
                </div>
                <div className="list" style={{ marginTop: 12 }}>
                  {OVERLAY_PANEL_LABELS.map((panel) => {
                    const placement = draft.panelPlacements[panel.id];
                    return (
                      <div
                        className="item"
                        data-selected={selectedPlacementId === `panel:${panel.id}` ? "true" : "false"}
                        id={`placement-panel-${panel.id}`}
                        key={panel.id}
                      >
                        <label className="toggle-row">
                          <input checked={Boolean(placement)} onChange={() => togglePanelPlacement(panel.id)} type="checkbox" />
                          <span>
                            <strong>{panel.label}</strong>
                            <span className="subtle"> {placement ? describePanelBox(placement) : panel.hint}</span>
                          </span>
                        </label>
                        {placement ? (
                          <div className="form-grid" style={{ marginTop: 12 }}>
                            <label>
                              <span className="label">X position (%)</span>
                              <input
                                max={90}
                                min={0}
                                onChange={(event) => updatePanelPlacement(panel.id, { xPercent: Number(event.target.value) || 0 })}
                                type="number"
                                value={placement.xPercent}
                              />
                            </label>
                            <label>
                              <span className="label">Y position (%)</span>
                              <input
                                max={90}
                                min={0}
                                onChange={(event) => updatePanelPlacement(panel.id, { yPercent: Number(event.target.value) || 0 })}
                                type="number"
                                value={placement.yPercent}
                              />
                            </label>
                            <label>
                              <span className="label">Width (%)</span>
                              <input
                                max={100}
                                min={10}
                                onChange={(event) =>
                                  updatePanelPlacement(panel.id, { widthPercent: Number(event.target.value) || placement.widthPercent })
                                }
                                type="number"
                                value={placement.widthPercent}
                              />
                            </label>
                            <label>
                              <span className="label">Height (%)</span>
                              <input
                                max={100}
                                min={8}
                                onChange={(event) =>
                                  updatePanelPlacement(panel.id, { heightPercent: Number(event.target.value) || placement.heightPercent })
                                }
                                type="number"
                                value={placement.heightPercent}
                              />
                            </label>
                            <label>
                              <span className="label">Opacity (%)</span>
                              <input
                                max={100}
                                min={5}
                                onChange={(event) =>
                                  updatePanelPlacement(panel.id, { opacityPercent: Number(event.target.value) || placement.opacityPercent })
                                }
                                type="number"
                                value={placement.opacityPercent}
                              />
                            </label>
                            <label className="toggle-row">
                              <input
                                checked={placement.allowOutsideSafeArea}
                                onChange={(event) => updatePanelPlacement(panel.id, { allowOutsideSafeArea: event.target.checked })}
                                type="checkbox"
                              />
                              <span>Allow outside safe area</span>
                            </label>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </details>
            </div>
            <div className="item">
              <span className="label">Positioned layers</span>
              <div className="subtle">
                Add custom text, logo, image, website, widget, or chat-game layers on top of the preset layout. Text layers can switch to safe
                local font stacks, metadata widgets can read from the canonical scene payload, and browser frames remain limited by each
                provider&apos;s iframe and CSP rules.
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
                    <div
                      className="item"
                      data-selected={selectedPlacementId === `layer:${layer.id}` ? "true" : "false"}
                      id={`placement-layer-${layer.id}`}
                      key={layer.id}
                    >
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
                        <label className="toggle-row">
                          <input
                            checked={layer.allowOutsideSafeArea}
                            onChange={(event) =>
                              updateCustomLayer(layer.id, (current) => ({
                                ...current,
                                allowOutsideSafeArea: event.target.checked
                              }))
                            }
                            type="checkbox"
                          />
                          <span>Allow outside safe area</span>
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
                                Metadata cards render from the canonical Scene payload. Browser widget frames still depend on provider iframe
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
                                This widget stays inside the published Scene contract and mirrors browser plus on-air scene data without a
                                remote iframe.
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
                            {describeOverlaySceneFrameSupport(layer.url).guidance} Embedded frames render in the
                            browser overlay page only — the on-air picture cannot draw external sites, so treat
                            this layer as preview content.
                          </div>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      {layer.kind === "game" ? (
                        <>
                          <div className="form-grid" style={{ marginTop: 12 }}>
                            <label>
                              <span className="label">Board backdrop (%)</span>
                              <input
                                max={100}
                                min={0}
                                onChange={(event) =>
                                  updateCustomLayer(layer.id, (current) =>
                                    current.kind === "game"
                                      ? { ...current, backgroundOpacityPercent: Math.max(0, Math.min(100, Number(event.target.value) || 0)) }
                                      : current
                                  )
                                }
                                type="number"
                                value={layer.backgroundOpacityPercent}
                              />
                            </label>
                          </div>
                          <div className="subtle" style={{ marginTop: 12 }}>
                            This layer places the chat game panel in the scene. Which game runs, its grid, and the
                            emote controls are configured under Overlays → Chat game, because the same round continues
                            across scene changes. The backdrop is the fill behind the board and goes all the way to 0 —
                            the cells stay outlined, so the game reads over the programme picture with no panel at all.
                            A box over the whole frame gives a board over the whole frame.
                          </div>
                        </>
                      ) : null}
                      {layer.kind === "source" ? (
                        <div className="form-grid" style={{ marginTop: 12 }}>
                          <label>
                            <span className="label">Stored video source</span>
                            <select
                              onChange={(event) =>
                                updateCustomLayer(layer.id, (current) =>
                                  current.kind === "source" ? { ...current, sourceId: event.target.value } : current
                                )
                              }
                              value={layer.sourceId}
                            >
                              <option value="">Not linked yet</option>
                              {(props.videoSources ?? []).map((source) => (
                                <option key={source.id} value={source.id}>
                                  {source.name}
                                  {source.urlPresent ? "" : " — no feed stored yet"}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="subtle" style={{ gridColumn: "1 / -1" }}>
                            The layer only places the picture. Feeds live in the video source list below the scene
                            controls, their addresses stay stored encrypted, and on air the layer disappears while
                            its feed is unreachable instead of freezing on a stale picture.
                          </div>
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
                        Asset {describeScenePreset(preset.overlay.scenePreset)} · Insert {describeScenePreset(preset.overlay.insertScenePreset)} · Standby {describeScenePreset(preset.overlay.standbyScenePreset)} · Reconnect{" "}
                        {describeScenePreset(preset.overlay.reconnectScenePreset)}
                      </div>
                      <div className="subtle">
                        Typography {describeTypographyPreset(preset.overlay.typographyPreset)} · {preset.overlay.customLayers.length} positioned layer
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
          <strong>{describeScenePreset(props.liveOverlay.scenePreset)}</strong>
          <div className="subtle">
            Asset headline {props.liveOverlay.headline} · Insert {props.liveOverlay.insertHeadline} · Standby {props.liveOverlay.standbyHeadline} ·
            Reconnect {props.liveOverlay.reconnectHeadline}
          </div>
          <div className="subtle">
            Typography {describeTypographyPreset(props.liveOverlay.typographyPreset)} · {props.liveOverlay.customLayers.length} positioned layer
            {props.liveOverlay.customLayers.length === 1 ? "" : "s"}
          </div>
          <div className="subtle">
            Asset {describeScenePreset(props.liveOverlay.scenePreset)} · Insert {describeScenePreset(props.liveOverlay.insertScenePreset)} · Standby {describeScenePreset(props.liveOverlay.standbyScenePreset)} · Reconnect{" "}
            {describeScenePreset(props.liveOverlay.reconnectScenePreset)}
          </div>
          <div className="subtle">Published {props.liveOverlay.updatedAt || "never"}</div>
        </div>
        <div className="item">
          <span className="label">Draft scene</span>
          <strong>{describeScenePreset(draft.scenePreset)}</strong>
          <div className="subtle">
            Asset headline {draft.headline} · Insert {draft.insertHeadline} · Standby {draft.standbyHeadline} · Reconnect {draft.reconnectHeadline}
          </div>
          <div className="subtle">
            Typography {describeTypographyPreset(draft.typographyPreset)} · {draft.customLayers.length} positioned layer{draft.customLayers.length === 1 ? "" : "s"}
          </div>
          <div className="subtle">
            Asset {describeScenePreset(draft.scenePreset)} · Insert {describeScenePreset(draft.insertScenePreset)} · Standby {describeScenePreset(draft.standbyScenePreset)} · Reconnect {describeScenePreset(draft.reconnectScenePreset)}
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
      <ScenePublishReviewDialog
        isPending={isPending}
        onClose={() => setIsPublishReviewOpen(false)}
        onPublish={() => {
          setError("");
          startTransition(() => void publishLive());
        }}
        open={isPublishReviewOpen}
        sections={reviewSections}
      />
    </form>
  );
}
