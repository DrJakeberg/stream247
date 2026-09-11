import path from "node:path";
import { describe, expect, it } from "vitest";
import { isInsideMediaRoot, sanitizeSubfolder } from "../../apps/web/lib/server/media-paths.js";

const mediaRoot = "/app/data/media";

describe("sanitizeSubfolder", () => {
  it("keeps ordinary folder names, including dots", () => {
    expect(sanitizeSubfolder("clips")).toBe("clips");
    expect(sanitizeSubfolder("clips.2026/best-of")).toBe("clips.2026/best-of");
  });

  it("drops traversal segments", () => {
    // The character class allows ".", so ".." used to survive sanitising completely intact and the
    // upload landed outside the media root.
    expect(sanitizeSubfolder("../../etc")).toBe("etc");
    expect(sanitizeSubfolder("..")).toBe("");
    expect(sanitizeSubfolder("clips/../../../root")).toBe("clips/root");
    expect(sanitizeSubfolder("....//....//etc")).toBe("etc");
  });

  it("treats backslashes as separators too", () => {
    expect(sanitizeSubfolder("..\\..\\windows")).toBe("windows");
  });

  it("drops empty and whitespace-only segments", () => {
    expect(sanitizeSubfolder("///")).toBe("");
    expect(sanitizeSubfolder("a//   //b")).toBe("a/b");
  });

  it("never produces a path that escapes the media root", () => {
    const hostile = [
      "../../etc",
      "..",
      "../",
      "./../../",
      "clips/../../..",
      "....//....//etc",
      "..\\..\\windows",
      "/etc/passwd",
      "  ../  ",
      "a/../../../../../../tmp"
    ];

    for (const candidate of hostile) {
      const resolved = path.join(mediaRoot, sanitizeSubfolder(candidate) || "uploads");
      expect(isInsideMediaRoot(resolved, mediaRoot)).toBe(true);
      expect(resolved.startsWith(mediaRoot)).toBe(true);
    }
  });
});

describe("isInsideMediaRoot", () => {
  it("accepts the root itself and paths beneath it", () => {
    expect(isInsideMediaRoot("/app/data/media", mediaRoot)).toBe(true);
    expect(isInsideMediaRoot("/app/data/media/uploads/a", mediaRoot)).toBe(true);
  });

  it("rejects anything outside, however it is spelled", () => {
    expect(isInsideMediaRoot("/app/data/media/../secrets", mediaRoot)).toBe(false);
    expect(isInsideMediaRoot("/etc/passwd", mediaRoot)).toBe(false);
    // A sibling directory sharing the root's prefix must not pass a naive string check.
    expect(isInsideMediaRoot("/app/data/media-other", mediaRoot)).toBe(false);
  });
});
