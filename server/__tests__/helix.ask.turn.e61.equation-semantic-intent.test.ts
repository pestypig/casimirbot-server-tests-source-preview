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

describe("helix ask E61 equation semantic intent", () => {
  it("routes formula-like relation source prompts to equation evidence", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "I am trying to feed the scientific calculator later; point me to an NHM2 source that actually contains a formula-like relation, not just prose.",
        mode: "read",
        debug: true,
        sessionId: `e61-semantic-relation-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.equation_semantic_intent?.required).toBe(true);
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_equation_location");
    expect(response.body?.retrieval_required_signal?.required).toBe(true);
    expect(response.body?.retrieval_required_signal?.requested_outputs).toContain("equation_location");
    expect(response.body?.resolved_turn_summary?.resolved_route_label).not.toMatch(/doc_evidence_location \/ universal_composer/);
    expect(["doc_equation_location", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
  }, 90000);

  it("preserves tau alpha relation terms for calculator-ready source search", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Somewhere in the NHM2 material, is there a paper or report with a tau or alpha relation I can plug numbers into?",
        mode: "read",
        debug: true,
        sessionId: `e61-semantic-tau-alpha-${Date.now()}`,
      })
      .expect(200);

    const query = String(response.body?.equation_attempt_debug?.retrieval_query_integrity?.generated_queries?.[0] ?? "");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_equation_location");
    expect(query).toMatch(/NHM2/i);
    expect(query).toMatch(/tau/i);
    expect(query).toMatch(/alpha/i);
    expect(query).toMatch(/relation/i);
    expect(query).toMatch(/plug numbers into/i);
    expect(response.body?.resolved_turn_summary?.resolved_route_label).not.toMatch(/doc_evidence_location \/ universal_composer/);
  }, 90000);

  it("does not over-trigger background-only generic relation prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Background only: what is a relation in physics?",
        mode: "read",
        debug: true,
        sessionId: `e61-background-relation-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.retrieval_required_signal?.required).toBe(false);
    expect(["direct_answer_text", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    expect(response.body?.terminal_error_code).not.toBe("equation_source_unavailable");
  }, 90000);
});
