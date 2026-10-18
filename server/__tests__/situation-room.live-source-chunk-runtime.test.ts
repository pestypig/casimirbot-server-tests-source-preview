import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  ensureDefaultLiveWorkerLanes,
  resetLiveWorkerLanesForTest,
} from "../services/situation-room/live-worker-lane-store";
import { runLiveWorkerLane } from "../services/situation-room/live-worker-runner";
import {
  appendLiveSourceChunk,
  getLiveSourceBufferStatus,
  listLiveSourceAnalysisJobs,
  listLiveSourceChunks,
  resetLiveSourceChunkBufferForTest,
} from "../services/situation-room/live-source-chunk-buffer";
import { resetSituationSourceCapabilitiesForTest } from "../services/situation-room/situation-source-capability-store";
import {
  listVisualFrameEvidence,
  resetVisualSnapshotStoreForTest,
} from "../services/situation-room/visual-snapshot-store";
import {
  clearInterpretedEventLogForTest,
  listInterpretedEvents,
} from "../services/situation-room/interpreted-event-log-store";
import { clearSyntheticEvidenceForTest } from "../services/situation-room/synthetic-evidence-ledger";
import { readLiveCognitionToolRegistry } from "../services/situation-room/live-cognition-tool-registry";

const threadId = "thread:live-source-chunks";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

