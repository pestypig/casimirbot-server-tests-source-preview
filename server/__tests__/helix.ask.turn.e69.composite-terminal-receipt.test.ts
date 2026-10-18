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

const textOf = (body: any): string => String(body?.selected_final_answer ?? body?.assistant_answer ?? body?.answer ?? "");

describe("helix ask E69 composite terminal receipt", () => {
  it("renders both requested panel actions from a composite receipt", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Situation Room Pipelines and open Scientific Calculator",
        mode: "read",
        debug: true,
        sessionId: `e69-two-panels-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("composite_turn_receipt");
    const receipt = response.body?.composite_turn_receipt;
    const actionKeys = receipt?.subgoal_results?.flatMap((result: any) => result.action_keys ?? []);
    expect(actionKeys).toEqual(expect.arrayContaining(["situation-room-pipelines.open", "scientific-calculator.open"]));
    expect(textOf(response.body)).toContain("Situation Room Pipelines");
    expect(textOf(response.body)).toContain("Scientific Calculator");
    expect(receipt?.completed_count).toBeGreaterThanOrEqual(2);
  }, 60000);

  it("renders document open and panel action outcomes together", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open the best NHM2 document about alpha 0p7000 mission time comparison and open Situation Room Sources",
        mode: "read",
        debug: true,
        sessionId: `e69-doc-panel-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("composite_turn_receipt");
    const results = response.body?.composite_turn_receipt?.subgoal_results ?? [];
    expect(results.map((result: any) => result.kind)).toEqual(expect.arrayContaining(["doc_open_best", "workspace_action"]));
    expect(JSON.stringify(results)).toContain("doc_open_receipt");
    expect(JSON.stringify(results)).toContain("situation-room-sources.open");
    expect(textOf(response.body)).toContain("Opened document");
    expect(textOf(response.body)).toContain("Situation Room Sources");

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(response.body.turn_id)}/debug-export`)
      .expect(200);
    expect(debugExport.body?.payload?.composite_turn_receipt?.kind).toBe("composite_turn_receipt");
    expect(debugExport.body?.payload?.subgoal_artifact_map?.length).toBeGreaterThanOrEqual(2);
  }, 90000);

  it("keeps equation lookup failures visible beside completed calculator action", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find the equation tau = alpha T in the current document and open Scientific Calculator",
        mode: "read",
        debug: true,
        sessionId: `e69-equation-calculator-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("composite_turn_receipt");
    const results = response.body?.composite_turn_receipt?.subgoal_results ?? [];
    expect(results.map((result: any) => result.kind)).toEqual(expect.arrayContaining(["doc_equation_location", "workspace_action"]));
    expect(JSON.stringify(results)).toContain("scientific-calculator.open");
    expect(textOf(response.body)).toContain("Scientific Calculator");
    expect(textOf(response.body)).toMatch(/Equation|equation/);
    expect(response.body?.terminal_error_code ?? null).not.toBe("terminal_consistency_violation");
  }, 90000);
});
