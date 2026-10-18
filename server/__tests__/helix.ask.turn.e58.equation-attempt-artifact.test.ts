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

const ledger = (body: any): any[] => (Array.isArray(body?.current_turn_artifact_ledger) ? body.current_turn_artifact_ledger : []);

describe("helix ask E58 equation extraction attempt artifacts", () => {
  it("records an equation extraction attempt when an equation-source turn fails closed", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "find me a nhm2 paper with equations?",
        mode: "read",
        debug: true,
        sessionId: `e58-equation-attempt-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_equation_location");
    expect(response.body?.retrieval_required_signal?.required).toBe(true);
    expect(["doc_equation_location", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);

    if (response.body?.terminal_artifact_kind === "typed_failure") {
      expect(response.body?.terminal_error_code).toBe("equation_source_unavailable");
      const attempt = ledger(response.body).find((artifact) => artifact?.kind === "equation_extraction_attempt");
      expect(attempt).toBeTruthy();
      expect(attempt?.payload?.kind).toBe("equation_extraction_attempt");
      expect(Array.isArray(attempt?.payload?.candidates_considered)).toBe(true);
      expect(attempt?.payload?.result).toMatch(/no_equation_like_snippets|no_eligible_candidates|internal_error/);
    }
  }, 90000);
});
