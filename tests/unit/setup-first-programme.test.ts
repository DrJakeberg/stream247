import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server";
import { createInitialSeedState, type AppState } from "@stream247/db";

// M99 "Wizard to first programme" (planning/research/ux-install.md U1, U2, R2 U3): /setup asks for the
// stream key and builds a first programme, the destination forms live in Studio → Output, and the empty
// library says how media gets in.
//
// The pages are rendered for real with renderToStaticMarkup. The wizard's writes go through the real
// routes (/api/destinations, /api/pools, /api/schedule/templates) against an in-memory state, so the last
// test shows what the e2e shows on a stack: after both steps readiness counts destination, pools and
// schedule as ready.

const page = vi.hoisted(() => ({
  state: null as unknown,
  user: { id: "owner", email: "owner@example.com", displayName: "Owner", role: "owner" } as unknown
}));

const writes = vi.hoisted(() => ({
  managedStreamKeys: [] as string[]
}));

vi.mock("../../apps/web/node_modules/next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
  cookies: async () => ({ get: () => undefined })
}));

vi.mock("../../apps/web/node_modules/next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`redirect ${target}`);
  },
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined }),
  usePathname: () => "/setup"
}));

vi.mock("../../apps/web/node_modules/next/link", () => ({
  default: (props: { href: string; children?: unknown }) => React.createElement("a", { href: props.href }, props.children as never)
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" }
      });
    }
  }
}));

vi.mock("@/lib/server/state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../apps/web/lib/server/state")>();
  const current = () => page.state as AppState;
  return {
    ...actual,
    readAppState: async () => current(),
    appendAuditEvent: async () => undefined,
    createPoolRecord: async (pool: AppState["pools"][number]) => {
      page.state = { ...current(), pools: [...current().pools, pool] };
    },
    createScheduleBlocks: async (blocks: AppState["scheduleBlocks"]) => {
      page.state = { ...current(), scheduleBlocks: [...current().scheduleBlocks, ...blocks] };
    },
    replaceAllScheduleBlocks: async (blocks: AppState["scheduleBlocks"]) => {
      page.state = { ...current(), scheduleBlocks: blocks };
    },
    updateDestinationRecord: async (
      destination: AppState["destinations"][number],
      options?: { managedStreamKey?: string }
    ) => {
      if (options?.managedStreamKey) {
        writes.managedStreamKeys.push(options.managedStreamKey);
      }
      page.state = {
        ...current(),
        destinations: current().destinations.map((entry) => (entry.id === destination.id ? destination : entry))
      };
    }
  };
});

vi.mock("@/lib/server/auth", () => ({
  getAuthenticatedUser: async () => page.user,
  requireApiRoles: async () => null
}));

vi.mock("@/lib/server/twitch", () => ({
  getAbsoluteAppUrl: () => "",
  getTwitchBroadcasterRedirectUri: () => ""
}));

vi.mock("@/lib/server/twitch-accounts-panel", () => ({
  buildTwitchAccountsPanelProps: async () => ({ props: {} })
}));

vi.mock("@/components/twitch-accounts-panel", () => ({
  TwitchAccountsPanel: () => null
}));

import { PUT as putDestination } from "../../apps/web/app/api/destinations/route";
import { POST as postPool } from "../../apps/web/app/api/pools/route";
import { POST as postTemplate } from "../../apps/web/app/api/schedule/templates/route";
import OutputPage from "../../apps/web/app/(admin)/output/page";
import SetupPage from "../../apps/web/app/setup/page";
import { AssetLibraryBrowser, LibraryEmptyState } from "../../apps/web/components/asset-library-browser";
import { ToastProvider } from "../../apps/web/components/ui/Toast";
import { getGoLiveChecklist } from "../../apps/web/lib/server/onboarding";
import { createFirstProgramme, describeWeeklyBlocksInTheWay } from "../../apps/web/lib/setup-first-programme";
import { TWITCH_INGEST_URL } from "../../apps/web/lib/destination-wording";

(globalThis as { React?: unknown }).React = React;

const rootDir = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(rootDir, file), "utf8");

/** Owner, public URL, Twitch app and bot connected: the wizard is past its first four steps. */
function twitchDoneState(overrides: Partial<AppState> = {}): AppState {
  const seed = createInitialSeedState();
  return {
    ...seed,
    initialized: true,
    owner: { email: "owner@example.com", passwordHash: "salt:hash", createdAt: "2026-10-01T00:00:00.000Z" },
    managedConfig: {
      ...seed.managedConfig,
      appUrl: "https://stream.example",
      twitchClientId: "client",
      twitchClientSecret: "secret"
    },
    twitch: { ...seed.twitch, status: "connected", broadcasterLogin: "jimpanse247bot" },
    ...overrides
  };
}

