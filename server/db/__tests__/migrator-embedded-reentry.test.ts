import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../migrator";

describe("embedded database migration re-entry", () => {
  it("migrates a fresh pg-mem database and can safely re-enter its migration ledger", async () => {
    const db = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool() as unknown as Pool;
    try {
      await runMigrations(pool);
      const first = await pool.query<{ id: string }>(
        "SELECT id FROM schema_migrations ORDER BY id",
      );
      expect(first.rows.some(({ id }) => id === "048_environment_event_ledger_identity")).toBe(true);

      await runMigrations(pool);
      const second = await pool.query<{ id: string }>(
        "SELECT id FROM schema_migrations ORDER BY id",
      );
      expect(second.rows).toEqual(first.rows);
    } finally {
      await pool.end();
    }
  });
});
