import { describe, expect, it, vi } from "vitest";

// M125 (review): an open broadcast event stream re-checks its session with every snapshot, so a team
// member whose access is removed stops receiving at once, like every other request of theirs.

const access = vi.hoisted(() => ({ allowed: true }));

vi.mock("@/lib/server/auth", () => ({
  requireApiRoles: async () => null,
  sessionCookieFromHeader: (header: string | null) => (header ?? "").replace("stream247_session=", ""),
  resolveSessionUser: (cookie: string | undefined) => (access.allowed && cookie === "x" ? { id: "u" } : null)
}));
vi.mock("@/lib/server/state", () => ({
  readAppState: async () => ({}),
  getBroadcastSnapshot: () => ({ ok: true })
}));

import { sessionCookieFromHeader } from "../../apps/web/lib/server/auth";
import { GET } from "../../apps/web/app/api/broadcast/stream/route";

function open() {
  return GET(new Request("http://localhost/api/broadcast/stream", { headers: { cookie: "stream247_session=x" } }));
}

describe("broadcast stream and removed access", () => {
  it("sends snapshots while the session resolves", async () => {
    access.allowed = true;
    const controller = new AbortController();
    const response = await GET(
      new Request("http://localhost/api/broadcast/stream", { headers: { cookie: "stream247_session=x" }, signal: controller.signal })
    );
    const first = await response.body!.getReader().read();
    expect(new TextDecoder().decode(first.value)).toContain('"ok":true');
    controller.abort();
  });

  it("ends the stream without a snapshot once it does not", async () => {
    access.allowed = false;
    const response = await open();
    expect((await response.body!.getReader().read()).done).toBe(true);
  });

  it("reads the session cookie from a Cookie header", async () => {
    const real = await vi.importActual<typeof import("../../apps/web/lib/server/auth")>("../../apps/web/lib/server/auth");
    expect(real.sessionCookieFromHeader("a=1; stream247_session=abc:1:2:3; b=2")).toBe("abc:1:2:3");
    expect(real.sessionCookieFromHeader(null)).toBeUndefined();
    expect(sessionCookieFromHeader).toBeDefined();
  });
});
