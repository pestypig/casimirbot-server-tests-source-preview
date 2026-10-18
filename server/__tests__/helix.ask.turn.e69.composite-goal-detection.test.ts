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

describe("helix ask E69 composite goal detection", () => {
  it("detects two workspace actions as a composite goal", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Situation Room Sources and show the docs directory",
        mode: "read",
        debug: true,
        sessionId: `e69-detect-two-workspace-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("composite_goal");
    expect(response.body?.terminal_artifact_kind).toBe("composite_turn_receipt");
    const actionKeys = response.body?.composite_turn_receipt?.subgoal_results?.flatMap((result: any) => result.action_keys ?? []);
    expect(actionKeys).toEqual(expect.arrayContaining(["situation-room-sources.open", "docs-viewer.open_directory"]));
  }, 60000);

  it("keeps single workspace actions single-lane", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Scientific Calculator",
        mode: "read",
        debug: true,
        sessionId: `e69-single-workspace-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(response.body?.composite_turn_receipt).toBeUndefined();
  }, 60000);

  it("does not mark a single document-open prompt composite", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open the best NHM2 document about alpha 0p7000 mission time comparison",
        mode: "read",
        debug: true,
        sessionId: `e69-single-doc-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_open_best");
    expect(response.body?.terminal_artifact_kind).not.toBe("composite_turn_receipt");
  }, 90000);
});
