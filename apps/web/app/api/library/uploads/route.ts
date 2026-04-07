import { randomUUID } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateSourceFieldRecords } from "@/lib/server/state";

const allowedExtensions = new Set([".mp4", ".mkv", ".mov", ".m4v", ".webm", ".avi", ".mp3", ".aac", ".flac", ".wav"]);
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

function sanitizeSubfolder(value: string): string {
  return value
    .split("/")
    .map((segment) =>
      segment
        .trim()
        .replace(/[^\w.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
    )
    .filter(Boolean)
    .join("/");
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

async function writeUploadedFile(targetRoot: string, file: File): Promise<string> {
  const safeName = sanitizeFileName(file.name);

  for (let attempt = 0; attempt <= maxUploadCollisionRetries; attempt += 1) {
    const finalPath = buildUploadPath(targetRoot, safeName, attempt);

    try {
      await pipeline(
        Readable.fromWeb(file.stream() as unknown as NodeReadableStream<Uint8Array>),
        createWriteStream(finalPath, { flags: "wx" })
      );
      return finalPath;
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        continue;
      }

      await removePartialUpload(finalPath);
      throw error;
    }
  }

  throw new Error(`Failed to reserve a unique upload path for ${safeName}.`);
}

export async function POST(request: Request) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const formData = await request.formData();
  const rawSubfolder = String(formData.get("subfolder") || "");
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File)
    .filter((file) => file.size > 0);

  if (files.length === 0) {
    return NextResponse.json({ message: "Select at least one local media file to upload." }, { status: 400 });
  }

  const invalidFile = files.find((file) => !allowedExtensions.has(path.extname(file.name).toLowerCase()));
  if (invalidFile) {
    return NextResponse.json(
      { message: `Unsupported file type for ${invalidFile.name}. Upload video or audio files that the local library can scan.` },
      { status: 400 }
    );
  }

  const mediaRoot = getMediaRoot();
  const subfolder = sanitizeSubfolder(rawSubfolder);
  const targetRoot = path.join(mediaRoot, subfolder || "uploads");
  await fs.mkdir(targetRoot, { recursive: true });

  const storedPaths: string[] = [];

  for (const file of files) {
    storedPaths.push(await writeUploadedFile(targetRoot, file));
  }

  await markLocalLibraryForRescan();
  await appendAuditEvent(
    "library.uploaded",
    `Uploaded ${storedPaths.length} local media file${storedPaths.length === 1 ? "" : "s"} into ${subfolder || "uploads"}.`
  );

  return NextResponse.json({
    ok: true,
    uploadedCount: storedPaths.length,
    targetFolder: path.relative(mediaRoot, targetRoot) || ".",
    message: `Uploaded ${storedPaths.length} file${storedPaths.length === 1 ? "" : "s"} into ${subfolder || "uploads"}. The local media library will refresh on the next worker cycle.`
  });
}
