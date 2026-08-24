import { expect, test, type Page } from "@playwright/test";

// The second place option labels were rewritten, checked the same way as the first.
//
// Rewriting what an option *says* is one edit away from rewriting what it *submits*, and the
// difference is invisible to a screenshot and to a wording snapshot: the page reads correctly in
// both while the control quietly does nothing. This drives the real thing — change it, save it,
// reload, and see whether the server kept it.
//
// It restores the original value in a finally block, because the visual and wording baselines run
// against this same seeded stack.

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

const ENGAGEMENT_PATH = "/studio?tab=engagement";
const CHAT_MODE_LABEL = "Chat mode";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
}

function chatMode(page: Page) {
  return page.getByLabel(CHAT_MODE_LABEL);
}

async function save(page: Page) {
  const saved = page.waitForResponse(
    (response) => response.url().includes("/api/overlay/engagement") && response.request().method() === "PUT",
    { timeout: 20_000 }
  );
  await page.getByRole("button", { name: "Save engagement settings" }).click();
  const response = await saved;
  expect(response.ok(), `saving returned ${response.status()}`).toBe(true);
}

test.describe("changing the chat mode", () => {
  test("submits the stored value, not the label shown", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1600 });
    await signIn(page);
    await page.goto(ENGAGEMENT_PATH);

    const select = chatMode(page);
    await expect(select).toBeVisible();
    const original = await select.inputValue();

    // The options read "Quiet" and "Flood" but have to submit "quiet" and "flood".
    const options = await select.locator("option").evaluateAll((nodes) =>
      nodes.map((node) => ({
        value: (node as HTMLOptionElement).value,
        text: (node as HTMLOptionElement).textContent?.trim() ?? ""
      }))
    );
    for (const option of options) {
      expect(option.value, "option values are stored ids").toMatch(/^[a-z0-9-]+$/);
      expect(option.text, "option text is not the id").not.toBe(option.value);
    }

    const target = options.map((option) => option.value).find((value) => value !== original);
    expect(target, "the fixture should offer more than one mode").toBeTruthy();

    try {
      await select.selectOption(target!);
      await save(page);
      await page.reload();
      await expect(chatMode(page)).toHaveValue(target!);
    } finally {
      await page.goto(ENGAGEMENT_PATH);
      await chatMode(page).selectOption(original);
      await save(page);
    }

    await page.reload();
    await expect(chatMode(page)).toHaveValue(original);
  });
});
