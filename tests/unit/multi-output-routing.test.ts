import { describe, expect, it } from "vitest";
import { selectActiveDestinationGroup } from "@stream247/core";
import type { StreamDestinationRecord } from "@stream247/db";
import {
  buildFfmpegOutputTarget,
  matchDestinationFailuresInLog,
  selectDestinationRuntimeTargets
} from "../../apps/worker/src/multi-output";

function createDestination(overrides: Partial<StreamDestinationRecord> = {}): StreamDestinationRecord {
  return {
    id: "destination-primary",
    provider: "twitch",
    role: "primary",
    priority: 0,
    name: "Primary",
    enabled: true,
    rtmpUrl: "rtmp://live.twitch.tv/app",
    streamKeyPresent: true,
    streamKeySource: "env",
    status: "ready",
    notes: "",
    lastValidatedAt: "",
    lastFailureAt: "",
    failureCount: 0,
    lastError: "",
    ...overrides
  };
}

describe("multi-output routing", () => {
  it("selects all healthy primary destinations before backups", () => {
    const selection = selectActiveDestinationGroup([
      {
        id: "destination-primary",
        name: "Primary Twitch",
        role: "primary",
        priority: 0,
        enabled: true,
        streamKeyPresent: true,
        status: "ready"
      },
      {
        id: "destination-youtube",
        name: "YouTube",
        role: "primary",
        priority: 1,
        enabled: true,
        streamKeyPresent: true,
        status: "ready"
      },
      {
        id: "destination-backup",
        name: "Backup",
        role: "backup",
        priority: 10,
        enabled: true,
        streamKeyPresent: true,
        status: "ready"
      }
    ]);

    expect(selection.mode).toBe("primary");
    expect(selection.activeDestinationIds).toEqual(["destination-primary", "destination-youtube"]);
    expect(selection.leadDestinationId).toBe("destination-primary");
  });

  it("resolves runtime targets from env-backed and managed keys", () => {
    const result = selectDestinationRuntimeTargets({
      destinations: [
        createDestination(),
        createDestination({
          id: "destination-youtube",
          provider: "custom-rtmp",
          name: "YouTube",
          priority: 1,
          rtmpUrl: "rtmp://a.rtmp.youtube.com/live2",
          streamKeySource: "managed"
        })
      ],
      managedKeys: {
        "destination-youtube": "managed-key"
      },
      env: {
        STREAM_OUTPUT_URL: "rtmp://live.twitch.tv/app",
        STREAM_OUTPUT_KEY: "env-key"
      } as NodeJS.ProcessEnv
    });

    expect(result.mode).toBe("primary");
    expect(result.leadDestination?.id).toBe("destination-primary");
    expect(result.targets.map((entry) => entry.target)).toEqual([
      "rtmp://live.twitch.tv/app/env-key",
      "rtmp://a.rtmp.youtube.com/live2/managed-key"
    ]);
  });

  it("builds a tee muxer output for multiple active destinations", () => {
    const output = buildFfmpegOutputTarget([
      {
        destination: createDestination(),
        target: "rtmp://live.twitch.tv/app/env-key"
      },
      {
        destination: createDestination({
          id: "destination-youtube",
          provider: "custom-rtmp",
          name: "YouTube",
          priority: 1,
          rtmpUrl: "rtmp://a.rtmp.youtube.com/live2",
          streamKeySource: "managed"
        }),
        target: "rtmp://a.rtmp.youtube.com/live2/managed-key"
      }
    ]);

    expect(output.muxer).toBe("tee");
    expect(output.output).toContain("[onfail=ignore:f=flv:use_fifo=1]rtmp://live.twitch.tv/app/env-key");
    expect(output.output).toContain("[onfail=ignore:f=flv:use_fifo=1]rtmp://a.rtmp.youtube.com/live2/managed-key");
  });

  it("maps destination-specific FFmpeg errors back to destination ids", () => {
    const matched = matchDestinationFailuresInLog("Connection reset while writing to a.rtmp.youtube.com", [
      {
        destination: createDestination(),
        target: "rtmp://live.twitch.tv/app/env-key"
      },
      {
        destination: createDestination({
          id: "destination-youtube",
          provider: "custom-rtmp",
          name: "YouTube",
          priority: 1,
          rtmpUrl: "rtmp://a.rtmp.youtube.com/live2",
          streamKeySource: "managed"
        }),
        target: "rtmp://a.rtmp.youtube.com/live2/managed-key"
      }
    ]);

    expect(matched).toEqual(["destination-youtube"]);
  });
});
