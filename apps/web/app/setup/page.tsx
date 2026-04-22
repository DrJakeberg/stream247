export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { GoLiveChecklist } from "@/components/go-live-checklist";
import { Panel } from "@/components/panel";
import { SetupForm } from "@/components/setup-form";
import { TwitchConnectPanel } from "@/components/twitch-connect-panel";
import { getGoLiveChecklist } from "@/lib/server/onboarding";
import { readAppState } from "@/lib/server/state";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { getTwitchAuthorizeUrl } from "@/lib/server/twitch";

export default async function SetupPage() {
  const state = await readAppState();
  const user = await getAuthenticatedUser();
  const twitchAuthorizeUrl = await getTwitchAuthorizeUrl("broadcaster-connect");
  const checklist = getGoLiveChecklist(state);

  if (state.initialized) {
    redirect(user ? "/dashboard" : "/login");
  }

  return (
    <main className="standalone">
      <section className="hero">
        <span className="badge">First-run setup</span>
        <h2>Deploy the stack, open the browser, bootstrap the workspace.</h2>
        <p>
          Create the owner account first. You can still keep external-service credentials in `.env`, but Stream247 also
          supports encrypted managed credentials after bootstrap.
        </p>
      </section>
      <section className="grid two">
        <Panel title="Owner account" eyebrow="Step 1">
          <SetupForm />
        </Panel>
        <Panel title="Twitch connection" eyebrow="Step 2">
          <p className="subtle">
            Twitch connection becomes available after the workspace is initialized. Configure these before clicking
            connect:
          </p>
          <div className="list">
            <div className="item">
              <strong>Set Twitch client credentials in `.env` or save them after bootstrap in settings</strong>
              <div className="subtle">
                The setup form can now store them encrypted, and the admin settings page can update them later.
              </div>
            </div>
            <div className="item">
              <strong>Register redirect URLs in the Twitch developer console</strong>
              <div className="subtle">
                {(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/integrations/twitch/callback
              </div>
              <div className="subtle">
                {(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/auth/twitch/callback
              </div>
            </div>
          </div>
          <TwitchConnectPanel authorizeUrl={twitchAuthorizeUrl} />
        </Panel>
        <Panel title="Go-live checklist" eyebrow="Before launch">
          <p className="subtle">
            Stream247 can explain what is still missing before the channel is truly ready, even before the first
            broadcast starts.
          </p>
          <GoLiveChecklist items={checklist} />
        </Panel>
      </section>
    </main>
  );
}
