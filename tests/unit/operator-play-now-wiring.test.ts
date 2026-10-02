import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// M74. choosePlaybackCandidate and runPlayoutCycle live in apps/worker/src/index.ts, which cannot be
// imported in a unit test (it starts the worker). The decisions are pure functions in
// playout-boundary.ts (tested there); this pins where the cycle uses them, the way
// youtube-playback-wiring.test.ts does.
const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

function functionBody(name: string): string {
  const start = workerSource.indexOf(`function ${name}(`);
  expect(start, `function ${name} not found`).toBeGreaterThan(-1);
  const next = workerSource.indexOf("\nfunction ", start + 1);
  const nextAsync = workerSource.indexOf("\nasync function ", start + 1);
  const ends = [next, nextAsync].filter((index) => index > -1);
  return workerSource.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
}

function between(body: string, from: string, to: string): string {
  const start = body.indexOf(from);
  expect(start, `${from} not found`).toBeGreaterThan(-1);
  const end = body.indexOf(to, start);
  expect(end, `${to} not found after ${from}`).toBeGreaterThan(start);
  return body.slice(start, end);
}

describe("selection without the restart-plus-desired-asset branch", () => {
  const choose = flat(functionBody("choosePlaybackCandidate"));

  it("selects an operator override only for a running Pin or Fallback", () => {
    // The DUT 2026-10-01: this arm re-picked the running archive for a Play now and every other action
    // that set the restart flag, ahead of the insert branch.
    expect(choose).not.toContain("state.playout.desiredAssetId");
    // M78: the arm applies core resolveOperatorOverrideHold (a running override, its item ready, not
    // under a skip hold -- tested in operator-precedence.test.ts), the rule the admin and the chat skip
    // vote use, so a Skip during a pin no longer starts the pinned item again from 0.
    expect(choose).toContain(
      'const overrideHold = resolveOperatorOverrideHold({ ...state.playout, assets: state.assets, nowMs: Date.now() }); const desiredAsset = overrideHold !== "" ? state.assets.find((asset) => asset.id === state.playout.overrideAssetId) : null;'
    );
    // Pin and Fallback still pin: the override branch comes first and Fallback writes the same fields.
    expect(choose.indexOf("if (desiredAsset)")).toBeLessThan(choose.indexOf('if (activeInsertAsset && state.playout.insertStatus !== "")'));
  });

  it("starts a queued Move next at once only when the running item was skipped", () => {
    expect(choose).toContain(
      '(state.playout.currentAssetId === "" || (state.playout.restartRequestedAt !== "" && state.playout.currentAssetId === skippedAssetId) || state.playout.status === "standby")'
    );
  });

  it("keeps a running pool item for Restart, but not an item a cancelled insert put on air", () => {
    // Only the insert: a pinned pool item whose pin ends plays on as the pool's item, as before M74.
    expect(choose).toContain('const runningOperatorItem = state.playout.selectionReasonCode === "operator_insert";');
    expect(choose).not.toContain('state.playout.selectionReasonCode === "operator_override"');
    expect(choose).toContain("processRunning && !runningOperatorItem && currentScheduleItem?.poolId && state.playout.currentAssetId");
    // Skip still moves on: the skipped item is never the running pool item, and the rotation (M73)
    // continues after it.
    const poolAsset = between(choose, "const currentPoolAsset =", ": null;");
    expect(poolAsset).toContain("asset.id !== skippedAssetId");
    // Since M89 the operator's Remove next hold is held out the same way, beside the skip hold.
    expect(choose).toContain("currentPoolAsset ?? selectPoolAsset(state, currentScheduleItem.poolId, skippedAssetId, removedNextAssetId)");
  });

  it("lets a Move next or Replay previous item play to its end, also from outside the pool's sources", () => {
    // After its manual_next start nothing else held it, and the pool's pick cut it after one cycle.
    const running = between(choose, "const runningScheduledAsset =", ": null;");
    expect(running).toContain(
      '(state.playout.selectionReasonCode === "scheduled_match" || state.playout.selectionReasonCode === "graceful_handoff" || state.playout.selectionReasonCode === "manual_next")'
    );
    expect(running).toContain("asset.id !== skippedAssetId");
    // It is handed on as graceful_handoff when it is not one of the pool's sources.
    expect(choose).toContain("if (runningScheduledAsset && (!currentPool || !currentPool.sourceIds.includes(runningScheduledAsset.sourceId))) {");
  });

  it("matches the running item through runningAssetTargetMatches", () => {
    const match = flat(functionBody("isMatchingRunningSelection"));
    expect(match).toContain(
      "return runningAssetTargetMatches({ desiredKind, desiredAssetId: desiredAsset.id, runningKind: playoutTargetKind, runningAssetId: playoutAssetId });"
    );
  });
});

