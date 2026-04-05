import { access, readFile } from "node:fs/promises";
import path from "node:path";

export type UpdateChannel = "stable" | "evaluation" | "mixed" | "custom";

export type UpdateCenterState = {
  appVersion: string;
  imageTags: {
    web: string;
    worker: string;
    playout: string;
  };
  channel: UpdateChannel;
  pinnedImages: boolean;
  alignedImages: boolean;
};

function extractImageTag(imageRef: string | undefined): string {
  const value = (imageRef || "").trim();
  if (!value || !value.includes(":")) {
    return "";
  }

  return value.slice(value.lastIndexOf(":") + 1);
}

function isStableTag(tag: string): boolean {
  return /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(tag);
}

export function detectUpdateChannel(tags: string[]): UpdateChannel {
  const filtered = tags.filter(Boolean);
  if (filtered.length === 0) {
    return "custom";
  }

  if (filtered.every((tag) => tag === "latest" || tag.startsWith("main-"))) {
    return "evaluation";
  }

  if (filtered.every((tag) => isStableTag(tag))) {
    return "stable";
  }

  if (filtered.some((tag) => tag === "latest" || tag.startsWith("main-")) && filtered.some((tag) => isStableTag(tag))) {
    return "mixed";
  }

  return "custom";
}

export async function resolveRepoPackagePath(startDir = process.cwd()): Promise<string> {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, "package.json");

    try {
      await access(candidate);
      const packageJson = JSON.parse(await readFile(candidate, "utf8")) as { name?: string };
      if (packageJson.name === "stream247") {
        return candidate;
      }
    } catch {
      // Continue walking upward until we either find the repo root or run out of parents.
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Could not resolve the stream247 package.json from ${startDir}.`);
    }
    currentDir = parentDir;
  }
}

export async function getUpdateCenterState(): Promise<UpdateCenterState> {
  const repoPackagePath = await resolveRepoPackagePath();
  const packageJson = JSON.parse(await readFile(repoPackagePath, "utf8")) as { version?: string };

  const imageTags = {
    web: extractImageTag(process.env.STREAM247_WEB_IMAGE),
    worker: extractImageTag(process.env.STREAM247_WORKER_IMAGE),
    playout: extractImageTag(process.env.STREAM247_PLAYOUT_IMAGE)
  };
  const tags = Object.values(imageTags);
  const nonEmptyTags = tags.filter(Boolean);

  return {
    appVersion: packageJson.version || "unknown",
    imageTags,
    channel: detectUpdateChannel(tags),
    pinnedImages: nonEmptyTags.length === 3 && nonEmptyTags.every((tag) => tag !== "latest"),
    alignedImages: nonEmptyTags.length === 3 && new Set(nonEmptyTags).size === 1
  };
}
