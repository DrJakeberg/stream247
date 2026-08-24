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
  /**
   * How many primary actions this page is expected to carry.
   *
   * One almost everywhere. Zero for surfaces that only show you something — inventing a primary
   * button for a page with nothing to be primary about would satisfy the rule and make the page
   * worse. More than one only where a page holds genuinely separate panels, each owning its own
   * save; that is two tasks, not two competing answers to one. Every value above one needs the
   * reason written next to it.
   */
  primaryActions: number;
  /** Public surfaces are measured without signing in, because that is how they are seen. */
  authenticated?: boolean;
};

const SURFACES: Surface[] = [
  // The page the audience actually lands on, and the only one here that is not an operator tool.
  { name: "channel", path: "/channel", maxControls: 1, primaryActions: 1, authenticated: false },
  // The page an operator opens when something is wrong. It showed 33 at once, six of them repair
  // actions of equal weight, with the order to try them explained in a paragraph above the form.
  { name: "live-control", path: "/live?tab=control", maxControls: 27, primaryActions: 1 },
  // Was 62, because the full editor stood open under every destination and the count therefore grew
  // with the number of outputs configured. Folding those away leaves what the page is for.
  { name: "live-status", path: "/live?tab=status", maxControls: 28, primaryActions: 1 },
  { name: "program-schedule", path: "/program?tab=schedule&day=1", maxControls: 14, primaryActions: 0 },
  // The overlay editor, where editing is the point — so this one is folded rather than trimmed. Was
  // 79; twenty-four of those were three buttons on each of eight layers, held open permanently.
  { name: "studio-scene", path: "/studio?tab=scene", maxControls: 55, primaryActions: 1 },
  { name: "admin-settings", path: "/admin?tab=settings", maxControls: 29, primaryActions: 1 },
  { name: "login", path: "/login", maxControls: 3, primaryActions: 1, authenticated: false },
  { name: "live-moderation", path: "/live?tab=moderation", maxControls: 20, primaryActions: 1 },
  { name: "program-pools", path: "/program?tab=pools", maxControls: 17, primaryActions: 1 },
  { name: "program-library", path: "/program?tab=library", maxControls: 31, primaryActions: 1 },
  { name: "program-sources", path: "/program?tab=sources", maxControls: 30, primaryActions: 1 },
  // Two panels that save separately: chat and alerts, and what chat is allowed to steer.
  { name: "studio-engagement", path: "/studio?tab=engagement", maxControls: 40, primaryActions: 2 },
  { name: "studio-output", path: "/studio?tab=output", maxControls: 20, primaryActions: 1 },
  { name: "admin-team", path: "/admin?tab=team", maxControls: 11, primaryActions: 1 }
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
      if (surface.authenticated !== false) {
        await signIn(page);
      }
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

        // The primary style is the plain .button class; everything else carries a modifier. If a
        // page has none, nothing tells you where to start; if it has several, none of them lead.
        const primaries = visible.filter(
          (element) => element.classList.contains("button") && element.className.trim() === "button"
        );

        return {
          total: visible.length,
          primaries: primaries.map((element) => (element.textContent || "").trim()),
          labels: visible.map((element) => (element.textContent || element.getAttribute("aria-label") || "").trim())
        };
      });

      // Reported on every run: the number is the point, and a silently passing budget teaches nothing.
      console.log(`${surface.name}: ${measured.total} controls, primary: [${measured.primaries.join(", ")}]`);
      console.log(`  ${measured.labels.filter(Boolean).join(" | ")}`);

      expect(measured.total).toBeLessThanOrEqual(surface.maxControls);

      // Two primary buttons is not twice as clear. The settings page carried "Save encrypted
      // settings" and "Export channel blueprint" side by side and neither led; the pools page had
      // one "Update pool" per pool, so the count grew with the content.
      expect(measured.primaries).toHaveLength(surface.primaryActions);
    });
  }
});
