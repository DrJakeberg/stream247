"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { useToast } from "@/components/ui/Toast";

type PoolOption = { id: string; name: string };

export function ProgrammingTemplateForm(props: { pools: PoolOption[] }) {
  const [template, setTemplate] = useState("always-on-single-pool");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
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
            const nextError = payload.message ?? "Could not apply program template.";
            setError(nextError);
            pushToast({ title: "Program template could not be applied.", description: nextError, tone: "error" });
            return;
          }

          pushToast({ title: payload.message ?? "Template applied.", tone: "success" });
          router.refresh();
        });
      }}
    >
      <label>
        <span className="label label-with-info">Program template<InfoTip text="Lays out a whole week of repeating blocks at once — one pool around the clock, one pool on weekdays and another at the weekend, or three pools splitting each day into overnight, daytime and prime time — every block in the category Replay. If any of those hours already hold programming the template is refused; ticking the replace option below deletes the whole existing schedule first, not just the overlapping hours." /></span>
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
        <span className="label label-with-info">
          {template === "always-on-single-pool"
            ? "All-day pool"
            : template === "weekday-weekend-split"
              ? "Weekday pool"
              : "Overnight pool (00:00-08:00)"}
          <InfoTip
            text={
              template === "always-on-single-pool"
                ? "Assets from this pool fill every hour of every day. Blocks are titled with the pool's name followed by “All Day”."
                : template === "weekday-weekend-split"
                  ? "Assets from this pool fill Monday to Friday, all day. Blocks are titled with the pool's name followed by “Weekdays”."
                  : "Assets from this pool fill midnight to 08:00 every day. Blocks are titled with the pool's name followed by “Overnight”."
            }
          />
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
          <span className="label label-with-info">
            {template === "weekday-weekend-split" ? "Weekend pool" : "Daytime pool (08:00-16:00)"}
            <InfoTip
              text={
                template === "weekday-weekend-split"
                  ? "Assets from this pool fill Saturday and Sunday, all day. Blocks are titled with the pool's name followed by “Weekend”."
                  : "Assets from this pool fill 08:00 to 16:00 every day. Blocks are titled with the pool's name followed by “Daytime”."
              }
            />
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
          <span className="label label-with-info">Prime-time pool (16:00-00:00)<InfoTip text="Assets from this pool fill 16:00 to midnight every day of the week. Blocks are titled with the pool's name followed by “Prime Time”." /></span>
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
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Applying..." : "Apply template"}
      </button>
    </form>
  );
}
