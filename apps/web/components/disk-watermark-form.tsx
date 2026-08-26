"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Folded by default, like every group that is configured once and then left alone. The pair
// validation here mirrors the worker's rule — recovery must sit above the trigger, both between
// 1 and 99 — so an operator hears about a bad pair from the form, not from a monitor that
// silently ignored it. Since M57 the fold also carries the group's two siblings in disk
// housekeeping: the observation-only system-volume watermark (incident + alert, no eviction)
// and the orphaned-library retention sweep (observe first, enable second).
export function DiskWatermarkForm(props: {
  initialValues: {
    diskWatermarkEnabled: string;
    diskWatermarkTriggerPercent: string;
    diskWatermarkRecoverPercent: string;
    systemVolumeTriggerPercent: string;
    systemVolumeRecoverPercent: string;
    assetRetentionEnabled: string;
    assetRetentionProtectionDays: string;
  };
  /** What an empty field resolves to: the env variable or the built-in default. */
  fallback: {
    enabled: boolean;
    triggerPercent: number;
    recoverPercent: number;
    systemTriggerPercent: number;
    systemRecoverPercent: number;
    retentionEnabled: boolean;
    retentionDays: number;
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
          const systemTrigger = String(formData.get("systemVolumeTriggerPercent") || "").trim();
          const systemRecover = String(formData.get("systemVolumeRecoverPercent") || "").trim();
          const retentionDays = String(formData.get("assetRetentionProtectionDays") || "").trim();

          // Say it before saving: the same checks the API enforces, evaluated against the
          // effective values so a half-filled pair is judged by what the blank half falls back to.
          for (const value of [trigger, recover, systemTrigger, systemRecover]) {
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
          const effectiveSystemTrigger = systemTrigger === "" ? props.fallback.systemTriggerPercent : Number(systemTrigger);
          const effectiveSystemRecover = systemRecover === "" ? props.fallback.systemRecoverPercent : Number(systemRecover);
          if ((systemTrigger !== "" || systemRecover !== "") && effectiveSystemRecover <= effectiveSystemTrigger) {
            setError(
              `The all-clear mark (${String(effectiveSystemRecover)}%) must sit above the warning mark (${String(effectiveSystemTrigger)}%), or one incident would become a drumbeat. The pair is rejected whole.`
            );
            return;
          }
          if (retentionDays !== "" && !(Number.isInteger(Number(retentionDays)) && Number(retentionDays) >= 1 && Number(retentionDays) <= 365)) {
            setError("The protection window is a whole number of days between 1 and 365.");
            return;
          }

          startTransition(async () => {
            const response = await fetch("/api/settings/operations", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                diskWatermarkEnabled: String(formData.get("diskWatermarkEnabled") || ""),
                diskWatermarkTriggerPercent: trigger,
                diskWatermarkRecoverPercent: recover,
                systemVolumeTriggerPercent: systemTrigger,
                systemVolumeRecoverPercent: systemRecover,
                assetRetentionEnabled: String(formData.get("assetRetentionEnabled") || ""),
                assetRetentionProtectionDays: retentionDays
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
        <p className="subtle">
          The system volume — the operating system and database disk, watched from the worker as the
          nearest measurable stand-in — cannot be relieved by eviction. Below the warning mark the
          channel raises a critical incident and sends an alert instead, until free space climbs back
          above the all-clear mark.
        </p>
        <div className="form-grid">
          <label>
            <span className="label">Warn below (percent free, system volume)</span>
            <input
              defaultValue={props.initialValues.systemVolumeTriggerPercent}
              inputMode="numeric"
              name="systemVolumeTriggerPercent"
              placeholder={`Follow the server (now: ${String(props.fallback.systemTriggerPercent)}%)`}
            />
          </label>
          <label>
            <span className="label">All clear above (percent free, system volume)</span>
            <input
              defaultValue={props.initialValues.systemVolumeRecoverPercent}
              inputMode="numeric"
              name="systemVolumeRecoverPercent"
              placeholder={`Follow the server (now: ${String(props.fallback.systemRecoverPercent)}%)`}
            />
          </label>
        </div>
        <p className="subtle">
          Library cleanup removes entries whose source is gone, and only those nothing references —
          no pool, schedule, curated set, queue, running playout or chat interaction — after they have
          been orphaned for the whole protection window. It counts its candidates in the worker log on
          every pass even while off, so you can watch what it would do before switching it on.
        </p>
        <div className="form-grid">
          <label>
            <span className="label">Remove orphaned library entries</span>
            <select defaultValue={props.initialValues.assetRetentionEnabled} name="assetRetentionEnabled">
              <option value="">Follow the server (now: {props.fallback.retentionEnabled ? "on" : "off"})</option>
              <option value="1">On</option>
              <option value="0">Off</option>
            </select>
          </label>
          <label>
            <span className="label">Protection window (days orphaned before removal)</span>
            <input
              defaultValue={props.initialValues.assetRetentionProtectionDays}
              inputMode="numeric"
              name="assetRetentionProtectionDays"
              placeholder={`Follow the server (now: ${String(props.fallback.retentionDays)} days)`}
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
