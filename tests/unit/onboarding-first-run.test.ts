import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server";
import { createInitialSeedState, type AppState } from "@stream247/db";

// M91 "Honest first run" (planning/research/ux-install.md I2, I6, I7, I8): plain HTTP is explained on
// /setup and /login, the instance step is prefilled, the password warning sits under its field, and the
// Twitch sign-in hint is read to the end.
//
// Pages and components are rendered for real with renderToStaticMarkup, which only ever sees the server's
// side. For the instance form, whose browser zone is read on the client, a small hook runner calls the
// component the way the browser does after hydration (client snapshots, effects run, then a re-render).

const runner = vi.hoisted(() => ({
  active: false,
  index: 0,
  values: [] as unknown[],
  effects: [] as Array<() => void>
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
    useEffect: (effect: () => void, deps?: unknown[]) => (runner.active ? runner.effects.push(effect) : actual.useEffect(effect, deps)),
    // After hydration React reads the client snapshot; renderToStaticMarkup alone only ever sees the server's.
    useSyncExternalStore: (subscribe: () => () => void, getSnapshot: () => unknown, getServerSnapshot?: () => unknown) =>
      runner.active ? getSnapshot() : actual.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot),
    useTransition: () => (runner.active ? [false, (callback: () => void) => callback()] : actual.useTransition())
  };
});

const page = vi.hoisted(() => ({
  state: null as unknown,
  requestHeaders: new Headers(),
  twitchBlocker: "credentials" as "credentials" | "app-url" | null
}));

