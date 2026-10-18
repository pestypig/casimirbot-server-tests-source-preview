import { describe, expect, it } from "vitest";

import { buildAskTurnSolverTrace } from "../../ask-turn-solver";
import { refreshToolLifecycleRecords } from "../../tool-lifecycle-trace";
import {
  authoritativeTypedFailureRequiresNoContinuation,
  reconcileAuthoritativeTypedFailureLifecycle,
} from "../typed-failure-lifecycle-reconciliation";
import { createHelixTurnLifecycleRecorder } from "../turn-lifecycle";

const basePayload = (): Record<string, unknown> => ({
  terminal_artifact_kind: "typed_failure",
  final_answer_source: "typed_failure",
  route_product_contract: {
    schema: "helix.route_product_contract.v1",
    source_target: "visual_capture",
    allowed_terminal_artifact_kinds: ["typed_failure"],
    forbidden_terminal_artifact_kinds: [],
  },
  source_target_intent: {
    schema: "helix.ask_source_target_intent.v1",
    target_source: "visual_capture",
    target_kind: "visual_capture",
    strength: "hard",
    must_enter_backend_ask: true,
    allow_client_shortcut: false,
    allow_no_tool_direct: false,
  },
  tool_call_admission_decision: {
    schema: "helix.tool_call_admission_decision.v1",
    requested_capability: "situation_run",
    admitted_capability: "situation_run",
    required_observation_kinds_for_requested_capability: [],
    admitted_tool_families: ["situation_run"],
  },
  current_turn_artifact_ledger: [],
  loop_parity_trace: {
    schema: "helix.loop_parity_trace.v1",
    selected_route: "/ask/turn",
    observations_created: [],
    route_authority_ok: false,
    terminal_selection_ran_after_observations: false,
    short_circuit_risk_flags: [
      "route_contract_missing",
      "route_authority_missing",
      "terminal_selected_before_observation_finalizer",
    ],
  },
  ask_turn_solver_trace: {
    schema: "helix.ask_turn_solver_trace.v1",
    route_authority_ok: false,
    solver_risk_flags: ["terminal_authority_before_solver_completion"],
    solver_short_circuit_flags: [
      "terminal_authority_before_solver_completion",
    ],
    evidence_reentry: {
      required: true,
      completed: false,
      skipped_reason: "terminal_selection_missing_after_required_evidence",
    },
    followup_reasoning_gate: {
      required: true,
      completed: false,
      skipped_reason: "final_arbitration_missing_after_evidence_or_tool_result",
      violation_codes: ["missing_followup_reasoning"],
    },
    final_arbitration: {
      terminal_artifact_kind: "unknown",
      final_answer_source: "unknown",
      remaining_uncertainty: [
        "terminal_authority_before_solver_completion",
      ],
    },
  },
  codex_parity_agent_spine_rail_table: {
    requested_capability: "situation_run",
    required_observation_kinds_for_requested_capability: [],
    observed_artifact_supports_requested_capability: true,
  },
  agent_runtime_loop_admission: {
    schema: "helix.agent_runtime_loop_admission.v1",
    admitted: true,
    mode: "record_only",
    reason:
      "source_or_capability_terminal_failure_requires_runtime_loop_record",
  },
  debug: {
    agent_runtime_loop_admission: {
      schema: "helix.agent_runtime_loop_admission.v1",
      admitted: true,
      mode: "record_only",
      reason:
        "source_or_capability_terminal_failure_requires_runtime_loop_record",
    },
  },
});

