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

const answerText = (body: any): string => String(body?.selected_final_answer ?? body?.text ?? "");

describe("helix ask E58 typed equation failure rendering", () => {
  it("renders equation-source failures from the typed failure instead of generic missing-artifact text", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "find me a nhm2 paper with equations?",
        mode: "read",
        debug: true,
        sessionId: `e58-equation-rendering-${Date.now()}`,
      })
      .expect(200);

    const text = answerText(response.body);
    if (response.body?.terminal_artifact_kind === "typed_failure") {
      expect(text).not.toMatch(/The turn stopped before required artifacts were satisfied/i);
      expect(text).toMatch(/NHM2/i);
      expect(text).toMatch(/equation|formula/i);
      expect(text).toMatch(/could not find|equation_source_unavailable/i);
    }
  }, 90000);

  it("dedupes calculator query terms while preserving equation and calculator intent", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find me an NHM2 document that has equations I can use in the scientific calculator.",
        mode: "read",
        debug: true,
        sessionId: `e58-equation-query-dedupe-${Date.now()}`,
      })
      .expect(200);

    const query = String(response.body?.retrieval_query_integrity?.generated_queries?.join(" ") ?? "");
    expect(query).toMatch(/NHM2/i);
    expect(query).toMatch(/equation/i);
    expect(query).toMatch(/scientific calculator|calculator/i);
    expect(query).not.toMatch(/calculator\s+calculator/i);
    expect(response.body?.retrieval_query_integrity?.duplicates_removed ?? []).toContain("calculator");
  }, 90000);

  it("does not render retrieval-recovery copy for background-only direct-answer timeouts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Background only: what is an equation of motion? [[TEST_FORCE_RECOVERY_TIMEOUT]]",
        mode: "read",
        debug: true,
        sessionId: `e58-background-timeout-${Date.now()}`,
      })
      .expect(200);

    const text = answerText(response.body);
    expect(response.body?.canonical_goal_frame?.answer_scope).toBe("model_only");
    expect(response.body?.terminal_error_code).toMatch(/direct_answer_unavailable|model_only_answer_unavailable/);
    expect(text).toMatch(/direct answer|background-only|general conceptual/i);
    expect(text).not.toMatch(/summarize the current document|retrieval recovery/i);
  }, 90000);
});
