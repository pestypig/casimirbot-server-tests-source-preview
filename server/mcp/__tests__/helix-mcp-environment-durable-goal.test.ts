import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import * as frontierPublisher from "../../services/environment-connectors/temporal-plans/temporal-frontier-publisher";
import * as temporalAdmission from "../../services/environment-connectors/temporal-plans/temporal-plan-admission";
import { buildHelixEnvironmentTemporalPlan } from "@shared/helix-environment-time";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { buildHelixSharedRealtimeRoomsExperimentPolicy } from "@shared/helix-account-session";
import { HELIX_SHARED_LIVE_ROOM_READ_SCOPE } from "@shared/contracts/helix-shared-live-room-agent.v1";
import { HELIX_AGENT_RUN_READ_SCOPE } from "@shared/contracts/helix-agent-api.v1";
import { HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE } from "@shared/helix-environment-action";
import {
  HELIX_ENVIRONMENT_DURABLE_GOAL_PROJECTION_SCHEMA,
  helixEnvironmentDurableGoalSha256,
  type HelixEnvironmentDurableGoalProjection,
} from "@shared/helix-environment-durable-goal";
import {
  createHelixMcpServer,
  type HelixEnvironmentDurableGoalMcpStore,
} from "../helix-mcp-server";
import type { HelixAgentApiService } from "../../services/helix-agent-api/service";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import type { SharedLiveRoomBindingStore } from "../../services/shared-live-room-control/binding-store";
import type { SharedLiveRoomControlService } from "../../services/shared-live-room-control/service";

const ROOM_ID = "shared_realtime_room:durable-goal-mcp";
const PARTICIPANT_ID = "shared_realtime_room_participant:durable-goal-mcp";

