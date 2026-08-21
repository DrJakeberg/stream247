import { describe, expect, it } from "vitest";
import {
  buildOverlaySceneLayout,
  clampOverlayText,
  formatOverlayClock,
  overlayScale,
  type OverlayEngagementView,
  type OverlayLayoutNode,
  type OverlayScenePayloadView
} from "@stream247/core";

function createPayload(overrides: Partial<OverlayScenePayloadView> = {}): OverlayScenePayloadView {
  return {
    scene: {
      surfaceStyle: "glass",
      panelAnchor: "bottom",
      titleScale: "balanced",
      typographyPreset: "studio-sans",
      resolvedPresetId: "lower-third"
    },
    channelName: "3JC Retro",
    accentColor: "#6ee7ff",
    brandLine: "STREAM247",
    heroLabel: "Now playing",
    heroTitle: "Advent of Code 2025",
    heroBody: "Recorded live",
    metaLine: "Programming · Twitch VOD",
    nextLabel: "Up next",
    nextTitle: "Retro Night",
    nextTimeLabel: "21:30",
    queueTitles: [],
    tickerText: "",
    emergencyBanner: "",
    timeZone: "Europe/Berlin",
    ...overrides
  };
}

/** Collects every string leaf, so assertions can ask what the frame actually says. */
function collectText(node: OverlayLayoutNode | OverlayLayoutNode[] | string | undefined): string[] {
  if (typeof node === "string") {
    return [node];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectText);
  }
  if (!node) {
    return [];
  }
  return collectText(node.props.children);
}

function collectStyles(node: OverlayLayoutNode | OverlayLayoutNode[] | string | undefined): Record<string, unknown>[] {
  if (typeof node === "string" || !node) {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectStyles);
  }
  return [node.props.style ?? {}, ...collectStyles(node.props.children)];
}

const options = { width: 1920, height: 1080, now: new Date("2026-08-18T18:10:00.000Z") };

describe("overlayScale", () => {
  it("maps the design grid onto the configured output width", () => {
    expect(overlayScale(1920)).toBe(1);
    expect(overlayScale(1280)).toBeCloseTo(0.667, 2);
  });

  it("never collapses below a legible floor", () => {
    expect(overlayScale(320)).toBe(0.35);
  });
});

describe("clampOverlayText", () => {
  it("leaves short text untouched", () => {
    expect(clampOverlayText("Retro Night", 40)).toBe("Retro Night");
  });

  it("truncates on a word boundary", () => {
    const result = clampOverlayText("Advent of Code 2025 Day Fourteen Marathon Special", 30);

    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result).not.toMatch(/\s…$/);
  });

  it("still truncates a single unbroken word", () => {
    const result = clampOverlayText("A".repeat(80), 20);

    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith("…")).toBe(true);
  });

  it("treats an empty-array artefact as empty", () => {
    expect(clampOverlayText("[]", 40)).toBe("");
  });
});

describe("formatOverlayClock", () => {
  it("renders in the channel timezone", () => {
    expect(formatOverlayClock(new Date("2026-08-18T18:10:00.000Z"), "Europe/Berlin")).toBe("20:10");
    expect(formatOverlayClock(new Date("2026-08-18T18:10:00.000Z"), "UTC")).toBe("18:10");
  });

  it("falls back instead of throwing on an invalid timezone", () => {
    expect(() => formatOverlayClock(new Date(), "Not/AZone")).not.toThrow();
  });
});

