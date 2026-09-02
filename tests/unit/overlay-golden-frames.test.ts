import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildOverlaySceneLayout,
  type OverlayChatView,
  type OverlayEngagementView,
  type OverlayScenePayloadView
} from "@stream247/core";
import { loadSceneRendererFonts, renderSceneSvg } from "@stream247/overlay-render";

/**
 * The picture that goes on air, frozen.
 *
 * The overlay studio is being rebuilt around the renderer, over several steps, and the rule for
 * every one of them is that the broadcast picture does not move until somebody moves it on purpose.
 * That is easy to say and impossible to check by looking: a lower third that shifts four pixels is
 * invisible in review and obvious on a stream.
 *
 * So each fixture is reduced to two checksums.
 *
 * The layout checksum covers the tree the layout builder produces — every box, every colour, every
 * clamped placement — and depends on nothing outside this repository. It is the one that will catch
 * a refactor that meant to change nothing.
 *
 * The SVG checksum additionally covers what satori does with that tree, which means it also depends
 * on the font metrics of the installed DejaVu. That makes it the sharper check and the more
 * fragile one; a mismatch there with the layout checksum intact points at the font, not the code.
 *
 * When a change is meant to move the picture, these constants are re-recorded in the same commit
 * that moves it, and the commit message says what moved and why.
 */

const FROZEN_AT = new Date("2026-02-01T21:30:00.000Z");

function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function basePayload(): OverlayScenePayloadView {
  return {
    scene: {
      surfaceStyle: "glass",
      panelAnchor: "bottom",
      titleScale: "balanced",
      typographyPreset: "studio-sans",
      resolvedPresetId: "lower-third",
      customLayers: []
    },
    channelName: "3JC Retro",
    accentColor: "#6ee7ff",
    brandLine: "STREAM247",
    heroLabel: "Now playing",
    heroTitle: "Advent of Code 2025",
    heroBody: "Recorded live",
    metaLine: "Programming",
    nextLabel: "Up next",
    nextTitle: "Retro Night",
    nextTimeLabel: "21:30",
    queueTitles: ["Prime time replay", "Late night standby"],
    tickerText: "Stream247 keeps the channel on air around the clock",
    emergencyBanner: "",
    timeZone: "Europe/Berlin"
  };
}

const chat: OverlayChatView = {
  position: "bottom-left",
  maxMessages: 5,
  messages: [
    { name: "viewer_one", text: "Kappa this stream rules Kappa" },
    { name: "配信好き", text: "これは非常に長い全角メッセージでレイアウトの幅見積もりを壊しに来ています" }
  ]
};

const engagement: OverlayEngagementView = {
  kind: "vote-next",
  headline: "What runs next?",
  options: [
    { token: "1", title: "Retro Night", votes: 41 },
    { token: "2", title: "Late night standby", votes: 25 }
  ],
  totalVotes: 66,
  secondsRemaining: 40,
  threshold: 0,
  hint: "Type 1 or 2 in chat"
};

type GoldenFrame = {
  name: string;
  input: Parameters<typeof buildOverlaySceneLayout>[0];
  width: number;
  height: number;
  layout: string;
  svg: string;
};

const FRAMES: GoldenFrame[] = [
  {
    name: "lower third, the frame that is on air most of the time",
    input: { payload: basePayload() },
    width: 1920,
    height: 1080,
    layout: "0eca45b0776bab1f",
    svg: "fb49ef0bbedf70d0"
  },
  {
    name: "emergency banner, the frame nobody looks at until it matters",
    input: { payload: { ...basePayload(), emergencyBanner: "Transmission resumes at 22:00" } },
    width: 1920,
    height: 1080,
    layout: "c9c595ed468d57bd",
    svg: "32f6da22a9469267"
  },
  {
    name: "chat and a vote together, the busiest the overlay ever gets",
    input: { payload: basePayload(), chat, engagement },
    width: 1920,
    height: 1080,
    layout: "dbaca76a0bef975b",
    svg: "00d29615f2fbfa81"
  },
  {
    name: "positioned layers, including the ones the renderer clamps or refuses",
    input: {
      payload: {
        ...basePayload(),
        scene: {
          ...basePayload().scene,
          customLayers: [
            // Inside the rules: drawn as asked.
            {
              kind: "text",
              enabled: true,
              xPercent: 60,
              yPercent: 12,
              widthPercent: 30,
              heightPercent: 14,
              opacityPercent: 90,
              allowOutsideSafeArea: false,
              text: "Sponsored by nobody",
              secondaryText: "and proud of it",
              textTone: "muted",
              textAlign: "left",
              useAccent: true,
              fontMode: "sans"
            },
            // Below every floor the renderer enforces: opacity under 5, width under 10, height
            // under 8. The studio rebuild drew these as asked; the renderer never has.
            {
              kind: "text",
              enabled: true,
              xPercent: 4,
              yPercent: 4,
              widthPercent: 3,
              heightPercent: 2,
              opacityPercent: 1,
              allowOutsideSafeArea: false,
              text: "Clamped",
              textTone: "default",
              textAlign: "center",
              useAccent: false,
              fontMode: "mono"
            },
            // A relative path. The browser resolves it against the page and shows a picture; the
            // renderer draws only data: and http(s), so on air there is nothing here.
            {
              kind: "logo",
              enabled: true,
              xPercent: 78,
              yPercent: 70,
              widthPercent: 16,
              heightPercent: 20,
              opacityPercent: 100,
              allowOutsideSafeArea: true,
              url: "/uploads/channel-logo.png",
              fit: "contain"
            }
          ]
        }
      }
    },
    width: 1920,
    height: 1080,
    layout: "426f57f46cbd8d65",
    svg: "ae594fcc183e0663"
  },
  {
    name: "720p, where every dimension is scaled rather than redesigned",
    input: { payload: basePayload(), chat },
    width: 1280,
    height: 720,
    layout: "9f10b3f1d6502a2e",
    svg: "c162d027ac944dca"
  }
];

describe("overlay golden frames", () => {
  it.each(FRAMES)("$name", async (frame) => {
    const tree = buildOverlaySceneLayout(frame.input, {
      width: frame.width,
      height: frame.height,
      now: FROZEN_AT
    });

    expect(checksum(JSON.stringify(tree))).toBe(frame.layout);

    let fonts;
    try {
      fonts = await loadSceneRendererFonts(process.env);
    } catch {
      // No font on this machine; the renderer could not start either. The layout checksum above
      // still ran, so this is a narrower check skipped, not a check that passed by accident.
      return;
    }

    const svg = await renderSceneSvg(
      { ...frame.input, width: frame.width, height: frame.height, now: FROZEN_AT },
      fonts,
      { embedFont: false }
    );

    expect(
      checksum(svg),
      "The layout is unchanged but satori drew it differently, which points at a different version " +
        "of DejaVu on this machine rather than at a change in this repository."
    ).toBe(frame.svg);
  }, 30_000);
});
