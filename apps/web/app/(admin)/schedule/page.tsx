export const dynamic = "force-dynamic";

import Link from "next/link";
import { findScheduleConflicts, lookaheadVideoTitleFromPool } from "@stream247/core";
import { AssetMetadataDrawer } from "@/components/asset-metadata-drawer";
import { Panel } from "@/components/panel";
import { ProgramNowNextLens } from "@/components/program-now-next-lens";
import { ProgramWeekLens } from "@/components/program-week-lens";
import { ProgrammingTemplateForm } from "@/components/programming-template-form";
import { ScheduleEditorWorkspace } from "@/components/schedule-editor-workspace";
import { ScheduleBlockForm } from "@/components/schedule-block-form";
import { ScheduleDayCloneForm } from "@/components/schedule-day-clone-form";
import { ScheduleVideoTimeline } from "@/components/schedule-video-timeline";
import { ScheduleWeekOverview } from "@/components/schedule-week-overview";
import { ShowProfileDeleteForm } from "@/components/show-profile-delete-form";
import { ShowProfileForm } from "@/components/show-profile-form";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tabs } from "@/components/ui/Tabs";
import { getShowProfileCategoryOptions } from "@/lib/asset-metadata";
import {
  getBroadcastSnapshot,
  getMaterializedProgrammingWeekPreview,
  getSchedulePreview,
  getWorkspaceTimeZone,
  readAppState
} from "@/lib/server/state";
import { buildWorkspaceHref } from "@/lib/workspace-navigation";

type ScheduleSearchParams = {
  lens?: string | string[];
  day?: string | string[];
  assetId?: string | string[];
};

const scheduleLensTabs = [
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
  { id: "now-next", label: "Now + Next" }
] as const;

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getFirstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function resolveScheduleLens(value: string | string[] | undefined) {
  const candidate = getFirstParam(value);
  return scheduleLensTabs.some((tab) => tab.id === candidate) ? candidate : "week";
}

