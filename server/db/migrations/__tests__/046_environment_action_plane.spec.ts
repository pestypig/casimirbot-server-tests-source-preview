import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration046 } from "../046_environment_action_plane";
import { migration047 } from "../047_environment_action_result_replay_identity";
import { migration048 } from "../048_environment_event_ledger_identity";

describe("migration046 environment action plane", () => {
  it("isolates paired player authority and preserves idempotent workflow evidence", async () => {
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
        CREATE TABLE helix_environment_capability_catalog_snapshots (catalog_snapshot_id text PRIMARY KEY);
        CREATE TABLE helix_connector_pairing_codes (
          pairing_id text PRIMARY KEY,
          command_credential_requested boolean NOT NULL DEFAULT false
        );
        INSERT INTO helix_accounts VALUES ('profile:owner');
        INSERT INTO helix_shared_realtime_rooms VALUES ('room:one');
        INSERT INTO helix_shared_realtime_room_members VALUES ('participant:owner');
        INSERT INTO helix_room_source_bindings VALUES ('room_source_binding:one');
        INSERT INTO helix_environment_connector_bindings VALUES ('environment_binding:one');
        INSERT INTO helix_room_environment_subject_bindings VALUES ('subject_binding:owner');
        INSERT INTO helix_environment_capability_catalog_snapshots VALUES ('catalog:one');
      `);
      await migration046.run(client, { enablePgvector: false });
      await migration047.run(client, { enablePgvector: false });
      await migration048.run(client, { enablePgvector: false });

      const insertAuthority = (id: string) => client.query(`
        INSERT INTO helix_environment_action_authorities (
          action_authority_id, environment_binding_id, room_source_binding_id,
          owner_profile_id, room_id, source_id, world_id, adapter_profile_id,
          domain_adapter,
          participant_id, subject_binding_id, subject_native_id,
          allowed_capability_ids, autonomy_mode, manual_override_policy
        ) VALUES (
          $1, 'environment_binding:one', 'room_source_binding:one',
          'profile:owner', 'room:one', 'source:one', 'minecraft:world',
          'game.minecraft.player.fabric.v1', 'minecraft.fabric_client.v1',
          'participant:owner',
          'subject_binding:owner', 'minecraft-player-uuid',
          '["com.casimirbot.minecraft.player.navigate"]'::jsonb,
          'approved_capabilities', 'cancel'
        );
      `, [id]);
      await insertAuthority("action_authority:one");
      await expect(insertAuthority("action_authority:duplicate")).rejects.toThrow();

      await client.query(`
        INSERT INTO helix_environment_action_connector_credentials (
          action_credential_id, action_authority_id, environment_binding_id,
          connector_installation_id, token_hash, token_prefix, scopes, expires_at
        ) VALUES (
          'action_credential:one', 'action_authority:one',
          'environment_binding:one', 'connector_installation:one',
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'helix_action_test',
          '["action.manifest.write","action.poll","action.result.write"]'::jsonb,
          now() + interval '1 hour'
        );
        INSERT INTO helix_environment_action_connector_manifests (
          manifest_id, action_authority_id, environment_binding_id,
          connector_installation_id, producer_epoch_ref, room_id, source_id,
          world_id, participant_id, subject_binding_id, subject_native_id,
          domain, domain_adapter, adapter_profile_id, adapter_version,
          protocol_version, manifest_hash, capabilities,
          available_control_engines, safety_policy
        ) VALUES (
          'action_manifest:one', 'action_authority:one',
          'environment_binding:one', 'connector_installation:one',
          'producer_epoch:one', 'room:one', 'source:one', 'minecraft:world',
          'participant:owner', 'subject_binding:owner', 'minecraft-player-uuid',
          'minecraft', 'minecraft.fabric_client.v1',
          'game.minecraft.player.fabric.v1', '0.1.0',
          'helix.environment_action.v1',
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          '[{"capability_id":"com.casimirbot.minecraft.player.navigate","capability_version":1}]'::jsonb,
          '[{"control_engine":"native_fabric","available":true}]'::jsonb,
          '{"host_access_supported":false,"emergency_stop_supported":true}'::jsonb
        );
      `);

      await expect(client.query(`
        INSERT INTO helix_environment_action_connector_heartbeats (
          heartbeat_id, manifest_id, action_authority_id,
          connector_installation_id, producer_epoch_ref, status,
          active_workflow_ids, controls_asserted, manual_input_detected,
          emergency_stop_latched, control_engines, payload_hash, created_at
        ) VALUES (
          'heartbeat:unsafe', 'action_manifest:one', 'action_authority:one',
          'connector_installation:one', 'producer_epoch:one', 'active', '[]'::jsonb,
          true, false, true, '[]'::jsonb,
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          now()
        );
      `)).rejects.toThrow();

      const insertRequest = (id: string, workflow: string, idempotency: string, tool: string) =>
        client.query(`
          INSERT INTO helix_environment_action_requests (
            action_request_id, workflow_id, action_authority_id,
            connector_manifest_id, catalog_snapshot_id, environment_binding_id,
            room_id, source_id, world_id, participant_id, subject_binding_id,
            subject_native_id, run_id, turn_id, provider_execution_id,
            tool_call_id, capability_id, capability_version, action_kind,
            effect_class, workflow_mode, requested_control_engine,
            request_payload, request_hash, idempotency_key,
            confirmation_state, approval_ref, policy_version, deadline_at
          ) VALUES (
            $1, $2, 'action_authority:one', 'action_manifest:one', 'catalog:one',
            'environment_binding:one', 'room:one', 'source:one',
            'minecraft:world', 'participant:owner', 'subject_binding:owner',
            'minecraft-player-uuid', 'run:one', 'turn:one', 'provider:one',
            $4, 'com.casimirbot.minecraft.player.navigate', 1, 'navigate_to',
            'continuous_control', 'long_running', 'native_fabric',
            '{"destination":{"x":4,"y":64,"z":0}}'::jsonb,
            'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
            $3, 'approved', 'approval:one', 1, now() + interval '1 minute'
          );
        `, [id, workflow, idempotency, tool]);

      await insertRequest(
        "action_request:one",
        "workflow:one",
        "idempotency:one",
        "tool:one",
      );
      await expect(insertRequest(
        "action_request:duplicate",
        "workflow:two",
        "idempotency:one",
        "tool:two",
      )).rejects.toThrow();

      await client.query(`
        INSERT INTO helix_environment_action_workflow_events (
          event_id, action_request_id, workflow_id, sequence, event_type,
          workflow_state, event_payload, event_hash, producer_epoch_ref, created_at
        ) VALUES (
          'action_event:one', 'action_request:one', 'workflow:one', 0,
          'workflow.started', 'running', '{"controls_released":false}'::jsonb,
          'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          'producer_epoch:one', now()
        );
        INSERT INTO helix_environment_action_results (
          action_result_id, action_request_id, workflow_id, action_execution_id,
          capability_id, capability_version, action_kind, outcome,
          result_payload, submitted_result_hash, result_hash, controls_released,
          host_access_performed, automatic_replay_performed,
          provenance_valid, eligible_for_current_turn_reentry, completed_at
        ) VALUES (
          'action_result:one', 'action_request:one', 'workflow:one',
          'action_execution:one', 'com.casimirbot.minecraft.player.navigate',
          1, 'navigate_to', 'succeeded',
          '{"postconditions":[{"status":"satisfied"}]}'::jsonb,
          'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          true, false, false, true, true, now()
        );
      `);

      const counts = await client.query(`
        SELECT
          (SELECT count(*)::int FROM helix_environment_action_authorities) AS authorities,
          (SELECT count(*)::int FROM helix_environment_action_connector_manifests) AS manifests,
          (SELECT count(*)::int FROM helix_environment_action_requests) AS requests,
          (SELECT count(*)::int FROM helix_environment_action_workflow_events) AS events,
          (SELECT count(*)::int FROM helix_environment_action_results) AS results;
      `);
      const row = counts.rows[0] as Record<string, unknown>;
      const scalar = (value: unknown): number =>
        Number(Array.isArray(value) ? value[0] : value);
      expect(scalar(row.authorities)).toBe(1);
      expect(scalar(row.manifests)).toBe(1);
      expect(scalar(row.requests)).toBe(1);
      expect(scalar(row.events)).toBe(1);
      expect(scalar(row.results)).toBe(1);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
