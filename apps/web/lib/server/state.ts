import {
  buildScheduleOccurrences,
  buildSchedulePreview,
  describePresenceStatus,
  getCurrentScheduleMoment,
  isCurrentScheduleTime
} from "@stream247/core";
import {
  appendAuditEvent,
  acknowledgeIncident,
  findTeamGrantByLogin,
  findUserByEmail,
  findUserById,
  readAppState,
  resolveIncident,
  updateAppState,
  writeAppState,
  type AppState,
  type AssetRecord,
  type AuditEvent,
  type IncidentRecord,
  type ModeratorPresenceWindowRecord,
  type OwnerAccount,
  type PlayoutRuntimeRecord,
  type PoolRecord,
  type ShowProfileRecord,
  type ScheduleBlockRecord,
  type SourceSyncRunRecord,
  type SourceRecord,
  type StreamDestinationRecord,
  type TeamAccessGrant,
  type TwitchConnection,
  type UserRecord,
  type UserRole,
  type OverlaySettingsRecord,
  type ManagedConfigRecord
} from "@stream247/db";

export type {
  AppState,
  AssetRecord,
  AuditEvent,
  IncidentRecord,
  ModeratorPresenceWindowRecord,
  OwnerAccount,
  PlayoutRuntimeRecord,
  PoolRecord,
  ShowProfileRecord,
  OverlaySettingsRecord,
  ManagedConfigRecord,
  ScheduleBlockRecord,
  SourceSyncRunRecord,
  SourceRecord,
  StreamDestinationRecord,
  TeamAccessGrant,
  TwitchConnection,
  UserRecord,
  UserRole
};

export { acknowledgeIncident, appendAuditEvent, findTeamGrantByLogin, findUserByEmail, findUserById, readAppState, resolveIncident, updateAppState, writeAppState };

export function getWorkspaceTimeZone(): string {
  return process.env.CHANNEL_TIMEZONE || "UTC";
}

export function getSchedulePreview(state: AppState) {
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: getWorkspaceTimeZone()
  });

  return buildSchedulePreview({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks
  });
}

export function getPresenceStatus(state: AppState) {
  return describePresenceStatus({
    activeWindows: state.presenceWindows.map((window) => ({
      actor: window.actor,
      minutes: window.minutes,
      createdAt: new Date(window.createdAt),
      expiresAt: new Date(window.expiresAt)
    })),
    now: new Date(),
    fallbackEmoteOnly: state.moderation.fallbackEmoteOnly
  });
}

export function getActivePresenceWindows(state: AppState): ModeratorPresenceWindowRecord[] {
  const now = new Date();
  return state.presenceWindows.filter((window) => new Date(window.expiresAt) > now);
}

export function getManagedConfigValue<K extends keyof ManagedConfigRecord>(
  state: AppState,
  key: K,
  envFallback = ""
): ManagedConfigRecord[K] {
  const value = state.managedConfig[key];
  return ((typeof value === "string" && value !== "" ? value : envFallback) as ManagedConfigRecord[K]);
}

export function getManagedTwitchConfig(state: AppState) {
  return {
    clientId: getManagedConfigValue(state, "twitchClientId", process.env.TWITCH_CLIENT_ID || ""),
    clientSecret: getManagedConfigValue(state, "twitchClientSecret", process.env.TWITCH_CLIENT_SECRET || ""),
    defaultCategoryId: getManagedConfigValue(
      state,
      "twitchDefaultCategoryId",
      process.env.TWITCH_DEFAULT_CATEGORY_ID || ""
    )
  };
}

export function getManagedAlertConfig(state: AppState) {
  return {
    discordWebhookUrl: getManagedConfigValue(state, "discordWebhookUrl", process.env.DISCORD_WEBHOOK_URL || ""),
    smtpHost: getManagedConfigValue(state, "smtpHost", process.env.SMTP_HOST || ""),
    smtpPort: getManagedConfigValue(state, "smtpPort", process.env.SMTP_PORT || ""),
    smtpUser: getManagedConfigValue(state, "smtpUser", process.env.SMTP_USER || ""),
    smtpPassword: getManagedConfigValue(state, "smtpPassword", process.env.SMTP_PASSWORD || ""),
    smtpFrom: getManagedConfigValue(state, "smtpFrom", process.env.SMTP_FROM || ""),
    alertEmailTo: getManagedConfigValue(state, "alertEmailTo", process.env.ALERT_EMAIL_TO || "")
  };
}

export function getCurrentScheduleItem(state: AppState) {
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: getWorkspaceTimeZone()
  });
  const occurrences = buildScheduleOccurrences({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks
  });

  return (
    occurrences.find((item) =>
      isCurrentScheduleTime({
        startTime: item.startTime,
        endTime: item.endTime,
        currentTime: scheduleMoment.time
      })
    ) ?? occurrences[0] ?? null
  );
}

