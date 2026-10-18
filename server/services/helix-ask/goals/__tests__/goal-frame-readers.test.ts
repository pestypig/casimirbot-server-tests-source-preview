import { describe, expect, it } from "vitest";

import { isAskTurnVisualCaptureGoalKind } from "../goal-frame-readers";

describe("goal-frame readers", () => {
  it("keeps canonical and legacy visual-capture goal identities evidence-compatible", () => {
    expect(isAskTurnVisualCaptureGoalKind("visual_capture")).toBe(true);
    expect(isAskTurnVisualCaptureGoalKind("visual_capture_describe")).toBe(true);
    expect(isAskTurnVisualCaptureGoalKind("live_pipeline_control")).toBe(false);
    expect(isAskTurnVisualCaptureGoalKind(null)).toBe(false);
  });
});
