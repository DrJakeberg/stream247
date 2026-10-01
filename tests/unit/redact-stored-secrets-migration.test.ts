import { describe, expect, it } from "vitest";
import { redactStoredSecretsMigration } from "@stream247/db";

/**
 * The migration that scrubs what the sinks let through before they redacted. Driven with a fake
 * client so the assertion is about what it reads and what it writes back: only rows that change
 * are updated, and what is written back no longer carries the key.
 */
function fakeClient(rows: {
  incidents: { id: string; title: string; message: string }[];
  audit_events: { id: string; message: string }[];
  stream_destinations?: { id: string; last_error: string }[];
  playout_runtime?: { singleton_id: number; last_error: string; last_stderr_sample: string; live_bridge_last_error: string }[];
}) {
  const updates: { sql: string; params: unknown[] }[] = [];
  return {
    updates,
    query: async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("SELECT id, title, message FROM incidents")) return { rows: rows.incidents };
      if (sql.startsWith("SELECT id, message FROM audit_events")) return { rows: rows.audit_events };
      if (sql.startsWith("SELECT id, last_error FROM stream_destinations")) return { rows: rows.stream_destinations ?? [] };
      if (sql.startsWith("SELECT singleton_id, last_error, last_stderr_sample, live_bridge_last_error FROM playout_runtime")) return { rows: rows.playout_runtime ?? [] };
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
      ],
      stream_destinations: [
        { id: "dest_1", last_error: "[fifo @ 0x1] Error opening rtmp://live.twitch.tv/app/live_123456_AbCdEfGhIjKlMnOpQrStUv: Input/output error" },
        { id: "dest_2", last_error: "" }
      ],
      playout_runtime: [
        { singleton_id: 1, last_error: "FFmpeg exited 1. Last stderr: rtmp://relay:1935/live/program?user=internal&pass=relaySecret1", last_stderr_sample: "[hls @ 0x2] ok", live_bridge_last_error: "" }
      ]
    });
    await redactStoredSecretsMigration.apply(client as never);
    expect(client.updates).toEqual([
      { sql: "UPDATE incidents SET title = $2, message = $3 WHERE id = $1", params: ["inc_1", "FFmpeg reported an error", "[fifo @ 0x1] Error opening rtmp://live.twitch.tv/app/<redacted>"] },
      { sql: "UPDATE audit_events SET message = $2 WHERE id = $1", params: ["aud_1", "Destination primary failed: srt://ingest:9000?passphrase=<redacted>"] },
      { sql: "UPDATE stream_destinations SET last_error = $2 WHERE id = $1", params: ["dest_1", "[fifo @ 0x1] Error opening rtmp://live.twitch.tv/app/<redacted>: Input/output error"] },
      { sql: "UPDATE playout_runtime SET last_error = $2, last_stderr_sample = $3, live_bridge_last_error = $4 WHERE singleton_id = $1", params: [1, "FFmpeg exited 1. Last stderr: rtmp://relay:1935/live/<redacted>?user=internal&pass=<redacted>", "[hls @ 0x2] ok", ""] }
    ]);
    expect(JSON.stringify(client.updates)).not.toMatch(/live_123456|hunter2|relaySecret1/);
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
