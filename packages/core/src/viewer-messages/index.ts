import { DE_VIEWER_MESSAGES } from "./de.js";
import { EN_VIEWER_MESSAGES } from "./en.js";
import {
  VIEWER_LOCALES,
  type ViewerLocale,
  type ViewerMessage,
  type ViewerMessageCatalogue,
  type ViewerMessageKey,
  type ViewerMessageParams
} from "./types.js";

export { DE_VIEWER_MESSAGES, EN_VIEWER_MESSAGES, VIEWER_LOCALES };
export type { ViewerLocale, ViewerMessage, ViewerMessageCatalogue, ViewerMessageKey, ViewerMessageParams };

/**
 * The viewer-language catalogue (M80): what the channel says to its audience, in the channel's
 * language.
 *
 * Every lookup is total. An unknown locale is English, a key missing from a language falls back to
 * English, and a key unknown to every language is an empty string — this runs inside the renderer
 * and the chat bot, where an exception means a frozen picture or a silent bot, and an empty line is
 * the smaller fault.
 */
export const VIEWER_MESSAGES: Readonly<Record<ViewerLocale, ViewerMessageCatalogue>> = {
  en: EN_VIEWER_MESSAGES,
  de: DE_VIEWER_MESSAGES
};

/** New installs speak English; owner decision 2026-10-01. */
export const DEFAULT_VIEWER_LOCALE: ViewerLocale = "en";

/** Names for the admin's language picker. The admin is English (M81), so the labels are too. */
export const VIEWER_LOCALE_LABELS: Readonly<Record<ViewerLocale, string>> = {
  en: "English",
  de: "German (Deutsch)"
};

/**
 * The BCP 47 tag each language formats with. English is en-GB because that is the locale the
 * on-air clock has always been formatted in, so moving it onto the catalogue changed no frame.
 */
const INTL_TAGS: Readonly<Record<ViewerLocale, string>> = { en: "en-GB", de: "de-DE" };

/** "de" stays "de"; anything else — empty, unknown, a typo, not a string — is English. */
export function normalizeViewerLocale(value: unknown): ViewerLocale {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (VIEWER_LOCALES as readonly string[]).includes(normalized) ? (normalized as ViewerLocale) : DEFAULT_VIEWER_LOCALE;
}

export function viewerIntlTag(locale: unknown): string {
  return INTL_TAGS[normalizeViewerLocale(locale)];
}

// Formatters are cached per language (and per zone for the clock): the renderer formats on every
// frame, and constructing an Intl formatter is far more expensive than using one.
const pluralRulesCache = new Map<string, Intl.PluralRules>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();
const clockFormatCache = new Map<string, Intl.DateTimeFormat>();

function pluralRules(tag: string): Intl.PluralRules {
  let rules = pluralRulesCache.get(tag);
  if (!rules) {
    rules = new Intl.PluralRules(tag);
    pluralRulesCache.set(tag, rules);
  }
  return rules;
}

/** A number as viewers read it: no grouping, which is what String(n) printed before M80. */
export function formatViewerNumber(locale: unknown, value: number): string {
  const tag = viewerIntlTag(locale);
  let format = numberFormatCache.get(tag);
  if (!format) {
    format = new Intl.NumberFormat(tag, { useGrouping: false, maximumFractionDigits: 3 });
    numberFormatCache.set(tag, format);
  }
  return format.format(value);
}

/**
 * The on-air clock, "HH:MM" on a 24-hour dial in both languages.
 *
 * hourCycle h23 rather than hour12:false: the latter lets some runtimes pick h24 and print "24:05"
 * after midnight. An invalid zone must not take the overlay down, so it falls back to the host
 * zone, exactly as formatOverlayClock always did.
 */
export function formatViewerClock(locale: unknown, now: Date, timeZone: string): string {
  const tag = viewerIntlTag(locale);
  const cacheKey = `${tag}|${timeZone}`;
  let format = clockFormatCache.get(cacheKey);
  if (!format) {
    const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
    try {
      format = new Intl.DateTimeFormat(tag, { ...options, timeZone: timeZone || undefined });
    } catch {
      format = new Intl.DateTimeFormat(tag, options);
    }
    clockFormatCache.set(cacheKey, format);
  }
  return format.format(now);
}

const timeZoneNameCache = new Map<string, Intl.DateTimeFormat[]>();

function zoneNameFrom(format: Intl.DateTimeFormat, now: Date): string {
  return format.formatToParts(now).find((part) => part.type === "timeZoneName")?.value ?? "";
}

/**
 * A time zone as a viewer names it, in the channel language: "Central European Time" /
 * "Mitteleuropäische Zeit" for Europe/Berlin, where the public page printed the IANA id before M80.
 *
 * The generic name first, because it does not flip twice a year the way "Summer Time" does and a
 * schedule spans the change. Where the language has no generic name Intl prints an offset
 * ("GMT+00:00" for UTC) or, from ICU 77 on, a bare "GMT", so the specific name is tried next
 * ("Coordinated Universal Time"); an offset is kept only when neither has a name. A zone Intl rejects is shown as it was configured,
 * never an exception on the public page.
 */
export function formatViewerTimeZoneName(locale: unknown, timeZone: string, now: Date = new Date()): string {
  const zone = timeZone.trim();
  if (!zone) {
    return "";
  }
  const tag = viewerIntlTag(locale);
  const cacheKey = `${tag}|${zone}`;
  let formats = timeZoneNameCache.get(cacheKey);
  if (!formats) {
    try {
      formats = (["longGeneric", "long"] as const).map(
        (timeZoneName) => new Intl.DateTimeFormat(tag, { timeZone: zone, timeZoneName })
      );
    } catch {
      return zone;
    }
    timeZoneNameCache.set(cacheKey, formats);
  }
  const names = formats.map((format) => zoneNameFrom(format, now)).filter(Boolean);
  return names.find((name) => !/^(GMT|UTC)([+\-−]|$)/.test(name)) ?? names[0] ?? zone;
}

