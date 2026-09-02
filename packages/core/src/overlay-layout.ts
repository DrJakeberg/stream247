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
    /**
     * Image nodes only. The renderer hands satori data URIs wherever it can (sampled source
     * frames always are), keeping rasterisation free of network fetches; an absolute http(s)
     * URL is fetched by satori itself and only re-fetched when the frame's cache key changes.
     */
    src?: string;
    /**
     * Image nodes only: the intrinsic size, declared so satori never has to derive it from the
     * bytes. Mandatory for any picture it might fail to fetch — without a declared size satori
     * throws "Image size cannot be determined" and the whole frame is lost, so one unreachable
     * chat emote would take the entire overlay off air.
     */
    width?: number;
    height?: number;
  };
};

export type OverlayLayoutOptions = {
  width: number;
  height: number;
  /** Wall clock used for the on-air clock, injected so renders stay deterministic in tests. */
  now?: Date;
  /**
   * The placement a running crawl was built against, when one is running.
   *
   * Present means ffmpeg is moving the line across this exact rectangle for the life of the
   * process, so the band is drawn empty and drawn HERE — not at whatever the payload says now. The
   * two would otherwise part company the moment an operator drags the panel in the studio: the
   * graph is fixed when the programme starts, so the band would move and the line would go on
   * crawling where the band used to be, over bare video, until the next block.
   *
   * Absent means draw the line at rest, which is what a still picture — the studio preview, a
   * baseline screenshot — has to show, because a still cannot show motion.
   */
  tickerCrawl?: OverlayPlacementView;
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

export type OverlayChatMessageView = {
  name: string;
  text: string;
  /**
   * The message split into literal text and emote pictures, from the PRIVMSG `emotes` tag. Absent
   * on rows written before emotes were read, and on messages that contain none — the panel then
   * draws `text` exactly as it always did.
   */
  segments?: { kind: string; text?: string; id?: string; url?: string }[];
};

/**
 * Live chat as the overlay draws it: display name and text only. Identities beyond the display
 * name never reach this type — the projection that feeds it already dropped them, and the layout
 * has no use for them.
 */
export type OverlayChatView = {
  /** One of the four corners; anything else falls back to bottom-left. */
  position: string;
  /** Operator's message count; the panel additionally caps at OVERLAY_CHAT_PANEL_MAX_MESSAGES. */
  maxMessages: number;
  /** Oldest first; the panel keeps the newest tail. */
  messages: OverlayChatMessageView[];
};

/**
 * The chat game as the overlay draws it — a structural mirror of ChatGameRenderModel, declared
 * here so this file stays dependency-free like the rest of the layout types.
 */
export type OverlayGameView = {
  gridWidth: number;
  gridHeight: number;
  cells: { x: number; y: number; kind: string; label?: string }[];
  headline: string;
  statusLine: string;
  hintLine: string;
  /** Coordinate-driven games ask for column letters and row numbers around the grid. */
  showCoordinates?: boolean;
  phase: string;
};

/**
 * The slice of a custom layer the native renderer reads. Placement is common to every kind; the
 * content fields are optional because each kind only carries its own and older cached payloads
 * predate them entirely. embed and widget layers stay browser-overlay-only — satori cannot run
 * an iframe — so no field of theirs appears here.
 */
export type OverlayCustomLayerView = {
  kind: string;
  enabled: boolean;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  opacityPercent: number;
  /**
   * game layers: how much of the panel's own backdrop is drawn, independent of opacityPercent.
   *
   * opacityPercent fades the whole panel, board included — at 5 the snake measured alpha 11 on
   * the rasteriser, which is not "a transparent game" but "no game". This fades only the fill and
   * border behind the board, so an operator who wants the playfield over bare video can have it
   * without the board going with it. Absent means 100: the panel as it has always been drawn.
   */
  backgroundOpacityPercent?: number;
  allowOutsideSafeArea: boolean;
  /** source layers: reference into the stored video sources. Never a URL. */
  sourceId?: string;
  /** logo/image layers: the picture, plus how it fills the box. */
  url?: string;
  fit?: string;
  /** text layers. */
  text?: string;
  secondaryText?: string;
  textTone?: string;
  textAlign?: string;
  useAccent?: boolean;
  fontMode?: string;
};

/** Historical name from the game-only era; the game panel still reads exactly this shape. */
export type OverlayGameLayerPlacement = OverlayCustomLayerView;

/**
 * Where a box sits and how loud it is — the whole placement vocabulary, for anything on the frame.
 *
 * There is exactly one of these. A custom layer carries it inline (it always has), and a built-in
 * panel now carries the same fields under the same names, resolved by the same resolvePlacementBox
 * against the same safe area. A second placement model would be a second set of rounding rules and
 * a second set of clamps, and the two would drift the first time one of them was fixed.
 */
export type OverlayPlacementView = {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  /** 5-100, clamped. Below 5 a panel is not "subtle", it is a thing nobody can see but everybody pays for. */
  opacityPercent?: number;
  allowOutsideSafeArea?: boolean;
};

/**
 * The panels the renderer draws itself, as the operator names them.
 *
 * "ticker" was absent until the panel existed: the payload carried tickerText and the renderer drew
 * it nowhere — measured, not read, on this rasteriser, where setting, clearing and replacing the
 * text all produced the same layout checksum. It is a panel now, with the same placement, the same
 * opacity and the same drag handle as the other six, and it draws only while it has a text.
 */
export type OverlayPanelId = "hero" | "next" | "vote" | "chat" | "clock" | "banner" | "ticker";

export const OVERLAY_PANEL_IDS: OverlayPanelId[] = ["hero", "next", "vote", "chat", "clock", "banner", "ticker"];

/**
 * Placements the operator has set, by panel.
 *
 * Absent means "wherever the layout puts it" — the panel stays in the flex flow it has always been
 * in, and the tree is byte-for-byte the tree that was on air before placement existed. That is the
 * whole compatibility story: the picture moves when somebody moves it, and not before.
 */
export type OverlayPanelPlacementMap = Partial<Record<OverlayPanelId, OverlayPlacementView>>;

/**
 * The pixel box a placed panel has to fit into.
 *
 * Passed to the panel builders rather than enforced from outside, because fitting is the panel's
 * own arithmetic: the chat panel decides how many messages a height holds, the vote panel how many
 * options, and both would rather draw fewer rows than rows nobody can see. It is exactly what
 * buildGamePanel has always done with its cell size. Undefined means the panel is in the flex flow
 * and keeps every number it has always had.
 */
type PanelFit = { width: number; height: number };

/** Which corner of its box a placed panel holds, so its default box reproduces the flow exactly. */
type PanelAnchorPoint = { x: "start" | "center" | "end"; y: "start" | "center" | "end" };

const PANEL_ANCHOR_POINTS: Record<OverlayPanelId, PanelAnchorPoint> = {
  // The lower third grows upwards from the bottom-left of the safe area, as the flow's last row does.
  hero: { x: "start", y: "end" },
  next: { x: "end", y: "end" },
  vote: { x: "end", y: "end" },
  chat: { x: "start", y: "end" },
  clock: { x: "end", y: "start" },
  banner: { x: "start", y: "start" },
  // The ticker fills its box rather than sitting in a corner of it: it is a band, and a band that
  // held one corner of a box the operator widened would leave the rest of the band empty.
  ticker: { x: "start", y: "start" }
};

/**
 * One sampled picture from the scene's video source, as the layout draws it. The data URI is the
 * capture itself; capturedAt is its identity for caching, so the frame cache key can react to a
 * new capture without hashing image bytes.
 */
export type OverlaySourceFrameView = {
  dataUri: string;
  /** "live" draws; anything else hides the layer. See sourceFrameVisible for the policy. */
  status: string;
  capturedAt: string;
};

export type OverlayLayoutInput = {
  payload: OverlayScenePayloadView;
  engagement?: OverlayEngagementView | null;
  game?: OverlayGameView | null;
  chat?: OverlayChatView | null;
  sourceFrame?: OverlaySourceFrameView | null;
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
    customLayers?: OverlayCustomLayerView[];
    /**
     * Placements the operator has set for the renderer's own panels. Absent, or absent for one
     * panel, means that panel stays in the flex flow it has always been in.
     */
    panelPlacements?: OverlayPanelPlacementMap;
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
  /**
   * How long one ticker message stands before the next one takes its place.
   *
   * Optional because payloads cached before the ticker panel existed do not carry it, and because
   * a single message ignores it entirely. See overlayTickerLine for why this is a dwell and not a
   * scroll speed.
   */
  tickerRotateSeconds?: number;
  emergencyBanner: string;
  timeZone: string;
};

/** Messages in one ticker text are separated by a middot or a line break. */
const TICKER_SEPARATORS = /[\n\r·]+/;

/** What rejoins them once they are one running line again. */
const TICKER_JOIN = " · ";

/**
 * Bounds on the seconds setting. They are the old dwell's bounds, kept because the stored column
 * is the same one — only its meaning changed, from how long a message stands to how long the line
 * takes to cross its band.
 */
export const OVERLAY_TICKER_MIN_SECONDS = 4;
export const OVERLAY_TICKER_MAX_SECONDS = 60;
export const OVERLAY_TICKER_DEFAULT_SECONDS = 8;

/**
 * The legible window the crawl speed is held inside, on the 1920x1080 design grid.
 *
 * A crawl is read by a viewer who did not choose to look at it, so both ends matter. The ceiling
 * is where a line stops being readable: at fontSize 26 a Latin glyph advances about 15px, so
 * 240px/s is 16 glyphs a second, which is fast reading and the fastest anybody should be able to
 * configure. The floor is where the motion stops reading as motion and starts looking like a
 * picture that is subtly broken; 40px/s crosses the band in three quarters of a minute.
 *
 * Both scale with the frame, so 720p crawls at the same visual pace rather than the same pixel
 * pace.
 */
export const OVERLAY_TICKER_CRAWL_MIN_PX_PER_SECOND = 40;
export const OVERLAY_TICKER_CRAWL_MAX_PX_PER_SECOND = 240;

/** The empty run between the end of the line and the start of its next pass, on the design grid. */
export const OVERLAY_TICKER_CRAWL_GAP = 240;

/**
 * The ink of the ticker line, on the design grid.
 *
 * Shared, because the band used to draw this line and now ffmpeg moves a strip of it across the
 * band instead: two pictures of the same sentence that must be the same sentence in the same face
 * at the same size, or the studio preview and the broadcast disagree about the ticker again.
 */
export const OVERLAY_TICKER_TEXT = { fontSize: 26, fontWeight: 600, lineHeight: 1.25, letterSpacing: 1 } as const;

/** The band's own insets, shared by the panel that draws it and the plan that crawls inside it. */
const TICKER_PAD_X = 24;
const TICKER_PAD_Y = 10;
const TICKER_ACCENT_BORDER = 6;

/**
 * The messages a ticker text holds, in order.
 *
 * Exported so the studio can say how many there are without splitting the string a second time
 * and disagreeing about what counts as a separator.
 */
export function overlayTickerMessages(text: string): string[] {
  return text
    .split(TICKER_SEPARATORS)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * The whole ticker as one running line.
 *
 * It used to be one message at a time, quantised against the epoch so every renderer picked the
 * same one. That was a dwell, and the reason was the update rate: the renderer redraws on
 * SCENE_RENDER_INTERVAL_MS — 2000ms by default, floored at 1000ms — so text drawn INTO the frame
 * cannot crawl, it can only teleport, 118px at a time.
 *
 * The crawl was never the rasteriser's job. ffmpeg moves the line over the band at the output
 * frame rate for nothing per frame (measured: exactly 4px per frame at 120px/s and 30fps, clipped
 * to the band, seamless across the wrap), so the line holds still in the picture the renderer
 * makes and moves in the picture the viewer sees. There is nothing left for a clock to decide
 * here, which is why this takes none.
 */
export function overlayTickerLine(payload: Pick<OverlayScenePayloadView, "tickerText">): string {
  return overlayTickerMessages(payload.tickerText).join(TICKER_JOIN);
}

/**
 * Everything ffmpeg needs to run the line across the band, and nothing it does not.
 *
 * `box` is the band the renderer draws; `crawl` is the clear run inside it, past the accent border
 * and the padding, which is where the label used to sit and where the moving strip goes.
 */
export type OverlayTickerCrawlPlan = {
  line: string;
  /** The placement the boxes were resolved from, so the caller can freeze it for the renderer. */
  placement: OverlayPlacementView;
  box: { left: number; top: number; width: number; height: number };
  crawl: { left: number; top: number; width: number; height: number };
  pxPerSecond: number;
  gapPx: number;
};

/**
 * Where the ticker crawls and how fast, resolved from the same placement the renderer uses.
 *
 * Deliberately reads the placement through resolvePlacementBox rather than repeating its
 * arithmetic: the band ffmpeg draws into and the band the rasteriser draws have to be the same
 * rectangle, and the only way to be sure of that is for there to be one function that decides it.
 */
export function overlayTickerCrawlPlan(
  input: Pick<OverlayLayoutInput, "payload" | "chat">,
  options: { width: number; height: number },
  /** A frozen placement, when a crawl is already running against one. */
  override?: OverlayPlacementView
): OverlayTickerCrawlPlan | null {
  const line = overlayTickerLine(input.payload);
  if (!line) {
    return null;
  }

  const scale = overlayScale(options.width);
  const px = (value: number) => Math.round(value * scale);
  const frameSize = { width: options.width, height: options.height };
  const placement =
    override ??
    input.payload.scene.panelPlacements?.ticker ??
    deriveDefaultPlacements(input.payload.scene.panelAnchor, String(input.chat?.position ?? "")).ticker;
  const box = resolvePlacementBox(placement, scale, frameSize);

  const seconds = Math.min(
    OVERLAY_TICKER_MAX_SECONDS,
    Math.max(
      OVERLAY_TICKER_MIN_SECONDS,
      Math.round(input.payload.tickerRotateSeconds ?? OVERLAY_TICKER_DEFAULT_SECONDS) || OVERLAY_TICKER_DEFAULT_SECONDS
    )
  );

  const pxPerSecond = Math.round(
    Math.min(
      OVERLAY_TICKER_CRAWL_MAX_PX_PER_SECOND * scale,
      Math.max(OVERLAY_TICKER_CRAWL_MIN_PX_PER_SECOND * scale, box.width / seconds)
    )
  );

  const inset = px(TICKER_ACCENT_BORDER) + px(TICKER_PAD_X);
  return {
    line,
    placement,
    box,
    crawl: {
      left: box.left + inset,
      top: box.top + px(TICKER_PAD_Y),
      width: Math.max(1, box.width - inset - px(TICKER_PAD_X)),
      height: Math.max(1, box.height - px(TICKER_PAD_Y) * 2)
    },
    pxPerSecond,
    gapPx: px(OVERLAY_TICKER_CRAWL_GAP)
  };
}

/** The face a typography preset resolves to, for anyone rendering overlay text outside the tree. */
export function overlayFontFamily(typographyPreset: string): string {
  return FONT_STACKS[typographyPreset] ?? FONT_STACKS["studio-sans"]!;
}

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

// The overlay's text hierarchy, as white alphas on the panel fill. There used to be five
// (0.5, 0.52, 0.62, 0.66, 0.78) — five loudnesses for three roles, and the two quietest sat on
// the lines a viewer most needs to act on: the vote hint and the programme metadata. Three steps,
// one per role.
//
// Measured at both ends of what the panel can be. On the opaque fill (#080a0f, the darkest
// backdrop): SECONDARY 11.97:1, TERTIARY 8.69:1. On the worst case — the signal surface's 72%
// scrim composited over pure white video, the lightest backdrop an ink can meet: SECONDARY
// 5.80:1, TERTIARY 4.68:1. Tertiary sits at 0.66 rather than 0.64 because 0.64 cleared that
// worst case by only 0.008. Both ends are re-derived from this source by
// overlay-accent-contrast.test.ts, so a softened step has to face the numbers.
const INK_PRIMARY = "#ffffff";
const INK_SECONDARY = "rgba(255,255,255,0.78)";
const INK_TERTIARY = "rgba(255,255,255,0.66)";

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
  fontFamily: string,
  fit?: PanelFit
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
          ? [label(chip, { color: INK_TERTIARY, fontSize: px(20), letterSpacing: px(1) })]
          : [])
      ])
    );
  }

  if (heroTitle) {
    children.push(
      label(heroTitle, { color: INK_PRIMARY, fontSize: titleSize, fontWeight: 700, lineHeight: 1.1 })
    );
  }

  if (heroBody) {
    children.push(
      label(heroBody, { color: INK_SECONDARY, fontSize: px(24), marginTop: px(8) })
    );
  }

  if (metaLine) {
    // Tertiary, not a fourth quieter step: 0.52 was the faintest line on air, and it carries the
    // category and schedule facts, not decoration. Colour only — tracking would change where the
    // clamped 110-character line breaks, and px() would apply it at some output sizes and round
    // it away at others.
    children.push(
      label(metaLine, { color: INK_TERTIARY, fontSize: px(19), marginTop: px(10) })
    );
  }

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        maxWidth: fit ? fit.width : px(1180),
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
  surfaceStyle: string,
  fit?: PanelFit
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

  // In the flow the panel grows with its options and pushes its neighbours down; in a box there is
  // nothing to push, so it drops the options that would not fit rather than drawing them over
  // whatever is underneath. Measured on the rasteriser: 115 design-px of header, hint and padding
  // plus 51 per option (217 at two options, 370 at five).
  const optionCapacity = fit ? Math.floor((fit.height - px(115)) / px(51)) : 5;
  const options = engagement.options.slice(0, Math.max(1, Math.min(5, optionCapacity))).map((option) => {
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
                borderRadius: px(6)
              }),
              label(clampOverlayText(option.title, 38), { color: INK_PRIMARY, fontSize: px(21) })
            ]),
            label(`${String(option.votes)}`, { color: INK_TERTIARY, fontSize: px(19) })
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
        width: fit ? fit.width : px(520),
        padding: `${px(22)}px ${px(24)}px`,
        borderRadius: px(18),
        fontFamily,
        ...resolveSurface(surfaceStyle, accent)
      },
      // The hint is the line that turns a watcher into a voter ("type !1 in chat"); it was the
      // faintest text on the frame, which had the priority exactly backwards.
      children: [header, ...options, ...(hint ? [label(hint, { color: INK_TERTIARY, fontSize: px(17), marginTop: px(4) })] : [])]
    }
  };
}

