import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server";
import { addPendingPlayoutAction, pendingPlayoutActionIncludes } from "@stream247/core";
import {
  decideInputOpenRetry,
  decideInputOpenRetryAfterExit,
  decideInputOpenRetryAtSlate,
  type InputOpenRetryState
} from "../../apps/worker/src/input-open-retry";
import { decideCycleEndPendingAction } from "../../apps/worker/src/playout-boundary";
import {
  describePendingPlayoutRequests,
  listOperatorHolds,
  resumeHasSomethingToClear,
  resumeTakesTheAir,
  type OperatorHoldsInput
} from "../../apps/web/lib/operator-holds";

// M120 = suggestion 22 of planning/suggestions-2026-10-04.md: operator actions get lost or stay invisible
// (M89 "Not changed", M94 review "Left as is").

const { mockAppendAuditEvent, mockReadAppState, mockUpdateDestinationRecord, mockUpdatePlayoutRuntime } = vi.hoisted(() => ({
  mockAppendAuditEvent: vi.fn(),
  mockReadAppState: vi.fn(),
  mockUpdateDestinationRecord: vi.fn(),
  mockUpdatePlayoutRuntime: vi.fn()
}));

vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent,
  readAppState: mockReadAppState,
  updateDestinationRecord: mockUpdateDestinationRecord,
  updatePlayoutRuntime: mockUpdatePlayoutRuntime
}));

vi.mock("../../apps/web/node_modules/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../apps/web/node_modules/react")>();
  return {
    ...actual,
    useState: (initial: unknown) => [typeof initial === "function" ? (initial as () => unknown)() : initial, () => undefined],
    useTransition: () => [false, (callback: () => void) => callback()]
  };
});

vi.mock("../../apps/web/node_modules/next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined })
}));

import { runBroadcastAction } from "../../apps/web/lib/server/broadcast";
import { PlayoutActionForm } from "../../apps/web/components/playout-action-form";

(globalThis as { React?: unknown }).React = React;

const FAR = "2099-01-01T00:00:00.000Z";

describe("a Refresh or queue rebuild waits for the cycle that carries it out", () => {
  it.each([
    ["", "refresh", "refresh"],
    ["", "rebuild_queue", "rebuild_queue"],
    ["refresh", "refresh", "refresh"],
    ["refresh", "rebuild_queue", "refresh_and_rebuild_queue"],
    ["rebuild_queue", "refresh", "refresh_and_rebuild_queue"],
    ["refresh_and_rebuild_queue", "rebuild_queue", "refresh_and_rebuild_queue"]
  ] as const)("adds %s and %s up to %s", (current, requested, expected) => {
    expect(addPendingPlayoutAction(current, requested)).toBe(expected);
  });

  it("names both parts of the combined request", () => {
    expect(pendingPlayoutActionIncludes("refresh_and_rebuild_queue", "refresh")).toBe(true);
    expect(pendingPlayoutActionIncludes("refresh_and_rebuild_queue", "rebuild_queue")).toBe(true);
    expect(pendingPlayoutActionIncludes("refresh", "rebuild_queue")).toBe(false);
    expect(pendingPlayoutActionIncludes("", "refresh")).toBe(false);
  });

  it("keeps a request added while the cycle ran for the next cycle", () => {
    const consumed = { pendingAction: "refresh" as const, pendingActionRequestedAt: "2026-10-23T10:00:00.000Z" };
    const row = { pendingAction: "refresh_and_rebuild_queue" as const, pendingActionRequestedAt: "2026-10-23T10:00:05.000Z" };
    expect(decideCycleEndPendingAction({ consumed, row })).toEqual(row);
    expect(decideCycleEndPendingAction({ consumed: row, row })).toEqual({ pendingAction: "", pendingActionRequestedAt: "" });
  });
});

