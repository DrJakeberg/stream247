import { describe, expect, it } from "vitest";
import type { ManagedConfigRecord } from "../../packages/db/src/index.js";
import {
  deriveSetupWizardSteps,
  listSetupProgrammeSources,
  resolveActiveSetupWizardStep,
  type SetupWizardReadiness,
  type SetupWizardStateSlice
} from "../../apps/web/lib/server/setup-wizard.js";

function emptyManagedConfig(overrides: Partial<ManagedConfigRecord> = {}): ManagedConfigRecord {
  return {
    appUrl: "",
    channelTimezone: "",
    twitchClientId: "",
    twitchClientSecret: "",
    twitchDefaultCategoryId: "",
    twitchBotLogin: "",
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

const ALL_READY: SetupWizardReadiness = { destinationReady: true, programmeReady: true };

function activeStep(
  state: SetupWizardStateSlice,
  env: Record<string, string | undefined> = {},
  requested?: string,
  readiness?: SetupWizardReadiness
) {
  return resolveActiveSetupWizardStep(deriveSetupWizardSteps(state, env, readiness), requested);
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
      {},
      ALL_READY
    );

    expect(steps.map((step) => `${step.id}:${step.complete}`)).toEqual([
      "owner:true",
      "instance:true",
      "twitch-app:true",
      "twitch-connect:true",
      "destination:true",
      "programme:true",
      "done:true"
    ]);
  });

  it("M99: takes the stream key and first programme steps from readiness, and Review waits for them", () => {
    const configured = wizardState({
      managedConfig: emptyManagedConfig({
        appUrl: "https://stream.example",
        twitchClientId: "client",
        twitchClientSecret: "secret"
      }),
      twitch: { status: "connected", broadcasterLogin: "streamer" }
    });
    const completion = (readiness?: SetupWizardReadiness) =>
      deriveSetupWizardSteps(configured, {}, readiness)
        .filter((step) => ["destination", "programme", "done"].includes(step.id))
        .map((step) => `${step.id}:${step.complete}`);

    // Without readiness (the old two-argument call) neither step is done, so Review is not either.
    expect(completion()).toEqual(["destination:false", "programme:false", "done:false"]);
    expect(completion({ destinationReady: true, programmeReady: false })).toEqual([
      "destination:true",
      "programme:false",
      "done:false"
    ]);
    expect(completion({ destinationReady: false, programmeReady: true })).toEqual([
      "destination:false",
      "programme:true",
      "done:false"
    ]);
    expect(completion(ALL_READY)).toEqual(["destination:true", "programme:true", "done:true"]);
    expect(deriveSetupWizardSteps(configured, {}).map((step) => step.title)).toEqual([
      "Owner account",
      "Instance basics",
      "Twitch app credentials",
      "Twitch accounts",
      "Where the stream goes",
      "First programme",
      "Review"
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
        }),
        {},
        undefined,
        ALL_READY
      )
    ).toBe("done");
  });

  it("M99: continues with the stream key, then the first programme, after the Twitch steps", () => {
    const twitchDone = wizardState({
      managedConfig: emptyManagedConfig({
        appUrl: "https://a.example",
        twitchClientId: "client",
        twitchClientSecret: "secret"
      }),
      twitch: { status: "connected", broadcasterLogin: "streamer" }
    });
    expect(activeStep(twitchDone)).toBe("destination");
    expect(activeStep(twitchDone, {}, undefined, { destinationReady: true, programmeReady: false })).toBe("programme");
    // Skipping the stream key leaves it open and goes on to the programme.
    expect(activeStep(twitchDone, {}, "programme")).toBe("programme");
    // A skipped Twitch step does not hold back the later ones once they are reached by link.
    expect(activeStep(wizardState(), {}, "destination")).toBe("destination");
  });

  it("lets a requested step override the derived one, which is what makes skipping work", () => {
    expect(activeStep(wizardState(), {}, "twitch-connect")).toBe("twitch-connect");
    expect(activeStep(wizardState(), {}, "not-a-step")).toBe("instance");
  });
});

describe("listSetupProgrammeSources (M99, U2)", () => {
  it("counts per enabled source the videos a pool could play now", () => {
    const asset = (id: string, sourceId: string, extra: Record<string, unknown> = {}) =>
      ({ id, sourceId, status: "ready", includeInProgramming: true, ...extra }) as never;
    const sources = [
      { id: "source-local-library", name: "Local Media Library", enabled: true },
      { id: "source-yt", name: "YouTube", enabled: true },
      { id: "source-off", name: "Disabled", enabled: false }
    ] as never[];
    const assets = [
      asset("a1", "source-local-library"),
      asset("a2", "source-local-library"),
      asset("a3", "source-local-library", { status: "pending" }),
      asset("a4", "source-local-library", { includeInProgramming: false }),
      // Quarantined: three probe failures in a row.
      asset("a5", "source-yt", { playbackProbeFailures: 3 }),
      asset("a6", "source-off")
    ];

    expect(listSetupProgrammeSources({ sources, assets } as never)).toEqual([
      { id: "source-local-library", name: "Local Media Library", readyCount: 2 },
      { id: "source-yt", name: "YouTube", readyCount: 0 }
    ]);
  });
});
