import { beforeEach, describe, expect, it } from "vitest";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  ingestWorkstationLiveSourceEvent,
  listWorkstationLiveSourceWindows,
  resetWorkstationLiveSources,
  setWorkstationLiveSourceStatus,
} from "../services/situation-room/workstation-live-source-ingest";
import { buildPhysicsStabilityTick } from "../services/situation-room/physics-stability-source";

describe("workstation live computation source", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetWorkstationLiveSources();
  });

  it("updates calculator prime stream lines from deterministic source ticks", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:prime",
      objective: "Set up a live prime number generator and show the next primes as they are found.",
      source_ids: ["source:calculator-prime-stream"],
      preset: "calculator_prime_stream",
      now: "2026-05-08T16:00:00.000Z",
    });

    const result = ingestWorkstationLiveSourceEvent({
      source_id: "source:calculator-prime-stream",
      environment_id: environment.environment_id,
      kind: "calculator_series",
      event_type: "prime_found",
      seq: 6,
      ts: "2026-05-08T16:00:06.000Z",
      payload: {
        candidate: 7,
        is_prime: true,
        latest_prime: 7,
        prime_count: 4,
        gap: 2,
      },
      evidence_refs: ["calculator:prime:7"],
      trace: {
        calculator_trace_id: "scicalc-prime:6:7",
        algorithm: "trial_division",
        deterministic: true,
      },
    });

    expect(result.computation_event).toMatchObject({
      schema: "helix.live_computation_event.v1",
      ok: true,
      output: expect.objectContaining({ candidate: 7, is_prime: true }),
    });
    expect(result.live_answer_environment_delta).toMatchObject({
      schema: "helix.live_answer_environment_delta.v1",
      reason: "computation_tick",
      changed_line_keys: expect.arrayContaining(["current_candidate", "latest_prime", "prime_count", "last_test"]),
    });
    expect(result.event).toMatchObject({
      source_event_id: result.event.event_id,
      source_family: "calculator_stream",
      tick_index: 6,
      deterministic: true,
    });
    expect(result.live_answer_environment?.lines.find((line) => line.key === "latest_prime")?.value).toBe("7");
    expect(result.live_answer_environment?.latest_evaluation).toMatchObject({
      reason: "tick_based",
      model_invoked: false,
      deterministic: true,
    });
    expect(result.live_answer_environment_delta).toMatchObject({
      source_event_count: 1,
      window_id: expect.stringContaining("live_window:"),
      raw_logs_included: false,
      context_policy: "compact_context_pack_only",
    });
    expect(listWorkstationLiveSourceWindows("source:calculator-prime-stream")).toHaveLength(1);
    expect(result.live_answer_environment?.lines.find((line) => line.key === "last_test")?.value).toBe("7 is prime.");
  });

  it("suppresses ticks for paused sources", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:prime",
      objective: "Set up a live prime number generator.",
      source_ids: ["source:calculator-prime-stream"],
      preset: "calculator_prime_stream",
      now: "2026-05-08T16:00:00.000Z",
    });

    ingestWorkstationLiveSourceEvent({
      source_id: "source:calculator-prime-stream",
      environment_id: environment.environment_id,
      kind: "calculator_series",
      event_type: "prime_found",
      seq: 1,
      payload: { candidate: 2, is_prime: true, latest_prime: 2, prime_count: 1 },
    });
    setWorkstationLiveSourceStatus({ source_id: "source:calculator-prime-stream", status: "paused" });

    const result = ingestWorkstationLiveSourceEvent({
      source_id: "source:calculator-prime-stream",
      environment_id: environment.environment_id,
      kind: "calculator_series",
      event_type: "prime_found",
      seq: 2,
      payload: { candidate: 3, is_prime: true, latest_prime: 3, prime_count: 2 },
    });

    expect(result.event.event_type).toBe("source_tick_suppressed");
    expect(result.live_answer_environment_delta).toBeNull();
  });

  it("updates equation interpreter lines from generic equation ticks", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:equation",
      objective: "Use the current calculator equation as a live source and explain solved values.",
      source_ids: ["source:calculator-equation-live"],
      preset: "calculator_equation_interpreter",
      now: "2026-05-08T16:00:00.000Z",
    });

    const result = ingestWorkstationLiveSourceEvent({
      source_id: "source:calculator-equation-live",
      environment_id: environment.environment_id,
      kind: "calculator_series",
      event_type: "equation_evaluated",
      seq: 1,
      ts: "2026-05-08T16:00:01.000Z",
      payload: {
        expression: "x^2 - 4 = 0",
        equation_context: "Finding roots for a simple quadratic model.",
        ok: true,
        mode: "equation",
        normalized_expression: "-4+x^2 = 0",
        result_text: "2, -2",
        variable: "x",
      },
      evidence_refs: ["calculator:equation:x2-minus-4"],
      trace: {
        calculator_trace_id: "scicalc-equation:1:1w61eu2",
        algorithm: "scientific_solver",
        deterministic: true,
      },
    });

    expect(result.live_answer_environment_delta?.changed_line_keys).toEqual(expect.arrayContaining([
      "current_equation",
      "latest_result",
      "variables",
      "interpretation",
      "big_picture",
    ]));
    expect(result.live_answer_environment?.lines.find((line) => line.key === "latest_result")?.value).toBe("2, -2");
    expect(result.live_answer_environment?.lines.find((line) => line.key === "interpretation")?.value).toContain("Finding roots");
    expect(result.live_answer_environment?.latest_evaluation).toMatchObject({
      model_invoked: false,
      deterministic: true,
    });
  });

  it("updates physics stability tracker lines through the same source reducer", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:physics",
      objective: "Set up a live stability tracker for this equation and tell me when the residual stabilizes.",
      source_ids: ["source:physics-simulation"],
      preset: "physics_stability_tracker",
      now: "2026-05-08T16:00:00.000Z",
    });
    const payload = buildPhysicsStabilityTick({
      sample_index: 4,
      config: {
        expression: "expected + amplitude / (sample_index + decay)",
        variable_bindings: { expected: 1, amplitude: 0.08, decay: 3 },
        tolerance: 0.02,
        stable_window_size: 5,
        tick_rate_ms: 1000,
      },
    });

    const result = ingestWorkstationLiveSourceEvent({
      source_id: "source:physics-simulation",
      environment_id: environment.environment_id,
      kind: "physics_simulation",
      event_type: "simulation_sample",
      seq: 4,
      payload: payload as unknown as Record<string, unknown>,
      evidence_refs: ["physics:sample:4"],
    });

    expect(result.event.source_family).toBe("physics_simulation");
    expect(result.live_answer_environment_delta?.changed_line_keys).toEqual(expect.arrayContaining(["residual", "latest_result", "anomaly"]));
    expect(result.live_answer_environment?.lines.find((line) => line.key === "residual")?.value).not.toBe("unknown");
    expect(result.live_answer_environment?.lines.find((line) => line.key === "anomaly")?.value).toMatch(/anomaly/i);
  });
});
