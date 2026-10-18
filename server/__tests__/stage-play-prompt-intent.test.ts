import { describe, expect, it } from "vitest";

import {
  isStagePlayCheckpointRequestPrompt,
  isStagePlayJobPlanningPrompt,
  isStagePlayReflectionPrompt,
} from "../services/helix-ask/stage-play-prompt-intent";

describe("Stage Play prompt intent", () => {
  it("keeps visible checkpoint handoff prompts on reflection instead of queue setup", () => {
    const prompt = [
      "Use the Stage Play reflection capability live_env.reflect_stage_play_context.",
      "Reflect the active Stage Play Badge Graph and project the current Live Interpretation.",
      "Stage Play checkpoint handle: stage_play_checkpoint_request:ui.",
      "Stage Play graph handle: stage_play_badge_graph:ui.",
      "Stage Play evidence handles: live_source_observation:ui.",
      "Checkpoint focus: A meaningful Stage Play perturbation occurred; what current answer snapshot should Helix Ask summarize?",
      "Report checkpoint freshness, missing evidence, and whether a current model-reviewed Answer Snapshot exists after the reflection.",
      "Leave visual/audio capture cadence unchanged.",
    ].join("\n");

    expect(isStagePlayReflectionPrompt(prompt)).toBe(true);
    expect(isStagePlayCheckpointRequestPrompt(prompt)).toBe(false);
    expect(isStagePlayJobPlanningPrompt(prompt)).toBe(false);
  });
});