describe("unified live-source chunk runtime", () => {
  beforeEach(() => {
    resetLiveSourceChunkBufferForTest();
    resetSituationSourceCapabilitiesForTest();
    resetVisualSnapshotStoreForTest();
    resetLiveAnswerEnvironments();
    resetLiveWorkerLanesForTest();
    clearInterpretedEventLogForTest();
    clearSyntheticEvidenceForTest();
    delete process.env.VISION_HTTP_BASE;
    delete process.env.VISION_HTTP_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_ENDPOINT;
  });

  it("records visual capture as a live-source chunk and queued analysis job", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/visual-source/start")
      .send({
        thread_id: threadId,
        source_id: "source:visual:minecraft-window",
        source_surface: "minecraft_client_window",
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/situation/visual-source/capture-frame")
      .send({
        thread_id: threadId,
        source_id: "source:visual:minecraft-window",
        image_ref: "ephemeral://frame/chunk",
        image_sha256: "d".repeat(64),
        mime_type: "image/png",
      })
      .expect(200);

    expect(response.body.live_source_chunk).toMatchObject({
      schema: "helix.live_source_chunk.v1",
      modality: "visual_frame",
      source_id: "source:visual:minecraft-window",
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
    });
    expect(response.body.live_source_analysis_job).toMatchObject({
      schema: "helix.live_source_analysis_job.v1",
      analyzer_id: "visual_analysis",
      status: "queued",
      assistant_answer: false,
      raw_content_included: false,
    });
  }, 10000);

  it("records audio transcript, world event, and calculator ticks through the same chunk route", async () => {
    const app = await createApp();

    const audio = await request(app)
      .post("/api/agi/situation/live-source/chunk")
      .send({
        thread_id: threadId,
        source_id: "source:audio",
        modality: "audio_transcript",
        compact_summary: "Helix, look at the farm boundary.",
      })
      .expect(200);
    const world = await request(app)
      .post("/api/agi/situation/live-source/chunk")
      .send({
        thread_id: threadId,
        source_id: "source:minecraft",
        modality: "world_event",
        compact_summary: "block_placed cobblestone_slab",
      })
      .expect(200);
    const calculator = await request(app)
      .post("/api/agi/situation/live-source/chunk")
      .send({
        thread_id: threadId,
        source_id: "source:calculator",
        modality: "calculator_stream",
        compact_summary: "tick result=79",
      })
      .expect(200);

    expect(audio.body.chunk.modality).toBe("audio_transcript");
    expect(world.body.chunk.modality).toBe("world_event");
    expect(calculator.body.chunk.modality).toBe("calculator_stream");
    expect([audio.body.chunk, world.body.chunk, calculator.body.chunk].every((chunk: any) => chunk.assistant_answer === false)).toBe(true);
    expect(listLiveSourceChunks({ threadId }).map((chunk) => chunk.modality)).toEqual(expect.arrayContaining([
      "audio_transcript",
      "world_event",
      "calculator_stream",
    ]));
  });

  it("workstation source ingest also emits chunk traffic", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/situation/live-source/event")
      .send({
        thread_id: threadId,
        source_id: "source:minecraft-server",
        kind: "minecraft_world_events",
        event_type: "block_placed",
        payload: { block: "minecraft:cobblestone_slab" },
      })
      .expect(200);

    expect(response.body.live_source_chunk).toMatchObject({
      modality: "world_event",
      source_id: "source:minecraft-server",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(response.body.live_source_analysis_job.analyzer_id).toBe("world_sense");
  });

  it("rate policies update producer cadence and stay non-answer metadata", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/situation/live-source/rate-policy")
      .send({
        thread_id: threadId,
        source_id: "source:visual",
        modality: "visual_frame",
        capture_mode: "interval",
        cadence_ms: 10_000,
      })
      .expect(200);

    expect(response.body.rate_policy).toMatchObject({
      schema: "helix.live_source_rate_policy.v1",
      capture_mode: "interval",
      cadence_ms: 10_000,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(response.body.producer).toMatchObject({
      cadence_ms: 10_000,
      capture_mode: "interval",
      assistant_answer: false,
    });
  });

  it("compacts old chunks under bounded backpressure instead of creating answers", () => {
    resetLiveSourceChunkBufferForTest({ maxChunks: 3 });
    for (let index = 0; index < 5; index += 1) {
      appendLiveSourceChunk({
        thread_id: threadId,
        source_id: "source:rapid",
        modality: "simulation_stream",
        compact_summary: `residual tick ${index}`,
      });
    }

    const chunks = listLiveSourceChunks({ threadId, sourceId: "source:rapid" });
    const status = getLiveSourceBufferStatus({ threadId });

    expect(chunks).toHaveLength(3);
    expect(status.sources[0]).toMatchObject({
      chunk_count: 3,
      backpressure: {
        status: "compacting",
        compacted_chunk_count: 2,
        assistant_answer: false,
      },
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("visual analysis worker consumes the latest visual_frame chunk without creating an answer", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:chunk-worker",
      objective: "Set up Minecraft Cortana from this screen share.",
      preset: "minecraft_run_monitor",
      source_ids: ["source:visual"],
    });
    const chunk = appendLiveSourceChunk({
      thread_id: threadId,
      source_id: "source:visual",
      modality: "visual_frame",
      compact_summary: "Visual frame captured.",
      payload_ref: "visual_frame:test",
    }).chunk;
    const lane = ensureDefaultLiveWorkerLanes(environment).find((entry) => entry.lane_key === "visual_analysis");
    expect(lane).toBeTruthy();

    const run = runLiveWorkerLane({ workerId: lane!.worker_id, triggerReason: "test_chunk_available" });
    const jobs = listLiveSourceAnalysisJobs({ threadId, sourceId: "source:visual" });

    expect(run.tool_calls[0]).toMatchObject({
      tool_id: "visual-frame.analyze",
      receipt_refs: [chunk.chunk_id],
    });
    expect(jobs.some((job) => job.chunk_id === chunk.chunk_id)).toBe(true);
    expect(run.assistant_answer).toBe(false);
    expect(run.raw_content_included).toBe(false);
  });

  it("source buffer status remains usable for partial-source live environments", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/live-source/chunk")
      .send({
        thread_id: threadId,
        source_id: "source:visual-only",
        modality: "visual_frame",
        compact_summary: "Visual source is active, no world source attached.",
      })
      .expect(200);

    const status = await request(app)
      .get(`/api/agi/situation/live-source/buffer-status?thread_id=${encodeURIComponent(threadId)}`)
      .expect(200);

    expect(status.body).toMatchObject({
      schema: "helix.live_source_buffer_status.v1",
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
    });
    expect(status.body.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_id: "source:visual-only",
        modality: "visual_frame",
      }),
    ]));
  });

  it("running visual analysis with missing provider records failure and next action", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/visual-source/start")
      .send({
        thread_id: threadId,
        source_id: "source:visual:missing-provider",
        source_surface: "minecraft_client_window",
      })
      .expect(200);
    const capture = await request(app)
      .post("/api/agi/situation/visual-source/capture-frame")
      .send({
        thread_id: threadId,
        source_id: "source:visual:missing-provider",
        image_ref: "ephemeral://frame/missing-provider",
        mime_type: "image/png",
      })
      .expect(200);

    const run = await request(app)
      .post(`/api/agi/situation/live-source/analysis-jobs/${encodeURIComponent(capture.body.live_source_analysis_job.job_id)}/run`)
      .send({})
      .expect(200);

    expect(run.body).toMatchObject({
      schema: "helix.live_source_analysis_execution.v1",
      ok: false,
      next_required_action: "configure_vision_provider",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(run.body.job).toMatchObject({
      status: "failed",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(run.body.output.interpreted_event.assistant_answer).toBe(false);
  });

  it("running visual analysis with configured provider and compact summary records visual evidence", async () => {
    process.env.VISION_HTTP_BASE = "http://vision-provider.test";
    const app = await createApp();
    const frame = await request(app)
      .post("/api/agi/situation/visual-frame")
      .send({
        thread_id: threadId,
        source_id: "source:visual:success",
        image_ref: "ephemeral://frame/success",
        mime_type: "image/png",
      })
      .expect(200);
    const chunk = await request(app)
      .post("/api/agi/situation/live-source/chunk")
      .send({
        thread_id: threadId,
        source_id: "source:visual:success",
        modality: "visual_frame",
        payload_ref: frame.body.frame.frame_id,
        compact_summary: "The Minecraft screen shows a chest inventory with item stacks visible.",
      })
      .expect(200);

    const run = await request(app)
      .post(`/api/agi/situation/live-source/analysis-jobs/${encodeURIComponent(chunk.body.analysis_job.job_id)}/run`)
      .send({})
      .expect(200);

    expect(run.body.ok).toBe(true);
    expect(run.body.job.status).toBe("completed");
    expect(run.body.job.output_refs[0]).toMatch(/^visual_evidence:/);
    expect(listVisualFrameEvidence({ threadId }).at(-1)).toMatchObject({
      summary: "The Minecraft screen shows a chest inventory with item stacks visible.",
      assistant_answer: false,
      raw_image_included: false,
    });
  });

  it("visual analysis without frame payload requests capture_frame_now", async () => {
    const app = await createApp();
    const chunk = await request(app)
      .post("/api/agi/situation/live-source/chunk")
      .send({
        thread_id: threadId,
        source_id: "source:visual:no-frame",
        modality: "visual_frame",
        compact_summary: "Visual frame captured.",
      })
      .expect(200);

    const run = await request(app)
      .post(`/api/agi/situation/live-source/analysis-jobs/${encodeURIComponent(chunk.body.analysis_job.job_id)}/run`)
      .send({})
      .expect(200);

    expect(run.body.ok).toBe(false);
    expect(run.body.next_required_action).toBe("capture_frame_now");
    expect(run.body.job.status).toBe("failed");
  });

  it("run-due executes audio, world, and calculator analysis jobs as evidence, not answers", async () => {
    const app = await createApp();
    for (const entry of [
      ["source:audio-due", "audio_transcript", "Helix, watch this farm boundary."],
      ["source:world-due", "world_event", "block_placed minecraft:cobblestone_slab"],
      ["source:calculator-due", "calculator_stream", "tick result=79 residual=0"],
    ]) {
      await request(app)
        .post("/api/agi/situation/live-source/chunk")
        .send({
          thread_id: threadId,
          source_id: entry[0],
          modality: entry[1],
          compact_summary: entry[2],
        })
        .expect(200);
    }

    const runDue = await request(app)
      .post("/api/agi/situation/live-source/analysis-jobs/run-due")
      .send({ thread_id: threadId, limit: 4 })
      .expect(200);

    expect(runDue.body.execution_count).toBe(3);
    expect(runDue.body.executions.every((entry: any) => entry.assistant_answer === false)).toBe(true);
    expect(runDue.body.executions.map((entry: any) => entry.job.status)).toEqual(["completed", "completed", "completed"]);
    expect(listInterpretedEvents({ threadId, limit: 10 }).length).toBeGreaterThanOrEqual(2);
  });

  it("analysis output updates present-state/live-card projection without assistant history", async () => {
    process.env.VISION_HTTP_BASE = "http://vision-provider.test";
    const app = await createApp();
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:analysis-card",
      objective: "Watch this Minecraft tab and describe what is happening.",
      preset: "minecraft_run_monitor",
      source_ids: ["source:visual-card"],
    });
    const frame = await request(app)
      .post("/api/agi/situation/visual-frame")
      .send({
        thread_id: threadId,
        source_id: "source:visual-card",
        image_ref: "ephemeral://frame/card",
        mime_type: "image/png",
      })
      .expect(200);
    const chunk = await request(app)
      .post("/api/agi/situation/live-source/chunk")
      .send({
        thread_id: threadId,
        source_id: "source:visual-card",
        modality: "visual_frame",
        payload_ref: frame.body.frame.frame_id,
        compact_summary: "The player is looking at a Minecraft farm boundary with crops visible.",
      })
      .expect(200);

    const run = await request(app)
      .post(`/api/agi/situation/live-source/analysis-jobs/${encodeURIComponent(chunk.body.analysis_job.job_id)}/run`)
      .send({})
      .expect(200);

    expect(run.body.output.live_answer_environment.environment_id).toBe(environment.environment_id);
    expect(run.body.output.live_environment_delta).toMatchObject({
      context_policy: "compact_context_pack_only",
      raw_logs_included: false,
    });
    expect(JSON.stringify(run.body)).not.toContain("assistant_answer\":true");
    expect(listInterpretedEvents({ threadId, limit: 10 }).some((event) => event.kind === "synthetic_evidence")).toBe(true);
  });

  it("analysis job read route exposes inspectable job lifecycle", async () => {
    const app = await createApp();
    const chunk = await request(app)
      .post("/api/agi/situation/live-source/chunk")
      .send({
        thread_id: threadId,
        source_id: "source:inspect",
        modality: "audio_transcript",
        compact_summary: "Ambient transcript chunk.",
      })
      .expect(200);

    const readBefore = await request(app)
      .get(`/api/agi/situation/live-source/analysis-jobs/${encodeURIComponent(chunk.body.analysis_job.job_id)}`)
      .expect(200);
    expect(readBefore.body.job.status).toBe("queued");

    await request(app)
      .post(`/api/agi/situation/live-source/analysis-jobs/${encodeURIComponent(chunk.body.analysis_job.job_id)}/run`)
      .send({})
      .expect(200);

    const readAfter = await request(app)
      .get(`/api/agi/situation/live-source/analysis-jobs/${encodeURIComponent(chunk.body.analysis_job.job_id)}`)
      .expect(200);
    expect(readAfter.body.job.status).toBe("completed");
    expect(readAfter.body.job.assistant_answer).toBe(false);
  });

  it("registers live-source setup tools as non-answer workstation actions", () => {
    const registry = readLiveCognitionToolRegistry();
    expect(registry.tools.map((tool) => tool.tool_id)).toEqual(expect.arrayContaining([
      "situation-room.live-source.create_producer",
      "situation-room.live-source.set_rate",
      "situation-room.live-source.start_analysis",
      "situation-room.live-source.run_due_analysis",
      "situation-room.live-source.query_chunks",
      "situation-room.live-source.query_analysis_jobs",
      "situation-room.live-source.configure_pipeline",
    ]));
    expect(registry.tools
      .filter((tool) => tool.tool_id.startsWith("situation-room.live-source."))
      .every((tool) => tool.creates_assistant_answer === false)).toBe(true);
  });
});
