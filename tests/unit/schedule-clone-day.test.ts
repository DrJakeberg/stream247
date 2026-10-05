import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleBlock } from "@stream247/core";

// M105, review finding R10: Clone day refuses an overlap on the 7-day minute line, as create, duplicate, edit
// and a template have since M88. An empty target weekday is not enough: a cloned block crossing midnight meets
// the next weekday's first block, and the previous weekday's late block reaches into the cloned morning.

const { mockRequireApiRoles, mockGetAuthenticatedUser, mockAppendAuditEvent, mockReadAppState, mockCreateScheduleBlocksChecked } = vi.hoisted(
  () => ({
    mockRequireApiRoles: vi.fn(),
    mockGetAuthenticatedUser: vi.fn(),
    mockAppendAuditEvent: vi.fn(),
    mockReadAppState: vi.fn(),
    mockCreateScheduleBlocksChecked: vi.fn()
  })
);

vi.mock("@/lib/server/auth", () => ({
  requireApiRoles: mockRequireApiRoles,
  getAuthenticatedUser: mockGetAuthenticatedUser
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  }
}));

vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent,
  createScheduleBlocksChecked: mockCreateScheduleBlocksChecked,
  deleteScheduleBlockRecord: vi.fn(),
  getWorkspaceTimeZone: () => "UTC",
  readAppState: mockReadAppState,
  updateScheduleBlockRecord: vi.fn(),
  updateScheduleRepeatGroupRecords: vi.fn()
}));

import { POST } from "../../apps/web/app/api/schedule/blocks/route";

const block = (overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "dayOfWeek" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock => ({
  title: overrides.id,
  categoryName: "Replay",
  sourceName: "Pool",
  poolId: "pool-1",
  repeatMode: "single",
  repeatGroupId: "",
  ...overrides
});

const cloneDay = (sourceDayOfWeek: number, targetDayOfWeeks: number[]) =>
  POST({ json: async () => ({ action: "clone-day", sourceDayOfWeek, targetDayOfWeeks }) } as never);

describe("Clone day checks the overlap on the 7-day line (R10)", () => {
  let stored: ScheduleBlock[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiRoles.mockResolvedValue(null);
    mockGetAuthenticatedUser.mockResolvedValue({ displayName: "Owner" });
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockReadAppState.mockImplementation(async () => ({ scheduleBlocks: stored, pools: [], assets: [], managedConfig: {} }));
    // Runs the route's own check against the stored blocks, as the transaction does, and stores on success.
    mockCreateScheduleBlocksChecked.mockImplementation(
      async (incoming: ScheduleBlock[], validate: (existing: ScheduleBlock[], incoming: ScheduleBlock[]) => void) => {
        validate(stored, incoming);
        stored = [...stored, ...incoming];
      }
    );
  });

  it("refuses a clone whose 23:00-01:00 block meets the next weekday's 00:00 block, and saves nothing", async () => {
    // Monday holds 23:00 for 120 min; Wednesday is empty, Thursday starts at 00:00.
    stored = [
      block({ id: "mon-late", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 120 }),
      block({ id: "thu-early", dayOfWeek: 4, startMinuteOfDay: 0, durationMinutes: 60 })
    ];
    const response = await cloneDay(1, [3]);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toContain("overlap");
    expect(stored.map((entry) => entry.id)).toEqual(["mon-late", "thu-early"]);
    expect(mockAppendAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses a cloned 00:00 block that the previous weekday's late block runs into", async () => {
    stored = [
      block({ id: "mon-morning", dayOfWeek: 1, startMinuteOfDay: 0, durationMinutes: 60 }),
      block({ id: "tue-late", dayOfWeek: 2, startMinuteOfDay: 23 * 60, durationMinutes: 120 })
    ];
    const response = await cloneDay(1, [3]);
    expect(response.status).toBe(400);
  });

  it("still clones onto an empty weekday when nothing meets", async () => {
    stored = [
      block({ id: "mon-late", dayOfWeek: 1, startMinuteOfDay: 23 * 60, durationMinutes: 120 }),
      block({ id: "fri-early", dayOfWeek: 5, startMinuteOfDay: 0, durationMinutes: 60 })
    ];
    const response = await cloneDay(1, [3]);
    expect(response.status).toBe(200);
    expect(stored.filter((entry) => entry.dayOfWeek === 3).map((entry) => [entry.startMinuteOfDay, entry.durationMinutes])).toEqual([[23 * 60, 120]]);
    expect(mockAppendAuditEvent).toHaveBeenCalledWith("schedule.day_cloned", expect.stringContaining("cloned 1 schedule block"));
  });
});
