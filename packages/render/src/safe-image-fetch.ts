// Remote pictures for the overlay renderer, fetched by us instead of satori (M125).
//
// satori fetches every http(s) <img> src itself, with the global fetch: any host, any address,
// following redirects. In the web container that made the studio preview a request forger for every
// signed-in role, viewers included: an image layer naming http://relay:9997/ or a loopback port had
// the web process call it and hand the error text back. The worker renders the same stored layers
// from its own network.
//
// So the layout is walked before satori sees it, and every remote src becomes a data: URI fetched
// here: http and https only, every address the name resolves to must be public (no loopback,
// private, link-local, carrier-grade NAT, multicast or reserved ranges, IPv4-mapped forms included),
// the connection goes to exactly the address that was checked (no second lookup a rebinding name
// could answer differently), redirects are followed by hand and checked the same way, and the body
// is bounded in time (5 s for the whole fetch, redirects included), in size and in the pixel size its
// header declares (M127). A picture that cannot be fetched under these rules is drawn as a transparent
// pixel of its declared size, which is what an unreachable emote already looked like.

import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

export const REMOTE_IMAGE_TIMEOUT_MS = 5_000;
export const REMOTE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const REMOTE_IMAGE_MAX_REDIRECTS = 3;
// The bytes bound the download, not the decode (M127): resvg allocates the full RGBA pixmap of every
// picture it draws, and a few hundred bytes of PNG can declare 16000 x 16000, a gibibyte. A side of
// 8192 covers a 4K frame with margin and a wide banner; the product caps one decode at 64 MiB.
export const REMOTE_IMAGE_MAX_SIDE = 8192;
export const REMOTE_IMAGE_MAX_PIXELS = 4096 * 4096;
const REMOTE_IMAGE_CACHE_TTL_MS = 10 * 60_000;
// A picture that failed is asked again sooner: one network blip must not blank a logo for long.
const REMOTE_IMAGE_FAILURE_TTL_MS = 60_000;
const REMOTE_IMAGE_CACHE_MAX_ENTRIES = 256;
const REMOTE_IMAGE_CACHE_MAX_BYTES = 32 * 1024 * 1024;

/** A 1x1 transparent PNG: what a picture that may not or cannot be fetched is drawn as. */
export const TRANSPARENT_PIXEL_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const blockedAddresses = (() => {
  const list = new BlockList();
  for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4]
  ] as const) {
    list.addSubnet(network, prefix, "ipv4");
  }
  for (const [network, prefix] of [
    ["::", 128],
    ["::1", 128],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["fc00::", 7],
    ["fe80::", 10],
    ["fec0::", 10],
    ["ff00::", 8]
  ] as const) {
    list.addSubnet(network, prefix, "ipv6");
  }
  return list;
})();

