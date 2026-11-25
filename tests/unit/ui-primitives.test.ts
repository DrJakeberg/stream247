import { describe, expect, it } from "vitest";
import * as React from "../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server";
import { Badge, resolveBadgeContent } from "../../apps/web/components/ui/Badge";

// The web components are compiled with the classic JSX runtime here.
(globalThis as { React?: unknown }).React = React;

describe("ui primitives", () => {
  it("does not render badge content for empty or placeholder values", () => {
    expect(resolveBadgeContent("")).toBeNull();
    expect(resolveBadgeContent("   ")).toBeNull();
    expect(resolveBadgeContent("[]")).toBeNull();
  });

  it("keeps visible badge content when text is present", () => {
    expect(resolveBadgeContent("Ready")).toBe("Ready");
    expect(resolveBadgeContent(0)).toBe(0);
  });

  // M129: "danger" is an outage and wears the critical tone, so it no longer looks like "needs setup".
  it("maps each badge variant to its pill class", () => {
    const classOf = (variant: "ready" | "warning" | "danger" | "neutral" | "live") =>
      renderToStaticMarkup(React.createElement(Badge, { variant }, "State")).match(/class="([^"]*)"/)?.[1];
    expect(classOf("ready")).toBe("badge badge-ready");
    expect(classOf("live")).toBe("badge badge-ready");
    expect(classOf("warning")).toBe("badge badge-action");
    expect(classOf("danger")).toBe("badge badge-critical");
    expect(classOf("neutral")).toBe("badge badge-optional");
  });
});
