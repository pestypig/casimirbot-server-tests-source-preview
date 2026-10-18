import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

describe("helix ask turn e10.2 runtime next-step decision", () => {
  it("ends workspace-only turns with a final_answer runtime decision", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open notes", mode: "read", sessionId: "e102-open-notes" })
      .expect(200);

    expect(response.body?.turn_runtime?.status).toBe("completed");
    expect(response.body?.turn_runtime?.last_decision?.kind).toBe("final_answer");
    expect(response.body?.turn_runtime?.decision_count).toBeGreaterThan(0);
    expect(response.body?.pending_server_request ?? null).toBeNull();
  });

  it("keeps missing note title as request_input decision", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create a note", mode: "read", sessionId: "e102-create-note" })
      .expect(200);

    expect(response.body?.turn_runtime?.status).toBe("pending_input");
    expect(response.body?.turn_runtime?.last_decision?.kind).toBe("request_input");
    expect(response.body?.turn_runtime?.last_decision?.required_fields?.length ?? 0).toBeGreaterThan(0);
    expect(response.body?.turn_runtime?.terminal?.kind).toBe("pending_input");
    expect(response.body?.pending_server_request?.request_id).toBeTruthy();
  });

  it("records final runtime decision for hybrid compare after workspace and reasoning observations", async () => {
    const app = createApp();
    const sessionId = "e102-hybrid";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create note called e102 compare", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "compare this doc with note e102 compare and tell me differences", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.turn_runtime?.completed_subgoals).toContain("workspace_action");
    expect(response.body?.turn_runtime?.completed_subgoals).toContain("reasoning_followup");
    expect(["final_answer", "request_input"]).toContain(response.body?.turn_runtime?.last_decision?.kind);
    expect(response.body?.turn_runtime?.decision_count).toBeGreaterThan(0);
  });
});

