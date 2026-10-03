import { NextRequest, NextResponse } from "next/server";
import {
  filterWeekdaysInDateWindow,
  findScheduleConflicts,
  findScheduleConflictsInvolving,
  getCurrentScheduleMoment,
  getRepeatDaysForMode,
  getScheduleDateDayOfWeek,
  isScheduleDateString,
  normalizeCuepointOffsetsSeconds,
  normalizeScheduleRepeatMode,
  validateScheduleBlock
} from "@stream247/core";
import { getAuthenticatedUser, requireApiRoles } from "@/lib/server/auth";
import {
  appendAuditEvent,
  createScheduleBlocks,
  createScheduleBlocksChecked,
  deleteScheduleBlockRecord,
  getWorkspaceTimeZone,
  readAppState,
  updateScheduleBlockRecord,
  updateScheduleRepeatGroupRecords
} from "@/lib/server/state";

function normalizeBody(body: {
  action?: string;
  id?: string;
  sourceBlockId?: string;
  sourceDayOfWeek?: number;
  targetDayOfWeeks?: number[];
  title?: string;
  categoryName?: string;
  startMinuteOfDay?: number;
  durationMinutes?: number;
  dayOfWeek?: number;
  dayOfWeeks?: number[];
  showId?: string;
  poolId?: string;
  sourceName?: string;
  repeatMode?: string;
  applyToRepeatSet?: boolean;
  cuepointAssetId?: string;
  cuepointOffsetsSeconds?: number[];
  runs?: string;
  validFrom?: string;
  validUntil?: string;
}) {
  const dates = normalizeRunDates(body);
  return {
    action: (body.action ?? "").trim(),
    id: (body.id ?? "").trim(),
    sourceBlockId: (body.sourceBlockId ?? "").trim(),
    sourceDayOfWeek: Number(body.sourceDayOfWeek ?? 0),
    targetDayOfWeeks: Array.isArray(body.targetDayOfWeeks)
      ? [...new Set(body.targetDayOfWeeks.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))]
      : [],
    title: (body.title ?? "").trim(),
    categoryName: (body.categoryName ?? "").trim(),
    startMinuteOfDay: Number(body.startMinuteOfDay ?? 0),
    durationMinutes: Number(body.durationMinutes ?? 0),
    dayOfWeek: Number(body.dayOfWeek ?? 0),
    dayOfWeeks: Array.isArray(body.dayOfWeeks)
      ? [...new Set(body.dayOfWeeks.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))]
      : [],
    showId: (body.showId ?? "").trim(),
    poolId: (body.poolId ?? "").trim(),
    sourceName: (body.sourceName ?? "").trim(),
    repeatMode: normalizeScheduleRepeatMode(String(body.repeatMode ?? "single")),
    applyToRepeatSet: Boolean(body.applyToRepeatSet),
    cuepointAssetId: (body.cuepointAssetId ?? "").trim(),
    cuepointOffsetsSeconds: normalizeCuepointOffsetsSeconds(
      Array.isArray(body.cuepointOffsetsSeconds) ? body.cuepointOffsetsSeconds.map((value) => Number(value)) : [],
      Number(body.durationMinutes ?? 0)
    ),
    ...dates,
    // A one-off block sits on the weekday of its date.
    ...(dates.runs === "once" && isScheduleDateString(dates.validFrom)
      ? { dayOfWeek: getScheduleDateDayOfWeek(dates.validFrom), dayOfWeeks: [], repeatMode: "single" as const }
      : {})
  };
}

/**
 * How the block runs (M93): every week (no dates), between two dates, or once (one date). Without `runs`
 * the dates are taken as sent, so a client that moves a block (the timeline) keeps the block's own dates.
 */
function normalizeRunDates(body: { runs?: string; validFrom?: string; validUntil?: string }) {
  const runs = body.runs === "weekly" || body.runs === "between" || body.runs === "once" ? body.runs : "";
  const validFrom = (body.validFrom ?? "").trim();
  const validUntil = (body.validUntil ?? "").trim();
  if (runs === "weekly") {
    return { runs, validFrom: "", validUntil: "" };
  }
  if (runs === "once") {
    return { runs, validFrom, validUntil: validFrom };
  }
  return { runs, validFrom, validUntil };
}

function runDatesError(payload: { runs: string; validFrom: string; validUntil: string }): string | null {
  if (payload.runs === "once" && !payload.validFrom) {
    return "Choose the date this block runs on.";
  }
  if (payload.runs === "between" && (!payload.validFrom || !payload.validUntil)) {
    return "Choose a first and a last date.";
  }
  return null;
}

