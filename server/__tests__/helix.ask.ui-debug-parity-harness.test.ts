import { describe, expect, it } from "vitest";

import {
  buildUiApiParitySessionId,
  collectCompleteRailEnvelopeViolations,
  collectRailTableViolations,
  collectUiApiTerminalParityViolations,
  collectUiDebugCompoundSubgoalRailStatuses,
  collectUiDebugRailCandidates,
  collectUiDebugRailMirrorViolations,
  BROAD_PARITY_PROMPTS,
  DEFAULT_PROMPTS,
  HELIX_ASK_DOCS_LOCATE_PROMPT,
  HELIX_ASK_EXPLICIT_CALCULATOR_PROMPT,
  HELIX_ASK_NATURAL_CALCULATOR_PROMPT,
  HELIX_ASK_TOOL_CATALOG_PROMPT,
  HELIX_ASK_VISUAL_CONTEXT_PROMPT,
  resolveUiDebugParityPromptPreset,
  resolveUiDebugParityPrompts,
  summarizeUiDebugParityGoalAcceptance,
  summarizeUiDebugParityWarnings,
  uiDebugParityGoalProofTrust,
  uiDebugParityProcessExitCode,
  uiServerBundleFreshnessWarnings,
} from "../../scripts/helix-ask-ui-debug-parity-harness";
import { CODEX_PARITY_AGENT_SPINE_CLASSES } from "../services/helix-ask/codex-parity-agent-spine-contract";

const baseRail = (): Record<string, unknown> => ({
  schema: "helix.codex_parity_agent_spine_rail_table.v1",
  turn_id: "ask:ui-debug-parity:test",
  prompt: "What tools are available for the helix ask to use?",
  requested_capability: null,
  visible_tool_surface: ["helix_ask.inspect_capability_catalog"],
  visible_tool_surface_original_count: 1,
  visible_tool_surface_truncated: false,
  selected_capability: "helix_ask.inspect_capability_catalog",
  admitted_capability: "helix_ask.inspect_capability_catalog",
  admission_proof_source: "capability_plan.selected_capability",
  admission_proven: true,
  executed_capability: "helix_ask.inspect_capability_catalog",
  compound_subgoal_count: 0,
  first_incomplete_compound_subgoal_id: null,
  first_incomplete_compound_requested_capability: null,
  first_incomplete_compound_runtime_capability: null,
  first_incomplete_compound_selected_capability: null,
  first_incomplete_compound_executed_capability: null,
  compound_first_broken_rail: null,
  compound_rail_failure_code: null,
  compound_repair_target: null,
  compound_incomplete_subgoal_did_tool_run: null,
  observation_kind: "capability_registry",
  observation_ref: "ask:ui-debug-parity:test:capability_registry",
  required_observation_kinds_for_requested_capability: ["capability_registry"],
  observed_artifact_supports_requested_capability: true,
  reentry_status: "reentered",
  reentry_proof_source: "tool_lifecycle_trace.lifecycle_stage",
  reentry_proven: true,
  goal_satisfaction: "satisfied",
  required_terminal_kind: "capability_help_summary",
  selected_terminal_kind: "capability_help_summary",
  terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
  terminal_authority_proven: true,
  visible_terminal_kind: "capability_help_summary",
  visible_projection_source: "terminal_presentation.terminal_artifact_kind",
  visible_projection_proven: true,
  codex_parity_class: "complete",
  first_broken_rail: null,
  repair_target: null,
  rail_status: "complete",
  rail_failure_code: null,
  normalized_codex_parity_classes: [...CODEX_PARITY_AGENT_SPINE_CLASSES],
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});

const compoundFailureRail = (): Record<string, unknown> => ({
  ...baseRail(),
  requested_capability: "docs-viewer.locate_in_doc",
  selected_capability: "docs-viewer.locate_in_doc",
  executed_capability: "docs-viewer.locate_in_doc",
  compound_subgoal_count: 2,
  first_incomplete_compound_subgoal_id: "subgoal:2",
  first_incomplete_compound_requested_capability: "scientific-calculator.solve_expression",
  first_incomplete_compound_runtime_capability: "scientific-calculator.solve_expression",
  first_incomplete_compound_selected_capability: "scientific-calculator.solve_expression",
  first_incomplete_compound_executed_capability: null,
  compound_first_broken_rail: "capability_execution",
  compound_rail_failure_code: "invalid_arg:latex_is_prose",
  compound_repair_target: "subgoal_argument_extraction",
  compound_incomplete_subgoal_did_tool_run: false,
  selected_terminal_kind: "typed_failure",
  visible_terminal_kind: "typed_failure",
  codex_parity_class: "broken",
  first_broken_rail: "capability_execution",
  repair_target: "subgoal_argument_extraction",
  rail_status: "fail_closed",
  rail_failure_code: "invalid_arg:latex_is_prose",
});

