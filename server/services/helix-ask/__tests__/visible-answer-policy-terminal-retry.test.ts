import { describe, expect, it } from "vitest";

import {
  buildVisibleAnswerPolicyTerminalRetryRejectedState,
  buildVisibleAnswerPolicyTerminalRetryMarker,
  readVisibleAnswerPolicyTerminalRetryRequest,
  theoryExecutionClosureViolationIsTerminallyRepairable,
  visibleAnswerPolicyTerminalRetrySucceeded,
} from "../visible-answer-policy-terminal-retry";
import type { HelixAgentContinuationState } from "@shared/helix-agent-continuation-state";

const repairablePayload = (): Record<string, unknown> => ({
  visible_answer_policy_faithfulness_rejection: {
    schema: "helix.visible_answer_policy_faithfulness_rejection.v1",
    turn_id: "ask:test:visible-policy-retry",
    rejected_terminal_artifact_kind: "model_synthesized_answer",
    rejected_final_answer_source: "final_answer_draft",
    violation: "theory_execution_closure_physical_truth_overclaim",
    repairable: true,
    retry_required: true,
    assistant_answer: false,
    raw_content_included: false,
  },
});

describe("visible answer policy terminal retry", () => {
  it("admits exactly one explicit repairable closure-policy retry", () => {
    const payload = repairablePayload();

    expect(
      readVisibleAnswerPolicyTerminalRetryRequest(
        payload,
        "ask:test:visible-policy-retry",
      ),
    ).toEqual({
      violation: "theory_execution_closure_physical_truth_overclaim",
      rejectedTerminalArtifactKind: "model_synthesized_answer",
      rejectedFinalAnswerSource: "final_answer_draft",
    });

    payload.visible_answer_policy_terminal_retry =
      buildVisibleAnswerPolicyTerminalRetryMarker({
        turnId: "ask:test:visible-policy-retry",
        violation: "theory_execution_closure_physical_truth_overclaim",
        status: "attempting",
        outcome: "provider_terminal_recovery_started",
      });

    expect(
      readVisibleAnswerPolicyTerminalRetryRequest(
        payload,
        "ask:test:visible-policy-retry",
      ),
    ).toBeNull();
    expect(payload.visible_answer_policy_terminal_retry).toMatchObject({
      schema: "helix.visible_answer_policy_terminal_retry.v1",
      attempt_count: 1,
      attempt_limit: 1,
      status: "attempting",
    });
  });

  it.each([
    "theory_execution_closure_artifact_invalid",
    "theory_execution_closure_synthesis_blocked",
    "route_contract_forbidden",
  ])("fails closed for non-repairable violation %s", (violation) => {
    const payload = repairablePayload();
    payload.visible_answer_policy_faithfulness_rejection = {
      schema: "helix.visible_answer_policy_faithfulness_rejection.v1",
      violation,
      repairable: false,
      retry_required: false,
    };

    expect(
      theoryExecutionClosureViolationIsTerminallyRepairable(violation),
    ).toBe(false);
    expect(readVisibleAnswerPolicyTerminalRetryRequest(payload)).toBeNull();
  });

  it("ignores stale rejection and retry markers from another turn", () => {
    const payload = repairablePayload();
    (
      payload.visible_answer_policy_faithfulness_rejection as Record<
        string,
        unknown
      >
    ).turn_id = "ask:test:current-turn";
    payload.visible_answer_policy_terminal_retry =
      buildVisibleAnswerPolicyTerminalRetryMarker({
        turnId: "ask:test:prior-turn",
        violation: "theory_execution_closure_physical_truth_overclaim",
        status: "exhausted",
      });
    expect(
      readVisibleAnswerPolicyTerminalRetryRequest(
        payload,
        "ask:test:current-turn",
      ),
    ).not.toBeNull();

    const current = repairablePayload();
    expect(
      readVisibleAnswerPolicyTerminalRetryRequest(
        current,
        "ask:test:visible-policy-retry",
      ),
    ).not.toBeNull();
  });

  it("never treats a missing terminal selection as a successful retry", () => {
    expect(
      visibleAnswerPolicyTerminalRetrySucceeded({
        selectedTerminalArtifactKind: null,
        finalAnswerSource: null,
        visibleText: "candidate text",
        repeatedPolicyRejection: null,
      }),
    ).toBe(false);
    expect(
      visibleAnswerPolicyTerminalRetrySucceeded({
        selectedTerminalArtifactKind: "typed_failure",
        finalAnswerSource: "typed_failure",
        visibleText: "bounded failure",
        repeatedPolicyRejection: null,
      }),
    ).toBe(false);
    expect(
      visibleAnswerPolicyTerminalRetrySucceeded({
        selectedTerminalArtifactKind: "model_synthesized_answer",
        finalAnswerSource: "agent_provider_terminal_candidate",
        visibleText: "bounded answer",
        repeatedPolicyRejection: null,
      }),
    ).toBe(true);
  });

  it("restores a blocked unsatisfied continuation state when repair is exhausted", () => {
    const provisional = {
      schema: "helix.agent_continuation_state.v1",
      turn_id: "ask:test:visible-policy-retry",
      state_id: "ask:test:visible-policy-retry:state:2",
      sequence: 2,
      trigger: "final_review",
      goal: {
        status: "satisfied",
        satisfied: true,
        terminal_product_allowed: true,
      },
      observation_refs: { all: [], existing: [], new: [] },
      missing_requirement_ids: [],
      last_attempt: null,
      next_admissible_affordances: [],
      tried_action_fingerprints: [],
      progress: {
        made_progress: true,
        new_observation_count: 0,
        resolved_requirement_ids: [],
        added_requirement_ids: [],
        new_affordance_count: 0,
        no_progress_repeat_count: 0,
        reason_codes: ["runtime_agent_terminal_recovery_completed"],
      },
      budget: {
        soft: {
          iterations: { max: 3, consumed: 2, remaining: 1 },
          tool_calls: { max: 3, consumed: 1, remaining: 2 },
          model_decisions: { max: 3, consumed: 2, remaining: 1 },
          pressure: "none",
          exhausted: false,
        },
        hard: {
          iterations: { max: 6, consumed: 2, remaining: 4 },
          tool_calls: { max: 6, consumed: 1, remaining: 5 },
          model_decisions: { max: 6, consumed: 2, remaining: 4 },
          exhausted: false,
        },
        extension_count: 0,
        max_extensions: 0,
      },
      allowed_decisions: ["answer"],
      authority: "runtime_agent_decides_within_admitted_boundaries",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    } satisfies HelixAgentContinuationState;
    const rejected =
      buildVisibleAnswerPolicyTerminalRetryRejectedState({
        turnId: provisional.turn_id,
        provisionalState: provisional,
      });
    expect(rejected).toMatchObject({
      sequence: 3,
      goal: {
        status: "blocked",
        satisfied: false,
        terminal_product_allowed: false,
      },
      progress: { made_progress: false },
      allowed_decisions: ["fail"],
    });
  });
});
