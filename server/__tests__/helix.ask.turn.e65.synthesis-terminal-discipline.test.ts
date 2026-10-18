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

describe("helix ask E65 synthesis terminal discipline", () => {
  it("does not let recommendation prompts terminate as raw Locations", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Now use the workspace again: based on the current NHM2 doc and my Helix workflow audit scratch note, what should I verify next?",
        mode: "read",
        debug: true,
        sessionId: `e65-synthesis-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_evidence_synthesis");
    expect(["doc_evidence_synthesis_answer", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/^Locations:/i);
    if (response.body?.terminal_artifact_kind === "typed_failure") {
      expect(response.body?.terminal_error_code).toBe("synthesis_unavailable");
      expect(String(response.body?.selected_final_answer ?? "")).toMatch(/synthesis_unavailable/i);
    }
  }, 90000);
});
