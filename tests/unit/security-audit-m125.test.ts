import { readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearRemoteImageCache,
  inlineRemoteImages,
  isPublicAddress,
  resolveRemoteImageSrc,
  TRANSPARENT_PIXEL_DATA_URI
} from "@stream247/overlay-render";
import { requestOnce } from "../../packages/render/src/safe-image-fetch";
import { chatGameCommandLane, createChatGameCooldowns } from "../../apps/worker/src/chat-game-cooldown";
import { judgeUploadSpace, resolveUploadMaxFileBytes } from "../../apps/web/lib/server/upload-space";

// M125: the fixes for the security audit of 2026-10 (research/security-audit-2026-10.md) that need no
// database: chat game cooldowns (3.3), remote pictures in the renderer (scene preview SSRF lead),
// admin pages (layout-only lead), upload space (upload lead) and the CI token (release-tag lead).

const rootDir = path.resolve(__dirname, "../..");

describe("chat game cooldowns (audit 3.3)", () => {
  it("a viewer's 'game' does not swallow a moderator's '!game stop' right after it", () => {
    const cooldowns = createChatGameCooldowns(5_000);
    const now = 1_000_000;
    expect(cooldowns.claim(chatGameCommandLane({ kind: "info" }, false), now)).toBe(true);
    expect(cooldowns.claim(chatGameCommandLane({ kind: "stop" }, true), now + 100)).toBe(true);
  });

  it("a viewer's own '!game stop' (a refusal) uses the room's window, not the moderators'", () => {
    expect(chatGameCommandLane({ kind: "stop" }, false)).toBe("room");
    expect(chatGameCommandLane({ kind: "info" }, true)).toBe("room");
    expect(chatGameCommandLane({ kind: "start" }, true)).toBe("moderator");
  });

  it("each lane still holds its own five seconds", () => {
    const cooldowns = createChatGameCooldowns(5_000);
    expect(cooldowns.claim("moderator", 0 + 10_000)).toBe(true);
    expect(cooldowns.claim("moderator", 14_999)).toBe(false);
    expect(cooldowns.claim("moderator", 15_000)).toBe(true);
    expect(cooldowns.claim("room", 10_000)).toBe(true);
    expect(cooldowns.claim("room", 12_000)).toBe(false);
  });
});

