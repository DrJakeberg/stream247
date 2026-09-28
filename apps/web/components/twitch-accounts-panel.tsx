"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import type { TwitchAccountsTexts } from "@/lib/twitch-account-texts";

// The two Twitch accounts side by side (2.1, M69): the broadcast channel (where the stream key sends
// video and viewers watch) and the bot account (chat and moderation). Every sentence comes from
// getTwitchAccountsTexts, which is where the wording is tested.

type SaveField = "broadcastChannelLogin" | "botLogin";

function LoginForm(props: {
  field: SaveField;
  label: string;
  info: string;
  defaultValue: string;
  placeholder: string;
  submitLabel: string;
  disabled: boolean;
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
        const value = String(new FormData(event.currentTarget).get(props.field) || "");
        startTransition(async () => {
          const response = await fetch("/api/settings/twitch-accounts", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [props.field]: value })
          });
          const payload = (await response.json().catch(() => ({}))) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not save.");
            return;
          }
          setMessage(payload.message ?? "Saved.");
          router.refresh();
        });
      }}
    >
      {/* The field comes first inside its label, the button after the label: a button inside an
          implicit label before the field would take over the field's accessible name. */}
      <label>
        <span className="label label-with-info">
          {props.label}
          <InfoTip text={props.info} />
        </span>
        <input defaultValue={props.defaultValue} disabled={props.disabled} name={props.field} placeholder={props.placeholder} />
      </label>
      <button className="button" disabled={props.disabled || isPending} type="submit">
        {isPending ? "Saving…" : props.submitLabel}
      </button>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
    </form>
  );
}

function CapabilityList(props: { title: string; entries: Array<{ label: string; available: boolean; statusText: string }> }) {
  return (
    <div className="list">
      <strong>{props.title}</strong>
      {props.entries.map((entry) => (
        <div className="item" key={entry.label}>
          <span className={entry.available ? "badge badge-ready" : "badge badge-action"}>
            {entry.available ? "Active" : "Waiting"}
          </span>{" "}
          {entry.label}
          {entry.available ? null : <div className="subtle">{entry.statusText}</div>}
        </div>
      ))}
    </div>
  );
}

function OwnerDisconnectButton(props: { channel: string; disabled: boolean }) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <div>
      <button
        className="button button-secondary"
        disabled={props.disabled || isPending}
        onClick={() => {
          setError("");
          startTransition(async () => {
            const response = await fetch("/api/integrations/twitch/disconnect-broadcaster", { method: "POST" });
            if (!response.ok) {
              const payload = (await response.json().catch(() => ({}))) as { message?: string };
              setError(payload.message ?? "Could not disconnect the channel owner.");
              return;
            }
            router.refresh();
          });
        }}
        type="button"
      >
        Disconnect channel owner ({props.channel})
      </button>
      {error ? <p className="danger">{error}</p> : null}
    </div>
  );
}

export function TwitchAccountsPanel(props: {
  texts: TwitchAccountsTexts;
  // The stored settings only (not env, not the bot fallback), so saving never writes an assumption.
  saved: { broadcastChannelLogin: string; botLogin: string };
  channelLogin: string;
  botLogin: string;
  // Link targets of the OAuth start routes; null when the Twitch app is not configured yet.
  botConnectHref: string | null;
  ownerConnectHref: string | null;
  botConnected: boolean;
  canEdit: boolean;
}) {
  const { texts } = props;
  const owner = texts.channel.owner;

  return (
    <div className="stack-form" id="twitch-accounts">
      <p className={texts.modeLine.tone === "warn" ? "warning" : "subtle"}>{texts.modeLine.text}</p>
      <div className="grid two">
        <section className="item stack-form" aria-label="Broadcast channel">
          <strong>{texts.channel.title}</strong>
          <div className="subtle">{texts.channel.subtitle}</div>
          <LoginForm
            defaultValue={props.saved.broadcastChannelLogin}
            disabled={!props.canEdit}
            field="broadcastChannelLogin"
            info="The Twitch login of the channel viewers watch. Chat joins this room; the watch link, live status, emote-only, title, category, schedule and viewer alerts all target it. Naming it is enough — its own account only has to connect for title, category, schedule and sub, cheer and channel-points alerts. Empty means the bot account's own channel."
            label="Broadcast channel login"
            placeholder="e.g. yourchannel"
            submitLabel="Save broadcast channel"
          />
          <div className="subtle">{texts.channel.sourceText}</div>
          <div>
            <strong>{texts.channel.liveText}</strong>
            {texts.channel.liveHint ? <div className="subtle">{texts.channel.liveHint}</div> : null}
          </div>
          {owner ? (
            <div className="stack-form">
              <strong>Channel owner connection (optional)</strong>
              <div>{owner.statusText}</div>
              {owner.lastRejection ? <div className="warning">{owner.lastRejection}</div> : null}
              {owner.action === "connect" && props.ownerConnectHref ? (
                <a className="button" href={props.ownerConnectHref}>
                  Connect as {props.channelLogin}
                </a>
              ) : null}
              {owner.action === "connect" && !props.ownerConnectHref ? (
                <div className="subtle">Save the Twitch client id and secret under Managed credentials to connect the channel owner.</div>
              ) : null}
              {owner.action === "disconnect" ? <OwnerDisconnectButton channel={props.channelLogin} disabled={!props.canEdit} /> : null}
              <div className="subtle">{owner.hint}</div>
              <CapabilityList entries={owner.needs} title="Needs the channel owner" />
            </div>
          ) : null}
        </section>
        <section className="item stack-form" aria-label="Bot account">
          <strong>{texts.bot.title}</strong>
          <div className="subtle">{texts.bot.subtitle}</div>
          <LoginForm
            defaultValue={props.saved.botLogin}
            disabled={!props.canEdit}
            field="botLogin"
            info="When set, connecting the bot account accepts only this Twitch login, and the panel warns if another account is connected. The bot account also signs in to Stream247 as owner. Empty accepts any account."
            label="Bot account login"
            placeholder={props.botLogin ? `Connected now: ${props.botLogin}` : "e.g. yourbot"}
            submitLabel="Save bot account"
          />
          <div>{texts.bot.statusText}</div>
          {texts.bot.warning ? <div className="warning">{texts.bot.warning}</div> : null}
          {texts.bot.lastRejection ? <div className="warning">{texts.bot.lastRejection}</div> : null}
          {props.botConnectHref ? (
            <a className="button" href={props.botConnectHref}>
              {props.botConnected ? "Reconnect bot account" : "Connect bot account"}
            </a>
          ) : (
            <div className="subtle">Save the Twitch client id and secret under Managed credentials to connect accounts.</div>
          )}
          <CapabilityList entries={texts.bot.runs} title="Runs through the bot account" />
        </section>
      </div>
      <p className="subtle">{texts.sourcesNote}</p>
    </div>
  );
}
