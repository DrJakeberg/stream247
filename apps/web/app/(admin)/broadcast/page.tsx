export const dynamic = "force-dynamic";

import { BroadcastControlRoom } from "@/components/broadcast-control-room";
import { getBroadcastSnapshot, readAppState } from "@/lib/server/state";
import { requireAuthenticatedUser } from "@/lib/server/auth";

export default async function BroadcastPage() {
  // Every page checks the sign-in itself (M125): the layout's check is not a guarantee for every render path.
  await requireAuthenticatedUser();
  const state = await readAppState();

  return (
    <BroadcastControlRoom
      assets={state.assets.filter((asset) => asset.status === "ready").map((asset) => ({ id: asset.id, title: asset.title }))}
      initialSnapshot={getBroadcastSnapshot(state)}
    />
  );
}
