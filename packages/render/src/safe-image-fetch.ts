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
// is bounded in time and size. A picture that cannot be fetched under these rules is drawn as a
// transparent pixel of its declared size, which is what an unreachable emote already looked like.

import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

export const REMOTE_IMAGE_TIMEOUT_MS = 5_000;
export const REMOTE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const REMOTE_IMAGE_MAX_REDIRECTS = 3;
const REMOTE_IMAGE_CACHE_TTL_MS = 10 * 60_000;
const REMOTE_IMAGE_CACHE_MAX_ENTRIES = 256;

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

async function resolvePublicAddress(hostname: string, resolveHost: ResolveHost): Promise<{ address: string; family: number }> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(bare) ? [{ address: bare, family: isIP(bare) }] : await resolveHost(bare);
  // Every answer must be public: a name that also resolves to an internal address is refused whole,
  // whichever answer the connection would have used.
  if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new RemoteImageRefused(`${hostname} does not resolve to a public address only.`);
  }
  return addresses[0]!;
}

function requestOnce(url: URL, pinned: { address: string; family: number }): Promise<
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
        response.on("end", () => resolve({ kind: "image", image: { contentType, body: Buffer.concat(chunks) } }));
        response.on("error", reject);
      }
    );
    request.on("timeout", () => request.destroy(new RemoteImageRefused("did not answer in time")));
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
    const pinned = await resolvePublicAddress(url.hostname, resolveHost);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new RemoteImageRefused("did not answer in time");
    }
    const answer = await requestOnce(url, pinned);
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

function remember(url: string, dataUri: string, now: number): void {
  cache.delete(url);
  cache.set(url, { dataUri, expiresAt: now + REMOTE_IMAGE_CACHE_TTL_MS });
  while (cache.size > REMOTE_IMAGE_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
}

/** Test seam only. */
export function clearRemoteImageCache(): void {
  cache.clear();
}

/** A remote src as a data: URI, or the transparent pixel when it may not or cannot be fetched. Never throws. */
export async function resolveRemoteImageSrc(src: string, resolveHost: ResolveHost = defaultResolveHost): Promise<string> {
  const now = Date.now();
  const cached = cache.get(src);
  if (cached && cached.expiresAt > now) {
    return cached.dataUri;
  }
  let dataUri = TRANSPARENT_PIXEL_DATA_URI;
  try {
    dataUri = toDataUri(await fetchRemoteImage(src, resolveHost));
  } catch {
    // Refused or unreachable: drawn empty, like an emote that did not load. Remembered as well, so a
    // refused address is not asked again on every frame.
  }
  remember(src, dataUri, now);
  return dataUri;
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
