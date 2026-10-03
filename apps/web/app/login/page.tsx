export const dynamic = "force-dynamic";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Panel } from "@/components/panel";
import { LoginForm } from "@/components/login-form";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";
import { getAuthenticatedUser } from "@/lib/server/auth";
import { readAppState } from "@/lib/server/state";
import { TwitchLoginPanel } from "@/components/twitch-login-panel";
import { getTwitchLoginBlocker } from "@/lib/server/twitch";
import { resolveRequestOrigin } from "@/lib/server/setup-wizard";
import { InsecureHttpNotice } from "@/components/insecure-http-notice";

export default async function LoginPage() {
  const state = await readAppState();
  // Only a yes/no check here. The URL itself is minted by /api/auth/twitch/start, because issuing
  // its state writes a cookie and a page render may not do that.
  const twitchLoginBlocker = await getTwitchLoginBlocker();
  const twitchAuthorizeUrl = twitchLoginBlocker ? null : "/api/auth/twitch/start";

  if (!state.initialized) {
    redirect("/setup");
  }

  const user = await getAuthenticatedUser();

  if (user) {
    redirect(buildWorkspaceHref("live"));
  }

  const requestOrigin = resolveRequestOrigin(await headers());

  return (
    <main className="standalone">
      <InsecureHttpNotice requestOrigin={requestOrigin} secureCookies={process.env.NODE_ENV === "production"} />
      <section className="grid two">
        <Panel title="Owner access" eyebrow="Owner sign-in">
          <p className="subtle">Use the local owner account for bootstrap, recovery, or emergency access.</p>
          <LoginForm />
        </Panel>
        <Panel title="Team sign-in" eyebrow="Twitch SSO">
          <TwitchLoginPanel authorizeUrl={twitchAuthorizeUrl} blocker={twitchLoginBlocker} />
        </Panel>
      </section>
    </main>
  );
}