vi.mock("../../apps/web/node_modules/next/headers", () => ({
  headers: async () => page.requestHeaders,
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

vi.mock("@/lib/server/state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../apps/web/lib/server/state")>();
  return { ...actual, readAppState: async () => page.state };
});

vi.mock("@/lib/server/auth", () => ({
  getAuthenticatedUser: async () => null
}));

vi.mock("@/lib/server/twitch", () => ({
  getTwitchLoginBlocker: async () => page.twitchBlocker,
  getAbsoluteAppUrl: () => "",
  getTwitchBroadcasterRedirectUri: () => ""
}));

vi.mock("@/lib/server/twitch-accounts-panel", () => ({
  buildTwitchAccountsPanelProps: async () => ({ props: {} })
}));

import LoginPage from "../../apps/web/app/login/page";
import SetupPage from "../../apps/web/app/setup/page";
import { InsecureHttpNotice, isInsecureRemoteOrigin } from "../../apps/web/components/insecure-http-notice";
import { SetupForm } from "../../apps/web/components/setup-form";
import { SetupInstanceForm } from "../../apps/web/components/setup-instance-form";
import { TwitchLoginPanel } from "../../apps/web/components/twitch-login-panel";
import { resolveRequestOrigin } from "../../apps/web/lib/server/setup-wizard";

// The web components are compiled with the classic JSX runtime here.
(globalThis as { React?: unknown }).React = React;

const TWO_WAYS_OUT = ["docker compose --profile proxy up -d", "ssh -L 3000:localhost:3000"];

function freshState(overrides: Partial<AppState> = {}): AppState {
  return { ...createInitialSeedState(), ...overrides };
}

function initializedState(): AppState {
  return freshState({
    initialized: true,
    owner: { email: "owner@example.com", passwordHash: "salt:hash", createdAt: "2026-10-01T00:00:00.000Z" }
  });
}

function requestFrom(host: string, proto: string) {
  page.requestHeaders = new Headers({ host, "x-forwarded-proto": proto });
}

/** Mount, run the effects, render again: what the browser shows once the effects have applied. */
function mountWithEffects<P>(component: (props: P) => unknown, props: P): string {
  runner.active = true;
  runner.values = [];
  try {
    runner.index = 0;
    runner.effects = [];
    component(props);
    for (const effect of runner.effects) {
      effect();
    }
    runner.index = 0;
    runner.effects = [];
    const element = component(props);
    runner.active = false;
    return renderToStaticMarkup(element as never);
  } finally {
    runner.active = false;
  }
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  page.twitchBlocker = "credentials";
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("I2: plain HTTP from another machine is explained (M91, decided 5.1 Q6)", () => {
  it("shows the two ways out on /login over http on a LAN address", async () => {
    page.state = initializedState();
    requestFrom("192.168.1.20:3000", "http");
    const html = renderToStaticMarkup((await LoginPage()) as never);
    expect(html).toContain("Signing in will not work over plain HTTP from another machine");
    for (const way of TWO_WAYS_OUT) {
      expect(html).toContain(way);
    }
  });

  it("shows the two ways out on /setup over http on a LAN address", async () => {
    page.state = freshState();
    requestFrom("192.168.1.20:3000", "http");
    const html = renderToStaticMarkup((await SetupPage({ searchParams: Promise.resolve({}) })) as never);
    expect(html).toContain("Signing in will not work over plain HTTP from another machine");
    for (const way of TWO_WAYS_OUT) {
      expect(html).toContain(way);
    }
  });

  it("says nothing on localhost, 127.0.0.1, over HTTPS, or outside production", async () => {
    page.state = initializedState();
    for (const [host, proto] of [
      ["localhost:3000", "http"],
      ["127.0.0.1:3000", "http"],
      ["stream.example.com", "https"]
    ]) {
      requestFrom(host, proto);
      expect(renderToStaticMarkup((await LoginPage()) as never)).not.toContain("plain HTTP");
    }
    vi.stubEnv("NODE_ENV", "development");
    requestFrom("192.168.1.20:3000", "http");
    expect(renderToStaticMarkup((await LoginPage()) as never)).not.toContain("plain HTTP");
  });

  it("judges the origin by protocol and host", () => {
    expect(isInsecureRemoteOrigin({ protocol: "http:", hostname: "192.168.1.20" })).toBe(true);
    expect(isInsecureRemoteOrigin({ protocol: "http:", hostname: "stream.lan" })).toBe(true);
    expect(isInsecureRemoteOrigin({ protocol: "http:", hostname: "localhost" })).toBe(false);
    expect(isInsecureRemoteOrigin({ protocol: "http:", hostname: "[::1]" })).toBe(false);
    expect(isInsecureRemoteOrigin({ protocol: "https:", hostname: "192.168.1.20" })).toBe(false);
    expect(
      renderToStaticMarkup(React.createElement(InsecureHttpNotice, { secureCookies: true, requestOrigin: "not a url" }))
    ).toBe("");
  });
});

describe("I6: the instance step is prefilled (M91)", () => {
  it("resolves the request origin from the forwarded protocol and host", () => {
    expect(resolveRequestOrigin(new Headers({ host: "192.168.1.20:3000" }))).toBe("http://192.168.1.20:3000");
    expect(resolveRequestOrigin(new Headers({ host: "web:3000", "x-forwarded-host": "stream.example.com", "x-forwarded-proto": "https" }))).toBe(
      "https://stream.example.com"
    );
    expect(resolveRequestOrigin(new Headers())).toBe("");
  });

  it("prefills the URL with the request origin and the zone with the browser's zone", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).resolvedOptions(),
      timeZone: "Europe/Berlin"
    });
    const html = mountWithEffects(SetupInstanceForm, {
      initialAppUrl: "",
      detectedAppUrl: "http://192.168.1.20:3000",
      initialTimezone: "",
      initialLanguage: "",
      envAppUrl: "",
      envTimezone: "",
      envLanguage: ""
    });
    expect(html).toMatch(/id="public-app-url"[^>]*value="http:\/\/192\.168\.1\.20:3000"|value="http:\/\/192\.168\.1\.20:3000"[^>]*id="public-app-url"/);
    expect(html).toMatch(/id="channel-timezone"[^>]*value="Europe\/Berlin"|value="Europe\/Berlin"[^>]*id="channel-timezone"/);
    expect(html).toContain("Detected from the address this page is open under; check it.");
    expect(html).toContain("Your browser&#x27;s time zone; check it.");
  });

  it("keeps saved values and does not prefill what the environment pins", () => {
    const html = mountWithEffects(SetupInstanceForm, {
      initialAppUrl: "https://saved.example.com",
      detectedAppUrl: "http://192.168.1.20:3000",
      initialTimezone: "America/New_York",
      initialLanguage: "de",
      envAppUrl: "",
      envTimezone: "",
      envLanguage: ""
    });
    expect(html).toContain('value="https://saved.example.com"');
    expect(html).toContain('value="America/New_York"');
    expect(html).not.toContain("check it");

    const pinned = mountWithEffects(SetupInstanceForm, {
      initialAppUrl: "",
      detectedAppUrl: "http://192.168.1.20:3000",
      initialTimezone: "",
      initialLanguage: "",
      envAppUrl: "https://env.example.com",
      envTimezone: "Europe/Vienna",
      envLanguage: ""
    });
    expect(pinned).not.toContain("192.168.1.20");
    expect(pinned).not.toContain("check it");
  });
});

