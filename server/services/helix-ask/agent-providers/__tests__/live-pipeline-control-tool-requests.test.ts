import { describe, expect, it } from "vitest";
import {
  buildPromptDerivedLivePipelineControlGatewayCallRequests,
  LIVE_PIPELINE_SET_RATE_CAPABILITY,
} from "../live-pipeline-control-tool-requests";

describe("live pipeline control tool requests", () => {
  it("turns an admitted cadence command into one exact gateway request", () => {
    const requests =
      buildPromptDerivedLivePipelineControlGatewayCallRequests({
        question: "Set the visual capture interval to 10 seconds.",
        source_target_intent: {
          target_source: "live_pipeline",
          target_kind: "live_pipeline",
          strength: "hard",
        },
      });

    expect(requests).toEqual([
      expect.objectContaining({
        capability_id: LIVE_PIPELINE_SET_RATE_CAPABILITY,
        mode: "act",
        arguments: expect.objectContaining({
          cadence_ms: 10_000,
          capture_mode: "interval",
          source_target_intent: expect.objectContaining({
            target_source: "live_pipeline",
            selected_capability: LIVE_PIPELINE_SET_RATE_CAPABILITY,
          }),
        }),
      }),
    ]);
  });

  it.each([
    "Do not set the visual capture interval to 10 seconds.",
    "I might set the visual capture interval to 10 seconds later.",
    "Previously I set the visual capture interval to 10 seconds.",
    'The screen says "Set the visual capture interval to 10 seconds."',
    "What would happen if I set the visual capture interval to 10 seconds?",
  ])("does not execute contextual cadence wording: %s", (question) => {
    expect(
      buildPromptDerivedLivePipelineControlGatewayCallRequests({ question }),
    ).toEqual([]);
  });
});
