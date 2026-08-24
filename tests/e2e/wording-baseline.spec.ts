import { expect, test, type Page } from "@playwright/test";

// What each surface says, as reviewable text.
//
// The visual baseline cannot see wording. It tolerates a fraction of the page to absorb sub-pixel
// text rendering, and these surfaces are several thousand pixels tall, so relabelling a handful of
// lines stays under the threshold — three separate wording changes passed through it untouched
// while this was being written, and a regression would have passed just as quietly.
//
// So the words get their own baseline. It is plain text rather than pixels, which means a change
// shows up in review as the sentence that changed rather than as a count of differing pixels, and
// it cannot go quietly red on antialiasing.
//
//   scripts/design-baseline.sh            verify
//   scripts/design-baseline.sh --update   re-record
//
// Anything genuinely per-run is replaced before comparing, not masked: a placeholder in the text is
// visible in review, whereas a masked region silently covers whatever grows underneath it.

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

type Surface = {
  name: string;
  path: string;
  authenticated?: boolean;
};

const SURFACES: Surface[] = [
  { name: "channel", path: "/channel", authenticated: false },
  { name: "login", path: "/login", authenticated: false },
  { name: "live-control", path: "/live?tab=control" },
  { name: "live-status", path: "/live?tab=status" },
  { name: "live-moderation", path: "/live?tab=moderation" },
  { name: "program-pools", path: "/program?tab=pools" },
  { name: "program-library", path: "/program?tab=library" },
  { name: "program-sources", path: "/program?tab=sources" },
  { name: "studio-scene", path: "/studio?tab=scene" },
  { name: "studio-engagement", path: "/studio?tab=engagement" },
  { name: "studio-output", path: "/studio?tab=output" },
  { name: "admin-settings", path: "/admin?tab=settings" },
  { name: "admin-team", path: "/admin?tab=team" }
];

/** Replacements for the parts that legitimately differ every run. */
const VOLATILE: Array<[RegExp, string]> = [
  [/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<timestamp>"],
  [/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "<time>"],
  [/\bv?\d+\.\d+\.\d+\b/g, "<version>"],
  [/\bsha256:[0-9a-f]+/g, "<digest>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<id>"]
];

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
}

function normalize(text: string): string {
  let normalized = text;
  for (const [pattern, replacement] of VOLATILE) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

test.describe("wording baseline", () => {
  for (const surface of SURFACES) {
    test(`${surface.name} says what it said`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: 1440, height: 1600 });

      if (surface.authenticated !== false) {
        await signIn(page);
      }

      await page.goto(surface.path);
      const shell = page.locator("main, .content-stack").first();
      await expect(shell).toBeVisible();

      // Collapsed groups are part of what a page says, so their summaries are included and their
      // contents are not — the same thing a reader sees.
      const text = await shell.innerText();

      expect(normalize(text)).toMatchSnapshot(`${surface.name}.txt`);
    });
  }
});
