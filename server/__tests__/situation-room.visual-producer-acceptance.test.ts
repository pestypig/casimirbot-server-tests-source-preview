import { beforeEach, describe, expect, it } from "vitest";
import {
  appendLiveSourceChunk,
  completeLiveSourceAnalysisJobsForChunk,
  queueLiveSourceAnalysisJob,
  resetLiveSourceChunkBufferForTest,
} from "../services/situation-room/live-source-chunk-buffer";
import {
  resetLiveSourceProducerBindingsForTest,
  setVisualProducerCadence,
} from "../services/situation-room/live-source-producer-binding";
import {
  listLiveSourceProducerLifecycleEvents,
  resetLiveSourceProducerLifecycleForTest,
} from "../services/situation-room/live-source-producer-lifecycle-store";
import { readLiveSourceProducerFreshness } from "../services/situation-room/live-source-producer-freshness";
import { calculateLivePipelineReadiness } from "../services/situation-room/live-pipeline-readiness";
import { runVisualCadenceAcceptance } from "../services/situation-room/visual-cadence-acceptance-runner";
import {
  recordVisualProducerSchedulerAdoption,
  resetVisualProducerSchedulerAdoptionsForTest,
} from "../services/situation-room/visual-producer-scheduler-adoption-store";
import {
  resetClientCapabilityActionsForTest,
} from "../services/client-capabilities/client-action-queue";
import {
  recordClientCapabilityAdoption,
  resetClientCapabilityAdoptionsForTest,
} from "../services/client-capabilities/client-adoption-store";

