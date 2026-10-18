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

describe("helix ask E69 composite pending request discipline", () => {
  it("does not fake pending state for composite turns without a pending request", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Situation Room Sources and show the docs directory",
        mode: "read",
        debug: true,
        sessionId: `e69-pending-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("composite_turn_receipt");
    expect(response.body?.final_status ?? response.body?.response_type).toBe("final_answer");
    expect(response.body?.pending_server_request ?? null).toBeNull();
    expect(response.body?.composite_turn_receipt?.pending_count).toBe(0);
  }, 60000);
});
