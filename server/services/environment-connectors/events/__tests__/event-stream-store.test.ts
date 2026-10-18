import {
  HELIX_ENVIRONMENT_EVENT_BATCH_SCHEMA,
  HELIX_ENVIRONMENT_EVENT_SCHEMA,
  helixEnvironmentEventBatchSchema,
  type HelixEnvironmentEvent,
} from "@shared/helix-environment-event-stream";
import { newDb } from "pg-mem";
import { describe, expect, it, vi } from "vitest";
import * as roomDatabase from "../../../helix-ask/realtime-room/room-store/database";
import { migration046 } from "../../../../db/migrations/046_environment_action_plane";
import { migration047 } from "../../../../db/migrations/047_environment_action_result_replay_identity";
import { migration048 } from "../../../../db/migrations/048_environment_event_ledger_identity";
import { environmentConnectorSha256 } from "../../catalog";
import {
  buildEnvironmentSituationDigest,
  environmentEventBatchContent,
  normalizeWorldAuthorityEventAttributes,
  recordEnvironmentActionEventBatch,
  readLatestEnvironmentSituationDigest,
  resolveWorldAuthoritySubjectNativeId,
  subscribeEnvironmentSituationDigestRecorded,
  type EnvironmentSituationDigestRecordedEvent,
  type EnvironmentEventTransactionRunner,
} from "../event-stream-store";
import type { EnvironmentActionConnectorClaim } from "../../actions";
import type { HelixWorldEvent } from "@shared/helix-world-event";

const observedAt = "2026-08-05T18:00:00.000Z";

const event = (input: {
  sequence: number;
  eventType: string;
  workflowRef?: string | null;
  attributes?: Record<string, unknown>;
}): HelixEnvironmentEvent => ({
  schema: HELIX_ENVIRONMENT_EVENT_SCHEMA,
  event_id: `environment_event:test-${input.sequence}`,
  sequence: input.sequence,
  event_type: input.eventType,
  producer_plane: "player_embodiment",
  domain: "minecraft",
  domain_adapter: "minecraft.fabric_client.v1",
  room_id: "shared_realtime_room:event-test",
  source_id: "source:room-ingress:event-test",
  world_id: "minecraft:local:event-test",
  producer_epoch_ref: "environment_action_epoch:event-test",
  subject_ref: "subject_binding:event-test",
  workflow_ref: input.workflowRef ?? null,
  summary: `Event ${input.sequence} was measured.`,
  attributes: input.attributes ?? {},
  evidence_refs: [`environment_action_event:test-${input.sequence}`],
  occurred_at: new Date(Date.parse(observedAt) + input.sequence * 100).toISOString(),
  observed_at: new Date(Date.parse(observedAt) + input.sequence * 100).toISOString(),
  provenance: "measured",
  raw_event_included: false,
  content_role: "environment_event_not_assistant_answer",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});

