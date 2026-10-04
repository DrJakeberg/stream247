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

test.describe.configure({ mode: "serial", retries: 0 });

async function ensureSignedIn(page: Page) {
  await page.goto("/setup");

  const setupButton = page.getByRole("button", { name: "Create owner account" });
  if (await setupButton.isVisible().catch(() => false)) {
    await page.getByLabel("Owner email").fill(ownerEmail);
    await page.getByLabel("Password").fill(ownerPassword);
    await setupButton.click();
    // Since M52 the wizard continues on /setup instead of dropping into the workspace. The wait
    // target must be something that only renders after bootstrap actually completed — the step
    // rail is visible before submitting too, and returning on it races the session cookie: the
    // next navigation then bounces through /login and lands on bare /live without its tab.
    await expect(page.getByText(`Owner ${ownerEmail} exists.`)).toBeVisible();
    return;
  }

  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  const oneTimeCode = page.getByLabel("One-time code");
  // After the first test enabled 2FA the sign-in answers with the code step, which renders a moment
  // after the click: checking visibility at once raced it and left a later test on /login. Wait for
  // whichever of the two outcomes comes.
  await Promise.race([
    page.waitForURL(/\/live(?:\?tab=control|status)?$/, { timeout: 15_000 }).catch(() => undefined),
    oneTimeCode.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined)
  ]);
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

test("bootstraps the workspace, verifies the operator IA, enables 2FA, and publishes a live scene update", async ({ page }) => {
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
  // Since M99 destinations are added in Studio → Output; Live → Status links there.
  await page.getByRole("link", { name: /Add or change destinations and stream keys in Studio → Output/ }).click();
  await expect(page).toHaveURL(/\/studio\?tab=output#output-destinations$/);
  await page.locator("#output-destinations summary", { hasText: "Add another destination" }).click();
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
  await expect(page.locator("#output-destinations").getByText(secondaryDestinationName)).toBeVisible();
  await page.goto("/live?tab=status");
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

  // The repair actions moved behind a disclosure: they are for when something is wrong, and having
  // six of them open in front of the everyday controls was the reason the live page showed
  // thirty-three at once. The cost is this extra click, which an operator pays too — so the smoke
  // test pays it as well rather than reaching past the interface.
  await page.getByText("If something is stuck").click();

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
  const publishLiveButton = page.getByRole("button", { name: "Publish live", exact: true });
  if (!(await publishLiveButton.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Review changes", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review scene changes before publishing", exact: true })).toBeVisible();
  }
  await publishLiveButton.click();
  await expect(page.getByText("Scene changes published live.")).toBeVisible();

  // What went on air is what the studio shows: since stage 2 there is no browser overlay page to
  // open, and the studio's preview is the on-air renderer's own frame — satori with embedFont off,
  // so every word is a <text> node and the typography preset is the SVG's font family. This is a
  // stronger claim than the old page made: it is the renderer that drew this, not an imitation.
  const renderedScene = page.getByLabel("Scene as the on-air renderer draws it");
  await expect(renderedScene.locator("svg")).toBeVisible({ timeout: 30_000 });
  await expect(renderedScene.getByText(channelNameMatcher)).toBeVisible({ timeout: 30_000 });
  await expect(renderedScene.getByText(customText)).toBeVisible();
  // satori lower-cases the family it writes into the SVG: font-family="stream247 serif".
  expect((await renderedScene.locator("svg").innerHTML()).toLowerCase()).toContain("stream247 serif");
});

// Calls the app's API from inside the signed-in page. The session cookie is Secure, and Playwright's
// own request context does not send it over plain http to 127.0.0.1; the browser does.
async function callApi<T>(page: Page, method: "GET" | "POST", url: string, data?: unknown): Promise<{ ok: boolean; body: T }> {
  return page.evaluate(
    async ({ method, url, data }) => {
      const response = await fetch(url, {
        method,
        headers: data === undefined ? undefined : { "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data)
      });
      return { ok: response.ok, body: await response.json() };
    },
    { method, url, data }
  ) as Promise<{ ok: boolean; body: T }>;
}

test("asks before a template replaces the schedule, and Cancel keeps the blocks (M97 U6)", async ({ page }) => {
  await ensureSignedIn(page);

  // A pool on the local library and a week of blocks from a template, through the same API the forms use.
  const sources = (await callApi<{ sources: Array<{ id: string; connectorKind: string }> }>(page, "GET", "/api/sources")).body;
  const library = sources.sources.find((source) => source.connectorKind === "local-library");
  expect(library, "the fresh install's local library source").toBeTruthy();
  const poolName = `Replace Check ${Date.now()}`;
  expect((await callApi(page, "POST", "/api/pools", { name: poolName, sourceIds: [library?.id] })).ok).toBeTruthy();
  const pools = (await callApi<{ pools: Array<{ id: string; name: string }> }>(page, "GET", "/api/pools")).body;
  const poolId = pools.pools.find((pool) => pool.name === poolName)?.id ?? "";
  expect(
    (await callApi(page, "POST", "/api/schedule/templates", { template: "always-on-single-pool", primaryPoolId: poolId, replaceExisting: true }))
      .ok
  ).toBeTruthy();
  const blockIds = async () =>
    (await callApi<{ blocks: Array<{ id: string }> }>(page, "GET", "/api/schedule/blocks")).body.blocks.map((block) => block.id).sort();
  const before = await blockIds();
  expect(before.length).toBeGreaterThan(0);

  await page.goto("/program?tab=schedule&lens=day");
  const templateForm = page.locator("form", { has: page.getByRole("button", { name: "Apply template" }) });
  await templateForm.locator('select[name="primaryPoolId"]').selectOption(poolId);
  await templateForm.getByText("Replace existing schedule blocks before applying template").click();

  let confirmation = "";
  page.once("dialog", async (dialog) => {
    confirmation = dialog.message();
    await dialog.dismiss();
  });
  let templateRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/schedule/templates")) {
      templateRequests += 1;
    }
  });
  await templateForm.getByRole("button", { name: "Apply template" }).click();
  await expect.poll(() => confirmation).toContain("Replace the whole schedule?");
  expect(templateRequests).toBe(0);
  expect(await blockIds()).toEqual(before);
});
