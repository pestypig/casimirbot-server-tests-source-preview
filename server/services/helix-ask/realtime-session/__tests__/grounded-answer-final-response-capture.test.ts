import { describe, expect, it } from "vitest";
import { createRealtimeGroundedFinalResponseCapture } from "../grounded-answer-final-response-capture";

describe("Realtime grounded final-response capture", () => {
  it("uses the structured non-streaming terminal payload without buffering its debug projection", () => {
    const capture = createRealtimeGroundedFinalResponseCapture({
      streaming: false,
      maxCaptureBytes: 32,
    });
    const payload = {
      response_type: "final_answer",
      answer: "Grounded answer",
      debug: {
        repeated_observations: "x".repeat(10_000),
      },
    };

    capture.capturePayload(payload);
    capture.capture(JSON.stringify(payload));

    expect(capture.finish()).toEqual({
      payload,
      failureCode: null,
      capturedBytes: 0,
    });
  });

  it("still fails closed when an unstructured response exceeds the capture bound", () => {
    const capture = createRealtimeGroundedFinalResponseCapture({
      streaming: false,
      maxCaptureBytes: 32,
    });

    capture.capture("x".repeat(33));

    expect(capture.finish()).toEqual({
      payload: null,
      failureCode: "realtime_feedback_turn_final_payload_too_large",
      capturedBytes: 0,
    });
  });
});