describe("I7: the password warning sits under the field (M91)", () => {
  it("says to store the password and where it can be changed, right under the field", () => {
    const html = renderToStaticMarkup(React.createElement(SetupForm));
    const field = html.indexOf('name="password"');
    const warning = html.indexOf("Store this password now.");
    expect(field).toBeGreaterThan(-1);
    expect(warning).toBeGreaterThan(field);
    // In the same label as the field, not behind the (i) and not in the paragraph below the form.
    expect(html.slice(field, warning)).not.toContain("</label>");
    expect(html).toContain("There is no e-mail reset: you can change it under Admin → Settings → Security");
  });
});

describe("I8: the Twitch sign-in hint is read to the end (M91)", () => {
  it("names the missing Twitch app credentials and links setup step 3", () => {
    const html = renderToStaticMarkup(React.createElement(TwitchLoginPanel, { authorizeUrl: null, blocker: "credentials" }));
    expect(html).toContain("Twitch app credentials");
    expect(html).toContain('href="/setup?step=twitch-app"');
    expect(html).toContain("setup step 3");
    expect(html).not.toContain("APP_URL");
  });

  it("names the missing public URL when the credentials are there", () => {
    const html = renderToStaticMarkup(React.createElement(TwitchLoginPanel, { authorizeUrl: null, blocker: "app-url" }));
    expect(html).toContain('href="/setup?step=instance"');
    expect(html).not.toContain("APP_URL");
  });

  it("the login page passes the blocker through", async () => {
    page.state = initializedState();
    requestFrom("localhost:3000", "http");
    page.twitchBlocker = "credentials";
    const html = renderToStaticMarkup((await LoginPage()) as never);
    expect(html).toContain('href="/setup?step=twitch-app"');
    expect(html).toContain("Owner sign-in");
  });

  it("has no line clamp on the hint", () => {
    const html = renderToStaticMarkup(React.createElement(TwitchLoginPanel, { authorizeUrl: null, blocker: "credentials" }));
    // The panel opts out of `.item .subtle`'s two-line clamp with `.login-hints`.
    expect(html).toMatch(/^<div class="item login-hints">/);
    const css = readFileSync(path.resolve(import.meta.dirname, "../../apps/web/app/globals.css"), "utf8");
    const clampRule = css.indexOf(".item .subtle,");
    const liftRule = css.search(/\.login-hints \.subtle \{\s*display: block;\s*overflow: visible;\s*\}/);
    expect(clampRule).toBeGreaterThan(-1);
    // Same specificity as the clamp, so it has to come after it to win.
    expect(liftRule).toBeGreaterThan(clampRule);
    expect(css.slice(liftRule).split("}")[0]).not.toContain("line-clamp");
  });
});
