import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server";
import type { AppState } from "../../apps/web/lib/server/state";
import type { BroadcastSnapshot, LiveIncidentSummary } from "../../apps/web/lib/live-broadcast";

// M90 "The 3 A.M. Answer" (planning/research/ux-install.md U7, U8, U11, U12): a tired operator sees
// what is wrong and what to press, first.
//
// The components are rendered for real: renderToStaticMarkup for markup, and for the buttons the
// component function is called with React's two state hooks replaced by plain values, so each
// button's own onClick can be pressed without a DOM.

const hooks = vi.hoisted(() => ({ stateful: false }));

vi.mock("../../apps/web/node_modules/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../apps/web/node_modules/react")>();
  return {
    ...actual,
    // Only while a test calls a component function directly; renderToStaticMarkup uses the real ones.
    useState: (initial: unknown) =>
      hooks.stateful ? actual.useState(initial) : [typeof initial === "function" ? (initial as () => unknown)() : initial, () => undefined],
    useTransition: () => (hooks.stateful ? actual.useTransition() : [false, (callback: () => void) => callback()])
  };
});

vi.mock("../../apps/web/node_modules/next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
  usePathname: () => "/live"
}));

vi.mock("../../apps/web/node_modules/next/link", () => ({
  default: (props: { href: string; children?: unknown }) => React.createElement("a", { href: props.href }, props.children as never)
}));

import { describeRuntimeReadinessSentence, getHeartbeatProblems } from "../../apps/web/lib/server/state";
import { OpenProblemsPanel } from "../../apps/web/components/open-problems-panel";
import { PlayoutActionForm, describePlayoutActionConfirmation } from "../../apps/web/components/playout-action-form";
import { AdminNavigation } from "../../apps/web/components/admin-navigation";
import { LiveWorkspaceHeader } from "../../apps/web/components/live-workspace-header";
import { AdminStatusRail } from "../../apps/web/components/admin-status-rail";

// The web components are compiled with the classic JSX runtime here.
(globalThis as { React?: unknown }).React = React;

const NOW = new Date("2026-10-02T03:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function stateWithHeartbeats(workerHeartbeatAt: string, playoutHeartbeatAt: string): AppState {
  return {
    playout: {
      status: "running",
      heartbeatAt: playoutHeartbeatAt,
      workerHeartbeatAt,
      programFeedStatus: "",
      programFeedUpdatedAt: "",
      uplinkStatus: ""
    }
  } as unknown as AppState;
}

function render(element: unknown): string {
  hooks.stateful = true;
  try {
    return renderToStaticMarkup(element as never);
  } finally {
    hooks.stateful = false;
  }
}

const sourceIncident: LiveIncidentSummary = {
  id: "incident-1",
  title: "Archive has stopped delivering",
  message: "The last 3 checks failed, the first of them at 2026-10-02 02:40 UTC.",
  severity: "warning",
  status: "open",
  scope: "source",
  fingerprint: "source.youtube-channel.source-1",
  action: "Open Program → Sources, check this source's address and whether it is still online, then press Sync now.",
  createdAt: ago(20 * 60_000),
  updatedAt: ago(60_000),
  acknowledgedAt: "",
  resolvedAt: ""
};