const principal = (scopes: readonly string[]): HelixAgentApiPrincipal => {
  const policy = buildHelixSharedRealtimeRoomsExperimentPolicy("developer");
  const now = "2026-08-22T12:00:00.000Z";
  return {
    tenantId: "tenant:durable-goal-mcp",
    issuer: "https://issuer.example",
    subjectId: "subject:durable-goal-mcp",
    accountProfileId: "profile:durable-goal-mcp",
    accountType: "developer",
    scopes: new Set(scopes),
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    accountContext: {
      session_id: "external-oauth:durable-goal-mcp",
      profile_id: "profile:durable-goal-mcp",
      trusted_account_session: true,
      account_session: {
        schema: "helix.account_session.v1",
        session_id: "external-oauth:durable-goal-mcp",
        profile: {
          profile_id: "profile:durable-goal-mcp",
          display_name: "Durable Goal MCP",
          email: null,
          auth_mode: "web_auth",
          account_type: "developer",
          provider: "external_oauth",
          provider_alias: "test",
          provider_subject: "subject:durable-goal-mcp",
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

const objective = {
  objective_text: "Earn one survival advancement and remain viable.",
  goal_kind: "custom_survival" as const,
  domain: "minecraft" as const,
  game_version: "1.21.8",
  mechanics_collection_ref: null,
  milestones: [{
    milestone_id: "milestone:first",
    description: "Earn the first advancement.",
    dependency_milestone_ids: [],
    required_postcondition_ids: ["postcondition:advancement", "postcondition:viable"],
  }],
};

const projection: HelixEnvironmentDurableGoalProjection = {
  schema: HELIX_ENVIRONMENT_DURABLE_GOAL_PROJECTION_SCHEMA,
  goal_id: "environment_durable_goal:mcp",
  revision: 1,
  latest_event_hash: `sha256:${"a".repeat(64)}`,
  status: "active",
  objective,
  identity: {
    owner_profile_id: "profile:durable-goal-mcp",
    host_ref: "environment_device:one",
    connector_installation_id: "installation:one",
    device_id: "device:one",
    environment_binding_id: "environment:one",
    room_source_binding_id: "room_source_binding:one",
    room_id: ROOM_ID,
    goal_owner_participant_id: PARTICIPANT_ID,
    participant_id: PARTICIPANT_ID,
    authority_participant_id: PARTICIPANT_ID,
    subject_binding_id: "subject_binding:one",
    subject_native_id: "player:one",
    source_id: "source:one",
    world_id: "minecraft:overworld",
    producer_epoch_ref: "epoch:one",
    action_authority_id: "authority:one",
    authority_policy_version: 1,
    authority_expires_at: "2099-01-01T00:00:00.000Z",
    run_id: null,
    turn_id: "turn:one",
  },
  active_milestone_id: null,
  milestones: [{
    milestone_id: "milestone:first",
    description: "Earn the first advancement.",
    status: "candidate",
    required_postcondition_ids: ["postcondition:advancement", "postcondition:viable"],
    completed_postcondition_ids: [],
  }],
  recent_attempts: [],
  attempt_count: 0,
  latest_checkpoint: null,
  recovery: { required: false, reason: null, rebound_event_id: null },
  consumed_semantic_wake_refs: [],
  event_refs: ["environment_durable_goal_event:one"],
  content_role: "environment_durable_goal_projection_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const connect = async (scopes: readonly string[], exactTask = false, includeBindingStore = true,
  probeExecutor?: ReturnType<typeof vi.fn>) => {
  const goalStore = {
    create: vi.fn(async () => projection),
    inspect: vi.fn(async () => projection),
    append: vi.fn(async () => ({ ...projection, revision: 2 })),
  } satisfies HelixEnvironmentDurableGoalMcpStore;
  const inspectRoom = vi.fn(async () => ({ room: { self_participant_id: PARTICIPANT_ID } }));
  const authenticateClient = vi.fn();
  const verifyTaskAssociation = vi.fn();
  const listRunPreparationCandidates = vi.fn(async (_input: { runId?: string }) => [
    { runId: "test:run_id" },
  ]);
  const server = createHelixMcpServer({
    principal: { ...principal(scopes), mcpClientRef: "mcp_client:test" },
    ...(exactTask ? {
      localSupervisorCoordinationStore: { serviceInstanceRef: "service:test", authenticateClient } as never,
      ...(includeBindingStore ? { reasoningTaskBindingStore: { verifyTaskAssociation,
        resolveDurableBindingContext: vi.fn().mockReturnValue(null) } as never } : {}),
    } : {}),
    service: {} as HelixAgentApiService,
    roomControlService: { inspectRoom } as unknown as SharedLiveRoomControlService,
    roomBindingStore: { listRunPreparationCandidates } as unknown as Pick<SharedLiveRoomBindingStore, "bindRunToRoom" | "claimPendingChatBinding" | "revokeRunRoomBindingForOwner" | "revokeClaimedRunChatBindingForOwner">,
    deviceCheckService: vi.fn(),
    environmentDurableGoalService: goalStore,
    ...(probeExecutor ? { environmentProbeExecutor: probeExecutor as never } : {}),
  });
  const client = new Client({ name: "durable-goal-mcp-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, goalStore, inspectRoom, authenticateClient, verifyTaskAssociation,
    listRunPreparationCandidates, close: async () => { await client.close(); await server.close(); } };
};

const temporalArgs = () => ({
  client_continuation_ref: "continuation:test", reasoning_binding_id: "binding:test", binding_epoch: 1,
  helix_conversation_id: "chat:test", mission_id: "mission:test", goal_id: "goal:test", expected_revision: 1,
  frontier_id: "frontier:test", probe_request_id: "probe:test", prior_turn_id: "turn:prior",
  request: {
    schema: "helix.environment_action.request.v1",
    ...Object.fromEntries(["action_request_id", "workflow_id", "action_authority_id", "environment_binding_id",
      "source_id", "world_id", "subject_binding_id", "subject_native_id", "run_id", "turn_id",
      "provider_execution_id", "tool_call_id", "catalog_snapshot_id", "capability_id"].map(key => [key, `test:${key}`])),
    room_id: ROOM_ID, capability_version: 1, action_kind: "execute_sequence", effect_class: "player_motion",
    workflow_mode: "long_running", requested_control_engine: "native_fabric", preconditions: [],
    postconditions: [{ condition_id: "post:test", condition_kind: "stopped", required: true, parameters: {} }],
    idempotency_key: "idempotency:test", confirmation_state: "not_required", approval_ref: null,
    created_at: "2026-09-05T12:00:00Z", deadline_at: "2026-09-05T12:01:00Z",
    constraints: { max_duration_ms: 60000, max_distance_blocks: 10, max_block_mutations: 0, max_inventory_transfers: 0,
      manual_override_policy: "cancel", require_postcondition_verification: true, world_mutation_allowed: false,
      combat_allowed: false, host_access_allowed: false, automatic_replay_allowed: false },
    answer_authority: false, assistant_answer: false, terminal_eligible: false, raw_content_included: false,
  },
  mutation_scope: { max_block_mutations: 0, max_inventory_transfers: 0, world_mutation_allowed: false,
    allowed_block_ids: [], allowed_regions: [], combat_allowed: false },
  plan: buildHelixEnvironmentTemporalPlan({
    plan_id: "plan:test", previous_plan_id: null, previous_plan_hash: null,
    identity: { environment_id: "env:test", source_id: "source:test", subject_id: "subject:test", producer_epoch: "epoch:test",
      authority_id: "authority:test", authority_revision: 1, goal_id: "goal:test", goal_revision: 1, observation_revision: 1, affordance_revision: 1 },
    clocks: { environment: { kind: "tick", sequence: 10, resolution_unit: "minecraft_tick", nominal_units_per_second: 20 },
      monotonic: { origin_id: "origin:test", elapsed_ms: 100 }, audit_at: "2026-09-05T12:00:00Z" },
    adapter_id: "minecraft.fabric_client", adapter_version: "1", compiler_version: "compiler:1", resident_executor_version: "native:1",
    start_node_id: "walk", maximum_total_units: 80, monotonic_deadline_elapsed_ms: 1000,
    watermarks: { decision_unit: 40, stop_unit: 60, committed_through_unit: 80, stabilization_node_id: "success" },
    lanes: [{ lane_id: "move", priority: 1, resource_keys: ["locomotion"] }], effect_ceiling: {},
    nodes: [{ kind: "action", node_id: "walk", lane_id: "move", capability_id: "com.casimirbot.minecraft.player.walk", capability_version: "1",
      arguments: { action_kind: "walk", direction: "forward", duration_ms: 100, sprint: false }, required_resources: ["locomotion"],
      timing: { earliest_start_unit: 0, latest_start_unit: 10, maximum_duration_units: 20 }, preconditions: [],
      completion_conditions: [{ kind: "adapter_condition", condition_id: "minecraft.player_grounded", arguments: { expected: true } }],
      abort_guards: [], effect_budget: {}, on_success_node_id: "success", on_failure_node_id: "failure", on_timeout_node_id: "failure" },
      { kind: "terminal", node_id: "success", outcome: "succeeded", reason_code: "done" },
      { kind: "terminal", node_id: "failure", outcome: "failed", reason_code: "failed" }],
  }),
});

describe("Helix MCP durable environment goal", () => {
  it("lists the exact-task Responses shadow tool but cannot spend without a native broker", async () => {
    vi.stubEnv("HELIX_NATIVE_OPENAI_RESPONSES_ACTION_BROKER_ENABLED", "0");
    const connection = await connect([HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
      HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE], true);
    try {
      expect((await connection.client.listTools()).tools.map(tool => tool.name))
        .toContain("helix_environment_responses_action_shadow_choose");
      expect((await connection.client.listTools()).tools.map(tool => tool.name))
        .toContain("helix_environment_responses_baseline_shadow_choose");
      const original = temporalArgs();
      const result = await connection.client.callTool({
        name: "helix_environment_responses_action_shadow_choose",
        arguments: { client_continuation_ref: original.client_continuation_ref,
          reasoning_binding_id: original.reasoning_binding_id,
          binding_epoch: original.binding_epoch,
          helix_conversation_id: original.helix_conversation_id,
          mission_id: original.mission_id, goal_id: original.goal_id,
          expected_revision: original.expected_revision,
          frontier_id: original.frontier_id, probe_request_id: original.probe_request_id,
          prior_turn_id: original.prior_turn_id, room_id: ROOM_ID,
          run_id: "test:run_id", turn_id: "turn:one",
          candidates: [{ candidate_id: "advance:test", action_code: "walk_to_waypoint",
            target_ref: "waypoint:test", estimated_units: 10,
            plan: original.plan, mutation_scope: original.mutation_scope }],
        },
      });
      expect(result.structuredContent).toMatchObject({ ok: false,
        reason: "responses_action_native_broker_unavailable", execution_authority: false });
      const baseline = await connection.client.callTool({
        name: "helix_environment_responses_baseline_shadow_choose",
        arguments: { client_continuation_ref: original.client_continuation_ref,
          reasoning_binding_id: original.reasoning_binding_id,
          binding_epoch: original.binding_epoch,
          helix_conversation_id: original.helix_conversation_id,
          mission_id: original.mission_id, goal_id: original.goal_id,
          expected_revision: original.expected_revision,
          room_id: ROOM_ID, run_id: "test:run_id", turn_id: "turn:one" },
      });
      expect(baseline.structuredContent).toMatchObject({ ok: false,
        reason: "responses_action_native_broker_unavailable", action_performed: false });
      expect(connection.authenticateClient).not.toHaveBeenCalled();
      expect(connection.verifyTaskAssociation).not.toHaveBeenCalled();
    } finally { await connection.close(); vi.unstubAllEnvs(); }
  });

  it("keeps Civilization and Responses tools reachable together across installed-size catalog pages", async () => {
    vi.stubEnv("HELIX_MCP_DISCOVERY_PROFILE", "");
    vi.stubEnv("HELIX_MCP_TOOL_LIST_PAGE_BYTES", "240000");
    const connection = await connect([HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
      HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE, HELIX_AGENT_RUN_READ_SCOPE], true);
    try {
      const names = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await connection.client.listTools(cursor ? { cursor } : undefined);
        for (const tool of page.tools) names.add(tool.name);
        cursor = page.nextCursor;
        pages += 1;
        if (cursor) {
          expect(cursors.has(cursor)).toBe(false);
          cursors.add(cursor);
        }
        expect(pages).toBeLessThan(20);
      } while (cursor);
      expect(pages).toBeGreaterThan(1);
      expect(names.has("helix_environment_responses_action_shadow_choose")).toBe(true);
      expect(names.has("helix_environment_responses_baseline_shadow_choose")).toBe(true);
      expect(names.has("helix_civilization_geospatial_evidence")).toBe(true);
      const firstPage = await connection.client.listTools();
      const firstPageNames = new Set(firstPage.tools.map(tool => tool.name));
      expect(firstPageNames.has("helix_environment_goal_create")).toBe(true);
      expect(firstPageNames.has("helix_environment_responses_action_shadow_choose")).toBe(true);
      expect(firstPageNames.has("helix_environment_responses_baseline_shadow_choose")).toBe(true);
    } finally {
      await connection.close();
      vi.unstubAllEnvs();
    }
  });
  it("admits a direct MCP client context without claiming a chat binding", async () => {
    const admit = vi.spyOn(temporalAdmission, "admitDirectTemporalPlan")
      .mockResolvedValue({ action_request_id: "direct-admitted:test" } as never);
    const connection = await connect([HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE], true, false);
    try {
      expect((await connection.client.listTools()).tools.map(tool => tool.name))
        .toContain("helix_environment_temporal_plan_submit_direct");
      const { client_continuation_ref: _continuation, reasoning_binding_id: _binding,
        binding_epoch: _epoch, helix_conversation_id: _chat,
        mission_id: _mission, ...argumentsForDirect } = temporalArgs();
      const result = await connection.client.callTool({
        name: "helix_environment_temporal_plan_submit_direct", arguments: argumentsForDirect,
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        execution_context_kind: "authenticated_mcp_client_session",
        provider_task_verified: false, room_steering_authority: false,
        admission_not_execution_proof: true,
      });
      expect(connection.verifyTaskAssociation).not.toHaveBeenCalled();
      expect(admit).toHaveBeenCalledOnce();
      expect(admit.mock.calls[0][0].preflight.association).toMatchObject({
        kind: "direct_mcp_client", profileRef: "profile:durable-goal-mcp",
        roomId: ROOM_ID, runId: "test:run_id", participantId: PARTICIPANT_ID,
        associationId: expect.stringMatching(/^direct_mcp_context:/),
        continuationRef: expect.stringMatching(/^direct_mcp_session:/),
      });
      admit.mockClear();
      connection.listRunPreparationCandidates.mockResolvedValueOnce([]);
      const stale = await connection.client.callTool({
        name: "helix_environment_temporal_plan_submit_direct", arguments: argumentsForDirect,
      });
      expect(stale.isError).toBe(true);
      expect(JSON.stringify(stale)).toContain("direct_mcp_run_unverified");
      expect(admit).not.toHaveBeenCalled();
    } finally { admit.mockRestore(); await connection.close(); }
  });

  it("rejects direct temporal submission without the action scope", async () => {
    const admit = vi.spyOn(temporalAdmission, "admitDirectTemporalPlan");
    const connection = await connect([HELIX_SHARED_LIVE_ROOM_READ_SCOPE], true, false);
    try {
      const { client_continuation_ref: _continuation, reasoning_binding_id: _binding,
        binding_epoch: _epoch, helix_conversation_id: _chat,
        mission_id: _mission, ...argumentsForDirect } = temporalArgs();
      const denied = await connection.client.callTool({
        name: "helix_environment_temporal_plan_submit_direct", arguments: argumentsForDirect,
      });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).toContain("insufficient_scope");
      expect(admit).not.toHaveBeenCalled();
    } finally { admit.mockRestore(); await connection.close(); }
  });

  it("submits serial plans with authenticated exact-task identity and refuses a rejected binding", async () => {
    const admit = vi.spyOn(temporalAdmission, "admitTemporalPlan").mockResolvedValue({ action_request_id: "admitted:test" } as never);
    const connection = await connect([HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE], true);
    try {
      expect((await connection.client.listTools()).tools.map(tool => tool.name)).toContain("helix_environment_temporal_plan_submit");
      expect((await connection.client.listTools()).tools.map(tool => tool.name)).toContain("helix_environment_temporal_plan_submit_fresh");
      const result = await connection.client.callTool({ name: "helix_environment_temporal_plan_submit", arguments: temporalArgs() });
      expect(result.isError, JSON.stringify({ result,
        authenticated: connection.authenticateClient.mock.calls.length,
        bindingVerified: connection.verifyTaskAssociation.mock.calls.length,
        admitted: admit.mock.calls.length })).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        provider_task_verified: true, reasoning_binding_ref: "binding:test",
        admission_not_execution_proof: true });
      expect(connection.authenticateClient).toHaveBeenCalledOnce();
      expect(admit).toHaveBeenCalledOnce();
      expect(admit.mock.calls[0][0]).toMatchObject({ preflight: {
        context: { profileId: "profile:durable-goal-mcp", participantId: PARTICIPANT_ID },
        binding: { profileRef: "profile:durable-goal-mcp", authenticatedMcpClientRef: "mcp_client:test",
          clientSessionRef: expect.stringMatching(/^supervisor_client:/), clientContinuationRef: "continuation:test",
          helixConversationId: "chat:test", missionId: "mission:test", runId: "test:run_id" },
        compilation: { target: "serial" } }, request: { participant_id: PARTICIPANT_ID } });
      admit.mockClear();
      for (const key of ["participant_id", "arguments", "temporal_compilation_hash"]) {
        const args = temporalArgs();
        const rejected = await connection.client.callTool({ name: "helix_environment_temporal_plan_submit",
          arguments: { ...args, request: { ...args.request, [key]: "injected" } } });
        expect(rejected.isError).toBe(true);
        expect(admit).not.toHaveBeenCalled();
      }
      connection.verifyTaskAssociation.mockImplementation(() => { throw new Error("revoked"); });
      const rejected = await connection.client.callTool({ name: "helix_environment_temporal_plan_submit", arguments: temporalArgs() });
      expect(rejected.isError).toBe(true);
      expect(admit).not.toHaveBeenCalled();
    } finally { admit.mockRestore(); await connection.close(); }
  });
  it("late-binds only the principal's finite plan to a server-fresh probe and frontier", async () => {
    const probeExecutor = vi.fn().mockResolvedValue({ ok: true, status: "completed",
      observation: { outcome: "succeeded", provenance_valid: true,
        eligible_for_current_turn_reentry: true, late_result_disposition: null,
        probe_request_ref: "probe:fresh", evidence_ref: "evidence:fresh" } });
    const original = temporalArgs();
    const freshIdentity = { ...original.plan.identity, observation_revision: 77,
      affordance_revision: 9 };
    const publish = vi.spyOn(frontierPublisher, "publishTemporalPerceptionFrontier")
      .mockResolvedValue({ frontier: { frontier_id: "frontier:fresh", identity: freshIdentity,
        clocks: { audit_at: "2026-10-08T16:00:00.000Z" } },
      planning_context: { catalog_snapshot_id: "catalog:fresh",
        resident_clock_observation: { clock: {
        clock_kind: "minecraft_game_tick", tick_index: 500,
        monotonic: { origin_id: "origin:fresh", elapsed_ms: 50_000 } } } } } as never);
    const admit = vi.spyOn(temporalAdmission, "admitTemporalPlan")
      .mockResolvedValue({ action_request_id: "admitted:fresh" } as never);
    const connection = await connect([HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
      HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE], true, true, probeExecutor);
    const { frontier_id: _frontierId, probe_request_id: _probeRequestId,
      prior_turn_id: _priorTurnId, ...freshArgs } = original;
    const { identity: _staleIdentity, clocks: _staleClocks,
      monotonic_deadline_elapsed_ms: _staleDeadline,
      plan_hash: _staleHash, ...authoredPlan } = original.plan;
    try {
      const result = await connection.client.callTool({
        name: "helix_environment_temporal_plan_submit_fresh",
        arguments: { ...freshArgs, plan: authoredPlan, deadline_after_ms: 5_000 },
      });
      expect(result.isError, JSON.stringify({ result, probeCalls: probeExecutor.mock.calls.length,
        frontierCalls: publish.mock.calls.length, admitCalls: admit.mock.calls.length })).not.toBe(true);
      expect(probeExecutor).toHaveBeenCalledOnce();
      expect(publish).toHaveBeenCalledWith(expect.objectContaining({
        probeRequestId: "probe:fresh", goalId: "goal:test", roomId: ROOM_ID }));
      expect(admit).toHaveBeenCalledOnce();
      const submitted = admit.mock.calls[0][0];
      expect(submitted.preflight.plan.identity).toEqual(freshIdentity);
      expect(submitted.preflight.plan.clocks.monotonic).toEqual({
        origin_id: "origin:fresh", elapsed_ms: 50_000 });
      expect(submitted.preflight.plan.monotonic_deadline_elapsed_ms).toBe(55_000);
      expect(submitted.preflight.plan.nodes).toEqual(original.plan.nodes);
      expect(submitted.request.catalog_snapshot_id).toBe("catalog:fresh");
      expect(submitted.preflight.context).toMatchObject({ probeRequestId: "probe:fresh",
        priorTurnId: expect.stringMatching(/^mcp_environment_probe_turn:/) });
      expect(result.structuredContent).toMatchObject({ admission_not_execution_proof: true,
        provider_task_verified: true, reasoning_binding_ref: "binding:test",
        observation_ref: "evidence:fresh" });
    } finally { await connection.close(); publish.mockRestore(); admit.mockRestore(); }
  });
  it("requires exact-task stores and rejects submission without action scope", async () => {
    for (const [scopes, exactTask] of [
      [[HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE], false],
      [[HELIX_SHARED_LIVE_ROOM_READ_SCOPE], true],
    ] as const) {
      const connection = await connect(scopes, exactTask);
      try {
        if (!exactTask) {
          expect((await connection.client.listTools()).tools.map(tool => tool.name)).not.toContain("helix_environment_temporal_plan_submit");
          expect((await connection.client.listTools()).tools.map(tool => tool.name)).not.toContain("helix_environment_temporal_plan_submit_fresh");
        }
        else {
          const result = await connection.client.callTool({ name: "helix_environment_temporal_plan_submit", arguments: temporalArgs() });
          expect(result.isError).toBe(true);
          expect(result.structuredContent).toMatchObject({ error: "insufficient_scope" });
          expect(connection.verifyTaskAssociation).not.toHaveBeenCalled();
        }
      }
      finally { await connection.close(); }
    }
  });
  it("publishes frontier using authenticated owner and room participant, rejecting identity injection", async () => {
    const publish = vi.spyOn(frontierPublisher, "publishTemporalPerceptionFrontier").mockResolvedValue({ frontier_id: "frontier:test" } as never);
    const connection = await connect([HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE]);
    const args = { room_id: ROOM_ID, goal_id: "goal:test", expected_revision: 1, run_id: "run:test",
      turn_id: "turn:current", prior_turn_id: "turn:prior", probe_request_id: "probe:test" };
    try {
      expect((await connection.client.listTools()).tools.map(tool => tool.name)).toContain("helix_environment_temporal_frontier_publish");
      const result = await connection.client.callTool({ name: "helix_environment_temporal_frontier_publish", arguments: args });
      expect(result.isError).not.toBe(true);
      expect(publish).toHaveBeenCalledWith({ profileId: "profile:durable-goal-mcp", participantId: PARTICIPANT_ID,
        roomId: ROOM_ID, goalId: "goal:test", expectedRevision: 1, runId: "run:test", turnId: "turn:current",
        priorTurnId: "turn:prior", probeRequestId: "probe:test" });
      publish.mockClear();
      const denied = await connection.client.callTool({ name: "helix_environment_temporal_frontier_publish",
        arguments: { ...args, profileId: "someone-else" } });
      expect(denied.isError).toBe(true);
      expect(publish).not.toHaveBeenCalled();
    } finally { publish.mockRestore(); await connection.close(); }
  });

  it("creates, inspects, and appends through current room identity as nonterminal re-entry context", async () => {
    const connection = await connect([HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE]);
    try {
      const catalog = await connection.client.listTools();
      expect(catalog.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "helix_environment_goal_create",
        "helix_environment_goal_inspect",
        "helix_environment_goal_append",
        "helix_environment_goal_checkpoint_hash",
      ]));
      const checkpointHashInput = {
        evidence_refs: ["environment_probe_evidence:checkpoint"],
        observation_revision: 42,
        verified_facts: { viable: true, controls_released: true },
        completed_postcondition_ids: ["postcondition:viable"],
        incomplete_postcondition_ids: ["postcondition:advancement"],
      };
      const checkpointHash = await connection.client.callTool({
        name: "helix_environment_goal_checkpoint_hash",
        arguments: checkpointHashInput,
      });
      expect(checkpointHash.isError, JSON.stringify(checkpointHash)).not.toBe(true);
      expect(checkpointHash.structuredContent).toMatchObject({
        operation: "environment.durable_goal.checkpoint_hash",
        checkpoint_evidence_hash: helixEnvironmentDurableGoalSha256(checkpointHashInput),
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      });
      const created = await connection.client.callTool({
        name: "helix_environment_goal_create",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: "environment:one",
          action_authority_id: "authority:one",
          subject_native_id: "player:one",
          turn_id: "turn:create",
          objective,
          idempotency_key: "session:first-goal",
        },
      });
      expect(created.isError, JSON.stringify(created)).not.toBe(true);
      expect(created.structuredContent).toMatchObject({
        operation: "com.casimirbot.environment.durable_goal.create",
        room_id: ROOM_ID,
        goal: { goal_id: projection.goal_id, reentry_required: true, terminal_eligible: false },
        reentry_required: true,
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(connection.goalStore.create).toHaveBeenCalledWith(expect.objectContaining({
        ownerProfileId: "profile:durable-goal-mcp",
        participantId: PARTICIPANT_ID,
        idempotencyKey: "session:first-goal",
      }));

      await connection.client.callTool({ name: "helix_environment_goal_inspect", arguments: { room_id: ROOM_ID, goal_id: projection.goal_id } });
      expect(connection.goalStore.inspect).toHaveBeenCalledWith({ goalId: projection.goal_id, profileId: "profile:durable-goal-mcp", participantId: PARTICIPANT_ID });

      await connection.client.callTool({
        name: "helix_environment_goal_append",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: "environment:one",
          goal_id: projection.goal_id,
          action_authority_id: "authority:one",
          subject_native_id: "player:one",
          turn_id: "turn:append",
          expected_revision: 1,
          payload: { kind: "strategy_revised", strategy_summary: "Try a safer route.", candidate_milestone_ids: ["milestone:first"], supersedes_strategy_event_id: null },
          evidence_refs: [],
        },
      });
      expect(connection.goalStore.append).toHaveBeenCalledWith(expect.objectContaining({ participantId: PARTICIPANT_ID, expectedRevision: 1 }));
      expect(connection.inspectRoom).toHaveBeenCalledTimes(3);
    } finally {
      await connection.close();
    }
  });

  it("rejects mutation before store access when action-write scope is absent", async () => {
    const connection = await connect([HELIX_SHARED_LIVE_ROOM_READ_SCOPE]);
    try {
      const result = await connection.client.callTool({
        name: "helix_environment_goal_create",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: "environment:one",
          action_authority_id: "authority:one",
          subject_native_id: "player:one",
          turn_id: "turn:create",
          objective,
        },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: "insufficient_scope" });
      expect(connection.goalStore.create).not.toHaveBeenCalled();
      expect(connection.inspectRoom).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });
});
