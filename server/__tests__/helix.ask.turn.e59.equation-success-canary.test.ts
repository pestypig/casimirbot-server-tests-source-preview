import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const CANARY_PATH = "/docs/test/nhm2-equation-canary.md";
const CANARY_SNIPPET = "tau_expected(alpha) = alpha * coordinateTimeS";

const ledger = (body: any): any[] => (Array.isArray(body?.current_turn_artifact_ledger) ? body.current_turn_artifact_ledger : []);
const answerText = (body: any): string => String(body?.selected_final_answer ?? body?.text ?? "");

describe("helix ask E59 equation success canary", () => {
  afterEach(() => {
    delete process.env.HELIX_ASK_E59_EQUATION_CANARY;
  });

  it("produces a valid doc_equation_location when an equation-bearing source exists", async () => {
    process.env.HELIX_ASK_E59_EQUATION_CANARY = "1";

    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find me an NHM2 document that has equations I can use in the scientific calculator.",
        mode: "read",
        debug: true,
        sessionId: `e59-equation-canary-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_equation_location");
    expect(response.body?.terminal_artifact_kind).toBe("doc_equation_location");
    expect(answerText(response.body)).toMatch(/Equation-bearing source:/i);
    expect(answerText(response.body)).toContain(CANARY_PATH);
    expect(answerText(response.body)).toContain(CANARY_SNIPPET);

    const equationArtifact = ledger(response.body).find((artifact) => artifact?.kind === "doc_equation_location");
    expect(equationArtifact?.payload?.evidence_kind).toBe("equation");
    expect(equationArtifact?.payload?.source_path).toBe(CANARY_PATH);
    expect(equationArtifact?.payload?.snippets?.[0]?.text).toContain(CANARY_SNIPPET);
    expect(equationArtifact?.payload?.snippets?.[0]?.equation_like).toBe(true);
    expect(String((equationArtifact?.payload?.equation_markers ?? []).join(" "))).toMatch(/=|tau_expected/);
    expect(response.body?.equation_attempt_debug?.equation_location_validation?.valid).toBe(true);
  }, 90000);

  it("keeps background-only equation questions sealed from equation retrieval", async () => {
    process.env.HELIX_ASK_E59_EQUATION_CANARY = "1";

    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Background only: what is an equation of motion?",
        mode: "read",
        debug: true,
        sessionId: `e59-background-equation-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.canonical_goal_frame?.answer_scope).toBe("model_only");
    expect(["direct_answer_text", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    if (response.body?.terminal_artifact_kind === "typed_failure") {
      expect(response.body?.terminal_error_code).toMatch(/direct_answer_unavailable|model_only_answer_unavailable/);
    }
    expect(response.body?.equation_attempt_debug ?? null).toBeNull();
    expect(ledger(response.body).some((artifact) => artifact?.kind === "equation_extraction_attempt")).toBe(false);
  }, 90000);
});