function buildNextCard(
  payload: OverlayScenePayloadView,
  accent: string,
  scale: number,
  fontFamily: string,
  fit?: PanelFit
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
        maxWidth: fit ? fit.width : px(520),
        padding: `${px(16)}px ${px(20)}px`,
        // 16 like the game panel: the right rail's small cards share one radius, and only the two
        // full panels (lower third, vote) carry the larger 18.
        borderRadius: px(16),
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
        label(nextTitle, { color: INK_PRIMARY, fontSize: px(24) })
      ]
    }
  };
}

// The panel's own message cap, independent of the operator's maxMessages (which reaches 12).
//
// The claim behind the number: the chat panel is the only overlay content other people write, so
// its worst case has to fit under the worst case of everything it can stack with. One message is
// one 19px row (~23px drawn) plus an 8px gap, so eight messages plus padding are ~280 design-px.
// The tallest neighbour is the five-option vote panel at ~425, the top cluster is ~110, and the
// frame keeps 56px vertical padding — stacked worst case ~947 of the 1080 grid, leaving real
// slack for a wrapped banner. At twelve messages that slack is gone.
export const OVERLAY_CHAT_PANEL_MAX_MESSAGES = 8;

// Character budgets for one message row inside the 680px panel (inner 640): a bold 14-character
// name (~170px) plus a 40-character text (~440px) fit a single 19px line in the loaded faces.
// lineClamp backstops glyphs wider than the estimate (CJK, fullwidth), so a row can never wrap
// into a second line and eat the height claim above.
const CHAT_NAME_MAX_CHARS = 14;
const CHAT_TEXT_MAX_CHARS = 40;

