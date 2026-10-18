import { describe, expect, it } from "vitest";
import { buildLoopParityTrace } from "../services/helix-ask/loop-parity-trace";

describe("Helix Ask loop parity trace", () => {
  it("recognizes a current-turn provider completion after workstation observation re-entry", () => {
    const turnId = "ask:test:provider-active-context";
    const observationRef = `${turnId}:workstation_gateway:workstation.active_context:1`;
    const normalizedRef = `${turnId}:codex_normalized:workstation_active_context_observation:1`;
    const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex:answer`;
    const payload = {
      source_target_intent: {
        target_source: "operator_text",
        target_kind: "realtime_transcript",
        strength: "hard",
      },
      poison_audit: { ok: true, violations: [] },
      terminal_answer_authority: {
        turn_id: turnId,
        terminal_artifact_kind: "agent_provider_terminal_candidate",
        final_answer_source: "agent_provider_terminal_candidate",
        terminal_artifact_ref: candidateRef,
        server_authoritative: true,
      },
      terminal_presentation: {
        turn_id: turnId,
        terminal_artifact_kind: "agent_provider_terminal_candidate",
        final_answer_source: "agent_provider_terminal_candidate",
        selected_observation_refs: [observationRef, normalizedRef],
      },
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        turn_id: turnId,
        selected_terminal_artifact_kind: "agent_provider_terminal_candidate",
        selected_terminal_artifact_ref: candidateRef,
        selected_terminal_support_refs: [observationRef, normalizedRef],
        integrity: {
          single_writer_applied: true,
          post_tool_model_step_satisfied: true,
        },
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        provider_terminal_candidate_ref: candidateRef,
        all_observations_succeeded: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: observationRef,
          kind: "provider_gateway_observation_packet",
          payload: { turn_id: turnId, observation_ref: observationRef },
        },
        {
          artifact_id: normalizedRef,
          kind: "workstation_active_context_observation",
          payload: { turn_id: turnId, artifact_id: normalizedRef },
        },
      ],
    };

    const trace = buildLoopParityTrace({
      turnId,
      promptText: "So, what workstation panel is active right now?",
      selectedRoute: "/ask/turn/stream",
      terminalArtifactKind: "agent_provider_terminal_candidate",
      finalAnswerSource: "agent_provider_terminal_candidate",
      payload,
    });

    expect(trace).toMatchObject({
      post_observation_finalizer_ran: true,
      followup_reasoning_ran: true,
      terminal_selection_ran_after_observations: true,
      route_authority_ok: true,
      terminal_authority_ok: true,
    });
    expect(trace.evidence_selected_for_answer).toEqual([
      observationRef,
      normalizedRef,
    ]);
    expect(trace.short_circuit_risk_flags).not.toContain(
      "classifier_selected_terminal_without_evidence",
    );
    expect(trace.short_circuit_risk_flags).not.toContain(
      "terminal_selected_before_observation_finalizer",
    );
    expect(trace.short_circuit_risk_flags).not.toContain(
      "route_authority_missing",
    );

    const missingModelStepTrace = buildLoopParityTrace({
      turnId,
      promptText: "So, what workstation panel is active right now?",
      selectedRoute: "/ask/turn/stream",
      terminalArtifactKind: "agent_provider_terminal_candidate",
      finalAnswerSource: "agent_provider_terminal_candidate",
      payload: {
        ...payload,
        terminal_authority_single_writer: {
          ...payload.terminal_authority_single_writer,
          integrity: {
            single_writer_applied: true,
            post_tool_model_step_satisfied: false,
          },
        },
      },
    });
    expect(
      missingModelStepTrace.terminal_selection_ran_after_observations,
    ).toBe(false);
    expect(missingModelStepTrace.short_circuit_risk_flags).toContain(
      "terminal_selected_before_observation_finalizer",
    );

    const staleSupportTrace = buildLoopParityTrace({
      turnId,
      promptText: "So, what workstation panel is active right now?",
      selectedRoute: "/ask/turn/stream",
      terminalArtifactKind: "agent_provider_terminal_candidate",
      finalAnswerSource: "agent_provider_terminal_candidate",
      payload: {
        ...payload,
        terminal_presentation: {
          ...payload.terminal_presentation,
          selected_observation_refs: [
            "ask:prior-turn:workstation.active_context:1",
          ],
        },
      },
    });
    expect(staleSupportTrace.terminal_selection_ran_after_observations).toBe(
      false,
    );
    expect(staleSupportTrace.route_authority_ok).toBe(false);
  });

  it("canonicalizes calculator panel action aliases to the admitted calculator capability", () => {
    const turnId = "ask:test:calculator-alias";
    const trace = buildLoopParityTrace({
      turnId,
      promptText:
        "Call scientific-calculator.solve_expression with expression 2 + 2.",
      selectedRoute: "calculator_solve",
      terminalArtifactKind: "workstation_tool_evaluation",
      finalAnswerSource: "workstation_tool_evaluation",
      payload: {
        source_target_intent: {
          target_source: "calculator_stream",
          target_kind: "current_turn_action",
          strength: "hard",
        },
        tool_call_admission_decision: {
          admitted_tool_families: ["calculator", "workstation_action"],
        },
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          allowed_terminal_artifact_kinds: ["workstation_tool_evaluation"],
          forbidden_terminal_artifact_kinds: [],
        },
        terminal_answer_authority: {
          server_authoritative: true,
        },
        route_authority_audit: {
          route_authority_ok: true,
          violation_codes: [],
        },
        poison_audit: {
          ok: true,
          violations: [],
        },
        terminal_presentation: {
          terminal_artifact_kind: "workstation_tool_evaluation",
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: `${turnId}:runtime_tool_call:1:calculator`,
            kind: "runtime_tool_call",
            payload: {
              capability_key: "scientific-calculator.solve_expression",
              call_id: `${turnId}:runtime_tool_call:1:calculator`,
            },
          },
          {
            artifact_id: `${turnId}:agent_runtime_1_scientific_calculator_solve_expression:calculator_result_trace:5`,
            kind: "calculator_result_trace",
            payload: {
              action_id: "solve_expression",
              trace_source: "scientific-calculator.solve_expression",
            },
          },
        ],
      },
    });

    expect(trace.actual_tool_calls).toEqual([
      expect.objectContaining({
        tool_id: "scientific-calculator.solve_expression",
        family: "calculator",
        admitted: true,
      }),
    ]);
    expect(trace.unexpected_tool_calls).toEqual([]);
    expect(trace.short_circuit_risk_flags).not.toContain(
      "tool_called_without_admission",
    );
  });

  it("recognizes the canonical visual gateway as an admitted SituationRun call", () => {
    const turnId = "ask:test:visual-situation-run";
    const trace = buildLoopParityTrace({
      turnId,
      promptText: "What is happening right now in the visual screen capture?",
      selectedRoute: "/ask",
      terminalArtifactKind: "typed_failure",
      finalAnswerSource: "typed_failure",
      payload: {
        tool_call_admission_decision: {
          admitted_tool_families: ["situation_run"],
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: `${turnId}:gateway:visual`,
            kind: "provider_gateway_observation_packet",
            payload: {
              capability_key: "situation-room.describe_visual_capture",
              call_id: `${turnId}:gateway:visual:call`,
            },
          },
        ],
      },
    });

    expect(trace.actual_tool_calls).toEqual([
      expect.objectContaining({
        tool_id: "situation-room.describe_visual_capture",
        family: "situation_run",
        admitted: true,
      }),
    ]);
    expect(trace.unexpected_tool_calls).toEqual([]);
    expect(trace.short_circuit_risk_flags).not.toContain(
      "tool_called_without_admission",
    );
  });

  it("classifies the Minecraft connector capability as live-environment evidence", () => {
    const turnId = "ask:test:minecraft-environment-connector";
    const capability = "com.casimirbot.minecraft.inventory.check";
    const trace = buildLoopParityTrace({
      turnId,
      promptText: "Check my current Minecraft inventory now.",
      selectedRoute: "/ask",
      terminalArtifactKind: "typed_failure",
      finalAnswerSource: "typed_failure",
      payload: {
        tool_call_admission_decision: {
          admitted_tool_families: ["live_environment"],
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: `${turnId}:gateway:minecraft`,
            kind: "provider_gateway_observation_packet",
            payload: {
              capability_key: capability,
              call_id: `${turnId}:gateway:minecraft:call`,
            },
          },
        ],
      },
    });

    expect(trace.actual_tool_calls).toEqual([
      expect.objectContaining({
        tool_id: capability,
        family: "live_environment",
        admitted: true,
      }),
    ]);
    expect(trace.unexpected_tool_calls).toEqual([]);
    expect(trace.short_circuit_risk_flags).not.toContain(
      "tool_called_without_admission",
    );
  });
});
