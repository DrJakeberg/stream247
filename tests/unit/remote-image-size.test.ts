import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import * as safeImageFetch from "../../packages/render/src/safe-image-fetch";
import { requestOnce } from "../../packages/render/src/safe-image-fetch";

// M127: a picture is bounded in decoded pixels, not only in bytes. resvg allocates the full RGBA pixmap
// of every picture it draws, and a few hundred bytes of PNG can declare 16000 x 16000 (1 GiB).

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8;
  header[25] = 6;
  // Body padding, as an IDAT would follow; the size check never reads it.
  return Buffer.concat([header, Buffer.alloc(64)]);
}

function jpeg(width: number, height: number): Buffer {
  // SOI, an APP0 segment and a DHT (which must be skipped although C4 sits in the SOF range), then SOF2.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]);
  const dht = Buffer.from([0xff, 0xc4, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc2, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dht, sof, Buffer.alloc(16)]);
}

function gif(width: number, height: number): Buffer {
  const body = Buffer.alloc(32);
  body.write("GIF89a", 0, "latin1");
  body.writeUInt16LE(width, 6);
  body.writeUInt16LE(height, 8);
  // No global colour table; the first image descriptor covers the whole screen.
  body[13] = 0x2c;
  body.writeUInt16LE(width, 18);
  body.writeUInt16LE(height, 20);
  return body;
}

function webpVp8x(width: number, height: number): Buffer {
  const body = Buffer.alloc(40);
  body.write("RIFF", 0, "latin1");
  body.writeUInt32LE(32, 4);
  body.write("WEBPVP8X", 8, "latin1");
  body.writeUInt32LE(10, 16);
  body.writeUIntLE(width - 1, 24, 3);
  body.writeUIntLE(height - 1, 27, 3);
  return body;
}

function webpVp8(width: number, height: number): Buffer {
  const body = Buffer.alloc(40);
  body.write("RIFF", 0, "latin1");
  body.write("WEBPVP8 ", 8, "latin1");
  body.writeUInt32LE(20, 16);
  Buffer.from([0x9d, 0x01, 0x2a]).copy(body, 23);
  body.writeUInt16LE(width, 26);
  body.writeUInt16LE(height, 28);
  return body;
}

function webpVp8l(width: number, height: number): Buffer {
  const body = Buffer.alloc(40);
  body.write("RIFF", 0, "latin1");
  body.write("WEBPVP8L", 8, "latin1");
  body.writeUInt32LE(20, 16);
  body[20] = 0x2f;
  body.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21);
  return body;
}

function avif(width: number, height: number): Buffer {
  const body = Buffer.alloc(48);
  body.writeUInt32BE(24, 0);
  body.write("ftypavif", 4, "latin1");
  body.writeUInt32BE(20, 24);
  body.write("ispe", 28, "latin1");
  body.writeUInt32BE(width, 36);
  body.writeUInt32BE(height, 40);
  return body;
}

async function serveOnce(contentType: string, body: Buffer) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await requestOnce(new URL(`http://127.0.0.1:${port}/picture`), { address: "127.0.0.1", family: 4 }, Date.now() + 2_000);
  } finally {
    server.close();
  }
}

describe("remote pictures are bounded in decoded size (M127)", () => {
  it("reads the declared size of PNG, JPEG, GIF and WebP headers", () => {
    const { readPictureSize } = safeImageFetch as unknown as {
      readPictureSize: (body: Buffer) => { width: number; height: number } | null;
    };
    expect(typeof readPictureSize).toBe("function");
    for (const side of [64, 16000]) {
      expect(readPictureSize(png(side, side))).toEqual({ width: side, height: side });
      expect(readPictureSize(jpeg(side, side))).toEqual({ width: side, height: side });
      expect(readPictureSize(gif(side, side))).toEqual({ width: side, height: side });
      expect(readPictureSize(webpVp8x(side, side))).toEqual({ width: side, height: side });
      expect(readPictureSize(avif(side, side))).toEqual({ width: side, height: side });
    }
    expect(readPictureSize(webpVp8(64, 48))).toEqual({ width: 64, height: 48 });
    expect(readPictureSize(webpVp8l(64, 48))).toEqual({ width: 64, height: 48 });
    expect(readPictureSize(Buffer.from("not a picture"))).toBeNull();
    expect(readPictureSize(png(64, 64).subarray(0, 20))).toBeNull();
  });

  it("refuses a small PNG that declares 16000 x 16000, and keeps an ordinary one and an SVG", async () => {
    await expect(serveOnce("image/png", png(16000, 16000))).rejects.toThrow(/picture size limit/);
    // Wide but thin is still too many pixels on one side.
    await expect(serveOnce("image/png", png(9000, 10))).rejects.toThrow(/picture size limit/);
    // Each side within the limit, the product over it.
    await expect(serveOnce("image/png", png(8192, 4096))).rejects.toThrow(/picture size limit/);
    await expect(serveOnce("image/gif", gif(16000, 16000))).rejects.toThrow(/picture size limit/);
    await expect(serveOnce("image/png", Buffer.from("garbage"))).rejects.toThrow(/cannot be read/);

    const small = await serveOnce("image/png", png(64, 64));
    expect(small.kind).toBe("image");
    const banner = await serveOnce("image/png", png(8192, 2048));
    expect(banner.kind).toBe("image");
    const svg = await serveOnce("image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000"/>'));
    expect(svg.kind).toBe("image");
  });
});
