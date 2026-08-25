"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Folded by default, like every group that is configured once and then left alone. The pair
// validation here mirrors the worker's rule — recovery must sit above the trigger, both between
// 1 and 99 — so an operator hears about a bad pair from the form, not from a monitor that
// silently ignored it.
export function DiskWatermarkForm(props: {
  initialValues: {
    diskWatermarkEnabled: string;
    diskWatermarkTriggerPercent: string;
    diskWatermarkRecoverPercent: string;
  };
  /** What an empty field resolves to: the env variable or the built-in default. */
  fallback: {
    enabled: boolean;
    triggerPercent: number;
    recoverPercent: number;
  };
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <details className="disclosure">
      <summary>Disk watermark</summary>
      <form
        className="stack-form"
        style={{ marginTop: 8 }}
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setMessage("");
          const formData = new FormData(event.currentTarget);
          const trigger = String(formData.get("diskWatermarkTriggerPercent") || "").trim();
          const recover = String(formData.get("diskWatermarkRecoverPercent") || "").trim();

          // Say it before saving: the same checks the API enforces, evaluated against the
          // effective values so a half-filled pair is judged by what the blank half falls back to.
          for (const value of [trigger, recover]) {
            if (value !== "" && !(Number(value) > 0 && Number(value) < 100)) {
              setError("Watermark values are percent of free disk space and must sit between 1 and 99.");
              return;
            }
          }
          const effectiveTrigger = trigger === "" ? props.fallback.triggerPercent : Number(trigger);
          const effectiveRecover = recover === "" ? props.fallback.recoverPercent : Number(recover);
          if ((trigger !== "" || recover !== "") && effectiveRecover <= effectiveTrigger) {
            setError(
              `Recovery (${String(effectiveRecover)}%) must sit above the trigger (${String(effectiveTrigger)}%), or eviction would stop the moment it starts. The pair is rejected whole.`
            );
            return;
          }

          startTransition(async () => {
            const response = await fetch("/api/settings/operations", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                diskWatermarkEnabled: String(formData.get("diskWatermarkEnabled") || ""),
                diskWatermarkTriggerPercent: trigger,
                diskWatermarkRecoverPercent: recover
              })
            });
            const payload = (await response.json()) as { message?: string };
            if (!response.ok) {
              setError(payload.message ?? "Could not save the disk watermark settings.");
              return;
            }
            setMessage(payload.message ?? "Disk watermark settings saved.");
            router.refresh();
          });
        }}
      >
        <p className="subtle">
          When free space on the media volume falls below the trigger, the worker evicts re-downloadable
          caches until it climbs back above the recovery mark. Empty fields follow the server environment
          or the built-in defaults.
        </p>
        <div className="form-grid">
          <label>
            <span className="label">Eviction under disk pressure</span>
            <select defaultValue={props.initialValues.diskWatermarkEnabled} name="diskWatermarkEnabled">
              <option value="">Follow the server (now: {props.fallback.enabled ? "on" : "off"})</option>
              <option value="1">On</option>
              <option value="0">Off</option>
            </select>
          </label>
          <label>
            <span className="label">Start evicting below (percent free)</span>
            <input
              defaultValue={props.initialValues.diskWatermarkTriggerPercent}
              inputMode="numeric"
              name="diskWatermarkTriggerPercent"
              placeholder={`Follow the server (now: ${String(props.fallback.triggerPercent)}%)`}
            />
          </label>
          <label>
            <span className="label">Stop evicting above (percent free)</span>
            <input
              defaultValue={props.initialValues.diskWatermarkRecoverPercent}
              inputMode="numeric"
              name="diskWatermarkRecoverPercent"
              placeholder={`Follow the server (now: ${String(props.fallback.recoverPercent)}%)`}
            />
          </label>
        </div>
        {error ? <p className="danger">{error}</p> : null}
        {message ? <p className="subtle">{message}</p> : null}
        <button className="button button-secondary" disabled={isPending} type="submit">
          {isPending ? "Saving..." : "Save disk watermark"}
        </button>
      </form>
    </details>
  );
}
