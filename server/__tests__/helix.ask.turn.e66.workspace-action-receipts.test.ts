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

const receipts = (body: any): any[] =>
  Array.isArray(body?.current_turn_artifact_ledger)
    ? body.current_turn_artifact_ledger
        .filter((artifact: any) => artifact?.kind === "workspace_action_receipt")
        .map((artifact: any) => artifact?.payload)
    : [];

describe("helix ask E66 workspace action receipts", () => {
  it("backs docs directory with an action-specific receipt", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Show the docs directory",
        mode: "read",
        debug: true,
        sessionId: `e66-docs-dir-${Date.now()}`,
      })
      .expect(200);

    const receipt = receipts(response.body).find((entry) => entry?.action_key === "docs-viewer.open_directory");
    expect(receipt).toEqual(
      expect.objectContaining({
        target_id: "docs-viewer",
        action_id: "open_directory",
        status: "dispatched",
      }),
    );
    expect(answerText(response.body)).toMatch(/Opening docs directory|Opened docs directory/i);
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
  }, 60000);

  it.each([
    ["Open Scientific Calculator", "scientific-calculator", "Scientific Calculator"],
    ["Open Essence Console", "agi-essence-console", "Essence Console"],
  ])("uses receipt text for %s", async (prompt, targetId, label) => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: prompt,
        mode: "read",
        debug: true,
        sessionId: `e66-receipt-${targetId}-${Date.now()}`,
      })
      .expect(200);

    const receipt = receipts(response.body).find((entry) => entry?.target_id === targetId);
    expect(receipt).toEqual(
      expect.objectContaining({
        action_key: `${targetId}.open`,
        action_id: "open",
        target_label: label,
      }),
    );
    expect(answerText(response.body)).toContain(label);
    expect(answerText(response.body)).not.toMatch(/Executed workstation action|could not produce a substantive/i);
    expect(response.body?.final_answer_source).toBe("artifact_synthesis");
  }, 60000);
});
