import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration058 } from "../058_environment_interaction_credentials";

describe("migration058 environment interaction credentials", () => {
  it("separates request credentials and enforces idempotent request identity", async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE helix_accounts (profile_id text PRIMARY KEY);
        CREATE TABLE helix_shared_realtime_rooms (room_id text PRIMARY KEY);
        CREATE TABLE helix_shared_realtime_room_members (participant_id text PRIMARY KEY);
        CREATE TABLE helix_environment_connector_bindings (environment_binding_id text PRIMARY KEY);
        CREATE TABLE helix_room_environment_subject_bindings (subject_binding_id text PRIMARY KEY);
        CREATE TABLE helix_environment_action_authorities (action_authority_id text PRIMARY KEY);
        INSERT INTO helix_accounts VALUES ('profile:owner');
        INSERT INTO helix_shared_realtime_rooms VALUES ('room:one');
        INSERT INTO helix_shared_realtime_room_members VALUES ('participant:one');
        INSERT INTO helix_environment_connector_bindings VALUES ('environment:one');
        INSERT INTO helix_room_environment_subject_bindings VALUES ('subject:one');
        INSERT INTO helix_environment_action_authorities VALUES ('authority:one');
      `);
      await migration058.run(client, { enablePgvector: false });
      await client.query(`
        INSERT INTO helix_environment_interaction_credentials (
          interaction_credential_id, action_authority_id, environment_binding_id,
          owner_profile_id, room_id, participant_id, subject_binding_id,
          subject_native_id, source_id, world_id, connector_installation_id,
          bootstrap_pairing_id, token_hash, token_prefix, expires_at
        ) VALUES (
          'credential:one','authority:one','environment:one','profile:owner',
          'room:one','participant:one','subject:one','player:uuid','source:one',
          'world:one','connector:one','pairing:one',
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'helix_env_interact_test',now() + interval '1 hour'
        );
        INSERT INTO helix_environment_interaction_requests (
          request_id, interaction_credential_id, idempotency_key_hash,
          request_hash, turn_id
        ) VALUES (
          'request:one','credential:one',
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          'turn:one'
        );
      `);
      await expect(client.query(`
        INSERT INTO helix_environment_interaction_requests (
          request_id, interaction_credential_id, idempotency_key_hash,
          request_hash, turn_id
        ) VALUES (
          'request:two','credential:one',
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          'turn:two'
        );
      `)).rejects.toThrow();
      const result = await client.query(
        "SELECT count(*)::int AS count FROM helix_environment_interaction_requests;",
      );
      expect(Number(result.rows[0]?.count)).toBe(1);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
