import { describe, expect, it } from "vitest";
import {
  DE_VIEWER_MESSAGES,
  EN_VIEWER_MESSAGES,
  VIEWER_LOCALES,
  VIEWER_MESSAGES,
  builtInViewerTextKey,
  formatOverlayClock,
  formatViewerClock,
  formatViewerNumber,
  formatViewerTimeZoneName,
  localizeViewerBuiltInText,
  normalizeViewerLocale,
  viewerMessagePlaceholders,
  viewerText,
  viewerUpperCase,
  type ViewerMessageKey
} from "@stream247/core";

/**
 * The viewer catalogue (M80): one place for every word the channel says to its audience.
 *
 * Adding a language means adding a catalogue file and one line in viewer-messages/index.ts; these
 * tests are what makes a half-translated language fail before it airs.
 */

const KEYS = Object.keys(EN_VIEWER_MESSAGES).sort() as ViewerMessageKey[];

describe("catalogue parity", () => {
  it("every language defines exactly the English keys", () => {
    for (const locale of VIEWER_LOCALES) {
      expect({ locale, keys: Object.keys(VIEWER_MESSAGES[locale]).sort() }).toEqual({ locale, keys: KEYS });
    }
  });

  it("every message uses the same placeholders in every language and every plural form", () => {
    for (const locale of VIEWER_LOCALES) {
      for (const key of KEYS) {
        const message = VIEWER_MESSAGES[locale][key];
        const english = viewerMessagePlaceholders(EN_VIEWER_MESSAGES[key]);
        expect({ locale, key, placeholders: viewerMessagePlaceholders(message) }).toEqual({ locale, key, placeholders: english });
        if (typeof message !== "string") {
          // A plural message is chosen by `count`, so it has to be one of its placeholders, and
          // each form must carry all of them — a form that drops one loses the number on air.
          expect({ locale, key, usesCount: english.includes("count") }).toEqual({ locale, key, usesCount: true });
          for (const form of Object.values(message)) {
            expect({ locale, key, form: viewerMessagePlaceholders(form) }).toEqual({ locale, key, form: english });
          }
        }
      }
    }
  });

  it("no German message is the English one left untranslated, except names that are names", () => {
    const sameByDesign = new Set<ViewerMessageKey>([
      "overlay.brand.channelName",
      "overlay.countdown",
      "game.name.snake",
      "game.name.minesweeper",
      "game.name.2048"
    ]);
    const untranslated = KEYS.filter((key) => !sameByDesign.has(key) && JSON.stringify(DE_VIEWER_MESSAGES[key]) === JSON.stringify(EN_VIEWER_MESSAGES[key]));
    expect(untranslated).toEqual([]);
  });
});

describe("formatting", () => {
  it("fills placeholders and prints numbers the way viewers read them, without grouping", () => {
    expect(viewerText("en", "game.status.progress", { cleared: 12345, total: 20000 })).toBe("Cleared 12345 of 20000");
    expect(viewerText("de", "game.status.progress", { cleared: 12345, total: 20000 })).toBe("12345/20000 geschafft");
    expect(formatViewerNumber("de", 1234567)).toBe("1234567");
    expect(formatViewerNumber("en", -5)).toBe("-5");
  });

  it("chooses plural forms with Intl.PluralRules — one vote is a Stimme, not Stimmen", () => {
    expect(viewerText("de", "skip.progress", { votes: 1, count: 1 })).toBe("1 von 1 Stimme");
    expect(viewerText("de", "skip.progress", { votes: 1, count: 3 })).toBe("1 von 3 Stimmen");
    expect(viewerText("en", "skip.progress", { votes: 1, count: 1 })).toBe("1 of 1 vote");
    expect(viewerText("en", "skip.progress", { votes: 2, count: 5 })).toBe("2 of 5 votes");
    expect(viewerText("de", "game.status.score", { count: 1 })).toBe("1 Punkt");
    expect(viewerText("de", "game.status.score", { count: 0 })).toBe("0 Punkte");
  });

  it("prints nothing for a missing placeholder rather than its name", () => {
    expect(viewerText("en", "textMode.now", {})).toBe("Now: ");
  });

  it("reads the clock as HH:MM on a 24-hour dial in both languages", () => {
    const evening = new Date("2026-02-01T21:30:00.000Z");
    const afterMidnight = new Date("2026-02-01T23:05:00.000Z");
    for (const locale of ["en", "de"]) {
      expect(formatViewerClock(locale, evening, "Europe/Berlin")).toBe("22:30");
      // h23, not h24: one minute past midnight is 00:05, never 24:05.
      expect(formatViewerClock(locale, afterMidnight, "Europe/Berlin")).toBe("00:05");
      expect(formatViewerClock(locale, evening, "UTC")).toBe("21:30");
    }
    // The layout's own entry point, unchanged for callers that do not pass a language.
    expect(formatOverlayClock(evening, "Europe/Berlin")).toBe("22:30");
    // An unusable zone falls back to the host zone instead of taking the overlay down.
    expect(formatOverlayClock(evening, "Mars/Olympus_Mons", "de")).toMatch(/^\d\d:\d\d$/);
  });

  it("upper-cases by the language's rules", () => {
    expect(viewerUpperCase("de", "Gleich geht’s weiter · Straße")).toBe("GLEICH GEHT’S WEITER · STRASSE");
    expect(viewerUpperCase("en", "Up next · 21:30")).toBe("UP NEXT · 21:30");
  });

  it("names a time zone as a viewer would, in the channel language", () => {
    // The public page printed the IANA id ("Europe/Berlin"). The generic name does not flip with
    // daylight saving; where a language has none Intl prints an offset, so the specific name is
    // used ("Coordinated Universal Time" rather than "GMT+00:00").
    const summer = new Date("2026-07-01T12:00:00.000Z");
    expect(formatViewerTimeZoneName("en", "Europe/Berlin", summer)).toBe("Central European Time");
    expect(formatViewerTimeZoneName("de", "Europe/Berlin", summer)).toBe("Mitteleuropäische Zeit");
    expect(formatViewerTimeZoneName("en", "UTC", summer)).toBe("Coordinated Universal Time");
    expect(formatViewerTimeZoneName("de", "UTC", summer)).toBe("Koordinierte Weltzeit");
    // No name in either form: the offset is still better than nothing.
    expect(formatViewerTimeZoneName("de", "Etc/GMT+5", summer)).toBe("GMT-05:00");
  });
});

