import { describe, expect, it } from "vitest";
import {
  buildLiveBridgeOverlayText,
  buildOverlaySceneLayout,
  buildOverlayScenePayload,
  buildOverlayTextLinesFromScenePayload,
  overlayNextTimeLabel,
  viewerText,
  type OverlayQueueKind
} from "@stream247/core";
import { expectNoEnglish, layoutTexts, storedDefaults } from "./viewer-language-helpers";

/**
 * Every viewer surface in both languages (M80), part one: the picture and the slates.
 *
 * Two things are checked for each. In German, no English sentence of the catalogue survives
 * anywhere in the output. In English, the output is what aired before M80, byte for byte — the
 * exact strings are pinned below — except for the wording M80 fixed on purpose: "No next block
 * configured" (an operator's word) became "Nothing scheduled", and the standby state has one name,
 * "Stand by", where it had four ("Standby", "Stand by", "Replay standby", "Please wait, restream
 * is starting").
 */

function payloadFor(queueKind: OverlayQueueKind, locale: string, overrides: Partial<Parameters<typeof buildOverlayScenePayload>[0]> = {}) {
  return buildOverlayScenePayload({
    overlay: storedDefaults(),
    queueKind,
    target: "on-air-text",
    currentTitle: "",
    nextTitle: "",
    nextTimeLabel: overlayNextTimeLabel(null, locale),
    timeZone: "Europe/Berlin",
    locale,
    ...overrides
  });
}

const QUEUE_KINDS: OverlayQueueKind[] = ["asset", "insert", "live", "reconnect", "standby"];

