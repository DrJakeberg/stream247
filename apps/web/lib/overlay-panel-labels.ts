import type { OverlayPanelId } from "@stream247/core";

/**
 * What the operator calls each of the renderer's own panels.
 *
 * One list, because two would drift: the sidebar names a panel when you place it and the publish
 * review names the same panel when it tells you two boxes overlap, and a review that said "hero"
 * where the form said "Now playing" would be a review about a different page.
 */
export const OVERLAY_PANEL_LABELS: { id: OverlayPanelId; label: string; hint: string }[] = [
  { id: "hero", label: "Now playing", hint: "The lower third: label, title, and the line under it." },
  { id: "next", label: "Up next", hint: "The small card in the right rail, when no vote is running." },
  { id: "vote", label: "Vote panel", hint: "Takes the rail's corner while chat is voting." },
  { id: "chat", label: "Chat", hint: "Fits as many of the newest messages as its height holds." },
  { id: "clock", label: "Clock", hint: "Channel time, top right." },
  { id: "banner", label: "Emergency banner", hint: "Only on air while the banner has text." },
  { id: "ticker", label: "Ticker", hint: "Only on air while the ticker has text. One message at a time." }
];

export function overlayPanelLabel(id: OverlayPanelId): string {
  return OVERLAY_PANEL_LABELS.find((panel) => panel.id === id)?.label ?? id;
}
