// Declarative broadcast-overlay layout.
//
// This is the single description of what goes on air. The worker rasterises it (satori -> SVG ->
// resvg -> PNG) straight into the ffmpeg filter chain, so the overlay is part of the encode rather
// than a separate surface someone has to composite. The admin preview renders the same tree, so
// what an operator sees is what viewers see.
//
// It replaces a renderer that launched a whole Chromium process per frame to take a screenshot of
// the /overlay page. On the production box that took over 10s and timed out on every attempt, so
// the overlay silently degraded to an ffmpeg drawtext line while also stalling playout starts.
//
// The node shape is satori's element format, declared here so this package stays dependency-free
// and unit-testable. Only the CSS subset satori implements may be used: flexbox, absolute
// positioning, colours, gradients, borders, radii, and text properties. No filters, no transforms,
// no external assets.

export type OverlayLayoutStyle = Record<string, string | number>;

export type OverlayLayoutNode = {
  type: string;
  props: {
    style?: OverlayLayoutStyle;
    children?: OverlayLayoutNode | OverlayLayoutNode[] | string;
  };
};

export type OverlayLayoutOptions = {
  width: number;
  height: number;
  /** Wall clock used for the on-air clock, injected so renders stay deterministic in tests. */
  now?: Date;
};

/** Scales every dimension from the 1920x1080 design grid to the configured output size. */
export function overlayScale(width: number): number {
  return Math.max(0.35, width / 1920);
}

function text(value: unknown): string {
  const normalized = String(value ?? "").trim();
  return normalized && normalized !== "[]" ? normalized : "";
}

function joinText(values: unknown[], separator: string): string {
  return values.map((value) => text(value)).filter(Boolean).join(separator);
}

function row(style: OverlayLayoutStyle, children: OverlayLayoutNode[]): OverlayLayoutNode {
  return { type: "div", props: { style: { display: "flex", ...style }, children } };
}

function label(value: string, style: OverlayLayoutStyle): OverlayLayoutNode {
  return { type: "div", props: { style: { display: "flex", ...style }, children: value } };
}

/**
 * Formats the on-air clock in the channel's own timezone.
 *
 * Intl is used rather than manual offset arithmetic so DST transitions are handled by the runtime.
 * An invalid timezone must not take the overlay down, so it falls back to the host zone.
 */
export function formatOverlayClock(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timeZone || undefined
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  }
}

/**
 * Truncates to a character budget on a whole-word boundary where possible, so a long VOD title
 * degrades into something readable instead of overflowing the panel.
 */
