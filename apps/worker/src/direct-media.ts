// Direct media sources: one operator-supplied URL that becomes exactly one playable asset.
//
// The sync used to build assets only for sources whose URL validated, but handed *every* direct
// source id to the wholesale replaceAssetsForSourceIds. So a URL that failed validation — a typo,
// a link an operator edited mid-cycle, a CDN path that gained a query string — contributed no
// asset while still authorising the delete, and the stored asset vanished. That is the same
// failure shape as the Twitch archive wipe: absence of evidence used as evidence of absence.
//
// Splitting the classification out of the sync keeps the two lists that must agree — which
// sources produced an asset, and which sources may be emptied — derived from one pass.
import path from "node:path";
import { MEDIA_FILE_EXTENSIONS } from "./local-library.js";

export function isDirectMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && MEDIA_FILE_EXTENSIONS.has(path.extname(url.pathname).toLowerCase());
  } catch {
    return false;
  }
}

export type DirectMediaSource = { id: string; externalUrl?: string };

export type DirectMediaSyncPlan<TSource extends DirectMediaSource> = {
  /** Sources that resolved to a usable media URL, in input order, with the trimmed URL. */
  entries: Array<{ source: TSource; url: string }>;
  /**
   * Sources whose URL could not be turned into an asset this cycle.
   *
   * Fed to the replacement scope as a failed ingest: an unusable URL says nothing about whether
   * the source's stored asset is still good, so the stored row stays.
   */
  invalidSourceIds: Set<string>;
};

export function planDirectMediaSync<TSource extends DirectMediaSource>(
  sources: readonly TSource[]
): DirectMediaSyncPlan<TSource> {
  const entries: Array<{ source: TSource; url: string }> = [];
  const invalidSourceIds = new Set<string>();

  for (const source of sources) {
    const url = source.externalUrl?.trim() ?? "";
    if (isDirectMediaUrl(url)) {
      entries.push({ source, url });
    } else {
      invalidSourceIds.add(source.id);
    }
  }

  return { entries, invalidSourceIds };
}
