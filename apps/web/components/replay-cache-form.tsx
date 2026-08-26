"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Folded by default, like every group that is configured once and then left alone. The bounds
// here mirror the shared core limits the API enforces, so an operator hears about a bad value
// from the form, not from a monitor that silently corrected it. Sizes are GB because nobody
// reasons about a replay cache in bytes.
export function ReplayCacheForm(props: {
  initialValues: {
    vodCacheEnabled: string;
    vodCacheAllowRemoteFallback: string;
    vodCacheMaxGb: string;
    vodCacheMinFreeGb: string;
    vodCacheMaxAssetGb: string;
    vodCacheRetentionHours: string;
    vodCachePartialMaxAgeHours: string;
    vodCacheDownloadTimeoutSeconds: string;
    vodCacheFailureCooldownSeconds: string;
    vodCacheLimitRate: string;
  };
  /** What an empty field resolves to: the env variable or the built-in default. */
  fallback: {
    enabled: boolean;
    allowRemoteFallback: boolean;
    maxGb: number;
    minFreeGb: number;
    maxAssetGb: number;
    retentionHours: number;
    partialMaxAgeHours: number;
    downloadTimeoutSeconds: number;
    failureCooldownSeconds: number;
    limitRate: string;
  };
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <details className="disclosure">
      <summary>Replay cache</summary>
      <form
        className="stack-form"
        style={{ marginTop: 8 }}
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setMessage("");
          const formData = new FormData(event.currentTarget);
          const read = (name: string) => String(formData.get(name) || "").trim();
          const maxGb = read("vodCacheMaxGb");
          const minFreeGb = read("vodCacheMinFreeGb");
          const maxAssetGb = read("vodCacheMaxAssetGb");
          const limitRate = read("vodCacheLimitRate");

          // Say it before saving: the same checks the API enforces, judged against what a blank
          // half of a pair would resolve to.
          for (const value of [maxGb, minFreeGb, maxAssetGb]) {
            if (value !== "" && !(Number(value) >= 1 && Number(value) <= 4096)) {
              setError("Cache sizes are GB and must sit between 1 and 4096.");
              return;
            }
          }
          const ranges: Array<[string, number, number, string]> = [
            [read("vodCacheRetentionHours"), 1, 8760, "hours to keep a cached replay"],
            [read("vodCachePartialMaxAgeHours"), 1, 168, "hours to keep an unfinished download"],
            [read("vodCacheDownloadTimeoutSeconds"), 30, 14400, "seconds before a download is abandoned"],
            [read("vodCacheFailureCooldownSeconds"), 60, 86400, "seconds before a failed replay is retried"]
          ];
          for (const [value, min, max, label] of ranges) {
            if (value !== "" && !(Number(value) >= min && Number(value) <= max)) {
              setError(`The ${label} must sit between ${String(min)} and ${String(max)}.`);
              return;
            }
          }
          if (limitRate !== "" && limitRate !== "0" && !/^\d+(\.\d+)?[KMG]?$/i.test(limitRate)) {
            setError("The download speed ceiling is a number with an optional K, M or G suffix (for example 8M), or 0 for unlimited.");
            return;
          }
          const effectiveMax = maxGb === "" ? props.fallback.maxGb : Number(maxGb);
          const effectiveMaxAsset = maxAssetGb === "" ? props.fallback.maxAssetGb : Number(maxAssetGb);
          if ((maxGb !== "" || maxAssetGb !== "") && effectiveMaxAsset > effectiveMax) {
            setError(
              `The largest single replay (${String(effectiveMaxAsset)} GB) must fit inside the cache ceiling (${String(effectiveMax)} GB), or it would be downloaded, evicted, and downloaded again forever. The pair is rejected whole.`
            );
            return;
          }

          startTransition(async () => {
            const response = await fetch("/api/settings/replay-cache", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                vodCacheEnabled: read("vodCacheEnabled"),
                vodCacheAllowRemoteFallback: read("vodCacheAllowRemoteFallback"),
                vodCacheMaxGb: maxGb,
                vodCacheMinFreeGb: minFreeGb,
                vodCacheMaxAssetGb: maxAssetGb,
                vodCacheRetentionHours: read("vodCacheRetentionHours"),
                vodCachePartialMaxAgeHours: read("vodCachePartialMaxAgeHours"),
                vodCacheDownloadTimeoutSeconds: read("vodCacheDownloadTimeoutSeconds"),
                vodCacheFailureCooldownSeconds: read("vodCacheFailureCooldownSeconds"),
                vodCacheLimitRate: limitRate
              })
            });
            const payload = (await response.json()) as { message?: string };
            if (!response.ok) {
              setError(payload.message ?? "Could not save the replay cache settings.");
              return;
            }
            setMessage(payload.message ?? "Replay cache settings saved.");
            router.refresh();
          });
        }}
      >
        <p className="subtle">
          Replays scheduled from Twitch are downloaded to local disk ahead of playback, so the channel
          plays a file instead of a remote stream. Empty fields follow the server environment or the
          built-in defaults; where the cache lives on disk stays a server decision.
        </p>
        <div className="form-grid">
          <label>
            <span className="label">Cache replays on this machine</span>
            <select defaultValue={props.initialValues.vodCacheEnabled} name="vodCacheEnabled">
              <option value="">Follow the server (now: {props.fallback.enabled ? "on" : "off"})</option>
              <option value="1">On</option>
              <option value="0">Off</option>
            </select>
          </label>
          <label>
            <span className="label">Cache ceiling (GB)</span>
            <input
              defaultValue={props.initialValues.vodCacheMaxGb}
              inputMode="numeric"
              name="vodCacheMaxGb"
              placeholder={`Follow the server (now: ${String(props.fallback.maxGb)} GB)`}
            />
          </label>
          <label>
            <span className="label">Keep this much disk free (GB)</span>
            <input
              defaultValue={props.initialValues.vodCacheMinFreeGb}
              inputMode="numeric"
              name="vodCacheMinFreeGb"
              placeholder={`Follow the server (now: ${String(props.fallback.minFreeGb)} GB)`}
            />
          </label>
          <label>
            <span className="label">Largest single replay to cache (GB)</span>
            <input
              defaultValue={props.initialValues.vodCacheMaxAssetGb}
              inputMode="numeric"
              name="vodCacheMaxAssetGb"
              placeholder={`Follow the server (now: ${String(props.fallback.maxAssetGb)} GB)`}
            />
          </label>
        </div>
        <p className="subtle">
          Anything larger than the single-replay limit is played from Twitch directly instead of being
          cached — downloading what the cache cannot hold would only saturate the connection. The
          speed ceiling keeps a background download from competing with the live stream for the line.
        </p>
        <div className="form-grid">
          <label>
            <span className="label">Keep a cached replay for (hours)</span>
            <input
              defaultValue={props.initialValues.vodCacheRetentionHours}
              inputMode="numeric"
              name="vodCacheRetentionHours"
              placeholder={`Follow the server (now: ${String(props.fallback.retentionHours)} h)`}
            />
          </label>
          <label>
            <span className="label">Discard an unfinished download after (hours)</span>
            <input
              defaultValue={props.initialValues.vodCachePartialMaxAgeHours}
              inputMode="numeric"
              name="vodCachePartialMaxAgeHours"
              placeholder={`Follow the server (now: ${String(props.fallback.partialMaxAgeHours)} h)`}
            />
          </label>
          <label>
            <span className="label">Abandon a download attempt after (seconds)</span>
            <input
              defaultValue={props.initialValues.vodCacheDownloadTimeoutSeconds}
              inputMode="numeric"
              name="vodCacheDownloadTimeoutSeconds"
              placeholder={`Follow the server (now: ${String(props.fallback.downloadTimeoutSeconds)} s)`}
            />
          </label>
          <label>
            <span className="label">Retry a failed replay after (seconds)</span>
            <input
              defaultValue={props.initialValues.vodCacheFailureCooldownSeconds}
              inputMode="numeric"
              name="vodCacheFailureCooldownSeconds"
              placeholder={`Follow the server (now: ${String(props.fallback.failureCooldownSeconds)} s)`}
            />
          </label>
          <label>
            <span className="label">Download speed ceiling (for example 8M; 0 for unlimited)</span>
            <input
              defaultValue={props.initialValues.vodCacheLimitRate}
              name="vodCacheLimitRate"
              placeholder={`Follow the server (now: ${props.fallback.limitRate || "unlimited"})`}
            />
          </label>
          <label>
            <span className="label">While a replay is still downloading, play it from Twitch</span>
            <select defaultValue={props.initialValues.vodCacheAllowRemoteFallback} name="vodCacheAllowRemoteFallback">
              <option value="">Follow the server (now: {props.fallback.allowRemoteFallback ? "on" : "off"})</option>
              <option value="1">On</option>
              <option value="0">Off</option>
            </select>
          </label>
        </div>
        {error ? <p className="danger">{error}</p> : null}
        {message ? <p className="subtle">{message}</p> : null}
        <button className="button button-secondary" disabled={isPending} type="submit">
          {isPending ? "Saving..." : "Save replay cache"}
        </button>
      </form>
    </details>
  );
}
