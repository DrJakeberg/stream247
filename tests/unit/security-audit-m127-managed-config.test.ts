import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M127: the managed-config routes and the worker's Twitch connection writes. The stored-row
 * behaviour is proven against PostgreSQL in tests/integration/db-roundtrip.test.ts; these cases pin
 * the callers to it, and the encoder route stands in for every managed-config form's refusal.
 */

const { mockRequireApiRoles, mockAppendAuditEvent, mockUpdateManagedConfigRecord } = vi.hoisted(() => ({
  mockRequireApiRoles: vi.fn(),
  mockAppendAuditEvent: vi.fn(),
  mockUpdateManagedConfigRecord: vi.fn()
}));

vi.mock("@/lib/server/auth", () => ({ requireApiRoles: mockRequireApiRoles }));
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
vi.mock("@/lib/server/state", () => ({
  appendAuditEvent: mockAppendAuditEvent,
  readAppState: vi.fn(),
  updateManagedConfigRecord: mockUpdateManagedConfigRecord
}));

import { PUT as putEncoder } from "../../apps/web/app/api/settings/encoder/route";
import { MANAGED_CONFIG_KEY_MISMATCH_MESSAGE } from "../../apps/web/lib/server/managed-config-save";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

function encoderRequest() {
  return new Request("http://localhost/api/settings/encoder", {
    method: "PUT",
    body: JSON.stringify({ ffmpegPreset: "veryfast", ffmpegMaxrate: "", ffmpegBufsize: "", ffmpegAudioBitrate: "" })
  }) as never;
}

describe("a managed-config save while APP_SECRET does not match", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiRoles.mockResolvedValue(null);
  });

  it("answers 409 with the restore hint and writes no audit line", async () => {
    const refusal = new Error("stored payload cannot be decrypted");
    refusal.name = "ManagedConfigKeyMismatchError";
    mockUpdateManagedConfigRecord.mockRejectedValue(refusal);

    const response = await putEncoder(encoderRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, message: MANAGED_CONFIG_KEY_MISMATCH_MESSAGE });
    expect(mockAppendAuditEvent).not.toHaveBeenCalled();
  });

  it("lets any other failure through unchanged", async () => {
    mockUpdateManagedConfigRecord.mockRejectedValue(new Error("connection refused"));

    await expect(putEncoder(encoderRequest())).rejects.toThrow("connection refused");
  });

  it("merges onto the stored record it is handed, not onto a snapshot of its own", async () => {
    mockUpdateManagedConfigRecord.mockResolvedValue(undefined);

    expect((await putEncoder(encoderRequest())).status).toBe(200);
    const [update] = mockUpdateManagedConfigRecord.mock.calls[0]!;
    expect(update({ ffmpegPreset: "", twitchEventsubSecret: "rotated-meanwhile" })).toMatchObject({
      ffmpegPreset: "veryfast",
      twitchEventsubSecret: "rotated-meanwhile"
    });
  });
});

describe("source pins", () => {
  it("every managed-config save under app/api passes an updater and handles the key-mismatch refusal", () => {
    const callers = sourceFiles(path.join(repoRoot, "apps/web/app/api")).filter((file) =>
      /updateManagedConfigRecord\(/.test(readFileSync(file, "utf8"))
    );
    expect(callers.length).toBeGreaterThanOrEqual(10);

    const offenders = callers.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const calls = source.match(/updateManagedConfigRecord\(/g)?.length ?? 0;
      const updaters = source.match(/updateManagedConfigRecord\(\(current\) =>/g)?.length ?? 0;
      const problems = [];
      if (updaters !== calls) {
        problems.push(`${path.relative(repoRoot, file)}: ${calls - updaters} call(s) without an updater`);
      }
      if (!source.includes("managedConfigSaveRefusal(error)")) {
        problems.push(`${path.relative(repoRoot, file)}: no key-mismatch refusal`);
      }
      return problems;
    });
    expect(offenders).toEqual([]);
  });

  it("the worker writes the Twitch connection rows only through the generation-checked patches", () => {
    const worker = readFileSync(path.join(repoRoot, "apps/worker/src/index.ts"), "utf8");

    expect(worker.match(/\bupdateTwitch(?:Broadcaster)?ConnectionRecord\(/g) ?? []).toEqual([]);
    expect(worker.match(/\.\.\.(?:args\.)?state\.twitch(?:Broadcaster)?,/g) ?? []).toEqual([]);
  });
});
