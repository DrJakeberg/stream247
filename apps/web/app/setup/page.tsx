export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { DEV_FALLBACK_APP_SECRET, resolveAppSecret } from "@stream247/db";
import { GoLiveChecklist } from "@/components/go-live-checklist";
import { Panel } from "@/components/panel";
import { SetupForm } from "@/components/setup-form";
import { SetupInstanceForm } from "@/components/setup-instance-form";
import { SetupTwitchAppForm } from "@/components/setup-twitch-app-form";
import { TwitchConnectPanel } from "@/components/twitch-connect-panel";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";
import { getGoLiveChecklist } from "@/lib/server/onboarding";
import {
  deriveSetupWizardSteps,
  resolveActiveSetupWizardStep,
  type SetupWizardStepId
} from "@/lib/server/setup-wizard";
import { readAppState } from "@/lib/server/state";
import { getAbsoluteAppUrl, isTwitchAuthorizeConfigured } from "@/lib/server/twitch";
import { getAuthenticatedUser } from "@/lib/server/auth";

const STEP_ORDER: SetupWizardStepId[] = ["owner", "instance", "twitch-app", "twitch-connect", "done"];

function stepHref(step: SetupWizardStepId): string {
  return `/setup?step=${step}`;
}

function nextStepHref(current: SetupWizardStepId): string {
  const index = STEP_ORDER.indexOf(current);
  return stepHref(STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)]);
}

/** The "each step skippable" half of the wizard contract; the rail keeps the skipped step open. */
function SkipLink({ from }: { from: SetupWizardStepId }) {
  return (
    <p className="subtle">
      <Link href={nextStepHref(from)}>Skip this step for now</Link> — it stays open in the list and can be finished any
      time, here or in the workspace settings.
    </p>
  );
}

