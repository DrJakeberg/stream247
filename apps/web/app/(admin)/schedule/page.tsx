export const dynamic = "force-dynamic";

import { Panel } from "@/components/panel";
import { getSchedulePreview, getWorkspaceTimeZone, readAppState } from "@/lib/server/state";

export default async function SchedulePage() {
  const state = await readAppState();
  const schedulePreview = getSchedulePreview(state);
  const timeZone = getWorkspaceTimeZone();
  type ScheduleItem = (typeof schedulePreview.items)[number];

  return (
    <Panel title="Schedule preview" eyebrow="Programming">
      <p className="subtle">
        The scheduler generates deterministic playout items with explainable
        reasons and room for manual overrides. Times are shown in {timeZone}.
      </p>
      <div className="list">
        {schedulePreview.items.map((item: ScheduleItem) => (
          <div className="item" key={item.id}>
            <strong>{item.title}</strong>
            <div className="subtle">
              {item.startTime} to {item.endTime} · {item.sourceName}
            </div>
            <div className="subtle">{item.reason}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
