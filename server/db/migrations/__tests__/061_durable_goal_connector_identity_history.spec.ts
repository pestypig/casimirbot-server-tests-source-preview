import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration059 } from "../059_environment_durable_goals";
import { migration061 } from "../061_durable_goal_connector_identity_history";

describe("migration061 durable goal connector identity history", () => {
  it("retains a recovery goal after every transient connector and participant parent is retired", async () => {
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
        INSERT INTO helix_environment_connector_installations VALUES ('installation:old');
        INSERT INTO helix_environment_connector_devices VALUES ('device:old');
        INSERT INTO helix_environment_connector_bindings VALUES ('environment:old');
        INSERT INTO helix_room_source_bindings VALUES ('source-binding:old');
        INSERT INTO helix_shared_realtime_rooms VALUES ('room:one');
        INSERT INTO helix_shared_realtime_room_members VALUES ('participant:old');
        INSERT INTO helix_room_environment_subject_bindings VALUES ('subject:old');
      `);
      await migration059.run(client, { enablePgvector: false });
      await migration061.run(client, { enablePgvector: false });
      await client.query(`
        INSERT INTO helix_environment_durable_goals (
          goal_id, owner_profile_id, connector_installation_id, device_id,
          environment_binding_id, room_source_binding_id, room_id,
          participant_id, subject_binding_id, subject_native_id, source_id,
          world_id, objective_hash, objective_payload, status
        ) VALUES (
          'goal:one', 'profile:owner', 'installation:old', 'device:old',
          'environment:old', 'source-binding:old', 'room:one',
          'participant:old', 'subject:old', 'player:one', 'source:one',
          'world:one',
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '{}'::jsonb, 'recovery_required'
        );
        DELETE FROM helix_room_environment_subject_bindings;
        DELETE FROM helix_shared_realtime_room_members;
        DELETE FROM helix_room_source_bindings;
        DELETE FROM helix_environment_connector_bindings;
        DELETE FROM helix_environment_connector_devices;
        DELETE FROM helix_environment_connector_installations;
      `);
      const restored = await client.query(
        `SELECT goal_id, connector_installation_id, device_id,
                environment_binding_id, room_source_binding_id,
                participant_id, subject_binding_id, status
           FROM helix_environment_durable_goals WHERE goal_id='goal:one';`,
      );
      expect(restored.rows).toEqual([{
        goal_id: "goal:one",
        connector_installation_id: "installation:old",
        device_id: "device:old",
        environment_binding_id: "environment:old",
        room_source_binding_id: "source-binding:old",
        participant_id: "participant:old",
        subject_binding_id: "subject:old",
        status: "recovery_required",
      }]);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