describe("the playout cycle", () => {
  const cycle = functionBody("runPlayoutCycle");
  const flatCycle = flat(cycle);

  it("shows the reconnect slate only through shouldShowReconnectSlate", () => {
    expect(flatCycle).toContain(
      'shouldShowReconnectSlate({ relayEnabled: STREAM247_RELAY_ENABLED, liveBridgeActive, reconnectActive, restartRequested: state.playout.restartRequestedAt !== "" })'
    );
    expect(flatCycle).not.toContain('(reconnectActive || state.playout.restartRequestedAt !== "")');
    // The direct-mode reconnect still sets the flag that shows the slate, and the relay guards stay.
    expect(flatCycle).toContain('const reconnectActive = !STREAM247_RELAY_ENABLED && !liveBridgeActive && state.playout.restartRequestedAt !== ""');
    expect(flatCycle).toContain("const reconnectDue = !STREAM247_RELAY_ENABLED && !liveBridgeActive && !reconnectActive");
    expect(flatCycle).toMatch(/await stopPlayoutProcess\("scheduled-reconnect"\); await updatePlayoutRuntime\(\(playout\) => \(\{ \.\.\.playout, restartRequestedAt: new Date\(\)\.toISOString\(\)/);
  });

  it("still resets a crash loop and restarts whatever the selection names", () => {
    expect(flatCycle).toContain(
      'if (state.playout.crashLoopDetected && (selection.asset || selection.queueKind === "live") && !state.playout.restartRequestedAt) { await stopPlayoutProcess("crash-loop-reset");'
    );
    expect(flatCycle).toContain('const restartRequested = Boolean(state.playout.restartRequestedAt) && selection.queueKind !== "live";');
    // M76 names what the restart was for (as-run log) right before the stop; nothing is awaited in between.
    expect(flatCycle.slice(flatCycle.indexOf("if (restartRequested) {"))).toMatch(
      /^if \(restartRequested\) \{ [^{}]*?asRunStopIntent = asRunRestartIntentOf\(\{ [^}]* \}\); await stopPlayoutProcess\("restart-requested"\);/
    );
  });

  it("waits for a finished exit's runtime write before the cycle's first read", () => {
    const capture = cycle.indexOf("const processRunningAtCycleStart = isPlayoutProcessRunning();");
    const firstRead = cycle.indexOf("let state = await readAppState();");
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(firstRead);
    expect(flat(cycle.slice(capture, firstRead + 40))).toContain(
      "const processRunningAtCycleStart = isPlayoutProcessRunning(); await pendingPlayoutExitUpdate; let state = await readAppState();"
    );
  });

  it("re-reads state after a stop between the cycle's first read and the selection", () => {
    const capture = cycle.indexOf("const processRunningAtCycleStart = isPlayoutProcessRunning();");
    const bound = cycle.indexOf("await enforceAssetDurationBound(state.assets);");
    const feed = cycle.indexOf("await updateProgramFeedRuntimeStatus();");
    const reread = cycle.indexOf("if (processRunningAtCycleStart && !isPlayoutProcessRunning()) {");
    const select = cycle.indexOf("let selection: SelectionResult = choosePlaybackCandidate(state);");
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(bound);
    expect(bound).toBeLessThan(feed);
    expect(feed).toBeLessThan(reread);
    expect(reread).toBeLessThan(select);
    // The exit handler's runtime write first (it clears the insert), then the read.
    expect(flat(cycle.slice(reread, select))).toContain("await pendingPlayoutExitUpdate; state = await readAppState();");
    expect(flat(workerSource)).toContain("pendingPlayoutExitUpdate = runtimeUpdate.then( () => undefined, () => undefined );");
  });

  it("logs every insert it clears before it aired", () => {
    // Since M78 the decision is decideInsertAfterSelection (playout-boundary.ts, tested there), and a
    // live selection no longer leaves the insert in place: the takeover drops a pending one as
    // "live-bridge" and ends an active one.
    const clear = flat(between(cycle, "const insertAfterSelection = decideInsertAfterSelection({", "selection = choosePlaybackCandidate(state);"));
    expect(clear).toContain('selectionIsLive: selection.queueKind === "live"');
    expect(clear).toContain(
      'if (insertAfterSelection.clear) { if (insertAfterSelection.dropReason !== "") { await recordDroppedInsert({ state, reason: insertAfterSelection.dropReason, selectionReasonCode: selection.reasonCode });'
    );
    expect(clear.indexOf("recordDroppedInsert(")).toBeLessThan(clear.indexOf("await updatePlayoutRuntime("));
    // Only the insert this cycle read; a Play now written since then is left for the next cycle.
    expect(clear).toContain(
      "playout.insertAssetId === clearedInsertAssetId && playout.insertRequestedAt === clearedInsertRequestedAt ? {"
    );
    for (const reason of ['"destination-missing"', '"prepare-failed"']) {
      expect(cycle).toContain(`reason: ${reason}`);
    }
    // Both start paths that clear the insert after a failed start.
    expect(cycle.match(/reason: "start-failed"/g)?.length).toBe(2);
    const record = flat(functionBody("recordDroppedInsert"));
    expect(record).toContain('logRuntimeEvent("playout.insert.dropped", { assetId, reason: args.reason, selectionReasonCode: args.selectionReasonCode');
    expect(record).toContain('await appendAuditEvent( "playout.insert.dropped",');
  });

  it("keeps the running item when an operator insert cannot be prepared", () => {
    const failure = flat(between(cycle, 'const message = error instanceof Error ? error.message : "Unknown Twitch VOD cache preparation error.";', "const recoveryPlan = planRecoveryAfterPlaybackPreparationFailure("));
    // The decision is decideInsertAfterPrepareFailure (playout-boundary.test.ts): a pending insert is
    // dropped; an insert on air that fails to prepare for a Restart takes the programme's recovery path,
    // and the cycle after it, with the fallback on air, ends it (combination review: nothing else did).
    expect(failure).toContain(
      "const insertFailure = decideInsertAfterPrepareFailure({ selectionReasonCode: failedReasonCode, insertStatus: state.playout.insertStatus, insertAssetId: state.playout.insertAssetId, processRunning: isPlayoutProcessRunning(), currentAssetId: state.playout.currentAssetId });"
    );
    expect(failure).toContain('if (insertFailure !== "recover") {');
    // A drop keeps its record ("dropped before it aired"); an insert that aired gets its own line and row.
    expect(failure).toContain(
      'if (insertFailure === "drop") { await recordDroppedInsert({ state, reason: "prepare-failed", selectionReasonCode: failedReasonCode, error: message }); } else {'
    );
    expect(failure).toContain('logRuntimeEvent("playout.insert.ended", { assetId: failedAsset.id, reason: "prepare-failed", error: message.slice(0, 300) });');
    expect(failure).toContain('await appendAuditEvent( "playout.insert.ended",');
    // Both clear only the insert this cycle selected: a Play now written meanwhile stands.
    expect(failure).toContain('...(playout.insertAssetId === failedAsset.id ? { insertAssetId: "", insertRequestedAt: "", insertStatus: "" } : {}),');
    expect(failure).toContain('reason: "prepare-failed"');
    expect(failure).toContain('requestImmediatePlayoutCycle("insert-prepare-failed"); return; }');
    // The incident and the recovery plan are for the programme, not for a dropped insert.
    expect(failure.indexOf("return; }")).toBeLessThan(failure.indexOf("await upsertIncident("));
    expect(flatCycle).toContain("const failedAsset = selection.asset; const failedReasonCode = selection.reasonCode;");
  });

  it("records the outgoing asset as the previous one", () => {
    expect(cycle.indexOf("const onAirAtCycleStart = state.playout.currentAssetId;")).toBeLessThan(
      cycle.indexOf("await enforceAssetDurationBound(state.assets);")
    );
    expect(flatCycle).toContain(
      'decidePreviousAssetId({ onAirAtCycleStart, lastEndedAssetId, incomingAssetId: selection.asset?.id ?? "", incomingIsLive: selection.queueKind === "live", previousAssetId: state.playout.previousAssetId })'
    );
    // The comparison against the re-read row, which startOrSwitchPlayout had already moved on, is gone.
    expect(flatCycle).not.toContain('(selection.asset && playout.currentAssetId !== "" && playout.currentAssetId !== selection.asset.id)');
    expect(flatCycle).toContain("...(previousAssetId !== state.playout.previousAssetId ? { previousAssetId, previousTitle: previousAssetTitle } : {}),");
    expect(flatCycle).toContain("selection.asset && onAirAtCycleStart && onAirAtCycleStart !== selection.asset.id ? onAirAtCycleStart");
  });
});

describe("the cycle's end", () => {
  const flatCycle = flat(functionBody("runPlayoutCycle"));

  it("marks the insert active only while the row still names it", () => {
    expect(flatCycle).toContain(
      '...decideCycleEndInsert({ selectionIsOperatorInsert: selection.reasonCode === "operator_insert", selectedAssetId: selection.asset?.id ?? "", row: { insertAssetId: playout.insertAssetId, insertRequestedAt: playout.insertRequestedAt, insertStatus: playout.insertStatus }, now: new Date().toISOString() }),'
    );
    expect(flatCycle).not.toContain('insertStatus: selection.reasonCode === "operator_insert" ? "active"');
  });

  it("warms the pool's next items while an operator item is on air, without moving the position", () => {
    const queue = between(flatCycle, "const rawQueueAssets = prioritizeManualNextAsset(", "manualNextQueueAsset );");
    for (const reasonCode of ["scheduled_match", "scheduled_insert", "graceful_handoff", "manual_next", "operator_insert", "operator_override"]) {
      expect(queue).toContain(`selection.reasonCode === "${reasonCode}"`);
    }
    expect(queue).toContain("currentStartsPool: selectionTakesPosition");
  });
});

describe("the playout exit handler", () => {
  it("clears an insert through shouldClearInsertOnExit, with the planned reason", () => {
    const flatWorker = flat(workerSource);
    expect(flatWorker).toContain(
      "...(shouldClearInsertOnExit({ plannedReason, insertStatus: playout.insertStatus, insertAssetId: playout.insertAssetId, currentAssetId: playout.currentAssetId }) ? { insertAssetId: \"\", insertRequestedAt: \"\", insertStatus: \"\" } : {}),"
    );
    expect(flatWorker).not.toContain('!wasPlanned && playout.insertStatus === "active"');
  });
});
