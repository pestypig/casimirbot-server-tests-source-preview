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

describe("helix ask E70 composite follow-up pending request", () => {
  it("asks a real clarification for ambiguous generic note handoff", async () => {
    const app = createApp();
    const sessionId = `e70-pending-${Date.now()}`;

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open the best NHM2 document about alpha 0p7000 mission time comparison and open Situation Room Sources",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Add that result to my note.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(response.body?.final_status).toBe("pending_input");
    expect(response.body?.terminal_artifact_kind).toBe("pending_server_request");
    expect(response.body?.pending_server_request?.turn_id).toBe(response.body?.turn_id);
    expect(response.body?.pending_server_request?.item_id).toBeTruthy();
    expect(response.body?.pending_server_request?.resolution_options?.length).toBeGreaterThanOrEqual(2);
    expect(response.body?.composite_subgoal_binding?.binding_status).toBe("ambiguous");
  }, 90000);
});
