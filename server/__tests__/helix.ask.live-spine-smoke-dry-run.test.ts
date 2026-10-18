import { describe, expect, it } from "vitest";

import {
  classifyLiveSpineSmokeResult,
  LIVE_SPINE_SMOKE_SCENARIOS,
  REQUIRED_LIVE_SPINE_COVERAGE,
  selectLiveSpineSmokeScenarios,
  summarizeLiveSpineSmokeCoverage,
  type LiveSpineScenario,
} from "../../scripts/helix-ask-live-spine-smoke";
import { CODEX_PARITY_AGENT_SPINE_CLASSES } from "../services/helix-ask/codex-parity-agent-spine-contract";
import { HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION } from "../services/helix-ask/terminal-rail-failure-reconciliation";

describe("Helix Ask live spine smoke dry-run contract", () => {
  it("covers every Codex-parity tool family required by the convergence goal", () => {
    const coverageSummary = summarizeLiveSpineSmokeCoverage();
    const coverage = new Set(coverageSummary.covered);

    expect(coverageSummary.required).toEqual(REQUIRED_LIVE_SPINE_COVERAGE);
    expect(coverageSummary.complete).toBe(true);
    expect(coverageSummary.missing).toEqual([]);
    for (const required of REQUIRED_LIVE_SPINE_COVERAGE) {
      expect(coverage.has(required), `missing live-spine coverage ${required}`).toBe(true);
    }

    for (const scenario of LIVE_SPINE_SMOKE_SCENARIOS) {
      expect(typeof scenario.id).toBe("string");
      expect(Array.isArray(scenario.coverage)).toBe(true);
      expect(scenario.expected).toBeTruthy();
    }
    expect(new Set(LIVE_SPINE_SMOKE_SCENARIOS.map((scenario) => scenario.id)).size).toBe(
      LIVE_SPINE_SMOKE_SCENARIOS.length,
    );
  });

  it("fails fixture classification when the server freshness marker is missing", () => {
    const scenario = LIVE_SPINE_SMOKE_SCENARIOS.find((entry) => entry.id === "capability_catalog_runtime");
    expect(scenario).toBeTruthy();

    const result = classifyLiveSpineSmokeResult(
      scenario!,
      buildCapabilityCatalogAskFixture({ includeRuntimeMarker: false }),
      { payload: {} },
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.failures).toContain("server_runtime_marker_missing:tool_rail_terminal_failure_reconciliation");
  });

  it("passes fixture classification when the server freshness marker is current", () => {
    const scenario = LIVE_SPINE_SMOKE_SCENARIOS.find((entry) => entry.id === "capability_catalog_runtime");
    expect(scenario).toBeTruthy();

    const result = classifyLiveSpineSmokeResult(
      scenario!,
      buildCapabilityCatalogAskFixture({ includeRuntimeMarker: true }),
      { payload: {} },
    );

    expect(result.verdict).toBe("PASS");
    expect(result.failures).toEqual([]);
    expect(result.tool_rail_terminal_failure_reconciliation_runtime).toMatchObject({
      available: true,
      version: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
    });
  });

  it("fails calculator fixture classification when calculator panel action receipts are missing", () => {
    const scenario = LIVE_SPINE_SMOKE_SCENARIOS.find((entry) => entry.id === "calculator_explicit");
    expect(scenario).toBeTruthy();

    const result = classifyLiveSpineSmokeResult(
      scenario!,
      buildCalculatorAskFixture({ includeActionEnvelope: false }),
      { payload: {} },
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "action_envelope_missing:scientific-calculator.open_panel",
        "action_envelope_missing:scientific-calculator.focus_panel",
      ]),
    );
  });

  it("passes calculator fixture classification when calculator panel action receipts are present", () => {
    const scenario = LIVE_SPINE_SMOKE_SCENARIOS.find((entry) => entry.id === "calculator_explicit");
    expect(scenario).toBeTruthy();

    const result = classifyLiveSpineSmokeResult(
      scenario!,
      buildCalculatorAskFixture({ includeActionEnvelope: true }),
      { payload: {} },
    );

    expect(result.verdict).toBe("PASS");
    expect(result.failures).toEqual([]);
    expect(result.action_envelope_capabilities).toEqual([
      "scientific-calculator.focus_panel",
      "scientific-calculator.open_panel",
    ]);
  });

  it("fails fixture classification when visible projection source is missing", () => {
    const scenario = LIVE_SPINE_SMOKE_SCENARIOS.find((entry) => entry.id === "capability_catalog_runtime");
    expect(scenario).toBeTruthy();
    const ask = buildCapabilityCatalogAskFixture({ includeRuntimeMarker: true });
    const rail = ask.codex_parity_agent_spine_rail_table as Record<string, unknown>;
    rail.visible_projection_source = null;

    const result = classifyLiveSpineSmokeResult(
      scenario!,
      ask,
      { payload: {} },
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.failures).toContain("visible_projection_source_missing");
  });

  it("fails fixture classification when visible projection source is not proven", () => {
    const scenario = LIVE_SPINE_SMOKE_SCENARIOS.find((entry) => entry.id === "capability_catalog_runtime");
    expect(scenario).toBeTruthy();
    const ask = buildCapabilityCatalogAskFixture({ includeRuntimeMarker: true });
    const rail = ask.codex_parity_agent_spine_rail_table as Record<string, unknown>;
    rail.visible_projection_proven = false;

    const result = classifyLiveSpineSmokeResult(
      scenario!,
      ask,
      { payload: {} },
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.failures).toContain("visible_projection_not_proven");
  });

  it("fails fixture classification when a debug rail mirror is stale", () => {
    const scenario = LIVE_SPINE_SMOKE_SCENARIOS.find((entry) => entry.id === "capability_catalog_runtime");
    expect(scenario).toBeTruthy();
    const ask = buildCapabilityCatalogAskFixture({ includeRuntimeMarker: true });
    const rail = ask.codex_parity_agent_spine_rail_table as Record<string, unknown>;
    const staleDebugRail = {
      ...rail,
      turn_id: "ask:live-spine-smoke-fixture:previous-turn",
      prompt: "Stale previous prompt",
      visible_tool_surface: ["model.direct_answer"],
      visible_tool_surface_original_count: 1,
      observation_kind: "reasoning_context",
      observation_ref: null,
      required_terminal_kind: "model_synthesized_answer",
      rail_status: "fail_closed",
      raw_content_included: true,
    };

    const result = classifyLiveSpineSmokeResult(
      scenario!,
      ask,
      {
        payload: {
          debug: {
            codex_parity_agent_spine_rail_table: staleDebugRail,
          },
        },
      },
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "rail_mirror_1_turn_id_mismatch:ask:live-spine-smoke-fixture:previous-turn!=ask:live-spine-smoke-fixture",
        "rail_mirror_1_prompt_mismatch:Stale previous prompt!=What tools are available for the helix ask to use?",
        "rail_mirror_1_visible_tool_surface_mismatch:model.direct_answer!=helix_ask.inspect_capability_catalog",
        "rail_mirror_1_observation_kind_mismatch:reasoning_context!=capability_registry",
        "rail_mirror_1_observation_ref_mismatch:null!=ask:live-spine-smoke-fixture:capability_registry_inspect:capability_registry:1",
        "rail_mirror_1_required_terminal_kind_mismatch:model_synthesized_answer!=capability_help_summary",
        "rail_mirror_1_rail_status_mismatch:fail_closed!=complete",
        "rail_mirror_1_raw_content_included_mismatch:true!=false",
      ]),
    );
  });

  it("fails fixture classification when a raw debug wrapper rail mirror is stale", () => {
    const scenario = LIVE_SPINE_SMOKE_SCENARIOS.find((entry) => entry.id === "capability_catalog_runtime");
    expect(scenario).toBeTruthy();
    const ask = buildCapabilityCatalogAskFixture({ includeRuntimeMarker: true });
    const rail = ask.codex_parity_agent_spine_rail_table as Record<string, unknown>;
    const staleWrapperRail = {
      ...rail,
      turn_id: "ask:live-spine-smoke-fixture:previous-wrapper-turn",
      prompt: "Stale wrapper prompt",
      visible_tool_surface: ["model.direct_answer"],
    };

    const result = classifyLiveSpineSmokeResult(
      scenario!,
      ask,
      {
        codex_parity_agent_spine_rail_table: staleWrapperRail,
        payload: ask,
      },
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "rail_mirror_2_turn_id_mismatch:ask:live-spine-smoke-fixture:previous-wrapper-turn!=ask:live-spine-smoke-fixture",
        "rail_mirror_2_prompt_mismatch:Stale wrapper prompt!=What tools are available for the helix ask to use?",
        "rail_mirror_2_visible_tool_surface_mismatch:model.direct_answer!=helix_ask.inspect_capability_catalog",
      ]),
    );
  });

  it("fails fixture classification when a fail-closed rail projects as a normal final answer", () => {
    const scenario = LIVE_SPINE_SMOKE_SCENARIOS.find(
      (entry) => entry.id === "live_source_mail_observation_or_fail_closed",
    );
    expect(scenario).toBeTruthy();

    const result = classifyLiveSpineSmokeResult(
      scenario!,
      buildLiveSourceFailClosedAskFixture({ projectAsTypedFailure: false }),
      { payload: {} },
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.failures).toContain("fail_closed_rail_missing_terminal_error_code");
    expect(result.failures).toContain("fail_closed_rail_not_typed_failure:model_synthesized_answer/model_synthesized_answer");
    expect(result.failures).toContain("fail_closed_rail_non_failure_response:final_answer/final_answer");
  });

  it("accepts fixture classification when a fail-closed rail projects as typed failure", () => {
    const scenario = LIVE_SPINE_SMOKE_SCENARIOS.find(
      (entry) => entry.id === "live_source_mail_observation_or_fail_closed",
    );
    expect(scenario).toBeTruthy();

    const result = classifyLiveSpineSmokeResult(
      scenario!,
      buildLiveSourceFailClosedAskFixture({ projectAsTypedFailure: true }),
      { payload: {} },
    );

    expect(result.verdict).toBe("PASS");
    expect(result.failures).toEqual([]);
  });

  it("fails fixture classification when ordered compound subgoal rail statuses are dropped", () => {
    const scenario = compoundCatalogWorkspaceScenario();
    const result = classifyLiveSpineSmokeResult(
      scenario,
      buildCompoundCatalogWorkspaceAskFixture({ includeSubgoalRails: false }),
      { payload: {} },
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.failures).toContain("compound_subgoal_rail_statuses_dropped:0<2");
  });

  it("accepts fixture classification when ordered compound subgoal rail statuses are preserved", () => {
    const scenario = compoundCatalogWorkspaceScenario();
    const result = classifyLiveSpineSmokeResult(
      scenario,
      buildCompoundCatalogWorkspaceAskFixture({ includeSubgoalRails: true }),
      { payload: {} },
    );

    expect(result.verdict).toBe("PASS");
    expect(result.failures).toEqual([]);
    expect(result.rail_table).toMatchObject({
      compound_subgoal_count: 2,
      compound_subgoal_rail_statuses_count: 2,
      compound_subgoal_rail_statuses: [
        expect.objectContaining({
          order: 1,
          requested_capability: "helix_ask.inspect_capability_catalog",
          selected_capability: "helix_ask.inspect_capability_catalog",
          executed_capability: "helix_ask.inspect_capability_catalog",
          observation_kind: "capability_registry",
          observation_ref: "obs:capability-registry",
          satisfaction: "satisfied",
          rail_status: "complete",
        }),
        expect.objectContaining({
          order: 2,
          requested_capability: "workspace_os.status",
          selected_capability: "workspace_os.status",
          executed_capability: "workspace_os.status",
          observation_kind: "workspace_os_status_observation",
          observation_ref: "obs:workspace-status",
          satisfaction: "satisfied",
          rail_status: "complete",
        }),
      ],
    });
  });

  it("selects all scenarios by default and preserves requested scenario filters", () => {
    const all = selectLiveSpineSmokeScenarios([]);
    expect(all.unknownIds).toEqual([]);
    expect(all.scenarios.map((scenario) => scenario.id)).toEqual(
      LIVE_SPINE_SMOKE_SCENARIOS.map((scenario) => scenario.id),
    );

    const single = selectLiveSpineSmokeScenarios([" capability_catalog_runtime ", "capability_catalog_runtime"]);
    expect(single.requestedIds).toEqual(["capability_catalog_runtime"]);
    expect(single.unknownIds).toEqual([]);
    expect(single.scenarios.map((scenario) => scenario.id)).toEqual(["capability_catalog_runtime"]);
  });

  it("reports unknown scenario filters instead of silently selecting zero scenarios", () => {
    const selection = selectLiveSpineSmokeScenarios(["missing_scenario", "calculator_explicit"]);

    expect(selection.requestedIds).toEqual(["missing_scenario", "calculator_explicit"]);
    expect(selection.unknownIds).toEqual(["missing_scenario"]);
    expect(selection.scenarios.map((scenario) => scenario.id)).toEqual(["calculator_explicit"]);

    const onlyUnknown = selectLiveSpineSmokeScenarios(["missing_scenario"]);
    expect(onlyUnknown.unknownIds).toEqual(["missing_scenario"]);
    expect(onlyUnknown.scenarios).toEqual([]);
  });

  it("reports missing coverage for focused scenario selections without treating the selector as invalid", () => {
    const selection = selectLiveSpineSmokeScenarios(["capability_catalog_runtime"]);
    const coverageSummary = summarizeLiveSpineSmokeCoverage(selection.scenarios);

    expect(selection.unknownIds).toEqual([]);
    expect(coverageSummary.complete).toBe(false);
    expect(coverageSummary.covered).toEqual(["capability_catalog"]);
    expect(coverageSummary.missing).toEqual(
      REQUIRED_LIVE_SPINE_COVERAGE.filter((coverage) => coverage !== "capability_catalog"),
    );
  });
});

