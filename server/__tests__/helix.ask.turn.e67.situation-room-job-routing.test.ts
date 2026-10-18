import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const executedActions = (body: any): any[] =>
  Array.isArray(body?.execution_trace) ? body.execution_trace.map((step: any) => step?.action).filter(Boolean) : [];

describe("helix ask E67 situation room job routing", () => {
  afterEach(() => {
    delete process.env.HELIX_E11_MODEL_DECISION_LLM;
    delete process.env.HELIX_E14_OBSERVATION_MODEL_DECISION;
    vi.resetModules();
  });

  it("routes natural translate-job phrasing to Situation Room Pipelines instead of model-only advice", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();

    const app = await createApp();
    const sessionId = `e67-situation-room-job-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Create a Spanish translation job for the current Situation Room source",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "situation-room-sources",
          hasSituationRoomContext: true,
        },
      })
      .expect(200);

    const actions = executedActions(response.body);
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(actions.some((action) => action?.panel_id === "situation-room-pipelines" && action?.action_id === "create_job")).toBe(
      true,
    );
    expect(JSON.stringify(response.body)).toContain("situation_room_job");
    expect(JSON.stringify(response.body)).toContain("terminal_artifact_satisfied");
    expect(JSON.stringify(response.body)).not.toContain("workstation-notes.create_note");
    expect(answerText(response.body)).toContain("created a Translate to es Situation Room job");
    expect(answerText(response.body)).toContain("manual-only");
    expect(answerText(response.body)).toContain("No workstation note was created");
  }, 60000);
});
