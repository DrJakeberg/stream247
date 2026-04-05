"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  currentUser: {
    email: string;
    authProvider: "local" | "twitch";
    twoFactorEnabled: boolean;
    hasPendingSecret: boolean;
    confirmedAt: string;
  } | null;
};

export function TwoFactorSettingsForm({ currentUser }: Props) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [setupUri, setSetupUri] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (!currentUser) {
    return <p className="subtle">Sign in again to manage local account security.</p>;
  }

  if (currentUser.authProvider !== "local") {
    return <p className="subtle">Two-factor authentication is only available for the local owner fallback account.</p>;
  }

  const beginSetup = () => {
    setError("");
    setMessage("");

    startTransition(async () => {
      const response = await fetch("/api/auth/2fa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: setupPassword })
      });
      const payload = (await response.json()) as { message?: string; secret?: string; otpAuthUri?: string };
      if (!response.ok) {
        setError(payload.message ?? "Could not begin two-factor setup.");
        return;
      }

      setSetupSecret(payload.secret ?? "");
      setSetupUri(payload.otpAuthUri ?? "");
      setSetupCode("");
      setMessage("Authenticator secret generated. Add it to your app, then confirm with a 6-digit code.");
    });
  };

  const confirmSetup = () => {
    setError("");
    setMessage("");

    startTransition(async () => {
      const response = await fetch("/api/auth/2fa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: setupCode })
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(payload.message ?? "Could not enable two-factor authentication.");
        return;
      }

      setSetupSecret("");
      setSetupUri("");
      setSetupPassword("");
      setSetupCode("");
      setMessage(payload.message ?? "Two-factor authentication enabled.");
      router.refresh();
    });
  };

  const disableTwoFactor = () => {
    setError("");
    setMessage("");

    startTransition(async () => {
      const response = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword, code: disableCode })
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(payload.message ?? "Could not disable two-factor authentication.");
        return;
      }

      setDisablePassword("");
      setDisableCode("");
      setMessage(payload.message ?? "Two-factor authentication disabled.");
      router.refresh();
    });
  };

  return (
    <div className="stack-form">
      <div className="list">
        <div className="item">
          <strong>Status</strong>
          <div className="subtle">
            {currentUser.twoFactorEnabled
              ? `Enabled${currentUser.confirmedAt ? ` since ${new Date(currentUser.confirmedAt).toLocaleString()}` : ""}.`
              : currentUser.hasPendingSecret || setupSecret
                ? "Setup started but not yet confirmed."
                : "Disabled."}
          </div>
        </div>
      </div>

      {!currentUser.twoFactorEnabled ? (
        <>
          <label>
            <span className="label">Current password</span>
            <input
              name="setup-password"
              onChange={(event) => setSetupPassword(event.target.value)}
              type="password"
              value={setupPassword}
            />
          </label>
          <button className="button secondary" disabled={isPending || !setupPassword} onClick={beginSetup} type="button">
            {currentUser.hasPendingSecret || setupSecret ? "Rotate authenticator secret" : "Start two-factor setup"}
          </button>

          {setupSecret ? (
            <div className="list">
              <div className="item">
                <strong>Authenticator secret</strong>
                <div className="subtle">
                  Copy this into your authenticator app if it cannot scan `otpauth://` links automatically.
                </div>
                <code>{setupSecret}</code>
              </div>
              <div className="item">
                <strong>Provisioning URI</strong>
                <div className="subtle">{setupUri}</div>
              </div>
            </div>
          ) : null}

          {setupSecret || currentUser.hasPendingSecret ? (
            <>
              <label>
                <span className="label">Confirm 6-digit code</span>
                <input
                  inputMode="numeric"
                  name="setup-code"
                  onChange={(event) => setSetupCode(event.target.value)}
                  pattern="[0-9]{6}"
                  placeholder="123456"
                  value={setupCode}
                />
              </label>
              <button className="button" disabled={isPending || setupCode.replace(/\D/g, "").length !== 6} onClick={confirmSetup} type="button">
                Confirm and enable 2FA
              </button>
            </>
          ) : null}
        </>
      ) : (
        <>
          <label>
            <span className="label">Current password</span>
            <input
              name="disable-password"
              onChange={(event) => setDisablePassword(event.target.value)}
              type="password"
              value={disablePassword}
            />
          </label>
          <label>
            <span className="label">Current 6-digit code</span>
            <input
              inputMode="numeric"
              name="disable-code"
              onChange={(event) => setDisableCode(event.target.value)}
              pattern="[0-9]{6}"
              placeholder="123456"
              value={disableCode}
            />
          </label>
          <button
            className="button secondary"
            disabled={isPending || !disablePassword || disableCode.replace(/\D/g, "").length !== 6}
            onClick={disableTwoFactor}
            type="button"
          >
            Disable 2FA
          </button>
        </>
      )}

      {message ? <p className="subtle">{message}</p> : null}
      {error ? <p className="danger">{error}</p> : null}
    </div>
  );
}
