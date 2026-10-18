import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  ensureDefaultLiveWorkerLanes,
  listLiveWorkerLanes,
  listLiveWorkerRuns,
  resetLiveWorkerLanesForTest,
} from "../services/situation-room/live-worker-lane-store";
import { runLiveWorkerLane } from "../services/situation-room/live-worker-runner";
import {
  recordVisualFrame,
  resetVisualSnapshotStoreForTest,
  startVisualSnapshotSource,
} from "../services/situation-room/visual-snapshot-store";
import { resetSituationSourceCapabilitiesForTest } from "../services/situation-room/situation-source-capability-store";
import { clearLiveLineToolRequestStoreForTest } from "../services/situation-room/live-line-tool-request-store";
import { resetLiveSourceChunkBufferForTest } from "../services/situation-room/live-source-chunk-buffer";

const threadId = "thread:live-workers";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

describe("live source watchdog worker lanes", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetLiveWorkerLanesForTest();
    resetVisualSnapshotStoreForTest();
    resetSituationSourceCapabilitiesForTest();
    resetLiveSourceChunkBufferForTest();
    clearLiveLineToolRequestStoreForTest();
    delete process.env.VISION_HTTP_BASE;
    delete process.env.VISION_HTTP_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_ENDPOINT;
  });

  it("creates default worker lanes for a live environment", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:workers",
      objective: "Set up Minecraft Cortana from this screen share.",
      preset: "minecraft_run_monitor",
    });

    const lanes = ensureDefaultLiveWorkerLanes(environment);

    expect(lanes.some((lane) => lane.lane_key === "visual_analysis")).toBe(true);
    expect(lanes.some((lane) => lane.lane_key === "source_health")).toBe(true);
    expect(lanes.some((lane) => lane.lane_key === "line_risk")).toBe(true);
    expect(lanes.every((lane) => lane.assistant_answer === false && lane.raw_content_included === false)).toBe(true);
  });

  it("records provider-missing validation for captured but undescribed visual frames", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:visual-worker",
      objective: "Set up Minecraft Cortana from this screen share.",
      preset: "minecraft_run_monitor",
    });
    startVisualSnapshotSource({
      thread_id: threadId,
      source_id: "source:visual",
      status: "active",
      source_surface: "minecraft_client_window",
    });
    recordVisualFrame({
      thread_id: threadId,
      source_id: "source:visual",
      image_ref: "ephemeral://test-frame",
      mime_type: "image/png",
    });
    const lane = ensureDefaultLiveWorkerLanes(environment).find((entry) => entry.lane_key === "visual_analysis");
    expect(lane).toBeTruthy();

    const run = runLiveWorkerLane({ workerId: lane!.worker_id, triggerReason: "test_frame_captured" });

    expect(run.status).toBe("completed");
    expect(run.validations).toContain("vision_provider_missing");
    expect(run.assistant_answer).toBe(false);
    expect(run.raw_content_included).toBe(false);
  });

  it("line risk worker runs the event-window cognition tool as a validation path", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:risk-worker",
      objective: "Monitor Minecraft risk.",
      preset: "minecraft_run_monitor",
    });
    const lane = ensureDefaultLiveWorkerLanes(environment).find((entry) => entry.lane_key === "line_risk");
    expect(lane).toBeTruthy();

    const run = runLiveWorkerLane({ workerId: lane!.worker_id, triggerReason: "test_missing_risk_evidence" });

    expect(run.status).toBe("completed");
    expect(run.tool_calls[0]?.tool_id).toBe("minecraft.query_event_window");
    expect(run.observations.length).toBeGreaterThan(0);
    expect(run.validations.length).toBeGreaterThan(0);
    expect(run.assistant_answer).toBe(false);
  });

  it("exposes worker lanes and runs through the API", async () => {
    const app = await createApp();
    const start = await request(app)
      .post("/api/agi/situation/live-answer-environment/start")
      .send({
        thread_id: threadId,
        created_turn_id: "turn:route-workers",
        objective: "Set up Minecraft Cortana from this screen share.",
        preset: "minecraft_run_monitor",
      })
      .expect(200);
    expect(start.body.worker_lane_count).toBeGreaterThan(0);

    const listed = await request(app)
      .get(`/api/agi/situation/live-workers?thread_id=${encodeURIComponent(threadId)}`)
      .expect(200);
    expect(listed.body.lanes.length).toBeGreaterThan(0);

    const visual = listed.body.lanes.find((lane: { lane_key: string }) => lane.lane_key === "visual_analysis");
    const run = await request(app)
      .post(`/api/agi/situation/live-workers/${encodeURIComponent(visual.worker_id)}/run`)
      .send({ trigger_reason: "test_route" })
      .expect(200);
    expect(run.body.run).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(listLiveWorkerRuns({ threadId }).length).toBeGreaterThan(0);
    expect(listLiveWorkerLanes({ threadId }).length).toBeGreaterThan(0);
  }, 15000);
});
