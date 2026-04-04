import { NextRequest, NextResponse } from "next/server";
import { findScheduleConflicts, validateScheduleBlock } from "@stream247/core";
import { getAuthenticatedUser, requireApiRoles } from "@/lib/server/auth";
import {
  appendAuditEvent,
  createScheduleBlocks,
  deleteScheduleBlockRecord,
  readAppState,
  updateScheduleBlockRecord
} from "@/lib/server/state";

function normalizeBody(body: {
  action?: string;
  id?: string;
  sourceBlockId?: string;
  title?: string;
  categoryName?: string;
  startMinuteOfDay?: number;
  durationMinutes?: number;
  dayOfWeek?: number;
  dayOfWeeks?: number[];
  showId?: string;
  poolId?: string;
  sourceName?: string;
}) {
  return {
    action: (body.action ?? "").trim(),
    id: (body.id ?? "").trim(),
    sourceBlockId: (body.sourceBlockId ?? "").trim(),
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
    sourceName: (body.sourceName ?? "").trim()
  };
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
      title?: string;
      categoryName?: string;
      startMinuteOfDay?: number;
      durationMinutes?: number;
      dayOfWeek?: number;
      dayOfWeeks?: number[];
      showId?: string;
      poolId?: string;
      sourceName?: string;
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

      const newBlocks = duplicateDays.map((dayOfWeek) => ({
        ...sourceBlock,
        id: `schedule_${Math.random().toString(36).slice(2, 10)}`,
        dayOfWeek
      }));
      const conflicts = findScheduleConflicts([...state.scheduleBlocks, ...newBlocks]);
      if (conflicts.length > 0) {
        throw new Error("Duplicated blocks overlap with existing programming. Adjust the target days or schedule.");
      }

      await createScheduleBlocks(newBlocks);
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

  const validationError = validateScheduleBlock(payload);
  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  try {
    const state = await readAppState();
    const pool = state.pools.find((entry) => entry.id === payload.poolId);
    if (!pool) {
      throw new Error("Schedule blocks must target an existing pool.");
    }
    if (payload.showId && !state.showProfiles.some((show) => show.id === payload.showId)) {
      throw new Error("Selected show profile no longer exists.");
    }

    const dayOfWeeks = payload.dayOfWeeks.length > 0 ? payload.dayOfWeeks : [payload.dayOfWeek];
    const newBlocks = dayOfWeeks.map((dayOfWeek) => ({
      id: `schedule_${Math.random().toString(36).slice(2, 10)}`,
      title: payload.title,
      categoryName: payload.categoryName,
      startMinuteOfDay: payload.startMinuteOfDay,
      durationMinutes: payload.durationMinutes,
      dayOfWeek,
      showId: payload.showId,
      poolId: payload.poolId,
      sourceName: pool.name
    }));
    const conflicts = findScheduleConflicts([...state.scheduleBlocks, ...newBlocks]);
    if (conflicts.length > 0) {
      throw new Error("Schedule blocks overlap. Adjust the new start time or duration.");
    }

    await createScheduleBlocks(newBlocks);
    const nextState = await readAppState();

    await appendAuditEvent(
      "schedule.created",
      `${user?.displayName || user?.email || "Unknown user"} created schedule block ${payload.title}${payload.dayOfWeeks.length > 1 ? ` across ${payload.dayOfWeeks.length} days` : ""}.`
    );

    return NextResponse.json({
      ok: true,
      message: `Schedule block ${payload.title} created${payload.dayOfWeeks.length > 1 ? ` across ${payload.dayOfWeeks.length} days` : ""}.`,
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
      poolId?: string;
      sourceName?: string;
    }
  );

  if (!payload.id) {
    return NextResponse.json({ message: "Schedule block id is required." }, { status: 400 });
  }

  const validationError = validateScheduleBlock(payload);
  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  try {
    const state = await readAppState();
    const existing = state.scheduleBlocks.find((block) => block.id === payload.id);
    if (!existing) {
      throw new Error("Schedule block not found.");
    }

    const pool = state.pools.find((entry) => entry.id === payload.poolId);
    if (!pool) {
      throw new Error("Schedule blocks must target an existing pool.");
    }
    if (payload.showId && !state.showProfiles.some((show) => show.id === payload.showId)) {
      throw new Error("Selected show profile no longer exists.");
    }

    const updatedBlock = {
      ...existing,
      title: payload.title,
      categoryName: payload.categoryName,
      startMinuteOfDay: payload.startMinuteOfDay,
      durationMinutes: payload.durationMinutes,
      dayOfWeek: payload.dayOfWeek,
      showId: payload.showId,
      poolId: payload.poolId,
      sourceName: pool.name
    };
    const nextBlocks = state.scheduleBlocks.map((block) => (block.id === payload.id ? updatedBlock : block));
    const conflicts = findScheduleConflicts(nextBlocks);
    if (conflicts.length > 0) {
      throw new Error("Schedule blocks overlap. Adjust the edited start time or duration.");
    }

    await updateScheduleBlockRecord(updatedBlock);
    const nextState = await readAppState();

    await appendAuditEvent(
      "schedule.updated",
      `${user?.displayName || user?.email || "Unknown user"} updated schedule block ${payload.title}.`
    );

    return NextResponse.json({
      ok: true,
      message: `Schedule block ${payload.title} updated.`,
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
