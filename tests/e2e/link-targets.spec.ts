import { expect, test, type Page } from "@playwright/test";

// Every link on every surface has to go somewhere.
//
// Written after finding three "Open setup" links on the go-live checklist that could not work:
// APP_URL and APP_SECRET are server environment variables with no screen behind them, and /setup
// redirects to the login page as soon as a workspace exists. They were dead ends presented as
// answers, on the page someone reads while trying to get on air, and nothing in the suite objected
// — a screenshot shows a link, and a wording snapshot shows its text.
//
// This follows them. A link that lands on the login page while signed in is the specific shape of
// that bug: the app deciding you should not be where the link said you could go.

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

const SURFACES = [
  { name: "channel", path: "/channel", authenticated: false },
  { name: "live-control", path: "/live?tab=control", authenticated: true },
  { name: "live-status", path: "/live?tab=status", authenticated: true },
  { name: "program-schedule", path: "/program?tab=schedule&day=1", authenticated: true },
  { name: "program-library", path: "/program?tab=library", authenticated: true },
  { name: "program-sources", path: "/program?tab=sources", authenticated: true },
  { name: "studio-scene", path: "/studio?tab=scene", authenticated: true },
  { name: "admin-settings", path: "/admin?tab=settings", authenticated: true }
];

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
}

test.describe("links go somewhere", () => {
  for (const surface of SURFACES) {
    test(`${surface.name} has no dead ends`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1440, height: 1600 });

      if (surface.authenticated) {
        await signIn(page);
      }

      await page.goto(surface.path);
      await expect(page.locator("main, .content-stack").first()).toBeVisible();

      const targets = await page.evaluate(() => {
        const root = document.querySelector("main, .content-stack");
        if (!root) return [] as string[];

        return [...root.querySelectorAll<HTMLAnchorElement>("a[href]")]
          .filter((anchor) => anchor.getAttribute("target") !== "_blank")
          .map((anchor) => anchor.getAttribute("href") || "")
          .filter((href) => href.startsWith("/"));
      });

      // The public channel page links out to Twitch and nowhere inward, which is correct for it.
      if (surface.authenticated) {
        expect(targets.length, "an operator surface should link somewhere").toBeGreaterThan(0);
      }

      const deadEnds: string[] = [];
      for (const href of [...new Set(targets)]) {
        // Navigated, not fetched. An API request out of this context does not carry the session the
        // way a click does, and every operator link then looks like a redirect to the login page —
        // a false accusation against the product, from the test.
        const response = await page.goto(href);
        const status = response?.status() ?? 0;

        // A redirect is only a dead end when it drops what you asked for.
        //
        // Two earlier versions of this got it wrong in opposite directions. Checking for the login
        // page missed the case entirely: signed in, /setup sends you to the workspace rather than
        // bouncing you. Comparing paths then flagged /assets/<id>, which redirects to
        // /program?tab=library&assetId=<id> — the detail view moved into the workspace and carries
        // the id with it. That is a route being tidied, not a link going nowhere.
        //
        // What separates them is whether the destination still knows what you were asking about.
        const landed = new URL(page.url());
        const asked = new URL(href, page.url());
        const subject = asked.pathname.split("/").filter(Boolean).at(-1) ?? "";
        const carriedOver = subject.length > 0 && `${landed.pathname}${landed.search}`.includes(subject);

        if (landed.pathname !== asked.pathname && !carriedOver) {
          deadEnds.push(`${href} → ${landed.pathname}${landed.search}`);
        }
        if (status >= 400) {
          deadEnds.push(`${href} → ${status}`);
        }
        await page.goBack().catch(() => undefined);
      }

      expect(deadEnds).toEqual([]);
    });
  }
});
