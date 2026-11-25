import { expect, test, type Page } from "@playwright/test";

/**
 * Layout asserted by measurement on every workspace (M65), after the studio showed what a pixel
 * baseline cannot say: it froze a broken layout as the expected picture and did not see 16px
 * controls appear. These numbers are the layout rules in docs/ui.md, checked where they can fail.
 */

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

const SURFACES = [
  "/live?tab=status",
  "/live?tab=control",
  "/live?tab=moderation",
  "/program?tab=schedule&day=1",
  "/program?tab=pools",
  "/program?tab=library",
  "/program?tab=sources",
  "/studio?tab=scene",
  "/studio?tab=engagement",
  "/studio?tab=output",
  "/admin?tab=settings",
  "/admin?tab=team"
];

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const stack = document.querySelector(".content-stack");
    const rail = document.querySelector(".admin-status-rail");
    const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
    return {
      clientWidth: doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      stackWidth: rect(stack)?.width ?? 0,
      stackRight: rect(stack)?.right ?? 0,
      railWidth: rect(rail)?.width ?? 0
    };
  });
}

test.describe("workspace layout", () => {
  test("no operator surface scrolls horizontally, at the baseline width and on a wide display", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page);
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const path of SURFACES) {
        await page.goto(path);
        await expect(page.locator(".content-stack")).toBeVisible();
        const m = await measure(page);
        // docs/ui.md: no operator surface should require horizontal page scrolling.
        expect(m.scrollWidth, `${path} @ ${width}: page wider than the viewport`).toBeLessThanOrEqual(m.clientWidth);
        // The content column ends inside the viewport and never grows past the widest cap.
        expect(m.stackRight, `${path} @ ${width}: content column past the viewport`).toBeLessThanOrEqual(m.clientWidth);
        expect(m.stackWidth, `${path} @ ${width}: content column over the cap`).toBeLessThanOrEqual(1800);
        // The status rail wraps inside the column instead of stretching it (the M59 regression).
        expect(m.railWidth, `${path} @ ${width}: status rail wider than its column`).toBeLessThanOrEqual(m.stackWidth + 1);
      }
    }
  });

  test("the workspace cap holds on a very wide display and the studio is the one surface that widens", async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1200 });
    await signIn(page);
    await page.goto("/admin?tab=settings");
    const admin = await measure(page);
    expect(admin.stackWidth).toBeLessThanOrEqual(1440);
    await page.goto("/studio?tab=scene");
    const studio = await measure(page);
    expect(studio.stackWidth).toBeGreaterThan(1440);
    expect(studio.stackWidth).toBeLessThanOrEqual(1800);
    expect(studio.scrollWidth).toBeLessThanOrEqual(studio.clientWidth);
  });

  // M90, U9 (planning/archive/research/ux-install.md): measured at 390 px the panel an operator needs at
  // night, "Open problems", sat at y = 5 723 of a 6 256 px page. docs/ui.md now makes the on-call
  // check of Live → Control the one mobile commitment; this holds it.
  test("on a phone, Open problems is near the top of Live control", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto("/live?tab=control");
    const panel = page.getByTestId("open-problems");
    await expect(panel).toBeVisible();
    const top = await panel.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
    expect(top, "Open problems below y = 1400 at 390 px").toBeLessThan(1400);
    const m = await measure(page);
    expect(m.scrollWidth, "Live control wider than a phone").toBeLessThanOrEqual(m.clientWidth);
  });

  // M129 (suggestion 23): one page header per page. Live control used to stack the Live workspace
  // header and a second control-room hero whose metric rail repeated the shared top strip cell for cell.
  test("one page header on Live control and Program library", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    for (const path of ["/live?tab=control", "/program?tab=library"]) {
      await page.goto(path);
      const stack = page.locator(".content-stack");
      await expect(stack).toBeVisible();
      await expect(stack.locator(".hero"), `${path}: page headers`).toHaveCount(1);
      await expect(stack.getByRole("heading", { level: 2 }), `${path}: level-2 headings`).toHaveCount(1);
    }
    // The shared top strip is the page's one Feed/Current/Next/Destination strip.
    await page.goto("/live?tab=control");
    await expect(page.locator(".content-stack span.label").filter({ hasText: /^Current$/ })).toHaveCount(1);
  });

  // M129: at the baseline desktop size the panel an operator needs first starts without scrolling.
  test("at 1440x900 Open problems is above the fold", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    await page.goto("/live?tab=control");
    const panel = page.getByTestId("open-problems");
    await expect(panel).toBeVisible();
    expect(await page.evaluate(() => window.scrollY), "page scrolled before measuring").toBe(0);
    const box = await panel.boundingBox();
    expect(box, "Open problems has no box").not.toBeNull();
    expect(box!.y, "Open problems starts below the 900 px fold").toBeLessThan(900);
    const heading = await panel.getByRole("heading", { name: "Open problems" }).boundingBox();
    expect(heading, "Open problems heading has no box").not.toBeNull();
    expect(heading!.y + heading!.height, "Open problems heading below the 900 px fold").toBeLessThanOrEqual(900);
  });

  // M129 (suggestion 24): every output row and every source row starts with a badge whose words say the
  // state; the class only repeats it. Pixel tolerance hides a pill, so this reads the DOM.
  test("output and source rows start with a state badge", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    const rowsOf = (heading: string) =>
      page.locator(".panel").filter({ has: page.locator("h3", { hasText: new RegExp(`^${heading}$`) }) }).locator(".list > .item");
    const leadingBadges = (rows: ReturnType<typeof rowsOf>) =>
      rows.evaluateAll((items) =>
        items.map((item) => {
          let first: Element = item;
          while (first.firstElementChild && !first.matches(".badge")) {
            first = first.firstElementChild;
          }
          const text = first.textContent?.trim() ?? "";
          return {
            text,
            className: first.matches(".badge") ? first.className : "",
            startsTheRow: (item.textContent ?? "").trimStart().startsWith(text)
          };
        })
      );
    const BADGE_CLASS: Record<string, string> = {
      Ready: "badge badge-ready",
      "Needs setup": "badge badge-action",
      Failing: "badge badge-critical"
    };
    const expectStateBadges = (badges: Awaited<ReturnType<typeof leadingBadges>>, where: string) => {
      expect(badges.length, `${where}: no rows`).toBeGreaterThan(0);
      for (const badge of badges) {
        expect(Object.keys(BADGE_CLASS), `${where}: badge words`).toContain(badge.text);
        expect(badge.className, `${where}: ${badge.text} badge class`).toBe(BADGE_CLASS[badge.text]);
        expect(badge.startsTheRow, `${where}: ${badge.text} badge is not first`).toBe(true);
      }
      return badges.map((badge) => badge.text);
    };

    await page.goto("/live?tab=control");
    const outputs = expectStateBadges(await leadingBadges(rowsOf("Sending to Twitch")), "Sending to Twitch");
    // The fixture: the primary Twitch output is ready, the relay and the backup are not set up.
    expect(outputs).toContain("Ready");
    expect(outputs).toContain("Needs setup");

    await page.goto("/program?tab=sources");
    expectStateBadges(await leadingBadges(rowsOf("Source connectors")), "Source connectors");

    // The detail page leads with the same badge, outside the heading, so the heading still names only the source.
    const firstRow = rowsOf("Source connectors").first();
    const name = (await firstRow.locator("strong").first().textContent())?.trim() ?? "";
    const listBadge = (await firstRow.locator(".badge").first().textContent())?.trim() ?? "";
    await firstRow.getByRole("link", { name: "Open detail" }).click();
    await expect(page).toHaveURL(/\/sources\//);
    const hero = page.locator(".content-stack .hero");
    await expect(hero.getByRole("heading", { level: 2 })).toHaveText(name);
    const beforeHeading = await hero.locator("h2").evaluate((heading) => {
      const badge = heading.previousElementSibling;
      return { className: badge?.className ?? "", text: badge?.textContent?.trim() ?? "" };
    });
    expect(beforeHeading.text).toBe(listBadge);
    expect(beforeHeading.className).toBe(BADGE_CLASS[listBadge]);
  });

  // M129 (suggestion 25): destructive actions look destructive, disabled buttons recede, and an action
  // group never offers two primary buttons. Folded controls count too: they are measured in the DOM.
  test("danger, disabled and primary buttons", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    const disabledStyles: { opacity: number; borderWidth: string; borderColor: string }[] = [];
    for (const [path, danger] of [
      ["/live?tab=control", "Remove next"],
      ["/program?tab=library", "Delete curated set"],
      ["/program?tab=sources", ""]
    ] as const) {
      await page.goto(path);
      await expect(page.locator(".content-stack")).toBeVisible();
      if (danger) {
        await expect(page.locator("button", { hasText: new RegExp(`^${danger}$`) }), `${path}: ${danger}`).toHaveClass(
          "button button-danger"
        );
      }
      disabledStyles.push(
        ...(await page.locator(".content-stack button.button:disabled").evaluateAll((buttons) =>
          buttons.map((button) => {
            const style = getComputedStyle(button);
            return { opacity: Number(style.opacity), borderWidth: style.borderTopWidth, borderColor: style.borderTopColor };
          })
        ))
      );
      const crowdedGroups = await page.locator(".content-stack").evaluate((stack) => {
        const primaries = new Map<Element, number>();
        for (const control of Array.from(stack.querySelectorAll("button.button, a.button"))) {
          if (control.className.trim() === "button" && control.parentElement) {
            primaries.set(control.parentElement, (primaries.get(control.parentElement) ?? 0) + 1);
          }
        }
        return [...primaries.entries()].filter(([, count]) => count > 1).map(([group]) => group.textContent?.slice(0, 80));
      });
      expect(crowdedGroups, `${path}: action groups with more than one primary button`).toEqual([]);
    }
    expect(disabledStyles.length, "no disabled button on these pages").toBeGreaterThan(0);
    for (const style of disabledStyles) {
      expect(style.opacity).toBeLessThanOrEqual(0.5);
      const borderHidden = style.borderWidth === "0px" || style.borderColor === "transparent" || /,\s*0\)$/.test(style.borderColor);
      expect(borderHidden, `disabled border ${style.borderWidth} ${style.borderColor}`).toBe(true);
    }
  });
});
