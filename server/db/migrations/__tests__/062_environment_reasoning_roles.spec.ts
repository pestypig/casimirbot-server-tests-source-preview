import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newDb, type IMemoryDb } from "pg-mem";
import { migration059 } from "../059_environment_durable_goals";
import { migration060 } from "../060_durable_goal_transient_identity";
import { migration061 } from "../061_durable_goal_connector_identity_history";
import { migration062 } from "../062_environment_reasoning_roles";

describe("migration062 environment reasoning roles", () => {
  let memory: IMemoryDb;
  let client: any;

  beforeAll(async () => {
    memory = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memory.adapters.createPg();
    client = new adapter.Client();
    await client.connect();
    await client.query(`
      CREATE TABLE helix_accounts (profile_id text PRIMARY KEY);
      CREATE TABLE helix_environment_connector_installations (installation_id text PRIMARY KEY);
      CREATE TABLE helix_environment_connector_devices (device_id text PRIMARY KEY);
      CREATE TABLE helix_environment_connector_bindings (environment_binding_id text PRIMARY KEY);
      CREATE TABLE helix_shared_realtime_rooms (room_id text PRIMARY KEY);
      CREATE TABLE helix_shared_realtime_room_members (participant_id text PRIMARY KEY);
      CREATE TABLE helix_room_source_bindings (binding_id text PRIMARY KEY);
      CREATE TABLE helix_room_environment_subject_bindings (subject_binding_id text PRIMARY KEY);
    `);
    await migration059.run(client, { enablePgvector: false });
    await migration060.run(client, { enablePgvector: false });
    await migration061.run(client, { enablePgvector: false });
    await migration062.run(client, { enablePgvector: false });
  });

  afterAll(async () => {
    await client.end();
  });

  it("creates the append-only ledger and role event tables", async () => {
    const tables = await client.query(`
      SELECT DISTINCT table_name FROM information_schema.tables
      WHERE table_name IN (
        'helix_environment_reasoning_role_ledgers',
        'helix_environment_reasoning_role_events'
      ) ORDER BY table_name;
    `);
    expect(tables.rows.map((row: any) => row.table_name)).toEqual([
      "helix_environment_reasoning_role_events",
      "helix_environment_reasoning_role_ledgers",
    ]);
  });

  it("rejects event kinds outside the sealed G6 vocabulary", async () => {
    await client.query(`INSERT INTO helix_accounts(profile_id) VALUES ('profile:owner');`);
    await client.query(`INSERT INTO helix_shared_realtime_rooms(room_id) VALUES ('room:one');`);
    await client.query(`
      INSERT INTO helix_environment_durable_goals(
        goal_id, owner_profile_id, connector_installation_id, device_id,
        environment_binding_id, room_source_binding_id, room_id, participant_id,
        subject_binding_id, subject_native_id, source_id, world_id, objective_hash,
        objective_payload
      ) VALUES (
        'environment_durable_goal:one', 'profile:owner', 'installation:history',
        'device:history', 'environment:history', 'room_source_binding:history',
        'room:one', 'participant:history', 'subject_binding:history', 'player:one',
        'source:history', 'minecraft:overworld',
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{}'
      );
    `);
    await client.query(`
      INSERT INTO helix_environment_reasoning_role_ledgers(goal_id, owner_profile_id, room_id)
      VALUES ('environment_durable_goal:one', 'profile:owner', 'room:one');
    `);
    await expect(client.query(`
      INSERT INTO helix_environment_reasoning_role_events(
        event_id, goal_id, sequence, event_kind, previous_event_hash, event_hash,
        event_payload, occurred_at
      ) VALUES (
        'event:bad', 'environment_durable_goal:one', 1, 'assistant_answer_written',
        NULL, 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '{}', now()
      );
    `)).rejects.toThrow();
  });
});
