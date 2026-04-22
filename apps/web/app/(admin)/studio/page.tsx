export const dynamic = "force-dynamic";

import OutputPage from "@/app/(admin)/output/page";
import OverlayStudioPage from "@/app/(admin)/overlay-studio/page";
import OverlaysPage from "@/app/(admin)/overlays/page";
import { WorkspaceTabs } from "@/components/workspace-tabs";
import { resolveWorkspaceTabId } from "@/lib/workspace-navigation";

export default async function StudioWorkspacePage(props: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const tab = resolveWorkspaceTabId("studio", searchParams.tab);

  return (
    <div className="stack-form">
      <WorkspaceTabs activeTabId={tab} workspaceId="studio" />
      {tab === "scene" ? <OverlayStudioPage /> : null}
      {tab === "engagement" ? <OverlaysPage /> : null}
      {tab === "output" ? <OutputPage /> : null}
    </div>
  );
}
