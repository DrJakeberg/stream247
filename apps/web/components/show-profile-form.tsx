"use client";

import { useState, useTransition } from "react";
import type { ShowProfileRecord } from "@/lib/server/state";

export function ShowProfileForm(props: { show?: ShowProfileRecord }) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const isEditing = Boolean(props.show);

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setMessage("");

        const formData = new FormData(event.currentTarget);

        startTransition(async () => {
          const response = await fetch("/api/shows", {
            method: isEditing ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: String(formData.get("id") || ""),
              name: String(formData.get("name") || ""),
              categoryName: String(formData.get("categoryName") || ""),
              defaultDurationMinutes: Number(formData.get("defaultDurationMinutes") || 60),
              color: String(formData.get("color") || "#0e6d5a"),
              description: String(formData.get("description") || "")
            })
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not save show profile.");
            return;
          }

          setMessage(payload.message ?? "Show profile saved.");
          window.location.reload();
        });
      }}
    >
      {props.show ? <input name="id" type="hidden" value={props.show.id} /> : null}
      <div className="form-grid">
        <label>
          <span className="label">Show name</span>
          <input defaultValue={props.show?.name ?? ""} name="name" placeholder="Morning Replay" required />
        </label>
        <label>
          <span className="label">Default category</span>
          <input defaultValue={props.show?.categoryName ?? ""} name="categoryName" placeholder="Replay" />
        </label>
      </div>
      <div className="form-grid">
        <label>
          <span className="label">Default duration</span>
          <input defaultValue={props.show?.defaultDurationMinutes ?? 120} min={15} name="defaultDurationMinutes" step={15} type="number" />
        </label>
        <label>
          <span className="label">Color</span>
          <input defaultValue={props.show?.color ?? "#0e6d5a"} name="color" type="color" />
        </label>
      </div>
      <label>
        <span className="label">Description</span>
        <input defaultValue={props.show?.description ?? ""} name="description" placeholder="Archive block with current/next overlay." />
      </label>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : isEditing ? "Update show" : "Add show"}
      </button>
    </form>
  );
}
