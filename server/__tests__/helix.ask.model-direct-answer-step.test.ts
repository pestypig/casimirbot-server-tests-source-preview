import { describe, expect, it } from "vitest";

import {
  buildModelDirectAnswerRetryInstruction,
  isUnavailableModelDirectAnswerText,
  markModelDirectAnswerRetryObservation,
  shouldRetryModelDirectAnswerStep,
} from "../services/helix-ask/model-direct-answer-step";

describe("model direct answer step", () => {
  it("detects unavailable model direct answer drafts", () => {
    expect(isUnavailableModelDirectAnswerText("direct_answer_unavailable")).toBe(true);
    expect(isUnavailableModelDirectAnswerText("I could not produce a final answer for this turn.")).toBe(true);
    expect(isUnavailableModelDirectAnswerText("An electron is a negatively charged elementary particle.")).toBe(false);
  });

  it("allows exactly one retry for unavailable model.direct_answer output", () => {
    const payload = {
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "direct_answer_unavailable",
    };
    const agentStepDecision = {
      next_step: "answer",
      chosen_capability: "model.direct_answer",
    };

    expect(shouldRetryModelDirectAnswerStep({
      payload,
      agentStepDecision,
      draftText: "direct_answer_unavailable",
      retryCount: 0,
    })).toBe(true);

    expect(shouldRetryModelDirectAnswerStep({
      payload,
      agentStepDecision,
      draftText: "direct_answer_unavailable",
      retryCount: 1,
    })).toBe(false);
  });

  it("records a retry observation without creating assistant answer text", () => {
    const payload = markModelDirectAnswerRetryObservation({
      turnId: "turn:model-direct-retry",
      payload: { current_turn_artifact_ledger: [] },
      reason: "direct_answer_unavailable",
    });

    expect(payload.model_direct_answer_retry_count).toBe(1);
    expect(payload.current_turn_artifact_ledger).toEqual([
      expect.objectContaining({
        kind: "model_direct_answer_retry_observation",
        payload: expect.objectContaining({
          schema: "helix.model_direct_answer_retry_observation.v1",
          assistant_answer: false,
          raw_content_included: false,
        }),
      }),
    ]);
  });

  it("builds a retry instruction that preserves the original user goal", () => {
    const instruction = buildModelDirectAnswerRetryInstruction({
      promptText: "Can you tell me what an electron is in one paragraph?",
      reason: "direct_answer_unavailable",
    });

    expect(instruction).toMatch(/Retry once/i);
    expect(instruction).toMatch(/direct_answer_text/i);
    expect(instruction).toMatch(/electron/i);
  });
});
