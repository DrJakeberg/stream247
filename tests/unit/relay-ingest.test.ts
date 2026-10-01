import { describe, expect, it } from "vitest";
import {
  constantTimeEqualStrings,
  deriveRelaySourceReadUrl,
  evaluateRelayAuth,
  parseRelaySourcePath,
  relaySourcePath,
  RELAY_PROGRAM_ROLLBACK_PATH,
  type RelayAuthRequest,
  type RelayIngestSourceCredential
} from "@stream247/core";

// M57 stage 2, Etappe A. The relay auth policy is a pure function so this matrix can pin it
// without a server: publish to a known push source needs that source's publish key, publish to
// the programme rollback path and every read needs the internal relay key, and everything else
// is denied. The endpoint only translates the decision into 200/403.

const sources: RelayIngestSourceCredential[] = [
  { id: "studio-cam", ingestKind: "push", publishKey: "push-key-aaaaaaaaaaaaaaaaaaaaaaaa" },
  { id: "pull-cam", ingestKind: "pull", publishKey: "" }
];

const INTERNAL_KEY = "internal-key-bbbbbbbbbbbbbbbbbbbbbb";

function request(overrides: Partial<RelayAuthRequest>): RelayAuthRequest {
  return {
    user: "",
    password: "",
    ip: "172.20.0.9",
    path: "",
    action: "publish",
    protocol: "rtmp",
    query: "",
    ...overrides
  };
}

function evaluate(overrides: Partial<RelayAuthRequest>, internalKey = INTERNAL_KEY) {
  return evaluateRelayAuth({ request: request(overrides), sources, internalKey });
}

describe("relay auth policy", () => {
  it("allows publishing to a known push source with its publish key", () => {
    const decision = evaluate({ path: "src-studio-cam", password: sources[0].publishKey });
    expect(decision.allow).toBe(true);
  });

  it("denies the full 403 matrix", () => {
    const denied: Array<Partial<RelayAuthRequest>> = [
      // Wrong or missing key on a known push source.
      { path: "src-studio-cam", password: "wrong-key" },
      { path: "src-studio-cam", password: "" },
      // The internal key does not publish onto a source path.
      { path: "src-studio-cam", password: INTERNAL_KEY },
      // A pull source has no publish key, and an empty presented key must never match it.
      { path: "src-pull-cam", password: "" },
      { path: "src-pull-cam", password: "anything" },
      // Unknown source ids and arbitrary paths.
      { path: "src-nobody", password: sources[0].publishKey },
      { path: "whatever", password: sources[0].publishKey },
      { path: "", password: sources[0].publishKey },
      // The rollback path only accepts the internal key.
      { path: RELAY_PROGRAM_ROLLBACK_PATH, password: sources[0].publishKey },
      { path: RELAY_PROGRAM_ROLLBACK_PATH, password: "" },
      // Reads need the internal key on every path.
      { action: "read", path: "src-studio-cam", password: "wrong" },
      { action: "read", path: "src-studio-cam", password: sources[0].publishKey },
      { action: "read", path: "live/program", password: "" },
      // Anything that is not publish or read is denied outright.
      { action: "api", path: "src-studio-cam", password: INTERNAL_KEY },
      { action: "playback", path: "src-studio-cam", password: INTERNAL_KEY },
      { action: "", path: "src-studio-cam", password: INTERNAL_KEY }
    ];

    for (const overrides of denied) {
      const decision = evaluate(overrides);
      expect(decision.allow, JSON.stringify(overrides)).toBe(false);
    }
  });

  it("allows the internal key to publish the programme rollback path and to read anywhere", () => {
    expect(evaluate({ path: RELAY_PROGRAM_ROLLBACK_PATH, password: INTERNAL_KEY }).allow).toBe(true);
    expect(evaluate({ action: "read", path: "src-studio-cam", password: INTERNAL_KEY }).allow).toBe(true);
    expect(evaluate({ action: "read", path: "live/program", password: INTERNAL_KEY }).allow).toBe(true);
  });

  it("never lets an empty internal key authorise anything", () => {
    expect(evaluate({ action: "read", path: "src-studio-cam", password: "" }, "").allow).toBe(false);
    expect(evaluate({ path: RELAY_PROGRAM_ROLLBACK_PATH, password: "" }, "").allow).toBe(false);
  });
});

describe("constant-time comparison", () => {
  it("compares correctly", () => {
    expect(constantTimeEqualStrings("abc", "abc")).toBe(true);
    expect(constantTimeEqualStrings("abc", "abd")).toBe(false);
    expect(constantTimeEqualStrings("abc", "ab")).toBe(false);
    expect(constantTimeEqualStrings("", "")).toBe(true);
    expect(constantTimeEqualStrings("", "a")).toBe(false);
  });

  it("structurally reads every character regardless of where the mismatch sits", () => {
    // The constant-time property, pinned structurally: instrumented inputs count charCodeAt
    // calls, and an early-exit implementation would read fewer characters when the first
    // character already differs.
    const instrument = (value: string, counter: { reads: number }) =>
      ({
        length: value.length,
        charCodeAt(index: number) {
          counter.reads += 1;
          return value.charCodeAt(index);
        }
      }) as unknown as string;

    const firstDiffers = { reads: 0 };
    constantTimeEqualStrings(instrument("Xbcdefgh", firstDiffers), instrument("abcdefgh", firstDiffers));
    const lastDiffers = { reads: 0 };
    constantTimeEqualStrings(instrument("abcdefgX", lastDiffers), instrument("abcdefgh", lastDiffers));
    const equal = { reads: 0 };
    constantTimeEqualStrings(instrument("abcdefgh", equal), instrument("abcdefgh", equal));

    expect(firstDiffers.reads).toBeGreaterThan(0);
    expect(firstDiffers.reads).toBe(lastDiffers.reads);
    expect(firstDiffers.reads).toBe(equal.reads);
  });
});

describe("relay source paths and the derived read URL", () => {
  it("derives the internal read URL instead of ever storing it", () => {
    expect(deriveRelaySourceReadUrl("studio-cam", "the-key")).toBe("rtsp://reader:the-key@relay:8554/src-studio-cam");
  });

  it("round-trips a source id through the relay path", () => {
    expect(relaySourcePath("studio-cam")).toBe("src-studio-cam");
    expect(parseRelaySourcePath("src-studio-cam")).toBe("studio-cam");
  });

  it("rejects paths that are not exactly one source path", () => {
    expect(parseRelaySourcePath("src-")).toBeNull();
    expect(parseRelaySourcePath("live/program")).toBeNull();
    expect(parseRelaySourcePath("src-a/b")).toBeNull();
    expect(parseRelaySourcePath("prefix-src-a")).toBeNull();
    expect(parseRelaySourcePath("")).toBeNull();
  });
});
