export const dynamic = "force-dynamic";

import {
  resolveAlertsRuntimeEnabled,
  resolveAssetRetentionConfig,
  resolveChatOverlayRuntimeEnabled,
  resolveDiskWatermarkConfig,
  resolveDurationBoundMarginSeconds,
  resolveFeedAudioWatchdogMs,
  resolvePlayoutFeedWatchdogMs,
  resolvePlayoutReconnectTuning,
  resolveProgramFeedTuning,
  resolveSystemVolumeWatermarkConfig,
  resolveSourceLayerRuntimeEnabled,
  resolveSourceLiveEnabled,
  resolveSourceLiveGainPercent,
  resolveTwitchScheduleSyncEnabled,
  resolveUplinkWatchdogMs,
  resolveVodCacheTuning
} from "@stream247/core";
import { AdminPageHeader } from "@/components/admin-page-header";
import { Panel } from "@/components/panel";
import { ChannelBlueprintForm } from "@/components/channel-blueprint-form";
import { DiskWatermarkForm } from "@/components/disk-watermark-form";
import { FeatureSwitchesForm } from "@/components/feature-switches-form";
import { FeedTuningForm } from "@/components/feed-tuning-form";
import { RelayAccessForm } from "@/components/relay-access-form";
import { ReplayCacheForm } from "@/components/replay-cache-form";
import { SecretSettingsForm } from "@/components/secret-settings-form";
import { SourceLiveSoundForm } from "@/components/source-live-sound-form";
import { TwoFactorSettingsForm } from "@/components/two-factor-settings-form";
import { WatchdogThresholdsForm } from "@/components/watchdog-thresholds-form";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { getSystemReadiness } from "@/lib/server/readiness";
import { getManagedAlertConfig, getManagedTwitchConfig, readAppState } from "@/lib/server/state";
import { getUpdateCenterState } from "@/lib/server/update-center";

