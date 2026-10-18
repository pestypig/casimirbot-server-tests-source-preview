import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration059 } from "../059_environment_durable_goals";
import { migration060 } from "../060_durable_goal_transient_identity";

describe("migration060 durable goal transient identity", () => {
  it("retains a durable goal after its rotating environment and subject bindings are removed", async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE helix_accounts (profile_id text PRIMARY KEY);
        CREATE TABLE helix_environment_connector_installations (installation_id text PRIMARY KEY);
        CREATE TABLE helix_environment_connector_devices (device_id text PRIMARY KEY);
        CREATE TABLE helix_environment_connector_bindings (environment_binding_id text PRIMARY KEY);
        CREATE TABLE helix_room_source_bindings (binding_id text PRIMARY KEY);
        CREATE TABLE helix_shared_realtime_rooms (room_id text PRIMARY KEY);
        CREATE TABLE helix_shared_realtime_room_members (participant_id text PRIMARY KEY);
        CREATE TABLE helix_room_environment_subject_bindings (subject_binding_id text PRIMARY KEY);
        INSERT INTO helix_accounts VALUES ('profile:owner');
        INSERT INTO helix_environment_connector_installations VALUES ('installation:one');
        INSERT INTO helix_environment_connector_devices VALUES ('device:one');
        INSERT INTO helix_environment_connector_bindings VALUES ('environment:old');
        INSERT INTO helix_room_source_bindings VALUES ('source-binding:one');
        INSERT INTO helix_shared_realtime_rooms VALUES ('room:one');
        INSERT INTO helix_shared_realtime_room_members VALUES ('participant:one');
        INSERT INTO helix_room_environment_subject_bindings VALUES ('subject:old');
      `);
      await migration059.run(client, { enablePgvector: false });
      await migration060.run(client, { enablePgvector: false });
      await client.query(`
        INSERT INTO helix_environment_durable_goals (
          goal_id, owner_profile_id, connector_installation_id, device_id,
          environment_binding_id, room_source_binding_id, room_id,
          participant_id, subject_binding_id, subject_native_id, source_id,
          world_id, objective_hash, objective_payload
        ) VALUES (
          'goal:one', 'profile:owner', 'installation:one', 'device:one',
          'environment:old', 'source-binding:one', 'room:one',
          'participant:one', 'subject:old', 'player:one', 'source:one',
          'world:one',
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '{}'::jsonb
        );
        DELETE FROM helix_room_environment_subject_bindings WHERE subject_binding_id='subject:old';
        DELETE FROM helix_environment_connector_bindings WHERE environment_binding_id='environment:old';
      `);
      const restored = await client.query(
        `SELECT goal_id, environment_binding_id, subject_binding_id
           FROM helix_environment_durable_goals WHERE goal_id='goal:one';`,
      );
      expect(restored.rows).toEqual([{
        goal_id: "goal:one",
        environment_binding_id: "environment:old",
        subject_binding_id: "subject:old",
      }]);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
