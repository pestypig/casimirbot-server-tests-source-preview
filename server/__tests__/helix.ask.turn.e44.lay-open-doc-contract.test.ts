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

const artifacts = (body: any): any[] =>
  (Array.isArray(body?.step_results) ? body.step_results : [])
    .map((step: any) => step?.result_artifact)
    .filter(Boolean);

const actionsOf = (body: any): any[] =>
  (body?.execution_trace ?? []).map((step: any) => step?.action).filter(Boolean);

const answerText = (body: any): string => String(body?.selected_final_answer ?? body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

describe("helix ask E44 lay query normalization and open-doc terminal contract", () => {
  it("normalizes lay trip-time wording before validating latest open-doc candidates", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to the latest doc about the warp profiles that saves trip time",
        mode: "read",
        debug: true,
        sessionId: `e44-lay-open-doc-${Date.now()}`,
      })
      .expect(200);

    const validation = artifacts(response.body).find((artifact) => artifact?.kind === "doc_candidate_validation");
    expect(validation).toBeTruthy();
    expect(validation?.ignored_terms).toContain("that");
    expect(validation?.requiredTerms).not.toContain("that");
    expect(validation?.requiredTerms).toEqual(expect.arrayContaining(["warp", "profile"]));
    expect(validation?.semantic_terms).toEqual(
      expect.arrayContaining(["travel time", "trip duration", "mission time", "route time", "time savings"]),
    );
    expect(response.body?.doc_candidate_validation_ignored_terms).toContain("that");
    expect(response.body?.doc_candidate_validation_semantic_terms).toContain("mission time");
    expect(response.body?.terminal_error_code).not.toBe("missing_required_artifacts");
    expect(answerText(response.body)).not.toMatch(/doc_summary|missing_required_artifacts/i);
  }, 60000);

  it("keeps weak open-doc candidates in clarify/unresolved contract instead of summary fallback", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to the latest doc about the warp profiles that saves trip time",
        mode: "read",
        debug: true,
        sessionId: `e44-open-doc-contract-${Date.now()}`,
      })
      .expect(200);

    const actions = actionsOf(response.body);
    expect(actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toBe(true);
    expect(actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "validate_doc_candidates")).toBe(true);
    if (!response.body?.open_doc_goal_satisfied) {
      expect(["open_doc_unresolved", "ambiguous_doc_candidates", undefined, null]).toContain(response.body?.terminal_error_code);
      expect(response.body?.doc_candidate_validation_needs_clarification).toBe(true);
      expect(answerText(response.body)).toMatch(/Which one should I open\?|could not confidently identify/i);
    }
    expect(response.body?.turn_runtime?.missing_required_artifacts ?? []).not.toContain("doc_summary");
  }, 60000);
});
