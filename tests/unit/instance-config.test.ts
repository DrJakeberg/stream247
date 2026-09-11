import { describe, expect, it } from "vitest";
import {
  isUsableTimeZone,
  resolveAppBaseUrl,
  resolveChannelTimeZone
} from "../../packages/db/src/instance-config.js";

describe("resolveAppBaseUrl", () => {
  it("lets the environment override the wizard-written value", () => {
    // The M52 rollback contract: an install that keeps APP_URL in env must behave exactly as
    // before, no matter what the wizard has stored.
    expect(
      resolveAppBaseUrl({ appUrl: "https://wizard.example" }, { APP_URL: "https://env.example" })
    ).toBe("https://env.example");
  });

  it("uses the managed value when the environment is silent", () => {
    expect(resolveAppBaseUrl({ appUrl: "https://wizard.example" }, {})).toBe("https://wizard.example");
    expect(resolveAppBaseUrl({ appUrl: "https://wizard.example" }, { APP_URL: "   " })).toBe(
      "https://wizard.example"
    );
  });

  it("strips trailing slashes so callers can append paths", () => {
    expect(resolveAppBaseUrl({ appUrl: "https://wizard.example/" }, {})).toBe("https://wizard.example");
    expect(resolveAppBaseUrl({ appUrl: "" }, { APP_URL: "https://env.example//" })).toBe("https://env.example");
  });

  it("returns empty when neither source is configured, so callers can tell", () => {
    // Callers that need a URL anyway (dev convenience) add their own localhost default; the
    // onboarding checklist needs to see the difference between configured and defaulted.
    expect(resolveAppBaseUrl({ appUrl: "" }, {})).toBe("");
    expect(resolveAppBaseUrl(undefined, {})).toBe("");
  });
});

describe("resolveChannelTimeZone", () => {
  it("prefers env, then the managed value, then UTC", () => {
    expect(
      resolveChannelTimeZone({ channelTimezone: "Europe/Berlin" }, { CHANNEL_TIMEZONE: "America/Chicago" })
    ).toBe("America/Chicago");
    expect(resolveChannelTimeZone({ channelTimezone: "Europe/Berlin" }, {})).toBe("Europe/Berlin");
    expect(resolveChannelTimeZone({ channelTimezone: "" }, {})).toBe("UTC");
    expect(resolveChannelTimeZone(undefined, {})).toBe("UTC");
  });
});

describe("isUsableTimeZone", () => {
  it("accepts IANA names and rejects gibberish", () => {
    expect(isUsableTimeZone("Europe/Berlin")).toBe(true);
    expect(isUsableTimeZone("UTC")).toBe(true);
    expect(isUsableTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isUsableTimeZone("")).toBe(false);
  });
});
