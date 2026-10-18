import { describe, expect, it } from "vitest";

import {
  buildFinalRouteReconciliation,
  buildSolverControllerDecision,
  buildTurnIdIntegrityAudit,
} from "../services/helix-ask/solver-controller-decision";

const satisfiedGoal = (goalKind: string, terminalKind: string) => ({
  schema: "helix.goal_satisfaction_evaluation.v1",
  turn_id: `ask:${goalKind}`,
  canonical_goal_kind: goalKind,
  required_terminal_kind: terminalKind,
  terminal_contract: {
    goal_kind: goalKind,
    required_terminal_kinds: [terminalKind],
    acceptable_fallbacks: [],
    forbidden_terminal_kinds: [],
  },
  required_actions: [],
  required_evidence: [],
  observed_results: [],
  satisfaction: "satisfied",
  next_decision: "allow_terminal",
  assistant_answer: false,
  raw_content_included: false,
});

const terminalEquivalenceOk = {
  schema: "helix.terminal_equivalence_harness_result.v1",
  ok: true,
  failure_codes: [],
};

const capabilityLifecycleOk = (turnId: string, terminalKind: string) => {
  const live = terminalKind === "live_pipeline_receipt";
  const capabilityFamily = live ? "live_source" : "workstation_action";
  const requestedAction = live ? "control_live_source" : "execute_workstation_action";
  const capabilityPlanId = `capability_plan:${turnId}:${capabilityFamily}:${requestedAction}`;
  const terminalArtifactId = `${turnId}:${terminalKind}`;
  return {
    terminal_artifact_id: terminalArtifactId,
    capability_plan: {
      schema: "helix.capability_plan.v1",
      turn_id: turnId,
      capability_family: capabilityFamily,
      requested_action: requestedAction,
      mutating: true,
      operator_command_required: true,
      operator_command_present: true,
      source_target: live ? "live_pipeline" : "workstation_panel",
      goal_kind: live ? "live_interval_set" : "panel_control",
      required_terminal_kind: terminalKind,
      admission_status: "admitted",
      assistant_answer: false,
      raw_content_included: false,
    },
    capability_result: {
      schema: "helix.capability_result.v1",
      turn_id: turnId,
      capability_plan_id: capabilityPlanId,
      status: "succeeded",
      receipt_refs: [terminalArtifactId],
      evidence_refs: [],
      selected_for_answer: true,
      reentered_solver: true,
      assistant_answer: false,
      raw_content_included: false,
    },
    capability_lifecycle_ledger: {
      schema: "helix.capability_lifecycle_ledger.v1",
      turn_id: turnId,
      capability_plan_id: capabilityPlanId,
      capability_result_id: capabilityPlanId,
      stages: [],
      failure_codes: [],
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
    },
    capability_adapter_request: {
      schema: "helix.capability_adapter_request.v1",
      turn_id: turnId,
      capability_plan_id: capabilityPlanId,
      assistant_answer: false,
      raw_content_included: false,
    },
    capability_adapter_result: {
      schema: "helix.capability_adapter_result.v1",
      turn_id: turnId,
      capability_plan_id: capabilityPlanId,
      status: "succeeded",
      assistant_answer: false,
      raw_content_included: false,
    },
  };
};

const runtimeLoopOk = (turnId: string, capability: string, artifactKind: string) => ({
  agent_step_decision: {
    schema: "helix.agent_step_decision.v1",
    decision_id: `${turnId}:decision:1`,
    chosen_capability: capability,
    decision_authority: "llm",
    assistant_answer: false,
    raw_content_included: false,
  },
  agent_runtime_loop: {
    schema: "helix.agent_runtime_loop.v1",
    iterations: [
      {
        decision_id: `${turnId}:decision:1`,
        chosen_capability: capability,
        decision_authority: "llm",
        decision_timing: "pre_action",
        tool_observation: { kind: artifactKind },
        artifact_refs: [`${turnId}:${artifactKind}`],
      },
      {
        decision_id: `${turnId}:decision:2`,
        chosen_capability: "answer",
        decision_authority: "llm",
        decision_timing: "post_observation",
      },
    ],
    assistant_answer: false,
    raw_content_included: false,
  },
  current_turn_artifact_ledger: [
    {
      artifact_id: `${turnId}:${artifactKind}`,
      turn_id: turnId,
      kind: artifactKind,
      payload: { kind: artifactKind },
    },
  ],
});

