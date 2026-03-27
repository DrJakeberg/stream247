export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { Panel } from "@/components/panel";
import { SetupForm } from "@/components/setup-form";
import { TwitchConnectPanel } from "@/components/twitch-connect-panel";
import { readAppState } from "@/lib/server/state";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { getTwitchAuthorizeUrl } from "@/lib/server/twitch";

export default async function SetupPage() {
  const state = await readAppState();
  const user = await getAuthenticatedUser();

  if (state.initialized) {
    redirect(user ? "/dashboard" : "/login");
  }

  return (
    <main className="standalone">
      <section className="hero">
        <span className="badge">First-run setup</span>
        <h2>Deploy the stack, open the browser, bootstrap the workspace.</h2>
        <p>
          Create the owner account first. Twitch OAuth client credentials stay in `.env` for now, because client
          secrets should not be stored through the browser UI in plaintext.
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
              <strong>Set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in `.env`</strong>
              <div className="subtle">These are application secrets and should stay outside normal runtime forms.</div>
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
          <TwitchConnectPanel authorizeUrl={getTwitchAuthorizeUrl("broadcaster-connect")} />
        </Panel>
      </section>
    </main>
  );
}
