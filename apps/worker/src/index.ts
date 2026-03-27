import { promises as fs } from "node:fs";
import path from "node:path";
import { buildSchedulePreview, describePresenceStatus } from "@stream247/core";
import {
  appendAuditEvent,
  readAppState,
  resolveIncident,
  updateAppState,
  upsertIncident,
  type AppState,
  type AssetRecord
} from "@stream247/db";

const mediaExtensions = new Set([".mp4", ".mkv", ".mov", ".m4v", ".webm"]);

function getMediaRoot(): string {
  return process.env.MEDIA_LIBRARY_ROOT || path.join(process.cwd(), "data", "media");
}

async function walkMediaFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(root, entry.name);
        if (entry.isDirectory()) {
          return walkMediaFiles(absolutePath);
        }
        return mediaExtensions.has(path.extname(entry.name).toLowerCase()) ? [absolutePath] : [];
      })
    );
    return files.flat();
  } catch {
    return [];
  }
}

function buildAssetFromPath(filePath: string, now: string): AssetRecord {
  const id = `asset_${Buffer.from(filePath).toString("base64url").slice(0, 32)}`;
  return {
    id,
    sourceId: "source-local-library",
    title: path.basename(filePath, path.extname(filePath)).replace(/[_-]+/g, " "),
    path: filePath,
    status: "ready",
    createdAt: now,
    updatedAt: now
  };
}

async function syncLocalMediaLibrary(): Promise<void> {
  const mediaRoot = getMediaRoot();
  const discoveredFiles = await walkMediaFiles(mediaRoot);
  const now = new Date().toISOString();
  const discoveredAssets = discoveredFiles.map((filePath) => buildAssetFromPath(filePath, now));

  await updateAppState((state) => {
    const existingByPath = new Map(state.assets.map((asset) => [asset.path, asset]));
    const nextAssets: AssetRecord[] = discoveredAssets.map((asset) => {
      const existing = existingByPath.get(asset.path);
      return existing
        ? {
            ...existing,
            title: asset.title,
            status: "ready",
            updatedAt: now
          }
        : asset;
    });

    const otherAssets = state.assets.filter((asset) => asset.sourceId !== "source-local-library");
    const nextSources = state.sources.some((source) => source.id === "source-local-library")
      ? state.sources.map((source) =>
          source.id === "source-local-library"
            ? {
                ...source,
                status: nextAssets.length > 0 ? "Ready" : "Empty",
                lastSyncedAt: now
              }
            : source
        )
      : [
          ...state.sources,
          {
            id: "source-local-library",
            name: "Local Media Library",
            type: "Filesystem scan",
            status: nextAssets.length > 0 ? "Ready" : "Empty",
            lastSyncedAt: now
          }
        ];

    return {
      ...state,
      sources: nextSources,
      assets: [...nextAssets, ...otherAssets]
    };
  });

  if (discoveredAssets.length > 0) {
    await resolveIncident("source.local-library.empty", "Local media library now contains playable assets.");
  } else {
    await upsertIncident({
      scope: "source",
      severity: "warning",
      title: "Local media library is empty",
      message: `No media files were found under ${mediaRoot}.`,
      fingerprint: "source.local-library.empty"
    });
  }
}

function getCurrentScheduleItem(state: AppState) {
  const preview = buildSchedulePreview({
    date: new Date().toISOString().slice(0, 10),
    blocks: state.scheduleBlocks
  });
  const currentTime = new Date().toISOString().slice(11, 16);
  return (
    preview.items.find((item) => item.startTime <= currentTime && item.endTime > currentTime) ??
    preview.items[0] ??
    null
  );
}

