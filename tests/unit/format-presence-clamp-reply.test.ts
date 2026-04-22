import { createDefaultModerationConfig, formatPresenceClampReply } from "@stream247/core";
import { describe, expect, it } from "vitest";

const config = createDefaultModerationConfig();

describe("formatPresenceClampReply", () => {
  it("confirms accepted values without clamp language", () => {
    expect(
      formatPresenceClampReply({
        commandInput: "!here 30",
        requestedMinutes: 30,
        appliedMinutes: 30,
        clampReason: "accepted",
        config
      })
    ).toBe("presence window set to 30 min");
  });

  it("explains default fallback when no explicit duration is supplied", () => {
    expect(
      formatPresenceClampReply({
        commandInput: "!here",
        requestedMinutes: null,
        appliedMinutes: 30,
        clampReason: "default",
        config
      })
    ).toBe("received !here, default is 30; window set to 30 min");
  });

  it("explains minimum clamps explicitly", () => {
    expect(
      formatPresenceClampReply({
        commandInput: "!here 5",
        requestedMinutes: 5,
        appliedMinutes: 10,
        clampReason: "minimum",
        config: {
          ...config,
          minMinutes: 10
        }
      })
    ).toBe("received !here 5, minimum is 10; window set to 10 min");
  });

  it("explains maximum clamps explicitly", () => {
    expect(
      formatPresenceClampReply({
        commandInput: "!here 9999",
        requestedMinutes: 9999,
        appliedMinutes: 60,
        clampReason: "maximum",
        config: {
          ...config,
          maxMinutes: 60
        }
      })
    ).toBe("received !here 9999, maximum is 60; window set to 60 min");
  });
});
