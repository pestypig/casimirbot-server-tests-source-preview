import { describe, expect, it } from "vitest";
import { applyHelixTerminalAuthoritySingleWriter } from "../terminal-authority-single-writer";

describe("terminal authority for Image Lens receipt reports", () => {
  it("materializes a route-approved Image Lens report over a stale post-tool continuation failure", () => {
    const staleFailure =
      "I could not complete this turn because a tool observation required a follow-up model answer step, but no later terminal answer artifact was available.";
    const payload: Record<string, unknown> = {
      ask_turn_solver_trace: {
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          route: {
            source_target: "visual_capture",
          },
          canonical_goal: {
            goal_kind: "visual_capture",
            required_terminal_kind: "image_lens_observation_report",
            allowed_terminal_artifact_kinds: ["image_lens_observation_report"],
            forbidden_terminal_artifact_kinds: [],
          },
          capability_policy: {
            allowed_tool_families: ["visual_analysis"],
            suppressed_tool_families: [],
          },
        },
        route_evidence_authority: {
          schema: "helix.route_evidence_authority.v1",
          turn_id: "turn-image-lens-report-terminal",
          allowed_terminal_artifact_kinds: ["image_lens_observation_report"],
          forbidden_terminal_artifact_kinds: [],
          required_terminal_kind: "image_lens_observation_report",
          terminal_product_allowed: true,
          current_turn_only: true,
        },
      },
      solver_continuation_observation: {
        schema: "helix.solver_continuation_observation.v1",
        required_next_step: "model_synthesis",
      },
      terminal_artifact_kind: "image_lens_observation_report",
      final_answer_source: "provider_image_lens_observation_report",
      selected_final_answer: staleFailure,
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "image_lens_observation_report",
        concise_text: staleFailure,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "turn-image-lens-report-terminal:capability_lane:visual_analysis.inspect_image_region:equation_7",
          kind: "capability_lane_observation_packet",
          payload: {
            schema: "helix.capability_lane_observation_packet.v1",
            capability_key: "visual_analysis.inspect_image_region",
            status: "succeeded",
            region_label: "equation_7",
            bbox: { x: 73, y: 570, width: 1077, height: 87 },
            crop_ref: "sha256:test#crop=73,570,1077,87",
            extraction_status: "extracted",
            label_match_status: "matched",
            exact_equation_admissibility: "admissible_for_exact_equation",
            exact_row_promotion: { status: "promoted" },
            text_candidate: "S = \\int d^4x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_m \\}, (7)",
            latex_candidate: "S = \\int d^4x \\sqrt{-g} e^{-\\phi} \\{ R + 2\\Lambda e^{-\\phi} + \\kappa e^{-\\phi} L_m \\}, \\quad (7)",
          },
        },
      ],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId: "turn-image-lens-report-terminal",
      payload,
      artifactLedger: payload.current_turn_artifact_ledger as never,
    } as never);

    expect(result.selected_terminal_artifact_kind).toBe("image_lens_observation_report");
    expect(result.source).toBe("provider_image_lens_observation_report");
    expect(result.visible_text).toContain("admissible_for_exact_equation");
    expect(result.visible_text).toContain("latex_candidate");
    expect(result.visible_text).not.toContain("tool observation required a follow-up model answer step");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.final_answer_source).toBe("provider_image_lens_observation_report");
    expect(payload.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      intent_class: "visual_capture",
      evidence_reentry_status: "reentered",
      allowed_terminal_products: expect.arrayContaining(["image_lens_observation_report"]),
      selected_terminal_product: expect.objectContaining({
        kind: "image_lens_observation_report",
        allowed_by_route: true,
      }),
      visible_answer_source: "provider_image_lens_observation_report",
      failure_rail: null,
    });
  });

  it("allows a bounded named receipt evaluation to terminate without a follow-up synthesis step", () => {
    const payload: Record<string, unknown> = {
      solver_continuation_observation: {
        schema: "helix.solver_continuation_observation.v1",
        required_next_step: "model_synthesis",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "visual_capture",
        allowed_terminal_artifact_kinds: [
          "image_lens_named_receipt_evaluation",
          "typed_failure",
        ],
        forbidden_terminal_artifact_kinds: ["model_synthesized_answer"],
        required_artifact_refs: [],
        precedence_reason: "image_lens_named_receipt_prompt_allows_bounded_receipt_report_without_claim_synthesis",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_artifact_kind: "image_lens_named_receipt_evaluation",
      final_answer_source: "image_lens_named_receipt_evaluation",
      selected_final_answer: [
        "Receipt evaluated: `crop_1` (existing Image Lens observation; no re-crop run).",
        "- promotion status: `not_applicable`",
        "- exact equation admissibility: `partial_candidate`",
      ].join("\n"),
      named_image_lens_receipt_evaluation: {
        schema: "helix.image_lens_named_receipt_evaluation.v1",
        status: "selected",
        receipt_name: "crop_1",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId: "turn-image-lens-receipt-terminal",
      payload,
      artifactLedger: [],
    } as never);

    expect(result.selected_terminal_artifact_kind).toBe("image_lens_named_receipt_evaluation");
    expect(result.source).toBe("image_lens_named_receipt_evaluation");
    expect(payload.final_answer_source).toBe("image_lens_named_receipt_evaluation");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(String(payload.selected_final_answer)).toContain("no re-crop run");
    expect(payload.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      evidence_reentry_status: "reentered",
      selected_terminal_product: expect.objectContaining({
        kind: "image_lens_named_receipt_evaluation",
        allowed_by_route: true,
      }),
      failure_rail: null,
    });
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "typed_failure",
          reason: "stale_solver_continuation_superseded_by_image_lens_named_receipt_evaluation",
        }),
      ]),
    );
  });
});

