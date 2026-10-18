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

describe("helix ask E62 evidence-to-synthesis guard", () => {
  it("does not let location-only output satisfy a conclusion question", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Now use the workspace again: does the current NHM2 evidence mean alpha is shortening proper time, changing coordinate time, or something else?",
        mode: "read",
        debug: true,
        sessionId: `e62-synthesis-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_evidence_synthesis");
    expect(["doc_evidence_synthesis_answer", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/^Locations:/);
    if (response.body?.terminal_artifact_kind === "typed_failure") {
      expect(response.body?.terminal_error_code).toBe("synthesis_unavailable");
    }
  }, 90000);

  it("keeps background-only concept answers sealed from terminal consistency failures", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Background only, without checking the workspace, explain whether alpha less than 1 means proper-time shortening.",
        mode: "read",
        debug: true,
        sessionId: `e62-background-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.retrieval_required_signal?.required).toBe(false);
    expect(["direct_answer_text", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    expect(response.body?.terminal_error_code).not.toBe("terminal_consistency_violation");
    expect(response.body?.terminal_error_code).not.toBe("retrieval_recovery_failed");
  }, 90000);
});
