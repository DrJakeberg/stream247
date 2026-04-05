"use client";

import type { PublicChannelSnapshot } from "@/lib/live-broadcast";
import { OverlaySceneCanvas } from "@/components/overlay-scene-canvas";
import { useLiveSnapshot } from "@/components/use-live-snapshot";

export function LiveOverlay(props: { initialSnapshot: PublicChannelSnapshot; chromeless?: boolean }) {
  const { snapshot } = useLiveSnapshot({
    initialSnapshot: props.initialSnapshot,
    stateUrl: "/api/channel/live",
    streamUrl: "/api/channel/live/stream"
  });

  return (
    <main className={`overlay-page${props.chromeless ? " overlay-page-chromeless" : ""}`}>
      <OverlaySceneCanvas payload={snapshot.activeScenePayload} />
    </main>
  );
}