export function getNextScheduleItem(state: AppState) {
  const current = getCurrentScheduleItem(state);
  const scheduleMoment = getCurrentScheduleMoment({
    now: new Date(),
    timeZone: getWorkspaceTimeZone()
  });
  const occurrences = buildScheduleOccurrences({
    date: scheduleMoment.date,
    blocks: state.scheduleBlocks
  });

  if (occurrences.length === 0) {
    return null;
  }

  if (!current) {
    return occurrences[0] ?? null;
  }

  const currentIndex = occurrences.findIndex((item) => item.key === current.key);
  if (currentIndex === -1) {
    return occurrences[0] ?? null;
  }

  return occurrences[(currentIndex + 1) % occurrences.length] ?? null;
}

export function getRecentAuditEvents(state: AppState, limit = 20): AuditEvent[] {
  return [...state.auditEvents]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}

export function getFilteredIncidents(
  state: AppState,
  filters: {
    status?: "open" | "resolved" | "all";
    severity?: IncidentRecord["severity"] | "all";
    scope?: IncidentRecord["scope"] | "all";
    query?: string;
  } = {}
): IncidentRecord[] {
  const query = (filters.query || "").trim().toLowerCase();

  return [...state.incidents]
    .filter((incident) => (filters.status && filters.status !== "all" ? incident.status === filters.status : true))
    .filter((incident) => (filters.severity && filters.severity !== "all" ? incident.severity === filters.severity : true))
    .filter((incident) => (filters.scope && filters.scope !== "all" ? incident.scope === filters.scope : true))
    .filter((incident) => {
      if (!query) {
        return true;
      }

      return [incident.title, incident.message, incident.fingerprint, incident.scope]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime());
}

export function getSourceIncidents(state: AppState, sourceId: string): IncidentRecord[] {
  const source = state.sources.find((entry) => entry.id === sourceId);
  if (!source) {
    return [];
  }

  const fingerprints = new Set<string>();
  if (source.connectorKind === "local-library" || source.id === "source-local-library") {
    fingerprints.add("source.local-library.empty");
  } else {
    fingerprints.add(`source.${source.connectorKind}.${source.id}`);
  }

  return [...state.incidents]
    .filter((incident) => {
      if (fingerprints.has(incident.fingerprint)) {
        return true;
      }

      const haystack = [incident.title, incident.message, incident.fingerprint].join(" ").toLowerCase();
      return haystack.includes(source.id.toLowerCase()) || haystack.includes(source.name.toLowerCase());
    })
    .sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime());
}

export function getSourceSyncRuns(state: AppState, sourceId: string, limit = 12): SourceSyncRunRecord[] {
  return state.sourceSyncRuns
    .filter((run) => run.sourceId === sourceId)
    .sort((left, right) => new Date(right.finishedAt || right.startedAt).getTime() - new Date(left.finishedAt || left.startedAt).getTime())
    .slice(0, limit);
}

