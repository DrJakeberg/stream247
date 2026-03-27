export const dynamic = "force-dynamic";

import { Panel } from "@/components/panel";
import { readAppState, getSchedulePreview, getWorkspaceTimeZone } from "@/lib/server/state";

export default async function ChannelPage() {
  const state = await readAppState();
  const schedulePreview = getSchedulePreview(state);
  const timeZone = getWorkspaceTimeZone();
  type ScheduleItem = (typeof schedulePreview.items)[number];

  return (
    <main className="standalone">
      <section className="hero">
        <span className="badge">Public schedule</span>
        <h2>What is live now, and what comes next.</h2>
        <p>
          Viewers can check the channel lineup, current block, and the next
          rotation window without opening the admin interface. Times are shown in {timeZone}.
        </p>
      </section>
      <Panel title="Upcoming lineup" eyebrow="Viewer page">
        <div className="list">
          {schedulePreview.items.map((item: ScheduleItem) => (
            <div className="item" key={item.id}>
              <strong>{item.title}</strong>
              <div className="subtle">
                {item.startTime} to {item.endTime} · {item.categoryName}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </main>
  );
}
