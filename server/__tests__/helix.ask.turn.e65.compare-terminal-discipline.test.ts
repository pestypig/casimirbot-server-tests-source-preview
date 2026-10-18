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

describe("helix ask E65 compare terminal discipline", () => {
  it("normalizes missing compare evidence to a clean typed compare failure", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Compare current NHM2 doc against my Helix workflow audit scratch note and tell me what the note captures versus misses.",
        mode: "read",
        debug: true,
        sessionId: `e65-compare-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_vs_note_compare");
    expect(response.body?.terminal_error_code).not.toBe("terminal_consistency_violation");
    expect(["doc_vs_note_compare", "comparison_summary", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    if (response.body?.terminal_artifact_kind === "typed_failure") {
      expect(String(response.body?.terminal_error_code ?? "")).toMatch(/^compare_/);
    }
  }, 90000);
});
