export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { Panel } from "@/components/panel";
import { LoginForm } from "@/components/login-form";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { readAppState } from "@/lib/server/state";
import { TwitchLoginPanel } from "@/components/twitch-login-panel";
import { getTwitchAuthorizeUrl } from "@/lib/server/twitch";

export default async function LoginPage() {
  const state = await readAppState();
  const twitchAuthorizeUrl = await getTwitchAuthorizeUrl("team-login");

  if (!state.initialized) {
    redirect("/setup");
  }

  const user = await getAuthenticatedUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="standalone">
      <section className="grid two">
        <Panel title="Owner access" eyebrow="Local bootstrap">
          <p className="subtle">Use the local owner account for bootstrap, recovery, or emergency access.</p>
          <LoginForm />
        </Panel>
        <Panel title="Team sign-in" eyebrow="Twitch SSO">
          <TwitchLoginPanel authorizeUrl={twitchAuthorizeUrl} />
        </Panel>
      </section>
    </main>
  );
}
