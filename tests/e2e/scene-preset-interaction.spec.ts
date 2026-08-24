import { expect, test, type Page } from "@playwright/test";

// Does choosing a scene preset actually stick?
//
// Written because a wording change nearly broke exactly this and nothing would have noticed. A
// find-and-replace that gave presets their proper names also wrapped four select value bindings, so
// the form would have been handed "Replay Lower Third" where it expected "replay-lower-third". The
// page would have looked right in every screenshot and every wording snapshot, and the picker would
// have been dead.
//
// The suite could see what the page said and how it looked. It could not see whether it worked.
//
// This restores the original value before finishing, including when the assertions fail: the visual
// and wording baselines run against the same seeded stack, and a test that leaves the fixture on a
// different preset turns every later run red for reasons that have nothing to do with the change
// being reviewed.

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

const SCENE_PATH = "/studio?tab=scene";
const PRESET_LABEL = "Active scene preset";
const OTHER_PRESET = "split-now-next";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
}

function presetSelect(page: Page) {
  return page.getByLabel(PRESET_LABEL);
}

async function saveDraft(page: Page) {
  // Wait for the request itself, not for the button to look idle again. Watching the button passed
  // once and failed the next run: it is only disabled while the transition is pending, which can be
  // over before the PUT has been answered, and the reload then raced the save.
  const saved = page.waitForResponse(
    (response) => response.url().includes("/api/overlay") && response.request().method() === "PUT",
    { timeout: 20_000 }
  );
  await page.getByRole("button", { exact: true, name: "Save draft" }).click();
  const response = await saved;
  expect(response.ok(), `saving the draft returned ${response.status()}`).toBe(true);
}

async function setPreset(page: Page, value: string) {
  await presetSelect(page).selectOption(value);
  await saveDraft(page);
}

test.describe("choosing a scene preset", () => {
  test("keeps the choice across a reload", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1600 });
    await signIn(page);
    await page.goto(SCENE_PATH);

    const select = presetSelect(page);
    await expect(select).toBeVisible();
    const original = await select.inputValue();
    expect(original, "the fixture should start on a known preset").toBeTruthy();
    expect(OTHER_PRESET).not.toBe(original);

    try {
      // The value the form submits has to be the stored id, not the label shown in the option.
      const optionValues = await select.locator("option").evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value)
      );
      expect(optionValues).toContain(OTHER_PRESET);
      for (const value of optionValues) {
        expect(value, "option values are ids, not display labels").toMatch(/^[a-z0-9-]+$/);
      }

      await setPreset(page, OTHER_PRESET);
      await page.reload();
      await expect(presetSelect(page)).toHaveValue(OTHER_PRESET);
    } finally {
      // Discard the draft rather than saving the old value back.
      //
      // Putting the preset back was not enough: saving at all leaves a draft, and the page then
      // reads "Pending changes · Draft differs from live scene" instead of "Live and draft match".
      // The wording baseline caught that on the next run, which is the point of it — but it means
      // the cleanup has to undo the act of saving, not just its content.
      await page.goto(SCENE_PATH);
      const reset = page.getByRole("button", { name: "Reset to live" });
      if (await reset.isEnabled().catch(() => false)) {
        const discarded = page.waitForResponse(
          (response) => response.url().includes("/api/overlay") && response.request().method() !== "GET",
          { timeout: 20_000 }
        );
        await reset.click();
        await discarded;
      }
    }

    await page.reload();
    await expect(presetSelect(page)).toHaveValue(original);
    await expect(page.getByText("Live and draft match").first()).toBeVisible();
  });
});
