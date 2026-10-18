import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newDb, type IMemoryDb } from "pg-mem";
import { migration064 } from "../064_room_environment_capability_grants";

describe("migration064 room environment capability grants", () => {
  let memory: IMemoryDb;
  let client: any;

  beforeAll(async () => {
    memory = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memory.adapters.createPg();
    client = new adapter.Client();
    await client.connect();
    await client.query(`
      CREATE TABLE helix_accounts (profile_id text PRIMARY KEY);
      CREATE TABLE helix_shared_realtime_rooms (room_id text PRIMARY KEY);
      CREATE TABLE helix_environment_connector_installations (installation_id text PRIMARY KEY);
      CREATE TABLE helix_environment_connector_devices (device_id text PRIMARY KEY);
      CREATE TABLE helix_environment_connector_bindings (environment_binding_id text PRIMARY KEY);
    `);
    await migration064.run(client, { enablePgvector: false });
  });

  afterAll(async () => {
    await client.end();
  });

  it("creates narrowed room grants and an execution-admission audit", async () => {
    const tables = await client.query(`
      SELECT DISTINCT table_name FROM information_schema.tables
      WHERE table_name IN (
        'helix_room_environment_capability_grants',
        'helix_room_environment_capability_grant_audit'
      ) ORDER BY table_name;
    `);
    expect(tables.rows.map((row: any) => row.table_name)).toEqual([
      "helix_room_environment_capability_grant_audit",
      "helix_room_environment_capability_grants",
    ]);
  });

  it("enforces one active grant per room connection and read-only grant mode", async () => {
    await client.query(`
      INSERT INTO helix_accounts VALUES ('profile:owner');
      INSERT INTO helix_shared_realtime_rooms VALUES ('room:one');
      INSERT INTO helix_environment_connector_installations VALUES ('installation:one');
      INSERT INTO helix_environment_connector_devices VALUES ('device:one');
      INSERT INTO helix_environment_connector_bindings VALUES ('environment:one');
    `);
    const insert = (id: string, mode = "read") => client.query(`
      INSERT INTO helix_room_environment_capability_grants (
        grant_id, room_id, connection_owner_profile_id,
        environment_binding_id, installation_id, device_id, source_id,
        world_or_site_ref, producer_epoch_ref, capability_ids, grant_mode,
        status, policy_revision, created_by_participant_id, expires_at
      ) VALUES ($1, 'room:one', 'profile:owner', 'environment:one',
        'installation:one', 'device:one', 'source:one', 'world:one',
        'producer_epoch:one', '["capability:read"]', $2, 'active', 1,
        'participant:owner', now() + interval '1 hour');
    `, [id, mode]);
    await insert("grant:one");
    await expect(insert("grant:two")).rejects.toThrow();
    await expect(client.query(`
      UPDATE helix_room_environment_capability_grants
      SET grant_mode='write' WHERE grant_id='grant:one';
    `)).rejects.toThrow();
  });
});
