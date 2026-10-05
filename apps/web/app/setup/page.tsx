export const dynamic = "force-dynamic";

import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isScheduleBlockDated } from "@stream247/core";
import { DEV_FALLBACK_APP_SECRET, resolveAppBaseUrl, resolveAppSecret } from "@stream247/db";
import { GoLiveChecklist } from "@/components/go-live-checklist";
import { InsecureHttpNotice } from "@/components/insecure-http-notice";
import { LibraryUploadForm } from "@/components/library-upload-form";
import { Panel } from "@/components/panel";
import { SetupDestinationForm } from "@/components/setup-destination-form";
import { SetupForm } from "@/components/setup-form";
import { SetupInstanceForm } from "@/components/setup-instance-form";
import { SetupProgrammeForm } from "@/components/setup-programme-form";
import { SetupTwitchAppForm } from "@/components/setup-twitch-app-form";
import { TwitchAccountsPanel } from "@/components/twitch-accounts-panel";
import { ToastProvider } from "@/components/ui/Toast";
import { DESTINATION_STATUS_LABELS, describeStreamKey } from "@/lib/destination-wording";
import { buildTwitchAccountsPanelProps } from "@/lib/server/twitch-accounts-panel";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";
import { getGoLiveChecklist } from "@/lib/server/onboarding";
import {
  deriveSetupWizardSteps,
  listSetupProgrammeSources,
  resolveRequestOrigin,
  resolveActiveSetupWizardStep,
  type SetupWizardStepId
} from "@/lib/server/setup-wizard";
import { readAppState } from "@/lib/server/state";
import { getAbsoluteAppUrl, getTwitchBroadcasterRedirectUri } from "@/lib/server/twitch";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { TWITCH_ACCOUNT_COUNT_SENTENCE, TWITCH_DEVELOPER_CONSOLE_URL } from "@/lib/twitch-account-texts";

