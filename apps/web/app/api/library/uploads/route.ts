import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { LIBRARY_MEDIA_FILE_EXTENSIONS, resolveDiskWatermarkConfig } from "@stream247/core";
import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateSourceFieldRecords } from "@/lib/server/state";
import { isInsideMediaRoot, sanitizeSubfolder } from "@/lib/server/media-paths";
import { judgeUploadSpace, resolveUploadMaxFileBytes } from "@/lib/server/upload-space";

// The scan decides what becomes an asset; the upload accepts exactly that and nothing it would ignore.
const allowedExtensions = new Set<string>(LIBRARY_MEDIA_FILE_EXTENSIONS);
const maxUploadCollisionRetries = 16;

function getMediaRoot(): string {
  return process.env.MEDIA_LIBRARY_ROOT || path.join(process.cwd(), "data", "media");
}

function sanitizeFileName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName, extension);
  const safeBaseName = baseName
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return `${safeBaseName || "upload"}${extension}`;
}

async function markLocalLibraryForRescan() {
  const state = await readAppState();
  const existing = state.sources.find((source) => source.id === "source-local-library");
  if (!existing) {
    return;
  }

  await updateSourceFieldRecords([
    {
      id: existing.id,
      status: "Sync queued",
      notes: "New local uploads detected. The worker will refresh the local media library on the next cycle."
    }
  ]);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

async function removePartialUpload(filePath: string) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

function buildUploadPath(targetRoot: string, safeName: string, attempt: number): string {
  if (attempt === 0) {
    return path.join(targetRoot, safeName);
  }

  const extension = path.extname(safeName);
  const baseName = path.basename(safeName, extension);
  return path.join(targetRoot, `${baseName}-${randomUUID().slice(0, 8)}${extension}`);
}

// Counts what passes and stops the copy the moment the body is longer than it said it would be.
function byteLimit(maxBytes: number): Transform & { readonly bytes: number } {
  let bytes = 0;
  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        callback(new UploadSizeMismatch());
        return;
      }
      callback(null, chunk);
    }
  });
  return Object.defineProperty(transform, "bytes", { get: () => bytes }) as Transform & { readonly bytes: number };
}

class UploadSizeMismatch extends Error {}

async function writeUploadedFile(
  targetRoot: string,
  fileName: string,
  body: ReadableStream<Uint8Array>,
  declaredBytes: number
): Promise<string> {
  const safeName = sanitizeFileName(fileName);

  for (let attempt = 0; attempt <= maxUploadCollisionRetries; attempt += 1) {
    const finalPath = buildUploadPath(targetRoot, safeName, attempt);
    const counter = byteLimit(declaredBytes);
    const output = createWriteStream(finalPath, { flags: "wx" });

    try {
      // The name is reserved before the first byte is read: the body can be read only once, so a
      // taken name must be found out while it is still untouched.
      await once(output, "open");
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        continue;
      }
      throw error;
    }

    try {
      await pipeline(Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>), counter, output);
      if (counter.bytes !== declaredBytes) {
        throw new UploadSizeMismatch();
      }
      return finalPath;
    } catch (error) {
      await removePartialUpload(finalPath);
      throw error;
    }
  }

  throw new Error(`Failed to reserve a unique upload path for ${safeName}.`);
}

function readHeaderText(request: Request, name: string): string | null {
  try {
    return decodeURIComponent(request.headers.get(name) ?? "");
  } catch {
    return null;
  }
}

/**
 * One file per request, the file itself as the body (M125).
 *
 * The multipart form this replaced was read with request.formData(), which holds the whole body in
 * the web process's memory (measured at about twice its size) before a single byte reaches the
 * disk, with no limit and no look at the free space. Now the body streams straight into the file,
 * its size is known before the first byte (Content-Length), and an upload that would leave the
 * media volume below the eviction watermark is refused up front with 507.
 */
export async function POST(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const fileName = readHeaderText(request, "x-upload-name");
  const rawSubfolder = readHeaderText(request, "x-upload-subfolder");
  const declaredBytes = Number(request.headers.get("content-length") ?? "");
  if (!fileName || rawSubfolder === null || !request.body || !Number.isSafeInteger(declaredBytes) || declaredBytes <= 0) {
    return NextResponse.json(
      { message: "Send one media file per request: the file as the body, its name in X-Upload-Name and its size in Content-Length." },
      { status: 400 }
    );
  }

  if (!allowedExtensions.has(path.extname(fileName).toLowerCase())) {
    return NextResponse.json(
      { message: `Unsupported file type for ${fileName}. The library scan ingests ${LIBRARY_MEDIA_FILE_EXTENSIONS.join(", ")}.` },
      { status: 400 }
    );
  }

  const mediaRoot = getMediaRoot();
  const subfolder = sanitizeSubfolder(rawSubfolder);
  const targetRoot = path.join(mediaRoot, subfolder || "uploads");

  if (!isInsideMediaRoot(targetRoot, mediaRoot)) {
    return NextResponse.json({ message: "Upload folder must stay inside the media library." }, { status: 400 });
  }

  await fs.mkdir(targetRoot, { recursive: true });

  const state = await readAppState();
  const space = judgeUploadSpace({
    volume: await fs.statfs(targetRoot),
    uploadBytes: declaredBytes,
    minFreeRatio: resolveDiskWatermarkConfig(state.managedConfig, process.env).triggerFreeRatio,
    maxFileBytes: resolveUploadMaxFileBytes(process.env)
  });
  if (!space.ok) {
    return NextResponse.json({ message: space.message }, { status: space.status });
  }

  let storedPath: string;
  try {
    storedPath = await writeUploadedFile(targetRoot, fileName, request.body, declaredBytes);
  } catch (error) {
    if (error instanceof UploadSizeMismatch) {
      return NextResponse.json({ message: `The upload of ${fileName} did not match its declared size and was discarded.` }, { status: 400 });
    }
    throw error;
  }

  await markLocalLibraryForRescan();
  await appendAuditEvent("library.uploaded", `Uploaded 1 local media file into ${subfolder || "uploads"}.`);

  return NextResponse.json({
    ok: true,
    uploadedCount: 1,
    storedName: path.basename(storedPath),
    targetFolder: path.relative(mediaRoot, targetRoot) || ".",
    message: `Uploaded ${path.basename(storedPath)} into ${subfolder || "uploads"}. The local media library will refresh on the next worker cycle.`
  });
}
