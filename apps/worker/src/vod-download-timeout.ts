/**
 * How long one Twitch VOD download may run (M62).
 *
 * The configured limit was a fixed two hours. On 2026-09-04 at 11:17 it killed the download of a
 * five-hour VOD at 7.2 GB, left the .part frozen on disk, and the replay aired from Twitch directly
 * for the rest of the day. A limit that ignores the content's length is wrong for long content and
 * pointless for short: a download is healthy as long as it keeps up with real time. So the limit is
 * at least the content's own running time, with the configured value as the floor for short VODs
 * and a ceiling of one day so a stuck download is still collected.
 */
export const VOD_DOWNLOAD_TIMEOUT_CEILING_MS = 24 * 60 * 60 * 1000;

export function resolveVodDownloadTimeoutMs(args: { configuredMs: number; durationSeconds: number }): number {
  const floor = Math.max(0, args.configuredMs);
  const byDuration = Number.isFinite(args.durationSeconds) && args.durationSeconds > 0 ? args.durationSeconds * 1000 : 0;
  return Math.min(VOD_DOWNLOAD_TIMEOUT_CEILING_MS, Math.max(floor, byDuration));
}
