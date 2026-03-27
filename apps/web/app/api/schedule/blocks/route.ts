import { NextRequest, NextResponse } from "next/server";
import { findScheduleConflicts, validateScheduleBlock } from "@stream247/core";
import { getAuthenticatedUser, requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, readAppState, updateAppState } from "@/lib/server/state";

function normalizeBody(body: {
  id?: string;
  title?: string;
  categoryName?: string;
  startMinuteOfDay?: number;
  durationMinutes?: number;
  sourceName?: string;
}) {
  return {
    id: (body.id ?? "").trim(),
    title: (body.title ?? "").trim(),
    categoryName: (body.categoryName ?? "").trim(),
    startMinuteOfDay: Number(body.startMinuteOfDay ?? 0),
    durationMinutes: Number(body.durationMinutes ?? 0),
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
      title?: string;
      categoryName?: string;
      startMinuteOfDay?: number;
      durationMinutes?: number;
      sourceName?: string;
    }
  );

  const validationError = validateScheduleBlock(payload);
  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  try {
    const nextState = await updateAppState((state) => {
      const nextBlocks = [
        ...state.scheduleBlocks,
        {
          id: `schedule_${Math.random().toString(36).slice(2, 10)}`,
          title: payload.title,
          categoryName: payload.categoryName,
          startMinuteOfDay: payload.startMinuteOfDay,
          durationMinutes: payload.durationMinutes,
          sourceName: payload.sourceName
        }
      ];

      const conflicts = findScheduleConflicts(nextBlocks);
      if (conflicts.length > 0) {
        throw new Error("Schedule blocks overlap. Adjust the new start time or duration.");
      }

      return {
        ...state,
        scheduleBlocks: nextBlocks
      };
    });

    await appendAuditEvent(
      "schedule.created",
      `${user?.displayName || user?.email || "Unknown user"} created schedule block ${payload.title}.`
    );

    return NextResponse.json({
      ok: true,
      message: `Schedule block ${payload.title} created.`,
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
    const nextState = await updateAppState((state) => {
      const existing = state.scheduleBlocks.find((block) => block.id === payload.id);
      if (!existing) {
        throw new Error("Schedule block not found.");
      }

      const nextBlocks = state.scheduleBlocks.map((block) =>
        block.id === payload.id
          ? {
              ...block,
              title: payload.title,
              categoryName: payload.categoryName,
              startMinuteOfDay: payload.startMinuteOfDay,
              durationMinutes: payload.durationMinutes,
              sourceName: payload.sourceName
            }
          : block
      );

      const conflicts = findScheduleConflicts(nextBlocks);
      if (conflicts.length > 0) {
        throw new Error("Schedule blocks overlap. Adjust the edited start time or duration.");
      }

      return {
        ...state,
        scheduleBlocks: nextBlocks
      };
    });

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

  await updateAppState((current) => ({
    ...current,
    scheduleBlocks: current.scheduleBlocks.filter((block) => block.id !== id)
  }));

  await appendAuditEvent(
    "schedule.deleted",
    `${user?.displayName || user?.email || "Unknown user"} deleted schedule block ${existing.title}.`
  );

  return NextResponse.json({ ok: true, message: `Schedule block ${existing.title} deleted.` });
}
