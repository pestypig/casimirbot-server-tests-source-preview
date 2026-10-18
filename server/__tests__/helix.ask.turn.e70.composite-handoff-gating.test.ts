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

describe("helix ask E70 composite handoff gating", () => {
  it("blocks failed equation subgoals from feeding note append", async () => {
    const app = createApp();
    const sessionId = `e70-gating-${Date.now()}`;

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find the equation tau = alpha T in the current document and open Scientific Calculator",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Add the equation result to my note.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("composite_followup");
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(response.body?.terminal_error_code).toBe("composite_subgoal_unusable");
    expect(response.body?.composite_handoff_decision?.decision).toBe("handoff_blocked");
    expect(JSON.stringify(response.body?.composite_handoff_decision)).toContain("failed_subgoal");
    expect(JSON.stringify(response.body?.current_turn_artifact_ledger ?? [])).not.toContain("note_update_receipt");
  }, 90000);
});
