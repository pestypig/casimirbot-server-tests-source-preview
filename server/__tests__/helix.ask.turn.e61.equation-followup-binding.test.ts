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

describe("helix ask E61 equation attempt follow-up binding", () => {
  it("binds follow-up questions to the prior equation extraction attempt", async () => {
    const app = createApp();
    const sessionId = `e61-followup-${Date.now()}`;

    const first = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Skip generic audit summaries: show me an NHM2 document where the useful content is an expression, formula, or derivation.",
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
        question:
          "For the last source-finding attempt, tell me what was checked and why it did or did not satisfy the calculator-ready equation requirement.",
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
    expect(String(followup.body?.selected_final_answer ?? "")).toMatch(/Candidates:/);
  }, 120000);

  it("fails closed when no prior equation attempt exists", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "For the last source-finding attempt, tell me what was checked.",
        mode: "read",
        debug: true,
        sessionId: `e61-followup-missing-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("equation_attempt_followup");
    expect(response.body?.response_type).toBe("final_failure");
    expect(response.body?.terminal_error_code).toBe("prior_equation_attempt_unavailable");
    expect(response.body?.pending_server_request).toBeFalsy();
  }, 90000);
});
