import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HELIX_ENVIRONMENT_ADAPTER_ADMISSION_SCHEMA,
  type HelixEnvironmentAdapterAdmissionProjection,
} from "@shared/helix-environment-adapter-profile";
import {
  HELIX_ENVIRONMENT_PROBE_RESULT_V1_SCHEMA,
  HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
  HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
  HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY,
  HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
  type HelixEnvironmentCapabilityDescriptor,
  type HelixEnvironmentConnectorProbeResult,
  type HelixEnvironmentProbeOutcome,
} from "@shared/helix-environment-connector";
import {
  HELIX_ENVIRONMENT_PROBE_RESULT_SCHEMA,
  type HelixEnvironmentProbeResult,
} from "@shared/helix-environment-probe";
import {
  HELIX_ROOM_SOURCE_BINDING_SCHEMA,
  HELIX_ROOM_SOURCE_INGRESS_SCOPES,
  type HelixRoomSourceBinding,
} from "@shared/helix-room-source-ingress";
import { ensureDatabase, getPool, resetDbClient } from "../../../../db/client";
import { installedDeviceRef } from "../../../helix-account/installed-security-store";
import { prepareBrowserEnvironmentSession } from "../../session/prepare-browser-session";
import { recoverEnvironmentSessionGoal } from "../../session/recover-session-goal";
import { EnvironmentDurableGoalStore } from "../../goals/durable-goal-store";
import { readExactEnvironmentPerceptionEvidence } from "../../temporal-plans/temporal-perception-context";
import { withSharedRealtimeRoomTransaction } from "../../../helix-ask/realtime-room/room-store/database";
import { materializeLegacyRoomSourceConnector } from "../../bindings";
import {
  listEnvironmentConnectorCapabilityDescriptors,
  readEnvironmentConnectorCapabilityDescriptor,
} from "../../catalog";
import { projectEnvironmentAdapterProducerEpoch } from "../../../situation-room/environment-adapter-admission-store";
import { resolveEnvironmentAdapterProfile } from "../../../situation-room/environment-adapter-registry";
import type { RoomSourceIngressRequestClaim } from "../../../helix-ask/realtime-room/source-link-store";
import {
  cancelDurableEnvironmentProbe,
  dispatchDurableEnvironmentProbe,
  expireDurableEnvironmentProbe,
  leaseDurableEnvironmentProbesForClaim,
  readDurableEnvironmentProbeContinuationEvidence,
  readDurableEnvironmentProbeObservation,
  submitDurableEnvironmentProbeResult,
  supersedeDurableEnvironmentProbe,
} from "../durable-broker";

const NOW = new Date("2026-07-27T13:00:00.000Z");
const PROFILE_ID = "profile:durable-environment-probe";
const ROOM_ID = "shared_realtime_room:durable-environment-probe";
const BINDING_ID = "room_source_binding:durable-environment-probe";
const CREDENTIAL_ID = "room_source_credential:durable-environment-probe";
const SOURCE_ID = "source:room-ingress:durable-environment-probe";
const WORLD_ID = "minecraft:minehut:durable-environment-probe";
const RUN_ID = "agent_run:durable-environment-probe";
const PRODUCER_EPOCH = "producer-epoch-durable-environment-probe";
const PARTICIPANT_ID = "room_participant:durable-environment-probe";
const CONSENT_VERSION = 1;
const CONSENT_RECEIPT_REF = "room_consent:durable-environment-probe:1";
const adapterRecord = resolveEnvironmentAdapterProfile({
  domainAdapter: "minecraft.minehut.v1",
  worldId: WORLD_ID,
});
const producerEpochRef = projectEnvironmentAdapterProducerEpoch({
  bindingId: BINDING_ID,
  producerEpoch: PRODUCER_EPOCH,
});
const admission: HelixEnvironmentAdapterAdmissionProjection = {
  schema: HELIX_ENVIRONMENT_ADAPTER_ADMISSION_SCHEMA,
  admission_id: "environment_adapter_admission:durable-environment-probe",
  adapter_profile_id: adapterRecord.profile.profile_id,
  adapter_profile_version: adapterRecord.profile.profile_version,
  adapter_contract_hash: adapterRecord.contract_hash,
  manifest_id: "manifest:durable-environment-probe",
  manifest_hash: `sha256:${"a".repeat(64)}`,
  producer_epoch_ref: producerEpochRef,
  source_family: adapterRecord.profile.source_family,
  mechanics_collection_ids: adapterRecord.profile.mechanics_collections.map(
    (entry) => entry.collection_id,
  ),
  admitted_at: NOW.toISOString(),
  content_role: "adapter_admission_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const binding: HelixRoomSourceBinding = {
  schema: HELIX_ROOM_SOURCE_BINDING_SCHEMA,
  binding_id: BINDING_ID,
  room_id: ROOM_ID,
  owner_profile_id: PROFILE_ID,
  source_id: SOURCE_ID,
  world_id: WORLD_ID,
  domain_adapter: "minecraft.minehut.v1",
  source_label: "Durable Minecraft connector",
  scopes: [...HELIX_ROOM_SOURCE_INGRESS_SCOPES],
  status: "active",
  public_ingress_base_url: "https://connector.invalid",
  credential_id: CREDENTIAL_ID,
  token_prefix: null,
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  expires_at: null,
  revoked_at: null,
  last_used_at: NOW.toISOString(),
  request_count: 1,
  execution_policy: {
    may_execute_live_actions: false,
    may_perform_read_only_probes: true,
  },
  content_role: "source_binding_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const claim: RoomSourceIngressRequestClaim = {
  binding,
  credentialId: CREDENTIAL_ID,
  requestProjectionId: "room_source_request_projection:durable-probe",
  producerEpoch: PRODUCER_EPOCH,
  sequence: 2,
  routeKey: "probes/pending",
  bodyDigest: `sha256:${"b".repeat(64)}`,
  replay: null,
};

const resultFor = (
  requestId: string,
  summary = "The bound actor has four inventory stacks.",
  createdAt = new Date(NOW.getTime() + 500).toISOString(),
): HelixEnvironmentProbeResult => ({
  schema: HELIX_ENVIRONMENT_PROBE_RESULT_SCHEMA,
  probe_result_id: `environment_probe_result:wire:${crypto.randomUUID()}`,
  probe_request_id: requestId,
  source_id: SOURCE_ID,
  room_id: ROOM_ID,
  domain: "minecraft",
  probe_type: "inventory_check",
  status: "succeeded",
  result_summary: summary,
  result: {
    details: {
      stack_count: 4,
      slots: [
        { slot: 0, item: "minecraft:diamond", count: 3 },
        { slot: 1, item: "minecraft:bread", count: 5 },
      ],
    },
  },
  sensor_scope: "privileged_server_state",
  requires_caveat: true,
  side_effects_performed: false,
  commands_executed: [],
  world_mutation_performed: false,
  evidence_refs: [BINDING_ID, admission.admission_id],
  deterministic: true,
  model_invoked: false,
  assistant_answer: false,
  raw_content_included: false,
  context_policy: "compact_context_pack_only",
  created_at: createdAt,
});

const connectorResultFor = (
  requestId: string,
  outcome: HelixEnvironmentProbeOutcome,
): HelixEnvironmentConnectorProbeResult => {
  const summary = `The connector reported ${outcome}.`;
  return {
    schema: HELIX_ENVIRONMENT_PROBE_RESULT_V1_SCHEMA,
    probe_request_id: requestId,
    capability_id: HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
    capability_version: 1,
    outcome,
    summary,
    result: {
      result_summary: summary,
    },
    side_effects_performed: false,
    commands_executed: [],
    environment_mutation_performed: false,
    deterministic: true,
    model_invoked: false,
    assistant_answer: false,
    raw_content_included: false,
    created_at: new Date(NOW.getTime() + 500).toISOString(),
  };
};

const seed = async (): Promise<
  Awaited<ReturnType<typeof materializeLegacyRoomSourceConnector>>
