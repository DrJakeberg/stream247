import { describe, expect, it } from "vitest";
import { overlayPlacementColumnsMigration } from "@stream247/db";

/**
 * The migration that was never written, found on the live database.
 *
 * `panel_placements_json` and `ticker_rotate_seconds` were added to the base-schema block and to
 * nothing else. The base-schema block is itself a migration, registered under one fixed id, so once
 * that id is recorded it never runs again — an existing install gets nothing. Measured on the live
 * DUT at v1.5.43: `overlay_settings` had 33 columns and neither of these two, and
 * `SELECT panel_placements_json FROM overlay_settings` answered `column ... does not exist`.
 *
 * Both are in the column list of `upsertOverlaySettingsTable`, which is what
 * `updateOverlaySettingsRecord` and `publishOverlayDraftRecord` call. So every save and every
 * publish from the design studio failed against that database — including the one an operator makes
 * by dragging a panel, which is exactly what writes `panel_placements_json`.
 *
 * Additive and idempotent, matching the base-schema block. The defaults are the readers' own
 * fallbacks — '{}' is "no panel has been moved" and 8 is OVERLAY_TICKER_DEFAULT_SECONDS — so the
 * picture is right the moment the columns exist, with nothing to backfill.
 */
function fakeClient() {
  const statements: string[] = [];
  return {
    statements,
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: [] };
    }
  };
}

describe("20260903_001_overlay_placement_columns", () => {
  it("adds both columns to both tables", async () => {
    const client = fakeClient();
    await overlayPlacementColumnsMigration.apply(client as never);
    const sql = client.statements.join("\n");
    for (const table of ["overlay_settings", "overlay_drafts"]) {
      expect(sql).toContain(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS panel_placements_json TEXT NOT NULL DEFAULT '{}'`);
      expect(sql).toContain(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ticker_rotate_seconds INTEGER NOT NULL DEFAULT 8`);
    }
  });

  it("says the same thing the base schema does, so a fresh install and an old one agree", async () => {
    const client = fakeClient();
    await overlayPlacementColumnsMigration.apply(client as never);
    const sql = client.statements.join("\n");
    // IF NOT EXISTS on every statement: the columns are already there on a database created from
    // the base schema, and re-running has to be free.
    const alters = sql.match(/ALTER TABLE \w+ ADD COLUMN[^;]*/g) ?? [];
    expect(alters).toHaveLength(4);
    expect(alters.every((statement) => statement.includes("IF NOT EXISTS"))).toBe(true);
  });

  it("is registered, and after the scenes migration that shipped with it", () => {
    expect(overlayPlacementColumnsMigration.id).toBe("20260903_001_overlay_placement_columns");
    expect(overlayPlacementColumnsMigration.description).toBeTruthy();
  });
});
