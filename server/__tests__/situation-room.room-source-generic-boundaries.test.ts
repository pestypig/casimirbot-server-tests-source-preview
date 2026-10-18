import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR,
} from "@shared/helix-room-source-ingress";
import {
  appendLiveSourceChunk,
  getLiveSourceProducer,
  listLiveSourceChunks,
  queueLiveSourceAnalysisJob,
  resetLiveSourceChunkBufferForTest,
  setLiveSourceProducerStatus,
  setLiveSourceRatePolicy,
  upsertLiveSourceProducer,
} from "../services/situation-room/live-source-chunk-buffer";
import {
  bindLiveSourceProducer,
  getLiveSourceProducerBinding,
  markVisualProducerHeartbeat,
  resetLiveSourceProducerBindingsForTest,
  setVisualProducerCadence,
} from "../services/situation-room/live-source-producer-binding";
import {
  recordLiveSourceProducerLifecycleEvent,
  resetLiveSourceProducerLifecycleForTest,
} from "../services/situation-room/live-source-producer-lifecycle-store";
import {
  ingestWorkstationLiveSourceEvent,
  listWorkstationLiveSources,
  resetWorkstationLiveSourceCounters,
  resetWorkstationLiveSources,
  setWorkstationLiveSourceStatus,
  setWorkstationLiveSourceTickRate,
  upsertWorkstationLiveSource,
} from "../services/situation-room/workstation-live-source-ingest";
import {
  recordSituationSourceHeartbeat,
  registerSituationSourceCapability,
  resetSituationSourceCapabilitiesForTest,
  updateSituationSourceCapability,
} from "../services/situation-room/situation-source-capability-store";
import {
  getLatestLiveSourceDescriptorForSource,
  listLiveSourceDescriptors,
  resetLiveSourceDescriptorsForTest,
  upsertLiveSourceDescriptor,
} from "../services/situation-room/live-source-descriptor-builder";
import {
  createLiveWorkstationPipeline,
  listLiveWorkstationPipelinesForSource,
  resetLiveWorkstationPipelines,
} from "../services/situation-room/live-workstation-pipeline-store";
import {
  alignVisualFrameWithEvents,
  analyzeVisualFrame,
  getVisualSnapshotSource,
  recordVisualFrame,
  resetVisualSnapshotStoreForTest,
  setVisualSnapshotSourceStatus,
  startVisualSnapshotSource,
  touchVisualSnapshotSource,
  updateVisualSnapshotSource,
} from "../services/situation-room/visual-snapshot-store";
import {
  getVisualProducerSchedulerAdoption,
  recordVisualProducerSchedulerAdoption,
  resetVisualProducerSchedulerAdoptionsForTest,
} from "../services/situation-room/visual-producer-scheduler-adoption-store";
import {
  getLatestLiveSourceIdentity,
  resetLiveSourceIdentitiesForTest,
  upsertLiveSourceIdentityFromChunk,
} from "../services/situation-room/live-source-identity-store";
import {
  createSituationThreadBinding,
  resetSituationThreadBindings,
  resolveSituationThreadBinding,
} from "../services/situation-room/thread-binding-store";
import {
  resolveWorldEventThreadBinding,
} from "../services/situation-room/thread-binding-resolver";

const protectedSourceId = "source:room-ingress:binding-guard-test";

const protectedChunk = {
  source_id: protectedSourceId,
  thread_id: "thread:guard",
  modality: "visual_frame",
  evidence_refs: [],
  sequence_index: 1,
  source_epoch: 1,
} as never;

