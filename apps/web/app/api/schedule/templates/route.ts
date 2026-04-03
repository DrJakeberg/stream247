import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, requireApiRoles } from "@/lib/server/auth";
import { appendAuditEvent, updateAppState } from "@/lib/server/state";

type TemplateKind = "always-on-single-pool" | "weekday-weekend-split" | "three-part-day";

function createBlock(args: {
  title: string;
  categoryName: string;
  dayOfWeek: number;
  startMinuteOfDay: number;
  durationMinutes: number;
  poolId: string;
  sourceName: string;
}) {
  return {
    id: `schedule_${Math.random().toString(36).slice(2, 10)}`,
    title: args.title,
    categoryName: args.categoryName,
    dayOfWeek: args.dayOfWeek,
    startMinuteOfDay: args.startMinuteOfDay,
    durationMinutes: args.durationMinutes,
    poolId: args.poolId,
    sourceName: args.sourceName
  };
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRoles(["owner", "admin", "operator"]);
  if (unauthorized) {
    return unauthorized;
  }

  const user = await getAuthenticatedUser();
  const body = (await request.json()) as {
    template?: TemplateKind;
    primaryPoolId?: string;
    secondaryPoolId?: string;
    tertiaryPoolId?: string;
    replaceExisting?: boolean;
  };

  const template = (body.template ?? "always-on-single-pool") as TemplateKind;
  const primaryPoolId = (body.primaryPoolId ?? "").trim();
  const secondaryPoolId = (body.secondaryPoolId ?? "").trim();
  const tertiaryPoolId = (body.tertiaryPoolId ?? "").trim();
  const replaceExisting = Boolean(body.replaceExisting);

  if (!primaryPoolId) {
    return NextResponse.json({ message: "A primary pool is required." }, { status: 400 });
  }

  if ((template === "weekday-weekend-split" || template === "three-part-day") && !secondaryPoolId) {
    return NextResponse.json({ message: "A secondary pool is required for this template." }, { status: 400 });
  }

  if (template === "three-part-day" && !tertiaryPoolId) {
    return NextResponse.json({ message: "A prime-time pool is required for the three-part day template." }, { status: 400 });
  }

  try {
    await updateAppState((state) => {
      const primaryPool = state.pools.find((pool) => pool.id === primaryPoolId);
      const secondaryPool = state.pools.find((pool) => pool.id === secondaryPoolId);
      const tertiaryPool = state.pools.find((pool) => pool.id === tertiaryPoolId);

      if (!primaryPool) {
        throw new Error("Primary pool not found.");
      }
      if (template !== "always-on-single-pool" && !secondaryPool) {
        throw new Error("Secondary pool not found.");
      }
      if (template === "three-part-day" && !tertiaryPool) {
        throw new Error("Prime-time pool not found.");
      }

      const generatedBlocks =
        template === "always-on-single-pool"
          ? Array.from({ length: 7 }, (_, dayOfWeek) =>
              createBlock({
                title: `${primaryPool.name} All Day`,
                categoryName: "Replay",
                dayOfWeek,
                startMinuteOfDay: 0,
                durationMinutes: 24 * 60,
                poolId: primaryPool.id,
                sourceName: primaryPool.name
              })
            )
          : template === "weekday-weekend-split"
            ? [
                ...[1, 2, 3, 4, 5].map((dayOfWeek) =>
                  createBlock({
                    title: `${primaryPool.name} Weekdays`,
                    categoryName: "Replay",
                    dayOfWeek,
                    startMinuteOfDay: 0,
                    durationMinutes: 24 * 60,
                    poolId: primaryPool.id,
                    sourceName: primaryPool.name
                  })
                ),
                ...[0, 6].map((dayOfWeek) =>
                  createBlock({
                    title: `${secondaryPool?.name || "Weekend"} Weekend`,
                    categoryName: "Replay",
                    dayOfWeek,
                    startMinuteOfDay: 0,
                    durationMinutes: 24 * 60,
                    poolId: secondaryPool!.id,
                    sourceName: secondaryPool!.name
                  })
                )
              ]
            : Array.from({ length: 7 }, (_, dayOfWeek) => dayOfWeek).flatMap((dayOfWeek) => [
                createBlock({
                  title: `${primaryPool.name} Overnight`,
                  categoryName: "Replay",
                  dayOfWeek,
                  startMinuteOfDay: 0,
                  durationMinutes: 8 * 60,
                  poolId: primaryPool.id,
                  sourceName: primaryPool.name
                }),
                createBlock({
                  title: `${secondaryPool!.name} Daytime`,
                  categoryName: "Replay",
                  dayOfWeek,
                  startMinuteOfDay: 8 * 60,
                  durationMinutes: 8 * 60,
                  poolId: secondaryPool!.id,
                  sourceName: secondaryPool!.name
                }),
                createBlock({
                  title: `${tertiaryPool!.name} Prime Time`,
                  categoryName: "Replay",
                  dayOfWeek,
                  startMinuteOfDay: 16 * 60,
                  durationMinutes: 8 * 60,
                  poolId: tertiaryPool!.id,
                  sourceName: tertiaryPool!.name
                })
              ]);

      return {
        ...state,
        scheduleBlocks: replaceExisting ? generatedBlocks : [...state.scheduleBlocks, ...generatedBlocks]
      };
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not apply programming template." },
      { status: 400 }
    );
  }

  await appendAuditEvent(
    "schedule.template.applied",
    `${user?.displayName || user?.email || "Unknown user"} applied ${template}${replaceExisting ? " and replaced the week" : ""}.`
  );

  return NextResponse.json({ ok: true, message: "Programming template applied." });
}
