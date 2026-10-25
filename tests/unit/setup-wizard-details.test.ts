import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server";

// M122 (suggestions 10 and 11 of planning/suggestions-2026-10-04.md, left by M99 and M91): a regional
// Twitch ingest is Twitch in the wizard, a source that becomes playable while the "First programme" step is
// open arrives ticked, and the zone field suggests the zone names the browser knows.
//
// A small hook runner calls a component the way the browser does: state survives between renders (a
// router refresh or a "check again" link keeps the mounted form), client snapshots are read, and a
// transition runs at once. renderToStaticMarkup alone shows the server's side.

const runner = vi.hoisted(() => ({
  active: false,
  index: 0,
  values: [] as unknown[]
}));

vi.mock("../../apps/web/node_modules/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../apps/web/node_modules/react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!runner.active) {
        return actual.useState(initial);
      }
      const slot = runner.index++;
      if (!(slot in runner.values)) {
        runner.values[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      }
      return [
        runner.values[slot],
        (next: unknown) => {
          runner.values[slot] = typeof next === "function" ? (next as (value: unknown) => unknown)(runner.values[slot]) : next;
        }
      ];
    },
    useSyncExternalStore: (subscribe: () => () => void, getSnapshot: () => unknown, getServerSnapshot?: () => unknown) =>
      runner.active ? getSnapshot() : actual.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot),
    useTransition: () => (runner.active ? [false, (callback: () => void) => callback()] : actual.useTransition())
  };
});

vi.mock("../../apps/web/node_modules/next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined })
}));

import { SetupDestinationForm } from "../../apps/web/components/setup-destination-form";
import { listBrowserTimeZones, SetupInstanceForm } from "../../apps/web/components/setup-instance-form";
import { SetupProgrammeForm } from "../../apps/web/components/setup-programme-form";
import { isTwitchIngestUrl, TWITCH_INGEST_URL } from "../../apps/web/lib/destination-wording";

// The web components are compiled with the classic JSX runtime here.
(globalThis as { React?: unknown }).React = React;

type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

/** Renders with the hook runner; state is kept from the previous call until `freshMount` is true. */
function renderMounted<P>(component: (props: P) => unknown, props: P, freshMount = false): Element | null {
  runner.active = true;
  if (freshMount) {
    runner.values = [];
  }
  try {
    runner.index = 0;
    return component(props) as Element | null;
  } finally {
    runner.active = false;
  }
}

function html(element: Element | null): string {
  return element ? renderToStaticMarkup(element as never) : "";
}

const destinationProps = {
  destinationId: "destination-primary",
  destinationName: "Primary Twitch Output",
  streamKeyPresent: true,
  streamKeySource: "managed" as const
};

afterEach(() => {
  vi.unstubAllGlobals();
  runner.values = [];
});

describe("suggestion 10a: a regional Twitch ingest is Twitch", () => {
  it("knows Twitch's global, older regional and contribute ingests, and nothing else", () => {
    for (const url of [
      TWITCH_INGEST_URL,
      "rtmp://live.twitch.tv/app/",
      "rtmps://live.twitch.tv:443/app",
      "rtmp://live.twitch.tv:1935/app",
      "rtmp://live-fra.twitch.tv/app",
      "rtmp://fra05.contribute.live-video.net/app",
      "rtmps://ams03.contribute.live-video.net/app"
    ]) {
      expect(isTwitchIngestUrl(url), url).toBe(true);
    }
    for (const url of [
      "",
      "rtmp://ingest.example/live",
      "rtmp://live.twitch.tv/live",
      "https://live.twitch.tv/app",
      "rtmp://live.twitch.tv.example/app",
      "rtmp://twitch.tv/app",
      "rtmp://fra05.contribute.live-video.net.example/app",
      "rtmp://live.twitch.tv:1/app",
      "rtmp://user@live.twitch.tv/app",
      "not a url"
    ]) {
      expect(isTwitchIngestUrl(url), url).toBe(false);
    }
  });

  it("shows a regional ingest as Twitch and names it in the hint", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SetupDestinationForm, { ...destinationProps, rtmpUrl: "rtmp://fra05.contribute.live-video.net/app" })
    );
    expect(markup).toMatch(/<option value="twitch" selected="">Twitch<\/option>/);
    expect(markup).toContain("Streams to rtmp://fra05.contribute.live-video.net/app; the key decides the channel.");
    expect(markup).not.toContain("RTMP URL");
  });

  it("keeps the regional ingest on saving as Twitch, and a custom address still reads as another service", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (_input: unknown, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response("{}", { status: 200 });
    });
    const form = renderMounted(SetupDestinationForm, { ...destinationProps, rtmpUrl: "rtmp://live-fra.twitch.tv/app" }, true);
    (form?.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: () => undefined });
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ provider: "twitch", rtmpUrl: "rtmp://live-fra.twitch.tv/app" });

    const custom = renderToStaticMarkup(React.createElement(SetupDestinationForm, { ...destinationProps, rtmpUrl: "rtmp://ingest.example/live" }));
    expect(custom).toMatch(/<option value="custom-rtmp" selected="">Another RTMP service<\/option>/);
  });
});

