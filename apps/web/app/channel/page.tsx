import { Panel } from "@/components/panel";
import { schedulePreview } from "@/lib/mock-data";

export default function ChannelPage() {
  return (
    <>
      <section className="hero">
        <span className="badge">Public schedule</span>
        <h2>What is live now, and what comes next.</h2>
        <p>
          Viewers can check the channel lineup, current block, and the next
          rotation window without opening the admin interface.
        </p>
      </section>
      <Panel title="Upcoming lineup" eyebrow="Viewer page">
        <div className="list">
          {schedulePreview.items.map((item) => (
            <div className="item" key={item.id}>
              <strong>{item.title}</strong>
              <div className="subtle">
                {item.startTime} to {item.endTime} · {item.categoryName}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
