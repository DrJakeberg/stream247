import { expect, test, type Page } from "@playwright/test";

/**
 * Layout asserted by measurement on every workspace (M65), after the studio showed what a pixel
 * baseline cannot say: it froze a broken layout as the expected picture and did not see 16px
 * controls appear. These numbers are the layout rules in docs/ui.md, checked where they can fail.
 */

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

const SURFACES = [
  "/live?tab=status",
  "/live?tab=control",
  "/live?tab=moderation",
  "/program?tab=schedule&day=1",
  "/program?tab=pools",
  "/program?tab=library",
  "/program?tab=sources",
  "/studio?tab=scene",
  "/studio?tab=engagement",
  "/studio?tab=output",
  "/admin?tab=settings",
  "/admin?tab=team"
];

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const stack = document.querySelector(".content-stack");
    const rail = document.querySelector(".admin-status-rail");
    const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
    return {
      clientWidth: doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      stackWidth: rect(stack)?.width ?? 0,
      stackRight: rect(stack)?.right ?? 0,
      railWidth: rect(rail)?.width ?? 0
    };
  });
}

test.describe("workspace layout", () => {
  test("no operator surface scrolls horizontally, at the baseline width and on a wide display", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page);
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const path of SURFACES) {
        await page.goto(path);
        await expect(page.locator(".content-stack")).toBeVisible();
        const m = await measure(page);
        // docs/ui.md: no operator surface should require horizontal page scrolling.
        expect(m.scrollWidth, `${path} @ ${width}: page wider than the viewport`).toBeLessThanOrEqual(m.clientWidth);
        // The content column ends inside the viewport and never grows past the widest cap.
        expect(m.stackRight, `${path} @ ${width}: content column past the viewport`).toBeLessThanOrEqual(m.clientWidth);
        expect(m.stackWidth, `${path} @ ${width}: content column over the cap`).toBeLessThanOrEqual(1800);
        // The status rail wraps inside the column instead of stretching it (the M59 regression).
        expect(m.railWidth, `${path} @ ${width}: status rail wider than its column`).toBeLessThanOrEqual(m.stackWidth + 1);
      }
    }
  });

  test("the workspace cap holds on a very wide display and the studio is the one surface that widens", async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1200 });
    await signIn(page);
    await page.goto("/admin?tab=settings");
    const admin = await measure(page);
    expect(admin.stackWidth).toBeLessThanOrEqual(1440);
    await page.goto("/studio?tab=scene");
    const studio = await measure(page);
    expect(studio.stackWidth).toBeGreaterThan(1440);
    expect(studio.stackWidth).toBeLessThanOrEqual(1800);
    expect(studio.scrollWidth).toBeLessThanOrEqual(studio.clientWidth);
  });
});