/** Upper-casing by the language's own rules, for the panel headings drawn in capitals. */
export function viewerUpperCase(locale: unknown, value: string): string {
  return value.toLocaleUpperCase(viewerIntlTag(locale));
}

function lookup(locale: ViewerLocale, key: string): ViewerMessage | undefined {
  const catalogue = VIEWER_MESSAGES[locale] as Readonly<Record<string, ViewerMessage>>;
  // hasOwn, so "constructor" or "toString" is an unknown key rather than a function.
  return Object.prototype.hasOwnProperty.call(catalogue, key) ? catalogue[key] : undefined;
}

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/**
 * One viewer-facing text in the channel language.
 *
 * Numbers in `params` are formatted for the language; a plural message picks its form from
 * `params.count`. A placeholder without a value prints nothing rather than its own name, because
 * "{title}" on air reads as a fault and an empty slot does not.
 */
export function viewerText(locale: unknown, key: ViewerMessageKey, params: ViewerMessageParams = {}): string {
  const resolved = normalizeViewerLocale(locale);
  const message = lookup(resolved, key) ?? lookup(DEFAULT_VIEWER_LOCALE, key);
  if (message === undefined) {
    return "";
  }

  let template: string;
  if (typeof message === "string") {
    template = message;
  } else {
    const count = Number(params.count);
    const category = Number.isFinite(count) ? pluralRules(INTL_TAGS[resolved]).select(count) : "other";
    template = message[category] ?? message.other;
  }

  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = params[name];
    if (typeof value === "number") {
      return formatViewerNumber(resolved, value);
    }
    return value === null || value === undefined ? "" : String(value);
  });
}

/** The `{name}` placeholders a message uses, across all its plural forms. For the parity test. */
export function viewerMessagePlaceholders(message: ViewerMessage): string[] {
  const forms = typeof message === "string" ? [message] : Object.values(message).filter((form): form is string => typeof form === "string");
  const names = new Set<string>();
  for (const form of forms) {
    for (const match of form.matchAll(PLACEHOLDER)) {
      names.add(match[1]!);
    }
  }
  return [...names].sort();
}

/**
 * English texts the product itself wrote, mapped to the catalogue entry that says the same thing.
 *
 * Two kinds. Stored defaults: an install keeps "Always on air" and its siblings in its overlay
 * settings because that is what the column defaults and the studio wrote, and M80 does not migrate
 * stored values. And names the worker writes into state in English, because the admin and the
 * as-run log read them there: the titles of a standby, a reconnect and an unnamed live bridge
 * ("Replay standby", "Scheduled reconnect", "Live Bridge"), and the local library's source name,
 * rewritten on every scan so an operator cannot rename it ("Local Media Library"). All of them
 * reach viewers verbatim unless something translates them on the way out.
 *
 * The left column is what was written before M80; the current English of each key joins it below,
 * so a value saved after M80 is recognised too.
 */
const BUILT_IN_ENGLISH_TEXTS: ReadonlyArray<readonly [string, ViewerMessageKey]> = [
  ["Stream247", "overlay.brand.channelName"],
  ["Replay stream", "overlay.brand.replayLabel"],
  ["Always on air", "overlay.headline.asset"],
  ["Insert on air", "overlay.headline.insert"],
  ["Scheduled reconnect in progress", "overlay.headline.reconnect"],
  ["Please wait, restream is starting", "overlay.headline.standby"],
  ["Replay standby", "overlay.title.standby"],
  ["Stand by", "overlay.title.standby"],
  ["Scheduled reconnect", "overlay.title.reconnect"],
  ["Live Bridge", "liveBridge.label"],
  ["Live input", "liveBridge.category"],
  ["Local Media Library", "source.localLibrary"]
];

const BUILT_IN_TEXT_KEYS: ReadonlyMap<string, ViewerMessageKey> = new Map([
  ...BUILT_IN_ENGLISH_TEXTS,
  ...BUILT_IN_ENGLISH_TEXTS.map(([, key]) => [EN_VIEWER_MESSAGES[key] as string, key] as const)
]);

/** The catalogue key a built-in English text stands for, or null for anything an operator wrote. */
export function builtInViewerTextKey(value: unknown): ViewerMessageKey | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? (BUILT_IN_TEXT_KEYS.get(normalized) ?? null) : null;
}

/**
 * A text on its way to viewers: built-in English is rendered from the catalogue in the channel
 * language, anything else verbatim.
 *
 * The rule is equality, not intent: a stored value equal to its built-in English default counts as
 * "not customised", because nothing distinguishes an operator who kept the default from one who
 * never opened the form. Anything else the operator wrote is theirs, and operator content is never
 * translated.
 *
 * Equality cuts the other way too, and that is documented rather than avoided: an asset, a block,
 * a category or a source the operator named exactly like one of the texts above ("Stand by",
 * "Live input") is drawn from the catalogue as well. Playout and queue state carry the worker's own
 * titles in the same fields as the operator's, with nothing saying who wrote them, so telling the
 * two apart would mean guessing per call site — and a wrong guess puts "Replay standby" on a
 * German channel, which is the fault this function exists to prevent.
 */
export function localizeViewerBuiltInText(locale: unknown, value: string): string {
  const key = builtInViewerTextKey(value);
  return key ? viewerText(locale, key) : value;
}
