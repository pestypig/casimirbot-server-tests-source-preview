import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixLiveSourceAnalysisJob } from "@shared/helix-live-source-analysis-job";
import type { HelixLiveSourceChunk } from "@shared/helix-live-source-chunk";

import { planRouter } from "../routes/agi.plan";
import {
  getLatestLiveSourceDescriptorForSource,
  resetLiveSourceDescriptorsForTest,
  upsertLiveSourceDescriptor,
} from "../services/situation-room/live-source-descriptor-builder";
import { routeLiveSourceAnalysisOutput } from "../services/situation-room/live-source-analysis-output-router";
import {
  getLatestLiveSourceIdentity,
  resetLiveSourceIdentitiesForTest,
} from "../services/situation-room/live-source-identity-store";
import { resetLiveSourceProducerBindingsForTest } from "../services/situation-room/live-source-producer-binding";
import { resetLiveSourceProducerLifecycleForTest } from "../services/situation-room/live-source-producer-lifecycle-store";
import { resetVisualProducerSchedulerAdoptionsForTest } from "../services/situation-room/visual-producer-scheduler-adoption-store";

const app = express();
app.use(express.json());
app.use("/api/agi", planRouter);

describe("camera live source descriptor", () => {
  beforeEach(() => {
    resetLiveSourceDescriptorsForTest();
    resetLiveSourceIdentitiesForTest();
    resetLiveSourceProducerBindingsForTest();
    resetLiveSourceProducerLifecycleForTest();
    resetVisualProducerSchedulerAdoptionsForTest();
  });

  it("preserves getUserMedia origin and infers the camera surface", () => {
    const descriptor = upsertLiveSourceDescriptor({
      source_id: "visual_source:device-camera",
      thread_id: "helix-ask:desktop",
      modality: "visual_frame",
      serving_context: {
        source_origin: "browser_getUserMedia",
      },
      current_state: "active_interval",
    });

    expect(descriptor.serving_context).toMatchObject({
      source_origin: "browser_getUserMedia",
      surface: "camera",
    });
    expect(descriptor.raw_content_included).toBe(false);
    expect(descriptor.assistant_answer).toBe(false);
  });

  it("keeps camera provenance through cadence, heartbeat, and scheduler adoption routes", async () => {
    const sourceId = "visual_source:device-camera-route";
    const cameraProvenance = {
      source_origin: "browser_getUserMedia",
      surface: "camera",
    };

    const cadenceResponse = await request(app)
      .post("/api/agi/situation/live-source/producer/set-cadence")
      .send({
        thread_id: "helix-ask:desktop",
        source_id: sourceId,
        cadence_ms: 10_000,
        capture_mode: "interval",
        client_stream_confirmed: true,
        ...cameraProvenance,
      })
      .expect(200);

    expect(cadenceResponse.body.source_descriptor.serving_context).toMatchObject({
      source_origin: "browser_getUserMedia",
      surface: "camera",
    });

    const producerId = cadenceResponse.body.receipt.cadence.producer_id as string;
    const heartbeatResponse = await request(app)
      .post("/api/agi/situation/live-source/producer/heartbeat")
      .send({
        thread_id: "helix-ask:desktop",
        source_id: sourceId,
        producer_id: producerId,
        client_stream_confirmed: true,
        status: "active",
        ...cameraProvenance,
      })
      .expect(200);

    expect(heartbeatResponse.body.source_descriptor.serving_context).toMatchObject({
      source_origin: "browser_getUserMedia",
      surface: "camera",
    });

    await request(app)
      .post("/api/agi/situation/live-source/producer/adopt")
      .send({
        producer_id: producerId,
        thread_id: "helix-ask:desktop",
        source_id: sourceId,
        cadence_ms: 10_000,
        capture_mode: "interval",
        client_stream_confirmed: true,
        interval_active: true,
        status: "adopted",
        ...cameraProvenance,
      })
      .expect(200);

    const descriptorsResponse = await request(app)
      .get("/api/agi/situation/live-source/descriptors")
      .query({
        thread_id: "helix-ask:desktop",
        source_id: sourceId,
      })
      .expect(200);

    expect(descriptorsResponse.body.descriptors).toHaveLength(1);
    expect(descriptorsResponse.body.descriptors[0]).toMatchObject({
      source_id: sourceId,
      current_state: "active_interval",
      serving_context: {
        source_origin: "browser_getUserMedia",
        surface: "camera",
      },
      raw_content_included: false,
      assistant_answer: false,
    });
  }, 30_000);

  it("does not clobber camera provenance during analysis or sparse client adoption", async () => {
    const sourceId = "visual_source:camera-analysis";
    const threadId = "helix-ask:desktop";
    upsertLiveSourceDescriptor({
      source_id: sourceId,
      thread_id: threadId,
      modality: "visual_frame",
      source_origin: "browser_getUserMedia",
      surface: "camera",
      current_state: "active_interval",
    });
    const chunk: HelixLiveSourceChunk = {
      schema: "helix.live_source_chunk.v1",
      chunk_id: "live_source_chunk:camera-analysis",
      source_id: sourceId,
      thread_id: threadId,
      environment_id: null,
      modality: "visual_frame",
      sequence_index: 1,
      ts: "2026-07-17T12:00:00.000Z",
      compact_summary: "A camera frame was analyzed.",
      payload_ref: "visual_frame:camera-analysis",
      evidence_refs: [],
      raw_content_included: false,
      assistant_answer: false,
      context_policy: "compact_context_pack_only",
    };
    const job: HelixLiveSourceAnalysisJob = {
      schema: "helix.live_source_analysis_job.v1",
      job_id: "live_source_analysis_job:camera-analysis",
      chunk_id: chunk.chunk_id,
      worker_id: "worker:camera-analysis",
      thread_id: threadId,
      source_id: sourceId,
      analyzer_id: "visual_frame_analyzer",
      status: "completed",
      output_refs: ["visual_evidence:camera-analysis"],
      summary: "A camera frame was analyzed.",
      assistant_answer: false,
      raw_content_included: false,
    };

    routeLiveSourceAnalysisOutput({
      job,
      chunk,
      status: "completed",
      summary: "A camera frame was analyzed.",
      outputRefs: job.output_refs,
      modelInvoked: true,
    });
    expect(getLatestLiveSourceDescriptorForSource(sourceId)?.serving_context).toMatchObject({
      source_origin: "browser_getUserMedia",
      surface: "camera",
    });
    expect(getLatestLiveSourceIdentity({ threadId, sourceId })).toMatchObject({
      source_origin: "browser_getUserMedia",
      source_surface: "camera",
      assistant_answer: false,
      raw_content_included: false,
    });

    const actionResponse = await request(app)
      .post("/api/agi/client-action/request")
      .send({
        thread_id: threadId,
        capability: "visual_capture",
        action: "adopt_producer",
        requires_user_gesture: false,
        args: {
          source_id: sourceId,
          producer_id: "visual_producer:camera-analysis",
          modality: "visual_frame",
          capture_mode: "interval",
          cadence_ms: 10_000,
        },
      })
      .expect(200);
    const actionRequestId = actionResponse.body.action.action_request_id as string;
    await request(app)
      .post(`/api/agi/client-action/${encodeURIComponent(actionRequestId)}/adopt`)
      .send({
        thread_id: threadId,
        source_id: sourceId,
        producer_id: "visual_producer:camera-analysis",
        ok: true,
        observed_state: {
          source_id: sourceId,
          client_stream_confirmed: true,
          interval_active: true,
          cadence_ms: 10_000,
        },
      })
      .expect(200);

    expect(getLatestLiveSourceDescriptorForSource(sourceId)?.serving_context).toMatchObject({
      source_origin: "browser_getUserMedia",
      surface: "camera",
    });
  }, 30_000);
});
