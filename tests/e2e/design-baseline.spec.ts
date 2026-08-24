import { expect, test, type Locator, type Page } from "@playwright/test";

// Visual baseline for the CSS consolidation.
//
// These run against the stream247-web:test image, which scripts/e2e-smoke.sh does NOT build — it
// uses whatever image already exists. A baseline captured from a stale image silently stops
// describing the source, and the next unrelated change shows up as a diff. Use the
// `test:design-baseline` npm scripts, which build first; CI builds the images before calling the
// smoke script.
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
  ".incident-list",
  // The scene preview renders a wall clock. The server paints the real time, hydration replaces it
  // with the frozen one, and the screenshot lands on whichever came first — which is why this
  // surface failed on one viewport and passed on the other in the same run. page.clock cannot reach
  // the server, so the region is masked instead.
  ".overlay-clock",
  // Build identity — app version and image tags. The version moves on every release, so a snapshot
  // asserting it would go red on release bumps rather than on design changes.
  //
  // This is not why CI and a developer machine disagreed, though it was blamed for it at the time:
  // local image builds had been silently broken for five days, so the harness kept comparing
  // against a five-day-old UI while CI built the real one. That is fixed in the build, not here.
  "[data-build-info]",
  // The shared status rail's values: what is on air, what is next, how the outputs are doing. Every
  // authenticated page carries it, and it is decided by the wall clock against the seeded schedule
  // — so it changes on its own when the day crosses a schedule boundary. It took out the live
  // control snapshots that way; the others survived only because a few changed words stay under the
  // pixel tolerance on a tall page, which is luck rather than a net. The labels above the values
  // are static and stay visible.
  ".admin-status-rail strong",
  ".admin-status-rail .subtle",
  ".status-rail strong"
];

/**
 * Waits until the shell stops changing height.
 *
 * CI failed these with mismatched image *heights*, and the reported height alternated between
 * attempts of a single run — 3636px, 3672px, 3636px. That is Playwright's stability loop, which
 * keeps screenshotting until two consecutive frames agree: the page was still moving while it was
 * being photographed. It reproduced only on CI because a developer machine reuses a stack that has
 * been idle for hours, while CI starts one seconds earlier and is still settling.
 *
 * Masking cannot fix this. A mask paints over pixels; it does not put reflowed content back where
 * it was, so a page that grows by one line still fails on everything below that line.
 */
async function waitForStableHeight(target: Locator) {
  const settleSamples = 3;
  const sampleIntervalMs = 250;
  const deadline = Date.now() + 15_000;

  let lastHeight = -1;
  let stableSamples = 0;

  while (Date.now() < deadline) {
    const box = await target.boundingBox();
    const height = box ? Math.round(box.height) : -1;

    stableSamples = height === lastHeight ? stableSamples + 1 : 0;
    lastHeight = height;

    if (stableSamples >= settleSamples) return;
    await target.page().waitForTimeout(sampleIntervalMs);
  }

  // Not fatal: the screenshot comparison below is the real assertion, and failing here would only
  // replace a precise diff with a vaguer timeout.
  console.warn(`Layout still moving after 15s; screenshotting anyway (last height ${lastHeight}px).`);
}

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
  // /live?tab=status and ?tab=control were excluded for a long time: driven by a live SSE feed and
  // built to display constantly-changing runtime state, their snapshots were flaky — an early run
  // passed 28/28 and a later, otherwise identical one failed on live-status-mobile with scattered
  // text differences. Field-level masks lost that race, and a net that goes red at random gets
  // ignored, which is worse than not having one.
  //
  // They are covered now because the runtime is pinned rather than masked: dev-stack.sh seeds a
  // fixed playout runtime with fixed instants, and the worker that would rewrite it is stopped, so
  // the SSE feed has nothing to push. These are the pages an operator opens when something is
  // wrong, which makes them the last ones that should have gone unwatched.
  { name: "live-status", path: "/live?tab=status", authenticated: true, masked: true },
  { name: "live-control", path: "/live?tab=control", authenticated: true, masked: true },
  { name: "live-moderation", path: "/live?tab=moderation", authenticated: true, masked: true },
  // Pinning the day was not enough, and neither was masking the clock: both of these rotted again
  // two days after their baseline was taken, with no code change in between. What varies is server
  // state and server time, and page.clock reaches neither — so the volatile regions are masked and
  // the snapshot covers layout rather than content. A net that goes red on a calendar rather than
  // on a regression is one people learn to ignore.
  { name: "program-schedule", path: "/program?tab=schedule&day=1", authenticated: true, masked: true },
  { name: "program-pools", path: "/program?tab=pools", authenticated: true, masked: true },
  { name: "program-library", path: "/program?tab=library", authenticated: true, masked: true },
  { name: "program-sources", path: "/program?tab=sources", authenticated: true, masked: true },
  { name: "studio-scene", path: "/studio?tab=scene", authenticated: true, masked: true },
  { name: "studio-engagement", path: "/studio?tab=engagement", authenticated: true, masked: true },
  { name: "studio-output", path: "/studio?tab=output", authenticated: true, masked: true },
  { name: "admin-settings", path: "/admin?tab=settings", authenticated: true, masked: true },
  { name: "admin-team", path: "/admin?tab=team", authenticated: true, masked: true }
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
        await waitForStableHeight(target);

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
