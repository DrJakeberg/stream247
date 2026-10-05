/**
 * How the daily trial of a quarantined item asks whether it plays (M95 H9, owner Q1; review finding R34,
 * 2026-10-05).
 *
 * The trial went through the queue's ordinary resolve. For a Twitch archive whose cache file is not there,
 * that resolve hands the archive to the download runner, which works one job at a time, first in first out:
 * every due archive queued a multi-gigabyte download ahead of the archives the programme needed next, one
 * per cycle and source, and the downloads pushed the disk towards the watermark eviction (which can delete
 * an upcoming archive's ready file). With the remote fallback off, a pool archive waiting behind them was
 * refused and the local fallback bridged instead.
 *
 * Now an uncached archive's trial only asks Twitch whether the archive still resolves (yt-dlp, no download)
 * and caches nothing: the remote address is not what the playout plays with the remote fallback off. A
 * clean answer lifts the quarantine, and the download comes when the pool's queue reaches the archive, in
 * the programme's own order. A cached archive, one settled as too large (streamed by configuration, never
 * downloaded) and every other item are tried with the ordinary resolve, as before.
 *
 * No I/O here.
 */

export type QuarantineTrialMode = "resolve" | "availability";

export function decideQuarantineTrialMode(input: { twitchArchive: boolean; cacheReady: boolean; settledTooLarge: boolean }): QuarantineTrialMode {
  return input.twitchArchive && !input.cacheReady && !input.settledTooLarge ? "availability" : "resolve";
}
