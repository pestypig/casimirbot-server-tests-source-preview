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

describe("helix ask E64 equation-usable evidence contract", () => {
  it("prefers an explicit NHM2 calculator formula source when one exists", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find me an NHM2 source with a calculator-usable equation.",
        mode: "read",
        debug: true,
        sessionId: `e64-explicit-equation-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_equation_location");
    expect(response.body?.terminal_artifact_kind).toBe("doc_equation_location");
    expect(answerText(response.body)).toMatch(/Equation-bearing source:/i);
    expect(answerText(response.body)).toContain("/docs/research/nhm2-frontier-distance-report.md");
    expect(answerText(response.body)).toContain("properTimeS_expected = alpha * T");

    const equationArtifact = ledger(response.body).find((artifact) => artifact?.kind === "doc_equation_location");
    expect(equationArtifact?.payload?.source_path).toBe("/docs/research/nhm2-frontier-distance-report.md");
    expect(JSON.stringify(equationArtifact?.payload?.snippets ?? [])).toContain("properTimeS_expected = alpha * T");
  }, 90000);

  it("accepts table-shaped NHM2 calculator evidence when the selected source has usable fields", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "In docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-2026-04-27.md, find calculator-usable NHM2 evidence for alpha proper time versus coordinate time.",
        mode: "read",
        debug: true,
        sessionId: `e64-table-evidence-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_equation_location");
    expect(["doc_equation_location", "doc_calculator_evidence"]).toContain(response.body?.terminal_artifact_kind);

    const calculatorArtifact = ledger(response.body).find((artifact) => artifact?.kind === "doc_calculator_evidence");
    expect(calculatorArtifact).toBeTruthy();
    expect(calculatorArtifact?.payload?.derived_formula).toBe("proper_time = alpha * coordinate_time");
    expect(JSON.stringify(calculatorArtifact?.payload?.fields ?? [])).toMatch(/shiftLapseCenterline(?:Alpha|DtauDt)|properVsCoordinate_ratio/);
  }, 90000);
});