> => {
  await ensureDatabase();
  const db = getPool();
  await db.query(
    `
      INSERT INTO helix_accounts (
        profile_id, display_name, account_type, provider
      ) VALUES ($1, 'Durable probe operator', 'developer', 'local');
    `,
    [PROFILE_ID],
  );
  await db.query(
    `
      INSERT INTO helix_shared_realtime_rooms (
        room_id, owner_profile_id, title, status
      ) VALUES ($1, $2, 'Durable environment probe', 'active');
    `,
    [ROOM_ID, PROFILE_ID],
  );
  await db.query(
    `
      INSERT INTO helix_shared_realtime_room_members (
        room_id,
        slot_number,
        profile_id,
        participant_id,
        member_role,
        presence,
        consent,
        joined_at,
        last_seen_at,
        updated_at
      ) VALUES (
        $1, 1, $2, $3, 'owner', 'present', $4::jsonb, $5, $5, $5
      );
    `,
    [
      ROOM_ID,
      PROFILE_ID,
      PARTICIPANT_ID,
      JSON.stringify({
        consent_version: CONSENT_VERSION,
        consent_receipt_ref: CONSENT_RECEIPT_REF,
      }),
      NOW.toISOString(),
    ],
  );
  await db.query(
    `
      INSERT INTO helix_room_source_bindings (
        binding_id, room_id, owner_profile_id, source_id, world_id,
        domain_adapter, source_label, scopes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb);
    `,
    [
      BINDING_ID,
      ROOM_ID,
      PROFILE_ID,
      SOURCE_ID,
      WORLD_ID,
      binding.domain_adapter,
      binding.source_label,
      JSON.stringify(binding.scopes),
    ],
  );
  await db.query(
    `
      INSERT INTO helix_room_source_credentials (
        credential_id, binding_id, token_hash, token_prefix, expires_at
      ) VALUES ($1, $2, $3, 'test-prefix', $4);
    `,
    [
      CREDENTIAL_ID,
      BINDING_ID,
      crypto.createHash("sha256").update("credential").digest("hex"),
      new Date(NOW.getTime() + 60_000).toISOString(),
    ],
  );
  await db.query(
    `
      INSERT INTO helix_environment_adapter_admissions (
        admission_id, binding_id, credential_id, producer_epoch, room_id,
        source_id, world_id, domain_adapter, adapter_profile_id,
        adapter_profile_version, adapter_contract_hash, manifest_id,
        manifest_hash, source_family, mechanics_collection_ids, admitted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15::jsonb, $16
      );
    `,
    [
      admission.admission_id,
      BINDING_ID,
      CREDENTIAL_ID,
      PRODUCER_EPOCH,
      ROOM_ID,
      SOURCE_ID,
      WORLD_ID,
      binding.domain_adapter,
      admission.adapter_profile_id,
      admission.adapter_profile_version,
      admission.adapter_contract_hash,
      admission.manifest_id,
      admission.manifest_hash,
      admission.source_family,
      JSON.stringify(admission.mechanics_collection_ids),
      admission.admitted_at,
    ],
  );
  await db.query(
    `
      INSERT INTO helix_agent_runs (
        run_id, schema_version, tenant_id, issuer, subject_id,
        account_profile_id, objective, objective_hash, runtime_provider,
        provider_goal_id, provider_thread_id, provider_session_id,
        lifecycle_status, completion_status, terminal_authority_status,
        configuration, evidence_bundle, max_steps, active_operation_id,
        operation_started_at, expires_at, created_at, updated_at
      ) VALUES (
        $1, 'helix.agent_run.v1', 'tenant:durable-probe',
        'https://issuer.example.test', 'subject:durable-probe', $2,
        'Inspect the bound actor inventory.', $3, 'codex',
        'provider_goal:durable-probe', 'provider_thread:durable-probe',
        'provider_session:durable-probe', 'running', 'in_progress',
        'pending', '{}'::jsonb, '{}'::jsonb, 8,
        'agent_operation:durable-probe', $5, $4, $5, $5
      );
    `,
    [
      RUN_ID,
      PROFILE_ID,
      `sha256:${"c".repeat(64)}`,
      new Date(NOW.getTime() + 60_000).toISOString(),
      NOW.toISOString(),
    ],
  );
  await db.query(
    `
      INSERT INTO helix_agent_run_room_bindings (
        binding_id,
        run_id,
        tenant_id,
        issuer,
        subject_id,
        account_profile_id,
        room_id,
        authorized_by_profile_id,
        participant_id_at_bind,
        member_role_at_bind,
        consent_version_at_bind,
        consent_receipt_ref_at_bind,
        status,
        created_at,
        updated_at
      ) VALUES (
        'agent_run_room_binding:durable-environment-probe',
        $1,
        'tenant:durable-probe',
        'https://issuer.example.test',
        'subject:durable-probe',
        $2,
        $3,
        $2,
        $4,
        'owner',
        $5,
        $6,
        'active',
        $7,
        $7
      );
    `,
    [
      RUN_ID,
      PROFILE_ID,
      ROOM_ID,
      PARTICIPANT_ID,
      CONSENT_VERSION,
      CONSENT_RECEIPT_REF,
      NOW.toISOString(),
    ],
  );
  return materializeLegacyRoomSourceConnector({
    ownerProfileId: PROFILE_ID,
    roomSourceBindingId: BINDING_ID,
    credentialId: CREDENTIAL_ID,
    roomId: ROOM_ID,
    sourceId: SOURCE_ID,
    worldId: WORLD_ID,
    producerEpochRef,
    adapterAdmission: admission,
    capabilityDescriptors: listEnvironmentConnectorCapabilityDescriptors({
      adapterProfileId: admission.adapter_profile_id,
    }),
  });
};

const dispatch = async (
  connector: Awaited<ReturnType<typeof materializeLegacyRoomSourceConnector>>,
  suffix: string,
  overrides: Partial<Parameters<typeof dispatchDurableEnvironmentProbe>[0]> = {},
) =>
  dispatchDurableEnvironmentProbe({
    tenantId: "tenant:durable-probe",
    ownerSubjectId: "subject:durable-probe",
    ownerProfileId: PROFILE_ID,
    executionAuthorityKind: "external_agent_run",
    runId: RUN_ID,
    turnId: `ask:durable-probe:${suffix}`,
    providerExecutionId: `provider_execution:durable-probe:${suffix}`,
    toolCallId: `tool_call:durable-probe:${suffix}`,
    roomId: ROOM_ID,
    sourceId: SOURCE_ID,
    producerEpochRef,
    adapterAdmission: admission,
    connector,
    descriptor: readEnvironmentConnectorCapabilityDescriptor(
      HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
    )!,
    arguments: {
      target: "current_actor",
      freshness_requirement_ms: 5_000,
    },
    freshnessRequirementMs: 5_000,
    timeoutMs: 10_000,
    idempotencyKey: `idempotency:durable-probe:${suffix}`,
    now: NOW,
    ...overrides,
  });

