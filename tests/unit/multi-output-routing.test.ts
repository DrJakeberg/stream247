import { describe, expect, it } from "vitest";
import { selectActiveDestinationGroup } from "@stream247/core";
import type { StreamDestinationRecord } from "@stream247/db";
import {
  buildFfmpegOutputTarget,
  groupDestinationRuntimeTargetsByOutputProfile,
  matchDestinationFailuresInLog,
  selectDestinationRuntimeTargets
} from "../../apps/worker/src/multi-output";

function createDestination(overrides: Partial<StreamDestinationRecord> = {}): StreamDestinationRecord {
  return {
    id: "destination-primary",
    provider: "twitch",
    role: "primary",
    priority: 0,
    outputProfileId: "inherit",
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

  it("keeps recovering primary outputs out of the active group until they are ready again", () => {
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
        status: "recovering"
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
    expect(selection.activeDestinationIds).toEqual(["destination-primary"]);
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

  it("groups active destinations by effective output profile", () => {
    const groups = groupDestinationRuntimeTargetsByOutputProfile({
      targets: [
        {
          destination: createDestination({
            id: "destination-primary",
            name: "Primary Twitch",
            outputProfileId: "inherit"
          }),
          target: "rtmp://live.twitch.tv/app/env-key"
        },
        {
          destination: createDestination({
            id: "destination-youtube",
            provider: "custom-rtmp",
            name: "YouTube",
            priority: 1,
            outputProfileId: "360p30"
          }),
          target: "rtmp://a.rtmp.youtube.com/live2/managed-key"
        },
        {
          destination: createDestination({
            id: "destination-secondary",
            provider: "custom-rtmp",
            name: "Secondary Twitch",
            priority: 2,
            outputProfileId: "inherit"
          }),
          target: "rtmp://live.example.com/app/secondary-key"
        }
      ],
      streamOutput: {
        profileId: "1080p30",
        width: 1920,
        height: 1080,
        fps: 30,
        updatedAt: "2026-04-21T10:00:00.000Z"
      },
      env: {
        STREAM_OUTPUT_WIDTH: "1280",
        STREAM_OUTPUT_HEIGHT: "720",
        STREAM_OUTPUT_FPS: "30"
      } as NodeJS.ProcessEnv
    });

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.label)).toEqual(["1280x720@30", "640x360@30"]);
    expect(groups[0]?.targets.map((entry) => entry.destination.id)).toEqual([
      "destination-primary",
      "destination-secondary"
    ]);
    expect(groups[0]?.settings).toMatchObject({
      profileId: "custom",
      width: 1280,
      height: 720,
      fps: 30
    });
    expect(groups[1]?.targets.map((entry) => entry.destination.id)).toEqual(["destination-youtube"]);
    expect(groups[1]?.settings).toMatchObject({
      profileId: "360p30",
      width: 640,
      height: 360,
      fps: 30
    });
  });

  it("flushes local file tee outputs while preserving fifo buffering", () => {
    const output = buildFfmpegOutputTarget([
      {
        destination: createDestination(),
        target: "/tmp/stream-output/primary/primary.flv"
      },
      {
        destination: createDestination({
          id: "destination-secondary",
          provider: "custom-rtmp",
          name: "Secondary",
          priority: 1,
          rtmpUrl: "/tmp/stream-output/secondary",
          streamKeySource: "managed"
        }),
        target: "/tmp/stream-output/secondary/secondary.flv"
      }
    ]);

    expect(output.muxer).toBe("tee");
    expect(output.output).toContain(
      "[onfail=ignore:f=flv:use_fifo=1:flush_packets=1]/tmp/stream-output/primary/primary.flv"
    );
    expect(output.output).toContain(
      "[onfail=ignore:f=flv:use_fifo=1:flush_packets=1]/tmp/stream-output/secondary/secondary.flv"
    );
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

  it("can disable single-target fallback when reclassifying an unexpected exit", () => {
    const matched = matchDestinationFailuresInLog(
      "[vist#0:1/h264 @ 0x75004d07e1c0] Resumed reading at pts 269.950 with rate 1.050 after a lag of 0.316s",
      [
        {
          destination: createDestination(),
          target: "rtmp://live.twitch.tv/app/env-key"
        }
      ],
      { allowSingleTargetFallback: false }
    );

    expect(matched).toEqual([]);
  });
});
