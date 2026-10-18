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

describe("helix ask E57 query preservation", () => {
  it("does not degrade source-with-formulas prompts to generic NHM2-only search", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "I need an NHM2 source with formulas, not just an audit summary.",
        mode: "read",
        debug: true,
        sessionId: `e57-source-formulas-${Date.now()}`,
      })
      .expect(200);

    const query = String((response.body?.retrieval_query_integrity?.generated_queries ?? []).join(" "));
    expect(response.body?.document_seeking_intent?.required).toBe(true);
    expect(response.body?.equation_retrieval_intent?.required).toBe(true);
    expect(query).toMatch(/NHM2/i);
    expect(query).toMatch(/formula|equation/i);
    expect(query).not.toMatch(/^NHM2$/i);
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_equation_location");
    expect(["doc_equation_location", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
  }, 90000);
});
