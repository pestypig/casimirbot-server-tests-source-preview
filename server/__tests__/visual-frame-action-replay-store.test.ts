import { describe, expect, it, beforeEach } from "vitest";
import {
  listPendingVisualFrameActionReplayRequests,
  recordVisualFrameActionReplayResult,
  requestVisualFrameActionReplay,
  resetVisualFrameActionReplayStoreForTest,
} from "../services/situation-room/visual-frame-action-replay-store";

describe("visual frame action replay store", () => {
  beforeEach(() => {
    resetVisualFrameActionReplayStoreForTest();
  });

  it("creates compact client-mediated replay requests without raw frame content", () => {
    const request = requestVisualFrameActionReplay({
      thread_id: "thread:visual",
      source_id: "visual_source:test",
      frame_history_ids: ["history:1"],
      shade_profile_ids: ["stage_play_visual_observer_profile:solar-sdo-aia-193:v1"],
      max_frames: 4,
      image_data_url: "data:image/jpeg;base64,SHOULD_NOT_PERSIST",
    });

    expect(request.status).toBe("pending_client_frames");
    expect(request.raw_content_included).toBe(false);
    expect(JSON.stringify(request)).not.toContain("SHOULD_NOT_PERSIST");
    expect(listPendingVisualFrameActionReplayRequests({ threadId: "thread:visual" })).toHaveLength(1);
  });

  it("records compact replay results and completes the request", () => {
    const request = requestVisualFrameActionReplay({
      thread_id: "thread:visual",
      source_id: "visual_source:test",
      frame_history_ids: ["history:1"],
      shade_profile_ids: ["profile:science"],
    });
    const recorded = recordVisualFrameActionReplayResult({
      replay_request_id: request.replay_request_id,
      thread_id: "thread:visual",
      source_id: "visual_source:test",
      source_frame_history_id: "history:1",
      replay_frame_id: "visual_frame:replay",
      evidence_id: "visual_evidence:replay",
      shade_profile_id: "profile:science",
      summary: "Replayed frame through selected science shade.",
      status: "completed",
      image_base64: "SHOULD_NOT_PERSIST",
    });

    expect(recorded.request?.status).toBe("completed");
    expect(recorded.result.assistant_answer).toBe(false);
    expect(recorded.result.terminal_eligible).toBe(false);
    expect(recorded.result.raw_content_included).toBe(false);
    expect(JSON.stringify(recorded)).not.toContain("SHOULD_NOT_PERSIST");
  });
});
