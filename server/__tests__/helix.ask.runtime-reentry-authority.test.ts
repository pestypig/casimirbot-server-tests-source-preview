import { describe, expect, it } from "vitest";

import { buildCapabilityLifecycleLedger } from "../services/helix-ask/capability-lifecycle-ledger";
import { evaluateRealtimeGroundingEvidence } from "../services/helix-ask/realtime-session/grounded-answer-evidence";
import { createHelixTurnLifecycleRecorder } from "../services/helix-ask/runtime/turn-lifecycle";
import { collectCapabilityReenteredRefs } from "../services/helix-ask/runtime/solver-payload-refresh";
import { buildSolverSubgoalLedger } from "../services/helix-ask/solver-subgoal-ledger";
import { buildToolLifecycleTrace } from "../services/helix-ask/tool-lifecycle-trace";

const buildRuntimeLifecycle = (input: { turnId: string; observationRef?: string }) => {
  const recorder = createHelixTurnLifecycleRecorder({
    turnId: input.turnId,
    scope: "codex_native_provider_cycle",
    now: () => 100,
  });
  const started = recorder.append({
    kind: "turn.started",
    producer: "helix_adapter",
    status: "started",
  });
  let causationId = started.event_id;
  if (input.observationRef) {
    const route = recorder.append({
      kind: "route.committed",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: causationId,
      route_commit_id: "route:calculator",
      capability_ids: ["scientific-calculator.solve_expression"],
    });
    const admitted = recorder.append({
      kind: "capability.admitted",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: route.event_id,
      route_commit_id: "route:calculator",
      capability_id: "scientific-calculator.solve_expression",
    });
    const call = recorder.append({
      kind: "tool.call.started",
      producer: "codex_runtime",
      status: "started",
      causation_id: admitted.event_id,
      route_commit_id: "route:calculator",
      call_id: "call:calculator",
      capability_id: "scientific-calculator.solve_expression",
    });
    const completed = recorder.append({
      kind: "tool.call.completed",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: call.event_id,
      route_commit_id: "route:calculator",
      call_id: "call:calculator",
      capability_id: "scientific-calculator.solve_expression",
      observation_refs: [input.observationRef],
    });
    const reentered = recorder.append({
      kind: "observation.reentered",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: completed.event_id,
      route_commit_id: "route:calculator",
      call_id: "call:calculator",
      capability_id: "scientific-calculator.solve_expression",
      observation_refs: [input.observationRef],
    });
    causationId = reentered.event_id;
  }
  const message = recorder.append({
    kind: "agent.message.completed",
    producer: "codex_runtime",
    status: "succeeded",
    causation_id: causationId,
    native_item_id: "agent-message:calculator",
    message_sha256: "hash:calculator",
  });
  const runtime = recorder.append({
    kind: "runtime.turn.completed",
    producer: "codex_runtime",
    status: "succeeded",
    causation_id: message.event_id,
    native_turn_id: "native-turn:calculator",
  });
  const eligibility = recorder.append({
    kind: "terminal.eligibility.checked",
    producer: "helix_policy",
    status: "succeeded",
    causation_id: runtime.event_id,
    terminal_kind: "agent_provider_terminal_candidate",
    terminal_eligible: true,
  });
  recorder.append({
    kind: "turn.completed",
    producer: "helix_adapter",
    status: "succeeded",
    causation_id: eligibility.event_id,
    terminal_kind: "agent_provider_terminal_candidate",
    terminal_eligible: true,
  });
  return recorder.snapshot();
};

const buildPayload = (input: { turnId: string; observationRef: string; lifecycleObservationRef?: string }) => ({
  selected_final_answer: "The result is 4.",
  native_provider_turn_lifecycle: buildRuntimeLifecycle({
    turnId: input.turnId,
    observationRef: input.lifecycleObservationRef,
  }),
  capability_plan: {
    schema: "helix.capability_plan.v1",
    turn_id: input.turnId,
    capability_family: "calculator",
    requested_action: "scientific-calculator.solve_expression",
    selected_capability: "scientific-calculator.solve_expression",
    source_target: "scientific_calculator",
    goal_kind: "calculator_solve",
    required_terminal_kind: "model_synthesized_answer",
    mutating: false,
    operator_command_required: false,
    operator_command_present: false,
    admission_status: "admitted",
    assistant_answer: false,
    raw_content_included: false,
  },
  capability_result: {
    schema: "helix.capability_result.v1",
    turn_id: input.turnId,
    capability_plan_id: "plan:calculator",
    status: "succeeded",
    receipt_refs: [],
    evidence_refs: [input.observationRef],
    selected_for_answer: true,
    reentered_solver: true,
    assistant_answer: false,
    raw_content_included: false,
  },
  runtime_tool_call: {
    capability_key: "scientific-calculator.solve_expression",
    status: "completed",
  },
  operational_satisfaction_evaluation: {
    schema: "helix.operational_satisfaction_evaluation.v1",
    turn_id: input.turnId,
    requested_surface_satisfied: true,
    next_decision: "allow_terminal",
    evidence_refs: [input.observationRef],
  },
  current_turn_artifact_ledger: [{
    artifact_id: input.observationRef,
    kind: "calculator_result_validation",
    payload: {
      schema: "helix.calculator_result_validation.v1",
      evidence_refs: [input.observationRef],
    },
  }],
  terminal_answer_authority: {
    schema: "helix.turn_terminal_authority.v1",
    server_authoritative: true,
  },
  route_authority_audit: {
    schema: "helix.route_authority_audit.v1",
    route_authority_ok: true,
  },
  solver_artifact_reentry_audit: {
    schema: "helix.solver_artifact_reentry_audit.v1",
    ok: true,
  },
});

