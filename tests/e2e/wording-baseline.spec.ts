import { expect, test, type Page } from "@playwright/test";

// What each surface says, as reviewable text.
//
// The visual baseline cannot see wording. It tolerates a fraction of the page to absorb sub-pixel
// text rendering, and these surfaces are several thousand pixels tall, so relabelling a handful of
// lines stays under the threshold — three separate wording changes passed through it untouched
// while this was being written, and a regression would have passed just as quietly.
//
// So the words get their own baseline. It is plain text rather than pixels, which means a change
// shows up in review as the sentence that changed rather than as a count of differing pixels, and
// it cannot go quietly red on antialiasing.
//
//   scripts/design-baseline.sh            verify
//   scripts/design-baseline.sh --update   re-record
//
// Anything genuinely per-run is replaced before comparing, not masked: a placeholder in the text is
// visible in review, whereas a masked region silently covers whatever grows underneath it.

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

type Surface = {
  name: string;
  path: string;
  authenticated?: boolean;
};

const SURFACES: Surface[] = [
  { name: "channel", path: "/channel", authenticated: false },
  { name: "login", path: "/login", authenticated: false },
  { name: "live-control", path: "/live?tab=control" },
  { name: "live-status", path: "/live?tab=status" },
  { name: "live-moderation", path: "/live?tab=moderation" },
  // Pinned to a weekday so the grid is the same every run. It was missing from this list until the
  // fixture week became gapless — the page most affected by that change was the one not covered.
  { name: "program-schedule", path: "/program?tab=schedule&day=1" },
  { name: "program-pools", path: "/program?tab=pools" },
  { name: "program-library", path: "/program?tab=library" },
  { name: "program-sources", path: "/program?tab=sources" },
  { name: "studio-scene", path: "/studio?tab=scene" },
  { name: "studio-engagement", path: "/studio?tab=engagement" },
  { name: "studio-output", path: "/studio?tab=output" },
  { name: "admin-settings", path: "/admin?tab=settings" },
  { name: "admin-team", path: "/admin?tab=team" }
];

/** Replacements for the parts that legitimately differ every run. */
const VOLATILE: Array<[RegExp, string]> = [
  [/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<timestamp>"],
  [/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "<time>"],
  // Full semver, including a prerelease or build suffix: "2.0.0-rc.1" must mask as one token, or every
  // release candidate rewrites the admin-settings reference (CI on the rc.1 bump caught "<version>-rc.1").
  [/\bv?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b/g, "<version>"],
  [/\bsha256:[0-9a-f]+/g, "<digest>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<id>"],
  // Ages, not configured durations: "162d 20h" is how long ago something happened and grows while
  // nobody is looking. It went into the first recording as a literal and would have turned this
  // baseline red an hour later — the exact failure mode it exists to avoid. Configured values like
  // "180 minutes" are deliberately not covered: those are settings, and a change to one is a change
  // worth seeing.
  [/\b\d+d \d+h\b/g, "<age>"],
  [/\b\d+h \d+m\b/g, "<age>"],
  [/\b\d+m \d+s\b/g, "<age>"],
  // The spoken form of the same thing, from the source-health sentences ("Last checked 4 minutes
  // ago, found 49 videos"). Separate from the compact shapes above because it is a different
  // sentence, not a different unit. Anchored on the trailing "ago" on purpose: that is what makes
  // it an age rather than a configured duration, so "180 minutes" in a settings field stays
  // deliberately uncovered exactly like the note above says it should. `describeElapsed` emits
  // "less than a minute ago" rather than "just now" so that this one pattern covers every age it
  // can produce.
  [/\b(?:\d+ (?:seconds?|minutes?|hours?|days?)|less than a minute) ago\b/g, "<age> ago"],
  // What is on air, and on which day.
  //
  // Two separate clocks reach these pages. Making the seeded week gapless fixed the first — there is
  // always something scheduled — but the blocks differ by hour, and the day still turns: Monday
  // became Tuesday overnight and five surfaces changed at once, naming a different block, a
  // different category, a different weekday, and rotating the week grid to start elsewhere.
  //
  // Which programme is playing is fixture data. The labels and sentences around it are the product,
  // and those are what this baseline is for. The names below are the fixture's own, listed here so
  // it is visible that they are being substituted rather than checked.
  [/Abendprogramm — Folge \d+/g, "<asset>"],
  [/\b(?:Nachtschleife|Tagesprogramm|Abendprogramm)\b/g, "<block>"],
  [/\b(?:Archiv|Talk|Musik)\b/g, "<category>"],
  [/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g, "<day>"],
  // "Selected from Lokale Bibliothek for 840 minutes": how much of a block the fill still covers
  // is decided by the wall clock against the seeded schedule, like the rail values above. It went
  // 840 -> 1020 between the day the snapshot was taken and a Saturday afternoon, on CI and locally
  // alike, and took the release run down with it. Data, not wording.
  [/\bfor \d+ minutes\b/g, "for <minutes> minutes"],
  [/\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)\b/g, "<DAY>"],
  // The week lens starts at today, so each day card's scheduled/projected total changes rows at
  // midnight — the first midnight run after the day-name fix above swapped "1440m scheduled" with
  // "1500m scheduled" and nothing else. These are aggregates whose *position* follows the clock,
  // unlike a configured "180 minutes", which stays deliberately uncovered.
  [/\b\d+m (scheduled|projected)\b/g, "<minutes> $1"],
  [/\b\d+h scheduled\b/g, "<hours> scheduled"]
];

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
}

function normalize(text: string): string {
  let normalized = text;
  for (const [pattern, replacement] of VOLATILE) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

test.describe("wording baseline", () => {
  for (const surface of SURFACES) {
    test(`${surface.name} says what it said`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: 1440, height: 1600 });

      if (surface.authenticated !== false) {
        await signIn(page);
      }

      await page.goto(surface.path);
      const shell = page.locator("main, .content-stack").first();
      await expect(shell).toBeVisible();

      // Collapsed groups are part of what a page says, so their summaries are included and their
      // contents are not — the same thing a reader sees.
      //
      // The status rail's values are dropped, its labels kept. What is on air right now is decided
      // by the wall clock against the seeded schedule, and this baseline went red on fourteen
      // surfaces at once when the day crossed a schedule boundary — one shared region, every
      // authenticated page. Those values are data, not wording; the labels above them are wording,
      // and stay covered.
      // Rewritten in the live document rather than in a clone: innerText needs layout, and a
      // detached node has none, so a clone collapses the whole page onto one line. The readable
      // diff is the point of this baseline. The page is discarded after the test either way.
      const text = await shell.evaluate((root) => {
        for (const value of root.querySelectorAll(".admin-status-rail strong, .admin-status-rail .subtle, .status-rail strong")) {
          value.textContent = "<runtime>";
        }
        // The preview drawn by the on-air renderer is a picture of the scene, not wording. Its text
        // is the operator's own draft laid out by satori — including a live clock — and it arrives
        // a moment after the page, so it is neither this baseline's subject nor stable enough to be
        // in it. The caption above it is wording and stays.
        for (const frame of root.querySelectorAll(".scene-render-preview")) {
          frame.textContent = "<rendered scene>";
        }
        return (root as HTMLElement).innerText;
      });

      expect(normalize(text)).toMatchSnapshot(`${surface.name}.txt`);
    });
  }
});
