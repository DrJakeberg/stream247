"use client";

import type { PublicChannelSnapshot } from "@/lib/live-broadcast";
import { resolveLiveOverlayStyle } from "@/lib/overlay-layout";
import { EngagementOverlay } from "@/components/engagement-overlay";
import { OverlaySceneCanvas } from "@/components/overlay-scene-canvas";
import { useLiveSnapshot } from "@/components/use-live-snapshot";
import type { CSSProperties } from "react";

export function LiveOverlay(props: {
  initialSnapshot: PublicChannelSnapshot;
  chromeless?: boolean;
  output?: {
    width: number;
    height: number;
  };
}) {
  const { snapshot } = useLiveSnapshot({
    initialSnapshot: props.initialSnapshot,
    stateUrl: "/api/channel/live",
    streamUrl: "/api/channel/live/stream"
  });
  const outputWidth = props.output?.width ?? 1280;
  const outputHeight = props.output?.height ?? 720;
  return (
    <main
      className={`overlay-page${props.chromeless ? " overlay-page-chromeless" : ""}`}
      style={resolveLiveOverlayStyle(outputWidth, outputHeight) as CSSProperties}
    >
      <OverlaySceneCanvas payload={snapshot.activeScenePayload} />
      <EngagementOverlay initialEngagement={snapshot.engagement} />
    </main>
  );
}
