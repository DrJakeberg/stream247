import { describe, expect, it, vi } from "vitest";
import {
  buildOverlaySceneLayout,
  parseTwitchEmoteTag,
  buildChatMessageSegments,
  resolveChatGameCommand,
  formatChatGameInfoReply,
  formatChatGameNoRoomReply,
  createDefaultChatGameSettings,
  normalizeOverlaySceneCustomLayers,
  type OverlaySceneCustomLayer,
  type OverlayLayoutNode,
  type OverlayScenePayloadView
} from "@stream247/core";
import { TwitchChatBridge, parseTwitchIrcMessage } from "../../apps/worker/src/twitch-engagement";
import {
  hasActiveChatGameLayer,
  resolveChatGameLayerProvisioning,
  resolveChatGameLayerTeardown,
  type ChatGameLayerProvisioningInput
} from "../../apps/worker/src/chat-game";
import { buildChatOverlayViewFromMessages } from "../../apps/worker/src/chat-overlay";

/**
 * The three things the operator reported, as one file: emotes never reached the broadcast, "!game"
 * did nothing, and the direction emotes steered nothing because no game was ever active.
 *
 * Everything here runs with moderator rights only — the emote positions ride the PRIVMSG tags every
 * chatter receives, the emote pictures come off an unauthenticated CDN, and starting a game writes
 * rows this installation already owns. No broadcaster-scoped API is touched.
 */

const FRAME = { width: 1920, height: 1080 };

function createPayload(): OverlayScenePayloadView {
  return {
    scene: {
      surfaceStyle: "glass",
      panelAnchor: "bottom",
      titleScale: "balanced",
      typographyPreset: "studio-sans",
      resolvedPresetId: "lower-third",
      customLayers: []
    },
    channelName: "jimpanse247",
    accentColor: "#6ee7ff",
    brandLine: "STREAM247",
    heroLabel: "Now playing",
    heroTitle: "Retro Night",
    heroBody: "",
    metaLine: "",
    nextLabel: "Up next",
    nextTitle: "",
    nextTimeLabel: "",
    queueTitles: [],
    tickerText: "",
    emergencyBanner: "",
    timeZone: "Europe/Berlin"
  };
}

function collectNodes(node: OverlayLayoutNode | null, out: OverlayLayoutNode[] = []): OverlayLayoutNode[] {
  if (!node || typeof node !== "object") {
    return out;
  }
  out.push(node);
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      collectNodes(child as OverlayLayoutNode, out);
    }
  } else if (children && typeof children === "object") {
    collectNodes(children as OverlayLayoutNode, out);
  }
  return out;
}

