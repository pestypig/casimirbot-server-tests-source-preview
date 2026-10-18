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

describe("helix ask E57 no-tool doc residue guard", () => {
  it("keeps background-only equation questions model-only and free of doc-search residue", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Background only: what is an equation of motion?",
        mode: "read",
        debug: true,
        sessionId: `e57-background-equation-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs",
          activeDocPath: "/docs/audits/nhm2-observer-audit.md",
        },
      })
      .expect(200);

    expect(response.body?.turn_scope_contract?.answer_scope).toBe("model_only");
    expect(response.body?.retrieval_required_signal?.required).toBe(false);
    expect(response.body?.equation_retrieval_intent?.required).toBe(false);
    expect(response.body?.terminal_artifact_kind).toMatch(/direct_answer_text|typed_failure/);
    expect(answerText(response.body)).not.toMatch(
      /Searched document:|Searched documents:|No locations found|Tried:|Path:\s*\/?docs\/|Open location|doc_location_matches/i,
    );
    if (response.body?.terminal_artifact_kind !== "typed_failure") {
      expect(response.body?.no_tool_contamination_check?.verdict).toBe("clean");
    }
  }, 60000);
});
