export const dynamic = "force-dynamic";

import { Panel } from "@/components/panel";
import { TeamAccessForm } from "@/components/team-access-form";
import { requireRoles } from "@/lib/server/auth";
import { readAppState } from "@/lib/server/state";

export default async function TeamPage() {
  await requireRoles(["owner", "admin"]);
  const state = await readAppState();

  return (
    <div className="grid two">
      <Panel title="Twitch team access" eyebrow="Identity">
        <p className="subtle">
          Grant access by Twitch login. Team members authenticate with Twitch SSO and inherit the configured tool role.
        </p>
        <TeamAccessForm />
      </Panel>

      <Panel title="Current grants" eyebrow="Access list">
        <div className="list">
          {state.teamAccessGrants.length > 0 ? (
            state.teamAccessGrants.map((grant) => (
              <div className="item" key={grant.id}>
                <strong>{grant.twitchLogin}</strong>
                <div className="subtle">
                  Role: {grant.role} · Added {new Date(grant.createdAt).toLocaleString()}
                </div>
              </div>
            ))
          ) : (
            <div className="item">
              <strong>No Twitch team access grants yet</strong>
              <div className="subtle">Add moderators or operators by Twitch login to enable Twitch SSO access.</div>
            </div>
          )}
        </div>
        <div className="list" style={{ marginTop: 16 }}>
          <div className="item">
            <strong>Active users</strong>
            <div className="subtle">{state.users.length} user account(s) currently known to the workspace.</div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
