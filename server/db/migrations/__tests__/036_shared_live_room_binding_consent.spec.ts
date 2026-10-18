import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migration036 } from "../036_shared_live_room_binding_consent";

describe("migration036 run-room binding consent identity", () => {
  let pool: Pool;

  beforeEach(async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memory.adapters.createPg();
    pool = new adapter.Pool() as unknown as Pool;
    await pool.query(`
      CREATE TABLE helix_agent_run_room_bindings (
        binding_id text PRIMARY KEY,
        run_id text NOT NULL
      );
    `);
    await pool.query(`
      INSERT INTO helix_agent_run_room_bindings (binding_id, run_id)
      VALUES ('binding:legacy', 'run_legacy_12345678');
    `);
    const client = await pool.connect();
    try {
      await migration036.run(client, { enablePgvector: false });
    } finally {
      client.release();
    }
  });

  afterEach(async () => {
    await pool.end();
  });

  it("adds consent identity without inventing it for legacy bindings", async () => {
    const { rows } = await pool.query<{
      consent_version_at_bind: string | null;
      consent_receipt_ref_at_bind: string | null;
    }>(`
      SELECT consent_version_at_bind, consent_receipt_ref_at_bind
      FROM helix_agent_run_room_bindings
      WHERE binding_id = 'binding:legacy';
    `);

    expect(rows[0]).toEqual({
      consent_version_at_bind: null,
      consent_receipt_ref_at_bind: null,
    });
  });
});
