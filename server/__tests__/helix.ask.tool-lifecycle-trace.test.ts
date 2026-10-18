import { describe, expect, it } from "vitest";

import {
  buildToolFollowupDecision,
  buildToolLifecycleTrace,
  refreshToolLifecycleRecords,
} from "../services/helix-ask/tool-lifecycle-trace";
import { buildArtifactQueryIndex } from "../services/helix-ask/artifact-query-index";
import { resolveToolFamilyContract } from "../services/helix-ask/tool-family-contract";
import { WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS } from "../services/helix-ask/workstation-context-feed-query-tool-contracts";

const genericContextFeedQuerySpecs = WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS.filter((spec) =>
  !["source_health", "trace_memory", "packet_traces"].includes(spec.feedKind),
);

describe("Helix Ask tool lifecycle trace", () => {
  it("recognizes docs-viewer summarize_doc observation contract", () => {
    const contract = resolveToolFamilyContract({
      toolName: "docs-viewer.summarize_doc",
      toolFamily: "docs_viewer",
    });

    expect(contract).toMatchObject({
      toolFamily: "docs_viewer",
      toolName: "docs-viewer.summarize_doc",
      requiredObservationKinds: expect.arrayContaining(["doc_summary", "observation_review"]),
      requiredReentry: true,
    });
    expect(contract?.allowedTerminalKinds).toEqual(expect.arrayContaining(["doc_summary"]));
  });

  it("preserves an exact admitted capability ahead of coarse family projections", () => {
    const capability = "theory-experiment-procedure.prepare";
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:exact-admitted-capability",
        capability_family: "theory_locator",
        requested_capability: capability,
        admission_status: "admitted",
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        turn_id: "ask:test:exact-admitted-capability",
        requested_capability: capability,
        selected_capability: capability,
        admitted_capability: capability,
        admitted_tool_families: ["theory_locator"],
      },
      operational_capability_trace: {
        policy_admitted_capability: "theory_locator",
      },
    };

    expect(
      buildToolLifecycleTrace({
        turnId: "ask:test:exact-admitted-capability",
        payload,
      }),
    ).toMatchObject({
      requested_capability: capability,
      admitted_capability: capability,
      tool_family: "theory_locator",
    });
  });

  it("does not mark Moral Graph family reentered when top-level reentry failed", () => {
    const turnId = "ask:test:moral-graph-family-reentry-failed";
    const moralRef = `${turnId}:moral_graph_reflection:1`;
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: turnId,
        capability_family: "moral_graph_reflection",
        requested_capability: "moral-graph.reflect_context",
        selected_capability: "moral-graph.reflect_context",
        admission_status: "admitted",
      },
      tool_call_admission_decision: {
        requested_capability: "moral-graph.reflect_context",
        requested_capability_family: "moral_graph_reflection",
        selected_capability: "moral-graph.reflect_context",
        admitted_capability: "moral-graph.reflect_context",
      },
      runtime_tool_call: {
        capability_key: "moral-graph.reflect_context",
        status: "completed",
      },
      tool_surface_packet: {
        schema: "helix.tool_surface_packet.v1",
        capabilities: ["moral-graph.reflect_context", "workstation_tool_gateway"],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: moralRef,
          kind: "moral_graph_reflection",
          payload: {
            schema: "helix.moral_graph_reflection_observation.v1",
            artifact_id: moralRef,
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
      ],
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        requested_capability: "moral-graph.reflect_context",
        admitted_capability: "moral-graph.reflect_context",
        executed_capability: "moral-graph.reflect_context",
        observation_refs: [moralRef],
        lifecycle_stage: "observed",
        status: "succeeded",
        evidence_reentered: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_followup_decision: {
        schema: "helix.tool_followup_decision.v1",
        evidence_reentered: false,
        next_action: "continue_reasoning",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "typed_failure",
        concise_text: "I could not complete this turn.",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        server_authoritative: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const index = buildArtifactQueryIndex({ turnId, payload });
    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: "moral-graph.reflect_context",
      observation_ref: moralRef,
      reentry_proven: false,
      rail_failure_code: "reentry_step_not_executed",
    });
    expect(index.tool_turn_chain_family_matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route_family: "moral_graph_reflection",
          observed: true,
          artifact_produced: true,
          artifact_reentered: false,
          rail_failure_code: "reentry_step_not_executed",
          rail_status: expect.not.stringMatching(/^complete$/),
        }),
      ]),
    );
  });

  it("maps workstation gateway Moral Graph observations to the Moral Graph family before reentry", () => {
    const turnId = "ask:test:moral-graph-workstation-gateway-reentry-failed";
    const moralRef = `${turnId}:codex_normalized:moral_graph_reflection:1`;
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: turnId,
        capability_family: "workstation_tool_gateway",
        requested_capability: "moral-graph.reflect_context",
        selected_capability: "moral-graph.reflect_context",
        admission_status: "admitted",
      },
      tool_call_admission_decision: {
        requested_capability: "moral-graph.reflect_context",
        requested_capability_family: "moral_graph_reflection",
        selected_capability: "moral-graph.reflect_context",
        admitted_capability: "moral-graph.reflect_context",
      },
      runtime_tool_call: {
        capability_key: "moral-graph.reflect_context",
        status: "completed",
      },
      tool_surface_packet: {
        schema: "helix.tool_surface_packet.v1",
        capabilities: ["moral-graph.reflect_context", "workstation_tool_gateway"],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: moralRef,
          kind: "moral_graph_reflection",
          payload: {
            schema: "helix.moral_graph_reflection_observation.v1",
            artifact_id: moralRef,
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
      ],
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        requested_capability: "moral-graph.reflect_context",
        admitted_capability: "moral-graph.reflect_context",
        executed_capability: "moral-graph.reflect_context",
        observation_refs: [moralRef],
        lifecycle_stage: "observed",
        status: "succeeded",
        evidence_reentered: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_followup_decision: {
        schema: "helix.tool_followup_decision.v1",
        evidence_reentered: false,
        next_action: "continue_reasoning",
        required_next_capability: "model.direct_answer",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "typed_failure",
        concise_text: "I could not complete this turn because a tool observation required a follow-up model answer step.",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        server_authoritative: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const index = buildArtifactQueryIndex({ turnId, payload });
    expect(index.tool_turn_chain_audit).toMatchObject({
      route_family: "moral_graph_reflection",
      requested_capability: "moral-graph.reflect_context",
      observation_ref: moralRef,
      expected_reentry_capability: "model.direct_answer",
      reentry_proven: false,
      rail_failure_code: "reentry_step_not_executed",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      observation_ref: moralRef,
      reentry_status: "not_reentered",
      first_broken_rail: "evidence_reentry",
      repair_target: "reentry_gate",
      codex_parity_class: "observation_not_reentered",
      rail_failure_code: "reentry_step_not_executed",
    });
    expect(index.tool_turn_chain_family_matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route_family: "moral_graph_reflection",
          observed: true,
          artifact_produced: true,
          observation_ref: moralRef,
          artifact_reentered: false,
          rail_failure_code: "reentry_step_not_executed",
        }),
      ]),
    );
  });

  it("keeps pending multi-step tools in poll mode instead of terminalizing", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:pending",
        capability_family: "debug_export",
        requested_action: "chrome_extension.visual_capture",
        admission_status: "admitted",
      },
      runtime_tool_call: {
        tool_call_id: "tool:pending",
        capability_key: "chrome_extension.visual_capture",
        session_id: "session:5050",
        process_id: "5880",
        status: "running",
      },
      pending_server_request: {
        request_id: "request:pending",
        session_id: "session:5050",
      },
      operational_satisfaction_evaluation: {
        schema: "helix.operational_satisfaction_evaluation.v1",
        turn_id: "ask:test:pending",
        next_decision: "continue",
        requested_surface_satisfied: false,
      },
    };

    const trace = buildToolLifecycleTrace({ turnId: "ask:test:pending", payload });
    const followup = buildToolFollowupDecision({ turnId: "ask:test:pending", payload, trace });

    expect(trace.lifecycle_stage).toBe("polling");
    expect(trace.status).toBe("running");
    expect(trace.retry_recommendation).toBe("poll_same_tool");
    expect(trace.terminal_eligible).toBe(false);
    expect(trace.session_ref).toBe("session:5050");
    expect(trace.process_ref).toBe("5880");
    expect(followup.next_action).toBe("poll");
    expect(followup.terminal_blockers).toContain("tool_still_running");
  });

  it("classifies disappeared local servers as external-change failures", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:server-gone",
        capability_family: "debug_export",
        requested_action: "backend_api.debug_export",
        admission_status: "admitted",
      },
      capability_result: {
        schema: "helix.capability_result.v1",
        turn_id: "ask:test:server-gone",
        capability_plan_id: "plan:server-gone",
        status: "failed",
        receipt_refs: [],
        evidence_refs: [],
        selected_for_answer: false,
        reentered_solver: false,
        failure_reason: "server unavailable: no listener on port 5050",
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const trace = buildToolLifecycleTrace({ turnId: "ask:test:server-gone", payload });
    const followup = buildToolFollowupDecision({ turnId: "ask:test:server-gone", payload, trace });

    expect(trace.lifecycle_stage).toBe("failed");
    expect(trace.status).toBe("failed");
    expect(trace.retry_recommendation).toBe("stop_external_change_required");
    expect(followup.next_action).toBe("terminal_failure");
    expect(followup.external_change_required).toBe(true);
  });

  it("blocks diagnostic fallbacks from becoming terminal answers", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:fallback",
        capability_family: "repo_evidence",
        requested_action: "repo-code.search_concept",
        admission_status: "admitted",
      },
      capability_result: {
        schema: "helix.capability_result.v1",
        turn_id: "ask:test:fallback",
        capability_plan_id: "plan:fallback",
        status: "succeeded",
        receipt_refs: ["receipt:fallback"],
        evidence_refs: ["evidence:fallback"],
        selected_for_answer: false,
        reentered_solver: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      operational_satisfaction_evaluation: {
        schema: "helix.operational_satisfaction_evaluation.v1",
        turn_id: "ask:test:fallback",
        required_surface: "chrome_extension_localhost_5050_tab",
        requested_surface_satisfied: false,
        fallback_used: true,
        fallback_equivalent: false,
        remaining_surface_blocker: "required_surface_not_satisfied:chrome_extension_localhost_5050_tab",
        next_decision: "continue",
        evidence_refs: ["evidence:fallback"],
      },
      capability_lifecycle_ledger: {
        schema: "helix.capability_lifecycle_ledger.v1",
        turn_id: "ask:test:fallback",
        ok: true,
        failure_codes: [],
      },
    };

    const trace = buildToolLifecycleTrace({ turnId: "ask:test:fallback", payload });
    const followup = buildToolFollowupDecision({ turnId: "ask:test:fallback", payload, trace });

    expect(trace.lifecycle_stage).toBe("reentered_solver");
    expect(trace.terminal_eligible).toBe(false);
    expect(trace.retry_recommendation).toBe("try_alternate_probe");
    expect(followup.next_action).toBe("alternate_probe");
    expect(followup.terminal_blockers).toContain("required_surface_not_satisfied:chrome_extension_localhost_5050_tab");
  });

  it("allows terminal answer only after calculator evidence re-enters the solver", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:calculator",
        capability_family: "calculator",
        requested_action: "scientific-calculator.solve_expression",
        admission_status: "admitted",
      },
      capability_result: {
        schema: "helix.capability_result.v1",
        turn_id: "ask:test:calculator",
        capability_plan_id: "plan:calculator",
        status: "succeeded",
        receipt_refs: ["calculator_receipt:1"],
        evidence_refs: ["calculator_validation:1"],
        selected_for_answer: true,
        reentered_solver: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      operational_satisfaction_evaluation: {
        schema: "helix.operational_satisfaction_evaluation.v1",
        turn_id: "ask:test:calculator",
        requested_surface_satisfied: true,
        next_decision: "allow_terminal",
        evidence_refs: ["calculator_validation:1"],
      },
      capability_lifecycle_ledger: {
        schema: "helix.capability_lifecycle_ledger.v1",
        turn_id: "ask:test:calculator",
        ok: true,
        failure_codes: [],
      },
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:calculator", payload });

    expect(payload.tool_lifecycle_trace).toMatchObject({
      lifecycle_stage: "reentered_solver",
      status: "completed",
      tool_family: "calculator",
      terminal_eligible: true,
      retry_recommendation: "allow_terminal",
      assistant_answer: false,
    });
    expect(payload.tool_followup_decision).toMatchObject({
      next_action: "terminal_answer",
      evidence_reentered: true,
      assistant_answer: false,
    });
  });

  it("indexes queryable artifacts against the tool-family contract without creating answer authority", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:calculator-index",
        capability_family: "calculator",
        requested_action: "scientific-calculator.solve_expression",
        admission_status: "admitted",
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "scientific-calculator.solve_expression",
        requested_capability_family: "calculator",
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_result: {
        schema: "helix.capability_result.v1",
        turn_id: "ask:test:calculator-index",
        capability_plan_id: "plan:calculator-index",
        status: "succeeded",
        receipt_refs: ["calculator_receipt:1"],
        evidence_refs: ["calculator_validation:1"],
        selected_for_answer: true,
        reentered_solver: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      operational_satisfaction_evaluation: {
        schema: "helix.operational_satisfaction_evaluation.v1",
        turn_id: "ask:test:calculator-index",
        requested_surface_satisfied: true,
        next_decision: "allow_terminal",
        evidence_refs: ["calculator_validation:1"],
      },
      runtime_tool_call: {
        tool_call_id: "tool:calculator-index",
        capability_key: "scientific-calculator.solve_expression",
        status: "completed",
      },
      capability_lifecycle_ledger: {
        schema: "helix.capability_lifecycle_ledger.v1",
        turn_id: "ask:test:calculator-index",
        ok: true,
        failure_codes: [],
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:calculator-index:final_answer_draft",
        support_refs: [
          "calculator_receipt:1",
          "calculator_result_trace:1",
          "calculator_result_validation:1",
        ],
      },
      terminal_artifact_kind: "calculator_stream_result",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer.v1",
        selected_terminal_artifact_kind: "calculator_stream_result",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "calculator_stream_result",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "calculator_receipt:1",
          kind: "calculator_receipt",
          payload: {
            schema: "helix.calculator_receipt.v1",
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "calculator_result_trace:1",
          kind: "calculator_result_trace",
          payload: {
            schema: "helix.calculator_result_trace.v1",
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "calculator_result_validation:1",
          kind: "calculator_result_validation",
          payload: {
            schema: "helix.calculator_result_validation.v1",
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:calculator-index", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:calculator-index", payload });

    expect(index).toMatchObject({
      schema: "helix.artifact_query_index.v1",
      tool_family: "calculator",
      capability: "scientific-calculator.solve_expression",
      artifact_count: 3,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      reentry_status: {
        evidence_reentered: true,
        followup_next_action: "terminal_answer",
        terminal_use_allowed: true,
      },
    });
    expect(index.missing_required_observation_kinds).toEqual([]);
    expect(index.queryable_artifact_keys).toEqual(
      expect.arrayContaining(["calculator_receipt:1", "calculator_result_trace:1", "calculator_result_validation:1"]),
    );
    expect(index.tool_turn_chain_audit).toMatchObject({
      schema: "helix.tool_turn_chain_audit.v1",
      route_family: "calculator",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      observation_artifact_kind: "calculator_receipt",
      required_terminal_kind: "calculator_stream_result",
      expected_reentry_capability: "model.direct_answer",
      reentry_executed: true,
      final_answer_draft_ref: "ask:test:calculator-index:final_answer_draft",
      support_refs_count: 3,
      materialized_terminal_artifact_kind: "calculator_stream_result",
      terminal_authority_kind: "calculator_stream_result",
      visible_terminal_kind: "calculator_stream_result",
      rail_status: "complete",
      rail_failure_code: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      schema: "helix.tool_rail_failure_triage.v1",
      route_family: "calculator",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      did_tool_run: true,
      observation_ref: "calculator_receipt:1",
      reentry_executed: true,
      first_broken_rail: null,
      failure_bucket: null,
      rail_status: "complete",
      rail_failure_code: null,
      repair_target: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      requested_capability: "scientific-calculator.solve_expression",
      selected_capability: "scientific-calculator.solve_expression",
      admitted_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      observation_kind: "calculator_receipt",
      observation_ref: "calculator_receipt:1",
      reentry_status: "reentered",
      required_terminal_kind: "calculator_stream_result",
      selected_terminal_kind: "calculator_stream_result",
      visible_terminal_kind: "calculator_stream_result",
      first_broken_rail: null,
      repair_target: null,
      codex_parity_class: "complete",
      rail_status: "complete",
      rail_failure_code: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(index.codex_parity_agent_spine_rail_table.normalized_codex_parity_classes).toEqual([
      "complete",
      "tool_surface_missing",
      "explicit_capability_demoted",
      "tool_admission_rejected",
      "selected_not_executed",
      "observation_missing",
      "source_identity_mismatch",
      "observation_not_reentered",
      "goal_contract_mismatch",
      "terminal_product_not_allowed",
      "terminal_authority_mismatch",
      "visible_projection_mismatch",
      "debug_mirror_stale",
      "provider_config_missing",
    ]);
    expect(index.tool_turn_chain_family_matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ route_family: "docs_viewer" }),
        expect.objectContaining({ route_family: "repo_code" }),
        expect.objectContaining({ route_family: "live_env" }),
        expect.objectContaining({ route_family: "workspace_directory" }),
        expect.objectContaining({
          route_family: "calculator",
          observed: true,
          did_tool_run: true,
          artifact_produced: true,
          artifact_reentered: true,
          rail_status: "complete",
          rail_failure_code: null,
        }),
        expect.objectContaining({ route_family: "internet_search" }),
        expect.objectContaining({ route_family: "image_lens / visual_capture" }),
      ]),
    );
  });

  it("indexes Workstation Notes list observations without admitting quoted note mutations", () => {
    const payload: Record<string, unknown> = {
      question: "The document says `workstation-notes.append_to_note`; do not append anything, just list notes.",
      current_turn_artifact_ledger: [
        {
          artifact_id: "workstation-notes:list:1",
          kind: "workstation_notes_list_observation",
          payload: {
            schema: "helix.workstation_notes_list_observation.v1",
            capability_key: "workstation-notes.list_notes",
            panel_id: "workstation-notes",
            action_id: "list_notes",
            status: "succeeded",
            note_count: 1,
            notes: [
              {
                id: "note-1",
                title: "Fusion notes",
                source_ref: "workstation-notes:note-1",
                assistant_answer: false,
                terminal_eligible: false,
                raw_content_included: false,
              },
            ],
            omitted_body_fields: ["body", "content", "html", "text", "markdown"],
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
            post_tool_model_step_required: true,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId: "ask:test:notes-list-index", payload });

    expect(index).toMatchObject({
      schema: "helix.artifact_query_index.v1",
      capability: "workstation-notes.list_notes",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(index.capability).not.toBe("workstation-notes.append_to_note");
    expect(index.artifact_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "workstation-notes:list:1",
          kind: "workstation_notes_list_observation",
          schema: null,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
          payload_authority_flags: {
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        }),
      ]),
    );
    expect(index.queryable_artifact_keys).toEqual(
      expect.arrayContaining([
        "workstation-notes:list:1",
        "workstation_notes_list_observation",
        "helix.workstation_notes_list_observation.v1",
      ]),
    );
  });

  it("does not report observation_missing after a calculator workstation terminal chain completes", () => {
    const payload: Record<string, unknown> = {
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "calculator_stream",
        allowed_terminal_artifact_kinds: ["workstation_tool_evaluation", "typed_failure"],
        required_terminal_kinds: ["workstation_tool_evaluation"],
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:calculator-workstation-terminal",
        capability_family: "calculator",
        requested_action: "scientific-calculator.solve_expression",
        admission_status: "admitted",
      },
      runtime_tool_call: {
        tool_call_id: "tool:calculator-workstation-terminal",
        capability_key: "scientific-calculator.solve_expression",
        status: "completed",
      },
      selected_final_answer: "Calculator verification plan completed.\nExpression: ((sqrt(81)+ln(e^3))*7-5^2)/2\nResult: 29.5",
      final_answer_source: "workstation_tool_evaluation",
      terminal_artifact_kind: "workstation_tool_evaluation",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "workstation_tool_evaluation",
        concise_text: "Calculator verification plan completed.\nExpression: ((sqrt(81)+ln(e^3))*7-5^2)/2\nResult: 29.5",
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
        terminal_kind: "answer",
        terminal_text_preview:
          "Calculator verification plan completed.\nExpression: ((sqrt(81)+ln(e^3))*7-5^2)/2\nResult: 29.5",
        server_authoritative: true,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "calculator_receipt:1",
          kind: "calculator_receipt",
          payload: {
            schema: "helix.calculator_receipt.v1",
            expression: "((sqrt(81)+ln(e^3))*7-5^2)/2",
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "workstation_tool_evaluation:1",
          kind: "workstation_tool_evaluation",
          payload: {
            schema: "helix.workstation_tool_evaluation.v1",
            supports_goal: true,
            summary: "Calculator-backed result: ((sqrt(81)+ln(e^3))*7-5^2)/2 = 29.5.",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "final_answer_draft:1",
          kind: "final_answer_draft",
          payload: {
            schema: "helix.final_answer_draft.v1",
            text: "Calculator verification plan completed.\nExpression: ((sqrt(81)+ln(e^3))*7-5^2)/2\nResult: 29.5",
            support_refs: ["calculator_receipt:1", "workstation_tool_evaluation:1"],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:calculator-workstation-terminal", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:calculator-workstation-terminal", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      route_family: "calculator",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      observation_artifact_kind: "calculator_receipt",
      required_terminal_kind: "workstation_tool_evaluation",
      reentry_executed: true,
      materialized_terminal_artifact_kind: "workstation_tool_evaluation",
      terminal_authority_kind: "workstation_tool_evaluation",
      visible_terminal_kind: "workstation_tool_evaluation",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      first_broken_rail: null,
      failure_bucket: null,
      rail_status: "complete",
      rail_failure_code: null,
      repair_target: null,
    });
  });

  it("mirrors concrete calculator capability when workstation planner action executed it", () => {
    const payload: Record<string, unknown> = {
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "calculator_stream",
        allowed_terminal_artifact_kinds: ["workstation_tool_evaluation", "typed_failure"],
        required_terminal_kinds: ["workstation_tool_evaluation"],
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "scientific-calculator.solve_expression",
        admitted_capability: "scientific-calculator.solve_expression",
        selected_capability: "scientific-calculator.solve_expression",
        admitted_tool_families: ["calculator", "workstation_action"],
        required_observation_kinds_for_requested_capability: ["calculator_receipt", "workstation_tool_evaluation"],
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:calculator-workstation-wrapper",
        capability_family: "workstation_action",
        requested_action: "execute_workstation_action",
        selected_capability: "execute_workstation_action",
        admission_status: "admitted",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      operational_capability_trace: {
        schema: "helix.operational_capability_trace.v1",
        model_proposed_capability: "scientific-calculator.solve_expression",
        policy_admitted_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            index: 1,
            chosen_capability: "scientific-calculator.solve_expression",
            executed_action_key: "scientific-calculator.solve_expression",
            produced_artifacts: ["calculator_receipt", "workstation_tool_evaluation"],
          },
        ],
      },
      runtime_tool_call: {
        tool_call_id: "tool:calculator-workstation-wrapper",
        capability_key: "scientific-calculator.solve_expression",
        status: "completed",
      },
      selected_final_answer: "Calculator verification plan completed.\nExpression: 2*(3+4)\nResult: 14",
      final_answer_source: "workstation_tool_evaluation",
      terminal_artifact_kind: "workstation_tool_evaluation",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "workstation_tool_evaluation",
        concise_text: "Calculator verification plan completed.\nExpression: 2*(3+4)\nResult: 14",
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
        terminal_kind: "answer",
        terminal_text_preview: "Calculator verification plan completed.\nExpression: 2*(3+4)\nResult: 14",
        server_authoritative: true,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "calculator_receipt:wrapper",
          kind: "calculator_receipt",
          payload: {
            schema: "helix.calculator_receipt.v1",
            expression: "2*(3+4)",
            result: 14,
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "workstation_tool_evaluation:wrapper",
          kind: "workstation_tool_evaluation",
          payload: {
            schema: "helix.workstation_tool_evaluation.v1",
            supports_goal: true,
            summary: "Calculator-backed result: 2*(3+4) = 14.",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "final_answer_draft:wrapper",
          kind: "final_answer_draft",
          payload: {
            schema: "helix.final_answer_draft.v1",
            text: "Calculator verification plan completed.\nExpression: 2*(3+4)\nResult: 14",
            support_refs: ["calculator_receipt:wrapper", "workstation_tool_evaluation:wrapper"],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:calculator-workstation-wrapper", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:calculator-workstation-wrapper", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      route_family: "calculator",
      requested_capability: "scientific-calculator.solve_expression",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      selected_executed_match: true,
      observation_artifact_kind: "calculator_receipt",
      required_terminal_kind: "workstation_tool_evaluation",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      selected_capability: "scientific-calculator.solve_expression",
      admitted_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      observation_kind: "calculator_receipt",
      required_terminal_kind: "workstation_tool_evaluation",
      selected_terminal_kind: "workstation_tool_evaluation",
      visible_terminal_kind: "workstation_tool_evaluation",
      codex_parity_class: "complete",
      rail_status: "complete",
    });
  });

  it("prefers terminal authority over draft materializer when mirroring materialized terminal kind", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:terminal-authority-mirror",
        capability_family: "calculator",
        requested_action: "scientific-calculator.solve_expression",
        admission_status: "admitted",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      runtime_tool_call: {
        tool_call_id: "tool:terminal-authority-mirror",
        capability_key: "scientific-calculator.solve_expression",
        status: "completed",
      },
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        observation_refs: ["calculator_receipt:1", "calculator_result_trace:1", "calculator_result_validation:1"],
        evidence_refs: ["calculator_result_validation:1", "workstation_tool_evaluation:1"],
        lifecycle_stage: "reentered_solver",
        status: "succeeded",
        evidence_reentered: true,
      },
      canonical_goal_frame: {
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        terminal_artifact_kind: "workstation_tool_evaluation",
      },
      final_answer_draft_selection: {
        schema: "helix.final_answer_draft_selection.v1",
        materialized_terminal_artifact_kind: "model_synthesized_answer",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "workstation_tool_evaluation",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "calculator_receipt:1",
          kind: "calculator_receipt",
          payload: {
            schema: "helix.calculator_receipt.v1",
            receipt_id: "calculator_receipt:1",
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "workstation_tool_evaluation:1",
          kind: "workstation_tool_evaluation",
          payload: {
            schema: "helix.workstation_tool_evaluation.v1",
            evaluation_id: "workstation_tool_evaluation:1",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "calculator_result_trace:1",
          kind: "calculator_result_trace",
          payload: {
            schema: "helix.calculator_result_trace.v1",
            trace_id: "calculator_result_trace:1",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "calculator_result_validation:1",
          kind: "calculator_result_validation",
          payload: {
            schema: "helix.calculator_result_validation.v1",
            validation_id: "calculator_result_validation:1",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId: "ask:test:terminal-authority-mirror", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      materialized_terminal_artifact_kind: "workstation_tool_evaluation",
      terminal_authority_kind: "workstation_tool_evaluation",
      visible_terminal_kind: "workstation_tool_evaluation",
      rail_status: "broken",
      rail_failure_code: "debug_mirror_stale",
      stale_terminal_debug_mirrors: [
        {
          source: "final_answer_draft_selection.materialized_terminal_artifact_kind",
          terminal_kind: "model_synthesized_answer",
        },
      ],
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      selected_terminal_kind: "workstation_tool_evaluation",
      visible_terminal_kind: "workstation_tool_evaluation",
      first_broken_rail: "visible_projection",
      repair_target: "presenter_boundary",
      codex_parity_class: "debug_mirror_stale",
      rail_failure_code: "debug_mirror_stale",
    });
  });

  it("classifies contextual no-tool suppression as a complete model-only rail, not tool drift", () => {
    const payload: Record<string, unknown> = {
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:suppressed-model-only",
        capability_family: "model_only",
        requested_action: "suppressed_contextual_tool_reference",
        selected_capability: "suppressed_contextual_tool_reference",
        admission_status: "rejected",
        rejection_reason: "contextual_tool_reference_suppressed",
        tool_admission_suppressed: true,
        capability_contract_arbitration: {
          schema: "helix.ask_capability_contract_arbitration.v1",
          contract_state: "suppressed_contextual_reference",
          selected_source_target: "model_only",
          selected_plan_family: "model_only",
          canonical_goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      operational_capability_trace: {
        schema: "helix.operational_capability_trace.v1",
        executed_capability: "model.direct_answer",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            executed_action_key: null,
            stop_reason: "terminal_satisfied",
            satisfaction: "satisfied",
          },
        ],
        executed_tool_call_count: 0,
        stop_reason: "terminal_satisfied",
      },
      final_answer_source: "model_direct_answer",
      terminal_artifact_kind: "direct_answer_text",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        final_answer_source: "model_direct_answer",
        terminal_artifact_kind: "direct_answer_text",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "direct_answer_text",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "reasoning_context:1",
          kind: "reasoning_context",
          payload: {
            schema: "helix.reasoning_context.v1",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "direct_answer_text:1",
          kind: "direct_answer_text",
          payload: {
            schema: "helix.direct_answer_text.v1",
            text: "Receipts are observations, not terminal answers.",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "final_answer_draft:1",
          kind: "final_answer_draft",
          payload: {
            schema: "helix.final_answer_draft.v1",
            support_refs: ["reasoning_context:1", "direct_answer_text:1"],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:suppressed-model-only", payload });
    (payload.tool_lifecycle_trace as Record<string, unknown>).executed_capability = "model.direct_answer";
    const index = buildArtifactQueryIndex({ turnId: "ask:test:suppressed-model-only", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      route_family: "model_only",
      selected_capability: "suppressed_contextual_tool_reference",
      executed_capability: null,
      required_terminal_kind: "direct_answer_text",
      materialized_terminal_artifact_kind: "direct_answer_text",
      terminal_authority_kind: "direct_answer_text",
      visible_terminal_kind: "direct_answer_text",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      selected_capability: "suppressed_contextual_tool_reference",
      executed_capability: null,
      did_tool_run: false,
      first_broken_rail: null,
      failure_bucket: null,
      rail_status: "complete",
      rail_failure_code: null,
      repair_target: null,
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      requested_capability: "model_only:suppressed_contextual_tool_reference",
      selected_capability: "suppressed_contextual_tool_reference",
      admitted_capability: null,
      executed_capability: null,
      observation_kind: "reasoning_context",
      reentry_status: "reentered",
      required_terminal_kind: "direct_answer_text",
      selected_terminal_kind: "direct_answer_text",
      visible_terminal_kind: "direct_answer_text",
      first_broken_rail: null,
      repair_target: null,
      codex_parity_class: "complete",
      rail_status: "complete",
      rail_failure_code: null,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("preserves executed docs tool capability when a later model answer performs synthesis", () => {
    const payload: Record<string, unknown> = {
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        turn_id: "ask:test:docs-locate-reentry",
        source_target: "docs_viewer",
        required: true,
        admitted_tool_families: ["docs_viewer"],
        capability_contract_guard_version: "E82",
        requested_capability: "docs-viewer.locate_in_doc",
        requested_capability_family: "docs_viewer",
        requested_capability_source: "explicit_user_command",
        requested_capability_confidence: 0.99,
        required_observation_kinds_for_requested_capability: [
          "doc_location_result",
          "doc_location_matches",
          "doc_evidence_location",
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:docs-locate-reentry",
        capability_family: "docs_viewer",
        requested_action: "docs-viewer.locate_in_doc",
        selected_capability: "docs-viewer.locate_in_doc",
        requested_capability: "docs-viewer.locate_in_doc",
        admission_status: "admitted",
        required_terminal_kind: "doc_evidence_synthesis_answer",
      },
      operational_capability_trace: {
        schema: "helix.operational_capability_trace.v1",
        executed_capability: "model.direct_answer",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            next_step: "next_action",
            chosen_capability: "docs-viewer.locate_in_doc",
            executed_action_key: "docs-viewer.locate_in_doc",
            satisfaction: "satisfied",
            observed_artifact_refs: ["doc_location_matches:1"],
          },
          {
            iteration: 2,
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            executed_action_key: null,
            satisfaction: "satisfied",
            stop_reason: "terminal_satisfied",
          },
        ],
        executed_tool_call_count: 1,
        stop_reason: "terminal_satisfied",
      },
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "doc_evidence_synthesis_answer",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        final_answer_source: "final_answer_draft",
        terminal_artifact_kind: "doc_evidence_synthesis_answer",
      },
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "doc_evidence_synthesis_answer",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "doc_evidence_synthesis_answer",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "doc_location_matches:1",
          kind: "doc_location_matches",
          payload: {
            schema: "helix.doc_location_matches.v1",
            document_path: "docs/helix-ask-codex-loop-discipline.md",
            matches: [{ line: 216, text: "Routes choose procedures." }],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "final_answer_draft:docs-locate",
          kind: "final_answer_draft",
          payload: {
            schema: "helix.final_answer_draft.v1",
            support_refs: ["doc_location_matches:1"],
            artifact_refs: ["doc_location_matches:1"],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:docs-locate-reentry", payload });
    (payload.tool_lifecycle_trace as Record<string, unknown>).executed_capability = "model.direct_answer";
    const index = buildArtifactQueryIndex({ turnId: "ask:test:docs-locate-reentry", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      capability_contract_guard_version: "E82",
      requested_capability: "docs-viewer.locate_in_doc",
      selected_capability: "docs-viewer.locate_in_doc",
      executed_capability: "docs-viewer.locate_in_doc",
      requested_selected_match: true,
      selected_executed_match: true,
      observation_artifact_kind: "doc_location_matches",
      required_terminal_kind: "doc_evidence_synthesis_answer",
      materialized_terminal_artifact_kind: "doc_evidence_synthesis_answer",
      terminal_authority_kind: "doc_evidence_synthesis_answer",
      visible_terminal_kind: "doc_evidence_synthesis_answer",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      requested_capability: "docs-viewer.locate_in_doc",
      selected_capability: "docs-viewer.locate_in_doc",
      executed_capability: "docs-viewer.locate_in_doc",
      did_tool_run: true,
      first_broken_rail: null,
      failure_bucket: null,
      rail_status: "complete",
      rail_failure_code: null,
      repair_target: null,
    });
  });

  it("does not report observation_missing when docs locate observed matches but terminal authority failed closed", () => {
    const payload: Record<string, unknown> = {
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        turn_id: "ask:test:docs-locate-terminal-failed-later",
        source_target: "docs_viewer",
        required: true,
        admitted_tool_families: ["docs_viewer"],
        requested_capability: "docs-viewer.locate_in_doc",
        requested_capability_family: "docs_viewer",
        requested_capability_source: "explicit_user_command",
        requested_capability_confidence: 0.99,
        required_observation_kinds_for_requested_capability: [
          "doc_location_result",
          "doc_location_matches",
          "doc_evidence_location",
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:docs-locate-terminal-failed-later",
        capability_family: "docs",
        requested_action: "docs-viewer.locate_in_doc",
        selected_capability: "docs-viewer.locate_in_doc",
        requested_capability: "docs-viewer.locate_in_doc",
        admission_status: "admitted",
        required_terminal_kind: "doc_evidence_synthesis_answer",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            next_step: "next_action",
            chosen_capability: "docs-viewer.locate_in_doc",
            executed_action_key: "docs-viewer.locate_in_doc",
            satisfaction: "satisfied",
            observed_artifact_refs: ["doc_location_matches:1"],
          },
          {
            iteration: 2,
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            executed_action_key: null,
            satisfaction: "satisfied",
          },
        ],
        executed_tool_call_count: 1,
      },
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "compound_prompt_coverage_incomplete",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
      },
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "typed_failure",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "typed_failure",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "doc_location_matches:1",
          kind: "doc_location_matches",
          payload: {
            schema: "helix.doc_location_matches.v1",
            document_path: "docs/helix-ask-codex-loop-discipline.md",
            matches: [{ line: 216, text: "Routes choose procedures." }],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "final_answer_draft:docs-locate",
          kind: "final_answer_draft",
          payload: {
            schema: "helix.final_answer_draft.v1",
            support_refs: ["doc_location_matches:1"],
            artifact_refs: ["doc_location_matches:1"],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:docs-locate-terminal-failed-later", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:docs-locate-terminal-failed-later", payload });

    expect(index.required_observation_coverage_mode).toBe("any");
    expect(index.missing_required_observation_kinds).toEqual([]);
    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: "docs-viewer.locate_in_doc",
      executed_capability: "docs-viewer.locate_in_doc",
      observation_artifact_kind: "doc_location_matches",
      observed_artifact_supports_requested_capability: true,
      materialized_terminal_artifact_kind: "typed_failure",
      terminal_authority_kind: "typed_failure",
      visible_terminal_kind: "typed_failure",
      rail_status: "fail_closed",
      rail_failure_code: "terminal_not_materialized",
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      requested_capability: "docs-viewer.locate_in_doc",
      executed_capability: "docs-viewer.locate_in_doc",
      first_broken_rail: "terminal_materialization",
      failure_bucket: "E_terminal_materializer_gap",
      rail_failure_code: "terminal_not_materialized",
      repair_target: "terminal_materializer",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      requested_capability: "docs-viewer.locate_in_doc",
      selected_capability: "docs-viewer.locate_in_doc",
      executed_capability: "docs-viewer.locate_in_doc",
      observation_kind: "doc_location_matches",
      goal_satisfaction: null,
      required_terminal_kind: "doc_evidence_synthesis_answer",
      selected_terminal_kind: "typed_failure",
      visible_terminal_kind: "typed_failure",
      first_broken_rail: "terminal_materialization",
      repair_target: "terminal_materializer",
      codex_parity_class: "goal_contract_mismatch",
    });
  });

  it("reports missing contract observations for incomplete tool evidence", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:calculator-index-missing",
        capability_family: "calculator",
        requested_action: "scientific-calculator.solve_expression",
        admission_status: "admitted",
      },
      runtime_tool_call: {
        tool_call_id: "tool:calculator-index-missing",
        capability_key: "scientific-calculator.solve_expression",
        status: "completed",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "calculator_receipt:only",
          kind: "calculator_receipt",
          payload: {
            schema: "helix.calculator_receipt.v1",
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:calculator-index-missing", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:calculator-index-missing", payload });

    expect(index.missing_required_observation_kinds).toEqual([]);
    expect(index.reentry_status).toMatchObject({
      evidence_reentered: true,
      terminal_use_allowed: false,
    });
    expect(index.tool_turn_chain_audit).toMatchObject({
      route_family: "calculator",
      rail_status: "broken",
      rail_failure_code: "terminal_not_materialized",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      observation_kind: "calculator_receipt",
      reentry_status: "reentered",
      first_broken_rail: "support_backed_draft",
      repair_target: "draft_builder",
      codex_parity_class: "goal_contract_mismatch",
      rail_failure_code: "terminal_not_materialized",
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      first_broken_rail: "support_backed_draft",
      failure_bucket: "D_support_backed_draft_missing",
      repair_target: "draft_builder",
    });
    expect(index.assistant_answer).toBe(false);
  });

  it("treats pending text-to-speech handoff as a terminal-valid voice action without claiming playback completion", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "read the last final answer outloud",
      selected_final_answer:
        "I sent the last final answer to the text-to-speech lane. Playback is pending on the client side.",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        terminal_artifact_kind: "agent_provider_terminal_candidate",
        server_authoritative: true,
        terminal_eligible: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "agent_provider_terminal_candidate",
        selected_observation_refs: [
          "ask:test:voice-handoff:capability_lane:text_to_speech.speak_text:pending",
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "ask:test:voice-handoff:capability_lane:text_to_speech.speak_text:pending",
          kind: "capability_lane_observation_packet",
          payload_schema: "helix.agent_step_observation_packet.v1",
          capability_key: "text_to_speech.speak_text",
          status: "client_pending",
          payload: {
            schema: "helix.agent_step_observation_packet.v1",
            capability_key: "text_to_speech.speak_text",
            status: "client_pending",
            produced_artifact_refs: [
              "ask:test:voice-handoff:capability_lane:text_to_speech.speak_text:pending",
            ],
            state_delta: {
              text_to_speech_receipt: {
                schema: "helix.text_to_speech.receipt.v1",
                playback_status: "awaiting_client_playback",
                provider_status: "accepted",
                assistant_answer: false,
                terminal_eligible: false,
                raw_content_included: false,
              },
            },
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId: "ask:test:voice-handoff", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: "text_to_speech.speak_text",
      selected_capability: "text_to_speech.speak_text",
      executed_capability: "text_to_speech.speak_text",
      observation_artifact_kind: "capability_lane_observation_packet",
      handoff_status: "client_pending",
      handoff_terminal_allowed: true,
      reentry_executed: true,
      reentry_proof_source: "voice_tts_handoff_terminal_allowed",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      requested_capability: "text_to_speech.speak_text",
      selected_capability: "text_to_speech.speak_text",
      executed_capability: "text_to_speech.speak_text",
      reentry_status: "handoff_terminal_allowed",
      rail_status: "complete",
      rail_failure_code: null,
      codex_parity_class: "complete",
    });
    expect(payload.selected_final_answer).not.toMatch(/\b(?:played|completed|heard)\b/i);
  });

  it("does not count route selection as progress without execution and observation", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:planned-not-run",
        capability_family: "workspace_directory",
        requested_action: "workspace-directory.resolve",
        admission_status: "admitted",
      },
      current_turn_artifact_ledger: [],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:planned-not-run", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:planned-not-run", payload });

    expect(index.tool_rail_failure_triage).toMatchObject({
      route_family: "workspace_directory",
      selected_capability: "workspace-directory.resolve",
      executed_capability: null,
      did_tool_run: false,
      observation_ref: null,
      first_broken_rail: "capability_execution",
      failure_bucket: "A_tool_did_not_execute",
      repair_target: "tool_execution",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      selected_capability: "workspace-directory.resolve",
      admitted_capability: "workspace-directory.resolve",
      executed_capability: null,
      observation_kind: null,
      reentry_status: "no_observation",
      first_broken_rail: "capability_execution",
      repair_target: "tool_execution",
      codex_parity_class: "selected_not_executed",
      rail_failure_code: "required_observation_missing",
    });
  });

  it("does not count a declared Docs execution without a receipt-backed observation", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:docs-declared-not-observed",
        capability_family: "docs_viewer",
        requested_action: "docs_viewer",
        admission_status: "admitted",
      },
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        requested_capability: "docs_viewer",
        admitted_capability: "docs_viewer",
        executed_capability: "docs_viewer",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "ask:test:docs-declared-not-observed:runtime_intent_packet",
          kind: "runtime_intent_packet",
          payload: {
            schema: "helix.runtime_intent_packet.v1",
            proposed_capability: "docs.search",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({
      turnId: "ask:test:docs-declared-not-observed",
      payload,
    });

    expect(index.tool_rail_failure_triage).toMatchObject({
      selected_capability: "docs_viewer",
      executed_capability: null,
      did_tool_run: false,
      observation_ref: null,
      first_broken_rail: "capability_execution",
      failure_bucket: "A_tool_did_not_execute",
      repair_target: "tool_execution",
    });
  });

  it("fails audit when a selected docs summary does not satisfy explicit locate_in_doc request", () => {
    const payload: Record<string, unknown> = {
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        turn_id: "ask:test:wrong-docs-procedure",
        source_target: "docs_viewer",
        required: true,
        admitted_tool_families: ["docs_viewer"],
        capability_contract_guard_version: "E82",
        requested_capability: "docs-viewer.locate_in_doc",
        requested_capability_family: "docs_viewer",
        requested_capability_source: "explicit_user_command",
        requested_capability_confidence: 0.99,
        required_observation_kinds_for_requested_capability: [
          "doc_location_result",
          "doc_location_matches",
          "doc_evidence_location",
        ],
        forbidden_terminal_artifact_kinds: ["direct_answer_text"],
        forbidden_routes: ["model_only_concept"],
        reason: "docs_viewer_requires_document_tool_path+explicit_capability_contract_required",
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:wrong-docs-procedure",
        capability_family: "docs",
        requested_action: "docs-viewer.summarize_doc",
        selected_capability: "docs-viewer.summarize_doc",
        requested_capability: "docs-viewer.locate_in_doc",
        admission_status: "admitted",
      },
      runtime_tool_call: {
        tool_call_id: "tool:wrong-docs-procedure",
        capability_key: "docs-viewer.summarize_doc",
        status: "completed",
      },
      terminal_artifact_kind: "doc_summary",
      terminal_presentation: { terminal_artifact_kind: "doc_summary" },
      terminal_answer_authority: { terminal_artifact_kind: "doc_summary" },
      current_turn_artifact_ledger: [
        {
          artifact_id: "doc_summary:wrong",
          kind: "observation_review",
          payload: {
            schema: "helix.observation_review.v1",
            summary: "Summarized the document.",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:wrong-docs-procedure", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:wrong-docs-procedure", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      capability_contract_guard_version: "E82",
      requested_capability: "docs-viewer.locate_in_doc",
      selected_capability: "docs-viewer.summarize_doc",
      requested_selected_match: false,
      rail_status: "broken",
      rail_failure_code: "explicit_capability_not_selected",
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      first_broken_rail: "route_admission",
      rail_failure_code: "explicit_capability_not_selected",
      repair_target: "intent_arbitration",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      requested_capability: "docs-viewer.locate_in_doc",
      selected_capability: "docs-viewer.summarize_doc",
      executed_capability: "docs-viewer.summarize_doc",
      first_broken_rail: "route_admission",
      repair_target: "intent_arbitration",
      codex_parity_class: "explicit_capability_demoted",
      rail_failure_code: "explicit_capability_not_selected",
    });
  });

  it("authorizes a completed scholarly lookup-to-full-text compound transition", () => {
    const turnId = "ask:test:scholarly-lookup-to-full-text-chain";
    const lookupRef = `${turnId}:scholarly_lookup`;
    const fullTextRef = `${turnId}:scholarly_full_text`;
    const terminalKind = "compound_evidence_synthesis_answer";
    const compoundSubgoalLedger = [
      {
        subgoal_id: `${turnId}:subgoal:1:lookup`,
        order: 1,
        requested_capability: "scholarly-research.lookup_papers",
        runtime_capability: "scholarly-research.lookup_papers",
        selected_capability: "scholarly-research.lookup_papers",
        executed_capability: "scholarly-research.lookup_papers",
        observation_kind: "scholarly_research_observation",
        observation_ref: lookupRef,
        support_refs: [lookupRef],
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
      },
      {
        subgoal_id: `${turnId}:subgoal:2:full-text`,
        order: 2,
        requested_capability: "scholarly-research.fetch_full_text",
        runtime_capability: "scholarly-research.fetch_full_text",
        selected_capability: "scholarly-research.fetch_full_text",
        executed_capability: "scholarly-research.fetch_full_text",
        observation_kind: "scholarly_full_text_observation",
        observation_ref: fullTextRef,
        support_refs: [fullTextRef],
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
      },
    ];
    const payload: Record<string, unknown> = {
      active_prompt:
        "Use scholarly-research.lookup_papers, then fetch the best accessible source with scholarly-research.fetch_full_text.",
      tool_call_admission_decision: {
        requested_capability: "scholarly-research.lookup_papers",
        requested_capability_source: "explicit_user_command",
        required_observation_kinds_for_requested_capability: ["scholarly_research_observation"],
      },
      capability_plan: {
        requested_capability: "scholarly-research.lookup_papers",
        selected_capability: "scholarly-research.fetch_full_text",
      },
      operational_capability_trace: {
        model_proposed_capability: "scholarly-research.fetch_full_text",
        executed_capability: "scholarly-research.fetch_full_text",
      },
      tool_lifecycle_trace: {
        requested_capability: "scholarly-research.fetch_full_text",
        admitted_capability: "scholarly-research.fetch_full_text",
        executed_capability: "scholarly-research.fetch_full_text",
        lifecycle_stage: "reentered_solver",
      },
      route_product_contract: {
        required_terminal_artifact_kind: terminalKind,
        allowed_terminal_artifact_kinds: [terminalKind],
      },
      canonical_goal_frame: {
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: terminalKind,
      },
      terminal_artifact_kind: terminalKind,
      terminal_answer_authority: {
        terminal_artifact_kind: terminalKind,
        support_refs: [lookupRef, fullTextRef],
      },
      terminal_authority_single_writer: {
        selected_terminal_artifact_kind: terminalKind,
        terminal_artifact_kind: terminalKind,
        support_refs: [lookupRef, fullTextRef],
      },
      terminal_presentation: {
        terminal_artifact_kind: terminalKind,
      },
      final_answer_draft: {
        artifact_id: `${turnId}:final_answer_draft`,
        support_refs: [lookupRef, fullTextRef],
      },
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        applies: true,
        complete: true,
        compound_subgoal_ledger: compoundSubgoalLedger,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: lookupRef,
          kind: "scholarly_research_observation",
          payload: {
            schema: "helix.scholarly_research_observation.v1",
            capability: "scholarly-research.lookup_papers",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: fullTextRef,
          kind: "scholarly_full_text_observation",
          payload: {
            schema: "helix.scholarly_full_text_observation.v1",
            capability: "scholarly-research.fetch_full_text",
            evidence_state: "full_text_usable",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: `${turnId}:final_answer_draft`,
          kind: "final_answer_draft",
          payload: {
            support_refs: [lookupRef, fullTextRef],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId, payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: "scholarly-research.lookup_papers",
      selected_capability: "scholarly-research.fetch_full_text",
      executed_capability: "scholarly-research.fetch_full_text",
      requested_selected_direct_match: false,
      requested_executed_direct_match: false,
      compound_transition_authorized: true,
      requested_selected_match: true,
      selected_executed_match: true,
      rail_status: "complete",
      rail_failure_code: null,
    });
  });

  it("does not count explicitly non-authoritative terminal records as rail proof", () => {
    const payload: Record<string, unknown> = {
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        turn_id: "ask:test:invalid-terminal-authority",
        source_target: "docs_viewer",
        required: true,
        admitted_tool_families: ["docs_viewer"],
        requested_capability: "docs-viewer.summarize_doc",
        requested_capability_family: "docs_viewer",
        required_observation_kinds_for_requested_capability: ["observation_review"],
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:invalid-terminal-authority",
        capability_family: "docs_viewer",
        selected_capability: "docs-viewer.summarize_doc",
        requested_capability: "docs-viewer.summarize_doc",
        admission_status: "admitted",
      },
      runtime_tool_call: {
        tool_call_id: "tool:invalid-terminal-authority",
        capability_key: "docs-viewer.summarize_doc",
        status: "completed",
      },
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        requested_capability: "docs-viewer.summarize_doc",
        admitted_capability: "docs-viewer.summarize_doc",
        executed_capability: "docs-viewer.summarize_doc",
        lifecycle_stage: "reentered_solver",
        terminal_eligible: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_followup_decision: {
        schema: "helix.tool_followup_decision.v1",
        next_action: "terminal_answer",
        evidence_reentered: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_artifact_kind: "doc_summary",
      terminal_presentation: { terminal_artifact_kind: "doc_summary" },
      terminal_answer_authority: {
        terminal_artifact_kind: "doc_summary",
        server_authoritative: false,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "doc_summary:invalid-terminal-authority",
          kind: "doc_summary",
          payload: {
            schema: "helix.doc_summary.v1",
            summary: "Summarized the document.",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "observation_review:invalid-terminal-authority",
          kind: "observation_review",
          payload: {
            schema: "helix.observation_review.v1",
            summary: "Summarized the document.",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId: "ask:test:invalid-terminal-authority", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: "docs-viewer.summarize_doc",
      selected_capability: "docs-viewer.summarize_doc",
      executed_capability: "docs-viewer.summarize_doc",
      materialized_terminal_artifact_kind: "doc_summary",
      terminal_authority_kind: null,
      terminal_authority_proof_source: null,
      terminal_authority_proven: false,
      visible_terminal_kind: "doc_summary",
      visible_projection_proven: true,
      rail_status: "broken",
      rail_failure_code: "terminal_authority_missing",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      selected_terminal_kind: null,
      terminal_authority_proof_source: null,
      terminal_authority_proven: false,
      visible_terminal_kind: "doc_summary",
      visible_projection_proven: true,
      rail_status: "broken",
      rail_failure_code: "terminal_authority_missing",
    });
  });

  it("classifies repeated weak repo evidence as an evidence re-entry progress failure", () => {
    const payload: Record<string, unknown> = {
      terminal_error_code: "repo_evidence_weak_after_repair",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        turn_id: "ask:test:weak-repo-loop",
        source_target: "repo_code",
        required: true,
        admitted_tool_families: ["repo_code"],
        capability_contract_guard_version: "E82",
        requested_capability: "repo-code.search_concept",
        requested_capability_family: "repo_code",
        requested_capability_source: "explicit_user_command",
        required_observation_kinds_for_requested_capability: [
          "repo_code_evidence_observation",
          "repo_evidence_relevance_gate",
        ],
        forbidden_terminal_artifact_kinds: ["direct_answer_text"],
        forbidden_routes: ["model_only_concept"],
        reason: "repo_code_requires_repo_evidence_path+explicit_capability_contract_required",
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:weak-repo-loop",
        capability_family: "repo_evidence",
        requested_action: "repo-code.search_concept",
        selected_capability: "repo-code.search_concept",
        requested_capability: "repo-code.search_concept",
        admission_status: "needs_evidence",
      },
      runtime_tool_call: {
        tool_call_id: "tool:weak-repo-loop",
        capability_key: "repo-code.search_concept",
        status: "completed",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "repo_obs:weak",
          kind: "repo_code_evidence_observation",
          payload: {
            schema: "helix.repo_code_evidence_observation.v1",
            concept: "terminal authority",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "repo_gate:weak",
          kind: "repo_evidence_relevance_gate",
          payload: {
            schema: "helix.repo_evidence_relevance_gate.v1",
            repair_required: true,
            terminal_allowed: false,
            coverage: "weak",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "typed_failure:weak",
          kind: "typed_failure",
          payload: {
            schema: "helix.typed_failure.v1",
            error_code: "repo_evidence_weak_after_repair",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:weak-repo-loop", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:weak-repo-loop", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: "repo-code.search_concept",
      selected_capability: "repo-code.search_concept",
      executed_capability: "repo-code.search_concept",
      rail_status: "fail_closed",
      rail_failure_code: "weak_evidence_repair_loop",
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      first_broken_rail: "evidence_reentry",
      rail_failure_code: "weak_evidence_repair_loop",
      repair_target: "repo_retrieval_repair_policy",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      requested_capability: "repo-code.search_concept",
      selected_capability: "repo-code.search_concept",
      executed_capability: "repo-code.search_concept",
      first_broken_rail: "evidence_reentry",
      repair_target: "repo_retrieval_repair_policy",
      codex_parity_class: "observation_not_reentered",
      rail_failure_code: "weak_evidence_repair_loop",
    });
  });

  it("does not count a policy-rejected runtime tool call as execution", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:calculator-policy-rejected",
        capability_family: "debug_export",
        requested_action: "scientific-calculator.solve_expression",
        admission_status: "admitted",
      },
      runtime_tool_call: {
        tool_call_id: "tool:calculator-policy-rejected",
        capability_key: "scientific-calculator.solve_expression",
        status: "rejected",
      },
      terminal_artifact_kind: "typed_failure",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer.v1",
        selected_terminal_artifact_kind: "typed_failure",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "typed_failure",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "runtime_tool_call:calculator-policy-rejected",
          kind: "runtime_tool_call",
          payload: {
            schema: "helix.runtime_tool_call.v1",
            capability_key: "scientific-calculator.solve_expression",
          },
        },
        {
          artifact_id: "runtime_tool_observation:calculator-policy-rejected",
          kind: "runtime_tool_observation",
          payload: {
            schema: "helix.runtime_tool_observation.v1",
            summary:
              "Runtime tool call rejected before execution: runtime_capability_not_admitted_by_tool_policy:scientific-calculator.solve_expression:calculator|workstation_action, runtime_tool_forbidden_by_tool_policy:scientific-calculator.solve_expression.",
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:calculator-policy-rejected", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:calculator-policy-rejected", payload });

    expect(index).toMatchObject({
      tool_family: "calculator",
      capability: "scientific-calculator.solve_expression",
      missing_required_observation_kinds: expect.arrayContaining([
        "calculator_receipt",
        "workstation_tool_evaluation",
      ]),
    });
    expect(index.tool_turn_chain_audit).toMatchObject({
      route_family: "calculator",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: null,
      policy_rejection_ref: "runtime_tool_observation:calculator-policy-rejected",
      observation_ref: null,
      materialized_terminal_artifact_kind: "typed_failure",
      terminal_authority_kind: "typed_failure",
      visible_terminal_kind: "typed_failure",
      rail_status: "fail_closed",
      rail_failure_code: "tool_execution_rejected",
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      route_family: "calculator",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: null,
      did_tool_run: false,
      observation_ref: null,
      first_broken_rail: "capability_execution",
      failure_bucket: "A_tool_did_not_execute",
      repair_target: "tool_admission",
      rail_status: "fail_closed",
      rail_failure_code: "tool_execution_rejected",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: null,
      observation_kind: null,
      observation_ref: null,
      reentry_status: "no_observation",
      required_terminal_kind: expect.any(String),
      selected_terminal_kind: "typed_failure",
      visible_terminal_kind: "typed_failure",
      first_broken_rail: "capability_execution",
      repair_target: "tool_admission",
      codex_parity_class: "tool_admission_rejected",
      rail_status: "fail_closed",
      rail_failure_code: "tool_execution_rejected",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(index.tool_turn_chain_family_matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route_family: "calculator",
          observed: true,
          did_tool_run: false,
          artifact_produced: false,
          rail_status: "fail_closed",
          rail_failure_code: "tool_execution_rejected",
        }),
      ]),
    );
  });

  it("classifies internet search provider key failures as config_missing", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:internet-config-missing",
        capability_family: "internet_search",
        requested_action: "internet_search.web_research",
        admission_status: "admitted",
      },
      terminal_error_code: "internet_search_config_missing",
      selected_final_answer: "Internet search is unavailable because Tavily, Exa, or Google CSE API keys are missing.",
      terminal_artifact_kind: "typed_failure",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer.v1",
        selected_terminal_artifact_kind: "typed_failure",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "typed_failure",
      },
      current_turn_artifact_ledger: [],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:internet-config-missing", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:internet-config-missing", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      route_family: "internet_search",
      selected_capability: "internet_search.web_research",
      executed_capability: null,
      observation_ref: null,
      materialized_terminal_artifact_kind: "typed_failure",
      terminal_authority_kind: "typed_failure",
      visible_terminal_kind: "typed_failure",
      rail_status: "fail_closed",
      rail_failure_code: "config_missing",
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      first_broken_rail: "config",
      failure_bucket: "G_config_missing",
      repair_target: "operator_config",
      rail_status: "fail_closed",
      rail_failure_code: "config_missing",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      selected_capability: "internet_search.web_research",
      executed_capability: null,
      first_broken_rail: "config",
      repair_target: "operator_config",
      codex_parity_class: "provider_config_missing",
      rail_status: "fail_closed",
      rail_failure_code: "config_missing",
    });
    expect(index.tool_turn_chain_family_matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route_family: "internet_search",
          observed: true,
          did_tool_run: false,
          artifact_produced: false,
          rail_status: "fail_closed",
          rail_failure_code: "config_missing",
        }),
      ]),
    );
  });

  it("classifies calculator terminal projection mismatch as presenter_boundary", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:calculator-projection-mismatch",
        capability_family: "calculator",
        requested_action: "scientific-calculator.solve_expression",
        admission_status: "admitted",
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "scientific-calculator.solve_expression",
        requested_capability_family: "calculator",
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_result: {
        schema: "helix.capability_result.v1",
        turn_id: "ask:test:calculator-projection-mismatch",
        status: "succeeded",
        receipt_refs: ["calculator_receipt:projection"],
        evidence_refs: ["calculator_result_validation:projection"],
        selected_for_answer: true,
        reentered_solver: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      operational_satisfaction_evaluation: {
        schema: "helix.operational_satisfaction_evaluation.v1",
        turn_id: "ask:test:calculator-projection-mismatch",
        requested_surface_satisfied: true,
        next_decision: "allow_terminal",
      },
      runtime_tool_call: {
        tool_call_id: "tool:calculator-projection-mismatch",
        capability_key: "scientific-calculator.solve_expression",
        status: "completed",
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:calculator-projection-mismatch:final_answer_draft",
        support_refs: [
          "calculator_receipt:projection",
          "calculator_result_trace:projection",
          "calculator_result_validation:projection",
        ],
      },
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "typed_failure",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: [
        { artifact_id: "calculator_receipt:projection", kind: "calculator_receipt", payload: { schema: "helix.calculator_receipt.v1" } },
        { artifact_id: "calculator_result_trace:projection", kind: "calculator_result_trace", payload: { schema: "helix.calculator_result_trace.v1" } },
        { artifact_id: "calculator_result_validation:projection", kind: "calculator_result_validation", payload: { schema: "helix.calculator_result_validation.v1" } },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:calculator-projection-mismatch", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:calculator-projection-mismatch", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      rail_status: "fail_closed",
      rail_failure_code: "terminal_projection_mismatch",
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      first_broken_rail: "visible_projection",
      failure_bucket: "F_terminal_projection_mismatch",
      repair_target: "presenter_boundary",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      first_broken_rail: "visible_projection",
      repair_target: "presenter_boundary",
      codex_parity_class: "visible_projection_mismatch",
      rail_failure_code: "terminal_projection_mismatch",
    });
  });

  it("reports a missing terminal authority writer as a terminal authority mismatch", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:terminal-authority-missing",
        capability_family: "calculator",
        requested_action: "scientific-calculator.solve_expression",
        admission_status: "admitted",
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "scientific-calculator.solve_expression",
        requested_capability_family: "calculator",
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_result: {
        schema: "helix.capability_result.v1",
        turn_id: "ask:test:terminal-authority-missing",
        status: "succeeded",
        receipt_refs: ["calculator_receipt:authority"],
        evidence_refs: ["calculator_result_validation:authority"],
        selected_for_answer: true,
        reentered_solver: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      operational_satisfaction_evaluation: {
        schema: "helix.operational_satisfaction_evaluation.v1",
        turn_id: "ask:test:terminal-authority-missing",
        requested_surface_satisfied: true,
        next_decision: "allow_terminal",
      },
      runtime_tool_call: {
        tool_call_id: "tool:terminal-authority-missing",
        capability_key: "scientific-calculator.solve_expression",
        status: "completed",
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:terminal-authority-missing:final_answer_draft",
        support_refs: [
          "calculator_receipt:authority",
          "calculator_result_trace:authority",
          "calculator_result_validation:authority",
        ],
      },
      terminal_artifact_kind: "calculator_stream_result",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "calculator_stream_result",
      },
      current_turn_artifact_ledger: [
        { artifact_id: "calculator_receipt:authority", kind: "calculator_receipt", payload: { schema: "helix.calculator_receipt.v1" } },
        { artifact_id: "calculator_result_trace:authority", kind: "calculator_result_trace", payload: { schema: "helix.calculator_result_trace.v1" } },
        { artifact_id: "calculator_result_validation:authority", kind: "calculator_result_validation", payload: { schema: "helix.calculator_result_validation.v1" } },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:terminal-authority-missing", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:terminal-authority-missing", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      materialized_terminal_artifact_kind: "calculator_stream_result",
      terminal_authority_kind: null,
      visible_terminal_kind: "calculator_stream_result",
      rail_status: "broken",
      rail_failure_code: "terminal_authority_missing",
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      first_broken_rail: "terminal_authority",
      repair_target: "terminal_authority",
      rail_failure_code: "terminal_authority_missing",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      selected_terminal_kind: null,
      visible_terminal_kind: "calculator_stream_result",
      first_broken_rail: "terminal_authority",
      repair_target: "terminal_authority",
      codex_parity_class: "terminal_authority_mismatch",
      rail_failure_code: "terminal_authority_missing",
    });
  });

  it("does not treat payload terminal kind alone as proven visible projection", () => {
    const payload: Record<string, unknown> = {
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "workspace_status_diagnostic",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:payload-only-visible-projection",
        capability_family: "workspace_diagnostic",
        requested_action: "workspace_os.status",
        selected_capability: "workspace_os.status",
        admission_status: "admitted",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            chosen_capability: "workspace_os.status",
            executed_action_key: "workspace_os.status",
            observed_artifact_refs: ["workspace_os_status_observation:payload-only"],
          },
        ],
        executed_tool_call_count: 1,
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:payload-only-visible-projection:final_answer_draft",
        support_refs: ["workspace_os_status_observation:payload-only"],
      },
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_answer_authority: {
        schema: "helix.terminal_answer_authority.v1",
        terminal_artifact_kind: "model_synthesized_answer",
        final_answer_source: "final_answer_draft",
      },
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "workspace_os_status_observation:payload-only",
          kind: "workspace_os_status_observation",
          producer_item_id: "workspace_os.status",
          payload: {
            schema: "helix.workspace_os_status_observation.v1",
            capability_key: "workspace_os.status",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:payload-only-visible-projection", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:payload-only-visible-projection", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      terminal_authority_kind: "model_synthesized_answer",
      visible_terminal_kind: "model_synthesized_answer",
      visible_projection_source: "payload.terminal_artifact_kind",
      visible_projection_proven: false,
      rail_status: "broken",
      rail_failure_code: "terminal_projection_mismatch",
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      first_broken_rail: "visible_projection",
      failure_bucket: "F_terminal_projection_mismatch",
      repair_target: "presenter_boundary",
      rail_failure_code: "terminal_projection_mismatch",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      selected_terminal_kind: "model_synthesized_answer",
      visible_terminal_kind: "model_synthesized_answer",
      visible_projection_source: "payload.terminal_artifact_kind",
      visible_projection_proven: false,
      first_broken_rail: "visible_projection",
      codex_parity_class: "visible_projection_mismatch",
      rail_status: "broken",
      rail_failure_code: "terminal_projection_mismatch",
    });
  });

  it("classifies a materialized terminal product that violates the route contract", () => {
    const payload: Record<string, unknown> = {
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "calculator_solve",
        required_terminal_kind: "calculator_stream_result",
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:terminal-product-mismatch",
        capability_family: "calculator",
        requested_action: "scientific-calculator.solve_expression",
        admission_status: "admitted",
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "scientific-calculator.solve_expression",
        requested_capability_family: "calculator",
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_result: {
        schema: "helix.capability_result.v1",
        turn_id: "ask:test:terminal-product-mismatch",
        status: "succeeded",
        receipt_refs: ["calculator_receipt:terminal-product"],
        evidence_refs: ["calculator_result_validation:terminal-product"],
        selected_for_answer: true,
        reentered_solver: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      operational_satisfaction_evaluation: {
        schema: "helix.operational_satisfaction_evaluation.v1",
        turn_id: "ask:test:terminal-product-mismatch",
        requested_surface_satisfied: true,
        next_decision: "allow_terminal",
      },
      runtime_tool_call: {
        tool_call_id: "tool:terminal-product-mismatch",
        capability_key: "scientific-calculator.solve_expression",
        status: "completed",
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:terminal-product-mismatch:final_answer_draft",
        support_refs: [
          "calculator_receipt:terminal-product",
          "calculator_result_trace:terminal-product",
          "calculator_result_validation:terminal-product",
        ],
      },
      terminal_artifact_kind: "doc_summary",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "doc_summary",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "doc_summary",
      },
      current_turn_artifact_ledger: [
        { artifact_id: "calculator_receipt:terminal-product", kind: "calculator_receipt", payload: { schema: "helix.calculator_receipt.v1" } },
        { artifact_id: "calculator_result_trace:terminal-product", kind: "calculator_result_trace", payload: { schema: "helix.calculator_result_trace.v1" } },
        { artifact_id: "calculator_result_validation:terminal-product", kind: "calculator_result_validation", payload: { schema: "helix.calculator_result_validation.v1" } },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:terminal-product-mismatch", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:terminal-product-mismatch", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      required_terminal_kind: "calculator_stream_result",
      materialized_terminal_artifact_kind: "doc_summary",
      terminal_authority_kind: "doc_summary",
      visible_terminal_kind: "doc_summary",
      rail_status: "broken",
      rail_failure_code: "terminal_product_mismatch",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      required_terminal_kind: "calculator_stream_result",
      selected_terminal_kind: "doc_summary",
      visible_terminal_kind: "doc_summary",
      first_broken_rail: "terminal_materialization",
      repair_target: "terminal_materializer",
      codex_parity_class: "terminal_product_not_allowed",
      rail_failure_code: "terminal_product_mismatch",
    });
  });

  it("lets a committed compound route authorize synthesis after an evidence-only theory reflection tool", () => {
    const turnId = "ask:test:committed-compound-theory-reflection";
    const observationRef = `${turnId}:theory_context_reflection`;
    const terminalKind = "compound_evidence_synthesis_answer";
    const payload: Record<string, unknown> = {
      active_prompt:
        "Compare the selected theory badges, reflect their current context, and synthesize the bounded comparison.",
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        turn_id: turnId,
        goal_kind: "theory_context_reflection",
        required_terminal_kind: "model_synthesized_answer",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        turn_id: turnId,
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: [
          "theory_context_reflection_answer",
          "model_synthesized_answer",
        ],
      },
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        commit_id: "committed-route:compound-theory-reflection",
        prompt_hash: "prompt-hash:compound-theory-reflection",
        committed_at_stage: "post_prompt_source_arbitration",
        prompt_intent: {
          primary_intent_kind: "general_reasoning",
          secondary_intent_kinds: [],
        },
        route: {
          selected_route: "/ask",
          source_target: "theory_locator",
          target_kind: "theory_locator",
          strength: "hard",
          source_identity: null,
          route_reason: "explicit_capability_contract",
          stale_metadata_policy: "ignore_unless_matches_commit",
        },
        canonical_goal: {
          goal_kind: "theory_locator",
          required_terminal_kind: terminalKind,
          allowed_terminal_artifact_kinds: [
            terminalKind,
            "model_synthesized_answer",
          ],
          forbidden_terminal_artifact_kinds: [
            "tool_receipt",
            "workspace_action_receipt",
          ],
        },
        capability_policy: {
          allowed_tool_families: ["theory_locator"],
          suppressed_tool_families: [],
          required_capability_families: ["theory_locator"],
          mutating_families_allowed: false,
        },
        suppression: {
          contextual_tool_mentions: [],
          negative_constraints: [],
          suppressed_families: [],
          firewall_required: true,
        },
        terminal_product: {
          terminal_authority_required: true,
          evidence_reentry_required: true,
          followup_reasoning_required: true,
          required_terminal_product: terminalKind,
        },
        transitions: [],
        compatibility: {
          source_goal_capability_terminal_compatible: true,
          stale_metadata_ignored: true,
          shortcut_firewall_applied: false,
          violations: [],
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      route_evidence_authority: {
        schema: "helix.route_evidence_authority.v1",
        turn_id: turnId,
        terminal_product_allowed: true,
        required_terminal_kind: terminalKind,
        allowed_terminal_artifact_kinds: [terminalKind],
        forbidden_terminal_artifact_kinds: [
          "tool_receipt",
          "workspace_action_receipt",
        ],
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "helix_ask.reflect_theory_context",
        requested_capability_family: "theory_locator",
        requested_capability_source: "explicit_user_command",
        required_observation_kinds_for_requested_capability: [
          "theory_context_reflection",
          "helix_theory_context_reflection_tool_receipt",
        ],
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: turnId,
        capability_family: "theory_locator",
        requested_capability: "helix_ask.reflect_theory_context",
        selected_capability: "helix_ask.reflect_theory_context",
        admission_status: "admitted",
      },
      operational_capability_trace: {
        model_proposed_capability: "helix_ask.reflect_theory_context",
        policy_admitted_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
      },
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        requested_capability: "helix_ask.reflect_theory_context",
        admitted_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        lifecycle_stage: "reentered_solver",
        status: "completed",
        observation_refs: [observationRef],
        evidence_refs: [observationRef],
      },
      capability_result: {
        schema: "helix.capability_result.v1",
        turn_id: turnId,
        capability_key: "helix_ask.reflect_theory_context",
        requested_capability: "helix_ask.reflect_theory_context",
        admitted_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        status: "succeeded",
        reentered_solver: true,
        selected_for_answer: true,
        observation_refs: [observationRef],
        evidence_refs: [observationRef],
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: `${turnId}:final_answer_draft`,
        support_refs: [observationRef],
      },
      terminal_artifact_kind: terminalKind,
      final_answer_source: terminalKind,
      terminal_answer_authority: {
        schema: "helix.terminal_answer_authority.v1",
        turn_id: turnId,
        terminal_artifact_kind: terminalKind,
        final_answer_source: terminalKind,
        support_refs: [observationRef],
        server_authoritative: true,
      },
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        turn_id: turnId,
        selected_terminal_artifact_kind: terminalKind,
        terminal_artifact_kind: terminalKind,
        support_refs: [observationRef],
        server_authoritative: true,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: terminalKind,
        final_answer_source: terminalKind,
        selected_observation_refs: [observationRef],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: observationRef,
          kind: "helix_theory_context_reflection_tool_receipt",
          payload: {
            schema: "helix.theory_context_reflection_tool_receipt.v1",
            capability: "helix_ask.reflect_theory_context",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId, payload });
    const index = buildArtifactQueryIndex({ turnId, payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      required_terminal_kind: terminalKind,
      materialized_terminal_artifact_kind: terminalKind,
      terminal_authority_kind: terminalKind,
      visible_terminal_kind: terminalKind,
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      required_terminal_kind: terminalKind,
      selected_terminal_kind: terminalKind,
      visible_terminal_kind: terminalKind,
      codex_parity_class: "complete",
      rail_status: "complete",
      rail_failure_code: null,
    });
  });

  it("keeps a compound synthesis terminal blocked when the committed route forbids it", () => {
    const turnId = "ask:test:forbidden-compound-theory-reflection";
    const observationRef = `${turnId}:theory_context_reflection`;
    const terminalKind = "compound_evidence_synthesis_answer";
    const payload: Record<string, unknown> = {
      active_prompt: "Reflect the current theory context.",
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        turn_id: turnId,
        goal_kind: "theory_context_reflection",
        required_terminal_kind: "model_synthesized_answer",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        turn_id: turnId,
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer"],
        forbidden_terminal_artifact_kinds: [terminalKind],
      },
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        canonical_goal: {
          goal_kind: "theory_locator",
          required_terminal_kind: "model_synthesized_answer",
          allowed_terminal_artifact_kinds: ["model_synthesized_answer"],
          forbidden_terminal_artifact_kinds: [terminalKind],
        },
      },
      route_evidence_authority: {
        schema: "helix.route_evidence_authority.v1",
        turn_id: turnId,
        terminal_product_allowed: false,
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer"],
        forbidden_terminal_artifact_kinds: [terminalKind],
      },
      tool_call_admission_decision: {
        requested_capability: "helix_ask.reflect_theory_context",
        requested_capability_family: "theory_locator",
        requested_capability_source: "explicit_user_command",
        required_observation_kinds_for_requested_capability: [
          "helix_theory_context_reflection_tool_receipt",
        ],
      },
      capability_plan: {
        requested_capability: "helix_ask.reflect_theory_context",
        selected_capability: "helix_ask.reflect_theory_context",
      },
      operational_capability_trace: {
        executed_capability: "helix_ask.reflect_theory_context",
      },
      tool_lifecycle_trace: {
        requested_capability: "helix_ask.reflect_theory_context",
        admitted_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        lifecycle_stage: "reentered_solver",
        observation_refs: [observationRef],
        evidence_refs: [observationRef],
      },
      final_answer_draft: {
        draft_id: `${turnId}:final_answer_draft`,
        support_refs: [observationRef],
      },
      terminal_artifact_kind: terminalKind,
      terminal_answer_authority: {
        terminal_artifact_kind: terminalKind,
        support_refs: [observationRef],
      },
      terminal_authority_single_writer: {
        selected_terminal_artifact_kind: terminalKind,
        support_refs: [observationRef],
      },
      terminal_presentation: {
        terminal_artifact_kind: terminalKind,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: observationRef,
          kind: "helix_theory_context_reflection_tool_receipt",
          payload: {
            capability: "helix_ask.reflect_theory_context",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId, payload });
    const index = buildArtifactQueryIndex({ turnId, payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      required_terminal_kind: "model_synthesized_answer",
      materialized_terminal_artifact_kind: terminalKind,
      rail_status: "broken",
      rail_failure_code: "terminal_product_mismatch",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      codex_parity_class: "terminal_product_not_allowed",
      rail_failure_code: "terminal_product_mismatch",
    });
  });

  it("classifies unsupported terminal drafts as goal contract mismatches", () => {
    const payload: Record<string, unknown> = {
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "calculator_solve",
        required_terminal_kind: "calculator_stream_result",
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:support-refs-missing",
        capability_family: "calculator",
        requested_action: "scientific-calculator.solve_expression",
        admission_status: "admitted",
      },
      capability_result: {
        schema: "helix.capability_result.v1",
        turn_id: "ask:test:support-refs-missing",
        status: "succeeded",
        receipt_refs: ["calculator_receipt:support-missing"],
        evidence_refs: ["calculator_result_validation:support-missing"],
        selected_for_answer: true,
        reentered_solver: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        requested_capability: "scientific-calculator.solve_expression",
        admitted_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        lifecycle_stage: "reentered_solver",
        status: "completed",
        observation_refs: ["calculator_receipt:support-missing"],
        evidence_refs: ["calculator_result_validation:support-missing"],
      },
      runtime_tool_call: {
        tool_call_id: "tool:support-refs-missing",
        capability_key: "scientific-calculator.solve_expression",
        status: "completed",
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:support-refs-missing:final_answer_draft",
        support_refs: [],
      },
      terminal_artifact_kind: "calculator_stream_result",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "calculator_stream_result",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "calculator_stream_result",
      },
      current_turn_artifact_ledger: [
        { artifact_id: "calculator_receipt:support-missing", kind: "calculator_receipt", payload: { schema: "helix.calculator_receipt.v1" } },
        { artifact_id: "calculator_result_trace:support-missing", kind: "calculator_result_trace", payload: { schema: "helix.calculator_result_trace.v1" } },
        { artifact_id: "calculator_result_validation:support-missing", kind: "calculator_result_validation", payload: { schema: "helix.calculator_result_validation.v1" } },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:support-refs-missing", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:support-refs-missing", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      reentry_executed: true,
      final_answer_draft_ref: "ask:test:support-refs-missing:final_answer_draft",
      support_refs_count: 0,
      rail_status: "broken",
      rail_failure_code: "support_refs_missing",
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      first_broken_rail: "support_backed_draft",
      repair_target: "draft_builder",
      rail_failure_code: "support_refs_missing",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      reentry_status: "reentered",
      first_broken_rail: "support_backed_draft",
      repair_target: "draft_builder",
      codex_parity_class: "goal_contract_mismatch",
      rail_failure_code: "support_refs_missing",
    });
  });

  it("does not count support refs from explicitly non-authoritative terminal records", () => {
    const payload: Record<string, unknown> = {
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "calculator_solve",
        required_terminal_kind: "calculator_stream_result",
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:invalid-authority-support-refs",
        capability_family: "calculator",
        requested_action: "scientific-calculator.solve_expression",
        admission_status: "admitted",
      },
      capability_result: {
        schema: "helix.capability_result.v1",
        turn_id: "ask:test:invalid-authority-support-refs",
        status: "succeeded",
        receipt_refs: ["calculator_receipt:invalid-authority-support"],
        evidence_refs: ["calculator_result_validation:invalid-authority-support"],
        selected_for_answer: true,
        reentered_solver: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        requested_capability: "scientific-calculator.solve_expression",
        admitted_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        lifecycle_stage: "reentered_solver",
        status: "completed",
        observation_refs: ["calculator_receipt:invalid-authority-support"],
        evidence_refs: ["calculator_result_validation:invalid-authority-support"],
      },
      runtime_tool_call: {
        tool_call_id: "tool:invalid-authority-support",
        capability_key: "scientific-calculator.solve_expression",
        status: "completed",
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:invalid-authority-support-refs:final_answer_draft",
        support_refs: [],
      },
      terminal_artifact_kind: "calculator_stream_result",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "calculator_stream_result",
        support_refs: ["calculator_receipt:invalid-authority-support"],
        support_refs_count: 1,
        server_authoritative: false,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "calculator_stream_result",
      },
      current_turn_artifact_ledger: [
        { artifact_id: "calculator_receipt:invalid-authority-support", kind: "calculator_receipt", payload: { schema: "helix.calculator_receipt.v1" } },
        { artifact_id: "calculator_subgoal_receipt:invalid-authority-support", kind: "calculator_subgoal_receipt", payload: { schema: "helix.calculator_subgoal_receipt.v1" } },
        { artifact_id: "calculator_result_trace:invalid-authority-support", kind: "calculator_result_trace", payload: { schema: "helix.calculator_result_trace.v1" } },
        { artifact_id: "calculator_result_validation:invalid-authority-support", kind: "calculator_result_validation", payload: { schema: "helix.calculator_result_validation.v1" } },
        { artifact_id: "workstation_tool_evaluation:invalid-authority-support", kind: "workstation_tool_evaluation", payload: { schema: "helix.workstation_tool_evaluation.v1" } },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:invalid-authority-support-refs", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:invalid-authority-support-refs", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      final_answer_draft_ref: "ask:test:invalid-authority-support-refs:final_answer_draft",
      support_refs_count: 0,
      terminal_authority_kind: null,
      terminal_authority_proven: false,
      rail_status: "broken",
      rail_failure_code: "support_refs_missing",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      terminal_authority_proven: false,
      rail_status: "broken",
      rail_failure_code: "support_refs_missing",
    });
  });

  it("does not count blocked draft selection materialization as terminal rail proof", () => {
    const payload: Record<string, unknown> = {
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "calculator_solve",
        required_terminal_kind: "calculator_stream_result",
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:blocked-draft-selection-proof",
        capability_family: "calculator",
        requested_action: "scientific-calculator.solve_expression",
        admission_status: "admitted",
      },
      capability_result: {
        schema: "helix.capability_result.v1",
        turn_id: "ask:test:blocked-draft-selection-proof",
        status: "succeeded",
        receipt_refs: ["calculator_receipt:blocked-draft-selection"],
        evidence_refs: ["calculator_result_validation:blocked-draft-selection"],
        selected_for_answer: true,
        reentered_solver: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        requested_capability: "scientific-calculator.solve_expression",
        admitted_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        lifecycle_stage: "reentered_solver",
        status: "completed",
        observation_refs: ["calculator_receipt:blocked-draft-selection"],
        evidence_refs: ["calculator_result_validation:blocked-draft-selection"],
      },
      runtime_tool_call: {
        tool_call_id: "tool:blocked-draft-selection",
        capability_key: "scientific-calculator.solve_expression",
        status: "completed",
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:blocked-draft-selection-proof:final_answer_draft",
        support_refs: [],
      },
      final_answer_draft_selection: {
        schema: "helix.final_answer_draft_selection.v1",
        materialized_terminal_artifact_kind: "calculator_stream_result",
        materialized_terminal_artifact_ref: "calculator_stream_result:blocked-draft-selection",
        support_refs: ["calculator_result_validation:blocked-draft-selection"],
        support_refs_count: 1,
        blocked_reason: "compound_subgoal_support_refs_missing",
      },
      route_terminal_materialization: {
        schema: "helix.route_terminal_materialization.v1",
        materialization_attempted: true,
        materialization_ok: false,
        materialization_blocked_reason: "compound_subgoal_support_refs_missing",
      },
      current_turn_artifact_ledger: [
        { artifact_id: "calculator_receipt:blocked-draft-selection", kind: "calculator_receipt", payload: { schema: "helix.calculator_receipt.v1" } },
        { artifact_id: "calculator_subgoal_receipt:blocked-draft-selection", kind: "calculator_subgoal_receipt", payload: { schema: "helix.calculator_subgoal_receipt.v1" } },
        { artifact_id: "calculator_result_trace:blocked-draft-selection", kind: "calculator_result_trace", payload: { schema: "helix.calculator_result_trace.v1" } },
        { artifact_id: "calculator_result_validation:blocked-draft-selection", kind: "calculator_result_validation", payload: { schema: "helix.calculator_result_validation.v1" } },
        { artifact_id: "workstation_tool_evaluation:blocked-draft-selection", kind: "workstation_tool_evaluation", payload: { schema: "helix.workstation_tool_evaluation.v1" } },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:blocked-draft-selection-proof", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:blocked-draft-selection-proof", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      final_answer_draft_ref: "ask:test:blocked-draft-selection-proof:final_answer_draft",
      support_refs_count: 0,
      materialized_terminal_artifact_kind: null,
      terminal_authority_kind: null,
      terminal_authority_proven: false,
      rail_status: "broken",
      rail_failure_code: "terminal_not_materialized",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      terminal_authority_proven: false,
      rail_status: "broken",
      rail_failure_code: "terminal_not_materialized",
    });
  });

  it("surfaces a missing visible capability surface before treating selected capability as progress", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:tool-surface-missing",
        capability_family: "docs",
        requested_action: "docs-viewer.locate_in_doc",
        selected_capability: "docs-viewer.locate_in_doc",
        requested_capability: "docs-viewer.locate_in_doc",
        requested_capability_source: "explicit_user_command",
        admission_status: "admitted",
      },
      current_turn_artifact_ledger: [],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:tool-surface-missing", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:tool-surface-missing", payload });

    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      requested_capability: "docs-viewer.locate_in_doc",
      visible_tool_surface: [],
      selected_capability: "docs-viewer.locate_in_doc",
      executed_capability: null,
      first_broken_rail: "capability_execution",
      codex_parity_class: "tool_surface_missing",
    });
  });

  it("normalizes a completed workspace_os.status turn through the same rail table", () => {
    const payload: Record<string, unknown> = {
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "workspace_status_diagnostic",
        required_terminal_kind: "model_synthesized_answer",
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        turn_id: "ask:test:workspace-os-status",
        source_target: "workspace_diagnostic",
        required: true,
        admitted_tool_families: ["workspace_diagnostic"],
        requested_capability: "workspace_os.status",
        requested_capability_family: "workspace_diagnostic",
        requested_capability_source: "explicit_user_command",
        required_observation_kinds_for_requested_capability: ["workspace_os_status_observation"],
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:workspace-os-status",
        capability_family: "workspace_diagnostic",
        requested_action: "workspace_os.status",
        selected_capability: "workspace_os.status",
        requested_capability: "workspace_os.status",
        admission_status: "admitted",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            chosen_capability: "workspace_os.status",
            executed_action_key: "workspace_os.status",
            observed_artifact_refs: ["workspace_os_status_observation:1"],
          },
        ],
        executed_tool_call_count: 1,
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:workspace-os-status:final_answer_draft",
        support_refs: ["workspace_os_status_observation:1"],
      },
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "model_synthesized_answer",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "workspace_os_status_observation:1",
          kind: "workspace_os_status_observation",
          payload: {
            schema: "helix.workspace_os_status_observation.v1",
            available_count: 18,
            blocked_count: 3,
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:workspace-os-status", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:workspace-os-status", payload });

    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      requested_capability: "workspace_os.status",
      selected_capability: "workspace_os.status",
      admitted_capability: "workspace_os.status",
      executed_capability: "workspace_os.status",
      observation_kind: "workspace_os_status_observation",
      observation_ref: "workspace_os_status_observation:1",
      reentry_status: "reentered",
      required_terminal_kind: "model_synthesized_answer",
      selected_terminal_kind: "model_synthesized_answer",
      visible_terminal_kind: "model_synthesized_answer",
      first_broken_rail: null,
      codex_parity_class: "complete",
      rail_status: "complete",
      rail_failure_code: null,
    });
  });

  it("normalizes a completed live-source mail read through the same rail table", () => {
    const payload: Record<string, unknown> = {
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "live_source_mailbox_review",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:live-mail-read",
        capability_family: "live_environment",
        requested_action: "live_env.read_processed_live_source_mail",
        selected_capability: "live_env.read_processed_live_source_mail",
        admission_status: "admitted",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            chosen_capability: "live_env.read_processed_live_source_mail",
            executed_action_key: "live_env.read_processed_live_source_mail",
            observed_artifact_refs: ["stage_play_processed_mail_packet:1"],
          },
        ],
        executed_tool_call_count: 1,
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:live-mail-read:final_answer_draft",
        support_refs: ["stage_play_processed_mail_packet:1"],
      },
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "model_synthesized_answer",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "stage_play_processed_mail_packet:1",
          kind: "stage_play_processed_mail_packet",
          producer_item_id: "live_env.read_processed_live_source_mail",
          payload: {
            schema: "stage_play_processed_mail_packet/v1",
            tool_name: "live_env.read_processed_live_source_mail",
            packet_id: "stage_play_processed_mail_packet:1",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:live-mail-read", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:live-mail-read", payload });

    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      selected_capability: "live_env.read_processed_live_source_mail",
      admitted_capability: "live_env.read_processed_live_source_mail",
      executed_capability: "live_env.read_processed_live_source_mail",
      observation_kind: "stage_play_processed_mail_packet",
      observation_ref: "stage_play_processed_mail_packet:1",
      reentry_status: "reentered",
      selected_terminal_kind: "model_synthesized_answer",
      visible_terminal_kind: "model_synthesized_answer",
      first_broken_rail: null,
      codex_parity_class: "complete",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(index.tool_turn_chain_family_matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route_family: "live_env",
          observed: true,
          did_tool_run: true,
          artifact_produced: true,
          rail_status: "complete",
        }),
      ]),
    );
  });

  it("normalizes workstation goal-context query artifacts as live-env capability evidence", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "Inspect workstation goal context updates for the visual source.",
      tool_surface_packet: {
        schema: "helix.tool_surface_packet.v1",
        tools: [{ name: "live_env.query_workstation_goal_context" }],
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "live_env.query_workstation_goal_context",
        admitted_capability: "live_env.query_workstation_goal_context",
        decision: "admitted",
      },
      agent_step_decision: {
        next_step: "call_tool",
        chosen_capability: "live_env.query_workstation_goal_context",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            chosen_capability: "live_env.query_workstation_goal_context",
            executed_action_key: "live_env.query_workstation_goal_context",
            observed_artifact_refs: ["stage_play_workstation_goal_context_read_result:1"],
          },
        ],
        executed_tool_call_count: 1,
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:goal-context:final_answer_draft",
        support_refs: ["stage_play_workstation_goal_context_read_result:1"],
      },
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "model_synthesized_answer",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "stage_play_workstation_goal_context_read_result:1",
          kind: "stage_play_workstation_goal_context_read_result",
          producer_item_id: "live_env.query_workstation_goal_context",
          payload: {
            schema: "stage_play_workstation_goal_context_read_result/v1",
            tool_name: "live_env.query_workstation_goal_context",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:goal-context", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:goal-context", payload });

    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      selected_capability: "live_env.query_workstation_goal_context",
      admitted_capability: "live_env.query_workstation_goal_context",
      executed_capability: "live_env.query_workstation_goal_context",
      observation_kind: "stage_play_workstation_goal_context_read_result",
      observation_ref: "stage_play_workstation_goal_context_read_result:1",
      reentry_status: "reentered",
      selected_terminal_kind: "model_synthesized_answer",
      first_broken_rail: null,
      rail_status: "complete",
      rail_failure_code: null,
    });
  });

  it("maps source health goal-context artifacts to the source health query tool", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "Query source health before deciding what the workstation can monitor.",
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "live_env.query_source_health",
        requested_capability_family: "live_source_mail",
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "helix.situation_source_capability_read:1",
          kind: "helix.situation_source_capability_read",
          producer_item_id: "live_env.query_source_health",
          payload: {
            schema: "helix.situation_source_capability_read.v1",
            tool_name: "live_env.query_source_health",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
        {
          artifact_id: "stage_play_goal_context_update:source-health",
          kind: "helix.workstation_goal_context_update.v1",
          producer_item_id: "live_env.query_source_health",
          payload: {
            schema: "helix.workstation_goal_context_update.v1",
            tool_name: "live_env.query_source_health",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId: "ask:test:source-health", payload });

    expect(index).toMatchObject({
      capability: "live_env.query_source_health",
      tool_family: "live_environment",
      tool_family_contract: {
        tool_name: "live_env.query_source_health",
        authority: "evidence_only",
        required_observation_kinds: expect.arrayContaining([
          "helix.situation_source_capability_read",
          "helix.workstation_goal_context_update.v1",
        ]),
      },
      missing_required_observation_kinds: [],
    });
  });

  it("maps trace-memory goal-context artifacts to the trace memory query tool", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "Query trace memory for the last workstation reasoning trace.",
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "live_env.query_trace_memory",
        requested_capability_family: "live_source_mail",
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "helix.workstation_reasoning_trace_query_result:1",
          kind: "helix.workstation_reasoning_trace_query_result",
          producer_item_id: "live_env.query_trace_memory",
          payload: {
            schema: "helix.workstation_reasoning_trace_query_result.v1",
            tool_name: "live_env.query_trace_memory",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
        {
          artifact_id: "stage_play_goal_context_update:trace-memory",
          kind: "helix.workstation_goal_context_update.v1",
          producer_item_id: "live_env.query_trace_memory",
          payload: {
            schema: "helix.workstation_goal_context_update.v1",
            tool_name: "live_env.query_trace_memory",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId: "ask:test:trace-memory", payload });

    expect(index).toMatchObject({
      capability: "live_env.query_trace_memory",
      tool_family: "live_environment",
      tool_family_contract: {
        tool_name: "live_env.query_trace_memory",
        authority: "evidence_only",
        required_observation_kinds: expect.arrayContaining([
          "helix.workstation_reasoning_trace_query_result",
          "helix.workstation_goal_context_update.v1",
        ]),
      },
      missing_required_observation_kinds: [],
    });
  });

  it("maps feed-specific goal-context artifacts to the selected workstation feed query tool", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "Query translation segments for the active audio live source.",
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "live_env.query_translation_segments",
        requested_capability_family: "live_source_mail",
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "stage_play_workstation_context_feed_query_result:translation",
          kind: "stage_play_workstation_context_feed_query_result",
          producer_item_id: "live_env.query_translation_segments",
          payload: {
            schema: "stage_play_workstation_context_feed_query_result/v1",
            tool_name: "live_env.query_translation_segments",
            feed_kind: "translated_transcripts",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
        {
          artifact_id: "stage_play_goal_context_update:translation-feed",
          kind: "helix.workstation_goal_context_update.v1",
          producer_item_id: "live_env.query_translation_segments",
          payload: {
            schema: "helix.workstation_goal_context_update.v1",
            tool_name: "live_env.query_translation_segments",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId: "ask:test:translation-feed", payload });

    expect(index).toMatchObject({
      capability: "live_env.query_translation_segments",
      tool_family: "live_environment",
      tool_family_contract: {
        tool_name: "live_env.query_translation_segments",
        authority: "evidence_only",
        required_observation_kinds: expect.arrayContaining([
          "stage_play_workstation_context_feed_query_result",
          "helix.workstation_goal_context_update.v1",
        ]),
      },
      missing_required_observation_kinds: [],
    });
  });

  it("maps route-evidence feed artifacts to the route-evidence query tool", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "Show route-watch evidence for the active workstation goal.",
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "live_env.query_route_evidence",
        requested_capability_family: "live_source_mail",
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "stage_play_workstation_context_feed_query_result:route-evidence",
          kind: "stage_play_workstation_context_feed_query_result",
          producer_item_id: "live_env.query_route_evidence",
          payload: {
            schema: "stage_play_workstation_context_feed_query_result/v1",
            tool_name: "live_env.query_route_evidence",
            feed_kind: "route_evidence",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
        {
          artifact_id: "stage_play_goal_context_update:route-evidence-feed",
          kind: "helix.workstation_goal_context_update.v1",
          producer_item_id: "live_env.query_route_evidence",
          payload: {
            schema: "helix.workstation_goal_context_update.v1",
            tool_name: "live_env.query_route_evidence",
            producer_kind: "route_watch",
            update_kind: "route_evidence",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
        {
          artifact_id: "stage_play_goal_context_update:automation-policy",
          kind: "helix.workstation_goal_context_update.v1",
          producer_item_id: "live_env.query_route_evidence",
          payload: {
            schema: "helix.workstation_goal_context_update.v1",
            tool_name: "live_env.query_route_evidence",
            producer_kind: "automation",
            update_kind: "automation_status",
            source_kind: "automation_policies",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId: "ask:test:route-evidence-feed", payload });

    expect(index).toMatchObject({
      capability: "live_env.query_route_evidence",
      tool_family: "live_environment",
      tool_family_contract: {
        tool_name: "live_env.query_route_evidence",
        authority: "evidence_only",
        required_observation_kinds: expect.arrayContaining([
          "stage_play_workstation_context_feed_query_result",
          "helix.workstation_goal_context_update.v1",
        ]),
      },
      missing_required_observation_kinds: [],
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(index.queryable_artifact_keys).toEqual(expect.arrayContaining([
      "route_evidence",
      "stage_play_workstation_context_feed_query_result:route-evidence",
      "stage_play_goal_context_update:route-evidence-feed",
      "stage_play_goal_context_update:automation-policy",
    ]));
  });

  it("infers canonical generic context-feed query capabilities from feed-kind artifacts", () => {
    for (const spec of genericContextFeedQuerySpecs) {
      const payload: Record<string, unknown> = {
        current_turn_artifact_ledger: [
          {
            artifact_id: `stage_play_workstation_context_feed_query_result:${spec.feedKind}`,
            kind: "stage_play_workstation_context_feed_query_result",
            payload: {
              schema: "stage_play_workstation_context_feed_query_result/v1",
              feed_kind: spec.feedKind,
              required_actuator: spec.actuator,
              assistant_answer: false,
              raw_content_included: false,
              terminal_eligible: false,
            },
          },
          {
            artifact_id: `stage_play_goal_context_update:${spec.feedKind}`,
            kind: "helix.workstation_goal_context_update.v1",
            payload: {
              schema: "helix.workstation_goal_context_update.v1",
              source_kind: spec.feedKind,
              assistant_answer: false,
              raw_content_included: false,
              terminal_eligible: false,
            },
          },
        ],
      };

      const index = buildArtifactQueryIndex({ turnId: `ask:test:${spec.feedKind}`, payload });

      expect(index).toMatchObject({
        capability: spec.capability,
        tool_family: "live_environment",
        tool_family_contract: {
          tool_name: spec.capability,
          authority: "evidence_only",
          required_observation_kinds: expect.arrayContaining(spec.toolFamilyRequiredObservationKinds),
        },
        missing_required_observation_kinds: [],
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      });
    }
  });

  it("maps workstation control receipt artifacts to the governed control tool", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "Apply the frog classifier preset to the active visual source.",
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "live_env.change_workstation_preset",
        requested_capability_family: "live_source_mail",
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "stage_play_workstation_control_receipt:change_preset:1",
          kind: "stage_play_workstation_control_receipt",
          producer_item_id: "live_env.change_workstation_preset",
          payload: {
            schema: "stage_play_workstation_control_receipt/v1",
            tool_name: "live_env.change_workstation_preset",
            control_kind: "change_preset",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
        {
          artifact_id: "stage_play_goal_context_update:workstation-control",
          kind: "helix.workstation_goal_context_update.v1",
          producer_item_id: "live_env.change_workstation_preset",
          payload: {
            schema: "helix.workstation_goal_context_update.v1",
            tool_name: "live_env.change_workstation_preset",
            update_kind: "suggested_action",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId: "ask:test:workstation-control", payload });

    expect(index).toMatchObject({
      capability: "live_env.change_workstation_preset",
      tool_family: "live_environment",
      tool_family_contract: {
        tool_name: "live_env.change_workstation_preset",
        authority: "control_receipt",
        required_observation_kinds: expect.arrayContaining([
          "stage_play_workstation_control_receipt",
          "helix.workstation_goal_context_update.v1",
        ]),
      },
      missing_required_observation_kinds: [],
    });
  });

  it("infers exact workstation control capabilities from sparse receipt actuator fields", () => {
    const cases = [
      {
        requiredActuator: "set_visual_preset",
        controlKind: "change_preset",
        capability: "live_env.set_visual_preset",
        prompt: "Apply the frog classifier shade to the active visual source.",
      },
      {
        requiredActuator: "set_audio_preset",
        controlKind: "change_preset",
        capability: "live_env.set_audio_preset",
        prompt: "Apply the translation preset to the active audio source.",
      },
      {
        requiredActuator: "focus_process_graph",
        controlKind: "focus_process_graph",
        capability: "live_env.focus_process_graph",
        prompt: "Focus the process graph on the visual packet trace.",
      },
      {
        requiredActuator: "repair_loop",
        controlKind: "repair_loop",
        capability: "live_env.repair_loop",
        prompt: "Repair the deterministic visual capture loop.",
      },
    ] as const;

    for (const testCase of cases) {
      const payload: Record<string, unknown> = {
        active_prompt: testCase.prompt,
        current_turn_artifact_ledger: [
          {
            artifact_id: `stage_play_workstation_control_receipt:${testCase.requiredActuator}:1`,
            kind: "stage_play_workstation_control_receipt",
            payload: {
              schema: "stage_play_workstation_control_receipt/v1",
              requiredActuator: testCase.requiredActuator,
              controlKind: testCase.controlKind,
              assistant_answer: false,
              raw_content_included: false,
              terminal_eligible: false,
            },
          },
          {
            artifact_id: `stage_play_goal_context_update:${testCase.requiredActuator}:1`,
            kind: "helix.workstation_goal_context_update.v1",
            payload: {
              schema: "helix.workstation_goal_context_update.v1",
              update_kind: "suggested_action",
              evidenceRefs: [`stage_play_workstation_control_receipt:${testCase.requiredActuator}:1`],
              assistant_answer: false,
              raw_content_included: false,
              terminal_eligible: false,
            },
          },
        ],
      };

      const index = buildArtifactQueryIndex({ turnId: `ask:test:${testCase.requiredActuator}`, payload });

      expect(index).toMatchObject({
        capability: testCase.capability,
        tool_family: "live_environment",
        tool_family_contract: {
          tool_name: testCase.capability,
          authority: "control_receipt",
          required_observation_kinds: expect.arrayContaining([
            "stage_play_workstation_control_receipt",
            "helix.workstation_goal_context_update.v1",
          ]),
        },
        missing_required_observation_kinds: [],
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      });
      expect(index.queryable_artifact_keys).toEqual(expect.arrayContaining([
        testCase.requiredActuator,
        testCase.controlKind,
      ]));
    }
  });

  it("maps narrator request artifacts to governed non-terminal voice delivery tools", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "Run live_env.narrator_bind_stream for the translated transcript.",
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "live_env.narrator_bind_stream",
        requested_capability_family: "voice_delivery",
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "helix_narrator_bind_stream_request:translated:1",
          kind: "helix.narrator_bind_stream_request.v1",
          producer_item_id: "live_env.narrator_bind_stream",
          payload: {
            schema: "helix.narrator_bind_stream_request.v1",
            schemaVersion: "helix.narrator_bind_stream_request.v1",
            tool_name: "live_env.narrator_bind_stream",
            sourceRef: "source:browser-audio",
            streamKind: "translated_transcript",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
        {
          artifact_id: "stage_play_goal_context_update:narrator-bind",
          kind: "helix.workstation_goal_context_update.v1",
          producer_item_id: "live_env.narrator_bind_stream",
          payload: {
            schema: "helix.workstation_goal_context_update.v1",
            tool_name: "live_env.narrator_bind_stream",
            producer_kind: "narrator",
            update_kind: "suggested_action",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId: "ask:test:narrator-bind", payload });

    expect(index).toMatchObject({
      capability: "live_env.narrator_bind_stream",
      tool_family: "live_environment",
      tool_family_contract: {
        tool_name: "live_env.narrator_bind_stream",
        authority: "control_receipt",
        required_observation_kinds: expect.arrayContaining([
          "helix.narrator_bind_stream_request.v1",
          "helix.workstation_goal_context_update.v1",
        ]),
      },
      missing_required_observation_kinds: [],
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("keeps artifact-query entries non-terminal even when receipts or projections carry payload authority flags", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "Inspect the Live Answer projection and narrator receipt as circuit evidence.",
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "live_env.query_live_answer_state",
        requested_capability_family: "live_source_mail",
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "live_answer_projection:unsafe-terminal",
          kind: "live_answer_projection",
          producer_item_id: "live_env.query_live_answer_state",
          payload: {
            schema: "stage_play_live_answer_projection/v1",
            tool_name: "live_env.query_live_answer_state",
            assistant_answer: true,
            raw_content_included: true,
            terminal_eligible: true,
          },
        },
        {
          artifact_id: "helix_narrator_bind_stream_request:unsafe-terminal",
          kind: "helix.narrator_bind_stream_request.v1",
          producer_item_id: "live_env.narrator_bind_stream",
          payload: {
            schema: "helix.narrator_bind_stream_request.v1",
            tool_name: "live_env.narrator_bind_stream",
            assistant_answer: true,
            raw_content_included: true,
            terminal_eligible: true,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId: "ask:test:artifact-index-non-terminal", payload });

    expect(index).toMatchObject({
      schema: "helix.artifact_query_index.v1",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(index.artifact_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ref: "live_answer_projection:unsafe-terminal",
        artifact_query_role: "observation_index_entry",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        payload_authority_flags: {
          assistant_answer: true,
          terminal_eligible: true,
          raw_content_included: true,
        },
      }),
      expect.objectContaining({
        ref: "helix_narrator_bind_stream_request:unsafe-terminal",
        artifact_query_role: "observation_index_entry",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        payload_authority_flags: {
          assistant_answer: true,
          terminal_eligible: true,
          raw_content_included: true,
        },
      }),
    ]));
  });

  it("indexes nested frontier literature maps as non-terminal theory-locator evidence", () => {
    const turnId = "ask:test:frontier-literature-map-index";
    const literatureMapId = "theory_frontier_literature_map:frontier-seed-alpha";
    const payload: Record<string, unknown> = {
      active_prompt: "Map scholarly evidence onto the theory frontier seed finder without promoting the claim.",
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: turnId,
        capability_family: "theory_locator",
        requested_capability: "helix_ask.reflect_theory_context",
        requested_action: "helix_ask.reflect_theory_context",
        admission_status: "admitted",
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "helix_ask.reflect_theory_context",
        requested_capability_family: "theory_locator",
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:receipt`,
          kind: "helix_theory_context_reflection_tool_receipt",
          producer_item_id: "agent_runtime_theory_locator_tool",
          source_scope: "current_turn",
          payload: {
            kind: "helix_theory_context_reflection_tool_receipt",
            schema: "helix_theory_context_reflection_tool_receipt/v1",
            tool_id: "helix_ask.reflect_theory_context",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
        {
          artifact_id: `${turnId}:reflection`,
          kind: "theory_context_reflection",
          producer_item_id: "agent_runtime_theory_locator_tool",
          source_scope: "current_turn",
          payload: {
            kind: "theory_context_reflection",
            schema: "theory_context_reflection/v1",
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
        {
          artifact_id: "frontier_search:alpha",
          kind: "theory_frontier_search",
          producer_item_id: "agent_runtime_theory_locator_tool",
          source_scope: "current_turn",
          payload: {
            kind: "theory_frontier_search",
            artifact_v1: {
              artifactId: "theory_frontier_search",
              schemaVersion: "theory_frontier_search/v1",
              searchId: "frontier_search:alpha",
              graphHash: "graph-hash-alpha",
              graphId: "helix-theory-badge-graph",
              query: "scale envelope congruence",
              searchSeed: "frontier-seed-alpha",
              taxonomyVersion: "taxonomy/v1",
              scoringVersion: "frontier-scoring/v1",
              verifierVersion: "theory_frontier_exact_contract/v1",
              scholarlyLookupRequests: [
                {
                  requestId: "scholarly_lookup:scale-envelope",
                  candidateId: "candidate:scale-envelope:chunk-a",
                  targetSource: "scholarly_research",
                  requestedOutputs: ["scholarly_paper_refs", "doi_metadata", "scholarly_full_text", "paper_pdf_pages"],
                  query: "Scale envelope congruence badge:scale badge:congruence",
                  badgeIds: ["badge:scale", "badge:congruence"],
                  renderChunkIds: ["render:scale"],
                  semanticChunkIds: ["semantic:congruence"],
                  reason: "High-value unresolved frontier candidate requires scholarly references as bounded evidence only.",
                  mutating: false,
                  noAutoPromoteLiterature: true,
                },
              ],
            },
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
        {
          artifact_id: "candidate:scale-envelope:chunk-a",
          kind: "theory_frontier_candidate",
          producer_item_id: "agent_runtime_theory_locator_tool",
          source_scope: "current_turn",
          payload: {
            kind: "theory_frontier_candidate",
            artifact_v1: {
              artifactId: "theory_frontier_candidate",
              schemaVersion: "theory_frontier_candidate/v1",
              candidateId: "candidate:scale-envelope:chunk-a",
              frontierKind: "candidate_connection",
              status: "exact_verification_pending",
              title: "Scale envelope congruence",
              badgeIds: ["badge:scale", "badge:congruence"],
              replay: {
                graphHash: "graph-hash-alpha",
                graphId: "helix-theory-badge-graph",
                query: "scale envelope congruence",
                searchSeed: "frontier-seed-alpha",
                taxonomyVersion: "taxonomy/v1",
                scoringVersion: "frontier-scoring/v1",
                evidenceReferenceIds: ["paper:10.0000/example"],
              },
            },
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
        {
          artifact_id: "candidate:scale-envelope:chunk-a:exact_contract_verification",
          kind: "theory_frontier_exact_contract_verification",
          producer_item_id: "agent_runtime_theory_locator_tool",
          source_scope: "current_turn",
          payload: {
            kind: "theory_frontier_exact_contract_verification",
            schema: "theory_frontier_exact_contract_verification/v1",
            artifact_v1: {
              artifactId: "theory_frontier_exact_contract_verification",
              schemaVersion: "theory_frontier_exact_contract_verification/v1",
              verifierVersion: "theory_frontier_exact_contract/v1",
              candidateId: "candidate:scale-envelope:chunk-a",
              exactContractSatisfied: false,
              promotionAllowed: false,
              validatesTheory: false,
              solvesPhysicalMechanism: false,
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
              issues: ["missing required observables"],
              checkedRequirements: {
                validCandidateContract: true,
                completeFirstPrinciplesPath: false,
                dimensionalChecks: true,
                equationAndVariableMappings: true,
                requiredObservables: false,
                uncertaintyBudget: true,
                falsificationChecks: true,
                evidenceProvenance: true,
                activeClaimBoundaries: true,
                nonTerminalBoundary: true,
              },
            },
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
        {
          artifact_id: literatureMapId,
          kind: "theory_frontier_literature_map",
          producer_item_id: "agent_runtime_theory_locator_tool",
          source_scope: "current_turn",
          payload: {
            kind: "theory_frontier_literature_map",
            status: "completed",
            parent_receipt_id: `${turnId}:receipt`,
            artifact_v1: {
              artifactId: "theory_frontier_literature_map",
              schemaVersion: "theory_frontier_literature_map/v1",
              mapId: literatureMapId,
              frontierCandidateIds: ["candidate:scale-envelope:chunk-a"],
              replay: {
                graphHash: "graph-hash-alpha",
                graphId: "helix-theory-badge-graph",
                query: "scale envelope congruence",
                searchSeed: "frontier-seed-alpha",
                taxonomyVersion: "taxonomy/v1",
                scoringVersion: "frontier-scoring/v1",
                literatureMapVersion: "theory_frontier_literature_map/v1",
                evidenceReferenceIds: ["paper:10.0000/example"],
              },
              sources: [
                {
                  sourceId: "scholarly:paper-alpha",
                  title: "Example frontier paper",
                  authors: ["Researcher"],
                  retrieval: {
                    targetSource: "scholarly_research",
                    requestedOutputs: ["scholarly_paper_refs"],
                    fullTextRetrieved: false,
                    fullTextDigest: null,
                  },
                },
              ],
              authority: {
                assistant_answer: false,
                terminal_eligible: false,
                validatesTheory: false,
                solvesPhysicalMechanism: false,
                promotionAllowed: false,
                noAutoPromoteLiterature: true,
              },
            },
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId, payload });

    expect(index).toMatchObject({
      schema: "helix.artifact_query_index.v1",
      capability: "helix_ask.reflect_theory_context",
      tool_family: "theory_locator",
      missing_required_observation_kinds: [],
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(index.queryable_artifact_keys).toEqual(expect.arrayContaining([
      literatureMapId,
      "theory_frontier_literature_map",
      "theory_frontier_literature_map/v1",
      "frontier_search:alpha",
      "theory_frontier_search",
      "theory_frontier_search/v1",
      "theory_frontier_candidate",
      "theory_frontier_candidate/v1",
      "theory_frontier_exact_contract_verification",
      "theory_frontier_exact_contract_verification/v1",
      "candidate:scale-envelope:chunk-a",
      "exact_verification_pending",
      "Scale envelope congruence",
      "badge:scale",
      "badge:congruence",
      "graph-hash-alpha",
      "helix-theory-badge-graph",
      "scale envelope congruence",
      "frontier-seed-alpha",
      "taxonomy/v1",
      "frontier-scoring/v1",
      "theory_frontier_exact_contract/v1",
      "scholarly_lookup:scale-envelope",
      "scholarly_research",
      "scholarly_paper_refs",
      "doi_metadata",
      "scholarly_full_text",
      "paper_pdf_pages",
      "Scale envelope congruence badge:scale badge:congruence",
      "render:scale",
      "semantic:congruence",
      "paper:10.0000/example",
      "scholarly:paper-alpha",
    ]));
    expect(index.artifact_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ref: "frontier_search:alpha",
        kind: "theory_frontier_search",
        nested_artifact_id: "theory_frontier_search",
        nested_schema_version: "theory_frontier_search/v1",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        ref: "candidate:scale-envelope:chunk-a",
        kind: "theory_frontier_candidate",
        nested_artifact_id: "theory_frontier_candidate",
        nested_schema_version: "theory_frontier_candidate/v1",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        ref: "candidate:scale-envelope:chunk-a:exact_contract_verification",
        kind: "theory_frontier_exact_contract_verification",
        nested_artifact_id: "theory_frontier_exact_contract_verification",
        nested_schema_version: "theory_frontier_exact_contract_verification/v1",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        ref: literatureMapId,
        kind: "theory_frontier_literature_map",
        nested_artifact_id: "theory_frontier_literature_map",
        nested_schema_version: "theory_frontier_literature_map/v1",
        artifact_query_role: "observation_index_entry",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        payload_authority_flags: {
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      }),
    ]));
  });

  it("exposes compound subgoal rail status in the artifact query index", () => {
    const turnId = "ask:test:compound-debug-index";
    const compoundContract = {
      schema: "helix.compound_capability_contract.v1",
      turn_id: turnId,
      prompt_shape: "compound_capability",
      requires_all_subgoals: true,
      terminal_policy: "synthesize_from_satisfied_subgoal_observations",
      subgoals: [
        {
          subgoal_id: `${turnId}:compound_capability_subgoal:1:workspace_os_status`,
          order: 1,
          requested_capability: "workspace_os.status",
          runtime_capability: "workspace_os.status",
          required_observation_kinds: ["workspace_os_status_observation"],
        },
        {
          subgoal_id: `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`,
          order: 2,
          requested_capability: "scientific-calculator.solve_expression",
          runtime_capability: "scientific-calculator.solve_expression",
          required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
        },
      ],
      assistant_answer: false,
      raw_content_included: false,
    };
    const executionState = {
      schema: "helix.capability_itinerary_execution_state.v1",
      applies: true,
      complete: false,
      compound_subgoal_ledger: [
        {
          subgoal_id: `${turnId}:compound_capability_subgoal:1:workspace_os_status`,
          order: 1,
          requested_capability: "workspace_os.status",
          runtime_capability: "workspace_os.status",
          selected_capability: "workspace_os.status",
          executed_capability: "workspace_os.status",
          args: {},
          planned_args: {},
          selected_args: {},
          required_args: [],
          optional_args: [],
          observation_kind: "workspace_os_status_observation",
          observation_ref: `${turnId}:workspace_status`,
          support_refs: [`${turnId}:workspace_status`],
          input_bindings: [],
          bound_input_refs: [],
          unresolved_input_bindings: [],
          forbidden_nearby_capabilities: ["debug.inspect_current_turn", "model.direct_answer"],
          satisfaction: "satisfied",
          rail_status: "complete",
          rail_failure_code: null,
        },
        {
          subgoal_id: `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`,
          order: 2,
          requested_capability: "scientific-calculator.solve_expression",
          runtime_capability: "scientific-calculator.solve_expression",
          selected_capability: "scientific-calculator.solve_expression",
          executed_capability: "scientific-calculator.solve_expression",
          args: { latex: "2+2", expression: "2+2" },
          planned_args: { latex: "2+2", expression: "2+2" },
          selected_args: { latex: "2+2", expression: "2+2" },
          required_args: ["latex"],
          optional_args: ["expression", "equation"],
          input_bindings: [],
          observation_kind: null,
          observation_ref: null,
          support_refs: [],
          bound_input_refs: [],
          unresolved_input_bindings: [],
          forbidden_nearby_capabilities: ["repo-code.search_concept", "model.direct_answer"],
          satisfaction: "pending",
          rail_status: "pending",
          rail_failure_code: "subgoal_observation_missing",
        },
      ],
      assistant_answer: false,
      raw_content_included: false,
    };
    const payload: Record<string, unknown> = {
      active_prompt:
        "Use workspace_os.status, then call scientific-calculator.solve_expression with this exact expression: 2+2.",
      compound_capability_contract: compoundContract,
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        compound_capability_contract: compoundContract,
        execution_state: executionState,
      },
      capability_itinerary_execution_state: executionState,
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:workspace_status`,
          kind: "workspace_os_status_observation",
          payload: {
            schema: "helix.workspace_os_status_observation.v1",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId, payload });

    expect(index.compound_capability_contract).toBe(compoundContract);
    expect(index.capability_itinerary_execution_state).toBe(executionState);
    expect(index.compound_subgoal_ledger).toEqual(executionState.compound_subgoal_ledger);
    expect(index.compound_subgoal_rail_statuses).toEqual([
      expect.objectContaining({
        requested_capability: "workspace_os.status",
        runtime_capability: "workspace_os.status",
        executed_capability: "workspace_os.status",
        args: {},
        planned_args: {},
        selected_args: {},
        required_args: [],
        optional_args: [],
        observation_kind: "workspace_os_status_observation",
        observation_ref: `${turnId}:workspace_status`,
        support_refs: [`${turnId}:workspace_status`],
        input_bindings: [],
        bound_input_refs: [],
        unresolved_input_bindings: [],
        contribution_role: "evidence",
        terminal_contribution_kind: "model_synthesized_answer",
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        requested_capability: "scientific-calculator.solve_expression",
        runtime_capability: "scientific-calculator.solve_expression",
        selected_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: { latex: "2+2", expression: "2+2" },
        planned_args: { latex: "2+2", expression: "2+2" },
        selected_args: { latex: "2+2", expression: "2+2" },
        required_args: ["latex"],
        optional_args: ["expression", "equation"],
        observation_kind: null,
        observation_ref: null,
        support_refs: [],
        input_bindings: [],
        bound_input_refs: [],
        unresolved_input_bindings: [],
        contribution_role: "terminal_component",
        terminal_contribution_kind: "workstation_tool_evaluation",
        satisfaction: "pending",
        rail_status: "pending",
        rail_failure_code: "subgoal_observation_missing",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
    ]);
    expect(index.tool_turn_chain_family_matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route_family: "workspace_diagnostic",
          observed: true,
          requested_capability: "workspace_os.status",
          did_tool_run: true,
          artifact_produced: true,
          artifact_reentered: true,
          rail_status: "complete",
          compound_subgoal_count: 1,
          compound_requested_capabilities: ["workspace_os.status"],
          compound_executed_capabilities: ["workspace_os.status"],
          compound_observation_refs: [`${turnId}:workspace_status`],
          compound_required_terminal_kinds: ["model_synthesized_answer"],
          compound_terminal_contribution_kinds: ["model_synthesized_answer"],
          compound_contribution_roles: ["evidence"],
          compound_forbidden_nearby_capabilities: ["debug.inspect_current_turn", "model.direct_answer"],
          compound_rail_statuses: ["complete"],
          compound_rail_failure_codes: [null],
        }),
        expect.objectContaining({
          route_family: "calculator",
          observed: true,
          requested_capability: "scientific-calculator.solve_expression",
          did_tool_run: true,
          artifact_produced: false,
          artifact_reentered: false,
          rail_status: "pending",
          rail_failure_code: "subgoal_observation_missing",
          compound_subgoal_count: 1,
          compound_requested_capabilities: ["scientific-calculator.solve_expression"],
          compound_executed_capabilities: ["scientific-calculator.solve_expression"],
          compound_observation_refs: [],
          compound_required_terminal_kinds: ["workstation_tool_evaluation"],
          compound_terminal_contribution_kinds: ["workstation_tool_evaluation"],
          compound_contribution_roles: ["terminal_component"],
          compound_forbidden_nearby_capabilities: ["repo-code.search_concept", "model.direct_answer"],
          compound_rail_statuses: ["pending"],
          compound_rail_failure_codes: ["subgoal_observation_missing"],
        }),
      ]),
    );
  });

  it("canonicalizes final typed-failure subgoal rails without erasing their pending history", () => {
    const turnId = "ask:test:compound-final-fail-closed";
    const observationRef = `${turnId}:visual-observation`;
    const subgoalId = `${turnId}:compound_capability_subgoal:1:image_lens_inspect`;
    const compoundContract = {
      schema: "helix.compound_capability_contract.v1",
      turn_id: turnId,
      subgoals: [
        {
          subgoal_id: subgoalId,
          order: 1,
          requested_capability: "image_lens.inspect",
          runtime_capability: "situation-room.describe_visual_capture",
          required_observation_kinds: ["visual_frame_evidence"],
          required_terminal_kind: "situation_context_pack",
          allowed_substitutions: ["situation-room.describe_visual_capture"],
          mandatory: true,
        },
      ],
    };
    const pendingSubgoal = {
      subgoal_id: subgoalId,
      order: 1,
      requested_capability: "image_lens.inspect",
      runtime_capability: "situation-room.describe_visual_capture",
      selected_capability: null,
      executed_capability: null,
      args: {},
      required_observation_kinds: ["visual_frame_evidence"],
      required_terminal_kind: "situation_context_pack",
      allowed_substitutions: ["situation-room.describe_visual_capture"],
      observation_kind: "provider_gateway_observation_packet",
      observation_ref: observationRef,
      observation_provenance: "capability_key",
      support_refs: [observationRef],
      satisfaction: "pending",
      rail_status: "pending",
      first_broken_rail: "observation_artifact",
      rail_failure_code: "subgoal_observation_missing",
      repair_target: "observation_materializer",
    };
    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "solver_continuation_pending",
        terminal_answer_authority: {
          selected_terminal_artifact_kind: "typed_failure",
        },
        terminal_presentation: { terminal_artifact_kind: "typed_failure" },
        compound_capability_contract: compoundContract,
        capability_itinerary_execution_state: {
          applies: true,
          complete: false,
          compound_subgoal_ledger: [pendingSubgoal],
        },
        tool_lifecycle_trace: {
          requested_capability: "situation-room.describe_visual_capture",
          admitted_capability: "situation-room.describe_visual_capture",
          executed_capability: "situation-room.describe_visual_capture",
          lifecycle_stage: "failed",
          observation_refs: [observationRef],
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: observationRef,
            kind: "provider_gateway_observation_packet",
            capability_key: "situation-room.describe_visual_capture",
            payload: { assistant_answer: false, raw_content_included: false },
          },
        ],
      },
    });

    expect(index.compound_subgoal_rail_statuses).toEqual([
      expect.objectContaining({
        subgoal_id: subgoalId,
        selected_capability: "situation-room.describe_visual_capture",
        executed_capability: "situation-room.describe_visual_capture",
        observation_ref: observationRef,
        satisfaction: "not_satisfied",
        rail_status: "fail_closed",
        rail_failure_code: "required_observation_missing",
      }),
    ]);
    expect(index.final_tool_turn_chain_audit).toMatchObject({
      rail_status: "fail_closed",
      compound_rail_failure_code: "required_observation_missing",
    });
    expect(index.historical_rail_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subgoal_id: subgoalId,
          rail_status: "pending",
          rail_failure_code: "subgoal_observation_missing",
          snapshot_role: "historical_intermediate",
        }),
      ]),
    );
  });

  it("projects an authoritative source-observation typed failure as fail closed", () => {
    const turnId = "ask:test:procedure-epoch-source-failure";
    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        terminal_error_code: "procedure_epoch_previous_unavailable",
        typed_failure: {
          error_code: "procedure_epoch_previous_unavailable",
          missing_evidence: ["previous_observation_missing"],
          next_required_action: "wait_for_scene_memory_index",
        },
        canonical_goal_frame: {
          authoritative_source_observation_typed_failure: true,
        },
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          source_target: "procedure_memory",
          allowed_terminal_artifact_kinds: [
            "procedure_epoch_replay",
            "typed_failure",
          ],
          forbidden_terminal_artifact_kinds: [],
        },
        route_authority_audit: { route_authority_ok: true },
        tool_call_admission_decision: {
          requested_capability: "procedure_memory",
          selected_capability: "procedure_memory",
          required_observation_kinds_for_requested_capability: [
            "previous_visual_observation",
          ],
        },
        capability_plan: {
          requested_capability: "procedure_memory",
          selected_capability: "procedure_memory",
        },
        terminal_answer_authority: {
          selected_terminal_artifact_kind: "typed_failure",
        },
        terminal_presentation: { terminal_artifact_kind: "typed_failure" },
        current_turn_artifact_ledger: [
          {
            artifact_id: `${turnId}:source-observation`,
            kind: "source_observation",
            payload: { status: "observed" },
          },
        ],
      },
    });

    expect(index.final_tool_turn_chain_audit).toMatchObject({
      requested_capability: "procedure_memory",
      selected_capability: "procedure_memory",
      rail_status: "fail_closed",
      rail_failure_code: "required_observation_missing",
    });
    expect(index.active_terminal_rail_status).toMatchObject({
      rail_status: "fail_closed",
      rail_failure_code: "required_observation_missing",
      terminal_error_code: "procedure_epoch_previous_unavailable",
    });
  });

  it("does not complete compound rail mirrors from satisfied rows without observation refs", () => {
    const turnId = "ask:test:compound-debug-index:satisfied-without-observation";
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:1:workspace_os_status`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const compoundContract = {
      schema: "helix.compound_capability_contract.v1",
      turn_id: turnId,
      prompt_shape: "compound_capability",
      requires_all_subgoals: true,
      terminal_policy: "synthesize_from_satisfied_subgoal_observations",
      subgoals: [
        {
          subgoal_id: workspaceSubgoalId,
          order: 1,
          requested_capability: "workspace_os.status",
          runtime_capability: "workspace_os.status",
          required_observation_kinds: ["workspace_os_status_observation"],
          mandatory: true,
        },
        {
          subgoal_id: calculatorSubgoalId,
          order: 2,
          requested_capability: "scientific-calculator.solve_expression",
          runtime_capability: "scientific-calculator.solve_expression",
          required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
          required_terminal_kind: "workstation_tool_evaluation",
          mandatory: true,
        },
      ],
      assistant_answer: false,
      raw_content_included: false,
    };
    const executionState = {
      schema: "helix.capability_itinerary_execution_state.v1",
      applies: true,
      complete: true,
      compound_subgoal_ledger: [
        {
          subgoal_id: workspaceSubgoalId,
          order: 1,
          requested_capability: "workspace_os.status",
          runtime_capability: "workspace_os.status",
          selected_capability: "workspace_os.status",
          executed_capability: "workspace_os.status",
          observation_kind: "workspace_os_status_observation",
          observation_ref: `${turnId}:workspace_status`,
          satisfaction: "satisfied",
          rail_status: "complete",
          rail_failure_code: null,
        },
        {
          subgoal_id: calculatorSubgoalId,
          order: 2,
          requested_capability: "scientific-calculator.solve_expression",
          runtime_capability: "scientific-calculator.solve_expression",
          selected_capability: "scientific-calculator.solve_expression",
          executed_capability: "scientific-calculator.solve_expression",
          observation_kind: "calculator_receipt",
          observation_ref: null,
          satisfaction: "satisfied",
          rail_status: "complete",
          rail_failure_code: null,
        },
      ],
      assistant_answer: false,
      raw_content_included: false,
    };

    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        compound_capability_contract: compoundContract,
        capability_itinerary: {
          schema: "helix.capability_itinerary.v1",
          compound_capability_contract: compoundContract,
          execution_state: executionState,
        },
        capability_itinerary_execution_state: executionState,
        current_turn_artifact_ledger: [
          {
            artifact_id: `${turnId}:workspace_status`,
            kind: "workspace_os_status_observation",
            payload: {
              schema: "helix.workspace_os_status_observation.v1",
              assistant_answer: false,
              raw_content_included: false,
            },
          },
        ],
      },
    });

    expect(index.compound_subgoal_missing_summary).toMatchObject({
      missing_compound_subgoal_ids: [calculatorSubgoalId],
      missing_required_capabilities: ["scientific-calculator.solve_expression"],
      next_missing_subgoal_id: calculatorSubgoalId,
      complete: false,
    });
    expect(index.tool_turn_chain_audit).toMatchObject({
      first_incomplete_compound_subgoal_id: calculatorSubgoalId,
      compound_rail_failure_code: null,
      rail_failure_code: "observation_missing",
      rail_status: "broken",
    });
    expect(index.tool_turn_chain_family_matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route_family: "calculator",
          observed: true,
          requested_capability: "scientific-calculator.solve_expression",
          did_tool_run: true,
          artifact_produced: false,
          artifact_reentered: false,
          rail_status: "broken",
          compound_subgoal_count: 1,
          compound_observation_refs: [],
        }),
      ]),
    );
  });

  it("reconstructs compound rail rows from explicit prompt contracts when route payload drops the contract", () => {
    const turnId = "ask:test:compound-debug-index:missing-contract";
    const prompt =
      "Use internet_search.web_research to find a current public source about Codex, " +
      "then use helix_ask.reflect_theory_context to connect that source to the receipts-as-observations rule, " +
      "then run scientific-calculator.solve_expression with this exact expression: (9+3)*7-25.";
    const payload: Record<string, unknown> = {
      active_turn_id: turnId,
      active_prompt: prompt,
      tool_call_admission_decision: {
        requested_capability: "internet_search.web_research",
        compound_requested_capabilities: [
          "internet_search.web_research",
          "helix_ask.reflect_theory_context",
          "scientific-calculator.solve_expression",
        ],
        admitted_tool_families: ["internet_search", "theory_locator", "calculator", "workstation_action"],
        required_observation_kinds_for_requested_capability: ["internet_search_observation"],
      },
      capability_plan: {
        requested_capability: "internet_search.web_research",
        selected_capability: "internet-search.search_web",
        compound_requested_capabilities: [
          "internet_search.web_research",
          "helix_ask.reflect_theory_context",
          "scientific-calculator.solve_expression",
        ],
      },
      terminal_artifact_kind: "request_user_input",
      terminal_answer_authority: { terminal_artifact_kind: "request_user_input" },
      terminal_presentation: { terminal_artifact_kind: "request_user_input" },
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:agent_runtime_loop_admission`,
          kind: "agent_runtime_loop_admission",
          payload: { assistant_answer: false, raw_content_included: false },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId, payload });

    expect(index.compound_capability_contract).toMatchObject({
      subgoals: [
        expect.objectContaining({ requested_capability: "internet_search.web_research" }),
        expect.objectContaining({ requested_capability: "helix_ask.reflect_theory_context" }),
        expect.objectContaining({ requested_capability: "scientific-calculator.solve_expression" }),
      ],
    });
    expect(index.compound_subgoal_rail_statuses).toEqual([
      expect.objectContaining({ requested_capability: "internet_search.web_research" }),
      expect.objectContaining({ requested_capability: "helix_ask.reflect_theory_context" }),
      expect.objectContaining({ requested_capability: "scientific-calculator.solve_expression" }),
    ]);
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      compound_subgoal_count: 3,
      first_incomplete_compound_requested_capability: "internet_search.web_research",
      compound_first_broken_rail: "capability_execution",
      compound_rail_failure_code: "compound_subgoal_dropped",
      compound_repair_target: "agent_step_selection",
    });
  });

  it("synthesizes fail-closed rail status for required compound subgoals dropped from the execution ledger", () => {
    const turnId = "ask:test:compound-debug-index:dropped-subgoal";
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:1:workspace_os_status`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const compoundContract = {
      schema: "helix.compound_capability_contract.v1",
      turn_id: turnId,
      prompt_shape: "compound_capability",
      requires_all_subgoals: true,
      terminal_policy: "synthesize_from_satisfied_subgoal_observations",
      subgoals: [
        {
          subgoal_id: workspaceSubgoalId,
          order: 1,
          requested_capability: "workspace_os.status",
          runtime_capability: "workspace_os.status",
          required_args: [],
          optional_args: [],
          required_observation_kinds: ["workspace_os_status_observation"],
          required_terminal_kind: "model_synthesized_answer",
          contribution_role: "evidence",
          terminal_contribution_kind: "model_synthesized_answer",
          allowed_substitutions: [],
          forbidden_nearby_capabilities: ["debug.inspect_current_turn", "model.direct_answer"],
          mandatory: true,
        },
        {
          subgoal_id: calculatorSubgoalId,
          order: 2,
          requested_capability: "scientific-calculator.solve_expression",
          runtime_capability: "scientific-calculator.solve_expression",
          required_args: ["latex"],
          optional_args: ["expression", "equation"],
          args_hint: { latex: "2+2", expression: "2+2" },
          required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
          required_terminal_kind: "workstation_tool_evaluation",
          contribution_role: "terminal_component",
          terminal_contribution_kind: "workstation_tool_evaluation",
          allowed_substitutions: [],
          forbidden_nearby_capabilities: ["repo-code.search_concept", "model.direct_answer"],
          mandatory: true,
        },
      ],
      assistant_answer: false,
      raw_content_included: false,
    };
    const executionState = {
      schema: "helix.capability_itinerary_execution_state.v1",
      applies: true,
      complete: true,
      compound_subgoal_ledger: [
        {
          subgoal_id: workspaceSubgoalId,
          order: 1,
          requested_capability: "workspace_os.status",
          runtime_capability: "workspace_os.status",
          selected_capability: "workspace_os.status",
          executed_capability: "workspace_os.status",
          args: {},
          planned_args: {},
          selected_args: {},
          required_args: [],
          optional_args: [],
          required_observation_kinds: ["workspace_os_status_observation"],
          required_terminal_kind: "model_synthesized_answer",
          observation_kind: "workspace_os_status_observation",
          observation_ref: `${turnId}:workspace_status`,
          support_refs: [`${turnId}:workspace_status`],
          satisfaction: "satisfied",
          rail_status: "complete",
          first_broken_rail: null,
          rail_failure_code: null,
          repair_target: null,
        },
      ],
      assistant_answer: false,
      raw_content_included: false,
    };
    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        compound_capability_contract: compoundContract,
        capability_itinerary: {
          schema: "helix.capability_itinerary.v1",
          compound_capability_contract: compoundContract,
          execution_state: executionState,
        },
        capability_itinerary_execution_state: executionState,
        current_turn_artifact_ledger: [
          {
            artifact_id: `${turnId}:workspace_status`,
            kind: "workspace_os_status_observation",
            payload: {
              schema: "helix.workspace_os_status_observation.v1",
              assistant_answer: false,
              raw_content_included: false,
            },
          },
        ],
      },
    });

    expect(index.compound_subgoal_ledger).toHaveLength(1);
    expect(index.compound_subgoal_rail_statuses).toEqual([
      expect.objectContaining({
        subgoal_id: workspaceSubgoalId,
        requested_capability: "workspace_os.status",
        executed_capability: "workspace_os.status",
        satisfaction: "satisfied",
        rail_status: "complete",
      }),
      expect.objectContaining({
        subgoal_id: calculatorSubgoalId,
        requested_capability: "scientific-calculator.solve_expression",
        runtime_capability: "scientific-calculator.solve_expression",
        selected_capability: null,
        executed_capability: null,
        args: { latex: "2+2", expression: "2+2" },
        args_source: "compound_contract_missing_ledger",
        planned_args: { latex: "2+2", expression: "2+2" },
        selected_args: null,
        required_args: ["latex"],
        required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
        required_terminal_kind: "workstation_tool_evaluation",
        observation_kind: null,
        observation_ref: null,
        support_refs: [],
        satisfaction: "missing",
        rail_status: "fail_closed",
        first_broken_rail: "capability_execution",
        rail_failure_code: "compound_subgoal_dropped",
        repair_target: "agent_step_selection",
      }),
    ]);
    expect(index.compound_subgoal_missing_summary).toMatchObject({
      missing_compound_subgoal_ids: [calculatorSubgoalId],
      missing_required_capabilities: ["scientific-calculator.solve_expression"],
      next_missing_subgoal_id: calculatorSubgoalId,
      complete: false,
    });
    expect(index.tool_turn_chain_family_matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route_family: "calculator",
          observed: true,
          requested_capability: "scientific-calculator.solve_expression",
          did_tool_run: false,
          artifact_produced: false,
          artifact_reentered: false,
          rail_status: "fail_closed",
          rail_failure_code: "compound_subgoal_dropped",
          compound_rail_failure_codes: ["compound_subgoal_dropped"],
        }),
      ]),
    );
  });

  it("recovers compound rail state from ledger artifacts when payload mirrors are absent", () => {
    const turnId = "ask:test:compound-debug-index:ledger-artifact-fallback";
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:1:workspace_os_status`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const compoundContract = {
      schema: "helix.compound_capability_contract.v1",
      turn_id: turnId,
      prompt_shape: "compound_capability",
      requires_all_subgoals: true,
      terminal_policy: "synthesize_from_satisfied_subgoal_observations",
      subgoals: [
        {
          subgoal_id: workspaceSubgoalId,
          order: 1,
          requested_capability: "workspace_os.status",
          runtime_capability: "workspace_os.status",
          required_args: [],
          optional_args: [],
          required_observation_kinds: ["workspace_os_status_observation"],
          required_terminal_kind: "model_synthesized_answer",
          contribution_role: "evidence",
          terminal_contribution_kind: "model_synthesized_answer",
          allowed_substitutions: [],
          forbidden_nearby_capabilities: ["debug.inspect_current_turn", "model.direct_answer"],
          mandatory: true,
        },
        {
          subgoal_id: calculatorSubgoalId,
          order: 2,
          requested_capability: "scientific-calculator.solve_expression",
          runtime_capability: "scientific-calculator.solve_expression",
          required_args: ["latex"],
          optional_args: ["expression", "equation"],
          args_hint: { latex: "2+2", expression: "2+2" },
          required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
          required_terminal_kind: "workstation_tool_evaluation",
          contribution_role: "terminal_component",
          terminal_contribution_kind: "workstation_tool_evaluation",
          allowed_substitutions: [],
          forbidden_nearby_capabilities: ["repo-code.search_concept", "model.direct_answer"],
          mandatory: true,
        },
      ],
      assistant_answer: false,
      raw_content_included: false,
    };
    const executionState = {
      schema: "helix.capability_itinerary_execution_state.v1",
      applies: true,
      complete: true,
      compound_subgoal_ledger: [
        {
          subgoal_id: workspaceSubgoalId,
          order: 1,
          requested_capability: "workspace_os.status",
          runtime_capability: "workspace_os.status",
          selected_capability: "workspace_os.status",
          executed_capability: "workspace_os.status",
          args: {},
          planned_args: {},
          selected_args: {},
          required_args: [],
          optional_args: [],
          required_observation_kinds: ["workspace_os_status_observation"],
          required_terminal_kind: "model_synthesized_answer",
          observation_kind: "workspace_os_status_observation",
          observation_ref: `${turnId}:workspace_status`,
          support_refs: [`${turnId}:workspace_status`],
          satisfaction: "satisfied",
          rail_status: "complete",
          first_broken_rail: null,
          rail_failure_code: null,
          repair_target: null,
        },
        {
          subgoal_id: calculatorSubgoalId,
          order: 2,
          requested_capability: "scientific-calculator.solve_expression",
          runtime_capability: "scientific-calculator.solve_expression",
          selected_capability: "scientific-calculator.solve_expression",
          executed_capability: "scientific-calculator.solve_expression",
          args: { latex: "2+2", expression: "2+2" },
          planned_args: { latex: "2+2", expression: "2+2" },
          selected_args: { latex: "2+2", expression: "2+2" },
          required_args: ["latex"],
          optional_args: ["expression", "equation"],
          required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
          required_terminal_kind: "workstation_tool_evaluation",
          observation_kind: "calculator_receipt",
          observation_ref: `${turnId}:calculator_receipt`,
          support_refs: [`${turnId}:calculator_receipt`],
          satisfaction: "satisfied",
          rail_status: "complete",
          first_broken_rail: null,
          rail_failure_code: null,
          repair_target: null,
        },
      ],
      assistant_answer: false,
      raw_content_included: false,
    };

    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        current_turn_artifact_ledger: [
          {
            artifact_id: `${turnId}:capability_itinerary`,
            kind: "capability_itinerary",
            payload: {
              schema: "helix.capability_itinerary.v1",
              compound_capability_contract: compoundContract,
              terminal_success_criteria: {
                required_capabilities: [
                  "workspace_os.status",
                  "scientific-calculator.solve_expression",
                ],
                compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
              },
            },
          },
          {
            artifact_id: `${turnId}:compound_capability_contract`,
            kind: "compound_capability_contract",
            payload: compoundContract,
          },
          {
            artifact_id: `${turnId}:capability_itinerary_execution_state`,
            kind: "capability_itinerary_execution_state",
            payload: executionState,
          },
          {
            artifact_id: `${turnId}:workspace_status`,
            kind: "workspace_os_status_observation",
            payload: {
              schema: "helix.workspace_os_status_observation.v1",
              assistant_answer: false,
              raw_content_included: false,
            },
          },
          {
            artifact_id: `${turnId}:calculator_receipt`,
            kind: "calculator_receipt",
            payload: {
              schema: "helix.calculator_receipt.v1",
              assistant_answer: false,
              raw_content_included: false,
            },
          },
        ],
      },
    });

    expect(index.compound_capability_contract).toMatchObject({
      schema: "helix.compound_capability_contract.v1",
      prompt_shape: "compound_capability",
    });
    expect(index.capability_itinerary_execution_state).toMatchObject({
      schema: "helix.capability_itinerary_execution_state.v1",
      complete: true,
    });
    expect(index.compound_subgoal_rail_statuses).toEqual([
      expect.objectContaining({
        subgoal_id: workspaceSubgoalId,
        requested_capability: "workspace_os.status",
        executed_capability: "workspace_os.status",
        observation_ref: `${turnId}:workspace_status`,
        satisfaction: "satisfied",
        rail_status: "complete",
      }),
      expect.objectContaining({
        subgoal_id: calculatorSubgoalId,
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        observation_ref: `${turnId}:calculator_receipt`,
        satisfaction: "satisfied",
        rail_status: "complete",
      }),
    ]);
    expect(index.compound_subgoal_missing_summary).toMatchObject({
      missing_compound_subgoal_ids: [],
      missing_required_capabilities: [],
      complete: true,
    });
  });

  it("separates final authoritative rail state from historical compound rail failures", () => {
    const turnId = "ask:test:compound-debug-index:historical-rail";
    const docsSubgoalId = `${turnId}:subgoal:1:docs`;
    const calculatorSubgoalId = `${turnId}:subgoal:2:calculator`;
    const staleCalculatorRail = {
      subgoal_id: calculatorSubgoalId,
      order: 2,
      requested_capability: "scientific-calculator.solve_expression",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: null,
      observation_kind: null,
      observation_ref: null,
      satisfaction: "missing",
      rail_status: "pending",
      first_broken_rail: "observation_artifact",
      rail_failure_code: "subgoal_observation_missing",
      repair_target: "observation_materializer",
    };
    const compoundContract = {
      schema: "helix.compound_capability_contract.v1",
      turn_id: turnId,
      prompt_shape: "compound_capability",
      requires_all_subgoals: true,
      terminal_policy: "synthesize_from_satisfied_subgoal_observations",
      subgoals: [
        {
          subgoal_id: docsSubgoalId,
          order: 1,
          requested_capability: "docs-viewer.locate_in_doc",
          runtime_capability: "docs-viewer.locate_in_doc",
          required_observation_kinds: ["doc_location_matches"],
          required_terminal_kind: "doc_location_matches",
          contribution_role: "evidence",
          terminal_contribution_kind: "doc_location_matches",
          mandatory: true,
        },
        {
          subgoal_id: calculatorSubgoalId,
          order: 2,
          requested_capability: "scientific-calculator.solve_expression",
          runtime_capability: "scientific-calculator.solve_expression",
          required_args: ["latex"],
          args_hint: { latex: "2+2" },
          required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
          required_terminal_kind: "workstation_tool_evaluation",
          contribution_role: "terminal_component",
          terminal_contribution_kind: "workstation_tool_evaluation",
          mandatory: true,
        },
      ],
      assistant_answer: false,
      raw_content_included: false,
    };
    const executionState = {
      schema: "helix.capability_itinerary_execution_state.v1",
      applies: true,
      complete: true,
      missing_compound_subgoal_ids: [],
      missing_required_capabilities: [],
      compound_subgoal_ledger: [
        {
          subgoal_id: docsSubgoalId,
          order: 1,
          requested_capability: "docs-viewer.locate_in_doc",
          runtime_capability: "docs-viewer.locate_in_doc",
          selected_capability: "docs-viewer.locate_in_doc",
          executed_capability: "docs-viewer.locate_in_doc",
          required_observation_kinds: ["doc_location_matches"],
          observation_kind: "doc_location_matches",
          observation_ref: `${turnId}:doc_location`,
          support_refs: [`${turnId}:doc_location`],
          satisfaction: "satisfied",
          rail_status: "complete",
          rail_failure_code: null,
        },
        {
          subgoal_id: calculatorSubgoalId,
          order: 2,
          requested_capability: "scientific-calculator.solve_expression",
          runtime_capability: "scientific-calculator.solve_expression",
          selected_capability: "scientific-calculator.solve_expression",
          executed_capability: "scientific-calculator.solve_expression",
          args: { latex: "2+2" },
          required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
          observation_kind: "calculator_receipt",
          observation_ref: `${turnId}:calculator_receipt`,
          support_refs: [`${turnId}:calculator_receipt`],
          satisfaction: "satisfied",
          rail_status: "complete",
          rail_failure_code: null,
        },
      ],
      assistant_answer: false,
      raw_content_included: false,
    };
    const payload: Record<string, unknown> = {
      active_prompt: "Use docs-viewer.locate_in_doc, then scientific-calculator.solve_expression.",
      tool_lifecycle_trace: {
        executed_capability: "docs-viewer.locate_in_doc",
        lifecycle_stage: "reentered_solver",
      },
      route_product_contract: {
        required_terminal_artifact_kind: "doc_evidence_synthesis_answer",
        allowed_terminal_artifact_kinds: ["doc_evidence_synthesis_answer"],
      },
      canonical_goal_frame: {
        goal_kind: "compound_capability_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
      },
      terminal_authority_single_writer: {
        selected_terminal_artifact_kind: "doc_evidence_synthesis_answer",
        terminal_artifact_kind: "doc_evidence_synthesis_answer",
        support_refs: [`${turnId}:doc_location`, `${turnId}:calculator_receipt`],
      },
      terminal_presentation: {
        terminal_artifact_kind: "doc_evidence_synthesis_answer",
      },
      final_answer_draft: {
        artifact_id: `${turnId}:final_answer_draft`,
        support_refs: [`${turnId}:doc_location`, `${turnId}:calculator_receipt`],
      },
      compound_subgoal_rail_statuses: [staleCalculatorRail],
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:compound_capability_contract`,
          kind: "compound_capability_contract",
          payload: compoundContract,
        },
        {
          artifact_id: `${turnId}:capability_itinerary_execution_state`,
          kind: "capability_itinerary_execution_state",
          payload: executionState,
        },
        {
          artifact_id: `${turnId}:doc_location`,
          kind: "doc_location_matches",
          payload: {
            schema: "helix.doc_location_matches.v1",
            capability: "docs-viewer.locate_in_doc",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: `${turnId}:calculator_receipt`,
          kind: "calculator_receipt",
          payload: {
            schema: "helix.calculator_receipt.v1",
            capability: "scientific-calculator.solve_expression",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: `${turnId}:final_answer_draft`,
          kind: "final_answer_draft",
          payload: {
            support_refs: [`${turnId}:doc_location`, `${turnId}:calculator_receipt`],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    const index = buildArtifactQueryIndex({ turnId, payload });

    expect(index.final_tool_turn_chain_audit).toMatchObject({
      snapshot_role: "final_authoritative",
      authoritative_for_pass_fail: true,
      rail_status: "complete",
      rail_failure_code: null,
      compound_rail_failure_code: null,
    });
    expect(index.final_tool_rail_failure_triage).toMatchObject({
      snapshot_role: "final_authoritative",
      authoritative_for_pass_fail: true,
      rail_status: "complete",
      rail_failure_code: null,
      first_broken_rail: null,
    });
    expect(index.active_terminal_rail_status).toMatchObject({
      schema: "helix.active_terminal_rail_status.v1",
      snapshot_role: "final_authoritative",
      pass_fail_source: "final_tool_turn_chain_audit",
      rail_status: "complete",
      rail_failure_code: null,
      terminal_artifact_kind: "doc_evidence_synthesis_answer",
      historical_rail_event_count: 1,
      debug_contains_historical_rail_events: true,
    });
    expect(index.historical_rail_events).toEqual([
      expect.objectContaining({
        schema: "helix.historical_rail_event.v1",
        snapshot_role: "historical_intermediate",
        superseded_by_final_rail: true,
        subgoal_id: calculatorSubgoalId,
        rail_status: "pending",
        rail_failure_code: "subgoal_observation_missing",
      }),
    ]);
  });

  it("exposes extended compound subgoal families in the family matrix", () => {
    const turnId = "ask:test:compound-debug-index:extended-families";
    const compoundSubgoalLedger = [
      {
        subgoal_id: `${turnId}:subgoal:1:capability_catalog`,
        order: 1,
        requested_capability: "helix_ask.inspect_capability_catalog",
        selected_capability: "helix_ask.inspect_capability_catalog",
        executed_capability: "helix_ask.inspect_capability_catalog",
        observation_kind: "capability_registry",
        observation_ref: `${turnId}:capability_registry`,
        required_terminal_kind: "capability_help_summary",
        contribution_role: "evidence",
        terminal_contribution_kind: "capability_help_summary",
        forbidden_nearby_capabilities: ["repo-code.search_concept", "model.direct_answer"],
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
      },
      {
        subgoal_id: `${turnId}:subgoal:2:scholarly_research`,
        order: 2,
        requested_capability: "scholarly-research.lookup_papers",
        selected_capability: "scholarly-research.lookup_papers",
        executed_capability: "scholarly-research.lookup_papers",
        observation_kind: "scholarly_research_observation",
        observation_ref: `${turnId}:scholarly`,
        required_terminal_kind: "scholarly_research_answer",
        contribution_role: "evidence",
        terminal_contribution_kind: "scholarly_research_answer",
        forbidden_nearby_capabilities: ["internet_search.web_research", "model.direct_answer"],
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
      },
      {
        subgoal_id: `${turnId}:subgoal:3:theory_locator`,
        order: 3,
        requested_capability: "helix_ask.reflect_theory_context",
        selected_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        observation_kind: "theory_context_reflection",
        observation_ref: `${turnId}:theory`,
        required_terminal_kind: "theory_context_reflection_answer",
        contribution_role: "evidence",
        terminal_contribution_kind: "theory_context_reflection_answer",
        forbidden_nearby_capabilities: ["internet_search.web_research", "model.direct_answer"],
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
      },
      {
        subgoal_id: `${turnId}:subgoal:4:civilization_bounds`,
        order: 4,
        requested_capability: "helix_ask.reflect_civilization_bounds",
        selected_capability: "helix_ask.reflect_civilization_bounds",
        executed_capability: "helix_ask.reflect_civilization_bounds",
        observation_kind: "civilization_bounds_roadmap/v1",
        observation_ref: `${turnId}:civilization`,
        required_terminal_kind: "model_synthesized_answer",
        contribution_role: "evidence",
        terminal_contribution_kind: "model_synthesized_answer",
        forbidden_nearby_capabilities: ["model.direct_answer"],
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
      },
      {
        subgoal_id: `${turnId}:subgoal:5:moral_graph_reflection`,
        order: 5,
        requested_capability: "helix_ask.reflect_ideology_context",
        selected_capability: "helix_ask.reflect_ideology_context",
        executed_capability: "helix_ask.reflect_ideology_context",
        observation_kind: "ideology_context_reflection/v1",
        observation_ref: `${turnId}:moral`,
        required_terminal_kind: "model_synthesized_answer",
        contribution_role: "evidence",
        terminal_contribution_kind: "model_synthesized_answer",
        forbidden_nearby_capabilities: ["model.direct_answer"],
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
      },
      {
        subgoal_id: `${turnId}:subgoal:6:visual_capture`,
        order: 6,
        requested_capability: "image_lens.inspect",
        selected_capability: "situation-room.describe_visual_capture",
        executed_capability: "situation-room.describe_visual_capture",
        observation_kind: "situation_context_pack",
        observation_ref: `${turnId}:visual`,
        required_terminal_kind: "situation_context_pack",
        contribution_role: "evidence",
        terminal_contribution_kind: "situation_context_pack",
        forbidden_nearby_capabilities: ["model.direct_answer"],
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
      },
      {
        subgoal_id: `${turnId}:subgoal:7:context_reflection`,
        order: 7,
        requested_capability: "helix_ask.reflect_context_attachments",
        selected_capability: "helix_ask.reflect_context_attachments",
        executed_capability: "helix_ask.reflect_context_attachments",
        observation_kind: "helix_context_reflection_tool_receipt/v1",
        observation_ref: `${turnId}:context-reflection`,
        required_terminal_kind: "model_synthesized_answer",
        contribution_role: "evidence",
        terminal_contribution_kind: "model_synthesized_answer",
        forbidden_nearby_capabilities: ["model.direct_answer"],
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
      },
      {
        subgoal_id: `${turnId}:subgoal:8:live_env`,
        order: 8,
        requested_capability: "live_env.read_processed_live_source_mail",
        selected_capability: "live_env.read_processed_live_source_mail",
        executed_capability: "live_env.read_processed_live_source_mail",
        observation_kind: "stage_play_processed_mail_packet",
        observation_ref: `${turnId}:live-mail`,
        required_terminal_kind: "model_synthesized_answer",
        contribution_role: "terminal_component",
        terminal_contribution_kind: "model_synthesized_answer",
        forbidden_nearby_capabilities: ["model.direct_answer"],
        satisfaction: "satisfied",
        rail_status: "complete",
        rail_failure_code: null,
      },
    ];
    const payload: Record<string, unknown> = {
      active_prompt: "Run a compound tool-family parity fixture.",
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        applies: true,
        complete: true,
        compound_subgoal_ledger: compoundSubgoalLedger,
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const index = buildArtifactQueryIndex({ turnId, payload });

    expect(index.tool_turn_chain_family_matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route_family: "capability_catalog",
          observed: true,
          requested_capability: "helix_ask.inspect_capability_catalog",
          compound_observation_refs: expect.arrayContaining([`${turnId}:capability_registry`]),
          compound_terminal_contribution_kinds: expect.arrayContaining(["capability_help_summary"]),
          compound_contribution_roles: expect.arrayContaining(["evidence"]),
          compound_forbidden_nearby_capabilities: expect.arrayContaining(["repo-code.search_concept", "model.direct_answer"]),
          rail_status: "complete",
        }),
        expect.objectContaining({
          route_family: "scholarly_research",
          observed: true,
          requested_capability: "scholarly-research.lookup_papers",
          compound_observation_refs: expect.arrayContaining([`${turnId}:scholarly`]),
          compound_terminal_contribution_kinds: expect.arrayContaining(["scholarly_research_answer"]),
          compound_contribution_roles: expect.arrayContaining(["evidence"]),
          compound_forbidden_nearby_capabilities: expect.arrayContaining(["internet_search.web_research", "model.direct_answer"]),
          rail_status: "complete",
        }),
        expect.objectContaining({
          route_family: "theory_locator",
          observed: true,
          requested_capability: "helix_ask.reflect_theory_context",
          compound_observation_refs: expect.arrayContaining([`${turnId}:theory`]),
          compound_terminal_contribution_kinds: expect.arrayContaining(["theory_context_reflection_answer"]),
          compound_contribution_roles: expect.arrayContaining(["evidence"]),
          compound_forbidden_nearby_capabilities: expect.arrayContaining(["internet_search.web_research", "model.direct_answer"]),
          rail_status: "complete",
        }),
        expect.objectContaining({
          route_family: "civilization_bounds",
          observed: true,
          requested_capability: "helix_ask.reflect_civilization_bounds",
          compound_observation_refs: expect.arrayContaining([`${turnId}:civilization`]),
          compound_terminal_contribution_kinds: expect.arrayContaining(["model_synthesized_answer"]),
          compound_contribution_roles: expect.arrayContaining(["evidence"]),
          compound_forbidden_nearby_capabilities: expect.arrayContaining(["model.direct_answer"]),
          rail_status: "complete",
        }),
        expect.objectContaining({
          route_family: "moral_graph_reflection",
          observed: true,
          requested_capability: "helix_ask.reflect_ideology_context",
          compound_observation_refs: expect.arrayContaining([`${turnId}:moral`]),
          compound_terminal_contribution_kinds: expect.arrayContaining(["model_synthesized_answer"]),
          compound_contribution_roles: expect.arrayContaining(["evidence"]),
          compound_forbidden_nearby_capabilities: expect.arrayContaining(["model.direct_answer"]),
          rail_status: "complete",
        }),
        expect.objectContaining({
          route_family: "image_lens / visual_capture",
          observed: true,
          requested_capability: "image_lens.inspect",
          compound_observation_refs: expect.arrayContaining([`${turnId}:visual`]),
          compound_terminal_contribution_kinds: expect.arrayContaining(["situation_context_pack"]),
          compound_contribution_roles: expect.arrayContaining(["evidence"]),
          compound_forbidden_nearby_capabilities: expect.arrayContaining(["model.direct_answer"]),
          rail_status: "complete",
        }),
        expect.objectContaining({
          route_family: "context_reflection",
          observed: true,
          requested_capability: "helix_ask.reflect_context_attachments",
          compound_observation_refs: expect.arrayContaining([`${turnId}:context-reflection`]),
          compound_terminal_contribution_kinds: expect.arrayContaining(["model_synthesized_answer"]),
          compound_contribution_roles: expect.arrayContaining(["evidence"]),
          compound_forbidden_nearby_capabilities: expect.arrayContaining(["model.direct_answer"]),
          rail_status: "complete",
        }),
        expect.objectContaining({
          route_family: "live_env",
          observed: true,
          requested_capability: "live_env.read_processed_live_source_mail",
          compound_observation_refs: expect.arrayContaining([`${turnId}:live-mail`]),
          compound_terminal_contribution_kinds: expect.arrayContaining(["model_synthesized_answer"]),
          compound_contribution_roles: expect.arrayContaining(["terminal_component"]),
          compound_forbidden_nearby_capabilities: expect.arrayContaining(["model.direct_answer"]),
          rail_status: "complete",
        }),
      ]),
    );
  });

  it("normalizes a completed internet_search.web_research turn through the same rail table", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "Use internet_search.web_research to find current source evidence.",
      tool_surface_packet: {
        schema: "helix.tool_surface_packet.v1",
        tools: [{ name: "internet_search.web_research" }],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "internet_research",
        required_terminal_kind: "internet_search_answer",
      },
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        turn_id: "ask:test:internet-search-complete",
        source_target: "internet_search",
        required: true,
        admitted_tool_families: ["internet_search"],
        requested_capability: "internet_search.web_research",
        requested_capability_family: "internet_search",
        requested_capability_source: "explicit_user_command",
        required_observation_kinds_for_requested_capability: ["internet_search_observation"],
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:internet-search-complete",
        capability_family: "internet_search",
        requested_action: "internet_search.web_research",
        selected_capability: "internet_search.web_research",
        requested_capability: "internet_search.web_research",
        admission_status: "admitted",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            chosen_capability: "internet_search.web_research",
            executed_action_key: "internet_search.web_research",
            observed_artifact_refs: ["internet_search_observation:1"],
          },
        ],
        executed_tool_call_count: 1,
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:internet-search-complete:final_answer_draft",
        support_refs: ["internet_search_observation:1"],
      },
      terminal_artifact_kind: "internet_search_answer",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "internet_search_answer",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "internet_search_answer",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "internet_search_observation:1",
          kind: "internet_search_observation",
          producer_item_id: "internet_search.web_research",
          payload: {
            schema: "helix.internet_search_observation.v1",
            result_count: 3,
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:internet-search-complete", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:internet-search-complete", payload });

    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      prompt: "Use internet_search.web_research to find current source evidence.",
      requested_capability: "internet_search.web_research",
      visible_tool_surface: expect.arrayContaining(["internet_search.web_research"]),
      selected_capability: "internet_search.web_research",
      admitted_capability: "internet_search.web_research",
      executed_capability: "internet_search.web_research",
      observation_kind: "internet_search_observation",
      observation_ref: "internet_search_observation:1",
      reentry_status: "reentered",
      required_terminal_kind: "internet_search_answer",
      selected_terminal_kind: "internet_search_answer",
      visible_terminal_kind: "internet_search_answer",
      first_broken_rail: null,
      codex_parity_class: "complete",
      rail_status: "complete",
      rail_failure_code: null,
    });
  });

  it("normalizes a completed visual capture turn through the same rail table", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "What is happening right now in the visual screen capture?",
      tool_surface_packet: {
        schema: "helix.tool_surface_packet.v1",
        tools: [{ name: "situation-room.describe_visual_capture" }],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "visual_capture_describe",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:visual-capture-complete",
        capability_family: "visual_capture",
        requested_action: "situation-room.describe_visual_capture",
        selected_capability: "situation-room.describe_visual_capture",
        admission_status: "admitted",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            chosen_capability: "situation-room.describe_visual_capture",
            executed_action_key: "situation-room.describe_visual_capture",
            observed_artifact_refs: ["visual_frame_evidence:1"],
          },
        ],
        executed_tool_call_count: 1,
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:visual-capture-complete:final_answer_draft",
        support_refs: ["visual_frame_evidence:1"],
      },
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "model_synthesized_answer",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "visual_frame_evidence:1",
          kind: "visual_frame_evidence",
          producer_item_id: "situation-room.describe_visual_capture",
          payload: {
            schema: "helix.visual_frame_evidence.v1",
            summary: "A seeded visual frame is available.",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:visual-capture-complete", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:visual-capture-complete", payload });

    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      prompt: "What is happening right now in the visual screen capture?",
      visible_tool_surface: expect.arrayContaining(["situation-room.describe_visual_capture"]),
      selected_capability: "situation-room.describe_visual_capture",
      admitted_capability: "situation-room.describe_visual_capture",
      executed_capability: "situation-room.describe_visual_capture",
      observation_kind: "visual_frame_evidence",
      observation_ref: "visual_frame_evidence:1",
      reentry_status: "reentered",
      required_terminal_kind: "situation_context_pack",
      selected_terminal_kind: "model_synthesized_answer",
      visible_terminal_kind: "model_synthesized_answer",
      first_broken_rail: null,
      codex_parity_class: "complete",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(index.tool_turn_chain_family_matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route_family: "image_lens / visual_capture",
          observed: true,
          did_tool_run: true,
          artifact_produced: true,
          rail_status: "complete",
        }),
      ]),
    );
  });

  it("records explicit capability substitutions as completed contract rails", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "Use image_lens.inspect to inspect the current visual capture.",
      tool_call_admission_decision: {
        schema: "helix.tool_call_admission_decision.v1",
        requested_capability: "image_lens.inspect",
        requested_capability_family: "visual_capture",
        requested_capability_source: "explicit_user_command",
        requested_capability_confidence: 1,
        required_observation_kinds_for_requested_capability: [
          "situation_context_pack",
          "visual_frame_evidence",
        ],
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:visual-substitution",
        capability_family: "visual_capture",
        requested_capability: "image_lens.inspect",
        requested_action: "image_lens.inspect",
        selected_capability: "situation-room.describe_visual_capture",
        admission_status: "admitted",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            chosen_capability: "situation-room.describe_visual_capture",
            executed_action_key: "situation-room.describe_visual_capture",
            observed_artifact_refs: ["situation_context_pack:1"],
          },
        ],
        executed_tool_call_count: 1,
      },
      runtime_tool_call: {
        tool_call_id: "tool:visual-substitution",
        capability_key: "situation-room.describe_visual_capture",
        status: "completed",
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:visual-substitution:final_answer_draft",
        support_refs: ["situation_context_pack:1"],
      },
      terminal_artifact_kind: "situation_context_pack",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer.v1",
        selected_terminal_artifact_kind: "situation_context_pack",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "situation_context_pack",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "situation_context_pack:1",
          kind: "situation_context_pack",
          producer_item_id: "situation-room.describe_visual_capture",
          payload: {
            schema: "helix.situation_context_pack.v1",
            summary: "A visual capture context pack is available.",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:visual-substitution", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:visual-substitution", payload });

    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: "image_lens.inspect",
      selected_capability: "situation-room.describe_visual_capture",
      executed_capability: "situation-room.describe_visual_capture",
      requested_selected_match: true,
      selected_executed_match: true,
      substitution_rule_applied: true,
      substitution_rule_id: "runtime_capability:situation-room.describe_visual_capture",
      observation_artifact_kind: "situation_context_pack",
      observation_ref: "situation_context_pack:1",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(index.tool_rail_failure_triage).toMatchObject({
      requested_capability: "image_lens.inspect",
      selected_capability: "situation-room.describe_visual_capture",
      executed_capability: "situation-room.describe_visual_capture",
      substitution_rule_applied: true,
      substitution_rule_id: "runtime_capability:situation-room.describe_visual_capture",
      first_broken_rail: null,
      failure_bucket: null,
      rail_status: "complete",
      rail_failure_code: null,
    });
  });

  it("normalizes a completed capability catalog turn through the same rail table", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "What tools are available for Helix Ask to use?",
      tool_surface_packet: {
        schema: "helix.tool_surface_packet.v1",
        tools: [{ name: "helix_ask.inspect_capability_catalog" }],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "capability_help",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:capability-catalog-complete",
        capability_family: "capability_catalog",
        requested_action: "helix_ask.inspect_capability_catalog",
        selected_capability: "helix_ask.inspect_capability_catalog",
        admission_status: "admitted",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            chosen_capability: "helix_ask.inspect_capability_catalog",
            executed_action_key: "helix_ask.inspect_capability_catalog",
            observed_artifact_refs: ["capability_registry:1", "capability_help_summary:1"],
          },
        ],
        executed_tool_call_count: 1,
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        draft_id: "ask:test:capability-catalog-complete:final_answer_draft",
        support_refs: ["capability_registry:1", "capability_help_summary:1"],
      },
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "model_synthesized_answer",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "capability_registry:1",
          kind: "capability_registry",
          producer_item_id: "helix_ask.inspect_capability_catalog",
          payload: {
            schema: "helix.capability_registry.v1",
            tools: [{ name: "repo-code.search_concept" }, { name: "workspace_os.status" }],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "capability_help_summary:1",
          kind: "capability_help_summary",
          producer_item_id: "helix_ask.inspect_capability_catalog",
          payload: {
            schema: "helix.capability_help_summary.v1",
            summary: "Capability catalog was inspected.",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:capability-catalog-complete", payload });
    const index = buildArtifactQueryIndex({ turnId: "ask:test:capability-catalog-complete", payload });

    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      prompt: "What tools are available for Helix Ask to use?",
      visible_tool_surface: expect.arrayContaining([
        "helix_ask.inspect_capability_catalog",
        "repo-code.search_concept",
        "workspace_os.status",
      ]),
      selected_capability: "helix_ask.inspect_capability_catalog",
      admitted_capability: "helix_ask.inspect_capability_catalog",
      executed_capability: "helix_ask.inspect_capability_catalog",
      observation_kind: "capability_registry",
      observation_ref: "capability_registry:1",
      reentry_status: "reentered",
      required_terminal_kind: "model_synthesized_answer",
      selected_terminal_kind: "model_synthesized_answer",
      visible_terminal_kind: "model_synthesized_answer",
      first_broken_rail: null,
      codex_parity_class: "complete",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(index.required_observation_coverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "capability_registry", present: true }),
      ]),
    );
  });

  it("covers the required Codex-parity spine families in one convergence matrix", () => {
    const buildCompletePayload = (input: {
      turnId: string;
      prompt: string;
      capability: string;
      requestedCapability?: string | null;
      capabilityFamily: string;
      sourceTarget: string;
      goalKind: string;
      terminalKind: string;
      observationKinds: string[];
      visibleTools?: string[];
      requestedObservationKinds?: string[];
    }): Record<string, unknown> => {
      const primaryObservation = input.observationKinds[0] ?? "observation";
      const observationRefs = input.observationKinds.map((kind, index) => `${kind}:${index + 1}`);
      return {
        active_prompt: input.prompt,
        tool_surface_packet: {
          schema: "helix.tool_surface_packet.v1",
          tools: (input.visibleTools ?? [input.capability]).map((name) => ({ name })),
          assistant_answer: false,
          raw_content_included: false,
        },
        canonical_goal_frame: {
          schema: "helix.canonical_goal_frame.v1",
          goal_kind: input.goalKind,
          required_terminal_kind: input.terminalKind,
        },
        tool_call_admission_decision: {
          schema: "helix.tool_call_admission_decision.v1",
          turn_id: input.turnId,
          source_target: input.sourceTarget,
          required: true,
          admitted_tool_families: [input.sourceTarget],
          requested_capability: input.requestedCapability ?? input.capability,
          requested_capability_family: input.sourceTarget,
          requested_capability_source: input.requestedCapability ? "explicit_user_command" : null,
          required_observation_kinds_for_requested_capability: input.requestedObservationKinds ?? input.observationKinds,
          assistant_answer: false,
          raw_content_included: false,
        },
        capability_plan: {
          schema: "helix.capability_plan.v1",
          turn_id: input.turnId,
          capability_family: input.capabilityFamily,
          requested_action: input.capability,
          selected_capability: input.capability,
          requested_capability: input.requestedCapability ?? input.capability,
          admission_status: "admitted",
        },
        agent_runtime_loop: {
          schema: "helix.agent_runtime_loop.v1",
          iterations: [
            {
              iteration: 1,
              chosen_capability: input.capability,
              executed_action_key: input.capability,
              observed_artifact_refs: observationRefs,
            },
          ],
          executed_tool_call_count: 1,
        },
        final_answer_draft: {
          schema: "helix.final_answer_draft.v1",
          draft_id: `${input.turnId}:final_answer_draft`,
          support_refs: observationRefs,
        },
        terminal_artifact_kind: input.terminalKind,
        terminal_authority_single_writer: {
          schema: "helix.terminal_authority_single_writer_result.v1",
          selected_terminal_artifact_kind: input.terminalKind,
        },
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          terminal_artifact_kind: input.terminalKind,
        },
        current_turn_artifact_ledger: input.observationKinds.map((kind, index) => ({
          artifact_id: observationRefs[index],
          kind,
          producer_item_id: input.capability,
          payload: {
            schema: `helix.${kind}.v1`,
            tool_name: input.capability,
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        })),
        selected_final_answer: `Completed ${primaryObservation}.`,
      };
    };

    const buildSuppressedContextPayload = (turnId: string): Record<string, unknown> => ({
      active_prompt: "Explain why calculator receipts are observations, but do not call the calculator.",
      tool_surface_packet: {
        schema: "helix.tool_surface_packet.v1",
        tools: [
          { name: "scientific-calculator.solve_expression" },
          { name: "suppressed_contextual_tool_reference" },
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: turnId,
        capability_family: "model_only",
        requested_action: "suppressed_contextual_tool_reference",
        selected_capability: "suppressed_contextual_tool_reference",
        admission_status: "rejected",
        rejection_reason: "contextual_tool_reference_suppressed",
        tool_admission_suppressed: true,
        capability_contract_arbitration: {
          schema: "helix.ask_capability_contract_arbitration.v1",
          contract_state: "suppressed_contextual_reference",
          selected_source_target: "model_only",
          selected_plan_family: "model_only",
          canonical_goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      operational_capability_trace: {
        schema: "helix.operational_capability_trace.v1",
        executed_capability: "model.direct_answer",
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            executed_action_key: null,
            stop_reason: "terminal_satisfied",
            satisfaction: "satisfied",
          },
        ],
        executed_tool_call_count: 0,
        stop_reason: "terminal_satisfied",
      },
      final_answer_source: "model_direct_answer",
      terminal_artifact_kind: "direct_answer_text",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        final_answer_source: "model_direct_answer",
        terminal_artifact_kind: "direct_answer_text",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "direct_answer_text",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "reasoning_context:1",
          kind: "reasoning_context",
          payload: {
            schema: "helix.reasoning_context.v1",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "direct_answer_text:1",
          kind: "direct_answer_text",
          payload: {
            schema: "helix.direct_answer_text.v1",
            text: "Receipts are observations, not terminal answers.",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "final_answer_draft:1",
          kind: "final_answer_draft",
          payload: {
            schema: "helix.final_answer_draft.v1",
            support_refs: ["reasoning_context:1", "direct_answer_text:1"],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
      selected_final_answer: "Receipts are observations, not terminal answers.",
    });

    const cases = [
      {
        coverage: "calculator",
        payload: buildCompletePayload({
          turnId: "ask:test:coverage-calculator",
          prompt: "Use scientific-calculator.solve_expression for 2 + 2.",
          capability: "scientific-calculator.solve_expression",
          requestedCapability: "scientific-calculator.solve_expression",
          capabilityFamily: "workstation_action",
          sourceTarget: "calculator",
          goalKind: "calculator_solve",
          terminalKind: "workstation_tool_evaluation",
          observationKinds: ["calculator_receipt"],
        }),
      },
      {
        coverage: "docs",
        payload: buildCompletePayload({
          turnId: "ask:test:coverage-docs",
          prompt: "Use docs-viewer.locate_in_doc to cite the claim.",
          capability: "docs-viewer.locate_in_doc",
          requestedCapability: "docs-viewer.locate_in_doc",
          capabilityFamily: "docs_viewer",
          sourceTarget: "docs_viewer",
          goalKind: "locate_in_doc",
          terminalKind: "doc_location_matches",
          observationKinds: ["doc_location_matches"],
        }),
      },
      {
        coverage: "repo_code",
        payload: buildCompletePayload({
          turnId: "ask:test:coverage-repo",
          prompt: "Use repo-code.search_concept to find terminal authority evidence.",
          capability: "repo-code.search_concept",
          requestedCapability: "repo-code.search_concept",
          capabilityFamily: "repo_evidence",
          sourceTarget: "repo_code",
          goalKind: "repo_concept_explanation",
          terminalKind: "repo_code_evidence_answer",
          observationKinds: ["repo_code_evidence_observation", "repo_evidence_relevance_gate"],
        }),
      },
      {
        coverage: "workspace_status",
        payload: buildCompletePayload({
          turnId: "ask:test:coverage-workspace-status",
          prompt: "Use workspace_os.status to inspect workstation status.",
          capability: "workspace_os.status",
          requestedCapability: "workspace_os.status",
          capabilityFamily: "workspace_diagnostic",
          sourceTarget: "workspace_diagnostic",
          goalKind: "workspace_status_diagnostic",
          terminalKind: "model_synthesized_answer",
          observationKinds: ["workspace_os_status_observation"],
        }),
      },
      {
        coverage: "live_source_mail",
        payload: buildCompletePayload({
          turnId: "ask:test:coverage-live-mail",
          prompt: "Read the processed live-source mailbox packet.",
          capability: "live_env.read_processed_live_source_mail",
          capabilityFamily: "live_environment",
          sourceTarget: "live_environment",
          goalKind: "live_source_mailbox_review",
          terminalKind: "model_synthesized_answer",
          observationKinds: ["stage_play_processed_mail_packet"],
        }),
      },
      {
        coverage: "internet_search",
        payload: buildCompletePayload({
          turnId: "ask:test:coverage-internet",
          prompt: "Use internet_search.web_research to find current source evidence.",
          capability: "internet_search.web_research",
          requestedCapability: "internet_search.web_research",
          capabilityFamily: "internet_search",
          sourceTarget: "internet_search",
          goalKind: "internet_research",
          terminalKind: "internet_search_answer",
          observationKinds: ["internet_search_observation"],
        }),
      },
      {
        coverage: "visual_image_lens",
        payload: buildCompletePayload({
          turnId: "ask:test:coverage-visual",
          prompt: "What is happening right now in the visual screen capture?",
          capability: "situation-room.describe_visual_capture",
          capabilityFamily: "visual_capture",
          sourceTarget: "visual_capture",
          goalKind: "visual_capture_describe",
          terminalKind: "situation_context_pack",
          observationKinds: ["situation_context_pack"],
        }),
      },
      {
        coverage: "capability_catalog",
        payload: buildCompletePayload({
          turnId: "ask:test:coverage-capability-catalog",
          prompt: "What tools are available for Helix Ask to use?",
          capability: "helix_ask.inspect_capability_catalog",
          capabilityFamily: "capability_catalog",
          sourceTarget: "runtime_evidence",
          goalKind: "capability_help",
          terminalKind: "model_synthesized_answer",
          observationKinds: ["capability_registry"],
          visibleTools: [
            "helix_ask.inspect_capability_catalog",
            "repo-code.search_concept",
            "workspace_os.status",
            "scientific-calculator.solve_expression",
          ],
        }),
      },
      {
        coverage: "contextual_suppression",
        payload: buildSuppressedContextPayload("ask:test:coverage-contextual-suppression"),
        expected: {
          selected_capability: "suppressed_contextual_tool_reference",
          admitted_capability: null,
          executed_capability: null,
          observation_kind: "reasoning_context",
          reentry_status: "reentered",
          required_terminal_kind: "direct_answer_text",
          selected_terminal_kind: "direct_answer_text",
          visible_terminal_kind: "direct_answer_text",
          first_broken_rail: null,
          codex_parity_class: "complete",
          rail_status: "complete",
          rail_failure_code: null,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];

    const covered = new Set<string>();
    for (const entry of cases) {
      refreshToolLifecycleRecords({ turnId: String(entry.payload.capability_plan && (entry.payload.capability_plan as Record<string, unknown>).turn_id), payload: entry.payload });
      const index = buildArtifactQueryIndex({
        turnId: String(entry.payload.capability_plan && (entry.payload.capability_plan as Record<string, unknown>).turn_id),
        payload: entry.payload,
      });
      const railTable = index.codex_parity_agent_spine_rail_table as Record<string, unknown>;
      covered.add(entry.coverage);
      expect(railTable).toMatchObject(
        entry.expected ?? {
          schema: "helix.codex_parity_agent_spine_rail_table.v1",
          selected_capability: (entry.payload.capability_plan as Record<string, unknown>).selected_capability,
          admitted_capability: (entry.payload.capability_plan as Record<string, unknown>).selected_capability,
          executed_capability: (entry.payload.capability_plan as Record<string, unknown>).selected_capability,
          reentry_status: "reentered",
          first_broken_rail: null,
          codex_parity_class: "complete",
          rail_status: "complete",
          rail_failure_code: null,
          assistant_answer: false,
          raw_content_included: false,
        },
      );
      expect(Array.isArray(railTable.visible_tool_surface)).toBe(true);
      expect((railTable.visible_tool_surface as unknown[]).length).toBeGreaterThan(0);
      expect(railTable.selected_terminal_kind).toBe(railTable.visible_terminal_kind);
      if (entry.coverage === "contextual_suppression") {
        expect(railTable.visible_tool_surface).toEqual(
          expect.arrayContaining(["suppressed_contextual_tool_reference"]),
        );
        expect(railTable.visible_tool_surface).not.toContain("scientific-calculator.solve_expression");
      }
    }

    expect([...covered].sort()).toEqual([
      "calculator",
      "capability_catalog",
      "contextual_suppression",
      "docs",
      "internet_search",
      "live_source_mail",
      "repo_code",
      "visual_image_lens",
      "workspace_status",
    ]);
  });

  it("keeps contextual tool mentions as follow-up reasoning, not execution", () => {
    const payload: Record<string, unknown> = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:contextual",
        capability_family: "workstation_action",
        requested_action: "click.start",
        admission_status: "rejected",
        rejection_reason: "contextual_tool_reference_suppressed",
        tool_admission_suppressed: true,
        suppression_reason: "screen_visible_tool_word_not_operator_command",
      },
    };

    const trace = buildToolLifecycleTrace({ turnId: "ask:test:contextual", payload });
    const followup = buildToolFollowupDecision({ turnId: "ask:test:contextual", payload, trace });

    expect(trace.lifecycle_stage).toBe("blocked");
    expect(trace.status).toBe("blocked");
    expect(trace.executed_capability).toBeNull();
    expect(trace.terminal_eligible).toBe(false);
    expect(followup.next_action).toBe("continue_reasoning");
    expect(followup.assistant_answer).toBe(false);
  });

  it("promotes workstation gateway lifecycle packets without admitting quoted notes mutations", () => {
    const notesListTrace = {
      schema: "helix.tool_lifecycle_trace.v1",
      turn_id: "ask:test:notes-gateway",
      tool_call_id: "ask:test:notes-gateway:workstation_gateway:workstation-notes.list_notes:1",
      tool_family: "workstation_tool_gateway",
      requested_capability: "workstation-notes.list_notes",
      admitted_capability: "workstation-notes.list_notes",
      executed_capability: "workstation-notes.list_notes",
      lifecycle_stage: "completed",
      status: "completed",
      session_ref: "codex",
      process_ref: null,
      observation_refs: ["artifact:notes-index"],
      receipt_refs: [],
      evidence_refs: ["artifact:notes-index"],
      failure_reason: null,
      retry_recommendation: "allow_terminal",
      fallback_used: false,
      fallback_equivalent: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    };
    const notesListFollowup = {
      schema: "helix.tool_followup_decision.v1",
      turn_id: "ask:test:notes-gateway",
      prior_tool_trace_ref: "ask:test:notes-gateway:workstation_gateway:workstation-notes.list_notes:tool_lifecycle_trace",
      observation_summary: "notes listed; body_redacted:true",
      next_action: "continue_reasoning",
      reason: "gateway_observation_requires_provider_reasoning_reentry",
      external_change_required: false,
      terminal_blockers: ["post_tool_model_step_required", "terminal_authority_not_evaluated"],
      required_surface_satisfied: true,
      evidence_reentered: false,
      assistant_answer: false,
      raw_content_included: false,
    };
    const payload: Record<string, unknown> = {
      question:
        'The screen shows "workstation-notes.append_to_note"; do not append anything. List the note titles only.',
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:notes-gateway",
        capability_family: "workstation_action",
        requested_action: "workstation-notes.append_to_note",
        admission_status: "rejected",
        rejection_reason: "quoted_or_negated_tool_reference_suppressed",
        tool_admission_suppressed: true,
      },
      debug: {
        workstation_gateway_call_results: [
          {
            capability_id: "workstation-notes.list_notes",
            status: "succeeded",
            tool_lifecycle_trace: notesListTrace,
            tool_followup_decision: notesListFollowup,
          },
        ],
      },
    };

    refreshToolLifecycleRecords({ turnId: "ask:test:notes-gateway", payload });

    expect(payload.tool_lifecycle_trace).toMatchObject({
      tool_family: "workstation_tool_gateway",
      requested_capability: "workstation-notes.list_notes",
      executed_capability: "workstation-notes.list_notes",
      lifecycle_stage: "completed",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(payload.tool_followup_decision).toMatchObject({
      next_action: "continue_reasoning",
      evidence_reentered: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect((payload.tool_followup_decision as Record<string, unknown>).terminal_blockers).toEqual(
      expect.arrayContaining(["post_tool_model_step_required", "terminal_authority_not_evaluated"]),
    );
    expect((payload.tool_lifecycle_trace as Record<string, unknown>).executed_capability).not.toBe(
      "workstation-notes.append_to_note",
    );
  });
});

