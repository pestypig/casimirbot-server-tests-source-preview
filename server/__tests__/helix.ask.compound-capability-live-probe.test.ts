import { describe, expect, it } from "vitest";

import {
  BROAD_LIVE_PROBE_BLOCK_MESSAGE,
  COMPOUND_CAPABILITY_LIVE_SCENARIOS,
  evaluateCompoundCapabilityScenario,
  resolveCompoundCapabilityLiveRunPolicy,
  selectCompoundCapabilityLiveScenarios,
  type CompoundCapabilityScenario,
} from "../../scripts/helix-ask-compound-capability-live-probe";

const scenarioById = (id: string): CompoundCapabilityScenario => {
  const scenario = COMPOUND_CAPABILITY_LIVE_SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`missing_scenario:${id}`);
  return scenario;
};

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const workspaceThenCalculatorDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:compound-live";
  const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:1:workspace_os_status`;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "workspace_os.status",
        executed_capability: "workspace_os.status",
        observation_kind: "workspace_os_status_observation",
        observation_ref: "obs:workspace-status",
        observation_provenance: "compound_subgoal_id",
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: {
          latex: "14*23+8",
          expression: "14*23+8",
        },
        input_bindings: [
          {
            binding_id: `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression:input_binding:1`,
            from_subgoal_id: workspaceSubgoalId,
            from_capability: "workspace_os.status",
            required_observation_kinds: ["workspace_os_status_observation"],
            arg_name: "source_ref",
            binding_kind: "source_ref",
            required: true,
            status: "bound",
          },
        ],
        bound_input_refs: [
          {
            binding_id: `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression:input_binding:1`,
            from_subgoal_id: workspaceSubgoalId,
            from_capability: "workspace_os.status",
            ref: "obs:workspace-status",
            observation_kind: "workspace_os_status_observation",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator",
        observation_provenance: "capability_key",
      },
    ],
    overrides,
  });
};

const invalidCalculatorArgsFailClosedDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:compound-invalid-args";
  const docsSubgoalId = `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`;
  return compoundDebug({
    turnId,
    terminalArtifactKind: "typed_failure",
    finalAnswerSource: "typed_failure",
    subgoals: [
      {
        requested_capability: "docs-viewer.locate_in_doc",
        runtime_capability: "docs.search",
        executed_capability: "docs.search",
        args: { query: "rule of thumb" },
        observation_kind: "doc_location_matches",
        observation_ref: "obs:doc-location",
        observation_provenance: "compound_subgoal_id",
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: null,
        args: {
          latex: "explain why receipts matter",
          expression: "explain why receipts matter",
        },
        input_bindings: [
          {
            binding_id: `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression:input_binding:1`,
            from_subgoal_id: docsSubgoalId,
            from_capability: "docs-viewer.locate_in_doc",
            required_observation_kinds: ["doc_location_result", "doc_location_matches", "doc_evidence_location"],
            arg_name: "source_ref",
            binding_kind: "source_ref",
            required: true,
            status: "bound",
          },
        ],
        observation_kind: null,
        observation_ref: null,
        observation_provenance: null,
        support_refs: [],
        satisfaction: "failed",
        rail_status: "fail_closed",
        first_broken_rail: "capability_execution",
        rail_failure_code: readString(overrides.terminal_error_code) ?? "invalid_arg:latex_is_prose",
        repair_target: "subgoal_argument_extraction",
      },
    ],
    overrides: {
      terminal_error_code: readString(overrides.terminal_error_code) ?? "invalid_arg:latex_is_prose",
      ...overrides,
    },
  });
};

const missingCalculatorArgsFailClosedDebug = () => {
  const base = invalidCalculatorArgsFailClosedDebug({
    terminal_error_code: "missing_required_arg:latex",
  });
  const payload = (base.debugExport as any).payload;
  const ledgerEntry = payload.capability_itinerary_execution_state.compound_subgoal_ledger[1];
  const railEntry = payload.artifact_query_index.compound_subgoal_rail_statuses[1];
  const contractEntry = payload.compound_capability_contract.subgoals[1];
  ledgerEntry.args = {};
  ledgerEntry.rail_failure_code = "missing_required_arg:latex";
  railEntry.args = {};
  railEntry.rail_failure_code = "missing_required_arg:latex";
  contractEntry.args_hint = {};
  return base;
};

const fixtureContractTermsForCapability = (
  capability: string,
  observationKind: string | null,
): {
  required_observation_kinds: string[];
  required_terminal_kind: string;
  allowed_substitutions: string[];
} => {
  switch (capability) {
    case "scientific-calculator.solve_expression":
      return {
        required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
        required_terminal_kind: "workstation_tool_evaluation",
        allowed_substitutions: [],
      };
    case "docs-viewer.locate_in_doc":
      return {
        required_observation_kinds: ["doc_location_result", "doc_location_matches", "doc_evidence_location"],
        required_terminal_kind: "doc_location_matches",
        allowed_substitutions: [],
      };
    case "docs-viewer.doc_equation_context":
      return {
        required_observation_kinds: ["doc_equation_context"],
        required_terminal_kind: "doc_equation_context",
        allowed_substitutions: [],
      };
    case "docs.search":
      return {
        required_observation_kinds: [
          "doc_search_results",
          "retrieval_context",
          "doc_location_result",
          "doc_location_matches",
          "doc_evidence_location",
          "doc_equation_context",
        ],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "workspace_os.status":
      return {
        required_observation_kinds: ["workspace_os_status_observation"],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "workspace-directory.resolve":
      return {
        required_observation_kinds: ["workspace_directory_resolution"],
        required_terminal_kind: "workspace_directory_resolution",
        allowed_substitutions: [],
      };
    case "repo-code.search_concept":
      return {
        required_observation_kinds: ["repo_code_evidence_observation", "repo_evidence_relevance_gate"],
        required_terminal_kind: "repo_code_evidence_answer",
        allowed_substitutions: [],
      };
    case "internet_search.web_research":
    case "internet-search.search_web":
      return {
        required_observation_kinds: ["internet_search_observation"],
        required_terminal_kind: "internet_search_answer",
        allowed_substitutions: [],
      };
    case "scholarly-research.lookup_papers":
      return {
        required_observation_kinds: ["scholarly_research_observation"],
        required_terminal_kind: "scholarly_research_answer",
        allowed_substitutions: [],
      };
    case "scholarly-research.fetch_full_text":
      return {
        required_observation_kinds: ["scholarly_full_text_observation"],
        required_terminal_kind: "scholarly_research_answer",
        allowed_substitutions: [],
      };
    case "scholarly-research.extract_numeric_parameters":
      return {
        required_observation_kinds: ["scholarly_numeric_parameter_observation"],
        required_terminal_kind: "scholarly_research_answer",
        allowed_substitutions: [],
      };
    case "helix_ask.reflect_theory_context":
    case "theory-badge-graph.reflect_discussion_context":
      return {
        required_observation_kinds: ["helix_theory_context_reflection_tool_receipt", "theory_context_reflection"],
        required_terminal_kind: "theory_context_reflection_answer",
        allowed_substitutions: [],
      };
    case "helix.theory.frontierVectorFieldTrace":
      return {
        required_observation_kinds: [
          "helix_theory_frontier_vector_field_tool_receipt",
          "theory_frontier_vector_field",
        ],
        required_terminal_kind: "theory_context_reflection_answer",
        allowed_substitutions: [],
      };
    case "helix_ask.reflect_context_attachments":
      return {
        required_observation_kinds: [
          "helix_context_reflection_tool_receipt/v1",
          "context_attachment",
          "bounded_context_reference",
        ],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "helix_ask.reflect_live_synthetic_data":
      return {
        required_observation_kinds: [
          "helix_context_reflection_tool_receipt/v1",
          "bounded_context_reference",
        ],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "helix_ask.reflect_ideology_context":
      return {
        required_observation_kinds: [
          "ideology_context_reflection/v1",
          "procedural_moral_classification/v1",
          "helix_moral_graph_reflection_tool_result",
          "workstation_tool_evaluation",
        ],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "helix_ask.bridge_theory_ideology_context":
      return {
        required_observation_kinds: ["helix_theory_ideology_bridge_tool_result", "theory_ideology_bridge"],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "helix_ask.build_civilization_scenario_frame":
      return {
        required_observation_kinds: ["civilization_scenario_frame/v1", "helix_civilization_scenario_frame_tool_result"],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "helix_ask.reflect_civilization_bounds":
      return {
        required_observation_kinds: ["civilization_bounds_roadmap/v1", "helix_civilization_bounds_tool_result"],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "live_env.query_micro_reasoner_presets":
      return {
        required_observation_kinds: [
          "live_environment_tool_observation",
          "stage_play_micro_reasoner_prompt_preset_query_result",
          "helix.workstation_goal_context_update.v1",
        ],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "live_env.draft_micro_reasoner_preset":
      return {
        required_observation_kinds: [
          "live_environment_tool_observation",
          "stage_play_micro_reasoner_prompt_preset_draft",
          "helix.workstation_goal_context_update.v1",
        ],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "live_env.route_micro_reasoner_prompt":
      return {
        required_observation_kinds: [
          "live_environment_tool_observation",
          "stage_play_micro_reasoner_prompt_delegation_result",
          "helix.workstation_goal_context_update.v1",
        ],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "live_env.read_processed_live_source_mail":
      return {
        required_observation_kinds: ["stage_play_processed_mail_packet"],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "live_env.check_live_source_mail":
    case "live_env.read_live_source_mail":
      return {
        required_observation_kinds: ["stage_play_live_source_mail_read_result"],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "live_env.process_live_source_mail":
      return {
        required_observation_kinds: ["stage_play_live_source_mail_read_result", "stage_play_processed_mail_packet"],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "live_env.reflect_live_source_mail_loop":
      return {
        required_observation_kinds: ["stage_play_live_source_mail_loop_reflection"],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "live_env.record_live_source_mail_decision":
      return {
        required_observation_kinds: ["stage_play_processed_mail_packet", "stage_play_live_source_mail_decision"],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "live_env.request_interim_voice_callout":
      return {
        required_observation_kinds: [
          "stage_play_live_source_mail_decision",
          "live_source_interim_voice_callout_receipt",
          "voice_hold_receipt",
          "voice_block_receipt",
          "voice_receipt",
        ],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "live_env.query_live_source_quality":
      return {
        required_observation_kinds: ["stage_play_live_source_quality", "helix.workstation_goal_context_update.v1"],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "live_env.query_workstation_goal_context":
      return {
        required_observation_kinds: [
          "stage_play_workstation_goal_context_read_result",
          "helix.agent_goal_session.v1",
        ],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "live_env.summarize_live_source_current_state":
      return {
        required_observation_kinds: ["stage_play_live_source_current_state", "helix.workstation_goal_context_update.v1"],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
    case "image_lens.inspect":
    case "situation-room.describe_visual_capture":
      return {
        required_observation_kinds: ["visual_frame_evidence", "situation_context_pack", "visual_capture_coverage"],
        required_terminal_kind: "situation_context_pack",
        allowed_substitutions: capability === "image_lens.inspect" ? ["situation-room.describe_visual_capture"] : [],
      };
    case "helix_ask.inspect_capability_catalog":
      return {
        required_observation_kinds: ["capability_registry"],
        required_terminal_kind: "capability_help_summary",
        allowed_substitutions: [],
      };
    case "helix_ask.reflect_workstation_tool_alignment":
      return {
        required_observation_kinds: ["capability_registry"],
        required_terminal_kind: "capability_help_summary",
        allowed_substitutions: [],
      };
    default:
      return {
        required_observation_kinds: observationKind ? [observationKind] : [],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      };
  }
};

const fixtureRequiredArgsForCapability = (capability: string): string[] => {
  switch (capability) {
    case "scientific-calculator.solve_expression":
      return ["latex"];
    case "docs-viewer.locate_in_doc":
    case "docs-viewer.doc_equation_context":
    case "repo-code.search_concept":
    case "workspace-directory.resolve":
    case "internet_search.web_research":
    case "internet-search.search_web":
    case "scholarly-research.lookup_papers":
      return ["query"];
    case "scholarly-research.fetch_full_text":
      return ["paper_result_or_source"];
    case "scholarly-research.extract_numeric_parameters":
      return ["text_evidence"];
    case "live_env.draft_micro_reasoner_preset":
      return ["scenario_text"];
    case "live_env.route_micro_reasoner_prompt":
      return ["source_summary"];
    default:
      return [];
  }
};

const fixtureOptionalArgsForCapability = (capability: string): string[] => {
  switch (capability) {
    case "scientific-calculator.solve_expression":
      return ["expression", "equation"];
    case "docs-viewer.locate_in_doc":
      return ["path", "anchor", "term", "text"];
    case "docs-viewer.doc_equation_context":
      return ["path", "anchor", "query", "selected_text"];
    case "helix_ask.inspect_capability_catalog":
      return ["query", "family", "include_hidden"];
    case "helix_ask.reflect_workstation_tool_alignment":
      return ["query", "include_matrix", "families"];
    case "helix_ask.reflect_context_attachments":
      return ["context_ref", "context_refs", "source_refs"];
    case "helix.theory.frontierVectorFieldTrace":
      return ["query", "source_refs"];
    case "helix_ask.reflect_live_synthetic_data":
      return ["source_refs", "deck_ref", "mailbox_ref"];
    case "workspace-directory.resolve":
      return ["uri", "path", "target", "target_kinds", "limit"];
    case "live_env.query_micro_reasoner_presets":
      return ["query", "include_presets", "limit", "source_id", "source_ids", "preset_id"];
    case "live_env.draft_micro_reasoner_preset":
      return ["base_preset_id", "candidate_prompts"];
    case "live_env.route_micro_reasoner_prompt":
      return ["candidate_prompts"];
    case "scholarly-research.fetch_full_text":
      return ["paper_result_id", "paper_id", "result_id", "doi", "arxiv_id", "arxivId", "source_url", "pdf_url", "full_text_url", "url"];
    case "scholarly-research.extract_numeric_parameters":
      return ["source_ref", "full_text_observation", "requested_variables", "variables"];
    case "image_lens.inspect":
    case "situation-room.describe_visual_capture":
      return ["view_state", "source_id", "regions"];
    default:
      return [];
  }
};

const compoundDebug = (input: {
  turnId: string;
  terminalArtifactKind?: string;
  finalAnswerSource?: string;
  subgoals: Array<{
    requested_capability: string;
    runtime_capability?: string;
    executed_capability: string | null;
    args?: Record<string, unknown>;
    required_args?: string[];
    optional_args?: string[];
    required_observation_kinds?: string[];
    required_terminal_kind?: string;
    allowed_substitutions?: string[];
    forbidden_nearby_capabilities?: string[];
    input_bindings?: Array<Record<string, unknown>>;
    observation_kind: string | null;
    observation_ref: string | null;
    observation_provenance?: string | null;
    support_refs?: string[];
    contribution_role?: string;
    terminal_contribution_kind?: string;
    bound_input_refs?: Array<Record<string, unknown>>;
    unresolved_input_bindings?: Array<Record<string, unknown>>;
    satisfaction?: string;
    rail_status?: string;
    first_broken_rail?: string | null;
    rail_failure_code?: string | null;
    repair_target?: string | null;
  }>;
  overrides?: Record<string, unknown>;
}) => {
  const terminalArtifactKind = input.terminalArtifactKind ?? "model_synthesized_answer";
  const finalAnswerSource = input.finalAnswerSource ?? "final_answer_draft";
  const ledger = input.subgoals.map((entry, index) => {
    const subgoalId = `${input.turnId}:compound_capability_subgoal:${index + 1}:${entry.requested_capability.replace(/[^A-Za-z0-9_-]+/g, "_")}`;
    const contractTerms = fixtureContractTermsForCapability(entry.requested_capability, entry.observation_kind);
    const requiredArgs = entry.required_args ?? fixtureRequiredArgsForCapability(entry.requested_capability);
    const optionalArgs = entry.optional_args ?? fixtureOptionalArgsForCapability(entry.requested_capability);
    const args = entry.args ?? {};
    return {
      subgoal_id: subgoalId,
      order: index + 1,
      requested_capability: entry.requested_capability,
      runtime_capability: entry.runtime_capability ?? entry.requested_capability,
      selected_capability: entry.runtime_capability ?? entry.requested_capability,
      executed_capability: entry.executed_capability,
      args,
      planned_args: args,
      selected_args: args,
      required_args: requiredArgs,
      optional_args: optionalArgs,
      required_observation_kinds: entry.required_observation_kinds ?? contractTerms.required_observation_kinds,
      required_terminal_kind: entry.required_terminal_kind ?? contractTerms.required_terminal_kind,
      allowed_substitutions: entry.allowed_substitutions ?? contractTerms.allowed_substitutions,
      forbidden_nearby_capabilities:
        entry.forbidden_nearby_capabilities ??
        ["model.direct_answer"],
      input_bindings: entry.input_bindings ?? [],
      observation_kind: entry.observation_kind,
      observation_ref: entry.observation_ref,
      observation_provenance:
        entry.observation_provenance ??
        (entry.observation_ref && (entry.satisfaction ?? "satisfied") === "satisfied" ? "capability_key" : null),
      support_refs: entry.support_refs ?? (entry.observation_ref ? [entry.observation_ref] : []),
      contribution_role: entry.contribution_role ?? (index === input.subgoals.length - 1 ? "terminal_component" : "evidence"),
      terminal_contribution_kind:
        entry.terminal_contribution_kind ??
        entry.required_terminal_kind ??
        contractTerms.required_terminal_kind,
      bound_input_refs: entry.bound_input_refs ?? [],
      unresolved_input_bindings: entry.unresolved_input_bindings ?? [],
      satisfaction: entry.satisfaction ?? "satisfied",
      rail_status: entry.rail_status ?? "complete",
      first_broken_rail: entry.first_broken_rail ?? null,
      rail_failure_code: entry.rail_failure_code ?? null,
      repair_target: entry.repair_target ?? null,
    };
  });
  const railStatuses = ledger.map((entry) => ({
    ...entry,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  }));
  const contractSubgoals = ledger.map((entry) => ({
    subgoal_id: entry.subgoal_id,
    order: entry.order,
    requested_capability: entry.requested_capability,
    runtime_capability: input.subgoals[entry.order - 1]?.runtime_capability ?? entry.requested_capability,
    args_hint: entry.args,
    args: entry.args,
    planned_args: entry.planned_args,
    selected_args: entry.selected_args,
    required_args: entry.required_args,
    optional_args: entry.optional_args,
    required_observation_kinds: entry.required_observation_kinds,
    required_terminal_kind: entry.required_terminal_kind,
    allowed_substitutions: entry.allowed_substitutions,
    forbidden_nearby_capabilities: entry.forbidden_nearby_capabilities,
    contribution_role: entry.contribution_role,
    terminal_contribution_kind: entry.terminal_contribution_kind,
    depends_on_subgoal_ids: Array.from(new Set(
      entry.input_bindings
        .map((binding) => readString(binding.from_subgoal_id))
        .filter((value): value is string => Boolean(value)),
    )),
    input_bindings: entry.input_bindings,
  }));
  const plannedSteps = contractSubgoals.map((entry) => ({
    step_id: entry.subgoal_id,
    requested_capability: entry.requested_capability,
    runtime_capability: entry.runtime_capability,
    compound_subgoal_id: entry.subgoal_id,
    args_hint: entry.args_hint,
    args: entry.args_hint,
    planned_args: entry.planned_args,
    selected_args: entry.selected_args,
    depends_on_subgoal_ids: entry.depends_on_subgoal_ids,
    input_bindings: entry.input_bindings,
    required_observation_kinds: entry.required_observation_kinds,
    terminal_contribution_kind: entry.terminal_contribution_kind,
    forbidden_nearby_capabilities: entry.forbidden_nearby_capabilities,
    status: "planned",
  }));
  const incompleteRows = ledger.filter((entry) =>
    entry.satisfaction !== "satisfied" ||
    entry.rail_status !== "complete" ||
    !entry.observation_ref
  );
  const firstIncomplete = incompleteRows[0] ?? null;
  const missingSummary = {
    missing_compound_subgoal_ids: incompleteRows.map((entry) => entry.subgoal_id),
    missing_required_capabilities: incompleteRows.map((entry) => entry.requested_capability),
    next_missing_subgoal_id: firstIncomplete?.subgoal_id ?? null,
    complete: incompleteRows.length === 0,
    assistant_answer: false,
    raw_content_included: false,
  };
  const codexParityRailTable = {
    compound_subgoal_count: ledger.length,
    first_incomplete_compound_subgoal_id: firstIncomplete?.subgoal_id ?? null,
    first_incomplete_compound_requested_capability: firstIncomplete?.requested_capability ?? null,
    first_incomplete_compound_runtime_capability: firstIncomplete?.runtime_capability ?? null,
    first_incomplete_compound_selected_capability: firstIncomplete?.selected_capability ?? null,
    first_incomplete_compound_executed_capability: firstIncomplete?.executed_capability ?? null,
    compound_incomplete_subgoal_did_tool_run: firstIncomplete ? Boolean(firstIncomplete.executed_capability) : null,
    compound_first_broken_rail: firstIncomplete?.first_broken_rail ?? null,
    compound_rail_failure_code: firstIncomplete?.rail_failure_code ?? null,
    compound_repair_target: firstIncomplete?.repair_target ?? null,
    assistant_answer: false,
    raw_content_included: false,
  };
  const payload = {
    terminal_artifact_kind: terminalArtifactKind,
    terminal_presentation: {
      terminal_artifact_kind: terminalArtifactKind,
    },
    final_answer_source: finalAnswerSource,
    compound_capability_contract: {
      schema: "helix.compound_capability_contract.v1",
      turn_id: input.turnId,
      subgoals: contractSubgoals,
    },
    capability_itinerary: {
      schema: "helix.capability_itinerary.v1",
      turn_id: input.turnId,
      planned_steps: plannedSteps,
      terminal_success_criteria: {
        requires_post_observation_synthesis: true,
        compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
        required_observation_families: [],
        required_capabilities: ledger.map((entry) => entry.requested_capability),
        allowed_terminal_artifact_kinds: [terminalArtifactKind, "model_synthesized_answer", "compound_evidence_synthesis_answer"],
        forbidden_terminal_artifact_kinds: ["tool_receipt", "calculator_receipt", "doc_open_receipt", "workspace_action_receipt"],
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        turn_id: input.turnId,
        subgoals: contractSubgoals,
      },
    },
    capability_itinerary_execution_state: {
      complete: incompleteRows.length === 0,
      missing_compound_subgoal_ids: missingSummary.missing_compound_subgoal_ids,
      missing_required_capabilities: missingSummary.missing_required_capabilities,
      next_missing_subgoal_id: missingSummary.next_missing_subgoal_id,
      compound_subgoal_ledger: ledger,
    },
    codex_parity_agent_spine_rail_table: codexParityRailTable,
    artifact_query_index: {
      compound_subgoal_rail_statuses: railStatuses,
      compound_subgoal_missing_summary: missingSummary,
      codex_parity_agent_spine_rail_table: codexParityRailTable,
    },
    ...(input.overrides ?? {}),
  };
  return {
    ask: {
      turn_id: input.turnId,
      terminal_artifact_kind: terminalArtifactKind,
      final_answer_source: finalAnswerSource,
    },
    debugExport: {
      schema: "helix.ask.debug_export.v1",
      payload,
    },
  };
};

const internetReflectionCalculatorDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:internet-reflection-calculator";
  const researchSubgoalId = `${turnId}:compound_capability_subgoal:1:internet_search_web_research`;
  const reflectionSubgoalId = `${turnId}:compound_capability_subgoal:2:helix_ask_reflect_theory_context`;
  const bindingId = `${reflectionSubgoalId}:input_binding:1`;
  const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:3:scientific-calculator_solve_expression`;
  const calculatorResearchBindingId = `${calculatorSubgoalId}:input_binding:1`;
  const calculatorReflectionBindingId = `${calculatorSubgoalId}:input_binding:2`;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "internet_search.web_research",
        runtime_capability: "internet-search.search_web",
        executed_capability: "internet-search.search_web",
        args: {
          query: "Alcubierre metric energy estimates",
        },
        required_args: ["query"],
        observation_kind: "internet_search_observation",
        observation_ref: "obs:web-search",
      },
      {
        requested_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        args: {
          prompt: "connect source to receipts-as-observations",
          source_ref: "obs:web-search",
        },
        input_bindings: [
          {
            binding_id: bindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: researchSubgoalId,
            from_capability: "internet_search.web_research",
            required_observation_kinds: ["internet_search_observation"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "theory_context_reflection",
        observation_ref: "obs:reflection",
        bound_input_refs: [
          {
            binding_id: bindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: researchSubgoalId,
            from_capability: "internet_search.web_research",
            ref: "obs:web-search",
          },
        ],
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: {
          latex: "(9+3)*7-25",
          expression: "(9+3)*7-25",
        },
        required_args: ["latex"],
        optional_args: ["expression", "equation"],
        input_bindings: [
          {
            binding_id: calculatorResearchBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: researchSubgoalId,
            from_capability: "internet_search.web_research",
            required_observation_kinds: ["internet_search_observation"],
            required: true,
            status: "pending",
          },
          {
            binding_id: calculatorReflectionBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_theory_context",
            required_observation_kinds: ["helix_theory_context_reflection_tool_receipt", "theory_context_reflection"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator",
        support_refs: ["obs:web-search", "obs:reflection", "obs:calculator"],
        bound_input_refs: [
          {
            binding_id: calculatorResearchBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: researchSubgoalId,
            from_capability: "internet_search.web_research",
            ref: "obs:web-search",
          },
          {
            binding_id: calculatorReflectionBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_theory_context",
            ref: "obs:reflection",
          },
        ],
      },
    ],
    overrides,
  });
};

const scholarlyReflectionCalculatorDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:scholarly-reflection-calculator";
  const researchSubgoalId = `${turnId}:compound_capability_subgoal:1:scholarly-research_lookup_papers`;
  const reflectionSubgoalId = `${turnId}:compound_capability_subgoal:2:helix_ask_reflect_theory_context`;
  const bindingId = `${reflectionSubgoalId}:input_binding:1`;
  const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:3:scientific-calculator_solve_expression`;
  const calculatorResearchBindingId = `${calculatorSubgoalId}:input_binding:1`;
  const calculatorReflectionBindingId = `${calculatorSubgoalId}:input_binding:2`;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "scholarly-research.lookup_papers",
        executed_capability: "scholarly-research.lookup_papers",
        args: {
          query: "Alcubierre metric energy estimates",
        },
        required_args: ["query"],
        observation_kind: "scholarly_research_observation",
        observation_ref: "obs:scholarly-lookup",
      },
      {
        requested_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        args: {
          prompt: "connect scholarly source to receipts-as-observations",
          source_ref: "obs:scholarly-lookup",
        },
        input_bindings: [
          {
            binding_id: bindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: researchSubgoalId,
            from_capability: "scholarly-research.lookup_papers",
            required_observation_kinds: ["scholarly_research_observation"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "theory_context_reflection",
        observation_ref: "obs:reflection",
        bound_input_refs: [
          {
            binding_id: bindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: researchSubgoalId,
            from_capability: "scholarly-research.lookup_papers",
            ref: "obs:scholarly-lookup",
          },
        ],
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: {
          latex: "(12+5)*3",
          expression: "(12+5)*3",
        },
        required_args: ["latex"],
        optional_args: ["expression", "equation"],
        input_bindings: [
          {
            binding_id: calculatorResearchBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: researchSubgoalId,
            from_capability: "scholarly-research.lookup_papers",
            required_observation_kinds: ["scholarly_research_observation"],
            required: true,
            status: "pending",
          },
          {
            binding_id: calculatorReflectionBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_theory_context",
            required_observation_kinds: ["helix_theory_context_reflection_tool_receipt", "theory_context_reflection"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator",
        support_refs: ["obs:scholarly-lookup", "obs:reflection", "obs:calculator"],
        bound_input_refs: [
          {
            binding_id: calculatorResearchBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: researchSubgoalId,
            from_capability: "scholarly-research.lookup_papers",
            ref: "obs:scholarly-lookup",
          },
          {
            binding_id: calculatorReflectionBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_theory_context",
            ref: "obs:reflection",
          },
        ],
      },
    ],
    overrides,
  });
};

const scholarlyFullTextReflectionCalculatorDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:scholarly-full-text-reflection-calculator";
  const lookupSubgoalId = `${turnId}:compound_capability_subgoal:1:scholarly-research_lookup_papers`;
  const fullTextSubgoalId = `${turnId}:compound_capability_subgoal:2:scholarly-research_fetch_full_text`;
  const reflectionSubgoalId = `${turnId}:compound_capability_subgoal:3:helix_ask_reflect_theory_context`;
  const fullTextBindingId = `${fullTextSubgoalId}:input_binding:1`;
  const reflectionLookupBindingId = `${reflectionSubgoalId}:input_binding:1`;
  const reflectionFullTextBindingId = `${reflectionSubgoalId}:input_binding:2`;
  const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:4:scientific-calculator_solve_expression`;
  const calculatorLookupBindingId = `${calculatorSubgoalId}:input_binding:1`;
  const calculatorFullTextBindingId = `${calculatorSubgoalId}:input_binding:2`;
  const calculatorReflectionBindingId = `${calculatorSubgoalId}:input_binding:3`;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "scholarly-research.lookup_papers",
        executed_capability: "scholarly-research.lookup_papers",
        args: {
          query: "Alcubierre metric energy estimates",
        },
        observation_kind: "scholarly_research_observation",
        observation_ref: "obs:scholarly-lookup",
      },
      {
        requested_capability: "scholarly-research.fetch_full_text",
        executed_capability: "scholarly-research.fetch_full_text",
        args: {
          paper_result_or_source: "obs:scholarly-lookup",
          paper_result_id: "obs:scholarly-lookup",
        },
        input_bindings: [
          {
            binding_id: fullTextBindingId,
            arg_name: "paper_result_or_source",
            binding_kind: "source_ref",
            from_subgoal_id: lookupSubgoalId,
            from_capability: "scholarly-research.lookup_papers",
            required_observation_kinds: ["scholarly_research_observation"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "scholarly_full_text_observation",
        observation_ref: "obs:scholarly-full-text",
        support_refs: ["obs:scholarly-lookup", "obs:scholarly-full-text"],
        bound_input_refs: [
          {
            binding_id: fullTextBindingId,
            arg_name: "paper_result_or_source",
            binding_kind: "source_ref",
            from_subgoal_id: lookupSubgoalId,
            from_capability: "scholarly-research.lookup_papers",
            ref: "obs:scholarly-lookup",
          },
        ],
      },
      {
        requested_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        args: {
          prompt: "connect paper evidence to receipts-as-observations",
          source_refs: ["obs:scholarly-lookup", "obs:scholarly-full-text"],
        },
        input_bindings: [
          {
            binding_id: reflectionLookupBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: lookupSubgoalId,
            from_capability: "scholarly-research.lookup_papers",
            required_observation_kinds: ["scholarly_research_observation"],
            required: true,
            status: "pending",
          },
          {
            binding_id: reflectionFullTextBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: fullTextSubgoalId,
            from_capability: "scholarly-research.fetch_full_text",
            required_observation_kinds: ["scholarly_full_text_observation"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "theory_context_reflection",
        observation_ref: "obs:reflection",
        support_refs: ["obs:scholarly-lookup", "obs:scholarly-full-text", "obs:reflection"],
        bound_input_refs: [
          {
            binding_id: reflectionLookupBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: lookupSubgoalId,
            from_capability: "scholarly-research.lookup_papers",
            ref: "obs:scholarly-lookup",
          },
          {
            binding_id: reflectionFullTextBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: fullTextSubgoalId,
            from_capability: "scholarly-research.fetch_full_text",
            ref: "obs:scholarly-full-text",
          },
        ],
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: {
          latex: "(2.5+1.5)*8",
          expression: "(2.5+1.5)*8",
        },
        required_args: ["latex"],
        optional_args: ["expression", "equation"],
        input_bindings: [
          {
            binding_id: calculatorLookupBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: lookupSubgoalId,
            from_capability: "scholarly-research.lookup_papers",
            required_observation_kinds: ["scholarly_research_observation"],
            required: true,
            status: "pending",
          },
          {
            binding_id: calculatorFullTextBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: fullTextSubgoalId,
            from_capability: "scholarly-research.fetch_full_text",
            required_observation_kinds: ["scholarly_full_text_observation"],
            required: true,
            status: "pending",
          },
          {
            binding_id: calculatorReflectionBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_theory_context",
            required_observation_kinds: ["helix_theory_context_reflection_tool_receipt", "theory_context_reflection"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator",
        support_refs: [
          "obs:scholarly-lookup",
          "obs:scholarly-full-text",
          "obs:reflection",
          "obs:calculator",
        ],
        bound_input_refs: [
          {
            binding_id: calculatorLookupBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: lookupSubgoalId,
            from_capability: "scholarly-research.lookup_papers",
            ref: "obs:scholarly-lookup",
          },
          {
            binding_id: calculatorFullTextBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: fullTextSubgoalId,
            from_capability: "scholarly-research.fetch_full_text",
            ref: "obs:scholarly-full-text",
          },
          {
            binding_id: calculatorReflectionBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_theory_context",
            ref: "obs:reflection",
          },
        ],
      },
    ],
    overrides,
  });
};

const workspaceDirectoryThenDocsDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:workspace-directory-then-docs";
  const directorySubgoalId = `${turnId}:compound_capability_subgoal:1:workspace-directory_resolve`;
  const docsSubgoalId = `${turnId}:compound_capability_subgoal:2:docs-viewer_locate_in_doc`;
  const docsTargetBindingId = `${docsSubgoalId}:input_binding:1`;
  return compoundDebug({
    turnId,
    terminalArtifactKind: "doc_evidence_synthesis_answer",
    subgoals: [
      {
        requested_capability: "workspace-directory.resolve",
        executed_capability: "workspace-directory.resolve",
        args: {
          query: "docs/helix-ask-codex-loop-discipline.md",
        },
        required_args: ["query"],
        optional_args: ["uri", "path", "target", "target_kinds", "limit"],
        observation_kind: "workspace_directory_resolution",
        observation_ref: "obs:workspace-directory",
      },
      {
        requested_capability: "docs-viewer.locate_in_doc",
        runtime_capability: "docs.search",
        executed_capability: "docs.search",
        args: {
          query: "rule of thumb",
          path: "docs/helix-ask-codex-loop-discipline.md",
        },
        required_args: ["query"],
        optional_args: ["path", "anchor", "term", "text"],
        input_bindings: [
          {
            binding_id: docsTargetBindingId,
            arg_name: "target_ref",
            binding_kind: "target_ref",
            from_subgoal_id: directorySubgoalId,
            from_capability: "workspace-directory.resolve",
            required_observation_kinds: ["workspace_directory_resolution"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "doc_location_matches",
        observation_ref: "obs:doc-location",
        bound_input_refs: [
          {
            binding_id: docsTargetBindingId,
            arg_name: "target_ref",
            binding_kind: "target_ref",
            from_subgoal_id: directorySubgoalId,
            from_capability: "workspace-directory.resolve",
            ref: "obs:workspace-directory",
          },
        ],
      },
    ],
    overrides,
  });
};

const docsThenCalculatorDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:docs-then-calculator";
  const docsSubgoalId = `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`;
  const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
  const calculatorBindingId = `${calculatorSubgoalId}:input_binding:1`;
  return compoundDebug({
    turnId,
    terminalArtifactKind: "doc_evidence_synthesis_answer",
    subgoals: [
      {
        requested_capability: "docs-viewer.locate_in_doc",
        runtime_capability: "docs.search",
        executed_capability: "docs.search",
        args: {
          query: "rule of thumb",
          path: "docs/helix-ask-codex-loop-discipline.md",
        },
        required_args: ["query"],
        optional_args: ["path", "anchor", "term", "text"],
        observation_kind: "doc_location_matches",
        observation_ref: "obs:doc-location",
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: {
          latex: "19+23",
          expression: "19+23",
        },
        input_bindings: [
          {
            binding_id: calculatorBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: docsSubgoalId,
            from_capability: "docs-viewer.locate_in_doc",
            required_observation_kinds: ["doc_location_result", "doc_location_matches", "doc_evidence_location"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator",
        support_refs: ["obs:doc-location", "obs:calculator"],
        bound_input_refs: [
          {
            binding_id: calculatorBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: docsSubgoalId,
            from_capability: "docs-viewer.locate_in_doc",
            ref: "obs:doc-location",
          },
        ],
      },
    ],
    overrides,
  });
};

const docsEquationContextThenCalculatorDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:docs-equation-context-then-calculator";
  const docsSubgoalId = `${turnId}:compound_capability_subgoal:1:docs-viewer_doc_equation_context`;
  const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
  const calculatorBindingId = `${calculatorSubgoalId}:input_binding:1`;
  return compoundDebug({
    turnId,
    terminalArtifactKind: "doc_evidence_synthesis_answer",
    subgoals: [
      {
        requested_capability: "docs-viewer.doc_equation_context",
        runtime_capability: "docs.search",
        executed_capability: "docs.search",
        args: {
          query: "Alcubierre metric equation",
        },
        observation_kind: "doc_equation_context",
        observation_ref: "obs:doc-equation-context",
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: {
          latex: "12*4+5",
          expression: "12*4+5",
        },
        input_bindings: [
          {
            binding_id: calculatorBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: docsSubgoalId,
            from_capability: "docs-viewer.doc_equation_context",
            required_observation_kinds: ["doc_equation_context"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator",
        support_refs: ["obs:doc-equation-context", "obs:calculator"],
        bound_input_refs: [
          {
            binding_id: calculatorBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: docsSubgoalId,
            from_capability: "docs-viewer.doc_equation_context",
            ref: "obs:doc-equation-context",
          },
        ],
      },
    ],
    overrides,
  });
};

const catalogThenWorkspaceDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:catalog-then-workspace";
  return compoundDebug({
    turnId,
    terminalArtifactKind: "model_synthesized_answer",
    subgoals: [
      {
        requested_capability: "helix_ask.inspect_capability_catalog",
        executed_capability: "helix_ask.inspect_capability_catalog",
        args: {
          include_hidden: false,
        },
        observation_kind: "capability_registry",
        observation_ref: "obs:capability-registry",
      },
      {
        requested_capability: "workspace_os.status",
        executed_capability: "workspace_os.status",
        args: {},
        observation_kind: "workspace_os_status_observation",
        observation_ref: "obs:workspace-status",
      },
    ],
    overrides,
  });
};

const workstationToolAlignmentThenWorkspaceDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:workstation-tool-alignment-then-workspace";
  return compoundDebug({
    turnId,
    terminalArtifactKind: "model_synthesized_answer",
    subgoals: [
      {
        requested_capability: "helix_ask.reflect_workstation_tool_alignment",
        executed_capability: "helix_ask.reflect_workstation_tool_alignment",
        args: {
          include_matrix: true,
        },
        observation_kind: "capability_registry",
        observation_ref: "obs:tool-alignment",
      },
      {
        requested_capability: "workspace_os.status",
        executed_capability: "workspace_os.status",
        args: {},
        observation_kind: "workspace_os_status_observation",
        observation_ref: "obs:workspace-status",
      },
    ],
    overrides,
  });
};

const repoPlusDocsDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:repo-plus-docs";
  return compoundDebug({
    turnId,
    terminalArtifactKind: "doc_evidence_synthesis_answer",
    subgoals: [
      {
        requested_capability: "repo-code.search_concept",
        executed_capability: "repo-code.search_concept",
        args: {
          query: "where terminal authority is enforced",
          concept: "terminal authority",
        },
        observation_kind: "repo_code_evidence_observation",
        observation_ref: "obs:repo-evidence",
      },
      {
        requested_capability: "docs-viewer.locate_in_doc",
        runtime_capability: "docs.search",
        executed_capability: "docs.search",
        args: {
          query: "same rule",
          path: "docs/helix-ask-codex-loop-discipline.md",
        },
        required_args: ["query"],
        optional_args: ["path", "anchor", "term", "text"],
        observation_kind: "doc_location_matches",
        observation_ref: "obs:doc-location",
      },
    ],
    overrides,
  });
};

const repoReflectionCalculatorDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:repo-reflection-calculator";
  const repoSubgoalId = `${turnId}:compound_capability_subgoal:1:repo-code_search_concept`;
  const reflectionSubgoalId = `${turnId}:compound_capability_subgoal:2:helix_ask_reflect_theory_context`;
  const reflectionBindingId = `${reflectionSubgoalId}:input_binding:1`;
  const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:3:scientific-calculator_solve_expression`;
  const calculatorRepoBindingId = `${calculatorSubgoalId}:input_binding:1`;
  const calculatorReflectionBindingId = `${calculatorSubgoalId}:input_binding:2`;
  return compoundDebug({
    turnId,
    terminalArtifactKind: "model_synthesized_answer",
    subgoals: [
      {
        requested_capability: "repo-code.search_concept",
        executed_capability: "repo-code.search_concept",
        args: {
          query: "terminal authority",
          concept: "terminal authority",
        },
        observation_kind: "repo_code_evidence_observation",
        observation_ref: "obs:repo-evidence",
      },
      {
        requested_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        args: {
          prompt: "explain the repo evidence",
          source_ref: "obs:repo-evidence",
        },
        input_bindings: [
          {
            binding_id: reflectionBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: repoSubgoalId,
            from_capability: "repo-code.search_concept",
            required_observation_kinds: ["repo_code_evidence_observation"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "theory_context_reflection",
        observation_ref: "obs:reflection",
        bound_input_refs: [
          {
            binding_id: reflectionBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: repoSubgoalId,
            from_capability: "repo-code.search_concept",
            ref: "obs:repo-evidence",
          },
        ],
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: {
          latex: "4*13",
          expression: "4*13",
        },
        required_args: ["latex"],
        optional_args: ["expression", "equation"],
        input_bindings: [
          {
            binding_id: calculatorRepoBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: repoSubgoalId,
            from_capability: "repo-code.search_concept",
            required_observation_kinds: ["repo_code_evidence_observation"],
            required: true,
            status: "pending",
          },
          {
            binding_id: calculatorReflectionBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_theory_context",
            required_observation_kinds: ["helix_theory_context_reflection_tool_receipt", "theory_context_reflection"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator",
        support_refs: ["obs:repo-evidence", "obs:reflection", "obs:calculator"],
        bound_input_refs: [
          {
            binding_id: calculatorRepoBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: repoSubgoalId,
            from_capability: "repo-code.search_concept",
            ref: "obs:repo-evidence",
          },
          {
            binding_id: calculatorReflectionBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_theory_context",
            ref: "obs:reflection",
          },
        ],
      },
    ],
    overrides,
  });
};

const docsReflectionCalculatorDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:docs-reflection-calculator";
  const docsSubgoalId = `${turnId}:compound_capability_subgoal:1:docs-viewer_locate_in_doc`;
  const reflectionSubgoalId = `${turnId}:compound_capability_subgoal:2:helix_ask_reflect_theory_context`;
  const reflectionBindingId = `${reflectionSubgoalId}:input_binding:1`;
  const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:3:scientific-calculator_solve_expression`;
  const calculatorDocsBindingId = `${calculatorSubgoalId}:input_binding:1`;
  const calculatorReflectionBindingId = `${calculatorSubgoalId}:input_binding:2`;
  return compoundDebug({
    turnId,
    terminalArtifactKind: "doc_evidence_synthesis_answer",
    subgoals: [
      {
        requested_capability: "docs-viewer.locate_in_doc",
        runtime_capability: "docs.search",
        executed_capability: "docs.search",
        args: {
          query: "receipts are observations",
        },
        required_args: ["query"],
        optional_args: ["path", "anchor", "term", "text"],
        observation_kind: "doc_location_matches",
        observation_ref: "obs:doc-location",
      },
      {
        requested_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        args: {
          prompt: "explain the document evidence",
          source_ref: "obs:doc-location",
        },
        input_bindings: [
          {
            binding_id: reflectionBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: docsSubgoalId,
            from_capability: "docs-viewer.locate_in_doc",
            required_observation_kinds: ["doc_location_result", "doc_location_matches", "doc_evidence_location"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "theory_context_reflection",
        observation_ref: "obs:reflection",
        bound_input_refs: [
          {
            binding_id: reflectionBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: docsSubgoalId,
            from_capability: "docs-viewer.locate_in_doc",
            ref: "obs:doc-location",
          },
        ],
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: {
          latex: "7*8",
          expression: "7*8",
        },
        required_args: ["latex"],
        optional_args: ["expression", "equation"],
        input_bindings: [
          {
            binding_id: calculatorDocsBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: docsSubgoalId,
            from_capability: "docs-viewer.locate_in_doc",
            required_observation_kinds: ["doc_location_result", "doc_location_matches", "doc_evidence_location"],
            required: true,
            status: "pending",
          },
          {
            binding_id: calculatorReflectionBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_theory_context",
            required_observation_kinds: ["helix_theory_context_reflection_tool_receipt", "theory_context_reflection"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator",
        support_refs: ["obs:doc-location", "obs:reflection", "obs:calculator"],
        bound_input_refs: [
          {
            binding_id: calculatorDocsBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: docsSubgoalId,
            from_capability: "docs-viewer.locate_in_doc",
            ref: "obs:doc-location",
          },
          {
            binding_id: calculatorReflectionBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_theory_context",
            ref: "obs:reflection",
          },
        ],
      },
    ],
    overrides,
  });
};

const contextReflectionCalculatorDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:context-reflection-calculator";
  const reflectionSubgoalId = `${turnId}:compound_capability_subgoal:1:helix_ask_reflect_context_attachments`;
  const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
  const calculatorBindingId = `${calculatorSubgoalId}:input_binding:1`;
  return compoundDebug({
    turnId,
    terminalArtifactKind: "model_synthesized_answer",
    subgoals: [
      {
        requested_capability: "helix_ask.reflect_context_attachments",
        executed_capability: "helix_ask.reflect_context_attachments",
        args: {
          context_ref: "attached-context",
        },
        observation_kind: "context_attachment",
        observation_ref: "obs:context-attachment",
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: {
          latex: "3*11",
          expression: "3*11",
        },
        input_bindings: [
          {
            binding_id: calculatorBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_context_attachments",
            required_observation_kinds: [
              "helix_context_reflection_tool_receipt/v1",
              "context_attachment",
              "bounded_context_reference",
            ],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator",
        support_refs: ["obs:context-attachment", "obs:calculator"],
        bound_input_refs: [
          {
            binding_id: calculatorBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_context_attachments",
            ref: "obs:context-attachment",
          },
        ],
      },
    ],
    overrides,
  });
};

const theoryFrontierTraceCalculatorDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:theory-frontier-trace-calculator";
  const traceSubgoalId = `${turnId}:compound_capability_subgoal:1:helix_theory_frontierVectorFieldTrace`;
  const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
  const calculatorBindingId = `${calculatorSubgoalId}:input_binding:1`;
  return compoundDebug({
    turnId,
    terminalArtifactKind: "model_synthesized_answer",
    subgoals: [
      {
        requested_capability: "helix.theory.frontierVectorFieldTrace",
        executed_capability: "helix.theory.frontierVectorFieldTrace",
        args: {
          query: "Helix Ask parity coverage",
        },
        observation_kind: "theory_frontier_vector_field",
        observation_ref: "obs:theory-frontier-trace",
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: {
          latex: "6*7",
          expression: "6*7",
        },
        input_bindings: [
          {
            binding_id: calculatorBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: traceSubgoalId,
            from_capability: "helix.theory.frontierVectorFieldTrace",
            required_observation_kinds: [
              "helix_theory_frontier_vector_field_tool_receipt",
              "theory_frontier_vector_field",
            ],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator",
        support_refs: ["obs:theory-frontier-trace", "obs:calculator"],
        bound_input_refs: [
          {
            binding_id: calculatorBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: traceSubgoalId,
            from_capability: "helix.theory.frontierVectorFieldTrace",
            ref: "obs:theory-frontier-trace",
          },
        ],
      },
    ],
    overrides,
  });
};

const liveSyntheticDataReflectionCalculatorDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:live-synthetic-data-reflection-calculator";
  const reflectionSubgoalId = `${turnId}:compound_capability_subgoal:1:helix_ask_reflect_live_synthetic_data`;
  const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
  const calculatorBindingId = `${calculatorSubgoalId}:input_binding:1`;
  return compoundDebug({
    turnId,
    terminalArtifactKind: "model_synthesized_answer",
    subgoals: [
      {
        requested_capability: "helix_ask.reflect_live_synthetic_data",
        executed_capability: "helix_ask.reflect_live_synthetic_data",
        args: {
          deck_ref: "live-synthetic-data",
        },
        observation_kind: "bounded_context_reference",
        observation_ref: "obs:live-synthetic-data",
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: {
          latex: "8*4",
          expression: "8*4",
        },
        input_bindings: [
          {
            binding_id: calculatorBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_live_synthetic_data",
            required_observation_kinds: [
              "helix_context_reflection_tool_receipt/v1",
              "bounded_context_reference",
            ],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator",
        support_refs: ["obs:live-synthetic-data", "obs:calculator"],
        bound_input_refs: [
          {
            binding_id: calculatorBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: reflectionSubgoalId,
            from_capability: "helix_ask.reflect_live_synthetic_data",
            ref: "obs:live-synthetic-data",
          },
        ],
      },
    ],
    overrides,
  });
};

const microReasonerPresetsThenDraftDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:micro-reasoner-presets-then-draft";
  const querySubgoalId = `${turnId}:compound_capability_subgoal:1:live_env_query_micro_reasoner_presets`;
  const draftSubgoalId = `${turnId}:compound_capability_subgoal:2:live_env_draft_micro_reasoner_preset`;
  const draftBindingId = `${draftSubgoalId}:input_binding:1`;
  const queryRequiredObservationKinds = fixtureContractTermsForCapability(
    "live_env.query_micro_reasoner_presets",
    "stage_play_micro_reasoner_prompt_preset_query_result",
  ).required_observation_kinds;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "live_env.query_micro_reasoner_presets",
        executed_capability: "live_env.query_micro_reasoner_presets",
        args: {
          include_presets: true,
          limit: 100,
          query: "inspect the micro reasoner preset catalog",
        },
        observation_kind: "stage_play_micro_reasoner_prompt_preset_query_result",
        observation_ref: "obs:micro-reasoner-presets",
      },
      {
        requested_capability: "live_env.draft_micro_reasoner_preset",
        executed_capability: "live_env.draft_micro_reasoner_preset",
        args: {
          scenario_text: "draft a live-source micro reasoner preset",
          base_preset_id: "stage_play_micro_reasoner_prompt_preset:generic-live-source:v1",
        },
        input_bindings: [
          {
            binding_id: draftBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: querySubgoalId,
            from_capability: "live_env.query_micro_reasoner_presets",
            required_observation_kinds: queryRequiredObservationKinds,
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "stage_play_micro_reasoner_prompt_preset_draft",
        observation_ref: "obs:micro-reasoner-draft",
        support_refs: ["obs:micro-reasoner-presets", "obs:micro-reasoner-draft"],
        bound_input_refs: [
          {
            binding_id: draftBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: querySubgoalId,
            from_capability: "live_env.query_micro_reasoner_presets",
            ref: "obs:micro-reasoner-presets",
          },
        ],
      },
    ],
    overrides,
  });
};

const microReasonerPresetsDraftRouteDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:micro-reasoner-presets-draft-route";
  const querySubgoalId = `${turnId}:compound_capability_subgoal:1:live_env_query_micro_reasoner_presets`;
  const draftSubgoalId = `${turnId}:compound_capability_subgoal:2:live_env_draft_micro_reasoner_preset`;
  const routeSubgoalId = `${turnId}:compound_capability_subgoal:3:live_env_route_micro_reasoner_prompt`;
  const draftBindingId = `${draftSubgoalId}:input_binding:1`;
  const routeQueryBindingId = `${routeSubgoalId}:input_binding:1`;
  const routeDraftBindingId = `${routeSubgoalId}:input_binding:2`;
  const queryRequiredObservationKinds = fixtureContractTermsForCapability(
    "live_env.query_micro_reasoner_presets",
    "stage_play_micro_reasoner_prompt_preset_query_result",
  ).required_observation_kinds;
  const draftRequiredObservationKinds = fixtureContractTermsForCapability(
    "live_env.draft_micro_reasoner_preset",
    "stage_play_micro_reasoner_prompt_preset_draft",
  ).required_observation_kinds;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "live_env.query_micro_reasoner_presets",
        executed_capability: "live_env.query_micro_reasoner_presets",
        args: {
          include_presets: true,
          limit: 100,
          query: "inspect the micro reasoner preset catalog",
        },
        observation_kind: "stage_play_micro_reasoner_prompt_preset_query_result",
        observation_ref: "obs:micro-reasoner-presets",
      },
      {
        requested_capability: "live_env.draft_micro_reasoner_preset",
        executed_capability: "live_env.draft_micro_reasoner_preset",
        args: {
          scenario_text: "draft a live-source micro reasoner preset",
          base_preset_id: "stage_play_micro_reasoner_prompt_preset:generic-live-source:v1",
        },
        input_bindings: [
          {
            binding_id: draftBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: querySubgoalId,
            from_capability: "live_env.query_micro_reasoner_presets",
            required_observation_kinds: queryRequiredObservationKinds,
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "stage_play_micro_reasoner_prompt_preset_draft",
        observation_ref: "obs:micro-reasoner-draft",
        support_refs: ["obs:micro-reasoner-presets", "obs:micro-reasoner-draft"],
        bound_input_refs: [
          {
            binding_id: draftBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: querySubgoalId,
            from_capability: "live_env.query_micro_reasoner_presets",
            ref: "obs:micro-reasoner-presets",
          },
        ],
      },
      {
        requested_capability: "live_env.route_micro_reasoner_prompt",
        executed_capability: "live_env.route_micro_reasoner_prompt",
        args: {
          source_summary: "route the drafted micro reasoner prompt",
          candidate_prompts: ["route the drafted micro reasoner prompt"],
        },
        input_bindings: [
          {
            binding_id: routeQueryBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: querySubgoalId,
            from_capability: "live_env.query_micro_reasoner_presets",
            required_observation_kinds: queryRequiredObservationKinds,
            required: true,
            status: "pending",
          },
          {
            binding_id: routeDraftBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: draftSubgoalId,
            from_capability: "live_env.draft_micro_reasoner_preset",
            required_observation_kinds: draftRequiredObservationKinds,
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "stage_play_micro_reasoner_prompt_delegation_result",
        observation_ref: "obs:micro-reasoner-route",
        support_refs: [
          "obs:micro-reasoner-presets",
          "obs:micro-reasoner-draft",
          "obs:micro-reasoner-route",
        ],
        bound_input_refs: [
          {
            binding_id: routeQueryBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: querySubgoalId,
            from_capability: "live_env.query_micro_reasoner_presets",
            ref: "obs:micro-reasoner-presets",
          },
          {
            binding_id: routeDraftBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: draftSubgoalId,
            from_capability: "live_env.draft_micro_reasoner_preset",
            ref: "obs:micro-reasoner-draft",
          },
        ],
      },
    ],
    overrides,
  });
};

const liveSourceMailReadProcessReflectDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:live-source-mail-read-process-reflect";
  const readSubgoalId = `${turnId}:compound_capability_subgoal:1:live_env_read_processed_live_source_mail`;
  const processSubgoalId = `${turnId}:compound_capability_subgoal:2:live_env_process_live_source_mail`;
  const reflectSubgoalId = `${turnId}:compound_capability_subgoal:3:live_env_reflect_live_source_mail_loop`;
  const processBindingId = `${processSubgoalId}:input_binding:1`;
  const reflectReadBindingId = `${reflectSubgoalId}:input_binding:1`;
  const reflectProcessBindingId = `${reflectSubgoalId}:input_binding:2`;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "live_env.read_processed_live_source_mail",
        executed_capability: "live_env.read_processed_live_source_mail",
        args: {},
        observation_kind: "stage_play_processed_mail_packet",
        observation_ref: "obs:processed-mail",
      },
      {
        requested_capability: "live_env.process_live_source_mail",
        executed_capability: "live_env.process_live_source_mail",
        args: {
          source_ref: "obs:processed-mail",
        },
        input_bindings: [
          {
            binding_id: processBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: readSubgoalId,
            from_capability: "live_env.read_processed_live_source_mail",
            required_observation_kinds: ["stage_play_processed_mail_packet"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "stage_play_live_source_mail_read_result",
        observation_ref: "obs:mail-process-result",
        support_refs: ["obs:processed-mail", "obs:mail-process-result"],
        bound_input_refs: [
          {
            binding_id: processBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: readSubgoalId,
            from_capability: "live_env.read_processed_live_source_mail",
            ref: "obs:processed-mail",
          },
        ],
      },
      {
        requested_capability: "live_env.reflect_live_source_mail_loop",
        executed_capability: "live_env.reflect_live_source_mail_loop",
        args: {
          source_refs: ["obs:processed-mail", "obs:mail-process-result"],
        },
        input_bindings: [
          {
            binding_id: reflectReadBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: readSubgoalId,
            from_capability: "live_env.read_processed_live_source_mail",
            required_observation_kinds: ["stage_play_processed_mail_packet"],
            required: true,
            status: "pending",
          },
          {
            binding_id: reflectProcessBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: processSubgoalId,
            from_capability: "live_env.process_live_source_mail",
            required_observation_kinds: [
              "stage_play_live_source_mail_read_result",
              "stage_play_processed_mail_packet",
            ],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "stage_play_live_source_mail_loop_reflection",
        observation_ref: "obs:mail-loop-reflection",
        support_refs: [
          "obs:processed-mail",
          "obs:mail-process-result",
          "obs:mail-loop-reflection",
        ],
        bound_input_refs: [
          {
            binding_id: reflectReadBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: readSubgoalId,
            from_capability: "live_env.read_processed_live_source_mail",
            ref: "obs:processed-mail",
          },
          {
            binding_id: reflectProcessBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: processSubgoalId,
            from_capability: "live_env.process_live_source_mail",
            ref: "obs:mail-process-result",
          },
        ],
      },
    ],
    overrides,
  });
};

const liveSourceMailReadProcessDecisionDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:live-source-mail-read-process-decision";
  const readSubgoalId = `${turnId}:compound_capability_subgoal:1:live_env_read_processed_live_source_mail`;
  const processSubgoalId = `${turnId}:compound_capability_subgoal:2:live_env_process_live_source_mail`;
  const decisionSubgoalId = `${turnId}:compound_capability_subgoal:3:live_env_record_live_source_mail_decision`;
  const processBindingId = `${processSubgoalId}:input_binding:1`;
  const decisionReadBindingId = `${decisionSubgoalId}:input_binding:1`;
  const decisionProcessBindingId = `${decisionSubgoalId}:input_binding:2`;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "live_env.read_processed_live_source_mail",
        executed_capability: "live_env.read_processed_live_source_mail",
        args: {},
        observation_kind: "stage_play_processed_mail_packet",
        observation_ref: "obs:processed-mail",
      },
      {
        requested_capability: "live_env.process_live_source_mail",
        executed_capability: "live_env.process_live_source_mail",
        args: {
          source_ref: "obs:processed-mail",
        },
        input_bindings: [
          {
            binding_id: processBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: readSubgoalId,
            from_capability: "live_env.read_processed_live_source_mail",
            required_observation_kinds: ["stage_play_processed_mail_packet"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "stage_play_live_source_mail_read_result",
        observation_ref: "obs:mail-process-result",
        support_refs: ["obs:processed-mail", "obs:mail-process-result"],
        bound_input_refs: [
          {
            binding_id: processBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: readSubgoalId,
            from_capability: "live_env.read_processed_live_source_mail",
            ref: "obs:processed-mail",
          },
        ],
      },
      {
        requested_capability: "live_env.record_live_source_mail_decision",
        executed_capability: "live_env.record_live_source_mail_decision",
        args: {
          evidence_refs: ["obs:processed-mail", "obs:mail-process-result"],
        },
        input_bindings: [
          {
            binding_id: decisionReadBindingId,
            arg_name: "evidence_refs",
            binding_kind: "support_ref",
            from_subgoal_id: readSubgoalId,
            from_capability: "live_env.read_processed_live_source_mail",
            required_observation_kinds: ["stage_play_processed_mail_packet"],
            required: true,
            status: "pending",
          },
          {
            binding_id: decisionProcessBindingId,
            arg_name: "evidence_refs",
            binding_kind: "support_ref",
            from_subgoal_id: processSubgoalId,
            from_capability: "live_env.process_live_source_mail",
            required_observation_kinds: [
              "stage_play_live_source_mail_read_result",
              "stage_play_processed_mail_packet",
            ],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "stage_play_live_source_mail_decision",
        observation_ref: "obs:mail-decision",
        support_refs: ["obs:processed-mail", "obs:mail-process-result", "obs:mail-decision"],
        bound_input_refs: [
          {
            binding_id: decisionReadBindingId,
            arg_name: "evidence_refs",
            binding_kind: "support_ref",
            from_subgoal_id: readSubgoalId,
            from_capability: "live_env.read_processed_live_source_mail",
            ref: "obs:processed-mail",
          },
          {
            binding_id: decisionProcessBindingId,
            arg_name: "evidence_refs",
            binding_kind: "support_ref",
            from_subgoal_id: processSubgoalId,
            from_capability: "live_env.process_live_source_mail",
            ref: "obs:mail-process-result",
          },
        ],
      },
    ],
    overrides,
  });
};

const liveSourceMailCheckThenRawReadDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:live-source-mail-check-then-raw-read";
  const checkSubgoalId = `${turnId}:compound_capability_subgoal:1:live_env_check_live_source_mail`;
  const readSubgoalId = `${turnId}:compound_capability_subgoal:2:live_env_read_live_source_mail`;
  const readBindingId = `${readSubgoalId}:input_binding:1`;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "live_env.check_live_source_mail",
        executed_capability: "live_env.check_live_source_mail",
        args: {},
        observation_kind: "stage_play_live_source_mail_read_result",
        observation_ref: "obs:live-mail-check",
      },
      {
        requested_capability: "live_env.read_live_source_mail",
        executed_capability: "live_env.read_live_source_mail",
        args: {
          source_ref: "obs:live-mail-check",
        },
        input_bindings: [
          {
            binding_id: readBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: checkSubgoalId,
            from_capability: "live_env.check_live_source_mail",
            required_observation_kinds: ["stage_play_live_source_mail_read_result"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "stage_play_live_source_mail_read_result",
        observation_ref: "obs:live-mail-read",
        support_refs: ["obs:live-mail-check", "obs:live-mail-read"],
        bound_input_refs: [
          {
            binding_id: readBindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: checkSubgoalId,
            from_capability: "live_env.check_live_source_mail",
            ref: "obs:live-mail-check",
          },
        ],
      },
    ],
    overrides,
  });
};

const liveSourceDecisionThenVoiceCalloutDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:live-source-decision-then-voice-callout";
  const decisionSubgoalId = `${turnId}:compound_capability_subgoal:1:live_env_record_live_source_mail_decision`;
  const voiceSubgoalId = `${turnId}:compound_capability_subgoal:2:live_env_request_interim_voice_callout`;
  const voiceBindingId = `${voiceSubgoalId}:input_binding:1`;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "live_env.record_live_source_mail_decision",
        executed_capability: "live_env.record_live_source_mail_decision",
        args: {},
        observation_kind: "stage_play_live_source_mail_decision",
        observation_ref: "obs:mail-decision",
      },
      {
        requested_capability: "live_env.request_interim_voice_callout",
        executed_capability: "live_env.request_interim_voice_callout",
        args: {
          message: "Summarize the mailbox decision for the operator.",
          evidence_refs: ["obs:mail-decision"],
        },
        input_bindings: [
          {
            binding_id: voiceBindingId,
            arg_name: "evidence_refs",
            binding_kind: "support_ref",
            from_subgoal_id: decisionSubgoalId,
            from_capability: "live_env.record_live_source_mail_decision",
            required_observation_kinds: ["stage_play_live_source_mail_decision"],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "live_source_interim_voice_callout_receipt",
        observation_ref: "obs:voice-callout",
        support_refs: ["obs:mail-decision", "obs:voice-callout"],
        bound_input_refs: [
          {
            binding_id: voiceBindingId,
            arg_name: "evidence_refs",
            binding_kind: "support_ref",
            from_subgoal_id: decisionSubgoalId,
            from_capability: "live_env.record_live_source_mail_decision",
            ref: "obs:mail-decision",
          },
        ],
      },
    ],
    overrides,
  });
};

const liveSourceQualityGoalContextStateDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:live-source-quality-goal-context-state";
  const qualitySubgoalId = `${turnId}:compound_capability_subgoal:1:live_env_query_live_source_quality`;
  const goalContextSubgoalId = `${turnId}:compound_capability_subgoal:2:live_env_query_workstation_goal_context`;
  const stateSubgoalId = `${turnId}:compound_capability_subgoal:3:live_env_summarize_live_source_current_state`;
  const stateQualityBindingId = `${stateSubgoalId}:input_binding:1`;
  const stateGoalContextBindingId = `${stateSubgoalId}:input_binding:2`;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "live_env.query_live_source_quality",
        executed_capability: "live_env.query_live_source_quality",
        args: {},
        observation_kind: "stage_play_live_source_quality",
        observation_ref: "obs:live-source-quality",
      },
      {
        requested_capability: "live_env.query_workstation_goal_context",
        executed_capability: "live_env.query_workstation_goal_context",
        args: {},
        observation_kind: "stage_play_workstation_goal_context_read_result",
        observation_ref: "obs:workstation-goal-context",
      },
      {
        requested_capability: "live_env.summarize_live_source_current_state",
        executed_capability: "live_env.summarize_live_source_current_state",
        args: {
          source_refs: ["obs:live-source-quality", "obs:workstation-goal-context"],
        },
        input_bindings: [
          {
            binding_id: stateQualityBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: qualitySubgoalId,
            from_capability: "live_env.query_live_source_quality",
            required_observation_kinds: ["stage_play_live_source_quality", "helix.workstation_goal_context_update.v1"],
            required: true,
            status: "pending",
          },
          {
            binding_id: stateGoalContextBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: goalContextSubgoalId,
            from_capability: "live_env.query_workstation_goal_context",
            required_observation_kinds: [
              "stage_play_workstation_goal_context_read_result",
              "helix.agent_goal_session.v1",
            ],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "stage_play_live_source_current_state",
        observation_ref: "obs:live-source-current-state",
        support_refs: [
          "obs:live-source-quality",
          "obs:workstation-goal-context",
          "obs:live-source-current-state",
        ],
        bound_input_refs: [
          {
            binding_id: stateQualityBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: qualitySubgoalId,
            from_capability: "live_env.query_live_source_quality",
            ref: "obs:live-source-quality",
          },
          {
            binding_id: stateGoalContextBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: goalContextSubgoalId,
            from_capability: "live_env.query_workstation_goal_context",
            ref: "obs:workstation-goal-context",
          },
        ],
      },
    ],
    overrides,
  });
};

const visualThenCalculatorDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:visual-then-calculator";
  const visualSubgoalId = `${turnId}:compound_capability_subgoal:1:image_lens_inspect`;
  const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
  const calculatorVisualBindingId = `${calculatorSubgoalId}:input_binding:1`;
  const visualRequiredObservationKinds = fixtureContractTermsForCapability(
    "image_lens.inspect",
    "situation_context_pack",
  ).required_observation_kinds;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "image_lens.inspect",
        runtime_capability: "situation-room.describe_visual_capture",
        executed_capability: "situation-room.describe_visual_capture",
        args: {
          source_id: "visual_source:visual_then_calculator",
        },
        observation_kind: "situation_context_pack",
        observation_ref: "obs:visual-context-pack",
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        args: {
          latex: "5*9",
          expression: "5*9",
        },
        required_args: ["latex"],
        optional_args: ["expression", "equation"],
        input_bindings: [
          {
            binding_id: calculatorVisualBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: visualSubgoalId,
            from_capability: "image_lens.inspect",
            required_observation_kinds: visualRequiredObservationKinds,
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "calculator_receipt",
        observation_ref: "obs:calculator",
        support_refs: ["obs:visual-context-pack", "obs:calculator"],
        bound_input_refs: [
          {
            binding_id: calculatorVisualBindingId,
            arg_name: "support_refs",
            binding_kind: "support_ref",
            from_subgoal_id: visualSubgoalId,
            from_capability: "image_lens.inspect",
            ref: "obs:visual-context-pack",
          },
        ],
      },
    ],
    overrides,
  });
};

const civilizationBoundsReflectionDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:civilization-bounds-reflection";
  const frameSubgoalId = `${turnId}:compound_capability_subgoal:1:helix_ask_build_civilization_scenario_frame`;
  const reflectionSubgoalId = `${turnId}:compound_capability_subgoal:2:helix_ask_reflect_civilization_bounds`;
  const bindingId = `${reflectionSubgoalId}:input_binding:1`;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "helix_ask.build_civilization_scenario_frame",
        executed_capability: "helix_ask.build_civilization_scenario_frame",
        args: {
          prompt: "long-range settlement scenario",
        },
        observation_kind: "civilization_scenario_frame/v1",
        observation_ref: "obs:civilization-frame",
      },
      {
        requested_capability: "helix_ask.reflect_civilization_bounds",
        executed_capability: "helix_ask.reflect_civilization_bounds",
        args: {
          prompt: "reflect collaboration and falsification bounds",
          scenarioFrameRef: "obs:civilization-frame",
        },
        input_bindings: [
          {
            binding_id: bindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: frameSubgoalId,
            from_capability: "helix_ask.build_civilization_scenario_frame",
            required_observation_kinds: [
              "civilization_scenario_frame/v1",
              "helix_civilization_scenario_frame_tool_result",
            ],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "civilization_bounds_reflection",
        observation_ref: "obs:civilization-bounds",
        bound_input_refs: [
          {
            binding_id: bindingId,
            arg_name: "source_ref",
            binding_kind: "source_ref",
            from_subgoal_id: frameSubgoalId,
            from_capability: "helix_ask.build_civilization_scenario_frame",
            ref: "obs:civilization-frame",
          },
        ],
      },
    ],
    overrides,
  });
};

const moralGraphReflectionBridgeDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:moral-graph-reflection-bridge";
  const theorySubgoalId = `${turnId}:compound_capability_subgoal:1:helix_ask_reflect_theory_context`;
  const ideologySubgoalId = `${turnId}:compound_capability_subgoal:2:helix_ask_reflect_ideology_context`;
  const bridgeSubgoalId = `${turnId}:compound_capability_subgoal:3:helix_ask_bridge_theory_ideology_context`;
  const theoryBindingId = `${bridgeSubgoalId}:input_binding:1`;
  const ideologyBindingId = `${bridgeSubgoalId}:input_binding:2`;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        args: {
          prompt: "uncertainty in the agent policy",
        },
        observation_kind: "theory_context_reflection",
        observation_ref: "obs:theory-reflection",
      },
      {
        requested_capability: "helix_ask.reflect_ideology_context",
        executed_capability: "helix_ask.reflect_ideology_context",
        args: {
          prompt: "wisdom under uncertainty",
        },
        observation_kind: "ideology_context_reflection/v1",
        observation_ref: "obs:moral-reflection",
      },
      {
        requested_capability: "helix_ask.bridge_theory_ideology_context",
        executed_capability: "helix_ask.bridge_theory_ideology_context",
        args: {
          prompt: "bridge theory and ideology context",
          theory_reflection_ref: "obs:theory-reflection",
          ideology_reflection_ref: "obs:moral-reflection",
        },
        input_bindings: [
          {
            binding_id: theoryBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: theorySubgoalId,
            from_capability: "helix_ask.reflect_theory_context",
            required_observation_kinds: [
              "helix_theory_context_reflection_tool_receipt",
              "theory_context_reflection",
            ],
            required: true,
            status: "pending",
          },
          {
            binding_id: ideologyBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: ideologySubgoalId,
            from_capability: "helix_ask.reflect_ideology_context",
            required_observation_kinds: [
              "ideology_context_reflection/v1",
              "procedural_moral_classification/v1",
              "helix_moral_graph_reflection_tool_result",
              "workstation_tool_evaluation",
            ],
            required: true,
            status: "pending",
          },
        ],
        observation_kind: "helix_theory_ideology_bridge_tool_result",
        observation_ref: "obs:theory-moral-bridge",
        bound_input_refs: [
          {
            binding_id: theoryBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: theorySubgoalId,
            from_capability: "helix_ask.reflect_theory_context",
            ref: "obs:theory-reflection",
          },
          {
            binding_id: ideologyBindingId,
            arg_name: "source_refs",
            binding_kind: "source_ref",
            from_subgoal_id: ideologySubgoalId,
            from_capability: "helix_ask.reflect_ideology_context",
            ref: "obs:moral-reflection",
          },
        ],
      },
    ],
    overrides,
  });
};

const scholarlyNumericParametersThenCalculatorDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:scholarly-numeric-parameters";
  const lookupSubgoalId = `${turnId}:compound_capability_subgoal:1:scholarly-research_lookup_papers`;
  const fullTextSubgoalId = `${turnId}:compound_capability_subgoal:2:scholarly-research_fetch_full_text`;
  const fullTextBindingId = `${fullTextSubgoalId}:input_binding:1`;
  const numericSubgoalId = `${turnId}:compound_capability_subgoal:3:scholarly-research_extract_numeric_parameters`;
  const numericBindingId = `${numericSubgoalId}:input_binding:1`;
  const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:4:scientific-calculator_solve_expression`;
  const calculatorBindingSources = [
    [lookupSubgoalId, "scholarly-research.lookup_papers", "scholarly_research_observation"],
    [fullTextSubgoalId, "scholarly-research.fetch_full_text", "scholarly_full_text_observation"],
    [numericSubgoalId, "scholarly-research.extract_numeric_parameters", "scholarly_numeric_parameter_observation"],
  ] as const;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "scholarly-research.lookup_papers",
        executed_capability: "scholarly-research.lookup_papers",
        args: { query: "tokamak unit-bearing plasma density temperature magnetic field" },
        observation_kind: "scholarly_research_observation",
        observation_ref: "obs:scholarly-lookup",
      },
      {
        requested_capability: "scholarly-research.fetch_full_text",
        executed_capability: "scholarly-research.fetch_full_text",
        args: { paper_result_or_source: "obs:scholarly-lookup" },
        input_bindings: [{
          binding_id: fullTextBindingId,
          arg_name: "paper_result_or_source",
          binding_kind: "source_ref",
          from_subgoal_id: lookupSubgoalId,
          from_capability: "scholarly-research.lookup_papers",
          required_observation_kinds: ["scholarly_research_observation"],
          required: true,
          status: "bound",
        }],
        bound_input_refs: [{
          binding_id: fullTextBindingId,
          arg_name: "paper_result_or_source",
          binding_kind: "source_ref",
          from_subgoal_id: lookupSubgoalId,
          from_capability: "scholarly-research.lookup_papers",
          ref: "obs:scholarly-lookup",
        }],
        observation_kind: "scholarly_full_text_observation",
        observation_ref: "obs:scholarly-full-text",
      },
      {
        requested_capability: "scholarly-research.extract_numeric_parameters",
        executed_capability: "scholarly-research.extract_numeric_parameters",
        args: {
          text_evidence: "obs:scholarly-full-text",
          requested_variables: ["n_m3", "T_eV", "B_T"],
        },
        input_bindings: [{
          binding_id: numericBindingId,
          arg_name: "text_evidence",
          binding_kind: "source_ref",
          from_subgoal_id: fullTextSubgoalId,
          from_capability: "scholarly-research.fetch_full_text",
          required_observation_kinds: ["scholarly_full_text_observation"],
          required: true,
          status: "bound",
        }],
        bound_input_refs: [{
          binding_id: numericBindingId,
          arg_name: "text_evidence",
          binding_kind: "source_ref",
          from_subgoal_id: fullTextSubgoalId,
          from_capability: "scholarly-research.fetch_full_text",
          ref: "obs:scholarly-full-text",
        }],
        observation_kind: null,
        observation_ref: null,
        satisfaction: "failed",
        rail_status: "fail_closed",
        first_broken_rail: "observation_binding",
        rail_failure_code: "numeric_parameter_evidence_incomplete",
        repair_target: "scholarly_numeric_parameter_evidence",
      },
      {
        requested_capability: "scientific-calculator.solve_expression",
        executed_capability: null,
        args: {},
        input_bindings: calculatorBindingSources.map(([fromSubgoalId, fromCapability, observationKind], index) => ({
          binding_id: `${calculatorSubgoalId}:input_binding:${index + 1}`,
          arg_name: "support_refs",
          binding_kind: "support_ref",
          from_subgoal_id: fromSubgoalId,
          from_capability: fromCapability,
          required_observation_kinds: [observationKind],
          required: true,
          status: "pending",
        })),
        unresolved_input_bindings: calculatorBindingSources.map(([fromSubgoalId, fromCapability, observationKind], index) => ({
          binding_id: `${calculatorSubgoalId}:input_binding:${index + 1}`,
          arg_name: "support_refs",
          binding_kind: "support_ref",
          from_subgoal_id: fromSubgoalId,
          from_capability: fromCapability,
          required_observation_kinds: [observationKind],
          required: true,
          status: "pending",
        })),
        observation_kind: null,
        observation_ref: null,
        satisfaction: "missing",
        rail_status: "fail_closed",
        first_broken_rail: "input_binding",
        rail_failure_code: "required_numeric_evidence_unavailable",
        repair_target: "scholarly_numeric_parameter_evidence",
      },
    ],
    overrides,
  });
};

const scholarlyLookupTheoryObservationDebug = (overrides: Record<string, unknown> = {}) => {
  const turnId = "ask:test:scholarly-lookup-theory-observation";
  const lookupSubgoalId = `${turnId}:compound_capability_subgoal:1:scholarly-research_lookup_papers`;
  const reflectionSubgoalId = `${turnId}:compound_capability_subgoal:2:theory-badge-graph_reflect_discussion_context`;
  const bindingId = `${reflectionSubgoalId}:input_binding:1`;
  return compoundDebug({
    turnId,
    subgoals: [
      {
        requested_capability: "scholarly-research.lookup_papers",
        executed_capability: "scholarly-research.lookup_papers",
        args: { query: "tokamak operating parameters" },
        observation_kind: "scholarly_research_observation",
        observation_ref: "obs:scholarly-lookup",
      },
      {
        requested_capability: "helix_ask.reflect_theory_context",
        executed_capability: "helix_ask.reflect_theory_context",
        args: { prompt: "reflect the bounded claim against the theory badge graph" },
        input_bindings: [{
          binding_id: bindingId,
          arg_name: "source_ref",
          binding_kind: "source_ref",
          from_subgoal_id: lookupSubgoalId,
          from_capability: "scholarly-research.lookup_papers",
          required_observation_kinds: ["scholarly_research_observation"],
          required: true,
          status: "bound",
        }],
        bound_input_refs: [{
          binding_id: bindingId,
          arg_name: "source_ref",
          binding_kind: "source_ref",
          from_subgoal_id: lookupSubgoalId,
          from_capability: "scholarly-research.lookup_papers",
          ref: "obs:scholarly-lookup",
        }],
        observation_kind: "theory_context_reflection",
        observation_ref: "obs:theory-reflection",
      },
    ],
    overrides,
  });
};

const deterministicDebugFixtureByScenarioId = {
  workspace_then_calculator: workspaceThenCalculatorDebug,
  docs_then_calculator: docsThenCalculatorDebug,
  docs_equation_context_then_calculator: docsEquationContextThenCalculatorDebug,
  workspace_directory_then_docs: workspaceDirectoryThenDocsDebug,
  catalog_then_workspace: catalogThenWorkspaceDebug,
  workstation_tool_alignment_then_workspace: workstationToolAlignmentThenWorkspaceDebug,
  natural_catalog_then_workspace: catalogThenWorkspaceDebug,
  micro_reasoner_presets_then_draft: microReasonerPresetsThenDraftDebug,
  micro_reasoner_presets_draft_route: microReasonerPresetsDraftRouteDebug,
  live_source_mail_read_process_reflect: liveSourceMailReadProcessReflectDebug,
  live_source_mail_read_process_decision: liveSourceMailReadProcessDecisionDebug,
  live_source_mail_check_then_raw_read: liveSourceMailCheckThenRawReadDebug,
  live_source_decision_then_voice_callout: liveSourceDecisionThenVoiceCalloutDebug,
  live_source_quality_goal_context_state: liveSourceQualityGoalContextStateDebug,
  repo_plus_docs: repoPlusDocsDebug,
  repo_reflection_calculator: repoReflectionCalculatorDebug,
  docs_reflection_calculator: docsReflectionCalculatorDebug,
  internet_reflection_calculator: internetReflectionCalculatorDebug,
  scholarly_reflection_calculator: scholarlyReflectionCalculatorDebug,
  scholarly_full_text_reflection_calculator: scholarlyFullTextReflectionCalculatorDebug,
  scholarly_numeric_parameters_then_calculator: scholarlyNumericParametersThenCalculatorDebug,
  scholarly_default_lookup_agent_decision: scholarlyLookupTheoryObservationDebug,
  scholarly_irrelevant_lookup_blocks_dependent_chain: scholarlyLookupTheoryObservationDebug,
  context_reflection_calculator: contextReflectionCalculatorDebug,
  theory_frontier_trace_calculator: theoryFrontierTraceCalculatorDebug,
  live_synthetic_data_reflection_calculator: liveSyntheticDataReflectionCalculatorDebug,
  visual_then_calculator: visualThenCalculatorDebug,
  civilization_bounds_reflection: civilizationBoundsReflectionDebug,
  moral_graph_reflection_bridge: moralGraphReflectionBridgeDebug,
  invalid_calculator_args_fail_closed: invalidCalculatorArgsFailClosedDebug,
  missing_calculator_args_fail_closed: missingCalculatorArgsFailClosedDebug,
} as const;

describe("Helix Ask compound capability live probe", () => {
  it("selects all compound live scenarios by default and reports unknown filters", () => {
    const all = selectCompoundCapabilityLiveScenarios([]);
    expect(all.requestedIds).toEqual([]);
    expect(all.unknownIds).toEqual([]);
    expect(all.scenarios.map((scenario) => scenario.id)).toEqual(
      COMPOUND_CAPABILITY_LIVE_SCENARIOS.map((scenario) => scenario.id),
    );

    const filtered = selectCompoundCapabilityLiveScenarios([
      " workspace_then_calculator ",
      "workspace_then_calculator",
      "missing_scenario",
    ]);
    expect(filtered.requestedIds).toEqual(["workspace_then_calculator", "missing_scenario"]);
    expect(filtered.unknownIds).toEqual(["missing_scenario"]);
    expect(filtered.scenarios.map((scenario) => scenario.id)).toEqual(["workspace_then_calculator"]);
    expect(filtered.availableIds).toContain("docs_then_calculator");
    expect(filtered.availableIds).toContain("workspace_directory_then_docs");
    expect(filtered.availableIds).toContain("natural_catalog_then_workspace");
    expect(filtered.availableIds).toContain("micro_reasoner_presets_then_draft");
    expect(filtered.availableIds).toContain("micro_reasoner_presets_draft_route");
    expect(filtered.availableIds).toContain("live_source_mail_read_process_reflect");
    expect(filtered.availableIds).toContain("internet_reflection_calculator");
    expect(filtered.availableIds).toContain("scholarly_reflection_calculator");
    expect(filtered.availableIds).toContain("scholarly_full_text_reflection_calculator");
    expect(filtered.availableIds).toContain("civilization_bounds_reflection");
    expect(filtered.availableIds).toContain("moral_graph_reflection_bridge");
  });

  it("keeps the active goal representative compound scenarios in the live probe set", () => {
    const scenarioIds = new Set(COMPOUND_CAPABILITY_LIVE_SCENARIOS.map((scenario) => scenario.id));
    const requiredByGoal = [
      "docs_then_calculator",
      "catalog_then_workspace",
      "repo_plus_docs",
      "internet_reflection_calculator",
      "visual_then_calculator",
      "civilization_bounds_reflection",
      "invalid_calculator_args_fail_closed",
      "missing_calculator_args_fail_closed",
    ];

    for (const scenarioId of requiredByGoal) {
      expect(scenarioIds.has(scenarioId), scenarioId).toBe(true);
    }
  });

  it("has deterministic debug fixture coverage for every live-probe scenario", () => {
    expect(Object.keys(deterministicDebugFixtureByScenarioId).sort()).toEqual(
      COMPOUND_CAPABILITY_LIVE_SCENARIOS.map((scenario) => scenario.id).sort(),
    );

    for (const scenario of COMPOUND_CAPABILITY_LIVE_SCENARIOS) {
      const fixture = deterministicDebugFixtureByScenarioId[
        scenario.id as keyof typeof deterministicDebugFixtureByScenarioId
      ];
      const { ask, debugExport } = fixture();
      const result = evaluateCompoundCapabilityScenario({
        scenario,
        ask,
        debugExport,
      });

      expect(result.failures, scenario.id).toEqual([]);
      expect(result.ok, scenario.id).toBe(true);
    }
  });

  it("blocks broad keyed live execution unless scenarios are filtered or explicitly allowed", () => {
    expect(resolveCompoundCapabilityLiveRunPolicy({
      dryRun: true,
      scenarioFilter: [],
      allowAllLiveScenarios: false,
    })).toEqual({
      blocked: false,
      blocked_reason: null,
      message: null,
    });

    expect(resolveCompoundCapabilityLiveRunPolicy({
      dryRun: false,
      scenarioFilter: [],
      allowAllLiveScenarios: false,
    })).toEqual({
      blocked: true,
      blocked_reason: "scenario_filter_required_for_live_probe",
      message: BROAD_LIVE_PROBE_BLOCK_MESSAGE,
    });

    expect(resolveCompoundCapabilityLiveRunPolicy({
      dryRun: false,
      scenarioFilter: ["docs_then_calculator"],
      allowAllLiveScenarios: false,
    })).toEqual({
      blocked: false,
      blocked_reason: null,
      message: null,
    });

    expect(resolveCompoundCapabilityLiveRunPolicy({
      dryRun: false,
      scenarioFilter: [],
      allowAllLiveScenarios: true,
    })).toEqual({
      blocked: false,
      blocked_reason: null,
      message: null,
    });
  });

  it("accepts a complete ordered compound ledger with bounded calculator args", () => {
    const { ask, debugExport } = workspaceThenCalculatorDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "workspace_os.status",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.selected_capabilities).toEqual([
      "workspace_os.status",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.executed_capabilities).toEqual([
      "workspace_os.status",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.observation_kinds).toEqual([
      "workspace_os_status_observation",
      "calculator_receipt",
    ]);
    expect(result.observation_refs).toEqual([
      "obs:workspace-status",
      "obs:calculator",
    ]);
    expect(result.observation_provenance).toEqual([
      "compound_subgoal_id",
      "capability_key",
    ]);
    expect(result.rail_observation_kinds).toEqual([
      "workspace_os_status_observation",
      "calculator_receipt",
    ]);
    expect(result.rail_observation_refs).toEqual([
      "obs:workspace-status",
      "obs:calculator",
    ]);
    expect(result.rail_observation_provenance).toEqual([
      "compound_subgoal_id",
      "capability_key",
    ]);
    expect(result.subgoal_terminal_contribution_kinds).toEqual([
      "model_synthesized_answer",
      "workstation_tool_evaluation",
    ]);
    expect(result.rail_terminal_contribution_kinds).toEqual([
      "model_synthesized_answer",
      "workstation_tool_evaluation",
    ]);
    expect(result.subgoal_contribution_roles).toEqual(["evidence", "terminal_component"]);
    expect(result.rail_contribution_roles).toEqual(["evidence", "terminal_component"]);
    expect(result.subgoal_forbidden_nearby_capabilities).toEqual([
      ["model.direct_answer"],
      ["model.direct_answer"],
    ]);
    expect(result.rail_forbidden_nearby_capabilities).toEqual([
      ["model.direct_answer"],
      ["model.direct_answer"],
    ]);
    expect(result.subgoal_satisfactions).toEqual(["satisfied", "satisfied"]);
    expect(result.subgoal_rail_statuses).toEqual(["complete", "complete"]);
    expect(result.subgoal_first_broken_rails).toEqual([null, null]);
    expect(result.subgoal_rail_failure_codes).toEqual([null, null]);
    expect(result.subgoal_repair_targets).toEqual([null, null]);
  });

  it("accepts internet search plus theory reflection plus calculator with source binding", () => {
    const { ask, debugExport } = internetReflectionCalculatorDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("internet_reflection_calculator"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "internet_search.web_research",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.executed_capabilities).toEqual([
      "internet-search.search_web",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.observation_kinds).toEqual([
      "internet_search_observation",
      "theory_context_reflection",
      "calculator_receipt",
    ]);
    expect(result.observation_refs).toEqual(["obs:web-search", "obs:reflection", "obs:calculator"]);
  });

  it("accepts scholarly research plus theory reflection plus calculator with source binding", () => {
    const { ask, debugExport } = scholarlyReflectionCalculatorDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("scholarly_reflection_calculator"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "scholarly-research.lookup_papers",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.executed_capabilities).toEqual([
      "scholarly-research.lookup_papers",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);
  });

  it("accepts scholarly lookup plus full text plus reflection plus calculator with source bindings", () => {
    const { ask, debugExport } = scholarlyFullTextReflectionCalculatorDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("scholarly_full_text_reflection_calculator"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "scholarly-research.lookup_papers",
      "scholarly-research.fetch_full_text",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.executed_capabilities).toEqual([
      "scholarly-research.lookup_papers",
      "scholarly-research.fetch_full_text",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.observation_kinds).toEqual([
      "scholarly_research_observation",
      "scholarly_full_text_observation",
      "theory_context_reflection",
      "calculator_receipt",
    ]);
    expect(result.observation_refs).toEqual([
      "obs:scholarly-lookup",
      "obs:scholarly-full-text",
      "obs:reflection",
      "obs:calculator",
    ]);
    expect(result.subgoal_input_bindings[1]).toEqual([
      expect.objectContaining({
        arg_name: "paper_result_or_source",
        from_capability: "scholarly-research.lookup_papers",
      }),
    ]);
    expect(result.subgoal_input_bindings[2]).toEqual([
      expect.objectContaining({
        arg_name: "source_refs",
        from_capability: "scholarly-research.lookup_papers",
      }),
      expect.objectContaining({
        arg_name: "source_refs",
        from_capability: "scholarly-research.fetch_full_text",
      }),
    ]);
    expect(result.subgoal_input_bindings[3]).toEqual([
      expect.objectContaining({
        arg_name: "support_refs",
        from_capability: "scholarly-research.lookup_papers",
      }),
      expect.objectContaining({
        arg_name: "support_refs",
        from_capability: "scholarly-research.fetch_full_text",
      }),
      expect.objectContaining({
        arg_name: "support_refs",
        from_capability: "helix_ask.reflect_theory_context",
      }),
    ]);
  });

  it("accepts docs location plus calculator with doc evidence support binding", () => {
    const { ask, debugExport } = docsThenCalculatorDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("docs_then_calculator"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "docs-viewer.locate_in_doc",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.executed_capabilities).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.observation_kinds).toEqual([
      "doc_location_matches",
      "calculator_receipt",
    ]);
    expect(result.subgoal_input_bindings[1]).toEqual([
      expect.objectContaining({
        arg_name: "support_refs",
        from_capability: "docs-viewer.locate_in_doc",
      }),
    ]);
    expect(result.subgoal_bound_input_refs[1]).toEqual([
      expect.objectContaining({
        ref: "obs:doc-location",
      }),
    ]);
  });

  it("accepts docs equation context plus calculator with equation evidence support binding", () => {
    const { ask, debugExport } = docsEquationContextThenCalculatorDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("docs_equation_context_then_calculator"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "docs-viewer.doc_equation_context",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.executed_capabilities).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.observation_kinds).toEqual([
      "doc_equation_context",
      "calculator_receipt",
    ]);
    expect(result.subgoal_input_bindings[1]).toEqual([
      expect.objectContaining({
        arg_name: "support_refs",
        from_capability: "docs-viewer.doc_equation_context",
      }),
    ]);
    expect(result.subgoal_bound_input_refs[1]).toEqual([
      expect.objectContaining({
        ref: "obs:doc-equation-context",
      }),
    ]);
  });

  it("accepts workspace-directory resolution plus docs location without dropping either rail", () => {
    const { ask, debugExport } = workspaceDirectoryThenDocsDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_directory_then_docs"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "workspace-directory.resolve",
      "docs-viewer.locate_in_doc",
    ]);
    expect(result.executed_capabilities).toEqual([
      "workspace-directory.resolve",
      "docs.search",
    ]);
  });

  it("accepts capability catalog plus workspace status without route drift to repo evidence", () => {
    const { ask, debugExport } = catalogThenWorkspaceDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("catalog_then_workspace"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "helix_ask.inspect_capability_catalog",
      "workspace_os.status",
    ]);
    expect(result.executed_capabilities).toEqual([
      "helix_ask.inspect_capability_catalog",
      "workspace_os.status",
    ]);
    expect(result.observation_kinds).toEqual([
      "capability_registry",
      "workspace_os_status_observation",
    ]);
    expect(result.subgoal_terminal_contribution_kinds).toEqual([
      "capability_help_summary",
      "model_synthesized_answer",
    ]);
  });

  it("accepts natural-language catalog plus workspace status as the same capability contract", () => {
    const { ask, debugExport } = catalogThenWorkspaceDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("natural_catalog_then_workspace"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "helix_ask.inspect_capability_catalog",
      "workspace_os.status",
    ]);
    expect(result.executed_capabilities).toEqual([
      "helix_ask.inspect_capability_catalog",
      "workspace_os.status",
    ]);
  });

  it("accepts workstation tool alignment plus workspace status as catalog evidence", () => {
    const { ask, debugExport } = workstationToolAlignmentThenWorkspaceDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workstation_tool_alignment_then_workspace"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "helix_ask.reflect_workstation_tool_alignment",
      "workspace_os.status",
    ]);
    expect(result.executed_capabilities).toEqual([
      "helix_ask.reflect_workstation_tool_alignment",
      "workspace_os.status",
    ]);
    expect(result.observation_kinds).toEqual([
      "capability_registry",
      "workspace_os_status_observation",
    ]);
  });

  it("accepts repo evidence plus docs location without flattening to one procedure", () => {
    const { ask, debugExport } = repoPlusDocsDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("repo_plus_docs"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "repo-code.search_concept",
      "docs-viewer.locate_in_doc",
    ]);
    expect(result.executed_capabilities).toEqual([
      "repo-code.search_concept",
      "docs.search",
    ]);
    expect(result.observation_kinds).toEqual([
      "repo_code_evidence_observation",
      "doc_location_matches",
    ]);
  });

  it("accepts repo evidence plus theory reflection plus calculator with source binding", () => {
    const { ask, debugExport } = repoReflectionCalculatorDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("repo_reflection_calculator"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "repo-code.search_concept",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.executed_capabilities).toEqual([
      "repo-code.search_concept",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.observation_kinds).toEqual([
      "repo_code_evidence_observation",
      "theory_context_reflection",
      "calculator_receipt",
    ]);
    expect(result.observation_refs).toEqual(["obs:repo-evidence", "obs:reflection", "obs:calculator"]);
    expect(result.subgoal_input_bindings[1]).toEqual([
      expect.objectContaining({
        arg_name: "source_ref",
        from_capability: "repo-code.search_concept",
      }),
    ]);
    expect(result.subgoal_input_bindings[2]).toEqual([
      expect.objectContaining({
        arg_name: "support_refs",
        from_capability: "repo-code.search_concept",
      }),
      expect.objectContaining({
        arg_name: "support_refs",
        from_capability: "helix_ask.reflect_theory_context",
      }),
    ]);
  });

  it("accepts docs evidence plus theory reflection plus calculator with source binding", () => {
    const { ask, debugExport } = docsReflectionCalculatorDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("docs_reflection_calculator"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "docs-viewer.locate_in_doc",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.executed_capabilities).toEqual([
      "docs.search",
      "helix_ask.reflect_theory_context",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.observation_kinds).toEqual([
      "doc_location_matches",
      "theory_context_reflection",
      "calculator_receipt",
    ]);
    expect(result.observation_refs).toEqual(["obs:doc-location", "obs:reflection", "obs:calculator"]);
    expect(result.subgoal_input_bindings[1]).toEqual([
      expect.objectContaining({
        arg_name: "source_ref",
        from_capability: "docs-viewer.locate_in_doc",
      }),
    ]);
    expect(result.subgoal_input_bindings[2]).toEqual([
      expect.objectContaining({
        arg_name: "support_refs",
        from_capability: "docs-viewer.locate_in_doc",
      }),
      expect.objectContaining({
        arg_name: "support_refs",
        from_capability: "helix_ask.reflect_theory_context",
      }),
    ]);
  });

  it("accepts live-env micro-reasoner preset query plus draft without mailbox packet state", () => {
    const { ask, debugExport } = microReasonerPresetsThenDraftDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("micro_reasoner_presets_then_draft"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "live_env.query_micro_reasoner_presets",
      "live_env.draft_micro_reasoner_preset",
    ]);
    expect(result.executed_capabilities).toEqual([
      "live_env.query_micro_reasoner_presets",
      "live_env.draft_micro_reasoner_preset",
    ]);
    expect(result.subgoal_input_bindings[1]).toEqual([
      expect.objectContaining({
        arg_name: "source_ref",
        from_capability: "live_env.query_micro_reasoner_presets",
      }),
    ]);
    expect(result.subgoal_bound_input_refs[1]).toEqual([
      expect.objectContaining({
        ref: "obs:micro-reasoner-presets",
      }),
    ]);
  });

  it("accepts live-env micro-reasoner preset query plus draft plus route with ordered source bindings", () => {
    const { ask, debugExport } = microReasonerPresetsDraftRouteDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("micro_reasoner_presets_draft_route"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "live_env.query_micro_reasoner_presets",
      "live_env.draft_micro_reasoner_preset",
      "live_env.route_micro_reasoner_prompt",
    ]);
    expect(result.executed_capabilities).toEqual([
      "live_env.query_micro_reasoner_presets",
      "live_env.draft_micro_reasoner_preset",
      "live_env.route_micro_reasoner_prompt",
    ]);
    expect(result.observation_kinds).toEqual([
      "stage_play_micro_reasoner_prompt_preset_query_result",
      "stage_play_micro_reasoner_prompt_preset_draft",
      "stage_play_micro_reasoner_prompt_delegation_result",
    ]);
    expect(result.subgoal_input_bindings[1]).toEqual([
      expect.objectContaining({
        arg_name: "source_ref",
        from_capability: "live_env.query_micro_reasoner_presets",
      }),
    ]);
    expect(result.subgoal_input_bindings[2]).toEqual([
      expect.objectContaining({
        arg_name: "source_refs",
        from_capability: "live_env.query_micro_reasoner_presets",
      }),
      expect.objectContaining({
        arg_name: "source_refs",
        from_capability: "live_env.draft_micro_reasoner_preset",
      }),
    ]);
    expect(result.subgoal_bound_input_refs[2]).toEqual([
      expect.objectContaining({
        ref: "obs:micro-reasoner-presets",
      }),
      expect.objectContaining({
        ref: "obs:micro-reasoner-draft",
      }),
    ]);
  });

  it("accepts live-source mailbox read plus process plus reflect with ordered source bindings", () => {
    const { ask, debugExport } = liveSourceMailReadProcessReflectDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("live_source_mail_read_process_reflect"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.reflect_live_source_mail_loop",
    ]);
    expect(result.executed_capabilities).toEqual([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.reflect_live_source_mail_loop",
    ]);
    expect(result.observation_kinds).toEqual([
      "stage_play_processed_mail_packet",
      "stage_play_live_source_mail_read_result",
      "stage_play_live_source_mail_loop_reflection",
    ]);
    expect(result.subgoal_input_bindings[1]).toEqual([
      expect.objectContaining({
        arg_name: "source_ref",
        from_capability: "live_env.read_processed_live_source_mail",
      }),
    ]);
    expect(result.subgoal_input_bindings[2]).toEqual([
      expect.objectContaining({
        arg_name: "source_refs",
        from_capability: "live_env.read_processed_live_source_mail",
      }),
      expect.objectContaining({
        arg_name: "source_refs",
        from_capability: "live_env.process_live_source_mail",
      }),
    ]);
    expect(result.subgoal_bound_input_refs[1]).toEqual([
      expect.objectContaining({
        ref: "obs:processed-mail",
      }),
    ]);
    expect(result.subgoal_bound_input_refs[2]).toEqual([
      expect.objectContaining({
        ref: "obs:processed-mail",
      }),
      expect.objectContaining({
        ref: "obs:mail-process-result",
      }),
    ]);
  });

  it("accepts live-source mailbox read plus process plus decision with ordered evidence bindings", () => {
    const { ask, debugExport } = liveSourceMailReadProcessDecisionDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("live_source_mail_read_process_decision"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
    ]);
    expect(result.executed_capabilities).toEqual([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
    ]);
    expect(result.observation_kinds).toEqual([
      "stage_play_processed_mail_packet",
      "stage_play_live_source_mail_read_result",
      "stage_play_live_source_mail_decision",
    ]);
    expect(result.subgoal_input_bindings[2]).toEqual([
      expect.objectContaining({
        arg_name: "evidence_refs",
        binding_kind: "support_ref",
        from_capability: "live_env.read_processed_live_source_mail",
      }),
      expect.objectContaining({
        arg_name: "evidence_refs",
        binding_kind: "support_ref",
        from_capability: "live_env.process_live_source_mail",
      }),
    ]);
    expect(result.subgoal_bound_input_refs[2]).toEqual([
      expect.objectContaining({
        arg_name: "evidence_refs",
        binding_kind: "support_ref",
        ref: "obs:processed-mail",
      }),
      expect.objectContaining({
        arg_name: "evidence_refs",
        binding_kind: "support_ref",
        ref: "obs:mail-process-result",
      }),
    ]);
  });

  it("accepts live-source decision plus voice callout with evidence binding", () => {
    const { ask, debugExport } = liveSourceDecisionThenVoiceCalloutDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("live_source_decision_then_voice_callout"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
    ]);
    expect(result.executed_capabilities).toEqual([
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
    ]);
    expect(result.observation_kinds).toEqual([
      "stage_play_live_source_mail_decision",
      "live_source_interim_voice_callout_receipt",
    ]);
    expect(result.subgoal_input_bindings[1]).toEqual([
      expect.objectContaining({
        arg_name: "evidence_refs",
        binding_kind: "support_ref",
        from_capability: "live_env.record_live_source_mail_decision",
      }),
    ]);
    expect(result.subgoal_bound_input_refs[1]).toEqual([
      expect.objectContaining({
        arg_name: "evidence_refs",
        binding_kind: "support_ref",
        ref: "obs:mail-decision",
      }),
    ]);
  });

  it("accepts context attachment reflection plus calculator with support binding", () => {
    const { ask, debugExport } = contextReflectionCalculatorDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("context_reflection_calculator"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "helix_ask.reflect_context_attachments",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.executed_capabilities).toEqual([
      "helix_ask.reflect_context_attachments",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.subgoal_input_bindings[1]).toEqual([
      expect.objectContaining({
        from_capability: "helix_ask.reflect_context_attachments",
      }),
    ]);
  });

  it("accepts theory frontier trace plus calculator with support binding", () => {
    const { ask, debugExport } = theoryFrontierTraceCalculatorDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("theory_frontier_trace_calculator"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "helix.theory.frontierVectorFieldTrace",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.executed_capabilities).toEqual([
      "helix.theory.frontierVectorFieldTrace",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.observation_kinds).toEqual([
      "theory_frontier_vector_field",
      "calculator_receipt",
    ]);
  });

  it("accepts live synthetic data reflection plus calculator with support binding", () => {
    const { ask, debugExport } = liveSyntheticDataReflectionCalculatorDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("live_synthetic_data_reflection_calculator"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "helix_ask.reflect_live_synthetic_data",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.executed_capabilities).toEqual([
      "helix_ask.reflect_live_synthetic_data",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.observation_kinds).toEqual([
      "bounded_context_reference",
      "calculator_receipt",
    ]);
  });

  it("accepts visual capture plus calculator with runtime substitution and support binding", () => {
    const { ask, debugExport } = visualThenCalculatorDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("visual_then_calculator"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "image_lens.inspect",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.runtime_capabilities).toEqual([
      "situation-room.describe_visual_capture",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.executed_capabilities).toEqual([
      "situation-room.describe_visual_capture",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.observation_kinds).toEqual([
      "situation_context_pack",
      "calculator_receipt",
    ]);
    expect(result.subgoal_allowed_substitutions[0]).toEqual([
      "situation-room.describe_visual_capture",
    ]);
    expect(result.subgoal_input_bindings[1]).toEqual([
      expect.objectContaining({
        arg_name: "support_refs",
        from_capability: "image_lens.inspect",
      }),
    ]);
    expect(result.subgoal_bound_input_refs[1]).toEqual([
      expect.objectContaining({
        ref: "obs:visual-context-pack",
      }),
    ]);
  });

  it("accepts civilization scenario frame plus civilization bounds reflection with source binding", () => {
    const { ask, debugExport } = civilizationBoundsReflectionDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("civilization_bounds_reflection"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "helix_ask.build_civilization_scenario_frame",
      "helix_ask.reflect_civilization_bounds",
    ]);
    expect(result.executed_capabilities).toEqual([
      "helix_ask.build_civilization_scenario_frame",
      "helix_ask.reflect_civilization_bounds",
    ]);
    expect(result.subgoal_input_bindings[1]).toEqual([
      expect.objectContaining({
        arg_name: "source_ref",
        from_capability: "helix_ask.build_civilization_scenario_frame",
      }),
    ]);
    expect(result.subgoal_bound_input_refs[1]).toEqual([
      expect.objectContaining({
        ref: "obs:civilization-frame",
      }),
    ]);
  });

  it("accepts moral graph reflection plus theory-ideology bridge with source binding", () => {
    const { ask, debugExport } = moralGraphReflectionBridgeDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("moral_graph_reflection_bridge"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.requested_capabilities).toEqual([
      "helix_ask.reflect_theory_context",
      "helix_ask.reflect_ideology_context",
      "helix_ask.bridge_theory_ideology_context",
    ]);
    expect(result.executed_capabilities).toEqual([
      "helix_ask.reflect_theory_context",
      "helix_ask.reflect_ideology_context",
      "helix_ask.bridge_theory_ideology_context",
    ]);
    expect(result.subgoal_input_bindings[2]).toEqual([
      expect.objectContaining({
        arg_name: "source_refs",
        from_capability: "helix_ask.reflect_theory_context",
      }),
      expect.objectContaining({
        arg_name: "source_refs",
        from_capability: "helix_ask.reflect_ideology_context",
      }),
    ]);
    expect(result.subgoal_bound_input_refs[2]).toEqual([
      expect.objectContaining({
        ref: "obs:theory-reflection",
      }),
      expect.objectContaining({
        ref: "obs:moral-reflection",
      }),
    ]);
  });

  it("catches satisfied reflection subgoals that lose required bound input refs", () => {
    const base = internetReflectionCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    payload.capability_itinerary_execution_state.compound_subgoal_ledger[1].bound_input_refs = [];
    payload.artifact_query_index.compound_subgoal_rail_statuses[1].bound_input_refs = [];

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("internet_reflection_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("subgoal_2_bound_input_refs_missing");
  });

  it("catches calculator subgoals that lose upstream research/reflection support bindings", () => {
    const base = internetReflectionCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    payload.capability_itinerary_execution_state.compound_subgoal_ledger[2].input_bindings =
      payload.capability_itinerary_execution_state.compound_subgoal_ledger[2].input_bindings.slice(1);
    payload.artifact_query_index.compound_subgoal_rail_statuses[2].input_bindings =
      payload.artifact_query_index.compound_subgoal_rail_statuses[2].input_bindings.slice(1);
    payload.capability_itinerary_execution_state.compound_subgoal_ledger[2].bound_input_refs = [];
    payload.artifact_query_index.compound_subgoal_rail_statuses[2].bound_input_refs = [];

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("internet_reflection_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "subgoal_3_input_binding_from_capability_missing:internet_search.web_research",
    );
    expect(result.failures).toContain("subgoal_3_bound_input_refs_missing");
  });

  it("catches planned itinerary steps that drop upstream support bindings", () => {
    const base = internetReflectionCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    payload.capability_itinerary.planned_steps[2].input_bindings = [];
    payload.capability_itinerary.planned_steps[2].depends_on_subgoal_ids = [];

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("internet_reflection_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "subgoal_3_planned_input_binding_from_capability_missing:internet_search.web_research,helix_ask.reflect_theory_context",
    );
    expect(result.failures).toContain("subgoal_3_planned_depends_on_subgoal_ids_mismatch");
    expect(result.failures).toContain("subgoal_3_planned_input_bindings_mismatch");
  });

  it("catches planned itinerary steps missing for bound subgoals", () => {
    const base = internetReflectionCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    payload.capability_itinerary.planned_steps = payload.capability_itinerary.planned_steps.filter(
      (entry: Record<string, unknown>) => entry.requested_capability !== "helix_ask.reflect_theory_context",
    );

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("internet_reflection_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("subgoal_2_planned_step_missing");
    expect(result.failures).toContain(
      "subgoal_2_planned_input_binding_from_capability_missing:internet_search.web_research",
    );
  });

  it("catches planned itinerary steps that drop terminal contribution metadata", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    delete payload.capability_itinerary.planned_steps[1].terminal_contribution_kind;

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "subgoal_2_planned_terminal_contribution_kind_mismatch:null!=workstation_tool_evaluation",
    );
  });

  it("catches planned itinerary steps that drop forbidden-nearby capability metadata", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    delete payload.capability_itinerary.planned_steps[1].forbidden_nearby_capabilities;

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("subgoal_2_planned_forbidden_nearby_capabilities_mismatch");
  });

  it("catches reflection subgoals bound to the wrong upstream capability", () => {
    const base = civilizationBoundsReflectionDebug();
    const payload = (base.debugExport as any).payload;
    payload.capability_itinerary_execution_state.compound_subgoal_ledger[1].input_bindings[0].from_capability =
      "model.direct_answer";
    payload.artifact_query_index.compound_subgoal_rail_statuses[1].input_bindings[0].from_capability =
      "model.direct_answer";

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("civilization_bounds_reflection"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "subgoal_2_input_binding_from_capability_missing:helix_ask.build_civilization_scenario_frame",
    );
  });

  it("catches scholarly reflection subgoals bound to non-scholarly upstream evidence", () => {
    const base = scholarlyReflectionCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    payload.capability_itinerary_execution_state.compound_subgoal_ledger[1].input_bindings[0].from_capability =
      "internet_search.web_research";
    payload.artifact_query_index.compound_subgoal_rail_statuses[1].input_bindings[0].from_capability =
      "internet_search.web_research";

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("scholarly_reflection_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "subgoal_2_input_binding_from_capability_missing:scholarly-research.lookup_papers",
    );
  });

  it("catches moral bridge subgoals that drop required ideology evidence binding", () => {
    const base = moralGraphReflectionBridgeDebug();
    const payload = (base.debugExport as any).payload;
    payload.capability_itinerary_execution_state.compound_subgoal_ledger[2].input_bindings =
      payload.capability_itinerary_execution_state.compound_subgoal_ledger[2].input_bindings.filter(
        (binding: Record<string, unknown>) => binding.from_capability !== "helix_ask.reflect_ideology_context",
      );
    payload.artifact_query_index.compound_subgoal_rail_statuses[2].input_bindings =
      payload.artifact_query_index.compound_subgoal_rail_statuses[2].input_bindings.filter(
        (binding: Record<string, unknown>) => binding.from_capability !== "helix_ask.reflect_ideology_context",
      );

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("moral_graph_reflection_bridge"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "subgoal_3_input_binding_from_capability_missing:helix_ask.reflect_ideology_context",
    );
  });

  it("catches dropped later subgoals instead of allowing first-tool success", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    payload.compound_capability_contract.subgoals = payload.compound_capability_contract.subgoals.slice(0, 1);
    payload.capability_itinerary_execution_state.compound_subgoal_ledger =
      payload.capability_itinerary_execution_state.compound_subgoal_ledger.slice(0, 1);
    payload.artifact_query_index.compound_subgoal_rail_statuses = [];

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("compound_subgoals_dropped:1<2");
    expect(result.failures).toContain("compound_subgoal_ledger_dropped:1<2");
    expect(result.failures).toContain("compound_subgoal_rail_statuses_dropped:0<2");
    expect(result.failures).toContain("subgoal_2_executed_mismatch:null");
  });

  it("catches missing per-subgoal rail-status debug mirrors", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    payload.artifact_query_index.compound_subgoal_rail_statuses = [];

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("compound_subgoal_rail_statuses_dropped:0<2");
    expect(result.failures).toContain("subgoal_1_rail_status_entry_missing");
    expect(result.failures).toContain("subgoal_2_rail_status_entry_missing");
  });

  it("uses synthesized rail rows for first missing subgoal diagnostics when the ledger dropped a subgoal", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    const calculatorSubgoalId = payload.compound_capability_contract.subgoals[1].subgoal_id;
    payload.capability_itinerary_execution_state.compound_subgoal_ledger =
      payload.capability_itinerary_execution_state.compound_subgoal_ledger.slice(0, 1);
    payload.artifact_query_index.compound_subgoal_rail_statuses[1] = {
      ...payload.artifact_query_index.compound_subgoal_rail_statuses[1],
      selected_capability: null,
      executed_capability: null,
      observation_kind: null,
      observation_ref: null,
      support_refs: [],
      satisfaction: "missing",
      rail_status: "fail_closed",
      first_broken_rail: "capability_execution",
      rail_failure_code: "compound_subgoal_dropped",
      repair_target: "agent_step_selection",
    };
    payload.artifact_query_index.compound_subgoal_missing_summary = {
      missing_compound_subgoal_ids: [calculatorSubgoalId],
      missing_required_capabilities: ["scientific-calculator.solve_expression"],
      next_missing_subgoal_id: calculatorSubgoalId,
      complete: false,
      assistant_answer: false,
      raw_content_included: false,
    };

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("compound_subgoal_ledger_dropped:1<2");
    expect(result.first_missing_subgoal_id).toBe(calculatorSubgoalId);
    expect(result.first_missing_subgoal_first_broken_rail).toBe("capability_execution");
    expect(result.first_missing_subgoal_rail_failure_code).toBe("compound_subgoal_dropped");
    expect(result.first_missing_subgoal_repair_target).toBe("agent_step_selection");
    expect(result.rail_requested_capabilities).toEqual([
      "workspace_os.status",
      "scientific-calculator.solve_expression",
    ]);
    expect(result.rail_selected_capabilities).toEqual(["workspace_os.status", null]);
    expect(result.rail_executed_capabilities).toEqual(["workspace_os.status", null]);
    expect(result.subgoal_first_broken_rails).toEqual([null, "capability_execution"]);
    expect(result.subgoal_rail_failure_codes).toEqual([null, "compound_subgoal_dropped"]);
    expect(result.subgoal_repair_targets).toEqual([null, "agent_step_selection"]);
  });

  it("catches calculator subgoal args that include non-math prompt text", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    payload.capability_itinerary_execution_state.compound_subgoal_ledger[1].args = {
      latex:
        "Use workspace_os.status to inspect workstation status, then call scientific-calculator.solve_expression with this exact expression: 14*23+8.",
      expression:
        "Use workspace_os.status to inspect workstation status, then call scientific-calculator.solve_expression with this exact expression: 14*23+8.",
    };

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "calculator_expression_mismatch:Use workspace_os.status to inspect workstation status, then call scientific-calculator.solve_expression with this exact expression: 14*23+8.",
    );
    expect(result.failures).toContain("calculator_expression_contains_non_math_prompt_text");
  });

  it("catches reflection/search prompt text smuggled into calculator subgoal args", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    payload.capability_itinerary_execution_state.compound_subgoal_ledger[1].args = {
      latex:
        "Use helix_ask.reflect_theory_context to connect internet_search evidence, then run scientific-calculator.solve_expression with this exact expression: (9+3)*7-25.",
      expression:
        "Use helix_ask.reflect_theory_context to connect internet_search evidence, then run scientific-calculator.solve_expression with this exact expression: (9+3)*7-25.",
    };

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "calculator_expression_mismatch:Use helix_ask.reflect_theory_context to connect internet_search evidence, then run scientific-calculator.solve_expression with this exact expression: (9+3)*7-25.",
    );
    expect(result.failures).toContain("calculator_expression_contains_non_math_prompt_text");
  });

  it("catches missing rail args even when ledger args are present", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    delete payload.artifact_query_index.compound_subgoal_rail_statuses[1].args;

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("subgoal_2_rail_args_missing");
    expect(result.failures).toContain("calculator_rail_expression_mismatch:null");
  });

  it("catches missing required-arg rail mirrors", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    delete payload.artifact_query_index.compound_subgoal_rail_statuses[1].required_args;

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("subgoal_2_rail_required_args_missing");
  });

  it("catches missing support-ref rail mirrors for satisfied subgoals", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    delete payload.artifact_query_index.compound_subgoal_rail_statuses[0].support_refs;

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("subgoal_1_rail_support_refs_missing");
  });

  it("catches missing observation provenance for satisfied subgoals", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    delete payload.capability_itinerary_execution_state.compound_subgoal_ledger[0].observation_provenance;
    delete payload.artifact_query_index.compound_subgoal_rail_statuses[0].observation_provenance;

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("subgoal_1_observation_provenance_missing");
    expect(result.failures).toContain("subgoal_1_rail_observation_provenance_missing");
  });

  it("catches calculator rail args that include non-math prompt text", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    payload.artifact_query_index.compound_subgoal_rail_statuses[1].args = {
      latex:
        "Use workspace_os.status to inspect workstation status, then call scientific-calculator.solve_expression with this exact expression: 14*23+8.",
      expression:
        "Use workspace_os.status to inspect workstation status, then call scientific-calculator.solve_expression with this exact expression: 14*23+8.",
    };

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("subgoal_2_rail_args_mismatch");
    expect(result.failures).toContain(
      "calculator_rail_expression_mismatch:Use workspace_os.status to inspect workstation status, then call scientific-calculator.solve_expression with this exact expression: 14*23+8.",
    );
    expect(result.failures).toContain("calculator_rail_expression_contains_non_math_prompt_text");
  });

  it("catches budget exhaustion and terminal projection divergence", () => {
    const base = workspaceThenCalculatorDebug({
      terminal_error_code: "agent_loop_budget_exhausted",
      terminal_artifact_kind: "typed_failure",
      terminal_presentation: {
        terminal_artifact_kind: "model_synthesized_answer",
      },
    });

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: {
        ...base.ask,
        terminal_artifact_kind: "typed_failure",
      },
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("budget_exhaustion:agent_loop_budget_exhausted");
    expect(result.failures).toContain("terminal_projection_mismatch:typed_failure!=model_synthesized_answer");
  });

  it("catches receipt terminal fallback for successful compound turns", () => {
    const base = workspaceThenCalculatorDebug({
      terminal_artifact_kind: "tool_receipt",
      terminal_presentation: {
        terminal_artifact_kind: "tool_receipt",
      },
      final_answer_source: "tool_receipt",
    });

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: {
        ...base.ask,
        terminal_artifact_kind: "tool_receipt",
        final_answer_source: "tool_receipt",
      },
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("receipt_terminal_forbidden:tool_receipt");
    expect(result.failures).toContain("receipt_final_answer_source_forbidden:tool_receipt");
  });

  it("catches document-open receipt fallback for successful compound turns", () => {
    const base = workspaceDirectoryThenDocsDebug({
      terminal_artifact_kind: "doc_open_receipt",
      terminal_presentation: {
        terminal_artifact_kind: "doc_open_receipt",
      },
      final_answer_source: "doc_open_receipt",
    });

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_directory_then_docs"),
      ask: {
        ...base.ask,
        terminal_artifact_kind: "doc_open_receipt",
        final_answer_source: "doc_open_receipt",
      },
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("receipt_terminal_forbidden:doc_open_receipt");
    expect(result.failures).toContain("receipt_final_answer_source_forbidden:doc_open_receipt");
  });

  it("catches successful compounds that agree on the wrong terminal kind", () => {
    const base = workspaceDirectoryThenDocsDebug({
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_presentation: {
        terminal_artifact_kind: "model_synthesized_answer",
      },
    });

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_directory_then_docs"),
      ask: {
        ...base.ask,
        terminal_artifact_kind: "model_synthesized_answer",
      },
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("terminal_authority_kind_mismatch:model_synthesized_answer");
    expect(result.failures).toContain("visible_terminal_kind_mismatch:model_synthesized_answer");
  });

  it("catches missing visible projection even when backend terminal authority is present", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    delete payload.terminal_presentation;
    delete payload.visible_terminal_kind;

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: {
        turn_id: base.ask.turn_id,
        terminal_artifact_kind: base.ask.terminal_artifact_kind,
        final_answer_source: base.ask.final_answer_source,
      },
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.terminal_authority_kind).toBe("model_synthesized_answer");
    expect(result.visible_terminal_kind).toBeNull();
    expect(result.backend_visible_terminal_kind).toBeNull();
    expect(result.failures).toContain("visible_terminal_kind_missing");
    expect(result.failures).toContain("backend_visible_terminal_kind_missing");
  });

  it("catches missing backend visible projection even when the API visible label is present", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    delete payload.terminal_presentation;
    delete payload.visible_terminal_kind;

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: {
        ...base.ask,
        visible_terminal_kind: "model_synthesized_answer",
      },
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.terminal_authority_kind).toBe("model_synthesized_answer");
    expect(result.visible_terminal_kind).toBe("model_synthesized_answer");
    expect(result.backend_visible_terminal_kind).toBeNull();
    expect(result.failures).toContain("backend_visible_terminal_kind_missing");
  });

  it("prefers backend single-writer authority over stale API terminal labels", () => {
    const base = workspaceDirectoryThenDocsDebug({
      terminal_authority_single_writer: {
        selected_terminal_artifact_kind: "doc_evidence_synthesis_answer",
        source: "doc_evidence_synthesis_answer",
        integrity: {
          single_writer_applied: true,
        },
      },
      terminal_presentation: {
        terminal_artifact_kind: "doc_evidence_synthesis_answer",
      },
    });

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_directory_then_docs"),
      ask: {
        ...base.ask,
        terminal_artifact_kind: "model_synthesized_answer",
        final_answer_source: "final_answer_draft",
        terminal_error_code: "terminal_projection_mismatch",
      },
      debugExport: base.debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.terminal_authority_kind).toBe("doc_evidence_synthesis_answer");
    expect(result.visible_terminal_kind).toBe("doc_evidence_synthesis_answer");
    expect(result.final_answer_source).toBe("doc_evidence_synthesis_answer");
    expect(result.terminal_error_code).toBeNull();
  });

  it("catches missing terminal authority on successful compound turns", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    delete payload.terminal_artifact_kind;
    delete payload.terminal_presentation;

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: {
        turn_id: base.ask.turn_id,
        final_answer_source: base.ask.final_answer_source,
      },
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("terminal_authority_kind_missing");
    expect(result.failures).toContain("visible_terminal_kind_missing");
  });

  it("catches compound final drafts missing satisfied subgoal support refs", () => {
    const base = workspaceThenCalculatorDebug({
      terminal_error_code: "compound_subgoal_support_refs_missing",
      compound_subgoal_draft_support_coverage: {
        schema: "helix.compound_subgoal_draft_support_coverage.v1",
        applies: true,
        ok: false,
        missing_observation_refs: ["obs:calculator"],
      },
    });

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("compound_draft_missing_subgoal_support_refs:obs:calculator");
  });

  it("accepts expected invalid-args fail-closed subgoals without treating them as live-probe regressions", () => {
    const { ask, debugExport } = invalidCalculatorArgsFailClosedDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("invalid_calculator_args_fail_closed"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.terminal_error_code).toBe("invalid_arg:latex_is_prose");
    expect(result.final_answer_source).toBe("typed_failure");
    expect(result.executed_capabilities).toEqual(["docs.search", null]);
    expect(result.subgoal_satisfactions).toEqual(["satisfied", "failed"]);
    expect(result.subgoal_rail_statuses).toEqual(["complete", "fail_closed"]);
    expect(result.subgoal_first_broken_rails).toEqual([null, "capability_execution"]);
    expect(result.subgoal_rail_failure_codes).toEqual([null, "invalid_arg:latex_is_prose"]);
    expect(result.subgoal_repair_targets).toEqual([null, "subgoal_argument_extraction"]);
    expect(result.missing_required_capabilities).toEqual(["scientific-calculator.solve_expression"]);
    expect(result.missing_compound_subgoal_ids).toEqual([
      "ask:test:compound-invalid-args:compound_capability_subgoal:2:scientific-calculator_solve_expression",
    ]);
    expect(result.next_missing_subgoal_id).toBe(
      "ask:test:compound-invalid-args:compound_capability_subgoal:2:scientific-calculator_solve_expression",
    );
    expect(result.first_missing_subgoal_id).toBe(
      "ask:test:compound-invalid-args:compound_capability_subgoal:2:scientific-calculator_solve_expression",
    );
    expect(result.first_missing_subgoal_first_broken_rail).toBe("capability_execution");
    expect(result.first_missing_subgoal_rail_failure_code).toBe("invalid_arg:latex_is_prose");
    expect(result.first_missing_subgoal_repair_target).toBe("subgoal_argument_extraction");
    expect(result.compound_complete).toBe(false);
  });

  it("accepts expected missing-required-args fail-closed subgoals without treating them as live-probe regressions", () => {
    const { ask, debugExport } = missingCalculatorArgsFailClosedDebug();

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("missing_calculator_args_fail_closed"),
      ask,
      debugExport,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.terminal_error_code).toBe("missing_required_arg:latex");
    expect(result.final_answer_source).toBe("typed_failure");
    expect(result.executed_capabilities).toEqual(["docs.search", null]);
    expect(result.subgoal_satisfactions).toEqual(["satisfied", "failed"]);
    expect(result.subgoal_rail_statuses).toEqual(["complete", "fail_closed"]);
    expect(result.subgoal_first_broken_rails).toEqual([null, "capability_execution"]);
    expect(result.subgoal_rail_failure_codes).toEqual([null, "missing_required_arg:latex"]);
    expect(result.subgoal_repair_targets).toEqual([null, "subgoal_argument_extraction"]);
    expect(result.missing_required_capabilities).toEqual(["scientific-calculator.solve_expression"]);
    expect(result.first_missing_subgoal_first_broken_rail).toBe("capability_execution");
    expect(result.first_missing_subgoal_rail_failure_code).toBe("missing_required_arg:latex");
    expect(result.first_missing_subgoal_repair_target).toBe("subgoal_argument_extraction");
    expect(result.compound_complete).toBe(false);
  });

  it("catches compound contract terms dropped from ledger and rail mirrors", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    delete payload.compound_capability_contract.subgoals[1].required_observation_kinds;
    delete payload.compound_capability_contract.subgoals[1].required_terminal_kind;
    delete payload.compound_capability_contract.subgoals[1].allowed_substitutions;
    delete payload.compound_capability_contract.subgoals[1].forbidden_nearby_capabilities;
    delete payload.capability_itinerary.compound_capability_contract.subgoals[1].forbidden_nearby_capabilities;
    delete payload.capability_itinerary.planned_steps[1].forbidden_nearby_capabilities;
    delete payload.capability_itinerary_execution_state.compound_subgoal_ledger[1].required_observation_kinds;
    delete payload.capability_itinerary_execution_state.compound_subgoal_ledger[1].required_terminal_kind;
    delete payload.capability_itinerary_execution_state.compound_subgoal_ledger[1].allowed_substitutions;
    delete payload.capability_itinerary_execution_state.compound_subgoal_ledger[1].forbidden_nearby_capabilities;
    delete payload.artifact_query_index.compound_subgoal_rail_statuses[1].required_observation_kinds;
    delete payload.artifact_query_index.compound_subgoal_rail_statuses[1].required_terminal_kind;
    delete payload.artifact_query_index.compound_subgoal_rail_statuses[1].allowed_substitutions;
    delete payload.artifact_query_index.compound_subgoal_rail_statuses[1].forbidden_nearby_capabilities;

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("subgoal_2_contract_required_observation_kinds_missing");
    expect(result.failures).toContain("subgoal_2_contract_required_terminal_kind_missing");
    expect(result.failures).toContain("subgoal_2_contract_allowed_substitutions_missing");
    expect(result.failures).toContain("subgoal_2_contract_forbidden_nearby_capabilities_missing");
    expect(result.failures).toContain("subgoal_2_required_observation_kinds_missing");
    expect(result.failures).toContain("subgoal_2_required_terminal_kind_missing");
    expect(result.failures).toContain("subgoal_2_allowed_substitutions_missing");
    expect(result.failures).toContain("subgoal_2_forbidden_nearby_capabilities_missing");
    expect(result.failures).toContain("subgoal_2_rail_required_observation_kinds_missing");
    expect(result.failures).toContain("subgoal_2_rail_required_terminal_kind_missing");
    expect(result.failures).toContain("subgoal_2_rail_allowed_substitutions_missing");
    expect(result.failures).toContain("subgoal_2_rail_forbidden_nearby_capabilities_missing");
  });

  it("catches compound terminal contribution metadata dropped from contract, ledger, and rail mirrors", () => {
    const base = workspaceThenCalculatorDebug();
    const payload = (base.debugExport as any).payload;
    delete payload.compound_capability_contract.subgoals[1].terminal_contribution_kind;
    delete payload.compound_capability_contract.subgoals[1].contribution_role;
    delete payload.capability_itinerary.compound_capability_contract.subgoals[1].terminal_contribution_kind;
    delete payload.capability_itinerary.compound_capability_contract.subgoals[1].contribution_role;
    delete payload.capability_itinerary_execution_state.compound_subgoal_ledger[1].terminal_contribution_kind;
    delete payload.capability_itinerary_execution_state.compound_subgoal_ledger[1].contribution_role;
    delete payload.artifact_query_index.compound_subgoal_rail_statuses[1].terminal_contribution_kind;
    delete payload.artifact_query_index.compound_subgoal_rail_statuses[1].contribution_role;

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("workspace_then_calculator"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("subgoal_2_contract_terminal_contribution_kind_missing");
    expect(result.failures).toContain("subgoal_2_contract_contribution_role_missing");
    expect(result.failures).toContain("subgoal_2_terminal_contribution_kind_missing");
    expect(result.failures).toContain("subgoal_2_contribution_role_missing");
    expect(result.failures).toContain("subgoal_2_rail_terminal_contribution_kind_missing");
    expect(result.failures).toContain("subgoal_2_rail_contribution_role_missing");
  });

  it("catches failed subgoals missing typed rail metadata", () => {
    const base = invalidCalculatorArgsFailClosedDebug();
    const payload = (base.debugExport as any).payload;
    delete payload.capability_itinerary_execution_state.compound_subgoal_ledger[1].first_broken_rail;
    delete payload.capability_itinerary_execution_state.compound_subgoal_ledger[1].rail_failure_code;
    delete payload.artifact_query_index.compound_subgoal_rail_statuses[1].first_broken_rail;
    delete payload.artifact_query_index.compound_subgoal_rail_statuses[1].rail_failure_code;

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("invalid_calculator_args_fail_closed"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("subgoal_2_first_broken_rail_missing");
    expect(result.failures).toContain("subgoal_2_failure_code_missing");
    expect(result.failures).toContain("subgoal_2_rail_first_broken_rail_missing");
    expect(result.failures).toContain("subgoal_2_rail_failure_code_missing");
  });

  it("catches failed subgoals whose rail failure code diverges from the ledger", () => {
    const base = invalidCalculatorArgsFailClosedDebug();
    const payload = (base.debugExport as any).payload;
    payload.artifact_query_index.compound_subgoal_rail_statuses[1].rail_failure_code = "wrong_failure_code";

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("invalid_calculator_args_fail_closed"),
      ask: base.ask,
      debugExport: base.debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "subgoal_2_rail_failure_code_mirror_mismatch:wrong_failure_code!=invalid_arg:latex_is_prose",
    );
  });

  it("rejects invalid-args fail-closed scenarios when the terminal error is not the expected typed failure", () => {
    const { ask, debugExport } = invalidCalculatorArgsFailClosedDebug({
      terminal_error_code: "agent_loop_budget_exhausted",
    });

    const result = evaluateCompoundCapabilityScenario({
      scenario: scenarioById("invalid_calculator_args_fail_closed"),
      ask,
      debugExport,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("budget_exhaustion:agent_loop_budget_exhausted");
    expect(result.failures).toContain("terminal_error_code_mismatch:agent_loop_budget_exhausted");
  });
});
