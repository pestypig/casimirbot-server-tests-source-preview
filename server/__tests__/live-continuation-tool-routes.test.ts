import express from "express";
import request from "supertest";
import { planRouter } from "../routes/agi.plan";
import { beforeEach, describe, expect, it } from "vitest";
import {
  resetLiveContinuationJobsForTest,
  upsertLiveContinuationJob,
} from "../services/situation-room/live-continuation-job-store";
import {
  resetLiveContinuationRunnerForTest,
} from "../services/situation-room/live-continuation-runner";

const createApp = async (): Promise<express.Express> => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

describe("live continuation model-visible tool routes", () => {
  beforeEach(() => {
    resetLiveContinuationJobsForTest();
    resetLiveContinuationRunnerForTest();
  });

  it("starts, queries, ticks, and controls a single-agent continuation job", async () => {
    const app = await createApp();

    const start = await request(app)
      .post("/api/agi/situation/live-continuation/start")
      .send({
        thread_id: "thread:mc",
        room_id: "room:minecraft",
        environment_id: "live-env:mc",
        source_ids: ["source:minecraft"],
        objective: "Keep the player oriented and warn on salient risk.",
      })
      .expect(200);

    const jobId = start.body?.job?.job_id;
    expect(jobId).toBeTruthy();
    expect(start.body?.receipt).toMatchObject({
      schema: "helix.live_continuation_job_receipt.v1",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      post_tool_model_step_required: true,
      context_role: "receipt_not_assistant_answer",
    });

    const query = await request(app)
      .post("/api/agi/situation/live-continuation/query")
      .send({ room_id: "room:minecraft" })
      .expect(200);
    expect(query.body?.jobs).toHaveLength(1);

    const tick = await request(app)
      .post("/api/agi/situation/live-continuation/tick")
      .send({ job_id: jobId, trigger: "manual_refresh" })
      .expect(200);
    expect(tick.body?.tick).toMatchObject({
      schema: "helix.live_continuation_tick.v1",
      job_id: jobId,
      status: "completed",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      post_tool_model_step_required: true,
    });
    expect(tick.body?.debug?.workers).toBeTruthy();

    await request(app).post("/api/agi/situation/live-continuation/pause").send({ job_id: jobId }).expect(200);
    await request(app).post("/api/agi/situation/live-continuation/resume").send({ job_id: jobId }).expect(200);
    const stopped = await request(app).post("/api/agi/situation/live-continuation/stop").send({ job_id: jobId }).expect(200);
    expect(stopped.body?.receipt?.job_status).toBe("stopped");
  }, 20_000);

  it("returns typed non-answer receipts for optional procedural tools", async () => {
    const app = await createApp();

    const worker = await request(app)
      .post("/api/agi/situation/live-continuation/worker-lane/run")
      .send({ lane: "risk_watch", evidence_refs: ["world_event:1"] })
      .expect(200);
    expect(worker.body?.receipt).toMatchObject({
      schema: "helix.worker_lane_receipt.v1",
      context_role: "hypothesis_not_assistant_answer",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      post_tool_model_step_required: true,
    });

    const goal = await request(app)
      .post("/api/agi/situation/live-continuation/goal/evaluate")
      .send({ thread_id: "thread:mc", room_id: "room:minecraft", evidence_refs: ["world_event:1"] })
      .expect(200);
    expect(goal.body?.receipt).toMatchObject({
      schema: "helix.goal_evaluation_receipt.v1",
      status: "needs_more_observation",
      context_role: "receipt_not_assistant_answer",
      terminal_eligible: false,
    });

    const job = upsertLiveContinuationJob({
      thread_id: "thread:mc",
      room_id: "room:minecraft",
      source_ids: ["source:minecraft"],
      objective: "Keep the source-health lane ready for authenticated observations.",
    });
    const sourceHealth = await request(app)
      .post("/api/agi/situation/live-continuation/source-health/query")
      .send({ job_id: job.job_id, source_id: "source:minecraft" })
      .expect(200);
    expect(sourceHealth.body?.receipt).toMatchObject({
      schema: "helix.live_source_admission_receipt.v1",
      source_id: "source:minecraft",
      transport: "unknown",
      freshness: {
        status: "unknown",
        last_seen_at: null,
      },
      trust_level: "unverified",
      context_role: "receipt_not_assistant_answer",
      terminal_eligible: false,
    });
  }, 30_000);
});
