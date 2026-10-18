import { describe, expect, it } from "vitest";

import {
  buildHelixCausalTurnTimelineSummary,
  getHelixCausalTurnTimeline,
} from "../services/helix-ask/causal-turn-timeline";

const electronProtonAnswer = [
  "- Charge: electrons are negative, while protons are positive.",
  "- Mass: a proton has about 1836 times the electron's mass.",
  "- Role in atoms: electrons occupy shells/clouds and participate in bonding; protons sit in the nucleus and help define element identity.",
  "Practical consequence: opposite charges bind electrons to nuclei, enabling stable atoms and chemistry.",
].join("\n");

const stages = (payload: Record<string, unknown>) =>
  getHelixCausalTurnTimeline(payload).events.map((event) => event.stage);

describe("Helix causal turn timeline", () => {
  it("records the model-only compound answer path and stale route-label supersession", () => {
    const turnId = "turn:timeline:electron-proton";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      route_reason_code: "clarify:missing_args",
      selected_final_answer: electronProtonAnswer,
      answer: electronProtonAnswer,
      text: electronProtonAnswer,
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "model_only_concept",
      },
      source_target_intent: {
        target_source: "unknown",
        target_kind: "unknown",
      },
      agent_step_decision: {
        next_step: "answer",
        chosen_capability: "model.direct_answer",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "direct-answer-1",
          kind: "direct_answer_text",
          payload: {
            text: electronProtonAnswer,
          },
        },
        {
          artifact_id: "final-draft-1",
          kind: "final_answer_draft",
          payload: {
            text: electronProtonAnswer,
          },
        },
      ],
      compound_prompt_coverage_gate: {
        passed: true,
        decision: "PASS",
        reason: "model_only_compound_answer_covers_required_parts",
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        reason: "model_only_compound_answer_covers_required_parts",
      },
      solver_controller_decision: {
        decision: "allow_terminal",
        blocking_reasons: [],
      },
      terminal_answer_authority: {
        terminal_artifact_kind: "direct_answer_text",
        terminal_text_hash: "hash:test",
      },
    };

    const timeline = getHelixCausalTurnTimeline(payload);
    const orderedStages = timeline.events.map((event) => event.stage);
    expect(orderedStages).toEqual(
      expect.arrayContaining([
        "prompt_received",
        "goal_classified",
        "source_target_decided",
        "route_label_set",
        "model_step_decided",
        "deterministic_fallback_used",
        "model_answer_artifact_created",
        "coverage_gate_evaluated",
        "goal_satisfaction_evaluated",
        "solver_controller_decided",
        "terminal_artifact_selected",
        "visible_response_written",
      ]),
    );
    expect(orderedStages.indexOf("coverage_gate_evaluated")).toBeLessThan(
      orderedStages.indexOf("terminal_artifact_selected"),
    );
    const fallbackEvent = timeline.events.find((event) => event.stage === "deterministic_fallback_used");
    expect(fallbackEvent?.fallback?.rule_id).toBe("model_only_fallback.electron_proton_comparison");
    expect(timeline.integrity.stale_route_label_detected).toBe(true);
    expect(timeline.integrity.deterministic_fallback_without_rule_id).toBe(false);

    const summary = buildHelixCausalTurnTimelineSummary({ payload, timeline });
    expect(summary).toMatchObject({
      selected_terminal_artifact_kind: "direct_answer_text",
      selected_capability: "model.direct_answer",
      deterministic_fallback_used: true,
      fallback_rule_id: "model_only_fallback.electron_proton_comparison",
      stale_route_label_detected: true,
    });
  });

  it("records workstation tool observation before terminal selection", () => {
    const turnId = "turn:timeline:docs-open";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      route_reason_code: "workstation_action",
      selected_final_answer: "The docs viewer has been successfully opened.",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "workstation_tool",
      },
      source_target_intent: {
        target_source: "workstation_panel",
      },
      available_capabilities: {
        entries: [{ capability_key: "docs-viewer.open" }],
      },
      agent_step_decision: {
        next_step: "use_capability",
        chosen_capability: "docs-viewer.open",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "receipt-1",
          kind: "workspace_action_receipt",
          payload: {
            status: "succeeded",
          },
        },
        {
          artifact_id: "final-draft-1",
          kind: "final_answer_draft",
          payload: {
            text: "The docs viewer has been successfully opened.",
          },
        },
      ],
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      solver_controller_decision: {
        decision: "allow_terminal",
      },
      terminal_answer_authority: {
        terminal_artifact_kind: "model_synthesized_answer",
      },
    };

    const orderedStages = stages(payload);
    expect(orderedStages).toEqual(
      expect.arrayContaining([
        "tool_surface_built",
        "model_step_decided",
        "tool_observation_created",
        "model_answer_artifact_created",
        "terminal_artifact_selected",
        "visible_response_written",
      ]),
    );
    expect(orderedStages.indexOf("tool_observation_created")).toBeLessThan(
      orderedStages.indexOf("terminal_artifact_selected"),
    );
  });

  it("records repo evidence observation before repo terminal selection", () => {
    const turnId = "turn:timeline:repo-evidence";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      route_reason_code: "repo_code_evidence",
      selected_final_answer: "Auntie Dottie is the app's voice/persona layer backed by Situation Room context.",
      terminal_artifact_kind: "repo_code_evidence_answer",
      final_answer_source: "repo_code_evidence_answer",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "repo_entity_definition",
      },
      source_target_intent: {
        target_source: "repo_code",
      },
      agent_step_decision: {
        next_step: "answer",
        chosen_capability: "model.synthesize_from_repo_evidence",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "repo-obs-1",
          kind: "repo_code_evidence_observation",
          payload: {
            refs: ["docs/helix-ask-flow.md"],
          },
        },
        {
          artifact_id: "repo-answer-1",
          kind: "repo_code_evidence_answer",
          payload: {
            text: "Auntie Dottie is the app's voice/persona layer backed by Situation Room context.",
          },
        },
      ],
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      solver_controller_decision: {
        decision: "allow_terminal",
      },
      terminal_answer_authority: {
        terminal_artifact_kind: "repo_code_evidence_answer",
      },
    };

    const orderedStages = stages(payload);
    expect(orderedStages).toEqual(
      expect.arrayContaining([
        "goal_classified",
        "repo_evidence_observation_created",
        "model_step_decided",
        "terminal_artifact_selected",
        "visible_response_written",
      ]),
    );
    expect(orderedStages.indexOf("repo_evidence_observation_created")).toBeLessThan(
      orderedStages.indexOf("model_step_decided"),
    );
    expect(orderedStages.indexOf("model_step_decided")).toBeLessThan(
      orderedStages.indexOf("terminal_artifact_selected"),
    );
  });

  it("records typed failure as the selected terminal product when projection fails after a candidate exists", () => {
    const turnId = "turn:timeline:terminal-error";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      route_reason_code: "calculator_solve / calculator_compound_chain",
      selected_final_answer: "I could not complete this turn because the terminal boundary blocked it.",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "terminal_boundary_ineligible",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "calculator_solve",
      },
      source_target_intent: {
        target_source: "calculator_stream",
      },
      agent_step_decision: {
        next_step: "answer",
        chosen_capability: "scientific-calculator.solve_expression",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "final-draft-1",
          kind: "final_answer_draft",
          payload: {
            text: "2*(3+4)=14.",
          },
        },
      ],
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        next_decision: "fail_closed",
      },
      solver_controller_decision: {
        decision: "allow_terminal",
      },
      terminal_authority_single_writer: {
        selected_terminal_artifact_kind: "model_synthesized_answer",
        selected_terminal_artifact_ref: "final-draft-1",
      },
      terminal_answer_authority: {
        terminal_artifact_kind: "typed_failure",
      },
    };

    const timeline = getHelixCausalTurnTimeline(payload);
    const summary = buildHelixCausalTurnTimelineSummary({ payload, timeline });

    expect(summary).toMatchObject({
      outcome: "terminal_error",
      selected_terminal_artifact_kind: "typed_failure",
    });
    const terminalEvent = timeline.events.find((event) => event.stage === "terminal_artifact_selected");
    expect(terminalEvent?.terminal?.selected_terminal_artifact_kind).toBe("typed_failure");
  });
});
