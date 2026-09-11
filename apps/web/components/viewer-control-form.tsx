"use client";

import type { ChatInteractionSettingsRecord } from "@stream247/db";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";

type ViewerControlFormProps = {
  settings: ChatInteractionSettingsRecord;
};

/**
 * Viewer control hands programme decisions to anonymous chat, so the form is explicit about what
 * each switch actually gives away rather than presenting bare toggles. The server re-validates
 * every bound regardless of what this sends; the min/max here exist to make the safe range
 * visible, not to enforce it.
 */
export function ViewerControlForm({ settings }: ViewerControlFormProps) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [votingEnabled, setVotingEnabled] = useState(settings.votingEnabled);
  const [requestsEnabled, setRequestsEnabled] = useState(settings.requestsEnabled);
  const [skipEnabled, setSkipEnabled] = useState(settings.skipEnabled);
  const [voteDurationSeconds, setVoteDurationSeconds] = useState(String(settings.voteDurationSeconds));
  const [voteOptionCount, setVoteOptionCount] = useState(String(settings.voteOptionCount));
  const [voteMinimumVoters, setVoteMinimumVoters] = useState(String(settings.voteMinimumVoters));
  const [requestCooldownSeconds, setRequestCooldownSeconds] = useState(String(settings.requestCooldownSeconds));
  const [requestQueueLimit, setRequestQueueLimit] = useState(String(settings.requestQueueLimit));
  const [skipThresholdPercent, setSkipThresholdPercent] = useState(String(Math.round(settings.skipThresholdRatio * 100)));
  const [skipMinimumVotes, setSkipMinimumVotes] = useState(String(settings.skipMinimumVotes));
  const [skipWindowSeconds, setSkipWindowSeconds] = useState(String(settings.skipWindowSeconds));
  const [requestCommand, setRequestCommand] = useState(settings.requestCommand);
  const [skipCommand, setSkipCommand] = useState(settings.skipCommand);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { pushToast } = useToast();

  async function save() {
    const response = await fetch("/api/chat-interaction/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled,
        votingEnabled,
        requestsEnabled,
        skipEnabled,
        voteDurationSeconds: Number(voteDurationSeconds),
        voteOptionCount: Number(voteOptionCount),
        voteMinimumVoters: Number(voteMinimumVoters),
        requestCooldownSeconds: Number(requestCooldownSeconds),
        requestQueueLimit: Number(requestQueueLimit),
        // Stored as a ratio; shown as a percentage because that is how operators think about it.
        skipThresholdRatio: Number(skipThresholdPercent) / 100,
        skipMinimumVotes: Number(skipMinimumVotes),
        skipWindowSeconds: Number(skipWindowSeconds),
        requestCommand,
        skipCommand
      })
    });

    const payload = (await response.json()) as { message?: string; settings?: ChatInteractionSettingsRecord };
    if (!response.ok) {
      const nextError = payload.message ?? "Could not update viewer control settings.";
      setError(nextError);
      pushToast({ title: "Could not save viewer control", description: nextError, tone: "error" });
      return;
    }

    // The server clamps to the safe range, so reflect what it actually stored rather than leaving
    // the form showing a value that was never accepted.
    if (payload.settings) {
      setVoteDurationSeconds(String(payload.settings.voteDurationSeconds));
      setVoteOptionCount(String(payload.settings.voteOptionCount));
      setVoteMinimumVoters(String(payload.settings.voteMinimumVoters));
      setRequestCooldownSeconds(String(payload.settings.requestCooldownSeconds));
      setRequestQueueLimit(String(payload.settings.requestQueueLimit));
      setSkipThresholdPercent(String(Math.round(payload.settings.skipThresholdRatio * 100)));
      setSkipMinimumVotes(String(payload.settings.skipMinimumVotes));
      setSkipWindowSeconds(String(payload.settings.skipWindowSeconds));
      setRequestCommand(payload.settings.requestCommand);
      setSkipCommand(payload.settings.skipCommand);
    }

    pushToast({
      title: "Viewer control saved",
      description: payload.message ?? "Chat can now steer the programme.",
      tone: "success"
    });
    router.refresh();
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        startTransition(() => void save());
      }}
    >
      <div className="list">
        <div className="item">
          <span className="label">Viewer control</span>
          <div className="subtle">
            Lets Twitch chat steer the programme. A vote can only reorder what is already queued, so chat
            influences the running order without bypassing your schedule.
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="toggle-row">
              <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
              <span className="label-with-info">Enable viewer control<InfoTip text="Master switch for everything on this page. While it is off, chat commands are ignored, no poll opens, and a skip vote in progress is dropped." /></span>
            </label>
          </div>
        </div>

        <div className="item">
          <span className="label">Vote on what plays next</span>
          <div className="subtle">
            A poll opens once per item and closes before the boundary, so viewers see the result before it
            takes effect. A tie leaves the schedule untouched rather than picking for them.
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="toggle-row">
              <input checked={votingEnabled} onChange={(event) => setVotingEnabled(event.target.checked)} type="checkbox" />
              <span className="label-with-info">Enable voting<InfoTip text="Opens a poll each time a new item goes on air: viewers type !1, !2 and so on to choose among the next queued items, and the winner moves to the front of the queue. Off, those numbers are ignored and no new poll opens; a poll already running still closes on time and its result still applies." /></span>
            </label>
            <label>
              <span className="label label-with-info">Poll duration (seconds)<InfoTip text="How long viewers have to vote after the poll opens; when the time is up the poll closes and the result is applied. Accepted between 15 seconds and 10 minutes, so a poll stays answerable but rarely outlives the item." /></span>
              <input
                max={600}
                min={15}
                onChange={(event) => setVoteDurationSeconds(event.target.value)}
                type="number"
                value={voteDurationSeconds}
              />
            </label>
            <label>
              <span className="label label-with-info">Candidates<InfoTip text="How many of the next queued items the poll offers, numbered !1 upward in queue order; with fewer than two items queued, no poll opens. Two to five, because more no longer fits on the overlay." /></span>
              <input
                max={5}
                min={2}
                onChange={(event) => setVoteOptionCount(event.target.value)}
                type="number"
                value={voteOptionCount}
              />
            </label>
            <label>
              <span className="label label-with-info">Minimum voters to honour a result<InfoTip text="How many different viewers must have voted before the result counts; below this the poll closes with no winner and the queue keeps its order. Each viewer counts once, however often they change their vote." /></span>
              <input
                min={1}
                onChange={(event) => setVoteMinimumVoters(event.target.value)}
                type="number"
                value={voteMinimumVoters}
              />
            </label>
          </div>
        </div>

        <div className="item">
          <span className="label">Requests</span>
          <div className="subtle">
            Viewers add a ready library item to the end of the queue. Only items the library has released are
            eligible.
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="toggle-row">
              <input
                checked={requestsEnabled}
                onChange={(event) => setRequestsEnabled(event.target.checked)}
                type="checkbox"
              />
              <span className="label-with-info">Enable requests<InfoTip text="Lets viewers add a video to the end of the queue by naming part of its title in chat. Any item that is ready to play qualifies, including items you have excluded from programming; only a replay whose download failed is skipped until its retry wait is over. A request that does not qualify is dropped silently, with no reply in chat." /></span>
            </label>
            <label>
              <span className="label label-with-info">Command<InfoTip text="The word viewers type after ! to make a request, followed by part of a title, e.g. with the default name: !request Title; case does not matter. Saved in lowercase with anything but letters, digits, - and _ removed and cut to 24 characters; a name that leaves nothing usable, or is only digits, is replaced by request." /></span>
              <input onChange={(event) => setRequestCommand(event.target.value)} type="text" value={requestCommand} />
            </label>
            <label>
              <span className="label label-with-info">Cooldown per viewer (seconds)<InfoTip text="How long a viewer must wait after an accepted request before the next one is taken; requests inside that time are turned down. Never below 30 seconds and at most a day, so requests are always throttled." /></span>
              <input
                min={30}
                onChange={(event) => setRequestCooldownSeconds(event.target.value)}
                type="number"
                value={requestCooldownSeconds}
              />
            </label>
            <label>
              <span className="label label-with-info">Maximum viewer requests in the queue<InfoTip text="How many viewer requests may wait in the queue at once, from 1 to 50; further requests are dropped until one of those items has left the queue, whether it played or an operator removed it. Items queued by operators do not count." /></span>
              <input
                max={50}
                min={1}
                onChange={(event) => setRequestQueueLimit(event.target.value)}
                type="number"
                value={requestQueueLimit}
              />
            </label>
          </div>
        </div>

        <div className="item">
          <span className="label">Skip vote</span>
          <div className="subtle">
            Needs both a share of active chatters and an absolute floor, so a quiet channel cannot be skipped
            by a handful of people. A skipped item is held back the same way an operator skip holds it.
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="toggle-row">
              <input checked={skipEnabled} onChange={(event) => setSkipEnabled(event.target.checked)} type="checkbox" />
              <span className="label-with-info">Enable skip votes<InfoTip text="Lets chat take the current item off air by voting. When enough viewers agree, playout moves on and the skipped item is kept out of the queue for an hour, the same hold an operator skip applies unless they choose another length." /></span>
            </label>
            <label>
              <span className="label label-with-info">Command<InfoTip text="The word viewers type after ! to vote for a skip, e.g. !skip; case does not matter, and the on-air skip panel shows it to them as !name. Saved in lowercase with anything but letters, digits, - and _ removed and cut to 24 characters; a name that leaves nothing usable, or is only digits, is replaced by skip." /></span>
              <input onChange={(event) => setSkipCommand(event.target.value)} type="text" value={skipCommand} />
            </label>
            <label>
              <span className="label label-with-info">Share of active chatters (%)<InfoTip text="The share of active chatters that must vote before a skip passes, where active means anyone who chatted within the Active chatter window set on the Engagement page. Between 10 and 100 percent; the minimum votes below applies as well." /></span>
              <input
                max={100}
                min={10}
                onChange={(event) => setSkipThresholdPercent(event.target.value)}
                type="number"
                value={skipThresholdPercent}
              />
            </label>
            <label>
              <span className="label label-with-info">Minimum votes<InfoTip text="The fewest votes a skip can ever pass with, whatever the share above works out to, so a nearly empty chat cannot skip the programme. At least 2: one viewer can never skip on their own." /></span>
              <input
                min={2}
                onChange={(event) => setSkipMinimumVotes(event.target.value)}
                type="number"
                value={skipMinimumVotes}
              />
            </label>
            <label>
              <span className="label label-with-info">Collection window (seconds)<InfoTip text="How long skip votes are collected from the first one before the tally starts again from zero; the tally also resets when the next item starts. Between 30 seconds and one hour, shown as a countdown on the on-air skip panel." /></span>
              <input
                max={3600}
                min={30}
                onChange={(event) => setSkipWindowSeconds(event.target.value)}
                type="number"
                value={skipWindowSeconds}
              />
            </label>
          </div>
        </div>
      </div>

      {error ? <p className="field-error">{error}</p> : null}

      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving…" : "Save viewer control"}
      </button>
    </form>
  );
}
