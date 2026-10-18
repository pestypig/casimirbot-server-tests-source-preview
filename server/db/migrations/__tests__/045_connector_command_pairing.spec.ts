import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration045 } from "../045_connector_command_pairing";

describe("migration045 connector command pairing", () => {
  it("adds non-secret pairing markers for direct command delivery", async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE helix_connector_pairing_codes (pairing_id text PRIMARY KEY);
        CREATE TABLE helix_environment_command_connector_credentials (
          command_credential_id text PRIMARY KEY
        );
      `);
      await migration045.run(client, { enablePgvector: false });
      await client.query(`
        INSERT INTO helix_connector_pairing_codes (pairing_id, command_credential_requested)
        VALUES ('pairing:one', true);
        INSERT INTO helix_environment_command_connector_credentials (
          command_credential_id, bootstrap_pairing_id
        ) VALUES ('credential:one', 'pairing:one');
      `);
      await expect(
        client.query(`
          INSERT INTO helix_environment_command_connector_credentials (
            command_credential_id, bootstrap_pairing_id
          ) VALUES ('credential:two', 'pairing:one');
        `),
      ).rejects.toThrow();
      const row = await client.query<{ command_credential_requested: boolean }>(
        `SELECT command_credential_requested FROM helix_connector_pairing_codes
         WHERE pairing_id = 'pairing:one';`,
      );
      expect(row.rows[0]?.command_credential_requested).toBe(true);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
