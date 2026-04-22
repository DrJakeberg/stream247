"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import type { ShowProfileRecord } from "@/lib/server/state";

export function ShowProfileForm(props: { show?: ShowProfileRecord }) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const isEditing = Boolean(props.show);
  const router = useRouter();
  const { pushToast } = useToast();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");

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
            const nextError = payload.message ?? "Could not save show profile.";
            setError(nextError);
            pushToast({ title: "Show profile could not be saved.", description: nextError, tone: "error" });
            return;
          }

          pushToast({ title: payload.message ?? "Show profile saved.", tone: "success" });
          router.refresh();
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
      <Textarea
        defaultValue={props.show?.description ?? ""}
        hint="Use this for operator-facing planning context, not viewer copy."
        label="Description"
        name="description"
        placeholder="Archive block with current/next overlay."
      />
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : isEditing ? "Update show" : "Add show"}
      </button>
    </form>
  );
}
