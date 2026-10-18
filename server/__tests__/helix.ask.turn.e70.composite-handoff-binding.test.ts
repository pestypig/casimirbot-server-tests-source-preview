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

describe("helix ask E70 composite handoff binding", () => {
  it("binds a follow-up to the failed equation subgoal from the prior composite turn", async () => {
    const app = createApp();
    const sessionId = `e70-binding-${Date.now()}`;

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find the equation tau = alpha T in the current document and open Scientific Calculator",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    const followup = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What failed in the equation part?",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(followup.body?.canonical_goal_frame?.goal_kind).toBe("composite_followup");
    expect(followup.body?.composite_subgoal_reference_intent?.reference_kind).toBe("the_equation_part");
    expect(followup.body?.composite_subgoal_binding?.binding_status).toBe("bound");
    expect(followup.body?.composite_subgoal_binding?.selected_subgoal_ids?.[0]).toContain("doc_equation_location");
    expect(followup.body?.terminal_artifact_kind).toBe("composite_subgoal_explanation");
    expect(followup.body?.composite_subgoal_explanation?.source_scope).toBe("prior_turn_context");

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(followup.body.turn_id)}/debug-export`)
      .expect(200);
    expect(debugExport.body?.payload?.composite_subgoal_binding?.binding_status).toBe("bound");
    expect(debugExport.body?.payload?.composite_handoff_decision?.decision).toBe("handoff_allowed");
    expect(debugExport.body?.payload?.composite_followup_anti_determinism_audit?.verdict).toBe("clean");
  }, 90000);

  it("binds a prior doc-open subgoal when asked what document was opened", async () => {
    const app = createApp();
    const sessionId = `e70-doc-binding-${Date.now()}`;

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open the best NHM2 document about alpha 0p7000 mission time comparison and open Situation Room Sources",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    const followup = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What document did you open?",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(followup.body?.canonical_goal_frame?.goal_kind).toBe("composite_followup");
    expect(followup.body?.composite_subgoal_binding?.binding_status).toBe("bound");
    expect(followup.body?.composite_subgoal_binding?.selected_subgoal_ids?.[0]).toContain("doc_open_best");
    expect(followup.body?.terminal_artifact_kind).toBe("composite_subgoal_explanation");
    expect(String(followup.body?.selected_final_answer ?? "")).toContain("Opened document");
  }, 90000);
});