const STEP_ORDER: SetupWizardStepId[] = [
  "owner",
  "instance",
  "twitch-app",
  "twitch-connect",
  "destination",
  "programme",
  "done"
];

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

  const checklist = getGoLiveChecklist(state);
  const checklistReady = (id: string) => checklist.some((item) => item.id === id && item.status === "ready");
  const steps = deriveSetupWizardSteps(state, process.env, {
    destinationReady: checklistReady("destination"),
    programmeReady: checklistReady("pools") && checklistReady("schedule")
  });
  const active = resolveActiveSetupWizardStep(steps, searchParams.step);
  const activeIndex = STEP_ORDER.indexOf(active);
  const twitchAccountsPanel = await buildTwitchAccountsPanelProps(state, user?.role);
  const requestOrigin = resolveRequestOrigin(await headers());

  const publicBaseUrl = resolveAppBaseUrl(state.managedConfig);
  // The built-in primary destination is the one the wizard fills; it cannot be deleted, so the fallback
  // to the first primary only covers a workspace restored from an old blueprint.
  const primaryDestination =
    state.destinations.find((destination) => destination.id === "destination-primary") ??
    state.destinations.find((destination) => destination.role === "primary") ??
    null;
  const programmeSources = listSetupProgrammeSources(state);
  const hasPlayableMedia = programmeSources.some((source) => source.readyCount > 0);
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
      <InsecureHttpNotice requestOrigin={requestOrigin} secureCookies={process.env.NODE_ENV === "production"} />
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
              drives the schedule grid and the on-air clock; the channel language is the one viewers are addressed in.
            </p>
            <SetupInstanceForm
              detectedAppUrl={requestOrigin}
              envAppUrl={(process.env.APP_URL || "").trim()}
              envLanguage={(process.env.CHANNEL_LANGUAGE || "").trim()}
              envTimezone={(process.env.CHANNEL_TIMEZONE || "").trim()}
              initialAppUrl={state.managedConfig.appUrl}
              initialLanguage={state.managedConfig.channelLanguage ?? ""}
              initialTimezone={state.managedConfig.channelTimezone}
              zoneInUse={Boolean(state.managedConfig.appUrl) || state.scheduleBlocks.length > 0}
            />
            <SkipLink from="instance" />
          </Panel>
        ) : null}
        {active === "twitch-app" ? (
          <Panel title="Twitch app credentials" eyebrow={`Step ${activeIndex + 1}`}>
            <p className="subtle">
              Register an application in the{" "}
              <a href={TWITCH_DEVELOPER_CONSOLE_URL} rel="noopener noreferrer" target="_blank">
                Twitch developer console
              </a>{" "}
              with these redirect URLs, then store its credentials here. They are encrypted with the app secret.
            </p>
            <div className="list">
              <div className="item">
                <strong>OAuth redirect URLs to register</strong>
                {publicBaseUrl ? (
                  <>
                    <div className="subtle">
                      Bot account connection: {getAbsoluteAppUrl(state, "/api/integrations/twitch/callback")}
                    </div>
                    <div className="subtle">Team sign-in with Twitch: {getAbsoluteAppUrl(state, "/api/auth/twitch/callback")}</div>
                    <div className="subtle">Channel owner connection: {getTwitchBroadcasterRedirectUri(state)}</div>
                    <div className="subtle">
                      All three, exactly as printed (the URL only, without the label). A missing one ends that
                      connection in Twitch’s “redirect mismatch”.
                    </div>
                  </>
                ) : (
                  // Without a public URL these would read http://localhost:3000/…, and a person would register
                  // them on Twitch and get a redirect mismatch once the real URL is set.
                  <div className="subtle">
                    Set the public URL in <Link href={stepHref("instance")}>step 2</Link> first — the redirect URLs are
                    built from it.
                  </div>
                )}
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
          <Panel title="Twitch accounts" eyebrow={`Step ${activeIndex + 1}`}>
            <p className="subtle">
              {TWITCH_ACCOUNT_COUNT_SENTENCE} The broadcast channel is where the video goes and viewers watch (its
              stream key goes into the output destination); the bot account is what Stream247 signs in as for chat
              and moderation. Name the broadcast channel, then connect the bot account;
              the channel&apos;s own account can connect later for title, category and schedule. Twitch sends you to
              Admin → Settings → Twitch accounts when it is done; come back to{" "}
              <Link href={stepHref("destination")}>/setup</Link> for the stream key and the first programme.
            </p>
            <TwitchAccountsPanel {...twitchAccountsPanel.props} />
            <SkipLink from="twitch-connect" />
          </Panel>
        ) : null}
        {active === "destination" ? (
          <Panel title="Where the stream goes" eyebrow={`Step ${activeIndex + 1}`}>
            <p className="subtle">
              Without a stream key nothing goes on air. The key belongs to the broadcast channel, never to the bot
              account: sign in to Twitch as the broadcast channel, open the Creator Dashboard at Settings → Stream and
              copy the Primary Stream key. It is a password for the channel; never paste it into chat or a
              screenshot.
            </p>
            {primaryDestination ? (
              <>
                <div className="item">
                  <strong>{primaryDestination.name}</strong>
                  <div className="subtle">
                    {DESTINATION_STATUS_LABELS[primaryDestination.status]} ·{" "}
                    {describeStreamKey(primaryDestination.streamKeyPresent, primaryDestination.streamKeySource)}
                  </div>
                </div>
                <SetupDestinationForm
                  destinationId={primaryDestination.id}
                  destinationName={primaryDestination.name}
                  rtmpUrl={primaryDestination.rtmpUrl}
                  streamKeyPresent={primaryDestination.streamKeyPresent}
                  streamKeySource={primaryDestination.streamKeySource ?? "missing"}
                />
              </>
            ) : (
              <p className="subtle">No primary destination exists; add one under Studio → Output.</p>
            )}
            <p className="subtle">
              A backup, more destinations and their full settings are under{" "}
              <Link href={`${buildWorkspaceHref("studio", "output")}#output-destinations`}>Studio → Output</Link>.
            </p>
            <SkipLink from="destination" />
          </Panel>
        ) : null}
        {active === "programme" ? (
          <Panel title="First programme" eyebrow={`Step ${activeIndex + 1}`}>
            <p className="subtle">
              Pick the media the channel plays. A pool is made from it, and the week is filled with it around the
              clock, so the channel has something to air every hour.
            </p>
            {steps.find((step) => step.id === "programme")?.complete ? (
              <div className="item">
                <strong>The week already plays</strong>
                <div className="subtle">
                  {checklist.find((item) => item.id === "schedule")?.detail} A pool made here again only fills the week
                  in place of those blocks, with “Replace the blocks already in the week”.
                </div>
              </div>
            ) : null}
            {hasPlayableMedia ? (
              <SetupProgrammeForm
                scheduleBlockCount={state.scheduleBlocks.length}
                sources={programmeSources}
                weeklyBlockCount={state.scheduleBlocks.filter((block) => !isScheduleBlockDated(block)).length}
              />
            ) : (
              <div className="stack-form">
                <div className="item">
                  <strong>No video is ready yet</strong>
                  <div className="subtle">
                    Upload files here, put them into data/media on the host (mp4, mkv, mov, m4v or webm), or add a
                    YouTube, Twitch or direct media source under{" "}
                    <Link href={buildWorkspaceHref("program", "sources")}>Program → Sources</Link>. New files are
                    scanned within a few minutes; <Link href={stepHref("programme")}>check again</Link> then.
                  </div>
                </div>
                <ToastProvider>
                  <LibraryUploadForm />
                </ToastProvider>
              </div>
            )}
            <SkipLink from="programme" />
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
              More sources, the schedule and further destinations are ordinary workspace tasks; the checklist below
              keeps track of what is still missing.
            </p>
            <a className="button" href={buildWorkspaceHref("live", "status")}>
              Open the workspace
            </a>
          </Panel>
        ) : null}
        {active === "done" ? (
          <Panel title="Readiness checklist" eyebrow="Before launch">
            <GoLiveChecklist items={checklist} />
          </Panel>
        ) : null}
      </section>
    </main>
  );
}
