import { expect, test, type Page } from "@playwright/test";

// Does dragging a panel actually move it, and to where it was dragged?
//
// The claim direct manipulation makes is not "a box moved on screen" — a local outline can do that
// while the stored value goes somewhere else entirely, which is exactly how the studio's old
// hand-written preview disagreed with the picture. So this test does not look at the outline. It
// reads the stored percent out of the sidebar's own number field afterwards, converts it back to
// design pixels with the renderer's arithmetic, and checks it against where the pointer was let go.
//
// The tolerance is the snap grid, not a fudge: the drag lands on the 8-design-pixel grid or on a
// neighbour's edge, both of which are inside 8 design pixels of the drop point by construction.
//
// Like scene-preset-interaction.spec.ts, this restores the fixture before it finishes, including
// when the assertions fail — the visual and wording baselines run against the same seeded stack.

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

const SCENE_PATH = "/studio?tab=scene";
/** The design grid the studio's numbers are in. Frame pixels at 1920x1080 by definition. */
const DESIGN = { width: 1920, height: 1080 };
const DESIGN_SAFE = { left: 72, top: 56, width: 1920 - 144, height: 1080 - 112 };
const GRID_DESIGN_PX = 8;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
}

function heroBox(page: Page) {
  return page.locator('.placement-box[aria-label^="Now playing"]');
}

/** The renderer's own inverse, done by hand here so the test does not import the code under test. */
function designToPercent(design: { left: number; top: number }) {
  return {
    xPercent: ((design.left - DESIGN_SAFE.left) / DESIGN_SAFE.width) * 100,
    yPercent: ((design.top - DESIGN_SAFE.top) / DESIGN_SAFE.height) * 100
  };
}

