import { expect, test } from "@playwright/test";

// M100: the public programme on a phone, and its calendar feed.
//
// Runs on the design-baseline stack (scripts/design-baseline.sh): the seeded week is gapless, so there is
// always a block on air and a Now card to measure.

test.describe("public programme", () => {
  test("the Now card is above the fold at 390 px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/channel");
    const now = page.locator(".channel-now");
    await expect(now).toBeVisible();
    const box = await now.boundingBox();
    expect(box, "the Now card has a box").not.toBeNull();
    // Its whole card, not just its top edge, inside the first screen.
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
  });

  test.describe("in a zone other than the channel's", () => {
    test.use({ timezoneId: "America/New_York" });

    test("writes the viewer's zone first and names the channel's", async ({ page }) => {
      await page.goto("/channel");
      // The fixture channel's zone is Europe/Berlin; the note switches once the page has hydrated.
      await expect(page.locator(".channel-public")).toContainText(/Channel time: |Sendezeit des Kanals: /);
    });
  });

  test("serves the week as a calendar feed", async ({ request }) => {
    const response = await request.get("/channel.ics");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/calendar");
    const body = await response.text();
    expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(body).toContain("BEGIN:VEVENT");
    expect(body.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
});
