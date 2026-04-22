import { stripInvisibleCharacters } from "@stream247/core";
import { describe, expect, it } from "vitest";

describe("stripInvisibleCharacters", () => {
  it("removes every invisible/control category covered by the sanitizer", () => {
    expect(stripInvisibleCharacters("\u0007\u0085Re\u200B\u200C\u200Dpla\u00ADy\u202E\u2066 title\uFEFF")).toBe("Replay title");
  });

  it("preserves printable unicode while normalizing into NFC", () => {
    expect(stripInvisibleCharacters("Cafe\u0301 \uD83C\uDF89 日本語")).toBe("Café \uD83C\uDF89 日本語");
  });
});
