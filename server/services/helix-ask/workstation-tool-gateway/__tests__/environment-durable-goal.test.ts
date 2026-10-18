import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import {
  HELIX_ENVIRONMENT_DURABLE_GOAL_APPEND_CAPABILITY,
  HELIX_ENVIRONMENT_DURABLE_GOAL_CREATE_CAPABILITY,
  HELIX_ENVIRONMENT_DURABLE_GOAL_INSPECT_CAPABILITY,
  HELIX_ENVIRONMENT_DURABLE_GOAL_PROJECTION_SCHEMA,
  type HelixEnvironmentDurableGoalProjection,
  helixEnvironmentDurableGoalSha256,
} from "@shared/helix-environment-durable-goal";
import { describe, expect, it, vi } from "vitest";
import type { HelixWorkstationGatewayAccountContext } from "../account-policy";
import {
  environmentDurableGoalManifests,
  executeEnvironmentDurableGoalGatewayCapability,
  type EnvironmentDurableGoalGatewayDependencies,
} from "../environment-durable-goal";

const ROOM_ID = "shared_realtime_room:goal-gateway";
const PROFILE_ID = "profile:goal-gateway";
const PARTICIPANT_ID = "participant:goal-gateway";
const ENVIRONMENT_ID = "environment:goal-gateway";