describe("helix ask solver controller decision", () => {
  it("allows capability help when the single writer supersedes a stale typed-failure mirror", () => {
    const payload = {
      canonical_goal_frame: {
        turn_id: "ask:capability-help",
        goal_kind: "capability_help",
        required_terminal_kind: "capability_help_summary",
      },
      route_reason_code: "capability_help",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      selected_final_answer: "The tools available for Helix Ask include 59 active dynamic workstation actions.",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "capability_help_summary",
        selected_terminal_artifact_ref: "ask:capability-help:capability_help_summary",
        source: "capability_help_summary",
        visible_text: "The tools available for Helix Ask include 59 active dynamic workstation actions.",
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "ask:capability-help", completed_solver_path: true },
      goal_satisfaction_evaluation: {
        ...satisfiedGoal("capability_help", "capability_help_summary"),
        required_evidence: [
          {
            kind: "capability_help_summary",
            required: true,
            satisfied: true,
            evidence_ref: "ask:capability-help:capability_help_summary",
          },
        ],
      },
      terminal_equivalence_harness_result: terminalEquivalenceOk,
      current_turn_artifact_ledger: [
        {
          artifact_id: "ask:capability-help:capability_registry",
          turn_id: "ask:capability-help",
          kind: "capability_registry",
          payload: { kind: "capability_registry" },
        },
        {
          artifact_id: "ask:capability-help:capability_help_summary",
          turn_id: "ask:capability-help",
          kind: "capability_help_summary",
          payload: {
            schema: "helix.capability_help_summary.v1",
            kind: "capability_help_summary",
            text: "The tools available for Helix Ask include 59 active dynamic workstation actions.",
          },
        },
      ],
    };

    const routeReconciliation = buildFinalRouteReconciliation({
      turnId: "ask:capability-help",
      finalRoute: "capability_help",
      payload,
    });
    const decision = buildSolverControllerDecision({
      turnId: "ask:capability-help",
      finalRoute: "capability_help",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({
        turnId: "ask:capability-help",
        payload,
      }),
      finalRouteReconciliation: routeReconciliation,
    });

    expect(decision.decision).toBe("allow_terminal");
    expect(decision.selected_terminal_artifact_kind).toBe("capability_help_summary");
    expect(decision.blocking_reasons).not.toContain("terminal_kind_not_required");
    expect(decision.blocking_reasons).not.toContain("committed_route_terminal_product_mismatch");
  });

  it("blocks stale terminal authority routes before normal terminal answers", () => {
    const payload = {
      canonical_goal_frame: {
        turn_id: "ask:stale",
        goal_kind: "doc_open_best",
        required_terminal_kind: "doc_open_receipt",
      },
      route_reason_code: "doc_open_best",
      terminal_artifact_kind: "doc_open_receipt",
      final_answer_source: "artifact_synthesis",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:stale",
        route: "dispatch:act",
        terminal_artifact_kind: "doc_open_receipt",
        final_answer_source: "artifact_synthesis",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "ask:stale", completed_solver_path: true },
      goal_satisfaction_evaluation: satisfiedGoal("doc_open_best", "doc_open_receipt"),
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const routeReconciliation = buildFinalRouteReconciliation({
      turnId: "ask:stale",
      finalRoute: "doc_open_best",
      payload,
    });
    const decision = buildSolverControllerDecision({
      turnId: "ask:stale",
      finalRoute: "doc_open_best",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:stale", payload }),
      finalRouteReconciliation: routeReconciliation,
    });

    expect(routeReconciliation.ok).toBe(false);
    expect(decision.decision).toBe("fail_closed");
    expect(decision.blocking_reasons).toContain("terminal_route_mismatch");
  });

  it("allows typed failures as fail-closed terminal products even when the previous route contract rejected the normal answer", () => {
    const payload = {
      canonical_goal_frame: {
        turn_id: "ask:typed-failure",
        goal_kind: "doc_open_best",
        required_terminal_kind: "doc_open_receipt",
      },
      route_reason_code: "doc_open_best",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:typed-failure",
        route: "dispatch:act",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        server_authoritative: true,
      },
      terminal_artifact_selection_guard: { allowed: false },
      product_authority_guard: { allowed: false },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: false },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "ask:typed-failure", completed_solver_path: false },
    };

    const routeReconciliation = buildFinalRouteReconciliation({
      turnId: "ask:typed-failure",
      finalRoute: "doc_open_best",
      payload,
    });
    const decision = buildSolverControllerDecision({
      turnId: "ask:typed-failure",
      finalRoute: "doc_open_best",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:typed-failure", payload }),
      finalRouteReconciliation: routeReconciliation,
    });

    expect(routeReconciliation.ok).toBe(true);
    expect(decision.decision).toBe("allow_terminal");
    expect(decision.blocking_reasons).toEqual([]);
  });

  it("blocks explicit visual answers when the live source identity audit is not ok", () => {
    const payload = {
      active_prompt: "Describe what you see in the visual capture.",
      canonical_goal_frame: {
        turn_id: "ask:visual",
        goal_kind: "situation_context_question",
        required_terminal_kind: "situation_context_pack",
      },
      source_target_intent: { target_source: "visual_capture", target_kind: "visual_capture" },
      route_reason_code: "situation_context_question",
      terminal_artifact_kind: "situation_context_pack",
      final_answer_source: "artifact_synthesis",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:visual",
        route: "situation_context_question",
        terminal_artifact_kind: "situation_context_pack",
        final_answer_source: "artifact_synthesis",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "ask:visual", completed_solver_path: false },
      goal_satisfaction_evaluation: satisfiedGoal("situation_context_question", "situation_context_pack"),
      terminal_equivalence_harness_result: terminalEquivalenceOk,
      live_source_identity_audit: {
        schema: "helix.live_source_identity_audit.v1",
        identity_ok: false,
        freshness_ok: false,
        diagnosis: "field_evaluations_missing",
      },
    };

    const decision = buildSolverControllerDecision({
      turnId: "ask:visual",
      finalRoute: "situation_context_question",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:visual", payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId: "ask:visual",
        finalRoute: "situation_context_question",
        payload,
      }),
    });

    expect(decision.decision).toBe("fail_closed");
    expect(decision.blocking_reasons).toContain("visual_evidence_missing");
    expect(decision.typed_failure_code).toBe("field_evaluations_missing");
  });

  it("blocks no-tool direct answers to live capture content prompts", () => {
    const payload = {
      active_prompt: "Describe what you see in the live capture.",
      canonical_goal_frame: {
        turn_id: "ask:live-capture-direct",
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      route_reason_code: "model_only_concept / no_tool_direct",
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "no_tool_direct",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:live-capture-direct",
        route: "model_only_concept",
        terminal_artifact_kind: "direct_answer_text",
        final_answer_source: "no_tool_direct",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "ask:live-capture-direct", completed_solver_path: true },
      goal_satisfaction_evaluation: satisfiedGoal("model_only_concept", "direct_answer_text"),
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId: "ask:live-capture-direct",
      finalRoute: "model_only_concept / no_tool_direct",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:live-capture-direct", payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId: "ask:live-capture-direct",
        finalRoute: "model_only_concept / no_tool_direct",
        payload,
      }),
    });

    expect(decision.decision).toBe("fail_closed");
    expect(decision.blocking_reasons).toContain("visual_evidence_missing");
  });

  it("blocks live pipeline receipts from satisfying live capture content prompts", () => {
    const payload = {
      active_prompt: "Can you review what is happening in the screen capture? I haven't started the interval 10 seconds yet.",
      canonical_goal_frame: {
        turn_id: "ask:visual-control-receipt",
        goal_kind: "live_pipeline_control",
        required_terminal_kind: "live_pipeline_receipt",
      },
      source_target_intent: { target_source: "visual_capture", target_kind: "visual_capture" },
      route_reason_code: "live_pipeline_control",
      terminal_artifact_kind: "live_pipeline_receipt",
      final_answer_source: "artifact_synthesis",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:visual-control-receipt",
        route: "live_pipeline_control",
        terminal_artifact_kind: "live_pipeline_receipt",
        final_answer_source: "artifact_synthesis",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "ask:visual-control-receipt", completed_solver_path: true },
      goal_satisfaction_evaluation: {
        ...satisfiedGoal("visual_capture_describe", "situation_context_pack"),
        terminal_contract: {
          goal_kind: "visual_capture_describe",
          required_terminal_kinds: ["visual_context_pack", "situation_context_pack", "visual_frame_evidence"],
          acceptable_fallbacks: ["typed_failure"],
          forbidden_terminal_kinds: ["live_pipeline_receipt", "visual_producer_cadence_receipt"],
          required_evidence: ["visual_observation", "field_evaluation"],
        },
        satisfaction: "not_satisfied",
        next_decision: "continue",
      },
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId: "ask:visual-control-receipt",
      finalRoute: "live_pipeline_control",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:visual-control-receipt", payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId: "ask:visual-control-receipt",
        finalRoute: "live_pipeline_control",
        payload,
      }),
    });

    expect(decision.decision).toBe("continue");
    expect(decision.blocking_reasons).toEqual(
      expect.arrayContaining(["goal_not_satisfied", "terminal_kind_not_required", "visual_evidence_missing"]),
    );
    expect(decision.typed_failure_code).toBe("visual_evidence_missing");
  });

  it("allows affirmative live interval control receipts under the live interval goal contract", () => {
    const payload = {
      active_prompt: "Set the visual capture interval to 10 seconds.",
      canonical_goal_frame: {
        turn_id: "ask:live-interval",
        goal_kind: "live_pipeline_control",
        required_terminal_kind: "live_pipeline_receipt",
      },
      route_reason_code: "live_pipeline_control",
      terminal_artifact_kind: "live_pipeline_receipt",
      final_answer_source: "artifact_synthesis",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:live-interval",
        route: "live_pipeline_control",
        terminal_artifact_kind: "live_pipeline_receipt",
        final_answer_source: "artifact_synthesis",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "ask:live-interval", completed_solver_path: true },
      ...runtimeLoopOk("ask:live-interval", "live-source.set_rate", "live_pipeline_receipt"),
      ...capabilityLifecycleOk("ask:live-interval", "live_pipeline_receipt"),
      goal_satisfaction_evaluation: {
        ...satisfiedGoal("live_interval_set", "live_pipeline_receipt"),
        terminal_contract: {
          goal_kind: "live_interval_set",
          required_terminal_kinds: ["live_pipeline_receipt"],
          acceptable_fallbacks: ["typed_failure", "request_user_input"],
          forbidden_terminal_kinds: ["visual_context_pack", "situation_context_pack", "visual_frame_evidence"],
          required_actions: ["situation-room.live-source.set_rate"],
          required_evidence: ["live_pipeline_receipt"],
        },
      },
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId: "ask:live-interval",
      finalRoute: "live_pipeline_control",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:live-interval", payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId: "ask:live-interval",
        finalRoute: "live_pipeline_control",
        payload,
      }),
    });

    expect(decision.decision).toBe("allow_terminal");
    expect(decision.blocking_reasons).toEqual([]);
  });

  it("does not require model re-entry for a route-authorized self-terminal live pipeline receipt", () => {
    const turnId = "ask:live-source-self-terminal-receipt";
    const payload = {
      active_prompt: "Keep checking my screen as a live answer.",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "live_source_continuation",
        required_terminal_kind: "live_pipeline_receipt",
      },
      source_target_intent: {
        target_source: "live_pipeline",
        allow_no_tool_direct: false,
        allow_client_shortcut: false,
      },
      route_reason_code: "live_source_continuation",
      terminal_artifact_kind: "live_pipeline_receipt",
      final_answer_source: "live_pipeline_receipt",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "live_source_continuation",
        terminal_artifact_kind: "live_pipeline_receipt",
        final_answer_source: "live_pipeline_receipt",
        server_authoritative: true,
      },
      live_pipeline_turn_receipt: {
        schema: "helix.live_pipeline_turn_receipt.v1",
        assistant_answer: false,
        raw_content_included: false,
      },
      route_product_contract: {
        source_target: "live_pipeline",
        allowed_terminal_artifact_kinds: ["live_pipeline_receipt"],
        forbidden_terminal_artifact_kinds: [],
      },
      terminal_artifact_selection_guard: {
        terminal_artifact_kind: "live_pipeline_receipt",
        allowed: true,
      },
      product_authority_guard: {
        terminal_artifact_kind: "live_pipeline_receipt",
        allowed: true,
      },
      tool_call_admission_decision: {
        source_target: "live_pipeline",
        required: true,
        admitted_tool_families: ["live_pipeline"],
      },
      tool_trace_disclosure: {
        schema: "helix.ask_tool_trace_disclosure.v1",
        items: [{ tool: "situation-room.pipeline.execute" }],
        assistant_answer: false,
        terminal_eligible: false,
      },
      poison_audit: {
        schema: "helix.turn_poison_audit.v1",
        ok: true,
        violations: [],
      },
      route_authority_audit: {
        schema: "helix.route_authority_audit.v1",
        route_authority_ok: true,
      },
      ask_turn_solver_trace: {
        schema: "helix.ask_turn_solver_trace.v1",
        turn_id: turnId,
        completed_solver_path: true,
        evidence_reentry_gate: {
          schema: "helix.evidence_reentry_gate.v1",
          turn_id: turnId,
          required: true,
          completed: false,
          violation_codes: ["evidence_selected_but_finalizer_missing"],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      goal_satisfaction_evaluation: satisfiedGoal(
        "live_source_continuation",
        "live_pipeline_receipt",
      ),
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "live_source_continuation",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId, payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId,
        finalRoute: "live_source_continuation",
        payload,
      }),
    });

    expect(decision.decision).toBe("allow_terminal");
    expect(decision.blocking_reasons).not.toContain(
      "post_observation_model_decision_missing",
    );
  });

  it("blocks satisfied tool terminals when prompt requirement coverage is incomplete", () => {
    const turnId = "ask:prompt-coverage";
    const payload = {
      active_prompt: "Calculate kinetic energy and momentum, then explain the units.",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      route_reason_code: "calculator_solve",
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "calculator_solve",
        terminal_artifact_kind: "workstation_tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: turnId, completed_solver_path: true },
      ...runtimeLoopOk(turnId, "scientific-calculator.solve_expression", "workstation_tool_evaluation"),
      ...capabilityLifecycleOk(turnId, "workstation_tool_evaluation"),
      goal_satisfaction_evaluation: satisfiedGoal("calculator_solve", "workstation_tool_evaluation"),
      prompt_requirement_coverage: {
        schema: "helix.prompt_requirement_coverage.v1",
        turn_id: turnId,
        coverage: "partial",
        missing_requirement_ids: ["momentum", "units"],
        next_decision: "repair_compose",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "calculator_solve",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId, payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({ turnId, finalRoute: "calculator_solve", payload }),
    });

    expect(decision.decision).toBe("typed_failure");
    expect(decision.blocking_reasons).toContain("prompt_requirement_coverage_incomplete");
    expect(decision.typed_failure_code).toBe("prompt_requirement_coverage_incomplete");
  });

  it("blocks docs terminals when docs retrieval coverage is incomplete", () => {
    const turnId = "ask:doc-retrieval-coverage";
    const payload = {
      active_prompt: "Summarize docs about NHM2 current status in 4 bullets. Include the path.",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "doc_summary",
        required_terminal_kind: "doc_summary",
      },
      route_reason_code: "doc_summary",
      terminal_artifact_kind: "doc_summary",
      final_answer_source: "artifact_synthesis",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "doc_summary",
        terminal_artifact_kind: "doc_summary",
        final_answer_source: "artifact_synthesis",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: turnId, completed_solver_path: true },
      ...runtimeLoopOk(turnId, "docs-viewer.summarize_doc", "doc_summary"),
      ...capabilityLifecycleOk(turnId, "doc_summary"),
      goal_satisfaction_evaluation: satisfiedGoal("doc_summary", "doc_summary"),
      doc_retrieval_coverage: {
        schema: "helix.doc_retrieval_coverage.v1",
        turn_id: turnId,
        coverage: "partial",
        requested_scope: "broad_topic",
        missing_requirement_ids: ["doc_search_results_observed"],
        next_decision: "repair_compose",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "doc_summary",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId, payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({ turnId, finalRoute: "doc_summary", payload }),
    });

    expect(decision.decision).toBe("typed_failure");
    expect(decision.blocking_reasons).toContain("doc_retrieval_coverage_incomplete");
    expect(decision.typed_failure_code).toBe("doc_retrieval_coverage_incomplete");
  });

  it("blocks satisfied terminals when compound prompt coverage gate fails", () => {
    const turnId = "ask:compound-coverage";
    const payload = {
      active_prompt: "Calculate spring energy, max speed, momentum, and height.",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      route_reason_code: "calculator_solve",
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "calculator_solve",
        terminal_artifact_kind: "workstation_tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: turnId, completed_solver_path: true },
      ...runtimeLoopOk(turnId, "scientific-calculator.solve_expression", "workstation_tool_evaluation"),
      ...capabilityLifecycleOk(turnId, "workstation_tool_evaluation"),
      goal_satisfaction_evaluation: satisfiedGoal("calculator_solve", "workstation_tool_evaluation"),
      prompt_requirement_coverage: {
        schema: "helix.prompt_requirement_coverage.v1",
        turn_id: turnId,
        coverage: "complete",
        missing_requirement_ids: [],
        next_decision: "allow_terminal",
        assistant_answer: false,
        raw_content_included: false,
      },
      compound_prompt_coverage_gate: {
        schema: "helix.compound_prompt_coverage_gate.v1",
        applies: true,
        passed: false,
        decision: "FAIL_CLOSED",
        reason: "required compound prompt items were missing",
        required_count: 4,
        answered_count: 2,
        blocked_count: 2,
        failed_closed_count: 0,
        unresolved_requirement_ids: ["R3", "R4"],
        non_visible_blocked_requirement_ids: ["R3", "R4"],
        resolutions: [],
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "calculator_solve",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId, payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({ turnId, finalRoute: "calculator_solve", payload }),
    });

    expect(decision.decision).toBe("typed_failure");
    expect(decision.blocking_reasons).toContain("compound_prompt_coverage_incomplete");
    expect(decision.typed_failure_code).toBe("compound_prompt_coverage_incomplete");
  });

  it("blocks workstation action receipts when the capability lifecycle is incomplete", () => {
    const payload = {
      active_prompt: "Open the docs panel.",
      canonical_goal_frame: {
        turn_id: "ask:capability-incomplete",
        goal_kind: "panel_control",
        required_terminal_kind: "workspace_action_receipt",
      },
      route_reason_code: "panel_control",
      terminal_artifact_kind: "workspace_action_receipt",
      final_answer_source: "artifact_synthesis",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:capability-incomplete",
        route: "panel_control",
        terminal_artifact_kind: "workspace_action_receipt",
        final_answer_source: "artifact_synthesis",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "ask:capability-incomplete", completed_solver_path: true },
      goal_satisfaction_evaluation: satisfiedGoal("docs_panel_open", "workspace_action_receipt"),
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId: "ask:capability-incomplete",
      finalRoute: "panel_control",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:capability-incomplete", payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId: "ask:capability-incomplete",
        finalRoute: "panel_control",
        payload,
      }),
    });

    expect(decision.decision).toBe("fail_closed");
    expect(decision.blocking_reasons).toContain("capability_lifecycle_incomplete");
  });

  it("allows materialized scholarly answers backed by agent-loop observations without receipt-style adapter lifecycle records", () => {
    const turnId = "ask:scholarly-materialized-controller";
    const scholarlyObservationRef = `${turnId}:runtime_tool_call:1:scholarly_research_observation`;
    const theoryReceiptRef = `${turnId}:theory_context_reflection_receipt`;
    const scholarlyAnswerRef = `${turnId}:scholarly_research_answer`;
    const finalDraftRef = `${turnId}:final_answer_draft`;
    const finalText = "Scholarly research and theory locator observations were re-entered before synthesis.";
    const payload = {
      active_prompt:
        "Use scholarly research to find papers about quantum coherence in photosynthesis, then use the Theory Badge Graph locator and synthesize uncertainty.",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "scholarly_research_lookup",
        answer_scope: "external_scholarly_research",
        required_terminal_kind: "scholarly_research_answer",
      },
      route_reason_code: "conversation:simple",
      source_target_intent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "scholarly_research",
        target_kind: "scholarly_research_lookup",
        strength: "hard",
        must_enter_backend_ask: true,
        allow_no_tool_direct: false,
      },
      terminal_artifact_kind: "scholarly_research_answer",
      terminal_artifact_id: scholarlyAnswerRef,
      final_answer_source: "final_answer_draft",
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: finalDraftRef,
        text: finalText,
        authority: "llm_post_observation_composer",
        composer_scope: "source_tool_backed",
        support_refs: [scholarlyObservationRef],
        receipt_refs: [theoryReceiptRef],
        grounded_in_observation_refs: [scholarlyObservationRef],
      },
      scholarly_research_answer: {
        schema: "helix.scholarly_research_answer.v1",
        artifact_id: scholarlyAnswerRef,
        text: finalText,
        answer_text: finalText,
        final_answer_draft_ref: finalDraftRef,
        support_refs: [scholarlyObservationRef, theoryReceiptRef],
        receipt_refs: [theoryReceiptRef],
        source_observation_refs: [scholarlyObservationRef],
        terminal_source: "final_answer_draft",
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "conversation:simple",
        terminal_artifact_kind: "scholarly_research_answer",
        final_answer_source: "final_answer_draft",
        terminal_kind: "answer",
        server_authoritative: true,
      },
      terminal_consistency_check: {
        schema: "helix.terminal_consistency_check.v1",
        turn_id: turnId,
        goal_kind: "scholarly_research_lookup",
        required_terminal_kind: "scholarly_research_answer",
        selected_terminal_kind: "scholarly_research_answer",
        satisfaction_terminal_kind: "final_answer",
        final_answer_source: "final_answer_draft",
        consistent: true,
        violations: [],
      },
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        applies: true,
        required_observation_families: ["scholarly_research", "theory_locator"],
        admitted_tool_families: ["scholarly_research", "theory_locator"],
        observed_families: ["scholarly_research", "theory_locator"],
        missing_observation_families: [],
        complete: true,
      },
      compound_prompt_coverage_gate: {
        schema: "helix.compound_prompt_coverage_gate.v1",
        applies: true,
        passed: false,
        decision: "FAIL_CLOSED",
        reason: "stale coverage gate evaluated before scholarly terminal materialization",
        unresolved_requirement_ids: ["R1"],
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: turnId,
        capability_family: "scholarly_research",
        requested_action: "lookup_papers",
        selected_capability: "scholarly-research.lookup_papers",
        admission_status: "admitted",
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: turnId, completed_solver_path: true },
      goal_satisfaction_evaluation: satisfiedGoal("scholarly_research_lookup", "scholarly_research_answer"),
      terminal_equivalence_harness_result: terminalEquivalenceOk,
      agent_step_decision: {
        schema: "helix.agent_step_decision.v1",
        decision_id: `${turnId}:decision:3`,
        chosen_capability: "answer",
        next_step: "answer",
        decision_authority: "llm",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            decision_id: `${turnId}:decision:1`,
            chosen_capability: "scholarly-research.lookup_papers",
            decision_authority: "llm",
            decision_timing: "pre_action",
            observed_artifact_refs: [scholarlyObservationRef],
          },
          {
            decision_id: `${turnId}:decision:2`,
            chosen_capability: "helix_ask.reflect_theory_context",
            decision_authority: "llm",
            decision_timing: "post_observation",
            observed_artifact_refs: [theoryReceiptRef],
          },
          {
            decision_id: `${turnId}:decision:3`,
            chosen_capability: "answer",
            decision_authority: "llm",
            decision_timing: "post_observation",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: scholarlyObservationRef,
          turn_id: turnId,
          kind: "scholarly_research_observation",
          payload: { schema: "helix.scholarly_research_observation.v1" },
        },
        {
          artifact_id: theoryReceiptRef,
          turn_id: turnId,
          kind: "helix_theory_context_reflection_tool_receipt",
          payload: { schema: "helix.theory_context_reflection_tool_receipt.v1" },
        },
        {
          artifact_id: finalDraftRef,
          turn_id: turnId,
          kind: "final_answer_draft",
          payload: {
            schema: "helix.final_answer_draft.v1",
            authority: "llm_post_observation_composer",
            composer_scope: "source_tool_backed",
            text: finalText,
            support_refs: [scholarlyObservationRef],
            receipt_refs: [theoryReceiptRef],
          },
        },
        {
          artifact_id: scholarlyAnswerRef,
          turn_id: turnId,
          kind: "scholarly_research_answer",
          payload: {
            schema: "helix.scholarly_research_answer.v1",
            support_refs: [scholarlyObservationRef, theoryReceiptRef],
            source_observation_refs: [scholarlyObservationRef],
            receipt_refs: [theoryReceiptRef],
          },
        },
      ],
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "conversation:simple",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId, payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({ turnId, finalRoute: "conversation:simple", payload }),
    });

    expect(decision.decision).toBe("allow_terminal");
    expect(decision.blocking_reasons).not.toContain("capability_lifecycle_incomplete");
    expect(decision.blocking_reasons).not.toContain("compound_prompt_coverage_incomplete");
    expect(decision.superseded_blocking_reasons).toContain("compound_prompt_coverage_incomplete");
    expect(decision.compound_prompt_coverage_gate_superseded_by_answer_artifact).toBe(true);
    expect(decision.compound_prompt_coverage_superseded_ref).toBe(scholarlyAnswerRef);
  });

  it("blocks scholarly answer coverage when ledger-only itinerary execution state is incomplete", () => {
    const turnId = "ask:scholarly-incomplete-ledger-controller";
    const scholarlyObservationRef = `${turnId}:runtime_tool_call:1:scholarly_research_observation`;
    const scholarlyAnswerRef = `${turnId}:scholarly_research_answer`;
    const finalDraftRef = `${turnId}:final_answer_draft`;
    const finalText = "Scholarly research was summarized before all required compound subgoals completed.";
    const executionState = {
      schema: "helix.capability_itinerary_execution_state.v1",
      applies: true,
      complete: false,
      required_observation_families: ["scholarly_research", "theory_locator"],
      admitted_tool_families: ["scholarly_research", "theory_locator"],
      observed_families: ["scholarly_research"],
      missing_observation_families: ["theory_locator"],
    };
    const payload = {
      active_prompt:
        "Use scholarly research to find papers, then use the Theory Badge Graph locator and synthesize.",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "scholarly_research_lookup",
        answer_scope: "external_scholarly_research",
        required_terminal_kind: "scholarly_research_answer",
      },
      route_reason_code: "conversation:simple",
      source_target_intent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "scholarly_research",
        target_kind: "scholarly_research_lookup",
        strength: "hard",
        must_enter_backend_ask: true,
        allow_no_tool_direct: false,
      },
      terminal_artifact_kind: "scholarly_research_answer",
      terminal_artifact_id: scholarlyAnswerRef,
      final_answer_source: "final_answer_draft",
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: finalDraftRef,
        text: finalText,
        authority: "llm_post_observation_composer",
        composer_scope: "source_tool_backed",
        support_refs: [scholarlyObservationRef],
        grounded_in_observation_refs: [scholarlyObservationRef],
      },
      scholarly_research_answer: {
        schema: "helix.scholarly_research_answer.v1",
        artifact_id: scholarlyAnswerRef,
        text: finalText,
        answer_text: finalText,
        final_answer_draft_ref: finalDraftRef,
        support_refs: [scholarlyObservationRef],
        source_observation_refs: [scholarlyObservationRef],
        terminal_source: "final_answer_draft",
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "conversation:simple",
        terminal_artifact_kind: "scholarly_research_answer",
        final_answer_source: "final_answer_draft",
        terminal_kind: "answer",
        server_authoritative: true,
      },
      terminal_consistency_check: {
        schema: "helix.terminal_consistency_check.v1",
        turn_id: turnId,
        goal_kind: "scholarly_research_lookup",
        required_terminal_kind: "scholarly_research_answer",
        selected_terminal_kind: "scholarly_research_answer",
        satisfaction_terminal_kind: "final_answer",
        final_answer_source: "final_answer_draft",
        consistent: true,
        violations: [],
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: turnId,
        capability_family: "scholarly_research",
        requested_action: "lookup_papers",
        selected_capability: "scholarly-research.lookup_papers",
        admission_status: "admitted",
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: turnId, completed_solver_path: true },
      goal_satisfaction_evaluation: satisfiedGoal("scholarly_research_lookup", "scholarly_research_answer"),
      terminal_equivalence_harness_result: terminalEquivalenceOk,
      agent_step_decision: {
        schema: "helix.agent_step_decision.v1",
        decision_id: `${turnId}:decision:2`,
        chosen_capability: "answer",
        next_step: "answer",
        decision_authority: "llm",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            decision_id: `${turnId}:decision:1`,
            chosen_capability: "scholarly-research.lookup_papers",
            decision_authority: "llm",
            decision_timing: "pre_action",
            observed_artifact_refs: [scholarlyObservationRef],
          },
          {
            decision_id: `${turnId}:decision:2`,
            chosen_capability: "answer",
            decision_authority: "llm",
            decision_timing: "post_observation",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: scholarlyObservationRef,
          turn_id: turnId,
          kind: "scholarly_research_observation",
          payload: { schema: "helix.scholarly_research_observation.v1" },
        },
        {
          artifact_id: finalDraftRef,
          turn_id: turnId,
          kind: "final_answer_draft",
          payload: {
            schema: "helix.final_answer_draft.v1",
            authority: "llm_post_observation_composer",
            composer_scope: "source_tool_backed",
            text: finalText,
            support_refs: [scholarlyObservationRef],
          },
        },
        {
          artifact_id: scholarlyAnswerRef,
          turn_id: turnId,
          kind: "scholarly_research_answer",
          payload: {
            schema: "helix.scholarly_research_answer.v1",
            support_refs: [scholarlyObservationRef],
            source_observation_refs: [scholarlyObservationRef],
          },
        },
        {
          artifact_id: `${turnId}:capability_itinerary_execution_state`,
          turn_id: turnId,
          kind: "capability_itinerary_execution_state",
          payload: executionState,
        },
      ],
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "conversation:simple",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId, payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({ turnId, finalRoute: "conversation:simple", payload }),
    });

    expect(decision.decision).toBe("fail_closed");
    expect(decision.blocking_reasons).toContain("capability_lifecycle_incomplete");
    expect(decision.compound_prompt_coverage_gate_superseded_by_answer_artifact).not.toBe(true);
  });

  it("allows workstation action receipts after plan, adapter result, lifecycle, and re-entry are complete", () => {
    const payload = {
      active_prompt: "Open the docs panel.",
      canonical_goal_frame: {
        turn_id: "ask:capability-complete",
        goal_kind: "panel_control",
        required_terminal_kind: "workspace_action_receipt",
      },
      route_reason_code: "panel_control",
      terminal_artifact_kind: "workspace_action_receipt",
      final_answer_source: "artifact_synthesis",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:capability-complete",
        route: "panel_control",
        terminal_artifact_kind: "workspace_action_receipt",
        final_answer_source: "artifact_synthesis",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "ask:capability-complete", completed_solver_path: true },
      ...runtimeLoopOk("ask:capability-complete", "docs-viewer.open", "workspace_action_receipt"),
      ...capabilityLifecycleOk("ask:capability-complete", "workspace_action_receipt"),
      goal_satisfaction_evaluation: satisfiedGoal("docs_panel_open", "workspace_action_receipt"),
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId: "ask:capability-complete",
      finalRoute: "panel_control",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:capability-complete", payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId: "ask:capability-complete",
        finalRoute: "panel_control",
        payload,
      }),
    });

    expect(decision.decision).toBe("allow_terminal");
    expect(decision.blocking_reasons).toEqual([]);
    expect(decision.consumed_artifact_refs).toEqual(
      expect.arrayContaining([
        "capability_plan",
        "capability_result",
        "capability_lifecycle_ledger",
        "capability_adapter_request",
        "capability_adapter_result",
      ]),
    );
  });

  it("blocks normal terminal answers when the goal satisfaction evaluator did not allow terminal", () => {
    const payload = {
      active_prompt: "Okay, can you open up the Docs panel?",
      canonical_goal_frame: {
        turn_id: "ask:docs-panel",
        goal_kind: "panel_control",
        required_terminal_kind: "workspace_action_receipt",
      },
      route_reason_code: "panel_control",
      terminal_artifact_kind: "workspace_action_receipt",
      final_answer_source: "artifact_synthesis",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:docs-panel",
        route: "panel_control",
        terminal_artifact_kind: "workspace_action_receipt",
        final_answer_source: "artifact_synthesis",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: {
        schema: "helix.ask_turn_solver_trace.v1",
        turn_id: "ask:docs-panel",
        completed_solver_path: true,
        final_arbitration: { reason: "all_subgoals_observed" },
      },
      goal_satisfaction_evaluation: {
        ...satisfiedGoal("docs_panel_open", "workspace_action_receipt"),
        satisfaction: "not_satisfied",
        next_decision: "continue",
      },
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId: "ask:docs-panel",
      finalRoute: "panel_control",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:docs-panel", payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId: "ask:docs-panel",
        finalRoute: "panel_control",
        payload,
      }),
    });

    expect(decision.decision).toBe("continue");
    expect(decision.blocking_reasons).toEqual(
      expect.arrayContaining(["goal_not_satisfied", "subgoals_observed_not_satisfied"]),
    );
  });

  it("blocks satisfied evaluations whose terminal artifact kind is not required by the goal contract", () => {
    const payload = {
      canonical_goal_frame: {
        turn_id: "ask:wrong-terminal",
        goal_kind: "panel_control",
        required_terminal_kind: "workspace_action_receipt",
      },
      route_reason_code: "panel_control",
      terminal_artifact_kind: "active_doc_identity",
      final_answer_source: "artifact_synthesis",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:wrong-terminal",
        route: "panel_control",
        terminal_artifact_kind: "active_doc_identity",
        final_answer_source: "artifact_synthesis",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "ask:wrong-terminal", completed_solver_path: true },
      goal_satisfaction_evaluation: satisfiedGoal("docs_panel_open", "workspace_action_receipt"),
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId: "ask:wrong-terminal",
      finalRoute: "panel_control",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:wrong-terminal", payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId: "ask:wrong-terminal",
        finalRoute: "panel_control",
        payload,
      }),
    });

    expect(decision.decision).toBe("typed_failure");
    expect(decision.blocking_reasons).toContain("terminal_kind_not_required");
  });

  it("allows satisfied model-only direct answers carried by a final-answer draft", () => {
    const turnId = "ask:model-only-direct";
    const payload = {
      active_prompt:
        "Do not call tools. Explain conceptually why receipts should be observations rather than terminal answers.",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      route_reason_code: "model_only_concept",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        turn_id: turnId,
        text: "Receipts are observations because they record what a tool produced; terminal answers require the solver path to select an answer artifact.",
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "model_only_concept",
        terminal_artifact_kind: "direct_answer_text",
        final_answer_source: "model_direct_answer",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: turnId, completed_solver_path: true },
      goal_satisfaction_evaluation: {
        ...satisfiedGoal("model_only_concept", "direct_answer_text"),
        turn_id: turnId,
        required_evidence: [
          {
            kind: "direct_answer_text",
            required: true,
            satisfied: true,
            evidence_ref: `${turnId}:final_answer_draft`,
          },
        ],
        observed_results: [
          {
            ref: `${turnId}:final_answer_draft`,
            kind: "direct_answer_text",
            status: "present",
            supports_goal: true,
            reason: "model-only direct answer draft satisfies the suppression contract.",
          },
        ],
      },
      terminal_equivalence_harness_result: terminalEquivalenceOk,
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:final_answer_draft`,
          turn_id: turnId,
          kind: "final_answer_draft",
          payload: {
            kind: "direct_answer_text",
            text: "Receipts are observations because they record what a tool produced.",
          },
        },
      ],
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "model_only_concept",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId, payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId,
        finalRoute: "model_only_concept",
        payload,
      }),
    });

    expect(decision.decision).toBe("allow_terminal");
    expect(decision.blocking_reasons).not.toContain("terminal_kind_not_required");
    expect(decision.blocking_reasons).not.toContain("solver_path_incomplete");
  });

  it("allows satisfied model-only direct answers carried by current-turn ledger evidence", () => {
    const turnId = "ask:model-only-ledger-direct";
    const directAnswerRef = "direct_answer_text:ledger-proof";
    const payload = {
      active_prompt: "Explain conceptually why a controller may answer directly.",
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      route_reason_code: "model_only_concept",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "agent_runtime_loop",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "model_only_concept",
        terminal_artifact_kind: "direct_answer_text",
        final_answer_source: "model_direct_answer",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: {
        schema: "helix.ask_turn_solver_trace.v1",
        turn_id: turnId,
        completed_solver_path: false,
      },
      goal_satisfaction_evaluation: {
        ...satisfiedGoal("model_only_concept", "direct_answer_text"),
        turn_id: turnId,
        required_evidence: [
          {
            kind: "direct_answer_text",
            required: true,
            satisfied: true,
            evidence_ref: directAnswerRef,
          },
        ],
        observed_results: [
          {
            ref: directAnswerRef,
            kind: "direct_answer_text",
            status: "observed",
            supports_goal: true,
            reason: "satisfies_goal_terminal_contract",
          },
        ],
      },
      terminal_equivalence_harness_result: terminalEquivalenceOk,
      current_turn_artifact_ledger: [
        {
          artifact_id: directAnswerRef,
          turn_id: turnId,
          kind: "direct_answer_text",
          payload: {
            text: "Direct answers are allowed only when the model-only terminal contract is satisfied.",
          },
        },
      ],
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "model_only_concept",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId, payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId,
        finalRoute: "model_only_concept",
        payload,
      }),
    });

    expect(decision.decision).toBe("allow_terminal");
    expect(decision.blocking_reasons).not.toContain("terminal_kind_not_required");
    expect(decision.blocking_reasons).not.toContain("solver_path_incomplete");
  });

  it("fails source-targeted normal terminals that lack a required artifact contract", () => {
    const payload = {
      active_prompt: "Open the docs panel.",
      canonical_goal_frame: {
        turn_id: "ask:missing-contract",
        goal_kind: "panel_control",
        required_terminal_kind: "workspace_action_receipt",
      },
      source_target_intent: {
        target_source: "docs_viewer",
        target_kind: "docs_viewer",
        strength: "hard",
        requested_outputs: ["workspace_action_receipt"],
        allow_no_tool_direct: false,
      },
      route_reason_code: "panel_control",
      terminal_artifact_kind: "workspace_action_receipt",
      final_answer_source: "artifact_synthesis",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:missing-contract",
        route: "panel_control",
        terminal_artifact_kind: "workspace_action_receipt",
        final_answer_source: "artifact_synthesis",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "ask:missing-contract", completed_solver_path: true },
      goal_satisfaction_evaluation: {
        ...satisfiedGoal("docs_panel_open", "workspace_action_receipt"),
        terminal_contract: undefined,
      },
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId: "ask:missing-contract",
      finalRoute: "panel_control",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:missing-contract", payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId: "ask:missing-contract",
        finalRoute: "panel_control",
        payload,
      }),
    });

    expect(decision.decision).toBe("typed_failure");
    expect(decision.blocking_reasons).toContain("required_artifact_contract_missing");
  });

  it("treats capability binding mismatch as a retryable observation before terminal failure", () => {
    const payload = {
      active_prompt: "Run the Dottie observer chain.",
      canonical_goal_frame: {
        turn_id: "ask:dottie-mismatch",
        goal_kind: "panel_control",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      route_reason_code: "panel_control",
      source_target_intent: {
        target_source: "workstation_panel",
        target_kind: "panel_control",
        strength: "hard",
        requested_outputs: ["workstation_tool_evaluation"],
        allow_no_tool_direct: false,
      },
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:dottie-mismatch",
        route: "panel_control",
        terminal_artifact_kind: "workstation_tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "ask:dottie-mismatch", completed_solver_path: false },
      goal_satisfaction_evaluation: satisfiedGoal("panel_control", "workstation_tool_evaluation"),
      terminal_equivalence_harness_result: terminalEquivalenceOk,
      agent_step_decision: {
        schema: "helix.agent_step_decision.v1",
        decision_id: "ask:dottie-mismatch:decision:1",
        chosen_capability: "docs-viewer.open",
        decision_authority: "llm",
        assistant_answer: false,
        raw_content_included: false,
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            decision_id: "ask:dottie-mismatch:decision:1",
            chosen_capability: "docs-viewer.open",
            decision_authority: "llm",
            decision_timing: "post_observation",
            observed_artifact_refs: ["ask:dottie-mismatch:dottie-attach"],
          },
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "ask:dottie-mismatch:dottie-attach",
          turn_id: "ask:dottie-mismatch",
          kind: "dottie_observer_subscription_receipt",
          payload: {
            schema: "helix.dottie_observer_subscription.v1",
            panel_id: "situation-room-pipelines",
            action_id: "observer.attach",
          },
        },
      ],
    };

    const decision = buildSolverControllerDecision({
      turnId: "ask:dottie-mismatch",
      finalRoute: "panel_control",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:dottie-mismatch", payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId: "ask:dottie-mismatch",
        finalRoute: "panel_control",
        payload,
      }),
    });

    expect(decision.decision).toBe("retry");
    expect(decision.retry_policy_ref).toBe("capability_binding_mismatch_observation");
    expect(decision.blocking_reasons).toContain("selected_capability_observation_missing");
    expect(decision.consumed_artifact_refs).toContain("capability_binding_mismatch_observation");
  });

  it("allows a satisfied workstation tool evaluation without generic adapter envelope", () => {
    const payload = {
      active_prompt: "Use the scientific calculator to solve 2+2.",
      canonical_goal_frame: {
        turn_id: "ask:calculator-tool-eval",
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      route_reason_code: "calculator_solve",
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:calculator-tool-eval",
        route: "calculator_solve",
        terminal_artifact_kind: "workstation_tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: "ask:calculator-tool-eval", completed_solver_path: true },
      goal_satisfaction_evaluation: {
        ...satisfiedGoal("calculator_solve", "workstation_tool_evaluation"),
        terminal_contract: {
          goal_kind: "calculator_solve",
          required_terminal_kinds: ["workstation_tool_evaluation"],
          acceptable_fallbacks: ["typed_failure"],
          forbidden_terminal_kinds: ["direct_answer_text"],
          required_actions: ["scientific-calculator.solve"],
          required_evidence: ["calculator_receipt", "workstation_tool_evaluation"],
        },
      },
      observation_review: {
        schema: "helix.observation_review.v1",
        does_it_satisfy_goal: true,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "ask:calculator-tool-eval:workstation_tool_evaluation",
          turn_id: "ask:calculator-tool-eval",
          kind: "workstation_tool_evaluation",
          payload: {
            schema: "helix.workstation_tool_evaluation.v1",
            supports_goal: true,
          },
        },
      ],
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId: "ask:calculator-tool-eval",
      finalRoute: "calculator_solve",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:calculator-tool-eval", payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId: "ask:calculator-tool-eval",
        finalRoute: "calculator_solve",
        payload,
      }),
    });

    expect(decision.decision).toBe("allow_terminal");
    expect(decision.blocking_reasons).not.toContain("capability_lifecycle_incomplete");
  });

  it("normalizes stale model-draft mirrors when terminal authority selected workstation tool evaluation", () => {
    const payload = {
      active_prompt: "Call scientific-calculator.solve_expression with 2+2 and answer from workstation_tool_evaluation.",
      canonical_goal_frame: {
        turn_id: "ask:calculator-stale-model-mirror",
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      route_reason_code: "calculator_solve",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:calculator-stale-model-mirror",
        route: "dispatch:act",
        terminal_artifact_kind: "workstation_tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
        server_authoritative: true,
      },
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        turn_id: "ask:calculator-stale-model-mirror",
        selected_terminal_artifact_kind: "workstation_tool_evaluation",
        source: "workstation_tool_evaluation",
        visible_text: "Calculator verification plan completed.\nExpression: 2+2\nResult: 4",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: "ask:calculator-stale-model-mirror",
        terminal_artifact_kind: "workstation_tool_evaluation",
        concise_text: "Calculator verification plan completed.\nExpression: 2+2\nResult: 4",
      },
      resolved_turn_summary: {
        terminal_artifact_kind: "workstation_tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: {
        schema: "helix.ask_turn_solver_trace.v1",
        turn_id: "ask:calculator-stale-model-mirror",
        completed_solver_path: true,
        final_arbitration: {
          terminal_artifact_kind: "model_synthesized_answer",
          final_answer_source: "final_answer_draft",
        },
      },
      goal_satisfaction_evaluation: {
        ...satisfiedGoal("calculator_solve", "workstation_tool_evaluation"),
        terminal_contract: {
          goal_kind: "calculator_solve",
          required_terminal_kinds: ["workstation_tool_evaluation"],
          acceptable_fallbacks: ["typed_failure"],
          forbidden_terminal_kinds: ["direct_answer_text", "model_synthesized_answer"],
          required_actions: ["scientific-calculator.solve_expression"],
          required_evidence: ["calculator_receipt", "workstation_tool_evaluation"],
        },
      },
      observation_review: {
        schema: "helix.observation_review.v1",
        does_it_satisfy_goal: true,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "ask:calculator-stale-model-mirror:workstation_tool_evaluation",
          turn_id: "ask:calculator-stale-model-mirror",
          kind: "workstation_tool_evaluation",
          payload: {
            schema: "helix.workstation_tool_evaluation.v1",
            supports_goal: true,
          },
        },
      ],
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId: "ask:calculator-stale-model-mirror",
      finalRoute: "calculator_solve",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:calculator-stale-model-mirror", payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId: "ask:calculator-stale-model-mirror",
        finalRoute: "calculator_solve",
        payload,
      }),
    });

    expect(decision.decision).toBe("allow_terminal");
    expect(decision.canonical_goal_kind).toBe("calculator_solve");
    expect(decision.required_terminal_kind).toBe("workstation_tool_evaluation");
    expect(decision.selected_terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(payload.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(payload.final_answer_source).toBe("workstation_tool_evaluation");
  });

  it("continues live-source record_decision phase instead of allowing typed failure without decision receipt", () => {
    const turnId = "ask:live-source-missing-decision";
    const payload = {
      canonical_goal_frame: {
        goal_kind: "live_environment_review",
        required_terminal_kind: "model_synthesized_answer",
      },
      route_reason_code: "live_environment_review",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "live_environment_review",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: turnId, completed_solver_path: false },
      goal_satisfaction_evaluation: {
        ...satisfiedGoal("live_environment_review", "model_synthesized_answer"),
        satisfaction: "partially_satisfied",
        next_decision: "fail_closed",
      },
      live_source_turn_phase_resolution: {
        artifactId: "live_source_turn_phase_resolution",
        schemaVersion: "live_source_turn_phase_resolution/v1",
        phase: "record_decision",
        reason: "Processed packet recommends a voice callout.",
        canonicalGoal: "processed_mail_voice_decision",
        allowedTools: ["live_env.record_live_source_mail_decision"],
        fallbackTools: [],
        forbiddenTools: ["live_env.request_interim_voice_callout", "final_answer"],
        requiredEvidence: ["stage_play_processed_mail_packet"],
        completionEvidence: ["stage_play_live_source_mail_decision"],
        nextPhase: "request_voice_after_decision",
        phaseLock: {
          locked: true,
          reason: "Decision authority must be recorded before voice output.",
        },
        evidenceRefs: ["stage_play_processed_mail_packet:voice"],
        assistant_answer: false,
        terminal_eligible: false,
        context_role: "tool_policy",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:processed_packet`,
          turn_id: turnId,
          kind: "live_environment_tool_observation",
          payload: {
            tool_name: "live_env.read_processed_live_source_mail",
            observation: {
              artifactId: "stage_play_processed_mail_packet",
              schemaVersion: "stage_play_processed_mail_packet/v1",
              recommendedNext: "request_voice_callout",
            },
          },
        },
      ],
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "live_environment_review",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId, payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId,
        finalRoute: "live_environment_review",
        payload,
      }),
    });

    expect(decision.decision).toBe("continue");
    expect(decision.blocking_reasons).toContain("missing_required_live_source_mail_decision");
  });

  it("continues live-source voice phase until the voice receipt or hold receipt exists", () => {
    const turnId = "ask:live-source-missing-voice-receipt";
    const payload = {
      canonical_goal_frame: {
        goal_kind: "live_environment_review",
        required_terminal_kind: "model_synthesized_answer",
      },
      route_reason_code: "live_environment_review",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "live_environment_review",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: turnId, completed_solver_path: false },
      goal_satisfaction_evaluation: {
        ...satisfiedGoal("live_environment_review", "model_synthesized_answer"),
        satisfaction: "partially_satisfied",
        next_decision: "fail_closed",
      },
      live_source_turn_phase_resolution: {
        artifactId: "live_source_turn_phase_resolution",
        schemaVersion: "live_source_turn_phase_resolution/v1",
        phase: "request_voice_after_decision",
        reason: "Recorded decision requests a voice callout.",
        canonicalGoal: "processed_mail_voice_decision",
        allowedTools: ["live_env.request_interim_voice_callout"],
        fallbackTools: [],
        forbiddenTools: ["live_env.record_live_source_mail_decision", "final_answer"],
        requiredEvidence: ["stage_play_live_source_mail_decision"],
        completionEvidence: [
          "live_source_interim_voice_callout_receipt",
          "voice_hold_receipt",
          "voice_block_receipt",
          "voice_receipt",
        ],
        phaseLock: {
          locked: true,
          reason: "Voice output is only allowed after a recorded request_voice_callout decision.",
        },
        assistant_answer: false,
        terminal_eligible: false,
        context_role: "tool_policy",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:decision`,
          turn_id: turnId,
          kind: "live_environment_tool_observation",
          payload: {
            tool_name: "live_env.record_live_source_mail_decision",
            observation: {
              artifactId: "stage_play_live_source_mail_decision",
              schemaVersion: "stage_play_live_source_mail_decision/v1",
              decision: "request_voice_callout",
            },
          },
        },
      ],
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "live_environment_review",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId, payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId,
        finalRoute: "live_environment_review",
        payload,
      }),
    });

    expect(decision.decision).toBe("continue");
    expect(decision.blocking_reasons).toContain("missing_required_voice_receipt_or_hold");
  });

  it("continues after terminal authority rejects a stale model-only fallback with observations present", () => {
    const turnId = "ask:stale-model-after-observation";
    const payload = {
      canonical_goal_frame: {
        goal_kind: "live_environment_review",
        required_terminal_kind: "model_synthesized_answer",
      },
      route_reason_code: "live_environment_review",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "live_environment_review",
        terminal_artifact_kind: "model_synthesized_answer",
        final_answer_source: "final_answer_draft",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: turnId, completed_solver_path: false },
      goal_satisfaction_evaluation: satisfiedGoal("live_environment_review", "model_synthesized_answer"),
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        rejected_candidates: [
          {
            kind: "model_synthesized_answer",
            source: "final_answer_draft",
            reason: "composer_claimed_no_observations_but_receipts_exist",
          },
        ],
      },
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "live_environment_review",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId, payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId,
        finalRoute: "live_environment_review",
        payload,
      }),
    });

    expect(decision.decision).toBe("continue");
    expect(decision.blocking_reasons).toContain("composer_claimed_no_observations_but_receipts_exist");
  });

  it("continues when a receipt candidate explicitly is not terminal eligible", () => {
    const turnId = "ask:receipt-not-terminal";
    const payload = {
      canonical_goal_frame: {
        goal_kind: "live_environment_review",
        required_terminal_kind: "model_synthesized_answer",
      },
      route_reason_code: "live_environment_review",
      terminal_artifact_kind: "tool_receipt",
      final_answer_source: "deterministic_receipt_fallback",
      terminal_eligible: false,
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "live_environment_review",
        terminal_artifact_kind: "tool_receipt",
        final_answer_source: "deterministic_receipt_fallback",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: { schema: "helix.ask_turn_solver_trace.v1", turn_id: turnId, completed_solver_path: true },
      goal_satisfaction_evaluation: satisfiedGoal("live_environment_review", "model_synthesized_answer"),
      terminal_equivalence_harness_result: terminalEquivalenceOk,
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "live_environment_review",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId, payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId,
        finalRoute: "live_environment_review",
        payload,
      }),
    });

    expect(decision.decision).toBe("continue");
    expect(decision.blocking_reasons).toContain("receipt_not_terminal_eligible");
  });

  it("surfaces admitted capability plans that never dispatch", () => {
    const payload = {
      active_prompt: "Search docs for Helix Ask console debug.",
      canonical_goal_frame: {
        turn_id: "ask:admitted-not-dispatched",
        goal_kind: "doc_lookup",
        required_terminal_kind: "doc_search_result",
      },
      route_reason_code: "doc_lookup",
      terminal_artifact_kind: "doc_search_result",
      final_answer_source: "doc_search_result",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: "ask:admitted-not-dispatched",
        route: "doc_lookup",
        terminal_artifact_kind: "doc_search_result",
        final_answer_source: "doc_search_result",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: {
        schema: "helix.ask_turn_solver_trace.v1",
        turn_id: "ask:admitted-not-dispatched",
        completed_solver_path: false,
      },
      goal_satisfaction_evaluation: satisfiedGoal("doc_lookup", "doc_search_result"),
      terminal_equivalence_harness_result: terminalEquivalenceOk,
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:admitted-not-dispatched",
        capability_family: "docs",
        requested_action: "search_docs",
        mutating: false,
        operator_command_required: false,
        operator_command_present: false,
        source_target: "docs_viewer",
        goal_kind: "doc_lookup",
        required_terminal_kind: "doc_search_result",
        admission_status: "needs_evidence",
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_lifecycle_ledger: {
        schema: "helix.capability_lifecycle_ledger.v1",
        turn_id: "ask:admitted-not-dispatched",
        capability_plan_id: "capability_plan:ask:admitted-not-dispatched:docs:search_docs",
        capability_result_id: null,
        stages: [
          {
            stage: "dispatched",
            status: "failed",
            refs: [],
            reason: "capability_admitted_not_dispatched",
          },
        ],
        failure_codes: ["capability_admitted_not_dispatched", "capability_result_missing"],
        ok: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const decision = buildSolverControllerDecision({
      turnId: "ask:admitted-not-dispatched",
      finalRoute: "doc_lookup",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId: "ask:admitted-not-dispatched", payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId: "ask:admitted-not-dispatched",
        finalRoute: "doc_lookup",
        payload,
      }),
    });

    expect(decision.decision).toBe("fail_closed");
    expect(decision.blocking_reasons).toContain("capability_admitted_not_dispatched");
    expect(decision.blocking_reasons).toContain("capability_lifecycle_incomplete");
    expect(decision.typed_failure_code).toBe("capability_admitted_not_dispatched");
  });

  it("blocks provider terminal candidates when required evidence re-entry is incomplete", () => {
    const turnId = "ask:scholarly-reentry-missing";
    const observationRef = `${turnId}:workstation_gateway:scholarly-research.lookup_papers:observation`;
    const payload = {
      active_prompt: "Search scholarly research for weyl curvature",
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        turn_id: turnId,
        goal_kind: "agent_provider_gateway_turn",
        requested_capability: "scholarly-research.lookup_papers",
        required_terminal_kind: "agent_provider_terminal_candidate",
        source: "codex_provider_workstation_gateway_projection",
        assistant_answer: false,
        raw_content_included: false,
      },
      route_reason_code: "agent_provider_gateway_turn",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      selected_final_answer: "Scholarly search returned weakly matched papers.",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        route: "/ask/turn/stream",
        terminal_artifact_kind: "agent_provider_terminal_candidate",
        final_answer_source: "agent_provider_terminal_candidate",
        server_authoritative: true,
      },
      poison_audit: { schema: "helix.turn_poison_audit.v1", ok: true, violations: [] },
      route_authority_audit: { schema: "helix.route_authority_audit.v1", route_authority_ok: true },
      ask_turn_solver_trace: {
        schema: "helix.ask_turn_solver_trace.v1",
        turn_id: turnId,
        completed_solver_path: false,
        evidence_reentry_gate: {
          schema: "helix.evidence_reentry_gate.v1",
          turn_id: turnId,
          required: true,
          completed: false,
          selected_evidence_refs: [],
          violation_codes: ["source_observation_terminal_without_selection"],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      goal_satisfaction_evaluation: satisfiedGoal("agent_provider_gateway_turn", "agent_provider_terminal_candidate"),
      terminal_equivalence_harness_result: terminalEquivalenceOk,
      current_turn_artifact_ledger: [
        {
          artifact_id: observationRef,
          turn_id: turnId,
          kind: "scholarly_research_observation",
          payload: {
            schema: "helix.scholarly_research_observation.v1",
            artifact_id: observationRef,
            capability: "scholarly-research.lookup_papers",
            selected_for_answer: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "/ask/turn/stream",
      payload,
      turnIdIntegrityAudit: buildTurnIdIntegrityAudit({ turnId, payload }),
      finalRouteReconciliation: buildFinalRouteReconciliation({
        turnId,
        finalRoute: "/ask/turn/stream",
        payload,
      }),
    });

    expect(decision.decision).toBe("fail_closed");
    expect(decision.blocking_reasons).toContain("post_observation_model_decision_missing");
    expect(decision.blocking_reasons).toContain("solver_path_incomplete");
    expect(decision.typed_failure_code).toBe("post_observation_model_decision_missing");
  });
});
