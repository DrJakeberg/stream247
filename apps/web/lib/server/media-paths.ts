// Path safety for caller-supplied media locations.
//
// Extracted from the upload route so the rules are importable and directly testable: they decide
// where an authenticated but untrusted request is allowed to write on disk.

import path from "node:path";

/**
 * Reduces a caller-supplied subfolder to a safe relative path.
 *
 * The character class keeps "." so ordinary names like "clips.2026" survive, which also meant a
 * ".." segment passed through untouched: "../../etc" sanitised to itself and escaped the media
 * root. Traversal segments are dropped outright — a segment made only of dots carries no name.
 * Backslashes are treated as separators too, so a Windows-style path cannot smuggle one through.
 */
export function sanitizeSubfolder(value: string): string {
  return value
    .split(/[/\\]/)
    .map((segment) =>
      segment
        .trim()
        .replace(/[^\w.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
    )
    .filter((segment) => segment.length > 0 && !/^\.+$/.test(segment))
    .join("/");
}

/**
 * Defence in depth: whatever the sanitiser produced, the resolved destination must still sit
 * inside the media root. A containment check cannot be fooled by an encoding the sanitiser missed,
 * and it also rejects a sibling directory that merely shares the root's prefix.
 */
export function isInsideMediaRoot(candidate: string, mediaRoot: string): boolean {
  const relative = path.relative(path.resolve(mediaRoot), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
