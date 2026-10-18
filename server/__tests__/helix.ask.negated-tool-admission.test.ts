import { describe, expect, it } from "vitest";

import { HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY } from "@shared/helix-scholarly-research-observation";
import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";
import { buildAskTurnSolverTrace, evaluateAskTurnSolverHardGate } from "../services/helix-ask/ask-turn-solver";
import { buildCapabilityLifecycleLedger } from "../services/helix-ask/capability-lifecycle-ledger";
import { buildHelixCapabilityItinerary } from "../services/helix-ask/capability-itinerary";
import { buildCapabilityPlan } from "../services/helix-ask/capability-planner";
import { buildSolverContinuationObservation } from "../services/helix-ask/solver-continuation";
import { buildToolCallAdmissionDecision } from "../services/helix-ask/tool-call-admission";
import {
  __testHelixAgentStepActionResolution,
  __testHelixCalculatorCompoundPlanning,
  __testHelixEvidenceRetrievalFailure,
  __testHelixGoalSatisfaction,
  __testHelixRuntimeToolCallValidation,
} from "../routes/agi.plan";

const turnId = "ask:test:negated-tool-admission";
const threadId = "helix-ask:test";

const canonicalGoal = {
  turn_id: turnId,
  goal_kind: "model_only_concept",
  answer_scope: "model_only",
  required_terminal_kind: "direct_answer_text",
  allows_workspace_context: false,
  allows_prior_artifacts: false,
  corpus_anchors: [],
  numeric_tokens: [],
  concept_tokens: [],
  confidence: "high",
  classifier_reasons: ["test"],
};

const availableCapabilities = (keys: string[]) => ({
  schema: "helix.available_capabilities.v1",
  turn_id: turnId,
  manifest_role: "model_visible_tool_menu",
  tool_manifest_version: "helix.ask.capability_manifest.v1",
  user_goal_summary: "test",
  canonical_goal_kind: "scholarly_research_lookup",
  model_visible_capability_keys: keys,
  recommended_capability_key: keys[0] ?? null,
  classifier_hints: [],
  capabilities: keys.map((key) => ({
    capability_key: key,
    label: key,
    lane: "retrieval",
    requires_action: true,
    expected_artifacts: [],
    goal_fit: "primary",
    reason: "test",
    model_visible_name: key,
    model_visible_description: key,
    availability: "available",
  })),
  assistant_answer: false,
  raw_content_included: false,
});

