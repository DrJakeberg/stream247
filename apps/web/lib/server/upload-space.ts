// Whether a library upload may start (M125): judged from its declared size before the first byte
// is written, so a refusal costs nothing and never leaves half a file behind.

export type UploadVolume = { bavail: number | bigint; blocks: number | bigint; bsize: number | bigint };

export type UploadSpaceVerdict = { ok: true } | { ok: false; status: 413 | 507; message: string };

const GIB = 1024 ** 3;

function formatGiB(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

/**
 * The optional per-file limit, STREAM247_UPLOAD_MAX_BYTES. Unset, empty or not a positive number
 * means no limit of its own: the free-space rule below still applies to every upload.
 */
export function resolveUploadMaxFileBytes(env: Record<string, string | undefined>): number | null {
  const parsed = Number(env.STREAM247_UPLOAD_MAX_BYTES ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

/**
 * Refuses an upload that would leave the media volume with less free space than the disk
 * watermark's trigger (the share at which the worker starts evicting caches), or that is larger
 * than the per-file limit when one is set. The watermark is the line the rest of the system
 * already treats as "the disk is getting full"; an upload must not be what pushes it there.
 */
export function judgeUploadSpace(input: {
  volume: UploadVolume;
  uploadBytes: number;
  minFreeRatio: number;
  maxFileBytes: number | null;
}): UploadSpaceVerdict {
  if (input.maxFileBytes !== null && input.uploadBytes > input.maxFileBytes) {
    return {
      ok: false,
      status: 413,
      message: `This file is ${formatGiB(input.uploadBytes)}; uploads are limited to ${formatGiB(input.maxFileBytes)} per file (STREAM247_UPLOAD_MAX_BYTES).`
    };
  }

  const blockSize = Number(input.volume.bsize);
  const freeBytes = Number(input.volume.bavail) * blockSize;
  const totalBytes = Number(input.volume.blocks) * blockSize;
  const keepFreeBytes = Math.ceil(totalBytes * input.minFreeRatio);
  if (freeBytes - input.uploadBytes < keepFreeBytes) {
    return {
      ok: false,
      status: 507,
      message: `Not enough space on the media volume: ${formatGiB(freeBytes)} free, this file needs ${formatGiB(input.uploadBytes)}, and ${formatGiB(keepFreeBytes)} must stay free (the disk watermark). Free up space or lower the watermark under Settings.`
    };
  }

  return { ok: true };
}
