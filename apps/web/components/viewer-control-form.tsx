"use client";

import type { ChatInteractionSettingsRecord } from "@stream247/db";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
              <span>Enable viewer control</span>
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
              <span>Enable voting</span>
            </label>
            <label>
              <span className="label">Poll duration (seconds)</span>
              <input
                max={600}
                min={15}
                onChange={(event) => setVoteDurationSeconds(event.target.value)}
                type="number"
                value={voteDurationSeconds}
              />
            </label>
            <label>
              <span className="label">Candidates</span>
              <input
                max={5}
                min={2}
                onChange={(event) => setVoteOptionCount(event.target.value)}
                type="number"
                value={voteOptionCount}
              />
            </label>
            <label>
              <span className="label">Minimum voters to honour a result</span>
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
              <span>Enable requests</span>
            </label>
            <label>
              <span className="label">Command</span>
              <input onChange={(event) => setRequestCommand(event.target.value)} type="text" value={requestCommand} />
            </label>
            <label>
              <span className="label">Cooldown per viewer (seconds)</span>
              <input
                min={30}
                onChange={(event) => setRequestCooldownSeconds(event.target.value)}
                type="number"
                value={requestCooldownSeconds}
              />
            </label>
            <label>
              <span className="label">Maximum viewer requests in the queue</span>
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
              <span>Enable skip votes</span>
            </label>
            <label>
              <span className="label">Command</span>
              <input onChange={(event) => setSkipCommand(event.target.value)} type="text" value={skipCommand} />
            </label>
            <label>
              <span className="label">Share of active chatters (%)</span>
              <input
                max={100}
                min={10}
                onChange={(event) => setSkipThresholdPercent(event.target.value)}
                type="number"
                value={skipThresholdPercent}
              />
            </label>
            <label>
              <span className="label">Minimum votes</span>
              <input
                min={2}
                onChange={(event) => setSkipMinimumVotes(event.target.value)}
                type="number"
                value={skipMinimumVotes}
              />
            </label>
            <label>
              <span className="label">Collection window (seconds)</span>
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
