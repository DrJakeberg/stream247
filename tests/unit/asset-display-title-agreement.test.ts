import { describe, expect, it } from "vitest";
import { overlayAssetDisplayTitle } from "@stream247/core";
import { buildAssetDisplayTitle as workerTitle } from "../../apps/worker/src/asset-display-title";
import { buildAssetDisplayTitle as webTitle } from "../../apps/web/lib/asset-metadata";

/**
 * The asset display title, held together rather than claimed to be consolidated.
 *
 * It was written four times: the worker's, the web's, a private copy inside
 * apps/web/lib/server/state.ts, and — added by the chapter-title change — one in core. The commit
 * message for that change said the title "moves with it". It did not: nothing moved, and a fourth
 * copy joined three that stayed. Adversarial review caught the claim, and this is the honest
 * version of it.
 *
 * The private copy in state.ts is gone; that file calls core's now. The worker's and the web's stay
 * where they are — each has its own call-site family and moving them at this hour buys nothing —
 * but nothing was holding the three together, and a chapter title built by one while the asset
 * title beside it is built by another is exactly the fault class the change claimed to retire.
 *
 * So they are measured against each other instead. Reviewed and measured: they agree on every input
 * anyone could construct, including whitespace-only titles, zero-width characters and a
 * right-to-left override. The only difference is the worker's extra fallbackTitle parameter, which
 * the others do not have and which no shared call site passes.
 */
const INPUTS: { name: string; asset: { title?: string; titlePrefix?: string } | null | undefined }[] = [
  { name: "plain", asset: { title: "Advent of Code", titlePrefix: "" } },
  { name: "with prefix", asset: { title: "Advent of Code", titlePrefix: "Replay:" } },
  { name: "prefix only", asset: { title: "", titlePrefix: "Replay:" } },
  { name: "title only", asset: { title: "Advent of Code" } },
  { name: "null", asset: null },
  { name: "undefined", asset: undefined },
  { name: "padded both", asset: { title: "  Show  ", titlePrefix: "  Replay:  " } },
  { name: "whitespace title", asset: { title: "   ", titlePrefix: "Replay:" } },
  { name: "zero width", asset: { title: "a​b", titlePrefix: "" } },
  { name: "right to left override", asset: { title: "a‮b", titlePrefix: "Replay:" } },
  { name: "newline", asset: { title: "one\ntwo", titlePrefix: "" } },
  { name: "empty both", asset: { title: "", titlePrefix: "" } }
];

describe("asset display title, three implementations", () => {
  it.each(INPUTS)("agrees on $name", ({ asset }) => {
    const core = overlayAssetDisplayTitle(asset);
    expect({ who: "worker", title: workerTitle(asset as never) }).toEqual({ who: "worker", title: core });
    expect({ who: "web", title: webTitle(asset as never) }).toEqual({ who: "web", title: core });
  });

  it("no longer keeps a fourth copy inside the state builder", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../apps/web/lib/server/state.ts", import.meta.url), "utf8");
    expect(source).not.toContain("function buildAssetDisplayTitle");
    expect(source).toContain("overlayAssetDisplayTitle(");
  });
});