function embeddedIpv4(address: string): string | null {
  // ::ffff:a.b.c.d and ::a.b.c.d, the NAT64 prefix 64:ff9b::/96 and 6to4 2002::/16 all carry an IPv4
  // address that the connection may end up at; each is judged by that address.
  const lower = address.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    return dotted[1] ?? null;
  }
  const hex = lower.match(/^(?:::ffff:|::|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = Number.parseInt(hex[1] ?? "0", 16);
    const low = Number.parseInt(hex[2] ?? "0", 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
  if (sixToFour) {
    const high = Number.parseInt(sixToFour[1] ?? "0", 16);
    const low = Number.parseInt(sixToFour[2] ?? "0", 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return null;
}

/** True only for an address on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return !blockedAddresses.check(address, "ipv4");
  }
  if (family === 6) {
    const v4 = embeddedIpv4(address);
    if (v4 !== null) {
      return isIP(v4) === 4 && !blockedAddresses.check(v4, "ipv4");
    }
    return !blockedAddresses.check(address, "ipv6");
  }
  return false;
}

export type ResolveHost = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultResolveHost: ResolveHost = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

type FetchedImage = { contentType: string; body: Buffer };

class RemoteImageRefused extends Error {}

function gifFrameSize(body: Buffer): { width: number; height: number } | null {
  // The first frame is what gets drawn, and its descriptor may declare more than the logical screen.
  let offset = 13;
  const packed = body[10] ?? 0;
  if (packed & 0x80) {
    offset += 3 * 2 ** ((packed & 7) + 1);
  }
  while (offset < body.length) {
    const block = body[offset];
    if (block === 0x2c) {
      if (offset + 9 > body.length) {
        return null;
      }
      return {
        width: body.readUInt16LE(offset + 1) + body.readUInt16LE(offset + 5),
        height: body.readUInt16LE(offset + 3) + body.readUInt16LE(offset + 7)
      };
    }
    if (block !== 0x21) {
      return null;
    }
    // An extension: label, then sub-blocks until an empty one.
    offset += 2;
    while (offset < body.length && body[offset] !== 0) {
      offset += (body[offset] ?? 0) + 1;
    }
    offset += 1;
  }
  return null;
}

function jpegSize(body: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 4 <= body.length) {
    if (body[offset] !== 0xff) {
      return null;
    }
    const marker = body[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // SOF0 to SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > body.length) {
        return null;
      }
      return { width: body.readUInt16BE(offset + 7), height: body.readUInt16BE(offset + 5) };
    }
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    offset += 2 + body.readUInt16BE(offset + 2);
  }
  return null;
}

function webpSize(body: Buffer): { width: number; height: number } | null {
  const chunk = body.toString("latin1", 12, 16);
  if (chunk === "VP8X" && body.length >= 30) {
    return { width: body.readUIntLE(24, 3) + 1, height: body.readUIntLE(27, 3) + 1 };
  }
  if (chunk === "VP8 " && body.length >= 30 && body[23] === 0x9d && body[24] === 0x01 && body[25] === 0x2a) {
    return { width: body.readUInt16LE(26) & 0x3fff, height: body.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L" && body.length >= 25 && body[20] === 0x2f) {
    const bits = body.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

function avifSize(body: Buffer): { width: number; height: number } | null {
  // Every ispe box (whole picture and grid tiles alike); the largest is what a decoder allocates.
  let width = 0;
  let height = 0;
  for (let at = body.indexOf("ispe", 0, "latin1"); at >= 0 && at + 16 <= body.length; at = body.indexOf("ispe", at + 4, "latin1")) {
    width = Math.max(width, body.readUInt32BE(at + 8));
    height = Math.max(height, body.readUInt32BE(at + 12));
  }
  return { width, height };
}

/**
 * The pixel size a raster picture declares in its header, read from the bytes whatever type the
 * server claimed; null when the bytes are no PNG, JPEG, GIF, WebP or AVIF, or the header is cut off.
 */
export function readPictureSize(body: Buffer): { width: number; height: number } | null {
  let size: { width: number; height: number } | null = null;
  if (body.length >= 24 && body.readUInt32BE(0) === 0x89504e47 && body.toString("latin1", 12, 16) === "IHDR") {
    size = { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
  } else if (body.length >= 4 && body[0] === 0xff && body[1] === 0xd8) {
    size = jpegSize(body);
  } else if (body.length >= 13 && /^GIF8[79]a$/.test(body.toString("latin1", 0, 6))) {
    const frame = gifFrameSize(body);
    size = frame
      ? { width: Math.max(body.readUInt16LE(6), frame.width), height: Math.max(body.readUInt16LE(8), frame.height) }
      : null;
  } else if (body.length >= 16 && body.toString("latin1", 0, 4) === "RIFF" && body.toString("latin1", 8, 12) === "WEBP") {
    size = webpSize(body);
  } else if (body.length >= 12 && body.toString("latin1", 4, 8) === "ftyp") {
    size = avifSize(body);
  }
  return size && size.width > 0 && size.height > 0 ? size : null;
}

/** Refuses a picture whose decode would be larger than the limits above. */
function checkPictureSize(body: Buffer, contentType: string): void {
  const size = readPictureSize(body);
  if (!size) {
    // An SVG is drawn as vectors into the frame, without a pixmap of its own size. Measured on
    // resvg-js 2.6.2: a raster embedded in it is not decoded either.
    if (contentType === "image/svg+xml") {
      return;
    }
    throw new RemoteImageRefused("has a size that cannot be read");
  }
  if (
    size.width > REMOTE_IMAGE_MAX_SIDE ||
    size.height > REMOTE_IMAGE_MAX_SIDE ||
    size.width * size.height > REMOTE_IMAGE_MAX_PIXELS
  ) {
    throw new RemoteImageRefused("is larger than the picture size limit");
  }
}

async function resolvePublicAddresses(hostname: string, resolveHost: ResolveHost): Promise<Array<{ address: string; family: number }>> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(bare) ? [{ address: bare, family: isIP(bare) }] : await resolveHost(bare);
  // Every answer must be public: a name that also resolves to an internal address is refused whole,
  // whichever answer the connection would have used.
  if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new RemoteImageRefused(`${hostname} does not resolve to a public address only.`);
  }
  return addresses;
}

/** Exported for tests only: one request to an already checked address. */
export function requestOnce(url: URL, pinned: { address: string; family: number }, deadline: number): Promise<
  { kind: "redirect"; location: string } | { kind: "image"; image: FetchedImage }
> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        headers: { accept: "image/*" },
        // The connection goes to the address that was checked, never to a second lookup.
        lookup: (_hostname, options, callback) => {
          if ((options as { all?: boolean }).all) {
            (callback as unknown as (error: null, addresses: Array<{ address: string; family: number }>) => void)(null, [pinned]);
          } else {
            callback(null, pinned.address, pinned.family);
          }
        },
        timeout: REMOTE_IMAGE_TIMEOUT_MS
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          resolve({ kind: "redirect", location: response.headers.location });
          return;
        }
        const contentType = String(response.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
        if (status !== 200 || !contentType.startsWith("image/")) {
          response.resume();
          reject(new RemoteImageRefused(`answered ${status} ${contentType || "without a content type"}`));
          return;
        }
        const declared = Number(response.headers["content-length"] ?? "");
        if (Number.isFinite(declared) && declared > REMOTE_IMAGE_MAX_BYTES) {
          response.destroy();
          reject(new RemoteImageRefused("is larger than the picture limit"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > REMOTE_IMAGE_MAX_BYTES) {
            response.destroy();
            reject(new RemoteImageRefused("is larger than the picture limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          try {
            checkPictureSize(body, contentType);
          } catch (error) {
            reject(error);
            return;
          }
          resolve({ kind: "image", image: { contentType, body } });
        });
        response.on("error", reject);
      }
    );
    request.on("timeout", () => request.destroy(new RemoteImageRefused("did not answer in time")));
    // The socket timeout only fires while nothing arrives; a host that drips one byte a second would
    // hold the frame for hours. This bounds the whole fetch, redirects included.
    const overall = setTimeout(
      () => request.destroy(new RemoteImageRefused("did not finish in time")),
      Math.max(0, deadline - Date.now())
    );
    request.on("close", () => clearTimeout(overall));
    request.on("error", reject);
    request.end();
  });
}

