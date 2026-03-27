export const dynamic = "force-dynamic";

import { Panel } from "@/components/panel";
import { SecretSettingsForm } from "@/components/secret-settings-form";
import { getManagedAlertConfig, getManagedTwitchConfig, readAppState } from "@/lib/server/state";

export default async function SettingsPage() {
  const state = await readAppState();
  const twitchConfig = getManagedTwitchConfig(state);
  const alertConfig = getManagedAlertConfig(state);

  return (
    <div className="grid two">
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
        </div>
      </Panel>
    </div>
  );
}
