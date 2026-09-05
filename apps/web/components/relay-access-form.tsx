"use client";

import { useState, useTransition } from "react";

/**
 * The emergency rollback lines for the programme path (M57 stage 2, Etappe E).
 *
 * Since the relay started checking credentials, sending the programme through it again needs two
 * environment lines that carry the relay's own access key — and that key is generated into the
 * database and never printed, which left a documented emergency path with no way to walk it. This
 * is that way.
 *
 * The value is fetched on an explicit click and held in this component's state only. Nothing about
 * it is server-rendered: the page ships the button and nothing else, so the key is absent from the
 * HTML, from the wording baseline, and from anything a listing could carry — the same custody the
 * source publish keys follow.
 *
 * Folded like every other group in this panel. It is read once during an incident and never again.
 */
export function RelayAccessForm() {
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <details className="disclosure">
      <summary>Relay access</summary>
      <div className="stack-form" style={{ marginTop: 8 }}>
        <p className="subtle">
          If the programme ever has to travel through the relay again — the fallback path in the
          runbooks — the server environment needs two lines that carry the relay&apos;s own access key.
          Showing them is recorded in the audit trail. Treat what appears here like a password: anyone
          holding it can publish into the programme path.
        </p>
        <div className="inline-form">
          <button
            className="button button-secondary"
            disabled={isPending}
            onClick={() => {
              setError("");
              startTransition(async () => {
                const response = await fetch("/api/settings/relay-access", { method: "POST" });
                const payload = (await response.json()) as { lines?: string[]; message?: string };
                if (!response.ok || !payload.lines) {
                  setError(payload.message ?? "Could not show the relay access lines.");
                  return;
                }
                setLines(payload.lines);
              });
            }}
            type="button"
          >
            {isPending ? "Fetching..." : lines.length > 0 ? "Show again" : "Show the rollback lines"}
          </button>
          {lines.length > 0 ? (
            <button className="button button-secondary" disabled={isPending} onClick={() => setLines([])} type="button">
              Hide
            </button>
          ) : null}
        </div>
        {error ? <p className="danger">{error}</p> : null}
        {lines.length > 0 ? (
          <>
            {/* Copy values, not prose: whole lines an operator pastes into the server environment
                and then restarts the stack. They are fetched fresh every time, never stored here.
                The names in them are part of the value being copied, which is also why they never
                reach the wording baseline — that records summaries, not the contents of a fold, and
                this fold holds nothing until someone clicks. */}
            {lines.map((line) => (
              <p key={line}>
                <code>{line}</code>
              </p>
            ))}
            <p className="subtle">
              Paste both lines into the server environment and restart, then follow the rollback steps
              in the runbook. Close this when you are done — nothing is kept on this page.
            </p>
          </>
        ) : null}
      </div>
    </details>
  );
}
