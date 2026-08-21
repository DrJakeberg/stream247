export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { Panel } from "@/components/panel";
import { LoginForm } from "@/components/login-form";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { readAppState } from "@/lib/server/state";
import { TwitchLoginPanel } from "@/components/twitch-login-panel";
import { isTwitchAuthorizeConfigured } from "@/lib/server/twitch";

export default async function LoginPage() {
  const state = await readAppState();
  // Only a yes/no check here. The URL itself is minted by /api/auth/twitch/start, because issuing
  // its state writes a cookie and a page render may not do that.
  const twitchAuthorizeUrl = (await isTwitchAuthorizeConfigured()) ? "/api/auth/twitch/start" : null;

  if (!state.initialized) {
    redirect("/setup");
  }

  const user = await getAuthenticatedUser();

  if (user) {
    redirect(buildWorkspaceHref("live"));
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
