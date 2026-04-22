import { expect, test, type Page } from "@playwright/test";

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

async function ensureSignedInForProgram(page: Page) {
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

test("captures the clean Program workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 });
  await ensureSignedInForProgram(page);
  await page.goto("/program?tab=pools");

  const workspace = page.locator(".content-stack > .stack-form").first();
  await expect(workspace).toBeVisible();
  await expect(workspace).toHaveScreenshot("program-workspace-pools.png", {
    animations: "disabled"
  });
});
