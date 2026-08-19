import { expect, test, type Locator, type Page } from "@playwright/test";

// Visual baseline for the CSS consolidation.
//
// The e2e stack is deterministic in its *data*: scripts/e2e-smoke.sh tears the volumes down and
// uses a fresh temp directory per run, so Postgres starts empty and nothing is seeded. What is not
// deterministic is *time* and *runtime state* — heartbeats, readiness, and anything derived from
// "now" differ on every run, and the Live surface exists precisely to display those.
//
// So the clock is frozen for anything rendered in the browser, and the regions that reflect
// server-side runtime state are masked. Masking is deliberately narrow: a masked region cannot
// catch a regression, so only genuinely unstable areas are covered.

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

// A fixed instant inside a weekday afternoon, so schedule surfaces resolve the same way every run.
const FROZEN_NOW = new Date("2026-04-08T14:30:00.000Z");

/** Selectors whose content is server-rendered runtime state and therefore varies per run. */
const RUNTIME_STATE_SELECTORS = [
  "[data-runtime-timestamp]",
  ".status-chip",
  ".readiness-timestamps",
  ".incident-list"
];

async function freezeClock(page: Page) {
  // Covers client-rendered clocks (the overlay preview ticks every second) and anything computed
  // from Date.now() after hydration.
  await page.clock.setFixedTime(FROZEN_NOW);
}

async function signIn(page: Page) {
  await page.goto("/setup");

  const setupButton = page.getByRole("button", { name: "Create owner account" });
  if (await setupButton.isVisible().catch(() => false)) {
    await page.getByLabel("Owner email").fill(ownerEmail);
    await page.getByLabel("Password").fill(ownerPassword);
    await setupButton.click();
    await expect(page).toHaveURL(/\/live(?:\?tab=status)?$/);
    return;
  }

  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
}

function runtimeMasks(page: Page): Locator[] {
  return RUNTIME_STATE_SELECTORS.map((selector) => page.locator(selector));
}

type Surface = {
  name: string;
  path: string;
  /** Whether this surface needs an authenticated session. */
  authenticated: boolean;
  /** Set when the surface shows live runtime state that cannot be frozen from the browser. */
  masked?: boolean;
};

const SURFACES: Surface[] = [
  { name: "login", path: "/login", authenticated: false },
  { name: "channel", path: "/channel", authenticated: false },
  { name: "live-status", path: "/live?tab=status", authenticated: true, masked: true },
  { name: "live-control", path: "/live?tab=control", authenticated: true, masked: true },
  { name: "live-moderation", path: "/live?tab=moderation", authenticated: true },
  { name: "program-schedule", path: "/program?tab=schedule", authenticated: true },
  { name: "program-pools", path: "/program?tab=pools", authenticated: true },
  { name: "program-library", path: "/program?tab=library", authenticated: true },
  { name: "program-sources", path: "/program?tab=sources", authenticated: true },
  { name: "studio-scene", path: "/studio?tab=scene", authenticated: true },
  { name: "studio-engagement", path: "/studio?tab=engagement", authenticated: true },
  { name: "studio-output", path: "/studio?tab=output", authenticated: true },
  { name: "admin-settings", path: "/admin?tab=settings", authenticated: true },
  { name: "admin-team", path: "/admin?tab=team", authenticated: true }
];

const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 1600 },
  // The width an operator actually has when something breaks and they are not at a desk.
  { label: "mobile", width: 390, height: 1400 }
];

test.describe("design baseline", () => {
  for (const viewport of VIEWPORTS) {
    for (const surface of SURFACES) {
      test(`${surface.name} @ ${viewport.label}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await freezeClock(page);

        if (surface.authenticated) {
          await signIn(page);
        }

        await page.goto(surface.path);
        // The workspace shell, not the raw body: excludes the toast stack, which is transient.
        const target = page.locator("main, .content-stack").first();
        await expect(target).toBeVisible();

        // Web fonts settle after first paint; without this the first run and the rest disagree.
        await page.evaluate(() => document.fonts.ready);

        await expect(target).toHaveScreenshot(`${surface.name}-${viewport.label}.png`, {
          animations: "disabled",
          caret: "hide",
          mask: surface.masked ? runtimeMasks(page) : undefined,
          // Absorbs sub-pixel text rendering differences without hiding a real layout change.
          maxDiffPixelRatio: 0.01
        });
      });
    }
  }
});
