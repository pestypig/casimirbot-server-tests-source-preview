import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration040 } from "../040_environment_probe_execution_authority";

describe("migration040 environment probe execution authority", () => {
  it("defaults legacy probes to external runs and admits only known server authority kinds", async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE helix_environment_probe_requests (
          probe_request_id text PRIMARY KEY
        );
        INSERT INTO helix_environment_probe_requests (probe_request_id)
        VALUES ('environment_probe_request:legacy');
      `);

      await migration040.run(client, { enablePgvector: false });

      const legacy = await client.query<{
        execution_authority_kind: string;
      }>(`
        SELECT execution_authority_kind
        FROM helix_environment_probe_requests
        WHERE probe_request_id = 'environment_probe_request:legacy';
      `);
      expect(legacy.rows[0]?.execution_authority_kind).toBe(
        "external_agent_run",
      );

      await client.query(`
        INSERT INTO helix_environment_probe_requests (
          probe_request_id,
          execution_authority_kind
        ) VALUES (
          'environment_probe_request:first-party',
          'first_party_shared_room'
        );
      `);
      await expect(
        client.query(`
          INSERT INTO helix_environment_probe_requests (
            probe_request_id,
            execution_authority_kind
          ) VALUES (
            'environment_probe_request:forged',
            'untrusted_connector'
          );
        `),
      ).rejects.toThrow();
    } finally {
      client.release();
      await pool.end();
    }
  });
});
