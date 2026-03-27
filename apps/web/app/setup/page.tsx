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
        <p>Create the owner account first. Then connect Twitch from the same setup flow.</p>
      </section>
      <section className="grid two">
        <Panel title="Owner account" eyebrow="Step 1">
          <SetupForm />
        </Panel>
        <Panel title="Twitch connection" eyebrow="Step 2">
          <p className="subtle">
            Twitch connection becomes available after the workspace is initialized. If OAuth is not configured yet,
            the admin UI will explain what is missing.
          </p>
          <TwitchConnectPanel authorizeUrl={getTwitchAuthorizeUrl("broadcaster-connect")} />
        </Panel>
      </section>
    </main>
  );
}