export default async function SettingsPage() {
  const state = await readAppState();
  const user = await getAuthenticatedUser();
  const twitchConfig = getManagedTwitchConfig(state);
  const alertConfig = getManagedAlertConfig(state);
  const readiness = await getSystemReadiness();
  const updateCenter = await getUpdateCenterState();
  // Env-only resolutions: what "follow the server" means for each folded operations group.
  const diskFallback = resolveDiskWatermarkConfig(null, process.env);
  const systemVolumeFallback = resolveSystemVolumeWatermarkConfig(null, process.env);
  const retentionFallback = resolveAssetRetentionConfig(null, process.env);
  const vodCacheFallback = resolveVodCacheTuning(null, process.env);
  const feedAudioFallback = resolveFeedAudioWatchdogMs(null, process.env);
  const feedStallFallback = resolvePlayoutFeedWatchdogMs(null, process.env);
  const uplinkFallback = resolveUplinkWatchdogMs(null, process.env);
  const reconnectFallback = resolvePlayoutReconnectTuning(null, process.env);
  const programFeedFallback = resolveProgramFeedTuning(null, process.env);
  const toGb = (bytes: number) => Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10;
  // Same roles the reveal route enforces, so the surface and the endpoint agree about who this is
  // for. Kept as a plain check rather than requireRoles(), which redirects: the rest of this page
  // is legitimately readable by any signed-in account and must stay that way.
  const mayRevealRelayAccess = user?.role === "owner" || user?.role === "admin";

  return (
    <div className="stack-form">
      <AdminPageHeader
        description="Settings change workspace-wide behavior: release posture, managed credentials, security defaults, and portable blueprints. Live channel actions stay in Live."
        eyebrow="Settings"
        title="Manage workspace security, credentials, releases, and blueprints."
      />

      <div className="grid two">
        <Panel title="Update center" eyebrow="Release">
          <p className="subtle">
            Keep production installs pinned to explicit image tags. Use the release preflight and upgrade rehearsal
            scripts before changing a live system.
          </p>
          <div className="list">
            {/* Build identity, not design: the version comes from package.json and the image tags
                from the environment, so both differ between a developer's machine, CI and
                production, and the version moves on every release. Marked so the visual baseline
                can exclude it — otherwise this snapshot rots on every version bump. */}
            <div className="item" data-build-info>
              <strong>Release channel</strong>
              <div className="subtle">
                App {updateCenter.appVersion} · channel {updateCenter.channel} · images{" "}
                {updateCenter.alignedImages ? "aligned" : "not aligned"}
              </div>
            </div>
            <div className="item" data-build-info>
              <strong>Image tags</strong>
              <div className="subtle">web: {updateCenter.imageTags.web || "unset"}</div>
              <div className="subtle">worker: {updateCenter.imageTags.worker || "unset"}</div>
              <div className="subtle">playout: {updateCenter.imageTags.playout || "unset"}</div>
            </div>
            <div className="item">
              <strong>Production checklist</strong>
              <div className="subtle">{updateCenter.pinnedImages ? "Images are pinned away from latest." : "Production should not run on latest image tags."}</div>
              <div className="subtle">{readiness.broadcastReady ? "Everything needed to go on air is ready." : "Something needed to go on air is missing."}</div>
              <div className="subtle">Run `pnpm release:preflight` before upgrades and `pnpm release:rehearse vX.Y.Z` before major changes.</div>
            </div>
            <div className="item">
              <strong>Runbooks</strong>
              <div className="subtle">See `docs/upgrading.md`, `docs/backup-and-restore.md`, `docs/operations.md`, and `docs/versioning.md`.</div>
            </div>
          </div>
        </Panel>

        <Panel title="Managed credentials" eyebrow="Credentials">
          <p className="subtle">
            Stream247 can now store integration credentials encrypted at rest in PostgreSQL. Environment variables
            still work as fallback values, but these settings let you manage Twitch and alert credentials from the UI.
          </p>
          <SecretSettingsForm
            initialValues={{
              twitchClientId: twitchConfig.clientId,
              twitchDefaultCategoryId: twitchConfig.defaultCategoryId,
              twitchBroadcastChannelLogin: twitchConfig.broadcastChannelLogin,
              smtpHost: alertConfig.smtpHost,
              smtpPort: alertConfig.smtpPort,
              smtpUser: alertConfig.smtpUser,
              smtpFrom: alertConfig.smtpFrom,
              alertEmailTo: alertConfig.alertEmailTo
            }}
            status={{
              hasTwitchClientSecret: Boolean(state.managedConfig.twitchClientSecret || process.env.TWITCH_CLIENT_SECRET),
              hasTwitchEventsubSecret: Boolean(state.managedConfig.twitchEventsubSecret || process.env.TWITCH_EVENTSUB_SECRET),
              hasDiscordWebhookUrl: Boolean(state.managedConfig.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL),
              hasSmtpPassword: Boolean(state.managedConfig.smtpPassword || process.env.SMTP_PASSWORD)
            }}
          />
        </Panel>

        <Panel title="Operations" eyebrow="Runtime">
          <p className="subtle">
            Operational decisions that used to live only in the server environment. Every group folds away
            because it is set once and then left alone; a value saved here wins over the environment.
          </p>
          <DiskWatermarkForm
            initialValues={{
              diskWatermarkEnabled: state.managedConfig.diskWatermarkEnabled,
              diskWatermarkTriggerPercent: state.managedConfig.diskWatermarkTriggerPercent,
              diskWatermarkRecoverPercent: state.managedConfig.diskWatermarkRecoverPercent,
              systemVolumeTriggerPercent: state.managedConfig.systemVolumeTriggerPercent,
              systemVolumeRecoverPercent: state.managedConfig.systemVolumeRecoverPercent,
              assetRetentionEnabled: state.managedConfig.assetRetentionEnabled,
              assetRetentionProtectionDays: state.managedConfig.assetRetentionProtectionDays
            }}
            fallback={{
              enabled: diskFallback.enabled,
              triggerPercent: Math.round(diskFallback.triggerFreeRatio * 100),
              recoverPercent: Math.round(diskFallback.recoverFreeRatio * 100),
              systemTriggerPercent: Math.round(systemVolumeFallback.triggerFreeRatio * 100),
              systemRecoverPercent: Math.round(systemVolumeFallback.recoverFreeRatio * 100),
              retentionEnabled: retentionFallback.enabled,
              retentionDays: retentionFallback.protectionDays
            }}
          />
          <FeatureSwitchesForm
            initialValues={{
              streamChatOverlayEnabled: state.managedConfig.streamChatOverlayEnabled,
              streamAlertsEnabled: state.managedConfig.streamAlertsEnabled,
              twitchScheduleSyncEnabled: state.managedConfig.twitchScheduleSyncEnabled,
              sourceLayerEnabled: state.managedConfig.sourceLayerEnabled,
              sourceLiveEnabled: state.managedConfig.sourceLiveEnabled
            }}
            fallback={{
              streamChatOverlayEnabled: resolveChatOverlayRuntimeEnabled(null, process.env),
              streamAlertsEnabled: resolveAlertsRuntimeEnabled(null, process.env),
              twitchScheduleSyncEnabled: resolveTwitchScheduleSyncEnabled(null, process.env),
              sourceLayerEnabled: resolveSourceLayerRuntimeEnabled(null, process.env),
              sourceLiveEnabled: resolveSourceLiveEnabled(null, process.env)
            }}
          />
          <SourceLiveSoundForm
            initialValue={state.managedConfig.sourceLiveGainPercent}
            fallback={resolveSourceLiveGainPercent(null, process.env)}
          />
          <ReplayCacheForm
            initialValues={{
              vodCacheEnabled: state.managedConfig.vodCacheEnabled,
              vodCacheAllowRemoteFallback: state.managedConfig.vodCacheAllowRemoteFallback,
              vodCacheMaxGb: state.managedConfig.vodCacheMaxGb,
              vodCacheMinFreeGb: state.managedConfig.vodCacheMinFreeGb,
              vodCacheMaxAssetGb: state.managedConfig.vodCacheMaxAssetGb,
              vodCacheRetentionHours: state.managedConfig.vodCacheRetentionHours,
              vodCachePartialMaxAgeHours: state.managedConfig.vodCachePartialMaxAgeHours,
              vodCacheDownloadTimeoutSeconds: state.managedConfig.vodCacheDownloadTimeoutSeconds,
              vodCacheFailureCooldownSeconds: state.managedConfig.vodCacheFailureCooldownSeconds,
              vodCacheLimitRate: state.managedConfig.vodCacheLimitRate
            }}
            fallback={{
              enabled: vodCacheFallback.enabled,
              allowRemoteFallback: vodCacheFallback.allowRemoteFallback,
              maxGb: toGb(vodCacheFallback.maxCacheBytes),
              minFreeGb: toGb(vodCacheFallback.minFreeBytes),
              maxAssetGb: toGb(vodCacheFallback.maxAssetBytes),
              retentionHours: vodCacheFallback.retentionHours,
              partialMaxAgeHours: vodCacheFallback.partialMaxAgeHours,
              downloadTimeoutSeconds: vodCacheFallback.downloadTimeoutSeconds,
              failureCooldownSeconds: vodCacheFallback.failureCooldownSeconds,
              limitRate: vodCacheFallback.limitRate
            }}
          />
          <WatchdogThresholdsForm
            initialValues={{
              feedAudioSilenceSeconds: state.managedConfig.feedAudioSilenceSeconds,
              feedAudioGraceSeconds: state.managedConfig.feedAudioGraceSeconds,
              feedStallTimeoutSeconds: state.managedConfig.feedStallTimeoutSeconds,
              feedStallGraceSeconds: state.managedConfig.feedStallGraceSeconds,
              uplinkStallTimeoutSeconds: state.managedConfig.uplinkStallTimeoutSeconds,
              uplinkStallGraceSeconds: state.managedConfig.uplinkStallGraceSeconds,
              uplinkNoProgressRestartSeconds: state.managedConfig.uplinkNoProgressRestartSeconds,
              durationBoundMarginSeconds: state.managedConfig.durationBoundMarginSeconds
            }}
            fallback={{
              feedAudioSilenceSeconds: Math.round(feedAudioFallback.silenceMs / 1000),
              feedAudioGraceSeconds: Math.round(feedAudioFallback.graceMs / 1000),
              feedStallTimeoutSeconds: Math.round(feedStallFallback.staleMs / 1000),
              feedStallGraceSeconds: Math.round(feedStallFallback.graceMs / 1000),
              uplinkStallTimeoutSeconds: Math.round(uplinkFallback.stallMs / 1000),
              uplinkStallGraceSeconds: Math.round(uplinkFallback.graceMs / 1000),
              uplinkNoProgressRestartSeconds: Math.round(uplinkFallback.noProgressRestartMs / 1000),
              durationBoundMarginSeconds: resolveDurationBoundMarginSeconds(null, process.env)
            }}
          />
          <FeedTuningForm
            initialValues={{
              playoutReconnectHours: state.managedConfig.playoutReconnectHours,
              playoutReconnectWindowSeconds: state.managedConfig.playoutReconnectWindowSeconds,
              programFeedTargetSeconds: state.managedConfig.programFeedTargetSeconds,
              programFeedListSize: state.managedConfig.programFeedListSize,
              programFeedFailoverSeconds: state.managedConfig.programFeedFailoverSeconds
            }}
            fallback={{
              playoutReconnectHours: reconnectFallback.intervalHours,
              playoutReconnectWindowSeconds: reconnectFallback.windowSeconds,
              programFeedTargetSeconds: programFeedFallback.targetSeconds,
              programFeedListSize: programFeedFallback.listSize,
              programFeedFailoverSeconds: programFeedFallback.failoverSeconds
            }}
          />
          {/* No initial values and no fallback: this group ships a button and nothing else, so the
              relay access key is absent from the rendered page and only ever arrives through the
              deliberate, audited, rate-limited reveal.

              Rendered only for owner/admin. This page itself has no role gate — the admin layout
              only requires a session — so without this condition every signed-in account, viewer
              and moderator included, would be shown a button labelled as the way to obtain the
              relay's credentials. The key never leaked (the route answers them 403), but a surface
              should not advertise the existence and retrieval path of a credential to people who
              may not have it. */}
          {mayRevealRelayAccess ? <RelayAccessForm /> : null}
        </Panel>

        <Panel title="Local account security" eyebrow="Security">
          <p className="subtle">
            Optional two-factor authentication is available for local accounts. Team members signing in through Twitch
            SSO are not affected by this setting.
          </p>
          <TwoFactorSettingsForm
            currentUser={user
              ? {
                  email: user.email,
                  authProvider: user.authProvider,
                  twoFactorEnabled: Boolean(user.twoFactorEnabled),
                  hasPendingSecret: Boolean(user.twoFactorSecret && !user.twoFactorEnabled),
                  confirmedAt: user.twoFactorConfirmedAt || ""
                }
              : null}
          />
        </Panel>

        <Panel title="Admin defaults" eyebrow="Settings">
          <div className="list">
            <div className="item">
              <strong>Twitch OAuth</strong>
              <div className="subtle">
                {twitchConfig.clientId
                  ? "Client id is available for Twitch OAuth and SSO."
                  : "Twitch OAuth is not ready until a client id and secret exist in settings or .env."}
              </div>
            </div>
            <div className="item">
              <strong>Alert delivery</strong>
              <div className="subtle">
                {alertConfig.discordWebhookUrl || alertConfig.smtpHost
                  ? "At least one managed or fallback alert delivery path is configured."
                  : "Discord and SMTP alerts are currently unconfigured."}
              </div>
            </div>
            <div className="item">
              <strong>Fallback model</strong>
              <div className="subtle">
                Empty fields do not wipe existing secrets. Stream247 keeps the stored value, or falls back to `.env` when
                no managed value exists.
              </div>
            </div>
            <div className="item">
              <strong>Operational stance</strong>
              <div className="subtle">
                Multi-output destinations, release preflight, upgrade rehearsal, and fresh-boot CI are now built into
                the default operating model.
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Channel Blueprints" eyebrow="Portability">
          <ChannelBlueprintForm />
        </Panel>
      </div>
    </div>
  );
}
