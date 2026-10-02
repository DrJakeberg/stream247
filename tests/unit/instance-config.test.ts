import { describe, expect, it } from "vitest";
import {
  findChannelTimeZoneProblem,
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

  it("skips an env value Intl rejects instead of handing it to every schedule read (M85)", () => {
    // The typo the research reproduced: it used to throw RangeError in every schedule read.
    expect(resolveChannelTimeZone({}, { CHANNEL_TIMEZONE: "Europe/Berln" })).toBe("UTC");
    expect(resolveChannelTimeZone({ channelTimezone: "Europe/Berlin" }, { CHANNEL_TIMEZONE: "Europe/Berln" })).toBe(
      "Europe/Berlin"
    );
    expect(resolveChannelTimeZone({ channelTimezone: "Mars/Olympus_Mons" }, {})).toBe("UTC");
    expect(() =>
      new Intl.DateTimeFormat("en-US", { timeZone: resolveChannelTimeZone({}, { CHANNEL_TIMEZONE: "Europe/Berln" }) })
    ).not.toThrow();
  });
});

describe("findChannelTimeZoneProblem", () => {
  it("names the skipped value and the zone the channel runs on instead", () => {
    expect(findChannelTimeZoneProblem({}, { CHANNEL_TIMEZONE: "Europe/Berln" })).toBe(
      'CHANNEL_TIMEZONE="Europe/Berln" in the environment is not a valid timezone, so the schedule runs on UTC. Use an IANA zone name such as Europe/Berlin.'
    );
    expect(findChannelTimeZoneProblem({ channelTimezone: "Europe/Berlin" }, { CHANNEL_TIMEZONE: "Europe/Berln" })).toContain(
      "so the schedule runs on Europe/Berlin."
    );
    expect(findChannelTimeZoneProblem({ channelTimezone: "Mars/Olympus_Mons" }, { CHANNEL_TIMEZONE: "Europe/Berln" })).toContain(
      'CHANNEL_TIMEZONE="Europe/Berln" in the environment and the saved channel timezone "Mars/Olympus_Mons" are not valid timezones'
    );
  });

  it("is silent when every configured value is usable, or a usable env value overrides a bad saved one", () => {
    expect(findChannelTimeZoneProblem({ channelTimezone: "Europe/Berlin" }, { CHANNEL_TIMEZONE: "America/Chicago" })).toBeNull();
    expect(findChannelTimeZoneProblem({}, {})).toBeNull();
    expect(findChannelTimeZoneProblem(undefined, { CHANNEL_TIMEZONE: "  " })).toBeNull();
    expect(findChannelTimeZoneProblem({ channelTimezone: "Mars/Olympus_Mons" }, { CHANNEL_TIMEZONE: "Europe/Berlin" })).toBeNull();
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