describe("the scene payload and the picture", () => {
  it("writes English exactly as before, apart from M80's deliberate fixes", () => {
    const labels = QUEUE_KINDS.map((kind) => {
      const payload = payloadFor(kind, "en");
      return [kind, payload.heroLabel, payload.nextLabel, payload.heroBody, payload.brandLine, payload.nextTimeLabel, payload.nextTitle];
    });
    expect(labels).toEqual([
      ["asset", "Now Playing", "Next", "Always on air", "Replay stream", "Nothing scheduled", "Schedule not available"],
      ["insert", "Insert On Air", "After Insert", "Insert on air", "Replay stream", "Nothing scheduled", "Schedule not available"],
      ["live", "Live Now", "After Live", "Always on air", "Replay stream", "Nothing scheduled", "Schedule not available"],
      ["reconnect", "Reconnect Window", "Returning With", "Scheduled reconnect in progress", "Replay stream", "Nothing scheduled", "Schedule not available"],
      // M80: "Standby" and "Please wait, restream is starting" became the one standby term.
      ["standby", "Stand by", "Next", "Stand by, we’ll be right back", "Replay stream", "Nothing scheduled", "Schedule not available"]
    ]);
    expect(payloadFor("asset", "en").heroTitle).toBe("Stream247");
    expect(payloadFor("asset", "en").locale).toBe("en");
  });

  it("writes German for every queue kind, stored defaults included", () => {
    const labels = QUEUE_KINDS.map((kind) => {
      const payload = payloadFor(kind, "de");
      return [kind, payload.heroLabel, payload.nextLabel, payload.heroBody, payload.brandLine, payload.nextTimeLabel, payload.nextTitle];
    });
    expect(labels).toEqual([
      ["asset", "Läuft gerade", "Als Nächstes", "Rund um die Uhr auf Sendung", "Wiederholung", "Noch nichts geplant", "Programm folgt"],
      ["insert", "Einspieler", "Danach", "Einspieler läuft", "Wiederholung", "Noch nichts geplant", "Programm folgt"],
      ["live", "Jetzt live", "Danach", "Rund um die Uhr auf Sendung", "Wiederholung", "Noch nichts geplant", "Programm folgt"],
      ["reconnect", "Kurze Unterbrechung", "Weiter mit", "Der Stream verbindet sich neu – gleich geht’s weiter", "Wiederholung", "Noch nichts geplant", "Programm folgt"],
      ["standby", "Gleich geht’s weiter", "Als Nächstes", "Kurze Pause – gleich geht’s weiter", "Wiederholung", "Noch nichts geplant", "Programm folgt"]
    ]);
    expect(payloadFor("asset", "de").locale).toBe("de");
  });

  it("never translates what the operator wrote", () => {
    const payload = buildOverlayScenePayload({
      overlay: { ...storedDefaults(), channelName: "3JC Retro", headline: "Immer Retro", replayLabel: "Aus dem Archiv" },
      queueKind: "asset",
      target: "on-air-text",
      currentTitle: "Always on air at night",
      nextTitle: "Retro Night",
      queueTitles: ["Late night standby"],
      locale: "de"
    });
    expect([payload.channelName, payload.heroBody, payload.brandLine, payload.heroTitle, payload.nextTitle, payload.queueTitles]).toEqual([
      "3JC Retro",
      "Immer Retro",
      "Aus dem Archiv",
      "Always on air at night",
      "Retro Night",
      ["Late night standby"]
    ]);
  });

  it("treats a title, category or source equal to a built-in English text as the product's own", () => {
    // The documented edge of the equality rule (docs/operations.md, "Channel Language"): state does
    // not say who wrote a title, so an operator's "Stand by" is drawn like the worker's.
    const collided = payloadFor("asset", "de", {
      currentTitle: "Stand by",
      currentCategory: "Live input",
      currentSourceName: "Live Bridge",
      nextTitle: "Always on air",
      queueTitles: ["Stream247", "Insert on air"]
    });
    expect([collided.heroTitle, collided.metaLine, collided.nextTitle, collided.queueTitles]).toEqual([
      "Gleich geht’s weiter",
      "Live-Übertragung · Live-Schaltung",
      "Rund um die Uhr auf Sendung",
      ["Stream247", "Einspieler läuft"]
    ]);
    // In English the only visible effect is M80's one standby term.
    expect(payloadFor("asset", "en", { currentTitle: "Replay standby" }).heroTitle).toBe("Stand by");
    // Equality is exact: one character more and the text is the operator's again.
    expect(payloadFor("asset", "de", { currentTitle: "Stand by!", currentCategory: "Live inputs" })).toMatchObject({
      heroTitle: "Stand by!",
      metaLine: "Live inputs"
    });
  });

  it("names the local library in the channel language, and any other source as the operator named it", () => {
    // The worker writes "Local Media Library" into the sources table on every scan, for the admin.
    const withSource = (locale: string, currentSourceName: string) =>
      buildOverlayScenePayload({
        overlay: storedDefaults("lower-third"),
        queueKind: "asset",
        target: "on-air-text",
        currentTitle: "Urlaub 2019",
        currentCategory: "Musik",
        currentSourceName,
        nextTitle: "",
        locale
      });
    expect(withSource("en", "Local Media Library").metaLine).toBe("Musik · Local Media Library");
    const german = withSource("de", "Local Media Library");
    expect(german.metaLine).toBe("Musik · Lokale Mediathek");
    expect(buildOverlayTextLinesFromScenePayload(german)).toEqual([
      "Wiederholung",
      "Jetzt: Urlaub 2019",
      "Musik · Lokale Mediathek",
      "Als Nächstes: Programm folgt"
    ]);
    expectNoEnglish(buildOverlayTextLinesFromScenePayload(german));
    expect(withSource("de", "Retro Library Berlin").metaLine).toBe("Musik · Retro Library Berlin");
  });

  it("falls back to the catalogue's brand line when the replay label is empty", () => {
    const cleared = (locale: string) => payloadFor("asset", locale, { overlay: { ...storedDefaults(), replayLabel: "" } }).brandLine;
    expect([cleared("en"), cleared("de")]).toEqual(["Replay stream", "Wiederholung"]);
  });

  it("writes the worker's and the studio preview's stand-in texts in both languages", () => {
    // An untitled remote asset, the next title when nothing is scheduled, the preview's unknown source.
    const standIns = (locale: string) => [
      viewerText(locale, "overlay.title.untitledAsset", { source: "Retro-Archiv" }),
      viewerText(locale, "overlay.next.comingUp"),
      viewerText(locale, "overlay.meta.sourceUnknown")
    ];
    expect(standIns("en")).toEqual(["Retro-Archiv item", "Coming up next", "Source to be announced"]);
    expect(standIns("de")).toEqual(["Video aus Retro-Archiv", "Gleich im Anschluss", "Quelle folgt"]);
    expectNoEnglish(standIns("de"));
  });

  it("names a standby, a reconnect and an unnamed live bridge in the channel language", () => {
    // The worker writes these into state in English for the admin and the as-run log.
    const standby = payloadFor("standby", "de", { currentTitle: "Replay standby", queueTitles: ["Scheduled reconnect"] });
    expect([standby.heroTitle, standby.queueTitles]).toEqual(["Gleich geht’s weiter", ["Geplanter Neustart"]]);
    expect(payloadFor("standby", "en", { currentTitle: "Replay standby" }).heroTitle).toBe("Stand by");
    expect(payloadFor("reconnect", "en", { currentTitle: "Scheduled reconnect" }).heroTitle).toBe("Scheduled reconnect");
  });
});