/**
 * Chat text arrives from strangers. Control characters can break satori's text shaping, bidi
 * overrides can reverse what the frame appears to say, and zero-width characters smuggle both —
 * all of it is stripped, and runs of whitespace (including newlines) collapse to single spaces so
 * a message is one line of plain text before any clamping happens. A message whose emote ranges
 * were read draws its emotes as pictures instead (see buildChatMessageNodes); this remains the
 * path for the text between them, and the whole path for a message with no emotes in it.
 */
function sanitizeChatLine(value: unknown): string {
  return (
    String(value ?? "")
      // Whitespace first: newlines and tabs become spaces before the control-range strip would
      // swallow them, so a line break keeps its word boundary.
      .replace(/\s+/g, " ")
      .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
      .replace(/ {2,}/g, " ")
      .trim()
  );
}

// How many emote pictures one message may put on air. A room can paste thirty emotes into one
// line; drawing them all would push the row past the panel and cost a network fetch each. Past
// this many the rest of the message degrades to its literal text, which is what the panel drew
// before emotes existed.
const CHAT_MESSAGE_MAX_EMOTES = 6;

// An emote picture is drawn one line-height tall, so a message with emotes is exactly as tall as
// one without and the panel's height claim at OVERLAY_CHAT_PANEL_MAX_MESSAGES still holds.
const CHAT_EMOTE_BOX = 22;

/**
 * One chat message as drawn nodes: text runs, with emote pictures placed inline where the PRIVMSG
 * tag said they are.
 *
 * The `width`/`height` props on the image are not decoration. satori determines an image's
 * intrinsic size by fetching it, and when the fetch fails it throws "Image size cannot be
 * determined" — which loses the entire overlay frame, not just the emote. With both declared it
 * skips the unreachable picture and renders everything else, so a CDN outage costs an emote rather
 * than the broadcast overlay. Measured against satori 0.29: unreachable URL with declared size
 * renders in ~19ms and draws no image; without it, the render throws.
 *
 * Returns null when the message has no usable segments, so callers fall back to plain text. The
 * pieces come back inside their own row so the panel's name/body gap stays one gap: inside a
 * message, text and the emote next to it sit tight against each other the way chat renders them.
 */
function buildChatMessageBody(
  message: OverlayChatMessageView,
  scale: number,
  budget: number
): OverlayLayoutNode | null {
  const segments = message.segments ?? [];
  if (!segments.some((segment) => segment.kind === "emote" && segment.url)) {
    return null;
  }

  const px = (value: number) => Math.round(value * scale);
  const nodes: OverlayLayoutNode[] = [];
  let remaining = budget;
  let emotes = 0;

  for (const segment of segments) {
    if (remaining <= 0) {
      break;
    }

    if (segment.kind === "emote") {
      const url = String(segment.url ?? "");
      // Only what the rasteriser can resolve, the same rule buildMediaPanel applies to logos.
      if (emotes >= CHAT_MESSAGE_MAX_EMOTES || !/^(data:image\/|https:\/\/)/.test(url)) {
        continue;
      }
      emotes += 1;
      // An emote costs three characters of the row budget: its 22px box plus the 4px gap is about
      // 2.6 glyphs of the 19px text beside it, so a wall of emotes clamps like a wall of words.
      remaining -= 3;
      nodes.push({
        type: "img",
        props: {
          src: url,
          width: px(CHAT_EMOTE_BOX),
          height: px(CHAT_EMOTE_BOX),
          style: { width: px(CHAT_EMOTE_BOX), height: px(CHAT_EMOTE_BOX), objectFit: "contain" }
        }
      });
      continue;
    }

    const value = clampOverlayText(sanitizeChatLine(segment.text), remaining);
    if (!value) {
      continue;
    }
    remaining -= value.length;
    // Same rule as the text-only label: satori honours lineClamp only on a block container, and a
    // run with a space beside a wide name measured 66px — three lines — on the rasteriser.
    nodes.push(
      label(value, { color: INK_PRIMARY, fontSize: px(19), lineClamp: 1, display: "block", minWidth: 0, overflow: "hidden" })
    );
  }

  // The row must yield to the panel, not the other way round: a nowrap row of labels and pictures
  // has an intrinsic width no character budget can bound (glyph widths are not characters), and
  // without minWidth 0 it would push the chatter's name to nothing and run onto bare video.
  return nodes.length > 0
    ? row({ alignItems: "center", gap: px(4), minWidth: 0, flexShrink: 1, overflow: "hidden" }, nodes)
    : null;
}

/**
 * The live-chat panel: the newest handful of messages, name and text, nothing else.
 *
 * No heading and no hint — chat explains itself, and every extra line would come out of the
 * height budget documented at OVERLAY_CHAT_PANEL_MAX_MESSAGES. Returns null when nothing
 * survives sanitisation: an empty chat renders no frame at all rather than an empty panel.
 */
