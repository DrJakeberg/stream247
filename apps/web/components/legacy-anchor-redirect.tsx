"use client";

import { useEffect } from "react";

/**
 * Sends a link to a section that moved on to its new page. A fragment never reaches the server, so the
 * redirect has to happen in the browser: `/live?tab=status#output-destinations` lands on the destination
 * forms in Studio → Output since M99 (U1).
 */
export function LegacyAnchorRedirect(props: { anchors: string[]; target: string }) {
  // A key, not the array: the caller writes the list inline, which is a new array on every render.
  const anchorKey = props.anchors.join(" ");
  useEffect(() => {
    const anchors = anchorKey.split(" ");
    const follow = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (hash && anchors.includes(hash)) {
        window.location.replace(props.target);
      }
    };
    follow();
    // A link to the anchor from the page itself changes only the fragment and renders nothing anew.
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [anchorKey, props.target]);

  return null;
}