const compoundSubgoalRails = (): Array<Record<string, unknown>> => [
  {
    subgoal_id: "subgoal:1",
    order: 1,
    requested_capability: "docs-viewer.locate_in_doc",
    runtime_capability: "docs-viewer.locate_in_doc",
    selected_capability: "docs-viewer.locate_in_doc",
    executed_capability: "docs-viewer.locate_in_doc",
    args: { query: "receipts are observations" },
    args_source: "compound_itinerary_execution",
    planned_args: { query: "receipts are observations" },
    selected_args: { query: "receipts are observations" },
    required_args: ["query"],
    optional_args: ["path", "anchor", "term", "text"],
    input_bindings: [],
    bound_input_refs: [],
    unresolved_input_bindings: [],
    observation_kind: "doc_location_matches",
    observation_ref: "ask:ui-api-parity:doc_location_matches",
    observation_provenance: "docs-viewer.locate_in_doc",
    support_refs: ["ask:ui-api-parity:doc_location_matches"],
    required_observation_kinds: ["doc_location_matches"],
    required_terminal_kind: "doc_evidence_synthesis_answer",
    terminal_contribution_kind: "doc_evidence_location",
    contribution_role: "evidence",
    allowed_substitutions: [],
    forbidden_nearby_capabilities: ["docs-viewer.summarize_doc", "model.direct_answer"],
    satisfaction: "satisfied",
    rail_status: "complete",
    first_broken_rail: null,
    rail_failure_code: null,
    repair_target: null,
  },
  {
    subgoal_id: "subgoal:2",
    order: 2,
    requested_capability: "scientific-calculator.solve_expression",
    runtime_capability: "scientific-calculator.solve_expression",
    selected_capability: "scientific-calculator.solve_expression",
    executed_capability: null,
    args: { latex: "explain why receipts matter" },
    args_source: "compound_itinerary_execution",
    planned_args: { latex: "explain why receipts matter" },
    selected_args: { latex: "explain why receipts matter" },
    required_args: ["latex"],
    optional_args: ["expression", "equation"],
    input_bindings: [
      {
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_subgoal_id: "subgoal:1",
        from_capability: "docs-viewer.locate_in_doc",
        required_observation_kinds: ["doc_location_matches"],
        required: true,
        status: "pending",
      },
    ],
    bound_input_refs: [],
    unresolved_input_bindings: [
      {
        arg_name: "support_refs",
        binding_kind: "support_ref",
        from_subgoal_id: "subgoal:1",
        from_capability: "docs-viewer.locate_in_doc",
        required_observation_kinds: ["doc_location_matches"],
        required: true,
        status: "pending",
      },
    ],
    observation_kind: null,
    observation_ref: null,
    observation_provenance: null,
    support_refs: [],
    required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
    required_terminal_kind: "workstation_tool_evaluation",
    terminal_contribution_kind: "calculator_result",
    contribution_role: "calculation",
    allowed_substitutions: [],
    forbidden_nearby_capabilities: ["repo-code.search_concept", "model.direct_answer"],
    satisfaction: "not_satisfied",
    rail_status: "fail_closed",
    first_broken_rail: "capability_execution",
    rail_failure_code: "invalid_arg:latex_is_prose",
    repair_target: "subgoal_argument_extraction",
  },
];

const calculatorActionEnvelope = (): Record<string, unknown> => ({
  schema: "helix.ask.action_envelope.v1",
  receipt_capability_ids: [
    "scientific-calculator.open_panel",
    "scientific-calculator.focus_panel",
  ],
  workstation_actions: [
    {
      schema_version: "helix.workstation.action/v1",
      action: "open_panel",
      panel_id: "scientific-calculator",
    },
    {
      schema_version: "helix.workstation.action/v1",
      action: "focus_panel",
      panel_id: "scientific-calculator",
    },
  ],
  assistant_answer: false,
  raw_content_included: false,
});

