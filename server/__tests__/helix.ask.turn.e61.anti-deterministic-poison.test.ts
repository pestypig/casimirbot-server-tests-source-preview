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

describe("helix ask E61 anti deterministic poison guard", () => {
  it("asserts artifact contracts rather than canned answer text for paraphrased equation-source prompts", async () => {
    const app = createApp();
    const prompts = [
      "I am trying to feed the scientific calculator later; point me to an NHM2 source that actually contains a formula-like relation, not just prose.",
      "Somewhere in the NHM2 material, is there a paper or report with a tau or alpha relation I can plug numbers into?",
      "Somewhere in the NHM2 documents, find the document where the useful content is an expression, formula, or derivation.",
    ];

    for (const [index, question] of prompts.entries()) {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question,
          mode: "read",
          debug: true,
          sessionId: `e61-anti-poison-${Date.now()}-${index}`,
        })
        .expect(200);

      expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_equation_location");
      expect(response.body?.retrieval_required_signal?.required).toBe(true);
      expect(response.body?.equation_semantic_intent?.strength).toBe("hard");
      expect(["doc_equation_location", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
      expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
      expect(String(response.body?.resolved_turn_summary?.resolved_route_label ?? "")).not.toMatch(
        /doc_evidence_location \/ universal_composer/,
      );
    }
  }, 180000);
});
