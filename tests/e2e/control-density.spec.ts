import { expect, test, type Page } from "@playwright/test";

// How many things a page asks you to choose between.
//
// "Simple and intuitive" is easy to agree with and easy to argue about, so this measures it instead:
// the number of controls actually visible on a surface, and whether one of them reads as the primary
// action. Counting is not the goal — a page can be dense and clear — but a page an operator opens
// during an incident should not present twenty equal-weight choices, and without a number that
// judgement stays a matter of taste.
//
// The budgets below are recorded from the current pages, not invented. They are a ratchet: they may
// be lowered as surfaces are simplified, and raising one should be a deliberate decision with a
// reason, not something that happens by accident.

const ownerEmail = process.env.E2E_OWNER_EMAIL || "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD || "stream247-owner-pass";

type Surface = {
  name: string;
  path: string;
  /** Ceiling for visible controls, taken from the page as it stands today. */
  maxControls: number;
  /**
   * How many primary actions this page is expected to carry.
   *
   * One almost everywhere. Zero for surfaces that only show you something — inventing a primary
   * button for a page with nothing to be primary about would satisfy the rule and make the page
   * worse. More than one only where a page holds genuinely separate panels, each owning its own
   * save; that is two tasks, not two competing answers to one. Every value above one needs the
   * reason written next to it.
   */
  primaryActions: number;
  /** Public surfaces are measured without signing in, because that is how they are seen. */
  authenticated?: boolean;
};

const SURFACES: Surface[] = [
  // The page the audience actually lands on, and the only one here that is not an operator tool.
  { name: "channel", path: "/channel", maxControls: 1, primaryActions: 1, authenticated: false },
  // The page an operator opens when something is wrong. It showed 33 at once, six of them repair
  // actions of equal weight, with the order to try them explained in a paragraph above the form.
  // Now 22: the repairs fold away, and so does bringing in an outside feed — a separate job whose
  // three fields and two buttons had been scattered across the page rather than kept together.
  // Then 21: the "Open public overlay" link went with the browser overlay page it opened — the
  // picture is drawn by the playout now, and the studio preview is the same drawing.
  { name: "live-control", path: "/live?tab=control", maxControls: 21, primaryActions: 1 },
  // Was 62, because the full editor stood open under every destination and the count therefore grew
  // with the number of outputs configured. Folding those away leaves what the page is for.
  // 27: two of the three "Open setup" links removed as dead ends came back with real targets — the
  // M52 wizard gave APP_URL and the app secret actual steps to open. A link that goes somewhere is
  // not clutter, so the budget moves with it.
  { name: "live-status", path: "/live?tab=status", maxControls: 27, primaryActions: 1 },
  { name: "program-schedule", path: "/program?tab=schedule&day=1", maxControls: 14, primaryActions: 0 },
  // The overlay editor, where editing is the point — so this one is folded rather than trimmed. Was
  // 79; twenty-four of those were three buttons on each of eight layers, held open permanently, and
  // one more was a select offering the same six presets as the cards beside it.
  // 56: the M57 source layer adds an eighth button to the add-layer palette. Hiding one palette
  // button while its seven siblings stay visible would suggest the layer kind does not exist, so
  // the ratchet moves by exactly that button; the source manager's add/edit form folds instead.
  // 62: M58 named scenes add six, and the count must not grow with the number of scenes — which is
  // why the picker is a select and not one control per scene, the way program-pools was fixed. The
  // six are: which scene (select), its name (input), the video source it is about (select), and
  // add / duplicate / delete. None of them folds. A fold would say "you may have several scenes,
  // but not here", and the whole point of the page is now that a channel has more than one scene;
  // the name and the source binding belong beside the picker because they describe the thing the
  // picker just selected.
  // 64, measured, was 62 (and the page measured 61 against it — one of slack). The three added are
  // the drag handles on the preview: one per box the frame actually draws, which in the fixture is
  // the lower third, the next card and the clock. They are controls and are counted as controls,
  // because that is what they are — the operator can now move a panel by taking hold of it, and
  // pretending otherwise would be measuring a page that does not exist.
  //
  // What is NOT counted, deliberately: the eight resize grips a selected box grows. They are spans
  // with no role and no tabindex, so eight per panel do not triple this page; the keyboard reaches
  // the same box through the panel's own button, where the arrow keys move it. That is the whole
  // reason the grips are not focusable.
  //
  // The number tracks what is on the frame rather than the number of scenes — placing the vote or
  // chat panel from the sidebar adds one each, and an enabled logo or text layer adds one, the same
  // way program-library's budget tracks the seeded assets. A layer already brings ten controls to
  // the sidebar; its handle is not what makes that grow.
  //
  // Still 64 after the ticker became the seventh panel, and that is a measurement rather than an
  // oversight. Three things could have moved it and none does on this fixture: the ticker's row in
  // the panel placement list is inside a fold that starts closed, so checkVisibility does not count
  // it; its drag handle follows the emergency banner's rule and appears only while the ticker has
  // text, which the fixture does not set; and the dwell field appears only once that text holds
  // more than one message. A channel that runs a rotating ticker will measure two more than this,
  // by the same rule that says a placed vote panel measures one more.
  { name: "studio-scene", path: "/studio?tab=scene", maxControls: 64, primaryActions: 1 },
  // 31, was 30: M56 moved the EventSub webhook secret into the managed credentials form, and a
  // secret belongs beside the other secrets rather than in a fold of its own — every sibling
  // ("client secret", "SMTP password") is permanently visible, and hiding just this one would
  // make the page suggest it does not exist. Everything else M56 added to this page (disk
  // watermark, feature switches) is folded and adds nothing to the count. M56 part 2 continued
  // the same way: the replay cache, the watchdog thresholds and the feed tuning are three more
  // folded groups in the operations panel — twenty-six controls that would have tripled this
  // page, all behind summaries, so the budget does not move.
  { name: "admin-settings", path: "/admin?tab=settings", maxControls: 31, primaryActions: 1 },
  { name: "login", path: "/login", maxControls: 3, primaryActions: 1, authenticated: false },
  { name: "live-moderation", path: "/live?tab=moderation", maxControls: 20, primaryActions: 1 },
  { name: "program-pools", path: "/program?tab=pools", maxControls: 17, primaryActions: 1 },
  // 35, not 31. The earlier number was recorded when the fixture seeded no assets at all, so the
  // library page was counted with nothing in it. Two assets bring two controls each. Of the fourteen
  // surfaces this is the only one whose count depended on that, which is why it is the only budget
  // that moved — but the number it replaces described an empty page, not a simpler one.
  { name: "program-library", path: "/program?tab=library", maxControls: 35, primaryActions: 1 },
  { name: "program-sources", path: "/program?tab=sources", maxControls: 30, primaryActions: 1 },
  // Three panels that save separately: chat and alerts, what chat is allowed to steer, and the
  // chat game. Each is its own task with its own save, which is the documented exception to the
  // one-primary rule — a shared save across unrelated panels would be the worse design.
  { name: "studio-engagement", path: "/studio?tab=engagement", maxControls: 48, primaryActions: 3 },
  { name: "studio-output", path: "/studio?tab=output", maxControls: 20, primaryActions: 1 },
  { name: "admin-team", path: "/admin?tab=team", maxControls: 11, primaryActions: 1 }
];

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/live(?:\?tab=control)?$/);
}

