import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ViewerLocale } from "@stream247/core";
import type { PublicChannelSnapshot } from "../../apps/web/lib/live-broadcast";
import type { PublicProgramme } from "../../apps/web/lib/public-programme";
import {
  buildPublicChannelDescription,
  buildPublicChannelHeader,
  buildPublicChannelView,
  describeProgrammeProgress,
  formatProgrammeDayLabel,
  formatProgrammeRemaining
} from "../../apps/web/lib/public-channel-view";
import { expectNoEnglish } from "./viewer-language-helpers";

/**
 * The public page /channel in the channel language (M80), item by item since M100.
 *
 * Every word the page and its live component show comes from buildPublicChannelHeader and
 * buildPublicChannelView, so reading those two in both languages reads the page. M100 replaced the
 * three block cards (On air now, Up next, After that) with a Now card that has the item on air and its
 * progress, the next 24 hours grouped by programme, and the coming week; the M80 rules stay pinned: the
 * zone's name instead of its IANA id, "Stand by" for the standby state, a status line instead of the
 * playout's own message, and operator content as written.
 */

const LABELS: Record<ViewerLocale, string> = { en: "Central European Time", de: "Mitteleuropäische Zeit" };

// 20:30 in Berlin (summer time, UTC+2) on Monday 2026-10-05.
const NOW = "2026-10-05T18:30:00.000Z";

const at = (hhmm: string, date = "2026-10-05") => {
  const [hours, minutes] = hhmm.split(":").map(Number);
  // Berlin wall clock to UTC, summer time: two hours back.
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), (hours ?? 0) - 2, minutes ?? 0)).toISOString();
};

const programme: PublicProgramme = {
  now: { kind: "item", title: "Episode 7", categoryName: "Retro", startsAt: at("20:00"), endsAt: at("21:00") },
  next: [
    {
      key: "retro",
      title: "Retro Night",
      categoryName: "Retro",
      dated: false,
      startsAt: at("21:00"),
      endsAt: at("22:00"),
      items: [
        { title: "Episode 8", startsAt: at("21:00"), endsAt: at("22:00") },
        { title: "Episode 9", startsAt: at("22:00"), endsAt: at("23:00") }
      ],
      itemCount: 2
    },
    {
      key: "late",
      title: "Late Show",
      categoryName: "Just Chatting",
      dated: true,
      startsAt: at("23:00"),
      endsAt: at("01:00", "2026-10-06"),
      items: [],
      itemCount: 0
    }
  ],
  week: [
    { key: "w1", title: "Retro Night", categoryName: "Retro", dated: false, startsAt: at("20:00"), endsAt: at("23:00") },
    { key: "w2", title: "Late Show", categoryName: "Just Chatting", dated: true, startsAt: at("23:00"), endsAt: at("01:00", "2026-10-06") },
    { key: "w3", title: "Retro Night", categoryName: "Retro", dated: false, startsAt: at("20:00", "2026-10-07"), endsAt: at("23:00", "2026-10-07") }
  ]
};

function snapshot(locale: ViewerLocale, overrides: Partial<PublicChannelSnapshot> = {}): PublicChannelSnapshot {
  return {
    generatedAt: NOW,
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
    programme: { now: null, next: [], week: [] },
    ...overrides
  };
}

const scheduled = (locale: ViewerLocale) => snapshot(locale, { programme });

const empty = (locale: ViewerLocale) =>
  snapshot(locale, { watchUrl: "", playout: { ...snapshot(locale).playout, status: "reconnecting", currentTitle: "" } });

function allTexts(view: unknown): string[] {
  if (typeof view === "string") {
    return view ? [view] : [];
  }
  if (Array.isArray(view)) {
    return view.flatMap(allTexts);
  }
  if (view && typeof view === "object") {
    return Object.entries(view)
      .filter(([key]) => key !== "lang" && key !== "key")
      .flatMap(([, value]) => allTexts(value));
  }
  return [];
}