/** Fetches one remote picture under the rules above; throws when it may not or cannot be fetched. */
export async function fetchRemoteImage(rawUrl: string, resolveHost: ResolveHost = defaultResolveHost): Promise<FetchedImage> {
  let url = new URL(rawUrl);
  const deadline = Date.now() + REMOTE_IMAGE_TIMEOUT_MS;
  for (let hop = 0; hop <= REMOTE_IMAGE_MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new RemoteImageRefused(`${url.protocol} is not http or https`);
    }
    if (url.username || url.password) {
      throw new RemoteImageRefused("carries credentials");
    }
    const candidates = await resolvePublicAddresses(url.hostname, resolveHost);
    let answer: Awaited<ReturnType<typeof requestOnce>> | null = null;
    let lastError: unknown = null;
    // Each checked address in turn: an IPv6 answer first on a host without an IPv6 route must not
    // cost the picture. A refusal by the server (status, type, size) is final, only a failed
    // connection moves on.
    for (const pinned of candidates) {
      if (Date.now() >= deadline) {
        throw new RemoteImageRefused("did not finish in time");
      }
      try {
        answer = await requestOnce(url, pinned, deadline);
        break;
      } catch (error) {
        if (error instanceof RemoteImageRefused) {
          throw error;
        }
        lastError = error;
      }
    }
    if (!answer) {
      throw lastError ?? new RemoteImageRefused("could not be reached");
    }
    if (answer.kind === "image") {
      return answer.image;
    }
    url = new URL(answer.location, url);
  }
  throw new RemoteImageRefused("redirected too often");
}

