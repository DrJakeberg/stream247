"use client";

import { useState, useTransition } from "react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");

        const formData = new FormData(event.currentTarget);
        const email = String(formData.get("email") || "");
        const password = String(formData.get("password") || "");

        startTransition(async () => {
          const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
          });

          if (!response.ok) {
            const payload = (await response.json()) as { message?: string };
            setError(payload.message ?? "Login failed.");
            return;
          }

          window.location.href = "/dashboard";
        });
      }}
    >
      <label>
        <span className="label">Owner email</span>
        <input name="email" type="email" required />
      </label>
      <label>
        <span className="label">Password</span>
        <input name="password" type="password" required />
      </label>
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

