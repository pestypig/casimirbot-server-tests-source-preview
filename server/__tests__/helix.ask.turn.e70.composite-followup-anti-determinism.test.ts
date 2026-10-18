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

describe("helix ask E70 composite follow-up anti-determinism", () => {
  it("emits clean binding and anti-poison audits for retrying a failed subgoal", async () => {
    const app = createApp();
    const sessionId = `e70-audit-${Date.now()}`;

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find the equation tau = alpha T in the current document and open Situation Room Sources",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Retry just the failed equation lookup.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("composite_followup");
    expect(response.body?.terminal_artifact_kind).toBe("composite_subgoal_retry_plan");
    expect(response.body?.composite_followup_anti_determinism_audit?.verdict).toBe("clean");
    expect(JSON.stringify(response.body?.composite_followup_anti_determinism_audit)).toContain("no_last_artifact_blind_use");
    expect(response.body?.composite_subgoal_binding?.binding_status).toBe("bound");
  }, 90000);

  it("does not let prior composite follow-up binding steal a new same-turn doc plus panel composite", async () => {
    const app = createApp();
    const sessionId = `e70-same-turn-precedence-${Date.now()}`;

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
        question: "Open the best NHM2 document about alpha 0p7000 mission time comparison and open Situation Room Sources",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("composite_goal");
    expect(response.body?.terminal_artifact_kind).toBe("composite_turn_receipt");
    expect(response.body?.composite_subgoal_reference_intent ?? null).toBeNull();
    expect(response.body?.composite_turn_receipt?.subgoal_results?.map((result: any) => result.kind)).toEqual(
      expect.arrayContaining(["doc_open_best", "workspace_action"]),
    );
  }, 90000);
});
