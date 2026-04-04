export const dynamic = "force-dynamic";

import { LiveOverlay } from "@/components/live-overlay";
import { getPublicChannelSnapshot, readAppState } from "@/lib/server/state";

export default async function OverlayPage() {
  const state = await readAppState();
  return <LiveOverlay initialSnapshot={getPublicChannelSnapshot(state)} />;
}
