import { describe, expect, it, vi } from "vitest";
import { logRuntimeEvent } from "../../apps/worker/src/runtime-log";

describe("runtime logging", () => {
  it("emits structured JSON events", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    logRuntimeEvent("playout.process.start", {
      destinationId: "dest_primary",
      targetKind: "asset"
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [payloadText] = spy.mock.calls[0] ?? [];
    const payload = JSON.parse(String(payloadText)) as {
      component: string;
      event: string;
      destinationId: string;
      targetKind: string;
      ts: string;
    };

    expect(payload.component).toBe("worker");
    expect(payload.event).toBe("playout.process.start");
    expect(payload.destinationId).toBe("dest_primary");
    expect(payload.targetKind).toBe("asset");
    expect(payload.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    spy.mockRestore();
  });
});