const executeCapabilitySubgoal = (payload: Record<string, unknown>, turnId: string) =>
  buildSolverSubgoalLedger({
    turnId,
    promptText: "Use the calculator and report the result.",
    payload,
  }).subgoals.find((subgoal) => subgoal.kind === "execute_capability");

describe("Helix runtime re-entry authority conformance", () => {
  it("rejects legacy re-entry claims that are absent from a verified event log", () => {
    const turnId = "ask:runtime-reentry:forged";
    const observationRef = "observation:calculator:forged";
    const payload = buildPayload({ turnId, observationRef });
    expect(collectCapabilityReenteredRefs(payload)).toEqual([]);
    const ledger = buildCapabilityLifecycleLedger({
      turnId,
      payload,
      terminalArtifactKind: "model_synthesized_answer",
    });
    payload.capability_lifecycle_ledger = ledger;
    const trace = buildToolLifecycleTrace({ turnId, payload });
    const grounding = evaluateRealtimeGroundingEvidence({
      turnId,
      requiredCapabilityIds: ["scientific-calculator.solve_expression"],
      payload: {
        ...payload,
        workstation_gateway_call_results: [{
          ok: true,
          capability_id: "scientific-calculator.solve_expression",
          artifact_refs: [observationRef],
          observation_packet: {
            status: "succeeded",
            call_id: "call:calculator",
            produced_artifact_refs: [observationRef],
          },
        }],
      },
      debug: null,
      solverTrace: null,
      evidenceContinuationCompleted: true,
    });

    expect(ledger).toMatchObject({
      reentry_authority: "runtime_event_log",
      runtime_lifecycle_verified: true,
      matched_reentry_refs: [],
      ok: false,
      failure_codes: expect.arrayContaining(["capability_result_not_reentered"]),
    });
    expect(trace).toMatchObject({
      reentry_authority: "runtime_event_log",
      runtime_lifecycle_verified: true,
      matched_reentry_refs: [],
      lifecycle_stage: "completed",
      terminal_eligible: false,
    });
    expect(executeCapabilitySubgoal(payload, turnId)).toMatchObject({
      status: "blocked",
      evaluation: { ok: false },
    });
    expect(grounding).toMatchObject({ satisfied: false, reentryAuthority: null });
  });

  it("admits exact observation refs from the verified runtime event log", () => {
    const turnId = "ask:runtime-reentry:exact";
    const observationRef = "observation:calculator:exact";
    const payload = buildPayload({
      turnId,
      observationRef,
      lifecycleObservationRef: observationRef,
    });
    expect(collectCapabilityReenteredRefs(payload)).toEqual([observationRef]);
    const ledger = buildCapabilityLifecycleLedger({
      turnId,
      payload,
      terminalArtifactKind: "model_synthesized_answer",
    });
    payload.capability_lifecycle_ledger = ledger;
    const trace = buildToolLifecycleTrace({ turnId, payload });
    const grounding = evaluateRealtimeGroundingEvidence({
      turnId,
      requiredCapabilityIds: ["scientific-calculator.solve_expression"],
      payload: {
        ...payload,
        workstation_gateway_call_results: [{
          ok: true,
          capability_id: "scientific-calculator.solve_expression",
          artifact_refs: [observationRef],
          observation_packet: {
            status: "succeeded",
            call_id: "call:calculator",
            produced_artifact_refs: [observationRef],
          },
        }],
      },
      debug: null,
      solverTrace: null,
      evidenceContinuationCompleted: true,
    });

    expect(ledger).toMatchObject({
      reentry_authority: "runtime_event_log",
      runtime_lifecycle_verified: true,
      matched_reentry_refs: [observationRef],
      failure_codes: [],
      ok: true,
    });
    expect(trace).toMatchObject({
      reentry_authority: "runtime_event_log",
      runtime_lifecycle_verified: true,
      matched_reentry_refs: [observationRef],
      lifecycle_stage: "reentered_solver",
      terminal_eligible: true,
    });
    expect(executeCapabilitySubgoal(payload, turnId)).toMatchObject({
      status: "succeeded",
      evaluation: { ok: true },
    });
    expect(grounding).toMatchObject({
      satisfied: true,
      evidenceRefs: expect.arrayContaining([observationRef]),
      reentryAuthority: "runtime_event_log",
    });
  });
});
