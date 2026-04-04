import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, upsertSourceRecord } from "@/lib/server/state";

const allowedExtensions = new Set([".mp4", ".mkv", ".mov", ".m4v", ".webm", ".avi", ".mp3", ".aac", ".flac", ".wav"]);

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

  await upsertSourceRecord({
    ...existing,
    status: "Sync queued",
    notes: "New local uploads detected. The worker will refresh the local media library on the next cycle."
  });
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
    const safeName = sanitizeFileName(file.name);
    const candidatePath = path.join(targetRoot, safeName);
    const finalPath = await (async () => {
      try {
        await fs.access(candidatePath);
        const extension = path.extname(safeName);
        const baseName = path.basename(safeName, extension);
        return path.join(targetRoot, `${baseName}-${randomUUID().slice(0, 8)}${extension}`);
      } catch {
        return candidatePath;
      }
    })();

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(finalPath, buffer);
    storedPaths.push(finalPath);
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
