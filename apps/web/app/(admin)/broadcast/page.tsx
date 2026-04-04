export const dynamic = "force-dynamic";

import { BroadcastControlRoom } from "@/components/broadcast-control-room";
import { getBroadcastSnapshot, readAppState } from "@/lib/server/state";

export default async function BroadcastPage() {
  const state = await readAppState();

  return (
    <BroadcastControlRoom
      assets={state.assets.filter((asset) => asset.status === "ready").map((asset) => ({ id: asset.id, title: asset.title }))}
      initialSnapshot={getBroadcastSnapshot(state)}
    />
  );
}
