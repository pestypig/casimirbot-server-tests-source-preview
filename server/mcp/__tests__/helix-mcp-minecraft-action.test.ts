import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as temporalFrontier from "../../services/environment-connectors/temporal-plans/temporal-frontier-publisher";
import { TemporalPlanError } from "../../services/environment-connectors/temporal-plans/temporal-plan-error";
import * as temporalAdmission from "../../services/environment-connectors/temporal-plans/temporal-plan-admission";
import { EnvironmentDurableGoalError } from "../../services/environment-connectors/goals/durable-goal-store";
import { EnvironmentActionBrokerError } from "../../services/environment-connectors/actions/action-broker";
import temporalSubmissionFixture from "./fixtures/temporal-submission.json";
import { buildHelixSharedRealtimeRoomsExperimentPolicy } from
  "@shared/helix-account-session";
import { HELIX_SHARED_LIVE_ROOM_READ_SCOPE } from
  "@shared/contracts/helix-shared-live-room-agent.v1";
import {
  HELIX_ENVIRONMENT_ACTION_OBSERVATION_SCHEMA,
  HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
  HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE,
  type HelixEnvironmentActionObservation,
} from "@shared/helix-environment-action";
import {
  HELIX_ENVIRONMENT_PROBE_OBSERVATION_SCHEMA,
  HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
  HELIX_MINECRAFT_HAZARDS_SCAN_CAPABILITY,
  HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
  HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY,
  HELIX_MINECRAFT_LOCAL_MAP_INSPECT_CAPABILITY,
  HELIX_MINECRAFT_NEARBY_ENTITIES_LIST_CAPABILITY,
  HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY,
  HELIX_MINECRAFT_REACHABILITY_CHECK_CAPABILITY,
  HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
  type HelixEnvironmentProbeObservation,
} from "@shared/helix-environment-connector";
import {
  HELIX_MINECRAFT_PLAYER_COMBAT_ATTACK_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_LOOK_CAPABILITY,
} from
  "@shared/helix-minecraft-player-capabilities";
import {
  HELIX_MINECRAFT_PLAYER_EXECUTE_REACTIVE_PROGRAM_CAPABILITY,
  HELIX_MINECRAFT_REACTIVE_PROGRAM_SCHEMA,
} from "@shared/helix-minecraft-reactive-program";
import {
  createHelixMcpServer,
  type HelixEnvironmentActionMcpExecutor,
  type HelixEnvironmentActionControlMcpExecutor,
  type HelixEnvironmentActionAuthorityLeaseExtender,
  type HelixEnvironmentProbeMcpExecutor,
  type HelixEnvironmentReasoningRoleMcpStore,
} from "../helix-mcp-server";
import type { HelixAgentApiService } from
  "../../services/helix-agent-api/service";
import type { HelixAgentApiPrincipal } from
  "../../services/helix-agent-api/types";
import type { HelixMcpEvidenceObservation } from
  "@shared/contracts/helix-mcp-evidence-capability.v1";
import type { SharedLiveRoomBindingStore } from
  "../../services/shared-live-room-control/binding-store";
import type { SharedLiveRoomControlService } from
  "../../services/shared-live-room-control/service";
import {
  enqueueStagePlayLiveSourceMailItem,
  resetStagePlayLiveSourceMailboxForTest,
} from "../../services/stage-play/stage-play-live-source-mailbox-store";

const ROOM_ID = "shared_realtime_room:mcp-minecraft-action";

const principal = (scopes: readonly string[]): HelixAgentApiPrincipal => {
  const policy = buildHelixSharedRealtimeRoomsExperimentPolicy("developer");
  const now = "2026-08-12T20:00:00.000Z";
  return {
    tenantId: "tenant-mcp-minecraft-action",
    issuer: "https://issuer.example",
    subjectId: "subject-mcp-minecraft-action",
    accountProfileId: "profile-mcp-minecraft-action",
    accountType: "developer",
    scopes: new Set(scopes),
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    accountContext: {
      session_id: "external-oauth:mcp-minecraft-action",
      profile_id: "profile-mcp-minecraft-action",
      trusted_account_session: true,
      account_session: {
        schema: "helix.account_session.v1",
        session_id: "external-oauth:mcp-minecraft-action",
        profile: {
          profile_id: "profile-mcp-minecraft-action",
          display_name: "MCP Minecraft Action",
          email: null,
          auth_mode: "web_auth",
          account_type: "developer",
          provider: "external_oauth",
          provider_alias: "test",
          provider_subject: "subject-mcp-minecraft-action",
          picture_url: null,
          created_at: now,
          updated_at: now,
        },
        account_policy: policy,
        status: "active",
        memory_scope: "profile",
        created_at: now,
        updated_at: now,
        expires_at: "2099-01-01T00:00:00.000Z",
      },
      account_policy: policy,
    },
  };
};

