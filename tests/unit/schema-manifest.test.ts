import { describe, expect, it } from "vitest";
import { DECLARED_SCHEMA } from "@stream247/db";
import { parseDeclaredSchema } from "../../scripts/lib/schema-manifest.mjs";

/**
 * The manifest against the SQL it was generated from.
 *
 * A generated file that nobody regenerates is worse than no file: it would answer confidently and
 * be wrong. This is the only thing keeping it honest — add a column to the schema without running
 * scripts/generate-schema-manifest.mjs and this fails, naming the column.
 *
 * The manifest exists because of what it would have caught. panel_placements_json and
 * ticker_rotate_seconds were added to the base-schema block and to nothing else, and that block is
 * itself a migration under one fixed id — so a fresh install had them and the live channel did not,
 * for weeks, while every save out of the design studio failed against a column that was not there.
 *
 * Verified against the real database once it was written: 39 tables, 460 columns, nothing missing
 * and nothing extra. That comparison also caught a parser fault — schema_migrations closes its
 * statement on the next line, so requiring the semicolon made the body run on into the surrounding
 * JavaScript and contribute "async", "await", "const" and five more as columns.
 */
const parsed = parseDeclaredSchema("packages/db/src/index.ts") as Record<string, string[]>;

describe("declared schema manifest", () => {
  it("names the same tables the schema creates", () => {
    expect(Object.keys(DECLARED_SCHEMA).sort()).toEqual(Object.keys(parsed).sort());
  });

  it("names the same columns, table by table", () => {
    for (const [table, columns] of Object.entries(parsed)) {
      expect({ table, columns: DECLARED_SCHEMA[table] }).toEqual({ table, columns });
    }
  });

  it("carries the two columns whose absence broke the studio", () => {
    for (const table of ["overlay_settings", "overlay_drafts"]) {
      expect(DECLARED_SCHEMA[table]).toContain("panel_placements_json");
      expect(DECLARED_SCHEMA[table]).toContain("ticker_rotate_seconds");
    }
  });

  it("reads a column out of a migration as readily as out of the base schema", () => {
    // Five tables are created by migrations and never appear in the base-schema block. A fresh
    // install runs the migrations too, so what it ends up with is the union — and the union is what
    // an old install has to match.
    expect(Object.keys(DECLARED_SCHEMA)).toContain("chat_viewer_requests");
    expect(Object.keys(DECLARED_SCHEMA)).toContain("asset_collections");
  });

  it("keeps constraint lines and comments out of the column lists", () => {
    // The parser reads CREATE TABLE bodies line by line, so a UNIQUE or a comment sitting among the
    // columns would otherwise arrive as one.
    for (const columns of Object.values(DECLARED_SCHEMA)) {
      for (const column of columns) {
        expect({ column, shape: /^[a-z][a-z0-9_]*$/.test(column) }).toEqual({ column, shape: true });
      }
    }
    expect(DECLARED_SCHEMA["schema_migrations"]).toEqual(["applied_at", "description", "id"]);
    expect(DECLARED_SCHEMA["audit_events"]).toEqual(["created_at", "id", "message", "type"]);
  });
});
