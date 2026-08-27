import { describe, expect, it } from "vitest";
import {
  buildRelayRollbackEnvLines,
  deriveRelayProgramRollbackUrl,
  describeSourceLiveState,
  RELAY_PROGRAM_ROLLBACK_BASE_URL
} from "@stream247/core";

// M57 stage 2, Etappe E.
//
// Two pure pieces the operator surfaces are built on: the credentialed rollback URL (the thing a
// notfall rollback needs and that no surface could produce since the relay started checking
// credentials), and the plain-English projection of the worker's attach decision.

describe("the programme rollback address", () => {
  it("carries the internal key as the credential the relay checks", () => {
    expect(deriveRelayProgramRollbackUrl("the-key")).toBe(`${RELAY_PROGRAM_ROLLBACK_BASE_URL}?user=internal&pass=the-key`);
  });

  it("escapes a key whose characters would otherwise end the query", () => {
    // base64url never produces these, but the URL is pasted into a shell environment file and a
    // key that silently truncated there would fail as "wrong password" with no hint why.
    expect(deriveRelayProgramRollbackUrl("a&b=c d")).toContain("pass=a%26b%3Dc%20d");
  });

  it("produces nothing at all without a key", () => {
    // Fail closed: a URL with an empty password would authenticate against nothing and read to an
    // operator as a working rollback line.
    expect(deriveRelayProgramRollbackUrl("")).toBe("");
    expect(buildRelayRollbackEnvLines("")).toEqual([]);
  });

  it("hands back both environment lines, each carrying the key", () => {
    const lines = buildRelayRollbackEnvLines("the-key");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`STREAM247_RELAY_OUTPUT_URL=${RELAY_PROGRAM_ROLLBACK_BASE_URL}?user=internal&pass=the-key`);
    expect(lines[1]).toBe(`STREAM247_RELAY_INPUT_URL=${RELAY_PROGRAM_ROLLBACK_BASE_URL}?user=internal&pass=the-key`);
  });
});

describe("what the live attach state says to an operator", () => {
  const nowMs = Date.parse("2026-08-27T10:00:00.000Z");

  it("says nothing when nothing has been observed yet", () => {
    expect(describeSourceLiveState({ state: "", nowMs })).toBe("");
    expect(describeSourceLiveState({ state: "something-else", nowMs })).toBe("");
  });

  it("names the live case and the condition its sound depends on", () => {
    const text = describeSourceLiveState({ state: "publishing", nowMs });
    expect(text).toContain("Live in the programme");
    expect(text.toLowerCase()).toContain("sound");
    expect(text.toLowerCase()).toContain("length");
  });

  it("separates waiting for the camera from having no live picture at all", () => {
    expect(describeSourceLiveState({ state: "not-publishing", nowMs })).toBe("Waiting for the camera.");
    expect(describeSourceLiveState({ state: "switched-off", nowMs })).toBe("Still picture only.");
    expect(describeSourceLiveState({ state: "no-source-layer", nowMs })).toBe("Still picture only.");
    expect(describeSourceLiveState({ state: "presence-unknown", nowMs })).toBe(
      "Still picture only. The camera could not be checked just now."
    );
  });

  it("separates an intention that never landed from one that was never made", () => {
    // Both mean "not on air", and saying so is the whole point: an attach that was decided but
    // never became an input used to leave the studio claiming the camera was live.
    expect(describeSourceLiveState({ state: "attach-unavailable", nowMs })).toBe(
      "Still picture only. The live connection could not be prepared."
    );
    expect(describeSourceLiveState({ state: "not-asset-playout", nowMs })).toBe(
      "Still picture only. A camera joins only while a recorded item is playing."
    );
  });

  it("counts the cooldown down in whole minutes", () => {
    expect(
      describeSourceLiveState({ state: "breaker-cooldown", retryAt: "2026-08-27T10:02:30.000Z", nowMs })
    ).toBe("Paused after a failed attempt. Trying again in about 3 minutes.");
    expect(
      describeSourceLiveState({ state: "breaker-cooldown", retryAt: "2026-08-27T10:00:40.000Z", nowMs })
    ).toBe("Paused after a failed attempt. Trying again in about a minute.");
  });

  it("drops the countdown once it has run out rather than promising a negative wait", () => {
    expect(describeSourceLiveState({ state: "breaker-cooldown", retryAt: "2026-08-27T09:58:00.000Z", nowMs })).toBe(
      "Paused after a failed attempt. The next attempt is due."
    );
    expect(describeSourceLiveState({ state: "breaker-cooldown", nowMs })).toBe(
      "Paused after a failed attempt. The next attempt is due."
    );
  });

  it("never leaks the vocabulary the worker logs", () => {
    // The stored value is a decision reason, not a sentence. Every projection must be English.
    for (const state of [
      "publishing",
      "not-publishing",
      "breaker-cooldown",
      "switched-off",
      "no-source-layer",
      "presence-unknown",
      "attach-unavailable",
      "not-asset-playout"
    ]) {
      expect(describeSourceLiveState({ state, nowMs })).not.toContain(state);
    }
  });
});
