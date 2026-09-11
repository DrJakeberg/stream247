import { describe, expect, it } from "vitest";
import type { ManagedConfigRecord } from "../../packages/db/src/index.js";
import {
  deriveSetupWizardSteps,
  resolveActiveSetupWizardStep,
  type SetupWizardStateSlice
} from "../../apps/web/lib/server/setup-wizard.js";

function emptyManagedConfig(overrides: Partial<ManagedConfigRecord> = {}): ManagedConfigRecord {
  return {
    appUrl: "",
    channelTimezone: "",
    twitchClientId: "",
    twitchClientSecret: "",
    twitchDefaultCategoryId: "",
    discordWebhookUrl: "",
    smtpHost: "",
    smtpPort: "",
    smtpUser: "",
    smtpPassword: "",
    smtpFrom: "",
    alertEmailTo: "",
    updatedAt: "",
    ...overrides
  };
}

function wizardState(overrides: Partial<SetupWizardStateSlice> = {}): SetupWizardStateSlice {
  return {
    owner: { email: "owner@example.com", passwordHash: "hash", createdAt: "2026-08-25T00:00:00.000Z" },
    managedConfig: emptyManagedConfig(),
    twitch: { status: "not-connected", broadcasterLogin: "" },
    ...overrides
  };
}

function activeStep(state: SetupWizardStateSlice, env: Record<string, string | undefined> = {}, requested?: string) {
  return resolveActiveSetupWizardStep(deriveSetupWizardSteps(state, env), requested);
}

describe("deriveSetupWizardSteps", () => {
  it("derives completion from what is actually configured, not a stored counter", () => {
    const steps = deriveSetupWizardSteps(
      wizardState({
        managedConfig: emptyManagedConfig({
          appUrl: "https://stream.example",
          twitchClientId: "client",
          twitchClientSecret: "secret"
        }),
        twitch: { status: "connected", broadcasterLogin: "streamer" }
      }),
      {}
    );

    expect(steps.map((step) => `${step.id}:${step.complete}`)).toEqual([
      "owner:true",
      "instance:true",
      "twitch-app:true",
      "twitch-connect:true",
      "done:true"
    ]);
  });

  it("treats env-configured installs as already past the matching steps", () => {
    // An install that keeps APP_URL and Twitch credentials in .env never sees those steps as open:
    // the wizard describes reality, and reality includes the environment.
    const steps = deriveSetupWizardSteps(wizardState(), {
      APP_URL: "https://env.example",
      TWITCH_CLIENT_ID: "env-client",
      TWITCH_CLIENT_SECRET: "env-secret"
    });

    expect(steps.find((step) => step.id === "instance")?.complete).toBe(true);
    expect(steps.find((step) => step.id === "twitch-app")?.complete).toBe(true);
    expect(steps.find((step) => step.id === "twitch-connect")?.complete).toBe(false);
  });
});

describe("resolveActiveSetupWizardStep", () => {
  it("pins everything to the owner step until an owner exists", () => {
    // Every later step writes managed config behind role checks; without an owner there is no
    // session to hold those roles, so a requested step cannot jump the queue.
    expect(activeStep(wizardState({ owner: null }))).toBe("owner");
    expect(activeStep(wizardState({ owner: null }), {}, "twitch-app")).toBe("owner");
  });

  it("continues at the first unconfigured step", () => {
    expect(activeStep(wizardState())).toBe("instance");
    expect(activeStep(wizardState({ managedConfig: emptyManagedConfig({ appUrl: "https://a.example" }) }))).toBe(
      "twitch-app"
    );
    expect(
      activeStep(
        wizardState({
          managedConfig: emptyManagedConfig({
            appUrl: "https://a.example",
            twitchClientId: "client",
            twitchClientSecret: "secret"
          })
        })
      )
    ).toBe("twitch-connect");
  });

  it("lands on done when everything is configured", () => {
    expect(
      activeStep(
        wizardState({
          managedConfig: emptyManagedConfig({
            appUrl: "https://a.example",
            twitchClientId: "client",
            twitchClientSecret: "secret"
          }),
          twitch: { status: "connected", broadcasterLogin: "streamer" }
        })
      )
    ).toBe("done");
  });

  it("lets a requested step override the derived one, which is what makes skipping work", () => {
    expect(activeStep(wizardState(), {}, "twitch-connect")).toBe("twitch-connect");
    expect(activeStep(wizardState(), {}, "not-a-step")).toBe("instance");
  });
});