describe("terminal authority for Theory Badge Graph reflection answers", () => {
  const theoryReceiptArtifacts = [
    {
      artifact_id: "turn-theory-reflection:theory_receipt",
      kind: "helix_theory_context_reflection_tool_receipt",
      payload: {
        schema: "helix_theory_context_reflection_tool_receipt/v1",
        text: "Theory Badge Graph reflection produced evolution and reflection adjacency notes.",
      },
    },
    {
      artifact_id: "turn-theory-reflection:theory_evaluation",
      kind: "workstation_tool_evaluation",
      payload: {
        schema: "helix.workstation_tool_evaluation.v1",
        capability_id: "theory-badge-graph.reflect_discussion_context",
        supports_subgoal: true,
        text: "Theory Badge Graph reflection produced conceptual graph context for evolution, adaptation, and reflective feedback.",
      },
    },
  ];
  const theoryProviderGatewayArtifacts = [
    {
      artifact_id: "turn-theory-reflection:theory_receipt",
      kind: "helix_theory_context_reflection_tool_receipt",
      payload_schema: "helix_theory_context_reflection_tool_receipt/v1",
      capability_key: "theory-badge-graph.reflect_discussion_context",
      status: "succeeded",
      text_preview:
        "Theory Badge Graph reflection produced conceptual graph context for evolution, adaptation, and reflective feedback.",
    },
    {
      artifact_id: "turn-theory-reflection:provider_gateway_observation",
      kind: "provider_gateway_observation_packet",
      payload_schema: "helix.agent_step_observation_packet.v1",
      capability_key: "theory-badge-graph.reflect_discussion_context",
      status: "succeeded",
    },
  ];

  const routeApprovedTheoryPayload = (question: string): Record<string, unknown> => ({
    turn_id: "turn-theory-reflection",
    question,
    canonical_goal_frame: {
      goal_kind: "theory_context_reflection",
      required_terminal_kind: "theory_context_reflection_answer",
      allowed_terminal_artifact_kinds: ["theory_context_reflection_answer"],
      forbidden_terminal_artifact_kinds: [],
      user_goal_summary: question,
    },
    route_product_contract: {
      schema: "helix.route_product_contract.v1",
      source_target: "theory_context_reflection",
      allowed_terminal_artifact_kinds: ["theory_context_reflection_answer"],
      forbidden_terminal_artifact_kinds: [],
      required_terminal_kind: "theory_context_reflection_answer",
    },
    tool_call_admission_decision: {
      requested_capability: "helix_ask.reflect_theory_context",
      requested_capability_family: "theory_locator",
      requested_capability_source: "explicit_user_command",
      selected_capability: "helix_ask.reflect_theory_context",
      admitted_capability: "helix_ask.reflect_theory_context",
    },
    agent_runtime_loop: {
      schema: "helix.agent_runtime_loop.v1",
      iterations: [
        {
          iteration: 1,
          decision_id: "turn-theory-reflection:agent_runtime_loop:decision:1",
          decision_authority: "llm",
          decision_timing: "pre_tool",
          next_step: "tool",
          chosen_capability: "helix_ask.reflect_theory_context",
          observed_artifact_refs: [
            "turn-theory-reflection:theory_receipt",
            "turn-theory-reflection:theory_evaluation",
          ],
          tool_observation: {
            status: "completed",
            kind: "helix_theory_context_reflection_tool_receipt",
            artifact_id: "turn-theory-reflection:theory_receipt",
          },
        },
        {
          iteration: 2,
          decision_id: "turn-theory-reflection:agent_runtime_loop:decision:2",
          decision_authority: "llm",
          decision_timing: "post_observation",
          next_step: "answer",
          chosen_capability: "model.direct_answer",
          observation_role: "terminal_decision",
          observed_artifact_refs: ["turn-theory-reflection:theory_evaluation"],
        },
      ],
    },
    agent_step_decision: {
      schema: "helix.agent_step_decision.v1",
      decision_id: "turn-theory-reflection:agent_runtime_loop:decision:2",
      decision_authority: "llm",
      decision_timing: "post_observation",
      next_step: "answer",
      chosen_capability: "model.direct_answer",
    },
    current_turn_artifact_ledger: theoryReceiptArtifacts,
    route_evidence_authority: {
      schema: "helix.route_evidence_authority.v1",
      allowed_terminal_artifact_kinds: ["theory_context_reflection_answer"],
      forbidden_terminal_artifact_kinds: [],
      required_terminal_kind: "theory_context_reflection_answer",
      terminal_product_allowed: true,
      current_turn_only: true,
    },
    goal_satisfaction_evaluation: {
      schema: "helix.goal_satisfaction_evaluation.v1",
      satisfaction: "satisfied",
      next_decision: "allow_terminal",
      terminal_contract: {
        required_terminal_kind: "theory_context_reflection_answer",
        allowed_terminal_artifact_kinds: ["theory_context_reflection_answer"],
      },
    },
    scientific_branch_gate: {
      schema: "helix.scientific_branch_gate.v1",
      status: "not_applicable",
      primary_domain: "unknown_math",
      congruence_grade_floor: "insufficient_evidence",
    },
  });

  it("does not replace a conceptual theory reflection with an Image Lens scientific blocker", () => {
    const payload = routeApprovedTheoryPayload(
      "What does the Theory Badge Graph say about reflection on evolution, and what would Stuart Hameroff Orch OR think about it?",
    );

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId: "turn-theory-reflection",
      payload,
      artifactLedger: theoryReceiptArtifacts,
    } as never);

    expect(result.selected_terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(result.visible_text).toContain("Theory context reflection answer:");
    expect(result.visible_text).toContain("conceptual graph context for evolution");
    expect(result.visible_text).not.toContain("Scientific evidence blocker");
    expect(result.visible_text).not.toContain("available Image Lens evidence");
    expect(result.visible_text).not.toContain("readable crop/OCR");
    expect(payload.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      intent_class: "theory_context_reflection",
      evidence_reentry_status: "reentered",
      allowed_terminal_products: expect.arrayContaining(["theory_context_reflection_answer"]),
      selected_terminal_product: expect.objectContaining({
        kind: "theory_context_reflection_answer",
        allowed_by_route: true,
      }),
      visible_answer_source: "theory_context_reflection_answer",
      failure_rail: null,
    });
  });

  it("keeps the scientific blocker for equation or calculator handoff prompts with insufficient evidence", () => {
    const payload = routeApprovedTheoryPayload(
      "Reflect the promoted equation evidence to the Theory Badge Graph and report calculator template admissibility.",
    );

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId: "turn-theory-reflection",
      payload,
      artifactLedger: theoryReceiptArtifacts,
    } as never);

    expect(result.selected_terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(result.visible_text).toContain("Scientific evidence blocker:");
    expect(result.visible_text).toContain("available Image Lens evidence");
  });

  it("lets route evidence authority recover a theory terminal when canonical goal metadata is stale", () => {
    const payload = routeApprovedTheoryPayload(
      "What does the Theory Badge Graph say about reflection on evolution? Do not use Image Lens, calculator, PDF, crop, or equation evidence.",
    );
    payload.canonical_goal_frame = {
      schema: "helix.canonical_goal_frame.v1",
      goal_kind: "agent_provider_gateway_turn",
      requested_capability: "theory-badge-graph.reflect_discussion_context",
      required_terminal_kind: "active_image_lens_source_missing",
      assistant_answer: false,
      raw_content_included: false,
    };
    delete payload.goal_satisfaction_evaluation;
    payload.solver_continuation_observation = {
      schema: "helix.solver_continuation_observation.v1",
      required_next_step: "model_synthesis",
    };
    payload.selected_final_answer =
      "I could not complete this turn because a tool observation required a follow-up model answer step, but no later terminal answer artifact was available.";
    payload.terminal_artifact_kind = "typed_failure";
    payload.final_answer_source = "typed_failure";

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId: "turn-theory-reflection",
      payload,
      artifactLedger: theoryReceiptArtifacts,
    } as never);

    expect(result.selected_terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(result.visible_text).toContain("Theory context reflection answer:");
    expect(result.visible_text).toContain("conceptual graph context for evolution");
    expect(result.visible_text).not.toContain("active_image_lens_source_missing");
    expect(result.visible_text).not.toContain("tool observation required a follow-up model answer step");
  });

  it("materializes a theory answer from the live provider gateway observation packet shape", () => {
    const payload = routeApprovedTheoryPayload(
      "What does the Theory Badge Graph say about reflection on evolution? What would Stuart Hameroff Orch OR think about it? Do not use Image Lens, calculator, PDF, crop, or equation evidence.",
    );
    payload.canonical_goal_frame = {
      schema: "helix.canonical_goal_frame.v1",
      goal_kind: "agent_provider_gateway_turn",
      requested_capability: "theory-badge-graph.reflect_discussion_context",
      required_terminal_kind: "active_image_lens_source_missing",
      assistant_answer: false,
      raw_content_included: false,
    };
    delete payload.goal_satisfaction_evaluation;
    payload.current_turn_artifact_ledger = theoryProviderGatewayArtifacts;
    payload.ask_turn_solver_trace = {
      schema: "helix.ask_turn_solver_trace.v1",
      route_evidence_authority: payload.route_evidence_authority,
    };
    delete payload.route_evidence_authority;
    delete payload.route_product_contract;
    payload.solver_continuation_observation = {
      schema: "helix.solver_continuation_observation.v1",
      required_next_step: "model_synthesis",
    };
    payload.selected_final_answer =
      "I could not complete this turn because a tool observation required a follow-up model answer step, but no later terminal answer artifact was available.";
    payload.terminal_artifact_kind = "typed_failure";
    payload.final_answer_source = "typed_failure";

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId: "turn-theory-reflection",
      payload,
      artifactLedger: theoryProviderGatewayArtifacts,
    } as never);

    expect(result.selected_terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(result.visible_text).toContain("Theory context reflection answer:");
    expect(result.visible_text).toContain("conceptual graph context for evolution");
    expect(result.visible_text).not.toContain("active_image_lens_source_missing");
    expect(result.visible_text).not.toContain("tool observation required a follow-up model answer step");
    expect(payload.ask_turn_procedure_trace).toMatchObject({
      schema: "helix.ask_turn_procedure_trace.v1",
      evidence_reentry_status: "reentered",
      allowed_terminal_products: expect.arrayContaining(["theory_context_reflection_answer"]),
      selected_terminal_product: expect.objectContaining({
        kind: "theory_context_reflection_answer",
        allowed_by_route: true,
      }),
      failure_rail: null,
    });
  });
});
