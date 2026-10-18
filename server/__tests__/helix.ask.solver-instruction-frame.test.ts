import { describe, expect, it } from "vitest";

import { buildCapabilityPlan } from "../services/helix-ask/capability-planner";
import { buildSolverInstructionFrame } from "../services/helix-ask/solver-instruction-frame";

const sourceTarget = (target_source: string, target_kind = target_source) => ({
  schema: "helix.ask_source_target_intent.v1",
  turn_id: "ask:instruction",
  thread_id: "helix-ask:test",
  target_source,
  target_kind,
  strength: "hard",
  explicit_cues: [],
  reasons: [],
  requested_outputs: [],
  suppressed_routes: [],
  precedence_reason: "test",
  must_enter_backend_ask: true,
  allow_client_shortcut: false,
  allow_no_tool_direct: false,
  confidence: 0.9,
  assistant_answer: false,
  raw_content_included: false,
});

const toolAdmission = (sourceTargetValue: string, admitted: string[]) => ({
  schema: "helix.tool_call_admission_decision.v1",
  turn_id: "ask:instruction",
  source_target: sourceTargetValue,
  required: admitted.length > 0,
  admitted_tool_families: admitted,
  forbidden_terminal_artifact_kinds: ["no_tool_direct", "model_only_concept"],
  forbidden_routes: [],
  reason: "test",
  assistant_answer: false,
  raw_content_included: false,
});

const canonicalGoal = (goal_kind: string, required_terminal_kind: string | null) => ({
  turn_id: "ask:instruction",
  goal_kind,
  answer_scope: "workspace_state",
  required_terminal_kind,
  allows_workspace_context: true,
  allows_prior_artifacts: false,
  corpus_anchors: [],
  numeric_tokens: [],
  concept_tokens: [],
  confidence: "high",
  classifier_reasons: ["test"],
});

describe("Helix solver instruction frame", () => {
  it("keeps run-nothing constraints through capability planning", () => {
    const prompt = "Click Start, but run nothing.";
    const frame = buildSolverInstructionFrame({
      turnId: "ask:run-nothing",
      promptText: prompt,
      sourceTargetIntent: sourceTarget("workstation_panel"),
    });
    const plan = buildCapabilityPlan({
      turnId: "ask:run-nothing",
      promptText: prompt,
      sourceTargetIntent: sourceTarget("workstation_panel"),
      toolCallAdmissionDecision: toolAdmission("workstation_panel", []),
      canonicalGoalFrame: canonicalGoal("panel_control", "workspace_action_receipt"),
      instructionFrame: frame,
    });

    expect(frame.negative_user_constraints).toEqual(expect.arrayContaining(["run nothing"]));
    expect(frame.active_rules).toEqual(expect.arrayContaining(["negative_user_constraint_blocks_mutating_capability"]));
    expect(plan).toMatchObject({
      capability_family: "workstation_action",
      admission_status: "rejected",
      rejection_reason: "negative_user_constraint_blocks_mutating_capability",
    });
  });

  it("preserves do-not-change-cadence while inspecting live source status", () => {
    const prompt = "Inspect the live source status, but do not change cadence.";
    const frame = buildSolverInstructionFrame({
      turnId: "ask:cadence-status",
      promptText: prompt,
      sourceTargetIntent: sourceTarget("live_pipeline"),
    });
    const plan = buildCapabilityPlan({
      turnId: "ask:cadence-status",
      promptText: prompt,
      sourceTargetIntent: sourceTarget("live_pipeline"),
      toolCallAdmissionDecision: toolAdmission("live_pipeline", ["live_pipeline"]),
      canonicalGoalFrame: canonicalGoal("live_source_status", "source_binding_status"),
      instructionFrame: frame,
    });

    expect(frame.capability_permission_rules).toEqual(expect.arrayContaining(["do_not_change_cadence_without_affirmative_operator_command"]));
    expect(plan).toMatchObject({
      capability_family: "live_source",
      requested_action: "inspect_live_source",
      mutating: false,
      admission_status: "admitted",
    });
  });

  it("keeps visual-source equal identity for retrieval and comparison prompts", () => {
    const frame = buildSolverInstructionFrame({
      turnId: "ask:visual-compare",
      promptText: "Compare what the visual screen capture sees now to the last epoch.",
      sourceTargetIntent: sourceTarget("visual_capture", "visual_capture"),
    });

    expect(frame.source_identity_rules).toEqual(expect.arrayContaining([
      "visual_source_equal_identity_persists_across_retrieval_and_comparison",
      "source_identity_must_match_selected_source_binding",
    ]));
    expect(frame.active_rules).toEqual(expect.arrayContaining(["visual_source_equal_identity_required"]));
  });

  it("reinstalls receipt-is-not-answer for terminal composition", () => {
    const frame = buildSolverInstructionFrame({
      turnId: "ask:receipt",
      promptText: "Open the NH-M2 white paper from docs.",
      sourceTargetIntent: sourceTarget("docs_viewer"),
    });

    expect(frame.terminal_authority_rules).toEqual(expect.arrayContaining([
      "receipt_is_not_answer",
      "terminal_artifact_must_match_canonical_goal",
      "terminal_authority_must_run_after_solver_completion",
    ]));
    expect(frame.codex_boundary.codex_owned_runtime_forbidden).toEqual(expect.arrayContaining(["generic_tool_execution_loop"]));
    expect(frame.codex_boundary.helix_owned_policy_allowed).toEqual(expect.arrayContaining(["terminal_authority_policy"]));
    expect(frame).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
    });
  });
});
