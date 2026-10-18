import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import {
  HELIX_ENVIRONMENT_REASONING_ROLE_RECORD_CAPABILITY,
  HELIX_ENVIRONMENT_REASONING_ROLE_PROJECTION_SCHEMA,
  type HelixEnvironmentReasoningRoleProjection,
} from "@shared/helix-environment-reasoning-role";
import { describe, expect, it, vi } from "vitest";
import type { HelixWorkstationGatewayAccountContext } from "../account-policy";
import {
  environmentReasoningRoleManifests,
  executeEnvironmentReasoningRoleGatewayCapability,
  linkCompletedEnvironmentReasoningRoleAction,
  type EnvironmentReasoningRoleGatewayDependencies,
} from "../environment-reasoning-role";

const ROOM_ID = "shared_realtime_room:g6-gateway";
const PROFILE_ID = "profile:g6-gateway";
const PARTICIPANT_ID = "participant:g6-gateway";
const GOAL_ID = "environment_durable_goal:g6";

const accountContext = (): HelixWorkstationGatewayAccountContext => {
  const policy = buildHelixAccountCapabilityPolicy("developer");
  const now = "2026-08-23T12:00:00.000Z";
  const session = {
    schema: "helix.account_session.v1" as const,
    session_id: "account_session:g6-gateway",
    profile: {
      profile_id: PROFILE_ID,
      display_name: "G6 gateway",
      auth_mode: "guest" as const,
      account_type: "developer" as const,
      provider: "guest" as const,
      created_at: now,
      updated_at: now,
    },
    account_policy: policy,
    status: "active" as const,
    memory_scope: "session_only" as const,
    created_at: now,
    updated_at: now,
    expires_at: "2099-01-01T00:00:00.000Z",
  };
  return {
    session_id: session.session_id,
    profile_id: PROFILE_ID,
    trusted_account_session: true,
    account_session: session,
    account_policy: policy,
  };
};

const projection = {
  schema: HELIX_ENVIRONMENT_REASONING_ROLE_PROJECTION_SCHEMA,
  goal_id: GOAL_ID,
  revision: 1,
  latest_event_hash: `sha256:${"a".repeat(64)}`,
  outputs: [],
  invalidated_output_ids: [],
  principal_dispositions: [],
  arbitrations: [],
  execution_links: [],
  measured_result_links: [],
  event_refs: ["environment_reasoning_role_event:one"],
  content_role: "environment_reasoning_role_projection_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
} as HelixEnvironmentReasoningRoleProjection;

const dependencies = (): EnvironmentReasoningRoleGatewayDependencies => ({
  store: {
    recordOutput: vi.fn(async () => projection),
    inspect: vi.fn(async () => projection),
    recordPrincipalDisposition: vi.fn(async () => projection),
    arbitrate: vi.fn(async () => projection),
    linkCompletedPrincipalExecution: vi.fn(async () => projection),
  },
  listRoomEnvironments: vi.fn(async () => [{
    environment_binding_id: "environment:g6",
    domain: "minecraft",
    connection_status: "active",
  }] as never),
  readMembership: vi.fn(async () => ({
    participantId: PARTICIPANT_ID,
    role: "owner",
    roomStatus: "active",
  }) as never),
  resolveActionContext: vi.fn(async () => ({
    actionAuthorityId: "authority:g6",
    environmentBindingId: "environment:g6",
    roomId: ROOM_ID,
    sourceId: "source:g6",
    worldId: "minecraft:overworld",
    participantId: PARTICIPANT_ID,
    subjectBindingId: "subject:g6",
    subjectNativeId: "player:g6",
    actionAdapterProfileId: "minecraft.fabric.player_action.v1",
    actionDomainAdapter: "minecraft.fabric_mod.v1",
    policyVersion: 1,
    autonomyMode: "autonomous" as const,
    manualOverridePolicy: "pause" as const,
    catalogSnapshotId: "catalog:g6",
    manifestId: "manifest:g6",
  })),
});