const compoundCatalogWorkspaceScenario = (): LiveSpineScenario => ({
  id: "compound_catalog_workspace_fixture",
  prompt: "Call helix_ask.inspect_capability_catalog, then use workspace_os.status to inspect workstation status.",
  coverage: ["capability_catalog", "workspace_status"],
  expected: {
    selectedCapability: "model.synthesize_from_compound_subgoal_observations",
    admittedCapability: "model.synthesize_from_compound_subgoal_observations",
    executedCapability: "model.synthesize_from_compound_subgoal_observations",
    requiredTerminalKind: "compound_evidence_synthesis_answer",
    selectedTerminalKind: "compound_evidence_synthesis_answer",
    visibleTerminalKind: "compound_evidence_synthesis_answer",
    railStatus: "complete",
    codexParityClass: "complete",
    firstBrokenRail: null,
    visibleToolSurfaceIncludes: [
      "helix_ask.inspect_capability_catalog",
      "workspace_os.status",
    ],
  },
});

const buildCapabilityCatalogAskFixture = (input: { includeRuntimeMarker: boolean }): Record<string, unknown> => {
  const turnId = "ask:live-spine-smoke-fixture";
  const prompt = "What tools are available for the helix ask to use?";
  const rail = {
    schema: "helix.codex_parity_agent_spine_rail_table.v1",
    turn_id: turnId,
    prompt,
    requested_capability: "helix_ask.inspect_capability_catalog",
    visible_tool_surface: ["helix_ask.inspect_capability_catalog"],
    visible_tool_surface_original_count: 1,
    visible_tool_surface_truncated: false,
    selected_capability: "helix_ask.inspect_capability_catalog",
    admitted_capability: "helix_ask.inspect_capability_catalog",
    admission_proof_source: "operational_capability_trace.policy_admitted_capability",
    admission_proven: true,
    executed_capability: "helix_ask.inspect_capability_catalog",
    observation_kind: "capability_registry",
    observation_ref: `${turnId}:capability_registry_inspect:capability_registry:1`,
    required_observation_kinds_for_requested_capability: ["capability_registry"],
    observed_artifact_supports_requested_capability: true,
    reentry_status: "reentered",
    reentry_proof_source: "capability_help_summary_materialized_from_catalog_observation",
    reentry_proven: true,
    goal_satisfaction: "satisfied",
    required_terminal_kind: "capability_help_summary",
    selected_terminal_kind: "capability_help_summary",
    terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
    terminal_authority_proven: true,
    visible_terminal_kind: "capability_help_summary",
    visible_projection_source: "terminal_presentation.terminal_artifact_kind",
    visible_projection_proven: true,
    first_broken_rail: null,
    repair_target: null,
    rail_status: "complete",
    rail_failure_code: null,
    codex_parity_class: "complete",
    normalized_codex_parity_classes: CODEX_PARITY_AGENT_SPINE_CLASSES,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  };
  return {
    turn_id: turnId,
    final_status: "final_answer",
    response_type: "final_answer",
    final_answer_source: "capability_help_summary",
    terminal_artifact_kind: "capability_help_summary",
    selected_final_answer: "Helix Ask can use capability catalog tools.",
    codex_parity_agent_spine_rail_table: rail,
    ...(input.includeRuntimeMarker
      ? {
          tool_rail_terminal_failure_reconciliation_runtime: {
            schema: "helix.tool_rail_terminal_failure_reconciliation.runtime.v1",
            version: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
            available: true,
            assistant_answer: false,
            raw_content_included: false,
          },
        }
      : {}),
  };
};