describe("U7: a dead worker or playout is the first open problem", () => {
  beforeEach(() => {
    delete process.env.STREAM247_RELAY_ENABLED;
  });

  it("lists a stale worker and a missing playout heartbeat, with the restart command", () => {
    const problems = getHeartbeatProblems(stateWithHeartbeats(ago(7 * 60_000), ""), NOW);
    expect(problems.map((problem) => [problem.id, problem.verdict])).toEqual([
      ["heartbeat-worker", "stale"],
      ["heartbeat-playout", "missing"]
    ]);
    expect(problems[0]?.title).toBe("The worker has stopped reporting");
    expect(problems[0]?.action).toContain("`docker compose restart worker`");
    expect(problems[1]?.title).toBe("Playout has never reported");
    expect(problems[1]?.action).toContain("`docker compose restart playout`");
  });

  it("lists nothing while both heartbeats are current", () => {
    expect(getHeartbeatProblems(stateWithHeartbeats(ago(30_000), ago(5_000)), NOW)).toEqual([]);
  });

  it("puts the heartbeat entry above every incident, with its age in words", () => {
    const problems = getHeartbeatProblems(stateWithHeartbeats(ago(7 * 60_000), ago(5_000)), NOW);
    const html = render(
      React.createElement(OpenProblemsPanel, {
        heartbeatProblems: problems,
        openIncidents: [sourceIncident],
        openIncidentCount: 1,
        nowMs: NOW
      })
    );
    const worker = html.indexOf("The worker has stopped reporting");
    const incident = html.indexOf("Archive has stopped delivering");
    expect(worker).toBeGreaterThan(-1);
    expect(incident).toBeGreaterThan(worker);
    expect(html).toContain("Last heard from 7 minutes ago.");
    expect(html).toContain("What to do: Restart the worker container: `docker compose restart worker`.");
    // The incident card ends with its catalogue action too.
    expect(html).toContain("What to do: Open Program → Sources");
    expect(html).not.toContain("No open incidents");
  });

  it("says a never-seen heartbeat in words, not as an empty age", () => {
    const html = render(
      React.createElement(OpenProblemsPanel, {
        heartbeatProblems: getHeartbeatProblems(stateWithHeartbeats("", ago(5_000)), NOW),
        openIncidents: [],
        openIncidentCount: 0,
        nowMs: NOW
      })
    );
    expect(html).toContain("The worker has never reported");
    expect(html).toContain("No heartbeat has been recorded yet.");
    expect(html).not.toContain("No open incidents");
  });
});

describe("U7: the shared rail does not contradict the page", () => {
  it("counts a silent worker as an open problem and names it", () => {
    const problems = getHeartbeatProblems(stateWithHeartbeats(ago(7 * 60_000), ago(5_000)), NOW);
    const snapshot = {
      queueItems: [],
      playout: { status: "running", transitionState: "idle", selectionReasonCode: "", prefetchStatus: "", currentTitle: "" },
      currentAsset: null,
      nextAsset: null,
      currentScheduleItem: null,
      nextScheduleItem: null,
      destination: null,
      openIncidents: [sourceIncident],
      openIncidentCount: 1,
      heartbeatProblems: problems,
      workerHealth: { status: "stale", summary: "", lastRunAt: ago(7 * 60_000) }
    } as unknown as BroadcastSnapshot;
    const html = render(React.createElement(AdminStatusRail, { initialSnapshot: snapshot }));
    expect(html).toContain("<strong>2</strong>");
    expect(html).toContain("critical · The worker has stopped reporting");
    expect(html).not.toContain("No unresolved incidents");
  });
});

describe("U8: the status sentence follows the heartbeats", () => {
  it("names what is down instead of calling it active", () => {
    expect(describeRuntimeReadinessSentence(stateWithHeartbeats("", ""), 0, NOW)).toBe(
      "No open incidents, the worker has never reported and playout has never reported: see Open problems on Live → Control."
    );
    expect(describeRuntimeReadinessSentence(stateWithHeartbeats(ago(7 * 60_000), ago(5_000)), 2, NOW)).toBe(
      "Besides the incidents above, the worker has stopped reporting: see Open problems on Live → Control."
    );
    expect(describeRuntimeReadinessSentence(stateWithHeartbeats(ago(30_000), ago(5_000)), 0, NOW)).toBe(
      "No open incidents. The worker and playout both reported within the last few minutes."
    );
  });
});

