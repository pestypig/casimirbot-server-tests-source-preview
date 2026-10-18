import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration076 } from "../076_environment_connector_installed_nodes";

describe("migration076", () => {
  it("adds exact installed-node bindings while preserving legacy grant identity", async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    await pool.query(`
      CREATE TABLE helix_environment_connector_installations (
        installation_id text PRIMARY KEY,
        owner_profile_id text NOT NULL,
        status text NOT NULL
      );
      CREATE TABLE helix_room_environment_capability_grants (
        grant_id text PRIMARY KEY,
        room_id text NOT NULL,
        installation_id text NOT NULL,
        environment_binding_id text NOT NULL,
        status text NOT NULL
      );
      INSERT INTO helix_environment_connector_installations
        VALUES ('installation:legacy','profile:owner','active');
      INSERT INTO helix_room_environment_capability_grants
        VALUES ('grant:legacy','room:one','installation:legacy','connection:legacy','active');
    `);
    await migration076.run(pool as never, { enablePgvector: false });

    const installation = await pool.query(
      `SELECT installed_device_id FROM helix_environment_connector_installations;`,
    );
    expect(installation.rows).toEqual([{ installed_device_id: null }]);
    const grant = await pool.query(
      `SELECT installed_node_ref FROM helix_room_environment_capability_grants;`,
    );
    expect(grant.rows).toEqual([{ installed_node_ref: "installation:legacy" }]);
    await expect(pool.query(
      `INSERT INTO helix_room_environment_capability_grants
       (grant_id,room_id,installation_id,environment_binding_id,status,installed_node_ref)
       VALUES ('grant:invalid','room:one','installation:legacy','connection:legacy','active',NULL);`,
    )).rejects.toThrow();
    await pool.end();
  });
});