describe("Helix Ask UI debug parity harness", () => {
  it("collects rail tables from top-level, payload, and nested debug mirrors", () => {
    const rail = baseRail();
    const debugExport = {
      codex_parity_agent_spine_rail_table: rail,
      payload: {
        codex_parity_agent_spine_rail_table: rail,
        debug: {
          codex_parity_agent_spine_rail_table: rail,
        },
        artifact_query_index: {
          codex_parity_agent_spine_rail_table: rail,
        },
      },
    };

    const rails = collectUiDebugRailCandidates(debugExport);

    expect(rails).toHaveLength(4);
    expect(rails.every((entry) => entry.turn_id === "ask:ui-debug-parity:test")).toBe(true);
  });

  it("collects ordered compound subgoal rails from top-level, payload, and artifact mirrors", () => {
    const rails = compoundSubgoalRails();

    expect(
      collectUiDebugCompoundSubgoalRailStatuses({
        payload: {
          artifact_query_index: {
            compound_subgoal_rail_statuses: rails,
          },
        },
      }),
    ).toEqual(rails);
  });

  it("flags stale UI debug rail mirrors", () => {
    const rail = baseRail();
    const staleRail = {
      ...rail,
      turn_id: "ask:ui-debug-parity:previous",
      prompt: "Stale previous prompt",
      visible_tool_surface: ["model.direct_answer"],
      selected_terminal_kind: "direct_answer_text",
      visible_terminal_kind: "direct_answer_text",
    };

    const violations = collectUiDebugRailMirrorViolations([rail, staleRail]);

    expect(violations).toEqual(
      expect.arrayContaining([
        "rail_mirror_1_turn_id_mismatch:ask:ui-debug-parity:previous!=ask:ui-debug-parity:test",
        "rail_mirror_1_prompt_mismatch:Stale previous prompt!=What tools are available for the helix ask to use?",
        "rail_mirror_1_visible_tool_surface_mismatch:model.direct_answer!=helix_ask.inspect_capability_catalog",
        "rail_mirror_1_selected_terminal_kind_mismatch:direct_answer_text!=capability_help_summary",
        "rail_mirror_1_visible_terminal_kind_mismatch:direct_answer_text!=capability_help_summary",
      ]),
    );
  });

  it("flags complete rails whose answer envelope still carries stale failure fields", () => {
    const rail = baseRail();
    const violations = collectCompleteRailEnvelopeViolations({
      railTable: rail,
      debugExport: {
        final_status: "final_failure",
        response_type: "typed_failure",
        final_answer_source: "typed_failure",
        terminal_error_code: "terminal_projection_mismatch",
        terminal_artifact_kind: "typed_failure",
        terminal_answer_authority: {
          schema: "helix.turn_terminal_authority.v1",
          terminal_artifact_kind: "capability_help_summary",
        },
      },
      visibleFinalAnswer: "The available tools are listed by runtime capability catalog.",
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        "complete_rail_terminal_error:terminal_projection_mismatch",
        "complete_rail_typed_failure_terminal",
        "complete_rail_non_final_response:final_failure/typed_failure",
      ]),
    );
  });

  it("does not require a successful envelope for incomplete typed failures", () => {
    const rail = {
      ...baseRail(),
      selected_terminal_kind: null,
      visible_terminal_kind: "typed_failure",
      codex_parity_class: "broken",
      rail_status: "fail_closed",
      first_broken_rail: "observation_artifact",
      rail_failure_code: "observation_missing",
      repair_target: "observation_materializer",
    };

    expect(
      collectCompleteRailEnvelopeViolations({
        railTable: rail,
        debugExport: {
          final_status: "final_failure",
          response_type: "typed_failure",
          terminal_error_code: "observation_missing",
          terminal_artifact_kind: "typed_failure",
        },
        visibleFinalAnswer: "I could not complete that turn.\nCause: observation_missing.",
      }),
    ).toEqual([]);
  });

  it("rejects visible rail projections without a projection proof source", () => {
    const rail = {
      ...baseRail(),
      visible_projection_source: null,
    };

    expect(collectRailTableViolations(rail, null)).toContain("rail_visible_projection_source_missing");
  });

  it("rejects visible rail projections whose projection source is not proven", () => {
    const rail = {
      ...baseRail(),
      visible_projection_proven: false,
    };

    expect(collectRailTableViolations(rail, null)).toContain("rail_visible_projection_not_proven");
  });

  it("rejects incomplete compound rails without first-incomplete subgoal mirrors", () => {
    const rail = {
      ...compoundFailureRail(),
      first_incomplete_compound_subgoal_id: null,
      first_incomplete_compound_requested_capability: null,
      first_incomplete_compound_runtime_capability: null,
      compound_first_broken_rail: null,
      compound_rail_failure_code: null,
      compound_repair_target: null,
      compound_incomplete_subgoal_did_tool_run: null,
    };

    expect(collectRailTableViolations(rail, null)).toEqual(
      expect.arrayContaining([
        "rail_incomplete_compound_first_incomplete_subgoal_missing",
        "rail_incomplete_compound_requested_capability_missing",
        "rail_incomplete_compound_runtime_capability_missing",
        "rail_incomplete_compound_rail_failure_code_missing",
        "rail_incomplete_compound_did_tool_run_missing",
      ]),
    );
  });

  it("flags complete rails that have no visible final answer text", () => {
    expect(
      collectCompleteRailEnvelopeViolations({
        railTable: baseRail(),
        debugExport: {
          final_status: "final_answer",
          response_type: "final_answer",
          terminal_artifact_kind: "capability_help_summary",
        },
        visibleFinalAnswer: "",
      }),
    ).toContain("complete_rail_missing_visible_final_answer");
  });

  it("accepts matching UI and API terminal parity for the same turn", () => {
    const rail = baseRail();
    const answer = "The available Helix Ask tools are exposed through the runtime capability catalog.";
    const uiDebugExport = {
      active_turn_id: "ask:ui-api-parity:shared",
      active_prompt: "What tools are available for the helix ask to use?",
      selected_final_answer: answer,
      terminal_artifact_kind: "capability_help_summary",
      terminal_error_code: null,
      codex_parity_agent_spine_rail_table: rail,
      ui_debug_parity_harness: {
        visible_final_answer: answer,
      },
    };
    const apiResponse = {
      turn_id: "ask:ui-api-parity:shared",
      question: "What tools are available for the helix ask to use?",
      selected_final_answer: answer,
      terminal_artifact_kind: "capability_help_summary",
      terminal_error_code: null,
      codex_parity_agent_spine_rail_table: rail,
    };

    expect(
      collectUiApiTerminalParityViolations({
        uiDebugExport,
        apiResponse,
      }),
    ).toEqual([]);
  });

  it("flags stale UI terminal mirrors against an API response for the same turn", () => {
    const rail = baseRail();
    const apiAnswer = "The available Helix Ask tools are exposed through the runtime capability catalog.";

    const violations = collectUiApiTerminalParityViolations({
      uiDebugExport: {
        active_turn_id: "ask:ui-api-parity:shared",
        active_prompt: "What tools are available for the helix ask to use?",
        selected_final_answer: "I could not complete that turn.\nCause: terminal_kind_not_required.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "terminal_kind_not_required",
        codex_parity_agent_spine_rail_table: {
          ...rail,
          selected_terminal_kind: "typed_failure",
          visible_terminal_kind: "typed_failure",
          rail_status: "fail_closed",
          rail_failure_code: "terminal_kind_not_required",
        },
        ui_debug_parity_harness: {
          visible_final_answer: "I could not complete that turn.\nCause: terminal_kind_not_required.",
        },
      },
      apiResponse: {
        turn_id: "ask:ui-api-parity:shared",
        question: "What tools are available for the helix ask to use?",
        selected_final_answer: apiAnswer,
        terminal_artifact_kind: "capability_help_summary",
        terminal_error_code: null,
        codex_parity_agent_spine_rail_table: rail,
      },
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        "ui_api_terminal_kind_mismatch:typed_failure!=capability_help_summary",
        "ui_api_terminal_error_mismatch:terminal_kind_not_required!=null",
        "ui_api_rail_selected_terminal_kind_mismatch:typed_failure!=capability_help_summary",
        "ui_api_rail_visible_terminal_kind_mismatch:typed_failure!=capability_help_summary",
        "ui_api_visible_answer_mismatch",
      ]),
    );
  });

  it("flags stale UI/API compound first-incomplete subgoal rail mirrors", () => {
    const uiRail = {
      ...compoundFailureRail(),
      first_incomplete_compound_subgoal_id: "subgoal:1",
      first_incomplete_compound_requested_capability: "docs-viewer.locate_in_doc",
      compound_rail_failure_code: "observation_missing",
    };
    const apiRail = compoundFailureRail();

    const violations = collectUiApiTerminalParityViolations({
      uiDebugExport: {
        active_turn_id: "ask:ui-api-parity:shared",
        active_prompt:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: uiRail,
      },
      apiResponse: {
        turn_id: "ask:ui-api-parity:shared",
        question:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: apiRail,
      },
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        "ui_api_rail_first_incomplete_compound_subgoal_id_mismatch:subgoal:1!=subgoal:2",
        "ui_api_rail_first_incomplete_compound_requested_capability_mismatch:docs-viewer.locate_in_doc!=scientific-calculator.solve_expression",
        "ui_api_rail_compound_rail_failure_code_mismatch:observation_missing!=invalid_arg:latex_is_prose",
      ]),
    );
  });

  it("flags UI/API ordered compound subgoal rail divergence even when top-level mirrors match", () => {
    const rail = compoundFailureRail();
    const uiRails = compoundSubgoalRails();
    const apiRails = compoundSubgoalRails().map((entry) =>
      entry.subgoal_id === "subgoal:2"
        ? {
            ...entry,
            args: { latex: "2+2" },
            executed_capability: "scientific-calculator.solve_expression",
            observation_kind: "calculator_receipt",
            observation_ref: "ask:ui-api-parity:calculator_receipt",
            satisfaction: "satisfied",
            rail_status: "complete",
            first_broken_rail: null,
            rail_failure_code: null,
            repair_target: null,
          }
        : entry,
    );

    const violations = collectUiApiTerminalParityViolations({
      uiDebugExport: {
        active_turn_id: "ask:ui-api-parity:shared",
        active_prompt:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
        compound_subgoal_rail_statuses: uiRails,
      },
      apiResponse: {
        turn_id: "ask:ui-api-parity:shared",
        question:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
        compound_subgoal_rail_statuses: apiRails,
      },
    });

    expect(violations).toContain("ui_api_compound_subgoal_rails_mismatch");
  });

  it("flags UI/API compound subgoal contract and provenance divergence", () => {
    const rail = compoundFailureRail();
    const uiRails = compoundSubgoalRails();
    const apiRails = compoundSubgoalRails().map((entry) =>
      entry.subgoal_id === "subgoal:1"
        ? {
            ...entry,
            observation_provenance: "model_generated_location",
            required_observation_kinds: ["doc_summary"],
            required_terminal_kind: "doc_summary",
            terminal_contribution_kind: "doc_summary",
            contribution_role: "summary",
            forbidden_nearby_capabilities: ["model.direct_answer"],
          }
        : entry,
    );

    const violations = collectUiApiTerminalParityViolations({
      uiDebugExport: {
        active_turn_id: "ask:ui-api-parity:shared",
        active_prompt:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
        compound_subgoal_rail_statuses: uiRails,
      },
      apiResponse: {
        turn_id: "ask:ui-api-parity:shared",
        question:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
        compound_subgoal_rail_statuses: apiRails,
      },
    });

    expect(violations).toEqual(expect.arrayContaining([
      "ui_api_compound_subgoal_rails_mismatch",
    ]));
  });

  it("flags shared UI/API complete compound subgoal rails without observation proof", () => {
    const rail = compoundFailureRail();
    const badRails = compoundSubgoalRails().map((entry) =>
      entry.subgoal_id === "subgoal:1"
        ? {
            ...entry,
            observation_ref: null,
            satisfaction: "satisfied",
            rail_status: "complete",
          }
        : entry,
    );

    const violations = collectUiApiTerminalParityViolations({
      uiDebugExport: {
        active_turn_id: "ask:ui-api-parity:shared",
        active_prompt:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
        compound_subgoal_rail_statuses: badRails,
      },
      apiResponse: {
        turn_id: "ask:ui-api-parity:shared",
        question:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
        compound_subgoal_rail_statuses: badRails,
      },
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        "ui_compound_subgoal_1_satisfied_observation_ref_missing",
        "ui_compound_subgoal_1_complete_observation_ref_missing",
        "api_compound_subgoal_1_satisfied_observation_ref_missing",
        "api_compound_subgoal_1_complete_observation_ref_missing",
      ]),
    );
    expect(violations).not.toContain("ui_api_compound_subgoal_rails_mismatch");
  });

  it("flags UI/API compound subgoal order divergence", () => {
    const rail = compoundFailureRail();
    const uiRails = compoundSubgoalRails();
    const apiRails = compoundSubgoalRails().map((entry) =>
      entry.subgoal_id === "subgoal:2"
        ? {
            ...entry,
            order: 1,
          }
        : {
            ...entry,
            order: 2,
          },
    );

    const violations = collectUiApiTerminalParityViolations({
      uiDebugExport: {
        active_turn_id: "ask:ui-api-parity:shared",
        active_prompt:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
        compound_subgoal_rail_statuses: uiRails,
      },
      apiResponse: {
        turn_id: "ask:ui-api-parity:shared",
        question:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
        compound_subgoal_rail_statuses: apiRails,
      },
    });

    expect(violations).toContain("ui_api_compound_subgoal_rails_mismatch");
  });

  it("flags UI/API compound subgoal binding divergence", () => {
    const rail = compoundFailureRail();
    const uiRails = compoundSubgoalRails();
    const apiRails = compoundSubgoalRails().map((entry) =>
      entry.subgoal_id === "subgoal:2"
        ? {
            ...entry,
            input_bindings: [],
            unresolved_input_bindings: [],
          }
        : entry,
    );

    const violations = collectUiApiTerminalParityViolations({
      uiDebugExport: {
        active_turn_id: "ask:ui-api-parity:shared",
        active_prompt:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
        compound_subgoal_rail_statuses: uiRails,
      },
      apiResponse: {
        turn_id: "ask:ui-api-parity:shared",
        question:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
        compound_subgoal_rail_statuses: apiRails,
      },
    });

    expect(violations).toContain("ui_api_compound_subgoal_rails_mismatch");
  });

  it("flags UI/API compound subgoal argument metadata divergence", () => {
    const rail = compoundFailureRail();
    const uiRails = compoundSubgoalRails();
    const apiRails = compoundSubgoalRails().map((entry) =>
      entry.subgoal_id === "subgoal:2"
        ? {
            ...entry,
            args_source: "ui_projection",
            planned_args: { latex: "2+2" },
            required_args: [],
          }
        : entry,
    );

    const violations = collectUiApiTerminalParityViolations({
      uiDebugExport: {
        active_turn_id: "ask:ui-api-parity:shared",
        active_prompt:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
        compound_subgoal_rail_statuses: uiRails,
      },
      apiResponse: {
        turn_id: "ask:ui-api-parity:shared",
        question:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
        compound_subgoal_rail_statuses: apiRails,
      },
    });

    expect(violations).toContain("ui_api_compound_subgoal_rails_mismatch");
  });

  it("flags missing compound subgoal rail mirrors when top-level rails declare a compound turn", () => {
    const rail = compoundFailureRail();

    const violations = collectUiApiTerminalParityViolations({
      uiDebugExport: {
        active_turn_id: "ask:ui-api-parity:shared",
        active_prompt:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
      },
      apiResponse: {
        turn_id: "ask:ui-api-parity:shared",
        question:
          "Use docs-viewer.locate_in_doc, then call scientific-calculator.solve_expression with this exact expression: explain why receipts matter.",
        selected_final_answer: "I could not complete that turn.\nCause: invalid_arg:latex_is_prose.",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "invalid_arg:latex_is_prose",
        codex_parity_agent_spine_rail_table: rail,
      },
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        "ui_compound_subgoal_rails_missing:0<2",
        "api_compound_subgoal_rails_missing:0<2",
      ]),
    );
  });

  it("does not require exact answer text for separate turns with matching terminal semantics", () => {
    const rail = baseRail();

    expect(
      collectUiApiTerminalParityViolations({
        uiDebugExport: {
          active_turn_id: "ask:ui-api-parity:ui",
          active_prompt: "What tools are available for the helix ask to use?",
          selected_final_answer: "Tool catalog answer phrased one way.",
          terminal_artifact_kind: "capability_help_summary",
          codex_parity_agent_spine_rail_table: rail,
          ui_debug_parity_harness: {
            visible_final_answer: "Tool catalog answer phrased one way.",
          },
        },
        apiResponse: {
          turn_id: "ask:ui-api-parity:api",
          question: "What tools are available for the helix ask to use?",
          selected_final_answer: "Tool catalog answer phrased another way.",
          terminal_artifact_kind: "capability_help_summary",
          codex_parity_agent_spine_rail_table: rail,
        },
      }),
    ).toEqual([]);
  });

  it("uses an operator-provided session id for UI/API parity comparisons", () => {
    expect(
      buildUiApiParitySessionId({
        configuredSessionId: "helix-shared-session",
        prompt: "Open the scientific calculator, solve 2*(3+4), and explain the steps.",
        turnId: "ask:ignored",
        index: 2,
      }),
    ).toBe("helix-shared-session");
  });

  it("derives a stable API parity session id from the UI turn when no session is configured", () => {
    expect(
      buildUiApiParitySessionId({
        prompt: "Open the scientific calculator, solve 2*(3+4), and explain the steps.",
        turnId: "ask:calculator natural turn",
        index: 2,
      }),
    ).toBe("helix-ask:ui-api-parity:ask:calculator-natural-turn");
  });

  it("falls back to a prompt-based API parity session id when the UI turn id is unavailable", () => {
    expect(
      buildUiApiParitySessionId({
        prompt: "What tools are available for the helix ask to use?",
        index: 1,
      }),
    ).toBe("helix-ask:ui-api-parity:what-tools-are-available-for-the-helix-ask-to-use");
  });

  it("labels UI/API parity runs from server bundles that predate local runtime changes", () => {
    expect(
      uiServerBundleFreshnessWarnings({
        serverBuildStartedAtMs: 1_000,
        latestLocalRuntimeChangeMs: 2_500,
        changedRuntimeFiles: [
          "server/routes/agi.plan.ts",
          "server/services/helix-ask/terminal-rail-failure-reconciliation.ts",
        ],
      }),
    ).toEqual(["server_bundle_predates_local_runtime_changes:1000<2500:changed_files=2"]);
  });

  it("does not warn when UI/API parity runs use a fresh bundle", () => {
    expect(
      uiServerBundleFreshnessWarnings({
        serverBuildStartedAtMs: 3_000,
        latestLocalRuntimeChangeMs: 2_500,
        changedRuntimeFiles: ["server/routes/agi.plan.ts"],
      }),
    ).toEqual([]);
  });

  it("summarizes stale-server UI/API warning downgrades at the report root", () => {
    expect(
      summarizeUiDebugParityWarnings([
        {
          warnings: [
            "server_bundle_predates_local_runtime_changes:1000<2500:changed_files=2",
            "untrusted_violation_due_to_stale_server_bundle:ui_terminal_authority_text_mismatch",
            "untrusted_violation_due_to_stale_server_bundle:ui_api_terminal_kind_mismatch:typed_failure!=capability_help_summary",
          ],
        },
      ]),
    ).toEqual({
      warning_count: 3,
      stale_server_bundle_count: 1,
      untrusted_violation_count: 2,
      capacity_or_admission_stress_count: 0,
    });
  });

  it("marks stale or capacity-limited UI/API reports as untrusted goal proof", () => {
    expect(
      uiDebugParityGoalProofTrust({
        stale_server_bundle_count: 1,
        untrusted_violation_count: 0,
        capacity_or_admission_stress_count: 0,
      }, 1),
    ).toEqual({
      trusted_for_goal_acceptance: false,
      requires_keyed_server_restart: true,
      capacity_or_admission_limited: false,
      executed_result_count: 1,
    });
    expect(
      uiDebugParityGoalProofTrust({
        stale_server_bundle_count: 0,
        untrusted_violation_count: 0,
        capacity_or_admission_stress_count: 1,
      }, 1),
    ).toEqual({
      trusted_for_goal_acceptance: false,
      requires_keyed_server_restart: false,
      capacity_or_admission_limited: true,
      executed_result_count: 1,
    });
    expect(
      uiDebugParityGoalProofTrust({
        stale_server_bundle_count: 0,
        untrusted_violation_count: 0,
        capacity_or_admission_stress_count: 0,
      }, 1),
    ).toEqual({
      trusted_for_goal_acceptance: true,
      requires_keyed_server_restart: false,
      capacity_or_admission_limited: false,
      executed_result_count: 1,
    });
    expect(
      uiDebugParityGoalProofTrust({
        stale_server_bundle_count: 0,
        untrusted_violation_count: 0,
        capacity_or_admission_stress_count: 0,
      }),
    ).toMatchObject({
      trusted_for_goal_acceptance: false,
      executed_result_count: 0,
    });
  });

  it("turns untrusted UI/API goal proof into a failing process exit code when proof is required", () => {
    expect(
      uiDebugParityProcessExitCode(true, true, {
        trusted_for_goal_acceptance: false,
      }),
    ).toBe(1);
    expect(
      uiDebugParityProcessExitCode(true, true, {
        trusted_for_goal_acceptance: true,
      }),
    ).toBe(0);
    expect(
      uiDebugParityProcessExitCode(true, false, {
        trusted_for_goal_acceptance: false,
      }),
    ).toBe(0);
    expect(
      uiDebugParityProcessExitCode(false, false, {
        trusted_for_goal_acceptance: true,
      }),
    ).toBe(1);
  });

  it("includes the natural calculator acceptance prompt in the default UI parity set", () => {
    expect(DEFAULT_PROMPTS).toEqual(
      expect.arrayContaining([
        {
          prompt: HELIX_ASK_NATURAL_CALCULATOR_PROMPT,
          expectCoverage: true,
          expectCalculatorPanel: true,
        },
      ]),
    );
    expect(resolveUiDebugParityPrompts("")).toEqual(DEFAULT_PROMPTS);
  });

  it("provides a broad UI/API parity prompt preset for goal-level live probes", () => {
    expect(resolveUiDebugParityPromptPreset("broad")).toEqual(BROAD_PARITY_PROMPTS);
    expect(resolveUiDebugParityPrompts("", "broad")).toEqual(BROAD_PARITY_PROMPTS);
    expect(BROAD_PARITY_PROMPTS).toEqual(
      expect.arrayContaining([
        { prompt: HELIX_ASK_TOOL_CATALOG_PROMPT },
        { prompt: HELIX_ASK_NATURAL_CALCULATOR_PROMPT, expectCoverage: true, expectCalculatorPanel: true },
        { prompt: HELIX_ASK_EXPLICIT_CALCULATOR_PROMPT, expectCoverage: true, expectCalculatorPanel: true },
        { prompt: "Use workspace_os.status to inspect workstation status." },
        { prompt: "What is happening right now in the visual screen capture?" },
        { prompt: "Do not open the docs viewer; just explain what the docs viewer is for." },
      ]),
    );
  });

  it("keeps explicit UI/API prompt overrides narrower than the broad preset", () => {
    expect(resolveUiDebugParityPrompts("Prompt one", "broad")).toEqual([{ prompt: "Prompt one" }]);
    expect(resolveUiDebugParityPromptPreset("unknown")).toEqual(DEFAULT_PROMPTS);
  });

  it("summarizes calculator natural/explicit agreement for broad UI/API runs", () => {
    expect(
      summarizeUiDebugParityGoalAcceptance([
        {
          prompt: HELIX_ASK_NATURAL_CALCULATOR_PROMPT,
          visible_final_answer: "Calculator verification plan completed.\nExpression: 2*(3+4)\nResult: 14",
          warnings: [],
          action_envelope: calculatorActionEnvelope(),
          codex_parity_agent_spine_rail_table: {
            executed_capability: "scientific-calculator.solve_expression",
            observation_kind: "calculator_receipt",
            selected_terminal_kind: "workstation_tool_evaluation",
          },
        },
        {
          prompt: HELIX_ASK_EXPLICIT_CALCULATOR_PROMPT,
          visible_final_answer: "Calculator verification plan completed.\nExpression: 2*(3+4)\nResult: 14",
          warnings: [],
          action_envelope: calculatorActionEnvelope(),
          codex_parity_agent_spine_rail_table: {
            executed_capability: "scientific-calculator.solve_expression",
            observation_kind: "calculator_receipt",
            selected_terminal_kind: "workstation_tool_evaluation",
          },
        },
      ]),
    ).toEqual({
      ok: true,
      calculator_pair_selected: true,
      calculator_pair_skipped_reason: null,
      calculator_pair_failures: [],
      docs_locate_selected: false,
      docs_locate_skipped_reason: "docs_locate_prompt_not_selected",
      docs_locate_failures: [],
      visual_context_selected: false,
      visual_context_skipped_reason: "visual_context_prompt_not_selected",
      visual_context_failures: [],
    });
  });

  it("flags calculator natural/explicit divergence in the UI/API goal summary", () => {
    expect(
      summarizeUiDebugParityGoalAcceptance([
        {
          prompt: HELIX_ASK_NATURAL_CALCULATOR_PROMPT,
          visible_final_answer: "Calculator subgoal: 2*(3+4)\nResult: 2",
          warnings: [],
          codex_parity_agent_spine_rail_table: {
            executed_capability: "execute_workstation_action",
            observation_kind: "calculator_receipt",
            selected_terminal_kind: "workstation_tool_evaluation",
          },
        },
        {
          prompt: HELIX_ASK_EXPLICIT_CALCULATOR_PROMPT,
          visible_final_answer: "Calculator verification plan completed.\nExpression: 2*(3+4)\nResult: 14",
          warnings: [],
          codex_parity_agent_spine_rail_table: {
            executed_capability: "scientific-calculator.solve_expression",
            observation_kind: "calculator_receipt",
            selected_terminal_kind: "workstation_tool_evaluation",
          },
        },
      ]).calculator_pair_failures,
    ).toEqual([
      "ui_calculator_natural_explicit_executed_capability_mismatch:execute_workstation_action!=scientific-calculator.solve_expression",
      "ui_calculator_natural_expected_result_14_missing",
      "ui_calculator_natural_open_panel_action_receipt_missing",
      "ui_calculator_natural_focus_panel_action_receipt_missing",
      "ui_calculator_explicit_open_panel_action_receipt_missing",
      "ui_calculator_explicit_focus_panel_action_receipt_missing",
    ]);
  });

  it("does not treat stale-server calculator divergence as trusted UI/API goal failure", () => {
    expect(
      summarizeUiDebugParityGoalAcceptance([
        {
          prompt: HELIX_ASK_NATURAL_CALCULATOR_PROMPT,
          visible_final_answer: "Calculator subgoal: 2*(3+4)\nResult: 2",
          warnings: ["server_bundle_predates_local_runtime_changes:1000<2500:changed_files=2"],
          codex_parity_agent_spine_rail_table: {
            executed_capability: "execute_workstation_action",
            observation_kind: "calculator_receipt",
            selected_terminal_kind: "workstation_tool_evaluation",
          },
        },
        {
          prompt: HELIX_ASK_EXPLICIT_CALCULATOR_PROMPT,
          visible_final_answer: "Calculator verification plan completed.\nExpression: 2*(3+4)\nResult: 14",
          warnings: [],
          codex_parity_agent_spine_rail_table: {
            executed_capability: "scientific-calculator.solve_expression",
            observation_kind: "calculator_receipt",
            selected_terminal_kind: "workstation_tool_evaluation",
          },
        },
      ]),
    ).toEqual({
      ok: true,
      calculator_pair_selected: true,
      calculator_pair_skipped_reason: "stale_server_bundle",
      calculator_pair_failures: [],
      docs_locate_selected: false,
      docs_locate_skipped_reason: "docs_locate_prompt_not_selected",
      docs_locate_failures: [],
      visual_context_selected: false,
      visual_context_skipped_reason: "visual_context_prompt_not_selected",
      visual_context_failures: [],
    });
  });

  it("does not fail default smoke runs that do not select the explicit calculator pair", () => {
    expect(
      summarizeUiDebugParityGoalAcceptance([
        {
          prompt: HELIX_ASK_NATURAL_CALCULATOR_PROMPT,
          visible_final_answer: "Calculator verification plan completed.\nExpression: 2*(3+4)\nResult: 14",
          warnings: [],
        },
      ]),
    ).toEqual({
      ok: true,
      calculator_pair_selected: false,
      calculator_pair_skipped_reason: "explicit_calculator_prompt_not_selected",
      calculator_pair_failures: [],
      docs_locate_selected: false,
      docs_locate_skipped_reason: "docs_locate_prompt_not_selected",
      docs_locate_failures: [],
      visual_context_selected: false,
      visual_context_skipped_reason: "visual_context_prompt_not_selected",
      visual_context_failures: [],
    });
  });

  it("accepts docs locate when it completes with requested doc evidence support", () => {
    expect(
      summarizeUiDebugParityGoalAcceptance([
        {
          prompt: HELIX_ASK_DOCS_LOCATE_PROMPT,
          visible_final_answer: "Found the receipt rule in docs/helix-ask-codex-loop-discipline.md.",
          warnings: [],
          codex_parity_agent_spine_rail_table: {
            codex_parity_class: "complete",
            rail_status: "complete",
            selected_terminal_kind: "doc_location_result",
            observation_kind: "doc_location_matches",
            observed_artifact_supports_requested_capability: true,
          },
        },
      ]).docs_locate_failures,
    ).toEqual([]);
  });

  it("rejects docs locate completion backed only by a summary or generic viewer receipt", () => {
    expect(
      summarizeUiDebugParityGoalAcceptance([
        {
          prompt: HELIX_ASK_DOCS_LOCATE_PROMPT,
          visible_final_answer: "Summarized docs/helix-ask-codex-loop-discipline.md.",
          warnings: [],
          codex_parity_agent_spine_rail_table: {
            codex_parity_class: "complete",
            rail_status: "complete",
            selected_terminal_kind: "doc_summary",
            observation_kind: "docs_viewer_receipt",
            observed_artifact_supports_requested_capability: true,
          },
        },
      ]).docs_locate_failures,
    ).toEqual(["ui_docs_locate_unexpected_terminal_or_observation:doc_summary/docs_viewer_receipt"]);
  });

  it("flags docs locate terminal projection mismatch instead of counting it as correct fail-closed behavior", () => {
    expect(
      summarizeUiDebugParityGoalAcceptance([
        {
          prompt: HELIX_ASK_DOCS_LOCATE_PROMPT,
          visible_final_answer:
            "I could not produce a terminal answer because terminal authority and visible projection selected different artifacts.",
          warnings: [],
          debug_export: {
            terminal_error_code: "terminal_projection_mismatch",
          },
          codex_parity_agent_spine_rail_table: {
            codex_parity_class: "broken",
            rail_status: "fail_closed",
            first_broken_rail: "observation_artifact",
            rail_failure_code: "terminal_projection_mismatch",
            selected_terminal_kind: "typed_failure",
            observation_kind: null,
          },
        },
      ]).docs_locate_failures,
    ).toEqual([
      "ui_docs_locate_terminal_projection_mismatch",
      "ui_docs_locate_fail_closed_as_terminal_projection_mismatch",
    ]);
  });

  it("accepts visual prompts that fail closed with missing visual source context", () => {
    expect(
      summarizeUiDebugParityGoalAcceptance([
        {
          prompt: HELIX_ASK_VISUAL_CONTEXT_PROMPT,
          visible_final_answer:
            "I could not complete this visual turn because browser/UI visual source context was not available to the Ask solver.",
          warnings: [],
          debug_export: {
            terminal_error_code: "visual_evidence_missing",
          },
          codex_parity_agent_spine_rail_table: {
            selected_terminal_kind: "typed_failure",
            observation_kind: null,
            rail_failure_code: "visual_evidence_missing",
          },
        },
      ]).visual_context_failures,
    ).toEqual([]);
  });

  it("flags visual prompts that answer without visual source context", () => {
    expect(
      summarizeUiDebugParityGoalAcceptance([
        {
          prompt: HELIX_ASK_VISUAL_CONTEXT_PROMPT,
          visible_final_answer: "The screen shows a game route.",
          warnings: [],
          codex_parity_agent_spine_rail_table: {
            selected_terminal_kind: "model_synthesized_answer",
            observation_kind: "direct_answer_text",
            rail_failure_code: null,
          },
        },
      ]).visual_context_failures,
    ).toEqual([
      "ui_visual_prompt_missing_source_context_not_identified",
      "ui_visual_prompt_terminalized_without_visual_source_context:model_synthesized_answer",
    ]);
  });

  it("accepts JSON prompt overrides with harness expectations", () => {
    expect(
      resolveUiDebugParityPrompts(
        JSON.stringify([
          {
            prompt: "Open the scientific calculator, solve 2*(3+4), and explain the steps.",
            expectCoverage: true,
            expectCalculatorPanel: true,
          },
        ]),
      ),
    ).toEqual([
      {
        prompt: HELIX_ASK_NATURAL_CALCULATOR_PROMPT,
        expectCoverage: true,
        expectCalculatorPanel: true,
      },
    ]);
  });

  it("accepts delimiter prompt overrides for quick broad probing", () => {
    expect(resolveUiDebugParityPrompts("Prompt one |||| Prompt two")).toEqual([
      { prompt: "Prompt one" },
      { prompt: "Prompt two" },
    ]);
  });
});