describe("G6 environment reasoning role workstation gateway", () => {
  it("publishes only nonterminal, non-executing role operations", () => {
    expect(environmentReasoningRoleManifests.map((entry) => entry.capability_id)).toEqual([
      "com.casimirbot.environment.reasoning_role.record",
      "com.casimirbot.environment.reasoning_role.inspect",
      "com.casimirbot.environment.reasoning_role.disposition",
      "com.casimirbot.environment.reasoning_role.arbitrate",
    ]);
    for (const manifest of environmentReasoningRoleManifests) {
      expect(manifest).toMatchObject({
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        shell_access: false,
        code_mutation: false,
      });
      expect(manifest.safety_tags).toContain("one_execution_arbiter");
      expect(manifest.safety_tags).toContain("no_execution_authority");
    }
  });

  it("binds a runtime-native shadow output to the trusted principal turn and server identity", async () => {
    const deps = dependencies();
    const result = await executeEnvironmentReasoningRoleGatewayCapability({
      capabilityId: HELIX_ENVIRONMENT_REASONING_ROLE_RECORD_CAPABILITY,
      turnId: "ask:principal:g6",
      agentRuntime: "codex",
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      arguments: {
        goal_id: GOAL_ID,
        expected_goal_revision: 7,
        expected_ledger_revision: 0,
        observation_revision: 42,
        input_evidence_refs: ["digest:42"],
        payload: {
          role_kind: "prospective_planning",
          proposal_id: "proposal:g6",
          objective_summary: "Check the route before movement.",
          capability_id: "com.casimirbot.minecraft.hazards.nearby",
          capability_arguments: { radius: 12 },
          predicted_postconditions: [],
          assumptions: [],
          resource_keys: ["player:g6:observation"],
          confidence: 0.8,
          abstain: false,
        },
        expires_in_seconds: 60,
      },
      dependencies: deps,
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        reentry_required: true,
        execution_authority: false,
        answer_authority: false,
        terminal_eligible: false,
      },
    });
    expect(deps.store.recordOutput).toHaveBeenCalledWith(expect.objectContaining({
      roomId: ROOM_ID,
      participantId: PARTICIPANT_ID,
      subjectNativeId: "player:g6",
      actionAuthorityId: "authority:g6",
      principalTurnId: "ask:principal:g6",
      turnId: "ask:principal:g6",
      producer: expect.objectContaining({
        selected_runtime_provider_id: "codex",
        supporting_provider_id: "codex",
      }),
    }));
  });

  it("fails closed outside an exact Shared Live Room principal turn", async () => {
    const deps = dependencies();
    const result = await executeEnvironmentReasoningRoleGatewayCapability({
      capabilityId: HELIX_ENVIRONMENT_REASONING_ROLE_RECORD_CAPABILITY,
      turnId: "ask:not-room",
      agentRuntime: "codex",
      accountContext: accountContext(),
      conversationThreadId: "ordinary-thread",
      dependencies: deps,
    });
    expect(result).toMatchObject({
      ok: false,
      error: "reasoning_role_forbidden",
      observation: { terminal_eligible: false },
    });
    expect(deps.store.recordOutput).not.toHaveBeenCalled();
  });

  it("links a completed action only through the exact room principal", async () => {
    const deps = dependencies();
    const result = await linkCompletedEnvironmentReasoningRoleAction({
      turnId: "ask:principal:g6",
      capabilityId: "com.casimirbot.minecraft.player.walk",
      capabilityArguments: {
        direction: "forward",
        duration_ms: 100,
        sprint: false,
      },
      environmentActionRequestId: "environment_action_request:g6",
      environmentActionResultRef: "environment_action_result:g6",
      reentryObservationRef: "agent_step_observation:g6",
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps,
    });
    expect(result).toBe(projection);
    expect(deps.store.linkCompletedPrincipalExecution).toHaveBeenCalledWith({
      profileId: PROFILE_ID,
      participantId: PARTICIPANT_ID,
      roomId: ROOM_ID,
      principalTurnId: "ask:principal:g6",
      capabilityId: "com.casimirbot.minecraft.player.walk",
      capabilityArguments: {
        direction: "forward",
        duration_ms: 100,
        sprint: false,
      },
      environmentActionRequestId: "environment_action_request:g6",
      environmentActionResultRef: "environment_action_result:g6",
      reentryObservationRef: "agent_step_observation:g6",
    });
  });
});
