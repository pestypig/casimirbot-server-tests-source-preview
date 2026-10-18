import { describe, expect, it } from "vitest";
import {
  helixEnvironmentCheckpointPublicOutcomeSchema,
} from "@shared/helix-environment-checkpoint-public-outcome";
import type { HelixEnvironmentCheckpointDecisionContext } from
  "@shared/helix-environment-checkpoint-decision";
import { materializeResponsesCheckpointDecision } from "../responses-checkpoint-choice";
import { projectResponsesCheckpointPublicOutcome } from
  "../responses-checkpoint-public-outcome";

const context = (): HelixEnvironmentCheckpointDecisionContext => ({
  environment_id: "environment:1", source_id: "source:1", subject_id: "subject:1",
  goal_id: "goal:1", goal_revision: 1, predecessor_plan_id: "plan:1",
  predecessor_plan_hash: `sha256:${"a".repeat(64)}`,
  checkpoint_id: "checkpoint:1", observation_ref: "observation:1",
  observation_revision: 1, affordance_revision: 1, producer_epoch: "epoch:1",
  authority_id: "authority:1", authority_revision: 1,
  monotonic_origin_id: "process:1", current_unit: 100,
  current_monotonic_ms: 1_000, maximum_proposal_horizon_units: 10,
  maximum_proposal_lifetime_ms: 500, interruption_pending: false,
});
const response = (status = "completed") => ({
  object: "response", status, error: null, incomplete_details: null,
  output: [{ type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: JSON.stringify({
      disposition: "hold_safe", rationale_code: "obstacle_detected",
    }) }] }],
});
const scope = () => ({ run_id: "run:1", goal_id: "goal:1",
  checkpoint_id: "checkpoint:1", observation_ref: "observation:1",
  producer_epoch: "epoch:1" });
const observedAt = "2026-09-30T12:00:00.000Z";

describe("Responses checkpoint public outcome", () => {
  it("projects only a powerless, exact-checkpoint disposition", () => {
    const result = materializeResponsesCheckpointDecision(
      response(), context(), context(), "decision:host", 5, 250,
    );
    const projection = projectResponsesCheckpointPublicOutcome({
      result, invocationContext: context(), currentContext: context(),
      scope: scope(), observedAt,
    });
    expect(projection).toMatchObject({
      run_id: "run:1", checkpoint_id: "checkpoint:1", status: "proposal",
      decision_id: "decision:host", disposition: "hold_safe", reason: null,
      execution_authority: false, action_authority_granted: false,
      answer_authority: false, assistant_answer: false, terminal_eligible: false,
      raw_response_included: false, private_reasoning_included: false,
    });
    expect(JSON.stringify(projection)).not.toContain("obstacle_detected");
    expect(helixEnvironmentCheckpointPublicOutcomeSchema.safeParse(projection).success).toBe(true);
  });

  it("labels incomplete output as rejected without copying provider text", () => {
    const result = materializeResponsesCheckpointDecision(
      response("incomplete"), context(), context(), "decision:host", 5, 250,
    );
    expect(projectResponsesCheckpointPublicOutcome({
      result, invocationContext: context(), currentContext: context(),
      scope: scope(), observedAt,
    })).toMatchObject({ status: "rejected", reason: "response_not_complete",
      decision_id: null, disposition: null });
  });

  it("does not relabel a rejected provider result after checkpoint identity rotates", () => {
    const result = materializeResponsesCheckpointDecision(
      response("incomplete"), context(), context(), "decision:host", 5, 250,
    );
    for (const changed of [
      { source_id: "source:2" }, { subject_id: "subject:2" },
      { goal_revision: 2 }, { predecessor_plan_id: "plan:2" },
      { observation_revision: 2 }, { affordance_revision: 2 },
      { authority_id: "authority:2" }, { authority_revision: 2 },
      { monotonic_origin_id: "process:2" },
    ]) {
      expect(projectResponsesCheckpointPublicOutcome({ result,
        invocationContext: context(), currentContext: { ...context(), ...changed },
        scope: scope(), observedAt })).toBeNull();
    }
  });

  it("never displays a result under a different run checkpoint or epoch", () => {
    const result = materializeResponsesCheckpointDecision(
      response(), context(), context(), "decision:host", 5, 250,
    );
    for (const changes of [
      { checkpoint_id: "checkpoint:2" }, { observation_ref: "observation:2" },
      { producer_epoch: "epoch:2" }, { goal_id: "goal:2" },
    ]) {
      expect(projectResponsesCheckpointPublicOutcome({
        result, invocationContext: context(), currentContext: context(),
        scope: { ...scope(), ...changes }, observedAt,
      })).toBeNull();
    }
    expect(projectResponsesCheckpointPublicOutcome({
      result, invocationContext: context(),
      currentContext: { ...context(), checkpoint_id: "checkpoint:2" },
      scope: scope(), observedAt,
    })).toBeNull();
    expect(projectResponsesCheckpointPublicOutcome({
      result, invocationContext: context(),
      currentContext: { ...context(), authority_revision: 2 },
      scope: scope(), observedAt,
    })).toBeNull();
  });

  it("rejects malformed public receipts and never upgrades a rejection", () => {
    const result = materializeResponsesCheckpointDecision(
      response("incomplete"), context(), context(), "decision:host", 5, 250,
    );
    const projected = projectResponsesCheckpointPublicOutcome({
      result, invocationContext: context(), currentContext: context(),
      scope: scope(), observedAt,
    });
    expect(helixEnvironmentCheckpointPublicOutcomeSchema.safeParse({
      ...projected, execution_authority: true,
    }).success).toBe(false);
    expect(helixEnvironmentCheckpointPublicOutcomeSchema.safeParse({
      ...projected, status: "proposal", disposition: "continue_same_goal",
    }).success).toBe(false);
  });
});