test.describe("control density", () => {
  for (const surface of SURFACES) {
    test(`${surface.name} keeps its controls countable`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: 1440, height: 1600 });
      if (surface.authenticated !== false) {
        await signIn(page);
      }
      await page.goto(surface.path);

      const shell = page.locator("main, .content-stack").first();
      await expect(shell).toBeVisible();

      const measured = await shell.evaluate((root) => {
        // The (i) beside a label opens an explanation; it is not something the operator does to the
        // channel, so it does not count against the surface's control budget.
        const selector = "button:not(.info-tip-button), a[href], input, select, textarea, [role=button]:not(.info-tip-button), [role=tab]";
        // checkVisibility, not bounding boxes. A control inside a closed <details> keeps its last
        // measured size — Chromium hides that content with content-visibility rather than by taking
        // it out of layout — so measuring rects reports collapsed groups as still on screen, which
        // is exactly the thing this test exists to detect.
        const visible = [...root.querySelectorAll<HTMLElement>(selector)].filter((element) =>
          element.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true, opacityProperty: true })
        );

        // The primary style is the plain .button class; everything else carries a modifier. If a
        // page has none, nothing tells you where to start; if it has several, none of them lead.
        const primaries = visible.filter(
          (element) => element.classList.contains("button") && element.className.trim() === "button"
        );

        return {
          total: visible.length,
          primaries: primaries.map((element) => (element.textContent || "").trim()),
          labels: visible.map((element) => (element.textContent || element.getAttribute("aria-label") || "").trim())
        };
      });

      // Reported on every run: the number is the point, and a silently passing budget teaches nothing.
      console.log(`${surface.name}: ${measured.total} controls, primary: [${measured.primaries.join(", ")}]`);
      console.log(`  ${measured.labels.filter(Boolean).join(" | ")}`);

      expect(measured.total).toBeLessThanOrEqual(surface.maxControls);

      // Two primary buttons is not twice as clear. The settings page carried "Save encrypted
      // settings" and "Export channel blueprint" side by side and neither led; the pools page had
      // one "Update pool" per pool, so the count grew with the content.
      expect(measured.primaries).toHaveLength(surface.primaryActions);
    });
  }
});
