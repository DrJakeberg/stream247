import { builtInViewerTextKey, localizeViewerBuiltInText, resolveOverlayHeadlineForQueueKind } from "@stream247/core";

type OverlayHeadlines = {
  headline: string;
  insertHeadline: string;
  standbyHeadline: string;
  reconnectHeadline: string;
};

/**
 * The four headlines as viewers read them (M104, U14): a stored built-in default such as
 * "Please wait, restream is starting" goes on air as the catalogue's text in the channel language,
 * so the admin summaries show that text, through the same resolver the picture uses.
 */
export function describeOverlayHeadlines(overlay: OverlayHeadlines, locale: string): string {
  const overrides = {
    insertHeadline: overlay.insertHeadline,
    standbyHeadline: overlay.standbyHeadline,
    reconnectHeadline: overlay.reconnectHeadline
  };
  const on = (kind: "asset" | "insert" | "standby" | "reconnect") =>
    resolveOverlayHeadlineForQueueKind(overlay.headline, kind, overrides, locale);
  return `Asset headline ${on("asset")} · Insert ${on("insert")} · Standby ${on("standby")} · Reconnect ${on("reconnect")}`;
}

/**
 * What viewers read for a headline field's stored value, when that differs from the field: a built-in
 * default is replaced by the catalogue's text in the channel language. Null when the field is what airs.
 */
export function describeOnAirWording(value: string, locale: string): string | null {
  const stored = value.trim();
  if (!builtInViewerTextKey(stored)) {
    return null;
  }
  const onAir = localizeViewerBuiltInText(locale, stored);
  return onAir === stored ? null : onAir;
}
