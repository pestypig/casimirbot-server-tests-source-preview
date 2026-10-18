import { beforeEach, describe, expect, it } from "vitest";
import {
  claimNextStandbyWorkItem,
  enqueueStandbyWorkItem,
  getStandbyQueueMetrics,
  listStandbyWorkItems,
  resetStandbyCognitionQueue,
} from "../services/situation-room/standby-cognition-queue";

describe("standby cognition queue", () => {
  beforeEach(() => resetStandbyCognitionQueue());

  it("lets user direct work preempt standby interpretation", () => {
    enqueueStandbyWorkItem({
      priority: "standby_interpretation",
      kind: "episode_narration",
      room_id: "room:minecraft",
      evidence_refs: ["episode:1"],
      now: "2026-05-07T12:00:00.000Z",
    });
    enqueueStandbyWorkItem({
      priority: "user_direct",
      kind: "user_request_context_refresh",
      room_id: "room:minecraft",
      evidence_refs: ["user:ask"],
      now: "2026-05-07T12:00:01.000Z",
    });

    const next = claimNextStandbyWorkItem("2026-05-07T12:00:02.000Z");
    expect(next).toMatchObject({
      schema: "helix.standby_work_item.v1",
      priority: "user_direct",
      status: "running",
    });
    expect(listStandbyWorkItems({ status: "dropped" })[0]).toMatchObject({
      priority: "standby_interpretation",
      dropped_reason: "preempted_by_user_direct",
    });
    expect(getStandbyQueueMetrics()).toMatchObject({
      dropped_count: 1,
    });
  });
});
