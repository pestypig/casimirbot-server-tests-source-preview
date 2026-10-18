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

describe("helix ask E62 deictic equation follow-up binding", () => {
  it("binds that source-finding attempt to the prior equation extraction attempt", async () => {
    const app = createApp();
    const sessionId = `e62-deictic-followup-${Date.now()}`;

    const first = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find me an NHM2 source that has a calculator-usable equation.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(first.body?.canonical_goal_frame?.goal_kind).toBe("doc_equation_location");
    expect(first.body?.equation_attempt_debug?.equation_extraction_attempt?.kind).toBe("equation_extraction_attempt");

    const followup = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "For that source-finding attempt, tell me what was checked and why it did or did not satisfy the calculator-ready equation requirement.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(followup.body?.canonical_goal_frame?.goal_kind).toBe("equation_attempt_followup");
    expect(followup.body?.terminal_artifact_kind).toBe("equation_attempt_explanation");
    expect(followup.body?.prior_context_bindings?.[0]).toMatchObject({
      artifact_kind: "equation_extraction_attempt",
      allowed_by_goal: true,
    });
    expect(followup.body?.terminal_error_code).not.toBe("terminal_consistency_violation");
    expect(String(followup.body?.selected_final_answer ?? "")).toMatch(/Queries:/);
  }, 120000);
});
