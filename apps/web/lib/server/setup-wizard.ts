// The setup wizard's spine.
//
// There is no stored step counter anywhere: every step's completion is derived from what is
// actually configured, so the wizard is resumable by construction — close the tab, come back, and
// it continues where the configuration actually stands. Skipping is just visiting a later step;
// the skipped step stays visibly open until reality changes.

import { resolveAppBaseUrl, type AppState } from "@stream247/db";
import { getManagedConfigValue } from "./state";

export type SetupWizardStepId = "owner" | "instance" | "twitch-app" | "twitch-connect" | "done";

export type SetupWizardStep = {
  id: SetupWizardStepId;
  title: string;
  /** One line under the title in the step rail; the step panels carry the full explanation. */
  summary: string;
  complete: boolean;
};

/**
 * The slice of app state the derivation actually reads. Narrow on purpose: tests can build it
 * honestly, and the type documents which configuration the wizard is a view of.
 */
export type SetupWizardStateSlice = {
  owner: AppState["owner"];
  managedConfig: AppState["managedConfig"];
  twitch: Pick<AppState["twitch"], "status" | "broadcasterLogin">;
};

export function deriveSetupWizardSteps(
  state: SetupWizardStateSlice,
  env: Record<string, string | undefined> = process.env
): SetupWizardStep[] {
  // Env fallbacks come from the same env object the resolver sees, so the whole derivation is a
  // pure function of (state, env) — an env-configured install shows those steps as already done.
  const twitchClientId = getManagedConfigValue(state, "twitchClientId", env.TWITCH_CLIENT_ID || "");
  const twitchClientSecret = getManagedConfigValue(state, "twitchClientSecret", env.TWITCH_CLIENT_SECRET || "");

  const hasOwner = Boolean(state.owner);
  const hasAppUrl = resolveAppBaseUrl(state.managedConfig, env) !== "";
  const hasTwitchApp = Boolean(twitchClientId && twitchClientSecret);
  const hasTwitchConnection = state.twitch.status === "connected";

  return [
    {
      id: "owner",
      title: "Owner account",
      summary: hasOwner ? `Owner ${state.owner?.email} exists.` : "Create the account that owns this workspace.",
      complete: hasOwner
    },
    {
      id: "instance",
      title: "Instance basics",
      summary: hasAppUrl
        ? `Public URL ${resolveAppBaseUrl(state.managedConfig, env)}.`
        : "Set the public URL and the channel timezone.",
      complete: hasAppUrl
    },
    {
      id: "twitch-app",
      title: "Twitch app credentials",
      summary: hasTwitchApp
        ? "Client id and secret are stored."
        : "Store the Twitch application's client id and secret.",
      complete: hasTwitchApp
    },
    {
      id: "twitch-connect",
      title: "Connect Twitch",
      summary: hasTwitchConnection
        ? `Connected as ${state.twitch.broadcasterLogin || "the Twitch account"}.`
        : "Sign the channel's Twitch account into this workspace.",
      complete: hasTwitchConnection
    },
    {
      id: "done",
      title: "Review",
      summary: "Secrets, storage, and what the go-live checklist still wants.",
      complete: hasOwner && hasAppUrl && hasTwitchApp && hasTwitchConnection
    }
  ];
}

export function resolveActiveSetupWizardStep(
  steps: SetupWizardStep[],
  requested: string | undefined
): SetupWizardStepId {
  // Every step past the first writes managed config behind role checks; without an owner there is
  // no session to hold those roles, so nothing else is operable yet.
  const owner = steps.find((step) => step.id === "owner");
  if (owner && !owner.complete) {
    return "owner";
  }

  const match = steps.find((step) => step.id === requested);
  if (match) {
    return match.id;
  }

  return steps.find((step) => !step.complete)?.id ?? "done";
}
