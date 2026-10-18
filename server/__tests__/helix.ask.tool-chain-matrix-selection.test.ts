import { describe, expect, it } from "vitest";

import {
  calculatorScenarioAgreementFailures,
  calculatorScenarioAcceptanceFailures,
  calculatorScenarioWorkstationActionFailures,
  railSpecificFailureProjectionAcceptanceFailures,
  readCapacityAdmissionStressReason,
  readThrownScenarioCapacityAdmissionStressReason,
  resolveToolChainMatrixParallelism,
  runBoundedToolChainTasks,
  serverBundleFreshnessWarnings,
  selectToolChainMatrixScenarios,
  summarizeToolChainMatrixWarnings,
  toolChainRailTableAcceptanceFailures,
  toolChainMatrixGoalProofTrust,
  toolChainMatrixProcessExitCode,
  TOOL_CHAIN_MATRIX_SCENARIOS,
  visualSourceContextAcceptanceFailures,
} from "../../scripts/helix-ask-tool-chain-matrix-probe";

describe("Helix Ask tool-chain matrix scenario selection", () => {
  it("selects all scenarios by default", () => {
    const selection = selectToolChainMatrixScenarios([]);

    expect(selection.requestedIds).toEqual([]);
    expect(selection.unknownIds).toEqual([]);
    expect(selection.availableIds).toEqual(TOOL_CHAIN_MATRIX_SCENARIOS.map((scenario) => scenario.id));
    expect(selection.scenarios.map((scenario) => scenario.id)).toEqual(
      TOOL_CHAIN_MATRIX_SCENARIOS.map((scenario) => scenario.id),
    );
  });

  it("preserves explicit scenario filters and removes duplicates", () => {
    const selection = selectToolChainMatrixScenarios([" docs_open ", "docs_open"]);

    expect(selection.requestedIds).toEqual(["docs_open"]);
    expect(selection.unknownIds).toEqual([]);
    expect(selection.scenarios.map((scenario) => scenario.id)).toEqual(["docs_open"]);
  });

  it("reports unknown scenario filters instead of silently selecting zero scenarios", () => {
    const selection = selectToolChainMatrixScenarios(["missing_scenario", "docs_open"]);

    expect(selection.requestedIds).toEqual(["missing_scenario", "docs_open"]);
    expect(selection.unknownIds).toEqual(["missing_scenario"]);
    expect(selection.scenarios.map((scenario) => scenario.id)).toEqual(["docs_open"]);
  });

  it("clamps tool-chain matrix parallelism to a bounded live-probe range", () => {
    expect(resolveToolChainMatrixParallelism("")).toBe(1);
    expect(resolveToolChainMatrixParallelism("0")).toBe(1);
    expect(resolveToolChainMatrixParallelism("3.9")).toBe(3);
    expect(resolveToolChainMatrixParallelism("99")).toBe(8);
    expect(resolveToolChainMatrixParallelism("not-a-number")).toBe(1);
  });

  it("runs bounded tool-chain tasks with stable result order", async () => {
    let active = 0;
    let maxActive = 0;
    const results = await runBoundedToolChainTasks([1, 2, 3, 4], 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return {
        item,
        verdict: "PASS",
      };
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results.map((result) => result.item)).toEqual([1, 2, 3, 4]);
  });

  it("fails calculator_steps when visible text shows the stale subgoal result", () => {
    const scenario = TOOL_CHAIN_MATRIX_SCENARIOS.find((entry) => entry.id === "calculator_steps");

    expect(scenario).toBeDefined();
    expect(
      calculatorScenarioAcceptanceFailures(
        scenario!,
        "Calculator subgoal: 2*(3+4)\nResult: 2\nTrace source: scientific-calculator.solve_expression.",
      ),
    ).toEqual(["calculator_steps_stale_subgoal_result_visible", "calculator_steps_expected_result_14_missing"]);
  });

  it("accepts calculator_steps when visible text contains the expected natural prompt result", () => {
    const scenario = TOOL_CHAIN_MATRIX_SCENARIOS.find((entry) => entry.id === "calculator_steps");

    expect(scenario).toBeDefined();
    expect(
      calculatorScenarioAcceptanceFailures(
        scenario!,
        "Calculator verification plan completed.\nExpression: 2*(3+4)\nResult: 14\nTrace source: scientific-calculator.solve_expression.",
      ),
    ).toEqual([]);
  });

  it("fails calculator scenarios when calculator panel action receipts are missing", () => {
    const scenario = TOOL_CHAIN_MATRIX_SCENARIOS.find((entry) => entry.id === "calculator_steps");

    expect(scenario).toBeDefined();
    expect(calculatorScenarioWorkstationActionFailures(scenario!, ["scientific-calculator.solve_expression"])).toEqual([
      "calculator_steps_calculator_open_panel_action_receipt_missing",
      "calculator_steps_calculator_focus_panel_action_receipt_missing",
    ]);
  });

  it("accepts calculator scenarios when open and focus action receipts are present", () => {
    const scenario = TOOL_CHAIN_MATRIX_SCENARIOS.find((entry) => entry.id === "calculator_explicit_equivalent");

    expect(scenario).toBeDefined();
    expect(
      calculatorScenarioWorkstationActionFailures(scenario!, [
        "scientific-calculator.open_panel",
        "scientific-calculator.focus_panel",
        "scientific-calculator.solve_expression",
      ]),
    ).toEqual([]);
  });

  it("includes an explicit calculator equivalent scenario for natural/API agreement", () => {
    const scenario = TOOL_CHAIN_MATRIX_SCENARIOS.find((entry) => entry.id === "calculator_explicit_equivalent");

    expect(scenario).toBeDefined();
    expect(scenario?.category).toBe("calculator_tool");
    expect(scenario?.prompt).toContain("scientific-calculator.solve_expression");
  });

  it("fails calculator_explicit_equivalent when visible text shows the stale subgoal result", () => {
    const scenario = TOOL_CHAIN_MATRIX_SCENARIOS.find((entry) => entry.id === "calculator_explicit_equivalent");

    expect(scenario).toBeDefined();
    expect(
      calculatorScenarioAcceptanceFailures(
        scenario!,
        "Calculator subgoal: 2*(3+4)\nResult: 2\nTrace source: scientific-calculator.solve_expression.",
      ),
    ).toEqual([
      "calculator_explicit_equivalent_stale_subgoal_result_visible",
      "calculator_explicit_equivalent_expected_result_14_missing",
    ]);
  });

  it("accepts calculator natural and explicit scenarios when their rails and result agree", () => {
    expect(
      calculatorScenarioAgreementFailures([
        {
          scenario_id: "calculator_steps",
          terminal_artifact_kind: "workstation_tool_evaluation",
          warnings: [],
          visible_text_excerpt:
            "Calculator verification plan completed.\nExpression: 2*(3+4)\nResult: 14\nTrace source: scientific-calculator.solve_expression.",
          rail_table: {
            executed_capability: "scientific-calculator.solve_expression",
            observation_kind: "calculator_receipt",
            selected_terminal_kind: "workstation_tool_evaluation",
          },
        },
        {
          scenario_id: "calculator_explicit_equivalent",
          terminal_artifact_kind: "workstation_tool_evaluation",
          warnings: [],
          visible_text_excerpt:
            "Calculator verification plan completed.\nExpression: 2*(3+4)\nResult: 14\nTrace source: scientific-calculator.solve_expression.",
          rail_table: {
            executed_capability: "scientific-calculator.solve_expression",
            observation_kind: "calculator_receipt",
            selected_terminal_kind: "workstation_tool_evaluation",
          },
        },
      ]),
    ).toEqual([]);
  });

  it("fails calculator natural and explicit agreement when executed capability or terminal kind diverges", () => {
    expect(
      calculatorScenarioAgreementFailures([
        {
          scenario_id: "calculator_steps",
          terminal_artifact_kind: "workstation_tool_evaluation",
          warnings: [],
          visible_text_excerpt: "Result: 14",
          rail_table: {
            executed_capability: "scientific-calculator.solve_expression",
            observation_kind: "calculator_receipt",
            selected_terminal_kind: "workstation_tool_evaluation",
          },
        },
        {
          scenario_id: "calculator_explicit_equivalent",
          terminal_artifact_kind: "model_synthesized_answer",
          warnings: [],
          visible_text_excerpt: "Result: 14",
          rail_table: {
            executed_capability: "model.direct_answer",
            observation_kind: "direct_answer_text",
            selected_terminal_kind: "model_synthesized_answer",
          },
        },
      ]),
    ).toEqual([
      "calculator_natural_explicit_executed_capability_mismatch:scientific-calculator.solve_expression!=model.direct_answer",
      "calculator_natural_explicit_observation_kind_mismatch:calculator_receipt!=direct_answer_text",
      "calculator_natural_explicit_terminal_kind_mismatch:workstation_tool_evaluation!=model_synthesized_answer",
    ]);
  });

  it("does not treat calculator agreement failures as product failures when the server bundle is stale", () => {
    expect(
      calculatorScenarioAgreementFailures([
        {
          scenario_id: "calculator_steps",
          terminal_artifact_kind: "workstation_tool_evaluation",
          warnings: [
            "server_bundle_predates_local_runtime_changes:1000<2000:changed_files=2",
            "untrusted_failure_due_to_stale_server_bundle:calculator_steps_expected_result_14_missing",
          ],
          visible_text_excerpt: "Calculator subgoal: 2*(3+4)\nResult: 2",
          rail_table: {
            executed_capability: "execute_workstation_action",
            observation_kind: "calculator_receipt",
            selected_terminal_kind: "workstation_tool_evaluation",
          },
        },
        {
          scenario_id: "calculator_explicit_equivalent",
          terminal_artifact_kind: "workstation_tool_evaluation",
          warnings: [],
          visible_text_excerpt: "Result: 14",
          rail_table: {
            executed_capability: "scientific-calculator.solve_expression",
            observation_kind: "calculator_receipt",
            selected_terminal_kind: "workstation_tool_evaluation",
          },
        },
      ]),
    ).toEqual([]);
  });

  it("does not require calculator agreement when only one calculator scenario was selected", () => {
    expect(
      calculatorScenarioAgreementFailures([
        {
          scenario_id: "calculator_steps",
          visible_text_excerpt: "Result: 14",
          rail_table: {
            executed_capability: "scientific-calculator.solve_expression",
            observation_kind: "calculator_receipt",
            selected_terminal_kind: "workstation_tool_evaluation",
          },
        },
      ]),
    ).toEqual([]);
  });

  it("fails when a specific observation rail failure is masked by projection mismatch text", () => {
    expect(
      railSpecificFailureProjectionAcceptanceFailures({
        railTable: {
          rail_status: "fail_closed",
          rail_failure_code: "observation_missing",
        },
        terminalError: "terminal_projection_mismatch",
        visibleText:
          "I could not produce a terminal answer because terminal authority and visible projection selected different artifacts.",
      }),
    ).toEqual([
      "specific_rail_failure_masked_by_terminal_projection_mismatch:observation_missing",
      "specific_rail_failure_visible_text_masked_by_projection_mismatch:observation_missing",
    ]);
  });

  it("rejects tool-chain rail tables that project a visible terminal without a projection source", () => {
    expect(
      toolChainRailTableAcceptanceFailures({
        railTable: {
          visible_terminal_kind: "model_synthesized_answer",
          visible_projection_proven: true,
        },
        terminalKind: "model_synthesized_answer",
        turnId: "ask:tool-chain:test",
        prompt: "What tools are available for Helix Ask?",
      }),
    ).toContain("rail_visible_projection_source_missing");
  });

  it("rejects tool-chain rail tables that project a visible terminal from an unproven source", () => {
    expect(
      toolChainRailTableAcceptanceFailures({
        railTable: {
          visible_terminal_kind: "model_synthesized_answer",
          visible_projection_source: "terminal_presentation",
          visible_projection_proven: false,
        },
        terminalKind: "model_synthesized_answer",
        turnId: "ask:tool-chain:test",
        prompt: "What tools are available for Helix Ask?",
      }),
    ).toContain("rail_visible_projection_not_proven");
  });

  it("keeps Ask admission capacity responses classified as capacity stress", () => {
    expect(
      readCapacityAdmissionStressReason({
        terminalKind: "ask_turn_admission",
        terminalError: "",
        visibleText: "Ask turn queued: instance_capacity.",
      }),
    ).toBe("instance_capacity");
  });

  it("keeps thrown Ask admission capacity rejects classified as capacity stress", () => {
    expect(
      readThrownScenarioCapacityAdmissionStressReason(
        '503 Service Unavailable: {"ok":false,"response_type":"capacity_rejected","terminal_artifact_kind":"ask_turn_admission","route_reason_code":"ask_turn_admission / memory_hard_pressure","text":"Ask turn rejected: memory_hard_pressure."}',
      ),
    ).toBe("memory_hard_pressure");
  });

  it("labels server bundles that started before local restart-sensitive changes", () => {
    expect(
      serverBundleFreshnessWarnings({
        serverBuildStartedAtMs: 1_000,
        latestLocalRuntimeChangeMs: 2_500,
        changedRuntimeFiles: [
          "server/services/helix-ask/workstation-answer-synthesizer.ts",
          "server/services/helix-ask/terminal-rail-failure-reconciliation.ts",
        ],
      }),
    ).toEqual(["server_bundle_predates_local_runtime_changes:1000<2500:changed_files=2"]);
  });

  it("does not label fresh or commit-only server bundles as stale", () => {
    expect(
      serverBundleFreshnessWarnings({
        serverBuildStartedAtMs: 3_000,
        latestLocalRuntimeChangeMs: 2_500,
        changedRuntimeFiles: ["server/services/helix-ask/workstation-answer-synthesizer.ts"],
      }),
    ).toEqual([]);
    expect(
      serverBundleFreshnessWarnings({
        serverBuildStartedAtMs: 1_000,
        latestLocalRuntimeChangeMs: null,
        changedRuntimeFiles: [],
      }),
    ).toEqual([]);
  });

  it("summarizes stale-server and capacity warnings at the matrix root", () => {
    expect(
      summarizeToolChainMatrixWarnings([
        {
          warnings: [
            "server_bundle_predates_local_runtime_changes:1000<2500:changed_files=2",
            "untrusted_failure_due_to_stale_server_bundle:calculator_steps_expected_result_14_missing",
          ],
        },
        {
          warnings: ["capacity_or_admission_stress:memory_hard_pressure"],
        },
      ]),
    ).toEqual({
      warning_count: 3,
      stale_server_bundle_count: 1,
      untrusted_failure_count: 1,
      capacity_or_admission_stress_count: 1,
    });
  });

  it("marks stale or capacity-limited matrix reports as untrusted goal proof", () => {
    expect(
      toolChainMatrixGoalProofTrust({
        stale_server_bundle_count: 1,
        untrusted_failure_count: 0,
        capacity_or_admission_stress_count: 0,
      }, 1),
    ).toEqual({
      trusted_for_goal_acceptance: false,
      requires_keyed_server_restart: true,
      capacity_or_admission_limited: false,
      executed_result_count: 1,
    });
    expect(
      toolChainMatrixGoalProofTrust({
        stale_server_bundle_count: 0,
        untrusted_failure_count: 0,
        capacity_or_admission_stress_count: 1,
      }, 1),
    ).toEqual({
      trusted_for_goal_acceptance: false,
      requires_keyed_server_restart: false,
      capacity_or_admission_limited: true,
      executed_result_count: 1,
    });
    expect(
      toolChainMatrixGoalProofTrust({
        stale_server_bundle_count: 0,
        untrusted_failure_count: 0,
        capacity_or_admission_stress_count: 0,
      }, 1),
    ).toEqual({
      trusted_for_goal_acceptance: true,
      requires_keyed_server_restart: false,
      capacity_or_admission_limited: false,
      executed_result_count: 1,
    });
    expect(
      toolChainMatrixGoalProofTrust({
        stale_server_bundle_count: 0,
        untrusted_failure_count: 0,
        capacity_or_admission_stress_count: 0,
      }),
    ).toMatchObject({
      trusted_for_goal_acceptance: false,
      executed_result_count: 0,
    });
  });

  it("turns untrusted goal proof into a failing process exit code when proof is required", () => {
    expect(
      toolChainMatrixProcessExitCode(true, true, {
        trusted_for_goal_acceptance: false,
      }),
    ).toBe(1);
    expect(
      toolChainMatrixProcessExitCode(true, true, {
        trusted_for_goal_acceptance: true,
      }),
    ).toBe(0);
    expect(
      toolChainMatrixProcessExitCode(true, false, {
        trusted_for_goal_acceptance: false,
      }),
    ).toBe(0);
    expect(
      toolChainMatrixProcessExitCode(false, false, {
        trusted_for_goal_acceptance: true,
      }),
    ).toBe(1);
  });

  it("fails visual prompts that answer without visual artifacts or missing-source context", () => {
    const scenario = TOOL_CHAIN_MATRIX_SCENARIOS.find((entry) => entry.id === "visual_missing_source_context");

    expect(scenario).toBeDefined();
    expect(
      visualSourceContextAcceptanceFailures({
        scenario: scenario!,
        artifactKinds: [],
        terminalKind: "model_synthesized_answer",
        terminalError: "",
        visibleText: "The screen shows a game scene with route drift.",
      }),
    ).toEqual([
      "visual_prompt_missing_source_context_not_identified",
      "visual_prompt_terminalized_without_visual_source_context:model_synthesized_answer",
    ]);
  });

  it("accepts visual prompts that fail closed with missing visual source context", () => {
    const scenario = TOOL_CHAIN_MATRIX_SCENARIOS.find((entry) => entry.id === "visual_missing_source_context");

    expect(scenario).toBeDefined();
    expect(
      visualSourceContextAcceptanceFailures({
        scenario: scenario!,
        artifactKinds: [],
        terminalKind: "typed_failure",
        terminalError: "visual_evidence_missing",
        visibleText:
          "I could not complete this visual turn because browser/UI visual source context was not available to the Ask solver.",
      }),
    ).toEqual([]);
  });
});