const observation: HelixEnvironmentActionObservation = {
  schema: HELIX_ENVIRONMENT_ACTION_OBSERVATION_SCHEMA,
  action_request_ref: "environment_action_request:mcp-jump",
  workflow_ref: "environment_action_workflow:mcp-jump",
  action_execution_ref: "environment_action_execution:mcp-jump",
  capability_id: HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY,
  capability_version: 1,
  action_kind: "jump",
  outcome: "succeeded",
  summary: "The paired player completed one jump.",
  result: { controls_released: true },
  progress_observation_refs: ["environment_action_event:mcp-jump"],
  postcondition_evidence_refs: ["environment_action_event:mcp-jump"],
  evidence_ref: "environment_action_evidence:mcp-jump",
  observed_at: "2026-08-12T20:00:01.000Z",
  provenance_valid: true,
  eligible_for_current_turn_reentry: true,
  content_role: "environment_action_observation_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const actorStatusObservation: HelixEnvironmentProbeObservation = {
  schema: HELIX_ENVIRONMENT_PROBE_OBSERVATION_SCHEMA,
  probe_request_ref: "environment_probe_request:mcp-actor-status",
  probe_attempt_ref: "environment_probe_attempt:mcp-actor-status",
  capability_id: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
  capability_version: 1,
  outcome: "succeeded",
  summary: "The selected player is alive and viable.",
  result: { health: 20, air: 300, alive: true, controls_released: true },
  evidence_ref: "environment_probe_evidence:mcp-actor-status",
  observed_at: "2026-08-12T20:00:01.000Z",
  freshness_age_ms: 0,
  provenance_valid: true,
  eligible_for_current_turn_reentry: true,
  late_result_disposition: null,
  content_role: "environment_probe_observation_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const situationObservation = (
  capabilityId: string,
): HelixEnvironmentProbeObservation => ({
  ...actorStatusObservation,
  probe_request_ref: `environment_probe_request:${capabilityId}`,
  probe_attempt_ref: `environment_probe_attempt:${capabilityId}`,
  capability_id: capabilityId,
  summary: `Observed ${capabilityId}.`,
  evidence_ref: `environment_probe_evidence:${capabilityId}`,
});

