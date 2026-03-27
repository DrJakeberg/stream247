import { promises as fs } from "node:fs";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import path from "node:path";
import type { Readable } from "node:stream";
import { buildSchedulePreview, describePresenceStatus } from "@stream247/core";
import {
  appendAuditEvent,
  readAppState,
  resolveIncident,
  updateAppState,
  upsertIncident,
  type AppState,
  type AssetRecord,
  type StreamDestinationRecord
} from "@stream247/db";

const mediaExtensions = new Set([".mp4", ".mkv", ".mov", ".m4v", ".webm"]);
let playoutProcess: ChildProcessByStdio<null, Readable, Readable> | null = null;
let playoutAssetId = "";
let playoutDestinationId = "";

function getMediaRoot(): string {
  return process.env.MEDIA_LIBRARY_ROOT || path.join(process.cwd(), "data", "media");
}

function isDirectMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && mediaExtensions.has(path.extname(url.pathname).toLowerCase());
  } catch {
    return false;
  }
}

function getConfiguredStreamTarget(destination: StreamDestinationRecord | null): string | null {
  if (!destination?.enabled) {
    return null;
  }

  const envUrl = process.env.STREAM_OUTPUT_URL || process.env.TWITCH_RTMP_URL;
  const envKey = process.env.STREAM_OUTPUT_KEY || process.env.TWITCH_STREAM_KEY;
  const streamUrl = destination.rtmpUrl || envUrl;
  const streamKey = envKey;

  if (!streamUrl || !streamKey) {
    return null;
  }

  return `${streamUrl.replace(/\/$/, "")}/${streamKey}`;
}

function getFfmpegCommand(input: string, output: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-re",
    "-stream_loop",
    "-1",
    "-i",
    input,
    "-c:v",
    "libx264",
    "-preset",
    process.env.FFMPEG_PRESET || "veryfast",
    "-maxrate",
    process.env.FFMPEG_MAXRATE || "4500k",
    "-bufsize",
    process.env.FFMPEG_BUFSIZE || "9000k",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "60",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-b:a",
    process.env.FFMPEG_AUDIO_BITRATE || "160k",
    "-f",
    "flv",
    output
  ];
}

