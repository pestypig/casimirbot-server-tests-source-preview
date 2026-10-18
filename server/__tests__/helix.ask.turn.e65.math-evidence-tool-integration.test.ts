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
const answerText = (body: any): string => String(body?.selected_final_answer ?? body?.text ?? "");

describe("helix ask E65 math evidence tool integration", () => {
  it("consumes a scored math evidence artifact for calculator source prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find me an NHM2 source with a calculator-usable equation.",
        mode: "read",
        debug: true,
        sessionId: `e65-tool-equation-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("doc_equation_location");
    expect(answerText(response.body)).toContain("properTimeS_expected = alpha * T");
    const equation = ledger(response.body).find((artifact) => artifact?.kind === "doc_equation_location");
    expect(equation?.payload?.anti_brittleness_audit?.hardcoded_source_path_used).toBe(false);
    expect(equation?.payload?.anti_brittleness_audit?.selected_by_score).toBe(true);
  }, 90000);

  it("uses synthesis artifacts for NHM2 alpha interpretation prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Using the current NHM2 evidence, does alpha=0.7 shorten proper time or change coordinate time?",
        mode: "read",
        debug: true,
        sessionId: `e65-tool-synthesis-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(answerText(response.body)).toMatch(/shortens ship proper time relative to coordinate time/i);
    expect(answerText(response.body)).toMatch(/does not change coordinate time/i);
    expect(answerText(response.body)).toContain("properVsCoordinate_ratio = 0.7");
    expect(answerText(response.body)).toContain("coordinateVsClassical_ratio = 1");
  }, 90000);

  it("uses calculator evidence artifacts for mission-time calculator input prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Use the mission-time comparison evidence to prepare calculator inputs for alpha 0p7000.",
        mode: "read",
        debug: true,
        sessionId: `e65-tool-table-inputs-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("doc_calculator_evidence");
    expect(answerText(response.body)).toMatch(/Calculator-usable evidence/i);
    expect(answerText(response.body)).toContain("proper_time = alpha * coordinate_time");
    expect(answerText(response.body)).toContain("shiftLapseCenterlineDtauDt");
    expect(answerText(response.body)).toContain("0.7");
    const calculatorEvidence = ledger(response.body).find((artifact) => artifact?.kind === "doc_calculator_evidence");
    expect(calculatorEvidence?.payload?.anti_brittleness_audit?.hardcoded_source_path_used).toBe(false);
    expect(calculatorEvidence?.payload?.anti_brittleness_audit?.selected_by_score).toBe(true);
  }, 90000);

  it("uses the math evidence tool for explicit doc-path calculator relation prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open /docs/research/nhm2-frontier-distance-report.md and show me the calculator relation.",
        mode: "read",
        debug: true,
        sessionId: `e65-tool-explicit-path-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("doc_equation_location");
    expect(answerText(response.body)).toContain("/docs/research/nhm2-frontier-distance-report.md");
    expect(answerText(response.body)).toContain("properTimeS_expected = alpha * T");
    expect(answerText(response.body)).not.toContain("equation_source_unavailable");
  }, 90000);
});
