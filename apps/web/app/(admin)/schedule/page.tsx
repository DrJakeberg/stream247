export const dynamic = "force-dynamic";

import { findScheduleConflicts, formatMinuteOfDay } from "@stream247/core";
import { Panel } from "@/components/panel";
import { ScheduleBlockDeleteForm } from "@/components/schedule-block-delete-form";
import { ScheduleBlockForm } from "@/components/schedule-block-form";
import { getSchedulePreview, getWorkspaceTimeZone, readAppState } from "@/lib/server/state";

export default async function SchedulePage() {
  const state = await readAppState();
  const schedulePreview = getSchedulePreview(state);
  const timeZone = getWorkspaceTimeZone();
  const conflicts = new Set(findScheduleConflicts(state.scheduleBlocks));
  const sourceOptions = [...new Set(state.sources.map((source) => source.name))].sort((left, right) =>
    left.localeCompare(right)
  );
  type ScheduleItem = (typeof schedulePreview.items)[number];

  return (
    <>
      <section className="grid two">
        <Panel title="Add schedule block" eyebrow="Programming">
          <p className="subtle">
            Build the day in {timeZone}. Start times are minute-accurate, durations use 15-minute steps, and
            overlapping blocks are rejected before save.
          </p>
          <ScheduleBlockForm sources={sourceOptions} />
        </Panel>

        <Panel title="Schedule preview" eyebrow="Programming">
          <p className="subtle">
            The scheduler generates deterministic playout items with explainable reasons. Times are shown in {timeZone}.
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
      </section>

      <Panel title="Existing blocks" eyebrow="Editor">
        <div className="list">
          {state.scheduleBlocks
            .slice()
            .sort((left, right) => left.startMinuteOfDay - right.startMinuteOfDay)
            .map((block) => (
              <div className="item" key={block.id}>
                <strong>{block.title}</strong>
                <div className="subtle">
                  {formatMinuteOfDay(block.startMinuteOfDay)} · {block.durationMinutes} minutes · {block.sourceName}
                </div>
                <div className="subtle">
                  {block.categoryName}
                  {conflicts.has(block.id) ? " · Conflict detected" : ""}
                </div>
                <div style={{ marginTop: 12 }}>
                  <ScheduleBlockForm block={block} sources={sourceOptions} />
                </div>
                <div style={{ marginTop: 8 }}>
                  <ScheduleBlockDeleteForm id={block.id} />
                </div>
              </div>
            ))}
        </div>
      </Panel>
    </>
  );
}