export default async function SetupPage(props: { searchParams?: Promise<{ step?: string }> }) {
  const searchParams = props.searchParams ? await props.searchParams : {};
  const state = await readAppState();
  const user = await getAuthenticatedUser();

  // Before an owner exists the wizard is the bootstrap surface and must be reachable without a
  // session. From then on every remaining step writes managed config behind role checks, so an
  // unauthenticated visit goes to the login page — same as any other operator surface.
  if (state.initialized && !user) {
    redirect("/login");
  }

  const steps = deriveSetupWizardSteps(state);
  const active = resolveActiveSetupWizardStep(steps, searchParams.step);
  const activeIndex = STEP_ORDER.indexOf(active);
  const twitchAuthorizeUrl = (await isTwitchAuthorizeConfigured()) ? "/api/integrations/twitch/connect" : null;

  const envAppSecret = Boolean((process.env.APP_SECRET || "").trim());
  // The secret story for the review step. resolveAppSecret only throws when production has neither
  // env nor a writable data volume — a state in which this page would not be rendering anyway.
  let generatedSecretActive = false;
  try {
    generatedSecretActive = !envAppSecret && resolveAppSecret() !== DEV_FALLBACK_APP_SECRET;
  } catch {
    generatedSecretActive = false;
  }

  return (
    <main className="standalone">
      <section className="hero">
        <span className="badge">First-run setup</span>
        <h2>Deploy the stack, open the browser, set everything up from here.</h2>
        <p>
          No hand-written .env required: the app secret generates itself, the bundled database configures itself, and
          this wizard covers the rest. Every value it writes can still be overridden by an environment variable, which
          also means existing installs keep working unchanged.
        </p>
      </section>
      <section className="grid two">
        <Panel title="Setup steps" eyebrow="Progress">
          <div className="list">
            {steps.map((step, index) => (
              <div className="item" key={step.id}>
                <div className="stats-row">
                  <strong>
                    {index + 1}. {step.title}
                  </strong>
                  <span className={`badge badge-${step.complete ? "ready" : step.id === active ? "action" : "optional"}`}>
                    {step.complete ? "Done" : step.id === active ? "Current" : "Open"}
                  </span>
                </div>
                <div className="subtle">{step.summary}</div>
                {state.owner && step.id !== active ? (
                  <div className="subtle" style={{ marginTop: 8 }}>
                    <Link href={stepHref(step.id)}>Go to this step</Link>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
        {active === "owner" ? (
          <Panel title="Owner account" eyebrow={`Step ${activeIndex + 1}`}>
            <SetupForm />
          </Panel>
        ) : null}
        {active === "instance" ? (
          <Panel title="Instance basics" eyebrow={`Step ${activeIndex + 1}`}>
            <p className="subtle">
              The public URL is what OAuth callbacks, EventSub webhooks, and overlay links are built from; the timezone
              drives the schedule grid and the on-air clock.
            </p>
            <SetupInstanceForm
              envAppUrl={(process.env.APP_URL || "").trim()}
              envTimezone={(process.env.CHANNEL_TIMEZONE || "").trim()}
              initialAppUrl={state.managedConfig.appUrl}
              initialTimezone={state.managedConfig.channelTimezone}
            />
            <SkipLink from="instance" />
          </Panel>
        ) : null}
        {active === "twitch-app" ? (
          <Panel title="Twitch app credentials" eyebrow={`Step ${activeIndex + 1}`}>
            <p className="subtle">
              Register an application in the Twitch developer console with these redirect URLs, then store its
              credentials here. They are encrypted with the app secret.
            </p>
            <div className="list">
              <div className="item">
                <strong>OAuth redirect URLs to register</strong>
                <div className="subtle">{getAbsoluteAppUrl(state, "/api/integrations/twitch/callback")}</div>
                <div className="subtle">{getAbsoluteAppUrl(state, "/api/auth/twitch/callback")}</div>
              </div>
            </div>
            <SetupTwitchAppForm
              hasStoredClientSecret={Boolean(state.managedConfig.twitchClientSecret)}
              initialClientId={state.managedConfig.twitchClientId}
            />
            <SkipLink from="twitch-app" />
          </Panel>
        ) : null}
        {active === "twitch-connect" ? (
          <Panel title="Connect Twitch" eyebrow={`Step ${activeIndex + 1}`}>
            <p className="subtle">
              Signs the channel&apos;s Twitch account into this workspace so metadata, schedule sync, and team access
              can work. Twitch sends you back into the workspace when it is done.
            </p>
            <TwitchConnectPanel authorizeUrl={twitchAuthorizeUrl} />
            <SkipLink from="twitch-connect" />
          </Panel>
        ) : null}
        {active === "done" ? (
          <Panel title="Nothing left to type" eyebrow={`Step ${activeIndex + 1}`}>
            <div className="list">
              <div className="item">
                <strong>App secret</strong>
                <div className="subtle">
                  {envAppSecret
                    ? "Provided via the APP_SECRET environment variable."
                    : generatedSecretActive
                      ? "Generated on first boot and stored on the data volume. Nothing to configure; set APP_SECRET only to pin your own."
                      : "Running on the development fallback — fine locally, refused in production."}
                </div>
              </div>
              <div className="item">
                <strong>Database</strong>
                <div className="subtle">
                  {(process.env.DATABASE_URL || "").trim()
                    ? "DATABASE_URL is set in the environment."
                    : "The bundled Postgres needs no configuration; DATABASE_URL exists only for pointing at an external database."}
                </div>
              </div>
            </div>
            <p className="subtle">
              Sources, the schedule, and stream destinations are ordinary workspace tasks — the checklist below keeps
              track of them.
            </p>
            <a className="button" href={buildWorkspaceHref("live", "status")}>
              Open the workspace
            </a>
          </Panel>
        ) : null}
        {active === "done" ? (
          <Panel title="Readiness checklist" eyebrow="Before launch">
            <GoLiveChecklist items={getGoLiveChecklist(state)} />
          </Panel>
        ) : null}
      </section>
    </main>
  );
}
