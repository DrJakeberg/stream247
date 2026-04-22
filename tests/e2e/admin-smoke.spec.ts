import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { generateTotpCode } from "../../apps/web/lib/server/two-factor";

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";
const outputRoot = process.env.E2E_SECONDARY_OUTPUT_ROOT || "/tmp/stream-output";
const secretCachePath = path.join(
  os.tmpdir(),
  `stream247-admin-smoke-${ownerEmail.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-2fa.txt`
);

test.describe.configure({ mode: "serial" });

async function ensureSignedIn(page: Page) {
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

  const oneTimeCode = page.getByLabel("One-time code");
  if (await oneTimeCode.isVisible().catch(() => false)) {
    if (!fs.existsSync(secretCachePath)) {
      throw new Error(`2FA secret cache missing at ${secretCachePath}`);
    }

    const cachedSecret = fs.readFileSync(secretCachePath, "utf8").trim();
    await oneTimeCode.fill(generateTotpCode(cachedSecret));
    await page.getByRole("button", { name: "Verify code" }).click();
  }

  await expect(page).toHaveURL(/\/live(?:\?tab=control|status)?$/);
}

test("bootstraps the workspace, verifies the operator IA, enables 2FA, and publishes a live scene update", async ({ browser, page }) => {
  const stamp = Date.now();
  const channelName = `Smoke Channel ${stamp}`;
  const customText = `Scene Studio V2 ${stamp}`;
  const secondaryDestinationName = `Smoke Secondary Output ${stamp}`;
  const channelNameMatcher = new RegExp(channelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  await ensureSignedIn(page);
  await page.goto("/live?tab=status");
  await expect(page).toHaveURL(/\/live\?tab=status$/);
  const adminNav = page.getByRole("navigation", { name: "Admin" });
  await expect(adminNav).toBeVisible();
  await expect(page.getByText("Workspaces", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Check readiness, integrations, and current channel posture/i })).toBeVisible();
  for (const [label, href] of [
    ["Live", "/live"],
    ["Program", "/program"],
    ["Studio", "/studio"],
    ["Admin", "/admin"]
  ] as const) {
    const link = adminNav.getByRole("link", { name: label, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("title", label);
  }

  await page.goto("/ops");
  await expect(page).toHaveURL(/\/live(?:\?tab=status)?$/);
  await expect(page.getByRole("heading", { name: /Check readiness, integrations, and current channel posture/i })).toBeVisible();

  await adminNav.getByRole("link", { name: "Program", exact: true }).click();
  await expect(page).toHaveURL(/\/program(?:\?tab=schedule)?$/);
  const programTabs = page.getByRole("tablist", { name: "Program tabs" });
  await expect(programTabs).toBeVisible();
  await expect(programTabs.getByRole("tab", { name: "Schedule", exact: true })).toBeVisible();

  await programTabs.getByRole("tab", { name: "Pools", exact: true }).click();
  await expect(page).toHaveURL(/\/program\?tab=pools$/);
  await expect(page.getByRole("heading", { name: /Manage programming pools/i })).toBeVisible();

  await programTabs.getByRole("tab", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL(/\/program\?tab=library$/);
  await expect(page.getByRole("heading", { name: /Browse the playable catalog and upload local media/i })).toBeVisible();

  await programTabs.getByRole("tab", { name: "Sources", exact: true }).click();
  await expect(page).toHaveURL(/\/program\?tab=sources$/);
  await expect(page.getByRole("heading", { name: /Manage ingest pipelines and source connectors/i })).toBeVisible();

  await adminNav.getByRole("link", { name: "Studio", exact: true }).click();
  await expect(page).toHaveURL(/\/studio(?:\?tab=scene)?$/);
  await expect(page.getByRole("heading", { name: /Publish the viewer-facing scene without leaving the control room/i })).toBeVisible();
  const studioTabs = page.getByRole("tablist", { name: "Studio tabs" });

  await studioTabs.getByRole("tab", { name: "Engagement", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\?tab=engagement$/);
  await expect(page.getByRole("heading", { name: /Manage in-stream engagement/i })).toBeVisible();

  await studioTabs.getByRole("tab", { name: "Output", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\?tab=output$/);
  await expect(page.getByRole("heading", { name: "Output profile", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save output settings", exact: true })).toBeVisible();

  await adminNav.getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page).toHaveURL(/\/admin(?:\?tab=settings)?$/);
  await expect(page.getByRole("heading", { name: /Manage workspace security, credentials, releases, and blueprints/i })).toBeVisible();
  const adminTabs = page.getByRole("tablist", { name: "Admin tabs" });

  await adminTabs.getByRole("tab", { name: "Team", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?tab=team$/);
  await expect(page.getByText("Twitch team access", { exact: true })).toBeVisible();

  await adminNav.getByRole("link", { name: "Live", exact: true }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
  const liveTabs = page.getByRole("tablist", { name: "Live tabs" });
  await liveTabs.getByRole("tab", { name: "Status", exact: true }).click();
  await expect(page).toHaveURL(/\/live\?tab=status$/);
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

  await adminNav.getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page).toHaveURL(/\/admin(?:\?tab=settings)?$/);
  await expect(page.getByRole("heading", { name: /Manage workspace security, credentials, releases, and blueprints/i })).toBeVisible();
  await page.getByLabel("Current password").fill(ownerPassword);
  await page.getByRole("button", { name: /Start two-factor setup|Rotate authenticator secret/ }).click();
  await expect(page.locator("strong", { hasText: "Authenticator secret" })).toBeVisible();

  const secret = (await page.locator("code").first().textContent())?.trim() || "";
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  fs.writeFileSync(secretCachePath, `${secret}\n`, "utf8");

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
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
  await expect(page.getByRole("heading", { name: /Operate the live 24\/7 output from one workspace/i })).toBeVisible();

  const refreshResponse = page.waitForResponse(
    (response) => response.url().includes("/api/broadcast/actions") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Refresh scenes" }).click();
  await expect((await refreshResponse).ok()).toBeTruthy();

  await adminNav.getByRole("link", { name: "Studio", exact: true }).click();
  await expect(page).toHaveURL(/\/studio(?:\?tab=scene)?$/);
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
