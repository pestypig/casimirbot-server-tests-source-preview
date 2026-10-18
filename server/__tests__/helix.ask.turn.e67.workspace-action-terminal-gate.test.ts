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

const panelPrompts = [
  ["Open the Docs & Papers panel", "docs-viewer.open"],
  ["Show the docs directory", "docs-viewer.open_directory"],
  ["Open Workstation Notes", "workstation-notes.open"],
  ["Open Clipboard History", "workstation-clipboard-history.open"],
  ["Open Situation Room Sources", "situation-room-sources.open"],
  ["Open Situation Room Pipelines", "situation-room-pipelines.open"],
  ["Open Workflow Timeline", "workstation-workflow-timeline.open"],
  ["Open Essence Console", "agi-essence-console.open"],
  ["Open Task History", "agi-task-history.open"],
  ["Open Scientific Calculator", "scientific-calculator.open"],
];

const textOf = (body: any): string => String(body?.selected_final_answer ?? body?.assistant_answer ?? body?.answer ?? "");

const artifactKinds = (body: any): string[] =>
  Array.isArray(body?.current_turn_artifact_ledger)
    ? body.current_turn_artifact_ledger.map((artifact: any) => String(artifact?.kind ?? "")).filter(Boolean)
    : [];

describe("helix ask E67 workspace action terminal gate", () => {
  it.each(panelPrompts)("%s completes only from a workspace action receipt", async (prompt, actionKey) => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: prompt,
        mode: "read",
        debug: true,
        sessionId: `e67-terminal-${String(actionKey).replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}`,
      })
      .expect(200);

    const receipt = response.body?.panel_action_receipt;
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(receipt?.action_key).toBe(actionKey);
    expect(receipt?.kind).toBe("workspace_action_receipt");
    expect(response.body?.terminal_error_code ?? null).not.toBe("terminal_consistency_violation");
    expect(response.body?.terminal_error_code ?? null).not.toBe("document_summary_recovery_failed");
    expect(textOf(response.body)).not.toBe("Executed workstation action.");
    expect(artifactKinds(response.body)).not.toEqual(expect.arrayContaining(["doc_summary", "doc_evidence_location"]));
  }, 60000);

  it("does not let document-open prompts get claimed by workspace actions", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open the best NHM2 document about alpha 0p7000 mission time comparison.",
        mode: "read",
        debug: true,
        sessionId: `e67-doc-open-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_open_best");
    expect(response.body?.terminal_artifact_kind).not.toBe("workspace_action_receipt");
    expect(artifactKinds(response.body)).not.toContain("workspace_action_receipt");
  }, 90000);

  it("normalizes unknown panel actions into typed workspace failures", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Panel Quantum Banana Shelf",
        mode: "read",
        debug: true,
        sessionId: `e67-unknown-panel-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(response.body?.terminal_error_code).toBe("workspace_action_unknown");
    expect(response.body?.terminal_error_code).not.toBe("terminal_consistency_violation");
    expect(artifactKinds(response.body)).toContain("typed_failure");
  }, 60000);
});
