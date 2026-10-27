export const dynamic = "force-dynamic";

import OutputPage from "@/app/(admin)/output/page";
import OverlayStudioPage from "@/app/(admin)/overlay-studio/page";
import OverlaysPage from "@/app/(admin)/overlays/page";
import { WorkspaceTabs } from "@/components/workspace-tabs";
import { resolveWorkspaceTabId } from "@/lib/workspace-navigation";
import { requireAuthenticatedUser } from "@/lib/server/auth";

export default async function StudioWorkspacePage(props: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  // Every page checks the sign-in itself (M125): the layout's check is not a guarantee for every render path.
  await requireAuthenticatedUser();
  const searchParams = await props.searchParams;
  const tab = resolveWorkspaceTabId("studio", searchParams.tab);

  return (
    <div className={tab === "scene" ? "stack-form workspace-wide" : "stack-form"}>
      <WorkspaceTabs activeTabId={tab} workspaceId="studio" />
      {tab === "scene" ? <OverlayStudioPage /> : null}
      {tab === "engagement" ? <OverlaysPage /> : null}
      {tab === "output" ? <OutputPage /> : null}
    </div>
  );
}