describe("the admin's actions leave another action's request alone", () => {
  type Playout = Record<string, unknown>;
  let runtime: Playout;
  let writes: Playout[];
  const assetOf = (id: string) => ({
    id,
    sourceId: "src",
    title: `Item ${id}`,
    path: `/app/data/media/${id}.mp4`,
    status: "ready",
    includeInProgramming: true,
    isGlobalFallback: id === "D",
    fallbackPriority: 100,
    cachePath: "",
    cacheStatus: ""
  });

  function seed(playout: Playout) {
    runtime = {
      status: "running",
      currentAssetId: "B",
      restartRequestedAt: "",
      overrideMode: "schedule",
      overrideAssetId: "",
      overrideUntil: "",
      manualNextAssetId: "",
      manualNextRequestedAt: "",
      insertAssetId: "",
      insertRequestedAt: "",
      insertStatus: "",
      skipAssetId: "",
      skipUntil: "",
      removeNextAssetId: "",
      removeNextUntil: "",
      pendingAction: "",
      pendingActionRequestedAt: "",
      liveBridgeStatus: "",
      liveBridgeInputUrl: "",
      previousAssetId: "C",
      queueItems: [
        { assetId: "B", title: "Item B" },
        { assetId: "C", title: "Item C" }
      ],
      ...playout
    };
    mockReadAppState.mockResolvedValue({
      playout: runtime,
      assets: ["A", "B", "C", "D"].map(assetOf),
      destinations: [{ id: "dest", name: "Primary", role: "primary", status: "recovering" }],
      managedConfig: {}
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    writes = [];
    mockAppendAuditEvent.mockResolvedValue(undefined);
    mockUpdateDestinationRecord.mockResolvedValue(undefined);
    mockUpdatePlayoutRuntime.mockImplementation(async (updater: (current: Playout) => Playout) => {
      const next = await updater(runtime);
      writes.push(next);
      return next;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const REQUESTED_AT = "2026-10-23T09:59:00.000Z";

  it.each([
    ["Skip", { type: "skip" } as const],
    ["Soft restart", { type: "restart" } as const],
    ["Hard reload", { type: "hard_reload" } as const],
    ["Force reconnect", { type: "force_reconnect" } as const],
    ["Recover outputs", { type: "recover_outputs" } as const],
    ["Pin", { type: "override", assetId: "A" } as const],
    ["Fallback", { type: "fallback" } as const],
    ["Resume", { type: "resume" } as const],
    ["Play now", { type: "play_now", assetId: "A" } as const],
    ["Live Bridge", { type: "bridge_start", inputUrl: "rtmp://encoder.example/live" } as const]
  ])("%s keeps a queue rebuild and a Refresh asked for before it", async (_name, action) => {
    for (const pendingAction of ["rebuild_queue", "refresh"]) {
      seed({ pendingAction, pendingActionRequestedAt: REQUESTED_AT });
      await runBroadcastAction(action);
      expect(writes.at(-1)).toMatchObject({ pendingAction, pendingActionRequestedAt: REQUESTED_AT });
    }
  });

  it.each([
    ["Move next", { type: "move_next", assetId: "A" } as const],
    ["Remove next", { type: "remove_next" } as const],
    ["Replay previous", { type: "replay_previous" } as const],
    ["Rebuild queue", { type: "rebuild_queue" } as const]
  ])("%s adds its rebuild to a waiting Refresh", async (_name, action) => {
    seed({ pendingAction: "refresh", pendingActionRequestedAt: REQUESTED_AT });
    await runBroadcastAction(action);
    expect(writes.at(-1)!.pendingAction).toBe("refresh_and_rebuild_queue");
    expect(writes.at(-1)!.pendingActionRequestedAt).not.toBe(REQUESTED_AT);
  });

  it("Refresh adds itself to a waiting rebuild", async () => {
    seed({ pendingAction: "rebuild_queue", pendingActionRequestedAt: REQUESTED_AT });
    await runBroadcastAction({ type: "refresh" });
    expect(writes.at(-1)!.pendingAction).toBe("refresh_and_rebuild_queue");
  });

  it("Resume of a hold alone clears it and restarts nothing, without the relay too", async () => {
    for (const hold of [
      { skipAssetId: "A", skipUntil: FAR },
      { removeNextAssetId: "C", removeNextUntil: FAR },
      { manualNextAssetId: "C", manualNextRequestedAt: REQUESTED_AT }
    ]) {
      seed(hold);
      await runBroadcastAction({ type: "resume" });
      expect(writes.at(-1)).toMatchObject({
        status: "running",
        restartRequestedAt: "",
        skipAssetId: "",
        removeNextAssetId: "",
        manualNextAssetId: ""
      });
    }
  });

  it("Resume of a Pin or a Play now restarts without the relay, as before", async () => {
    seed({ overrideMode: "asset", overrideAssetId: "A", overrideUntil: FAR, skipAssetId: "C", skipUntil: FAR });
    await runBroadcastAction({ type: "resume" });
    expect(writes.at(-1)).toMatchObject({ status: "recovering", overrideMode: "schedule", skipAssetId: "" });
    expect(writes.at(-1)!.restartRequestedAt).not.toBe("");
    seed({ insertAssetId: "A", insertStatus: "pending", insertRequestedAt: REQUESTED_AT });
    await runBroadcastAction({ type: "resume" });
    expect(writes.at(-1)!.restartRequestedAt).not.toBe("");
    vi.stubEnv("STREAM247_RELAY_ENABLED", "1");
    seed({ overrideMode: "asset", overrideAssetId: "A", overrideUntil: FAR });
    await runBroadcastAction({ type: "resume" });
    expect(writes.at(-1)!.restartRequestedAt).toBe("");
  });
});

describe("the live view shows what the operator's actions hold", () => {
  const nowMs = Date.parse("2026-10-23T10:00:00.000Z");
  const inMinutes = (minutes: number) => new Date(nowMs + minutes * 60_000).toISOString();
  const none: OperatorHoldsInput = {
    overrideMode: "schedule",
    overrideAssetId: "",
    overrideUntil: "",
    insertAssetId: "",
    insertStatus: "",
    manualNextAssetId: "",
    skipAssetId: "",
    skipUntil: "",
    removeNextAssetId: "",
    removeNextUntil: "",
    pendingAction: ""
  };
  const titleOf = (id: string) => `Item ${id}`;

  it("lists every hold in words, with the time left", () => {
    const holds = listOperatorHolds(
      {
        ...none,
        overrideMode: "asset",
        overrideAssetId: "A",
        overrideUntil: inMinutes(42),
        insertAssetId: "E",
        insertStatus: "pending",
        manualNextAssetId: "F",
        skipAssetId: "B",
        skipUntil: inMinutes(125),
        removeNextAssetId: "C",
        removeNextUntil: inMinutes(60)
      },
      titleOf,
      nowMs
    );
    expect(holds.map((hold) => hold.text)).toEqual([
      "Pinned on air: Item A for 42 more min.",
      "Play now: Item E takes the air at the next playout cycle.",
      "Move next: Item F plays next.",
      "Skipped: Item B stays out for 2 h 5 min more.",
      "Removed from next: Item C stays out for 1 h more."
    ]);
    expect(listOperatorHolds({ ...none, overrideMode: "fallback", overrideAssetId: "D", overrideUntil: inMinutes(5) }, titleOf, nowMs)[0]!.text).toBe(
      "Fallback on air: Item D for 5 more min."
    );
    expect(listOperatorHolds({ ...none, insertAssetId: "E", insertStatus: "active" }, titleOf, nowMs)[0]!.text).toBe(
      "Play now: Item E is on air to its end."
    );
  });

  it("leaves out holds that ran out, and then Resume has nothing to clear", () => {
    const expired = { ...none, skipAssetId: "B", skipUntil: inMinutes(-1), removeNextAssetId: "C", removeNextUntil: inMinutes(-5) };
    expect(listOperatorHolds(expired, titleOf, nowMs)).toEqual([]);
    expect(resumeHasSomethingToClear(expired, nowMs)).toBe(false);
    expect(resumeHasSomethingToClear(none, nowMs)).toBe(false);
  });

  it("enables Resume for a skip hold, a Remove next or a Move next alone, which do not take the air", () => {
    for (const hold of [
      { skipAssetId: "B", skipUntil: inMinutes(30) },
      { removeNextAssetId: "C", removeNextUntil: inMinutes(30) },
      { manualNextAssetId: "C" }
    ]) {
      expect(resumeHasSomethingToClear({ ...none, ...hold }, nowMs)).toBe(true);
      expect(resumeTakesTheAir({ ...none, ...hold }, nowMs)).toBe(false);
    }
    expect(resumeTakesTheAir({ ...none, overrideMode: "asset", overrideAssetId: "A", overrideUntil: inMinutes(1) }, nowMs)).toBe(true);
    expect(resumeTakesTheAir({ ...none, insertAssetId: "E", insertStatus: "active" }, nowMs)).toBe(true);
  });

  it("says which requests wait for the next playout cycle", () => {
    expect(describePendingPlayoutRequests("")).toBe("");
    expect(describePendingPlayoutRequests("refresh")).toBe("Waiting for the next playout cycle: Refresh scenes.");
    expect(describePendingPlayoutRequests("refresh_and_rebuild_queue")).toBe(
      "Waiting for the next playout cycle: Refresh scenes and Rebuild queue."
    );
  });

  it("renders Resume schedule enabled for a hold and greyed out without one", () => {
    const resumeButton = (resumeEnabled: boolean) => {
      const html = renderToStaticMarkup(
        React.createElement(PlayoutActionForm, { assets: [{ id: "A", title: "Item A" }], overrideMode: "schedule", resumeEnabled })
      );
      return html.match(/<button[^>]*>Resume schedule<\/button>/)?.[0] ?? "";
    };
    expect(resumeButton(true)).not.toContain("disabled");
    expect(resumeButton(false)).toContain("disabled");
  });

  it("puts the holds and the waiting requests on the control room's Current and next panel", () => {
    const source = readFileSync(path.join(process.cwd(), "apps/web/components/broadcast-control-room.tsx"), "utf8").replace(/\s+/g, " ");
    expect(source).toContain("const operatorHolds = Number.isFinite(incidentNowMs) ? listOperatorHolds(snapshot.playout, titleOf, incidentNowMs) : [];");
    expect(source).toContain('<div className="item" data-testid="operator-holds"> <strong>Operator holds</strong>');
    expect(source).toContain("Resume schedule clears all of these.");
    expect(source).toContain("{pendingRequests ? <div className=\"subtle\">{pendingRequests}</div> : null}");
  });
});

describe("a retry the reconnect slate or standby takes the place of", () => {
  const nowMs = Date.parse("2026-10-23T10:00:00.000Z");
  const failed: InputOpenRetryState = { assetId: "A", retried: false, failedAtMs: nowMs - 5_000 };
  const base = { retry: failed, runtimeStatus: "failed", runtimeCurrentAssetId: "A", runtimeReasonCode: "scheduled_match", processRunning: false, nowMs };

  it("is still owed after a Restart, Skip or Force reconnect wrote over the failed status", () => {
    for (const runtimeStatus of ["failed", "recovering", "reconnecting"]) {
      expect(decideInputOpenRetry({ ...base, runtimeStatus })).toEqual({ assetId: "A", reasonCode: "scheduled_match" });
    }
    expect(decideInputOpenRetry({ ...base, runtimeStatus: "running" })).toBeNull();
    expect(decideInputOpenRetry({ ...base, runtimeStatus: "recovering", processRunning: true })).toBeNull();
  });

  it("is kept through the reconnect slate and started after it, with one log line", () => {
    const atSlate = decideInputOpenRetryAtSlate({
      retry: failed,
      slate: "reconnect",
      selectedAssetId: "A",
      selectedReasonCode: "scheduled_match",
      selectedIsRetry: true,
      nowMs
    });
    expect(atSlate).toMatchObject({ event: "playout.input.retry.deferred", assetId: "A", reason: "reconnect-slate" });
    expect(atSlate.next).toMatchObject({ assetId: "A", retried: false, coveredBySlate: true, reasonCode: "scheduled_match" });

    // The slate runs, nothing is named on air: the selection asks for the retry, the slate takes the cycle
    // again while its window lasts, without a second log line.
    const whileSlate = { ...base, retry: atSlate.next, runtimeStatus: "reconnecting", runtimeCurrentAssetId: "", runtimeReasonCode: "scheduled_reconnect", processRunning: true };
    expect(decideInputOpenRetry(whileSlate)).toEqual({ assetId: "A", reasonCode: "scheduled_match" });
    const again = decideInputOpenRetryAtSlate({
      retry: atSlate.next,
      slate: "reconnect",
      selectedAssetId: "A",
      selectedReasonCode: "scheduled_match",
      selectedIsRetry: true,
      nowMs
    });
    expect(again).toMatchObject({ event: "", next: atSlate.next });
    // After the window the cycle starts it: nothing to log here, the worker marks it retried.
    expect(
      decideInputOpenRetryAtSlate({ retry: atSlate.next, slate: "", selectedAssetId: "A", selectedReasonCode: "scheduled_match", selectedIsRetry: true, nowMs })
    ).toMatchObject({ event: "", next: atSlate.next });
    // The slate's own exit ("" item) leaves it owed.
    expect(decideInputOpenRetryAfterExit({ previous: atSlate.next, exitedAssetId: "", immediateOpenFailure: false, nowMs }).next).toEqual(atSlate.next);
  });

  it("is dropped with a log line when the slate or standby takes a cycle that did not pick it", () => {
    // A Skip of the failed item holds it out: the selection went on to the next item.
    expect(
      decideInputOpenRetryAtSlate({ retry: failed, slate: "reconnect", selectedAssetId: "B", selectedReasonCode: "scheduled_match", selectedIsRetry: false, nowMs })
    ).toEqual({ next: null, event: "playout.input.retry.dropped", assetId: "A", reason: "reconnect-slate" });
    expect(
      decideInputOpenRetryAtSlate({ retry: failed, slate: "standby", selectedAssetId: "", selectedReasonCode: "standby", selectedIsRetry: false, nowMs })
    ).toEqual({ next: null, event: "playout.input.retry.dropped", assetId: "A", reason: "standby" });
  });

  it("is dropped with a log line when another item takes the air after the slate", () => {
    const covered: InputOpenRetryState = { ...failed, coveredBySlate: true, reasonCode: "scheduled_match" };
    expect(
      decideInputOpenRetryAtSlate({ retry: covered, slate: "", selectedAssetId: "P", selectedReasonCode: "operator_override", selectedIsRetry: false, nowMs })
    ).toEqual({ next: null, event: "playout.input.retry.dropped", assetId: "A", reason: "other-item" });
    expect(decideInputOpenRetry({ ...base, retry: covered, runtimeCurrentAssetId: "P", processRunning: true })).toBeNull();
    // A Live Bridge that takes the air after the slate ends it too (review finding).
    expect(
      decideInputOpenRetryAtSlate({ retry: covered, slate: "", selectedAssetId: "", selectedReasonCode: "live_bridge", selectedIsRetry: false, selectedLive: true, nowMs })
    ).toEqual({ next: null, event: "playout.input.retry.dropped", assetId: "A", reason: "live-bridge" });
    expect(decideInputOpenRetryAfterExit({ previous: covered, exitedAssetId: "P", immediateOpenFailure: false, nowMs }).next).toBeNull();
  });

  it("leaves a retry that is not owed alone", () => {
    for (const retry of [null, { ...failed, retried: true }, { ...failed, failedAtMs: nowMs - 11 * 60_000 }]) {
      expect(
        decideInputOpenRetryAtSlate({ retry, slate: "standby", selectedAssetId: "", selectedReasonCode: "standby", selectedIsRetry: false, nowMs }).event
      ).toBe("");
    }
  });

  it("is wired into the cycle right after the slate step, before the retry is used up", () => {
    const source = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8").replace(/\s+/g, " ");
    const atSlate = source.indexOf("const retryAtSlate = decideInputOpenRetryAtSlate({ retry: inputOpenRetry, slate: slateTakesCycle,");
    expect(atSlate).toBeGreaterThan(source.indexOf('slateTakesCycle = "standby";'));
    expect(atSlate).toBeLessThan(source.indexOf("const selectionIsOpenRetry = Boolean("));
    expect(source).toContain(
      'inputOpenRetry = retryAtSlate.next; if (retryAtSlate.event !== "") { logRuntimeEvent(retryAtSlate.event, { assetId: retryAtSlate.assetId, reason: retryAtSlate.reason }); }'
    );
  });
});