describe("buildOverlaySceneLayout", () => {
  it("puts the programme information on the frame", () => {
    const layout = buildOverlaySceneLayout({ payload: createPayload() }, options);
    const texts = collectText(layout);

    expect(texts).toContain("Advent of Code 2025");
    expect(texts).toContain("Recorded live");
    expect(texts).toContain("NOW PLAYING");
    expect(texts.join(" ")).toContain("3JC Retro");
  });

  it("sizes the canvas to the configured output", () => {
    const layout = buildOverlaySceneLayout({ payload: createPayload() }, { width: 1280, height: 720 });

    expect(layout.props.style).toMatchObject({ width: "1280px", height: "720px" });
  });

  it("keeps the canvas fully transparent so ffmpeg composites it over the programme", () => {
    const layout = buildOverlaySceneLayout({ payload: createPayload() }, options);

    expect(layout.props.style?.backgroundColor).toBe("rgba(0,0,0,0)");
  });

  it("shows the next item when nothing else claims the right rail", () => {
    const layout = buildOverlaySceneLayout({ payload: createPayload() }, options);

    expect(collectText(layout)).toContain("Retro Night");
  });

  it("gives the vote panel priority over the next item", () => {
    const engagement: OverlayEngagementView = {
      kind: "vote-next",
      headline: "Was läuft als Nächstes?",
      options: [
        { token: "!1", title: "Retro Night", votes: 12 },
        { token: "!2", title: "Coding Marathon", votes: 5 }
      ],
      totalVotes: 17,
      secondsRemaining: 30,
      threshold: 0,
      hint: "Schreib !1 oder !2"
    };

    const texts = collectText(buildOverlaySceneLayout({ payload: createPayload(), engagement }, options));

    expect(texts).toContain("!1");
    expect(texts).toContain("30s");
    // "Up next" gave way to the thing viewers are being asked to act on.
    expect(texts).not.toContain("UP NEXT · 21:30");
  });

  it("renders a zero-vote option with a visible bar rather than nothing", () => {
    const engagement: OverlayEngagementView = {
      kind: "vote-next",
      headline: "Vote",
      options: [{ token: "!1", title: "Nobody voted for this", votes: 0 }],
      totalVotes: 0,
      secondsRemaining: 10,
      threshold: 0,
      hint: ""
    };

    const widths = collectStyles(buildOverlaySceneLayout({ payload: createPayload(), engagement }, options))
      .map((style) => style.width)
      .filter((width): width is string => typeof width === "string" && width.endsWith("%"));

    expect(widths).toContain("2%");
  });

  it("does not divide by zero when a vote has no votes yet", () => {
    const engagement: OverlayEngagementView = {
      kind: "vote-next",
      headline: "Vote",
      options: [{ token: "!1", title: "A", votes: 0 }],
      totalVotes: 0,
      secondsRemaining: 5,
      threshold: 0,
      hint: ""
    };

    expect(() => buildOverlaySceneLayout({ payload: createPayload(), engagement }, options)).not.toThrow();
  });

  it("surfaces an emergency banner", () => {
    const layout = buildOverlaySceneLayout(
      { payload: createPayload({ emergencyBanner: "Technische Stoerung" }) },
      options
    );

    expect(collectText(layout)).toContain("Technische Stoerung");
  });

  it("falls back to a safe accent when the configured colour is not a hex value", () => {
    const styles = collectStyles(
      buildOverlaySceneLayout({ payload: createPayload({ accentColor: "javascript:alert(1)" }) }, options)
    );

    const accents = styles.map((style) => style.backgroundColor).filter(Boolean);
    expect(accents).toContain("#6ee7ff");
    expect(JSON.stringify(styles)).not.toContain("javascript:");
  });

  it("omits sections whose content is empty instead of drawing empty boxes", () => {
    const layout = buildOverlaySceneLayout(
      { payload: createPayload({ heroBody: "", metaLine: "", nextTitle: "" }) },
      options
    );
    const texts = collectText(layout);

    expect(texts).not.toContain("");
    expect(texts).toContain("Advent of Code 2025");
  });

  it("renders every surface style and title scale without throwing", () => {
    for (const surfaceStyle of ["glass", "solid", "signal"]) {
      for (const titleScale of ["compact", "balanced", "cinematic"]) {
        const payload = createPayload();
        payload.scene = { ...payload.scene, surfaceStyle, titleScale };

        expect(() => buildOverlaySceneLayout({ payload }, options)).not.toThrow();
      }
    }
  });
});
