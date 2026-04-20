"use client";

import type { PublicChannelSnapshot } from "@/lib/live-broadcast";
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
  const overlayScale = Math.min(1, Math.max(0.62, outputHeight / 720));
  const px = (value: number) => `${Math.round(value * overlayScale)}px`;
  const rem = (value: number) => `${(value * overlayScale).toFixed(3)}rem`;

  return (
    <main
      className={`overlay-page${props.chromeless ? " overlay-page-chromeless" : ""}`}
      style={
        {
          "--overlay-output-width": `${outputWidth}px`,
          "--overlay-output-height": `${outputHeight}px`,
          "--overlay-gap": px(18),
          "--overlay-card-padding": px(20),
          "--overlay-card-large-padding": px(26),
          "--overlay-card-xl-padding": px(32),
          "--overlay-title-margin-top": px(10),
          "--overlay-title-margin-bottom": px(8),
          "--overlay-chip-padding-y": px(10),
          "--overlay-chip-padding-x": px(14),
          "--overlay-chip-font-size": rem(0.85),
          "--overlay-banner-padding-y": px(14),
          "--overlay-banner-padding-x": px(18),
          "--overlay-ticker-padding-y": px(12),
          "--overlay-ticker-padding-x": px(18),
          "--overlay-ticker-font-size": rem(0.88),
          "--overlay-custom-text-padding-y": px(18),
          "--overlay-custom-text-padding-x": px(20),
          "--overlay-custom-widget-padding-y": px(20),
          "--overlay-custom-widget-padding-x": px(22),
          "--overlay-title-compact-min": rem(1.65),
          "--overlay-title-compact-max": rem(2.7),
          "--overlay-title-balanced-min": rem(2),
          "--overlay-title-balanced-max": rem(3.8),
          "--overlay-title-cinematic-min": rem(2.4),
          "--overlay-title-cinematic-max": rem(5),
          "--overlay-custom-headline-min": rem(1.5),
          "--overlay-custom-headline-max": rem(2.6),
          "--overlay-custom-body-min": rem(1),
          "--overlay-custom-body-max": rem(1.4),
          "--overlay-custom-caption-size": rem(0.92),
          "--overlay-custom-widget-title-min": rem(1.2),
          "--overlay-custom-widget-title-max": rem(2.2)
        } as CSSProperties
      }
    >
      <OverlaySceneCanvas payload={snapshot.activeScenePayload} />
      <EngagementOverlay initialEngagement={snapshot.engagement} />
    </main>
  );
}
