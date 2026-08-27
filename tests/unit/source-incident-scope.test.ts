import { describe, expect, it } from "vitest";
import { planSourceIncidentResolution } from "../../apps/worker/src/source-sync-scope.js";

// C2: syncYoutubePlaylistSources resolved ingestion incidents behind a single `hadFailure` flag,
// so one failing source kept every healthy sibling's incident open. With a permanently broken
// source — a URL that will never validate — the healthy sources' incidents never resolved at all,
// and the incident list stopped describing reality. The per-source set was already being built
// two lines away for the replacement decision; it just was not used here.
describe("planSourceIncidentResolution", () => {
  const sources = [{ id: "src_ok" }, { id: "src_broken" }, { id: "src_ok_2" }];

  it("resolves the healthy sources' incidents even while a sibling is failing", () => {
    expect(planSourceIncidentResolution({ sources, failedSourceIds: new Set(["src_broken"]) })).toEqual({
      resolve: ["src_ok", "src_ok_2"],
      keepOpen: ["src_broken"]
    });
  });

  it("keeps every incident open when every source failed", () => {
    expect(
      planSourceIncidentResolution({ sources, failedSourceIds: new Set(["src_ok", "src_broken", "src_ok_2"]) })
    ).toEqual({ resolve: [], keepOpen: ["src_ok", "src_broken", "src_ok_2"] });
  });

  it("resolves everything when the whole sync was clean", () => {
    expect(planSourceIncidentResolution({ sources, failedSourceIds: new Set() })).toEqual({
      resolve: ["src_ok", "src_broken", "src_ok_2"],
      keepOpen: []
    });
  });

  it("handles a sync with no sources at all", () => {
    expect(planSourceIncidentResolution({ sources: [], failedSourceIds: new Set() })).toEqual({
      resolve: [],
      keepOpen: []
    });
  });
});