describe("environment event stream and digest reducer", () => {
  it("normalizes the live Fabric snapshot sections and stable player identity into digest facts", () => {
    const worldEvent: HelixWorldEvent = {
      schema: "helix.world_event.v1",
      world_id: "minecraft:local:event-test",
      room_id: "shared_realtime_room:event-test",
      source_id: "source:room-ingress:event-test",
      ts: observedAt,
      actor_id: "minecraft:player:testplayer",
      actor_label: "TestPlayer",
      event_type: "environment_state_snapshot",
      evidence_refs: ["snapshot:test-1"],
      meta: {
        snapshot: {
          snapshot_id: "snapshot:test-1",
          stable_actor_id: "e6b8e983-b138-3202-9413-336c164cfec8",
          actor_state: {
            health: 20,
            food_level: 20,
            position: { x: 1, y: 64, z: 2 },
          },
          inventory_state: {
            carried_items: [{ item_type: "minecraft:bread", count: 1, slot: 0 }],
            inventory_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
          object_state: {
            hazards: [{ hazard_type: "lava", severity: "warning" }],
          },
          focus: { target_kind: "empty" },
        },
      },
    };

    expect(resolveWorldAuthoritySubjectNativeId(worldEvent)).toBe(
      "e6b8e983-b138-3202-9413-336c164cfec8",
    );
    expect(normalizeWorldAuthorityEventAttributes(worldEvent)).toMatchObject({
      actor: {
        label: "TestPlayer",
        health: 20,
        food_level: 20,
        position: { x: 1, y: 64, z: 2 },
      },
      inventory: {
        carried_items: [{ item_type: "minecraft:bread", count: 1, slot: 0 }],
      },
      hazards: {
        observed: [{ hazard_type: "lava", severity: "warning" }],
      },
      focus: { target_kind: "empty" },
      snapshot_refs: ["snapshot:test-1"],
    });
  });

  it("folds measured player and workflow facts while retaining every raw event reference", () => {
    const events = [
      event({
        sequence: 0,
        eventType: "workflow.started",
        workflowRef: "environment_action_workflow:test",
        attributes: {
          actor: {
            position: { x: 0, y: 64, z: 0 },
            health: 20,
          },
          active_workflow: {
            action_kind: "navigate_to",
            workflow_state: "running",
            progress_fraction: 0,
          },
          snapshot_refs: ["environment_snapshot:test-0"],
        },
      }),
      event({
        sequence: 1,
        eventType: "workflow.progress",
        workflowRef: "environment_action_workflow:test",
        attributes: {
          actor: { position: { x: 4, y: 64, z: 0 } },
          active_workflow: {
            action_kind: "navigate_to",
            workflow_state: "running",
            progress_fraction: 0.5,
          },
        },
      }),
    ];
    const digest = buildEnvironmentSituationDigest({
      environmentBindingId: "environment_binding:event-test",
      events,
    });
    expect(digest).toMatchObject({
      producer_plane: "player_embodiment",
      subject_ref: "subject_binding:event-test",
      latest_event_sequence: 1,
      event_counts: {
        "workflow.started": 1,
        "workflow.progress": 1,
      },
      situation: {
        actor: { health: 20, position: { x: 4, y: 64, z: 0 } },
        active_workflow: {
          workflow_ref: "environment_action_workflow:test",
          progress_fraction: 0.5,
        },
      },
      derived_from_event_refs: [
        "environment_event:test-0",
        "environment_event:test-1",
      ],
      derived_from_snapshot_refs: ["environment_snapshot:test-0"],
      provenance_valid: true,
      answer_authority: false,
      terminal_eligible: false,
    });
    const { digest_hash: _digestHash, ...content } = digest;
    expect(digest.digest_hash).toBe(environmentConnectorSha256(content));
  });

  it("persists exact replay once and rejects a producer sequence gap", async () => {
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
        INSERT INTO helix_accounts VALUES ('profile:event-test');
        INSERT INTO helix_shared_realtime_rooms VALUES ('shared_realtime_room:event-test');
        INSERT INTO helix_shared_realtime_room_members VALUES ('participant:event-test');
        INSERT INTO helix_room_source_bindings VALUES ('room_source_binding:event-test');
        INSERT INTO helix_environment_connector_bindings VALUES ('environment_binding:event-test');
        INSERT INTO helix_room_environment_subject_bindings VALUES ('subject_binding:event-test');
        INSERT INTO helix_environment_capability_catalog_snapshots VALUES ('catalog:event-test');
      `);
      await migration046.run(client, { enablePgvector: false });
      await migration047.run(client, { enablePgvector: false });
      await migration048.run(client, { enablePgvector: false });
      await client.query(`
        INSERT INTO helix_environment_action_authorities (
          action_authority_id, environment_binding_id, room_source_binding_id,
          owner_profile_id, room_id, source_id, world_id, adapter_profile_id,
          domain_adapter, participant_id, subject_binding_id, subject_native_id,
          allowed_capability_ids, autonomy_mode, manual_override_policy
        ) VALUES (
          'environment_action_authority:event-test',
          'environment_binding:event-test', 'room_source_binding:event-test',
          'profile:event-test', 'shared_realtime_room:event-test',
          'source:room-ingress:event-test', 'minecraft:local:event-test',
          'game.minecraft.player.fabric.v1', 'minecraft.fabric_client.v1',
          'participant:event-test', 'subject_binding:event-test',
          'minecraft-player-uuid', '[]'::jsonb, 'approved_capabilities', 'cancel'
        );
        INSERT INTO helix_environment_action_connector_manifests (
          manifest_id, action_authority_id, environment_binding_id,
          connector_installation_id, producer_epoch_ref, room_id, source_id,
          world_id, participant_id, subject_binding_id, subject_native_id,
          domain, domain_adapter, adapter_profile_id, adapter_version,
          protocol_version, manifest_hash, capabilities,
          available_control_engines, safety_policy, expires_at
        ) VALUES (
          'environment_action_manifest:event-test',
          'environment_action_authority:event-test',
          'environment_binding:event-test',
          'environment_action_connector_installation:event-test',
          'environment_action_epoch:event-test',
          'shared_realtime_room:event-test',
          'source:room-ingress:event-test', 'minecraft:local:event-test',
          'participant:event-test', 'subject_binding:event-test',
          'minecraft-player-uuid', 'minecraft', 'minecraft.fabric_client.v1',
          'game.minecraft.player.fabric.v1', '0.1.0',
          'helix.environment_action.v1',
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, now() + interval '1 hour'
        );
      `);

      const claim: EnvironmentActionConnectorClaim = {
        ownerProfileId: "profile-owner",
        authorityId: "environment_action_authority:event-test",
        credentialId: "environment_action_credential:event-test",
        connectorInstallationId:
          "environment_action_connector_installation:event-test",
        environmentBindingId: "environment_binding:event-test",
        roomSourceBindingId: "room_source_binding:event-test",
        roomId: "shared_realtime_room:event-test",
        sourceId: "source:room-ingress:event-test",
        worldId: "minecraft:local:event-test",
        actionAdapterProfileId: "game.minecraft.player.fabric.v1",
        actionDomainAdapter: "minecraft.fabric_client.v1",
        sourceAdapterProfileId: "game.minecraft.fabric.v1",
        participantId: "participant:event-test",
        subjectBindingId: "subject_binding:event-test",
        subjectNativeId: "minecraft-player-uuid",
        policyVersion: 1,
      };
      const first = event({
        sequence: 0,
        eventType: "workflow.started",
        workflowRef: "environment_action_workflow:event-test",
      });
      const content = {
        schema: HELIX_ENVIRONMENT_EVENT_BATCH_SCHEMA,
        batch_id: "environment_event_batch:persisted",
        room_id: first.room_id,
        source_id: first.source_id,
        world_id: first.world_id,
        producer_epoch_ref: first.producer_epoch_ref,
        producer_plane: "player_embodiment" as const,
        first_sequence: 0,
        last_sequence: 0,
        events: [first],
        created_at: observedAt,
        content_role: "environment_event_batch_not_assistant_answer" as const,
        answer_authority: false as const,
        assistant_answer: false as const,
        terminal_eligible: false as const,
        raw_content_included: false as const,
      };
      const batch = {
        ...content,
        batch_hash: environmentConnectorSha256(content),
      };
      const withTransaction: EnvironmentEventTransactionRunner = async (
        handler,
      ) => handler(client);
      const published: EnvironmentSituationDigestRecordedEvent[] = [];
      const unsubscribe = subscribeEnvironmentSituationDigestRecorded((value) =>
        published.push(value),
      );
      const transaction = vi.spyOn(roomDatabase, "withSharedRealtimeRoomTransaction")
        .mockImplementation(async handler => handler(client));
      let recorded: Awaited<ReturnType<typeof recordEnvironmentActionEventBatch>>;
      try {
        recorded = await recordEnvironmentActionEventBatch({ claim, batch });
        expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
          requireLocalSnapshot: true,
          snapshotTables: ["helix_environment_event_batches", "helix_environment_events", "helix_environment_situation_digests"],
        });
      } finally { transaction.mockRestore(); }
      const replayed = await recordEnvironmentActionEventBatch({
        claim,
        batch,
        withTransaction,
      });
      unsubscribe();
      expect(recorded.replayed).toBe(false);
      expect(replayed.replayed).toBe(true);
      expect(replayed.digest.digest_id).toBe(recorded.digest.digest_id);
      expect(published).toEqual([
        {
          environment_binding_id: claim.environmentBindingId,
          digest: recorded.digest,
        },
      ]);
      const readBack = await readLatestEnvironmentSituationDigest({
        context: {
          environmentBindingId: claim.environmentBindingId,
          roomId: claim.roomId,
          sourceId: claim.sourceId,
          worldId: claim.worldId,
          participantId: claim.participantId,
          subjectBindingId: claim.subjectBindingId,
        },
        maxAgeMs: 30_000,
        producerPlane: "player_embodiment",
        readDatabase: async () => client,
        now: () => Date.parse(recorded.digest.observed_at) + 1_000,
      });
      expect(readBack).toMatchObject({
        outcome: "fresh",
        digest: { digest_id: recorded.digest.digest_id },
        provenance_valid: true,
        eligible_for_current_turn_reentry: true,
        terminal_eligible: false,
      });
      await client.query(
        `UPDATE helix_environment_situation_digests
         SET digest_payload = $2::jsonb WHERE digest_id = $1;`,
        [recorded.digest.digest_id, JSON.stringify({ forged: true })],
      );
      const forged = await readLatestEnvironmentSituationDigest({
        context: {
          environmentBindingId: claim.environmentBindingId,
          roomId: claim.roomId,
          sourceId: claim.sourceId,
          worldId: claim.worldId,
          participantId: claim.participantId,
          subjectBindingId: claim.subjectBindingId,
        },
        maxAgeMs: 30_000,
        readDatabase: async () => client,
        now: () => Date.parse(recorded.digest.observed_at) + 1_000,
      });
      expect(forged).toMatchObject({
        outcome: "integrity_failed",
        digest: null,
        provenance_valid: false,
        eligible_for_current_turn_reentry: false,
      });
      const counts = await client.query(`
        SELECT
          (SELECT count(*)::int FROM helix_environment_event_batches) AS batches,
          (SELECT count(*)::int FROM helix_environment_events) AS events,
          (SELECT count(*)::int FROM helix_environment_situation_digests) AS digests;
      `);
      const scalar = (value: unknown): number =>
        Number(Array.isArray(value) ? value[0] : value);
      expect(scalar(counts.rows[0].batches)).toBe(1);
      expect(scalar(counts.rows[0].events)).toBe(1);
      expect(scalar(counts.rows[0].digests)).toBe(1);

      const second = event({ sequence: 2, eventType: "workflow.progress" });
      const gapContent = {
        ...content,
        batch_id: "environment_event_batch:gap",
        first_sequence: 2,
        last_sequence: 2,
        events: [second],
      };
      await expect(
        recordEnvironmentActionEventBatch({
          claim,
          batch: {
            ...gapContent,
            batch_hash: environmentConnectorSha256(gapContent),
          },
          withTransaction,
        }),
      ).rejects.toMatchObject({ code: "action_event_conflict" });
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("clears active workflow state only when its terminal event is observed", () => {
    const digest = buildEnvironmentSituationDigest({
      environmentBindingId: "environment_binding:event-test",
      events: [
        event({
          sequence: 0,
          eventType: "workflow.started",
          workflowRef: "environment_action_workflow:test",
        }),
        event({
          sequence: 1,
          eventType: "workflow.succeeded",
          workflowRef: "environment_action_workflow:test",
        }),
      ],
    });
    expect(digest.situation.active_workflow).toBeNull();
    expect(digest.event_counts["workflow.succeeded"]).toBe(1);
  });

  it("rejects sequence gaps and cross-identity events before persistence", () => {
    const first = event({ sequence: 0, eventType: "workflow.started" });
    const third = event({ sequence: 2, eventType: "workflow.progress" });
    const content = {
      schema: HELIX_ENVIRONMENT_EVENT_BATCH_SCHEMA,
      batch_id: "environment_event_batch:event-test",
      room_id: first.room_id,
      source_id: first.source_id,
      world_id: first.world_id,
      producer_epoch_ref: first.producer_epoch_ref,
      producer_plane: "player_embodiment" as const,
      first_sequence: 0,
      last_sequence: 2,
      events: [first, third],
      created_at: observedAt,
      content_role: "environment_event_batch_not_assistant_answer" as const,
      answer_authority: false as const,
      assistant_answer: false as const,
      terminal_eligible: false as const,
      raw_content_included: false as const,
    };
    const batch = {
      ...content,
      batch_hash: environmentConnectorSha256(content),
    };
    expect(helixEnvironmentEventBatchSchema.safeParse(batch).success).toBe(false);
    expect(
      helixEnvironmentEventBatchSchema.safeParse({
        ...batch,
        last_sequence: 0,
        events: [{ ...first, room_id: "shared_realtime_room:forged" }],
      }).success,
    ).toBe(false);
  });

  it("defines batch integrity over every field except the submitted hash", () => {
    const first = event({ sequence: 0, eventType: "workflow.started" });
    const content = {
      schema: HELIX_ENVIRONMENT_EVENT_BATCH_SCHEMA,
      batch_id: "environment_event_batch:event-hash",
      room_id: first.room_id,
      source_id: first.source_id,
      world_id: first.world_id,
      producer_epoch_ref: first.producer_epoch_ref,
      producer_plane: "player_embodiment" as const,
      first_sequence: 0,
      last_sequence: 0,
      events: [first],
      created_at: observedAt,
      content_role: "environment_event_batch_not_assistant_answer" as const,
      answer_authority: false as const,
      assistant_answer: false as const,
      terminal_eligible: false as const,
      raw_content_included: false as const,
    };
    const batch = helixEnvironmentEventBatchSchema.parse({
      ...content,
      batch_hash: environmentConnectorSha256(content),
    });
    expect(environmentConnectorSha256(environmentEventBatchContent(batch))).toBe(
      batch.batch_hash,
    );
  });
});
