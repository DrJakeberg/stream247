import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const overlaySettingsFormSource = readFileSync(
  path.join(process.cwd(), "apps/web/components/overlay-settings-form.tsx"),
  "utf8"
);
const engagementSettingsFormSource = readFileSync(
  path.join(process.cwd(), "apps/web/components/engagement-settings-form.tsx"),
  "utf8"
);
const destinationOutputProfileFormSource = readFileSync(
  path.join(process.cwd(), "apps/web/components/destination-output-profile-form.tsx"),
  "utf8"
);

describe("studio workspace", () => {
  it("reviews scene publishes before they go live and exposes the safe-area override control", () => {
    expect(overlaySettingsFormSource).toContain("Review changes");
    expect(overlaySettingsFormSource).toContain("Allow outside safe area");
    expect(overlaySettingsFormSource).toContain("Publish review");
  });

  it("ships the chatter-participation game controls in the Studio engagement form", () => {
    expect(engagementSettingsFormSource).toContain("Chatter-participation game");
    expect(engagementSettingsFormSource).toContain("Enable chatter-participation game");
    expect(engagementSettingsFormSource).toContain("Solo mode");
    expect(engagementSettingsFormSource).toContain("Small-group mode");
    expect(engagementSettingsFormSource).toContain("Crowd mode");
  });

  it("shows destination health with StatusChip in the output surface", () => {
    expect(destinationOutputProfileFormSource).toContain('import { StatusChip }');
    expect(destinationOutputProfileFormSource).toContain("<StatusChip");
  });
});