describe("Helix Ask negated/contextual tool admission", () => {
  it("keeps natural no-workstation requests on the model-only route", () => {
    const prompts = [
      "In plain language, explain the difference between a scientific hypothesis and a scientific theory without using workstation tools.",
      "Without using workstation tools, compare a scientific hypothesis with a scientific theory and give one example of each.",
      "Do not use the workstation tools; explain the distinction from general reasoning.",
    ];

    for (const promptText of prompts) {
      const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
      const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });

      expect(sourceTargetIntent).toMatchObject({
        target_source: "model_only",
        target_kind: "general_background",
        allow_no_tool_direct: true,
      });
      expect(admission).toMatchObject({
        source_target: "model_only",
        required: false,
        admitted_tool_families: ["model_only"],
      });
    }
  });

  it("recognizes capability lane observation packets as admission evidence for actual lane calls", () => {
    const trace = buildAskTurnSolverTrace({
      turnId: "ask:test:tts-lane-admission",
      promptText: "Translate a sentence, then read it aloud.",
      selectedRoute: "agent_provider",
      terminalArtifactKind: "agent_provider_terminal_candidate",
      finalAnswerSource: "agent_provider_terminal_candidate",
      payload: {
        turn_id: "ask:test:tts-lane-admission",
        tool_call_admission_decision: {
          schema: "helix.tool_call_admission_decision.v1",
          admitted_tool_families: [],
          assistant_answer: false,
          raw_content_included: false,
        },
        current_turn_artifact_ledger: [
          {
            schema: "helix.current_turn_artifact.v1",
            kind: "capability_lane_observation_packet",
            payload_schema: "helix.agent_step_observation_packet.v1",
            ref: "ask:test:tts-lane-admission:capability_lane:text_to_speech.speak_text:receipt",
            capability_key: "text_to_speech.speak_text",
            status: "blocked",
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
      },
      loopParityTrace: {
        actual_tool_calls: [
          {
            tool_name: "text_to_speech.speak_text",
            admitted: false,
            mutating: false,
          },
        ],
      },
    });

    expect(trace.tool_admission_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_id: "text_to_speech.speak_text",
          admitted: true,
          reason: "actual_tool_call_matched_capability_lane_observation",
        }),
      ]),
    );
    expect(trace.tool_admission_candidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_id: "text_to_speech.speak_text",
          reason: "actual_tool_call_missing_admission",
        }),
      ]),
    );
  });

  it("does not classify conditional prior-evidence calculator follow-up as an explicit calculator command", () => {
    const promptText =
      "If the previous answer has enough cited unit-bearing values, bind the formula into a numeric expression and run the calculator. Then explain what the result means and what the evidence does not prove.";

    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });

    expect(sourceTargetIntent.target_source).not.toBe("calculator_stream");
    expect(admission.source_target).not.toBe("calculator_stream");
    expect(admission.admitted_tool_families).not.toContain("calculator");
  });

  it("still admits calculator for conditional prior-evidence follow-up with a concrete expression", () => {
    const promptText =
      "If the previous answer has enough cited unit-bearing values, run the calculator with expression: 6.626e-34 * 5e14.";

    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });

    expect(admission.source_target).toBe("calculator_stream");
    expect(admission.admitted_tool_families).toContain("calculator");
  });

  it("suppresses contextual docs-viewer references before tool admission", () => {
    const prompts = [
      "Do not open the docs viewer; just explain what the docs viewer is for.",
      "Explain what would happen if I opened the docs viewer.",
      '"Open the docs viewer" is the command I typed; explain what it means.',
      "I opened the docs viewer earlier; what is it for?",
      "Earlier I saw the docs-viewer.search_docs tool mentioned in debug. Do not run it; just explain whether mentioning a tool name should execute it.",
    ];

    for (const promptText of prompts) {
      const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
      const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });
      const plan = buildCapabilityPlan({
        turnId,
        promptText,
        sourceTargetIntent,
        toolCallAdmissionDecision: admission,
        canonicalGoalFrame: canonicalGoal,
      });

      expect(sourceTargetIntent).toMatchObject({
        target_source: "model_only",
        target_kind: "general_background",
        allow_no_tool_direct: true,
      });
      expect(admission).toMatchObject({
        source_target: "model_only",
        required: false,
        admitted_tool_families: ["model_only"],
        tool_admission_suppressed: true,
      });
      expect(plan).toMatchObject({
        source_target: "model_only",
        requested_action: "suppressed_contextual_tool_reference",
        tool_admission_suppressed: true,
      });
      expect(plan.capability_family).not.toBe("docs");
      expect(plan.capability_family).not.toBe("repo_evidence");
    }
  });

  it("allows terminal direct answers after compliant contextual tool suppression", () => {
    const promptText =
      "Earlier I saw docs-viewer.search_docs in debug. Do not run it; just explain whether mentioning a tool name should execute it.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });
    const plan = buildCapabilityPlan({
      turnId,
      promptText,
      sourceTargetIntent,
      toolCallAdmissionDecision: admission,
      canonicalGoalFrame: canonicalGoal,
    });
    const payload = {
      active_prompt: promptText,
      selected_final_answer: "Mentioning a tool name should not execute it unless the prompt is an affirmative operator command.",
      final_answer_source: "model_synthesis",
      terminal_artifact_kind: "direct_answer_text",
      canonical_goal_frame: canonicalGoal,
      source_target_intent: sourceTargetIntent,
      tool_call_admission_decision: admission,
      capability_plan: plan,
      route_authority_audit: {
        schema: "helix.route_authority_audit.v1",
        route_authority_ok: true,
      },
      poison_audit: {
        schema: "helix.turn_poison_audit.v1",
        ok: true,
        violations: [],
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "conversation:simple",
        terminal_artifact_kind: "direct_answer_text",
        final_answer_source: "model_synthesis",
        server_authoritative: true,
      },
      loop_parity_trace: {
        schema: "helix.loop_parity_trace.v1",
        actual_tool_calls: [],
        unexpected_tool_calls: [],
        route_authority_ok: true,
        poison_audit_ok: true,
        terminal_authority_ok: true,
      },
    };

    const trace = buildAskTurnSolverTrace({
      turnId,
      promptText,
      selectedRoute: "conversation:simple",
      terminalArtifactKind: "direct_answer_text",
      finalAnswerSource: "model_synthesis",
      payload,
    });

    expect(trace.contextual_tool_audit.blocked_contextual_tool_executed).toBe(false);
    expect(trace.completed_solver_path).toBe(true);
    expect(trace.solver_risk_flags).not.toContain("terminal_authority_before_solver_completion");
  });

  it("does not convert satisfied suppressed contextual tool answers into route-authority typed failures", () => {
    const promptText =
      "Earlier I saw docs-viewer.search_docs in debug. Do not run it; just explain whether mentioning a tool name should execute it.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });
    const plan = buildCapabilityPlan({
      turnId,
      promptText,
      sourceTargetIntent,
      toolCallAdmissionDecision: admission,
      canonicalGoalFrame: canonicalGoal,
    });
    const payload = {
      active_prompt: promptText,
      selected_final_answer: "Mentioning a tool name should not execute it unless the prompt is an affirmative operator command.",
      final_answer_source: "model_synthesis",
      terminal_artifact_kind: "direct_answer_text",
      canonical_goal_frame: canonicalGoal,
      source_target_intent: sourceTargetIntent,
      tool_call_admission_decision: admission,
      capability_plan: plan,
      route_authority_audit: {
        schema: "helix.route_authority_audit.v1",
        route_authority_ok: false,
        violation_codes: ["poison_clean_but_authority_failed"],
        primary_violation_code: "poison_clean_but_authority_failed",
      },
      poison_audit: {
        schema: "helix.turn_poison_audit.v1",
        ok: true,
        violations: [],
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "conversation:simple",
        terminal_artifact_kind: "direct_answer_text",
        final_answer_source: "model_synthesis",
        server_authoritative: true,
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        turn_id: turnId,
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        required_evidence: [
          {
            kind: "direct_answer_text",
            satisfied: true,
            evidence_ref: "direct_answer_text:test",
          },
        ],
        terminal_contract: {
          goal_kind: "model_only_concept",
          required_terminal_kinds: ["direct_answer_text"],
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      loop_parity_trace: {
        schema: "helix.loop_parity_trace.v1",
        actual_tool_calls: [],
        unexpected_tool_calls: [],
        route_authority_ok: false,
        poison_audit_ok: true,
        terminal_authority_ok: true,
        short_circuit_risk_flags: ["poison_clean_but_authority_failed"],
      },
      current_turn_artifact_ledger: [],
    };

    payload.ask_turn_solver_trace = buildAskTurnSolverTrace({
      turnId,
      promptText,
      selectedRoute: "conversation:simple",
      terminalArtifactKind: "direct_answer_text",
      finalAnswerSource: "model_synthesis",
      payload,
    });

    expect(
      buildSolverContinuationObservation({
        turnId,
        payload,
        hardGateCode: "poison_clean_but_authority_failed",
        finalRoute: "conversation:simple",
        terminalKind: "direct_answer_text",
        artifactLedger: [],
      }),
    ).toBeNull();

    const hardGate = evaluateAskTurnSolverHardGate({
      turnId,
      payload,
      trace: payload.ask_turn_solver_trace,
      loopParityTrace: payload.loop_parity_trace,
    });

    expect(hardGate.failed).toBe(false);
    expect(hardGate.failure_codes).not.toContain("poison_clean_but_authority_failed");
    expect(payload.ask_turn_solver_trace.contextual_tool_audit).toMatchObject({
      contextual_tool_family_blocked: true,
      blocked_contextual_tool_executed: false,
    });
  });

  it("does not flag intentionally suppressed contextual references as dispatched without admission", () => {
    const promptText =
      "Earlier I saw docs-viewer.search_docs in debug. Do not run it; just explain whether mentioning a tool name should execute it.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });
    const plan = buildCapabilityPlan({
      turnId,
      promptText,
      sourceTargetIntent,
      toolCallAdmissionDecision: admission,
      canonicalGoalFrame: canonicalGoal,
    });
    const ledger = buildCapabilityLifecycleLedger({
      turnId,
      terminalArtifactKind: "direct_answer_text",
      payload: {
        terminal_artifact_kind: "direct_answer_text",
        canonical_goal_frame: canonicalGoal,
        capability_plan: plan,
        loop_parity_trace: {
          actual_tool_calls: [{ tool_id: "model.direct_answer", tool_name: "model.direct_answer" }],
        },
      },
    });

    expect(ledger.failure_codes).not.toContain("capability_dispatched_without_admission");
  });

  it("keeps affirmative docs-viewer open commands admissible", () => {
    const promptText = "Open the docs viewer.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "docs_viewer",
      target_kind: "docs_viewer",
      allow_no_tool_direct: false,
    });
    expect(admission).toMatchObject({
      source_target: "docs_viewer",
      required: true,
      admitted_tool_families: ["docs_viewer"],
    });
    expect(admission.tool_admission_suppressed).toBeUndefined();
  });

  it("admits affirmative scientific calculator solve requests through the calculator rail", () => {
    const promptText =
      "Call scientific-calculator.solve_expression with this exact expression: ((sqrt(81)+ln(e^3))*7-5^2)/2. Return the calculator result.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });

    expect(admission).toMatchObject({
      source_target: "calculator_stream",
      required: true,
      admitted_tool_families: expect.arrayContaining(["calculator", "workstation_action"]),
      capability_contract_guard_version: "E82",
      requested_capability: "scientific-calculator.solve_expression",
    });
    expect(admission.reason).toContain("calculator_stream_requires_calculator_tool_path");
    expect(admission.reason).toContain("explicit_capability_contract_required");
    expect(admission.tool_admission_suppressed).toBeUndefined();
    expect(admission.forbidden_tool_families ?? []).not.toEqual(
      expect.arrayContaining(["calculator", "workstation_action"]),
    );
  });

  it("lets explicit mandatory calculator admission dominate repo-code debug wording", () => {
    const promptText =
      "Call scientific-calculator.solve_expression with this exact expression: ((sqrt(81)+ln(e^3))*7-5^2)/2. " +
      "Use the calculator tool, wait for calculator_receipt, re-enter that receipt as evidence, and answer only from the calculator-backed terminal result. " +
      "Evaluate the project_local_agent_loop rail after the calculator observation.";
    const sourceTargetIntent = {
      schema: "helix.ask_source_target_intent.v1",
      turn_id: turnId,
      thread_id: threadId,
      target_source: "repo_code",
      target_kind: "repo_code",
      strength: "hard",
      explicit_cues: ["project_local_agent_loop"],
      reasons: ["explicit_repo_code_source_target", "project_local_agent_loop"],
      requested_outputs: ["repo_code", "tool_call_eligibility", "terminal_contract"],
      suppressed_routes: ["model_only_concept", "no_tool_direct"],
      precedence_reason: "explicit_repo_code_source_target",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
      confidence: 0.97,
      assistant_answer: false,
      raw_content_included: false,
    };
    const admission = buildToolCallAdmissionDecision({
      turnId,
      sourceTargetIntent,
      promptText,
      mandatoryNextTool: {
        schema: "helix.mandatory_next_tool.v1",
        tool_name: "scientific-calculator.solve_expression",
      },
      canonicalGoalFrame: {
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
        required_actions: ["scientific-calculator.solve_expression"],
      },
    });

    expect(admission).toMatchObject({
      source_target: "calculator_stream",
      required: true,
      admitted_tool_families: expect.arrayContaining(["calculator", "workstation_action"]),
      route_arbitration_guard_version: "E82",
      original_source_target: "repo_code",
      effective_source_target: "calculator_stream",
      canonical_goal_kind: "calculator_solve",
      mandatory_next_tool_name: "scientific-calculator.solve_expression",
      requested_capability: "scientific-calculator.solve_expression",
      requested_capability_source: "explicit_user_command",
      mandatory_capability_family: "calculator",
      mandatory_capability_admitted: true,
      calculator_goal_overrode_repo_source_target: true,
      repo_code_preserved_as_secondary_context: true,
      tool_admission_dominance_reason: "explicit_requested_capability_contract",
      runtime_capability_rejection_reason: null,
    });
    expect(admission.reason).toContain("explicit_capability_contract_required");
    expect(admission.reason).toContain("mandatory_calculator_admission_dominance");
    expect(admission.forbidden_tool_families ?? []).not.toEqual(
      expect.arrayContaining(["calculator", "workstation_action"]),
    );
  });

  it("keeps pure repo-code tool-call eligibility questions on the repo rail", () => {
    const promptText =
      "Starting from the top of the agentic turn-based system, can the agent make the right tool calls? Cite the repo paths.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });

    expect(sourceTargetIntent.reasons).toContain("project_local_agent_loop");
    expect(admission).toMatchObject({
      source_target: "repo_code",
      required: true,
      admitted_tool_families: ["repo_code"],
      reason: "repo_code_requires_repo_evidence_path",
    });
    expect(admission.admitted_tool_families).not.toContain("calculator");
    expect(admission.route_arbitration_guard_version).toBeUndefined();
  });

  it("makes explicit workspace_os.status dominate debug diagnosis routing", () => {
    const promptText =
      "Use workspace_os.status to inspect workstation status. Answer only from the produced workstation tool evaluation or status artifact.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });
    const plan = buildCapabilityPlan({
      turnId,
      promptText,
      sourceTargetIntent,
      toolCallAdmissionDecision: admission,
      canonicalGoalFrame: {
        ...canonicalGoal,
        goal_kind: "debug_diagnosis",
        required_terminal_kind: "debug_evidence_diagnosis",
      },
    });

    expect(admission).toMatchObject({
      source_target: "workspace_diagnostic",
      required: true,
      admitted_tool_families: expect.arrayContaining(["workspace_diagnostic"]),
      capability_contract_guard_version: "E82",
      requested_capability: "workspace_os.status",
      requested_capability_family: "workspace_diagnostic",
    });
    expect(plan).toMatchObject({
      capability_family: "workspace_diagnostic",
      requested_action: "workspace_os.status",
      selected_capability: "workspace_os.status",
      requested_capability: "workspace_os.status",
    });
  });

  it("makes explicit docs-viewer.locate_in_doc dominate summary heuristics", () => {
    const promptText =
      "Use docs-viewer.locate_in_doc to find the section in the open document that discusses Codex parity or tool-output re-entry. Answer only from the docs-viewer observation and cite the document evidence.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });
    const plan = buildCapabilityPlan({
      turnId,
      promptText,
      sourceTargetIntent,
      toolCallAdmissionDecision: admission,
      canonicalGoalFrame: {
        ...canonicalGoal,
        goal_kind: "active_doc_summary",
        required_terminal_kind: "doc_summary",
      },
    });

    expect(admission).toMatchObject({
      source_target: "docs_viewer",
      required: true,
      admitted_tool_families: ["docs_viewer"],
      capability_contract_guard_version: "E82",
      requested_capability: "docs-viewer.locate_in_doc",
      required_observation_kinds_for_requested_capability: expect.arrayContaining([
        "doc_location_result",
        "doc_location_matches",
        "doc_evidence_location",
      ]),
    });
    expect(plan).toMatchObject({
      capability_family: "docs",
      requested_action: "docs.search",
      selected_capability: "docs.search",
      requested_capability: "docs-viewer.locate_in_doc",
    });
    expect(__testHelixAgentStepActionResolution.resolveHelixAgentStepActionForCapability({
      capabilityKey: "docs-viewer.locate_in_doc",
      transcript: promptText,
      canonicalGoalFrame: {
        ...canonicalGoal,
        goal_kind: "locate_in_doc",
        required_terminal_kind: "doc_location_result",
      },
      workspaceSnapshot: {
        activeDocPath: "docs/helix-ask-codex-loop-discipline.md",
      } as any,
      capabilityArgs: {
        query: "Codex parity",
      },
    })).toMatchObject({
      panel_id: "docs-viewer",
      action_id: "locate_in_doc",
      args: {
        query: "Codex parity",
        path: "docs/helix-ask-codex-loop-discipline.md",
      },
    });
  });

  it("keeps explicit repo-code.search_concept as the requested capability contract", () => {
    const promptText =
      "Use repo-code.search_concept to find where Helix Ask terminal authority or terminal projection is implemented. Answer only from repo/code evidence and cite file paths.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });
    const plan = buildCapabilityPlan({
      turnId,
      promptText,
      sourceTargetIntent,
      toolCallAdmissionDecision: admission,
      canonicalGoalFrame: {
        ...canonicalGoal,
        goal_kind: "repo_code_evidence_question",
        required_terminal_kind: "repo_code_evidence_answer",
      },
    });

    expect(admission).toMatchObject({
      source_target: "repo_code",
      required: true,
      admitted_tool_families: ["repo_code"],
      capability_contract_guard_version: "E82",
      requested_capability: "repo-code.search_concept",
    });
    expect(plan).toMatchObject({
      capability_family: "repo_evidence",
      requested_action: "repo-code.search_concept",
      selected_capability: "repo-code.search_concept",
      requested_capability: "repo-code.search_concept",
    });
  });

  it("classifies mandatory calculator admission rejection for one-shot fail closed handling", () => {
    const validation = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: turnId,
        call_id: "tool:test:calculator-denied",
        capability_key: "scientific-calculator.solve_expression",
        args: { expression: "((sqrt(81)+ln(e^3))*7-5^2)/2" },
        reason: "test",
        expected_artifacts: ["calculator_receipt", "workstation_tool_evaluation"],
        assistant_answer: false,
        raw_content_included: false,
      },
      availableCapabilities: availableCapabilities(["scientific-calculator.solve_expression"]) as any,
      toolCallAdmissionDecision: {
        schema: "helix.tool_call_admission_decision.v1",
        turn_id: turnId,
        source_target: "repo_code",
        required: true,
        admitted_tool_families: ["repo_code"],
        forbidden_terminal_artifact_kinds: ["direct_answer_text", "no_tool_direct", "model_only_concept"],
        forbidden_routes: ["model_only_concept", "no_tool_direct"],
        reason: "repo_code_requires_repo_evidence_path",
        assistant_answer: false,
        raw_content_included: false,
      },
    }).validation;

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        "runtime_capability_not_admitted_by_tool_policy:scientific-calculator.solve_expression:calculator|workstation_action",
        "runtime_tool_forbidden_by_tool_policy:scientific-calculator.solve_expression",
      ]),
    );
    expect(__testHelixRuntimeToolCallValidation.isMandatoryCapabilityAdmissionRejection({
      payload: {
        mandatory_next_tool: {
          schema: "helix.mandatory_next_tool.v1",
          tool_name: "scientific-calculator.solve_expression",
        },
      },
      runtimeToolCall: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: turnId,
        call_id: "tool:test:calculator-denied",
        capability_key: "scientific-calculator.solve_expression",
        args: { expression: "((sqrt(81)+ln(e^3))*7-5^2)/2" },
        reason: "test",
        expected_artifacts: ["calculator_receipt", "workstation_tool_evaluation"],
        assistant_answer: false,
        raw_content_included: false,
      },
      runtimeToolValidation: validation,
    })).toBe(true);
  });

  it("suppresses quoted and negated calculator mentions before tool admission", () => {
    const prompts = [
      'Earlier I said "open calculator"; do not do that now. Explain why no tool should run.',
      "Do not open the calculator; just explain what the calculator is for.",
      "What tool would you use to open calculator? Explain without opening it.",
      "If I later call scientific-calculator.solve_expression, what should happen? Do not run it now.",
      'The screen-visible text says "scientific-calculator.solve_expression"; explain what that label means without running it.',
      "Earlier I called scientific-calculator.solve_expression; summarize why that historical tool name should not execute now.",
    ];

    for (const promptText of prompts) {
      const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
      const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });
      const plan = buildCapabilityPlan({
        turnId,
        promptText,
        sourceTargetIntent,
        toolCallAdmissionDecision: admission,
        canonicalGoalFrame: canonicalGoal,
      });

      expect(sourceTargetIntent).toMatchObject({
        target_source: "model_only",
        allow_no_tool_direct: true,
      });
      expect(admission, promptText).toMatchObject({
        source_target: "model_only",
        required: false,
        admitted_tool_families: ["model_only"],
        tool_admission_suppressed: true,
      });
      expect(plan).toMatchObject({
        source_target: "model_only",
        requested_action: "suppressed_contextual_tool_reference",
        tool_admission_suppressed: true,
      });
      expect(plan.capability_family).not.toBe("calculator");
      expect(plan.capability_family).not.toBe("workstation_action");
      const terminalContract = __testHelixGoalSatisfaction.resolveHelixGoalTerminalContract({
        canonicalGoalFrame: canonicalGoal,
        transcript: promptText,
        selectedAction: {
          panel_id: "scientific-calculator",
          action_id: "solve_expression",
          args: { expression: "2 + 2" },
        },
      });
      expect(terminalContract).toMatchObject({
        goal_kind: "model_only_concept",
        required_terminal_kinds: ["direct_answer_text"],
        required_actions: [],
      });
      expect(terminalContract.forbidden_terminal_kinds).toContain("workstation_tool_evaluation");
    }
  });

  it("does not suppress affirmative calculator commands after contextual words in a previous sentence", () => {
    const promptText =
      "Use internet_search.web_research to find a cited research-paper source for the Alcubierre metric. " +
      "Then use helix_ask.reflect_theory_context to connect the cited source to the rule that receipts are observations before terminal authority. " +
      "Finally run scientific-calculator.solve_expression with this exact expression: (9+3)*7-25.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });
    const plan = buildCapabilityPlan({
      turnId,
      promptText,
      sourceTargetIntent,
      toolCallAdmissionDecision: admission,
      canonicalGoalFrame: canonicalGoal,
      availableCapabilities: availableCapabilities([
        "internet-search.search_web",
        "helix_ask.reflect_theory_context",
        "scientific-calculator.solve_expression",
      ]) as any,
    });

    expect(admission.tool_admission_suppressed).not.toBe(true);
    expect(plan.tool_admission_suppressed).not.toBe(true);
    expect(plan.compound_capability_contract?.subgoals.map((subgoal) => subgoal.requested_capability)).toEqual([
      "internet_search.web_research",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);
    expect(plan.compound_capability_contract?.subgoals.at(-1)?.args_hint).toEqual({
      expression: "(9+3)*7-25",
      latex: "(9+3)*7-25",
    });
  });

  it("does not let suppressed calculator references enter calculator compound planning", () => {
    const promptText =
      "Do not call any tools. Explain why calculator receipts are observations, not terminal answers.";

    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });
    const plan = buildCapabilityPlan({
      turnId,
      promptText,
      sourceTargetIntent,
      toolCallAdmissionDecision: admission,
      canonicalGoalFrame: canonicalGoal,
    });

    expect(admission).toMatchObject({
      source_target: "model_only",
      required: false,
      admitted_tool_families: ["model_only"],
      tool_admission_suppressed: true,
    });
    expect(plan).toMatchObject({
      requested_action: "suppressed_contextual_tool_reference",
      source_target: "model_only",
      required_terminal_kind: "direct_answer_text",
    });
    expect(__testHelixCalculatorCompoundPlanning.shouldSuppressHelixCalculatorCompoundPlanning(promptText)).toBe(true);
  });

  it("normalizes stale calculator receipt results from the expression before terminal materialization", () => {
    expect(
      __testHelixCalculatorCompoundPlanning.readHelixCalculatorReceiptResultText({
        expression: "2*(3+4)",
        result_text: "2",
        result_unit: null,
      }),
    ).toBe("14");
  });

  it("detects stale calculator draft result text before terminal materialization", () => {
    expect(
      __testHelixCalculatorCompoundPlanning.helixCalculatorAnswerConflictsWithExpressionResult(
        [
          "I used the calculator result as a numeric subgoal, then continued the reasoning from that observation.",
          "Calculator subgoal: 2*(3+4)",
          "Result: 2",
          "Trace source: scientific-calculator.solve_expression.",
        ].join("\n"),
      ),
    ).toBe(true);
  });

  it("sanitizes stale calculator return text from receipt results at the final handoff", () => {
    const text = [
      "I used the calculator result as a numeric subgoal, then continued the reasoning from that observation.",
      "Calculator subgoal: 2*(3+4)",
      "Result: 2",
      "Trace source: scientific-calculator.solve_expression.",
    ].join("\n");

    const sanitized = __testHelixCalculatorCompoundPlanning.sanitizeHelixCalculatorAnswerAgainstReceiptResults({
      text,
      prompt: "Open the scientific calculator, solve 2*(3+4), and explain the steps.",
      receipts: [
        {
          receipt_id: "calculator:receipt:2-times-sum",
          subgoal_id: "calculator_subgoal_1",
          expression: "2*(3+4)",
          result_text: "2",
          result_unit: null,
        },
      ],
      coverage: {
        schema: "helix.calculator_plan_coverage.v1",
        coverage_id: "coverage:2-times-sum",
        turn_id: turnId,
        coverage: "complete",
        requirements: [],
        missing_requirement_ids: [],
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    expect(sanitized).toContain("Calculator expression: 2*(3+4)");
    expect(sanitized).toContain("Result: 14");
    expect(sanitized).not.toContain("Result: 2\n");
  });

  it("repairs calculator arguments that retain command words instead of the extracted expression", () => {
    const sanitized = __testHelixCalculatorCompoundPlanning.sanitizeHelixRuntimeCalculatorArgs({
      transcript:
        "Use the Scientific Calculator to compute (8 * 9) + 1. The string `internet-search.search_web` is only a non-executable example. Report the numeric result only.",
      toolArgs: {
        latex: "UsetheScientificCalculatortocompute(8*9)+1",
        expression: "UsetheScientificCalculatortocompute(8*9)+1",
      },
    });

    expect(sanitized).toMatchObject({
      latex: "(8*9)+1",
      expression: "(8*9)+1",
      runtime_arg_repair: expect.objectContaining({
        reason: "calculator_arg_was_instruction_contaminated",
      }),
    });
  });

  it("does not request doc_reference when explicit docs locate already has a path ref", () => {
    const failure = __testHelixEvidenceRetrievalFailure.buildAskTurnEvidenceRetrievalFailure({
      transcript:
        "Use docs-viewer.locate_in_doc to find where docs/helix-ask-codex-loop-discipline.md says routes choose procedures.",
      evidenceRefs: ["docs/helix-ask-codex-loop-discipline.md"],
      workspaceSnapshot: null,
      executionTrace: [],
    });

    expect(failure).toBeNull();
  });

  it("extracts the cited phrase from explicit docs path locate commands", () => {
    const promptText =
      "Use docs-viewer.locate_in_doc to find where docs/helix-ask-codex-loop-discipline.md says routes choose procedures or tools produce observations. Answer only from the docs-viewer observation and cite the document evidence.";

    expect(__testHelixAgentStepActionResolution.resolveAskTurnDocLocateQuery(promptText)).toBe(
      "routes choose procedures",
    );
    expect(__testHelixAgentStepActionResolution.resolveHelixAgentStepActionForCapability({
      capabilityKey: "docs-viewer.locate_in_doc",
      transcript: promptText,
      canonicalGoalFrame: {
        ...canonicalGoal,
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
      },
      workspaceSnapshot: {
        activeDocPath: "docs/helix-ask-codex-loop-discipline.md",
      } as any,
      capabilityArgs: {},
    })).toMatchObject({
      panel_id: "docs-viewer",
      action_id: "locate_in_doc",
      args: {
        query: "routes choose procedures",
        target_transcript: "routes choose procedures",
        path: "docs/helix-ask-codex-loop-discipline.md",
      },
    });
  });

  it("extracts explicit query fields for docs locate tool calls", () => {
    const promptText =
      "Call docs-viewer.locate_in_doc for docs/helix-ask-codex-loop-discipline.md with query: receipts are observations not answers. Return only line-backed document evidence from that tool observation.";

    expect(__testHelixAgentStepActionResolution.resolveAskTurnDocLocateQuery(promptText)).toBe(
      "receipts are observations not answers",
    );
    expect(__testHelixAgentStepActionResolution.resolveHelixAgentStepActionForCapability({
      capabilityKey: "docs-viewer.locate_in_doc",
      transcript: promptText,
      canonicalGoalFrame: {
        ...canonicalGoal,
        goal_kind: "locate_in_doc",
        required_terminal_kind: "doc_location_matches",
      },
      workspaceSnapshot: {
        activeDocPath: "docs/helix-ask-codex-loop-discipline.md",
      } as any,
      capabilityArgs: {},
    })).toMatchObject({
      panel_id: "docs-viewer",
      action_id: "locate_in_doc",
      args: {
        query: "receipts are observations not answers",
        target_transcript: "receipts are observations not answers",
        path: "docs/helix-ask-codex-loop-discipline.md",
      },
    });
  });

  it("scopes 'do not write files' to mutation while admitting research plus locator observations", () => {
    const promptText =
      "Do not write files. Use scholarly papers and citations to research microtubule coherence, then place it on the theory badge graph with scale bands and uncertainty mode.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, sourceTargetIntent, promptText });
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText,
      sourceTargetIntent,
      toolCallAdmissionDecision: admission,
      availableCapabilities: availableCapabilities([
        HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        "helix_ask.reflect_theory_context",
      ]),
    });

    expect(sourceTargetIntent.target_source).toBe("scholarly_research");
    expect(sourceTargetIntent.allow_no_tool_direct).toBe(false);
    expect(admission).toMatchObject({
      source_target: "theory_locator",
      required: true,
      admitted_tool_families: expect.arrayContaining(["scholarly_research", "theory_locator"]),
    });
    expect(admission.tool_admission_suppressed).toBeUndefined();
    expect(admission.forbidden_tool_families ?? []).toEqual(
      expect.arrayContaining(["workstation_action", "notes"]),
    );
    expect(admission.forbidden_tool_families ?? []).not.toEqual(
      expect.arrayContaining(["scholarly_research"]),
    );
    expect(itinerary.prompt_shape).toBe("compound_tool");
    expect(itinerary.relevant_tool_families).toEqual(["scholarly_research", "theory_locator"]);
    expect(itinerary.terminal_success_criteria.required_observation_families).toEqual([
      "scholarly_research",
      "theory_locator",
    ]);
  });

  it("does not suppress read-only theory locator when file writes are negated", () => {
    const promptText =
      "Do not write files. Place this claim on the theory badge graph with scale bands and uncertainty mode.";
    const admission = buildToolCallAdmissionDecision({
      turnId,
      promptText,
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        turn_id: turnId,
        thread_id: threadId,
        target_source: "workstation_panel",
        target_kind: "workstation_panel",
        strength: "hard",
        explicit_cues: ["theory_context_reflection"],
        reasons: ["workstation_tool_plan:theory_context_reflection"],
        requested_outputs: ["helix_theory_context_reflection_tool_receipt", "workstation_tool_evaluation"],
        suppressed_routes: ["no_tool_direct", "model_only_concept", "panel_generated_answer"],
        precedence_reason: "theory_context_reflection_tool_plan",
        must_enter_backend_ask: true,
        allow_client_shortcut: false,
        allow_no_tool_direct: false,
        confidence: 0.9,
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    expect(admission).toMatchObject({
      source_target: "workstation_panel",
      required: true,
      admitted_tool_families: ["theory_locator"],
      reason: "theory_locator_requires_readonly_locator_path",
    });
    expect(admission.tool_admission_suppressed).toBeUndefined();
    expect(admission.forbidden_tool_families ?? []).toEqual(
      expect.arrayContaining(["workstation_action", "notes"]),
    );
    expect(admission.forbidden_tool_families ?? []).not.toEqual(
      expect.arrayContaining(["theory_locator"]),
    );
  });
});
