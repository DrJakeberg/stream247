import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@stream247/core";
import { resolveChannelLanguage } from "../../packages/db/src/instance-config.js";
import { buildActiveScenePayload, getViewerLocale } from "../../apps/web/lib/server/state";
import { resolveTwitchFallbackTitle } from "../../apps/worker/src/twitch-metadata";

/**
 * The channel language setting (M80): stored like the channel timezone, in managed config, with
 * CHANNEL_LANGUAGE overriding it from the environment, and English when neither says anything.
 * The worker, playout and uplink read it through resolveChannelLanguage on the managed config each
 * cycle refreshes; the web app through getViewerLocale, which wraps the same resolver.
 */

describe("resolveChannelLanguage — the worker's, playout's and uplink's reader", () => {
  it("prefers env, then the stored value, then English", () => {
    expect(resolveChannelLanguage({ channelLanguage: "en" }, { CHANNEL_LANGUAGE: "de" })).toBe("de");
    expect(resolveChannelLanguage({ channelLanguage: "de" }, {})).toBe("de");
    expect(resolveChannelLanguage({ channelLanguage: "de" }, { CHANNEL_LANGUAGE: "  " })).toBe("de");
    expect(resolveChannelLanguage({ channelLanguage: "" }, {})).toBe("en");
    expect(resolveChannelLanguage(undefined, {})).toBe("en");
  });

  it("reads anything that is not a language this build speaks as English", () => {
    expect(resolveChannelLanguage({ channelLanguage: "fr" }, {})).toBe("en");
    expect(resolveChannelLanguage({ channelLanguage: "de" }, { CHANNEL_LANGUAGE: "klingon" })).toBe("en");
    expect(resolveChannelLanguage({ channelLanguage: "DE" }, {})).toBe("de");
  });
});

describe("the web app's reader and the studio preview", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function state(channelLanguage: string, queueKind = "standby"): AppState {
    return {
      assets: [],
      sources: [],
      playout: {
        currentAssetId: "",
        nextAssetId: "",
        processStartedAt: "",
        currentTitle: "Replay standby",
        nextTitle: "",
        liveBridgeLabel: "",
        liveBridgeInputType: "rtmp",
        queueItems: [{ kind: queueKind, title: "Please wait, restream is starting" }],
        queuedAssetIds: []
      },
      scheduleBlocks: [],
      managedConfig: { channelLanguage, channelTimezone: "UTC" },
      overlay: {
        queuePreviewCount: 3,
        channelName: "Stream247",
        replayLabel: "Replay stream",
        headline: "Always on air",
        standbyHeadline: "Please wait, restream is starting"
      }
    } as unknown as AppState;
  }

  it("follows the same order as the worker", () => {
    vi.stubEnv("CHANNEL_LANGUAGE", "");
    expect(getViewerLocale(state("de"))).toBe("de");
    expect(getViewerLocale(state(""))).toBe("en");
    vi.stubEnv("CHANNEL_LANGUAGE", "de");
    expect(getViewerLocale(state("en"))).toBe("de");
  });

  it("previews the standby slate in the channel language, as the broadcast will draw it", () => {
    vi.stubEnv("CHANNEL_LANGUAGE", "");
    const german = buildActiveScenePayload(state("de"));
    expect([german.locale, german.heroLabel, german.heroTitle, german.heroBody, german.brandLine]).toEqual([
      "de",
      "Gleich geht’s weiter",
      "Kurze Pause – gleich geht’s weiter",
      "Kurze Pause – gleich geht’s weiter",
      "Wiederholung"
    ]);
    const english = buildActiveScenePayload(state("en"));
    expect([english.locale, english.heroLabel, english.heroBody]).toEqual(["en", "Stand by", "Stand by, we’ll be right back"]);
  });

  it("previews a live bridge in the channel language", () => {
    vi.stubEnv("CHANNEL_LANGUAGE", "");
    const base = state("de", "live");
    const live = buildActiveScenePayload(
      {
        ...base,
        playout: { ...base.playout, currentTitle: "", queueItems: [{ kind: "live", title: "" }] },
        overlay: { ...base.overlay, showCurrentCategory: true, showSourceLabel: true }
      } as AppState,
      { queueKind: "live" }
    );
    expect([live.heroTitle, live.metaLine]).toEqual(["Live-Schaltung", "Live-Übertragung · Live-Schaltung · RTMP"]);
  });
});