describe("remote pictures in the overlay renderer (scene preview lead)", () => {
  it("knows internal addresses, IPv4-mapped and NAT64 forms included", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.18.0.4",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "64:ff9b::a9fe:a9fe",
      "2002:7f00:0001::1",
      "not-an-address"
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of ["1.1.1.1", "151.101.1.1", "2606:4700:4700::1111"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("never connects to a loopback fixture, and draws it as a transparent pixel", async () => {
    clearRemoteImageCache();
    let hits = 0;
    const server = http.createServer((_request, response) => {
      hits += 1;
      response.writeHead(200, { "content-type": "image/png" });
      response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const layout = {
        type: "div",
        props: {
          children: [
            { type: "img", props: { src: `http://127.0.0.1:${port}/logo.png` } },
            { type: "img", props: { src: `http://localhost:${port}/logo.png` } },
            { type: "img", props: { src: "data:image/png;base64,AAAA" } },
            { type: "img", props: { src: "file:///etc/passwd" } }
          ]
        }
      };
      const resolved = await inlineRemoteImages(layout);
      const sources = (resolved.props.children as Array<{ props: { src: string } }>).map((node) => node.props.src);
      expect(sources).toEqual([
        TRANSPARENT_PIXEL_DATA_URI,
        TRANSPARENT_PIXEL_DATA_URI,
        "data:image/png;base64,AAAA",
        TRANSPARENT_PIXEL_DATA_URI
      ]);
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });

  it("refuses a name that resolves to the relay's compose address, or to any internal address among public ones", async () => {
    clearRemoteImageCache();
    const asked: string[] = [];
    const resolveHost = async (hostname: string) => {
      asked.push(hostname);
      return hostname === "relay"
        ? [{ address: "172.18.0.3", family: 4 }]
        : [
            { address: "93.184.216.34", family: 4 },
            { address: "10.0.0.5", family: 4 }
          ];
    };
    expect(await resolveRemoteImageSrc("http://relay:9997/v3/paths/list", resolveHost)).toBe(TRANSPARENT_PIXEL_DATA_URI);
    expect(await resolveRemoteImageSrc("https://rebind.example/logo.png", resolveHost)).toBe(TRANSPARENT_PIXEL_DATA_URI);
    expect(asked).toEqual(["relay", "rebind.example"]);
  });
});

describe("remote pictures are bounded in time as a whole (review of M125)", () => {
  it("gives up on a host that drips one byte at a time, however steadily", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      const drip = setInterval(() => response.write(Buffer.from([0])), 100);
      response.on("close", () => clearInterval(drip));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const started = Date.now();
      await expect(
        requestOnce(new URL(`http://127.0.0.1:${port}/slow.png`), { address: "127.0.0.1", family: 4 }, Date.now() + 600)
      ).rejects.toThrow("did not finish in time");
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

describe("admin pages check the sign-in themselves (layout-only lead)", () => {
  function pages(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? pages(full) : entry === "page.tsx" ? [full] : [];
    });
  }

  it("every page under (admin) awaits requireAuthenticatedUser or requireRoles", () => {
    const found = pages(path.join(rootDir, "apps/web/app/(admin)"));
    expect(found.length).toBeGreaterThanOrEqual(18);
    const unguarded = found.filter((file) => !/await require(?:AuthenticatedUser|Roles)\(/.test(readFileSync(file, "utf8")));
    expect(unguarded).toEqual([]);
  });
});

describe("upload space (upload lead)", () => {
  const volume = { bsize: 4096, blocks: (100 * 1024 ** 3) / 4096, bavail: (20 * 1024 ** 3) / 4096 };

  it("allows an upload that leaves the watermark free and refuses one that does not", () => {
    expect(judgeUploadSpace({ volume, uploadBytes: 9 * 1024 ** 3, minFreeRatio: 0.1, maxFileBytes: null })).toEqual({ ok: true });
    const refused = judgeUploadSpace({ volume, uploadBytes: 11 * 1024 ** 3, minFreeRatio: 0.1, maxFileBytes: null });
    expect(refused).toMatchObject({ ok: false, status: 507 });
  });

  it("applies STREAM247_UPLOAD_MAX_BYTES only when it is a positive number", () => {
    expect(resolveUploadMaxFileBytes({})).toBeNull();
    expect(resolveUploadMaxFileBytes({ STREAM247_UPLOAD_MAX_BYTES: "abc" })).toBeNull();
    expect(resolveUploadMaxFileBytes({ STREAM247_UPLOAD_MAX_BYTES: "1000" })).toBe(1000);
    expect(judgeUploadSpace({ volume, uploadBytes: 2000, minFreeRatio: 0.1, maxFileBytes: 1000 })).toMatchObject({ ok: false, status: 413 });
  });
});

describe("CI token (release-tag lead)", () => {
  const ci = readFileSync(path.join(rootDir, ".github/workflows/ci.yml"), "utf8");

  it("holds packages: write only in the publish job, which runs for pushes to main only", () => {
    const publishAt = ci.indexOf("\n  publish:\n");
    expect(publishAt).toBeGreaterThan(0);
    const validate = ci.slice(0, publishAt);
    const publish = ci.slice(publishAt);
    expect(validate).not.toMatch(/packages:\s*write/);
    expect(validate).not.toMatch(/push:\s*true/);
    expect(publish).toMatch(/if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
    expect(publish).toMatch(/packages:\s*write/);
    expect(publish).toMatch(/type=sha,prefix=main-/);
  });

  it("test builds take node:22-alpine from mirror.gcr.io; the Dockerfiles and the publish job do not (owner's choice 2026-10-27)", () => {
    const publishAt = ci.indexOf("\n  publish:\n");
    const validate = ci.slice(0, publishAt);
    const publish = ci.slice(publishAt);
    const tagAt = validate.indexOf(
      "docker tag mirror.gcr.io/library/node:22-alpine public.ecr.aws/docker/library/node:22-alpine"
    );
    expect(tagAt).toBeGreaterThan(0);
    expect(tagAt).toBeLessThan(validate.indexOf("docker build -f docker/web.Dockerfile"));
    expect(publish).not.toContain("mirror.gcr.io");
    for (const file of ["docker/web.Dockerfile", "docker/worker.Dockerfile"]) {
      const from = readFileSync(path.join(rootDir, file), "utf8").match(/^FROM .*/gm) ?? [];
      expect(from.length).toBeGreaterThan(0);
      for (const line of from) expect(line).toMatch(/^FROM public\.ecr\.aws\/docker\/library\/node:22-alpine /);
    }
  });
});

describe("web memory ceiling (upload lead, owner's choice 2026-10-27)", () => {
  it("gives web a 2 GiB mem_limit that STREAM247_WEB_MEMORY_LIMIT can change", () => {
    const compose = readFileSync(path.join(rootDir, "docker-compose.yml"), "utf8");
    const web = compose.slice(compose.indexOf("\n  web:\n"), compose.indexOf("\n  worker:\n"));
    expect(web).toContain("mem_limit: ${STREAM247_WEB_MEMORY_LIMIT:-2g}");
  });

  it("publishes web's port on 127.0.0.1 only unless STREAM247_WEB_BIND opens it (owner's choice 2026-10-27)", () => {
    const compose = readFileSync(path.join(rootDir, "docker-compose.yml"), "utf8");
    const web = compose.slice(compose.indexOf("\n  web:\n"), compose.indexOf("\n  worker:\n"));
    expect(web).toContain('- "${STREAM247_WEB_BIND:-127.0.0.1}:3000:3000"');
    expect(web).not.toMatch(/- "3000:3000"/);
  });
});
