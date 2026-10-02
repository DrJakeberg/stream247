/**
 * What the operator presses or runs for an incident (M90, U10/U11, lead S12).
 *
 * An incident card used to say what was wrong and stop there: "Playout crash-loop protection is
 * active ... Manual intervention is required" at three in the morning, with no word on which
 * intervention. This catalogue gives every CRITICAL fingerprint the worker and the storage layer
 * report one concrete next step, so the card can end with it.
 * `tests/unit/incident-actions.test.ts` reads every `fingerprint:` literal with its severity out of
 * `apps/worker/src/index.ts` and `packages/db/src/index.ts` and fails on a critical one that has no
 * entry here, so a new critical reporting site cannot ship without an answer.
 *
 * The incident row itself carries no action (`IncidentRecord` is unchanged): the action is looked up
 * by fingerprint when the card is drawn, so a better sentence reaches incidents that are already open.
 *
 * Names are the ones the admin shows: "Live → If something is stuck", "Program → Sources",
 * "Admin → Settings". Container commands use the service names of `docker-compose.yml`.
 */

export type IncidentOperatorAction = {
  /** The whole fingerprint, or everything in front of the key for a keyed family. */
  fingerprint: string;
  /** True when the reporting site appends `.<key>` (a source id, an output profile). */
  keyed: boolean;
  /** One or two sentences: what to press or run, and where. */
  action: string;
};

function restartCommand(service: string): string {
  return `docker compose restart ${service}`;
}

function logCommand(service: string): string {
  return `docker compose logs --tail 200 ${service}`;
}

const LOOP_SERVICES = ["worker", "playout", "uplink"] as const;

export const INCIDENT_OPERATOR_ACTIONS: readonly IncidentOperatorAction[] = [
  {
    fingerprint: "playout.crash-loop",
    keyed: false,
    action:
      "Skip the item that keeps failing (Skip current under Live → Control) or remove its source from the pool, then press Soft restart under Live → Control → If something is stuck."
  },
  {
    fingerprint: "playout.ffmpeg.exit",
    keyed: false,
    action:
      "Playout restarts by itself. If this comes back, skip the item named here (Skip current under Live → Control) and check its source under Program → Sources."
  },
  {
    fingerprint: "playout.start.failed",
    keyed: false,
    action:
      "Check the destination's address and stream key under Live → Status, then press Soft restart under Live → Control → If something is stuck."
  },
  {
    fingerprint: "playout.switch.failed",
    keyed: false,
    action:
      "Press Soft restart under Live → Control → If something is stuck. If the next switch fails too, skip the item named here (Skip current under Live → Control)."
  },
  {
    fingerprint: "source",
    keyed: true,
    action:
      "Open Program → Sources, check this source's address and whether it is still online, then press Sync now. Until it delivers, give its pool a second source."
  },
  {
    fingerprint: "disk.watermark.exhausted",
    keyed: false,
    action:
      "Free space on the data volume: delete media you no longer need under Program → Library or on the host. Playout caches again once space is back."
  },
  {
    fingerprint: "system.volume.low",
    keyed: false,
    action:
      "Free space on the host's system disk, for example with `docker image prune` for old images. Stream247 cannot free this disk itself."
  },
  {
    fingerprint: "twitch.refresh.failed",
    keyed: false,
    action: "Reconnect the Twitch account under Admin → Settings → Twitch accounts."
  },
  {
    fingerprint: "twitch.reconnect.required",
    keyed: false,
    action: "Reconnect the Twitch account under Admin → Settings → Twitch accounts."
  },
  {
    fingerprint: "secrets.key-mismatch",
    keyed: false,
    action:
      "Put back the APP_SECRET the secrets were saved with (the environment or the secret file on the data volume) and restart web and worker, or enter every secret again under Admin → Settings."
  },
  {
    fingerprint: "schema.drift",
    keyed: false,
    action: `Restart the web container so the database update runs (\`${restartCommand("web")}\`). If the entry stays, restore the backup taken before the upgrade.`
  },
  ...LOOP_SERVICES.flatMap((service) => [
    {
      fingerprint: `${service}.loop.stalled`,
      keyed: false,
      action: `Nothing if it happened once: the ${service} process restarted itself. If it repeats, run \`${logCommand(service)}\` and restart it with \`${restartCommand(service)}\`.`
    },
    {
      fingerprint: `${service}.loop.crashed`,
      keyed: false,
      action: `If it repeats, run \`${logCommand(service)}\` to see why, and restart the ${service} with \`${restartCommand(service)}\`.`
    }
  ])
];

/** The catalogue entry for a stored fingerprint, or null when there is none. */
export function findIncidentOperatorAction(fingerprint: string): IncidentOperatorAction | null {
  for (const entry of INCIDENT_OPERATOR_ACTIONS) {
    if (entry.keyed ? fingerprint.startsWith(`${entry.fingerprint}.`) : fingerprint === entry.fingerprint) {
      return entry;
    }
  }

  return null;
}

/** The sentence to show under an incident, or "" when the catalogue has none. */
export function describeIncidentOperatorAction(fingerprint: string): string {
  return findIncidentOperatorAction(fingerprint)?.action ?? "";
}

/** What to run when a runtime process stops reporting (the web-side heartbeat problems of M90). */
export function describeHeartbeatRestartAction(service: "worker" | "playout"): string {
  return `Restart the ${service} container: \`${restartCommand(service)}\`. If it stops again, run \`${logCommand(service)}\` to see why.`;
}