const buildCalculatorAskFixture = (input: { includeActionEnvelope: boolean }): Record<string, unknown> => {
  const turnId = "ask:live-spine-smoke-calculator-fixture";
  const prompt =
    "Call scientific-calculator.solve_expression with this exact expression: 2 + 2. Wait for calculator_receipt and answer from workstation_tool_evaluation.";
  const terminalKind = "workstation_tool_evaluation";
  const rail = {
    schema: "helix.codex_parity_agent_spine_rail_table.v1",
    turn_id: turnId,
    prompt,
    requested_capability: "scientific-calculator.solve_expression",
    visible_tool_surface: ["scientific-calculator.solve_expression"],
    visible_tool_surface_original_count: 1,
    visible_tool_surface_truncated: false,
    selected_capability: "scientific-calculator.solve_expression",
    admitted_capability: "scientific-calculator.solve_expression",
    admission_proof_source: "tool_call_admission_decision.admitted_capability",
    admission_proven: true,
    executed_capability: "scientific-calculator.solve_expression",
    observation_kind: "calculator_receipt",
    observation_ref: `${turnId}:scientific-calculator.solve_expression:calculator_receipt:1`,
    required_observation_kinds_for_requested_capability: ["calculator_receipt"],
    observed_artifact_supports_requested_capability: true,
    reentry_status: "reentered",
    reentry_proof_source: "workstation_tool_evaluation_materialized_from_calculator_observation",
    reentry_proven: true,
    goal_satisfaction: "satisfied",
    required_terminal_kind: terminalKind,
    selected_terminal_kind: terminalKind,
    terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
    terminal_authority_proven: true,
    visible_terminal_kind: terminalKind,
    visible_projection_source: "terminal_presentation.terminal_artifact_kind",
    visible_projection_proven: true,
    first_broken_rail: null,
    repair_target: null,
    rail_status: "complete",
    rail_failure_code: null,
    codex_parity_class: "complete",
    normalized_codex_parity_classes: CODEX_PARITY_AGENT_SPINE_CLASSES,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  };
  return {
    turn_id: turnId,
    final_status: "final_answer",
    response_type: "final_answer",
    final_answer_source: terminalKind,
    terminal_artifact_kind: terminalKind,
    selected_final_answer: "2 + 2 = 4.",
    codex_parity_agent_spine_rail_table: rail,
    tool_rail_terminal_failure_reconciliation_runtime: {
      schema: "helix.tool_rail_terminal_failure_reconciliation.runtime.v1",
      version: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
      available: true,
      assistant_answer: false,
      raw_content_included: false,
    },
    ...(input.includeActionEnvelope
      ? {
          action_envelope: {
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
          },
        }
      : {}),
  };
};

