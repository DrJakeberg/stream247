import { expect, test, type Page } from "@playwright/test";

/**
 * The scene studio's layout, measured rather than screenshotted.
 *
 * The pixel baseline had frozen a broken layout as the expected state: the preview column is a grid,
 * a grid's rows stretch by default, and the column was as tall as the form beside it — so the label
 * sat at the top, its select a screen lower, the picture somewhere in the middle and the drag help at
 * the very bottom. A screenshot cannot tell "spread over four thousand pixels" from "intended", and
 * the 1% pixel tolerance cannot see a 16px control appear. These assertions can.
 */

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
}

test.describe("scene studio layout", () => {
  test("keeps the preview column as tall as its content and pins it while the form scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signIn(page);
    await page.goto("/studio?tab=scene");
    await expect(page.getByRole("heading", { name: "Scene controls" })).toBeVisible();

    const column = page.locator(".scene-designer-preview");
    await expect(column).toHaveCSS("align-content", "start");
    await expect(column).toHaveCSS("position", "sticky");

    // The toolbar, the picture and the help text follow each other without a hole between them.
    const toolbar = await page.locator(".scene-preview-toolbar").boundingBox();
    const picture = await page.locator(".scene-preview-shell-render").boundingBox();
    const help = await page.locator(".scene-designer-preview > p.subtle").boundingBox();
    if (!toolbar || !picture || !help) {
      throw new Error("preview column parts did not render");
    }
    expect(picture.y - (toolbar.y + toolbar.height)).toBeLessThan(80);
    expect(help.y - (picture.y + picture.height)).toBeLessThan(80);

    // The column ends where its content ends; the form beside it runs on for pages.
    const columnBox = await column.boundingBox();
    const sidebarBox = await page.locator(".scene-designer-sidebar").boundingBox();
    if (!columnBox || !sidebarBox) {
      throw new Error("designer grid did not render");
    }
    expect(columnBox.height).toBeLessThan(sidebarBox.height / 2);

    // Scrolling the form keeps the picture on screen.
    await page.evaluate(() => window.scrollTo(0, 1500));
    const pinned = await page.locator(".scene-preview-shell-render").boundingBox();
    if (!pinned) {
      throw new Error("preview left the page while scrolling");
    }
    expect(pinned.y).toBeGreaterThan(0);
    expect(pinned.y).toBeLessThan(1000);
  });

  test("explains its title, panels and preview through (i) tips that open on keyboard focus", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Before signing in, while the login form is still there: the field labels resolve to exactly one
    // control each. A tip inside a label used to break this twice — a <button> took the label's
    // control, and a tooltip element's text made getByLabel("Password") match the e-mail field.
    await page.goto("/login");
    await expect(page.getByLabel("Owner email")).toHaveCount(1);
    await expect(page.getByLabel("Password")).toHaveCount(1);
    await signIn(page);
    await page.goto("/studio?tab=scene");
    await expect(page.getByRole("heading", { name: "Scene controls" })).toBeVisible();

    // At least the header, both panels and the preview toolbar; the form's own fields add many more.
    const tips = page.locator(".info-tip-button");
    expect(await tips.count()).toBeGreaterThanOrEqual(4);

    // The explanation is an attribute, drawn as ::after and read out through aria-description —
    // deliberately not an element, so it never becomes part of a <label>'s text.
    const first = tips.first();
    const description = await first.getAttribute("aria-description");
    expect(description).toBeTruthy();
    expect(description).toMatch(/scene/i);
    await expect(first).toHaveAttribute("data-tip", String(description));
    const bubbleVisibility = () => first.evaluate((el) => getComputedStyle(el, "::after").visibility);
    expect(await bubbleVisibility()).toBe("hidden");
    await first.focus();
    await expect.poll(bubbleVisibility).toBe("visible");
  });
});
