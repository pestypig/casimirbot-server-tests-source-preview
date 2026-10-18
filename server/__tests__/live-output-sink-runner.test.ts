import { beforeEach, describe, expect, it } from "vitest";
import { createLiveAnswerEnvironment, getLiveAnswerEnvironment, resetLiveAnswerEnvironments } from "../services/situation-room/live-answer-environment-store";
import { planLiveWorkstationPipeline } from "../services/helix-ask/live-workstation-pipeline-planner";
import { createLiveWorkstationPipeline, resetLiveWorkstationPipelines } from "../services/situation-room/live-workstation-pipeline-store";
import { resetLiveTransformRunnerState, runLiveTransformsForSourceEvent } from "../services/situation-room/live-transform-runner";
import { runLiveOutputSinks } from "../services/situation-room/live-output-sink-runner";
import type { WorkstationLiveSourceEvent } from "@shared/helix-workstation-live-source";

describe("live output sink runner", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetLiveWorkstationPipelines();
    resetLiveTransformRunnerState();
  });

  it("updates live environment lines and emits note sink receipts", () => {
    const sourceId = "source:browser-tab-transcript";
    const plan = planLiveWorkstationPipeline({
      prompt: "Summarize each sentence from this live browser tab into a note.",
      sourceIds: [sourceId],
    });
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:test",
      objective: plan.objective,
      source_ids: [sourceId],
      preset: "custom",
      line_schema: plan.line_schema,
    });
    const planWithEnv = {
      ...plan,
      sinks: plan.sinks.map((sink) => sink.kind === "live_answer_environment" ? { ...sink, target_id: environment.environment_id } : sink),
    };
    const { pipeline } = createLiveWorkstationPipeline({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:test",
      objective: plan.objective,
      source_ids: [sourceId],
      environment_id: environment.environment_id,
      plan: planWithEnv,
    });
    const event: WorkstationLiveSourceEvent = {
      schema: "helix.workstation_live_source_event.v1",
      event_id: "evt:note",
      source_id: sourceId,
      environment_id: environment.environment_id,
      thread_id: "helix-ask:test",
      seq: 1,
      tick_index: 1,
      ts: "2026-05-10T12:00:00.000Z",
      kind: "browser_audio_transcript",
      source_family: "browser_audio",
      event_type: "transcript_sentence",
      payload: { text: "This source sentence should become a compact note summary." },
      evidence_refs: ["evt:note"],
      deterministic: true,
    };

    const results = runLiveTransformsForSourceEvent({ pipeline, event });
    const receipts = runLiveOutputSinks({ pipeline, results, now: event.ts });

    expect(receipts.map((receipt) => receipt.kind)).toEqual(expect.arrayContaining(["workstation_note", "live_answer_environment"]));
    expect(receipts.every((receipt) => receipt.schema === "helix.live_output_sink_receipt.v1")).toBe(true);
    expect(receipts.every((receipt) => receipt.ok)).toBe(true);
    expect(JSON.stringify(receipts)).not.toContain("assistant_text");
  });

  it("updates a derived prime gap live environment from canonical prime stream ticks", () => {
    const sourceId = "source:calculator-prime-stream";
    const plan = planLiveWorkstationPipeline({
      prompt: "Create a live output from the prime stream that tracks prime gaps.",
    });
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:prime-gap",
      objective: plan.objective,
      source_ids: [sourceId],
      preset: "custom",
      line_schema: plan.line_schema,
    });
    const planWithEnv = {
      ...plan,
      sinks: plan.sinks.map((sink) => sink.kind === "live_answer_environment" ? { ...sink, target_id: environment.environment_id } : sink),
    };
    const { pipeline } = createLiveWorkstationPipeline({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:prime-gap",
      objective: plan.objective,
      source_ids: [sourceId],
      environment_id: environment.environment_id,
      plan: planWithEnv,
    });
    const tick = (seq: number, candidate: number, latestPrime: number, gap: number): WorkstationLiveSourceEvent => ({
      schema: "helix.workstation_live_source_event.v1",
      event_id: `evt:prime:${candidate}`,
      source_id: sourceId,
      environment_id: environment.environment_id,
      thread_id: "helix-ask:test",
      seq,
      tick_index: seq,
      ts: `2026-05-10T12:00:0${seq}.000Z`,
      kind: "calculator_series",
      source_family: "calculator_stream",
      event_type: "prime_found",
      payload: {
        candidate,
        is_prime: true,
        latest_prime: latestPrime,
        prime_count: seq,
        gap,
        next_candidate: candidate + 1,
        algorithm: "trial_division",
      },
      evidence_refs: [`calculator:prime:${candidate}`],
      deterministic: true,
    });
    const nonPrimeTick = (seq: number, candidate: number, latestPrime: number): WorkstationLiveSourceEvent => ({
      schema: "helix.workstation_live_source_event.v1",
      event_id: `evt:prime:${candidate}`,
      source_id: sourceId,
      environment_id: environment.environment_id,
      thread_id: "helix-ask:test",
      seq,
      tick_index: seq,
      ts: `2026-05-10T12:00:0${seq}.000Z`,
      kind: "calculator_series",
      source_family: "calculator_stream",
      event_type: "prime_candidate_checked",
      payload: {
        candidate,
        is_prime: false,
        latest_prime: latestPrime,
        prime_count: seq,
        next_candidate: candidate + 1,
        algorithm: "trial_division",
      },
      evidence_refs: [`calculator:prime:${candidate}`],
      deterministic: true,
    });

    for (const event of [
      tick(1, 2, 2, 0),
      tick(2, 3, 3, 1),
      tick(3, 5, 5, 2),
      nonPrimeTick(4, 6, 5),
      nonPrimeTick(5, 10, 5),
      tick(6, 11, 11, 6),
      nonPrimeTick(7, 12, 11),
    ]) {
      const results = runLiveTransformsForSourceEvent({ pipeline, event, now: event.ts });
      const receipts = runLiveOutputSinks({ pipeline, results, now: event.ts });
      expect(receipts.some((receipt) => receipt.kind === "live_answer_environment" && receipt.ok)).toBe(true);
    }

    const updated = getLiveAnswerEnvironment(environment.environment_id);
    expect(updated?.lines_by_key?.latest_prime?.value).toBe("11");
    expect(updated?.lines_by_key?.previous_prime?.value).toBe("5");
    expect(updated?.lines_by_key?.gap?.value).toBe("6");
    expect(updated?.lines_by_key?.largest_gap?.value).toBe("6");
    expect(updated?.latest_evaluation?.model_invoked).toBe(false);
    expect(JSON.stringify(updated)).not.toContain("assistant_text");
  });
});