describe("the public page in English", () => {
  it("keeps the header's words", () => {
    expect(buildPublicChannelHeader("en")).toEqual({
      lang: "en",
      badge: "Schedule",
      heading: "What is live now, and what comes next.",
      lineupTitle: "Upcoming lineup",
      lineupEyebrow: "Schedule"
    });
    // The root layout's description is the product's tagline; this page's is for viewers.
    expect(buildPublicChannelDescription("en")).toBe("What is live now, and what comes next.");
  });

  it("shows the item on air, the next 24 hours grouped by programme, and the week", () => {
    expect(buildPublicChannelView(scheduled("en"), true)).toEqual({
      lang: "en",
      statusLabel: "On air",
      updateNotice: "",
      // Was in the hero; the zone's name, never its IANA id (M80).
      timeZoneNote: "All times are shown in Central European Time.",
      watchLabel: "Watch the stream",
      now: {
        heading: "On air now",
        title: "Episode 7",
        detail: "20:00 to 21:00 · Retro",
        channelTime: "",
        progressPercent: 50,
        remaining: "30:00 left"
      },
      nextHeading: "Up next",
      next: [
        {
          key: "retro",
          timeRange: "21:00 to 22:00",
          channelTime: "",
          title: "Episode 8",
          detail: "Retro Night · Retro",
          dated: "",
          moreLabel: "1 more video",
          more: [{ key: `retro:${at("22:00")}`, time: "22:00", title: "Episode 9" }]
        },
        {
          // A block with nothing to play is listed by its own times and title.
          key: "late",
          timeRange: "23:00 to 01:00",
          channelTime: "",
          title: "Late Show",
          detail: "Just Chatting",
          dated: "Special",
          moreLabel: "",
          more: []
        }
      ],
      nextEmptyTitle: "No next item published yet",
      nextEmptyBody: "The next item will appear here as soon as it is confirmed.",
      weekHeading: "The next 7 days",
      week: [
        {
          key: "2026-10-05",
          label: "Today",
          entries: [
            { key: "w1", timeRange: "20:00 to 23:00", channelTime: "", title: "Retro Night", detail: "Retro", dated: "" },
            { key: "w2", timeRange: "23:00 to 01:00", channelTime: "", title: "Late Show", detail: "Just Chatting", dated: "Special" }
          ]
        },
        {
          key: "2026-10-07",
          label: "Wed 7 Oct",
          entries: [{ key: "w3", timeRange: "20:00 to 23:00", channelTime: "", title: "Retro Night", detail: "Retro", dated: "" }]
        }
      ],
      weekEmpty: "Nothing is scheduled for the next 7 days.",
      calendarLabel: "Add the schedule to your calendar"
    });
  });

  it("uses the viewer's words where nothing is scheduled", () => {
    const view = buildPublicChannelView(empty("en"), false);
    expect(view).toMatchObject({
      statusLabel: "Starting up",
      updateNotice: "Updating every few seconds",
      next: [],
      week: [],
      nextEmptyTitle: "No next item published yet",
      // Was "The next queue item will appear here as soon as the runtime confirms it."
      nextEmptyBody: "The next item will appear here as soon as it is confirmed."
    });
    expect(view.now).toEqual({
      heading: "Scheduled now",
      // Was "Standby".
      title: "Stand by",
      // Was the playout's own message, here "Crash-loop protection is active.".
      detail: "The stream is starting, back in a moment.",
      channelTime: "",
      progressPercent: null,
      remaining: ""
    });
  });

  it("V2: says what is scheduled, not what is on air, while the playout is down", () => {
    const down = (locale: ViewerLocale) =>
      snapshot(locale, {
        playout: { ...snapshot(locale).playout, status: "failed" },
        programme: { ...programme, now: { kind: "block", title: "Retro Night", categoryName: "Retro", startsAt: at("20:00"), endsAt: at("23:00") } }
      });
    expect(buildPublicChannelView(down("en"), true)).toMatchObject({ statusLabel: "Off air", now: { heading: "Scheduled now", title: "Retro Night" } });
    expect(buildPublicChannelView(down("de"), true)).toMatchObject({
      statusLabel: "Gerade nicht auf Sendung",
      now: { heading: "Laut Programm jetzt", title: "Retro Night" }
    });
    // On air, the same block card is headed as before.
    expect(buildPublicChannelView({ ...down("en"), playout: snapshot("en").playout }, true).now.heading).toBe("On air now");
  });

  it("translates the worker's English state title and keeps operator titles as written", () => {
    // "Replay standby" is what the worker writes into playout state for the admin; viewers get the
    // one standby term. An item or block title is operator content and is never touched.
    const titled = (title: string) => snapshot("en", { programme: { ...programme, now: { ...programme.now!, title } } });
    expect(buildPublicChannelView(titled("Replay standby"), true).now.title).toBe("Stand by");
    expect(buildPublicChannelView(titled("Replay standby (Director's Cut)"), true).now.title).toBe("Replay standby (Director's Cut)");
    expect(buildPublicChannelView(snapshot("en"), true).now.title).toBe("Stand by");
  });
});

