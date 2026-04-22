"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type PoolOption = { id: string; name: string };

export function ProgrammingTemplateForm(props: { pools: PoolOption[] }) {
  const [template, setTemplate] = useState("always-on-single-pool");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        setMessage("");

        const formData = new FormData(event.currentTarget);

        startTransition(async () => {
          const response = await fetch("/api/schedule/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              template: String(formData.get("template") || ""),
              primaryPoolId: String(formData.get("primaryPoolId") || ""),
              secondaryPoolId: String(formData.get("secondaryPoolId") || ""),
              tertiaryPoolId: String(formData.get("tertiaryPoolId") || ""),
              replaceExisting: formData.get("replaceExisting") === "on"
            })
          });

          const payload = (await response.json()) as { message?: string };
          if (!response.ok) {
            setError(payload.message ?? "Could not apply program template.");
            return;
          }

          setMessage(payload.message ?? "Template applied.");
          router.refresh();
        });
      }}
    >
      <label>
        <span className="label">Program template</span>
        <select
          name="template"
          onChange={(event) => setTemplate(event.target.value)}
          value={template}
        >
          <option value="always-on-single-pool">Always-on single pool</option>
          <option value="weekday-weekend-split">Weekday / weekend split</option>
          <option value="three-part-day">Three-part day rotation</option>
        </select>
      </label>
      <label>
        <span className="label">
          {template === "always-on-single-pool"
            ? "All-day pool"
            : template === "weekday-weekend-split"
              ? "Weekday pool"
              : "Overnight pool (00:00-08:00)"}
        </span>
        <select name="primaryPoolId" required>
          <option value="">Select a pool</option>
          {props.pools.map((pool) => (
            <option key={pool.id} value={pool.id}>
              {pool.name}
            </option>
          ))}
        </select>
      </label>
      {template !== "always-on-single-pool" ? (
        <label>
          <span className="label">
            {template === "weekday-weekend-split" ? "Weekend pool" : "Daytime pool (08:00-16:00)"}
          </span>
          <select name="secondaryPoolId" required>
            <option value="">Select a pool</option>
            {props.pools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {template === "three-part-day" ? (
        <label>
          <span className="label">Prime-time pool (16:00-00:00)</span>
          <select name="tertiaryPoolId" required>
            <option value="">Select a pool</option>
            {props.pools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="chip-toggle">
        <input name="replaceExisting" type="checkbox" />
        <span>Replace existing schedule blocks before applying template</span>
      </label>
      <p className="subtle">
        Templates are designed to get a new channel on air quickly, then you can fine-tune individual days in the
        timeline editor.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      {message ? <p className="subtle">{message}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Applying..." : "Apply template"}
      </button>
    </form>
  );
}