function buildChatPanel(
  chat: OverlayChatView,
  accent: string,
  scale: number,
  fontFamily: string,
  surfaceStyle: string,
  fit?: PanelFit
): OverlayLayoutNode | null {
  const px = (value: number) => Math.round(value * scale);
  const operatorLimit = Number.isFinite(chat.maxMessages) ? Math.round(chat.maxMessages) : 1;
  // In the flow the cap is a height budget derived from what the panel could stack with (see
  // OVERLAY_CHAT_PANEL_MAX_MESSAGES). In a box there is nothing to stack with and nothing to push,
  // so the box height is the budget: measured on the rasteriser the panel is 26 design-px of
  // padding plus 30 per message (56 at one, 86 at two, 176 at five, 266 at eight), and it draws as
  // many of the newest messages as that arithmetic allows. The cap still applies on top of it.
  const boxCapacity = fit ? Math.floor((fit.height - px(26)) / px(30)) : OVERLAY_CHAT_PANEL_MAX_MESSAGES;
  const limit = Math.max(1, Math.min(operatorLimit, OVERLAY_CHAT_PANEL_MAX_MESSAGES, boxCapacity));

  const messages = chat.messages
    .map((message) => ({
      name: clampOverlayText(sanitizeChatLine(message.name), CHAT_NAME_MAX_CHARS),
      text: clampOverlayText(sanitizeChatLine(message.text), CHAT_TEXT_MAX_CHARS),
      // Emote pictures replace the codes inside the text, so a message that is nothing but emotes
      // has no text left to pass the filter below — the body decides whether the row is drawable.
      body: buildChatMessageBody(message, scale, CHAT_TEXT_MAX_CHARS)
    }))
    .filter((message) => message.name && (message.text || message.body))
    .slice(-limit);

  if (messages.length === 0) {
    return null;
  }

  const rows = messages.map((message, index) =>
    row({ alignItems: "center", gap: px(10), ...(index > 0 ? { marginTop: px(8) } : {}) }, [
      label(message.name, {
        color: accentTextColor(accent),
        fontSize: px(19),
        fontWeight: 700,
        // The name is the fixed part of the row; the message yields, never the name.
        flexShrink: 0
      }),
      message.body ??
        label(message.text, {
          color: INK_PRIMARY,
          fontSize: px(19),
          // One drawn line per message, whatever the glyph widths — the height claim depends on it.
          // satori honours lineClamp only on a block container; on the flex label it never
          // applied, and a 34-wide-glyph message measured 44px — two lines — on the rasteriser.
          // Block display makes the clamp real, and the row yields to the panel instead of
          // pushing the name to nothing.
          lineClamp: 1,
          display: "block",
          minWidth: 0,
          flexShrink: 1,
          overflow: "hidden"
        })
    ])
  );

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: fit ? fit.width : px(680),
        padding: `${px(16)}px ${px(20)}px`,
        // 16 like the other small rail cards; only the two full panels carry 18.
        borderRadius: px(16),
        fontFamily,
        ...resolveSurface(surfaceStyle, accent)
      },
      children: rows
    }
  };
}

/** Clamps a custom-layer percent box the same way the studio preview does. */
function clampPlacementPercent(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, min), max);
}

/**
 * The floors a box cannot be resized below.
 *
 * Named rather than inline because the studio's drag handles have to stop at exactly these numbers.
 * A handle that let the operator pull a panel to nothing, only for the renderer to snap it back to
 * a tenth of the frame, would be the studio lying about the picture again.
 */
export const OVERLAY_PLACEMENT_MIN_WIDTH_PERCENT = 10;
export const OVERLAY_PLACEMENT_MIN_HEIGHT_PERCENT = 8;

/**
 * The rectangle percents are measured against, in frame pixels.
 *
 * Shared by the forward resolver and its inverse so there is one reading of the safe area, and one
 * place where overlayScale and the rounding to whole pixels happen. It is not a fixed fraction of
 * the frame: 56 design pixels at 1280x720 rounds to 37, so the safe band is 646px of 720 (89.72%)
 * where at 1920x1080 it is 968px of 1080 (89.63%). Percents therefore mean slightly different
 * pixels at different output sizes, which is exactly why the studio has to be told the real one.
 *
 * Exported because the studio's drag handles snap to this rectangle. A studio that hardcoded
 * "72 and 56" would be right at 1920x1080 and wrong everywhere else — which is the class of bug
 * the hand-written HTML preview was removed for.
 */
export function resolvePlacementSafeArea(
  frame: { width: number; height: number },
  allowOutsideSafeArea = false
): { left: number; top: number; width: number; height: number } {
  const px = (value: number) => Math.round(value * overlayScale(frame.width));
  const left = allowOutsideSafeArea ? 0 : px(72);
  const top = allowOutsideSafeArea ? 0 : px(56);
  return { left, top, width: frame.width - left * 2, height: frame.height - top * 2 };
}

/**
 * Resolves a custom layer's percent box into frame pixels — the game panel's placement rules,
 * extracted verbatim so every positioned panel clamps identically: a layer that has not opted out
 * of the safe area positions inside the same margins the root layout keeps for its own panels,
 * and width/height are clamped against the remaining room so no box can leave the frame.
 */
function resolvePlacementBox(
  placement: OverlayPlacementView,
  scale: number,
  frame: { width: number; height: number }
): { left: number; top: number; width: number; height: number } {
  const px = (value: number) => Math.round(value * scale);

  const safeX = placement.allowOutsideSafeArea ? 0 : px(72);
  const safeY = placement.allowOutsideSafeArea ? 0 : px(56);
  const safeWidth = frame.width - safeX * 2;
  const safeHeight = frame.height - safeY * 2;

  const xPercent = clampPlacementPercent(placement.xPercent, 0, 100);
  const yPercent = clampPlacementPercent(placement.yPercent, 0, 100);
  const widthPercent = clampPlacementPercent(placement.widthPercent, OVERLAY_PLACEMENT_MIN_WIDTH_PERCENT, 100 - xPercent);
  const heightPercent = clampPlacementPercent(
    placement.heightPercent,
    OVERLAY_PLACEMENT_MIN_HEIGHT_PERCENT,
    100 - yPercent
  );

  return {
    left: Math.round(safeX + (safeWidth * xPercent) / 100),
    top: Math.round(safeY + (safeHeight * yPercent) / 100),
    width: Math.round((safeWidth * widthPercent) / 100),
    height: Math.round((safeHeight * heightPercent) / 100)
  };
}

/**
 * Percent box in, frame pixels out — the renderer's own resolver, for anyone drawing the same box.
 *
 * The studio needs this to know where a panel actually is before it can put a drag handle on it.
 * Calling the renderer's function rather than repeating its arithmetic is the whole point: the
 * studio drew its own imitation once and disagreed with the picture on the safe area, the clamps
 * and the scale all at the same time.
 */
export function resolvePlacementPixelBox(
  placement: OverlayPlacementView,
  frame: { width: number; height: number }
): { left: number; top: number; width: number; height: number } {
  return resolvePlacementBox(placement, overlayScale(frame.width), frame);
}

/**
 * Frame pixels in, percent box out — the inverse of resolvePlacementBox.
 *
 * This is the function direct manipulation is built on. The operator drags a rectangle across the
 * preview; this says which percents draw that rectangle, and because it reads the same safe area
 * through the same overlayScale and applies the same clamps, "what you dragged is what gets drawn"
 * is a property that can be tested rather than a claim (tests/unit/overlay-placement-roundtrip).
 *
 * The round trip is exact in pixels, not in percents. resolvePlacementBox rounds to whole frame
 * pixels, so a percent cannot survive the trip unchanged — at 1280x720 one pixel of the 1184px
 * safe band is 0.0845%, and the percents that come back differ by at most half of that. What does
 * survive is the box: resolvePlacementPixelBox(resolvePlacementPercent(box)) is the same box.
 */
export function resolvePlacementPercent(
  box: { left: number; top: number; width: number; height: number },
  frame: { width: number; height: number },
  options: { allowOutsideSafeArea?: boolean } = {}
): { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number } {
  const safe = resolvePlacementSafeArea(frame, options.allowOutsideSafeArea === true);

  const xPercent = clampPlacementPercent(((box.left - safe.left) / safe.width) * 100, 0, 100);
  const yPercent = clampPlacementPercent(((box.top - safe.top) / safe.height) * 100, 0, 100);

  return {
    xPercent,
    yPercent,
    widthPercent: clampPlacementPercent(
      (box.width / safe.width) * 100,
      OVERLAY_PLACEMENT_MIN_WIDTH_PERCENT,
      Math.max(OVERLAY_PLACEMENT_MIN_WIDTH_PERCENT, 100 - xPercent)
    ),
    heightPercent: clampPlacementPercent(
      (box.height / safe.height) * 100,
      OVERLAY_PLACEMENT_MIN_HEIGHT_PERCENT,
      Math.max(OVERLAY_PLACEMENT_MIN_HEIGHT_PERCENT, 100 - yPercent)
    )
  };
}

/**
 * The frame-pixel box a source layer occupies, for callers outside the renderer (M57 stage 2,
 * Etappe C: the worker's live-attach path draws a PiP window exactly where the sampled panel would
 * sit). A thin wrapper over the renderer's own placement resolver, deriving the design-grid scale
 * from the frame width the same way buildOverlaySceneLayout does — so the box the worker overlays
 * and the box the renderer would have drawn are bit-identical, and the PiP never drifts from where
 * the skipped snapshot panel used to be. Pure and dependency-free, safe to call off the render path.
 */
export function resolveSourceLayerPixelBox(
  placement: OverlayCustomLayerView,
  frame: { width: number; height: number }
): { left: number; top: number; width: number; height: number } {
  return resolvePlacementBox(placement, overlayScale(frame.width), frame);
}

