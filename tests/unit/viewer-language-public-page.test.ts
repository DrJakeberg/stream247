import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ViewerLocale } from "@stream247/core";
import type { PublicChannelSnapshot } from "../../apps/web/lib/live-broadcast";
import {
  buildPublicChannelDescription,
  buildPublicChannelHeader,
  buildPublicChannelView
} from "../../apps/web/lib/public-channel-view";
import { expectNoEnglish } from "./viewer-language-helpers";

/**
 * The public page /channel in the channel language (M80).
 *
 * Every word the page and its live component show comes from buildPublicChannelHeader and
 * buildPublicChannelView, so reading those two in both languages reads the page. English is pinned
 * byte for byte against what the page said before M80, apart from the deliberate fixes: the
 * zone's name instead of its IANA id, "Stand by" for the standby state, no "runtime" in the
 * empty-next line, and a status line instead of the playout's own message.
 */

const LABELS: Record<ViewerLocale, string> = { en: "Central European Time", de: "Mitteleuropäische Zeit" };

function snapshot(locale: ViewerLocale, overrides: Partial<PublicChannelSnapshot> = {}): PublicChannelSnapshot {
  return {
    generatedAt: "2026-10-01T18:00:00.000Z",
    timeZone: "Europe/Berlin",
    locale,
    timeZoneLabel: LABELS[locale],
    watchUrl: "https://www.twitch.tv/jimpanse247",
    overlay: {} as PublicChannelSnapshot["overlay"],
    engagement: {} as PublicChannelSnapshot["engagement"],
    activeScene: {} as PublicChannelSnapshot["activeScene"],
    playout: {
      status: "running",
      message: "Crash-loop protection is active.",
      currentTitle: "Replay standby",
      transitionState: "idle",
      overrideMode: "schedule"
    },
    currentAsset: null,
    nextAsset: null,
    queuedAssets: [],
    queueItems: [],
    currentScheduleItem: null,
    nextScheduleItem: null,
    laterScheduleItems: [],
    ...overrides
  };
}

function scheduleItem(title: string, startTime: string, endTime: string, categoryName: string) {
  return { id: title, key: title, title, startTime, endTime, categoryName, sourceName: "", reason: "" } as never;
}

function queueItem(title: string, kind = "asset") {
  return { id: title, kind, title, subtitle: "", position: 0, scenePreset: "", asset: null } as never;
}

const scheduled = (locale: ViewerLocale) =>
  snapshot(locale, {
    currentScheduleItem: scheduleItem("Retro Night", "20:00", "22:00", "Retro"),
    nextScheduleItem: scheduleItem("Late Show", "22:00", "23:30", "Just Chatting"),
    queueItems: [queueItem("Episode 1"), queueItem("Episode 2"), queueItem("Scheduled reconnect", "reconnect")]
  });

const empty = (locale: ViewerLocale) =>
  snapshot(locale, { watchUrl: "", playout: { ...snapshot(locale).playout, status: "reconnecting", currentTitle: "" } });

function allTexts(view: object): string[] {
  return Object.entries(view)
    .filter(([key]) => key !== "lang")
    .map(([, value]) => String(value))
    .filter(Boolean);
}

describe("the public page in English", () => {
  it("keeps the header's words and names the zone as a viewer would", () => {
    expect(buildPublicChannelHeader("en", "Central European Time")).toEqual({
      lang: "en",
      badge: "Schedule",
      heading: "What is live now, and what comes next.",
      // Was "All times are shown in Europe/Berlin." (the IANA id).
      timeZoneNote: "All times are shown in Central European Time.",
      lineupTitle: "Upcoming lineup",
      lineupEyebrow: "Schedule"
    });
    // The root layout's description is the product's tagline; this page's is for viewers.
    expect(buildPublicChannelDescription("en")).toBe("What is live now, and what comes next.");
  });

  it("shows a scheduled hour exactly as before", () => {
    expect(buildPublicChannelView(scheduled("en"), true)).toEqual({
      lang: "en",
      statusLabel: "On air",
      updateNotice: "",
      timeZoneLabel: "Central European Time",
      watchLabel: "Watch the stream",
      onAirHeading: "On air now",
      onAirTitle: "Retro Night",
      onAirDetail: "20:00 to 22:00 · Retro",
      nextHeading: "Up next",
      nextTitle: "Late Show",
      nextDetail: "22:00 to 23:30 · Just Chatting",
      afterHeading: "After that",
      // The worker's English queue title passes the built-in rule, like on the picture; in English
      // it reads as before (the German case below translates it).
      afterText: "Episode 1 → Episode 2 → Scheduled reconnect"
    });
  });

  it("lists what the schedule airs after up next when the queue is empty", () => {
    const idleQueue = (locale: ViewerLocale) =>
      snapshot(locale, {
        nextScheduleItem: scheduleItem("Nachtschleife", "00:00", "06:00", "Archiv"),
        laterScheduleItems: [
          scheduleItem("Tagesprogramm", "06:00", "20:00", "Archiv"),
          // No title: the category stands in, as on the rest of the page.
          scheduleItem("", "20:00", "00:00", "Abendprogramm")
        ]
      });
    // Was "Nothing further is scheduled yet." on a channel programmed around the clock.
    for (const locale of ["en", "de"] as const) {
      expect(buildPublicChannelView(idleQueue(locale), true).afterText).toBe(
        "06:00 Tagesprogramm → 20:00 Abendprogramm"
      );
    }
    // The queue still wins when there is one.
    expect(buildPublicChannelView({ ...idleQueue("en"), queueItems: [queueItem("Episode 1")] }, true).afterText).toBe(
      "Episode 1"
    );
  });

  it("uses the viewer's words where nothing is scheduled", () => {
    expect(buildPublicChannelView(empty("en"), false)).toMatchObject({
      statusLabel: "Starting up",
      updateNotice: "Updating every few seconds",
      // Was "Standby".
      onAirTitle: "Stand by",
      // Was the playout's own message, here "Crash-loop protection is active.".
      onAirDetail: "The stream is starting, back in a moment.",
      nextTitle: "No next item published yet",
      // Was "The next queue item will appear here as soon as the runtime confirms it."
      nextDetail: "The next item will appear here as soon as it is confirmed.",
      afterText: "Nothing further is scheduled yet."
    });
  });

  it("translates the worker's English state title and keeps operator titles as written", () => {
    // "Replay standby" is what the worker writes into playout state for the admin; viewers get the
    // one standby term. An asset or block title is operator content and is never touched.
    expect(buildPublicChannelView(snapshot("en"), true).onAirTitle).toBe("Stand by");
    const asset = { id: "a", title: "Replay standby (Director's Cut)" } as never;
    expect(buildPublicChannelView(snapshot("en", { currentAsset: asset }), true).onAirTitle).toBe("Replay standby (Director's Cut)");
  });
});