describe("visual producer cadence acceptance", () => {
  beforeEach(() => {
    resetLiveSourceChunkBufferForTest();
    resetLiveSourceProducerBindingsForTest();
    resetLiveSourceProducerLifecycleForTest();
    resetVisualProducerSchedulerAdoptionsForTest();
    resetClientCapabilityActionsForTest();
    resetClientCapabilityAdoptionsForTest();
  });

  it("moves waiting client freshness forward after scheduler adoption", () => {
    const cadence = setVisualProducerCadence({
      threadId: "helix-ask:desktop",
      sourceId: "visual_source:adopt",
      environmentId: "live_answer:adopt",
      cadenceMs: 10_000,
      captureMode: "interval",
      clientStreamConfirmed: false,
      status: "waiting_for_client",
    });

    const before = readLiveSourceProducerFreshness({
      producerId: cadence.producer.producer_id,
    });
    expect(before?.stale_reason).toBe("waiting_for_client_adoption");
    expect(before?.next_required_action).toBe("client_adopt_visual_producer");

    const adoption = recordVisualProducerSchedulerAdoption({
      producer_id: cadence.producer.producer_id,
      source_id: "visual_source:adopt",
      thread_id: "helix-ask:desktop",
      environment_id: "live_answer:adopt",
      cadence_ms: 10_000,
      capture_mode: "interval",
      client_stream_confirmed: true,
      interval_active: true,
      status: "adopted",
    });

    expect(adoption.status).toBe("adopted");
    const after = readLiveSourceProducerFreshness({
      producerId: cadence.producer.producer_id,
    });
    expect(after?.stale_reason).toBe("client_adopted_waiting_for_chunk");
    expect(after?.next_required_action).toBe("capture_frame_now");
  });

  it("records cadence lifecycle and reports stale when no chunks arrive", () => {
    const cadence = setVisualProducerCadence({
      threadId: "helix-ask:desktop",
      sourceId: "visual_source:test",
      pipelineId: "live_pipeline:test",
      cadenceMs: 10_000,
      captureMode: "interval",
      clientStreamConfirmed: true,
      status: "active",
    });
    recordClientCapabilityAdoption({
      action_request_id: "client_action:test",
      thread_id: "helix-ask:desktop",
      source_id: "visual_source:test",
      producer_id: cadence.producer.producer_id,
      ok: true,
      observed_state: {
        client_stream_confirmed: true,
        interval_active: true,
        track_ready_state: "live",
      },
    });

    const events = listLiveSourceProducerLifecycleEvents({
      producerId: cadence.producer.producer_id,
    });
    expect(events.map((event) => event.kind)).toContain("cadence_set");
    expect(events.map((event) => event.kind)).toContain("interval_started");

    const freshness = readLiveSourceProducerFreshness({
      producerId: cadence.producer.producer_id,
      now: new Date(Date.now() + 25_000).toISOString(),
    });
    expect(freshness?.is_fresh).toBe(false);
    expect(freshness?.stale_reason).toBe("client_adopted_waiting_for_chunk");
    expect(freshness?.next_required_action).toBe("capture_frame_now");
  });

  it("passes cadence acceptance with two visual chunks and analysis output", () => {
    const cadence = setVisualProducerCadence({
      threadId: "helix-ask:desktop",
      sourceId: "visual_source:test",
      pipelineId: "live_pipeline:test",
      cadenceMs: 10_000,
      captureMode: "interval",
      clientStreamConfirmed: true,
      status: "active",
    });
    recordClientCapabilityAdoption({
      action_request_id: "client_action:test-pass",
      thread_id: "helix-ask:desktop",
      source_id: "visual_source:test",
      producer_id: cadence.producer.producer_id,
      ok: true,
      observed_state: {
        client_stream_confirmed: true,
        interval_active: true,
        track_ready_state: "live",
      },
    });
    const first = appendLiveSourceChunk({
      source_id: "visual_source:test",
      thread_id: "helix-ask:desktop",
      modality: "visual_frame",
      ts: "2026-05-16T12:00:00.000Z",
      payload_ref: "visual_frame:first",
      evidence_refs: ["visual_frame:first"],
      capture_mode: "interval",
    });
    queueLiveSourceAnalysisJob({ chunk: first.chunk, analyzerId: "visual_analysis" });
    completeLiveSourceAnalysisJobsForChunk({
      chunkId: first.chunk.chunk_id,
      threadId: "helix-ask:desktop",
      status: "completed",
      outputRefs: ["visual_evidence:first"],
      summary: "First frame analyzed.",
    });
    const second = appendLiveSourceChunk({
      source_id: "visual_source:test",
      thread_id: "helix-ask:desktop",
      modality: "visual_frame",
      ts: "2026-05-16T12:00:10.000Z",
      payload_ref: "visual_frame:second",
      evidence_refs: ["visual_frame:second"],
      capture_mode: "interval",
    });
    queueLiveSourceAnalysisJob({ chunk: second.chunk, analyzerId: "visual_analysis" });
    completeLiveSourceAnalysisJobsForChunk({
      chunkId: second.chunk.chunk_id,
      threadId: "helix-ask:desktop",
      status: "completed",
      outputRefs: ["visual_evidence:second"],
      summary: "Second frame analyzed.",
    });

    const result = runVisualCadenceAcceptance({
      producerId: cadence.producer.producer_id,
    });
    expect(result?.ok).toBe(true);
    expect(result?.assistant_answer).toBe(false);
    expect(result?.checks.find((entry) => entry.name === "two_increasing_chunks")?.ok).toBe(true);
    expect(result?.checks.find((entry) => entry.name === "latest_job_has_output_or_failure")?.ok).toBe(true);
  });

  it("does not report pipeline ready when the required visual producer is stale", () => {
    const cadence = setVisualProducerCadence({
      threadId: "helix-ask:desktop",
      sourceId: "visual_source:stale-ready",
      pipelineId: "live_pipeline:stale-ready",
      cadenceMs: 10_000,
      captureMode: "interval",
      clientStreamConfirmed: true,
      status: "active",
    });
    recordClientCapabilityAdoption({
      action_request_id: "client_action:stale-ready",
      thread_id: "helix-ask:desktop",
      source_id: "visual_source:stale-ready",
      producer_id: cadence.producer.producer_id,
      ok: true,
      observed_state: {
        client_stream_confirmed: true,
        interval_active: true,
        track_ready_state: "live",
      },
    });
    const chunk = appendLiveSourceChunk({
      source_id: "visual_source:stale-ready",
      thread_id: "helix-ask:desktop",
      modality: "visual_frame",
      ts: "2026-05-16T12:00:00.000Z",
      payload_ref: "visual_frame:stale-ready",
      evidence_refs: ["visual_frame:stale-ready"],
      capture_mode: "interval",
    });
    const queued = queueLiveSourceAnalysisJob({ chunk: chunk.chunk, analyzerId: "visual_analysis" });
    completeLiveSourceAnalysisJobsForChunk({
      chunkId: chunk.chunk.chunk_id,
      threadId: "helix-ask:desktop",
      status: "completed",
      outputRefs: ["visual_evidence:stale-ready"],
      summary: "Stale frame analyzed.",
    });

    const readiness = calculateLivePipelineReadiness({
      plan: {
        schema: "helix.live_source_pipeline_plan.v1",
        plan_id: "live_source_pipeline_plan:stale-ready",
        thread_id: "helix-ask:desktop",
        objective: "Watch visual source.",
        environment_id: null,
        requested_modalities: ["visual_frame"],
        producers: [{
          source_id: "visual_source:stale-ready",
          modality: "visual_frame",
          capture_mode: "interval",
          cadence_ms: 10_000,
          permission_required: false,
        }],
        analyzers: [],
        live_card_schema: [],
        missing_capabilities: [],
        assistant_answer: false,
        raw_content_included: false,
      },
      receipt: {
        schema: "helix.live_source_pipeline_receipt.v1",
        receipt_id: "live_source_pipeline_receipt:stale-ready",
        pipeline_id: "live_pipeline:stale-ready",
        plan_id: "live_source_pipeline_plan:stale-ready",
        thread_id: "helix-ask:desktop",
        environment_id: null,
        status: "active",
        source_producer_ids: [cadence.producer.producer_id],
        analysis_job_ids: [queued.job_id],
        worker_lane_ids: [],
        missing_capabilities: [],
        next_repair_actions: [],
        ok: true,
        assistant_answer: false,
        raw_content_included: false,
        context_policy: "compact_context_pack_only",
      },
      producers: [cadence.producer],
      chunks: [chunk.chunk],
      analysisJobs: [{
        ...queued,
        status: "completed",
        output_refs: ["visual_evidence:stale-ready"],
        summary: "Stale frame analyzed.",
      }],
      repairActions: ["capture_frame_now"],
      missingCapabilities: [],
      now: "2026-05-16T12:00:25.000Z",
    });

    expect(readiness.state).toBe("stale");
    expect(readiness.score).toBeLessThan(0.8);
    expect(readiness.summary).toMatch(/stale/i);
  });
});
