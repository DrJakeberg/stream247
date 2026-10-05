/**
 * What the wizard's "First programme" step writes (M99, U2): a pool from the picked sources, then the
 * "Always-on single pool" template over it. The form (`components/setup-programme-form.tsx`) runs this with
 * the browser's fetch; the test runs it against the real routes.
 *
 * Review finding R17 (2026-10-05): the template lays seven 00:00-24:00 blocks over the week, so without
 * *Replace* it overlaps every weekly (undated) block and the template route refuses it. The step wrote the
 * pool first, so on a week with any weekly block (the DUT's, for one) every press without *Replace* failed
 * and left one more pool named "Programme". It now stops before writing anything, and a pool an earlier
 * press created is used again instead of a new one. Dated blocks are no obstacle: the template's weekly
 * blocks sit under them (M93).
 */

export type FirstProgrammePool = { id: string; name: string; sourceIds: string[] };

export type FirstProgrammeResult =
  | { status: "done"; pool: FirstProgrammePool }
  | { status: "error"; message: string; pool: FirstProgrammePool | null };

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

export function describeWeeklyBlocksInTheWay(weeklyBlockCount: number): string {
  return `The week has ${weeklyBlockCount} weekly block${weeklyBlockCount === 1 ? "" : "s"}, and the new all-day blocks would overlap ${
    weeklyBlockCount === 1 ? "it" : "every one of them"
  }. Tick "Replace the blocks already in the week", or add the pool to the week under Program → Schedule. Nothing was created.`;
}

const sameSources = (left: string[], right: string[]) =>
  left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);

export async function createFirstProgramme(args: {
  name: string;
  sourceIds: string[];
  replaceWeek: boolean;
  /** Undated blocks in the week: the ones the template's all-day blocks would overlap. */
  weeklyBlockCount: number;
  /** The pool an earlier press of this form created; used again while its name and sources are unchanged. */
  createdPool: FirstProgrammePool | null;
  fetch: FetchLike;
}): Promise<FirstProgrammeResult> {
  if (args.sourceIds.length === 0) {
    return { status: "error", message: "Pick at least one source.", pool: args.createdPool };
  }
  if (!args.replaceWeek && args.weeklyBlockCount > 0) {
    return { status: "error", message: describeWeeklyBlocksInTheWay(args.weeklyBlockCount), pool: args.createdPool };
  }

  let pool =
    args.createdPool && args.createdPool.name === args.name && sameSources(args.createdPool.sourceIds, args.sourceIds)
      ? args.createdPool
      : null;
  if (!pool) {
    const poolResponse = await args.fetch("/api/pools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: args.name, sourceIds: args.sourceIds })
    });
    const poolPayload = (await poolResponse.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!poolResponse.ok || !poolPayload.id) {
      return { status: "error", message: poolPayload.message ?? "Could not create the pool.", pool: args.createdPool };
    }
    pool = { id: poolPayload.id, name: args.name, sourceIds: [...args.sourceIds] };
  }

  const templateResponse = await args.fetch("/api/schedule/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template: "always-on-single-pool", primaryPoolId: pool.id, replaceExisting: args.replaceWeek })
  });
  if (!templateResponse.ok) {
    const templatePayload = (await templateResponse.json().catch(() => ({}))) as { message?: string };
    // The pool stays, and the next press of this form uses it again.
    return {
      status: "error",
      message: `The pool ${args.name.trim() || "Programme"} was created, but the week was not filled: ${
        templatePayload.message ?? "the template could not be applied."
      }`,
      pool
    };
  }
  return { status: "done", pool };
}