async function runPlayoutCycle(): Promise<void> {
  const state = await readAppState();
  const currentScheduleItem = getCurrentScheduleItem(state);
  const preferredSource = currentScheduleItem?.sourceName;
  const eligibleSource = state.sources.find((source) => source.name === preferredSource) ?? state.sources[0];
  const asset =
    state.assets.find((entry) => {
      const matchingSource = state.sources.find((source) => source.id === entry.sourceId);
      return matchingSource?.name === eligibleSource?.name && entry.status === "ready";
    }) ?? state.assets.find((entry) => entry.status === "ready");

  if (!asset) {
    await upsertIncident({
      scope: "playout",
      severity: "critical",
      title: "No playable asset available",
      message: "The playout engine could not find a ready asset to put on air.",
      fingerprint: "playout.no-asset"
    });

    await updateAppState((current) => ({
      ...current,
      playout: {
        status: "degraded",
        currentAssetId: "",
        currentTitle: "",
        heartbeatAt: new Date().toISOString(),
        message: "No playable asset is available."
      }
    }));
    return;
  }

  await resolveIncident("playout.no-asset", "A playable asset is available again.");
  await updateAppState((current) => ({
    ...current,
    playout: {
      status: "running",
      currentAssetId: asset.id,
      currentTitle: currentScheduleItem ? `${currentScheduleItem.title} · ${asset.title}` : asset.title,
      heartbeatAt: new Date().toISOString(),
      message: currentScheduleItem
        ? `Scheduled block ${currentScheduleItem.title} is mapped to asset ${asset.title}.`
        : `Fallback asset ${asset.title} is selected.`
    }
  }));
}

async function sendDiscordAlert(message: string): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message })
    });
  } catch {
    // Alert delivery errors should not crash the worker loop.
  }
}

async function reconcileTwitch(): Promise<void> {
  const state = await readAppState();
  if (state.twitch.status !== "connected" || !state.twitch.accessToken || !state.twitch.broadcasterId) {
    return;
  }

  const currentScheduleItem = getCurrentScheduleItem(state);
  if (!currentScheduleItem) {
    return;
  }

  const desiredTitle = currentScheduleItem.title;
  const presenceStatus = describePresenceStatus({
    activeWindows: state.presenceWindows.map((window) => ({
      actor: window.actor,
      minutes: window.minutes,
      createdAt: new Date(window.createdAt),
      expiresAt: new Date(window.expiresAt)
    })),
    now: new Date(),
    fallbackEmoteOnly: state.moderation.fallbackEmoteOnly
  });

  try {
    const channelBody: Record<string, string> = { title: desiredTitle };
    if (process.env.TWITCH_DEFAULT_CATEGORY_ID) {
      channelBody.game_id = process.env.TWITCH_DEFAULT_CATEGORY_ID;
    }

    const channelResponse = await fetch(
      `https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(state.twitch.broadcasterId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${state.twitch.accessToken}`,
          "Client-Id": process.env.TWITCH_CLIENT_ID || "",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(channelBody)
      }
    );

    if (!channelResponse.ok) {
      throw new Error(`Channel metadata sync failed with status ${channelResponse.status}.`);
    }

    const chatResponse = await fetch(
      `https://api.twitch.tv/helix/chat/settings?broadcaster_id=${encodeURIComponent(
        state.twitch.broadcasterId
      )}&moderator_id=${encodeURIComponent(state.twitch.broadcasterId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${state.twitch.accessToken}`,
          "Client-Id": process.env.TWITCH_CLIENT_ID || "",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          emote_mode: presenceStatus.chatMode === "emote-only"
        })
      }
    );

    if (!chatResponse.ok) {
      throw new Error(`Chat settings sync failed with status ${chatResponse.status}.`);
    }

    await resolveIncident("twitch.reconcile.failed", "Twitch reconciliation succeeded.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Twitch reconciliation error.";
    await upsertIncident({
      scope: "twitch",
      severity: "warning",
      title: "Twitch reconciliation failed",
      message,
      fingerprint: "twitch.reconcile.failed"
    });
    await sendDiscordAlert(`Stream247 warning: ${message}`);
  }
}

async function runWorkerCycle(): Promise<void> {
  await syncLocalMediaLibrary();
  await reconcileTwitch();
  await appendAuditEvent("worker.cycle", "Worker reconciliation cycle completed.");
}

async function runLoop(mode: "worker" | "playout"): Promise<void> {
  const run = mode === "worker" ? runWorkerCycle : runPlayoutCycle;
  const delay = mode === "worker" ? 30_000 : 15_000;

  for (;;) {
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unknown ${mode} error.`;
      await upsertIncident({
        scope: mode === "worker" ? "worker" : "playout",
        severity: "critical",
        title: `${mode} loop crashed`,
        message,
        fingerprint: `${mode}.loop.crashed`
      });
      await sendDiscordAlert(`Stream247 critical: ${mode} loop crashed: ${message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

const mode = process.argv[2] === "playout" ? "playout" : "worker";

runLoop(mode).catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
