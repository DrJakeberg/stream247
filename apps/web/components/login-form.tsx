"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";

export function LoginForm() {
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [challengeToken, setChallengeToken] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setInfo("");

        const formData = new FormData(event.currentTarget);
        const email = String(formData.get("email") || "");
        const password = String(formData.get("password") || "");
        const code = String(formData.get("code") || "");

        startTransition(async () => {
          const response = await fetch(requiresTwoFactor ? "/api/auth/login/2fa" : "/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              requiresTwoFactor
                ? { challengeToken, code }
                : { email, password }
            )
          });

          if (response.status === 202) {
            const payload = (await response.json()) as { challengeToken?: string };
            setRequiresTwoFactor(true);
            setChallengeToken(payload.challengeToken ?? "");
            setPendingEmail(email);
            setInfo("Enter the 6-digit code from your authenticator app to finish signing in.");
            return;
          }

          if (!response.ok) {
            const payload = (await response.json()) as { message?: string };
            setError(payload.message ?? "Login failed.");
            return;
          }

          router.replace(buildWorkspaceHref("live"));
        });
      }}
    >
      <label>
        <span className="label label-with-info">Owner email<InfoTip text="Only the workspace owner signs in with an address and password here; team members use the Twitch sign-in instead. Upper or lower case does not matter." /></span>
        <input name="email" type="email" disabled={requiresTwoFactor} required={!requiresTwoFactor} />
      </label>
      <label>
        <span className="label label-with-info">Password<InfoTip text="Checked against the owner password chosen during setup. Ten failed tries within fifteen minutes block further sign-in for this address from your connection until those fifteen minutes are up; a correct password clears the count." /></span>
        <input name="password" type="password" disabled={requiresTwoFactor} required={!requiresTwoFactor} />
      </label>
      {requiresTwoFactor ? (
        <>
          <p className="subtle">Continuing sign-in for {pendingEmail || "the owner account"}.</p>
          <label>
            <span className="label label-with-info">One-time code<InfoTip text="The six digits your authenticator app shows for this workspace right now; the code changes every 30 seconds and the one just before it is still accepted. It appears because two-factor sign-in is switched on for the owner account." /></span>
            <input inputMode="numeric" name="code" pattern="[0-9]{6}" placeholder="123456" required />
          </label>
        </>
      ) : null}
      {info ? <p className="subtle">{info}</p> : null}
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Signing in..." : requiresTwoFactor ? "Verify code" : "Sign in"}
      </button>
    </form>
  );
}
