import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import {
  HELIX_ENVIRONMENT_ACTION_CONTROL_OBSERVATION_SCHEMA,
  HELIX_ENVIRONMENT_ACTION_CONTROL_REQUEST_SCHEMA,
  type HelixEnvironmentActionControlObservation,
} from "@shared/helix-environment-action";
import { describe, expect, it, vi } from "vitest";
import type { HelixWorkstationGatewayAccountContext } from "../account-policy";
import {
  environmentActionControlMinecraftManifests,
  executeEnvironmentActionControlGatewayCapability,
  type EnvironmentActionControlGatewayDependencies,
} from "../environment-action-control";

const ROOM_ID = "shared_realtime_room:player-control-test";
const PROFILE_ID = "profile:player-control-test";
const PARTICIPANT_ID = "participant:player-control-test";
const WORKFLOW_ID = "environment_action_workflow:player-control-test";
const CANCEL_CAPABILITY = "com.casimirbot.minecraft.player.workflow.cancel";
const EMERGENCY_STOP_CAPABILITY = "com.casimirbot.minecraft.player.emergency_stop";

const accountContext = (): HelixWorkstationGatewayAccountContext => {
  const accountPolicy = buildHelixAccountCapabilityPolicy("developer");
  const session = {
    schema: "helix.account_session.v1" as const,
    session_id: "account_session:player-control-test",
    profile: {
      profile_id: PROFILE_ID,
      display_name: "Player control tester",
      auth_mode: "guest" as const,
      account_type: "developer" as const,
      provider: "guest" as const,
      created_at: "2026-08-05T12:00:00.000Z",
      updated_at: "2026-08-05T12:00:00.000Z",
    },
    account_policy: accountPolicy,
    status: "active" as const,
    memory_scope: "session_only" as const,
    created_at: "2026-08-05T12:00:00.000Z",
    updated_at: "2026-08-05T12:00:00.000Z",
    expires_at: "2026-08-06T12:00:00.000Z",
  };
  return {
    session_id: session.session_id,
    profile_id: PROFILE_ID,
    trusted_account_session: true,
    account_session: session,
    account_policy: accountPolicy,
  };
};

const observation: HelixEnvironmentActionControlObservation = {
  schema: HELIX_ENVIRONMENT_ACTION_CONTROL_OBSERVATION_SCHEMA,
  control_request_ref: "environment_action_control:test",
  workflow_ref: WORKFLOW_ID,
  control_kind: "cancel",
  outcome: "completed",
  summary: "The paired client canceled the workflow and released controls.",
  affected_workflow_refs: [WORKFLOW_ID],
  workflow_state: "canceled",
  controls_released: true,
  evidence_refs: ["environment_action_event:canceled"],
  evidence_ref: "environment_action_control_evidence:test",
  observed_at: "2026-08-05T12:00:02.000Z",
  provenance_valid: true,
  eligible_for_current_turn_reentry: true,
  content_role:
    "environment_action_control_observation_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const deps = (
  overrides: Partial<EnvironmentActionControlGatewayDependencies> = {},
): Partial<EnvironmentActionControlGatewayDependencies> => ({
  readMembership: vi.fn(async () => ({
    participantId: PARTICIPANT_ID,
    role: "owner",
    roomStatus: "active",
  }) as never),
  resolveContext: vi.fn(async () => ({
    actionAuthorityId: "environment_action_authority:test",
    environmentBindingId: "environment_binding:test",
    roomId: ROOM_ID,
    participantId: PARTICIPANT_ID,
    workflowId: WORKFLOW_ID,
  })),
  requestControl: vi.fn(async ({ controlKind, workflowId }) => ({
    schema: HELIX_ENVIRONMENT_ACTION_CONTROL_REQUEST_SCHEMA,
    control_request_id: "environment_action_control:test",
    control_kind: controlKind,
    action_authority_id: "environment_action_authority:test",
    environment_binding_id: "environment_binding:test",
    room_id: ROOM_ID,
    source_id: "source:test",
    world_id: "minecraft:local:test",
    participant_id: PARTICIPANT_ID,
    subject_binding_id: "subject_binding:test",
    workflow_id: workflowId,
    reason: "Cancel the workflow.",
    release_all_controls: controlKind === "cancel",
    created_at: "2026-08-05T12:00:00.000Z",
    deadline_at: "2026-08-05T12:01:00.000Z",
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  }) as never),
  emergencyStop: vi.fn(async () => ({
    authority: {},
    controlRequest: {
      schema: HELIX_ENVIRONMENT_ACTION_CONTROL_REQUEST_SCHEMA,
      control_request_id: "environment_action_control:emergency-test",
      control_kind: "emergency_stop",
      action_authority_id: "environment_action_authority:test",
      environment_binding_id: "environment_binding:test",
      room_id: ROOM_ID,
      source_id: "source:test",
      world_id: "minecraft:local:test",
      participant_id: PARTICIPANT_ID,
      subject_binding_id: "subject_binding:test",
      workflow_id: null,
      reason: "Emergency stop the paired client.",
      release_all_controls: true,
      created_at: "2026-08-05T12:00:00.000Z",
      deadline_at: "2026-08-05T12:01:00.000Z",
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    },
  }) as never),
  awaitObservation: vi.fn(async () => observation),
  readRetainedResult: vi.fn(async () => null),
  ...overrides,
});