const accountContext = (): HelixWorkstationGatewayAccountContext => {
  const policy = buildHelixAccountCapabilityPolicy("developer");
  const now = "2026-08-22T12:00:00.000Z";
  const session = {
    schema: "helix.account_session.v1" as const,
    session_id: "account_session:goal-gateway",
    profile: {
      profile_id: PROFILE_ID,
      display_name: "Goal gateway",
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
  return { session_id: session.session_id, profile_id: PROFILE_ID, trusted_account_session: true, account_session: session, account_policy: policy };
};

const objective = {
  objective_text: "Earn one advancement and remain viable.",
  goal_kind: "custom_survival" as const,
  domain: "minecraft" as const,
  game_version: "1.21.8",
  mechanics_collection_ref: null,
  milestones: [{ milestone_id: "milestone:one", description: "Earn an advancement.", dependency_milestone_ids: [], required_postcondition_ids: ["postcondition:advancement", "postcondition:viable"] }],
};

const projection: HelixEnvironmentDurableGoalProjection = {
  schema: HELIX_ENVIRONMENT_DURABLE_GOAL_PROJECTION_SCHEMA,
  goal_id: "environment_durable_goal:one",
  revision: 1,
  latest_event_hash: `sha256:${"a".repeat(64)}`,
  status: "active",
  objective,
  identity: {
    owner_profile_id: PROFILE_ID,
    host_ref: "environment_device:one",
    connector_installation_id: "installation:one",
    device_id: "device:one",
    environment_binding_id: ENVIRONMENT_ID,
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
  milestones: [],
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

const dependencies = () => {
  const store = {
    create: vi.fn(async () => projection),
    inspect: vi.fn(async () => projection),
    listForRoom: vi.fn(async () => [projection]),
    append: vi.fn(async () => projection),
  };
  return {
    store,
    listRoomEnvironments: vi.fn(async () => [{
      environment_binding_id: ENVIRONMENT_ID,
      room_source_binding_id: "room_source_binding:one",
      room_id: ROOM_ID,
      source_id: "source:one",
      world_id: "minecraft:overworld",
      source_label: "Local Fabric",
      domain: "minecraft",
      connection_status: "active",
    }] as never),
    readMembership: vi.fn(async () => ({ participantId: PARTICIPANT_ID, role: "owner", roomStatus: "active" }) as never),
    resolveActionContext: vi.fn(async () => ({
      actionAuthorityId: "authority:one",
      environmentBindingId: ENVIRONMENT_ID,
      roomId: ROOM_ID,
      sourceId: "source:one",
      worldId: "minecraft:overworld",
      participantId: PARTICIPANT_ID,
      subjectBindingId: "subject_binding:one",
      subjectNativeId: "player:one",
      actionAdapterProfileId: "minecraft.fabric.player_action.v1",
      actionDomainAdapter: "minecraft.fabric_mod.v1",
      policyVersion: 1,
      autonomyMode: "autonomous" as const,
      manualOverridePolicy: "pause" as const,
      catalogSnapshotId: "catalog:one",
      manifestId: "manifest:one",
    })),
  } satisfies EnvironmentDurableGoalGatewayDependencies;
};

describe("durable environment goal workstation gateway", () => {
  it("publishes create, inspect, and append as nonterminal shared capabilities", () => {
    expect(environmentDurableGoalManifests.map((entry) => entry.capability_id)).toEqual([
      "com.casimirbot.environment.durable_goal.create",
      "com.casimirbot.environment.durable_goal.inspect",
      "com.casimirbot.environment.durable_goal.append",
    ]);
    for (const manifest of environmentDurableGoalManifests) {
      expect(manifest).toMatchObject({ shell_access: false, code_mutation: false, terminal_eligible: false, post_tool_model_step_required: true, assistant_answer: false });
    }
    const createManifest = environmentDurableGoalManifests.find(
      (entry) => entry.capability_id === HELIX_ENVIRONMENT_DURABLE_GOAL_CREATE_CAPABILITY,
    );
    expect(
      (createManifest?.input_schema.properties.objective as { required?: string[] })
        .required,
    ).toContain("mechanics_collection_ref");
    expect(
      (
        createManifest?.input_schema.properties.objective as {
          properties?: { game_version?: { maxLength?: number } };
        }
      ).properties?.game_version?.maxLength,
    ).toBe(80);
  });

  it("returns model-repair guidance for a malformed model-authored objective", async () => {
    const deps = dependencies();
    const { mechanics_collection_ref: _missing, ...malformedObjective } = objective;
    const result = await executeEnvironmentDurableGoalGatewayCapability({
      capabilityId: HELIX_ENVIRONMENT_DURABLE_GOAL_CREATE_CAPABILITY,
      turnId: "turn:create-repair",
      arguments: { objective: malformedObjective },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps,
    });
    expect(result).toMatchObject({
      ok: false,
      error: "durable_goal_event_invalid",
      repairAction: "repair",
    });
    expect(result.summary).toContain("mechanics_collection_ref");
    expect(deps.store.create).not.toHaveBeenCalled();
  });

  it("publishes canonical checkpoint fields and derives their integrity hash server-side", async () => {
    const deps = dependencies();
    const evidenceRefs = ["environment_probe_evidence:current"];
    const payload = {
      kind: "checkpoint_verified" as const,
      checkpoint_id: "checkpoint:preflight",
      milestone_id: "milestone:one",
      observation_revision: 42,
      verified_facts: { actor_status_bound: true },
      completed_postcondition_ids: ["postcondition:viable"],
      incomplete_postcondition_ids: ["postcondition:advancement"],
      postconditions: ["ignored_cross_variant_field"],
      rationale: "ignored cross-variant narration",
    };
    const appendManifest = environmentDurableGoalManifests.find(
      (entry) =>
        entry.capability_id === HELIX_ENVIRONMENT_DURABLE_GOAL_APPEND_CAPABILITY,
    );

    expect(
      (appendManifest?.input_schema.properties.payload as {
        properties?: Record<string, unknown>;
      }).properties,
    ).toHaveProperty("checkpoint_id");

    const result = await executeEnvironmentDurableGoalGatewayCapability({
      capabilityId: HELIX_ENVIRONMENT_DURABLE_GOAL_APPEND_CAPABILITY,
      turnId: "turn:append-checkpoint",
      arguments: {
        goal_id: projection.goal_id,
        expected_revision: 1,
        payload,
        evidence_refs: evidenceRefs,
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps,
    });

    expect(result.ok).toBe(true);
    expect(deps.store.append).toHaveBeenCalledWith(
      expect.objectContaining({
        goalId: projection.goal_id,
        payload: {
          kind: payload.kind,
          checkpoint_id: payload.checkpoint_id,
          milestone_id: payload.milestone_id,
          observation_revision: payload.observation_revision,
          verified_facts: payload.verified_facts,
          completed_postcondition_ids: payload.completed_postcondition_ids,
          incomplete_postcondition_ids: payload.incomplete_postcondition_ids,
          checkpoint_evidence_hash: helixEnvironmentDurableGoalSha256({
            evidence_refs: evidenceRefs,
            observation_revision: 42,
            verified_facts: payload.verified_facts,
            completed_postcondition_ids: payload.completed_postcondition_ids,
            incomplete_postcondition_ids: payload.incomplete_postcondition_ids,
          }),
        },
        evidenceRefs,
      }),
    );
  });

  it("returns model-repair guidance for a paraphrased optional environment label", async () => {
    const deps = dependencies();
    const result = await executeEnvironmentDurableGoalGatewayCapability({
      capabilityId: HELIX_ENVIRONMENT_DURABLE_GOAL_CREATE_CAPABILITY,
      turnId: "turn:create-label-repair",
      arguments: { environment_label: "active Fabric environment", objective },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps,
    });
    expect(result).toMatchObject({
      ok: false,
      error: "durable_goal_environment_label_invalid",
      repairAction: "repair",
    });
    expect(result.summary).toContain("Retry without environment_label");
    expect(deps.resolveActionContext).not.toHaveBeenCalled();
    expect(deps.store.create).not.toHaveBeenCalled();
  });

  it("resolves protected identity server-side when Runtime Codex creates the milestone contract", async () => {
    const deps = dependencies();
    const result = await executeEnvironmentDurableGoalGatewayCapability({
      capabilityId: HELIX_ENVIRONMENT_DURABLE_GOAL_CREATE_CAPABILITY,
      turnId: "turn:create",
      arguments: { objective },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps,
    });
    expect(result).toMatchObject({ ok: true, status: "completed", observation: { outcome: "recorded", goal: { goal_id: projection.goal_id }, provenance_valid: true, eligible_for_current_turn_reentry: true, answer_authority: false, terminal_eligible: false } });
    expect(deps.store.create).toHaveBeenCalledWith(expect.objectContaining({ ownerProfileId: PROFILE_ID, participantId: PARTICIPANT_ID, environmentBindingId: ENVIRONMENT_ID, subjectNativeId: "player:one", actionAuthorityId: "authority:one", objective }));
    expect(deps.resolveActionContext).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      profileId: PROFILE_ID,
      environmentBindingId: ENVIRONMENT_ID,
      participantId: PARTICIPANT_ID,
    });
  });

  it("reconstructs an authorized goal without requiring model-authored environment identity", async () => {
    const deps = dependencies();
    const result = await executeEnvironmentDurableGoalGatewayCapability({
      capabilityId: HELIX_ENVIRONMENT_DURABLE_GOAL_INSPECT_CAPABILITY,
      turnId: "turn:inspect",
      arguments: { goal_id: projection.goal_id },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps,
    });
    expect(result).toMatchObject({ ok: true, observation: { outcome: "fresh", reentry_required: true, terminal_eligible: false } });
    expect(deps.store.inspect).toHaveBeenCalledWith({ goalId: projection.goal_id, profileId: PROFILE_ID, participantId: PARTICIPANT_ID });
    expect(deps.listRoomEnvironments).not.toHaveBeenCalled();
    expect(deps.resolveActionContext).not.toHaveBeenCalled();
  });

  it("resolves the only readable goal from the exact active room environment", async () => {
    const deps = dependencies();
    const result = await executeEnvironmentDurableGoalGatewayCapability({
      capabilityId: HELIX_ENVIRONMENT_DURABLE_GOAL_INSPECT_CAPABILITY,
      turnId: "turn:inspect-current",
      arguments: {},
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps,
    });

    expect(result).toMatchObject({
      ok: true,
      executedArgs: {
        goal_id: projection.goal_id,
        goal_resolution: "only_readable_goal_for_exact_active_environment",
      },
      observation: { goal: { goal_id: projection.goal_id } },
    });
    expect(deps.store.listForRoom).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      profileId: PROFILE_ID,
      participantId: PARTICIPANT_ID,
      sourceId: "source:one",
      worldId: "minecraft:overworld",
      roomSourceBindingId: "room_source_binding:one",
      limit: 8,
    });
    expect(deps.store.inspect).toHaveBeenCalledWith({
      goalId: projection.goal_id,
      profileId: PROFILE_ID,
      participantId: PARTICIPANT_ID,
    });
  });

  it("fails closed with exact candidate IDs when current-goal resolution is ambiguous", async () => {
    const deps = dependencies();
    deps.store.listForRoom.mockResolvedValue([
      projection,
      { ...projection, goal_id: "environment_durable_goal:two" },
    ]);

    const result = await executeEnvironmentDurableGoalGatewayCapability({
      capabilityId: HELIX_ENVIRONMENT_DURABLE_GOAL_INSPECT_CAPABILITY,
      turnId: "turn:inspect-ambiguous",
      arguments: {},
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "durable_goal_selection_required",
      repairAction: "repair",
    });
    expect(result.summary).toContain(projection.goal_id);
    expect(result.summary).toContain(projection.objective.objective_text);
    expect(result.summary).toContain("environment_durable_goal:two");
    expect(result.summary).toContain(projection.goal_id);
    expect(result.summary).toContain("environment_durable_goal:two");
    expect(deps.store.inspect).not.toHaveBeenCalled();
  });
});