describe("U11: the three interrupting actions of 'If something is stuck' confirm", () => {
  const fetchMock = vi.fn();
  const confirmMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
    confirmMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { confirm: confirmMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type Element = { type: unknown; props: { children?: unknown; onClick?: () => void; disabled?: boolean; title?: string } };

  function findButton(node: unknown, label: string): Element | null {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findButton(child, label);
        if (found) return found;
      }
      return null;
    }
    if (!node || typeof node !== "object" || !("props" in node)) {
      return null;
    }
    const element = node as Element;
    if (element.type === "button" && element.props.children === label) {
      return element;
    }
    return findButton(element.props.children, label);
  }

  function form(relayEnabled: boolean) {
    return PlayoutActionForm({ assets: [{ id: "asset-1", title: "Folge 1" }], overrideMode: "schedule", relayEnabled });
  }

  const sentTypes = () => fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as { body: string }).body)).type);

  for (const [label, type, relayEnabled] of [
    ["Soft restart", "restart", true],
    ["Soft restart", "restart", false],
    ["Hard reload", "hard_reload", true],
    ["Hard reload", "hard_reload", false],
    ["Force reconnect", "force_reconnect", false]
  ] as const) {
    it(`${label} (${relayEnabled ? "relay" : "direct"}): Cancel sends nothing, OK sends ${type}`, () => {
      const button = findButton(form(relayEnabled), label);
      expect(button, label).not.toBeNull();

      confirmMock.mockReturnValueOnce(false);
      button?.props.onClick?.();
      expect(confirmMock).toHaveBeenLastCalledWith(describePlayoutActionConfirmation(type, relayEnabled));
      expect(fetchMock).not.toHaveBeenCalled();

      confirmMock.mockReturnValueOnce(true);
      button?.props.onClick?.();
      expect(sentTypes()).toEqual([type]);
    });
  }

  it("says per button whether viewers see a cut", () => {
    expect(describePlayoutActionConfirmation("restart", true)).toContain("Viewers see a short cut");
    expect(describePlayoutActionConfirmation("restart", true)).toContain("the Twitch connection stays up");
    expect(describePlayoutActionConfirmation("restart", false)).toContain("Viewers see the stream drop");
    expect(describePlayoutActionConfirmation("hard_reload", false)).toContain("Viewers see the stream drop");
    // Direct mode: the encoder is the connection, so a forced reconnect drops it.
    expect(describePlayoutActionConfirmation("force_reconnect", false)).toContain("drops the connection to Twitch");
  });

  it("disables Force reconnect with the relay, where the server refuses it", () => {
    const button = findButton(form(true), "Force reconnect");
    expect(button?.props.disabled).toBe(true);
    expect(button?.props.title).toContain("The relay holds the Twitch connection");
  });

  it("leaves the non-interrupting repairs one tap", () => {
    for (const [label, type] of [
      ["Refresh scenes", "refresh"],
      ["Rebuild queue", "rebuild_queue"]
    ] as const) {
      fetchMock.mockClear();
      findButton(form(false), label)?.props.onClick?.();
      expect(confirmMock).not.toHaveBeenCalled();
      expect(sentTypes()).toEqual([type]);
    }
  });
});

describe("U12: the Live chip without a connected Twitch account", () => {
  const snapshot = {
    twitch: { connected: false, status: "unknown", viewerCount: 0, channelLogin: "", botLogin: "", startedAt: "" },
    presence: { active: false, actor: "", remainingMinutes: 0 },
    playout: { status: "running" }
  } as unknown as BroadcastSnapshot;

  it("reads 'Not connected to Twitch' in the sidebar, never 'Checking'", () => {
    const html = render(React.createElement(AdminNavigation, { initialSnapshot: snapshot }));
    expect(html).toContain("Not connected to Twitch");
    expect(html).not.toContain("Checking");
  });

  it("reads 'Checking' only while a connected account has not been asked yet", () => {
    const connected = { ...snapshot, twitch: { ...snapshot.twitch, connected: true } } as BroadcastSnapshot;
    const html = render(React.createElement(AdminNavigation, { initialSnapshot: connected }));
    expect(html).toContain("Checking");
    expect(html).not.toContain("Not connected to Twitch");
  });

  it("reads the same in the Live workspace header", () => {
    expect(typeof LiveWorkspaceHeader).toBe("function");
    const html = render(React.createElement(LiveWorkspaceHeader as never, { initialSnapshot: snapshot } as never));
    expect(html).toContain("Not connected to Twitch");
  });
});