const buildCompoundCatalogWorkspaceAskFixture = (
  input: { includeSubgoalRails: boolean },
): Record<string, unknown> => {
  const turnId = "ask:compound-catalog-workspace-fixture";
  const prompt = compoundCatalogWorkspaceScenario().prompt;
  const terminalKind = "compound_evidence_synthesis_answer";
  const rail = {
    schema: "helix.codex_parity_agent_spine_rail_table.v1",
    turn_id: turnId,
    prompt,
    requested_capability: null,
    visible_tool_surface: [
      "helix_ask.inspect_capability_catalog",
      "workspace_os.status",
      "model.synthesize_from_compound_subgoal_observations",
    ],
    visible_tool_surface_original_count: 3,
    visible_tool_surface_truncated: false,
    selected_capability: "model.synthesize_from_compound_subgoal_observations",
    admitted_capability: "model.synthesize_from_compound_subgoal_observations",
    admission_proof_source: "compound_capability_contract.subgoals",
    admission_proven: true,
    executed_capability: "model.synthesize_from_compound_subgoal_observations",
    observation_kind: "compound_evidence_synthesis_answer",
    observation_ref: `${turnId}:compound_evidence_synthesis_answer`,
    required_observation_kinds_for_requested_capability: [
      "capability_registry",
      "workspace_os_status_observation",
    ],
    observed_artifact_supports_requested_capability: true,
    reentry_status: "reentered",
    reentry_proof_source: "compound_subgoal_rail_statuses",
    reentry_proven: true,
    goal_satisfaction: "satisfied",
    required_terminal_kind: terminalKind,
    selected_terminal_kind: terminalKind,
    terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
    terminal_authority_proven: true,
    visible_terminal_kind: terminalKind,
    visible_projection_source: "terminal_presentation.terminal_artifact_kind",
    visible_projection_proven: true,
    first_broken_rail: null,
    repair_target: null,
    rail_status: "complete",
    rail_failure_code: null,
    codex_parity_class: "complete",
    compound_subgoal_count: 2,
    first_incomplete_compound_subgoal_id: null,
    first_incomplete_compound_requested_capability: null,
    first_incomplete_compound_runtime_capability: null,
    first_incomplete_compound_selected_capability: null,
    first_incomplete_compound_executed_capability: null,
    compound_first_broken_rail: null,
    compound_rail_failure_code: null,
    compound_repair_target: null,
    compound_incomplete_subgoal_did_tool_run: null,
    normalized_codex_parity_classes: CODEX_PARITY_AGENT_SPINE_CLASSES,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  };
  return {
    turn_id: turnId,
    final_status: "final_answer",
    response_type: "final_answer",
    final_answer_source: terminalKind,
    terminal_artifact_kind: terminalKind,
    selected_final_answer: "The capability catalog and workspace status observations are ready for synthesis.",
    codex_parity_agent_spine_rail_table: rail,
    ...(input.includeSubgoalRails
      ? {
          compound_subgoal_rail_statuses: [
            {
              subgoal_id: `${turnId}:compound_capability_subgoal:1:helix_ask_inspect_capability_catalog`,
              order: 1,
              requested_capability: "helix_ask.inspect_capability_catalog",
              runtime_capability: "helix_ask.inspect_capability_catalog",
              selected_capability: "helix_ask.inspect_capability_catalog",
              executed_capability: "helix_ask.inspect_capability_catalog",
              args: {},
              observation_kind: "capability_registry",
              observation_ref: "obs:capability-registry",
              observation_provenance: "capability_key",
              satisfaction: "satisfied",
              rail_status: "complete",
              first_broken_rail: null,
              rail_failure_code: null,
              repair_target: null,
            },
            {
              subgoal_id: `${turnId}:compound_capability_subgoal:2:workspace_os_status`,
              order: 2,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              selected_capability: "workspace_os.status",
              executed_capability: "workspace_os.status",
              args: {},
              observation_kind: "workspace_os_status_observation",
              observation_ref: "obs:workspace-status",
              observation_provenance: "capability_key",
              satisfaction: "satisfied",
              rail_status: "complete",
              first_broken_rail: null,
              rail_failure_code: null,
              repair_target: null,
            },
          ],
        }
      : {}),
    tool_rail_terminal_failure_reconciliation_runtime: {
      schema: "helix.tool_rail_terminal_failure_reconciliation.runtime.v1",
      version: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
      available: true,
      assistant_answer: false,
      raw_content_included: false,
    },
  };
};

