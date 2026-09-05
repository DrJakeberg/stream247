"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";

export function SecretSettingsForm(props: {
  initialValues: {
    twitchClientId: string;
    twitchDefaultCategoryId: string;
    twitchBroadcastChannelLogin: string;
    smtpHost: string;
    smtpPort: string;
    smtpUser: string;
    smtpFrom: string;
    alertEmailTo: string;
  };
  status: {
    hasTwitchClientSecret: boolean;
    hasTwitchEventsubSecret: boolean;
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
              twitchBroadcastChannelLogin: String(formData.get("twitchBroadcastChannelLogin") || ""),
              twitchEventsubSecret: String(formData.get("twitchEventsubSecret") || ""),
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
          <span className="label label-with-info">Twitch client id<InfoTip text="Identifies the Twitch application this workspace acts through: team sign-in with Twitch, connecting the broadcaster, and every title, category and viewer-alert call to Twitch. Without it, none of those work." /></span>
          <input defaultValue={props.initialValues.twitchClientId} name="twitchClientId" />
        </label>
        <label>
          <span className="label label-with-info">Twitch client secret<InfoTip text="Proves to Twitch that requests really come from your application; it is needed alongside the client id for Twitch sign-in, the broadcaster connection and viewer-alert subscriptions. Leaving the field blank keeps the stored value." /></span>
          <input
            name="twitchClientSecret"
            placeholder={props.status.hasTwitchClientSecret ? "Stored. Leave blank to keep it." : "Not configured"}
            type="password"
          />
        </label>
      </div>
      <div className="form-grid">
        <label>
          <span className="label label-with-info">Default Twitch category id<InfoTip text="Sets the channel's category on Twitch whenever the chapter, asset or schedule block on air does not name one that Twitch recognises. When this is empty too, the category is left as it is and a warning is raised; the title still syncs." /></span>
          <input defaultValue={props.initialValues.twitchDefaultCategoryId} name="twitchDefaultCategoryId" />
        </label>
        <label>
          <span className="label label-with-info">Broadcast channel login<InfoTip text="Names the Twitch channel the audience watches when it is not the connected account's own: chat joins that room, the public watch link points there, and title and category are written to it once its broadcaster account is connected. Must be 4-25 letters, digits or underscores." /></span>
          <input
            defaultValue={props.initialValues.twitchBroadcastChannelLogin}
            name="twitchBroadcastChannelLogin"
            placeholder="Empty: same channel as the connected account"
          />
        </label>
        <label>
          <span className="label label-with-info">EventSub webhook secret<InfoTip text="A password you invent (any long random string); it is registered with Twitch when viewer-alert subscriptions are created and then used to check that each follow, subscription, cheer or channel-point event really came from Twitch. Without it no subscriptions are created; leaving the field blank keeps the stored value." /></span>
          <input
            name="twitchEventsubSecret"
            placeholder={props.status.hasTwitchEventsubSecret ? "Stored. Leave blank to keep it." : "Needed for viewer alerts"}
            type="password"
          />
        </label>
        <label>
          <span className="label label-with-info">Discord webhook url<InfoTip text="Posts operational warnings to a Discord channel: low system disk space, Twitch sync trouble, and a crashed worker, uplink or playout loop, each at most once per half hour. Leaving the field blank keeps the stored value." /></span>
          <input
            name="discordWebhookUrl"
            placeholder={props.status.hasDiscordWebhookUrl ? "Stored. Leave blank to keep it." : "Optional"}
            type="password"
          />
        </label>
      </div>
      <div className="form-grid">
        <label>
          <span className="label label-with-info">SMTP host<InfoTip text="Mail server that delivers the operational warnings (low system disk space, Twitch sync trouble, crashed loops) by email. Emails are only sent once host, port, sender and recipient are all filled in." /></span>
          <input defaultValue={props.initialValues.smtpHost} name="smtpHost" />
        </label>
        <label>
          <span className="label label-with-info">SMTP port<InfoTip text="Port of the mail server. 465 connects over TLS from the start." /></span>
          <input defaultValue={props.initialValues.smtpPort} name="smtpPort" />
        </label>
        <label>
          <span className="label label-with-info">SMTP user<InfoTip text="Account name used to log in to the mail server. Leave it empty for a server that accepts mail without a login." /></span>
          <input defaultValue={props.initialValues.smtpUser} name="smtpUser" />
        </label>
      </div>
      <div className="form-grid">
        <label>
          <span className="label label-with-info">SMTP password<InfoTip text="Password for the SMTP user; only used when a user is set. Leaving the field blank keeps the stored value." /></span>
          <input
            name="smtpPassword"
            placeholder={props.status.hasSmtpPassword ? "Stored. Leave blank to keep it." : "Optional"}
            type="password"
          />
        </label>
        <label>
          <span className="label label-with-info">SMTP from<InfoTip text="Sender address that appears on alert emails. Without it no email goes out, even when the server details are complete." /></span>
          <input defaultValue={props.initialValues.smtpFrom} name="smtpFrom" />
        </label>
        <label>
          <span className="label label-with-info">Alert email to<InfoTip text="Mailbox that receives the operational warnings: low system disk space, Twitch sync trouble, and a crashed worker, uplink or playout loop, each at most once per half hour. Leave it empty to send alerts to Discord only." /></span>
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
