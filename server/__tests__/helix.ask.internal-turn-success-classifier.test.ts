import { describe, expect, it } from "vitest";

import { classifyHelixInternalTurnSuccess } from "../services/helix-ask/internal-turn-success-classifier";
import { applyHelixProjectionMismatchGate } from "../services/helix-ask/projection-mismatch-gate";

const makeLedger = (turnId: string, includeDraft = true) => [
  {
    artifact_id: `${turnId}:obs`,
    kind: "agent_step_observation_packet",
    payload: {
      schema: "helix.agent_step_observation_packet.v1",
      status: "succeeded",
      terminal_eligible: false,
      post_tool_model_step_required: true,
    },
  },
  ...(includeDraft
    ? [
        {
          artifact_id: `${turnId}:draft`,
          kind: "final_answer_draft",
          payload: {
            schema: "helix.final_answer_draft.v1",
            text: "docs-viewer has been successfully opened.",
          },
        },
      ]
    : []),
];

describe("Helix internal turn success classifier", () => {
  it("classifies internal success and visible success", () => {
    const turnId = "ask:test:internal-visible-success";
    const result = classifyHelixInternalTurnSuccess({
      turn_id: turnId,
      artifact_ledger: makeLedger(turnId),
      terminal_authority_single_writer_result: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        turn_id: turnId,
        selected_terminal_artifact_ref: `${turnId}:draft`,
        selected_terminal_artifact_kind: "model_synthesized_answer",
        visible_text: "docs-viewer has been successfully opened.",
        assistant_answer: false,
        source: "final_answer_draft",
        rejected_candidates: [],
        writes: {
          payload_text: "docs-viewer has been successfully opened.",
          payload_answer: "docs-viewer has been successfully opened.",
          payload_assistant_answer: "docs-viewer has been successfully opened.",
          payload_selected_final_answer: "docs-viewer has been successfully opened.",
          terminal_presentation_concise_text: "docs-viewer has been successfully opened.",
          debug_selected_final_answer: "docs-viewer has been successfully opened.",
        },
        integrity: {
          single_writer_applied: true,
          visible_matches_selected_artifact: true,
          visible_matches_draft: true,
          stale_failure_visible: false,
          receipt_visible_as_answer: false,
          post_tool_model_step_satisfied: true,
          legacy_terminal_candidate_count: 0,
          forbidden_terminal_candidate_count: 1,
          payload_mirror_written_after_terminal_selection: true,
        },
      },
      visible_text: "docs-viewer has been successfully opened.",
      stage: "pre_response_send",
    });

    expect(result.outcome).toBe("internal_success_and_visible_success");
    expect(result.internal.tool_path_succeeded).toBe(true);
    expect(result.internal.post_tool_model_step_satisfied).toBe(true);
    expect(result.visible.visible_matches_final_answer_draft).toBe(true);
  });

  it("classifies internal success with visible failure", () => {
    const turnId = "ask:test:internal-visible-failure";
    const result = classifyHelixInternalTurnSuccess({
      turn_id: turnId,
      artifact_ledger: makeLedger(turnId),
      visible_text: "I could not produce a terminal answer for this turn.",
      stage: "pre_response_send",
    });

    expect(result.outcome).toBe("internal_success_visible_failure");
    expect(result.internal.final_answer_draft_exists).toBe(true);
    expect(result.visible.generic_terminal_failure_visible).toBe(true);
  });
});

describe("Helix projection mismatch gate", () => {
  it("repairs internal success visible failure by invoking the single writer", () => {
    const turnId = "ask:test:projection-repair";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
    };
    const result = applyHelixProjectionMismatchGate({
      turn_id: turnId,
      artifact_ledger: makeLedger(turnId),
      current_payload: payload,
      current_visible_text: "I could not produce a terminal answer for this turn.",
      thread_id: "thread:test",
    });

    expect(result.internal_turn_success.outcome).toBe("internal_success_and_visible_success");
    expect(result.internal_turn_success.repair).toMatchObject({
      repair_attempted: true,
      repair_action: "invoke_terminal_authority_single_writer",
      repair_succeeded: true,
    });
    expect(payload.selected_final_answer).toBe("docs-viewer has been successfully opened.");
    expect(payload.terminal_authority_single_writer).toBeTruthy();
    expect(result.terminal_projection_health.projection_mismatch_repaired).toBe(true);
  });

  it("does not fabricate success for true internal failure", () => {
    const turnId = "ask:test:true-internal-failure";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      final_answer_source: "typed_failure",
    };
    const result = applyHelixProjectionMismatchGate({
      turn_id: turnId,
      artifact_ledger: makeLedger(turnId, false),
      current_payload: payload,
      current_visible_text: "I could not produce a terminal answer for this turn.",
    });

    expect(result.internal_turn_success.outcome).toBe("internal_failure_visible_failure");
    expect(payload.selected_final_answer).toBe("I could not produce a terminal answer for this turn.");
  });
});