describe("symptom 1: emotes on the broadcast", () => {
  it("keeps the emote positions Twitch sends in the PRIVMSG tags", () => {
    const line =
      "@badge-info=;badges=;display-name=Viewer;emotes=25:0-4,12-16;id=chat-1;mod=0 " +
      ":viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #jimpanse247 :Kappa hey Kappa";

    const message = parseTwitchIrcMessage(line);

    expect(message?.emotes).toEqual([
      { id: "25", start: 0, end: 4 },
      { id: "25", start: 12, end: 16 }
    ]);
  });

  it("draws an emote as a picture, not as its literal code", () => {
    const layout = buildOverlaySceneLayout(
      {
        payload: createPayload(),
        chat: {
          position: "bottom-left",
          maxMessages: 5,
          messages: [
            {
              name: "viewer",
              text: "Kappa hey",
              segments: [
                { kind: "emote", id: "25", url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0" },
                { kind: "text", text: " hey" }
              ]
            }
          ]
        }
      },
      FRAME
    );

    const images = collectNodes(layout).filter((node) => node.type === "img");
    expect(images).toHaveLength(1);
    expect(images[0]!.props.src).toContain("/emoticons/v2/25/");
    // Explicit intrinsic size: satori throws "Image size cannot be determined" and loses the whole
    // frame when a remote picture cannot be fetched and no size was declared.
    expect(images[0]!.props.width).toBeGreaterThan(0);
    expect(images[0]!.props.height).toBeGreaterThan(0);
  });

  it("splits a message on code points, so an emote after an astral character lands right", () => {
    const occurrences = parseTwitchEmoteTag("25:2-6");
    const segments = buildChatMessageSegments("🎮 Kappa", occurrences);

    expect(segments).toEqual([
      { kind: "text", text: "🎮 " },
      { kind: "emote", id: "25", url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0" }
    ]);
  });
});

describe("the emote path through the process boundary", () => {
  it("carries the segments from the bridge buffer to the on-air projection", () => {
    const bridge = new TwitchChatBridge();
    bridge["channel"] = "jimpanse247";
    bridge["handleChunk"](
      "@display-name=Viewer;emotes=25:0-4;id=chat-9;mod=0 " +
        ":viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #jimpanse247 :Kappa hey\r\n"
    );

    const buffered = bridge.getRecentMessages();
    expect(buffered).toHaveLength(1);
    expect(buffered[0]!.segments[0]).toMatchObject({ kind: "emote", id: "25" });

    const view = buildChatOverlayViewFromMessages(
      {
        enabled: true,
        position: "bottom-left",
        maxMessages: 5,
        messages: buffered.map((event) => ({
          name: event.actor,
          text: event.message,
          at: event.createdAt,
          segments: event.segments
        }))
      },
      new Date()
    );

    expect(view?.messages[0]?.segments?.[0]).toMatchObject({ kind: "emote", id: "25" });
  });

  it("draws nothing for an emote whose address is not a fetchable picture", () => {
    const layout = buildOverlaySceneLayout(
      {
        payload: createPayload(),
        chat: {
          position: "bottom-left",
          maxMessages: 5,
          messages: [
            {
              name: "viewer",
              text: "hey",
              segments: [
                { kind: "emote", id: "25", url: "javascript:alert(1)" },
                { kind: "text", text: "hey" }
              ]
            }
          ]
        }
      },
      FRAME
    );

    expect(collectNodes(layout).filter((node) => node.type === "img")).toHaveLength(0);
  });
});

describe("symptom 2: !game", () => {
  it("answers !game with the games and how to start them", () => {
    expect(resolveChatGameCommand("!game")).toEqual({ kind: "info" });
    const reply = formatChatGameInfoReply({ running: null, settings: createDefaultChatGameSettings() });
    expect(reply).toContain("!snake");
    expect(reply).toContain("!minesweeper");
    expect(reply).toContain("!2048");
  });

  it("starts a game from its own command, with the ! optional like !here", () => {
    expect(resolveChatGameCommand("!snake")).toEqual({ kind: "start", gameId: "snake" });
    expect(resolveChatGameCommand("2048")).toEqual({ kind: "start", gameId: "2048" });
    expect(resolveChatGameCommand("!minesweeper")).toEqual({ kind: "start", gameId: "minesweeper" });
    expect(resolveChatGameCommand("hello there")).toBeNull();
  });

  it("never fires on a sentence that merely mentions a game", () => {
    expect(resolveChatGameCommand("i love snake")).toBeNull();
    expect(resolveChatGameCommand("snake is great")).toBeNull();
    expect(resolveChatGameCommand("")).toBeNull();
  });

  it("says the answer back into the room the bridge is joined to", async () => {
    const write = vi.fn();
    const onChatGameCommand = vi.fn().mockResolvedValue("No game is running. Start one: !snake");
    const bridge = new TwitchChatBridge({ onChatGameCommand });

    bridge["socket"] = { write, destroyed: false } as never;
    bridge["channel"] = "jimpanse247";
    bridge["handleChunk"](
      "@display-name=Viewer;id=chat-2;mod=0 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #jimpanse247 :!game\r\n"
    );

    // The handler is async so the socket path never blocks; the reply lands on the next turns.
    await new Promise((resolve) => setImmediate(resolve));

    expect(onChatGameCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: { kind: "info" }, actor: "Viewer", isModerator: false })
    );
    expect(write).toHaveBeenCalledWith("PRIVMSG #jimpanse247 :No game is running. Start one: !snake\r\n");
  });
});

/** The overlay a start would write, or a thrown refusal — for the tests about the ok path. */
function provisionedOverlay(overlay: ChatGameLayerProvisioningInput): ChatGameLayerProvisioningInput {
  const provisioning = resolveChatGameLayerProvisioning(overlay);
  if (!provisioning.ok) {
    throw new Error(`refused: ${provisioning.reason}`);
  }
  return provisioning.overlay;
}

