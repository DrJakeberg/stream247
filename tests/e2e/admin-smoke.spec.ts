import { expect, test } from "@playwright/test";
import { generateTotpCode } from "../../apps/web/lib/server/two-factor";

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";
const outputRoot = process.env.E2E_SECONDARY_OUTPUT_ROOT || "/tmp/stream-output";

test.describe.configure({ mode: "serial" });

test("bootstraps the workspace, verifies the operator IA, enables 2FA, and publishes a live scene update", async ({ browser, page }) => {
  const stamp = Date.now();
  const channelName = `Smoke Channel ${stamp}`;
  const customText = `Scene Studio V2 ${stamp}`;
  const secondaryDestinationName = `Smoke Secondary Output ${stamp}`;
  const channelNameMatcher = new RegExp(channelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  await page.goto("/setup");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Create owner account" }).click();
  await expect(page).toHaveURL(/\/broadcast$/);
  await expect(page.getByRole("heading", { name: /Operate the live 24\/7 output from one workspace/i })).toBeVisible();
  const adminNav = page.getByRole("navigation", { name: "Admin" });

  await adminNav.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: /Check readiness, integrations, and current channel posture/i })).toBeVisible();
  const destinationForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Add destination" }) }).first();
  await destinationForm.getByLabel("Name").fill(secondaryDestinationName);
  await destinationForm.getByLabel("RTMP URL").fill(`${outputRoot}/secondary-a`);
  await destinationForm.getByLabel("Stream key").fill("secondary-a.flv");
  await destinationForm.getByLabel("Notes").fill("CI smoke output");
  const createDestinationResponse = page.waitForResponse(
    (response) => response.url().includes("/api/destinations") && response.request().method() === "POST"
  );
  await destinationForm.getByRole("button", { name: "Add destination" }).click();
  await expect((await createDestinationResponse).ok()).toBeTruthy();
  await expect(destinationForm.getByText("Destination created.")).toBeVisible();
  await expect(page.getByText(secondaryDestinationName)).toBeVisible();
  await expect(page.getByText("2 active", { exact: true })).toBeVisible();
  await expect(page.getByText(/2 active output\(s\) are ready\./i)).toBeVisible();

  await adminNav.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: /Manage workspace security, credentials, releases, and blueprints/i })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: /Operate the live 24\/7 output from one workspace/i })).toBeVisible();

  const refreshResponse = page.waitForResponse(
    (response) => response.url().includes("/api/broadcast/actions") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Refresh scenes" }).click();
  await expect((await refreshResponse).ok()).toBeTruthy();

  await adminNav.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL(/\/sources$/);
  await expect(page.getByRole("heading", { name: /Manage sources, uploads, pools, and the playable catalog/i })).toBeVisible();

  await adminNav.getByRole("link", { name: "Scene Studio", exact: true }).click();
  await expect(page).toHaveURL(/\/overlay-studio$/);
  await expect(page.getByRole("heading", { name: /Publish the viewer-facing scene without leaving the control room/i })).toBeVisible();
  await page.getByLabel("Channel name").fill(channelName);
  await page.getByLabel("Typography preset").selectOption("editorial-serif");
  await page.getByRole("button", { name: "Add Text Layer" }).click();
  await page.getByLabel("Text content").fill(customText);
  await page.getByLabel("Secondary text").fill("CI smoke overlay");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Scene draft saved.")).toBeVisible();
  await page.getByRole("button", { name: "Publish live" }).click();
  await expect(page.getByText("Scene changes published live.")).toBeVisible();

  const publicOverlay = await browser.newPage();
  await publicOverlay.goto("/overlay");
  await expect(publicOverlay.locator(".overlay-frame.overlay-typography-editorial-serif")).toBeVisible();
  await expect(publicOverlay.getByText(channelNameMatcher)).toBeVisible();
  await expect(publicOverlay.getByText(customText)).toBeVisible();
});
