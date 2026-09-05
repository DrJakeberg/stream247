export const dynamic = "force-dynamic";

import { LiveChannelPage } from "@/components/live-channel-page";
import { Panel } from "@/components/panel";
import { getPublicChannelSnapshot, getWorkspaceTimeZone, readAppState } from "@/lib/server/state";

export default async function ChannelPage() {
  const state = await readAppState();
  const timeZone = getWorkspaceTimeZone(state);

  // channel-public restyles the shared primitives for the audience; see globals.css.
  return (
    <main className="standalone channel-public">
      <section className="hero">
        <span className="badge">Schedule</span>
        <h2>What is live now, and what comes next.</h2>
        {/*
          This used to read "Viewers can check the channel lineup, current block, and the next
          rotation window without opening the admin interface" — written to an operator, about
          viewers, on the page viewers read. "Current block" and "rotation window" are words from
          the scheduler; "admin interface" is a place the audience has never been and cannot go.
          What is left is the part a visitor needs.
        */}
        <p>All times are shown in {timeZone}.</p>
      </section>
      <Panel title="Upcoming lineup" eyebrow="Schedule">
        <LiveChannelPage initialSnapshot={getPublicChannelSnapshot(state)} />
      </Panel>
    </main>
  );
}
