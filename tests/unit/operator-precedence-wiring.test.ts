import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// M78. The decisions are pure (core operator-precedence.ts, playout-boundary.ts decideInsertAfterSelection,
// chat-control.ts) and tested there; apps/worker/src/index.ts cannot be imported in a unit test (it starts
// the worker), so this pins where the worker uses them, the way operator-play-now-wiring.test.ts does.
// The override arm's skip hold is pinned there, next to the rest of the selection.
const workerSource = readFileSync(path.join(process.cwd(), "apps/worker/src/index.ts"), "utf8");
const bridgeSource = readFileSync(path.join(process.cwd(), "apps/worker/src/twitch-engagement.ts"), "utf8");
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

describe("a Live Bridge takeover ends the insert", () => {
  const cycle = flat(functionBody("runPlayoutCycle"));

  it("decides on the live selection, before anything starts or switches", () => {
    const decide = cycle.indexOf("const insertAfterSelection = decideInsertAfterSelection({");
    expect(decide).toBeGreaterThan(cycle.indexOf("let selection: SelectionResult = choosePlaybackCandidate(state);"));
    expect(decide).toBeLessThan(cycle.indexOf("await startOrSwitchPlayout("));
    // No exception for a live selection any more: it used to leave the insert in place, and the insert on
    // air at the takeover started again from 0 after the release.
    expect(cycle).not.toContain('selection.reasonCode !== "operator_insert" && selection.queueKind !== "live"');
  });

  it("logs an insert on air that the takeover cut, and drops a pending one through recordDroppedInsert", () => {
    const clear = between(cycle, "if (insertAfterSelection.clear) {", "selection = choosePlaybackCandidate(state);");
    expect(clear).toContain(
      '} else if (selection.queueKind === "live") { // It aired, so it is not a drop; the takeover that cut it is worth a line all the same. logRuntimeEvent("playout.insert.ended", { assetId: state.playout.insertAssetId, reason: "live-bridge" }); }'
    );
    // The clear itself is M74's: only the insert this cycle read.
    expect(clear).toContain('insertStatus: "",');
  });

  it("empties the insert in the takeover cycle, so the cycle after the release has none to bring back", () => {
    // The live rows of decideInsertAfterSelection (playout-boundary.test.ts) say clear; this is the write
    // that makes the release a plain schedule cycle: the insert arm needs an insert id and a status.
    const clear = between(cycle, "if (insertAfterSelection.clear) {", "selection = choosePlaybackCandidate(state);");
    expect(clear).toContain('insertAssetId: "", insertRequestedAt: "", insertStatus: "",');
    expect(clear).toContain("state = await readAppState();");
    expect(cycle.indexOf("if (insertAfterSelection.clear) {")).toBeLessThan(cycle.indexOf("await startOrSwitchPlayout("));
  });
});

describe("viewers never override the operator", () => {
  it("hands the IRC handler the hold and answers a paused vote once", () => {
    const handler = flat(between(workerSource, "onChatMessage(message) {", "onChatGameCommand:"));
    expect(handler).toContain("config: latestChatInteractionConfig, operatorHold: latestOperatorHold });");
    expect(handler).toContain(
      'if (effect.kind === "skip-paused" && effect.announce) { twitchChatBridge.say(formatChatSkipPausedReply(effect.hold)); }'
    );
  });

  it("refreshes the hold every cycle, ends a running campaign under it, before the effects are applied", () => {
    const reconcile = flat(functionBody("reconcileChatInteraction"));
    const hold = reconcile.indexOf("latestOperatorHold = resolveOperatorOverrideHold({");
    expect(hold).toBeGreaterThan(reconcile.indexOf("const state = await readAppState();"));
    expect(hold).toBeLessThan(reconcile.indexOf("await drainChatEffects(state, config);"));
    expect(reconcile).toContain("assets: state.assets, nowMs: Date.now() }); if (latestOperatorHold !== \"\") { chatControl.clearSkipVote(); }");
  });

  it("judges a vote that passed up to a cycle earlier on the row as it is now", () => {
    const drain = flat(functionBody("drainChatEffects"));
    const skip = between(drain, 'if (effect.kind === "skip-passed") {', 'if (effect.kind !== "request") {');
    // decidePassedSkipVote (operator-precedence.test.ts): paused under a hold, stale for an item that left
    // the air or that a Skip already holds out, applied otherwise.
    expect(skip).toContain(
      "await updatePlayoutRuntime((playout, current) => { onAirAtApply = playout.currentAssetId; decision = decidePassedSkipVote({ ...playout, votedAssetId: effect.assetId, assets: current.assets, nowMs: Date.now() });"
    );
    expect(skip).toContain('return decision.kind !== "apply" ? playout : {');
    // Applied, the operator's Skip write, as before.
    expect(skip).toContain('status: "recovering", restartRequestedAt: now, heartbeatAt: now, skipAssetId: effect.assetId,');
    const refused = between(skip, 'if (decision.kind === "paused") {', "continue; }");
    expect(refused).toContain('logRuntimeEvent("chat.skip.paused", { assetId: effect.assetId, hold: heldBy });');
    expect(refused).toContain('await appendAuditEvent( "chat.skip.refused",');
    expect(refused).toContain("if (chatControl.claimSkipPausedReply()) { twitchChatBridge.say(formatChatSkipPausedReply(heldBy)); }");
    // A stale vote writes nothing: the operator's skip hold and restart flag stay as the operator wrote them.
    const stale = between(skip, 'if (decision.kind === "stale") {', "continue; }");
    expect(stale).toContain('logRuntimeEvent("chat.skip.stale", { assetId: effect.assetId, currentAssetId: onAirAtApply });');
    expect(stale).not.toContain("updatePlayoutRuntime");
    // The applied skip is logged and audited only when it was applied.
    expect(skip.indexOf('logRuntimeEvent("chat.skip.applied"')).toBeGreaterThan(skip.indexOf('if (decision.kind === "stale") {'));
  });

  it("speaks through the bridge's own socket write", () => {
    expect(flat(bridgeSource)).toContain("say(message: string): void { this.sendChatMessage(message); }");
  });
});
