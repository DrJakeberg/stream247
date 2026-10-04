import { expect, test, type Page } from "@playwright/test";

// M99 "Wizard to first programme": a fresh owner completes "Where the stream goes" and "First
// programme", and readiness then shows destination, pools and schedule ready.
//
// Needs its own fresh stack: no owner yet, no stream key in the environment and one video in the media
// library (`E2E_FRESH_DESTINATION=1 E2E_MEDIA_FIXTURE=1 pnpm test:e2e:smoke` with this spec, as CI runs
// it). The stack's primary destination points at a file inside the playout container instead of Twitch,
// so the step shows "Another RTMP service" with that address and only the key is pasted.

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

test.describe.configure({ mode: "serial", retries: 0 });

async function stepBadge(page: Page, title: string) {
  return page.locator(".item").filter({ has: page.locator("strong", { hasText: title }) }).first().locator(".badge");
}

async function checklistBadge(page: Page, title: string) {
  return page
    .locator(".item")
    .filter({ has: page.locator("strong", { hasText: new RegExp(`^${title}$`) }) })
    .first()
    .locator(".badge");
}

test("a fresh owner completes the stream key and first programme steps, and readiness is green for them", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/setup");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Create owner account" }).click();
  await expect(page.getByText(`Owner ${ownerEmail} exists.`)).toBeVisible();

  // Before the steps: readiness has none of the three.
  await page.goto("/setup?step=done");
  for (const title of ["Live destination", "Program pools", "Weekly schedule"]) {
    await expect(await checklistBadge(page, title)).toHaveText("Needs action");
  }

  // Where the stream goes.
  await page.goto("/setup?step=destination");
  await expect(page.getByRole("heading", { name: "Where the stream goes" })).toBeVisible();
  // The RTMP URL's hint also mentions the stream key, so the field is found by the start of its name.
  const keyField = page.getByRole("textbox", { name: /^Stream key/ });
  await expect(keyField).toHaveAttribute("type", "password");
  await keyField.fill("primary.flv");
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/destinations") && response.request().method() === "PUT"
  );
  await page.getByRole("button", { name: /^Save to / }).click();
  expect((await saved).ok()).toBeTruthy();
  await page.goto("/setup?step=destination");
  await expect(page.getByText("A destination with a stream key is ready.")).toBeVisible();
  await expect(page.getByText("Stream key stored here")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Stream key/ })).toHaveValue("");

  // First programme: the worker's library scan makes the fixture ready within a few cycles.
  await expect(async () => {
    await page.goto("/setup?step=programme");
    await expect(page.getByRole("button", { name: "Create the pool and fill the week" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 150_000, intervals: [3_000] });
  await expect(page.getByText(/Local Media Library · \d+ ready video/)).toBeVisible();
  const template = page.waitForResponse(
    (response) => response.url().endsWith("/api/schedule/templates") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Create the pool and fill the week" }).click();
  expect((await template).ok()).toBeTruthy();

  // Review: both steps done, and readiness shows destination, pools and schedule ready.
  await page.goto("/setup?step=done");
  await expect(await stepBadge(page, "5. Where the stream goes")).toHaveText("Done");
  await expect(await stepBadge(page, "6. First programme")).toHaveText("Done");
  for (const title of ["Live destination", "Program pools", "Weekly schedule"]) {
    await expect(await checklistBadge(page, title)).toHaveText("Ready");
  }

  // The week holds the template's seven all-day blocks of the new pool.
  const blocks = await page.evaluate(async () => {
    const response = await fetch("/api/schedule/blocks");
    return response.ok ? ((await response.json()) as { blocks?: Array<{ poolId: string; durationMinutes: number }> }).blocks ?? [] : [];
  });
  expect(blocks).toHaveLength(7);
  expect(blocks.every((block) => block.durationMinutes === 24 * 60)).toBe(true);

  // The destination forms moved to Studio → Output; a link to the old section follows them there.
  await page.goto("/live?tab=status#output-destinations");
  await page.waitForURL(/\/studio\?tab=output#output-destinations$/);
  // The add form is folded; opening it shows the form that used to stand on Live → Status.
  await page.locator("#output-destinations summary", { hasText: "Add another destination" }).click();
  await expect(page.locator("#output-destinations").getByRole("button", { name: "Add destination" })).toBeVisible();
});