describe("suggestion 10b: a source that becomes playable while the step is open arrives ticked", () => {
  const library = { id: "source-local", name: "Local Media Library", readyCount: 2 };
  const channel = { id: "source-channel", name: "Channel VODs", readyCount: 5 };

  it("ticks a source that becomes playable after the mounted form refreshes", () => {
    // One source plays already, the other has no ready video yet: only the first is offered.
    const first = html(renderMounted(SetupProgrammeForm, { sources: [library, { ...channel, readyCount: 0 }], scheduleBlockCount: 0 }, true));
    expect(first).not.toContain("Channel VODs");
    // A refresh (after a failed press, or the router keeping the step) brings the second; the form is the same one.
    const markup = html(renderMounted(SetupProgrammeForm, { sources: [library, channel], scheduleBlockCount: 0 }));
    expect(markup.match(/<input type="checkbox" checked=""\/>/g)).toHaveLength(2);
  });

  it("keeps a source the owner unticked unticked, and ticks the new one", () => {
    const first = renderMounted(SetupProgrammeForm, { sources: [library, { ...channel, readyCount: 0 }], scheduleBlockCount: 0 }, true);
    const checkbox = findCheckbox(first, 0);
    (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: false } });

    const markup = html(renderMounted(SetupProgrammeForm, { sources: [library, channel], scheduleBlockCount: 0 }));
    expect(markup).toContain('<label class="chip-toggle"><input type="checkbox"/><span>Local Media Library · 2 ready videos</span>');
    expect(markup).toContain('<label class="chip-toggle chip-toggle-active"><input type="checkbox" checked=""/><span>Channel VODs · 5 ready videos</span>');
  });
});

describe("suggestion 11: the zone field suggests the zone names the browser knows", () => {
  const instanceProps = {
    initialAppUrl: "https://stream.example.com",
    initialTimezone: "Europe/Berlin",
    initialLanguage: "en",
    envAppUrl: "",
    envTimezone: "",
    envLanguage: ""
  };

  it("lists UTC first, then every zone, with a spaced label for zones with an underscore", () => {
    const zones = listBrowserTimeZones();
    expect(zones[0]).toBe("UTC");
    expect(zones).toContain("Europe/Berlin");
    expect(zones.filter((zone) => zone === "UTC")).toHaveLength(1);

    const markup = html(renderMounted(SetupInstanceForm, instanceProps, true));
    expect(markup).toMatch(/<input[^>]*list="channel-timezone-options"/);
    expect(markup).toContain('<datalist id="channel-timezone-options"><option value="UTC"></option>');
    expect(markup).toContain('<option value="Europe/Berlin"></option>');
    expect(markup).toContain('<option label="America/New York" value="America/New_York"></option>');
    expect(markup).toContain("Type a city or region to pick from the list.");
    // Still a text field: a saved zone shows as it is.
    expect(markup).toMatch(/id="channel-timezone"[^>]*value="Europe\/Berlin"|value="Europe\/Berlin"[^>]*id="channel-timezone"/);
  });

  it("leaves the list to the browser: the server's render has none", () => {
    const markup = renderToStaticMarkup(React.createElement(SetupInstanceForm, instanceProps));
    expect(markup).not.toContain("<datalist");
    expect(markup).not.toContain('list="channel-timezone-options"');
    expect(markup).not.toContain("Type a city or region");
  });

  it("offers no list while the environment pins the zone", () => {
    const markup = html(renderMounted(SetupInstanceForm, { ...instanceProps, envTimezone: "Europe/Vienna" }, true));
    expect(markup).toContain("CHANNEL_TIMEZONE is set to Europe/Vienna in the environment and overrides whatever is saved here.");
    expect(markup).not.toContain("Type a city or region");
    expect(markup).not.toContain("<datalist");
  });
});

function findCheckbox(root: Element | null, index: number): Element {
  const found: Element[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object" || !("props" in node)) {
      return;
    }
    const element = node as Element;
    if (element.type === "input" && element.props.type === "checkbox") {
      found.push(element);
    }
    visit(element.props.children);
  };
  visit(root);
  return found[index];
}