export function getSourceAuditEvents(state: AppState, sourceId: string, limit = 12): AuditEvent[] {
  const source = state.sources.find((entry) => entry.id === sourceId);
  if (!source) {
    return [];
  }

  return [...state.auditEvents]
    .filter((event) => {
      const haystack = [event.type, event.message].join(" ").toLowerCase();
      return (
        haystack.includes(source.id.toLowerCase()) ||
        haystack.includes(source.name.toLowerCase()) ||
        (source.connectorKind === "local-library" && haystack.includes("local media library"))
      );
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}

export function getSourceReferences(state: AppState, sourceId: string) {
  const pools = state.pools.filter((pool) => pool.sourceIds.includes(sourceId));
  const poolIds = new Set(pools.map((pool) => pool.id));
  const scheduleBlocks = state.scheduleBlocks.filter((block) => block.poolId && poolIds.has(block.poolId));

  return {
    pools,
    scheduleBlocks
  };
}

export function getWorkerHealth(state: AppState) {
  const lastWorkerCycle = state.auditEvents.find((event) => event.type === "worker.cycle") ?? null;
  const lastRunAt = lastWorkerCycle?.createdAt || "";
  const ageMs = lastRunAt ? Date.now() - new Date(lastRunAt).getTime() : Number.POSITIVE_INFINITY;

  if (!lastRunAt) {
    return {
      status: "missing" as const,
      summary: "No worker heartbeat has been recorded yet.",
      lastRunAt
    };
  }

  if (ageMs > 120_000) {
    return {
      status: "stale" as const,
      summary: "Worker heartbeat is stale. Reconciliation may be stuck.",
      lastRunAt
    };
  }

  return {
    status: "healthy" as const,
    summary: "Worker heartbeat is current.",
    lastRunAt
  };
}

export function getRuntimeDriftReport(state: AppState) {
  const currentScheduleItem = getCurrentScheduleItem(state);
  const currentAsset = state.assets.find((asset) => asset.id === state.playout.currentAssetId) ?? null;
  const currentSource = currentAsset ? state.sources.find((source) => source.id === currentAsset.sourceId) ?? null : null;
  const activeDestination = state.destinations.find((entry) => entry.id === state.playout.currentDestinationId) ?? state.destinations[0] ?? null;
  const workerHealth = getWorkerHealth(state);
  const playoutHeartbeatAgeMs = state.playout.heartbeatAt ? Date.now() - new Date(state.playout.heartbeatAt).getTime() : Number.POSITIVE_INFINITY;

  const items = [
    {
      id: "worker-heartbeat",
      label: "Worker heartbeat",
      severity: workerHealth.status === "healthy" ? ("ok" as const) : ("warning" as const),
      summary: workerHealth.summary,
      detail: workerHealth.lastRunAt ? `Last cycle: ${workerHealth.lastRunAt}` : "No cycle timestamp recorded."
    },
    {
      id: "playout-heartbeat",
      label: "Playout heartbeat",
      severity:
        state.playout.status === "running" || state.playout.status === "recovering" || state.playout.status === "switching"
          ? playoutHeartbeatAgeMs > 45_000
            ? ("warning" as const)
            : ("ok" as const)
          : state.playout.status === "failed" || state.playout.status === "degraded"
            ? ("warning" as const)
            : ("info" as const),
      summary:
        state.playout.status === "failed" || state.playout.status === "degraded"
          ? `Playout is ${state.playout.status}.`
          : playoutHeartbeatAgeMs > 45_000 &&
              (state.playout.status === "running" || state.playout.status === "recovering" || state.playout.status === "switching")
            ? "Playout heartbeat is stale."
            : "Playout heartbeat is in sync.",
      detail: state.playout.heartbeatAt ? `Last heartbeat: ${state.playout.heartbeatAt}` : "No playout heartbeat recorded."
    },
    {
      id: "schedule-alignment",
      label: "Schedule alignment",
      severity:
        state.playout.overrideMode !== "schedule"
          ? ("info" as const)
          : currentScheduleItem && currentSource && currentSource.name !== currentScheduleItem.sourceName
            ? ("warning" as const)
            : currentScheduleItem && currentAsset
              ? ("ok" as const)
              : ("info" as const),
      summary:
        state.playout.overrideMode !== "schedule"
          ? `Operator override is active (${state.playout.overrideMode}).`
          : currentScheduleItem && currentSource && currentSource.name !== currentScheduleItem.sourceName
            ? "Current asset source does not match the active schedule block."
            : currentScheduleItem && currentAsset
              ? "Current asset follows the active schedule block."
              : "No current schedule block or asset to compare.",
      detail:
        currentScheduleItem && currentAsset
          ? `Schedule source: ${currentScheduleItem.sourceName} · Asset source: ${currentSource?.name || "unknown"}`
          : "Alignment check is waiting for both a schedule block and a current asset."
    },
    {
      id: "destination-readiness",
      label: "Destination readiness",
      severity: activeDestination && activeDestination.status === "ready" ? ("ok" as const) : ("warning" as const),
      summary: activeDestination ? `Destination is ${activeDestination.status}.` : "No active destination is configured.",
      detail: activeDestination
        ? `${activeDestination.name} · ${activeDestination.notes}`
        : "Configure a playout destination before expecting a stable broadcast."
    },
    {
      id: "twitch-metadata",
      label: "Twitch metadata sync",
      severity:
        state.twitch.status !== "connected"
          ? ("info" as const)
          : currentScheduleItem &&
              (state.twitch.lastSyncedTitle !== currentScheduleItem.title ||
                (currentScheduleItem.categoryName !== "" && state.twitch.lastSyncedCategoryName !== currentScheduleItem.categoryName))
            ? ("warning" as const)
            : ("ok" as const),
      summary:
        state.twitch.status !== "connected"
          ? "Twitch is not connected."
          : currentScheduleItem &&
              (state.twitch.lastSyncedTitle !== currentScheduleItem.title ||
                (currentScheduleItem.categoryName !== "" && state.twitch.lastSyncedCategoryName !== currentScheduleItem.categoryName))
            ? "Twitch metadata does not match the active schedule block yet."
            : "Twitch metadata matches the active schedule block.",
      detail:
        state.twitch.status !== "connected"
          ? "Connect the broadcaster account to enable metadata drift checks."
          : `Last synced title/category: ${state.twitch.lastSyncedTitle || "none"} · ${state.twitch.lastSyncedCategoryName || "none"}`
    }
  ];

  return {
    items,
    attentionCount: items.filter((item) => item.severity === "warning").length
  };
}