// The safe area on the 1920x1080 design grid, the rectangle resolvePlacementBox measures percents
// against: 72px in from each side, 56px from top and bottom.
const SAFE_AREA = { left: 72, top: 56, width: 1920 - 144, height: 1080 - 112 };

/**
 * The shortest box resolvePlacementBox will actually produce, in design pixels.
 *
 * Every placement's height is clamped up to OVERLAY_PLACEMENT_MIN_HEIGHT_PERCENT, so a panel whose
 * default asks for less gets more and the studio's caption disagrees with the picture. The clock's
 * box has always been this tall — it asks for 48 and resolves to 77 — which is why the ticker's
 * default has to clear this rather than the 48 the clock draws.
 */
const PLACEMENT_MIN_BOX_HEIGHT = Math.ceil((SAFE_AREA.height * OVERLAY_PLACEMENT_MIN_HEIGHT_PERCENT) / 100);

/**
 * The size each built-in panel is given room for when it is placed, on the design grid.
 *
 * Measured on the rasteriser at 1920x1080, then rounded up to the panel's own worst case, because
 * a placed panel fits into its box instead of growing out of it: the lower third drew 683x220 at
 * the balanced title scale and needs room for the cinematic one, the vote panel 217 at two options
 * and 370 at its five, the chat panel 56 at one message and 266 at its eight, the next card 219x87,
 * the clock 126x48, the banner 1636x52.
 */
const PANEL_DEFAULT_SIZES: Record<OverlayPanelId, { width: number; height: number }> = {
  hero: { width: 1180, height: 260 },
  next: { width: 520, height: 90 },
  vote: { width: 520, height: 370 },
  chat: { width: 680, height: 266 },
  clock: { width: 150, height: 48 },
  banner: { width: 1636, height: 60 },
  // Full safe width, because a notice read in passing wants the longest line it can get: measured
  // on this rasteriser, a Latin glyph at fontSize 26 advances 15.43px, so 1776px less the panel's
  // own 48px of padding holds 112 characters of a message the store caps at 180.
  //
  // 78 tall, not the 56 a single line needs, because resolvePlacementBox floors every box at
  // OVERLAY_PLACEMENT_MIN_HEIGHT_PERCENT — 8% of 968 is 77.44 design pixels, so a shorter number
  // here would be a number the studio showed and the renderer ignored. Measured: asking for 56
  // resolved to 77. This is the floor, rounded up so the percent round trip lands back on it.
  ticker: { width: 1776, height: PLACEMENT_MIN_BOX_HEIGHT }
};

/**
 * What each panel actually measured in the flow, as opposed to the room its box reserves.
 *
 * The two differ on purpose. A box is generous, because a panel that outgrows it is cut off — the
 * lower third has to hold a cinematic title, so its box is 260 tall where the balanced title drew
 * 220. But the panel the flow stacked *above* it started at the drawn edge, not at the generous
 * one, so the stack offsets have to use what was drawn or the chat panel lands 40px high.
 */
const PANEL_FLOW_HEIGHTS: Record<"hero" | "next" | "vote" | "chat", number> = {
  hero: 220,
  next: 87,
  vote: 370,
  chat: 266
};

function percentBox(left: number, top: number, width: number, height: number): OverlayPlacementView {
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    xPercent: round(((left - SAFE_AREA.left) / SAFE_AREA.width) * 100),
    yPercent: round(((top - SAFE_AREA.top) / SAFE_AREA.height) * 100),
    widthPercent: round((width / SAFE_AREA.width) * 100),
    heightPercent: round((height / SAFE_AREA.height) * 100),
    opacityPercent: 100,
    allowOutsideSafeArea: false
  };
}

/**
 * Where the flex flow puts every built-in panel today, as placement boxes.
 *
 * This is the seed the studio shows before anybody has moved anything, and the box a panel is
 * given the moment it is placed. It is derived, not recorded: each panel holds one corner of its
 * box (PANEL_ANCHOR_POINTS), and the boxes below put that corner exactly where the flow puts it,
 * so the panel lands on the same pixel whatever its content measures.
 *
 * Exact for every panel the flow anchors to a corner of the safe area — the lower third, the vote
 * panel, the next card, the clock, the banner. The chat panel is the one the flow stacks (above
 * the lower third at bottom-left, above the rail at bottom-right) or centres (at a top position,
 * where space-between drops it into the middle band rather than under the clock); its box is the
 * room the flow leaves it, measured against a nominal neighbour, and the studio's numbers say
 * where it is rather than pretending the stacking was a choice.
 */
export function deriveDefaultPlacements(
  panelAnchor: string,
  chatPosition = "bottom-left",
  onFrame: { vote?: boolean } = {}
): Record<OverlayPanelId, OverlayPlacementView> {
  const size = PANEL_DEFAULT_SIZES;
  const drawn = PANEL_FLOW_HEIGHTS;
  const safeRight = SAFE_AREA.left + SAFE_AREA.width;
  const safeBottom = SAFE_AREA.top + SAFE_AREA.height;
  // The centre anchor stops the root's space-between and stacks the clock and the lower third as
  // one block in the middle of the frame. Where that block ends up depends on everything else on
  // the frame, so this centres the panels on the frame — which is what the setting means — and the
  // flow's own answer for one particular scene may sit a few dozen pixels off it.
  const heroTop = panelAnchor === "center" ? Math.round((1080 - size.hero.height) / 2) : safeBottom - size.hero.height;
  const heroDrawnTop = heroTop + size.hero.height - drawn.hero;
  const clockTop = panelAnchor === "center" ? heroTop - size.clock.height : SAFE_AREA.top;
  const railBottom = panelAnchor === "center" ? heroTop + size.hero.height : safeBottom;
  // Whichever of the two the rail actually carries is what the chat panel stacks on: the vote
  // panel takes the corner when a vote is running, and the next card has it the rest of the time.
  const railHeight = onFrame.vote ? drawn.vote : drawn.next;

  const chatBox = () => {
    const width = size.chat.width;
    const height = size.chat.height;
    if (chatPosition === "top-left" || chatPosition === "top-right") {
      // Under the top bar, which is where a "top" chat reads as belonging. The flow's
      // space-between currently drops it into the middle band instead — an accident of the root's
      // justification rather than a decision, and not one worth freezing into a default.
      const left = chatPosition === "top-left" ? SAFE_AREA.left : safeRight - width;
      return percentBox(left, SAFE_AREA.top + size.clock.height + 16, width, height);
    }
    if (chatPosition === "bottom-right") {
      return percentBox(safeRight - width, railBottom - railHeight - 14 - height, width, height);
    }
    return percentBox(SAFE_AREA.left, heroDrawnTop - 14 - height, width, height);
  };

  return {
    hero: percentBox(SAFE_AREA.left, heroTop, size.hero.width, size.hero.height),
    next: percentBox(safeRight - size.next.width, railBottom - size.next.height, size.next.width, size.next.height),
    vote: percentBox(safeRight - size.vote.width, railBottom - size.vote.height, size.vote.width, size.vote.height),
    chat: chatBox(),
    clock: percentBox(safeRight - size.clock.width, clockTop, size.clock.width, size.clock.height),
    banner: percentBox(SAFE_AREA.left, SAFE_AREA.top, size.banner.width, size.banner.height),
    // The one panel the flow never placed, so this is a choice rather than a reproduction. It is
    // the band directly under the top bar, clearing the deepest box up there: the banner asks for
    // 60 and the clock for 48, and both resolve to the 78-pixel floor, so the top bar's boxes end
    // at 134 and the ticker starts at 150. Measured, not assumed — the first attempt put it at 120
    // and overlapped the clock's box by 13 pixels, which is exactly the gap between what the clock
    // draws and the box it is given.
    //
    // The lower third is at 764-1024, so there is nothing below to clear. Deliberately not tied to
    // panelAnchor: the centre anchor pulls the clock down to meet the lower third, and following it
    // there would put the ticker inside the block it was moved out of the way of.
    ticker: percentBox(
      SAFE_AREA.left,
      SAFE_AREA.top + Math.max(size.banner.height, size.clock.height, PLACEMENT_MIN_BOX_HEIGHT) + 16,
      size.ticker.width,
      size.ticker.height
    )
  };
}

function flexAlign(edge: "start" | "center" | "end"): string {
  return edge === "center" ? "center" : edge === "end" ? "flex-end" : "flex-start";
}

/**
 * Puts a built-in panel in its placement box.
 *
 * The box is absolute, the panel inside it is not: it is held against the corner it holds in the
 * flow, at its own size, so a box that is roomier than the content does not stretch the panel and
 * a shorter lower third still ends where the flow ended it. overflow: hidden is the promise the
 * flow used to make by construction — a panel that outgrows its box is cut off at the box rather
 * than drawn across its neighbour.
 */