describe("authoritative typed-failure lifecycle reconciliation", () => {
  it("keeps stale projections read-only when a verified lifecycle already owns the facts", () => {
    const turnId = "ask:test:canonical-typed-failure-read-only";
    const observationRef = `${turnId}:observation:connector-offline`;
    const recorder = createHelixTurnLifecycleRecorder({
      turnId,
      scope: "helix_ask_turn",
      now: () => 100,
    });
    const started = recorder.append({
      kind: "turn.started",
      producer: "helix_adapter",
      status: "started",
    });
    const route = recorder.append({
      kind: "route.committed",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: started.event_id,
      route_commit_id: `${turnId}:route`,
      capability_ids: ["com.casimirbot.minecraft.inventory.check"],
    });
    const admitted = recorder.append({
      kind: "capability.admitted",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: route.event_id,
      route_commit_id: `${turnId}:route`,
      capability_id: "com.casimirbot.minecraft.inventory.check",
    });
    const call = recorder.append({
      kind: "tool.call.started",
      producer: "codex_runtime",
      status: "started",
      causation_id: admitted.event_id,
      route_commit_id: `${turnId}:route`,
      call_id: `${turnId}:call`,
      capability_id: "com.casimirbot.minecraft.inventory.check",
    });
    const failed = recorder.append({
      kind: "tool.call.failed",
      producer: "helix_adapter",
      status: "failed",
      causation_id: call.event_id,
      route_commit_id: `${turnId}:route`,
      call_id: `${turnId}:call`,
      capability_id: "com.casimirbot.minecraft.inventory.check",
      observation_refs: [observationRef],
      reason_code: "connector_offline",
    });
    const reentered = recorder.append({
      kind: "observation.reentered",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: failed.event_id,
      route_commit_id: `${turnId}:route`,
      call_id: `${turnId}:call`,
      capability_id: "com.casimirbot.minecraft.inventory.check",
      observation_refs: [observationRef],
    });
    const message = recorder.append({
      kind: "agent.message.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: reentered.event_id,
      message_sha256: "hash:typed-failure",
    });
    const runtime = recorder.append({
      kind: "runtime.turn.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: message.event_id,
    });
    const eligibility = recorder.append({
      kind: "terminal.eligibility.checked",
      producer: "helix_terminal_authority",
      status: "succeeded",
      causation_id: runtime.event_id,
      terminal_kind: "typed_failure",
      terminal_eligible: true,
    });
    recorder.append({
      kind: "turn.failed",
      producer: "helix_adapter",
      status: "failed",
      causation_id: eligibility.event_id,
      terminal_kind: "typed_failure",
      terminal_eligible: true,
      reason_code: "connector_offline",
    });
    const payload = basePayload();
    payload.turn_id = turnId;
    payload.turn_lifecycle = recorder.snapshot();
    payload.terminal_error_code = "connector_offline";
    payload.typed_failure = {
      schema: "helix.typed_failure.v1",
      error_code: "connector_offline",
    };
    payload.route_authority_audit = { route_authority_ok: true };
    payload.provider_reasoning_reentry = {
      schema: "helix.provider_reasoning_reentry.v1",
      status: "not_run",
      evidence_reentered: false,
      solver_completed: false,
    };
    payload.codex_parity_agent_spine_rail_table = {
      rail_status: "fail_closed",
      rail_failure_code: "terminal_not_materialized",
    };

    expect(
      reconcileAuthoritativeTypedFailureLifecycle({
        payload,
        turnId,
        selectedTerminalArtifactKind: "typed_failure",
        finalAnswerSource: "typed_failure",
      }),
    ).toBe(true);
    expect(payload.provider_reasoning_reentry).toMatchObject({
      status: "not_run",
      evidence_reentered: false,
      solver_completed: false,
    });
    expect(payload.codex_parity_agent_spine_rail_table).toMatchObject({
      rail_status: "fail_closed",
      rail_failure_code: "terminal_not_materialized",
    });
    expect(payload.typed_failure_lifecycle_reconciliation).toMatchObject({
      schema: "helix.typed_failure_lifecycle_reconciliation.v1",
      mode: "read_only_projection",
      status: "canonical_lifecycle_preserved",
      error_code: "connector_offline",
      runtime_observation_reentry_refs: [observationRef],
      runtime_turn_completed: true,
      projections_mutated: false,
    });
  });
  it("accepts the canonical single writer as typed-failure authority before later mirrors settle", () => {
    const payload = basePayload();
    payload.terminal_error_code = "procedure_memory_unavailable";
    payload.typed_failure = {
      schema: "helix.typed_failure.v1",
      error_code: "procedure_memory_unavailable",
      next_required_action: "repair_procedure_memory",
      assistant_answer: false,
      raw_content_included: false,
    };
    payload.route_authority_audit = { route_authority_ok: false };
    payload.loop_parity_trace = {
      ...(payload.loop_parity_trace as Record<string, unknown>),
      route_authority_ok: false,
    };
    payload.terminal_answer_authority = { server_authoritative: false };
    payload.terminal_authority_single_writer = {
      schema: "helix.terminal_authority_single_writer_result.v1",
      selected_terminal_artifact_kind: "typed_failure",
      selected_terminal_artifact_ref: "ask:test:typed_failure:1",
      source: "typed_failure",
      integrity: { single_writer_applied: true },
    };

    expect(authoritativeTypedFailureRequiresNoContinuation(payload)).toBe(
      true,
    );

    (payload.terminal_authority_single_writer as Record<string, unknown>).source =
      "final_answer_draft";
    expect(authoritativeTypedFailureRequiresNoContinuation(payload)).toBe(
      false,
    );
  });

  it("settles the canonical uppercase procedure-memory source failure", () => {
    const payload = basePayload();
    payload.terminal_error_code =
      "PROCEDURE_MEMORY_ACTIVE_SITUATION_RUN_MISSING";
    payload.typed_failure = {
      schema: "helix.typed_failure.v1",
      error_code: "PROCEDURE_MEMORY_ACTIVE_SITUATION_RUN_MISSING",
      next_required_action: "repair_procedure_memory",
      assistant_answer: false,
      raw_content_included: false,
    };
    payload.route_authority_audit = { route_authority_ok: true };
    (payload.loop_parity_trace as Record<string, unknown>).observations_created = [
      {
        observation_id: "ask:test:procedure-memory-source-failure",
        source_kind: "source_observation",
      },
    ];
    (payload.loop_parity_trace as Record<string, unknown>).actual_tool_calls = [];

    expect(authoritativeTypedFailureRequiresNoContinuation(payload)).toBe(
      true,
    );
  });

  it("settles stale route and terminal flags after a zero-observation typed failure", () => {
    const payload = basePayload();
    delete payload.route_product_contract;

    expect(
      reconcileAuthoritativeTypedFailureLifecycle({
        payload,
        turnId: "ask:test:capability-unavailable",
        promptText: "Review what is happening in the screen capture.",
        selectedTerminalArtifactKind: "typed_failure",
        finalAnswerSource: "typed_failure",
      }),
    ).toBe(true);

    expect(payload.route_authority_audit).toMatchObject({
      schema: "helix.route_authority_audit.v1",
      route_authority_ok: true,
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
    });
    expect(payload.route_product_contract).toMatchObject({
      schema: "helix.route_product_contract.v1",
      source_target: "visual_capture",
    });
    expect(payload.canonical_goal_frame).toMatchObject({
      authoritative_zero_observation_typed_failure: true,
    });
    expect(payload.tool_call_admission_decision).toMatchObject({
      requested_capability: "situation_run",
      required_observation_kinds_for_requested_capability: [
        "visual_frame_evidence",
        "situation_context_pack",
        "visual_capture_coverage",
      ],
    });
    expect(payload.loop_parity_trace).toMatchObject({
      route_authority_ok: true,
      terminal_selection_ran_after_observations: true,
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      short_circuit_risk_flags: [],
    });
    expect(payload.ask_turn_solver_trace).toMatchObject({
      route_authority_ok: true,
      completed_solver_path: true,
      solver_risk_flags: [],
      solver_short_circuit_flags: [],
      evidence_reentry: {
        required: false,
        completed: true,
        reason: "authoritative_typed_failure_no_observation",
      },
      followup_reasoning_gate: {
        required: false,
        completed: true,
        reason: "authoritative_typed_failure_no_observation",
        violation_codes: [],
      },
      final_arbitration: {
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        remaining_uncertainty: [],
      },
    });
    expect(payload.codex_parity_agent_spine_rail_table).toMatchObject({
      requested_capability: "situation_run",
      required_observation_kinds_for_requested_capability: [
        "visual_frame_evidence",
        "situation_context_pack",
        "visual_capture_coverage",
      ],
      observed_artifact_supports_requested_capability: false,
    });
    expect(payload.agent_runtime_loop_admission).toMatchObject({
      admitted: false,
      mode: "skip",
      reason: "authoritative_typed_failure_terminal",
    });
    expect(
      (payload.debug as Record<string, unknown>)
        .agent_runtime_loop_admission,
    ).toMatchObject({
      admitted: false,
      mode: "skip",
      reason: "authoritative_typed_failure_terminal",
    });
  });

  it("does not reconcile an observed-tool path", () => {
    const payload = basePayload();
    (
      payload.loop_parity_trace as Record<string, unknown>
    ).observations_created = [
      {
        observation_id: "obs:1",
        source_kind: "tool_observation",
      },
    ];

    expect(
      reconcileAuthoritativeTypedFailureLifecycle({
        payload,
        turnId: "ask:test:post-tool-failure",
        promptText: "Use the observation and continue.",
        selectedTerminalArtifactKind: "typed_failure",
        finalAnswerSource: "typed_failure",
      }),
    ).toBe(false);
    expect(payload.agent_runtime_loop_admission).toMatchObject({
      admitted: true,
      mode: "record_only",
      reason:
        "source_or_capability_terminal_failure_requires_runtime_loop_record",
    });
    expect(
      (
        payload.loop_parity_trace as {
          short_circuit_risk_flags: string[];
        }
      ).short_circuit_risk_flags,
    ).toContain("route_authority_missing");
  });

  it("does not misclassify a current-turn capability observation packet as a zero-observation failure", () => {
    const payload = basePayload();
    const turnId = "ask:test:capability-repair-required";
    payload.active_turn_id = turnId;
    payload.terminal_error_code = "precondition_failed";
    payload.typed_failure = {
      schema: "helix.typed_failure.v1",
      turn_id: turnId,
      error_code: "precondition_failed",
      message: "The failed capability needs a corrected model-authored request.",
      assistant_answer: false,
      raw_content_included: false,
    };
    payload.route_authority_audit = { route_authority_ok: true };
    payload.capability_lane_observation_packets = [
      {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: turnId,
        iteration: 2,
        call_id: `${turnId}:call:2`,
        decision_id: `${turnId}:decision:2`,
        capability_key:
          "com.casimirbot.minecraft.player.guardian.execute",
        status: "failed",
        observation_summary:
          "The concurrent program reached its admitted tick ceiling.",
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    ];

    expect(authoritativeTypedFailureRequiresNoContinuation(payload)).toBe(
      false,
    );
    expect(
      reconcileAuthoritativeTypedFailureLifecycle({
        payload,
        turnId,
        promptText: "Repair the failed Minecraft guardian attempt.",
        selectedTerminalArtifactKind: "typed_failure",
        finalAnswerSource: "typed_failure",
      }),
    ).toBe(false);
    expect(payload.canonical_goal_frame).toBeUndefined();
  });

  it("settles an actionable source-observation failure without launching a generic tool loop", () => {
    const payload = basePayload();
    payload.terminal_error_code = "procedure_epoch_previous_unavailable";
    payload.typed_failure = {
      schema: "helix.typed_failure.v1",
      error_code: "procedure_epoch_previous_unavailable",
      next_required_action: "wait_for_scene_memory_index",
      message:
        "Previous visual observation evidence is unavailable for comparison.",
      assistant_answer: false,
      raw_content_included: false,
    };
    payload.source_target_intent = {
      schema: "helix.ask_source_target_intent.v1",
      target_source: "procedure_memory",
      target_kind: "situation_epoch",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    };
    payload.route_product_contract = {
      schema: "helix.route_product_contract.v1",
      source_target: "procedure_memory",
      allowed_terminal_artifact_kinds: [
        "procedure_epoch_replay",
        "typed_failure",
      ],
      forbidden_terminal_artifact_kinds: [],
    };
    payload.current_turn_artifact_ledger = [
      {
        artifact_id: "ask:test:source-observation",
        kind: "source_observation",
        payload: { status: "observed" },
      },
      {
        artifact_id: "ask:test:source-typed-failure",
        kind: "typed_failure",
        payload: payload.typed_failure,
      },
    ];
    payload.loop_parity_trace = {
      ...(payload.loop_parity_trace as Record<string, unknown>),
      selected_route: "procedure_epoch_replay_question",
      observations_created: [
        {
          observation_id: "ask:test:source-observation",
          source_kind: "source_observation",
        },
      ],
      actual_tool_calls: [],
      short_circuit_risk_flags: [
        "missing_followup_reasoning",
        "goal_satisfaction_incomplete",
      ],
    };
    payload.ask_turn_solver_trace = {
      ...(payload.ask_turn_solver_trace as Record<string, unknown>),
      solver_risk_flags: [
        "missing_followup_reasoning",
        "goal_satisfaction_incomplete",
      ],
      followup_reasoning_gate: {
        required: true,
        completed: false,
        violation_codes: ["missing_followup_reasoning"],
      },
    };

    expect(
      reconcileAuthoritativeTypedFailureLifecycle({
        payload,
        turnId: "ask:test:source-observation-failure",
        promptText: "What changed since the previous visual capture?",
        selectedTerminalArtifactKind: "typed_failure",
        finalAnswerSource: "typed_failure",
      }),
    ).toBe(true);
    expect(payload.canonical_goal_frame).toMatchObject({
      authoritative_source_observation_typed_failure: true,
    });
    expect(payload.ask_turn_solver_trace).toMatchObject({
      completed_solver_path: true,
      solver_risk_flags: [],
      followup_reasoning_gate: {
        required: false,
        completed: true,
        reason: "authoritative_source_observation_typed_failure",
        violation_codes: [],
      },
    });
    (
      payload.loop_parity_trace as Record<string, unknown>
    ).actual_tool_calls = [
      {
        tool_id: "procedure_memory:retrieve_procedure_evidence",
        status: "failed",
      },
    ];
    expect(authoritativeTypedFailureRequiresNoContinuation(payload)).toBe(
      true,
    );
  });

  it("settles a connector-offline turn after verified post-observation reasoning and clears stale rail projections", () => {
    const payload = basePayload();
    const turnId = "ask:test:connector-offline-after-reentry";
    const observationRef = `${turnId}:provider_gateway_observation_packet:1`;
    payload.terminal_error_code = "connector_offline";
    payload.typed_failure = {
      schema: "helix.typed_failure.v1",
      error_code: "connector_offline",
      message:
        "No currently credentialed, registry-admitted Minecraft connector is available for the bound room.",
      next_required_action: "pair_environment_connector",
      assistant_answer: false,
      raw_content_included: false,
    };
    payload.source_target_intent = {
      schema: "helix.ask_source_target_intent.v1",
      target_source: "live_environment",
      target_kind: "live_environment",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    };
    payload.route_product_contract = {
      schema: "helix.route_product_contract.v1",
      source_target: "live_environment",
      allowed_terminal_artifact_kinds: [
        "model_synthesized_answer",
        "typed_failure",
      ],
      forbidden_terminal_artifact_kinds: [],
    };
    payload.current_turn_artifact_ledger = [
      {
        artifact_id: observationRef,
        kind: "provider_gateway_observation_packet",
        payload: {
          status: "failed",
          error_code: "connector_offline",
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:typed_failure:connector_offline`,
        kind: "typed_failure",
        payload: payload.typed_failure,
      },
    ];
    payload.loop_parity_trace = {
      ...(payload.loop_parity_trace as Record<string, unknown>),
      selected_route: "/ask/turn/stream",
      actual_tool_calls: [
        {
          tool_id: "com.casimirbot.minecraft.inventory.check",
          result_ref: observationRef,
        },
      ],
      // The production workstation gateway can leave this legacy projection
      // empty even though the authoritative runtime lifecycle proves that the
      // rejected tool observation was re-entered.
      observations_created: [],
      route_authority_ok: true,
    };
    payload.turn_lifecycle = {
      schema: "helix.turn_lifecycle.v1",
      authority: "runtime_event_log",
      events: [
        {
          kind: "observation.reentered",
          status: "succeeded",
          observation_refs: [observationRef],
        },
      ],
      reduction: {
        tool_calls: [
          {
            observation_refs: [observationRef],
            reentry_observation_refs: [observationRef],
            reentered: true,
          },
        ],
        post_observation_reasoning_completed: true,
        runtime_turn_completed: true,
        terminal_eligible: true,
      },
      integrity: { ok: true, violations: [] },
    };
    payload.route_authority_audit = {
      schema: "helix.route_authority_audit.v1",
      route_authority_ok: true,
    };
    payload.terminal_answer_authority = {
      schema: "helix.turn_terminal_authority.v1",
      server_authoritative: true,
    };
    payload.terminal_authority_single_writer = {
      schema: "helix.terminal_authority_single_writer_result.v1",
      selected_terminal_artifact_kind: "typed_failure",
      selected_terminal_artifact_ref: `${turnId}:typed_failure:connector_offline`,
      source: "typed_failure",
      integrity: { single_writer_applied: true },
    };
    payload.codex_parity_agent_spine_rail_table = {
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      first_broken_rail: "terminal_materialization",
      repair_target: "terminal_materializer",
      codex_parity_class: "goal_contract_mismatch",
      rail_status: "fail_closed",
      rail_failure_code: "terminal_not_materialized",
      terminal_eligible: false,
    };
    payload.tool_turn_chain_audit = {
      rail_status: "fail_closed",
      rail_failure_code: "terminal_not_materialized",
      terminal_eligible: false,
    };
    payload.tool_rail_failure_triage = {
      first_broken_rail: "terminal_materialization",
      failure_bucket: "E_terminal_materializer_gap",
      repair_target: "terminal_materializer",
      rail_status: "fail_closed",
      rail_failure_code: "terminal_not_materialized",
      terminal_eligible: false,
    };
    payload.active_terminal_rail_status = {
      rail_status: "fail_closed",
      rail_failure_code: "terminal_not_materialized",
      first_broken_rail: "terminal_materialization",
      repair_target: "terminal_materializer",
      terminal_eligible: false,
    };
    payload.provider_reasoning_reentry = {
      schema: "helix.provider_reasoning_reentry.v1",
      status: "not_run",
      observation_reentered: true,
      evidence_reentered: false,
      solver_completed: false,
      goal_satisfaction_compatible: false,
      terminal_eligible: false,
    };
    payload.tool_followup_decision = {
      schema: "helix.tool_followup_decision.v1",
      next_action: "retry",
      reason: "connector_offline",
      external_change_required: false,
      terminal_blockers: ["post_tool_model_step_required"],
      evidence_reentered: false,
      terminal_eligible: false,
    };
    payload.canonical_goal_frame = {
      // A pre-observation reconciliation pass can establish this projection;
      // the authoritative lifecycle must replace it once re-entry is proven.
      authoritative_zero_observation_typed_failure: true,
    };

    expect(authoritativeTypedFailureRequiresNoContinuation(payload)).toBe(
      true,
    );
    expect(
      reconcileAuthoritativeTypedFailureLifecycle({
        payload,
        turnId,
        promptText: "Check my current Minecraft inventory.",
        selectedTerminalArtifactKind: "typed_failure",
        finalAnswerSource: "typed_failure",
      }),
    ).toBe(true);
    expect(payload.canonical_goal_frame).toMatchObject({
      authoritative_source_observation_typed_failure: true,
    });
    expect(payload.canonical_goal_frame).not.toHaveProperty(
      "authoritative_zero_observation_typed_failure",
    );
    expect(payload.codex_parity_agent_spine_rail_table).toMatchObject({
      first_broken_rail: null,
      repair_target: null,
      codex_parity_class: "complete",
      rail_status: "complete",
      rail_failure_code: null,
      terminal_eligible: false,
    });
    expect(payload.tool_turn_chain_audit).toMatchObject({
      rail_status: "complete",
      rail_failure_code: null,
      terminal_eligible: false,
    });
    expect(payload.tool_rail_failure_triage).toMatchObject({
      first_broken_rail: null,
      failure_bucket: null,
      repair_target: null,
      rail_status: "complete",
      rail_failure_code: null,
      terminal_eligible: false,
    });
    expect(payload.active_terminal_rail_status).toMatchObject({
      rail_status: "complete",
      rail_failure_code: null,
      first_broken_rail: null,
      repair_target: null,
      terminal_eligible: false,
    });
    expect(payload.provider_reasoning_reentry).toMatchObject({
      status: "completed",
      observation_reentered: true,
      evidence_reentered: true,
      solver_completed: true,
      goal_satisfaction_compatible: true,
      terminal_eligible: false,
      completion_source: "turn_lifecycle.runtime_event_log",
    });
    expect(payload.tool_followup_decision).toMatchObject({
      next_action: "stop",
      reason: "connector_offline",
      external_change_required: true,
      terminal_blockers: [],
      evidence_reentered: true,
      terminal_eligible: false,
      completion_source: "turn_lifecycle.runtime_event_log",
    });

    Object.assign(
      payload.provider_reasoning_reentry as Record<string, unknown>,
      {
        status: "not_run",
        evidence_reentered: false,
        solver_completed: false,
        goal_satisfaction_compatible: false,
        completion_source: null,
      },
    );
    refreshToolLifecycleRecords({ payload, turnId });
    expect(payload.provider_reasoning_reentry).toMatchObject({
      status: "completed",
      evidence_reentered: true,
      solver_completed: true,
      goal_satisfaction_compatible: true,
      completion_source: "turn_lifecycle.runtime_event_log",
    });
    expect(payload.tool_followup_decision).toMatchObject({
      next_action: "stop",
      reason: "connector_offline",
      external_change_required: true,
      terminal_blockers: [],
      evidence_reentered: true,
      completion_source: "turn_lifecycle.runtime_event_log",
    });
  });

  it("builds a complete solver trace for an already-authoritative bounded source failure", () => {
    const payload = basePayload();
    payload.terminal_error_code = "procedure_epoch_previous_unavailable";
    payload.typed_failure = {
      schema: "helix.typed_failure.v1",
      error_code: "procedure_epoch_previous_unavailable",
      next_required_action: "wait_for_scene_memory_index",
      assistant_answer: false,
      raw_content_included: false,
    };
    payload.source_target_intent = {
      schema: "helix.ask_source_target_intent.v1",
      target_source: "procedure_memory",
      target_kind: "situation_epoch",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    };
    payload.route_product_contract = {
      schema: "helix.route_product_contract.v1",
      source_target: "procedure_memory",
      allowed_terminal_artifact_kinds: [
        "procedure_epoch_replay",
        "typed_failure",
      ],
      forbidden_terminal_artifact_kinds: [],
    };
    payload.current_turn_artifact_ledger = [
      {
        artifact_id: "ask:test:bounded-source-observation",
        kind: "source_observation",
        payload: { status: "observed" },
      },
    ];
    payload.loop_parity_trace = {
      ...(payload.loop_parity_trace as Record<string, unknown>),
      selected_route: "procedure_epoch_replay_question",
      observations_created: [
        {
          observation_id: "ask:test:bounded-source-observation",
          source_kind: "source_observation",
        },
      ],
      actual_tool_calls: [],
      route_authority_ok: true,
      poison_audit_ok: true,
      terminal_authority_ok: true,
      terminal_selection_ran_after_observations: true,
    };
    payload.route_authority_audit = {
      schema: "helix.route_authority_audit.v1",
      route_authority_ok: true,
    };
    payload.poison_audit = {
      schema: "helix.poison_audit.v1",
      ok: true,
    };
    payload.terminal_answer_authority = {
      schema: "helix.terminal_answer_authority.v1",
      server_authoritative: true,
    };

    const trace = buildAskTurnSolverTrace({
      turnId: "ask:test:bounded-source-terminal",
      promptText: "What changed since the previous visual capture?",
      selectedRoute: "procedure_epoch_replay_question",
      terminalArtifactKind: "typed_failure",
      finalAnswerSource: "typed_failure",
      payload,
    });

    expect(trace).toMatchObject({
      completed_solver_path: true,
      evidence_reentry_gate: {
        required: false,
        completed: true,
      },
      followup_reasoning_gate: {
        required: false,
        completed: true,
        reason: "authoritative_typed_failure_no_continuation",
      },
      final_arbitration: {
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        remaining_uncertainty: [],
      },
    });
  });
});