describe("the layout's own words", () => {
  const NOW = new Date("2026-02-01T21:30:00.000Z");
  const engagement = {
    kind: "vote-next" as const,
    headline: "",
    options: [{ token: "!1", title: "Retro Night", votes: 1234 }],
    totalVotes: 1234,
    secondsRemaining: 40,
    threshold: 0,
    hint: ""
  };

  function drawn(locale: string, overrides: Record<string, unknown> = {}) {
    const payload = {
      ...payloadFor("asset", locale, {
        currentTitle: "Retro Night",
        nextTitle: "Late Show",
        nextTimeLabel: overlayNextTimeLabel({ startTime: "20:00", endTime: "22:00" }, locale)
      }),
      ...overrides
    };
    // The poll takes the rail the next card sits on, so each is drawn once on its own.
    return [
      ...layoutTexts(buildOverlaySceneLayout({ payload }, { width: 1920, height: 1080, now: NOW })),
      ...layoutTexts(buildOverlaySceneLayout({ payload, engagement }, { width: 1920, height: 1080, now: NOW }))
    ];
  }

  it("draws English as before", () => {
    const texts = drawn("en");
    expect(texts).toEqual(expect.arrayContaining(["NOW PLAYING", "NEXT · 20:00-22:00", "22:30", "40s", "1234"]));
    // A payload cached before the next label existed still reads "Up next".
    expect(drawn("en", { nextLabel: "" })).toContain("UP NEXT · 20:00-22:00");
  });

  it("draws German, capitals by German rules, the clock on the same dial", () => {
    const texts = drawn("de");
    expect(texts).toEqual(expect.arrayContaining(["LÄUFT GERADE", "ALS NÄCHSTES · 20:00–22:00", "22:30", "40s", "1234"]));
    expect(drawn("de", { nextLabel: "" })).toContain("ALS NÄCHSTES · 20:00–22:00");
    expectNoEnglish(texts);
  });

  it("treats a payload cached before M80, without a language, as English", () => {
    const { locale: _dropped, ...legacy } = payloadFor("asset", "en", { nextTimeLabel: "21:30" });
    const texts = layoutTexts(buildOverlaySceneLayout({ payload: { ...legacy, nextLabel: "" } }, { width: 1920, height: 1080, now: NOW }));
    expect(texts).toEqual(expect.arrayContaining(["NOW PLAYING", "22:30"]));
  });
});

