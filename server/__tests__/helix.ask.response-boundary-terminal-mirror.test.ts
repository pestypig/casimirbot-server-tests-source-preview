import { describe, expect, it } from "vitest";

import { __testHelixAskOutputContract } from "../routes/agi.plan";
import { HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION } from "../services/helix-ask/terminal-rail-failure-reconciliation";

describe("Helix Ask response-boundary terminal mirrors", () => {
  it("projects workstation terminal authority over stale model-synthesized debug mirrors", () => {
    const answerText = "Calculator verification plan completed.\nExpression: 2+2\nResult: 4";
    const payload = {
      turn_id: "ask:test-workstation-terminal-mirror",
      ok: true,
      response_type: "final_answer",
      final_status: "final_answer",
      status: "final_answer",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      selected_final_answer: answerText,
      answer: answerText,
      text: answerText,
      canonical_goal_frame: {
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        terminal_kind: "answer",
        terminal_artifact_kind: "workstation_tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
        terminal_text_preview: answerText,
        server_authoritative: true,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "workstation_tool_evaluation",
        concise_text: answerText,
      },
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "workstation_tool_evaluation",
        source: "workstation_tool_evaluation",
        visible_text: answerText,
      },
      resolved_turn_summary: {
        final_status: "final_answer",
        resolved_route_label: "calculator_solve / workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
      },
      ask_turn_solver_trace: {
        schema: "helix.ask_turn_solver_trace.v1",
        final_arbitration: {
          terminal_artifact_kind: "model_synthesized_answer",
          final_answer_source: "final_answer_draft",
        },
      },
      solver_controller_decision: {
        schema: "helix.solver_controller_decision.v1",
        decision: "allow_terminal",
        canonical_goal_kind: "temporal_followup",
        required_terminal_kind: "model_synthesized_answer",
        selected_terminal_artifact_kind: "model_synthesized_answer",
      },
      solver_controller_summary: {
        decision: "allow_terminal",
        required_terminal_kind: "model_synthesized_answer",
        selected_terminal_artifact_kind: "model_synthesized_answer",
      },
      terminal_projection_guard: {
        schema: "helix.terminal_projection_guard.v1",
        terminal_authority_kind: "workstation_tool_evaluation",
        visible_terminal_kind: "model_synthesized_answer",
        action: "project_authority_artifact",
        error_code: null,
      },
      debug: {},
    };

    const envelope = __testHelixAskOutputContract.buildHelixDebugExportEnvelope({
      payload,
      prompt: "Call scientific-calculator.solve_expression with 2+2.",
      sessionId: "test-session",
    }) as Record<string, any>;

    expect(envelope.final_answer_source).toBe("workstation_tool_evaluation");
    expect(envelope.resolved_turn_summary).toMatchObject({
      resolved_route_label: "calculator_solve / workstation_tool_evaluation",
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
    });
    expect(envelope.ask_turn_solver_trace.final_arbitration).toMatchObject({
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
    });
    expect(envelope.solver_controller_decision).toMatchObject({
      canonical_goal_kind: "calculator_solve",
      required_terminal_kind: "workstation_tool_evaluation",
      selected_terminal_artifact_kind: "workstation_tool_evaluation",
    });
    expect(envelope.terminal_projection_guard).toMatchObject({
      terminal_authority_kind: "workstation_tool_evaluation",
      visible_terminal_kind: "workstation_tool_evaluation",
      error_code: null,
    });
  });

  it("mirrors compound subgoal rails at the debug export boundary", () => {
    const turnId = "ask:test-compound-subgoal-debug-mirror";
    const compoundLedger = [
      {
        subgoal_id: `${turnId}:subgoal:docs`,
        order: 1,
        requested_capability: "docs-viewer.locate_in_doc",
        runtime_capability: "docs-viewer.locate_in_doc",
        selected_capability: "docs-viewer.locate_in_doc",
        executed_capability: "docs-viewer.locate_in_doc",
        args: { query: "rule of thumb" },
        args_source: "runtime_tool_call",
        planned_args: { query: "rule of thumb" },
        selected_args: { query: "rule of thumb" },
        required_observation_kinds: expect.arrayContaining(["doc_location_matches"]),
        required_terminal_kind: "doc_location_matches",
        allowed_substitutions: [],
        forbidden_nearby_capabilities: ["docs-viewer.summarize_doc", "model.direct_answer"],
        input_bindings: [],
        observation_kind: "doc_location_matches",
        observation_ref: `${turnId}:doc_location_matches`,
        observation_provenance: "compound_subgoal_id",
        support_refs: [`${turnId}:doc_location_matches`],
        bound_input_refs: [],
        unresolved_input_bindings: [],
        satisfaction: "satisfied",
        contribution_role: "evidence",
        terminal_contribution_kind: "doc_location_matches",
        rail_status: "complete",
        first_broken_rail: null,
        rail_failure_code: null,
        repair_target: null,
      },
      {
        subgoal_id: `${turnId}:subgoal:calculator`,
        order: 2,
        requested_capability: "scientific-calculator.solve_expression",
        runtime_capability: "scientific-calculator.solve_expression",
        selected_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: { latex: "6*7", expression: "6*7" },
        args_source: "runtime_tool_call",
        planned_args: { latex: "6*7", expression: "6*7" },
        selected_args: { latex: "6*7", expression: "6*7" },
        required_observation_kinds: expect.arrayContaining(["calculator_receipt"]),
        required_terminal_kind: "workstation_tool_evaluation",
        allowed_substitutions: [],
        forbidden_nearby_capabilities: ["repo-code.search_concept", "model.direct_answer"],
        input_bindings: [
          {
            from_subgoal_id: `${turnId}:subgoal:docs`,
            from_capability: "docs-viewer.locate_in_doc",
            observation_ref: `${turnId}:doc_location_matches`,
            to_arg: "support_refs",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: `${turnId}:calculator_receipt`,
        observation_provenance: "capability_key",
        support_refs: [`${turnId}:doc_location_matches`, `${turnId}:calculator_receipt`],
        bound_input_refs: [
          {
            from_subgoal_id: `${turnId}:subgoal:docs`,
            from_capability: "docs-viewer.locate_in_doc",
            observation_ref: `${turnId}:doc_location_matches`,
            to_arg: "support_refs",
          },
        ],
        unresolved_input_bindings: [],
        satisfaction: "satisfied",
        contribution_role: "terminal_component",
        terminal_contribution_kind: "workstation_tool_evaluation",
        rail_status: "complete",
        first_broken_rail: null,
        rail_failure_code: null,
        repair_target: null,
      },
    ];
    const payload = {
      turn_id: turnId,
      terminal_artifact_kind: "doc_evidence_synthesis_answer",
      final_answer_source: "final_answer_draft",
      selected_final_answer: "Located the doc anchor and calculated 42.",
      answer: "Located the doc anchor and calculated 42.",
      text: "Located the doc anchor and calculated 42.",
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          required_capabilities: [
            "docs-viewer.locate_in_doc",
            "scientific-calculator.solve_expression",
          ],
        },
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          requires_all_subgoals: true,
          subgoals: [
            {
              subgoal_id: `${turnId}:subgoal:docs`,
              requested_capability: "docs-viewer.locate_in_doc",
              runtime_capability: "docs-viewer.locate_in_doc",
              required_observation_kinds: ["doc_location_matches"],
            },
            {
              subgoal_id: `${turnId}:subgoal:calculator`,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              required_observation_kinds: ["calculator_receipt"],
            },
          ],
        },
      },
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        applies: true,
        complete: true,
        compound_subgoal_ledger: compoundLedger,
      },
      current_turn_artifact_ledger: [],
      debug: {},
    };

    const envelope = __testHelixAskOutputContract.buildHelixDebugExportEnvelope({
      payload,
      prompt: "Call docs-viewer.locate_in_doc then call scientific-calculator.solve_expression.",
      sessionId: "test-session",
    }) as Record<string, any>;

    expect(envelope.compound_subgoal_ledger).toEqual(compoundLedger);
    expect(envelope.compound_subgoal_rail_statuses).toEqual([
      expect.objectContaining({
        subgoal_id: `${turnId}:subgoal:docs`,
        order: 1,
        requested_capability: "docs-viewer.locate_in_doc",
        runtime_capability: "docs-viewer.locate_in_doc",
        selected_capability: "docs-viewer.locate_in_doc",
        executed_capability: "docs-viewer.locate_in_doc",
        args: { query: "rule of thumb" },
        args_source: "runtime_tool_call",
        planned_args: { query: "rule of thumb" },
        selected_args: { query: "rule of thumb" },
        required_observation_kinds: expect.arrayContaining(["doc_location_matches"]),
        required_terminal_kind: "doc_location_matches",
        allowed_substitutions: [],
        forbidden_nearby_capabilities: ["docs-viewer.summarize_doc", "model.direct_answer"],
        input_bindings: [],
        observation_kind: "doc_location_matches",
        observation_ref: `${turnId}:doc_location_matches`,
        observation_provenance: "compound_subgoal_id",
        support_refs: [`${turnId}:doc_location_matches`],
        bound_input_refs: [],
        unresolved_input_bindings: [],
        satisfaction: "satisfied",
        contribution_role: "evidence",
        terminal_contribution_kind: "doc_location_matches",
        rail_status: "complete",
        first_broken_rail: null,
        rail_failure_code: null,
        repair_target: null,
      }),
      expect.objectContaining({
        subgoal_id: `${turnId}:subgoal:calculator`,
        order: 2,
        requested_capability: "scientific-calculator.solve_expression",
        runtime_capability: "scientific-calculator.solve_expression",
        selected_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: { latex: "6*7", expression: "6*7" },
        args_source: "runtime_tool_call",
        planned_args: { latex: "6*7", expression: "6*7" },
        selected_args: { latex: "6*7", expression: "6*7" },
        required_observation_kinds: expect.arrayContaining(["calculator_receipt"]),
        required_terminal_kind: "workstation_tool_evaluation",
        allowed_substitutions: [],
        forbidden_nearby_capabilities: ["repo-code.search_concept", "model.direct_answer"],
        input_bindings: [
          {
            from_subgoal_id: `${turnId}:subgoal:docs`,
            from_capability: "docs-viewer.locate_in_doc",
            observation_ref: `${turnId}:doc_location_matches`,
            to_arg: "support_refs",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: `${turnId}:calculator_receipt`,
        observation_provenance: "capability_key",
        support_refs: [`${turnId}:doc_location_matches`, `${turnId}:calculator_receipt`],
        bound_input_refs: [
          {
            from_subgoal_id: `${turnId}:subgoal:docs`,
            from_capability: "docs-viewer.locate_in_doc",
            observation_ref: `${turnId}:doc_location_matches`,
            to_arg: "support_refs",
          },
        ],
        unresolved_input_bindings: [],
        satisfaction: "satisfied",
        contribution_role: "terminal_component",
        terminal_contribution_kind: "workstation_tool_evaluation",
        rail_status: "complete",
        first_broken_rail: null,
        rail_failure_code: null,
        repair_target: null,
      }),
    ]);
    expect(envelope.debug.compound_subgoal_ledger).toEqual(envelope.compound_subgoal_ledger);
    expect(envelope.debug.compound_subgoal_rail_statuses).toEqual(envelope.compound_subgoal_rail_statuses);
    expect(envelope.artifact_query_index.compound_subgoal_rail_statuses).toEqual(
      envelope.compound_subgoal_rail_statuses,
    );
  });

  it("mirrors compound missing-subgoal summaries into the artifact query index", () => {
    const turnId = "ask:test-compound-missing-summary";
    const missingSubgoalId = `${turnId}:subgoal:calculator`;
    const payload = {
      turn_id: turnId,
      ok: false,
      response_type: "typed_failure",
      final_status: "typed_failure",
      status: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "compound_subgoal_observation_missing",
      final_answer_source: "typed_failure",
      selected_final_answer: "Missing calculator observation.",
      answer: "Missing calculator observation.",
      text: "Missing calculator observation.",
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        applies: true,
        complete: false,
        missing_compound_subgoal_ids: [missingSubgoalId],
        missing_required_capabilities: ["scientific-calculator.solve_expression"],
        next_missing_subgoal_id: missingSubgoalId,
        compound_subgoal_ledger: [
          {
            subgoal_id: `${turnId}:subgoal:docs`,
            order: 1,
            requested_capability: "docs-viewer.locate_in_doc",
            runtime_capability: "docs-viewer.locate_in_doc",
            selected_capability: "docs-viewer.locate_in_doc",
            executed_capability: "docs-viewer.locate_in_doc",
            args: { query: "rule of thumb" },
            args_source: "runtime_tool_call",
            planned_args: { query: "rule of thumb" },
            selected_args: { query: "rule of thumb" },
            required_args: ["query"],
            optional_args: ["doc_path"],
            required_observation_kinds: ["doc_location_matches"],
            required_terminal_kind: "doc_location_result",
            observation_kind: "doc_location_matches",
            observation_ref: `${turnId}:doc_location_matches`,
            support_refs: [`${turnId}:doc_location_matches`],
            satisfaction: "satisfied",
            rail_status: "complete",
            first_broken_rail: null,
            rail_failure_code: null,
            repair_target: null,
          },
          {
            subgoal_id: missingSubgoalId,
            order: 2,
            requested_capability: "scientific-calculator.solve_expression",
            runtime_capability: "scientific-calculator.solve_expression",
            selected_capability: "scientific-calculator.solve_expression",
            executed_capability: null,
            args: { latex: "explain why receipts matter", expression: "explain why receipts matter" },
            args_source: "planned_args_validation",
            planned_args: { latex: "explain why receipts matter", expression: "explain why receipts matter" },
            selected_args: { latex: "explain why receipts matter", expression: "explain why receipts matter" },
            required_args: ["latex"],
            optional_args: ["expression", "support_refs"],
            required_observation_kinds: ["calculator_receipt"],
            required_terminal_kind: "workstation_tool_evaluation",
            observation_kind: null,
            observation_ref: null,
            support_refs: [],
            satisfaction: "failed",
            rail_status: "fail_closed",
            first_broken_rail: "observation_artifact",
            rail_failure_code: "subgoal_observation_missing",
            repair_target: "observation_materializer",
          },
        ],
      },
      debug: {},
    };

    const envelope = __testHelixAskOutputContract.buildHelixDebugExportEnvelope({
      payload,
      prompt: "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression.",
      sessionId: "test-session",
    }) as Record<string, any>;

    expect(envelope.artifact_query_index.compound_subgoal_missing_summary).toEqual({
      missing_compound_subgoal_ids: [missingSubgoalId],
      missing_required_capabilities: ["scientific-calculator.solve_expression"],
      next_missing_subgoal_id: missingSubgoalId,
      complete: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(envelope.compound_subgoal_missing_summary).toEqual(
      envelope.artifact_query_index.compound_subgoal_missing_summary,
    );
    expect(envelope.debug.compound_subgoal_missing_summary).toEqual(
      envelope.artifact_query_index.compound_subgoal_missing_summary,
    );
    expect(envelope.compound_capability_synthesis_readiness).toEqual(
      expect.objectContaining({
        applies: true,
        complete: false,
        has_failed_subgoal: true,
        missing_compound_subgoal_ids: [missingSubgoalId],
        missing_required_capabilities: ["scientific-calculator.solve_expression"],
        incomplete_compound_subgoal_ids: [missingSubgoalId],
      }),
    );
    expect(envelope.debug.compound_capability_synthesis_readiness).toEqual(
      envelope.compound_capability_synthesis_readiness,
    );
    expect(envelope.artifact_query_index.compound_subgoal_rail_statuses[1]).toEqual(
      expect.objectContaining({
        subgoal_id: missingSubgoalId,
        requested_capability: "scientific-calculator.solve_expression",
        runtime_capability: "scientific-calculator.solve_expression",
        selected_capability: "scientific-calculator.solve_expression",
        executed_capability: null,
        args: { latex: "explain why receipts matter", expression: "explain why receipts matter" },
        args_source: "planned_args_validation",
        planned_args: { latex: "explain why receipts matter", expression: "explain why receipts matter" },
        selected_args: { latex: "explain why receipts matter", expression: "explain why receipts matter" },
        required_args: ["latex"],
        optional_args: expect.arrayContaining(["expression", "support_refs"]),
        required_observation_kinds: expect.arrayContaining(["calculator_receipt"]),
        required_terminal_kind: "workstation_tool_evaluation",
        observation_kind: null,
        observation_ref: null,
        support_refs: [],
        satisfaction: "failed",
        rail_status: "fail_closed",
        first_broken_rail: "observation_artifact",
        rail_failure_code: "subgoal_observation_missing",
        repair_target: "observation_materializer",
      }),
    );
    expect(envelope.debug.compound_subgoal_rail_statuses).toEqual(
      envelope.artifact_query_index.compound_subgoal_rail_statuses,
    );
  });

  it("normalizes stale top-level final-draft mirrors from typed-failure authority", () => {
    const failureText = "I could not produce a terminal answer for this turn.";
    const payload = {
      ok: true,
      response_type: "final_answer",
      final_status: "final_answer",
      status: "final_answer",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      terminal_error_code: "terminal_consistency_violation",
      selected_final_answer: "stale draft",
      answer: "stale draft",
      text: "stale draft",
      compound_prompt_coverage_gate: {
        schema: "helix.compound_prompt_coverage_gate.v1",
        applies: true,
        passed: false,
        decision: "FAIL_CLOSED",
      },
      terminal_answer_authority: {
        schema: "helix.terminal_authority.v1",
        terminal_kind: "failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        terminal_text_preview: failureText,
        server_authoritative: true,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "typed_failure",
        concise_text: failureText,
      },
      resolved_turn_summary: {
        final_status: "final_failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
      },
      debug: {
        final_answer_source: "final_answer_draft",
      },
    };

    const normalized = __testHelixAskOutputContract.prepareHelixAskLiveResponsePayload(payload, { mode: "deep" }) as Record<string, unknown>;

    expect(normalized).toMatchObject({
      ok: false,
      response_type: "final_failure",
      final_status: "final_failure",
      status: "final_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "compound_prompt_coverage_incomplete",
      selected_final_answer: failureText,
      answer: failureText,
      text: failureText,
    });
    expect(normalized.debug).toMatchObject({
      ok: false,
      response_type: "final_failure",
      final_status: "final_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "compound_prompt_coverage_incomplete",
      selected_final_answer: failureText,
    });
  });

  it("normalizes debug-export cache envelopes from typed-failure authority", () => {
    const failureText = "Compound prompt coverage failed before terminal success.";
    const payload = {
      turn_id: "ask:test-debug-export-terminal-mirror",
      ok: true,
      response_type: "final_answer",
      final_status: "final_answer",
      status: "final_answer",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      terminal_error_code: "terminal_consistency_violation",
      selected_final_answer: "stale draft",
      answer: "stale draft",
      text: "stale draft",
      current_turn_artifact_ledger: [],
      compound_prompt_coverage_gate: {
        schema: "helix.compound_prompt_coverage_gate.v1",
        applies: true,
        passed: false,
        decision: "FAIL_CLOSED",
      },
      terminal_answer_authority: {
        schema: "helix.terminal_authority.v1",
        terminal_kind: "failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        terminal_text_preview: failureText,
        server_authoritative: true,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "typed_failure",
        concise_text: failureText,
      },
      resolved_turn_summary: {
        final_status: "final_failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
      },
      debug: {
        final_answer_source: "final_answer_draft",
      },
    };

    const envelope = __testHelixAskOutputContract.buildHelixDebugExportEnvelope({
      payload,
      prompt: "Find scholarly sources, locate theory badges, then synthesize.",
      sessionId: "test-session",
    });

    expect(envelope).toMatchObject({
      selected_final_answer: failureText,
      final_answer_source: "typed_failure",
      terminal_error_code: "compound_prompt_coverage_incomplete",
      terminal_artifact_kind: "typed_failure",
      response_type: "final_failure",
      final_status: "final_failure",
      status: "final_failure",
      ok: false,
    });
    expect(envelope?.resolved_turn_summary).toMatchObject({
      final_status: "final_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "compound_prompt_coverage_incomplete",
      final_answer_source: "typed_failure",
    });
    expect(envelope?.terminal_answer_authority).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
    });
    expect(JSON.stringify(envelope)).not.toContain("terminal_consistency_violation");
  });

  it("normalizes terminal-consistency errors to typed failure when coverage is missing", () => {
    const failureText = "The turn failed before a terminal answer was authoritative.";
    const payload = {
      turn_id: "ask:test-missing-coverage-terminal-mirror",
      ok: true,
      response_type: "final_answer",
      final_status: "final_answer",
      status: "final_answer",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      terminal_error_code: "terminal_consistency_violation",
      selected_final_answer: "stale draft",
      answer: "stale draft",
      text: "stale draft",
      current_turn_artifact_ledger: [],
      terminal_answer_authority: {
        schema: "helix.terminal_authority.v1",
        terminal_kind: "failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        terminal_text_preview: failureText,
        server_authoritative: true,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "typed_failure",
        concise_text: failureText,
      },
      resolved_turn_summary: {
        final_status: "final_failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
      },
      debug: {
        final_answer_source: "final_answer_draft",
      },
    };

    const normalized = __testHelixAskOutputContract.prepareHelixAskLiveResponsePayload(payload, { mode: "deep" }) as Record<string, any>;
    const envelope = __testHelixAskOutputContract.buildHelixDebugExportEnvelope({
      payload,
      prompt: "Use scholarly research then theory locator.",
      sessionId: "test-session",
    });

    expect(normalized).toMatchObject({
      ok: false,
      response_type: "final_failure",
      final_status: "final_failure",
      status: "final_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "terminal_authority_missing",
    });
    expect(normalized.debug).toMatchObject({
      terminal_error_code: "terminal_authority_missing",
    });
    expect(envelope).toMatchObject({
      terminal_error_code: "terminal_authority_missing",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
    });
    expect(envelope?.resolved_turn_summary).toMatchObject({
      terminal_error_code: "terminal_authority_missing",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
    });
    expect(JSON.stringify(envelope)).not.toContain("terminal_consistency_violation");
  });

  it("normalizes superseded compound coverage from authoritative terminal answers", () => {
    const answerText = [
      "Evidence packet includes six source-backed article references for the photosynthetic coherence question.",
      "The second observation maps the topic near photosynthetic light-harvesting and coherence-window context.",
      "The final synthesis keeps the boundary diagnostic and cites the collected source records.",
    ].join("\n");
    const staleGate = {
      schema: "helix.compound_prompt_coverage_gate.v1",
      applies: true,
      passed: true,
      decision: "PASS",
      reason: "all required compound prompt items were answered, visibly blocked, or failed closed",
      required_count: 3,
      answered_count: 0,
      blocked_count: 0,
      failed_closed_count: 3,
      unresolved_requirement_ids: [],
      non_visible_blocked_requirement_ids: [],
      resolutions: ["R1", "R2", "R3"].map((id) => ({
        requirement_id: id,
        status: "failed_closed",
        reason: "terminal failed closed before a partial success answer could be authoritative",
        evidence_refs: [],
        terminal_visible: true,
        assistant_answer: false,
        raw_content_included: false,
      })),
      assistant_answer: false,
      raw_content_included: false,
    };
    const payload = {
      turn_id: "ask:test-superseded-compound-coverage",
      ok: true,
      response_type: "final_answer",
      final_status: "final_answer",
      status: "final_answer",
      terminal_artifact_kind: "scholarly_research_answer",
      final_answer_source: "final_answer_draft",
      selected_final_answer: answerText,
      answer: answerText,
      text: answerText,
      compound_prompt_coverage_gate: staleGate,
      current_turn_artifact_ledger: [
        {
          artifact_id: "ask:test-superseded-compound-coverage:compound_prompt_coverage_gate",
          kind: "compound_prompt_coverage_gate",
          payload: staleGate,
        },
      ],
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        terminal_kind: "answer",
        terminal_artifact_kind: "scholarly_research_answer",
        final_answer_source: "final_answer_draft",
        terminal_text_preview: answerText,
        server_authoritative: true,
      },
      solver_controller_decision: {
        schema: "helix.solver_controller_decision.v1",
        decision: "allow_terminal",
        compound_prompt_coverage_gate_superseded_by_answer_artifact: true,
        compound_prompt_coverage_superseded_ref: "ask:test-superseded-compound-coverage:scholarly_research_answer",
      },
      ask_turn_solver_trace: {
        schema: "helix.ask_turn_solver_trace.v1",
        compound_prompt_contract: {
          schema: "helix.compound_prompt_contract.v1",
          requirements: [
            { id: "R1", text: "Use scholarly research to find papers about quantum coherence in photosynthesis.", required: true },
            { id: "R2", text: "Use the Theory Badge Graph locator to place the claim.", required: true },
            { id: "R3", text: "Synthesize uncertainty with citations.", required: true },
          ],
        },
      },
      debug: {
        compound_prompt_coverage_gate: staleGate,
      },
    };

    const normalized = __testHelixAskOutputContract.prepareHelixAskLiveResponsePayload(payload, { mode: "deep" }) as Record<string, any>;
    const envelope = __testHelixAskOutputContract.buildHelixDebugExportEnvelope({
      payload,
      prompt: "Use scholarly research, then the Theory Badge Graph locator, then synthesize uncertainty with citations.",
      sessionId: "test-session",
    }) as Record<string, any>;

    expect(normalized.compound_prompt_coverage_gate).toMatchObject({
      passed: true,
      decision: "PASS",
      answered_count: 3,
      failed_closed_count: 0,
      unresolved_requirement_ids: [],
    });
    expect(normalized.compound_prompt_coverage_gate.resolutions.map((entry: any) => entry.status)).toEqual([
      "answered",
      "answered",
      "answered",
    ]);
    expect(normalized.debug.compound_prompt_coverage_gate).toMatchObject({
      answered_count: 3,
      failed_closed_count: 0,
    });
    expect(normalized.current_turn_artifact_ledger[0].payload).toMatchObject({
      answered_count: 3,
      failed_closed_count: 0,
    });
    expect(envelope.compound_prompt_coverage_gate).toMatchObject({
      answered_count: 3,
      failed_closed_count: 0,
      reason: "terminal authority superseded an earlier fail-closed coverage gate after the compound solver path allowed the answer",
    });
    expect(envelope.compound_prompt_coverage_gate.resolutions.map((entry: any) => entry.status)).not.toContain("failed_closed");
  });

  it("exports terminal rail reconciliation runtime marker on complete ask-turn envelopes", () => {
    const answerText = "Helix Ask can use the runtime capability catalog.";
    const payload = {
      turn_id: "ask:test-terminal-rail-reconciliation-runtime-marker",
      ok: true,
      response_type: "final_answer",
      final_status: "final_answer",
      status: "final_answer",
      terminal_artifact_kind: "capability_help_summary",
      final_answer_source: "capability_help_summary",
      selected_final_answer: answerText,
      answer: answerText,
      text: answerText,
      canonical_goal_frame: {
        goal_kind: "capability_catalog_help",
        required_terminal_kind: "capability_help_summary",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "ask:test-terminal-rail-reconciliation-runtime-marker:capability_registry:1",
          kind: "capability_registry",
          source_scope: "current_turn",
          payload: {
            schema: "helix.capability_catalog_observation.v1",
            selected_capability: "helix_ask.inspect_capability_catalog",
          },
        },
        {
          artifact_id: "ask:test-terminal-rail-reconciliation-runtime-marker:capability_help_summary:1",
          kind: "capability_help_summary",
          source_scope: "current_turn",
          payload: {
            schema: "helix.capability_help_summary.v1",
            text: answerText,
          },
        },
      ],
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        terminal_kind: "answer",
        terminal_artifact_kind: "capability_help_summary",
        final_answer_source: "capability_help_summary",
        terminal_text_preview: answerText,
        server_authoritative: true,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "capability_help_summary",
        concise_text: answerText,
      },
      resolved_turn_summary: {
        final_status: "final_answer",
        resolved_route_label: "capability_catalog / capability_help_summary",
        terminal_artifact_kind: "capability_help_summary",
        final_answer_source: "capability_help_summary",
      },
      codex_parity_agent_spine_rail_table: {
        rail_status: "complete",
        first_broken_rail: null,
        rail_failure_code: null,
      },
      debug: {},
    };

    const envelope = __testHelixAskOutputContract.buildHelixDebugExportEnvelope({
      payload,
      prompt: "What tools are available for the helix ask to use?",
      sessionId: "test-session",
    }) as Record<string, any>;

    expect((payload as Record<string, any>).tool_rail_terminal_failure_reconciliation_runtime).toMatchObject({
      schema: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
      version: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
      available: true,
    });
    expect(envelope.tool_rail_terminal_failure_reconciliation_runtime).toMatchObject({
      schema: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
      version: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
      available: true,
    });
    expect(envelope.debug.tool_rail_terminal_failure_reconciliation_runtime).toMatchObject({
      schema: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
      version: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
      available: true,
    });
  });

  it("exports rail-specific observation failures instead of generic projection mismatch", () => {
    const staleProjectionFailure =
      "I could not produce a terminal answer because terminal authority and visible projection selected different artifacts.";
    const payload = {
      turn_id: "ask:test-rail-specific-observation-failure",
      ok: false,
      response_type: "final_failure",
      final_status: "final_failure",
      status: "final_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "terminal_projection_mismatch",
      terminal_failure_text: staleProjectionFailure,
      selected_final_answer: staleProjectionFailure,
      answer: staleProjectionFailure,
      text: staleProjectionFailure,
      current_turn_artifact_ledger: [],
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        terminal_kind: "failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        terminal_error_code: "terminal_projection_mismatch",
        terminal_text_preview: staleProjectionFailure,
        server_authoritative: true,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "terminal_projection_mismatch",
        concise_text: staleProjectionFailure,
      },
      codex_parity_agent_spine_rail_table: {
        schema: "helix.codex_parity_agent_spine_rail_table.v1",
        turn_id: "ask:test-rail-specific-observation-failure",
        route_family: "docs_viewer",
        requested_capability: "docs-viewer.open",
        selected_capability: "docs-viewer.open",
        executed_capability: "execute_workstation_action",
        observation_artifact_kind: "workspace_action_receipt",
        required_observation_kinds_for_requested_capability: ["doc_open_receipt"],
        rail_status: "fail_closed",
        first_broken_rail: "observation_artifact",
        rail_failure_code: "observation_missing",
        repair_target: "observation_materializer",
      },
      debug: {},
    };

    const envelope = __testHelixAskOutputContract.buildHelixDebugExportEnvelope({
      payload,
      prompt: "Open the docs viewer.",
      sessionId: "test-session",
    }) as Record<string, any>;

    expect(envelope.terminal_error_code).toBe("observation_missing");
    expect(envelope.selected_final_answer).toContain("requested capability did not produce the required observation");
    expect(envelope.selected_final_answer).toContain("docs-viewer.open");
    expect(envelope.selected_final_answer).toContain("doc_open_receipt");
    expect(envelope.selected_final_answer).not.toContain("visible projection selected different artifacts");
    expect(envelope.tool_rail_terminal_failure_reconciliation).toMatchObject({
      applied: true,
      replaced_terminal_error_code: "terminal_projection_mismatch",
      terminal_error_code: "observation_missing",
      rail_failure_code: "observation_missing",
      first_broken_rail: "observation_artifact",
    });
    expect(envelope.debug.tool_rail_terminal_failure_reconciliation).toMatchObject({
      applied: true,
      terminal_error_code: "observation_missing",
    });
    expect(envelope.resolved_turn_summary).toMatchObject({
      final_status: "final_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "observation_missing",
      final_answer_source: "typed_failure",
    });
  });
});
