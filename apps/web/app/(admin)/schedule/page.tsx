export const dynamic = "force-dynamic";

import { findScheduleConflicts } from "@stream247/core";
import { Panel } from "@/components/panel";
import { ProgrammingTemplateForm } from "@/components/programming-template-form";
import { ScheduleEditorWorkspace } from "@/components/schedule-editor-workspace";
import { ScheduleBlockForm } from "@/components/schedule-block-form";
import { ScheduleDayCloneForm } from "@/components/schedule-day-clone-form";
import { ScheduleWeekOverview } from "@/components/schedule-week-overview";
import { ScheduleVideoTimeline } from "@/components/schedule-video-timeline";
import { ShowProfileDeleteForm } from "@/components/show-profile-delete-form";
import { ShowProfileForm } from "@/components/show-profile-form";
import { getMaterializedProgrammingWeekPreview, getSchedulePreview, getWorkspaceTimeZone, readAppState } from "@/lib/server/state";

export default async function SchedulePage() {
  const state = await readAppState();
  const schedulePreview = getSchedulePreview(state);
  const materializedWeek = getMaterializedProgrammingWeekPreview(state);
  const timeZone = getWorkspaceTimeZone();
  const conflicts = new Set(findScheduleConflicts(state.scheduleBlocks));
  const poolOptions = state.pools
    .map((pool) => ({ id: pool.id, name: pool.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const readyAssetOptions = state.assets
    .filter((asset) => asset.status === "ready")
    .map((asset) => ({ id: asset.id, title: asset.title, status: asset.status }));
  const shows = state.showProfiles
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const materializedToday = materializedWeek[0];
  const liveQueue = state.playout.queueItems.slice(0, 5);

  return (
    <>
      <section className="grid two">
        <Panel title="Add schedule block" eyebrow="Program">
          <p className="subtle">
            Build the week in {timeZone}. Blocks target pools, start times are minute-accurate, durations use
            15-minute steps, and overlapping windows on the same weekday are rejected before save.
          </p>
          <ScheduleBlockForm assets={readyAssetOptions} pools={poolOptions} shows={shows} />
        </Panel>
        <Panel title="Show profiles" eyebrow="Program">
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
        <Panel title="Weekly coverage" eyebrow="Program">
          <p className="subtle">
            This is the programming shape of the full week. Use it to spot empty days, overloaded days, and when your
            first or last blocks start.
          </p>
          <ScheduleWeekOverview blocks={state.scheduleBlocks} materializedDays={materializedWeek} />
        </Panel>
        <Panel title="Quick-start templates" eyebrow="Program">
          <p className="subtle">
            Use templates to bootstrap a full week quickly, then fine-tune individual days in the editor below.
          </p>
          <ProgrammingTemplateForm pools={poolOptions} />
        </Panel>
        <Panel title="Clone a schedule day" eyebrow="Program">
          <p className="subtle">
            Copy one fully built weekday onto additional empty weekdays in a single step. This is useful for weekday
            patterns before you fine-tune exceptions.
          </p>
          <ScheduleDayCloneForm />
        </Panel>

        <Panel title="Materialized fill preview" eyebrow="Program">
          <p className="subtle">
            The scheduler preview now follows pool rotation, insert rules, and natural asset lengths. Times are shown in {timeZone}.
          </p>
          <div className="list">
            {materializedToday?.blocks.map((block) => (
              <div className="item" key={block.blockId}>
                <div className="stats-row">
                  <strong>{block.title}</strong>
                  <span className={`programming-status-pill programming-status-${block.fillStatus}`}>{block.fillLabel}</span>
                  <span className="subtle">{block.repeatLabel}</span>
                </div>
                <div className="subtle">
                  {dayLabels[block.dayOfWeek]} · {block.startTime} to {block.endTime} · {block.poolName}
                </div>
                <div className="subtle">
                  Unique library: {block.uniqueMinutes}m · Projected: {block.projectedMinutes}m
                  {block.insertCount > 0 ? ` · ${block.insertCount} insert${block.insertCount === 1 ? "" : "s"}` : ""}
                  {block.cuepointCount > 0 ? ` · ${block.cuepointCount} cuepoint-triggered` : ""}
                </div>
                {block.queuePreview.length > 0 ? (
                  <div className="subtle">Queue preview: {block.queuePreview.join(" · ")}</div>
                ) : null}
                {block.notes.map((note) => (
                  <div className="subtle" key={note}>
                    {note}
                  </div>
                ))}
              </div>
            ))}
            {materializedToday?.blocks.length ? null : (
              <div className="item">
                <strong>No materialized items today</strong>
                <div className="subtle">Add schedule blocks or ready assets to see fill behavior for the current programming day.</div>
              </div>
            )}
          </div>
          <div className="list" style={{ marginTop: 14 }}>
            <div className="item">
              <strong>Live queue context</strong>
              <div className="subtle">Current on-air controls still win. This queue helps compare today&apos;s programming against the real runtime.</div>
              {liveQueue.length > 0 ? (
                <div className="subtle" style={{ marginTop: 8 }}>
                  {liveQueue.map((item) => `${item.kind.toUpperCase()} · ${item.title}${item.subtitle ? ` (${item.subtitle})` : ""}`).join(" · ")}
                </div>
              ) : (
                <div className="subtle" style={{ marginTop: 8 }}>No live queue items are currently published.</div>
              )}
            </div>
            <div className="item">
              <strong>Video-level timeline</strong>
              <div className="subtle">
                Expand any block to inspect the predicted pool sequence. The preview follows the current pool cursor and
                wraps through eligible videos when a block is longer than the ready library window.
              </div>
            </div>
            <ScheduleVideoTimeline dayLabels={dayLabels} items={schedulePreview.items} />
          </div>
        </Panel>
      </section>

      <Panel title="Program editor" eyebrow="Editor">
        <ScheduleEditorWorkspace
          blocks={state.scheduleBlocks}
          conflicts={[...conflicts]}
          materializedDays={materializedWeek}
          liveQueueItems={liveQueue.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            subtitle: item.subtitle
          }))}
          pools={state.pools.map((pool) => ({
            id: pool.id,
            name: pool.name,
            insertAssetId: pool.insertAssetId,
            insertEveryItems: pool.insertEveryItems,
            audioLaneAssetId: pool.audioLaneAssetId,
            audioLaneVolumePercent: pool.audioLaneVolumePercent
          }))}
          assets={readyAssetOptions}
          showProfiles={shows}
          timeZone={timeZone}
        />
      </Panel>
    </>
  );
}