describe("text mode and the standby slate", () => {
  const PRESETS = ["minimal-chip", "bumper-board", "reconnect-board", "split-now-next", "standby-board", "lower-third"] as const;

  function lines(locale: string, preset: (typeof PRESETS)[number], queueKind: OverlayQueueKind = "asset") {
    return buildOverlayTextLinesFromScenePayload(
      buildOverlayScenePayload({
        overlay: storedDefaults(preset),
        queueKind,
        target: "on-air-text",
        currentTitle: "Retro Night",
        nextTitle: "Late Show",
        queueTitles: ["Late Show", "Night Owl"],
        locale
      })
    );
  }

  it("keeps the English prefixes byte for byte", () => {
    expect(PRESETS.map((preset) => lines("en", preset))).toEqual([
      ["Replay stream", "Now: Retro Night"],
      ["Replay stream", "Always on air", "Insert: Retro Night", "Next: Late Show", "After this: Late Show · Night Owl"],
      ["Replay stream", "Always on air", "Resuming with: Late Show", "Queue: Late Show · Night Owl"],
      ["Replay stream", "Now: Retro Night", "Next: Late Show"],
      ["Replay stream", "Always on air", "Current: Retro Night", "Next: Late Show", "Later: Late Show · Night Owl"],
      ["Replay stream", "Now: Retro Night", "Next: Late Show", "Queue: Late Show · Night Owl"]
    ]);
  });

  it("writes every prefix in German", () => {
    const german = PRESETS.map((preset) => lines("de", preset));
    expect(german).toEqual([
      ["Wiederholung", "Jetzt: Retro Night"],
      ["Wiederholung", "Rund um die Uhr auf Sendung", "Einspieler: Retro Night", "Als Nächstes: Late Show", "Danach: Late Show · Night Owl"],
      ["Wiederholung", "Rund um die Uhr auf Sendung", "Weiter mit: Late Show", "Demnächst: Late Show · Night Owl"],
      ["Wiederholung", "Jetzt: Retro Night", "Als Nächstes: Late Show"],
      ["Wiederholung", "Rund um die Uhr auf Sendung", "Gerade: Retro Night", "Als Nächstes: Late Show", "Später: Late Show · Night Owl"],
      ["Wiederholung", "Jetzt: Retro Night", "Als Nächstes: Late Show", "Demnächst: Late Show · Night Owl"]
    ]);
    expectNoEnglish(german.flat());
  });

  it("writes the standby slate the way the worker builds it, in both languages", () => {
    // writeStandbySlate with no schedule: the standby title and the "resumes shortly" line.
    function slate(locale: string) {
      return buildOverlayTextLinesFromScenePayload(
        buildOverlayScenePayload({
          overlay: storedDefaults(),
          queueKind: "standby",
          target: "on-air-text",
          currentTitle: viewerText(locale, "overlay.title.standby"),
          nextTitle: viewerText(locale, "overlay.next.resumesShortly"),
          nextTimeLabel: overlayNextTimeLabel(null, locale),
          locale
        })
      );
    }
    expect(slate("en")).toEqual(["Replay stream", "Stand by, we’ll be right back", "Current: Stand by", "Next: Programming will resume shortly"]);
    expect(slate("de")).toEqual([
      "Wiederholung",
      "Kurze Pause – gleich geht’s weiter",
      "Gerade: Gleich geht’s weiter",
      "Als Nächstes: Das Programm geht gleich weiter"
    ]);
    expectNoEnglish(slate("de"));
  });

  it("writes a live bridge the way it always read in English, and in German", () => {
    const english = buildLiveBridgeOverlayText({ locale: "en", title: "", inputType: "rtmp", nextTitle: "" });
    expect(english).toEqual({
      currentTitle: "Live Bridge",
      currentCategory: "Live input",
      currentSourceName: "Live Bridge · RTMP",
      nextTitle: "Schedule resumes after live mode"
    });
    const german = buildLiveBridgeOverlayText({ locale: "de", title: "", inputType: "hls", nextTitle: "" });
    expect(german).toEqual({
      currentTitle: "Live-Schaltung",
      currentCategory: "Live-Übertragung",
      currentSourceName: "Live-Schaltung · HLS",
      nextTitle: "Danach geht’s im Programm weiter"
    });
    expectNoEnglish(Object.values(german));
    // The operator's own label is the title, in every language.
    expect(buildLiveBridgeOverlayText({ locale: "de", title: "Studio B", inputType: "rtmp", nextTitle: "Late Show" })).toMatchObject({
      currentTitle: "Studio B",
      nextTitle: "Late Show"
    });
  });
});