const buildLiveSourceFailClosedAskFixture = (input: { projectAsTypedFailure: boolean }): Record<string, unknown> => {
  const turnId = "ask:live-source-fail-closed-fixture";
  const prompt = "Use live_env.read_processed_live_source_mail to inspect the latest processed live-source mail.";
  const terminalErrorCode = input.projectAsTypedFailure ? "missing_required_live_source_mailbox_observation" : null;
  const terminalKind = input.projectAsTypedFailure ? "typed_failure" : "model_synthesized_answer";
  const finalStatus = input.projectAsTypedFailure ? "final_failure" : "final_answer";
  const rail = {
    schema: "helix.codex_parity_agent_spine_rail_table.v1",
    turn_id: turnId,
    prompt,
    requested_capability: "live_env.read_processed_live_source_mail",
    visible_tool_surface: ["live_env.read_processed_live_source_mail"],
    visible_tool_surface_original_count: 1,
    visible_tool_surface_truncated: false,
    selected_capability: "live_env.read_processed_live_source_mail",
    admitted_capability: "live_env.read_processed_live_source_mail",
    admission_proof_source: "tool_call_admission_decision.selected_capability",
    admission_proven: true,
    executed_capability: "live_env.read_processed_live_source_mail",
    observation_kind: "reasoning_context",
    observation_ref: `${turnId}:reasoning_followup:reasoning_context:1`,
    required_observation_kinds_for_requested_capability: ["stage_play_processed_mail_packet"],
    observed_artifact_supports_requested_capability: false,
    reentry_status: "reentered",
    reentry_proof_source: "tool_lifecycle_trace.lifecycle_stage",
    reentry_proven: true,
    goal_satisfaction: "not_satisfied",
    required_terminal_kind: "model_synthesized_answer",
    selected_terminal_kind: terminalKind,
    terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
    terminal_authority_proven: true,
    visible_terminal_kind: terminalKind,
    visible_projection_source: "terminal_presentation.terminal_artifact_kind",
    visible_projection_proven: true,
    first_broken_rail: "observation_artifact",
    repair_target: "observation_materializer",
    rail_status: "fail_closed",
    rail_failure_code: "required_observation_missing",
    codex_parity_class: "observation_missing",
    normalized_codex_parity_classes: CODEX_PARITY_AGENT_SPINE_CLASSES,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  };
  return {
    turn_id: turnId,
    final_status: finalStatus,
    response_type: finalStatus,
    final_answer_source: terminalKind,
    terminal_artifact_kind: terminalKind,
    ...(terminalErrorCode ? { terminal_error_code: terminalErrorCode } : {}),
    selected_final_answer: input.projectAsTypedFailure
      ? "I could not complete this live-source mailbox turn because the required mailbox observation was not materialized."
      : "Here is a normal-looking answer without the required mailbox observation.",
    codex_parity_agent_spine_rail_table: rail,
    tool_rail_terminal_failure_reconciliation_runtime: {
      schema: "helix.tool_rail_terminal_failure_reconciliation.runtime.v1",
      version: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
      available: true,
      assistant_answer: false,
      raw_content_included: false,
    },
  };
};
