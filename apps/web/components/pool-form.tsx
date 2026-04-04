"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PoolRecord, SourceRecord } from "@/lib/server/state";

export function PoolForm(props: {
  sources: SourceRecord[];
  pool?: PoolRecord;
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const isEditing = Boolean(props.pool);
  const router = useRouter();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setMessage("");

        const formData = new FormData(event.currentTarget);
        const sourceIds = formData.getAll("sourceIds").map((value) => String(value));

        startTransition(async () => {
          const response = await fetch("/api/pools", {
            method: isEditing ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: String(formData.get("id") || ""),
              name: String(formData.get("name") || ""),
              sourceIds
            })
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not save pool.");
            return;
          }

          setMessage(payload.message ?? "Pool saved.");
          router.refresh();
        });
      }}
    >
      {props.pool ? <input name="id" type="hidden" value={props.pool.id} /> : null}
      <label>
        <span className="label">Pool name</span>
        <input defaultValue={props.pool?.name ?? ""} name="name" placeholder="Morning archive" required />
      </label>
      <label>
        <span className="label">Included sources</span>
        <select defaultValue={props.pool?.sourceIds ?? []} multiple name="sourceIds" size={Math.min(8, Math.max(3, props.sources.length))}>
          {props.sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </label>
      <p className="subtle">Pools currently use persistent round-robin playback across all ready assets from the selected sources.</p>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving..." : isEditing ? "Update pool" : "Add pool"}
      </button>
    </form>
  );
}