describe("the Twitch title when no asset names it", () => {
  it("is the schedule block's title when there is one, written by the operator and left alone", () => {
    expect(resolveTwitchFallbackTitle({ locale: "de", scheduleTitle: "Retro Night", playoutTitle: "Replay standby" })).toBe("Retro Night");
  });

  it("turns the worker's English state titles into the channel language", () => {
    expect(resolveTwitchFallbackTitle({ locale: "de", scheduleTitle: "", playoutTitle: "Replay standby" })).toBe("Gleich geht’s weiter");
    expect(resolveTwitchFallbackTitle({ locale: "de", scheduleTitle: "", playoutTitle: "Scheduled reconnect" })).toBe("Geplanter Neustart");
    expect(resolveTwitchFallbackTitle({ locale: "de", scheduleTitle: "", playoutTitle: "Live Bridge" })).toBe("Live-Schaltung");
    expect(resolveTwitchFallbackTitle({ locale: "en", scheduleTitle: "", playoutTitle: "Scheduled reconnect" })).toBe("Scheduled reconnect");
    expect(resolveTwitchFallbackTitle({ locale: "de", scheduleTitle: "", playoutTitle: "Guest Interview" })).toBe("Guest Interview");
  });
});

const { mockRequireApiRoles, mockAppendAuditEvent, mockReadAppState, mockUpdateManagedConfigRecord } = vi.hoisted(() => ({
  mockRequireApiRoles: vi.fn(),
  mockAppendAuditEvent: vi.fn(),
  mockReadAppState: vi.fn(),
  mockUpdateManagedConfigRecord: vi.fn()
}));

vi.mock("@/lib/server/auth", () => ({ requireApiRoles: mockRequireApiRoles }));
vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  }
}));

describe("PUT /api/settings/instance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiRoles.mockResolvedValue(null);
    mockReadAppState.mockResolvedValue({
      managedConfig: { appUrl: "https://stream.example", channelTimezone: "Europe/Berlin", channelLanguage: "", twitchClientId: "keep" }
    });
  });

  async function put(body: Record<string, string>) {
    // The route's state helpers, replaced for this suite only; the preview tests above use the real ones.
    vi.doMock("@/lib/server/state", () => ({
      appendAuditEvent: mockAppendAuditEvent,
      readAppState: mockReadAppState,
      updateManagedConfigRecord: mockUpdateManagedConfigRecord
    }));
    vi.resetModules();
    const { PUT } = await import("../../apps/web/app/api/settings/instance/route");
    return PUT(new Request("http://localhost/api/settings/instance", { method: "PUT", body: JSON.stringify(body) }) as never);
  }

  it("saves the language alone, leaving the URL and the timezone as they were", async () => {
    const response = await put({ channelLanguage: "de" });
    expect(response.status).toBe(200);
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(
      expect.objectContaining({ channelLanguage: "de", appUrl: "https://stream.example", channelTimezone: "Europe/Berlin", twitchClientId: "keep" })
    );
  });

  it("keeps the stored language when the wizard does not send one", async () => {
    mockReadAppState.mockResolvedValue({ managedConfig: { appUrl: "", channelTimezone: "", channelLanguage: "de" } });
    await put({ channelTimezone: "UTC" });
    expect(mockUpdateManagedConfigRecord).toHaveBeenCalledWith(expect.objectContaining({ channelLanguage: "de", channelTimezone: "UTC" }));
  });

  it("refuses a language this build does not speak instead of quietly airing English", async () => {
    const response = await put({ channelLanguage: "fr" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: '"fr" is not a channel language. Choose one of: en, de.' });
    expect(mockUpdateManagedConfigRecord).not.toHaveBeenCalled();
  });
});
