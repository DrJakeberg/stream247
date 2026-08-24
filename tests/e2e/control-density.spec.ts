import { expect, test, type Page } from "@playwright/test";

// How many things a page asks you to choose between.
//
// "Simple and intuitive" is easy to agree with and easy to argue about, so this measures it instead:
// the number of controls actually visible on a surface, and whether one of them reads as the primary
// action. Counting is not the goal — a page can be dense and clear — but a page an operator opens
// during an incident should not present twenty equal-weight choices, and without a number that
// judgement stays a matter of taste.
//
// The budgets below are recorded from the current pages, not invented. They are a ratchet: they may
// be lowered as surfaces are simplified, and raising one should be a deliberate decision with a
// reason, not something that happens by accident.

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

type Surface = {
  name: string;
  path: string;
  /** Ceiling for visible controls, taken from the page as it stands today. */
  maxControls: number;
};

const SURFACES: Surface[] = [
  // The page an operator opens when something is wrong. It showed 33 at once, six of them repair
  // actions of equal weight, with the order to try them explained in a paragraph above the form.
  { name: "live-control", path: "/live?tab=control", maxControls: 27 },
  // Highest of the admin surfaces, and not yet looked at: most of it is one destination editor
  // repeated per destination, so the count grows with the number of outputs configured.
  { name: "live-status", path: "/live?tab=status", maxControls: 62 },
  { name: "program-schedule", path: "/program?tab=schedule&day=1", maxControls: 14 },
  { name: "studio-scene", path: "/studio?tab=scene", maxControls: 79 },
  { name: "admin-settings", path: "/admin?tab=settings", maxControls: 29 }
];

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
}

test.describe("control density", () => {
  for (const surface of SURFACES) {
    test(`${surface.name} keeps its controls countable`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: 1440, height: 1600 });
      await signIn(page);
      await page.goto(surface.path);

      const shell = page.locator("main, .content-stack").first();
      await expect(shell).toBeVisible();

      const measured = await shell.evaluate((root) => {
        const selector = "button, a[href], input, select, textarea, [role=button], [role=tab]";
        // checkVisibility, not bounding boxes. A control inside a closed <details> keeps its last
        // measured size — Chromium hides that content with content-visibility rather than by taking
        // it out of layout — so measuring rects reports collapsed groups as still on screen, which
        // is exactly the thing this test exists to detect.
        const visible = [...root.querySelectorAll<HTMLElement>(selector)].filter((element) =>
          element.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true, opacityProperty: true })
        );

        return {
          total: visible.length,
          labels: visible.map((element) => (element.textContent || element.getAttribute("aria-label") || "").trim())
        };
      });

      // Reported on every run: the number is the point, and a silently passing budget teaches nothing.
      console.log(`${surface.name}: ${measured.total} controls`);
      console.log(`  ${measured.labels.filter(Boolean).join(" | ")}`);

      expect(measured.total).toBeLessThanOrEqual(surface.maxControls);
    });
  }
});
