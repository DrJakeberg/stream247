"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import type { TwitchAccountsTexts, TwitchCapabilityLine } from "@/lib/twitch-account-texts";

// The two Twitch accounts side by side (2.1, M69): the broadcast channel (where the stream key sends
// video and viewers watch) and the bot account (chat and moderation). Every sentence comes from
// getTwitchAccountsTexts, which is where the wording is tested.

// One form for both logins: they are one decision (which account is which), and a single save keeps
// the settings page at one save per panel (tests/e2e/control-density.spec.ts).
function AccountsForm(props: {
  saved: { broadcastChannelLogin: string; botLogin: string };
  botPlaceholder: string;
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
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const response = await fetch("/api/settings/twitch-accounts", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              broadcastChannelLogin: String(formData.get("broadcastChannelLogin") || ""),
              botLogin: String(formData.get("botLogin") || "")
            })
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
      {/* Fields inside their labels, the button after the labels: a button inside an implicit label
          before the field would take over the field's accessible name. */}
      <div className="form-grid">
        <label>
          <span className="label label-with-info">
            Broadcast channel login
            <InfoTip text="The Twitch login of the channel viewers watch; its stream key receives the video. Chat joins this room; the watch link, live status, emote-only, title, category, schedule and viewer alerts all target it. Naming it is enough — its own account only has to connect for title, category, schedule and sub, cheer and channel-points alerts. Empty uses TWITCH_BROADCAST_CHANNEL_LOGIN when the server sets it, otherwise the bot account's own channel." />
          </span>
          <input defaultValue={props.saved.broadcastChannelLogin} disabled={props.disabled} name="broadcastChannelLogin" placeholder="e.g. yourchannel" />
        </label>
        <label>
          <span className="label label-with-info">
            Bot account login
            <InfoTip text="The account Stream247 signs in as for chat and moderation. When set, connecting the bot account accepts only this Twitch login, and the panel warns if another account is connected. The bot account also signs in to Stream247 as owner. Empty uses TWITCH_BOT_LOGIN when the server sets it, otherwise any account is accepted." />
          </span>
          <input defaultValue={props.saved.botLogin} disabled={props.disabled} name="botLogin" placeholder={props.botPlaceholder} />
        </label>
      </div>
      <button className="button" disabled={props.disabled || isPending} type="submit">
        {isPending ? "Saving…" : "Save Twitch accounts"}
      </button>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
    </form>
  );
}

const BADGE = {
  active: { className: "badge badge-ready", label: "Active" },
  waiting: { className: "badge badge-action", label: "Waiting" },
  off: { className: "badge badge-optional", label: "Off" }
} as const;

function CapabilityList(props: { title: string; entries: TwitchCapabilityLine[] }) {
  return (
    <div className="list">
      <strong>{props.title}</strong>
      {props.entries.map((entry) => (
        <div className="item" key={entry.label}>
          <span className={BADGE[entry.state].className}>{BADGE[entry.state].label}</span> {entry.label}
          {entry.state === "active" ? null : <div className="subtle">{entry.statusText}</div>}
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
  // Why the connect links are missing, naming the missing setting; "" when they work.
  connectBlocker: string;
  botConnected: boolean;
  canEdit: boolean;
}) {
  const { texts } = props;
  const owner = texts.channel.owner;

  return (
    <div className="stack-form" id="twitch-accounts">
      <p className={texts.modeLine.tone === "warn" ? "warning" : "subtle"}>{texts.modeLine.text}</p>
      <AccountsForm
        botPlaceholder={props.botLogin ? `Connected now: ${props.botLogin}` : "e.g. yourbot"}
        disabled={!props.canEdit}
        saved={props.saved}
      />
      <div className="grid two">
        <section className="item stack-form" aria-label="Broadcast channel">
          <strong>{texts.channel.title}</strong>
          <div className="subtle">{texts.channel.subtitle}</div>
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
                <a className="button button-secondary" href={props.ownerConnectHref}>
                  Connect as {props.channelLogin}
                </a>
              ) : null}
              {owner.action === "connect" && !props.ownerConnectHref ? <div className="subtle">{props.connectBlocker}</div> : null}
              {owner.action === "disconnect" ? <OwnerDisconnectButton channel={props.channelLogin} disabled={!props.canEdit} /> : null}
              <div className="subtle">{owner.hint}</div>
              <CapabilityList entries={owner.needs} title="Needs the channel owner" />
            </div>
          ) : null}
        </section>
        <section className="item stack-form" aria-label="Bot account">
          <strong>{texts.bot.title}</strong>
          <div className="subtle">{texts.bot.subtitle}</div>
          <div className="subtle">{texts.bot.sourceText}</div>
          <div>{texts.bot.statusText}</div>
          {texts.bot.warning ? <div className="warning">{texts.bot.warning}</div> : null}
          {texts.bot.lastRejection ? <div className="warning">{texts.bot.lastRejection}</div> : null}
          {props.botConnectHref ? (
            <a className="button button-secondary" href={props.botConnectHref}>
              {props.botConnected ? "Reconnect bot account" : "Connect bot account"}
            </a>
          ) : (
            <div className="subtle">{props.connectBlocker}</div>
          )}
          <CapabilityList entries={texts.bot.runs} title="Runs through the bot account" />
        </section>
      </div>
      <p className="subtle">{texts.sourcesNote}</p>
    </div>
  );
}