/** Today in the channel's time zone: a date window that ended before it is refused on save. */
function channelToday(state: Awaited<ReturnType<typeof readAppState>>): string {
  return getCurrentScheduleMoment({ now: new Date(), timeZone: getWorkspaceTimeZone(state) }).date;
}

function describeCreatedRun(payload: { validFrom: string; validUntil: string }): string {
  if (payload.validFrom && payload.validFrom === payload.validUntil) {
    return ` for ${payload.validFrom}`;
  }
  if (payload.validFrom && payload.validUntil) {
    return `, from ${payload.validFrom} to ${payload.validUntil}`;
  }
  return "";
}

function generateId(prefix: "schedule" | "repeat" = "schedule") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function GET() {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator", "moderator", "viewer"]);
  if (unauthorized) {
    return unauthorized;
  }

  const state = await readAppState();
  return NextResponse.json({
    blocks: state.scheduleBlocks,
    conflicts: findScheduleConflicts(state.scheduleBlocks)
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const user = await getAuthenticatedUser();
  const payload = normalizeBody(
    (await request.json()) as {
      action?: string;
      sourceBlockId?: string;
      sourceDayOfWeek?: number;
      targetDayOfWeeks?: number[];
      title?: string;
      categoryName?: string;
      startMinuteOfDay?: number;
      durationMinutes?: number;
      dayOfWeek?: number;
      dayOfWeeks?: number[];
      showId?: string;
      poolId?: string;
      sourceName?: string;
      cuepointAssetId?: string;
      cuepointOffsetsSeconds?: number[];
      runs?: string;
      validFrom?: string;
      validUntil?: string;
    }
  );

  if (payload.action === "duplicate") {
    if (!payload.sourceBlockId) {
      return NextResponse.json({ message: "Source schedule block is required." }, { status: 400 });
    }

    const selectedDays = payload.dayOfWeeks;
    if (selectedDays.length === 0) {
      return NextResponse.json({ message: "Select at least one weekday to duplicate onto." }, { status: 400 });
    }

    try {
      const state = await readAppState();
      const sourceBlock = state.scheduleBlocks.find((block) => block.id === payload.sourceBlockId);
      if (!sourceBlock) {
        throw new Error("Source schedule block not found.");
      }

      const duplicateDays = [...new Set(selectedDays)].filter((day) => day !== sourceBlock.dayOfWeek);
      if (duplicateDays.length === 0) {
        throw new Error("Choose at least one different weekday for the duplicate.");
      }
      // A copy keeps the block's dates (M93), so it must land on a weekday those dates contain.
      if (
        sourceBlock.validFrom &&
        sourceBlock.validUntil &&
        filterWeekdaysInDateWindow(duplicateDays, sourceBlock.validFrom, sourceBlock.validUntil).length !== duplicateDays.length
      ) {
        throw new Error("A chosen weekday does not fall between this block's dates.");
      }

      const newBlocks = duplicateDays.map((dayOfWeek) => ({
        ...sourceBlock,
        id: generateId("schedule"),
        dayOfWeek,
        repeatMode: "single" as const,
        repeatGroupId: ""
      }));
      await createScheduleBlocksChecked(newBlocks, (existing, incoming) => {
        if (findScheduleConflictsInvolving([...existing, ...incoming], incoming.map((block) => block.id)).length > 0) {
          throw new Error("Duplicated blocks overlap with existing programming. Adjust the target days or schedule.");
        }
      });
      const nextState = await readAppState();

      await appendAuditEvent(
        "schedule.duplicated",
        `${user?.displayName || user?.email || "Unknown user"} duplicated schedule block ${sourceBlock.title} onto ${duplicateDays.length} day${duplicateDays.length === 1 ? "" : "s"}.`
      );

      return NextResponse.json({
        ok: true,
        message: `Schedule block ${sourceBlock.title} duplicated onto ${duplicateDays.length} day${duplicateDays.length === 1 ? "" : "s"}.`,
        blocks: nextState.scheduleBlocks
      });
    } catch (error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Could not duplicate schedule block." },
        { status: 400 }
      );
    }
  }

  if (payload.action === "clone-day") {
    const targetDays = payload.targetDayOfWeeks;
    if (targetDays.length === 0) {
      return NextResponse.json({ message: "Select at least one target weekday." }, { status: 400 });
    }

    try {
      const state = await readAppState();
      const sourceBlocks = state.scheduleBlocks
        .filter((block) => block.dayOfWeek === payload.sourceDayOfWeek)
        .slice()
        .sort((left, right) => left.startMinuteOfDay - right.startMinuteOfDay);
      if (sourceBlocks.length === 0) {
        throw new Error("The selected source day does not contain any schedule blocks.");
      }

      const distinctTargetDays = [...new Set(targetDays)].filter((day) => day !== payload.sourceDayOfWeek);
      if (distinctTargetDays.length === 0) {
        throw new Error("Choose at least one different weekday to clone onto.");
      }

      const occupiedTargetDay = distinctTargetDays.find((day) => state.scheduleBlocks.some((block) => block.dayOfWeek === day));
      if (occupiedTargetDay !== undefined) {
        throw new Error("One of the selected target weekdays already has blocks. Clear it first or choose empty weekdays.");
      }

      // A dated block is cloned only onto weekdays its dates contain (M93); elsewhere it would never air.
      const clonedBlocks = distinctTargetDays.flatMap((dayOfWeek) =>
        sourceBlocks
          .filter(
            (block) =>
              !block.validFrom ||
              !block.validUntil ||
              filterWeekdaysInDateWindow([dayOfWeek], block.validFrom, block.validUntil).length > 0
          )
          .map((block) => ({
          ...block,
          id: generateId("schedule"),
          dayOfWeek,
          repeatMode: "single" as const,
          repeatGroupId: ""
        }))
      );

      await createScheduleBlocks(clonedBlocks);
      const nextState = await readAppState();

      await appendAuditEvent(
        "schedule.day_cloned",
        `${user?.displayName || user?.email || "Unknown user"} cloned ${sourceBlocks.length} schedule block${sourceBlocks.length === 1 ? "" : "s"} from day ${payload.sourceDayOfWeek} onto ${distinctTargetDays.length} day${distinctTargetDays.length === 1 ? "" : "s"}.`
      );

      return NextResponse.json({
        ok: true,
        message: `Cloned ${sourceBlocks.length} block${sourceBlocks.length === 1 ? "" : "s"} onto ${distinctTargetDays.length} weekday${distinctTargetDays.length === 1 ? "" : "s"}.`,
        blocks: nextState.scheduleBlocks
      });
    } catch (error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Could not clone programming day." },
        { status: 400 }
      );
    }
  }

  // The dates are checked once the weekdays and today are known.
  const validationError = validateScheduleBlock({ ...payload, validFrom: "", validUntil: "" }) ?? runDatesError(payload);
  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  try {
    const state = await readAppState();
    const today = channelToday(state);
    const pool = state.pools.find((entry) => entry.id === payload.poolId);
    if (!pool) {
      throw new Error("Schedule blocks must target an existing pool.");
    }
    if (payload.showId && !state.showProfiles.some((show) => show.id === payload.showId)) {
      throw new Error("Selected show profile no longer exists.");
    }
    const cuepointAsset = payload.cuepointAssetId
      ? state.assets.find((asset) => asset.id === payload.cuepointAssetId && asset.status === "ready") ?? null
      : null;
    if (payload.cuepointAssetId && !cuepointAsset) {
      throw new Error("Cuepoint insert asset is no longer available.");
    }
    if (payload.cuepointOffsetsSeconds.length > 0 && !payload.cuepointAssetId && !pool.insertAssetId) {
      throw new Error("Cuepoints require either a block override insert asset or a pool automatic insert asset.");
    }

      const repeatDays =
        payload.dayOfWeeks.length > 0 ? payload.dayOfWeeks : getRepeatDaysForMode(payload.repeatMode, payload.dayOfWeek);
      if (repeatDays.length === 0) {
        throw new Error("Select at least one weekday for this programming block.");
      }
      // Between two dates, only the weekdays that occur between them get a copy: "daily for 3 days" is three
      // blocks, not seven of which four never air.
      const dayOfWeeks =
        payload.validFrom && payload.validUntil && payload.validFrom <= payload.validUntil
          ? filterWeekdaysInDateWindow(repeatDays, payload.validFrom, payload.validUntil)
          : repeatDays;
      if (dayOfWeeks.length === 0) {
        throw new Error("None of the chosen weekdays falls between these dates.");
      }
      for (const dayOfWeek of dayOfWeeks) {
        const blockError = validateScheduleBlock({ ...payload, dayOfWeek }, { today });
        if (blockError) {
          throw new Error(blockError);
        }
      }
      const repeatMode =
        payload.repeatMode === "single" && dayOfWeeks.length > 1 ? ("custom" as const) : payload.repeatMode;
      const repeatGroupId = dayOfWeeks.length > 1 ? generateId("repeat") : "";
      const newBlocks = dayOfWeeks.map((dayOfWeek) => ({
        id: generateId("schedule"),
        title: payload.title,
        categoryName: payload.categoryName,
        startMinuteOfDay: payload.startMinuteOfDay,
        durationMinutes: payload.durationMinutes,
        dayOfWeek,
        showId: payload.showId,
        poolId: payload.poolId,
        sourceName: pool.name,
        repeatMode,
        repeatGroupId,
        cuepointAssetId: cuepointAsset?.id ?? "",
        cuepointOffsetsSeconds: payload.cuepointOffsetsSeconds,
        validFrom: payload.validFrom,
        validUntil: payload.validUntil
      }));
    // Validated inside the transaction that inserts. Checking against the separately-read `state`
    // leaves a window where a second editor commits a block this check never saw, both writes
    // succeed, and the result is the overlapping schedule the check exists to prevent.
    await createScheduleBlocksChecked(newBlocks, (existing, incoming) => {
      if (findScheduleConflictsInvolving([...existing, ...incoming], incoming.map((block) => block.id)).length > 0) {
        throw new Error("Schedule blocks overlap. Adjust the new start time or duration.");
      }
    });
    const nextState = await readAppState();

    await appendAuditEvent(
      "schedule.created",
      `${user?.displayName || user?.email || "Unknown user"} created schedule block ${payload.title}${dayOfWeeks.length > 1 ? ` across ${dayOfWeeks.length} days` : ""}.`
    );

    return NextResponse.json({
      ok: true,
      message: `Schedule block ${payload.title} created${dayOfWeeks.length > 1 ? ` across ${dayOfWeeks.length} days` : ""}${describeCreatedRun(payload)}.`,
      blocks: nextState.scheduleBlocks
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not create schedule block." },
      { status: 400 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const user = await getAuthenticatedUser();
  const payload = normalizeBody(
    (await request.json()) as {
      id?: string;
      title?: string;
      categoryName?: string;
      startMinuteOfDay?: number;
      durationMinutes?: number;
      dayOfWeek?: number;
      showId?: string;
      poolId?: string;
      sourceName?: string;
      applyToRepeatSet?: boolean;
      cuepointAssetId?: string;
      cuepointOffsetsSeconds?: number[];
      runs?: string;
      validFrom?: string;
      validUntil?: string;
    }
  );

  if (!payload.id) {
    return NextResponse.json({ message: "Schedule block id is required." }, { status: 400 });
  }

  // The dates are checked once the weekdays and today are known.
  const validationError = validateScheduleBlock({ ...payload, validFrom: "", validUntil: "" }) ?? runDatesError(payload);
  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  try {
    const state = await readAppState();
    const existing = state.scheduleBlocks.find((block) => block.id === payload.id);
    if (!existing) {
      throw new Error("Schedule block not found.");
    }
    const applyToRepeatSet = payload.applyToRepeatSet && Boolean(existing.repeatGroupId);
    if (applyToRepeatSet && payload.runs === "once") {
      throw new Error("A single date applies to one block. Turn off Apply to repeat set to run this occurrence once.");
    }
    // The repeat set keeps each copy's weekday, so the dates are checked against the edited copy's own day.
    const datesError = validateScheduleBlock(
      { ...payload, dayOfWeek: applyToRepeatSet ? existing.dayOfWeek : payload.dayOfWeek },
      { today: channelToday(state) }
    );
    if (datesError) {
      throw new Error(datesError);
    }

    const pool = state.pools.find((entry) => entry.id === payload.poolId);
    if (!pool) {
      throw new Error("Schedule blocks must target an existing pool.");
    }
    if (payload.showId && !state.showProfiles.some((show) => show.id === payload.showId)) {
      throw new Error("Selected show profile no longer exists.");
    }
    const cuepointAsset = payload.cuepointAssetId
      ? state.assets.find((asset) => asset.id === payload.cuepointAssetId && asset.status === "ready") ?? null
      : null;
    if (payload.cuepointAssetId && !cuepointAsset) {
      throw new Error("Cuepoint insert asset is no longer available.");
    }
    if (payload.cuepointOffsetsSeconds.length > 0 && !payload.cuepointAssetId && !pool.insertAssetId) {
      throw new Error("Cuepoints require either a block override insert asset or a pool automatic insert asset.");
    }

    const updatedBlock = {
      ...existing,
      title: payload.title,
      categoryName: payload.categoryName,
      startMinuteOfDay: payload.startMinuteOfDay,
      durationMinutes: payload.durationMinutes,
      dayOfWeek: applyToRepeatSet ? existing.dayOfWeek : payload.dayOfWeek,
      showId: payload.showId,
      poolId: payload.poolId,
      sourceName: pool.name,
      repeatMode: applyToRepeatSet ? existing.repeatMode || "single" : "single",
      repeatGroupId: applyToRepeatSet ? existing.repeatGroupId || "" : "",
      cuepointAssetId: cuepointAsset?.id ?? "",
      cuepointOffsetsSeconds: payload.cuepointOffsetsSeconds,
      validFrom: payload.validFrom,
      validUntil: payload.validUntil
    };
    const nextBlocks = applyToRepeatSet
      ? state.scheduleBlocks.map((block) =>
          block.repeatGroupId && block.repeatGroupId === existing.repeatGroupId
            ? {
                ...block,
                title: payload.title,
                categoryName: payload.categoryName,
                startMinuteOfDay: payload.startMinuteOfDay,
                durationMinutes: payload.durationMinutes,
                showId: payload.showId,
                poolId: payload.poolId,
                sourceName: pool.name,
                cuepointAssetId: cuepointAsset?.id ?? "",
                cuepointOffsetsSeconds: payload.cuepointOffsetsSeconds,
                validFrom: payload.validFrom,
                validUntil: payload.validUntil
              }
            : block
        )
      : state.scheduleBlocks.map((block) => (block.id === payload.id ? updatedBlock : block));
    const changedIds = applyToRepeatSet
      ? state.scheduleBlocks.filter((block) => block.repeatGroupId === existing.repeatGroupId).map((block) => block.id)
      : [payload.id];
    const conflicts = findScheduleConflictsInvolving(nextBlocks, changedIds);
    if (conflicts.length > 0) {
      throw new Error("Schedule blocks overlap. Adjust the edited start time or duration.");
    }

    if (applyToRepeatSet && existing.repeatGroupId) {
      await updateScheduleRepeatGroupRecords({
        repeatGroupId: existing.repeatGroupId,
        title: payload.title,
        categoryName: payload.categoryName,
        startMinuteOfDay: payload.startMinuteOfDay,
        durationMinutes: payload.durationMinutes,
        showId: payload.showId,
        poolId: payload.poolId,
        sourceName: pool.name,
        cuepointAssetId: cuepointAsset?.id ?? "",
        cuepointOffsetsSeconds: payload.cuepointOffsetsSeconds,
        validFrom: payload.validFrom,
        validUntil: payload.validUntil
      });
    } else {
      await updateScheduleBlockRecord(updatedBlock);
    }
    const nextState = await readAppState();

    await appendAuditEvent(
      "schedule.updated",
      `${user?.displayName || user?.email || "Unknown user"} updated schedule block ${payload.title}${applyToRepeatSet ? " across its repeat set" : existing.repeatGroupId ? " and detached it from its repeat set" : ""}.`
    );

    return NextResponse.json({
      ok: true,
      message: `Schedule block ${payload.title} updated${applyToRepeatSet ? " across its repeat set" : existing.repeatGroupId ? " and detached from its repeat set" : ""}.`,
      blocks: nextState.scheduleBlocks
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not update schedule block." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const user = await getAuthenticatedUser();
  const body = (await request.json()) as { id?: string };
  const id = (body.id ?? "").trim();

  if (!id) {
    return NextResponse.json({ message: "Schedule block id is required." }, { status: 400 });
  }

  const state = await readAppState();
  const existing = state.scheduleBlocks.find((block) => block.id === id);
  if (!existing) {
    return NextResponse.json({ message: "Schedule block not found." }, { status: 404 });
  }

  await deleteScheduleBlockRecord(id);

  await appendAuditEvent(
    "schedule.deleted",
    `${user?.displayName || user?.email || "Unknown user"} deleted schedule block ${existing.title}.`
  );

  return NextResponse.json({ ok: true, message: `Schedule block ${existing.title} deleted.` });
}
