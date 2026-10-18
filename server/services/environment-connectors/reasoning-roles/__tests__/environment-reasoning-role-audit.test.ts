import { describe, expect, it } from "vitest";
import type { HelixEnvironmentReasoningRoleProjection } from
  "@shared/helix-environment-reasoning-role";
import { auditEnvironmentReasoningRoleContinuity } from
  "../environment-reasoning-role-audit";

const base = (): HelixEnvironmentReasoningRoleProjection => ({
  schema: "helix.environment_reasoning_role_projection.v1",
  goal_id: "goal:g6",
  revision: 5,
  latest_event_hash: `sha256:${"a".repeat(64)}`,
  outputs: [{
    role_output_id: "output:g6",
    identity: { principal_turn_id: "turn:g6" },
    payload: { role_kind: "prospective_planning" },
  } as never],
  invalidated_output_ids: [],
  principal_dispositions: [{
    kind: "principal_disposition_recorded",
    role_output_id: "output:g6",
    principal_turn_id: "turn:g6",
    disposition: "adopted",
    adopted_capability_id: "minecraft.walk",
    adopted_capability_arguments_hash: `sha256:${"b".repeat(64)}`,
    rationale_summary: "Use the current proposal.",
  }],
  arbitrations: [{
    kind: "proposal_arbitrated",
    arbitration_id: "arbitration:g6",
    considered_role_output_ids: ["output:g6"],
    selected_role_output_id: "output:g6",
    status: "selected_one",
    reason: "Current and adopted.",
  }],
  execution_links: [{
    kind: "execution_link_recorded",
    arbitration_id: "arbitration:g6",
    role_output_id: "output:g6",
    environment_action_request_id: "action:g6",
    capability_id: "minecraft.walk",
  }],
  measured_result_links: [{
    kind: "measured_result_link_recorded",
    environment_action_request_id: "action:g6",
    environment_action_result_ref: "result:g6",
    principal_turn_id: "turn:g6",
    reentry_observation_ref: "reentry:g6",
  }],
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
});

describe("G6 environment reasoning continuity audit", () => {
  it("observes a continuous causal chain without acquiring authority", () => {
    expect(auditEnvironmentReasoningRoleContinuity(base())).toMatchObject({
      status: "consistent",
      first_divergent_stage: null,
      observer_only: true,
      can_admit: false,
      can_reject: false,
      can_rewrite: false,
      can_execute: false,
      terminal_eligible: false,
    });
  });

  it("identifies missing measured-result re-entry as the first divergence", () => {
    const projection = base();
    projection.measured_result_links = [];
    expect(auditEnvironmentReasoningRoleContinuity(projection)).toMatchObject({
      status: "divergent",
      first_divergent_stage: "measured_result_reentry",
    });
  });

  it("identifies a poisoned principal-turn projection without changing it", () => {
    const projection = base();
    projection.principal_dispositions[0].principal_turn_id = "turn:other";
    expect(auditEnvironmentReasoningRoleContinuity(projection)).toMatchObject({
      status: "divergent",
      first_divergent_stage: "principal_disposition",
    });
    expect(projection.principal_dispositions[0].principal_turn_id).toBe(
      "turn:other",
    );
  });
});
