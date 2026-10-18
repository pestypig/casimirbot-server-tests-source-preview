import { describe, expect, it } from "vitest";

import { WORKSTATION_AGENT_GOAL_CONTEXT_FEED_QUERY_ACTUATORS } from "@shared/contracts/workstation-goal-context.v1";
import {
  HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
  HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
} from "@shared/helix-scholarly-research-observation";
import { explicitCapabilityContractForCapability } from "../services/helix-ask/explicit-capability-contract";
import {
  TOOL_FAMILY_CONTRACTS,
  TOOL_FAMILY_DEFAULT_CONTRACTS,
  resolveToolFamilyContract,
  type ToolFamily,
} from "../services/helix-ask/tool-family-contract";
import {
  evaluateToolFamilyTerminalPolicy,
  isWorkstationObservationTerminalKind,
} from "../services/helix-ask/tool-family-terminal-policy";
import { WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS } from "../services/helix-ask/workstation-context-feed-query-tool-contracts";

const activeParityToolFamilies: ToolFamily[] = [
  "calculator",
  "internet_search",
  "scholarly_research",
  "repo_code",
  "docs_viewer",
  "workspace_directory",
  "workspace_diagnostic",
  "workstation",
  "visual_capture",
  "procedure_memory",
  "live_environment",
  "live_source_mail",
  "live_source_decision",
  "voice_delivery",
  "moral_graph_reflection",
  "theory_locator",
  "context_reflection",
  "civilization_bounds",
  "capability_catalog",
];

const routeContract = (allowed: string[], forbidden: string[] = []) => ({
  schema: "helix.route_product_contract.v1",
  turn_id: "ask:tool-family",
  thread_id: "thread:tool-family",
  source_target: "workstation_panel",
  allowed_terminal_artifact_kinds: allowed,
  forbidden_terminal_artifact_kinds: forbidden,
  required_artifact_refs: [],
  precedence_reason: "test",
  assistant_answer: false,
  raw_content_included: false,
});

