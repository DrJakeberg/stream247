export const dynamic = "force-dynamic";

import { LiveOverlay } from "@/components/live-overlay";
import { getPublicChannelSnapshot, readAppState } from "@/lib/server/state";

type OverlayPageProps = {
  searchParams: Promise<{
    chromeless?: string;
  }>;
};

export default async function OverlayPage(props: OverlayPageProps) {
  const state = await readAppState();
  const searchParams = await props.searchParams;
  return <LiveOverlay chromeless={searchParams.chromeless === "1"} initialSnapshot={getPublicChannelSnapshot(state)} />;
}
