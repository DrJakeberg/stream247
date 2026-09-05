"use client";

import { InfoTip } from "@/components/ui/InfoTip";
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
            <span className="label label-with-info">Eviction under disk pressure<InfoTip text="When free space on the media volume drops below the mark, the worker deletes what is cheapest to lose — sampled video frames, unused VOD cache, orphaned feed segments, old thumbnails — one stage every 30 seconds, never media the schedule or queue still needs. Off, nothing is deleted because the disk is filling; the VOD cache's own size cap and the routine feed sweep still run." /></span>
            <select defaultValue={props.initialValues.diskWatermarkEnabled} name="diskWatermarkEnabled">
              <option value="">Follow the server (now: {props.fallback.enabled ? "on" : "off"})</option>
              <option value="1">On</option>
              <option value="0">Off</option>
            </select>
          </label>
          <label>
            <span className="label label-with-info">Start evicting below (percent free)<InfoTip text="The share of the media volume that must stay free; when free space drops under it, the worker starts evicting. It keeps going until free space reaches the &quot;Stop evicting above&quot; mark, not just back to this line, so a nearly full disk does not trip again right away." /></span>
            <input
              defaultValue={props.initialValues.diskWatermarkTriggerPercent}
              inputMode="numeric"
              name="diskWatermarkTriggerPercent"
              placeholder={`Follow the server (now: ${String(props.fallback.triggerPercent)}%)`}
            />
          </label>
          <label>
            <span className="label label-with-info">Stop evicting above (percent free)<InfoTip text="Once this much of the media volume is free again, the worker stops deleting and closes the incident it opened while evicting. Must sit above &quot;Start evicting below&quot; or the pair is rejected whole; the wider the gap, the longer until the next round of eviction." /></span>
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
            <span className="label label-with-info">Warn below (percent free, system volume)<InfoTip text="Free space on the system volume — measured at the worker's own root filesystem as a stand-in for the operating-system disk, which eviction cannot relieve — under which the channel opens a critical incident and sends one alert. Nothing is deleted; it is a call for an operator to make room, and a database kept on another disk or host is not watched by this." /></span>
            <input
              defaultValue={props.initialValues.systemVolumeTriggerPercent}
              inputMode="numeric"
              name="systemVolumeTriggerPercent"
              placeholder={`Follow the server (now: ${String(props.fallback.systemTriggerPercent)}%)`}
            />
          </label>
          <label>
            <span className="label label-with-info">All clear above (percent free, system volume)<InfoTip text="Free space on the system volume at which the open incident is closed again. Kept above the warning mark on purpose, so a value hovering at the line does not open and close the incident on every measurement; a pair in the wrong order is rejected." /></span>
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
            <span className="label label-with-info">Remove orphaned library entries<InfoTip text="Allows the hourly sweep to delete the library entries it finds orphaned: source gone, nothing referencing them, and in that state for the whole protection window. Off, the sweep still runs and writes its candidate counts to the worker log, so you can watch what it would remove before allowing it." /></span>
            <select defaultValue={props.initialValues.assetRetentionEnabled} name="assetRetentionEnabled">
              <option value="">Follow the server (now: {props.fallback.retentionEnabled ? "on" : "off"})</option>
              <option value="1">On</option>
              <option value="0">Off</option>
            </select>
          </label>
          <label>
            <span className="label label-with-info">Protection window (days orphaned before removal)<InfoTip text="How long an entry must stay orphaned before the sweep may remove it, counted from when the sweep first noticed it (or from its last update, whichever is later) — so deleting a source never makes its library entries vanish the same day. Whole days, from 1 to 365; the files on disk are not touched." /></span>
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