describe("durable environment probe broker", () => {
  it("preserves independently authenticated bootstrap probes in private directory mode", async () => {
    const connector = await seed();
    vi.stubEnv("HELIX_PRIVATE_ENVIRONMENT_HOME", "1");
    const dispatched = await dispatch(connector, "private-mode-bootstrap");
    const [lease] = await leaseDurableEnvironmentProbesForClaim({
      claim, adapterAdmission: admission, limit: 1, now: NOW,
    });
    const accepted = await submitDurableEnvironmentProbeResult({
      claim, adapterAdmission: admission, now: NOW,
      submission: { schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
        probe_attempt_id: lease.probe_attempt_id, lease_token: lease.lease_token,
        submitted_at: NOW.toISOString(), result: resultFor(dispatched.requestId) },
    });
    expect(accepted.observation).toMatchObject({ outcome: "succeeded", eligible_for_current_turn_reentry: true });
  });
  it.each(["healthy", "idle epoch"])("keeps repeated Ready up checks fresh without replacing the goal or weakening probe replay (%s)", async scenario => {
    // Real preparation + broker storage/lease/normalization/evidence reads.
    // Authentication projections and the physical sensor are isolated fixtures.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      const connector = await seed();
      const subjectBindingId = "environment_subject_binding:ready-up-retry";
      const nativeId = "00000000-0000-4000-8000-000000000001";
      const capability = HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY;
      await getPool().query(`INSERT INTO helix_room_environment_subject_bindings (
        subject_binding_id, room_id, participant_id, profile_id, environment_binding_id,
        room_source_binding_id, source_id, world_id, subject_kind, subject_ref,
        subject_native_id, subject_label, verification_method, confidence,
        producer_epoch_ref, verified_at, last_confirmed_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'minecraft.player','environment_subject:ready-up-retry',
        $9,'ReadinessFixturePlayer','self_claim',0.8,$10,$11,$11,$11,$11)`,
      [subjectBindingId, ROOM_ID, PARTICIPANT_ID, PROFILE_ID, connector.environmentBindingId,
        BINDING_ID, SOURCE_ID, WORLD_ID, nativeId, producerEpochRef, NOW.toISOString()]);
      const input = { sessionId: "session:ready", profileRef: PROFILE_ID, bindingId: "binding:ready",
        bindingEpoch: 1, helixConversationId: "chat:ready", missionId: null, runId: RUN_ID, requestId: "same-request" };
      const target = { ...input, authenticatedMcpClientRef: "client:ready", clientSessionRef: "client-session:ready",
        clientContinuationRef: "task:ready" };
      const store = { resolveOwnedPreparationTarget: vi.fn(() => target), verifyTaskAssociation: vi.fn() };
      const presence = [{ authenticated_profile_ref: PROFILE_ID, client_session_ref: target.clientSessionRef,
        authenticated_mcp_client_ref: target.authenticatedMcpClientRef, conversation_thread_ref: target.clientContinuationRef }];
      const identity = { environment_binding_id: connector.environmentBindingId, source_id: SOURCE_ID, world_id: WORLD_ID,
        owner_profile_id: PROFILE_ID, room_id: ROOM_ID, goal_owner_participant_id: PARTICIPANT_ID,
        participant_id: PARTICIPANT_ID, run_id: RUN_ID,
        subject_binding_id: subjectBindingId, subject_native_id: nativeId, action_authority_id: "authority:unchanged" };
      const exact = { environmentBindingId: connector.environmentBindingId, sourceId: SOURCE_ID, worldId: WORLD_ID,
        subjectBindingId, subjectNativeId: nativeId, observationProducerEpochRef: producerEpochRef };
      let goal: any = { goal_id: "goal:unchanged", revision: 5, identity };
      const connectorRow = (await getPool().query(`SELECT installation_id, device_id
        FROM helix_environment_connector_bindings WHERE environment_binding_id=$1`, [connector.environmentBindingId])).rows[0];
      let actionEpoch = "action-epoch:old";
      const currentIdentity = (turnId: string) => ({ ...identity,
        owner_profile_id: PROFILE_ID, host_ref: `environment_device:${connectorRow.device_id}`,
        connector_installation_id: connectorRow.installation_id, device_id: connectorRow.device_id,
        room_source_binding_id: BINDING_ID, room_id: ROOM_ID, goal_owner_participant_id: PARTICIPANT_ID,
        participant_id: PARTICIPANT_ID, authority_participant_id: PARTICIPANT_ID,
        producer_epoch_ref: actionEpoch, authority_policy_version: 1,
        authority_expires_at: new Date(NOW.getTime() + 60_000).toISOString(), run_id: RUN_ID, turn_id: turnId });
      // Real ledger and evidence resolver; only current authority is a fixture.
      const goals = new EnvironmentDurableGoalStore(withSharedRealtimeRoomTransaction,
        async (_db, request) => currentIdentity(request.turnId));
      if (scenario === "idle epoch") {
        goal = await goals.create({ ownerProfileId: PROFILE_ID, participantId: PARTICIPANT_ID,
          roomId: ROOM_ID, environmentBindingId: connector.environmentBindingId, subjectNativeId: nativeId,
          actionAuthorityId: identity.action_authority_id, runId: RUN_ID, turnId: "turn:create",
          objective: { domain: "minecraft", game_version: "1.21.8", goal_kind: "custom_survival",
            mechanics_collection_ref: null, objective_text: "Observe the bounded fixture without moving.",
            milestones: [{ milestone_id: "observe", description: "Inspect", dependency_milestone_ids: [],
              required_postcondition_ids: ["observed"] }] } });
        actionEpoch = "action-epoch:new";
      }
      const originalGoalId = goal.goal_id;
      const reads: Array<{ requestId: string; turnId: string; replayed: boolean }> = [];
      const readExact = (requestId: string, priorTurnId: string, expectedEnvironmentIdentity = exact) =>
        readDurableEnvironmentProbeContinuationEvidence({ requestId, expectedPriorTurnId: priorTurnId,
          expectedRoomId: ROOM_ID, expectedCapabilityId: capability, expectedEnvironmentIdentity,
          maxAgeMs: 5_000, now: new Date() });
      const deps = {
        account: vi.fn().mockResolvedValue({ trusted_account_session: true, profile_id: PROFILE_ID, session_id: input.sessionId }),
        association: vi.fn().mockResolvedValue({ room_id: ROOM_ID, run_id: RUN_ID,
          run_expires_at: new Date(NOW.getTime() + 60_000).toISOString() }),
        membership: vi.fn().mockResolvedValue({ participantId: PARTICIPANT_ID, roomStatus: "active" }),
        goal: vi.fn(async () => goal), createGoal: vi.fn(), refreshSubject: vi.fn(), inspect: vi.fn(),
        environments: vi.fn().mockResolvedValue([{ ...identity, room_id: ROOM_ID,
          self_subject_binding: { subject_binding_id: subjectBindingId, participant_id: PARTICIPANT_ID, status: "active" } }]),
        observe: vi.fn(async (request) => {
          await request.assertCurrentTarget();
          expect(request.expectedEnvironmentIdentity).toEqual({ roomId: ROOM_ID,
            environmentBindingId: connector.environmentBindingId, sourceId: SOURCE_ID, worldId: WORLD_ID,
            subjectBindingId, subjectNativeId: nativeId });
          const dispatchInput = { descriptor: readEnvironmentConnectorCapabilityDescriptor(capability)!,
            arguments: request.arguments, turnId: request.turnId, toolCallId: request.toolCallId,
            providerExecutionId: request.providerExecutionId, requestingParticipantId: PARTICIPANT_ID,
            resolvedSubject: { subjectBindingId, subjectNativeId: nativeId },
            idempotencyKey: `environment_probe:${RUN_ID}:${request.turnId}:${request.toolCallId}:${capability}`,
            now: new Date() };
          const dispatched = await dispatch(connector, "ready-up", dispatchInput);
          // Retransmission of one read must still be idempotent.
          expect(await dispatch(connector, "ready-up", dispatchInput)).toMatchObject({ requestId: dispatched.requestId, replayed: true });
          reads.push({ requestId: dispatched.requestId, turnId: request.turnId, replayed: dispatched.replayed });
          if (!dispatched.replayed) {
            const [lease] = await leaseDurableEnvironmentProbesForClaim({ claim, adapterAdmission: admission, limit: 1, now: new Date() });
            const position = { x: 0, y: 0, z: 0 };
            const result: HelixEnvironmentProbeResult = {
              schema: HELIX_ENVIRONMENT_PROBE_RESULT_SCHEMA, probe_result_id: `result:${dispatched.requestId}`,
              probe_request_id: dispatched.requestId, source_id: SOURCE_ID, room_id: ROOM_ID,
              domain: "minecraft", probe_type: "perception_snapshot", status: "succeeded",
              result_summary: "Synthetic bounded readiness perception", result: { details: {
                snapshot_schema: "helix.minecraft_perception_snapshot.v1", observation_revision: reads.length,
                game_tick: reads.length, capture_duration_ms: 1, dimension: "minecraft:overworld",
                actor: { position, velocity: position, yaw: 0, pitch: 0, health: 20, max_health: 20,
                  food_level: 20, air: 300, on_ground: true, on_fire: false, freezing: false },
                focus: { kind: "miss", distance_blocks: 0, line_of_sight: true, occlusion: "none" }, entities: [], hazards: [],
                movement_candidates: ["north", "south", "east", "west"].map(cardinal_direction => ({
                  cardinal_direction, relative_direction: "forward", target_feet_position: position, support_position: position,
                  support_block: "minecraft:stone", evidence_complete: false, feet_clear: false, head_clear: false,
                  drop_depth_blocks: 0, drop_scan_complete: false, nearby_hazard_count: 0, nearby_fluid_count: 0, safe_candidate: false,
                })), inventory: { item_count: 0, slots: [] },
                coverage: { horizontal_radius: 2, vertical_radius: 2, loaded_region_complete: true,
                  unknown_cell_count: 0, entities_complete: true, hazards_complete: true, omitted_categories: [] },
                ui_state: { server_container_open: false, same_revision: true, client_screen_state: "unobserved",
                  input_capture_known: false, input_activity: false, freshness: "unobserved" },
                world_rules: { keep_inventory: false }, semantic_fingerprint: `sha256:${"f".repeat(64)}`,
              } }, sensor_scope: "sensor_observable", requires_caveat: false, side_effects_performed: false,
              commands_executed: [], world_mutation_performed: false, evidence_refs: [], deterministic: true,
              model_invoked: false, assistant_answer: false, raw_content_included: false,
              context_policy: "compact_context_pack_only", created_at: new Date().toISOString(),
            };
            await submitDurableEnvironmentProbeResult({ claim, adapterAdmission: admission,
              submission: { schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA, probe_request_id: dispatched.requestId,
                probe_attempt_id: lease.probe_attempt_id, lease_token: lease.lease_token, result }, now: new Date() });
          }
          return { ok: true, observation: await readDurableEnvironmentProbeObservation(dispatched.requestId) };
        }),
        prepare: vi.fn(async (preparation) => {
          const { context } = preparation;
          if (scenario === "idle epoch") {
            const recovered = await recoverEnvironmentSessionGoal(preparation, store as never, {
              goals, database: async () => getPool(), identity: async () => currentIdentity(context.turnId),
              perception: readExactEnvironmentPerceptionEvidence,
            });
            goal = recovered.goal;
            expect(goal).toMatchObject({ goal_id: originalGoalId, revision: 5, status: "active", attempt_count: 0 });
            expect(goal.latest_checkpoint.observation_revision).toBe(NOW.getTime());
            expect(goal.milestones[0].completed_postcondition_ids).toEqual([]);
          }
          const evidence = await readExact(context.probeRequestId, context.priorTurnId);
          return { readiness: { ready: evidence !== null, valid_until_ms: evidence ? Date.now() + 5000 : null }, repairs: [], execution_authority: false };
        }),
      };
      for (let invocation = 0; invocation < 3; invocation++) {
        vi.setSystemTime(new Date(NOW.getTime() + invocation * 10_000));
        const result = await prepareBrowserEnvironmentSession(input, store as never, presence as never, deps as never);
        expect(result.readiness.ready, `Ready up invocation ${invocation + 1}`).toBe(true);
        expect(result.repairs).toEqual([]);
        expect(deps.prepare.mock.calls.at(-1)![0].context).toMatchObject({ goalId: goal.goal_id,
          expectedRevision: scenario === "idle epoch" && invocation === 0 ? 1 : 5 });
        await expect(readExact(reads.at(-1)!.requestId, reads.at(-1)!.turnId,
          { ...exact, subjectNativeId: "player:foreign" })).resolves.toBeNull();
        await expect(readExact(reads.at(-1)!.requestId, "turn:foreign")).resolves.toBeNull();
      }
      expect(new Set(reads.map(read => read.requestId)).size).toBe(3);
      expect(new Set(reads.map(read => read.turnId)).size).toBe(1);
      expect(reads.every(read => !read.replayed)).toBe(true);
      await expect(readExact(reads[0].requestId, reads[0].turnId)).resolves.toBeNull();
      expect(deps.createGoal).not.toHaveBeenCalled();
      expect(deps.refreshSubject).not.toHaveBeenCalled();
      if (scenario === "healthy") expect(goal).toEqual({ goal_id: "goal:unchanged", revision: 5, identity });
      else expect((await getPool().query(`SELECT sequence FROM helix_environment_durable_goal_events
        WHERE goal_id=$1 ORDER BY sequence`, [originalGoalId])).rows.map(row => row.sequence)).toEqual([1, 2, 3, 4, 5]);
    } finally { vi.useRealTimers(); }
  });

  it.each(["captured", "connector", "wrong_player", "missing_player", "wrong_tick", "old_sensor", "expired", "replay", "wrong_source"])(
    "carries opt-in navigation through the broker: %s", async scenario => {
      const connector = await seed();
      const nativeId = "00000000-0000-4000-8000-000000000001";
      const capability = HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY;
      const subjectBindingId = "environment_subject_binding:nav-observation";
      if (scenario !== "missing_player") await getPool().query(`INSERT INTO helix_room_environment_subject_bindings (
        subject_binding_id, room_id, participant_id, profile_id, environment_binding_id,
        room_source_binding_id, source_id, world_id, subject_kind, subject_ref,
        subject_native_id, subject_label, verification_method, confidence,
        producer_epoch_ref, verified_at, last_confirmed_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'minecraft.player','environment_subject:nav',
        $9,'NavigationFixturePlayer','self_claim',0.8,$10,$11,$11,$11,$11)`,
        [subjectBindingId, ROOM_ID, PARTICIPANT_ID, PROFILE_ID, connector.environmentBindingId,
          BINDING_ID, SOURCE_ID, WORLD_ID, nativeId, producerEpochRef, NOW.toISOString()]);
      const dispatched = await dispatch(connector, `nav:${scenario}`, {
        descriptor: readEnvironmentConnectorCapabilityDescriptor(capability)!,
        arguments: { target: "current_actor", include_navigation_collision: true },
        requestingParticipantId: PARTICIPANT_ID,
        ...(scenario === "missing_player" ? {} : { resolvedSubject: { subjectBindingId, subjectNativeId: nativeId } }),
      });
      const [lease] = await leaseDurableEnvironmentProbesForClaim({ claim, adapterAdmission: admission, limit: 1, now: new Date(NOW.getTime() + 100) });
      expect(lease.request.target).toMatchObject({ include_navigation_collision: true });
      const replay = JSON.parse(await fs.readFile("docs/evidence/eh-g8-environment-spatial-navigation-v1/nav1c-selected-player-capture-fixture.json", "utf8"));
      if (scenario === "wrong_player") replay.subject_native_id = "00000000-0000-4000-8000-000000000002";
      if (scenario === "wrong_tick") replay.tick_end++;
      const position = { x: 0, y: 0, z: 0 };
      const details = {
        snapshot_schema: "helix.minecraft_perception_snapshot.v1", observation_revision: 100, game_tick: 100,
        capture_duration_ms: 1, dimension: "minecraft:overworld",
        actor: { position, velocity: position, yaw: 0, pitch: 0, health: 20, max_health: 20, food_level: 20, air: 300, on_ground: true, on_fire: false, freezing: false },
        focus: { kind: "miss", distance_blocks: 0, line_of_sight: true, occlusion: "none" },
        entities: [], hazards: [],
        movement_candidates: ["north", "south", "east", "west"].map(cardinal_direction => ({
          cardinal_direction, relative_direction: "forward", target_feet_position: position, support_position: position,
          support_block: "minecraft:stone", evidence_complete: false, feet_clear: false, head_clear: false,
          drop_depth_blocks: 0, drop_scan_complete: false, nearby_hazard_count: 0, nearby_fluid_count: 0, safe_candidate: false,
        })),
        inventory: { item_count: 0, slots: [] },
        coverage: { horizontal_radius: 2, vertical_radius: 2, loaded_region_complete: true, unknown_cell_count: 0, entities_complete: true, hazards_complete: true, omitted_categories: [] },
        ui_state: { server_container_open: false, same_revision: true, client_screen_state: "unobserved", input_capture_known: false, input_activity: false, freshness: "unobserved" },
        world_rules: { keep_inventory: false }, semantic_fingerprint: `sha256:${"f".repeat(64)}`,
        ...(scenario === "old_sensor" ? {} : { navigation_collision: { status: "captured", replay } }),
      };
      const result: HelixEnvironmentProbeResult = {
        schema: HELIX_ENVIRONMENT_PROBE_RESULT_SCHEMA, probe_result_id: `result:nav:${scenario}`, probe_request_id: dispatched.requestId,
        source_id: scenario === "wrong_source" ? "source:other" : SOURCE_ID, room_id: ROOM_ID, domain: "minecraft", probe_type: "perception_snapshot",
        status: "succeeded", result_summary: "Synthetic bounded perception", result: { details }, sensor_scope: "sensor_observable",
        requires_caveat: false, side_effects_performed: false, commands_executed: [], world_mutation_performed: false,
        evidence_refs: [], deterministic: true, model_invoked: false, assistant_answer: false, raw_content_included: false,
        context_policy: "compact_context_pack_only", created_at: new Date(NOW.getTime() + 200).toISOString(),
      };
      const submit = () => submitDurableEnvironmentProbeResult({ claim, adapterAdmission: admission,
        submission: { schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA, probe_request_id: dispatched.requestId,
          probe_attempt_id: lease.probe_attempt_id, lease_token: lease.lease_token,
          result: scenario === "connector" ? { ...connectorResultFor(dispatched.requestId, "succeeded"),
            capability_id: capability, capability_version: 2, result: { result_summary: result.result_summary, ...details } } : result },
        now: new Date(NOW.getTime() + (scenario === "expired" ? 20_000 : 500)),
      });
      if (["wrong_player", "missing_player", "wrong_tick", "wrong_source"].includes(scenario)) {
        await expect(submit()).rejects.toMatchObject({ code: "schema_validation_failed" }); return;
      }
      const accepted = await submit();
      expect(accepted.observation.result.navigation_collision).toMatchObject({ status: scenario === "old_sensor" ? "unavailable" : "captured" });
      expect(accepted.observation).toMatchObject({ answer_authority: false, assistant_answer: false, terminal_eligible: false,
        eligible_for_current_turn_reentry: scenario !== "expired" });
      if (scenario === "replay") expect((await submit()).replayed).toBe(true);
      const evidence = await readDurableEnvironmentProbeContinuationEvidence({ requestId: dispatched.requestId,
        expectedPriorTurnId: `ask:durable-probe:nav:${scenario}`, expectedRoomId: ROOM_ID, expectedCapabilityId: capability,
        now: new Date(NOW.getTime() + 1000) });
      if (scenario === "expired") expect(evidence).toBeNull();
      else expect(evidence?.observation.result.navigation_collision).toEqual(accepted.observation.result.navigation_collision);
    },
  );
  beforeEach(async () => {
    vi.stubEnv(
      "DATABASE_URL",
      `pg-mem://durable-environment-probe-${crypto.randomUUID()}`,
    );
    vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "0");
    await resetDbClient();
  });

  afterEach(async () => {
    await resetDbClient();
    vi.unstubAllEnvs();
  });

  it("versions legacy connector packages when the admitted capability catalog changes", async () => {
    const original = await seed();
    const descriptors = listEnvironmentConnectorCapabilityDescriptors({
      adapterProfileId: admission.adapter_profile_id,
    });
    const syntheticAdditionalDescriptor = {
      ...descriptors[0],
      capability_id: "com.casimirbot.minecraft.synthetic.additional",
      trusted_model_label: "Synthetic additional Minecraft observation",
      trusted_model_description:
        "Test-only descriptor proving that immutable legacy package identity changes with catalog content.",
    } satisfies HelixEnvironmentCapabilityDescriptor;

    const expanded = await materializeLegacyRoomSourceConnector({
      ownerProfileId: PROFILE_ID,
      roomSourceBindingId: BINDING_ID,
      credentialId: CREDENTIAL_ID,
      roomId: ROOM_ID,
      sourceId: SOURCE_ID,
      worldId: WORLD_ID,
      producerEpochRef,
      adapterAdmission: admission,
      capabilityDescriptors: [...descriptors, syntheticAdditionalDescriptor],
    });

    expect(expanded.packageVersionId).not.toBe(original.packageVersionId);
    expect(expanded.environmentBindingId).not.toBe(original.environmentBindingId);
    expect(expanded.catalogSnapshot.capability_descriptors).toHaveLength(
      descriptors.length + 1,
    );

    const packages = await getPool().query<{
      package_version_id: string;
      package_version: string;
      content_hash: string;
    }>(
      `
        SELECT package_version_id, package_version, content_hash
        FROM helix_environment_connector_packages
        WHERE package_id = 'com.casimirbot.legacy.minecraft'
        ORDER BY package_version_id;
      `,
    );
    expect(packages.rows).toHaveLength(2);
    expect(new Set(packages.rows.map((row) => row.package_version)).size).toBe(2);
    expect(new Set(packages.rows.map((row) => row.content_hash)).size).toBe(2);
  });

  it("preserves device and environment identities across source credential rotation", async () => {
    const original = await seed();
    const rotatedCredentialId =
      "room_source_credential:durable-environment-probe:rotated";

    const rotated = await materializeLegacyRoomSourceConnector({
      ownerProfileId: PROFILE_ID,
      roomSourceBindingId: BINDING_ID,
      credentialId: rotatedCredentialId,
      roomId: ROOM_ID,
      sourceId: SOURCE_ID,
      worldId: WORLD_ID,
      producerEpochRef: `${producerEpochRef}:rotated`,
      adapterAdmission: admission,
      capabilityDescriptors: listEnvironmentConnectorCapabilityDescriptors({
        adapterProfileId: admission.adapter_profile_id,
      }),
    });

    expect(rotated.deviceId).toBe(original.deviceId);
    expect(rotated.environmentBindingId).toBe(original.environmentBindingId);

    const devices = await getPool().query<{
      device_id: string;
      credential_ref: string | null;
    }>(
      `SELECT device_id, credential_ref
       FROM helix_environment_connector_devices
       WHERE installation_id = $1;`,
      [rotated.installationId],
    );
    expect(devices.rows).toEqual([
      {
        device_id: original.deviceId,
        credential_ref: rotatedCredentialId,
      },
    ]);

    const bindings = await getPool().query<{
      environment_binding_id: string;
      device_id: string;
      status: string;
    }>(
      `SELECT environment_binding_id, device_id, status
       FROM helix_environment_connector_bindings
       WHERE installation_id = $1 AND room_source_binding_id = $2;`,
      [rotated.installationId, BINDING_ID],
    );
    expect(bindings.rows).toEqual([
      {
        environment_binding_id: original.environmentBindingId,
        device_id: original.deviceId,
        status: "active",
      },
    ]);
  });

  it("binds an explicitly attested same-host connector to the active installed desktop node", async () => {
    const original = await seed();
    const installedDeviceId = "desktop_device:durable-environment-probe";
    await getPool().query(
      `
        INSERT INTO helix_installed_devices (
          profile_id, device_id, label, platform, status,
          recovery_generation, registered_at, last_seen_at,
          revoked_at, created_at, updated_at
        ) VALUES (
          $1, $2, 'Durable probe desktop', 'windows', 'active',
          0, $3, $3, NULL, $3, $3
        );
      `,
      [PROFILE_ID, installedDeviceId, NOW.toISOString()],
    );

    const rebound = await materializeLegacyRoomSourceConnector({
      ownerProfileId: PROFILE_ID,
      installedDeviceId,
      roomSourceBindingId: BINDING_ID,
      credentialId: CREDENTIAL_ID,
      roomId: ROOM_ID,
      sourceId: SOURCE_ID,
      worldId: WORLD_ID,
      producerEpochRef,
      adapterAdmission: admission,
      capabilityDescriptors: listEnvironmentConnectorCapabilityDescriptors({
        adapterProfileId: admission.adapter_profile_id,
      }),
    });

    expect(rebound.environmentBindingId).toBe(original.environmentBindingId);
    expect(rebound.installedNodeRef).toBe(installedDeviceRef(installedDeviceId));
    const installation = await getPool().query<{
      installed_device_id: string | null;
    }>(
      `SELECT installed_device_id
       FROM helix_environment_connector_installations
       WHERE installation_id = $1;`,
      [rebound.installationId],
    );
    expect(installation.rows).toEqual([{ installed_device_id: installedDeviceId }]);

    const rematerialized = await materializeLegacyRoomSourceConnector({
      ownerProfileId: PROFILE_ID,
      roomSourceBindingId: BINDING_ID,
      credentialId: CREDENTIAL_ID,
      roomId: ROOM_ID,
      sourceId: SOURCE_ID,
      worldId: WORLD_ID,
      producerEpochRef,
      adapterAdmission: admission,
      capabilityDescriptors: listEnvironmentConnectorCapabilityDescriptors({
        adapterProfileId: admission.adapter_profile_id,
      }),
    });

    expect(rematerialized.installedNodeRef).toBe(
      installedDeviceRef(installedDeviceId),
    );
  });

  it("persists exact correlation, leases once, hashes the lease token, and normalizes an idempotent result", async () => {
    const connector = await seed();
    const dispatched = await dispatch(connector, "success");
    expect(dispatched.replayed).toBe(false);

    const wrongDeviceLeases = await leaseDurableEnvironmentProbesForClaim({
      claim,
      adapterAdmission: admission,
      expectedDeviceId: "connector_device:wrong-device",
      expectedEnvironmentBindingId: connector.environmentBindingId,
      limit: 8,
      leaseMs: 4_000,
      now: new Date(NOW.getTime() + 50),
    });
    expect(wrongDeviceLeases).toEqual([]);

    const leases = await leaseDurableEnvironmentProbesForClaim({
      claim,
      adapterAdmission: admission,
      expectedDeviceId: connector.deviceId,
      expectedEnvironmentBindingId: connector.environmentBindingId,
      limit: 8,
      leaseMs: 4_000,
      now: new Date(NOW.getTime() + 100),
    });
    expect(leases).toHaveLength(1);
    expect(leases[0]).toMatchObject({
      capability_id: HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
      capability_version: 1,
      request: {
        probe_request_id: dispatched.requestId,
        probe_type: "inventory_check",
        constraints: {
          read_only: true,
          side_effects_allowed: false,
        },
      },
    });

    const persisted = await getPool().query<{
      run_id: string;
      turn_id: string;
      tool_call_id: string;
      lease_token_hash: string;
    }>(
      `
        SELECT r.run_id, r.turn_id, r.tool_call_id, a.lease_token_hash
        FROM helix_environment_probe_requests r
        JOIN helix_environment_probe_attempts a
          ON a.probe_request_id = r.probe_request_id
        WHERE r.probe_request_id = $1;
      `,
      [dispatched.requestId],
    );
    expect(persisted.rows[0]).toMatchObject({
      run_id: RUN_ID,
      turn_id: "ask:durable-probe:success",
      tool_call_id: "tool_call:durable-probe:success",
    });
    expect(persisted.rows[0].lease_token_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(persisted.rows[0])).not.toContain(
      leases[0].lease_token,
    );

    const submission = {
      schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
      probe_attempt_id: leases[0].probe_attempt_id,
      lease_token: leases[0].lease_token,
      result: resultFor(dispatched.requestId),
      submitted_at: new Date(NOW.getTime() + 500).toISOString(),
    } as const;
    await expect(
      submitDurableEnvironmentProbeResult({
        claim,
        adapterAdmission: admission,
        expectedDeviceId: "connector_device:wrong-device",
        expectedEnvironmentBindingId: connector.environmentBindingId,
        submission,
        now: new Date(NOW.getTime() + 450),
      }),
    ).rejects.toMatchObject({ code: "binding_revoked" });
    const accepted = await submitDurableEnvironmentProbeResult({
      claim,
      adapterAdmission: admission,
      expectedDeviceId: connector.deviceId,
      expectedEnvironmentBindingId: connector.environmentBindingId,
      submission,
      now: new Date(NOW.getTime() + 500),
    });
    expect(accepted).toMatchObject({
      replayed: false,
      observation: {
        outcome: "succeeded",
        capability_id: HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
        provenance_valid: true,
        eligible_for_current_turn_reentry: true,
        late_result_disposition: null,
        answer_authority: false,
        terminal_eligible: false,
        result: {
          item_count: 4,
          slots: [
            { slot: 0, item: "minecraft:diamond", count: 3 },
            { slot: 1, item: "minecraft:bread", count: 5 },
          ],
        },
      },
    });
    const replayed = await submitDurableEnvironmentProbeResult({
      claim,
      adapterAdmission: admission,
      expectedDeviceId: connector.deviceId,
      expectedEnvironmentBindingId: connector.environmentBindingId,
      submission,
      now: new Date(NOW.getTime() + 600),
    });
    expect(replayed.replayed).toBe(true);
    expect(replayed.observation.evidence_ref).toBe(
      accepted.observation.evidence_ref,
    );
    expect(
      await readDurableEnvironmentProbeObservation(dispatched.requestId),
    ).toEqual(accepted.observation);
  });

  it("commits an audit record while rejecting a conflicting duplicate", async () => {
    const connector = await seed();
    const dispatched = await dispatch(connector, "conflict");
    const [lease] = await leaseDurableEnvironmentProbesForClaim({
      claim,
      adapterAdmission: admission,
      limit: 1,
      now: new Date(NOW.getTime() + 100),
    });
    const submission = {
      schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
      probe_attempt_id: lease.probe_attempt_id,
      lease_token: lease.lease_token,
      result: resultFor(dispatched.requestId),
      submitted_at: new Date(NOW.getTime() + 500).toISOString(),
    } as const;
    await submitDurableEnvironmentProbeResult({
      claim,
      adapterAdmission: admission,
      submission,
      now: new Date(NOW.getTime() + 500),
    });

    await expect(
      submitDurableEnvironmentProbeResult({
        claim,
        adapterAdmission: admission,
        submission: {
          ...submission,
          result: resultFor(
            dispatched.requestId,
            "A conflicting connector result.",
          ),
        },
        now: new Date(NOW.getTime() + 600),
      }),
    ).rejects.toMatchObject({
      code: "probe_result_conflict",
      statusCode: 409,
    });
    const audit = (await getPool().query(
      `
        SELECT a.status, e.event_type
        FROM helix_environment_probe_attempts a
        JOIN helix_environment_probe_events e
          ON e.probe_request_id = a.probe_request_id
        WHERE a.probe_attempt_id = $1
          AND e.event_type = 'probe_result_conflict';
      `,
      [lease.probe_attempt_id],
    )) as {
      rows: Array<{
        status: string;
        event_type: string;
      }>;
    };
    expect(audit.rows[0]).toEqual({
      status: "conflict",
      event_type: "probe_result_conflict",
    });
  });

  it("rehydrates only fresh exact prior-turn room evidence without credentials", async () => {
    const connector = await seed();
    const dispatched = await dispatch(connector, "continuation-evidence");
    const [lease] = await leaseDurableEnvironmentProbesForClaim({
      claim,
      adapterAdmission: admission,
      expectedDeviceId: connector.deviceId,
      expectedEnvironmentBindingId: connector.environmentBindingId,
      limit: 1,
      now: new Date(NOW.getTime() + 100),
    });
    await submitDurableEnvironmentProbeResult({
      claim,
      adapterAdmission: admission,
      expectedDeviceId: connector.deviceId,
      expectedEnvironmentBindingId: connector.environmentBindingId,
      submission: {
        schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
        probe_attempt_id: lease.probe_attempt_id,
        lease_token: lease.lease_token,
        result: resultFor(dispatched.requestId),
        submitted_at: new Date(NOW.getTime() + 500).toISOString(),
      },
      now: new Date(NOW.getTime() + 500),
    });

    const evidence =
      await readDurableEnvironmentProbeContinuationEvidence({
        requestId: dispatched.requestId,
        expectedPriorTurnId:
          "ask:durable-probe:continuation-evidence",
        expectedRoomId: ROOM_ID,
        expectedCapabilityId:
          HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
        now: new Date(NOW.getTime() + 1_000),
      });

    expect(evidence).toMatchObject({
      schema:
        "helix.environment_connector.prior_probe_evidence.v1",
      probe_request_ref: dispatched.requestId,
      prior_turn_id:
        "ask:durable-probe:continuation-evidence",
      room_id: ROOM_ID,
      source_id: SOURCE_ID,
      world_id: WORLD_ID,
      environment_binding_ref: connector.environmentBindingId,
      capability_id:
        HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
      semantic_arguments: { target: "current_actor" },
      observation: {
        outcome: "succeeded",
        provenance_valid: true,
        eligible_for_current_turn_reentry: true,
      },
      evidence_age_ms: 500,
      answer_authority: false,
      terminal_eligible: false,
    });
    expect(JSON.stringify(evidence)).not.toContain(lease.lease_token);
    expect(JSON.stringify(evidence)).not.toContain("credential");

    const exactIdentity = {
      environmentBindingId: connector.environmentBindingId, sourceId: SOURCE_ID,
      worldId: WORLD_ID, subjectBindingId: "subject-binding:temporal-test",
      subjectNativeId: "player:temporal-test", observationProducerEpochRef: admission.producer_epoch_ref,
    };
    const readExact = (expectedEnvironmentIdentity = exactIdentity) =>
      readDurableEnvironmentProbeContinuationEvidence({
        requestId: dispatched.requestId,
        expectedPriorTurnId: "ask:durable-probe:continuation-evidence",
        expectedRoomId: ROOM_ID, expectedCapabilityId: HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
        now: new Date(NOW.getTime() + 1_000), expectedEnvironmentIdentity,
      });
    // Legacy unbound evidence remains readable above, but is not exact-player proof.
    await expect(readExact()).resolves.toBeNull();
    const exactDb = await getPool();
    await exactDb.query(`INSERT INTO helix_room_environment_subject_bindings (
      subject_binding_id, room_id, participant_id, profile_id, environment_binding_id,
      room_source_binding_id, source_id, world_id, subject_kind, subject_ref,
      subject_native_id, subject_label, verification_method, confidence,
      producer_epoch_ref, verified_at, last_confirmed_at, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'minecraft.player','environment_subject:temporal-test',
      $9,'TemporalPlayer','self_claim',0.8,$10,$11,$11,$11,$11)`,
      [exactIdentity.subjectBindingId, ROOM_ID, PARTICIPANT_ID, PROFILE_ID,
        connector.environmentBindingId, BINDING_ID, SOURCE_ID, WORLD_ID,
        exactIdentity.subjectNativeId, admission.producer_epoch_ref, NOW.toISOString()]);
    await exactDb.query(`UPDATE helix_environment_probe_requests
      SET resolved_subject_binding_id=$2, resolved_subject_native_id=$3
      WHERE probe_request_id=$1`, [dispatched.requestId, exactIdentity.subjectBindingId, exactIdentity.subjectNativeId]);
    await expect(readExact()).resolves.toMatchObject({ probe_request_ref: dispatched.requestId });
    const expiryDiagnostic = vi.fn();
    const readAtAge = (age: number, expectedEnvironmentIdentity = exactIdentity) =>
      readDurableEnvironmentProbeContinuationEvidence({
        requestId: dispatched.requestId,
        expectedPriorTurnId: "ask:durable-probe:continuation-evidence",
        expectedRoomId: ROOM_ID, expectedCapabilityId: HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
        expectedEnvironmentIdentity, maxAgeMs: 5000,
        now: new Date(NOW.getTime() + 500 + age), onExpired: expiryDiagnostic,
      });
    await expect(readAtAge(5000)).resolves.not.toBeNull();
    expect(expiryDiagnostic).not.toHaveBeenCalled();
    await expect(readAtAge(5001)).resolves.toBeNull();
    expect(expiryDiagnostic).toHaveBeenCalledTimes(1);
    expect(expiryDiagnostic).toHaveBeenCalledWith({ evidence_age_ms: 5001, max_age_ms: 5000 });
    expiryDiagnostic.mockClear();
    await expect(readAtAge(6000, { ...exactIdentity, subjectNativeId: "wrong:identity" })).resolves.toBeNull();
    await expect(readAtAge(-1)).resolves.toBeNull();
    expect(expiryDiagnostic).not.toHaveBeenCalled();
    expiryDiagnostic.mockImplementation(() => { throw new Error("diagnostic sink failed"); });
    await expect(readAtAge(6000)).resolves.toBeNull();
    for (const key of Object.keys(exactIdentity) as Array<keyof typeof exactIdentity>) {
      await expect(readExact({ ...exactIdentity, [key]: "wrong:identity" })).resolves.toBeNull();
    }

    await expect(
      readDurableEnvironmentProbeContinuationEvidence({
        requestId: dispatched.requestId,
        expectedPriorTurnId: "ask:wrong-turn",
        expectedRoomId: ROOM_ID,
        expectedCapabilityId:
          HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
        now: new Date(NOW.getTime() + 1_000),
      }),
    ).resolves.toBeNull();
    await expect(
      readDurableEnvironmentProbeContinuationEvidence({
        requestId: dispatched.requestId,
        expectedPriorTurnId:
          "ask:durable-probe:continuation-evidence",
        expectedRoomId: "shared_realtime_room:wrong",
        expectedCapabilityId:
          HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
        now: new Date(NOW.getTime() + 1_000),
      }),
    ).resolves.toBeNull();
    await expect(
      readDurableEnvironmentProbeContinuationEvidence({
        requestId: dispatched.requestId,
        expectedPriorTurnId:
          "ask:durable-probe:continuation-evidence",
        expectedRoomId: ROOM_ID,
        expectedCapabilityId:
          HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
        maxAgeMs: 5_000,
        now: new Date(NOW.getTime() + 10_000),
      }),
    ).resolves.toBeNull();
  });

  it.each([
    "capability_unavailable",
    "target_unavailable",
    "target_ambiguous",
  ] as const)(
    "normalizes the connector-reported %s outcome as current-turn nonterminal evidence",
    async (outcome) => {
      const connector = await seed();
      const dispatched = await dispatch(connector, outcome);
      const [lease] = await leaseDurableEnvironmentProbesForClaim({
        claim,
        adapterAdmission: admission,
        expectedDeviceId: connector.deviceId,
        expectedEnvironmentBindingId: connector.environmentBindingId,
        limit: 1,
        now: new Date(NOW.getTime() + 100),
      });
      const accepted = await submitDurableEnvironmentProbeResult({
        claim,
        adapterAdmission: admission,
        expectedDeviceId: connector.deviceId,
        expectedEnvironmentBindingId: connector.environmentBindingId,
        submission: {
          schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
          probe_attempt_id: lease.probe_attempt_id,
          lease_token: lease.lease_token,
          result: connectorResultFor(dispatched.requestId, outcome),
          submitted_at: new Date(NOW.getTime() + 500).toISOString(),
        },
        now: new Date(NOW.getTime() + 500),
      });

      expect(accepted.observation).toMatchObject({
        outcome,
        provenance_valid: true,
        eligible_for_current_turn_reentry: true,
        answer_authority: false,
        terminal_eligible: false,
      });
    },
  );

  it("rechecks post-dispatch consent, account, binding, credential, catalog, and producer authority", async () => {
    const connector = await seed();
    const dispatchAndLease = async (suffix: string) => {
      const dispatched = await dispatch(connector, suffix);
      const [lease] = await leaseDurableEnvironmentProbesForClaim({
        claim,
        adapterAdmission: admission,
        expectedDeviceId: connector.deviceId,
        expectedEnvironmentBindingId: connector.environmentBindingId,
        limit: 1,
        now: new Date(NOW.getTime() + 100),
      });
      return { dispatched, lease };
    };
    const submit = (
      dispatched: { requestId: string },
      lease: {
        probe_attempt_id: string;
        lease_token: string;
      },
    ) =>
      submitDurableEnvironmentProbeResult({
        claim,
        adapterAdmission: admission,
        expectedDeviceId: connector.deviceId,
        expectedEnvironmentBindingId: connector.environmentBindingId,
        submission: {
          schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
          probe_attempt_id: lease.probe_attempt_id,
          lease_token: lease.lease_token,
          result: resultFor(dispatched.requestId),
          submitted_at: new Date(NOW.getTime() + 500).toISOString(),
        },
        now: new Date(NOW.getTime() + 500),
      });

    const consent = await dispatchAndLease("consent-revoked");
    await getPool().query(
      `
        UPDATE helix_shared_realtime_room_members
        SET consent = $2::jsonb
        WHERE room_id = $1 AND profile_id = $3;
      `,
      [
        ROOM_ID,
        JSON.stringify({
          consent_version: CONSENT_VERSION + 1,
          consent_receipt_ref: "room_consent:durable-environment-probe:2",
        }),
        PROFILE_ID,
      ],
    );
    expect(await submit(consent.dispatched, consent.lease)).toMatchObject({
      observation: {
        outcome: "permission_revoked",
        provenance_valid: true,
        eligible_for_current_turn_reentry: false,
      },
    });
    await getPool().query(
      `
        UPDATE helix_shared_realtime_room_members
        SET consent = $2::jsonb
        WHERE room_id = $1 AND profile_id = $3;
      `,
      [
        ROOM_ID,
        JSON.stringify({
          consent_version: CONSENT_VERSION,
          consent_receipt_ref: CONSENT_RECEIPT_REF,
        }),
        PROFILE_ID,
      ],
    );

    const account = await dispatchAndLease("account-revoked");
    await getPool().query(
      "UPDATE helix_accounts SET account_type = 'user' WHERE profile_id = $1;",
      [PROFILE_ID],
    );
    expect(await submit(account.dispatched, account.lease)).toMatchObject({
      observation: {
        outcome: "permission_revoked",
        eligible_for_current_turn_reentry: false,
      },
    });
    await getPool().query(
      "UPDATE helix_accounts SET account_type = 'developer' WHERE profile_id = $1;",
      [PROFILE_ID],
    );

    const environmentBinding = await dispatchAndLease("binding-revoked");
    await getPool().query(
      `
        UPDATE helix_environment_connector_bindings
        SET status = 'revoked', revoked_at = $2
        WHERE environment_binding_id = $1;
      `,
      [connector.environmentBindingId, NOW.toISOString()],
    );
    expect(
      await submit(environmentBinding.dispatched, environmentBinding.lease),
    ).toMatchObject({
      observation: {
        outcome: "binding_revoked",
        eligible_for_current_turn_reentry: false,
      },
    });
    await getPool().query(
      `
        UPDATE helix_environment_connector_bindings
        SET status = 'active', revoked_at = NULL
        WHERE environment_binding_id = $1;
      `,
      [connector.environmentBindingId],
    );

    const credential = await dispatchAndLease("credential-revoked");
    await getPool().query(
      `
        UPDATE helix_room_source_credentials
        SET status = 'revoked', revoked_at = $2
        WHERE credential_id = $1;
      `,
      [CREDENTIAL_ID, NOW.toISOString()],
    );
    expect(await submit(credential.dispatched, credential.lease)).toMatchObject(
      {
        observation: {
          outcome: "binding_revoked",
          eligible_for_current_turn_reentry: false,
        },
      },
    );
    await getPool().query(
      `
        UPDATE helix_room_source_credentials
        SET status = 'active', revoked_at = NULL
        WHERE credential_id = $1;
      `,
      [CREDENTIAL_ID],
    );

    const catalog = await dispatchAndLease("catalog-expired");
    await getPool().query(
      `
        UPDATE helix_environment_capability_catalog_snapshots
        SET expires_at = $2
        WHERE catalog_snapshot_id = $1;
      `,
      [
        connector.catalogSnapshot.catalog_snapshot_id,
        new Date(NOW.getTime() + 200).toISOString(),
      ],
    );
    expect(await submit(catalog.dispatched, catalog.lease)).toMatchObject({
      observation: {
        outcome: "capability_version_changed",
        eligible_for_current_turn_reentry: false,
      },
    });
    await getPool().query(
      `
        UPDATE helix_environment_capability_catalog_snapshots
        SET expires_at = NULL
        WHERE catalog_snapshot_id = $1;
      `,
      [connector.catalogSnapshot.catalog_snapshot_id],
    );

    const epoch = await dispatchAndLease("producer-epoch-changed");
    await getPool().query(
      `
        UPDATE helix_environment_connector_devices
        SET producer_epoch_ref = 'adapter_epoch:changed'
        WHERE device_id = $1;
      `,
      [connector.deviceId],
    );
    await expect(submit(epoch.dispatched, epoch.lease)).rejects.toMatchObject({
      code: "producer_epoch_mismatch",
      statusCode: 409,
    });
  });

  it("normalizes cancellation, supersession, timeout, stale results, and connector-offline exhaustion", async () => {
    const connector = await seed();

    const canceled = await dispatch(connector, "canceled");
    const [canceledLease] = await leaseDurableEnvironmentProbesForClaim({
      claim,
      adapterAdmission: admission,
      limit: 1,
      now: new Date(NOW.getTime() + 100),
    });
    expect(
      await cancelDurableEnvironmentProbe({
        requestId: canceled.requestId,
        reason: "user_interrupted",
      }),
    ).toBe(true);
    expect(
      await readDurableEnvironmentProbeObservation(canceled.requestId),
    ).toMatchObject({
      outcome: "request_canceled",
      eligible_for_current_turn_reentry: false,
    });
    const lateCanceled = await submitDurableEnvironmentProbeResult({
      claim,
      adapterAdmission: admission,
      submission: {
        schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
        probe_attempt_id: canceledLease.probe_attempt_id,
        lease_token: canceledLease.lease_token,
        result: resultFor(canceled.requestId),
        submitted_at: new Date(NOW.getTime() + 500).toISOString(),
      },
      now: new Date(NOW.getTime() + 500),
    });
    expect(lateCanceled.observation).toMatchObject({
      provenance_valid: true,
      eligible_for_current_turn_reentry: false,
      late_result_disposition: "late_after_cancellation",
    });

    const superseded = await dispatch(connector, "superseded");
    const [supersededLease] = await leaseDurableEnvironmentProbesForClaim({
      claim,
      adapterAdmission: admission,
      limit: 1,
      now: new Date(NOW.getTime() + 100),
    });
    expect(
      await supersedeDurableEnvironmentProbe({
        requestId: superseded.requestId,
        supersededByRequestId: "environment_probe_request:replacement",
        reason: "newer_exact_request",
      }),
    ).toBe(true);
    expect(
      await readDurableEnvironmentProbeObservation(superseded.requestId),
    ).toMatchObject({
      outcome: "request_superseded",
      eligible_for_current_turn_reentry: false,
    });
    const lateSuperseded = await submitDurableEnvironmentProbeResult({
      claim,
      adapterAdmission: admission,
      submission: {
        schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
        probe_attempt_id: supersededLease.probe_attempt_id,
        lease_token: supersededLease.lease_token,
        result: resultFor(superseded.requestId),
        submitted_at: new Date(NOW.getTime() + 500).toISOString(),
      },
      now: new Date(NOW.getTime() + 500),
    });
    expect(lateSuperseded.observation).toMatchObject({
      provenance_valid: true,
      eligible_for_current_turn_reentry: false,
      late_result_disposition: "late_after_supersession",
    });

    const timedOut = await dispatch(connector, "timed-out");
    expect(await expireDurableEnvironmentProbe(timedOut.requestId)).toBe(true);
    expect(
      await readDurableEnvironmentProbeObservation(timedOut.requestId),
    ).toMatchObject({
      outcome: "probe_timeout",
      eligible_for_current_turn_reentry: true,
    });

    const stale = await dispatch(connector, "stale");
    const [staleLease] = await leaseDurableEnvironmentProbesForClaim({
      claim,
      adapterAdmission: admission,
      limit: 1,
      now: new Date(NOW.getTime() + 100),
    });
    const staleAccepted = await submitDurableEnvironmentProbeResult({
      claim,
      adapterAdmission: admission,
      submission: {
        schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
        probe_attempt_id: staleLease.probe_attempt_id,
        lease_token: staleLease.lease_token,
        result: resultFor(
          stale.requestId,
          "This connector result is too old for the request.",
          new Date(NOW.getTime() - 6_000).toISOString(),
        ),
        submitted_at: new Date(NOW.getTime() + 500).toISOString(),
      },
      now: new Date(NOW.getTime() + 500),
    });
    expect(staleAccepted.observation).toMatchObject({
      outcome: "result_stale",
      provenance_valid: true,
      eligible_for_current_turn_reentry: false,
    });

    const offline = await dispatch(connector, "offline");
    expect(
      await leaseDurableEnvironmentProbesForClaim({
        claim,
        adapterAdmission: admission,
        limit: 1,
        leaseMs: 1_000,
        now: new Date(NOW.getTime() + 100),
      }),
    ).toHaveLength(1);
    expect(
      await leaseDurableEnvironmentProbesForClaim({
        claim,
        adapterAdmission: admission,
        limit: 1,
        leaseMs: 1_000,
        now: new Date(NOW.getTime() + 1_200),
      }),
    ).toHaveLength(1);
    expect(
      await leaseDurableEnvironmentProbesForClaim({
        claim,
        adapterAdmission: admission,
        limit: 1,
        leaseMs: 1_000,
        now: new Date(NOW.getTime() + 2_300),
      }),
    ).toHaveLength(1);
    expect(
      await leaseDurableEnvironmentProbesForClaim({
        claim,
        adapterAdmission: admission,
        limit: 1,
        leaseMs: 1_000,
        now: new Date(NOW.getTime() + 3_400),
      }),
    ).toEqual([]);
    expect(
      await readDurableEnvironmentProbeObservation(offline.requestId),
    ).toMatchObject({
      outcome: "connector_offline",
      eligible_for_current_turn_reentry: true,
    });
  });

  it("keeps a late authentic result as evidence but makes it ineligible for the completed turn", async () => {
    const connector = await seed();
    const dispatched = await dispatch(connector, "late");
    const [lease] = await leaseDurableEnvironmentProbesForClaim({
      claim,
      adapterAdmission: admission,
      limit: 1,
      now: new Date(NOW.getTime() + 100),
    });
    await getPool().query(
      `
        UPDATE helix_agent_runs
        SET lifecycle_status = 'completed',
            completion_status = 'completed'
        WHERE run_id = $1;
      `,
      [RUN_ID],
    );
    const accepted = await submitDurableEnvironmentProbeResult({
      claim,
      adapterAdmission: admission,
      submission: {
        schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
        probe_attempt_id: lease.probe_attempt_id,
        lease_token: lease.lease_token,
        result: resultFor(dispatched.requestId),
        submitted_at: new Date(NOW.getTime() + 500).toISOString(),
      },
      now: new Date(NOW.getTime() + 500),
    });
    expect(accepted.observation).toMatchObject({
      provenance_valid: true,
      eligible_for_current_turn_reentry: false,
      late_result_disposition: "late_after_turn_closed",
    });
  });

  it("accepts a timely first-party shared-room result without inventing an external Agent API run", async () => {
    const connector = await seed();
    const dispatched = await dispatchDurableEnvironmentProbe({
      tenantId: "first_party_browser_session",
      ownerSubjectId: "first_party_subject:durable-environment-probe",
      ownerProfileId: PROFILE_ID,
      executionAuthorityKind: "first_party_shared_room",
      runId: "first_party_shared_room:durable-environment-probe",
      turnId: "ask:first-party-room:success",
      providerExecutionId: "provider_execution:first-party-room:success",
      toolCallId: "tool_call:first-party-room:success",
      roomId: ROOM_ID,
      sourceId: SOURCE_ID,
      producerEpochRef,
      adapterAdmission: admission,
      connector,
      descriptor: readEnvironmentConnectorCapabilityDescriptor(
        HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
      )!,
      arguments: {
        target: "current_actor",
        freshness_requirement_ms: 5_000,
      },
      freshnessRequirementMs: 5_000,
      timeoutMs: 10_000,
      idempotencyKey: "idempotency:first-party-room:success",
      now: NOW,
    });
    const [lease] = await leaseDurableEnvironmentProbesForClaim({
      claim,
      adapterAdmission: admission,
      limit: 1,
      now: new Date(NOW.getTime() + 100),
    });

    const accepted = await submitDurableEnvironmentProbeResult({
      claim,
      adapterAdmission: admission,
      submission: {
        schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
        probe_attempt_id: lease.probe_attempt_id,
        lease_token: lease.lease_token,
        result: resultFor(dispatched.requestId),
        submitted_at: new Date(NOW.getTime() + 500).toISOString(),
      },
      now: new Date(NOW.getTime() + 500),
    });

    expect(accepted.observation).toMatchObject({
      outcome: "succeeded",
      provenance_valid: true,
      eligible_for_current_turn_reentry: true,
      late_result_disposition: null,
    });
  });

  it("accepts a timely read-only result for a present consented room participant", async () => {
    const connector = await seed();
    const participantProfileId = "profile:durable-environment-participant";
    const participantId = "room_participant:durable-environment-participant";
    await getPool().query(
      `
        INSERT INTO helix_accounts (
          profile_id, display_name, account_type, provider
        ) VALUES ($1, 'Durable probe participant', 'user', 'local');

        INSERT INTO helix_shared_realtime_room_members (
          room_id, slot_number, profile_id, participant_id, member_role,
          presence, consent, joined_at, last_seen_at, updated_at
        ) VALUES (
          $2, 2, $1, $3, 'participant', 'present', $4::jsonb, $5, $5, $5
        );
      `,
      [
        participantProfileId,
        ROOM_ID,
        participantId,
        JSON.stringify({
          consent_version: CONSENT_VERSION,
          consent_receipt_ref:
            "room_consent:durable-environment-participant:1",
        }),
        NOW.toISOString(),
      ],
    );
    const dispatched = await dispatchDurableEnvironmentProbe({
      tenantId: "first_party_browser_session",
      ownerSubjectId: "first_party_subject:durable-environment-participant",
      ownerProfileId: participantProfileId,
      executionAuthorityKind: "first_party_shared_room",
      runId: "first_party_shared_room:durable-environment-participant",
      turnId: "ask:first-party-room:participant-success",
      providerExecutionId:
        "provider_execution:first-party-room:participant-success",
      toolCallId: "tool_call:first-party-room:participant-success",
      roomId: ROOM_ID,
      sourceId: SOURCE_ID,
      producerEpochRef,
      requestingParticipantId: participantId,
      adapterAdmission: admission,
      connector,
      descriptor: readEnvironmentConnectorCapabilityDescriptor(
        HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
      )!,
      arguments: {
        target: "current_actor",
        freshness_requirement_ms: 5_000,
      },
      freshnessRequirementMs: 5_000,
      timeoutMs: 10_000,
      idempotencyKey: "idempotency:first-party-room:participant-success",
      now: NOW,
    });
    const [lease] = await leaseDurableEnvironmentProbesForClaim({
      claim,
      adapterAdmission: admission,
      limit: 1,
      now: new Date(NOW.getTime() + 100),
    });

    const accepted = await submitDurableEnvironmentProbeResult({
      claim,
      adapterAdmission: admission,
      submission: {
        schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
        probe_attempt_id: lease.probe_attempt_id,
        lease_token: lease.lease_token,
        result: resultFor(dispatched.requestId),
        submitted_at: new Date(NOW.getTime() + 500).toISOString(),
      },
      now: new Date(NOW.getTime() + 500),
    });

    expect(accepted.observation).toMatchObject({
      outcome: "succeeded",
      provenance_valid: true,
      eligible_for_current_turn_reentry: true,
      late_result_disposition: null,
    });
  });

  it("injects a frozen native subject and exact structure verification only into the connector lease", async () => {
    const connector = await seed();
    const subjectNativeId = "123e4567-e89b-12d3-a456-426614174000";
    const subjectBindingId = "environment_subject_binding:durable-probe";
    await getPool().query(
      `
        INSERT INTO helix_room_environment_subject_bindings (
          subject_binding_id,
          room_id,
          participant_id,
          profile_id,
          environment_binding_id,
          room_source_binding_id,
          source_id,
          world_id,
          subject_kind,
          subject_ref,
          subject_native_id,
          subject_label,
          verification_method,
          confidence,
          producer_epoch_ref,
          verified_at,
          last_confirmed_at,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          'minecraft.player', 'environment_subject:durable-probe', $9,
          'DurablePlayer', 'self_claim', 0.8, $10, $11, $11, $11, $11
        );
      `,
      [
        subjectBindingId,
        ROOM_ID,
        PARTICIPANT_ID,
        PROFILE_ID,
        connector.environmentBindingId,
        BINDING_ID,
        SOURCE_ID,
        WORLD_ID,
        subjectNativeId,
        producerEpochRef,
        NOW.toISOString(),
      ],
    );
    const dispatched = await dispatchDurableEnvironmentProbe({
      tenantId: "first_party_browser_session",
      ownerSubjectId: "first_party_subject:durable-environment-probe",
      ownerProfileId: PROFILE_ID,
      executionAuthorityKind: "first_party_shared_room",
      runId: "first_party_shared_room:durable-environment-probe-subject",
      turnId: "ask:first-party-room:subject",
      providerExecutionId: "provider_execution:first-party-room:subject",
      toolCallId: "tool_call:first-party-room:subject",
      roomId: ROOM_ID,
      sourceId: SOURCE_ID,
      producerEpochRef,
      requestingParticipantId: PARTICIPANT_ID,
      resolvedSubject: { subjectBindingId, subjectNativeId },
      adapterAdmission: admission,
      connector,
      descriptor: readEnvironmentConnectorCapabilityDescriptor(
        HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
      )!,
      arguments: {
        target: "current_actor",
        horizontal_radius: 7,
        vertical_radius: 8,
        purpose: "structure_verification",
        verification_from: { x: -52, y: 69, z: 4 },
        verification_to: { x: -48, y: 71, z: 4 },
        expected_block: "minecraft:stone_bricks",
        freshness_requirement_ms: 5_000,
      },
      freshnessRequirementMs: 5_000,
      timeoutMs: 10_000,
      idempotencyKey: "idempotency:first-party-room:subject",
      now: NOW,
    });
    const [lease] = await leaseDurableEnvironmentProbesForClaim({
      claim,
      adapterAdmission: admission,
      limit: 1,
      now: new Date(NOW.getTime() + 100),
    });

    expect(lease.capability_request.arguments).toEqual({
      target: "current_actor",
      horizontal_radius: 7,
      vertical_radius: 8,
      purpose: "structure_verification",
      verification_from: { x: -52, y: 69, z: 4 },
      verification_to: { x: -48, y: 71, z: 4 },
      expected_block: "minecraft:stone_bricks",
      freshness_requirement_ms: 5_000,
    });
    expect(JSON.stringify(lease.capability_request)).not.toContain(
      subjectNativeId,
    );
    expect(lease.request).toMatchObject({
      probe_request_id: dispatched.requestId,
      target: {
        target_ref: "current_actor",
        horizontal_radius: 7,
        vertical_radius: 8,
        purpose: "structure_verification",
        verification_from: { x: -52, y: 69, z: 4 },
        verification_to: { x: -48, y: 71, z: 4 },
        expected_block: "minecraft:stone_bricks",
        actor_id: subjectNativeId,
      },
    });
    const persisted = await getPool().query<{
      requesting_participant_id: string;
      resolved_subject_binding_id: string;
      resolved_subject_native_id: string;
    }>(
      `
        SELECT
          requesting_participant_id,
          resolved_subject_binding_id,
          resolved_subject_native_id
        FROM helix_environment_probe_requests
        WHERE probe_request_id = $1;
      `,
      [dispatched.requestId],
    );
    expect(persisted.rows[0]).toEqual({
      requesting_participant_id: PARTICIPANT_ID,
      resolved_subject_binding_id: subjectBindingId,
      resolved_subject_native_id: subjectNativeId,
    });
  });

  it("recovers the frozen request and lease across a local server restart without persisting the raw lease token", async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "helix-environment-probe-restart-"),
    );
    const snapshotPath = path.join(tempRoot, "helix-db.json");
    try {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
      vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshotPath);
      await resetDbClient();

      const connector = await seed();
      const subjectNativeId = "123e4567-e89b-12d3-a456-426614174001";
      const subjectBindingId = "environment_subject_binding:restart";
      await getPool().query(
        `
          INSERT INTO helix_room_environment_subject_bindings (
            subject_binding_id,
            room_id,
            participant_id,
            profile_id,
            environment_binding_id,
            room_source_binding_id,
            source_id,
            world_id,
            subject_kind,
            subject_ref,
            subject_native_id,
            subject_label,
            verification_method,
            confidence,
            producer_epoch_ref,
            verified_at,
            last_confirmed_at,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            'minecraft.player', 'environment_subject:restart', $9,
            'RestartPlayer', 'self_claim', 0.8, $10, $11, $11, $11, $11
          );
        `,
        [
          subjectBindingId,
          ROOM_ID,
          PARTICIPANT_ID,
          PROFILE_ID,
          connector.environmentBindingId,
          BINDING_ID,
          SOURCE_ID,
          WORLD_ID,
          subjectNativeId,
          producerEpochRef,
          NOW.toISOString(),
        ],
      );
      const dispatched = await dispatchDurableEnvironmentProbe({
        tenantId: "first_party_browser_session",
        ownerSubjectId: "first_party_subject:restart",
        ownerProfileId: PROFILE_ID,
        executionAuthorityKind: "first_party_shared_room",
        runId: "first_party_shared_room:restart",
        turnId: "ask:first-party-room:restart",
        providerExecutionId: "provider_execution:first-party-room:restart",
        toolCallId: "tool_call:first-party-room:restart",
        roomId: ROOM_ID,
        sourceId: SOURCE_ID,
        producerEpochRef,
        requestingParticipantId: PARTICIPANT_ID,
        resolvedSubject: { subjectBindingId, subjectNativeId },
        adapterAdmission: admission,
        connector,
        descriptor: readEnvironmentConnectorCapabilityDescriptor(
          HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
        )!,
        arguments: {
          target: "current_actor",
          freshness_requirement_ms: 5_000,
        },
        freshnessRequirementMs: 5_000,
        timeoutMs: 10_000,
        idempotencyKey: "idempotency:first-party-room:restart",
        now: NOW,
      });
      const [lease] = await leaseDurableEnvironmentProbesForClaim({
        claim,
        adapterAdmission: admission,
        limit: 1,
        leaseMs: 4_000,
        now: new Date(NOW.getTime() + 100),
      });
      await resetDbClient();
      await ensureDatabase();

      const restored = await getPool().query<{
        request_status: string;
        attempt_status: string;
        lease_token_hash: string;
        subject_label: string;
      }>(
        `
          SELECT
            r.status AS request_status,
            a.status AS attempt_status,
            a.lease_token_hash,
            s.subject_label
          FROM helix_environment_probe_requests r
          JOIN helix_environment_probe_attempts a
            ON a.probe_request_id = r.probe_request_id
          JOIN helix_room_environment_subject_bindings s
            ON s.subject_binding_id = r.resolved_subject_binding_id
          WHERE r.probe_request_id = $1;
        `,
        [dispatched.requestId],
      );
      expect(restored.rows[0]).toMatchObject({
        request_status: "leased",
        attempt_status: "leased",
        subject_label: "RestartPlayer",
      });
      expect(JSON.stringify(restored.rows[0])).not.toContain(lease.lease_token);

      const accepted = await submitDurableEnvironmentProbeResult({
        claim,
        adapterAdmission: admission,
        submission: {
          schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
          probe_attempt_id: lease.probe_attempt_id,
          lease_token: lease.lease_token,
          result: resultFor(dispatched.requestId),
          submitted_at: new Date(NOW.getTime() + 500).toISOString(),
        },
        now: new Date(NOW.getTime() + 500),
      });
      expect(accepted.observation).toMatchObject({
        outcome: "succeeded",
        provenance_valid: true,
        eligible_for_current_turn_reentry: true,
      });
    } finally {
      await resetDbClient();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