async function refreshBroadcasterAccessToken(): Promise<string> {
  const state = await readAppState();
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret || !state.twitch.refreshToken) {
    throw new Error("Missing Twitch client credentials or refresh token.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: state.twitch.refreshToken,
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body
  });

  if (!response.ok) {
    throw new Error(`Twitch token refresh failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  const refreshedAt = new Date().toISOString();
  const tokenExpiresAt = payload.expires_in
    ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
    : state.twitch.tokenExpiresAt;

  await updateAppState((current) => ({
    ...current,
    twitch: {
      ...current.twitch,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? current.twitch.refreshToken,
      status: "connected",
      tokenExpiresAt,
      lastRefreshAt: refreshedAt,
      error: ""
    }
  }));

  await resolveIncident("twitch.refresh.failed", "Twitch token refresh succeeded.");
  return payload.access_token;
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
  const isFallback = filePath.toLowerCase().includes("fallback") || filePath.toLowerCase().includes("standby");
  const id = `asset_${Buffer.from(filePath).toString("base64url").slice(0, 32)}`;
  return {
    id,
    sourceId: "source-local-library",
    title: path.basename(filePath, path.extname(filePath)).replace(/[_-]+/g, " "),
    path: filePath,
    status: "ready",
    fallbackPriority: isFallback ? 1 : 100,
    isGlobalFallback: isFallback,
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
            fallbackPriority: asset.fallbackPriority,
            isGlobalFallback: asset.isGlobalFallback,
            updatedAt: now
          }
        : asset;
    });

    const otherAssets = state.assets.filter((asset) => asset.sourceId !== "source-local-library");
    const nextSources: AppState["sources"] = state.sources.some((source) => source.id === "source-local-library")
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
            connectorKind: "local-library",
            status: nextAssets.length > 0 ? "Ready" : "Empty",
            externalUrl: "",
            notes: "Scans files mounted into the media library volume.",
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

async function syncDirectMediaSources(): Promise<void> {
  const state = await readAppState();
  const now = new Date().toISOString();
  const directSources = state.sources.filter((source) => source.connectorKind === "direct-media");
  const directAssets: AssetRecord[] = [];
  let hasInvalidSource = false;

  for (const source of directSources) {
    const url = source.externalUrl?.trim() ?? "";
    if (!isDirectMediaUrl(url)) {
      hasInvalidSource = true;
      continue;
    }

    directAssets.push({
      id: `asset_${source.id}`,
      sourceId: source.id,
      title: source.name,
      path: url,
      status: "ready",
      fallbackPriority: 100,
      isGlobalFallback: false,
      createdAt: now,
      updatedAt: now
    });
  }

  await updateAppState((current) => ({
    ...current,
    sources: current.sources.map((source) => {
      if (source.connectorKind !== "direct-media") {
        return source;
      }

      const valid = isDirectMediaUrl(source.externalUrl?.trim() ?? "");
      return {
        ...source,
        status: valid ? "Ready" : "Invalid URL",
        notes: valid
          ? "Direct media URL normalized into the playout asset catalog."
          : "Direct media sources currently require an http(s) URL ending in a supported media file extension.",
        lastSyncedAt: now
      };
    }),
    assets: [
      ...directAssets,
      ...current.assets.filter((asset) => {
        const matchingSource = current.sources.find((source) => source.id === asset.sourceId);
        return matchingSource?.connectorKind !== "direct-media";
      })
    ]
  }));

  if (hasInvalidSource) {
    await upsertIncident({
      scope: "source",
      severity: "warning",
      title: "One or more direct media sources are invalid",
      message: "Direct media URLs must be http(s) links ending in a supported media file extension.",
      fingerprint: "source.direct-media.invalid"
    });
  } else {
    await resolveIncident("source.direct-media.invalid", "All direct media sources are valid.");
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

function choosePlaybackCandidate(state: AppState) {
  const currentScheduleItem = getCurrentScheduleItem(state);
  const preferredSource = currentScheduleItem?.sourceName;
  const preferredAsset = state.assets.find((entry) => {
    if (entry.status !== "ready") {
      return false;
    }
    const matchingSource = state.sources.find((source) => source.id === entry.sourceId);
    return matchingSource?.name === preferredSource;
  });

  if (preferredAsset) {
    return {
      asset: preferredAsset,
      reason: currentScheduleItem
        ? `Scheduled block ${currentScheduleItem.title} is mapped to asset ${preferredAsset.title}.`
        : `Selected asset ${preferredAsset.title}.`,
      lifecycleStatus: "running" as const
    };
  }

  const globalFallback = [...state.assets]
    .filter((asset) => asset.status === "ready" && asset.isGlobalFallback)
    .sort((left, right) => left.fallbackPriority - right.fallbackPriority)[0];

  if (globalFallback) {
    return {
      asset: globalFallback,
      reason: `Global fallback asset ${globalFallback.title} is selected.`,
      lifecycleStatus: "recovering" as const
    };
  }

  const anyReadyAsset = [...state.assets]
    .filter((asset) => asset.status === "ready")
    .sort((left, right) => left.fallbackPriority - right.fallbackPriority)[0];

  if (anyReadyAsset) {
    return {
      asset: anyReadyAsset,
      reason: `Fallback asset ${anyReadyAsset.title} is selected.`,
      lifecycleStatus: "recovering" as const
    };
  }

  return {
    asset: null,
    reason: "The playout engine could not find a ready asset to put on air.",
    lifecycleStatus: "failed" as const
  };
}

function stopPlayoutProcess(): void {
  if (playoutProcess && !playoutProcess.killed) {
    playoutProcess.kill("SIGTERM");
  }
  playoutProcess = null;
  playoutAssetId = "";
  playoutDestinationId = "";
}

async function startOrSwitchPlayout(args: {
  asset: AssetRecord;
  destination: StreamDestinationRecord;
  streamTarget: string;
  lifecycleStatus: AppState["playout"]["status"];
  reason: string;
}): Promise<void> {
  const switching = playoutProcess && !playoutProcess.killed;
  if (switching) {
    stopPlayoutProcess();
  }

  const ffmpegBinary = process.env.FFMPEG_BIN || "ffmpeg";
  const command = getFfmpegCommand(args.asset.path, args.streamTarget);
  const child = spawn(ffmpegBinary, command, {
    stdio: ["ignore", "pipe", "pipe"]
  });

  playoutProcess = child;
  playoutAssetId = args.asset.id;
  playoutDestinationId = args.destination.id;

  const pid = child.pid ?? 0;
  const startedAt = new Date().toISOString();

  await updateAppState((current) => ({
    ...current,
    playout: {
      ...current.playout,
      status: switching ? "switching" : args.lifecycleStatus === "recovering" ? "recovering" : "starting",
      currentAssetId: args.asset.id,
      currentTitle: args.asset.title,
      desiredAssetId: args.asset.id,
      currentDestinationId: args.destination.id,
      heartbeatAt: startedAt,
      processPid: pid,
      processStartedAt: startedAt,
      lastError: "",
      message: args.reason
    }
  }));

  child.stderr.on("data", (chunk) => {
    const line = chunk.toString().trim();
    if (!line) {
      return;
    }

    void updateAppState((current) => ({
      ...current,
      playout: {
        ...current.playout,
        lastStderrSample: line.slice(0, 400),
        heartbeatAt: new Date().toISOString()
      }
    }));

    if (line.toLowerCase().includes("error")) {
      void upsertIncident({
        scope: "playout",
        severity: "warning",
        title: "FFmpeg reported an error",
        message: line.slice(0, 400),
        fingerprint: "playout.ffmpeg.stderr"
      });
    }
  });

  child.on("exit", (code) => {
    playoutProcess = null;
    playoutAssetId = "";
    playoutDestinationId = "";
    void updateAppState((current) => ({
      ...current,
      playout: {
        ...current.playout,
        status: code === 0 ? "idle" : "failed",
        heartbeatAt: new Date().toISOString(),
        processPid: 0,
        processStartedAt: "",
        lastExitCode: String(code ?? ""),
        restartCount: current.playout.restartCount + 1,
        lastError: code === 0 ? current.playout.lastError : `FFmpeg exited with code ${String(code)}.`,
        message: code === 0 ? "Playout process stopped cleanly." : "Playout process exited unexpectedly."
      }
    }));
    void upsertIncident({
      scope: "playout",
      severity: code === 0 ? "info" : "critical",
      title: "FFmpeg process exited",
      message: `FFmpeg exited with code ${String(code)}.`,
      fingerprint: "playout.ffmpeg.exit"
    });
  });
}

async function syncDestinations(): Promise<void> {
  const now = new Date().toISOString();
  await updateAppState((state) => ({
    ...state,
    destinations: state.destinations.map((destination) => {
      const streamTarget = getConfiguredStreamTarget(destination);
      return {
        ...destination,
        streamKeyPresent: Boolean(process.env.STREAM_OUTPUT_KEY || process.env.TWITCH_STREAM_KEY),
        status: destination.enabled ? (streamTarget ? "ready" : "missing-config") : "missing-config",
        lastValidatedAt: now,
        notes: streamTarget
          ? "Destination is configured and ready for FFmpeg output."
          : "Configure STREAM_OUTPUT_URL/KEY or TWITCH_RTMP_URL/TWITCH_STREAM_KEY."
      };
    })
  }));
}

async function runPlayoutCycle(): Promise<void> {
  const state = await readAppState();
  const destination = state.destinations.find((entry) => entry.enabled) ?? null;
  const streamTarget = getConfiguredStreamTarget(destination);
  const selection = choosePlaybackCandidate(state);

  if (!destination || !streamTarget) {
    await upsertIncident({
      scope: "playout",
      severity: "warning",
      title: "Playout destination is not configured",
      message: "Set STREAM_OUTPUT_URL and STREAM_OUTPUT_KEY or TWITCH_RTMP_URL and TWITCH_STREAM_KEY to enable FFmpeg playout.",
      fingerprint: "playout.output.missing"
    });

    await updateAppState((current) => ({
      ...current,
      playout: {
        ...current.playout,
        status: "degraded",
        heartbeatAt: new Date().toISOString(),
        message: "No active RTMP destination is configured."
      }
    }));
    return;
  }

  await resolveIncident("playout.output.missing", "Playout destination is configured.");

  if (!selection.asset) {
    await upsertIncident({
      scope: "playout",
      severity: "critical",
      title: "No playable asset available",
      message: selection.reason,
      fingerprint: "playout.no-asset"
    });

    await updateAppState((current) => ({
      ...current,
      playout: {
        ...current.playout,
        status: "failed",
        currentAssetId: "",
        currentTitle: "",
        desiredAssetId: "",
        heartbeatAt: new Date().toISOString(),
        lastError: selection.reason,
        message: selection.reason
      }
    }));
    stopPlayoutProcess();
    return;
  }

  await resolveIncident("playout.no-asset", "A playable asset is available again.");

  if (!playoutProcess || playoutProcess.killed) {
    await startOrSwitchPlayout({
      asset: selection.asset,
      destination,
      streamTarget,
      lifecycleStatus: selection.lifecycleStatus,
      reason: selection.reason
    });
  } else if (playoutAssetId !== selection.asset.id || playoutDestinationId !== destination.id) {
    await startOrSwitchPlayout({
      asset: selection.asset,
      destination,
      streamTarget,
      lifecycleStatus: "switching",
      reason: selection.reason
    });
  }

  await updateAppState((current) => ({
    ...current,
    playout: {
      ...current.playout,
      status: selection.lifecycleStatus === "recovering" ? "recovering" : "running",
      currentAssetId: selection.asset.id,
      currentTitle: selection.asset.title,
      desiredAssetId: selection.asset.id,
      currentDestinationId: destination.id,
      heartbeatAt: new Date().toISOString(),
      message: selection.reason
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

  const expiresAt = state.twitch.tokenExpiresAt ? new Date(state.twitch.tokenExpiresAt).getTime() : 0;
  let twitchAccessToken = state.twitch.accessToken;
  if (expiresAt > 0 && expiresAt - Date.now() < 5 * 60_000) {
    twitchAccessToken = await refreshBroadcasterAccessToken();
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

  const sync = async (accessToken: string) => {
    const channelBody: Record<string, string> = { title: desiredTitle };
    if (process.env.TWITCH_DEFAULT_CATEGORY_ID) {
      channelBody.game_id = process.env.TWITCH_DEFAULT_CATEGORY_ID;
    }

    const channelResponse = await fetch(
      `https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(state.twitch.broadcasterId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
          Authorization: `Bearer ${accessToken}`,
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
  };

  try {
    await sync(twitchAccessToken);
    await resolveIncident("twitch.reconcile.failed", "Twitch reconciliation succeeded.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Twitch reconciliation error.";
    if (message.includes("401")) {
      try {
        twitchAccessToken = await refreshBroadcasterAccessToken();
        await sync(twitchAccessToken);
        await resolveIncident("twitch.reconcile.failed", "Twitch reconciliation succeeded after token refresh.");
        return;
      } catch (refreshError) {
        const refreshMessage = refreshError instanceof Error ? refreshError.message : "Unknown Twitch refresh failure.";
        await upsertIncident({
          scope: "twitch",
          severity: "critical",
          title: "Twitch token refresh failed",
          message: refreshMessage,
          fingerprint: "twitch.refresh.failed"
        });
      }
    }

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
  await syncDestinations();
  await syncLocalMediaLibrary();
  await syncDirectMediaSources();
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
