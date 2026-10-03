import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server";
import { buildMaterializedProgrammingWeek, type ScheduleBlock } from "@stream247/core";

// M97 (U5, U6): the week view as an operator reads it, and the confirmation before a template replaces
// the week. Rendered for real; the template form is called with React's state hooks replaced by plain
// values, so its own submit handler runs without a DOM (as in three-am-answer.test.ts).

const hooks = vi.hoisted(() => ({ stateful: false }));

vi.mock("../../apps/web/node_modules/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../apps/web/node_modules/react")>();
  return {
    ...actual,
    useState: (initial: unknown) =>
      hooks.stateful ? actual.useState(initial) : [typeof initial === "function" ? (initial as () => unknown)() : initial, () => undefined],
    useTransition: () => (hooks.stateful ? actual.useTransition() : [false, (callback: () => void) => callback()])
  };
});

vi.mock("../../apps/web/node_modules/next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined })
}));

vi.mock("../../apps/web/node_modules/next/link", () => ({
  default: (props: { href: string; children?: unknown }) => React.createElement("a", { href: props.href }, props.children as never)
}));

vi.mock("../../apps/web/components/ui/Toast", () => ({
  useToast: () => ({ pushToast: () => undefined })
}));

import { ProgramWeekLens } from "../../apps/web/components/program-week-lens";
import { ProgrammingTemplateForm, describeTemplateReplaceConfirmation } from "../../apps/web/components/programming-template-form";
import type { AssetRecord } from "../../apps/web/lib/server/state";

// The components use the classic JSX runtime under vitest.
(globalThis as { React?: unknown }).React = React;

const block = (overrides: Partial<ScheduleBlock> & Pick<ScheduleBlock, "id" | "dayOfWeek" | "startMinuteOfDay" | "durationMinutes">): ScheduleBlock => ({
  title: overrides.id,
  categoryName: "Archive",
  sourceName: "Pool",
  poolId: "pool-1",
  ...overrides
});

const pool = { id: "pool-1", name: "Abendprogramm", sourceIds: ["source-1"], cursorAssetId: "", insertAssetId: "", insertEveryItems: 0, itemsSinceInsert: 0 };
const assets = [1, 2, 3].map((index) => ({
  id: `item-${index}`,
  sourceId: "source-1",
  title: `Folge ${index}`,
  status: "ready",
  includeInProgramming: true,
  durationSeconds: 120,
  createdAt: `2026-09-0${index}T00:00:00.000Z`
}));

describe("U5/U6: the week view", () => {
  // 2026-10-03 is a Saturday: a 24 h grid with a block past midnight on Saturday night.
  const days = buildMaterializedProgrammingWeek({
    startDate: "2026-10-03",
    blocks: [
      block({ id: "sat-day", title: "Tagesprogramm", dayOfWeek: 6, startMinuteOfDay: 0, durationMinutes: 23 * 60 }),
      block({ id: "sat-late", title: "Nachtprogramm", dayOfWeek: 6, startMinuteOfDay: 23 * 60, durationMinutes: 120 }),
      block({ id: "sun-day", title: "Sonntag", dayOfWeek: 0, startMinuteOfDay: 60, durationMinutes: 23 * 60 })
    ],
    pools: [pool],
    assets
  });
  const html = renderToStaticMarkup(ProgramWeekLens({ days, assets: assets as unknown as AssetRecord[] }));

  it("dates the day headers and counts hours, not minutes", () => {
    expect(html).toContain("Sat 3 Oct");
    expect(html).toContain("Sun 4 Oct");
    expect(html).toContain("24 h scheduled");
    expect(html).not.toMatch(/\d+m scheduled/);
  });

  it("lists the overnight block once, ending '→ 01:00 Sun'", () => {
    expect(html.match(/Nachtprogramm/g)?.length).toBe(1);
    expect(html).toContain("23:00 → 01:00 Sun");
  });

  it("says why a block repeats, with numbers", () => {
    expect(html).toContain("6 min of video for a 23 h block: plays ≈ 230 times. Add videos to Abendprogramm.");
  });

  it("offers 'Edit block' per block and 'Add block' per day, into the day lens", () => {
    expect(html).toContain('href="/program?tab=schedule&amp;lens=day&amp;day=6#schedule-block-sat-late"');
    expect(html.match(/>Edit block</g)?.length).toBe(3);
    expect(html).toContain('href="/program?tab=schedule&amp;lens=day&amp;day=6&amp;add=1#add-schedule-block"');
    expect(html.match(/>Add block</g)?.length).toBe(7);
  });
});

describe("U6: 'Replace existing schedule blocks' asks first", () => {
  const fetchMock = vi.fn();
  const confirmMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
    confirmMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { confirm: confirmMock });
    // The handler reads the fields through FormData(form); the fake form carries them as a map.
    vi.stubGlobal(
      "FormData",
      class {
        private readonly values: Record<string, string>;
        constructor(form: { values: Record<string, string> }) {
          this.values = form.values;
        }
        get(name: string) {
          return this.values[name] ?? null;
        }
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function submit(existingBlockCount: number, replaceExisting: boolean) {
    const element = ProgrammingTemplateForm({ pools: [{ id: "pool-1", name: "Abendprogramm" }], existingBlockCount }) as unknown as {
      props: { onSubmit: (event: unknown) => void };
    };
    element.props.onSubmit({
      preventDefault: () => undefined,
      currentTarget: {
        values: { template: "always-on-single-pool", primaryPoolId: "pool-1", ...(replaceExisting ? { replaceExisting: "on" } : {}) }
      }
    });
  }

  it("Cancel sends nothing, so the blocks stay; OK replaces", () => {
    confirmMock.mockReturnValueOnce(false);
    submit(21, true);
    expect(confirmMock).toHaveBeenLastCalledWith(describeTemplateReplaceConfirmation(21));
    expect(fetchMock).not.toHaveBeenCalled();

    confirmMock.mockReturnValueOnce(true);
    submit(21, true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as { body: string }).body)).replaceExisting).toBe(true);
  });

  it("does not ask when nothing would be replaced", () => {
    submit(21, false);
    submit(0, true);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("names how many blocks go", () => {
    expect(describeTemplateReplaceConfirmation(21)).toBe(
      "Replace the whole schedule? The 21 schedule blocks you have now are deleted before the template is applied. This cannot be undone."
    );
  });
});
