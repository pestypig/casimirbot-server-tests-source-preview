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

describe("helix ask turn e10.1 runtime foundation", () => {
  it("summarizes workspace-only turns as completed runtime observations", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open notes", mode: "read", sessionId: "e101-open-notes" })
      .expect(200);

    expect(response.body?.turn_runtime?.status).toBe("completed");
    expect(response.body?.turn_runtime?.terminal?.kind).toBe("final_answer");
    expect(response.body?.turn_runtime?.completed_subgoals).toContain("workspace_action");
    expect(response.body?.turn_runtime?.observation_count).toBeGreaterThan(0);
    expect(response.body?.turn_runtime?.artifact_keys).toContain("workspace_context");
  });

  it("records workspace then reasoning observations for hybrid compare turns", async () => {
    const app = createApp();
    const sessionId = "e101-hybrid";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create note called e101 compare", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "compare this doc with note e101 compare and tell me differences", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.turn_runtime?.status).toBe("completed");
    expect(response.body?.turn_runtime?.completed_subgoals).toContain("workspace_action");
    expect(response.body?.turn_runtime?.completed_subgoals).toContain("reasoning_followup");
    expect(response.body?.turn_runtime?.artifact_keys).toContain("workspace_context");
    expect(response.body?.turn_runtime?.artifact_keys).toContain("reasoning_context");
  });

  it("summarizes clarify turns as pending input runtime state", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create a note", mode: "read", sessionId: "e101-pending-note" })
      .expect(200);

    expect(response.body?.turn_runtime?.status).toBe("pending_input");
    expect(response.body?.turn_runtime?.terminal?.kind).toBe("pending_input");
    expect(response.body?.pending_server_request?.request_id).toBeTruthy();
  });
});

