"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function SecretSettingsForm(props: {
  initialValues: {
    twitchClientId: string;
    twitchDefaultCategoryId: string;
    smtpHost: string;
    smtpPort: string;
    smtpUser: string;
    smtpFrom: string;
    alertEmailTo: string;
  };
  status: {
    hasTwitchClientSecret: boolean;
    hasDiscordWebhookUrl: boolean;
    hasSmtpPassword: boolean;
  };
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setMessage("");

        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const response = await fetch("/api/settings/secrets", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              twitchClientId: String(formData.get("twitchClientId") || ""),
              twitchClientSecret: String(formData.get("twitchClientSecret") || ""),
              twitchDefaultCategoryId: String(formData.get("twitchDefaultCategoryId") || ""),
              discordWebhookUrl: String(formData.get("discordWebhookUrl") || ""),
              smtpHost: String(formData.get("smtpHost") || ""),
              smtpPort: String(formData.get("smtpPort") || ""),
              smtpUser: String(formData.get("smtpUser") || ""),
              smtpPassword: String(formData.get("smtpPassword") || ""),
              smtpFrom: String(formData.get("smtpFrom") || ""),
              alertEmailTo: String(formData.get("alertEmailTo") || "")
            })
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not update managed settings.");
            return;
          }

          setMessage(payload.message ?? "Managed settings updated.");
          router.refresh();
        });
      }}
    >
      <div className="form-grid">
        <label>
          <span className="label">Twitch client id</span>
          <input defaultValue={props.initialValues.twitchClientId} name="twitchClientId" />
        </label>
        <label>
          <span className="label">Twitch client secret</span>
          <input
            name="twitchClientSecret"
            placeholder={props.status.hasTwitchClientSecret ? "Stored. Leave blank to keep it." : "Not configured"}
            type="password"
          />
        </label>
      </div>
      <div className="form-grid">
        <label>
          <span className="label">Default Twitch category id</span>
          <input defaultValue={props.initialValues.twitchDefaultCategoryId} name="twitchDefaultCategoryId" />
        </label>
        <label>
          <span className="label">Discord webhook url</span>
          <input
            name="discordWebhookUrl"
            placeholder={props.status.hasDiscordWebhookUrl ? "Stored. Leave blank to keep it." : "Optional"}
            type="password"
          />
        </label>
      </div>
      <div className="form-grid">
        <label>
          <span className="label">SMTP host</span>
          <input defaultValue={props.initialValues.smtpHost} name="smtpHost" />
        </label>
        <label>
          <span className="label">SMTP port</span>
          <input defaultValue={props.initialValues.smtpPort} name="smtpPort" />
        </label>
        <label>
          <span className="label">SMTP user</span>
          <input defaultValue={props.initialValues.smtpUser} name="smtpUser" />
        </label>
      </div>
      <div className="form-grid">
        <label>
          <span className="label">SMTP password</span>
          <input
            name="smtpPassword"
            placeholder={props.status.hasSmtpPassword ? "Stored. Leave blank to keep it." : "Optional"}
            type="password"
          />
        </label>
        <label>
          <span className="label">SMTP from</span>
          <input defaultValue={props.initialValues.smtpFrom} name="smtpFrom" />
        </label>
        <label>
          <span className="label">Alert email to</span>
          <input defaultValue={props.initialValues.alertEmailTo} name="alertEmailTo" />
        </label>
      </div>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save encrypted settings"}
      </button>
    </form>
  );
}
