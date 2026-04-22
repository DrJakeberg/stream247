import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const liveWorkspacePageSource = readFileSync(path.join(process.cwd(), "apps/web/app/(admin)/live/page.tsx"), "utf8");
const liveWorkspaceHeaderSource = readFileSync(
  path.join(process.cwd(), "apps/web/components/live-workspace-header.tsx"),
  "utf8"
);

describe("live workspace header", () => {
  it("renders one shared live-status header above the workspace tabs", () => {
    expect(liveWorkspacePageSource).toContain('import { LiveWorkspaceHeader }');
    expect(liveWorkspacePageSource).toContain("<LiveWorkspaceHeader initialSnapshot={getBroadcastSnapshot(state)} />");
  });

  it("shows Twitch status, uptime, viewer count, and a separate playout chip", () => {
    expect(liveWorkspaceHeaderSource).toContain("getBroadcastLiveStatusLabel(snapshot.twitch)");
    expect(liveWorkspaceHeaderSource).toContain("getBroadcastLiveUptimeLabel(snapshot.twitch)");
    expect(liveWorkspaceHeaderSource).toContain("getBroadcastLiveViewerCountLabel(snapshot.twitch)");
    expect(liveWorkspaceHeaderSource).toContain("Feed running");
    expect(liveWorkspaceHeaderSource).toContain('<span className="label">Twitch uptime</span>');
    expect(liveWorkspaceHeaderSource).toContain('<span className="label">Viewers</span>');
  });
});