function toDataUri(image: FetchedImage): string {
  return `data:${image.contentType};base64,${image.body.toString("base64")}`;
}

const cache = new Map<string, { dataUri: string; expiresAt: number }>();
let cachedBytes = 0;

function forget(url: string): void {
  const entry = cache.get(url);
  if (entry) {
    cachedBytes -= entry.dataUri.length;
    cache.delete(url);
  }
}

function remember(url: string, dataUri: string, now: number, ttlMs: number): void {
  forget(url);
  cache.set(url, { dataUri, expiresAt: now + ttlMs });
  cachedBytes += dataUri.length;
  // Bounded by count and by size, oldest first.
  while (cache.size > REMOTE_IMAGE_CACHE_MAX_ENTRIES || cachedBytes > REMOTE_IMAGE_CACHE_MAX_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined || oldest === url) {
      break;
    }
    forget(oldest);
  }
}

/** Test seam only. */
export function clearRemoteImageCache(): void {
  cache.clear();
  cachedBytes = 0;
}

/** A remote src as a data: URI, or the transparent pixel when it may not or cannot be fetched. Never throws. */
export async function resolveRemoteImageSrc(src: string, resolveHost: ResolveHost = defaultResolveHost): Promise<string> {
  const now = Date.now();
  const cached = cache.get(src);
  if (cached && cached.expiresAt > now) {
    return cached.dataUri;
  }
  try {
    const dataUri = toDataUri(await fetchRemoteImage(src, resolveHost));
    remember(src, dataUri, now, REMOTE_IMAGE_CACHE_TTL_MS);
    return dataUri;
  } catch {
    // Refused or unreachable: drawn empty, like an emote that did not load. Remembered for a minute,
    // so a refused address is not asked again on every frame.
    remember(src, TRANSPARENT_PIXEL_DATA_URI, now, REMOTE_IMAGE_FAILURE_TTL_MS);
    return TRANSPARENT_PIXEL_DATA_URI;
  }
}

type LayoutNodeLike = { type: string; props: { src?: string; children?: unknown } };

function collectRemoteSrcNodes(node: unknown, found: LayoutNodeLike[]): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectRemoteSrcNodes(child, found);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  const candidate = node as LayoutNodeLike;
  if (!candidate.props || typeof candidate.props !== "object") {
    return;
  }
  if (typeof candidate.props.src === "string" && !candidate.props.src.startsWith("data:")) {
    found.push(candidate);
  }
  collectRemoteSrcNodes(candidate.props.children, found);
}

/**
 * Replaces every src in a layout tree that is not a data: URI. satori then never fetches anything:
 * a src it would have fetched is either a picture we fetched under the rules above or the
 * transparent pixel.
 */
export async function inlineRemoteImages<T>(layout: T, resolveHost: ResolveHost = defaultResolveHost): Promise<T> {
  const nodes: LayoutNodeLike[] = [];
  collectRemoteSrcNodes(layout, nodes);
  await Promise.all(
    nodes.map(async (node) => {
      const src = node.props.src ?? "";
      node.props.src = /^https?:\/\//i.test(src) ? await resolveRemoteImageSrc(src, resolveHost) : TRANSPARENT_PIXEL_DATA_URI;
    })
  );
  return layout;
}
