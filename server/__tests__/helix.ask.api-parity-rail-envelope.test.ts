import { describe, expect, it } from "vitest";

import type { HelixApiParityScenario } from "../services/helix-ask/api-parity-matrix";
import { buildApiParityProbeResult } from "../services/helix-ask/api-parity-probe";
import { CODEX_PARITY_AGENT_SPINE_CLASSES } from "../services/helix-ask/codex-parity-agent-spine-contract";
import { HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION } from "../services/helix-ask/terminal-rail-failure-reconciliation";

describe("Helix Ask API parity rail envelope invariants", () => {
  it("rejects fail-closed rails that project as normal final answers", () => {
    const scenario = liveSourceFailClosedScenario();
    const askTurn = buildLiveSourceFailClosedTurn({ projectAsTypedFailure: false });

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toEqual(
      expect.arrayContaining([
        "fail_closed_rail_missing_terminal_error_code",
        "fail_closed_rail_not_typed_failure:model_synthesized_answer/model_synthesized_answer",
        "fail_closed_rail_non_failure_response:final_answer/final_answer",
      ]),
    );
  });

  it("accepts fail-closed rails that project as typed failures", () => {
    const scenario = liveSourceFailClosedScenario();
    const askTurn = buildLiveSourceFailClosedTurn({ projectAsTypedFailure: true });

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(true);
    expect(probe.failures).toEqual([]);
  });

  it("rejects stale debug rail mirrors that disagree with the API rail", () => {
    const scenario = liveSourceFailClosedScenario();
    const askTurn = buildLiveSourceFailClosedTurn({ projectAsTypedFailure: true });
    const railTable = askTurn.codex_parity_agent_spine_rail_table as Record<string, unknown>;
    const staleDebugRail = {
      ...railTable,
      turn_id: "ask:test:previous-turn",
      prompt: "Stale previous prompt",
      visible_tool_surface: ["model.direct_answer"],
      visible_tool_surface_original_count: 1,
      assistant_answer: true,
      executed_capability: null,
      observation_ref: null,
    };
    const debugPayload = Object.fromEntries(
      Object.entries(askTurn).filter(([key]) => key !== "codex_parity_agent_spine_rail_table"),
    );

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: {
        payload: {
          ...debugPayload,
          debug: {
            codex_parity_agent_spine_rail_table: staleDebugRail,
          },
        },
      },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toEqual(
      expect.arrayContaining([
        "rail_mirror_1_turn_id_mismatch:ask:test:previous-turn!=ask:test:fail-closed-rail-projection-contract",
        "rail_mirror_1_prompt_mismatch:Stale previous prompt!=Use live_env.read_processed_live_source_mail to inspect the latest processed live-source mail.",
        "rail_mirror_1_visible_tool_surface_mismatch:model.direct_answer!=live_env.read_processed_live_source_mail",
        "rail_mirror_1_assistant_answer_mismatch:true!=false",
        "rail_mirror_1_executed_capability_mismatch:null!=live_env.read_processed_live_source_mail",
        "rail_mirror_1_observation_ref_mismatch:null!=ask:test:reasoning_context:1",
      ]),
    );
  });

  it("rejects stale raw debug wrapper rail mirrors even when debug payload is current", () => {
    const scenario = liveSourceFailClosedScenario();
    const askTurn = buildLiveSourceFailClosedTurn({ projectAsTypedFailure: true });
    const railTable = askTurn.codex_parity_agent_spine_rail_table as Record<string, unknown>;
    const staleWrapperRail = {
      ...railTable,
      turn_id: "ask:test:previous-wrapper-turn",
      prompt: "Stale wrapper prompt",
      visible_tool_surface: ["model.direct_answer"],
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: {
        codex_parity_agent_spine_rail_table: staleWrapperRail,
        payload: askTurn,
      },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toEqual(
      expect.arrayContaining([
        "rail_mirror_2_turn_id_mismatch:ask:test:previous-wrapper-turn!=ask:test:fail-closed-rail-projection-contract",
        "rail_mirror_2_prompt_mismatch:Stale wrapper prompt!=Use live_env.read_processed_live_source_mail to inspect the latest processed live-source mail.",
        "rail_mirror_2_visible_tool_surface_mismatch:model.direct_answer!=live_env.read_processed_live_source_mail",
      ]),
    );
  });

  it("rejects rails with visible projection kind but no projection proof source", () => {
    const scenario = liveSourceFailClosedScenario();
    const askTurn = buildLiveSourceFailClosedTurn({ projectAsTypedFailure: true });
    const railTable = askTurn.codex_parity_agent_spine_rail_table as Record<string, unknown>;
    railTable.visible_projection_source = null;

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toContain("rail_visible_projection_source_missing");
  });

  it("rejects rails with visible projection kind but unproven projection source", () => {
    const scenario = liveSourceFailClosedScenario();
    const askTurn = buildLiveSourceFailClosedTurn({ projectAsTypedFailure: true });
    const railTable = askTurn.codex_parity_agent_spine_rail_table as Record<string, unknown>;
    railTable.visible_projection_proven = false;

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toContain("rail_visible_projection_not_proven");
  });

  it("rejects incomplete compound rails without first-incomplete subgoal mirrors", () => {
    const scenario = liveSourceFailClosedScenario();
    const askTurn = buildLiveSourceFailClosedTurn({ projectAsTypedFailure: true });
    askTurn.codex_parity_agent_spine_rail_table = {
      ...(askTurn.codex_parity_agent_spine_rail_table as Record<string, unknown>),
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
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toEqual(
      expect.arrayContaining([
        "rail_incomplete_compound_first_incomplete_subgoal_missing",
        "rail_incomplete_compound_requested_capability_missing",
        "rail_incomplete_compound_rail_failure_code_missing",
        "rail_incomplete_compound_did_tool_run_missing",
      ]),
    );
  });

  it("summarizes ordered compound subgoal rails for API parity diagnostics", () => {
    const scenario = liveSourceFailClosedScenario();
    const askTurn = buildLiveSourceFailClosedTurn({ projectAsTypedFailure: true });
    askTurn.codex_parity_agent_spine_rail_table = {
      ...(askTurn.codex_parity_agent_spine_rail_table as Record<string, unknown>),
      compound_subgoal_count: 2,
      first_incomplete_compound_subgoal_id: "ask:test:subgoal:mailbox",
      first_incomplete_compound_requested_capability: "live_env.read_processed_live_source_mail",
      first_incomplete_compound_runtime_capability: "live_env.read_processed_live_source_mail",
      first_incomplete_compound_selected_capability: "live_env.read_processed_live_source_mail",
      first_incomplete_compound_executed_capability: "live_env.read_processed_live_source_mail",
      compound_first_broken_rail: "observation_artifact",
      compound_rail_failure_code: "required_observation_missing",
      compound_repair_target: "observation_materializer",
      compound_incomplete_subgoal_did_tool_run: true,
    };
    askTurn.compound_subgoal_rail_statuses = [
      {
        subgoal_id: "ask:test:subgoal:catalog",
        order: 1,
        requested_capability: "helix_ask.inspect_capability_catalog",
        runtime_capability: "helix_ask.inspect_capability_catalog",
        selected_capability: "helix_ask.inspect_capability_catalog",
        executed_capability: "helix_ask.inspect_capability_catalog",
        args: {},
        observation_kind: "capability_registry",
        observation_ref: "ask:test:capability_registry",
        observation_provenance: "capability_key",
        satisfaction: "satisfied",
        rail_status: "complete",
        first_broken_rail: null,
        rail_failure_code: null,
        repair_target: null,
      },
      {
        subgoal_id: "ask:test:subgoal:mailbox",
        order: 2,
        requested_capability: "live_env.read_processed_live_source_mail",
        runtime_capability: "live_env.read_processed_live_source_mail",
        selected_capability: "live_env.read_processed_live_source_mail",
        executed_capability: "live_env.read_processed_live_source_mail",
        args: {},
        observation_kind: null,
        observation_ref: null,
        observation_provenance: null,
        satisfaction: "not_satisfied",
        rail_status: "fail_closed",
        first_broken_rail: "observation_artifact",
        rail_failure_code: "required_observation_missing",
        repair_target: "observation_materializer",
      },
    ];

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(true);
    expect(probe.rail_table.compound_subgoal_rails).toEqual([
      expect.objectContaining({
        subgoal_id: "ask:test:subgoal:catalog",
        requested_capability: "helix_ask.inspect_capability_catalog",
        selected_capability: "helix_ask.inspect_capability_catalog",
        executed_capability: "helix_ask.inspect_capability_catalog",
        observation_kind: "capability_registry",
        observation_ref: "ask:test:capability_registry",
        satisfaction: "satisfied",
        rail_status: "complete",
      }),
      expect.objectContaining({
        subgoal_id: "ask:test:subgoal:mailbox",
        requested_capability: "live_env.read_processed_live_source_mail",
        selected_capability: "live_env.read_processed_live_source_mail",
        executed_capability: "live_env.read_processed_live_source_mail",
        observation_kind: null,
        observation_ref: null,
        satisfaction: "not_satisfied",
        rail_status: "fail_closed",
        first_broken_rail: "observation_artifact",
        rail_failure_code: "required_observation_missing",
        repair_target: "observation_materializer",
      }),
    ]);
  });

  it("rejects complete compound subgoal rails without observation proof", () => {
    const scenario = liveSourceFailClosedScenario();
    const askTurn = buildLiveSourceFailClosedTurn({ projectAsTypedFailure: true });
    askTurn.codex_parity_agent_spine_rail_table = {
      ...(askTurn.codex_parity_agent_spine_rail_table as Record<string, unknown>),
      compound_subgoal_count: 1,
      first_incomplete_compound_subgoal_id: "ask:test:subgoal:catalog",
      first_incomplete_compound_requested_capability: "helix_ask.inspect_capability_catalog",
      first_incomplete_compound_runtime_capability: "helix_ask.inspect_capability_catalog",
      first_incomplete_compound_selected_capability: "helix_ask.inspect_capability_catalog",
      first_incomplete_compound_executed_capability: "helix_ask.inspect_capability_catalog",
      compound_first_broken_rail: "observation_artifact",
      compound_rail_failure_code: "required_observation_missing",
      compound_repair_target: "observation_materializer",
      compound_incomplete_subgoal_did_tool_run: true,
    };
    askTurn.compound_subgoal_rail_statuses = [
      {
        subgoal_id: "ask:test:subgoal:catalog",
        order: 1,
        requested_capability: "helix_ask.inspect_capability_catalog",
        runtime_capability: "helix_ask.inspect_capability_catalog",
        selected_capability: "helix_ask.inspect_capability_catalog",
        executed_capability: "helix_ask.inspect_capability_catalog",
        args: {},
        observation_kind: "capability_registry",
        observation_ref: null,
        observation_provenance: null,
        satisfaction: "satisfied",
        rail_status: "complete",
        first_broken_rail: null,
        rail_failure_code: null,
        repair_target: null,
      },
    ];

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toEqual(
      expect.arrayContaining([
        "rail_compound_subgoal_1_satisfied_observation_ref_missing",
        "rail_compound_subgoal_1_complete_observation_ref_missing",
      ]),
    );
  });

  it("rejects compound rails when the ordered subgoal rail statuses are dropped", () => {
    const scenario = liveSourceFailClosedScenario();
    const askTurn = buildLiveSourceFailClosedTurn({ projectAsTypedFailure: true });
    askTurn.codex_parity_agent_spine_rail_table = {
      ...(askTurn.codex_parity_agent_spine_rail_table as Record<string, unknown>),
      compound_subgoal_count: 2,
      first_incomplete_compound_subgoal_id: "ask:test:subgoal:mailbox",
      first_incomplete_compound_requested_capability: "live_env.read_processed_live_source_mail",
      first_incomplete_compound_runtime_capability: "live_env.read_processed_live_source_mail",
      first_incomplete_compound_selected_capability: "live_env.read_processed_live_source_mail",
      first_incomplete_compound_executed_capability: "live_env.read_processed_live_source_mail",
      compound_first_broken_rail: "observation_artifact",
      compound_rail_failure_code: "required_observation_missing",
      compound_repair_target: "observation_materializer",
      compound_incomplete_subgoal_did_tool_run: true,
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toContain("rail_compound_subgoal_rail_statuses_dropped:0<2");
  });

  it("rejects malformed compound subgoal rails without ordered args or fail-closed rail fields", () => {
    const scenario = liveSourceFailClosedScenario();
    const askTurn = buildLiveSourceFailClosedTurn({ projectAsTypedFailure: true });
    askTurn.codex_parity_agent_spine_rail_table = {
      ...(askTurn.codex_parity_agent_spine_rail_table as Record<string, unknown>),
      compound_subgoal_count: 1,
      first_incomplete_compound_subgoal_id: "ask:test:subgoal:mailbox",
      first_incomplete_compound_requested_capability: "live_env.read_processed_live_source_mail",
      first_incomplete_compound_runtime_capability: "live_env.read_processed_live_source_mail",
      first_incomplete_compound_selected_capability: "live_env.read_processed_live_source_mail",
      first_incomplete_compound_executed_capability: "live_env.read_processed_live_source_mail",
      compound_first_broken_rail: "observation_artifact",
      compound_rail_failure_code: "required_observation_missing",
      compound_repair_target: "observation_materializer",
      compound_incomplete_subgoal_did_tool_run: true,
    };
    askTurn.compound_subgoal_rail_statuses = [
      {
        subgoal_id: "ask:test:subgoal:mailbox",
        requested_capability: "live_env.read_processed_live_source_mail",
        runtime_capability: "live_env.read_processed_live_source_mail",
        selected_capability: "live_env.read_processed_live_source_mail",
        executed_capability: "live_env.read_processed_live_source_mail",
        observation_kind: null,
        observation_ref: null,
        observation_provenance: null,
        satisfaction: "not_satisfied",
        rail_status: "fail_closed",
      },
    ];

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toEqual(
      expect.arrayContaining([
        "rail_compound_subgoal_1_order_invalid",
        "rail_compound_subgoal_1_args_field_missing",
        "rail_compound_subgoal_1_first_broken_rail_missing",
        "rail_compound_subgoal_1_rail_failure_code_missing",
        "rail_compound_subgoal_1_repair_target_missing",
      ]),
    );
  });

  it("accepts a source-identity policy failure after every compound tool rail completed", () => {
    const scenario = liveSourceFailClosedScenario();
    const askTurn = buildLiveSourceFailClosedTurn({ projectAsTypedFailure: true });
    askTurn.terminal_error_code = "fresh_source_unbound";
    askTurn.live_source_identity_audit = {
      schema: "helix.live_source_identity_audit.v1",
      identity_ok: false,
      diagnosis: "fresh_source_unbound",
      assistant_answer: false,
      raw_content_included: false,
    };
    askTurn.codex_parity_agent_spine_rail_table = {
      ...(askTurn.codex_parity_agent_spine_rail_table as Record<string, unknown>),
      compound_subgoal_count: 1,
      first_incomplete_compound_subgoal_id: null,
      first_incomplete_compound_requested_capability: null,
      first_incomplete_compound_runtime_capability: null,
      first_incomplete_compound_selected_capability: null,
      first_incomplete_compound_executed_capability: null,
      compound_first_broken_rail: null,
      compound_rail_failure_code: null,
      compound_repair_target: null,
      compound_incomplete_subgoal_did_tool_run: null,
      observed_artifact_supports_requested_capability: true,
      first_broken_rail: "source_identity",
      repair_target: "source_binding",
      codex_parity_class: "source_identity_mismatch",
      rail_status: "fail_closed",
      rail_failure_code: "source_identity_mismatch",
    };
    askTurn.compound_subgoal_rail_statuses = [
      {
        subgoal_id: "ask:test:subgoal:visual-capture",
        order: 1,
        requested_capability: "live_env.read_processed_live_source_mail",
        runtime_capability: "live_env.read_processed_live_source_mail",
        selected_capability: "live_env.read_processed_live_source_mail",
        executed_capability: "live_env.read_processed_live_source_mail",
        args: {},
        observation_kind: "reasoning_context",
        observation_ref: "ask:test:reasoning_context:1",
        observation_provenance: "capability_key",
        satisfaction: "satisfied",
        rail_status: "complete",
        first_broken_rail: null,
        rail_failure_code: null,
        repair_target: null,
      },
    ];

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(true);
    expect(probe.failures).toEqual([]);
  });
});

const liveSourceFailClosedScenario = (): HelixApiParityScenario => ({
  id: "fail_closed_rail_projection_contract",
  description: "A fail-closed live-source rail must project as typed failure.",
  enabled: true,
  seed: "none",
  prompt: "Use live_env.read_processed_live_source_mail to inspect the latest processed live-source mail.",
  expected: {
    solver_completed: false,
  },
});

const buildLiveSourceFailClosedTurn = (input: { projectAsTypedFailure: boolean }): Record<string, unknown> => {
  const scenario = liveSourceFailClosedScenario();
  const turnId = "ask:test:fail-closed-rail-projection-contract";
  const terminalErrorCode = input.projectAsTypedFailure
    ? "missing_required_live_source_mailbox_observation"
    : null;
  const terminalKind = input.projectAsTypedFailure ? "typed_failure" : "model_synthesized_answer";
  const finalStatus = input.projectAsTypedFailure ? "final_failure" : "final_answer";
  const railTable = {
    schema: "helix.codex_parity_agent_spine_rail_table.v1",
    turn_id: turnId,
    prompt: scenario.prompt,
    requested_capability: "live_env.read_processed_live_source_mail",
    visible_tool_surface: ["live_env.read_processed_live_source_mail"],
    visible_tool_surface_original_count: 1,
    visible_tool_surface_truncated: false,
    selected_capability: "live_env.read_processed_live_source_mail",
    admitted_capability: "live_env.read_processed_live_source_mail",
    admission_proof_source: "tool_call_admission_decision.selected_capability",
    admission_proven: true,
    executed_capability: "live_env.read_processed_live_source_mail",
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
    observation_kind: "reasoning_context",
    observation_ref: "ask:test:reasoning_context:1",
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
    codex_parity_class: "observation_missing",
    normalized_codex_parity_classes: [...CODEX_PARITY_AGENT_SPINE_CLASSES],
    rail_status: "fail_closed",
    rail_failure_code: "required_observation_missing",
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  };
  return {
    turn_id: turnId,
    final_status: finalStatus,
    response_type: finalStatus,
    ...(terminalErrorCode ? { terminal_error_code: terminalErrorCode } : {}),
    final_answer_source: terminalKind,
    terminal_artifact_kind: terminalKind,
    selected_final_answer: input.projectAsTypedFailure
      ? "I could not complete this live-source mailbox turn because the required mailbox observation was not materialized."
      : "Here is a normal-looking answer without the required mailbox observation.",
    codex_parity_agent_spine_rail_table: railTable,
    tool_rail_terminal_failure_reconciliation_runtime: {
      schema: "helix.tool_rail_terminal_failure_reconciliation.runtime.v1",
      version: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
      available: true,
      assistant_answer: false,
      raw_content_included: false,
    },
    ask_turn_solver_trace: {
      completed_solver_path: false,
      selected_primary_intent: "live_source_mailbox",
      solver_short_circuit_flags: [],
    },
    loop_parity_trace: {
      admitted_tool_families: ["live_environment"],
      actual_tool_calls: ["live_env.read_processed_live_source_mail"],
      unexpected_tool_calls: [],
      short_circuit_risk_flags: [],
    },
    route_authority_audit: {
      route_authority_ok: true,
      violation_codes: [],
    },
    poison_audit: {
      ok: true,
    },
    terminal_answer_authority: {
      server_authoritative: true,
      final_answer_source: terminalKind,
      terminal_artifact_kind: terminalKind,
      ...(terminalErrorCode ? { terminal_error_code: terminalErrorCode } : {}),
    },
    terminal_presentation: {
      terminal_artifact_kind: terminalKind,
      ...(terminalErrorCode ? { terminal_error_code: terminalErrorCode } : {}),
    },
  };
};
