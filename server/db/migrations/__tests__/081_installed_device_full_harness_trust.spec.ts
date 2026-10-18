import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration026 } from "../026_helix_accounts";
import { migration070 } from "../070_installed_security_devices";
import { migration081 } from "../081_installed_device_full_harness_trust";

describe("migration081", () => {
  it("adds revocable full-harness trust fields with safe defaults", async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    const pg = memory.adapters.createPg();
    const pool = new pg.Pool();
    const client = await pool.connect();
    try {
      const context = { enablePgvector: false };
      await migration026.run(client as never, context);
      await migration070.run(client as never, context);
      await migration081.run(client as never, context);
      await client.query(`
        INSERT INTO helix_accounts (
          profile_id, display_name, account_type, provider, created_at, updated_at
        ) VALUES ('profile:test', 'Test', 'developer', 'local', now(), now());
      `);
      await client.query(`
        INSERT INTO helix_installed_devices (
          profile_id, device_id, label, platform, status
        ) VALUES ('profile:test', 'device:test', 'Test device', 'windows', 'active');
      `);
      const { rows } = await client.query(`
        SELECT full_harness_trusted, full_harness_trust_revision,
          full_harness_trusted_by_session_id
        FROM helix_installed_devices;
      `);
      expect(rows).toEqual([{
        full_harness_trusted: false,
        full_harness_trust_revision: 0,
        full_harness_trusted_by_session_id: null,
      }]);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
