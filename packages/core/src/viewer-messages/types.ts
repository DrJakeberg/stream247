import type { EN_VIEWER_MESSAGES } from "./en.js";

/** The languages a channel can speak to its viewers in. */
export const VIEWER_LOCALES = ["en", "de"] as const;

export type ViewerLocale = (typeof VIEWER_LOCALES)[number];

/**
 * One message: plain text, or plural forms chosen by the `count` parameter. `other` is required
 * because it is what Intl.PluralRules answers for every category a language does not spell out.
 */
export type ViewerPluralMessage = {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
};

export type ViewerMessage = string | ViewerPluralMessage;

/** Every key the English reference catalogue defines. */
export type ViewerMessageKey = keyof typeof EN_VIEWER_MESSAGES;

/** A complete catalogue: every key, nothing else. */
export type ViewerMessageCatalogue = { readonly [Key in ViewerMessageKey]: ViewerMessage };

export type ViewerMessageParams = Readonly<Record<string, string | number | null | undefined>>;