describe("never throws on air", () => {
  it("treats every unknown language as English", () => {
    for (const value of ["", "fr", "DE ", "En", null, undefined, 42, {}]) {
      const expected = String(value ?? "").trim().toLowerCase() === "de" ? "de" : "en";
      expect(normalizeViewerLocale(value)).toBe(expected);
    }
    expect(viewerText("fr", "vote.headline")).toBe("What plays next?");
  });

  it("shows a zone Intl rejects as configured instead of failing the public page", () => {
    expect(formatViewerTimeZoneName("de", "Mars/Olympus_Mons")).toBe("Mars/Olympus_Mons");
    expect(formatViewerTimeZoneName("en", "")).toBe("");
    expect(formatViewerTimeZoneName("xx", "Europe/Berlin")).toBe("Central European Time");
  });

  it("answers an unknown key with an empty string", () => {
    expect(viewerText("de", "no.such.key" as ViewerMessageKey)).toBe("");
    // hasOwn, so an inherited property is not a message.
    expect(viewerText("en", "constructor" as ViewerMessageKey)).toBe("");
  });
});

describe("stored English defaults count as not customised", () => {
  it("renders a built-in English default from the catalogue in the channel language", () => {
    expect(localizeViewerBuiltInText("de", "Always on air")).toBe("Rund um die Uhr auf Sendung");
    expect(localizeViewerBuiltInText("de", "Please wait, restream is starting")).toBe("Kurze Pause – gleich geht’s weiter");
    expect(localizeViewerBuiltInText("de", "Replay stream")).toBe("Wiederholung");
    expect(localizeViewerBuiltInText("de", " Insert on air ")).toBe("Einspieler läuft");
    expect(localizeViewerBuiltInText("de", "Scheduled reconnect in progress")).toBe(
      "Der Stream verbindet sich neu – gleich geht’s weiter"
    );
  });

  it("maps the titles the worker writes into state for the admin", () => {
    expect(localizeViewerBuiltInText("de", "Replay standby")).toBe("Gleich geht’s weiter");
    expect(localizeViewerBuiltInText("de", "Scheduled reconnect")).toBe("Geplanter Neustart");
    expect(localizeViewerBuiltInText("de", "Live Bridge")).toBe("Live-Schaltung");
    // The local library's source name, which the worker rewrites on every scan.
    expect(builtInViewerTextKey("Local Media Library")).toBe("source.localLibrary");
    expect(localizeViewerBuiltInText("de", "Local Media Library")).toBe("Lokale Mediathek");
    expect(localizeViewerBuiltInText("en", "Local Media Library")).toBe("Local Media Library");
    // M80's one English standby term replaces the old ones on air.
    expect(localizeViewerBuiltInText("en", "Replay standby")).toBe("Stand by");
    expect(localizeViewerBuiltInText("en", "Please wait, restream is starting")).toBe("Stand by, we’ll be right back");
  });

  it("leaves everything an operator wrote exactly as written, in every language", () => {
    for (const value of ["Retro Night", "always on air", "Always on air!", "Bitte warten", ""]) {
      expect(localizeViewerBuiltInText("de", value)).toBe(value);
      expect(builtInViewerTextKey(value)).toBeNull();
    }
  });

  it("recognises a value saved after M80 in today's English as well", () => {
    expect(builtInViewerTextKey("Stand by, we’ll be right back")).toBe("overlay.headline.standby");
    expect(localizeViewerBuiltInText("de", "Stand by, we’ll be right back")).toBe("Kurze Pause – gleich geht’s weiter");
  });
});