describe("Minecraft player workflow-control workstation gateway", () => {
  it("returns a retained terminal result separately from the current not-running observation", async () => {
    const native = {...observation, control_kind: 'status' as const, outcome: 'not_running' as const,
      workflow_state: null, controls_released: false};
    const retained = {workflow_ref: WORKFLOW_ID, outcome:'succeeded', observed_at:'2026-08-05T11:00:00.000Z',
      result:{controls_released:true}, answer_authority:false, terminal_eligible:false} as never;
    const readRetainedResult = vi.fn(async () => retained);
    const result = await executeEnvironmentActionControlGatewayCapability({
      capabilityId:'com.casimirbot.minecraft.player.workflow.status',turnId:'turn:retained',
      arguments:{workflow_ref:WORKFLOW_ID},accountContext:accountContext(),
      conversationThreadId:`helix-ask:room:${ROOM_ID}`,
      dependencies:deps({awaitObservation:vi.fn(async()=>native),readRetainedResult}),
    });
    expect(result.ok).toBe(true);
    expect(result.observation).toEqual(native);
    expect(result.retained_result).toBe(retained);
    expect(result.summary).toContain('historical, not a current control-state check');
    expect(readRetainedResult).toHaveBeenCalledWith({roomId:ROOM_ID,profileId:PROFILE_ID,
      workflowId:WORKFLOW_ID,requestingParticipantId:PARTICIPANT_ID});
  });

  it.each([CANCEL_CAPABILITY, 'com.casimirbot.minecraft.player.workflow.resume'])(
    'does not turn %s into success using an old completed result', async capabilityId => {
      const readRetainedResult = vi.fn(async()=>({outcome:'succeeded'}) as never);
      const result = await executeEnvironmentActionControlGatewayCapability({capabilityId,turnId:'turn:negative',
        arguments:{workflow_ref:WORKFLOW_ID},accountContext:accountContext(),
        conversationThreadId:`helix-ask:room:${ROOM_ID}`,
        dependencies:deps({readRetainedResult,awaitObservation:vi.fn(async()=>({...observation,outcome:'not_running'}))}),
      });
      expect(result.ok).toBe(false);
      expect(readRetainedResult).not.toHaveBeenCalled();
    });

  it("publishes status, resume, cancel, and emergency stop as bounded nonterminal tools", () => {
    expect(environmentActionControlMinecraftManifests).toHaveLength(4);
    expect(environmentActionControlMinecraftManifests.map(
      (manifest) => manifest.capability_id,
    )).toEqual([
      "com.casimirbot.minecraft.player.workflow.status",
      "com.casimirbot.minecraft.player.workflow.resume",
      CANCEL_CAPABILITY,
      EMERGENCY_STOP_CAPABILITY,
    ]);
    for (const manifest of environmentActionControlMinecraftManifests) {
      expect(manifest).toMatchObject({
        shell_access: false,
        code_mutation: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      });
      expect(manifest.safety_tags).toEqual(
        expect.arrayContaining(["no_shell", "no_code_mutation", "non_terminal"]),
      );
      expect(manifest.input_schema).toMatchObject({
        required: ["workflow_ref"],
      });
    }
    expect(environmentActionControlMinecraftManifests[0]?.description).toContain(
      "not a general player health, location, hazard, inventory, or safe-baseline read",
    );
  });

  it("resolves an exact workflow to its authority before applying global emergency stop", async () => {
    const emergencyStop = vi.fn(deps().emergencyStop!);
    const requestControl = vi.fn();
    const emergencyObservation: HelixEnvironmentActionControlObservation = {
      ...observation,
      control_request_ref: "environment_action_control:emergency-test",
      workflow_ref: null,
      control_kind: "emergency_stop",
      summary: "The paired client emergency-stopped its active workflow and released controls.",
      affected_workflow_refs: [WORKFLOW_ID],
      workflow_state: "emergency_stopped",
      evidence_ref: "environment_action_control_evidence:emergency-test",
    };
    const result = await executeEnvironmentActionControlGatewayCapability({
      capabilityId: EMERGENCY_STOP_CAPABILITY,
      turnId: "ask:player-control:emergency-stop",
      arguments: {
        workflow_ref: WORKFLOW_ID,
        reason: "Release my player controls immediately.",
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps({
        emergencyStop,
        requestControl,
        awaitObservation: vi.fn(async () => emergencyObservation),
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      executedArgs: {
        workflow_ref: WORKFLOW_ID,
        control_kind: "emergency_stop",
      },
      observation: {
        control_kind: "emergency_stop",
        outcome: "completed",
        controls_released: true,
        terminal_eligible: false,
      },
    });
    expect(emergencyStop).toHaveBeenCalledWith(expect.objectContaining({
      actionAuthorityId: "environment_action_authority:test",
      environmentBindingId: "environment_binding:test",
    }));
    expect(requestControl).not.toHaveBeenCalled();
  });

  it("accepts an idempotent emergency stop when authority is suspended and no workflow remains", async () => {
    const result = await executeEnvironmentActionControlGatewayCapability({
      capabilityId: EMERGENCY_STOP_CAPABILITY,
      turnId: "ask:player-control:emergency-stop-idempotent",
      arguments: { workflow_ref: WORKFLOW_ID },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps({
        emergencyStop: vi.fn(async () => ({
          authority: { status: "suspended" },
          controlRequest: {
            schema: HELIX_ENVIRONMENT_ACTION_CONTROL_REQUEST_SCHEMA,
            control_request_id: "environment_action_control:emergency-idempotent",
            control_kind: "emergency_stop",
            action_authority_id: "environment_action_authority:test",
            environment_binding_id: "environment_binding:test",
            room_id: ROOM_ID,
            source_id: "source:test",
            world_id: "minecraft:local:test",
            participant_id: PARTICIPANT_ID,
            subject_binding_id: "subject_binding:test",
            workflow_id: null,
            reason: "Emergency stop the paired client.",
            release_all_controls: true,
            created_at: "2026-08-05T12:00:00.000Z",
            deadline_at: "2026-08-05T12:01:00.000Z",
            answer_authority: false,
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        }) as never),
        awaitObservation: vi.fn(async () => ({
          ...observation,
          control_kind: "emergency_stop",
          outcome: "not_running",
          workflow_state: null,
          controls_released: true,
          affected_workflow_refs: [],
          summary: "No workflow remained running.",
        })),
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      observation: {
        control_kind: "emergency_stop",
        outcome: "completed",
        workflow_state: "emergency_stopped",
        controls_released: true,
        provenance_valid: true,
      },
    });
  });

  it("resolves the exact speaker workflow server-side and re-enters cancellation evidence", async () => {
    const requestControl = vi.fn(deps().requestControl!);
    const result = await executeEnvironmentActionControlGatewayCapability({
      capabilityId: CANCEL_CAPABILITY,
      turnId: "ask:player-control:cancel",
      arguments: { workflow_ref: WORKFLOW_ID, reason: "Stop walking now." },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps({ requestControl }),
    });
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      executedArgs: {
        workflow_ref: WORKFLOW_ID,
        control_kind: "cancel",
      },
      observation: {
        outcome: "completed",
        controls_released: true,
        provenance_valid: true,
        eligible_for_current_turn_reentry: true,
        terminal_eligible: false,
      },
    });
    expect(requestControl).toHaveBeenCalledWith(expect.objectContaining({
      actionAuthorityId: "environment_action_authority:test",
      workflowId: WORKFLOW_ID,
      controlKind: "cancel",
    }));
    expect(JSON.stringify(result.executedArgs)).not.toContain("action_authority");
  });

  it("fails before workflow lookup without a trusted room session", async () => {
    const resolveContext = vi.fn();
    const result = await executeEnvironmentActionControlGatewayCapability({
      capabilityId: CANCEL_CAPABILITY,
      turnId: "ask:player-control:untrusted",
      arguments: { workflow_ref: WORKFLOW_ID },
      accountContext: null,
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: { resolveContext },
    });
    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      error: "action_policy_denied",
      observation: {
        provenance_valid: false,
        eligible_for_current_turn_reentry: false,
      },
    });
    expect(resolveContext).not.toHaveBeenCalled();
  });
});
