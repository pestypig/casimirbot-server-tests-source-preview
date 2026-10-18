import { beforeEach, describe, expect, it } from "vitest";
import {
  completeStandbyQueueItem,
  enqueueStandbyQueueItem,
  listStandbyQueueItems,
  resetStandbyQueue,
} from "../services/situation-room/standby-queue";

describe("standby queue", () => {
  beforeEach(() => resetStandbyQueue());

  it("orders direct user work ahead of standby interpretation", () => {
    enqueueStandbyQueueItem({
      room_id: "room:minecraft",
      priority: "standby_interpretation",
      task_kind: "micro_narration",
      input_refs: ["signal:1"],
      created_at: "2026-05-06T10:00:00.000Z",
    });
    enqueueStandbyQueueItem({
      room_id: "room:minecraft",
      priority: "user_direct",
      task_kind: "context_compaction",
      input_refs: ["turn:ask"],
      created_at: "2026-05-06T10:00:01.000Z",
    });

    expect(listStandbyQueueItems("room:minecraft")[0].priority).toBe("user_direct");
  });

  it("records completed deterministic queue work", () => {
    const item = enqueueStandbyQueueItem({
      room_id: "room:minecraft",
      priority: "standby_interpretation",
      task_kind: "semantic_event",
      input_refs: ["signal:1"],
      created_at: "2026-05-06T10:00:00.000Z",
    });
    const completed = completeStandbyQueueItem(item.queue_item_id, "semantic:1", "2026-05-06T10:00:00.000Z");

    expect(completed).toMatchObject({
      status: "completed",
      result_ref: "semantic:1",
    });
  });
});
