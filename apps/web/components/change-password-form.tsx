"use client";

import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";

/**
 * Change the owner password (M91, owner decision 2026-10-01): the current password is required. A
 * forgotten one is reset on the host with the command in docs/operations.md, never by e-mail.
 */
export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const mismatch = repeatPassword !== "" && repeatPassword !== newPassword;

  // Folded: changing the password is an occasional job, and the settings page's control budget is a
  // ratchet worth keeping (tests/e2e/control-density.spec.ts).
  return (
    <details className="disclosure">
      <summary>Change password</summary>
      <form
        className="stack-form"
        style={{ marginTop: 8 }}
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setMessage("");

          startTransition(async () => {
            const response = await fetch("/api/auth/password", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ currentPassword, newPassword })
            });
            const payload = (await response.json()) as { message?: string };
            if (!response.ok) {
              setError(payload.message ?? "Could not change the password.");
              return;
            }

            setCurrentPassword("");
            setNewPassword("");
            setRepeatPassword("");
            setMessage(payload.message ?? "Password changed.");
          });
        }}
      >
        <label>
          <span className="label label-with-info">
            Current password
            <InfoTip text="The password you sign in with now. Forgotten it? Sign-in cannot help; the reset command in the operations guide sets a new one on the host." />
          </span>
          <input
            autoComplete="current-password"
            name="current-password"
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            type="password"
            value={currentPassword}
          />
        </label>
        <label>
          <span className="label">New password</span>
          <input
            autoComplete="new-password"
            minLength={10}
            name="new-password"
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="At least 10 characters"
            required
            type="password"
            value={newPassword}
          />
        </label>
        <label>
          <span className="label">Repeat the new password</span>
          <input
            autoComplete="new-password"
            name="repeat-password"
            onChange={(event) => setRepeatPassword(event.target.value)}
            required
            type="password"
            value={repeatPassword}
          />
        </label>
        {mismatch ? <p className="danger">The two new passwords differ.</p> : null}
        {error ? <p className="danger">{error}</p> : null}
        {message ? <p className="subtle">{message}</p> : null}
        <button
          className="button secondary"
          disabled={isPending || !currentPassword || newPassword.length < 10 || repeatPassword !== newPassword}
          type="submit"
        >
          {isPending ? "Changing..." : "Change password"}
        </button>
      </form>
    </details>
  );
}