function placePanel(
  panel: OverlayLayoutNode,
  id: OverlayPanelId,
  placement: OverlayPlacementView,
  scale: number,
  frame: { width: number; height: number },
  anchorOverride?: PanelAnchorPoint
): OverlayLayoutNode {
  const box = resolvePlacementBox(placement, scale, frame);
  const anchor = anchorOverride ?? PANEL_ANCHOR_POINTS[id];
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        justifyContent: flexAlign(anchor.x),
        alignItems: flexAlign(anchor.y),
        overflow: "hidden",
        opacity: clampPlacementPercent(placement.opacityPercent ?? 100, 5, 100) / 100
      },
      children: [panel]
    }
  };
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

  const box = resolvePlacementBox(placement, scale, frame);
  const boxLeft = box.left;
  const boxTop = box.top;
  const boxWidth = box.width;
  const boxHeight = box.height;

  const gridWidth = Math.max(1, Math.round(game.gridWidth));
  const gridHeight = Math.max(1, Math.round(game.gridHeight));

  const hint = text(game.hintLine);

  // Text rows above and below the grid share the box with it; whatever is left decides the cell
  // size. The floor keeps cells visible even when an operator draws a tiny box. A coordinate
  // gutter, when the game asks for one, costs exactly one extra cell in each direction.
  //
  // The allowance used to be a flat px(84) whatever the panel actually drew. Measured on the
  // rasteriser at 1920x1080: the header row is 26px tall plus its 10px margin, the hint 19px plus
  // its 10px margin — 65 with a hint, 36 without. The flat number therefore took 19px of board
  // height away from every game and 48px from every game without a hint, which on a full-frame
  // box is a whole cell. Reserving what the rows measure instead is the same arithmetic the rows
  // are laid out by, so the board can grow into what nothing else is using.
  const framePadding = px(18);
  const textAllowance = px(26) + px(10) + (hint ? px(19) + px(10) : 0);
  const gap = Math.max(1, px(2));
  const axis = game.showCoordinates ? 1 : 0;
  const innerWidth = boxWidth - framePadding * 2;
  const innerHeight = boxHeight - framePadding * 2 - textAllowance;
  const cellSize = Math.max(
    px(8),
    Math.floor(
      Math.min(
        (innerWidth - gap * (gridWidth + axis - 1)) / (gridWidth + axis),
        (innerHeight - gap * (gridHeight + axis - 1)) / (gridHeight + axis)
      )
    )
  );

  const cellBorder = Math.max(1, px(2));

  const cellContents = new Map<string, { kind: string; label?: string }>();
  for (const cell of game.cells) {
    cellContents.set(`${String(cell.x)},${String(cell.y)}`, { kind: cell.kind, label: cell.label });
  }

  // Mirrors chatGameColumnLabel in the game framework — declared locally because this file stays
  // dependency-free and the rule (spreadsheet letters: 0 → "a", 26 → "aa") is fixed by the games'
  // own chat vocabulary, which viewers type back at the board.
  const columnLabel = (index: number): string => {
    let value = index + 1;
    let out = "";
    while (value > 0) {
      out = String.fromCharCode(97 + ((value - 1) % 26)) + out;
      value = Math.floor((value - 1) / 26);
    }
    return out;
  };

  const axisLabel = (value: string): OverlayLayoutNode =>
    label(value, {
      width: cellSize,
      height: cellSize,
      alignItems: "center",
      justifyContent: "center",
      color: INK_TERTIARY,
      fontSize: Math.max(px(9), Math.floor(cellSize * 0.44)),
      fontWeight: 700
    });

  const gridRows: OverlayLayoutNode[] = [];
  if (axis === 1) {
    // Column letters across the top, above an empty corner. Without these the coordinates the
    // game asks chat to type would be unguessable on air.
    gridRows.push(
      row({ gap }, [axisLabel(""), ...Array.from({ length: gridWidth }, (_, x) => axisLabel(columnLabel(x)))])
    );
  }
  for (let y = 0; y < gridHeight; y += 1) {
    const rowCells: OverlayLayoutNode[] = [];
    if (axis === 1) {
      rowCells.push(axisLabel(String(y + 1)));
    }
    for (let x = 0; x < gridWidth; x += 1) {
      const content = cellContents.get(`${String(x)},${String(y)}`);
      const kind = content?.kind ?? "";
      const cellStyle: OverlayLayoutStyle = {
        display: "flex",
        width: cellSize,
        height: cellSize,
        borderRadius: Math.max(1, px(3)),
        // Every cell is outlined, because the backdrop behind it may not be there.
        //
        // The board's marks are white or accent-coloured; on the panel fill that is all the
        // contrast they need, and over bare white video with the fill turned off the white snake
        // head measured 1.00:1 against its own surroundings — the board was simply gone. The
        // outline is the one mark that survives both ends: composited over white it measures
        // 14.4:1 against the head it encloses, and over black the head itself is 21:1 against it.
        border: `${String(cellBorder)}px solid rgba(5,7,12,0.85)`,
        backgroundColor: "rgba(255,255,255,0.10)"
      };
      let labelColor = INK_PRIMARY;
      if (kind === "snake-head") {
        // The head is the cell every viewer tracks, so it gets the strongest mark on the panel.
        cellStyle.backgroundColor = "#ffffff";
      } else if (kind === "snake-body") {
        cellStyle.backgroundColor = accent;
      } else if (kind === "food") {
        cellStyle.backgroundColor = "#ffffff";
        cellStyle.borderRadius = 999;
      } else if (kind === "revealed") {
        // A dug minesweeper cell: brighter than untouched ground, numbered at the frontier.
        cellStyle.backgroundColor = "rgba(255,255,255,0.22)";
      } else if (kind === "mine") {
        cellStyle.backgroundColor = "#ffffff";
        cellStyle.borderRadius = 999;
      } else if (kind === "tile") {
        cellStyle.backgroundColor = accent;
        labelColor = accentInkColor(accent);
      } else if (kind === "tile-strong") {
        // The white tile marks the values the round is building towards; dark ink keeps the
        // number readable on it under every accent.
        cellStyle.backgroundColor = "#ffffff";
        labelColor = "#05070c";
      }
      if (content?.label) {
        // Longer labels (a "2048" tile) trade size for fit; the weight keeps them legible.
        cellStyle.alignItems = "center";
        cellStyle.justifyContent = "center";
        cellStyle.color = labelColor;
        cellStyle.fontWeight = 700;
        cellStyle.fontSize = Math.max(px(9), Math.floor(cellSize * (content.label.length > 2 ? 0.3 : 0.46)));
        rowCells.push({ type: "div", props: { style: cellStyle, children: content.label } });
      } else {
        rowCells.push({ type: "div", props: { style: cellStyle } });
      }
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

  // The backdrop is its own node rather than a fill on the panel, so it can fade on its own.
  // Everything the operator can turn off lives here: the surface fill and its border.
  const backdrop: OverlayLayoutNode = {
    type: "div",
    props: {
      style: {
        display: "flex",
        position: "absolute",
        left: 0,
        top: 0,
        width: boxWidth,
        height: boxHeight,
        borderRadius: px(16),
        opacity: clampPlacementPercent(placement.backgroundOpacityPercent ?? 100, 0, 100) / 100,
        ...resolveSurface(surfaceStyle, accent)
      }
    }
  };

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
        // The panel is the box the operator drew, not whatever its content happened to need. A
        // full-frame box measured 1055px of the 1080 it was given, so the backdrop stopped short
        // of the frame and the board sat wherever the content ended.
        height: boxHeight,
        padding: `${String(framePadding)}px`,
        borderRadius: px(16),
        opacity: clampPlacementPercent(placement.opacityPercent, 5, 100) / 100,
        fontFamily
      },
      children: [
        backdrop,
        header,
        // The board takes the room between the two text rows and centres itself in it. Square
        // cells almost never match the box's aspect exactly, so there is always slack on one
        // axis; left-aligned it read as a board shoved into a corner of its own panel (measured
        // 19px of margin on the left against 207px on the right at 1920x1080).
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flexGrow: 1,
              width: "100%",
              gap
            },
            children: gridRows
          }
        },
        ...(hint
          ? [
              label(clampOverlayText(hint, 70), {
                // Secondary, not tertiary: the hint is the only line that tells a new viewer the
                // game is theirs to play.
                color: INK_SECONDARY,
                fontSize: px(16),
                marginTop: px(10)
              })
            ]
          : [])
      ]
    }
  };
}

/**
 * The one place that decides whether a sampled source frame may be drawn.
 *
 * Owner default: a source whose feed went away is HIDDEN on air — no frozen last picture, because
 * a viewer cannot tell a frozen camera from a live one, and the studio shows the outage as a
 * status instead. If that decision ever changes to "last picture plus an offline mark", this
 * predicate (and buildSourcePanel, which would gain the mark) is the whole change.
 */