describe("symptom 3: the direction emotes did nothing", () => {
  it("provisions the on-air game layer, so starting a game needs no studio handwork", () => {
    const provisioned = provisionedOverlay({ enabled: false, customLayers: [] });

    expect(provisioned.enabled).toBe(true);
    expect(provisioned.customLayers.some((layer) => layer.kind === "game" && layer.enabled)).toBe(true);
  });

  it("re-enables an existing game layer instead of adding a second one", () => {
    const provisioned = provisionedOverlay({
      enabled: true,
      customLayers: [
        {
          id: "layer-1",
          kind: "game",
          name: "Chat Game",
          enabled: false,
          xPercent: 60,
          yPercent: 10,
          widthPercent: 30,
          heightPercent: 44,
          opacityPercent: 100,
          allowOutsideSafeArea: false
        }
      ]
    });

    expect(provisioned.customLayers).toHaveLength(1);
    expect(provisioned.customLayers[0]!.enabled).toBe(true);
  });

  it("switches the layer off on stop but leaves the overlay published", () => {
    const started = provisionedOverlay({ enabled: false, customLayers: [] });
    const stopped = resolveChatGameLayerTeardown(started);

    expect(stopped.customLayers.some((layer) => layer.kind === "game" && layer.enabled)).toBe(false);
    // Chat started the game; it did not publish the overlay, so it must not unpublish it either.
    expect(stopped.enabled).toBe(true);
    expect(stopped.customLayers).toHaveLength(1);
  });
});

describe("finding: the studio's layer cap", () => {
  function textLayer(index: number): OverlaySceneCustomLayer {
    return {
      id: `text-${index}`,
      kind: "text",
      name: `Text ${index}`,
      enabled: true,
      xPercent: 4,
      yPercent: 10,
      widthPercent: 34,
      heightPercent: 16,
      opacityPercent: 100,
      allowOutsideSafeArea: false,
      text: `Line ${index}`,
      secondaryText: "",
      textTone: "headline",
      textAlign: "left",
      useAccent: false
    };
  }

  /**
   * What the handler does with a start, minus the database: provisioning on the stored overlay,
   * the write through the store's real normaliser (cap included), and the reply decided on what
   * came out of it — never on what went in.
   */
  function startFromChat(overlay: ChatGameLayerProvisioningInput) {
    const provisioning = resolveChatGameLayerProvisioning(overlay);
    const written = provisioning.ok ? provisioning.overlay : overlay;
    const stored = { enabled: written.enabled, customLayers: normalizeOverlaySceneCustomLayers(written.customLayers) };
    const onAir = hasActiveChatGameLayer(stored);
    const reply = onAir
      ? formatChatGameInfoReply({ running: { gameId: "snake" }, settings: createDefaultChatGameSettings() })
      : formatChatGameNoRoomReply({ gameId: "snake", layerCount: stored.customLayers.length });
    return { provisioning, stored, onAir, reply };
  }

  it("refuses a start the store has no room to keep, and never says 'on air' for it", () => {
    // The studio's maximum of eight layers, none of them a game, overlay not published.
    const overlay = { enabled: false, customLayers: Array.from({ length: 8 }, (_, index) => textLayer(index)) };
    const { provisioning, stored, onAir, reply } = startFromChat(overlay);

    expect(provisioning).toEqual({ ok: false, reason: "no-room", layerCount: 8 });
    expect(onAir).toBe(false);
    expect(reply).not.toContain("on air");
    expect(reply).toContain("8 layers");
    expect(reply).toContain("!snake");
    // A refused start leaves the overlay exactly as the operator had it: not published, no
    // ninth layer, nothing for the normaliser to drop.
    expect(stored.enabled).toBe(false);
    expect(stored.customLayers.map((layer) => layer.kind)).toEqual(Array(8).fill("text"));
  });

  it("fits the game layer in beside seven others, and the store keeps it", () => {
    const overlay = { enabled: false, customLayers: Array.from({ length: 7 }, (_, index) => textLayer(index)) };
    const { provisioning, stored, onAir, reply } = startFromChat(overlay);

    expect(provisioning.ok).toBe(true);
    expect(stored.customLayers).toHaveLength(8);
    expect(onAir).toBe(true);
    expect(reply).toContain("on air");
  });
});