export function clampOverlayText(value: string, maxChars: number): string {
  const normalized = text(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const hardCut = normalized.slice(0, Math.max(1, maxChars - 1));
  const lastSpace = hardCut.lastIndexOf(" ");
  const body = lastSpace > maxChars * 0.6 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${body.trimEnd()}…`;
}

export { joinText as joinOverlayText, text as visibleOverlayText, label as overlayLabelNode, row as overlayRowNode };

export type OverlayVoteOptionView = {
  token: string;
  title: string;
  votes: number;
};

/** Live chat-driven state drawn on top of the programme scene. */
export type OverlayEngagementView = {
  kind: "none" | "vote-next" | "skip-vote";
  headline: string;
  options: OverlayVoteOptionView[];
  totalVotes: number;
  secondsRemaining: number;
  /** For skip votes: how many votes are still needed to pass. */
  threshold: number;
  hint: string;
};

export type OverlayLayoutInput = {
  payload: OverlayScenePayloadView;
  engagement?: OverlayEngagementView | null;
};

/** The subset of OverlayScenePayload the layout consumes. */
export type OverlayScenePayloadView = {
  scene: { surfaceStyle: string; panelAnchor: string; titleScale: string; typographyPreset: string; resolvedPresetId: string };
  channelName: string;
  accentColor: string;
  brandLine: string;
  heroLabel: string;
  heroTitle: string;
  heroBody: string;
  metaLine: string;
  nextLabel: string;
  nextTitle: string;
  nextTimeLabel: string;
  queueTitles: string[];
  tickerText: string;
  emergencyBanner: string;
  timeZone: string;
};

const FONT_STACKS: Record<string, string> = {
  "studio-sans": "Stream247 Sans",
  "editorial-serif": "Stream247 Serif",
  "signal-mono": "Stream247 Mono"
};

const TITLE_SIZES: Record<string, number> = {
  compact: 40,
  balanced: 52,
  cinematic: 66
};

function resolveSurface(style: string, accent: string): OverlayLayoutStyle {
  if (style === "solid") {
    return { backgroundColor: "rgba(8,10,15,0.94)", border: `2px solid ${accent}` };
  }

  if (style === "signal") {
    return { backgroundColor: "rgba(8,10,15,0.72)", borderLeft: `10px solid ${accent}` };
  }

  // glass: a vertical wash reads as depth without the blur filters satori cannot do.
  return {
    backgroundImage: "linear-gradient(180deg, rgba(16,20,30,0.86) 0%, rgba(8,10,15,0.93) 100%)",
    border: "1px solid rgba(255,255,255,0.12)"
  };
}

function sanitizeAccent(value: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : "#6ee7ff";
}

function buildLowerThird(
  payload: OverlayScenePayloadView,
  accent: string,
  scale: number,
  fontFamily: string
): OverlayLayoutNode {
  const px = (value: number) => Math.round(value * scale);
  const titleSize = px(TITLE_SIZES[payload.scene.titleScale] ?? TITLE_SIZES.balanced!);
  const chip = joinText([payload.brandLine, payload.channelName], " · ");
  const heroLabel = text(payload.heroLabel);
  const heroTitle = clampOverlayText(payload.heroTitle, 68);
  const heroBody = clampOverlayText(payload.heroBody, 96);
  const metaLine = clampOverlayText(payload.metaLine, 110);

  const children: OverlayLayoutNode[] = [];

  if (chip || heroLabel) {
    children.push(
      row({ alignItems: "center", gap: px(14), marginBottom: px(10) }, [
        ...(heroLabel
          ? [
              label(heroLabel.toUpperCase(), {
                color: "#05070c",
                backgroundColor: accent,
                fontSize: px(18),
                fontWeight: 700,
                letterSpacing: px(2),
                padding: `${px(5)}px ${px(12)}px`,
                borderRadius: px(6)
              })
            ]
          : []),
        ...(chip
          ? [label(chip, { color: "rgba(255,255,255,0.66)", fontSize: px(20), letterSpacing: px(1) })]
          : [])
      ])
    );
  }

  if (heroTitle) {
    children.push(
      label(heroTitle, { color: "#ffffff", fontSize: titleSize, fontWeight: 700, lineHeight: 1.1 })
    );
  }

  if (heroBody) {
    children.push(
      label(heroBody, { color: "rgba(255,255,255,0.78)", fontSize: px(24), marginTop: px(8) })
    );
  }

  if (metaLine) {
    children.push(
      label(metaLine, { color: "rgba(255,255,255,0.52)", fontSize: px(19), marginTop: px(10) })
    );
  }

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        maxWidth: px(1180),
        padding: `${px(26)}px ${px(34)}px`,
        borderRadius: px(18),
        fontFamily,
        ...resolveSurface(payload.scene.surfaceStyle, accent)
      },
      children
    }
  };
}

function buildVotePanel(
  engagement: OverlayEngagementView,
  accent: string,
  scale: number,
  fontFamily: string,
  surfaceStyle: string
): OverlayLayoutNode | null {
  if (engagement.kind === "none") {
    return null;
  }

  const px = (value: number) => Math.round(value * scale);
  const total = Math.max(1, engagement.totalVotes);
  const countdown = Math.max(0, Math.round(engagement.secondsRemaining));

  const header = row({ alignItems: "center", justifyContent: "space-between", marginBottom: px(14) }, [
    label(clampOverlayText(engagement.headline, 40).toUpperCase(), {
      color: accent,
      fontSize: px(20),
      fontWeight: 700,
      letterSpacing: px(2)
    }),
    label(`${countdown}s`, {
      color: "#05070c",
      backgroundColor: accent,
      fontSize: px(20),
      fontWeight: 700,
      padding: `${px(4)}px ${px(12)}px`,
      borderRadius: px(999)
    })
  ]);

  const options = engagement.options.slice(0, 5).map((option) => {
    const share = Math.round((option.votes / total) * 100);
    return {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", marginBottom: px(14) },
        children: [
          row({ alignItems: "center", justifyContent: "space-between", marginBottom: px(5) }, [
            row({ alignItems: "center", gap: px(10) }, [
              label(option.token, {
                color: "#05070c",
                backgroundColor: "rgba(255,255,255,0.86)",
                fontSize: px(17),
                fontWeight: 700,
                padding: `${px(2)}px ${px(9)}px`,
                borderRadius: px(5)
              }),
              label(clampOverlayText(option.title, 38), { color: "#ffffff", fontSize: px(21) })
            ]),
            label(`${String(option.votes)}`, { color: "rgba(255,255,255,0.62)", fontSize: px(19) })
          ]),
          // Track and fill are separate nodes because satori has no ::before/::after.
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                width: "100%",
                height: px(8),
                borderRadius: px(999),
                backgroundColor: "rgba(255,255,255,0.12)"
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      // Always leave a sliver so a zero-vote option still reads as a bar.
                      width: `${String(Math.max(2, share))}%`,
                      height: "100%",
                      borderRadius: px(999),
                      backgroundColor: accent
                    }
                  }
                }
              ]
            }
          }
        ]
      }
    } satisfies OverlayLayoutNode;
  });

  const hint = text(engagement.hint);

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: px(520),
        padding: `${px(22)}px ${px(24)}px`,
        borderRadius: px(18),
        fontFamily,
        ...resolveSurface(surfaceStyle, accent)
      },
      children: [header, ...options, ...(hint ? [label(hint, { color: "rgba(255,255,255,0.5)", fontSize: px(17), marginTop: px(4) })] : [])]
    }
  };
}

function buildNextCard(
  payload: OverlayScenePayloadView,
  accent: string,
  scale: number,
  fontFamily: string
): OverlayLayoutNode | null {
  const nextTitle = clampOverlayText(payload.nextTitle, 44);
  if (!nextTitle) {
    return null;
  }

  const px = (value: number) => Math.round(value * scale);
  const heading = joinText([payload.nextLabel || "Up next", payload.nextTimeLabel], " · ");

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        maxWidth: px(520),
        padding: `${px(16)}px ${px(20)}px`,
        borderRadius: px(14),
        fontFamily,
        ...resolveSurface(payload.scene.surfaceStyle, accent)
      },
      children: [
        label(heading.toUpperCase(), {
          color: accent,
          fontSize: px(16),
          fontWeight: 700,
          letterSpacing: px(2),
          marginBottom: px(6)
        }),
        label(nextTitle, { color: "#ffffff", fontSize: px(24) })
      ]
    }
  };
}

function buildBanner(message: string, scale: number, fontFamily: string): OverlayLayoutNode {
  const px = (value: number) => Math.round(value * scale);
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        width: "100%",
        justifyContent: "center",
        padding: `${px(12)}px ${px(24)}px`,
        borderRadius: px(10),
        backgroundColor: "rgba(190,32,48,0.94)",
        color: "#ffffff",
        fontFamily,
        fontSize: px(24),
        fontWeight: 700,
        letterSpacing: px(1)
      },
      children: clampOverlayText(message, 120)
    }
  };
}

/**
 * Builds the full-frame overlay tree.
 *
 * The root is a transparent, output-sized canvas: the rasterised PNG is composited by ffmpeg at
 * 0:0 over the programme video, so every pixel the layout does not paint stays fully transparent.
 */
export function buildOverlaySceneLayout(input: OverlayLayoutInput, options: OverlayLayoutOptions): OverlayLayoutNode {
  const { payload } = input;
  const scale = overlayScale(options.width);
  const px = (value: number) => Math.round(value * scale);
  const accent = sanitizeAccent(payload.accentColor);
  const fontFamily = FONT_STACKS[payload.scene.typographyPreset] ?? FONT_STACKS["studio-sans"]!;
  const anchorTop = payload.scene.panelAnchor === "center";

  const banner = text(payload.emergencyBanner);
  const votePanel = input.engagement ? buildVotePanel(input.engagement, accent, scale, fontFamily, payload.scene.surfaceStyle) : null;
  const nextCard = buildNextCard(payload, accent, scale, fontFamily);

  const clock = formatOverlayClock(options.now ?? new Date(), payload.timeZone);
  const clockChip = label(clock, {
    color: "#ffffff",
    fontSize: px(26),
    fontWeight: 700,
    letterSpacing: px(1),
    fontFamily,
    padding: `${px(8)}px ${px(18)}px`,
    borderRadius: px(999),
    ...resolveSurface(payload.scene.surfaceStyle, accent)
  });

  const topBar: OverlayLayoutNode[] = [
    row({ alignItems: "flex-start", justifyContent: "space-between", width: "100%", gap: px(24) }, [
      banner
        ? buildBanner(banner, scale, fontFamily)
        : { type: "div", props: { style: { display: "flex" } } },
      clockChip
    ])
  ];

  // Right rail carries whatever is secondary: the vote panel takes priority over "up next",
  // because it is the thing viewers are being asked to act on.
  const rail: OverlayLayoutNode[] = [];
  if (votePanel) {
    rail.push(votePanel);
  } else if (nextCard) {
    rail.push(nextCard);
  }

  const bottom = row({ alignItems: "flex-end", justifyContent: "space-between", width: "100%", gap: px(28) }, [
    buildLowerThird(payload, accent, scale, fontFamily),
    ...(rail.length ? [{ type: "div", props: { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: px(14) }, children: rail } }] : [])
  ]);

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: `${String(options.width)}px`,
        height: `${String(options.height)}px`,
        justifyContent: anchorTop ? "center" : "space-between",
        padding: `${px(56)}px ${px(72)}px`,
        // Transparent: ffmpeg composites this over the programme frame.
        backgroundColor: "rgba(0,0,0,0)"
      },
      children: [...topBar, bottom]
    }
  };
}