describe("room-ingress namespace generic Situation boundaries", () => {
  beforeEach(() => {
    resetLiveSourceChunkBufferForTest();
    resetLiveSourceProducerBindingsForTest();
    resetLiveSourceProducerLifecycleForTest();
    resetWorkstationLiveSources();
    resetSituationSourceCapabilitiesForTest();
    resetLiveSourceDescriptorsForTest();
    resetLiveWorkstationPipelines();
    resetVisualSnapshotStoreForTest();
    resetVisualProducerSchedulerAdoptionsForTest();
    resetLiveSourceIdentitiesForTest();
    resetSituationThreadBindings();
  });

  it("rejects protected source writes across every generic live-source family", () => {
    const writes: Array<() => unknown> = [
      () => upsertLiveSourceProducer({
        sourceId: protectedSourceId,
        threadId: "thread:guard",
        modality: "visual_frame",
      }),
      () => appendLiveSourceChunk({
        source_id: protectedSourceId,
        thread_id: "thread:guard",
        modality: "visual_frame",
      }),
      () => setLiveSourceRatePolicy({ source_id: protectedSourceId }),
      () => setLiveSourceProducerStatus({
        sourceId: protectedSourceId,
        status: "paused",
      }),
      () => queueLiveSourceAnalysisJob({ chunk: protectedChunk }),
      () => upsertWorkstationLiveSource({
        source_id: protectedSourceId,
        kind: "visual_frame",
      }),
      () => ingestWorkstationLiveSourceEvent({
        source_id: protectedSourceId,
        kind: "visual_frame",
        event_type: "frame",
      }),
      () => setWorkstationLiveSourceStatus({
        source_id: protectedSourceId,
        status: "paused",
      }),
      () => setWorkstationLiveSourceTickRate({
        source_id: protectedSourceId,
        tick_rate_ms: 1_000,
      }),
      () => resetWorkstationLiveSourceCounters({
        source_id: protectedSourceId,
      }),
      () => bindLiveSourceProducer({
        sourceId: protectedSourceId,
        threadId: "thread:guard",
      }),
      () => setVisualProducerCadence({
        sourceId: protectedSourceId,
        threadId: "thread:guard",
      }),
      () => markVisualProducerHeartbeat({
        sourceId: protectedSourceId,
        threadId: "thread:guard",
      }),
      () => recordLiveSourceProducerLifecycleEvent({
        producerId: "producer:guard",
        sourceId: protectedSourceId,
        threadId: "thread:guard",
        kind: "producer_created",
        summary: "must reject",
      }),
      () => registerSituationSourceCapability({
        source_id: protectedSourceId,
      }),
      () => updateSituationSourceCapability({
        source_id: protectedSourceId,
      }),
      () => recordSituationSourceHeartbeat({
        source_id: protectedSourceId,
      }),
      () => upsertLiveSourceDescriptor({
        source_id: protectedSourceId,
      }),
      () => createLiveWorkstationPipeline({
        thread_id: "thread:guard",
        objective: "must reject",
        source_ids: ["source:normal", protectedSourceId],
        plan: {} as never,
      }),
      () => startVisualSnapshotSource({
        source_id: protectedSourceId,
      }),
      () => setVisualSnapshotSourceStatus({
        sourceId: protectedSourceId,
        status: "paused",
      }),
      () => touchVisualSnapshotSource({
        sourceId: protectedSourceId,
      }),
      () => updateVisualSnapshotSource({
        source_id: protectedSourceId,
      }),
      () => recordVisualFrame({
        source_id: protectedSourceId,
      }),
      () => analyzeVisualFrame({
        source_id: protectedSourceId,
      }),
      () => alignVisualFrameWithEvents({
        source_id: protectedSourceId,
      }),
      () => recordVisualProducerSchedulerAdoption({
        source_id: protectedSourceId,
      }),
      () => upsertLiveSourceIdentityFromChunk({
        chunk: protectedChunk,
      }),
    ];

    for (const write of writes) {
      expect(write).toThrow(HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR);
    }
  });

  it("hides protected reads and stale records without inheriting a room fallback", () => {
    expect(getLiveSourceProducer(protectedSourceId)).toBeNull();
    expect(listLiveSourceChunks({ sourceId: protectedSourceId })).toEqual([]);
    expect(getLiveSourceProducerBinding(protectedSourceId)).toBeNull();
    expect(getLatestLiveSourceDescriptorForSource(protectedSourceId)).toBeNull();
    expect(listLiveSourceDescriptors({ sourceId: protectedSourceId })).toEqual([]);
    expect(listLiveWorkstationPipelinesForSource(protectedSourceId)).toEqual([]);
    expect(getVisualSnapshotSource(protectedSourceId)).toBeNull();
    expect(getVisualProducerSchedulerAdoption(protectedSourceId)).toBeNull();
    expect(getLatestLiveSourceIdentity({
      threadId: "thread:guard",
      sourceId: protectedSourceId,
    })).toBeNull();

    const descriptor = upsertLiveSourceDescriptor({
      source_id: "source:ordinary",
      thread_id: "thread:guard",
    });
    descriptor.source_id = protectedSourceId;
    expect(getLatestLiveSourceDescriptorForSource("source:ordinary")).toBeNull();
    expect(listLiveSourceDescriptors()).toEqual([]);

    createSituationThreadBinding({
      room_id: "room:guard",
      thread_id: "thread:ordinary",
    });
    expect(resolveSituationThreadBinding({
      room_id: "room:guard",
      source_id: protectedSourceId,
    })).toBeNull();
    expect(resolveWorldEventThreadBinding({
      room_id: "room:guard",
      source_id: protectedSourceId,
    })).toMatchObject({
      binding: null,
      reason: "binding_mismatch",
      mismatched_bindings: [],
      diagnostic: {
        detected_source_count: 0,
        active_binding_count: 0,
      },
    });
  });

  it("returns the same typed 403 for nested source fields and encoded source paths", async () => {
    const { planRouter } = await import("../routes/agi.plan");
    const app = express();
    app.use(express.json());
    app.use("/api/agi", planRouter);

    const nested = await request(app)
      .post("/api/agi/situation/live-source/descriptor")
      .send({
        source_id: "source:ordinary",
        serving_context: {
          active_visual_source_id: protectedSourceId,
        },
      })
      .expect(403);
    expect(nested.body).toMatchObject({
      ok: false,
      error: HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
    });

    const encodedSourceId = encodeURIComponent(protectedSourceId);
    const path = await request(app)
      .post(`/api/agi/situation/live-source/${encodedSourceId}/pause`)
      .send({})
      .expect(403);
    expect(path.body?.error).toBe(HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR);

    await request(app)
      .post("/api/agi/situation/live-source/descriptor")
      .send({
        source_id: "source:ordinary",
        user_label: `quoted text ${protectedSourceId}`,
      })
      .expect(200);
  }, 60_000);
});