test.describe("dragging a panel on the preview", () => {
  test("stores the percent that matches where it was dropped", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1600 });
    await signIn(page);
    await page.goto(SCENE_PATH);

    const hero = heroBox(page);
    await expect(hero).toBeVisible();
    // page.mouse works in viewport coordinates and does not scroll for you, unlike locator.click().
    // The scene editor sits well below the fold at this viewport.
    await hero.scrollIntoViewIfNeeded();
    // The frame the renderer drew. Waiting for it matters: the drag is measured against the boxes
    // over the picture, and a preview still showing its empty state is a preview whose picture the
    // operator has not seen yet.
    await expect(page.locator(".scene-render-preview svg")).toBeVisible({ timeout: 30_000 });

    // The preview's displayed size, which is what turns a pointer position into an output pixel.
    const shell = page.locator(".scene-preview-shell-render");
    const shellBox = await shell.boundingBox();
    expect(shellBox, "the preview shell should be laid out").toBeTruthy();
    // Screen pixels per design pixel. This is the preview scale (shell / output width) multiplied
    // by overlayScale (output width / 1920), and those two cancel to exactly this — which is why
    // the test does not need to know which profile the fixture encodes at.
    const previewScale = shellBox!.width / DESIGN.width;
    // Reported on every run: the number is the point. At 1440 viewport this is about 0.4, which is
    // why the arrow keys exist — one screen pixel is roughly 2.5 design pixels.
    console.log(`design pixels per screen pixel: ${(1 / previewScale).toFixed(3)} (shell ${Math.round(shellBox!.width)}px wide)`);
    expect(previewScale).toBeGreaterThan(0.1);

    const start = await hero.boundingBox();
    expect(start, "the hero box should be laid out").toBeTruthy();

    // Drag it up and to the right by a round number of design pixels.
    const moveDesign = { x: 160, y: -240 };
    const from = { x: start!.x + start!.width / 2, y: start!.y + start!.height / 2 };
    const to = {
      x: from.x + moveDesign.x * previewScale,
      y: from.y + moveDesign.y * previewScale
    };

    try {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      // Two moves: one to start the drag, one to land it. A single move can be delivered before
      // the pointer capture is in place.
      await page.mouse.move(from.x + moveDesign.x * previewScale * 0.5, from.y + moveDesign.y * previewScale * 0.5);
      await page.mouse.move(to.x, to.y);
      await page.mouse.up();

      // Placing the hero opens the sidebar's placement fold at its row, and the number fields are
      // the stored value — not a label the component could have drawn from its own drag state.
      const row = page.locator("#placement-panel-hero");
      await expect(row).toHaveAttribute("data-selected", "true");
      const storedX = Number(await row.getByLabel("X position (%)").inputValue());
      const storedY = Number(await row.getByLabel("Y position (%)").inputValue());

      // Where the pointer was let go, in design pixels: the box's own top-left plus the movement.
      const expectedDesign = {
        left: (start!.x - shellBox!.x) / previewScale + moveDesign.x,
        top: (start!.y - shellBox!.y) / previewScale + moveDesign.y
      };
      const expected = designToPercent(expectedDesign);

      // Percent tolerance worth one grid cell on each axis.
      const toleranceX = (GRID_DESIGN_PX / DESIGN_SAFE.width) * 100;
      const toleranceY = (GRID_DESIGN_PX / DESIGN_SAFE.height) * 100;
      console.log(
        `dropped at design ${Math.round(expectedDesign.left)},${Math.round(expectedDesign.top)} ` +
          `-> expected ${expected.xPercent.toFixed(2)}%,${expected.yPercent.toFixed(2)}% ` +
          `stored ${String(storedX)}%,${String(storedY)}%`
      );

      expect(Math.abs(storedX - expected.xPercent)).toBeLessThanOrEqual(toleranceX);
      expect(Math.abs(storedY - expected.yPercent)).toBeLessThanOrEqual(toleranceY);

      // And the renderer agrees: a new frame is drawn for the moved panel, and the box the studio
      // shows afterwards is the one the stored percent resolves to. The frame is still on screen
      // throughout — the drop never blanks the picture.
      await expect(page.locator(".scene-render-preview svg")).toBeVisible();
      // Re-measured together: selecting a box scrolls the sidebar to its row, so a shell rectangle
      // taken before the drag is in the wrong place afterwards. Both boxes are read now, and only
      // the difference between them is used.
      const landedShell = await shell.boundingBox();
      const landed = await hero.boundingBox();
      expect(Math.abs((landed!.x - landedShell!.x) / previewScale - expectedDesign.left)).toBeLessThanOrEqual(
        GRID_DESIGN_PX
      );
      expect(Math.abs((landed!.y - landedShell!.y) / previewScale - expectedDesign.top)).toBeLessThanOrEqual(
        GRID_DESIGN_PX
      );
    } finally {
      // Nothing was saved: a drag changes the draft in the browser and the operator still has to
      // press "Save draft". Leaving the page is therefore the whole cleanup, and it is the safe
      // one — pressing "Reset to live" would write to the fixture the wording baseline reads.
      await page.goto(SCENE_PATH);
      await expect(page.getByText("Live and draft match").first()).toBeVisible();
    }
  });

  test("an arrow key moves the panel by one design pixel and shift by eight", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1600 });
    await signIn(page);
    await page.goto(SCENE_PATH);

    const hero = heroBox(page);
    await expect(hero).toBeVisible();
    await expect(page.locator(".scene-render-preview svg")).toBeVisible({ timeout: 30_000 });

    try {
      // Click to place and select, then nudge. The keyboard is the only way to ask for one design
      // pixel: at preview scale ~0.4 the pointer cannot resolve better than about 2.5.
      await hero.click();
      const row = page.locator("#placement-panel-hero");
      await expect(row).toHaveAttribute("data-selected", "true");
      const field = row.getByLabel("X position (%)");
      const before = Number(await field.inputValue());

      await hero.focus();
      await page.keyboard.press("ArrowRight");
      await expect(field).not.toHaveValue(String(before));
      const afterOne = Number(await field.inputValue());
      const onePixel = (1 / DESIGN_SAFE.width) * 100;
      console.log(`one design pixel is ${onePixel.toFixed(4)}%; arrow moved ${(afterOne - before).toFixed(4)}%`);
      expect(afterOne - before).toBeGreaterThan(0);
      // A tenth of a design pixel. The stored percent is rounded to three decimals, which is
      // 0.018 of one — finer than the whole-pixel rounding the renderer does downstream.
      expect(Math.abs(afterOne - before - onePixel)).toBeLessThanOrEqual(onePixel / 10);

      await page.keyboard.press("Shift+ArrowRight");
      const afterEight = Number(await field.inputValue());
      expect(afterEight - afterOne).toBeGreaterThan(afterOne - before);
      expect(Math.abs(afterEight - afterOne - onePixel * GRID_DESIGN_PX)).toBeLessThanOrEqual(onePixel / 10);
    } finally {
      // Nothing was saved: a drag changes the draft in the browser and the operator still has to
      // press "Save draft". Leaving the page is therefore the whole cleanup, and it is the safe
      // one — pressing "Reset to live" would write to the fixture the wording baseline reads.
      await page.goto(SCENE_PATH);
      await expect(page.getByText("Live and draft match").first()).toBeVisible();
    }
  });
});
