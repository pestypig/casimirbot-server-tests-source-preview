import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const createApp = async (): Promise<{ app: express.Express }> => {
  const agi = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", agi.planRouter);
  return { app };
};

const actions = (body: any): any[] =>
  Array.isArray(body?.execution_trace) ? body.execution_trace.map((step: any) => step?.action).filter(Boolean) : [];

describe("helix ask live workstation pipeline routing", () => {
  afterEach(() => {
    delete process.env.HELIX_E11_MODEL_DECISION_LLM;
    delete process.env.HELIX_E14_OBSERVATION_MODEL_DECISION;
    vi.resetModules();
  });

  it("routes live transcript note prompts to create_live_workstation_pipeline", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();
    const { app } = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Summarize each sentence from this live browser tab into a note.",
        mode: "read",
        debug: true,
        sessionId: `live-pipeline-routing-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "situation-room-pipelines",
          hasSituationRoomContext: true,
        },
      })
      .expect(200);

    const action = actions(response.body).find(
      (entry) =>
        entry?.panel_id === "situation-room-pipelines" &&
        entry?.action_id === "create_live_workstation_pipeline",
    );
    expect(action).toBeTruthy();
    expect(action?.args?.objective).toContain("Summarize each sentence");
    expect(response.body.response_type).not.toBe("final_failure");
    expect(JSON.stringify(response.body)).not.toContain("I could not map that workspace command");
    expect(JSON.stringify(response.body)).not.toContain("terminal_consistency_violation");
  }, 60000);
});
