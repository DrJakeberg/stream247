export const dynamic = "force-dynamic";

import { findScheduleConflicts, formatMinuteOfDay } from "@stream247/core";
import { Panel } from "@/components/panel";
import { ProgrammingTemplateForm } from "@/components/programming-template-form";
import { ScheduleBlockDeleteForm } from "@/components/schedule-block-delete-form";
import { ScheduleBlockDuplicateForm } from "@/components/schedule-block-duplicate-form";
import { ScheduleBlockForm } from "@/components/schedule-block-form";
import { ScheduleTimeline } from "@/components/schedule-timeline";
import { ScheduleWeekOverview } from "@/components/schedule-week-overview";
import { ShowProfileDeleteForm } from "@/components/show-profile-delete-form";
import { ShowProfileForm } from "@/components/show-profile-form";
import { getSchedulePreview, getWorkspaceTimeZone, readAppState } from "@/lib/server/state";

export default async function SchedulePage() {
  const state = await readAppState();
  const schedulePreview = getSchedulePreview(state);
  const timeZone = getWorkspaceTimeZone();
  const conflicts = new Set(findScheduleConflicts(state.scheduleBlocks));
  const poolOptions = state.pools
    .map((pool) => ({ id: pool.id, name: pool.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const shows = state.showProfiles
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  type ScheduleItem = (typeof schedulePreview.items)[number];

  return (
    <>
      <section className="grid two">
        <Panel title="Add schedule block" eyebrow="Programming">
          <p className="subtle">
            Build the week in {timeZone}. Blocks target pools, start times are minute-accurate, durations use
            15-minute steps, and overlapping windows on the same weekday are rejected before save.
          </p>
          <ScheduleBlockForm pools={poolOptions} shows={shows} />
        </Panel>
        <Panel title="Show profiles" eyebrow="Programming">
          <p className="subtle">
            Show profiles sit above individual blocks. Use them to standardize titles, default category, duration, and
            color across the week.
          </p>
          <ShowProfileForm />
          <div className="list">
            {shows.map((show) => (
              <div className="item" key={show.id}>
                <div className="stats-row">
                  <strong>{show.name}</strong>
                  <span className="show-swatch" style={{ background: show.color }} />
                  <span className="subtle">{show.categoryName || "No category"}</span>
                  <span className="subtle">{show.defaultDurationMinutes}m default</span>
                </div>
                {show.description ? <div className="subtle">{show.description}</div> : null}
                <div style={{ marginTop: 12 }}>
                  <ShowProfileForm show={show} />
                </div>
                <div style={{ marginTop: 8 }}>
                  <ShowProfileDeleteForm id={show.id} name={show.name} />
                </div>
              </div>
            ))}
            {shows.length === 0 ? (
              <div className="item">
                <strong>No show profiles yet</strong>
                <div className="subtle">Create reusable formats like Morning Replay, Prime Time, or Weekend Archive.</div>
              </div>
            ) : null}
          </div>
        </Panel>
        <Panel title="Weekly coverage" eyebrow="Programming">
          <p className="subtle">
            This is the programming shape of the full week. Use it to spot empty days, overloaded days, and when your
            first or last blocks start.
          </p>
          <ScheduleWeekOverview blocks={state.scheduleBlocks} />
        </Panel>
        <Panel title="Quick-start templates" eyebrow="Programming">
          <p className="subtle">
            Use templates to bootstrap a full week quickly, then fine-tune individual days in the editor below.
          </p>
          <ProgrammingTemplateForm pools={poolOptions} />
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
                  {dayLabels[item.dayOfWeek]} · {item.startTime} to {item.endTime} · {item.sourceName}
                </div>
                <div className="subtle">{item.reason}</div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <Panel title="Existing blocks" eyebrow="Editor">
        <ScheduleTimeline blocks={state.scheduleBlocks} conflicts={[...conflicts]} showProfiles={shows} timeZone={timeZone} />
        <div className="list">
          {state.scheduleBlocks
            .slice()
            .sort((left, right) => left.startMinuteOfDay - right.startMinuteOfDay)
            .map((block) => {
              const show = shows.find((entry) => entry.id === block.showId);

              return (
                <div className="item" key={block.id}>
                  <strong>{block.title}</strong>
                  <div className="subtle">
                    {dayLabels[block.dayOfWeek]} · {formatMinuteOfDay(block.startMinuteOfDay)} · {block.durationMinutes} minutes · {block.sourceName}
                  </div>
                  <div className="subtle">
                    {block.categoryName}
                    {show ? ` · Show: ${show.name}` : ""}
                    {conflicts.has(block.id) ? " · Conflict detected" : ""}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <ScheduleBlockForm block={block} pools={poolOptions} shows={shows} />
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <ScheduleBlockDuplicateForm block={block} />
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <ScheduleBlockDeleteForm id={block.id} />
                  </div>
                </div>
              );
            })}
        </div>
      </Panel>
    </>
  );
}
