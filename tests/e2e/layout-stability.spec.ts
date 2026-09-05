import { expect, test, type Page } from "@playwright/test";

// Why this exists.
//
// The visual baseline for /live?tab=control and /admin?tab=settings failed on CI with *different
// image heights* — and the heights differed between retries of the same run: 3636px, then 3672px,
// then 3636px again. A mask cannot fix that. Masking paints over pixels; it does not put reflowed
// content back where it was, so a page that changes height still fails on every pixel below the
// point where the reflow started.
//
// Chasing that through screenshots is guesswork, so this test asserts the property the baseline
// actually depends on: loading the same page twice must produce the same layout height. When it
// does not, the failure names the elements whose text changed, which is the thing to fix.
//
// It is deliberately separate from design-baseline.spec.ts: that suite compares against committed
// images and needs the Playwright image for font parity, while this one compares a page against
// itself and holds regardless of where it runs.

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

// The two surfaces that actually failed this way. Covering every page cost five minutes of CI for
// a property the snapshots already catch — slower, but they do catch it. This is here to explain
// the failure, not to be the only thing that notices it.
const SURFACES = [
  { name: "live-control", path: "/live?tab=control" },
  { name: "admin-settings", path: "/admin?tab=settings" }
];

const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 1600 },
  { label: "mobile", width: 390, height: 1400 }
];

/** Long enough for second-resolution values to tick over between the two loads. */
const SETTLE_MS = 8_000;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
}

/**
 * Height of the workspace shell, plus the text of every leaf element, so a failure can say which
 * text changed rather than only that something did.
 */
async function measure(page: Page, path: string) {
  await page.goto(path);
  const target = page.locator("main, .content-stack").first();
  await expect(target).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  return page.evaluate(() => {
    const root = document.querySelector("main, .content-stack");
    if (!root) throw new Error("No workspace shell on the page.");

    const texts: string[] = [];
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      if (element.children.length > 0) continue;
      const text = (element.textContent || "").trim();
      if (text) texts.push(text);
    }

    return { height: Math.round(root.getBoundingClientRect().height), texts };
  });
}

test.describe("layout stability", () => {
  for (const viewport of VIEWPORTS) {
    for (const surface of SURFACES) {
      test(`${surface.name} @ ${viewport.label} keeps its height across loads`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await signIn(page);

        const first = await measure(page, surface.path);
        await page.waitForTimeout(SETTLE_MS);
        const second = await measure(page, surface.path);

        // Reported before the height, because the changed text is what explains the height.
        const changed = first.texts
          .map((text, index) => ({ text, after: second.texts[index] }))
          .filter((pair) => pair.after !== undefined && pair.after !== pair.text)
          .map((pair) => `${JSON.stringify(pair.text)} -> ${JSON.stringify(pair.after)}`);

        expect(
          { changedText: changed, height: [first.height, second.height] },
          `${surface.name} changed between two loads ${SETTLE_MS}ms apart`
        ).toEqual({ changedText: [], height: [first.height, first.height] });
      });
    }
  }
});
