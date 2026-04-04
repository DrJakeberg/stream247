import { describe, expect, it } from "vitest";
import { detectUpdateChannel } from "../../apps/web/lib/server/update-center";

describe("update center helpers", () => {
  it("detects stable pinned semver tags", () => {
    expect(detectUpdateChannel(["v1.0.3", "v1.0.3", "v1.0.3"])).toBe("stable");
  });

  it("detects evaluation tags", () => {
    expect(detectUpdateChannel(["latest", "latest", "main-abc123"])).toBe("evaluation");
  });

  it("detects mixed production states", () => {
    expect(detectUpdateChannel(["v1.0.3", "latest", "v1.0.3"])).toBe("mixed");
  });

  it("falls back to custom when tags are non-standard", () => {
    expect(detectUpdateChannel(["internal", "", "nightly"])).toBe("custom");
  });
});
