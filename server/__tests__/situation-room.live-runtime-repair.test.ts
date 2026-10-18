import { beforeEach, describe, expect, it } from "vitest";
import { planLiveRuntimeRepair } from "../services/situation-room/live-runtime-repair-planner";
import { executeLiveRuntimeRepair } from "../services/situation-room/live-runtime-repair-executor";
import {
  appendLiveSourceChunk,
  listLiveSourceAnalysisJobs,
  queueLiveSourceAnalysisJob,
  resetLiveSourceChunkBufferForTest,
} from "../services/situation-room/live-source-chunk-buffer";
import {
  resetLiveSourceProducerBindingsForTest,
  setVisualProducerCadence,
} from "../services/situation-room/live-source-producer-binding";
import { resetLiveSourceProducerLifecycleForTest } from "../services/situation-room/live-source-producer-lifecycle-store";

describe("live runtime repair planner and executor", () => {
  beforeEach(() => {
    resetLiveSourceChunkBufferForTest();
    resetLiveSourceProducerBindingsForTest();
    resetLiveSourceProducerLifecycleForTest();
  });

  it("maps visual stale diagnostics to capture-frame repair without auto permission bypass", () => {
    const plan = planLiveRuntimeRepair({
      threadId: "helix-ask:desktop",
      producerId: "live_source_producer:test",
      freshness: {
        schema: "helix.live_source_producer_freshness.v1",
        producer_id: "live_source_producer:test",
        source_id: "visual_source:test",
        thread_id: "helix-ask:desktop",
        cadence_ms: 10_000,
        last_capture_at: null,
        last_chunk_id: null,
        last_analysis_job_id: null,
        last_visual_evidence_id: null,
        last_card_delta_at: null,
        is_fresh: false,
        stale_reason: "no_chunk_after_two_cadence_windows",
        next_required_action: "capture_frame_now",
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    expect(plan.problem_kind).toBe("visual_no_chunks");
    expect(plan.recommended_actions.find((action) => action.action_id === "capture_frame_now")?.requires_user_permission).toBe(true);
    const receipt = executeLiveRuntimeRepair({ plan, selectedActionId: "capture_frame_now" });
    expect(receipt.ok).toBe(false);
    expect(receipt.next_required_action).toBe("capture_frame_now");
    expect(receipt.assistant_answer).toBe(false);
  });

  it("maps pending analysis to safe run_due_analysis and records receipt", () => {
    setVisualProducerCadence({
      threadId: "helix-ask:desktop",
      sourceId: "visual_source:test",
      pipelineId: "live_pipeline:test",
      cadenceMs: 10_000,
      captureMode: "interval",
      clientStreamConfirmed: true,
      status: "active",
    });
    const chunk = appendLiveSourceChunk({
      source_id: "visual_source:test",
      thread_id: "helix-ask:desktop",
      modality: "visual_frame",
      payload_ref: "visual_frame:test",
      evidence_refs: ["visual_frame:test"],
      capture_mode: "interval",
    }).chunk;
    queueLiveSourceAnalysisJob({ chunk, analyzerId: "visual_analysis" });
    const plan = planLiveRuntimeRepair({
      threadId: "helix-ask:desktop",
      producerId: "visual_source:test",
      acceptance: {
        schema: "helix.visual_cadence_acceptance_result.v1",
        producer_id: "live_source_producer:test",
        ok: false,
        checks: [{ name: "latest_job_has_output_or_failure", ok: false, summary: "pending", related_ids: [] }],
        next_required_action: "run_due_analysis",
        assistant_answer: false,
      },
    });

    expect(plan.problem_kind).toBe("visual_analysis_pending");
    expect(plan.selected_action_id).toBe("run_due_analysis");
    const receipt = executeLiveRuntimeRepair({ plan });
    expect(receipt.selected_action_id).toBe("run_due_analysis");
    expect(receipt.assistant_answer).toBe(false);
    expect(listLiveSourceAnalysisJobs({ threadId: "helix-ask:desktop", sourceId: "visual_source:test", status: "any" }).at(-1)?.status).not.toBe("queued");
  });

  it("maps world no_thread_context to exact source thread attach", () => {
    const plan = planLiveRuntimeRepair({
      threadId: "helix-ask:desktop",
      worldBindingCheck: {
        ok: false,
        latest_append_reason: "no_thread_context",
        next_required_action: "attach_world_event_source",
        latest_source: {
          room_id: "room:minecraft",
          source_id: "source:plugin-a",
          world_id: "world:a",
        },
      },
    });

    expect(plan.problem_kind).toBe("world_event_no_thread_context");
    expect(plan.selected_action_id).toBe("attach_world_event_source_to_thread");
    const receipt = executeLiveRuntimeRepair({
      plan,
      worldBindingSource: {
        room_id: "room:minecraft",
        source_id: "source:plugin-a",
        world_id: "world:a",
      },
    });
    expect(receipt.ok).toBe(true);
    expect(receipt.tool_observation_refs[0]).toMatch(/^situation-binding:/);
  });
});
