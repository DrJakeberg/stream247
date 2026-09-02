import { describe, expect, it } from "vitest";
import { redactStoredSecretsMigration } from "@stream247/db";

/**
 * The migration that scrubs what the sinks let through before they redacted. Driven with a fake
 * client so the assertion is about what it reads and what it writes back: only rows that change
 * are updated, and what is written back no longer carries the key.
 */
function fakeClient(rows: { incidents: { id: string; title: string; message: string }[]; audit_events: { id: string; message: string }[] }) {
  const updates: { sql: string; params: unknown[] }[] = [];
  return {
    updates,
    query: async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("SELECT id, title, message FROM incidents")) return { rows: rows.incidents };
      if (sql.startsWith("SELECT id, message FROM audit_events")) return { rows: rows.audit_events };
      updates.push({ sql, params: params ?? [] });
      return { rows: [] };
    }
  };
}

describe("20260902_001_redact_stored_secrets", () => {
  it("rewrites only the rows that carried a secret, and writes them back redacted", async () => {
    const client = fakeClient({
      incidents: [
        { id: "inc_1", title: "FFmpeg reported an error", message: "[fifo @ 0x1] Error opening rtmp://live.twitch.tv/app/live_123456_AbCdEfGhIjKlMnOpQrStUv" },
        { id: "inc_2", title: "Program feed input stalled", message: "[hls @ 0x2] Failed to reload playlist" }
      ],
      audit_events: [
        { id: "aud_1", message: "Destination primary failed: srt://ingest:9000?passphrase=hunter2" },
        { id: "aud_2", message: "3JakeC checked in for 5 minutes via Twitch chat (accepted)." }
      ]
    });
    await redactStoredSecretsMigration.apply(client as never);
    expect(client.updates).toEqual([
      { sql: "UPDATE incidents SET title = $2, message = $3 WHERE id = $1", params: ["inc_1", "FFmpeg reported an error", "[fifo @ 0x1] Error opening rtmp://live.twitch.tv/app/<redacted>"] },
      { sql: "UPDATE audit_events SET message = $2 WHERE id = $1", params: ["aud_1", "Destination primary failed: srt://ingest:9000?passphrase=<redacted>"] }
    ]);
    expect(JSON.stringify(client.updates)).not.toMatch(/live_123456|hunter2/);
  });

  it("is idempotent: a second pass over redacted rows writes nothing", async () => {
    const client = fakeClient({
      incidents: [{ id: "inc_1", title: "t", message: "rtmp://live.twitch.tv/app/<redacted>" }],
      audit_events: [{ id: "aud_1", message: "srt://ingest:9000?passphrase=<redacted>" }]
    });
    await redactStoredSecretsMigration.apply(client as never);
    expect(client.updates).toEqual([]);
  });
});
