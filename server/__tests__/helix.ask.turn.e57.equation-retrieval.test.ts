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

describe("helix ask E57 equation-bearing retrieval", () => {
  it("routes casual NHM2 paper-with-equations prompts through retrieval instead of no-tool conversation", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "find me a nhm2 paper with equations?",
        mode: "read",
        debug: true,
        sessionId: `e57-paper-equations-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.document_seeking_intent?.required).toBe(true);
    expect(response.body?.equation_retrieval_intent?.required).toBe(true);
    expect(response.body?.retrieval_required_signal?.required).toBe(true);
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_equation_location");
    expect(response.body?.route_reason_code ?? response.body?.route).not.toBe("conversation:simple");
    expect(response.body?.dispatch_policy).not.toBe("direct_answer_only");
    expect(["doc_equation_location", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(answerText(response.body)).not.toMatch(/Searched document:|No locations found|Path:\s*docs\//i);
    if (response.body?.terminal_artifact_kind === "typed_failure") {
      expect(response.body?.terminal_error_code ?? answerText(response.body)).toMatch(/equation_source_unavailable/i);
      expect(answerText(response.body)).toMatch(/equation-bearing snippets|equation_source_unavailable/i);
    }
  }, 90000);

  it("preserves equation and calculator terms for calculator-useful document prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find me an NHM2 document that has equations I can use in the scientific calculator.",
        mode: "read",
        debug: true,
        sessionId: `e57-calculator-equations-${Date.now()}`,
      })
      .expect(200);

    const generatedQueries = response.body?.retrieval_query_integrity?.generated_queries ?? [];
    expect(generatedQueries.join(" ")).toMatch(/NHM2/i);
    expect(generatedQueries.join(" ")).toMatch(/equation|formula/i);
    expect(generatedQueries.join(" ")).toMatch(/calculator/i);
    expect(response.body?.retrieval_query_integrity?.valid).toBe(true);
    expect(["doc_equation_location", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    if (response.body?.terminal_artifact_kind === "doc_equation_location") {
      expect(answerText(response.body)).toMatch(/Equation-bearing source:|Equation markers:|Snippet:/i);
    } else {
      expect(response.body?.terminal_error_code ?? answerText(response.body)).toMatch(/equation_source_unavailable/i);
      expect(answerText(response.body)).toMatch(/equation-bearing snippets|equation_source_unavailable/i);
    }
  }, 90000);
});