describe("M100: the Now card's progress for a fixed clock", () => {
  it("runs the bar and counts down what is left", () => {
    const start = "2026-10-05T18:00:00.000Z";
    const end = "2026-10-05T19:00:00.000Z";
    expect(describeProgrammeProgress(start, end, Date.parse("2026-10-05T18:45:00.000Z"))).toEqual({ percent: 75, remainingSeconds: 900 });
    expect(describeProgrammeProgress(start, end, Date.parse("2026-10-05T18:00:20.000Z"))).toEqual({ percent: 0.6, remainingSeconds: 3580 });
    // Before its start and after its end it stays on the bar's ends.
    expect(describeProgrammeProgress(start, end, Date.parse("2026-10-05T17:00:00.000Z"))).toEqual({ percent: 0, remainingSeconds: 3600 });
    expect(describeProgrammeProgress(start, end, Date.parse("2026-10-05T20:00:00.000Z"))).toEqual({ percent: 100, remainingSeconds: 0 });
    expect(describeProgrammeProgress(start, "", 0)).toBeNull();
    expect(formatProgrammeRemaining(900)).toBe("15:00");
    expect(formatProgrammeRemaining(59.2)).toBe("01:00");
    expect(formatProgrammeRemaining(3725)).toBe("1:02:05");
  });

  it("reads the browser's clock once hydrated, in both languages", () => {
    const tick = Date.parse("2026-10-05T18:45:00.000Z");
    expect(buildPublicChannelView(scheduled("en"), true, { nowMs: tick }).now).toMatchObject({ progressPercent: 75, remaining: "15:00 left" });
    expect(buildPublicChannelView(scheduled("de"), true, { nowMs: tick }).now).toMatchObject({ progressPercent: 75, remaining: "noch 15:00" });
  });
});

describe("M100 (R2 Q7): the viewer's time first, the channel's second", () => {
  it("writes every time in the browser's zone when it differs from the channel zone, and the channel time beside it", () => {
    const view = buildPublicChannelView(scheduled("en"), true, { viewerTimeZone: "America/New_York" });
    // 20:00 in Berlin is 14:00 in New York (both on summer time).
    expect(view.now.detail).toBe("14:00 to 15:00 · Retro");
    expect(view.now.channelTime).toBe("20:00 to 21:00 channel time");
    expect(view.next[0]).toMatchObject({ timeRange: "15:00 to 16:00", channelTime: "21:00 to 22:00 channel time" });
    expect(view.next[0]?.more[0]?.time).toBe("16:00");
    // The zone note names both; the viewer's zone name is the browser's own (not pinned: it is ICU's).
    expect(view.timeZoneNote).toMatch(/^Times are shown in your time zone, .+\. Channel time: Central European Time\.$/);
    // Days are the viewer's: Late Show at 23:00 Monday in Berlin is 17:00 Monday in New York, and Wednesday's
    // 20:00 is Wednesday's 14:00.
    expect(view.week.map((day) => [day.label, day.entries.map((entry) => entry.timeRange)])).toEqual([
      ["Today", ["14:00 to 17:00", "17:00 to 19:00"]],
      ["Wed 7 Oct", ["14:00 to 17:00"]]
    ]);
  });

  it("moves an entry to the viewer's day when the zones put it on different dates", () => {
    const late = snapshot("en", {
      programme: {
        now: null,
        next: [],
        week: [{ key: "night", title: "Night", categoryName: "Night", dated: false, startsAt: at("01:00", "2026-10-06"), endsAt: at("02:00", "2026-10-06") }]
      }
    });
    const inBerlin = buildPublicChannelView(late, true);
    const inLosAngeles = buildPublicChannelView(late, true, { viewerTimeZone: "America/Los_Angeles" });
    expect(inBerlin.week.map((day) => day.label)).toEqual(["Tomorrow"]);
    // 01:00 Tuesday in Berlin is 16:00 Monday in Los Angeles: today there.
    expect(inLosAngeles.week.map((day) => [day.label, day.entries[0]?.timeRange])).toEqual([["Today", "16:00 to 17:00"]]);
  });

  it("writes one time when the browser's zone keeps the channel's clock", () => {
    const view = buildPublicChannelView(scheduled("en"), true, { viewerTimeZone: "Europe/Paris" });
    expect(view.timeZoneNote).toBe("All times are shown in Central European Time.");
    expect(view.now.channelTime).toBe("");
    expect(view.next.every((group) => group.channelTime === "")).toBe(true);
  });

  it("labels days in the channel language without the runtime's names", () => {
    expect(formatProgrammeDayLabel("en", "2026-10-05", "2026-10-05")).toBe("Today");
    expect(formatProgrammeDayLabel("de", "2026-10-06", "2026-10-05")).toBe("Morgen");
    expect(formatProgrammeDayLabel("en", "2026-10-10", "2026-10-05")).toBe("Sat 10 Oct");
    expect(formatProgrammeDayLabel("de", "2026-10-10", "2026-10-05")).toBe("Sa, 10. Okt.");
  });
});