describe("the public page in German", () => {
  it("writes the header in German, with the zone's German name", () => {
    const header = buildPublicChannelHeader("de", "Mitteleuropäische Zeit");
    expect(header).toEqual({
      lang: "de",
      badge: "Programm",
      heading: "Was gerade läuft und was als Nächstes kommt.",
      timeZoneNote: "Alle Uhrzeiten: Mitteleuropäische Zeit.",
      lineupTitle: "Demnächst im Programm",
      lineupEyebrow: "Programm"
    });
    expect(buildPublicChannelDescription("de")).toBe("Was gerade läuft und was als Nächstes kommt.");
    expectNoEnglish(allTexts(header));
  });

  it("writes a scheduled hour in German and leaves operator content alone", () => {
    expect(buildPublicChannelView(scheduled("de"), true)).toEqual({
      lang: "de",
      statusLabel: "Auf Sendung",
      updateNotice: "",
      timeZoneLabel: "Mitteleuropäische Zeit",
      watchLabel: "Zum Stream",
      onAirHeading: "Jetzt auf Sendung",
      onAirTitle: "Retro Night",
      onAirDetail: "20:00 bis 22:00 · Retro",
      nextHeading: "Als Nächstes",
      nextTitle: "Late Show",
      nextDetail: "22:00 bis 23:30 · Just Chatting",
      afterHeading: "Danach",
      afterText: "Episode 1 → Episode 2 → Geplanter Neustart"
    });
  });

  it("has no English sentence anywhere, in every state the page can show", () => {
    const views = [
      buildPublicChannelView(scheduled("de"), true),
      buildPublicChannelView(scheduled("de"), false),
      buildPublicChannelView(empty("de"), false),
      buildPublicChannelView(snapshot("de"), true),
      buildPublicChannelView(snapshot("de", { playout: { ...snapshot("de").playout, status: "failed", currentTitle: "" } }), true)
    ];
    const texts = views.flatMap(allTexts).filter((text) => !["Retro Night", "Late Show", "Episode 1", "Episode 2"].some((title) => text.includes(title)));
    expectNoEnglish(texts);
    expect(views.map((view) => view.onAirDetail).slice(2)).toEqual([
      "Der Stream startet, gleich geht’s weiter.",
      "Läuft gerade.",
      "Der Kanal ist gerade nicht auf Sendung."
    ]);
    expect(buildPublicChannelView(empty("de"), false)).toMatchObject({
      statusLabel: "Startet gerade",
      updateNotice: "Aktualisiert sich alle paar Sekunden",
      onAirTitle: "Gleich geht’s weiter",
      nextTitle: "Noch nichts angekündigt",
      nextDetail: "Sobald feststeht, was als Nächstes läuft, steht es hier.",
      afterText: "Danach ist noch nichts geplant."
    });
  });

  it("never shows the playout's own message, in either language", () => {
    for (const locale of ["en", "de"] as const) {
      for (const state of [snapshot(locale), empty(locale), scheduled(locale)]) {
        expect(allTexts(buildPublicChannelView(state, false)).join("\n")).not.toContain("Crash-loop");
      }
    }
  });

  it("follows the snapshot's language, so a change reaches an open page with the next update", () => {
    const open = scheduled("en");
    expect(buildPublicChannelView(open, true).onAirHeading).toBe("On air now");
    expect(buildPublicChannelView({ ...open, locale: "de" }, true).onAirHeading).toBe("Jetzt auf Sendung");
  });
});

describe("the page draws only from the view", () => {
  const page = readFileSync(new URL("../../apps/web/app/channel/page.tsx", import.meta.url), "utf8");
  const live = readFileSync(new URL("../../apps/web/components/live-channel-page.tsx", import.meta.url), "utf8");

  it("carries the language on the content, not on the admin's <html>", () => {
    expect(page).toContain('<main className="standalone channel-public" lang={header.lang}>');
    expect(live).toContain('<div className="stack-form" lang={view.lang}>');
    expect(page).toContain("generateMetadata");
  });

  it("shows neither the operator's status text nor the raw zone id", () => {
    // The sentences themselves are guarded with every other viewer surface in
    // viewer-language-literals.test.ts; this is what the page used to print besides them.
    const before = ["snapshot.playout.message", "{snapshot.timeZone}", "{timeZone}", '"Standby"'];
    expect(before.filter((literal) => page.includes(literal) || live.includes(literal))).toEqual([]);
  });
});
