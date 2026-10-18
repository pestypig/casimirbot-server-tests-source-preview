import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration059 } from "../059_environment_durable_goals";

describe("migration059 environment durable goals", () => {
  it("stores one hash-linked append-only event sequence per exact goal", async () => {
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
        INSERT INTO helix_environment_connector_bindings VALUES ('environment:one');
        INSERT INTO helix_room_source_bindings VALUES ('source-binding:one');
        INSERT INTO helix_shared_realtime_rooms VALUES ('room:one');
        INSERT INTO helix_shared_realtime_room_members VALUES ('participant:one');
        INSERT INTO helix_room_environment_subject_bindings VALUES ('subject:one');
      `);
      await migration059.run(client, { enablePgvector: false });
      await client.query(`
        INSERT INTO helix_environment_durable_goals (
          goal_id, owner_profile_id, connector_installation_id, device_id,
          environment_binding_id, room_source_binding_id, room_id,
          participant_id, subject_binding_id, subject_native_id, source_id,
          world_id, objective_hash, objective_payload
        ) VALUES (
          'goal:one', 'profile:owner', 'installation:one', 'device:one',
          'environment:one', 'source-binding:one', 'room:one',
          'participant:one', 'subject:one', 'player:one', 'source:one',
          'world:one',
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '{}'::jsonb
        );
        INSERT INTO helix_environment_durable_goal_events (
          event_id, goal_id, sequence, event_kind, previous_event_hash,
          event_hash, owner_profile_id, connector_installation_id, device_id,
          environment_binding_id, room_source_binding_id, room_id,
          goal_owner_participant_id, participant_id, authority_participant_id, subject_binding_id, subject_native_id, source_id,
          world_id, producer_epoch_ref, action_authority_id,
          authority_policy_version, authority_expires_at, turn_id, event_payload, payload,
          occurred_at
        ) VALUES (
          'event:one', 'goal:one', 1, 'goal_created', NULL,
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          'profile:owner', 'installation:one', 'device:one', 'environment:one',
          'source-binding:one', 'room:one', 'participant:one', 'participant:one', 'participant:one', 'subject:one',
          'player:one', 'source:one', 'world:one', 'epoch:one', 'authority:one',
          1, now() + interval '1 hour', 'turn:one', '{}'::jsonb, '{}'::jsonb, now()
        );
      `);
      await expect(client.query(`
        INSERT INTO helix_environment_durable_goal_events (
          event_id, goal_id, sequence, event_kind, previous_event_hash,
          event_hash, owner_profile_id, connector_installation_id, device_id,
          environment_binding_id, room_source_binding_id, room_id,
          goal_owner_participant_id, participant_id, authority_participant_id, subject_binding_id, subject_native_id, source_id,
          world_id, producer_epoch_ref, action_authority_id,
          authority_policy_version, authority_expires_at, turn_id, event_payload, payload,
          occurred_at
        ) VALUES (
          'event:duplicate', 'goal:one', 1, 'goal_created', NULL,
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          'profile:owner', 'installation:one', 'device:one', 'environment:one',
          'source-binding:one', 'room:one', 'participant:one', 'participant:one', 'participant:one', 'subject:one',
          'player:one', 'source:one', 'world:one', 'epoch:one', 'authority:one',
          1, now() + interval '1 hour', 'turn:two', '{}'::jsonb, '{}'::jsonb, now()
        );
      `)).rejects.toThrow();
      await expect(client.query(`
        INSERT INTO helix_environment_durable_goal_events (
          event_id, goal_id, sequence, event_kind, previous_event_hash,
          event_hash, owner_profile_id, connector_installation_id, device_id,
          environment_binding_id, room_source_binding_id, room_id,
          goal_owner_participant_id, participant_id, authority_participant_id, subject_binding_id, subject_native_id, source_id,
          world_id, producer_epoch_ref, action_authority_id,
          authority_policy_version, authority_expires_at, turn_id, event_payload, payload,
          occurred_at
        ) VALUES (
          'event:orphan', 'goal:one', 2, 'strategy_revised', NULL,
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          'profile:owner', 'installation:one', 'device:one', 'environment:one',
          'source-binding:one', 'room:one', 'participant:one', 'participant:one', 'participant:one', 'subject:one',
          'player:one', 'source:one', 'world:one', 'epoch:one', 'authority:one',
          1, now() + interval '1 hour', 'turn:two', '{}'::jsonb, '{}'::jsonb, now()
        );
      `)).rejects.toThrow();
    } finally {
      client.release();
      await pool.end();
    }
  });
});
