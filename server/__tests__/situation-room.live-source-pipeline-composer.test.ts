import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { composeLiveSourcePipelinePlan } from "../services/helix-ask/live-source-pipeline-composer";
import {
  executeLiveSourcePipelinePlan,
  resetLiveSourcePipelinesForTest,
} from "../services/helix-ask/live-source-pipeline-executor";
import { resetLiveAnswerEnvironments } from "../services/situation-room/live-answer-environment-store";
import { resetLiveWorkerLanesForTest } from "../services/situation-room/live-worker-lane-store";
import { resetLiveSourceChunkBufferForTest } from "../services/situation-room/live-source-chunk-buffer";
import { clearInterpretedEventLogForTest, listInterpretedEvents } from "../services/situation-room/interpreted-event-log-store";
import { clearSyntheticEvidenceForTest } from "../services/situation-room/synthetic-evidence-ledger";
import { resetSituationSourceCapabilitiesForTest } from "../services/situation-room/situation-source-capability-store";
import { resetVisualSnapshotStoreForTest } from "../services/situation-room/visual-snapshot-store";
import { readLiveCognitionToolRegistry } from "../services/situation-room/live-cognition-tool-registry";
import { resetLivePipelineLifecycleForTest } from "../services/situation-room/live-pipeline-lifecycle-store";

const threadId = "thread:live-source-pipeline";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