describe("the public page in German", () => {
  it("writes the header in German", () => {
    const header = buildPublicChannelHeader("de");
    expect(header).toEqual({
      lang: "de",
      badge: "Programm",
      heading: "Was gerade läuft und was als Nächstes kommt.",
      lineupTitle: "Demnächst im Programm",
      lineupEyebrow: "Programm"
    });
    expect(buildPublicChannelDescription("de")).toBe("Was gerade läuft und was als Nächstes kommt.");
    expectNoEnglish(allTexts(header));
  });

  it("writes the programme in German and leaves operator content alone", () => {
    const view = buildPublicChannelView(scheduled("de"), true);
    expect(view).toMatchObject({
      statusLabel: "Auf Sendung",
      timeZoneNote: "Alle Uhrzeiten: Mitteleuropäische Zeit.",
      watchLabel: "Zum Stream",
      now: { heading: "Jetzt auf Sendung", title: "Episode 7", detail: "20:00 bis 21:00 · Retro", remaining: "noch 30:00" },
      nextHeading: "Als Nächstes",
      weekHeading: "Die nächsten 7 Tage",
      calendarLabel: "Programm in den Kalender übernehmen"
    });
    expect(view.next.map((group) => [group.timeRange, group.title, group.moreLabel, group.dated])).toEqual([
      ["21:00 bis 22:00", "Episode 8", "1 weiteres Video", ""],
      ["23:00 bis 01:00", "Late Show", "", "Sondersendung"]
    ]);
    expect(view.week.map((day) => day.label)).toEqual(["Heute", "Mi, 7. Okt."]);
  });

  it("has no English sentence anywhere, in every state the page can show", () => {
    const views = [
      buildPublicChannelView(scheduled("de"), true),
      buildPublicChannelView(scheduled("de"), false),
      buildPublicChannelView(scheduled("de"), true, { viewerTimeZone: "America/New_York" }),
      buildPublicChannelView(empty("de"), false),
      buildPublicChannelView(snapshot("de"), true),
      buildPublicChannelView(snapshot("de", { playout: { ...snapshot("de").playout, status: "failed", currentTitle: "" } }), true)
    ];
    const operatorWords = ["Episode", "Retro", "Late Show", "Just Chatting"];
    // The viewer zone's name is the runtime's (ICU), not the catalogue's.
    const texts = views
      .flatMap(allTexts)
      .filter((text) => !operatorWords.some((word) => text.includes(word)))
      .filter((text) => !text.startsWith("Uhrzeiten in deiner Zeitzone"));
    expectNoEnglish(texts);
    expect(views.map((view) => view.now.detail).slice(3)).toEqual([
      "Der Stream startet, gleich geht’s weiter.",
      "Läuft gerade.",
      "Der Kanal ist gerade nicht auf Sendung."
    ]);
    expect(buildPublicChannelView(empty("de"), false)).toMatchObject({
      statusLabel: "Startet gerade",
      updateNotice: "Aktualisiert sich alle paar Sekunden",
      now: { title: "Gleich geht’s weiter" },
      nextEmptyTitle: "Noch nichts angekündigt",
      nextEmptyBody: "Sobald feststeht, was als Nächstes läuft, steht es hier.",
      weekEmpty: "Für die nächsten 7 Tage ist nichts geplant."
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
    expect(buildPublicChannelView(open, true).now.heading).toBe("On air now");
    expect(buildPublicChannelView({ ...open, locale: "de" }, true).now.heading).toBe("Jetzt auf Sendung");
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
