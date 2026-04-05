export const dynamic = "force-dynamic";

import { Panel } from "@/components/panel";
import { ChannelBlueprintForm } from "@/components/channel-blueprint-form";
import { SecretSettingsForm } from "@/components/secret-settings-form";
import { TwoFactorSettingsForm } from "@/components/two-factor-settings-form";
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

  return (
    <div className="grid two">
      <Panel title="Update center" eyebrow="Operations">
        <p className="subtle">
          Keep production installs pinned to explicit image tags. Use the release preflight and upgrade rehearsal
          scripts before changing a live system.
        </p>
        <div className="list">
          <div className="item">
            <strong>Release channel</strong>
            <div className="subtle">
              App {updateCenter.appVersion} · channel {updateCenter.channel} · images{" "}
              {updateCenter.alignedImages ? "aligned" : "not aligned"}
            </div>
          </div>
          <div className="item">
            <strong>Image tags</strong>
            <div className="subtle">web: {updateCenter.imageTags.web || "unset"}</div>
            <div className="subtle">worker: {updateCenter.imageTags.worker || "unset"}</div>
            <div className="subtle">playout: {updateCenter.imageTags.playout || "unset"}</div>
          </div>
          <div className="item">
            <strong>Production checklist</strong>
            <div className="subtle">{updateCenter.pinnedImages ? "Images are pinned away from latest." : "Production should not run on latest image tags."}</div>
            <div className="subtle">{readiness.broadcastReady ? "Broadcast readiness is currently green." : "Broadcast readiness is currently degraded."}</div>
            <div className="subtle">Run `pnpm release:preflight` before upgrades and `pnpm release:rehearse vX.Y.Z` before major changes.</div>
          </div>
          <div className="item">
            <strong>Runbooks</strong>
            <div className="subtle">See `docs/upgrading.md`, `docs/backup-and-restore.md`, `docs/operations.md`, and `docs/versioning.md`.</div>
          </div>
        </div>
      </Panel>

      <Panel title="Managed credentials" eyebrow="Settings">
        <p className="subtle">
          Stream247 can now store integration credentials encrypted at rest in PostgreSQL. Environment variables still
          work as fallback values, but these settings let you manage Twitch and alert credentials from the UI.
        </p>
        <SecretSettingsForm
          initialValues={{
            twitchClientId: twitchConfig.clientId,
            twitchDefaultCategoryId: twitchConfig.defaultCategoryId,
            smtpHost: alertConfig.smtpHost,
            smtpPort: alertConfig.smtpPort,
            smtpUser: alertConfig.smtpUser,
            smtpFrom: alertConfig.smtpFrom,
            alertEmailTo: alertConfig.alertEmailTo
          }}
          status={{
            hasTwitchClientSecret: Boolean(state.managedConfig.twitchClientSecret || process.env.TWITCH_CLIENT_SECRET),
            hasDiscordWebhookUrl: Boolean(state.managedConfig.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL),
            hasSmtpPassword: Boolean(state.managedConfig.smtpPassword || process.env.SMTP_PASSWORD)
          }}
        />
      </Panel>

      <Panel title="Local account security" eyebrow="Access">
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

      <Panel title="Current behavior" eyebrow="Secrets">
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

      <Panel title="Channel Blueprints" eyebrow="Library">
        <ChannelBlueprintForm />
      </Panel>
    </div>
  );
}