export function sourceFrameVisible(frame: OverlaySourceFrameView | null | undefined): frame is OverlaySourceFrameView {
  return Boolean(frame && frame.status === "live" && frame.dataUri.startsWith("data:image/"));
}

/**
 * The sampled-source panel: the newest capture, filling the operator's placement box.
 *
 * Deliberately chromeless beyond the shared surface: a camera picture explains itself, and every
 * heading would cost picture height. The image is always a data URI (the sampler reads the
 * capture file and inlines it), so drawing this panel never puts network I/O on the render path.
 */
function buildSourcePanel(
  sourceFrame: OverlaySourceFrameView,
  placement: OverlayCustomLayerView,
  accent: string,
  scale: number,
  surfaceStyle: string,
  frame: { width: number; height: number }
): OverlayLayoutNode {
  const px = (value: number) => Math.round(value * scale);
  const box = resolvePlacementBox(placement, scale, frame);
  const framePadding = Math.max(2, px(6));

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        padding: `${framePadding}px`,
        borderRadius: px(16),
        opacity: clampPlacementPercent(placement.opacityPercent, 5, 100) / 100,
        ...resolveSurface(surfaceStyle, accent)
      },
      children: [
        {
          type: "img",
          props: {
            src: sourceFrame.dataUri,
            style: {
              width: box.width - framePadding * 2,
              height: box.height - framePadding * 2,
              objectFit: "cover",
              borderRadius: px(12)
            }
          }
        }
      ]
    }
  };
}

/**
 * A logo or image layer on air: the same placement rules as every positioned panel, no surface
 * chrome. Chromeless on purpose — logos ship with transparency, and putting the panel scrim
 * behind them would draw a dark plate the studio preview does not show.
 *
 * Only URLs the rasteriser can actually resolve are drawn: data URIs (free) and absolute http(s)
 * URLs (satori fetches them when the frame's cache key changes). A relative library path renders
 * in the browser overlay but has no base URL here, so it is skipped rather than failing the
 * whole frame.
 */
function buildMediaPanel(
  placement: OverlayCustomLayerView,
  scale: number,
  frame: { width: number; height: number }
): OverlayLayoutNode | null {
  const url = String(placement.url ?? "");
  if (!/^(data:image\/|https?:\/\/)/.test(url)) {
    return null;
  }

  const px = (value: number) => Math.round(value * scale);
  const box = resolvePlacementBox(placement, scale, frame);

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        borderRadius: px(16),
        overflow: "hidden",
        opacity: clampPlacementPercent(placement.opacityPercent, 5, 100) / 100
      },
      children: [
        {
          type: "img",
          props: {
            src: url,
            style: {
              width: box.width,
              height: box.height,
              objectFit: placement.fit === "cover" ? "cover" : "contain"
            }
          }
        }
      ]
    }
  };
}

/**
 * A text layer on air, built from the panel's existing ink and surface vocabulary — no colours of
 * its own. Tones map onto the studio's three text sizes; with only regular and bold faces loaded,
 * the headline is bold and body/caption stay regular. Custom local font families cannot reach the
 * rasteriser (it loads exactly three families), so they fall back to the scene's preset stack.
 */
function buildTextPanel(
  placement: OverlayCustomLayerView,
  accent: string,
  scale: number,
  fontFamily: string,
  surfaceStyle: string,
  frame: { width: number; height: number }
): OverlayLayoutNode | null {
  const primary = clampOverlayText(String(placement.text ?? ""), 180);
  const secondary = clampOverlayText(String(placement.secondaryText ?? ""), 220);
  if (!primary && !secondary) {
    return null;
  }

  const px = (value: number) => Math.round(value * scale);
  const box = resolvePlacementBox(placement, scale, frame);
  const tone = String(placement.textTone ?? "headline");
  const align = String(placement.textAlign ?? "left");
  const alignItems = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";

  const stacks: Record<string, string> = {
    "safe-sans": FONT_STACKS["studio-sans"]!,
    "safe-serif": FONT_STACKS["editorial-serif"]!,
    "safe-mono": FONT_STACKS["signal-mono"]!
  };
  const resolvedFamily = stacks[String(placement.fontMode ?? "")] ?? fontFamily;

  const primaryStyle: OverlayLayoutStyle =
    tone === "caption"
      ? { fontSize: px(13), letterSpacing: px(1), textTransform: "uppercase" }
      : tone === "body"
        ? { fontSize: px(16), lineHeight: 1.2 }
        : { fontSize: px(30), fontWeight: 700, lineHeight: 1.05 };

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems,
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        padding: `${px(14)}px ${px(18)}px`,
        borderRadius: px(16),
        opacity: clampPlacementPercent(placement.opacityPercent, 5, 100) / 100,
        fontFamily: resolvedFamily,
        textAlign: align,
        ...resolveSurface(surfaceStyle, accent)
      },
      children: [
        ...(primary
          ? [label(primary, { color: placement.useAccent === true ? accentTextColor(accent) : INK_PRIMARY, ...primaryStyle })]
          : []),
        ...(secondary ? [label(secondary, { color: INK_SECONDARY, fontSize: px(13), marginTop: px(6) })] : [])
      ]
    }
  };
}

