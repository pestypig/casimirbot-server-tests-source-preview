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

describe("helix ask E70 composite follow-up explanation", () => {
  it("explains failed equation subgoals from prior composite context", async () => {
    const app = createApp();
    const sessionId = `e70-explain-${Date.now()}`;

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find the equation tau = alpha T in the current document and open Scientific Calculator",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "For the failed part, tell me what happened.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("composite_subgoal_explanation");
    expect(response.body?.composite_subgoal_explanation?.source_scope).toBe("prior_turn_context");
    expect(String(response.body?.selected_final_answer ?? "")).toContain("equation_source_unavailable");
    expect(response.body?.final_answer_source).toBe("artifact_synthesis");
  }, 90000);
});
