export const dynamic = "force-dynamic";

import { LiveChannelPage } from "@/components/live-channel-page";
import { Panel } from "@/components/panel";
import { getPublicChannelSnapshot, getWorkspaceTimeZone, readAppState } from "@/lib/server/state";

export default async function ChannelPage() {
  const state = await readAppState();
  const timeZone = getWorkspaceTimeZone();

  return (
    <main className="standalone">
      <section className="hero">
        <span className="badge">Public schedule</span>
        <h2>What is live now, and what comes next.</h2>
        <p>
          Viewers can check the channel lineup, current block, and the next
          rotation window without opening the admin interface. Times are shown in {timeZone}.
        </p>
      </section>
      <Panel title="Upcoming lineup" eyebrow="Viewer page">
        <LiveChannelPage initialSnapshot={getPublicChannelSnapshot(state)} />
      </Panel>
    </main>
  );
}
