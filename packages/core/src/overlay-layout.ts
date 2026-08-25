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

/**
 * The chat game as the overlay draws it — a structural mirror of ChatGameRenderModel, declared
 * here so this file stays dependency-free like the rest of the layout types.
 */
export type OverlayGameView = {
  gridWidth: number;
  gridHeight: number;
  cells: { x: number; y: number; kind: string }[];
  headline: string;
  statusLine: string;
  hintLine: string;
  phase: string;
};

/** The slice of a custom layer the native renderer needs to place the game panel. */
export type OverlayGameLayerPlacement = {
  kind: string;
  enabled: boolean;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  opacityPercent: number;
  allowOutsideSafeArea: boolean;
};

export type OverlayLayoutInput = {
  payload: OverlayScenePayloadView;
  engagement?: OverlayEngagementView | null;
  game?: OverlayGameView | null;
};

/** The subset of OverlayScenePayload the layout consumes. */
export type OverlayScenePayloadView = {
  scene: {
    surfaceStyle: string;
    panelAnchor: string;
    titleScale: string;
    typographyPreset: string;
    resolvedPresetId: string;
    /** Optional because older cached payloads predate custom-layer-aware native rendering. */
    customLayers?: OverlayGameLayerPlacement[];
  };
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

/**
 * Ink for a chip filled with the operator's accent colour.
 *
 * The label chip used to be painted "#05070c" whatever the accent was. That reads well on the
 * default cyan and disappears on anything dark — and this is the one surface where nobody in the
 * product sees the mistake, because it is only visible to whoever is watching the stream.
 *
 * Relative luminance per WCAG, then black or white, whichever is further away. The threshold sits
 * where the two contrast ratios cross, so the choice is always the more legible of the two rather
 * than a taste call.
 */
/** The panel fill, treated as opaque. See accentTextColor. */
const OVERLAY_PANEL_FILL = "#080a0f";

function relativeLuminance(hex: string): number | null {
  const raw = hex.trim().replace("#", "");
  const full =
    raw.length === 3 || raw.length === 4
      ? raw
          .slice(0, 3)
          .split("")
          .map((char) => char + char)
          .join("")
      : raw.slice(0, 6);

  if (!/^[0-9a-f]{6}$/i.test(full)) {
    return null;
  }

  const channel = (start: number) => {
    const value = parseInt(full.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrastAgainstPanel(hex: string): number | null {
  const colour = relativeLuminance(hex);
  const panel = relativeLuminance(OVERLAY_PANEL_FILL) ?? 0;
  if (colour === null) {
    return null;
  }
  return (Math.max(colour, panel) + 0.05) / (Math.min(colour, panel) + 0.05);
}

/**
 * The accent, when it can be read as text on the panel; white when it cannot.
 *
 * Two headings are lettered in the operator's accent colour directly on the dark panel. A dark
 * accent puts dark text on a dark surface — the same mistake as the label chip, mirrored, and just
 * as invisible from inside the product.
 *
 * Keeping the accent whenever it works matters: it is the channel's colour, and overriding it for
 * safety would take branding away from people whose choice was fine. So it is measured, and only
 * replaced when it falls below 4.5:1.
 *
 * The panel is 72–94% opaque over moving video, so the true backdrop is not knowable here. This
 * measures against the fill as if it were opaque, which is the darkest it gets and therefore the
 * case where a dark accent fails hardest.
 */
export function accentTextColor(accent: string): string {
  const ratio = contrastAgainstPanel(accent);
  if (ratio === null) {
    return "#ffffff";
  }
  return ratio >= 4.5 ? accent : "#ffffff";
}

export function accentInkColor(accent: string): "#05070c" | "#ffffff" {
  const hex = accent.trim().replace("#", "");
  const full =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split("")
          .map((char) => char + char)
          .join("")
      : hex.slice(0, 6);

  if (!/^[0-9a-f]{6}$/i.test(full)) {
    return "#05070c";
  }

  const channel = (start: number) => {
    const value = parseInt(full.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);

  return luminance > 0.179 ? "#05070c" : "#ffffff";
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
                color: accentInkColor(accent),
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
      color: accentTextColor(accent),
      fontSize: px(20),
      fontWeight: 700,
      letterSpacing: px(2)
    }),
    label(`${countdown}s`, {
      color: accentInkColor(accent),
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
          color: accentTextColor(accent),
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

/** Clamps a custom-layer percent box the same way the studio preview does. */
function clampPlacementPercent(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, min), max);
}

/**
 * The chat-game panel: heading, score, the cell grid, and the how-to-play hint.
 *
 * Rendered natively because this is the surface the audience actually plays on — the game is
 * pointless if it only exists in the studio preview. The grid is plain flex rows of fixed-size
 * squares: at one frame per second there is nothing to animate, so legibility comes entirely from
 * cell size and contrast. Cells scale to fit the operator's placement box and never overflow it.
 */
function buildGamePanel(
  game: OverlayGameView,
  placement: OverlayGameLayerPlacement,
  accent: string,
  scale: number,
  fontFamily: string,
  surfaceStyle: string,
  frame: { width: number; height: number }
): OverlayLayoutNode {
  const px = (value: number) => Math.round(value * scale);

  // The same safe margins the root layout keeps for its own panels. A layer that has not opted
  // out of the safe area positions inside them, so the panel can never sit in an overscan edge.
  const safeX = placement.allowOutsideSafeArea ? 0 : px(72);
  const safeY = placement.allowOutsideSafeArea ? 0 : px(56);
  const safeWidth = frame.width - safeX * 2;
  const safeHeight = frame.height - safeY * 2;

  const xPercent = clampPlacementPercent(placement.xPercent, 0, 100);
  const yPercent = clampPlacementPercent(placement.yPercent, 0, 100);
  const widthPercent = clampPlacementPercent(placement.widthPercent, 10, 100 - xPercent);
  const heightPercent = clampPlacementPercent(placement.heightPercent, 8, 100 - yPercent);

  const boxLeft = Math.round(safeX + (safeWidth * xPercent) / 100);
  const boxTop = Math.round(safeY + (safeHeight * yPercent) / 100);
  const boxWidth = Math.round((safeWidth * widthPercent) / 100);
  const boxHeight = Math.round((safeHeight * heightPercent) / 100);

  const gridWidth = Math.max(1, Math.round(game.gridWidth));
  const gridHeight = Math.max(1, Math.round(game.gridHeight));

  // Text rows above and below the grid share the box with it; whatever is left decides the cell
  // size. The floor keeps cells visible even when an operator draws a tiny box.
  const framePadding = px(18);
  const textAllowance = px(84);
  const gap = Math.max(1, px(2));
  const innerWidth = boxWidth - framePadding * 2;
  const innerHeight = boxHeight - framePadding * 2 - textAllowance;
  const cellSize = Math.max(
    px(8),
    Math.floor(
      Math.min((innerWidth - gap * (gridWidth - 1)) / gridWidth, (innerHeight - gap * (gridHeight - 1)) / gridHeight)
    )
  );

  const cellKinds = new Map<string, string>();
  for (const cell of game.cells) {
    cellKinds.set(`${String(cell.x)},${String(cell.y)}`, cell.kind);
  }

  const gridRows: OverlayLayoutNode[] = [];
  for (let y = 0; y < gridHeight; y += 1) {
    const rowCells: OverlayLayoutNode[] = [];
    for (let x = 0; x < gridWidth; x += 1) {
      const kind = cellKinds.get(`${String(x)},${String(y)}`) ?? "";
      const cellStyle: OverlayLayoutStyle = {
        display: "flex",
        width: cellSize,
        height: cellSize,
        borderRadius: Math.max(1, px(3)),
        backgroundColor: "rgba(255,255,255,0.10)"
      };
      if (kind === "snake-head") {
        // The head is the cell every viewer tracks, so it gets the strongest mark on the panel.
        cellStyle.backgroundColor = "#ffffff";
      } else if (kind === "snake-body") {
        cellStyle.backgroundColor = accent;
      } else if (kind === "food") {
        cellStyle.backgroundColor = "#ffffff";
        cellStyle.borderRadius = 999;
      }
      rowCells.push({ type: "div", props: { style: cellStyle } });
    }
    gridRows.push(row({ gap }, rowCells));
  }

  const header = row({ alignItems: "center", justifyContent: "space-between", marginBottom: px(10), gap: px(12) }, [
    label(clampOverlayText(game.headline, 32).toUpperCase(), {
      color: accentTextColor(accent),
      fontSize: px(18),
      fontWeight: 700,
      letterSpacing: px(2)
    }),
    label(clampOverlayText(game.statusLine, 30), {
      color: accentInkColor(accent),
      backgroundColor: accent,
      fontSize: px(17),
      fontWeight: 700,
      padding: `${px(3)}px ${px(10)}px`,
      borderRadius: px(999)
    })
  ]);

  const hint = text(game.hintLine);

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        left: boxLeft,
        top: boxTop,
        width: boxWidth,
        padding: `${framePadding}px`,
        borderRadius: px(16),
        opacity: clampPlacementPercent(placement.opacityPercent, 5, 100) / 100,
        fontFamily,
        ...resolveSurface(surfaceStyle, accent)
      },
      children: [
        header,
        { type: "div", props: { style: { display: "flex", flexDirection: "column", gap }, children: gridRows } },
        ...(hint
          ? [
              label(clampOverlayText(hint, 70), {
                // Solid enough to clear 4.5:1 on the panel fill; the hint is the only line that
                // tells a new viewer the game is theirs to play.
                color: "rgba(255,255,255,0.78)",
                fontSize: px(16),
                marginTop: px(10)
              })
            ]
          : [])
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

  // The game renders only when this scene carries an enabled game layer AND a game is actually
  // running. Either alone is not enough: a scene without the layer stays game-free however lively
  // chat is, and an enabled layer with no running game draws nothing rather than an empty board.
  const gamePlacement = (payload.scene.customLayers ?? []).find((layer) => layer.kind === "game" && layer.enabled) ?? null;
  const gamePanel =
    gamePlacement && input.game
      ? buildGamePanel(input.game, gamePlacement, accent, scale, fontFamily, payload.scene.surfaceStyle, {
          width: options.width,
          height: options.height
        })
      : null;

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
        backgroundColor: "rgba(0,0,0,0)",
        // The game panel positions absolutely against this root, so the root must be its
        // containing block rather than the browser default of the nearest positioned ancestor.
        position: "relative"
      },
      children: [...topBar, bottom, ...(gamePanel ? [gamePanel] : [])]
    }
  };
}