function resolveDayOfWeek(value: string | string[] | undefined, fallbackDay: number) {
  const parsed = Number.parseInt(getFirstParam(value), 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 6 ? parsed : fallbackDay;
}

export default async function SchedulePage(props: { searchParams?: Promise<ScheduleSearchParams> } = {}) {
  const searchParams = props.searchParams ? await props.searchParams : {};
  const state = await readAppState();
  const broadcastSnapshot = getBroadcastSnapshot(state);
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
  const categoryOptions = getShowProfileCategoryOptions(shows);
  const defaultDay = materializedWeek[0]?.dayOfWeek ?? 1;
  const activeDay = resolveDayOfWeek(searchParams.day, defaultDay);
  const materializedActiveDay = materializedWeek.find((day) => day.dayOfWeek === activeDay) ?? null;
  const liveQueue = state.playout.queueItems.slice(0, 5);
  const lens = resolveScheduleLens(searchParams.lens);
  const selectedAssetId = getFirstParam(searchParams.assetId);
  const selectedAsset = selectedAssetId ? state.assets.find((asset) => asset.id === selectedAssetId) ?? null : null;
  const fallbackAssets = state.assets
    .filter((asset) => asset.isGlobalFallback)
    .slice()
    .sort((left, right) => left.fallbackPriority - right.fallbackPriority);
  const emptyWeekBlocks = materializedWeek.flatMap((day) =>
    day.blocks
      .filter((block) => {
        if (block.items.length > 0) {
          return false;
        }

        const pool = block.poolId ? state.pools.find((entry) => entry.id === block.poolId) ?? null : null;
        return !lookaheadVideoTitleFromPool({
          pool,
          assets: state.assets
        });
      })
      .map((block) => `${dayLabels[block.dayOfWeek]} ${block.startTime} ${block.title}`)
  );
  const closeDrawerHref = buildWorkspaceHref("program", "schedule", {
    lens,
    day: lens === "week" || lens === "day" ? String(activeDay) : undefined
  });

  return (
    <div className="stack-form">
      <Tabs
        activeId={lens}
        ariaLabel="Program schedule lenses"
        items={scheduleLensTabs.map((tab) => ({
          id: tab.id,
          href: buildWorkspaceHref("program", "schedule", {
            lens: tab.id,
            day: tab.id === "week" || tab.id === "day" ? String(activeDay) : undefined,
            assetId: selectedAssetId || undefined
          }),
          label: tab.label
        }))}
      />

      <div className={selectedAsset ? "program-lens-layout" : "stack-form"}>
        <div className="stack-form">
          {lens === "week" ? (
            <>
              <Panel title="Week lens" eyebrow="Program">
                <p className="subtle">
                  The week view resolves the first playable video for every block from the current pool cursor, then
                  lets you expand into the predicted sequence before anything goes on air.
                </p>
                <ProgramWeekLens assets={state.assets} days={materializedWeek} pools={state.pools} />
              </Panel>
              {emptyWeekBlocks.length > 0 ? (
                <Panel title="Needs attention" eyebrow="Program">
                  <EmptyState
                    action={
                      <Link className="button secondary" href={buildWorkspaceHref("program", "pools")}>
                        Open pools
                      </Link>
                    }
                    description={`Unresolved blocks: ${emptyWeekBlocks.slice(0, 3).join(" · ")}`}
                    title="Some week blocks still resolve to no playable video"
                  />
                </Panel>
              ) : null}
            </>
          ) : null}

          {lens === "day" ? (
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
                    Show profiles sit above individual blocks. Use them to standardize titles, default category,
                    duration, and color across the week.
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
                      <EmptyState
                        description="Create reusable formats like Morning Replay, Prime Time, or Weekend Archive."
                        title="No show profiles yet"
                      />
                    ) : null}
                  </div>
                </Panel>
                <Panel title="Weekly coverage" eyebrow="Program">
                  <p className="subtle">
                    This is the programming shape of the full week. Use it to spot empty days, overloaded days, and
                    when your first or last blocks start.
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
                    Copy one fully built weekday onto additional empty weekdays in a single step. This is useful for
                    weekday patterns before you fine-tune exceptions.
                  </p>
                  <ScheduleDayCloneForm />
                </Panel>
                <Panel title="Materialized fill preview" eyebrow="Program">
                  <p className="subtle">
                    The scheduler preview now follows pool rotation, insert rules, and natural asset lengths. Times are
                    shown in {timeZone}.
                  </p>
                  <div className="list">
                    {materializedActiveDay?.blocks.map((block) => (
                      <div className="item" key={block.blockId}>
                        <div className="stats-row">
                          <strong>{block.title}</strong>
                          <span className={`programming-status-pill programming-status-${block.fillStatus}`}>
                            {block.fillLabel}
                          </span>
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
                    {materializedActiveDay?.blocks.length ? null : (
                      <EmptyState
                        description="Add schedule blocks or ready assets to see fill behavior for the selected programming day."
                        title="No materialized items for this day"
                      />
                    )}
                  </div>
                  <div className="list" style={{ marginTop: 14 }}>
                    <div className="item">
                      <strong>Live queue context</strong>
                      <div className="subtle">
                        Current on-air controls still win. This queue helps compare the selected day&apos;s programming
                        against the real runtime.
                      </div>
                      {liveQueue.length > 0 ? (
                        <div className="subtle" style={{ marginTop: 8 }}>
                          {liveQueue
                            .map((item) => `${item.kind.toUpperCase()} · ${item.title}${item.subtitle ? ` (${item.subtitle})` : ""}`)
                            .join(" · ")}
                        </div>
                      ) : (
                        <div className="subtle" style={{ marginTop: 8 }}>
                          No live queue items are currently published.
                        </div>
                      )}
                    </div>
                    <div className="item">
                      <strong>Video-level timeline</strong>
                      <div className="subtle">
                        Expand any block to inspect the predicted pool sequence. The preview follows the current pool
                        cursor and wraps through eligible videos when a block is longer than the ready library window.
                      </div>
                    </div>
                    <ScheduleVideoTimeline dayLabels={dayLabels} items={schedulePreview.items.filter((item) => item.dayOfWeek === activeDay)} />
                  </div>
                </Panel>
              </section>

              <Panel title="Program editor" eyebrow="Day lens">
                <ScheduleEditorWorkspace
                  assetCatalog={state.assets.map((asset) => ({
                    id: asset.id,
                    title: asset.title,
                    titlePrefix: asset.titlePrefix || "",
                    categoryName: asset.categoryName || "",
                    durationSeconds: asset.durationSeconds || 0
                  }))}
                  assets={readyAssetOptions}
                  blocks={state.scheduleBlocks}
                  conflicts={[...conflicts]}
                  initialDay={activeDay}
                  liveQueueItems={liveQueue.map((item) => ({
                    id: item.id,
                    kind: item.kind,
                    title: item.title,
                    subtitle: item.subtitle
                  }))}
                  materializedDays={materializedWeek}
                  pools={state.pools.map((pool) => ({
                    id: pool.id,
                    name: pool.name,
                    insertAssetId: pool.insertAssetId,
                    insertEveryItems: pool.insertEveryItems,
                    audioLaneAssetId: pool.audioLaneAssetId,
                    audioLaneVolumePercent: pool.audioLaneVolumePercent
                  }))}
                  selectedAssetId={selectedAssetId}
                  showProfiles={shows}
                  timeZone={timeZone}
                />
              </Panel>
            </>
          ) : null}

          {lens === "now-next" ? (
            <Panel title="Now + Next" eyebrow="Program">
              <p className="subtle">
                This lens mirrors the live queue context: what is running now, what resolves next, and which fallback
                assets can recover the channel if programming runs empty.
              </p>
              <ProgramNowNextLens fallbackAssets={fallbackAssets} snapshot={broadcastSnapshot} />
            </Panel>
          ) : null}
        </div>

        {selectedAsset ? (
          <AssetMetadataDrawer asset={selectedAsset} categoryOptions={categoryOptions} closeHref={closeDrawerHref} />
        ) : null}
      </div>
    </div>
  );
}