function readyAsset(id: string, sourceId = "source-local-library"): AppState["assets"][number] {
  return {
    id,
    sourceId,
    title: `Video ${id}`,
    path: `/app/data/media/${id}.mp4`,
    status: "ready",
    includeInProgramming: true,
    durationSeconds: 1800,
    updatedAt: "2026-10-01T00:00:00.000Z"
  } as AppState["assets"][number];
}

async function renderSetup(step?: string): Promise<string> {
  return renderToStaticMarkup((await SetupPage({ searchParams: Promise.resolve(step ? { step } : {}) })) as never);
}

function jsonRequest(url: string, method: string, body: Record<string, unknown>) {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never;
}

beforeEach(() => {
  writes.managedStreamKeys = [];
  vi.unstubAllEnvs();
  // The seed reads these; a developer's shell must not decide what the wizard shows.
  for (const name of ["STREAM_OUTPUT_URL", "STREAM_OUTPUT_KEY", "TWITCH_RTMP_URL", "TWITCH_STREAM_KEY", "APP_URL"]) {
    vi.stubEnv(name, "");
  }
});

describe("U1: Where the stream goes (decided 5.1 Q9)", () => {
  it("follows the Twitch steps, with the Twitch preset and a masked key field", async () => {
    page.state = twitchDoneState();
    const html = await renderSetup();

    expect(html).toContain("Where the stream goes");
    expect(html).toContain("Without a stream key nothing goes on air.");
    expect(html).toContain("Primary Twitch Output");
    expect(html).toContain("Stream key missing");
    // Twitch is preselected and names its ingest; the key is a password field that keeps nothing.
    expect(html).toMatch(/<option value="twitch" selected="">Twitch<\/option>/);
    expect(html).toContain(`Streams to ${TWITCH_INGEST_URL}`);
    expect(html).toMatch(/<input[^>]*type="password"[^>]*value=""/);
    expect(html).toMatch(/<input[^>]*autoComplete="new-password"|<input[^>]*autocomplete="new-password"/i);
    expect(html).toContain("Stored encrypted with the app secret; it never appears in this form again.");
    expect(html).toContain("Skip this step for now");
    expect(html).toContain('href="/setup?step=programme"');
  });

  it("saves the key through the destination route, encrypted storage and no key in the answer", async () => {
    page.state = twitchDoneState();
    const response = await putDestination(
      jsonRequest("http://localhost/api/destinations", "PUT", {
        id: "destination-primary",
        provider: "twitch",
        enabled: true,
        rtmpUrl: TWITCH_INGEST_URL,
        streamKey: "live_000000000_wizardtestkey"
      })
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("wizardtestkey");
    expect(writes.managedStreamKeys).toEqual(["live_000000000_wizardtestkey"]);
    const primary = (page.state as AppState).destinations.find((entry) => entry.id === "destination-primary");
    expect(primary).toMatchObject({ rtmpUrl: TWITCH_INGEST_URL, streamKeyPresent: true, streamKeySource: "managed", status: "ready" });

    // The step reads as done and the page shows only that a key is stored, never the key.
    const html = await renderSetup("destination");
    expect(html).toContain("A destination with a stream key is ready.");
    expect(html).toContain("Stream key stored here");
    expect(html).not.toContain("wizardtestkey");
  });

  it("keeps a custom ingest the destination already has", async () => {
    const seed = twitchDoneState();
    page.state = {
      ...seed,
      destinations: seed.destinations.map((entry) =>
        entry.id === "destination-primary" ? { ...entry, rtmpUrl: "rtmp://ingest.example/live" } : entry
      )
    };
    const html = await renderSetup("destination");
    expect(html).toMatch(/<option value="custom-rtmp" selected="">Another RTMP service<\/option>/);
    expect(html).toContain('value="rtmp://ingest.example/live"');
  });
});

describe("U1: the destination forms live in Studio → Output", () => {
  it("renders the add form and each destination's editor there, under the anchor the wizard links to", async () => {
    page.state = twitchDoneState();
    // In the app the admin layout provides the toasts the output profile form uses.
    const html = renderToStaticMarkup(React.createElement(ToastProvider, null, (await OutputPage()) as never) as never);

    expect(html).toContain('id="output-destinations"');
    expect(html).toContain("Output destinations");
    expect(html).toContain("Add destination");
    expect(html).toContain("<summary>Change this destination</summary>");
    expect(html).toContain("Managed stream key");
  });

  it("leaves Live → Status a summary with a link, and sends the old section to the new place", () => {
    const status = read("apps/web/app/(admin)/dashboard/page.tsx");
    expect(status).toContain('title="Output destinations"');
    expect(status).not.toContain("DestinationCreateForm");
    expect(status).not.toContain("DestinationSettingsForm");
    expect(status).toContain('buildWorkspaceHref("studio", "output")}#output-destinations');
    expect(status).toContain('anchors={["output-destinations"]}');
    // Readiness and the wizard link to the new place.
    page.state = twitchDoneState();
    const destination = getGoLiveChecklist(page.state as AppState).find((item) => item.id === "destination");
    expect(destination?.href).toBe("/studio?tab=output");
  });
});

describe("U2: First programme", () => {
  it("says how to add media while no video is ready, with the upload form in the step", async () => {
    page.state = twitchDoneState();
    const html = await renderSetup("programme");

    expect(html).toContain("First programme");
    expect(html).toContain("No video is ready yet");
    expect(html).toContain("data/media");
    expect(html).toContain('href="/program?tab=sources"');
    expect(html).toContain("Upload into local library");
    expect(html).not.toContain("Create the pool and fill the week");
  });

  it("offers the sources with ready videos and creates the pool and the week from them", async () => {
    page.state = twitchDoneState({ assets: [readyAsset("a1"), readyAsset("a2")] });
    const html = await renderSetup("programme");

    expect(html).toContain("Local Media Library · 2 ready videos");
    expect(html).toContain("A pool is a playlist the schedule plays from.");
    expect(html).toContain("Create the pool and fill the week");
    // An empty week has nothing to replace, so the step does not ask.
    expect(html).not.toContain("Replace the blocks already in the week");
  });

  it("asks before replacing blocks the week already has", async () => {
    page.state = twitchDoneState({
      assets: [readyAsset("a1")],
      scheduleBlocks: [
        {
          id: "schedule_old",
          title: "Old",
          categoryName: "Replay",
          dayOfWeek: 1,
          startMinuteOfDay: 0,
          durationMinutes: 60,
          poolId: "pool_missing",
          sourceName: "",
          repeatMode: "single",
          repeatGroupId: ""
        } as AppState["scheduleBlocks"][number]
      ]
    });
    const html = await renderSetup("programme");
    expect(html).toContain("Replace the blocks already in the week");
    expect(html).toContain("The week has 1 block.");
    // R17: without Replace a weekly block can never take the all-day blocks, and the step says so.
    expect(html).toContain("The new all-day blocks overlap its weekly blocks, so the week is filled only with this ticked.");
  });
});

describe("R17: First programme on a week that already has weekly blocks", () => {
  const weeklyBlock = {
    id: "schedule_old",
    title: "Old",
    categoryName: "Replay",
    dayOfWeek: 1,
    startMinuteOfDay: 0,
    durationMinutes: 60,
    poolId: "pool_missing",
    sourceName: "",
    repeatMode: "single",
    repeatGroupId: ""
  } as AppState["scheduleBlocks"][number];

  // The form's fetch, answered by the real routes against the in-memory state.
  const routeFetch = vi.fn(async (url: string, init: { method: string; body: string }) => {
    const request = jsonRequest(`http://localhost${url}`, init.method, JSON.parse(init.body) as Record<string, unknown>);
    return url === "/api/pools" ? postPool(request) : postTemplate(request);
  });
  const programmePools = () => (page.state as AppState).pools.filter((entry) => entry.name === "Programme");

  beforeEach(() => {
    routeFetch.mockClear();
  });

  it("stops before writing anything when Replace is not ticked, and says why", async () => {
    page.state = twitchDoneState({ assets: [readyAsset("a1")], scheduleBlocks: [weeklyBlock] });
    const poolsBefore = (page.state as AppState).pools.length;
    for (let press = 0; press < 3; press += 1) {
      const result = await createFirstProgramme({
        name: "Programme",
        sourceIds: ["source-local-library"],
        replaceWeek: false,
        weeklyBlockCount: 1,
        createdPool: null,
        fetch: routeFetch
      });
      expect(result).toEqual({ status: "error", message: describeWeeklyBlocksInTheWay(1), pool: null });
    }
    expect(routeFetch).not.toHaveBeenCalled();
    expect((page.state as AppState).pools).toHaveLength(poolsBefore);
    expect((page.state as AppState).scheduleBlocks).toEqual([weeklyBlock]);
  });

  it("uses the pool of a failed press again, so the week is filled with one pool, not two", async () => {
    // A weekly block another editor saved after the page was drawn: the step counted none, the route refuses.
    page.state = twitchDoneState({ assets: [readyAsset("a1")], scheduleBlocks: [weeklyBlock] });
    const first = await createFirstProgramme({
      name: "Programme",
      sourceIds: ["source-local-library"],
      replaceWeek: false,
      weeklyBlockCount: 0,
      createdPool: null,
      fetch: routeFetch
    });
    expect(first.status).toBe("error");
    expect(first.pool).not.toBeNull();
    expect(programmePools()).toHaveLength(1);

    const second = await createFirstProgramme({
      name: "Programme",
      sourceIds: ["source-local-library"],
      replaceWeek: true,
      weeklyBlockCount: 1,
      createdPool: first.pool,
      fetch: routeFetch
    });
    expect(second).toEqual({ status: "done", pool: first.pool });
    expect(programmePools()).toHaveLength(1);
    const state = page.state as AppState;
    expect(state.scheduleBlocks).toHaveLength(7);
    expect(state.scheduleBlocks.every((entry) => entry.poolId === first.pool?.id)).toBe(true);
  });

  it("fills a week of dated blocks only without Replace, since they sit over the new weekly blocks", async () => {
    const dated = { ...weeklyBlock, id: "schedule_special", validFrom: "2026-10-12", validUntil: "2026-10-12" };
    page.state = twitchDoneState({ assets: [readyAsset("a1")], scheduleBlocks: [dated] });
    const html = await renderSetup("programme");
    expect(html).toContain("Without this its dated blocks stay and take the air at their times.");
    const result = await createFirstProgramme({
      name: "Programme",
      sourceIds: ["source-local-library"],
      replaceWeek: false,
      weeklyBlockCount: 0,
      createdPool: null,
      fetch: routeFetch
    });
    expect(result.status).toBe("done");
    expect((page.state as AppState).scheduleBlocks).toHaveLength(8);
  });
});

describe("the wizard ends with a stream key and a playing week", () => {
  it("after both steps readiness shows destination, pools and schedule ready and the wizard lands on Review", async () => {
    page.state = twitchDoneState({ assets: [readyAsset("a1"), readyAsset("a2")] });
    const before = getGoLiveChecklist(page.state as AppState);
    for (const id of ["destination", "pools", "schedule"]) {
      expect(before.find((item) => item.id === id)?.status, id).toBe("action");
    }

    // Step "Where the stream goes": what SetupDestinationForm sends.
    expect(
      (
        await putDestination(
          jsonRequest("http://localhost/api/destinations", "PUT", {
            id: "destination-primary",
            provider: "twitch",
            enabled: true,
            rtmpUrl: TWITCH_INGEST_URL,
            streamKey: "live_000000000_wizardtestkey"
          })
        )
      ).status
    ).toBe(200);

    // Step "First programme": what SetupProgrammeForm sends, in its order.
    const poolResponse = await postPool(
      jsonRequest("http://localhost/api/pools", "POST", { name: "Programme", sourceIds: ["source-local-library"] })
    );
    const { id: poolId } = (await poolResponse.json()) as { id: string };
    const templateResponse = await postTemplate(
      jsonRequest("http://localhost/api/schedule/templates", "POST", {
        template: "always-on-single-pool",
        primaryPoolId: poolId,
        replaceExisting: false
      })
    );
    expect(templateResponse.status).toBe(200);

    const state = page.state as AppState;
    expect(state.scheduleBlocks).toHaveLength(7);
    expect(new Set(state.scheduleBlocks.map((block) => block.dayOfWeek))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
    expect(state.scheduleBlocks.every((block) => block.poolId === poolId && block.durationMinutes === 24 * 60)).toBe(true);

    const after = getGoLiveChecklist(state);
    for (const id of ["destination", "pools", "schedule"]) {
      expect(after.find((item) => item.id === id)?.status, id).toBe("ready");
    }

    const html = await renderSetup();
    expect(html).toContain("Nothing left to type");
    expect(html).toContain("A pool with ready videos fills every day of the week.");
    expect((html.match(/>Done</g) ?? []).length).toBe(7);
  });
});

describe("R2 U3: the empty library", () => {
  it("says how to add media when the library is empty", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssetLibraryBrowser, { assets: [], sources: [], assetCollections: [] }) as never
    );
    expect(html).toContain("The library is empty");
    expect(html).toContain("upload files with the form on this page");
    expect(html).toContain("data/media");
    expect(html).toContain('href="/program?tab=sources"');
    expect(html).not.toContain("filters");
  });

  it("says the filters hide everything when the library has assets", () => {
    const html = renderToStaticMarkup(
      React.createElement(LibraryEmptyState, { totalCount: 3, onClearFilters: () => undefined }) as never
    );
    expect(html).toContain("The filters hide every asset");
    expect(html).toContain("The library holds 3 assets");
    expect(html).toContain("Clear all filters");
    expect(html).not.toContain("The library is empty");
  });

  it("shows neither message while assets are listed", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssetLibraryBrowser, {
        assets: [readyAsset("a1")],
        sources: [{ id: "source-local-library", name: "Local Media Library" } as AppState["sources"][number]],
        assetCollections: []
      }) as never
    );
    expect(html).toContain("Video a1");
    expect(html).not.toContain("The library is empty");
    expect(html).not.toContain("The filters hide every asset");
  });
});