describe("agentic live-source pipeline composer", () => {
  beforeEach(() => {
    resetLiveSourcePipelinesForTest();
    resetLiveSourceChunkBufferForTest();
    resetLiveAnswerEnvironments();
    resetLiveWorkerLanesForTest();
    resetSituationSourceCapabilitiesForTest();
    resetVisualSnapshotStoreForTest();
    resetLivePipelineLifecycleForTest();
    clearInterpretedEventLogForTest();
    clearSyntheticEvidenceForTest();
    delete process.env.VISION_HTTP_BASE;
    delete process.env.VISION_HTTP_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_ENDPOINT;
  });

  it("maps Minecraft Cortana prompt to visual and world sources", () => {
    const plan = composeLiveSourcePipelinePlan({
      threadId,
      objective: "Set up Minecraft Cortana from my active screen capture and Minehut source.",
    });

    expect(plan).toMatchObject({
      schema: "helix.live_source_pipeline_plan.v1",
      thread_id: threadId,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(plan.requested_modalities).toEqual(expect.arrayContaining(["visual_frame", "world_event"]));
    expect(plan.live_card_schema.map((line) => line.label)).toEqual(expect.arrayContaining([
      "Place",
      "Activity",
      "Structure",
      "Entities",
      "Risk",
      "Missing Evidence",
      "Next Check",
    ]));
    expect(plan.missing_capabilities).toEqual(expect.arrayContaining(["grant_visual_capture_permission", "attach_world_event_source"]));
  });

  it("maps Moral transcript prompt to transcript and reference analysis", () => {
    const plan = composeLiveSourcePipelinePlan({
      threadId,
      objective: "Compare this tab transcript to Moral as it comes in.",
    });

    expect(plan.requested_modalities).toEqual(expect.arrayContaining(["audio_transcript", "document_context"]));
    expect(plan.live_card_schema.map((line) => line.label)).toEqual(expect.arrayContaining([
      "Current claim",
      "Moral comparison",
      "Evidence",
      "Uncertainty",
      "Next Check",
    ]));
  });

  it("maps equation stream prompt to calculator and simulation streams", () => {
    const plan = composeLiveSourcePipelinePlan({
      threadId,
      objective: "Make this equation a live source and watch stability.",
    });

    expect(plan.requested_modalities).toEqual(expect.arrayContaining(["calculator_stream", "simulation_stream"]));
    expect(plan.live_card_schema.map((line) => line.label)).toEqual(expect.arrayContaining([
      "Equation",
      "Variables",
      "Result",
      "Stability",
      "Residual",
      "Next Check",
    ]));
  });

  it("maps document math prompt to document and calculator context", () => {
    const plan = composeLiveSourcePipelinePlan({
      threadId,
      objective: "Read this document and verify equations as I go.",
    });

    expect(plan.requested_modalities).toEqual(expect.arrayContaining(["document_context", "calculator_stream", "note_context"]));
    expect(plan.live_card_schema.map((line) => line.label)).toEqual(expect.arrayContaining([
      "Section",
      "Equation",
      "Verification",
      "Evidence",
      "Next Check",
    ]));
  });

  it("executes a pipeline into producers, workers, and an inspectable dashboard", async () => {
    const app = await createApp();
    const compose = await request(app)
      .post("/api/agi/situation/live-source/pipeline/compose")
      .send({
        thread_id: threadId,
        objective: "Set up Minecraft Cortana from my active screen capture and Minehut source.",
      })
      .expect(200);

    const execute = await request(app)
      .post("/api/agi/situation/live-source/pipeline/execute")
      .send({ plan_id: compose.body.plan.plan_id })
      .expect(200);

    expect(execute.body.receipt).toMatchObject({
      schema: "helix.live_source_pipeline_receipt.v1",
      status: "active",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(execute.body.receipt.source_producer_ids.length).toBeGreaterThan(0);
    expect(execute.body.receipt.worker_lane_ids.length).toBeGreaterThan(0);
    expect(execute.body.dashboard).toMatchObject({
      schema: "helix.live_source_pipeline_dashboard.v1",
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
    });
    expect(execute.body.dashboard.producers.length).toBeGreaterThan(0);
    expect(execute.body.dashboard.readiness).toMatchObject({
      schema: "helix.live_pipeline_readiness.v1",
      state: "waiting_for_permission",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(execute.body.dashboard.lifecycle_events.map((event: any) => event.kind)).toEqual(expect.arrayContaining([
      "pipeline_executed",
      "producer_created",
      "rate_policy_set",
    ]));
  }, 10000);

  it("pipeline readiness and lifecycle routes expose permission and first-chunk states", async () => {
    const app = await createApp();
    const execute = await request(app)
      .post("/api/agi/situation/live-source/pipeline/execute")
      .send({
        thread_id: threadId,
        objective: "Set up Minecraft Cortana from my active screen capture and Minehut source.",
      })
      .expect(200);
    const pipelineId = execute.body.receipt.pipeline_id;

    const waitingPermission = await request(app)
      .get(`/api/agi/situation/pipelines/${encodeURIComponent(pipelineId)}/readiness`)
      .expect(200);
    expect(waitingPermission.body.readiness.state).toBe("waiting_for_permission");

    const visualSource = execute.body.plan.producers.find((producer: any) => producer.modality === "visual_frame").source_id;
    await request(app)
      .post("/api/agi/situation/live-source/rate-policy")
      .send({
        thread_id: threadId,
        source_id: visualSource,
        modality: "visual_frame",
        status: "active",
        capture_mode: "manual",
      })
      .expect(200);

    const waitingChunk = await request(app)
      .get(`/api/agi/situation/pipelines/${encodeURIComponent(pipelineId)}/readiness`)
      .expect(200);
    expect(waitingChunk.body.readiness.state).toBe("waiting_for_first_chunk");

    const lifecycle = await request(app)
      .get(`/api/agi/situation/pipelines/${encodeURIComponent(pipelineId)}/lifecycle`)
      .expect(200);
    expect(lifecycle.body.events.every((event: any) => event.assistant_answer === false)).toBe(true);
  });

  it("pipeline repair proposes provider and capture/world actions rather than failing", () => {
    const plan = composeLiveSourcePipelinePlan({
      threadId,
      objective: "Set up Minecraft Cortana from my active screen capture and Minehut source.",
    });
    const { receipt } = executeLiveSourcePipelinePlan(plan);

    const appPromise = createApp();
    return appPromise.then(async (app) => {
      const repair = await request(app)
        .post(`/api/agi/situation/live-source/pipeline/${encodeURIComponent(receipt.pipeline_id)}/repair`)
        .send({})
        .expect(200);

      expect(repair.body.actions).toEqual(expect.arrayContaining([
        "grant_visual_capture_permission",
        "configure_vision_provider",
        "attach_world_event_source",
      ]));
      expect(repair.body.assistant_answer).toBe(false);
    });
  });

  it("running pipeline analysis updates dashboard evidence and interpreted log", async () => {
    const app = await createApp();
    const execute = await request(app)
      .post("/api/agi/situation/live-source/pipeline/execute")
      .send({
        thread_id: threadId,
        objective: "Compare this tab transcript to Moral as it comes in.",
      })
      .expect(200);
    const audioSource = execute.body.plan.producers.find((producer: any) => producer.modality === "audio_transcript").source_id;
    await request(app)
      .post("/api/agi/situation/live-source/chunk")
      .send({
        thread_id: threadId,
        source_id: audioSource,
        modality: "audio_transcript",
        compact_summary: "Helix, compare this claim to Moral: attachment to concepts creates suffering.",
      })
      .expect(200);

    const run = await request(app)
      .post("/api/agi/situation/live-source/analysis-jobs/run-due")
      .send({ thread_id: threadId })
      .expect(200);
    const inspect = await request(app)
      .get(`/api/agi/situation/live-source/pipeline/${encodeURIComponent(execute.body.receipt.pipeline_id)}`)
      .expect(200);

    expect(run.body.executions.some((entry: any) => entry.job.status === "completed")).toBe(true);
    expect(inspect.body.dashboard.analysis_jobs.length).toBeGreaterThan(0);
    expect(inspect.body.dashboard.live_card).toBeTruthy();
    expect(listInterpretedEvents({ threadId, limit: 20 }).some((event) => event.kind === "synthetic_evidence")).toBe(true);
    expect(JSON.stringify(inspect.body)).not.toContain("assistant_answer\":true");
  });

  it("acceptance harness advances chunks, analysis, evidence routing, and readiness", async () => {
    const app = await createApp();
    const execute = await request(app)
      .post("/api/agi/situation/live-source/pipeline/execute")
      .send({
        thread_id: threadId,
        objective: "Set up Minecraft Cortana from my active screen capture and Minehut source.",
      })
      .expect(200);

    const acceptance = await request(app)
      .post(`/api/agi/situation/pipelines/${encodeURIComponent(execute.body.receipt.pipeline_id)}/run-acceptance`)
      .send({})
      .expect(200);

    expect(acceptance.body.result).toMatchObject({
      schema: "helix.live_pipeline_acceptance_result.v1",
      ok: true,
      poison_audit_ok: true,
      terminal_authority_ok: true,
      assistant_answer_from_pipeline_count: 0,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(acceptance.body.result.scenarios.length).toBeGreaterThan(0);
    expect(acceptance.body.lifecycle_events.map((event: any) => event.kind)).toEqual(expect.arrayContaining([
      "chunk_received",
      "analysis_job_queued",
      "analysis_job_completed",
      "evidence_routed",
      "present_state_updated",
    ]));
    expect(["ready", "degraded"]).toContain(acceptance.body.readiness.state);
  });

  it("pipeline tools are registered as non-answer actions", () => {
    const registry = readLiveCognitionToolRegistry();
    expect(registry.tools.map((tool) => tool.tool_id)).toEqual(expect.arrayContaining([
      "situation-room.pipeline.compose",
      "situation-room.pipeline.execute",
      "situation-room.pipeline.inspect",
      "situation-room.pipeline.repair",
      "situation-room.pipeline.stop",
      "situation-room.pipeline.archive",
    ]));
    expect(registry.tools
      .filter((tool) => tool.tool_id.startsWith("situation-room.pipeline."))
      .every((tool) => tool.creates_assistant_answer === false)).toBe(true);
  });

  it("stopping a pipeline pauses producers without creating assistant answers", () => {
    const plan = composeLiveSourcePipelinePlan({
      threadId,
      objective: "Make this equation a live source and watch stability.",
    });
    const { receipt } = executeLiveSourcePipelinePlan(plan);

    return createApp().then(async (app) => {
      const stop = await request(app)
        .post(`/api/agi/situation/live-source/pipeline/${encodeURIComponent(receipt.pipeline_id)}/stop`)
        .send({})
        .expect(200);

      expect(stop.body.receipt).toMatchObject({
        status: "stopped",
        assistant_answer: false,
        raw_content_included: false,
      });
    });
  });
});
