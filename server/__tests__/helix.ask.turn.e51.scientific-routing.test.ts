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

const FORCE_RECOVERY_TIMEOUT = "[[TEST_FORCE_RECOVERY_TIMEOUT]]";

describe("helix ask E51 scientific routing and conceptual compare guards", () => {
  it("keeps conceptual versus wording on the model-only path", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Is proper time versus coordinate time basically traveler clock time versus coordinate label time?",
        mode: "read",
        debug: true,
        sessionId: `e51-conceptual-versus-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.canonical_goal_frame?.answer_scope).toBe("model_only");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("direct_answer_text");
    expect(response.body?.tool_choice_arbitration?.answer_scope).toBe("model_only");
    expect(response.body?.terminal_artifact_kind).not.toBe("comparison_summary");
    expect(response.body?.terminal_artifact_kind).not.toBe("doc_vs_note_compare");
    expect(response.body?.terminal_error_code).not.toBe("retrieval_recovery_failed");
  }, 60000);

  it("maps NHM2 alpha 0p995 recovery timeouts to numeric-result typed failure", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          `${FORCE_RECOVERY_TIMEOUT} I am hunting the NHM2 frontier-distance number around alpha 0p995; find the strongest source and give the actual value, not a broad summary.`,
        mode: "read",
        debug: true,
        sessionId: `e51-numeric-timeout-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_scientific_numeric");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("doc_numeric_answer");
    expect(response.body?.canonical_goal_frame?.numeric_tokens ?? []).toEqual(
      expect.arrayContaining(["0p995", "0.995", "alpha 0p995", "alpha 0.995"]),
    );
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(response.body?.terminal_error_code).toBe("numeric_result_unavailable");
    expect(response.body?.terminal_consistency_check?.consistent).toBe(true);
    expect(String(response.body?.selected_final_answer ?? response.body?.text ?? "")).not.toMatch(
      /summarize the current document|retrieval recovery/i,
    );
  }, 90000);

  it("maps NHM2 alpha 0p7000 recovery timeouts to concept-explanation typed failure", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          `${FORCE_RECOVERY_TIMEOUT} For NHM2 warp-profile work, translate alpha 0p7000 into normal words. What is that parameter doing?`,
        mode: "read",
        debug: true,
        sessionId: `e51-concept-timeout-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_scientific_concept");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("doc_concept_explanation");
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(response.body?.terminal_error_code).toBe("concept_explanation_unavailable");
    expect(response.body?.terminal_error_code).not.toBe("terminal_consistency_violation");
    expect(response.body?.terminal_consistency_check?.consistent).toBe(true);
  }, 90000);

  it("does not expose rejected active-doc summaries as the final text for concept failures", async () => {
    const app = createApp();
    const activePath = "/docs/research/nhm2-follow-up-patch-runbook.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "For NHM2 warp-profile work, translate alpha 0p7000 into normal words. What is that parameter doing?",
        mode: "read",
        debug: true,
        sessionId: `e51-concept-active-doc-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs",
          activeDocPath: activePath,
          docViewer: { currentPath: activePath },
        },
      })
      .expect(200);

    const answer = String(response.body?.selected_final_answer ?? response.body?.text ?? "");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_scientific_concept");
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(response.body?.terminal_error_code).toBe("concept_explanation_unavailable");
    expect(answer).toContain("concept_explanation_unavailable");
    expect(answer).not.toMatch(/^Explained\s+\//i);
    expect(answer).not.toContain("Key claim:");
    expect(response.body?.terminal_consistency_check?.consistent).toBe(true);
  }, 90000);
});
