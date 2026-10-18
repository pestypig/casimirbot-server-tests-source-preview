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

const answerText = (body: any): string =>
  String(body?.selected_final_answer ?? body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

const artifactKinds = (body: any): string[] =>
  Array.isArray(body?.current_turn_artifact_ledger)
    ? body.current_turn_artifact_ledger.map((artifact: any) => String(artifact?.kind ?? "")).filter(Boolean)
    : [];

describe("helix ask E66 workspace action terminal discipline", () => {
  it("keeps Workflow Timeline out of document recovery", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Workflow Timeline",
        mode: "read",
        debug: true,
        sessionId: `e66-workflow-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(response.body?.capability_selection_result?.capability_id).toBe("workstation-workflow-timeline.open");
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(response.body?.terminal_error_code ?? null).not.toBe("document_summary_recovery_failed");
    expect(answerText(response.body)).not.toMatch(/summarize|document|retrieval recovery/i);
    expect(artifactKinds(response.body)).not.toContain("doc_evidence_location");
  }, 60000);

  it("does not use terminal consistency violation for Task History", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Task History",
        mode: "read",
        debug: true,
        sessionId: `e66-task-history-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.capability_selection_result?.capability_id).toBe("agi-task-history.open");
    expect(response.body?.terminal_error_code ?? null).not.toBe("terminal_consistency_violation");
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(answerText(response.body)).toMatch(/Task History/i);
  }, 60000);
});
