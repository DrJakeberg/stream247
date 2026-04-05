import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectUpdateChannel,
  getUpdateCenterState,
  resolveRepoPackagePath
} from "../../apps/web/lib/server/update-center";

const temporaryDirectories: string[] = [];
const originalCwd = process.cwd();

describe("update center helpers", () => {
  afterEach(async () => {
    process.chdir(originalCwd);
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, {
          recursive: true,
          force: true
        })
      )
    );
  });

  it("detects stable pinned semver tags", () => {
    expect(detectUpdateChannel(["v1.0.3", "v1.0.3", "v1.0.3"])).toBe("stable");
  });

  it("detects evaluation tags", () => {
    expect(detectUpdateChannel(["latest", "latest", "main-abc123"])).toBe("evaluation");
  });

  it("detects mixed production states", () => {
    expect(detectUpdateChannel(["v1.0.3", "latest", "v1.0.3"])).toBe("mixed");
  });

  it("falls back to custom when tags are non-standard", () => {
    expect(detectUpdateChannel(["internal", "", "nightly"])).toBe("custom");
  });

  it("resolves the repo package from a repo-root working directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "stream247-update-center-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "stream247", version: "9.9.9" }));

    await expect(resolveRepoPackagePath(root)).resolves.toBe(path.join(root, "package.json"));
  });

  it("walks up from apps/web style working directories to the repo package", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "stream247-update-center-"));
    temporaryDirectories.push(root);
    const webDirectory = path.join(root, "apps", "web");
    await mkdir(webDirectory, { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "stream247", version: "1.2.3" }));
    await writeFile(path.join(webDirectory, "package.json"), JSON.stringify({ name: "web", version: "1.2.3" }));

    await expect(resolveRepoPackagePath(webDirectory)).resolves.toBe(path.join(root, "package.json"));
  });

  it("reads the repo version for update center state from an apps/web style cwd", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "stream247-update-center-"));
    temporaryDirectories.push(root);
    const webDirectory = path.join(root, "apps", "web");
    await mkdir(webDirectory, { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "stream247", version: "2.4.6" }));
    await writeFile(path.join(webDirectory, "package.json"), JSON.stringify({ name: "web", version: "2.4.6" }));

    const previousImages = {
      web: process.env.STREAM247_WEB_IMAGE,
      worker: process.env.STREAM247_WORKER_IMAGE,
      playout: process.env.STREAM247_PLAYOUT_IMAGE
    };

    process.chdir(webDirectory);
    process.env.STREAM247_WEB_IMAGE = "ghcr.io/example/web:v2.4.6";
    process.env.STREAM247_WORKER_IMAGE = "ghcr.io/example/worker:v2.4.6";
    process.env.STREAM247_PLAYOUT_IMAGE = "ghcr.io/example/playout:v2.4.6";

    try {
      const state = await getUpdateCenterState();
      expect(state.appVersion).toBe("2.4.6");
      expect(state.channel).toBe("stable");
      expect(state.alignedImages).toBe(true);
    } finally {
      process.env.STREAM247_WEB_IMAGE = previousImages.web;
      process.env.STREAM247_WORKER_IMAGE = previousImages.worker;
      process.env.STREAM247_PLAYOUT_IMAGE = previousImages.playout;
    }
  });
});
