import { describe, expect, it } from "vitest";
import { findMissingDeclaredColumns } from "@stream247/db";

/**
 * The check that would have found it on the first boot instead of weeks later.
 *
 * panel_placements_json and ticker_rotate_seconds lived in the base-schema block and nowhere else.
 * That block is itself a migration under one fixed id, so a fresh install had them and the live
 * channel did not — and because the columns are only written on an explicit save, nothing failed
 * loudly. The channel ran on, the logs stayed clean, and every save out of the design studio hit a
 * column that was not there.
 *
 * So after the migrations have run, the database is asked what it actually has and compared with
 * what the source says it should. Driven with a fake client here: the query is one read of
 * information_schema and the answer is a list, which is the whole of it.
 */
function fakeClient(rows: { table_name: string; column_name: string }[]) {
  const queries: string[] = [];
  return {
    queries,
    query: async (sql: string) => {
      queries.push(sql);
      return { rows };
    }
  };
}

/** Every column the manifest declares, so a test can then take one away. */
async function everything() {
  const { DECLARED_SCHEMA } = (await import("@stream247/db")) as unknown as {
    DECLARED_SCHEMA: Record<string, string[]>;
  };
  return Object.entries(DECLARED_SCHEMA).flatMap(([table_name, columns]) =>
    columns.map((column_name) => ({ table_name, column_name }))
  );
}

describe("schema drift check", () => {
  it("finds nothing when the database has everything the source declares", async () => {
    const client = fakeClient(await everything());
    expect(await findMissingDeclaredColumns(client as never)).toEqual([]);
  });

  it("names the column that is missing, and the table it belongs to", async () => {
    const rows = (await everything()).filter(
      (row) => !(row.table_name === "overlay_settings" && row.column_name === "panel_placements_json")
    );
    expect(await findMissingDeclaredColumns(fakeClient(rows) as never)).toEqual([
      { table: "overlay_settings", column: "panel_placements_json" }
    ]);
  });

  it("names a whole table when the table itself never arrived", async () => {
    const rows = (await everything()).filter((row) => row.table_name !== "chat_viewer_requests");
    const missing = await findMissingDeclaredColumns(fakeClient(rows) as never);
    expect(missing.every((entry) => entry.table === "chat_viewer_requests")).toBe(true);
    expect(missing.length).toBeGreaterThan(0);
  });

  it("says nothing about a column the database has and the source does not", async () => {
    // An operator's own column, or one left over from a rollback. Not our business, and certainly
    // not an incident: the check is about writes that would fail, not about tidiness.
    const rows = [...(await everything()), { table_name: "assets", column_name: "eine_fremde_spalte" }];
    expect(await findMissingDeclaredColumns(fakeClient(rows) as never)).toEqual([]);
  });

  it("asks the database once, not once per table", async () => {
    const client = fakeClient(await everything());
    await findMissingDeclaredColumns(client as never);
    expect(client.queries).toHaveLength(1);
    expect(client.queries[0]).toContain("pg_catalog.pg_attribute");
  });
});
