import { describe, expect, it, beforeEach } from "vitest";
import { isStagePlayRawSessionBufferEntryV1 } from "../../shared/stage-play-raw-session-buffer";
import {
  clearStagePlayRawSessionBuffer,
  listStagePlayRawSessionBufferEntries,
  recordStagePlayRawSessionBufferEntry,
  resetStagePlayRawSessionBufferForTest,
  stagePlayRawSessionId,
} from "../services/stage-play/stage-play-raw-session-buffer-store";

beforeEach(() => {
  resetStagePlayRawSessionBufferForTest();
});

describe("Stage Play raw session buffer store", () => {
  it("records session-scoped audit entries without assistant authority", () => {
    const entry = recordStagePlayRawSessionBufferEntry({
      threadId: "thread:stage-play-buffer",
      roomId: "room:stage",
      sourceId: "source:audio",
      modality: "audio_transcript",
      sourceEventId: "event:transcript:1",
      fromTs: "2026-06-02T12:00:00.000Z",
      toTs: "2026-06-02T12:00:10.000Z",
      rawKind: "transcript",
      rawRef: "event:transcript:1",
      rawTextPreview: "The ship is changing course toward the corridor.",
      evidenceRefs: ["live_source_chunk:1"],
      now: "2026-06-02T12:00:10.000Z",
    });

    expect(entry).not.toBeNull();
    expect(isStagePlayRawSessionBufferEntryV1(entry)).toBe(true);
    expect(entry).toMatchObject({
      schema: "stage_play_raw_session_buffer_entry/v1",
      sessionId: stagePlayRawSessionId({ threadId: "thread:stage-play-buffer", roomId: "room:stage" }),
      assistant_answer: false,
      context_role: "audit_buffer_not_graph",
      retention: {
        policy: "session_ttl",
        ttlMs: 3600000,
      },
    });
    expect(listStagePlayRawSessionBufferEntries({
      threadId: "thread:stage-play-buffer",
      now: new Date("2026-06-02T12:00:11.000Z"),
    })).toEqual([entry]);
  });

  it("expires ttl entries and clears manual entries by scope", () => {
    recordStagePlayRawSessionBufferEntry({
      threadId: "thread:stage-play-buffer",
      roomId: "room:stage",
      sourceId: "source:visual",
      modality: "visual_frame",
      rawKind: "frame_ref",
      rawRef: "visual_frame:1",
      ttlMs: 1000,
      now: "2026-06-02T12:00:00.000Z",
    });
    const manual = recordStagePlayRawSessionBufferEntry({
      threadId: "thread:stage-play-buffer",
      roomId: "room:stage",
      sourceId: "source:visual",
      modality: "visual_frame",
      rawKind: "frame_ref",
      rawRef: "visual_frame:2",
      retentionPolicy: "manual_clear",
      now: "2026-06-02T12:00:00.000Z",
    });

    expect(listStagePlayRawSessionBufferEntries({
      threadId: "thread:stage-play-buffer",
      now: new Date("2026-06-02T12:00:02.000Z"),
    })).toEqual([manual]);

    const cleared = clearStagePlayRawSessionBuffer({
      threadId: "thread:stage-play-buffer",
      sourceId: "source:visual",
    });
    expect(cleared.clearedCount).toBe(1);
    expect(listStagePlayRawSessionBufferEntries({ threadId: "thread:stage-play-buffer" })).toEqual([]);
  });
});
