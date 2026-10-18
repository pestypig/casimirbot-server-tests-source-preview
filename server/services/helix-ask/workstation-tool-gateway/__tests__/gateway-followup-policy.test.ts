import {
  HELIX_AGENT_STEP_OBSERVATION_PACKET_SCHEMA,
  type HelixAgentStepObservationPacket,
} from "@shared/helix-agent-step-observation-packet";
import { describe, expect, it } from "vitest";
import { resolveWorkstationGatewayFollowupPolicy } from "../gateway-followup-policy";

const packet = (
  repairAction?: string,
): HelixAgentStepObservationPacket => ({
  schema: HELIX_AGENT_STEP_OBSERVATION_PACKET_SCHEMA,
  turn_id: "ask:gateway-followup-policy",
  iteration: 1,
  call_id: "tool_call:gateway-followup-policy",
  decision_id: "decision:gateway-followup-policy",
  capability_key: "com.casimirbot.minecraft.player.look",
  panel_id: "workstation-gateway",
  action: "room.environment.player_action",
  status: "failed",
  produced_artifact_refs: ["environment_action_observation:test"],
  observation_summary: "The action produced a typed failure observation.",
  receipts: [],
  missing_requirements: repairAction
    ? [
        {
          code: "request_canceled",
          message: "Manual input canceled the workflow.",
          repair_action: repairAction,
        },
      ]
    : [],
  state_delta: {},
  suggested_next_steps: [],
  produced_affordances: [],
  consumed_affordances: [],
  terminal_eligible: false,
  post_tool_model_step_required: true,
  assistant_answer: false,
  raw_content_included: false,
});

describe("workstation gateway follow-up policy", () => {
  it("turns a typed ask_user repair into a non-retryable human boundary", () => {
    expect(
      resolveWorkstationGatewayFollowupPolicy({
        observationPacket: packet("ask_user"),
        blocked: false,
        failed: true,
        terminalEligible: false,
      }),
    ).toEqual({
      retryRecommendation: "ask_user",
      nextAction: "ask_user",
      externalChangeRequired: true,
      recoverySource: "typed_user_intervention",
    });
  });

  it("retains retry for an ordinary failed observation without user repair", () => {
    expect(
      resolveWorkstationGatewayFollowupPolicy({
        observationPacket: packet("retry"),
        blocked: false,
        failed: true,
        terminalEligible: false,
      }),
    ).toMatchObject({
      retryRecommendation: "retry_same_tool",
      nextAction: "retry",
      externalChangeRequired: false,
      recoverySource: "failed_gateway",
    });
  });

  it("re-enters a typed schema repair instead of asking the user", () => {
    expect(
      resolveWorkstationGatewayFollowupPolicy({
        observationPacket: packet("repair"),
        blocked: true,
        failed: false,
        terminalEligible: false,
      }),
    ).toEqual({
      retryRecommendation: "retry_same_tool",
      nextAction: "retry",
      externalChangeRequired: false,
      recoverySource: "blocked_gateway",
    });
  });
});