function buildBanner(message: string, scale: number, fontFamily: string, fit?: PanelFit): OverlayLayoutNode {
  const px = (value: number) => Math.round(value * scale);
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        width: fit ? fit.width : "100%",
        justifyContent: "center",
        padding: `${px(12)}px ${px(24)}px`,
        // 12 keeps the banner within the panel radius family (12/16/18) instead of being the one
        // shape with its own corner.
        borderRadius: px(12),
        backgroundColor: "rgba(190,32,48,0.94)",
        color: INK_PRIMARY,
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
 * Opacity of the ticker's own fill.
 *
 * Exported because it is the number the legibility of this panel rests on, and a test that had to
 * re-read it out of a style string would be testing the parser.
 *
 * The ticker is the one panel a viewer reads without having chosen to look at it, over whatever
 * the programme happens to be showing, so it is the most opaque thing on the frame rather than the
 * least. 0.94 is not a new number: it is exactly the "solid" surface style's fill, so the palette
 * gains nothing to keep in step. Measured, white ink on this fill: 19.80:1 over black video,
 * 17.64:1 over white video — the two ends of what a video frame can be. The softest surface in the
 * family, signal's 0.72, would still clear the 4.5:1 bar at 8.25:1; 0.94 is chosen because a
 * ticker that is hard to read is a ticker nobody reads, not because 0.72 would fail.
 */
export const OVERLAY_TICKER_FILL_ALPHA = 0.94;

/**
 * The ticker band: one message, held still, inside the box the operator gave it.
 *
 * The fit rule is the chat panel's, not a character budget: the number of lines comes out of the
 * box's own height, and satori clamps the text to that. A character budget cannot promise a fit
 * because glyphs are not characters — the same 180 characters are 2775px of Latin and 5060px of
 * full-width CJK at this size, and only one of those was ever going to overflow a box measured in
 * characters.
 */
function buildTickerPanel(
  message: string,
  accent: string,
  scale: number,
  fontFamily: string,
  fit: PanelFit
): OverlayLayoutNode {
  const px = (value: number) => Math.round(value * scale);
  const fontSize = px(OVERLAY_TICKER_TEXT.fontSize);
  const lineHeight = OVERLAY_TICKER_TEXT.lineHeight;
  const padY = px(TICKER_PAD_Y);
  const padX = px(TICKER_PAD_X);

  // What the box actually holds, the way buildChatPanel derives its message count from its height.
  // At the default 56-tall band this is one line; an operator who drags the box taller gets the
  // lines they made room for instead of a panel that ignores them.
  const lines = Math.max(1, Math.min(4, Math.floor((fit.height - padY * 2) / Math.round(fontSize * lineHeight))));

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        alignItems: "center",
        width: fit.width,
        height: fit.height,
        padding: `${String(padY)}px ${String(padX)}px`,
        borderRadius: px(12),
        backgroundColor: `rgba(8,10,15,${String(OVERLAY_TICKER_FILL_ALPHA)})`,
        borderLeft: `${String(px(TICKER_ACCENT_BORDER))}px solid ${accent}`,
        overflow: "hidden"
      },
      // An empty message draws the band and nothing in it. That is not a degenerate case: it is
      // the on-air case, where the line is a strip ffmpeg moves across this very rectangle, and
      // drawing it here as well would put a second, motionless copy under the moving one.
      children: message
        ? [
        label(message, {
          color: INK_PRIMARY,
          fontSize,
          fontFamily,
          fontWeight: OVERLAY_TICKER_TEXT.fontWeight,
          lineHeight,
          letterSpacing: px(OVERLAY_TICKER_TEXT.letterSpacing),
          // The three together are what makes satori cut rather than overflow, exactly as the chat
          // panel's message label does.
          lineClamp: lines,
          display: "block",
          minWidth: 0,
          overflow: "hidden"
        })
          ]
        : []
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
  const fontFamily = overlayFontFamily(payload.scene.typographyPreset);
  const anchorTop = payload.scene.panelAnchor === "center";

  const frameSize = { width: options.width, height: options.height };

  // Placements the operator has set. A panel with no entry here is not placed: it stays in the
  // flex flow below and nothing about it changes, which is why a scene nobody has rearranged draws
  // the tree it drew before placement existed.
  const placements = payload.scene.panelPlacements ?? {};
  const placedPanels: OverlayLayoutNode[] = [];
  const fitFor = (id: OverlayPanelId): PanelFit | undefined => {
    const placement = placements[id];
    return placement ? resolvePlacementBox(placement, scale, frameSize) : undefined;
  };
  /** Sends a built panel to its box, or hands it back to the flow when it has none. */
  const routed = (
    id: OverlayPanelId,
    panel: OverlayLayoutNode | null,
    anchor?: PanelAnchorPoint
  ): OverlayLayoutNode | null => {
    const placement = placements[id];
    if (!panel || !placement) {
      return panel;
    }
    placedPanels.push(placePanel(panel, id, placement, scale, frameSize, anchor));
    return null;
  };

  const banner = text(payload.emergencyBanner);
  const votePanel = routed(
    "vote",
    input.engagement ? buildVotePanel(input.engagement, accent, scale, fontFamily, payload.scene.surfaceStyle, fitFor("vote")) : null
  );
  const nextCard = routed("next", buildNextCard(payload, accent, scale, fontFamily, fitFor("next")));

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

  // The other positioned layers, in the operator's layer order. The source panel follows the
  // game panel's double gate: an enabled source layer AND a drawable frame (see
  // sourceFrameVisible — a stale feed hides the layer rather than freezing it). One frame input
  // means one drawn source layer per scene; the first enabled one wins, like the game panel.
  // embed and widget layers never appear here — satori cannot run an iframe, so they stay
  // browser-overlay-only and the studio says so.
  const customPanels: OverlayLayoutNode[] = [];
  let sourceDrawn = false;
  for (const layer of payload.scene.customLayers ?? []) {
    if (!layer.enabled) {
      continue;
    }
    if (layer.kind === "source" && !sourceDrawn && sourceFrameVisible(input.sourceFrame)) {
      customPanels.push(buildSourcePanel(input.sourceFrame, layer, accent, scale, payload.scene.surfaceStyle, frameSize));
      sourceDrawn = true;
    } else if (layer.kind === "logo" || layer.kind === "image") {
      const mediaPanel = buildMediaPanel(layer, scale, frameSize);
      if (mediaPanel) {
        customPanels.push(mediaPanel);
      }
    } else if (layer.kind === "text") {
      const textPanel = buildTextPanel(layer, accent, scale, fontFamily, payload.scene.surfaceStyle, frameSize);
      if (textPanel) {
        customPanels.push(textPanel);
      }
    }
  }

  // Chat is gated upstream (enabled setting, freshness) by the projection that builds the view;
  // here the only gate left is content. An empty or fully-sanitised-away chat builds no panel,
  // and with no panel every placement below collapses back to exactly the chatless tree.
  const chatBuilt = input.chat ? buildChatPanel(input.chat, accent, scale, fontFamily, payload.scene.surfaceStyle, fitFor("chat")) : null;
  // A placed chat panel still holds the corner the operator picked, so moving the box does not
  // silently re-anchor it: a top-right chat grows downwards from the box's top-right corner.
  const requested = String(input.chat?.position ?? "");
  const chatPanel = routed("chat", chatBuilt, {
    x: requested === "top-right" || requested === "bottom-right" ? "end" : "start",
    y: requested === "top-left" || requested === "top-right" ? "start" : "end"
  });
  const chatPosition = chatPanel ? requested : "";

  const clock = formatOverlayClock(options.now ?? new Date(), payload.timeZone);
  const clockChip = label(clock, {
    color: INK_PRIMARY,
    fontSize: px(26),
    fontWeight: 700,
    letterSpacing: px(1),
    fontFamily,
    padding: `${px(8)}px ${px(18)}px`,
    borderRadius: px(999),
    ...resolveSurface(payload.scene.surfaceStyle, accent)
  });

  // The placeholder an absent banner already used stands in for a placed one too, so the row keeps
  // its shape whichever of the two has left it.
  const emptyCell = (): OverlayLayoutNode => ({ type: "div", props: { style: { display: "flex" } } });
  const bannerCell = banner ? routed("banner", buildBanner(banner, scale, fontFamily, fitFor("banner"))) : null;
  const clockCell = routed("clock", clockChip);

  const topBar: OverlayLayoutNode[] = [
    row({ alignItems: "flex-start", justifyContent: "space-between", width: "100%", gap: px(24) }, [
      bannerCell ?? emptyCell(),
      clockCell ?? emptyCell()
    ])
  ];

  // The chat panel joins the flex flow of whichever corner the operator chose, never absolute
  // positioning: a top position hangs it in its own full-width row under the banner/clock, a
  // bottom position stacks it into the column of the panel that anchors that corner. Flex flow is
  // the overlap guarantee — the panel displaces its neighbours instead of covering them, which is
  // what lets the height claim at OVERLAY_CHAT_PANEL_MAX_MESSAGES stay a budget rather than a
  // collision rule. This also holds for the centre anchor, where absolute maths would collide
  // with the vertically-centred lower third.
  if (chatPanel && (chatPosition === "top-left" || chatPosition === "top-right")) {
    topBar.push(
      row(
        {
          width: "100%",
          justifyContent: chatPosition === "top-left" ? "flex-start" : "flex-end",
          marginTop: px(16)
        },
        [chatPanel]
      )
    );
  }

  // Right rail carries whatever is secondary: the vote panel takes priority over "up next",
  // because it is the thing viewers are being asked to act on.
  const rail: OverlayLayoutNode[] = [];
  if (chatPanel && chatPosition === "bottom-right") {
    // Above the vote panel / next card, so those keep their exact anchor at the frame's edge.
    rail.push(chatPanel);
  }
  if (votePanel) {
    rail.push(votePanel);
  } else if (nextCard) {
    rail.push(nextCard);
  }

  // The ticker is the one built-in panel with no position in the flow to fall back on — it never
  // had one, because it was never drawn. So it is always placed, from the operator's box when they
  // have moved it and from the derived default otherwise, and it is the empty text rather than a
  // missing placement that keeps it off the picture.
  // Placed from the very plan ffmpeg crawls in, so the rectangle the moving strip runs across and
  // the rectangle this paints the band into cannot drift apart.
  // In crawl mode the band belongs to the PROCESS, not to the current payload: ffmpeg is moving a
  // strip across one rectangle for the whole programme, so neither a text cleared mid-block nor a
  // panel dragged mid-block may take the band away from the line running across it.
  const crawling = Boolean(options.tickerCrawl);
  const tickerPlan = overlayTickerCrawlPlan(input, frameSize, options.tickerCrawl);
  if (tickerPlan || crawling) {
    const tickerPlacement =
      options.tickerCrawl ??
      placements.ticker ??
      deriveDefaultPlacements(payload.scene.panelAnchor, String(input.chat?.position ?? "")).ticker;
    placedPanels.push(
      placePanel(
        buildTickerPanel(
          crawling ? "" : (tickerPlan?.line ?? ""),
          accent,
          scale,
          fontFamily,
          resolvePlacementBox(tickerPlacement, scale, frameSize)
        ),
        "ticker",
        tickerPlacement,
        scale,
        frameSize
      )
    );
  }

  const lowerThird = routed("hero", buildLowerThird(payload, accent, scale, fontFamily, fitFor("hero")));
  const chatAtBottomLeft = chatPanel && !(chatPosition === "bottom-right" || chatPosition === "top-left" || chatPosition === "top-right");
  const leftCell: OverlayLayoutNode = chatAtBottomLeft
    ? {
        type: "div",
        props: {
          style: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: px(14) },
          children: [chatPanel, ...(lowerThird ? [lowerThird] : [])]
        }
      }
    : lowerThird ?? emptyCell();

  const bottom = row({ alignItems: "flex-end", justifyContent: "space-between", width: "100%", gap: px(28) }, [
    leftCell,
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
      // Placed built-in panels go after the flow and before the custom layers: a panel the operator
      // moved is still the renderer's own furniture, so anything they added on top stays on top.
      children: [...topBar, bottom, ...placedPanels, ...(gamePanel ? [gamePanel] : []), ...customPanels]
    }
  };
}
