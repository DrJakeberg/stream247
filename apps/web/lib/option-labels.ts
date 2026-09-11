/**
 * Turns a stored enum value into something readable, without claiming to know what it means.
 *
 * The engagement settings offered "bottom-left", "quiet", "flood" and "card" as the option text —
 * the values as they are stored. Sentence case and a space instead of the hyphen is the whole
 * change, and that limit is deliberate: nothing in the codebase documents how "flood" differs from
 * "active", so a label like "Show every message" would be a guess presented as fact. This makes the
 * options readable; naming them properly needs someone who knows what they do.
 */
export function humanizeOptionValue(value: string): string {
  const text = String(value || "").replace(/[-_]+/g, " ").trim();

  if (!text) {
    return "";
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}