describe("Helix Ask tool-family contract registry", () => {
  it("has a concrete default contract for every shared tool family", () => {
    expect(Object.keys(TOOL_FAMILY_DEFAULT_CONTRACTS).sort()).toEqual([...activeParityToolFamilies].sort());

    for (const family of activeParityToolFamilies) {
      expect(TOOL_FAMILY_DEFAULT_CONTRACTS[family]).toMatchObject({
        toolFamily: family,
        defaultAssistantAnswer: false,
        defaultTerminalEligible: false,
        defaultRawContentIncluded: false,
      });
    }
  });

  it("registers the required named tools and civilization receipts", () => {
    const required = [
      ["live_env.check_live_source_mail", "live_source_mail", "evidence_only"],
      ["live_env.read_live_source_mail", "live_source_mail", "evidence_only"],
      ["live_env.read_processed_live_source_mail", "live_source_mail", "evidence_only"],
      ["live_env.reflect_live_source_mail_loop", "live_source_mail", "evidence_only"],
      ["live_env.query_workstation_goal_context", "live_environment", "evidence_only"],
      ["live_env.start_agent_goal_session", "live_environment", "control_receipt"],
      ["live_env.query_source_health", "live_environment", "evidence_only"],
      ["live_env.query_live_source_quality", "live_source_mail", "evidence_only"],
      ["live_env.summarize_live_source_current_state", "live_source_mail", "evidence_only"],
      ["live_env.query_trace_memory", "live_environment", "evidence_only"],
      ["live_env.evaluate_goal_satisfaction", "live_environment", "evidence_only"],
      ["live_env.query_packet_traces", "live_environment", "evidence_only"],
      ["live_env.query_visual_summaries", "live_environment", "evidence_only"],
      ["live_env.query_audio_transcripts", "live_environment", "evidence_only"],
      ["live_env.query_translation_segments", "live_environment", "evidence_only"],
      ["live_env.query_microdeck_outputs", "live_environment", "evidence_only"],
      ["live_env.query_live_answer_state", "live_environment", "evidence_only"],
      ["live_env.query_narrator_events", "live_environment", "evidence_only"],
      ["live_env.query_route_evidence", "live_environment", "evidence_only"],
      ["live_env.query_automation_policies", "live_environment", "evidence_only"],
      ["live_env.configure_route_watch", "live_environment", "control_receipt"],
      ["live_env.configure_live_source_watch_job", "live_environment", "control_receipt"],
      ["live_env.change_workstation_preset", "live_environment", "control_receipt"],
      ["live_env.set_visual_preset", "live_environment", "control_receipt"],
      ["live_env.set_audio_preset", "live_environment", "control_receipt"],
      ["live_env.bind_workstation_source", "live_environment", "control_receipt"],
      ["live_env.unbind_workstation_source", "live_environment", "control_receipt"],
      ["live_env.pause_workstation_loop", "live_environment", "control_receipt"],
      ["live_env.resume_workstation_loop", "live_environment", "control_receipt"],
      ["live_env.set_workstation_loop_state", "live_environment", "control_receipt"],
      ["live_env.repair_loop", "live_environment", "control_receipt"],
      ["live_env.repair_workstation_source", "live_environment", "control_receipt"],
      ["live_env.update_live_answer_projection", "live_environment", "control_receipt"],
      ["live_env.focus_process_graph", "live_environment", "control_receipt"],
      ["live_env.process_live_source_mail", "live_source_mail", "evidence_only"],
      ["live_env.record_live_source_mail_decision", "live_source_decision", "control_receipt"],
      ["live_env.request_interim_voice_callout", "voice_delivery", "control_receipt"],
      ["live_env.narrator_say", "live_environment", "control_receipt"],
      ["live_env.narrator_bind_stream", "live_environment", "control_receipt"],
      ["scientific-calculator.solve_expression", "calculator", "evidence_only"],
      ["repo-code.search_concept", "repo_code", "evidence_only"],
      ["docs-viewer.open", "docs_viewer", "control_receipt"],
      ["docs-viewer.locate_in_doc", "docs_viewer", "evidence_only"],
      ["docs-viewer.doc_equation_context", "docs_viewer", "evidence_only"],
      ["workspace-directory.resolve", "workspace_directory", "evidence_only"],
      ["workspace_os.status", "workspace_diagnostic", "evidence_only"],
      ["workstation-notes.append_to_note", "workstation", "control_receipt"],
      ["internet_search.web_research", "internet_search", "evidence_only"],
      [HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY, "scholarly_research", "evidence_only"],
      [HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY, "scholarly_research", "evidence_only"],
      ["image_lens.inspect", "visual_capture", "evidence_only"],
      ["situation-room.describe_visual_capture", "visual_capture", "evidence_only"],
      ["procedure_memory:retrieve_procedure_evidence", "procedure_memory", "evidence_only"],
      ["helix_ask.reflect_theory_context", "theory_locator", "evidence_only"],
      ["helix.theory.frontierVectorFieldTrace", "theory_locator", "evidence_only"],
      ["helix_ask.reflect_ideology_context", "moral_graph_reflection", "evidence_only"],
      ["helix_ask.bridge_theory_ideology_context", "moral_graph_reflection", "evidence_only"],
      ["helix_ask.build_civilization_scenario_frame", "civilization_bounds", "evidence_only"],
      ["helix_ask.reflect_civilization_bounds", "civilization_bounds", "evidence_only"],
      ["helix_civilization_bounds_tool_result", "civilization_bounds", "evidence_only"],
      ["helix_ask.inspect_capability_catalog", "capability_catalog", "evidence_only"],
      ["helix_ask.reflect_workstation_tool_alignment", "capability_catalog", "evidence_only"],
      ["helix_ask.reflect_live_synthetic_data", "context_reflection", "evidence_only"],
      ["helix_ask.reflect_context_attachments", "context_reflection", "evidence_only"],
      ["toolchain_matrix", "capability_catalog", "evidence_only"],
      ["microdeck_reflection", "context_reflection", "evidence_only"],
      ["macro_reasoner_deck_reflection", "context_reflection", "evidence_only"],
      ["mail_loop_synthetic_data", "context_reflection", "evidence_only"],
    ];

    for (const [toolName, toolFamily, authority] of required) {
      expect(resolveToolFamilyContract({ toolName })).toMatchObject({
        toolFamily,
        authority,
        defaultAssistantAnswer: false,
        defaultTerminalEligible: false,
        defaultRawContentIncluded: false,
      });
    }
  });

  it("derives workstation context-feed query contracts from the canonical feed actuator map", () => {
    const specsByFeed = new Map(WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS.map((spec) => [spec.feedKind, spec]));

    expect([...specsByFeed.keys()].sort()).toEqual(Object.keys(WORKSTATION_AGENT_GOAL_CONTEXT_FEED_QUERY_ACTUATORS).sort());

    for (const [feedKind, actuator] of Object.entries(WORKSTATION_AGENT_GOAL_CONTEXT_FEED_QUERY_ACTUATORS)) {
      const spec = specsByFeed.get(feedKind as keyof typeof WORKSTATION_AGENT_GOAL_CONTEXT_FEED_QUERY_ACTUATORS);

      expect(spec).toBeDefined();
      expect(spec).toMatchObject({
        feedKind,
        actuator,
        capability: `live_env.${actuator}`,
      });
      expect(spec?.label).toEqual(expect.any(String));
      expect(spec?.label.length).toBeGreaterThan(0);
      expect(spec?.plannerExpectedReceiptKind).toEqual(expect.any(String));
      expect(spec?.plannerExpectedReceiptKind.length).toBeGreaterThan(0);

      const familyContract = resolveToolFamilyContract({ toolName: spec?.capability });
      expect(familyContract).toMatchObject({
        toolName: spec?.capability,
        toolFamily: "live_environment",
        authority: "evidence_only",
        mutating: false,
        allowedTerminalKinds: ["model_synthesized_answer"],
        requiredReentry: true,
        requiresGoalSatisfaction: true,
        defaultAssistantAnswer: false,
        defaultTerminalEligible: false,
        defaultRawContentIncluded: false,
      });
      expect(familyContract?.requiredObservationKinds).toEqual([
        "live_environment_tool_observation",
        ...(spec?.toolFamilyRequiredObservationKinds ?? []),
        spec?.explicitRequiredObservationKind,
      ]);
      expect(familyContract?.aliases).toEqual(spec?.aliases);

      const explicitContract = explicitCapabilityContractForCapability(spec?.capability);
      expect(explicitContract).toMatchObject({
        capability: spec?.capability,
        capability_family: "live_environment",
        plan_family: "live_environment",
        source_target: "live_environment",
        admission_families: ["live_environment"],
        required_terminal_kind: "model_synthesized_answer",
        allowed_substitutions: [],
      });
      expect(explicitContract?.aliases).toEqual(spec?.aliases);
      expect(explicitContract?.required_observation_kinds).toEqual([
        "live_environment_tool_observation",
        spec?.explicitRequiredObservationKind,
        "helix.workstation_goal_context_update.v1",
      ]);
      expect(explicitCapabilityContractForCapability(actuator)?.capability).toBe(spec?.capability);
    }
  });

  it("resolves every registered tool to a contract with nonterminal receipt defaults", () => {
    for (const entry of TOOL_FAMILY_CONTRACTS) {
      expect(resolveToolFamilyContract({ toolName: entry.toolName })).toMatchObject({
        toolName: entry.toolName,
        toolFamily: entry.toolFamily,
        authority: entry.authority,
        defaultAssistantAnswer: false,
        defaultTerminalEligible: false,
        defaultRawContentIncluded: false,
      });
      expect(entry.requiredObservationKinds.length).toBeGreaterThan(0);
      expect(entry.requiredReentry).toBe(true);
      expect(entry.requiresGoalSatisfaction).toBe(true);
    }
  });

  it("keeps default tool receipts nonterminal and non-answering", () => {
    for (const entry of TOOL_FAMILY_CONTRACTS) {
      const receiptKind = entry.requiredObservationKinds[0] ?? "tool_receipt";
      const decision = evaluateToolFamilyTerminalPolicy({
        toolName: entry.toolName,
        terminalArtifactKind: receiptKind,
        routeProductContract: routeContract([receiptKind, "model_synthesized_answer"]),
        canonicalGoalFrame: {
          goal_kind: "tool_result",
          required_terminal_kind: receiptKind,
        },
        admitted: true,
        goalSatisfied: true,
        operatorCommandPresent: true,
        mutating: entry.mutating,
      });

      expect(decision.assistant_answer).toBe(false);
      expect(decision.terminal_eligible).toBe(false);
      expect(decision.raw_content_included).toBe(false);
      expect(decision.candidate_artifact_kind).toBe(receiptKind);
      expect((decision as unknown as { terminal_artifact_kind?: unknown }).terminal_artifact_kind).toBeUndefined();
    }
  });

  it("classifies workstation circuit observations as nonterminal artifact kinds", () => {
    expect(isWorkstationObservationTerminalKind("helix.workstation_goal_context_update.v1")).toBe(true);
    expect(isWorkstationObservationTerminalKind("stage_play_workstation_context_feed_query_result/v1")).toBe(true);
    expect(isWorkstationObservationTerminalKind("stage_play_micro_reasoner_run/v1")).toBe(true);
    expect(isWorkstationObservationTerminalKind("helix.narrator_event/v1")).toBe(true);
  });

  it("prevents read-only evidence tools from writing terminal answer fields", () => {
    const evidenceTools = TOOL_FAMILY_CONTRACTS.filter((entry) => entry.authority === "evidence_only");

    for (const entry of evidenceTools) {
      const receiptKind = `${entry.toolFamily}_receipt`;
      const decision = evaluateToolFamilyTerminalPolicy({
        toolName: entry.toolName,
        terminalArtifactKind: receiptKind,
        routeProductContract: routeContract([receiptKind, "model_synthesized_answer"]),
        canonicalGoalFrame: {
          goal_kind: "evidence_tool_result",
          required_terminal_kind: receiptKind,
        },
        admitted: true,
        goalSatisfied: true,
        operatorCommandPresent: true,
        mutating: false,
      });

      expect(decision, `${entry.toolName}:${receiptKind}`).toMatchObject({
        allowed: false,
        reason: "evidence_only_tool_cannot_terminalize_receipt",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      });
    }
  });

  it("keeps workstation observation artifacts nonterminal even when a route contract names them", () => {
    const observationCases = [
      ["live_env.query_workstation_goal_context", "helix.workstation_goal_context_update.v1"],
      ["live_env.query_workstation_goal_context", "helix.agent_goal_session.v1"],
      ["live_env.start_agent_goal_session", "stage_play_agent_goal_session_tool_result/v1"],
      ["live_env.query_trace_memory", "helix.workstation_reasoning_trace_query_result.v1"],
      ["live_env.query_packet_traces", "stage_play_packet_trace_query_result.v1"],
      ["live_env.query_packet_traces", "live_source_causal_trace/v1"],
      ["live_env.query_visual_summaries", "stage_play_workstation_context_feed_query_result.v1"],
      ["live_env.query_visual_summaries", "visual_summaries"],
      ["live_env.query_audio_transcripts", "audio_transcripts"],
      ["live_env.query_translation_segments", "translated_transcripts"],
      ["live_env.query_microdeck_outputs", "microdeck_outputs"],
      ["live_env.query_microdeck_outputs", "stage_play_microdeck_output"],
      ["live_env.query_live_answer_state", "live_answer_lines"],
      ["live_env.query_live_answer_state", "panel_projection"],
      ["live_env.query_live_answer_state", "stage_play_live_answer_projection"],
      ["live_env.query_narrator_events", "narrator_events"],
      ["live_env.query_narrator_events", "narrator_bindings"],
      ["live_env.query_packet_traces", "packet_traces"],
      ["live_env.query_workstation_goal_context", "route_evidence"],
      ["live_env.evaluate_goal_satisfaction", "helix.live_environment_goal_satisfaction.v1"],
      ["live_env.evaluate_goal_satisfaction", "goal_satisfaction"],
      ["live_env.query_route_evidence", "stage_play_workstation_context_feed_query_result.v1"],
      ["live_env.query_route_evidence", "route_evidence"],
      ["live_env.query_route_evidence", "automation_policies"],
      ["live_env.query_route_evidence", "automation_status"],
      ["live_env.query_automation_policies", "stage_play_workstation_context_feed_query_result.v1"],
      ["live_env.query_automation_policies", "automation_policies"],
      ["live_env.query_automation_policies", "automation_status"],
      ["live_env.query_trace_memory", "trace_memory"],
      ["live_env.query_microdeck_outputs", "microdeck_output"],
      ["live_env.query_live_answer_state", "live_answer_projection"],
      ["live_env.query_source_health", "source_health"],
      ["live_env.narrator_say", "helix.narrator_say_request.v1"],
      ["live_env.narrator_bind_stream", "helix.narrator_bind_stream_request.v1"],
      ["live_env.narrator_say", "helix.narrator_event/v1"],
      ["live_env.change_workstation_preset", "stage_play_workstation_control_receipt/v1"],
      ["live_env.read_processed_live_source_mail", "stage_play_live_source_mail_wake_request/v1"],
      ["live_env.read_processed_live_source_mail", "stage_play_live_source_mail_wake_result/v1"],
      ["live_env.read_processed_live_source_mail", "stage_play_live_source_mail_wake_result_projection/v1"],
      ["live_env.read_processed_live_source_mail", "stage_play_live_source_mail_wake_result_observation/v1"],
    ];

    for (const [toolName, terminalArtifactKind] of observationCases) {
      const decision = evaluateToolFamilyTerminalPolicy({
        toolName,
        terminalArtifactKind,
        routeProductContract: routeContract([terminalArtifactKind, "model_synthesized_answer"]),
        canonicalGoalFrame: {
          goal_kind: "workstation_observation_debug",
          required_terminal_kind: terminalArtifactKind,
        },
        admitted: true,
        goalSatisfied: true,
        operatorCommandPresent: true,
        mutating: false,
      });

      expect(decision).toMatchObject({
        allowed: false,
        reason: "observation_artifact_cannot_terminalize",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      });
    }
  });

  it("requires route product authorization before control receipts can terminalize", () => {
    const controlTools = TOOL_FAMILY_CONTRACTS.filter((entry) => entry.authority === "control_receipt");

    for (const entry of controlTools) {
      const receiptKind = entry.allowedTerminalKinds.find((kind) => kind !== "model_synthesized_answer") ??
        entry.requiredObservationKinds.at(-1) ??
        "workspace_action_receipt";
      const decision = evaluateToolFamilyTerminalPolicy({
        toolName: entry.toolName,
        terminalArtifactKind: receiptKind,
        routeProductContract: routeContract(["model_synthesized_answer"], [receiptKind]),
        canonicalGoalFrame: {
          goal_kind: "control_receipt",
          required_terminal_kind: receiptKind,
        },
        admitted: true,
        goalSatisfied: true,
        operatorCommandPresent: true,
        mutating: entry.mutating,
      });

      const expectedReason = isWorkstationObservationTerminalKind(receiptKind)
        ? "observation_artifact_cannot_terminalize"
        : "terminal_kind_forbidden_by_route_product_contract";
      expect(decision, `${entry.toolName}:${receiptKind}`).toMatchObject({
        allowed: false,
        reason: expectedReason,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      });
    }
  });

  it("blocks evidence-only tool receipts from becoming terminal answers", () => {
    const decision = evaluateToolFamilyTerminalPolicy({
      toolName: "scientific-calculator.solve_expression",
      toolFamily: "calculator",
      terminalArtifactKind: "calculator_receipt",
      routeProductContract: routeContract(["calculator_receipt", "model_synthesized_answer"]),
      canonicalGoalFrame: {
        goal_kind: "calculator_solve",
        required_terminal_kind: "calculator_receipt",
      },
      admitted: true,
      goalSatisfied: true,
      operatorCommandPresent: true,
      mutating: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("evidence_only_tool_cannot_terminalize_receipt");
    expect(decision.assistant_answer).toBe(false);
    expect(decision.terminal_eligible).toBe(false);
  });

  it("allows admitted control receipts only when route and goal contract match", () => {
    const allowed = evaluateToolFamilyTerminalPolicy({
      toolName: "click_or_activate_control",
      toolFamily: "workstation_action",
      terminalArtifactKind: "workspace_action_receipt",
      routeProductContract: routeContract(["workspace_action_receipt", "typed_failure"]),
      canonicalGoalFrame: {
        goal_kind: "panel_control",
        required_terminal_kind: "workspace_action_receipt",
      },
      admitted: true,
      goalSatisfied: true,
      operatorCommandPresent: true,
      mutating: true,
    });

    const blockedByRoute = evaluateToolFamilyTerminalPolicy({
      toolName: "click_or_activate_control",
      toolFamily: "workstation_action",
      terminalArtifactKind: "workspace_action_receipt",
      routeProductContract: routeContract(["model_synthesized_answer"], ["workspace_action_receipt"]),
      canonicalGoalFrame: {
        goal_kind: "panel_control",
        required_terminal_kind: "workspace_action_receipt",
      },
      admitted: true,
      goalSatisfied: true,
      operatorCommandPresent: true,
      mutating: true,
    });

    const blockedByGoal = evaluateToolFamilyTerminalPolicy({
      toolName: "docs-viewer.open",
      toolFamily: "docs_viewer",
      terminalArtifactKind: "doc_open_receipt",
      routeProductContract: routeContract(["doc_open_receipt", "doc_summary"]),
      canonicalGoalFrame: {
        goal_kind: "doc_summary",
        required_terminal_kind: "doc_summary",
      },
      admitted: true,
      goalSatisfied: true,
      operatorCommandPresent: true,
      mutating: true,
    });

    expect(allowed.allowed).toBe(true);
    expect(allowed.reason).toBe("terminal_kind_allowed_by_control_receipt_contract");
    expect(blockedByRoute).toMatchObject({
      allowed: false,
      reason: "terminal_kind_forbidden_by_route_product_contract",
    });
    expect(blockedByGoal).toMatchObject({
      allowed: false,
      reason: "control_receipt_requires_matching_goal_terminal",
    });
  });

  it("requires an operator command before a mutating control receipt can terminalize", () => {
    const decision = evaluateToolFamilyTerminalPolicy({
      toolName: "workstation-notes.append_to_note",
      terminalArtifactKind: "workspace_action_receipt",
      routeProductContract: routeContract(["workspace_action_receipt"]),
      canonicalGoalFrame: {
        goal_kind: "note_mutation",
        required_terminal_kind: "workspace_action_receipt",
      },
      admitted: true,
      goalSatisfied: true,
      operatorCommandPresent: false,
      mutating: true,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("mutating_control_receipt_requires_operator_command");
  });
});
