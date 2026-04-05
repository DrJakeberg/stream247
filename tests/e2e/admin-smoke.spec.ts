import { expect, test } from "@playwright/test";
import { generateTotpCode } from "../../apps/web/lib/server/two-factor";

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

test.describe.configure({ mode: "serial" });

test("bootstraps the workspace, enables 2FA, and publishes a live scene update", async ({ browser, page }) => {
  const stamp = Date.now();
  const channelName = `Smoke Channel ${stamp}`;
  const channelNameMatcher = new RegExp(channelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  await page.goto("/setup");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Create owner account" }).click();
  await expect(page).toHaveURL(/\/broadcast$/);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByLabel("Current password").fill(ownerPassword);
  await page.getByRole("button", { name: /Start two-factor setup|Rotate authenticator secret/ }).click();
  await expect(page.locator("strong", { hasText: "Authenticator secret" })).toBeVisible();

  const secret = (await page.locator("code").first().textContent())?.trim() || "";
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);

  await page.getByLabel("Confirm 6-digit code").fill(generateTotpCode(secret));
  await page.getByRole("button", { name: "Confirm and enable 2FA" }).click();
  await expect(page.getByText(/Enabled since|Two-factor authentication enabled/i)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("One-time code")).toBeVisible();
  await page.getByLabel("One-time code").fill(generateTotpCode(secret));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL(/\/broadcast$/);

  const refreshResponse = page.waitForResponse(
    (response) => response.url().includes("/api/broadcast/actions") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Refresh scenes" }).click();
  await expect((await refreshResponse).ok()).toBeTruthy();

  await page.getByRole("link", { name: "Overlay", exact: true }).click();
  await expect(page).toHaveURL(/\/overlay-studio$/);
  await page.getByLabel("Channel name").fill(channelName);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Scene draft saved.")).toBeVisible();
  await page.getByRole("button", { name: "Publish live" }).click();
  await expect(page.getByText("Scene changes published live.")).toBeVisible();

  const publicOverlay = await browser.newPage();
  await publicOverlay.goto("/overlay");
  await expect(publicOverlay.getByText(channelNameMatcher)).toBeVisible();
});
