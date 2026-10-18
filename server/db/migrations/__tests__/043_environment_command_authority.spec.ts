import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration043 } from "../043_environment_command_authority";

describe("migration043 environment command authority", () => {
  it("isolates authority, member grant, connector credential, and idempotent command state", async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    const pool = new adapter.Pool();
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE helix_accounts (profile_id text PRIMARY KEY);
        CREATE TABLE helix_shared_realtime_rooms (room_id text PRIMARY KEY);
        CREATE TABLE helix_shared_realtime_room_members (participant_id text PRIMARY KEY);
        CREATE TABLE helix_room_source_bindings (binding_id text PRIMARY KEY);
        CREATE TABLE helix_environment_connector_bindings (environment_binding_id text PRIMARY KEY);
        CREATE TABLE helix_room_environment_subject_bindings (subject_binding_id text PRIMARY KEY);
        INSERT INTO helix_accounts VALUES ('profile:owner'), ('profile:member');
        INSERT INTO helix_shared_realtime_rooms VALUES ('room:one');
        INSERT INTO helix_shared_realtime_room_members VALUES ('participant:owner'), ('participant:member');
        INSERT INTO helix_room_source_bindings VALUES ('room_source_binding:one');
        INSERT INTO helix_environment_connector_bindings VALUES ('environment_binding:one');
        INSERT INTO helix_room_environment_subject_bindings VALUES ('subject_binding:member');
      `);

      await migration043.run(client, { enablePgvector: false });

      const insertAuthority = (id: string, profile = "server_administrator") =>
        client.query(
          `
            INSERT INTO helix_environment_command_authorities (
              command_authority_id, environment_binding_id,
              room_source_binding_id, owner_profile_id, room_id, source_id,
              world_id, adapter_profile_id, authority_profile, autonomy_mode
            ) VALUES (
              $1, 'environment_binding:one', 'room_source_binding:one',
              'profile:owner', 'room:one', 'source:one', 'minecraft:world',
              'game.minecraft.readonly.v1', $2, 'autonomous'
            );
          `,
          [id, profile],
        );

      await insertAuthority("command_authority:one");
      await expect(
        insertAuthority("command_authority:duplicate-active"),
      ).rejects.toThrow();
      await expect(
        client.query(`
          INSERT INTO helix_environment_command_authorities (
            command_authority_id, environment_binding_id,
            room_source_binding_id, owner_profile_id, room_id, source_id,
            world_id, adapter_profile_id, authority_profile
          ) VALUES (
            'command_authority:invalid', 'environment_binding:one',
            'room_source_binding:one', 'profile:owner', 'room:one',
            'source:one', 'minecraft:world', 'game.minecraft.readonly.v1',
            'host_shell'
          );
        `),
      ).rejects.toThrow();

      const insertGrant = (id: string) =>
        client.query(
          `
            INSERT INTO helix_environment_command_member_grants (
              command_grant_id, command_authority_id, room_id,
              participant_id, profile_id, environment_binding_id,
              subject_binding_id, max_authority_profile
            ) VALUES (
              $1, 'command_authority:one', 'room:one', 'participant:member',
              'profile:member', 'environment_binding:one',
              'subject_binding:member', 'server_administrator'
            );
          `,
          [id],
        );

      await insertGrant("command_grant:one");
      await expect(insertGrant("command_grant:duplicate-active")).rejects.toThrow();

      await client.query(`
        INSERT INTO helix_environment_command_connector_credentials (
          command_credential_id, command_authority_id, environment_binding_id,
          token_hash, token_prefix, scopes, expires_at
        ) VALUES (
          'command_credential:one', 'command_authority:one',
          'environment_binding:one',
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'helix_cmd_test', '["command_requests:read","command_results:write"]'::jsonb,
          now() + interval '1 hour'
        );
        INSERT INTO helix_environment_command_catalog_snapshots (
          command_catalog_id, command_authority_id, environment_binding_id,
          source_id, world_id, adapter_profile_id, domain_adapter, game_version,
          producer_epoch_ref, command_tree_hash, root_command_count
        ) VALUES (
          'command_catalog:one', 'command_authority:one',
          'environment_binding:one', 'source:one', 'minecraft:world',
          'game.minecraft.readonly.v1', 'minecraft.fabric_mod.v1', '1.21.8',
          'producer_epoch:one',
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          84
        );
      `);

      const insertRequest = (id: string, idempotency: string, toolCall: string) =>
        client.query(
          `
            INSERT INTO helix_environment_command_requests (
              command_request_id, command_authority_id, command_grant_id,
              command_catalog_id, environment_binding_id, room_id, source_id,
              world_id, participant_id, subject_binding_id, run_id, turn_id,
              provider_execution_id, tool_call_id, command_text, command_hash,
              authority_profile, autonomy_mode, policy_version,
              command_root_hint, requested_category, expected_effect,
              idempotency_key, confirmation_state, deadline_at
            ) VALUES (
              $1, 'command_authority:one', 'command_grant:one',
              'command_catalog:one', 'environment_binding:one', 'room:one',
              'source:one', 'minecraft:world', 'participant:member',
              'subject_binding:member', 'run:one', 'turn:one', 'provider:one',
              $3, 'time set day',
              'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
              'server_administrator', 'autonomous', 1,
              'time', 'world_time_weather', 'world_mutation', $2,
              'not_required', now() + interval '30 seconds'
            );
          `,
          [id, idempotency, toolCall],
        );

      await insertRequest("command_request:one", "idempotency:one", "tool:one");
      await expect(
        insertRequest("command_request:duplicate", "idempotency:one", "tool:two"),
      ).rejects.toThrow();

      await client.query(`
        INSERT INTO helix_environment_command_results (
          command_result_id, command_request_id, command_execution_id,
          command_hash, command_root, parsed_category, effect_class, outcome,
          result_code, result_payload, result_hash, side_effects_performed,
          environment_mutation_performed, server_administration_performed,
          provenance_valid, eligible_for_current_turn_reentry
        ) VALUES (
          'command_result:one', 'command_request:one', 'command_execution:one',
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          'time', 'world_time_weather', 'world_mutation', 'succeeded', 1,
          '{"summary":"Set the time to day."}'::jsonb,
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          true, true, false, true, true
        );
      `);

      const state = await client.query(`
        SELECT
          (SELECT count(*)::int FROM helix_environment_command_authorities) AS authorities,
          (SELECT count(*)::int FROM helix_environment_command_member_grants) AS grants,
          (SELECT count(*)::int FROM helix_environment_command_connector_credentials) AS credentials,
          (SELECT count(*)::int FROM helix_environment_command_requests) AS requests,
          (SELECT count(*)::int FROM helix_environment_command_results) AS results;
      `);
      const row = state.rows[0] as Record<string, unknown>;
      const scalar = (value: unknown): number =>
        Number(Array.isArray(value) ? value[0] : value);
      expect(scalar(row.authorities)).toBe(1);
      expect(scalar(row.grants)).toBe(1);
      expect(scalar(row.credentials)).toBe(1);
      expect(scalar(row.requests)).toBe(1);
      expect(scalar(row.results)).toBe(1);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