const connect = async (input: {
  scopes: readonly string[];
  executeAction: HelixEnvironmentActionMcpExecutor;
  executeControl?: HelixEnvironmentActionControlMcpExecutor;
  executeProbe?: HelixEnvironmentProbeMcpExecutor;
  extendAuthority?: HelixEnvironmentActionAuthorityLeaseExtender;
  reasoningRoleService?: HelixEnvironmentReasoningRoleMcpStore;
  temporalStores?: boolean;
}) => {
  const putMcpEvidence = vi.fn(async () => undefined);
  const roomControlService = {
    inspectRoom: vi.fn(async () => ({
      room: { self_participant_id: "participant:mcp-self" },
    })),
  } as unknown as SharedLiveRoomControlService;
  const server = createHelixMcpServer({
    principal: { ...principal(input.scopes),
      ...(input.temporalStores ? { mcpClientRef: "mcp_client:isolated-temporal-test" } : {}) },
    service: {} as HelixAgentApiService,
    roomControlService,
    roomBindingStore: {} as Pick<
      SharedLiveRoomBindingStore,
      | "bindRunToRoom"
      | "claimPendingChatBinding"
      | "revokeRunRoomBindingForOwner"
      | "revokeClaimedRunChatBindingForOwner"
    >,
    deviceCheckService: vi.fn(),
    ...(input.temporalStores ? {
      localSupervisorCoordinationStore: {
        serviceInstanceRef: "service:test", authenticateClient: vi.fn(),
      } as never,
      // This admission-error fixture models a legacy binding, not a durable
      // grant. The real durable identity/repository path is covered separately.
      reasoningTaskBindingStore: { verifyTaskAssociation: vi.fn(),
        resolveDurableBindingContext: vi.fn(() => null) } as never,
    } : {}),
    environmentActionExecutor: input.executeAction,
    environmentActionControlExecutor: input.executeControl,
    environmentProbeExecutor: input.executeProbe,
    environmentActionAuthorityLeaseExtender: input.extendAuthority,
    environmentReasoningRoleService: input.reasoningRoleService,
    mcpEvidenceObservationStore: {
      put: putMcpEvidence,
      get: vi.fn(),
    } as never,
  });
  const client = new Client(
    { name: "helix-minecraft-action-mcp-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    putMcpEvidence,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
};

afterEach(() => {
  resetStagePlayLiveSourceMailboxForTest();
});

describe("Helix MCP Minecraft action boundary", () => {
  it('transports historical workflow results separately from live status', async () => {
    const native = {schema:'helix.environment_action.control_observation.v1',
      control_request_ref:'control:test',workflow_ref:observation.workflow_ref,control_kind:'status',
      outcome:'not_running',summary:'Not running.',affected_workflow_refs:[],workflow_state:null,
      controls_released:false,evidence_refs:[],evidence_ref:'control-evidence:test',
      observed_at:'2026-09-08T12:00:00.000Z',provenance_valid:true,eligible_for_current_turn_reentry:true,
      content_role:'environment_action_control_observation_not_assistant_answer',reentry_required:true,
      answer_authority:false,assistant_answer:false,terminal_eligible:false,raw_content_included:false} as const;
    const connection = await connect({scopes:[HELIX_SHARED_LIVE_ROOM_READ_SCOPE,HELIX_ENVIRONMENT_ACTION_READ_SCOPE],
      executeAction:vi.fn() as HelixEnvironmentActionMcpExecutor,
      executeControl:vi.fn(async()=>({ok:true,status:'completed',summary:'Historical result; no current release claim.',
        observation:native,retained_result:observation})) as HelixEnvironmentActionControlMcpExecutor});
    try {
      const result = await connection.client.callTool({name:'helix_minecraft_workflow_status',
        arguments:{room_id:'shared_realtime_room:mcp',workflow_ref:observation.workflow_ref}});
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ok:true,observation:native,retained_result:observation,
        answer_authority:false,terminal_eligible:false});
    } finally {await connection.close();}
  });
  it("persists the exact fresh situation observation for owner-scoped durable re-entry", async () => {
    const observedAt = new Date(Date.now() - 1_000).toISOString();
    const probeObservation = {
      ...situationObservation(HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY),
      observed_at: observedAt,
      freshness_age_ms: 1_000,
      observation_revision: 17,
    };
    const connection = await connect({
      scopes: [HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_READ_SCOPE],
      executeAction: vi.fn(),
      executeProbe: vi.fn(async () => ({
        ok: true, status: "completed", summary: probeObservation.summary,
        observation: probeObservation,
      })),
    });
    try {
      const result = await connection.client.callTool({
        name: "helix_minecraft_situation_probe",
        arguments: { room_id: ROOM_ID, probe: {
          kind: "perception_snapshot", freshness_requirement_ms: 5_000,
        } },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const envelope = result.structuredContent?.mcp_evidence as HelixMcpEvidenceObservation;
      expect(envelope).toMatchObject({
        payload: probeObservation,
        observed_at: observedAt,
        capability_id: "helix.minecraft.situation.observe_result",
        support_refs: [probeObservation.evidence_ref],
        authority: { answer_authority: false, agent_executable: false,
          assistant_answer: false, terminal_eligible: false, reentry_required: true },
      });
      expect(envelope.freshness.age_ms).toBeGreaterThanOrEqual(1_000);
      expect(Date.parse(envelope.freshness.expires_at!)).toBeLessThanOrEqual(
        Date.parse(observedAt) + 5_000,
      );
      expect(connection.putMcpEvidence).toHaveBeenCalledWith({
        owner: { tenantId: "tenant-mcp-minecraft-action", accountProfileId: "profile-mcp-minecraft-action" },
        toolName: "helix_minecraft_situation_probe", observation: envelope,
      });
    } finally { await connection.close(); }
  });

  it.each([
    ["stale timestamp", { observed_at: "2020-01-01T00:00:00.000Z" }],
    ["future timestamp", { observed_at: "2099-01-01T00:00:00.000Z" }],
    ["stale age", { freshness_age_ms: 5_000 }],
    ["unknown age", { freshness_age_ms: null }],
    ["invalid provenance", { provenance_valid: false }],
    ["ineligible", { eligible_for_current_turn_reentry: false }],
    ["late result", { late_result_disposition: "late_after_timeout" }],
    ["unsuccessful outcome", { outcome: "result_stale" }],
    ["different capability", { capability_id: HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY }],
  ] satisfies Array<[string, Partial<HelixEnvironmentProbeObservation>]>)(
    "does not mint reusable situation evidence for %s", async (_label, overrides) => {
      const probeObservation = {
        ...situationObservation(HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY),
        observed_at: new Date().toISOString(), ...overrides,
      };
      const connection = await connect({
        scopes: [HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_READ_SCOPE],
        executeAction: vi.fn(),
        executeProbe: vi.fn(async () => ({ ok: true, status: "completed",
          summary: probeObservation.summary, observation: probeObservation })),
      });
      try {
        const result = await connection.client.callTool({
          name: "helix_minecraft_situation_probe",
          arguments: { room_id: ROOM_ID, probe: { kind: "perception_snapshot" } },
        });
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        expect(result.structuredContent?.mcp_evidence).toBeNull();
        expect(result.structuredContent?.observation).toEqual(probeObservation);
        expect(connection.putMcpEvidence).not.toHaveBeenCalled();
      } finally { await connection.close(); }
    },
  );

  it("preserves probe truth without a durable reference when evidence storage fails", async () => {
    const probeObservation = {
      ...situationObservation(HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY),
      observed_at: new Date().toISOString(),
    };
    const connection = await connect({
      scopes: [HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_READ_SCOPE],
      executeAction: vi.fn(),
      executeProbe: vi.fn(async () => ({ ok: true, status: "completed",
        summary: probeObservation.summary, observation: probeObservation })),
    });
    connection.putMcpEvidence.mockRejectedValueOnce(new Error("private-storage-detail"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await connection.client.callTool({
        name: "helix_minecraft_situation_probe",
        arguments: { room_id: ROOM_ID, probe: { kind: "perception_snapshot" } },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ ok: true,
        observation: probeObservation, mcp_evidence: null, terminal_eligible: false });
      expect(connection.putMcpEvidence).toHaveBeenCalledTimes(1);
      expect(JSON.stringify([result, warning.mock.calls])).not.toContain("private-storage-detail");
    } finally { warning.mockRestore(); await connection.close(); }
  });

  it("preserves durable admission rejection on the supervisor path without leaking exception text", async () => {
    const admit = vi.spyOn(temporalAdmission, "admitTemporalPlan").mockRejectedValue(
      new EnvironmentDurableGoalError("durable_goal_evidence_identity_mismatch", 409, "private-error-sentinel"));
    const executeAction = vi.fn() as unknown as HelixEnvironmentActionMcpExecutor;
    const connection = await connect({ temporalStores: true, executeAction,
      scopes: [HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE] });
    try {
      const result = await connection.client.callTool({ name: "helix_environment_temporal_plan_submit",
        arguments: temporalSubmissionFixture });
      expect(admit, JSON.stringify(result)).toHaveBeenCalledOnce();
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: "durable_goal_evidence_identity_mismatch",
        retryable: false, execution_authority: false, answer_authority: false, terminal_eligible: false });
      expect(JSON.stringify(result)).not.toContain("private-error-sentinel");
      expect(executeAction).not.toHaveBeenCalled();
      admit.mockRejectedValueOnce(new EnvironmentDurableGoalError("durable_goal_evidence_stale", 409,
        "private-expiry-sentinel", [], [], { evidence_age_ms: 6157, max_age_ms: 5000,
          context_stage_ms: { goal: 100, catalog: 200, perception: 300 }, private_extra: "private-diagnostic-sentinel" } as never));
      const stale = await connection.client.callTool({ name: "helix_environment_temporal_plan_submit",
        arguments: temporalSubmissionFixture });
      expect(stale.isError).toBe(true);
      expect(stale.structuredContent).toMatchObject({ error: "durable_goal_evidence_stale",
        evidence_freshness: { evidence_age_ms: 6157, max_age_ms: 5000,
          context_stage_ms: { goal: 100, catalog: 200, perception: 300 } }, execution_authority: false });
      expect(JSON.stringify(stale)).not.toMatch(/private-(expiry|diagnostic)-sentinel/);
      expect(executeAction).not.toHaveBeenCalled();
      admit.mockRejectedValueOnce(new EnvironmentActionBrokerError(
        "action_policy_denied", 409, "private-broker-error-sentinel"));
      const brokerRejection = await connection.client.callTool({ name: "helix_environment_temporal_plan_submit",
        arguments: temporalSubmissionFixture });
      expect(brokerRejection.isError).toBe(true);
      expect(brokerRejection.structuredContent).toMatchObject({ error: "action_policy_denied",
        retryable: false, execution_authority: false, answer_authority: false, terminal_eligible: false });
      expect(JSON.stringify(brokerRejection)).not.toContain("private-broker-error-sentinel");
      expect(executeAction).not.toHaveBeenCalled();
      admit.mockRejectedValueOnce(new Error("private-unexpected-sentinel"));
      const unexpected = await connection.client.callTool({ name: "helix_environment_temporal_plan_submit",
        arguments: temporalSubmissionFixture });
      expect(unexpected.isError).toBe(true);
      expect(unexpected.structuredContent).toMatchObject({ error: "internal_error" });
      expect(JSON.stringify(unexpected)).not.toContain("private-unexpected-sentinel");
    } finally {
      admit.mockRestore();
      await connection.close();
    }
  });
  it("preserves a typed frontier clock rejection across MCP without dispatch or private error text", async () => {
    const error = new TemporalPlanError("temporal_frontier_resident_clock_expired");
    error.message = "private-error-sentinel";
    const publish = vi.spyOn(temporalFrontier, "publishTemporalPerceptionFrontier").mockRejectedValue(error);
    const executeAction = vi.fn() as HelixEnvironmentActionMcpExecutor;
    const connection = await connect({ scopes: [HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
      HELIX_ENVIRONMENT_ACTION_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE], executeAction });
    try {
      const result = await connection.client.callTool({ name: "helix_environment_temporal_frontier_publish",
        arguments: { room_id: ROOM_ID, goal_id: "goal:test", expected_revision: 1,
          run_id: "run:test", turn_id: "turn:test", prior_turn_id: "turn:prior", probe_request_id: "probe:test" } });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: "temporal_frontier_resident_clock_expired",
        retryable: false, execution_authority: false, answer_authority: false, terminal_eligible: false });
      expect(JSON.stringify(result)).not.toContain("private-error-sentinel");
      expect(executeAction).not.toHaveBeenCalled();
    } finally {
      publish.mockRestore();
      await connection.close();
    }
  });
  it("publishes typed non-terminal tools with separate read and write scopes", async () => {
    const executeAction = vi.fn(async () => ({
      ok: true,
      status: "completed" as const,
      summary: observation.summary,
      observation,
      idempotentReplay: false,
    })) as HelixEnvironmentActionMcpExecutor;
    const executeProbe = vi.fn(async (
      request: Parameters<HelixEnvironmentProbeMcpExecutor>[0],
    ) => {
      const probeObservation =
        request.capabilityId === HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY
          ? actorStatusObservation
          : situationObservation(request.capabilityId);
      return {
        ok: true,
        status: "completed" as const,
        summary: probeObservation.summary,
        observation: probeObservation,
      };
    }) as HelixEnvironmentProbeMcpExecutor;
    const linkCompletedPrincipalExecution = vi.fn(async () => null);
    const reasoningRoleService = {
      recordOutput: vi.fn(),
      inspect: vi.fn(),
      recordPrincipalDisposition: vi.fn(),
      arbitrate: vi.fn(),
      linkCompletedPrincipalExecution,
    } as unknown as HelixEnvironmentReasoningRoleMcpStore;
    const extendAuthority = vi.fn(async (input) => ({
      schema: "helix.environment_action_authority.v1",
      action_authority_id: input.actionAuthorityId,
      environment_binding_id: input.environmentBindingId,
      room_source_binding_id: "room_source_binding:mcp",
      room_id: input.roomId,
      source_id: "source:mcp",
      world_id: "minecraft:local:mcp",
      adapter_profile_id: "game.minecraft.player.fabric.v1",
      domain_adapter: "minecraft.fabric_mod.v1",
      participant_id: "participant:mcp-self",
      subject_binding_id: "subject_binding:mcp",
      allowed_capability_ids: [HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY],
      autonomy_mode: "approved_capabilities",
      manual_override_policy: "pause",
      status: "active",
      policy_version: 1,
      issued_at: "2026-08-12T20:00:00.000Z",
      expires_at: input.expiresAt,
      revoked_at: null,
      credential_included: false,
      content_role: "environment_action_authority_not_assistant_answer",
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    })) as HelixEnvironmentActionAuthorityLeaseExtender;
    const connection = await connect({
      scopes: [
        HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
        HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
        HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE,
      ],
      executeAction,
      executeProbe,
      extendAuthority,
      reasoningRoleService,
    });
    try {
      const catalog = await connection.client.listTools();
      const action = catalog.tools.find(
        (candidate) => candidate.name === "helix_minecraft_player_action",
      ) as (typeof catalog.tools)[number] & { _meta?: Record<string, unknown> };
      const actorStatus = catalog.tools.find(
        (candidate) => candidate.name === "helix_minecraft_actor_status",
      ) as (typeof catalog.tools)[number] & { _meta?: Record<string, unknown> };
      const situationProbe = catalog.tools.find(
        (candidate) => candidate.name === "helix_minecraft_situation_probe",
      ) as (typeof catalog.tools)[number] & { _meta?: Record<string, unknown> };
      const semanticWake = catalog.tools.find(
        (candidate) => candidate.name === "helix_environment_semantic_wake_read",
      ) as (typeof catalog.tools)[number] & { _meta?: Record<string, unknown> };
      const status = catalog.tools.find(
        (candidate) => candidate.name === "helix_minecraft_workflow_status",
      ) as (typeof catalog.tools)[number] & { _meta?: Record<string, unknown> };
      const control = catalog.tools.find(
        (candidate) => candidate.name === "helix_minecraft_workflow_control",
      );
      expect(action).toBeDefined();
      expect(actorStatus).toBeDefined();
      expect(situationProbe).toBeDefined();
      expect(semanticWake).toBeDefined();
      expect(status).toBeDefined();
      expect(control).toBeDefined();
      expect(action.annotations).toMatchObject({
        readOnlyHint: false,
        idempotentHint: true,
      });
      expect(actorStatus.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
      expect(actorStatus.inputSchema).toMatchObject({
        properties: {
          include_navigation_collision: { type: "boolean" },
        },
      });
      expect(situationProbe.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
      expect(situationProbe.description).toContain(
        "never proves a navigable or safe path",
      );
      expect(actorStatus._meta?.securitySchemes).toEqual([{
        type: "oauth2",
        scopes: [
          HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
          HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
        ],
      }]);
      expect(action._meta?.securitySchemes).toEqual([{
        type: "oauth2",
        scopes: [
          HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
          HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE,
        ],
      }]);
      expect(status._meta?.securitySchemes).toEqual([{
        type: "oauth2",
        scopes: [
          HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
          HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
        ],
      }]);

      const extendedExpiry = new Date(Date.now() + 60 * 60_000).toISOString();
      const extendedAuthority = await connection.client.callTool({
        name: "helix_environment_action_authority_extend",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: "environment:mcp",
          action_authority_id: "environment_action_authority:mcp",
          expires_at: extendedExpiry,
        },
      });
      expect(extendedAuthority.isError, JSON.stringify(extendedAuthority)).not.toBe(true);
      expect(extendedAuthority.structuredContent).toMatchObject({
        operation: "environment.action_authority.extend",
        authority: {
          action_authority_id: "environment_action_authority:mcp",
          expires_at: extendedExpiry,
          credential_included: false,
        },
        reentry_required: true,
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(semanticWake.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
      expect(semanticWake._meta?.securitySchemes).toEqual([{
        type: "oauth2",
        scopes: [
          HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
          HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
        ],
      }]);

      enqueueStagePlayLiveSourceMailItem({
        threadId: `helix-ask:room:${ROOM_ID}`,
        roomId: ROOM_ID,
        environmentId: "room_source_binding:mcp-wake",
        sourceId: "source:mcp-wake",
        sourceKind: "minecraft_world_event",
        environmentIdentity: {
          producerPlane: "player_embodiment",
          roomSourceBindingId: "room_source_binding:mcp-wake",
          worldId: "minecraft:local:mcp-wake",
          producerEpochRef: "environment_action_epoch:mcp-wake",
          subjectRef: "environment_subject_binding:mcp-wake",
          participantId: "participant:mcp-self",
          selectedPlayerRef: "environment_subject_binding:mcp-wake",
          selectedPlayerNativeId: "player-native:mcp-self",
          observationRevision: 7,
          digestId: "environment_situation_digest:mcp-wake",
          digestHash: "sha256:mcp-wake",
          provenanceValid: true,
        },
        evidenceRef: "environment_situation_digest:mcp-wake",
        summaryText: JSON.stringify({
          schema: "helix.minecraft_semantic_wake_evidence.v1",
          semantic_state: { active_workflow: null },
          answer_authority: false,
        }),
        summaryPreview: "Minecraft semantic change: workflow.succeeded.",
        createdAt: new Date().toISOString(),
      });
      enqueueStagePlayLiveSourceMailItem({
        threadId: `helix-ask:room:${ROOM_ID}`,
        roomId: ROOM_ID,
        environmentId: "room_source_binding:mcp-other",
        sourceId: "source:mcp-other",
        sourceKind: "minecraft_world_event",
        environmentIdentity: {
          producerPlane: "player_embodiment",
          roomSourceBindingId: "room_source_binding:mcp-other",
          worldId: "minecraft:local:mcp-other",
          producerEpochRef: "environment_action_epoch:mcp-other",
          subjectRef: "environment_subject_binding:mcp-other",
          participantId: "participant:mcp-other",
          selectedPlayerRef: "environment_subject_binding:mcp-other",
          selectedPlayerNativeId: "player-native:mcp-other",
          observationRevision: 8,
          digestId: "environment_situation_digest:mcp-other",
          digestHash: "sha256:mcp-other",
          provenanceValid: true,
        },
        evidenceRef: "environment_situation_digest:mcp-other",
        summaryText: "{}",
        createdAt: new Date().toISOString(),
      });

      const semanticWakeResult = await connection.client.callTool({
        name: "helix_environment_semantic_wake_read",
        arguments: { room_id: ROOM_ID, after_observation_revision: 6 },
      });
      expect(semanticWakeResult.isError, JSON.stringify(semanticWakeResult)).not.toBe(true);
      expect(semanticWakeResult.structuredContent).toMatchObject({
        operation: "environment.semantic_wake.read",
        room_id: ROOM_ID,
        items: [{
          digest_id: "environment_situation_digest:mcp-wake",
          observation_revision: 7,
          participant_id: "participant:mcp-self",
          freshness: "fresh",
        }],
        reentry_required: true,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      });

      const actorStatusResult = await connection.client.callTool({
        name: "helix_minecraft_actor_status",
        arguments: { room_id: ROOM_ID },
      });
      expect(actorStatusResult.isError, JSON.stringify(actorStatusResult)).not.toBe(true);
      expect(actorStatusResult.structuredContent).toMatchObject({
        operation: "minecraft.actor.status.read",
        room_id: ROOM_ID,
        ok: true,
        status: "completed",
        observation: {
          capability_id: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
          evidence_ref: "environment_probe_evidence:mcp-actor-status",
          answer_authority: false,
          assistant_answer: false,
          terminal_eligible: false,
        },
        perception_snapshot_compatibility: {
          mode: "actor_status_catalog_compatibility_v1",
          catalog_refresh_required: true,
          prior_turn_id: expect.stringMatching(/^mcp_environment_perception_compat_turn:/u),
          ok: true,
          status: "completed",
          observation: {
            capability_id: HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY,
            answer_authority: false,
            assistant_answer: false,
            terminal_eligible: false,
          },
        },
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      });
      expect(executeProbe).toHaveBeenCalledWith(expect.objectContaining({
        capabilityId: HELIX_MINECRAFT_ACTOR_STATUS_READ_CAPABILITY,
        arguments: { freshness_requirement_ms: 30_000 },
        accountContext: expect.objectContaining({
          profile_id: "profile-mcp-minecraft-action",
        }),
        conversationThreadId: `helix-ask:room:${ROOM_ID}`,
        turnId: expect.stringMatching(/^mcp_environment_probe_turn:/),
        toolCallId: expect.stringMatching(/^mcp_environment_probe_tool_call:/),
        providerExecutionId: expect.stringMatching(/^mcp_environment_probe_execution:/),
      }));
      expect(executeProbe).toHaveBeenCalledWith(expect.objectContaining({
        capabilityId: HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY,
        arguments: {
          horizontal_radius: 7,
          vertical_radius: 8,
          freshness_requirement_ms: 30_000,
        },
        accountContext: expect.objectContaining({
          profile_id: "profile-mcp-minecraft-action",
        }),
        conversationThreadId: `helix-ask:room:${ROOM_ID}`,
        turnId: expect.stringMatching(/^mcp_environment_perception_compat_turn:/),
        toolCallId:
          expect.stringMatching(/^mcp_environment_perception_compat_tool_call:/),
        providerExecutionId:
          expect.stringMatching(/^mcp_environment_perception_compat_execution:/),
      }));

      const actorStatusWithUnsupportedSelector = await connection.client.callTool({
        name: "helix_minecraft_actor_status",
        arguments: {
          room_id: ROOM_ID,
          environment_label: "a label that the frozen actor-status schema cannot admit",
        },
      });
      expect(actorStatusWithUnsupportedSelector.isError).toBe(true);
      expect(executeProbe).toHaveBeenCalledTimes(2);

      const actorStatusWithNavigationCollision = await connection.client.callTool({
        name: "helix_minecraft_actor_status",
        arguments: { room_id: ROOM_ID, include_navigation_collision: true },
      });
      expect(actorStatusWithNavigationCollision.isError).not.toBe(true);
      expect(actorStatusWithNavigationCollision.structuredContent).toMatchObject({
        perception_snapshot_compatibility: {
          ok: true,
          observation: {
            capability_id: HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY,
            answer_authority: false,
            terminal_eligible: false,
          },
        },
      });
      expect(executeProbe).toHaveBeenLastCalledWith(expect.objectContaining({
        capabilityId: HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY,
        arguments: {
          horizontal_radius: 7,
          vertical_radius: 8,
          freshness_requirement_ms: 30_000,
          include_navigation_collision: true,
        },
      }));
      expect(executeProbe).toHaveBeenCalledTimes(4);

      const actorStatusWithInvalidNavigationCollision = await connection.client.callTool({
        name: "helix_minecraft_actor_status",
        arguments: { room_id: ROOM_ID, include_navigation_collision: "true" },
      });
      expect(actorStatusWithInvalidNavigationCollision.isError).toBe(true);
      expect(executeProbe).toHaveBeenCalledTimes(4);

      const situationCases = [
        {
          probe: { kind: "inventory" },
          capabilityId: HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
          arguments: {},
        },
        {
          probe: { kind: "nearby_entities", freshness_requirement_ms: 5_000 },
          capabilityId: HELIX_MINECRAFT_NEARBY_ENTITIES_LIST_CAPABILITY,
          arguments: { freshness_requirement_ms: 5_000 },
        },
        {
          probe: { kind: "hazards" },
          capabilityId: HELIX_MINECRAFT_HAZARDS_SCAN_CAPABILITY,
          arguments: {},
        },
        {
          probe: { kind: "local_map" },
          capabilityId: HELIX_MINECRAFT_LOCAL_MAP_INSPECT_CAPABILITY,
          arguments: {},
        },
        {
          probe: {
            kind: "spatial_region",
            horizontal_radius: 5,
            vertical_radius: 8,
            purpose: "movement_safety",
          },
          capabilityId: HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
          arguments: {
            horizontal_radius: 5,
            vertical_radius: 8,
            purpose: "movement_safety",
          },
        },
        {
          probe: {
            kind: "line_of_sight",
            position: { x: 12.5, y: 64, z: -3.25 },
          },
          capabilityId: HELIX_MINECRAFT_LINE_OF_SIGHT_CHECK_CAPABILITY,
          arguments: {
            target: "position",
            position: { x: 12.5, y: 64, z: -3.25 },
          },
        },
        {
          probe: {
            kind: "reachability",
            position: { x: 13, y: 64, z: -3 },
          },
          capabilityId: HELIX_MINECRAFT_REACHABILITY_CHECK_CAPABILITY,
          arguments: {
            target: "position",
            position: { x: 13, y: 64, z: -3 },
          },
        },
        {
          probe: {
            kind: "perception_snapshot",
            horizontal_radius: 4,
            vertical_radius: 8,
            include_navigation_collision: true,
          },
          capabilityId: HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY,
          arguments: {
            horizontal_radius: 4,
            vertical_radius: 8,
            include_navigation_collision: true,
          },
        },
      ] as const;
      for (const situationCase of situationCases) {
        const situationResult = await connection.client.callTool({
          name: "helix_minecraft_situation_probe",
          arguments: { room_id: ROOM_ID, probe: situationCase.probe },
        });
        expect(situationResult.isError, JSON.stringify(situationResult)).not.toBe(true);
        expect(situationResult.structuredContent).toMatchObject({
          operation: "minecraft.situation.probe",
          probe_kind: situationCase.probe.kind,
          room_id: ROOM_ID,
          ok: true,
          observation: {
            capability_id: situationCase.capabilityId,
            answer_authority: false,
            assistant_answer: false,
            terminal_eligible: false,
          },
          answer_authority: false,
          assistant_answer: false,
          terminal_eligible: false,
        });
        expect(executeProbe).toHaveBeenLastCalledWith(expect.objectContaining({
          capabilityId: situationCase.capabilityId,
          turnId: situationResult.structuredContent?.prior_turn_id,
          arguments: situationCase.arguments,
          accountContext: expect.objectContaining({
            profile_id: "profile-mcp-minecraft-action",
          }),
          conversationThreadId: `helix-ask:room:${ROOM_ID}`,
        }));
        expect(situationResult.structuredContent?.prior_turn_id).toMatch(
          /^mcp_environment_probe_turn:[0-9a-f-]+$/u,
        );
      }

      const missingPosition = await connection.client.callTool({
        name: "helix_minecraft_situation_probe",
        arguments: {
          room_id: ROOM_ID,
          probe: { kind: "line_of_sight" },
        },
      });
      expect(missingPosition.isError).toBe(true);
      expect(executeProbe).toHaveBeenCalledTimes(12);

      const result = await connection.client.callTool({
        name: "helix_minecraft_player_action",
        arguments: {
          room_id: ROOM_ID,
          idempotency_key: "mcp-minecraft-jump-once",
          principal_turn_id: "g6-principal-turn",
          action: { action_kind: "jump", count: 1 },
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        operation: "minecraft.player.action",
        room_id: ROOM_ID,
        ok: true,
        status: "completed",
        observation: {
          workflow_ref: "environment_action_workflow:mcp-jump",
          answer_authority: false,
          assistant_answer: false,
          terminal_eligible: false,
        },
        mcp_evidence: {
          schema: "helix.mcp_evidence_observation.v1",
          capability_id: "helix.minecraft.player_action.observe_result",
          payload_schema: HELIX_ENVIRONMENT_ACTION_OBSERVATION_SCHEMA,
          authority: {
            agent_executable: false,
            answer_authority: false,
            assistant_answer: false,
            terminal_eligible: false,
            reentry_required: true,
          },
        },
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      });
      expect(connection.putMcpEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "helix_minecraft_player_action",
          observation: expect.objectContaining({
            capability_id: "helix.minecraft.player_action.observe_result",
          }),
        }),
      );
      expect(executeAction).toHaveBeenCalledWith(expect.objectContaining({
        capabilityId: HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY,
        arguments: { count: 1 },
        accountContext: expect.objectContaining({
          profile_id: "profile-mcp-minecraft-action",
        }),
        conversationThreadId: `helix-ask:room:${ROOM_ID}`,
        turnId: "g6-principal-turn",
        toolCallId: expect.stringMatching(/^mcp_environment_tool_call:/),
        providerExecutionId: expect.stringMatching(/^mcp_environment_execution:/),
      }));
      expect(linkCompletedPrincipalExecution).toHaveBeenCalledWith({
        profileId: "profile-mcp-minecraft-action",
        participantId: "participant:mcp-self",
        roomId: ROOM_ID,
        principalTurnId: "g6-principal-turn",
        capabilityId: HELIX_MINECRAFT_PLAYER_JUMP_CAPABILITY,
        capabilityArguments: { action_kind: "jump", count: 1 },
        environmentActionRequestId: observation.action_request_ref,
        environmentActionResultRef: observation.evidence_ref,
        reentryObservationRef: observation.evidence_ref,
      });

      const attackResult = await connection.client.callTool({
        name: "helix_minecraft_player_action",
        arguments: {
          room_id: ROOM_ID,
          idempotency_key: "mcp-minecraft-attack-once",
          action: {
            action_kind: "attack",
            target_ref: "target:mcp-exact-zombie",
            target_entity_type_id: "minecraft:zombie",
            target_classification: "hostile",
            max_acquisition_distance: 16,
            require_line_of_sight: true,
            minimum_attack_cooldown: 0.9,
            max_attack_pulses: 1,
            max_duration_ms: 1_000,
            stop_below_health: 10,
            friendly_fire: false,
          },
        },
      });
      expect(attackResult.isError, JSON.stringify(attackResult)).not.toBe(true);
      expect(executeAction).toHaveBeenLastCalledWith(
        expect.objectContaining({
          capabilityId: HELIX_MINECRAFT_PLAYER_COMBAT_ATTACK_CAPABILITY,
          arguments: expect.objectContaining({
            target_ref: "target:mcp-exact-zombie",
          }),
        }),
      );

      const guardedAction = {
        room_id: ROOM_ID,
        perception_semantic_fingerprint: `sha256:${"a".repeat(64)}`,
        action: { action_kind: "jump", count: 1 },
      };
      const firstGuarded = await connection.client.callTool({
        name: "helix_minecraft_player_action",
        arguments: {
          ...guardedAction,
          idempotency_key: "caller-key-one",
        },
      });
      const firstGuardedExecution = executeAction.mock.calls.at(-1)?.[0];
      const secondGuarded = await connection.client.callTool({
        name: "helix_minecraft_player_action",
        arguments: {
          ...guardedAction,
          idempotency_key: "caller-key-two",
        },
      });
      const secondGuardedExecution = executeAction.mock.calls.at(-1)?.[0];
      expect(firstGuarded.isError, JSON.stringify(firstGuarded)).not.toBe(true);
      expect(secondGuarded.isError, JSON.stringify(secondGuarded)).not.toBe(true);
      expect(firstGuardedExecution?.providerExecutionId).toBe(
        secondGuardedExecution?.providerExecutionId,
      );
      expect(firstGuardedExecution?.toolCallId).not.toBe(
        secondGuardedExecution?.toolCallId,
      );

      const lookResult = await connection.client.callTool({
        name: "helix_minecraft_player_action",
        arguments: {
          room_id: ROOM_ID,
          idempotency_key: "mcp-minecraft-retain-focus",
          action: {
            action_kind: "look_at",
            target: { target_kind: "current_focus" },
            max_turn_degrees_per_tick: 1,
          },
        },
      });
      expect(lookResult.isError, JSON.stringify(lookResult)).not.toBe(true);
      expect(executeAction).toHaveBeenLastCalledWith(expect.objectContaining({
        capabilityId: HELIX_MINECRAFT_PLAYER_LOOK_CAPABILITY,
        arguments: {
          target_kind: "current_focus",
          max_turn_degrees_per_tick: 1,
        },
      }));

      const trackResult = await connection.client.callTool({
        name: "helix_minecraft_player_action",
        arguments: {
          room_id: ROOM_ID,
          idempotency_key: "mcp-minecraft-track-nearest-zombie",
          action: {
            action_kind: "track_target",
            target: {
              target_kind: "entity_type",
              entity_type_id: "minecraft:zombie",
              selection: "nearest",
            },
            aim_point: "center",
            max_acquisition_distance: 16,
            max_duration_ms: 15_000,
            max_turn_degrees_per_tick: 20,
            max_angular_acceleration_degrees_per_tick_squared: 4,
            prediction_ticks: 2,
            deadband_degrees: 0.5,
            reacquire_ticks: 10,
            require_line_of_sight: true,
            stop_below_health: 6,
          },
        },
      });
      expect(trackResult.isError, JSON.stringify(trackResult)).not.toBe(true);
      expect(executeAction).toHaveBeenLastCalledWith(expect.objectContaining({
        capabilityId: "com.casimirbot.minecraft.player.camera.track",
        arguments: expect.objectContaining({
          target_kind: "entity_type",
          entity_type_id: "minecraft:zombie",
          aim_point: "center",
        }),
      }));
      expect(
        executeAction.mock.calls.at(-1)?.[0]?.arguments,
      ).not.toHaveProperty("selection");

      const reactiveResult = await connection.client.callTool({
        name: "helix_minecraft_player_action",
        arguments: {
          room_id: ROOM_ID,
          idempotency_key: "mcp-minecraft-reactive-jump",
          action: {
            action_kind: "execute_reactive_program",
            program_schema: HELIX_MINECRAFT_REACTIVE_PROGRAM_SCHEMA,
            program_id: "program:mcp-reactive-jump",
            ruleset: "survival_tas",
            execution_plane: "player_embodiment",
            scheduler_engine: "native_fabric_concurrent",
            max_total_ticks: 80,
            completion_policy: {
              mode: "all_required",
              cancel_remaining_on_settle: true,
            },
            mutation_scope: {
              world_mutation_allowed: false,
              max_block_mutations: 0,
              max_inventory_transfers: 0,
              allowed_block_ids: [],
              allowed_regions: [],
              combat_allowed: false,
            },
            lanes: [{
              lane_id: "lane:jump",
              lane_kind: "locomotion",
              priority: 50,
              required: true,
              activation: "immediate",
              resource_ceiling: ["locomotion"],
              start_node_id: "node:jump",
              nodes: [
                {
                  node_id: "node:jump",
                  node_kind: "action",
                  earliest_tick: 0,
                  timeout_ticks: 40,
                  action: { action_kind: "jump", count: 1 },
                  on_success: "node:done",
                  on_failure: "node:failed",
                  on_timeout: "node:failed",
                },
                {
                  node_id: "node:done",
                  node_kind: "terminal",
                  terminal_outcome: "succeeded",
                  reason_code: "jump_done",
                },
                {
                  node_id: "node:failed",
                  node_kind: "terminal",
                  terminal_outcome: "failed",
                  reason_code: "jump_failed",
                },
              ],
            }],
            races: [],
            interrupts: [],
          },
        },
      });
      expect(reactiveResult.isError, JSON.stringify(reactiveResult)).not.toBe(true);
      expect(executeAction).toHaveBeenLastCalledWith(expect.objectContaining({
        capabilityId: HELIX_MINECRAFT_PLAYER_EXECUTE_REACTIVE_PROGRAM_CAPABILITY,
        arguments: expect.objectContaining({
          program_id: "program:mcp-reactive-jump",
          scheduler_engine: "native_fabric_concurrent",
        }),
      }));
    } finally {
      await connection.close();
    }
  });

  it("rejects action execution before the broker when the write scope is absent", async () => {
    const executeAction = vi.fn() as unknown as HelixEnvironmentActionMcpExecutor;
    const connection = await connect({
      scopes: [HELIX_SHARED_LIVE_ROOM_READ_SCOPE],
      executeAction,
    });
    try {
      const result = await connection.client.callTool({
        name: "helix_minecraft_player_action",
        arguments: {
          room_id: ROOM_ID,
          idempotency_key: "mcp-minecraft-scope-denial",
          action: { action_kind: "jump", count: 1 },
        },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: "insufficient_scope",
      });
      const challenge = (
        result as unknown as { _meta?: { "mcp/www_authenticate"?: string[] } }
      )._meta?.["mcp/www_authenticate"]?.[0] ?? "";
      expect(challenge).toContain(HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE);
      expect(executeAction).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });
});
