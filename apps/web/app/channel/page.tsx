export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { cache } from "react";
import { LiveChannelPage } from "@/components/live-channel-page";
import { Panel } from "@/components/panel";
import { buildPublicChannelDescription, buildPublicChannelHeader } from "@/lib/public-channel-view";
import { getPublicChannelSnapshot, getViewerLocale, readAppState } from "@/lib/server/state";

// One state read per request, shared by the metadata and the page.
const readChannelState = cache(() => readAppState());

export async function generateMetadata(): Promise<Metadata> {
  // The root layout's description is the product's tagline, written for whoever installs it; link
  // previews of this page are seen by viewers, in the channel language.
  return { description: buildPublicChannelDescription(getViewerLocale(await readChannelState())) };
}

export default async function ChannelPage() {
  const state = await readChannelState();
  const snapshot = getPublicChannelSnapshot(state);
  const header = buildPublicChannelHeader(snapshot.locale);

  // channel-public restyles the shared primitives for the audience; see globals.css.
  // lang sits on <main>, not <html>: the root layout also serves the admin, which stays English
  // (M81), and Next.js has no per-route <html> short of splitting the app into several root layouts.
  return (
    <main className="standalone channel-public" lang={header.lang}>
      <section className="hero">
        <span className="badge">{header.badge}</span>
        <h2>{header.heading}</h2>
        {/*
          This used to read "Viewers can check the channel lineup, current block, and the next
          rotation window without opening the admin interface" — written to an operator, about
          viewers, on the page viewers read. "Current block" and "rotation window" are words from
          the scheduler; "admin interface" is a place the audience has never been and cannot go.
          The zone note moved into the live part below (M100): it names the viewer's own zone, which
          only the browser knows.
        */}
      </section>
      <Panel title={header.lineupTitle} eyebrow={header.lineupEyebrow}>
        <LiveChannelPage initialSnapshot={snapshot} />
      </Panel>
    </main>
  );
}
