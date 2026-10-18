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

describe("helix ask E65 valid evidence handoff", () => {
  it("blocks note append from consuming a failed prior locate result", async () => {
    const app = createApp();
    const sessionId = `e65-handoff-${Date.now()}`;

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find where shiftLapseCenterlineDtauDt or properVsCoordinate_ratio_missing_anchor appears.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Add the alpha 0.7 evidence location you just found to my note.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(response.body?.evidence_handoff_decision?.decision).toBe("handoff_blocked");
    expect(response.body?.terminal_error_code).toBe("prior_evidence_invalid");
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/prior_evidence_invalid/i);
  }, 120000);
});
