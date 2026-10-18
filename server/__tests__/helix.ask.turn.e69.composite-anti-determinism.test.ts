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

describe("helix ask E69 composite anti-determinism", () => {
  it("audits composite synthesis as receipt rendering only", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find the equation tau = alpha T in the current document and open Situation Room Sources",
        mode: "read",
        debug: true,
        sessionId: `e69-anti-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("composite_turn_receipt");
    expect(response.body?.composite_anti_determinism_audit?.verdict).toBe("clean");
    expect(response.body?.composite_anti_determinism_audit?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: "no_single_artifact_dominance", passed: true }),
        expect.objectContaining({ check: "no_hardcoded_science_answer", passed: true }),
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain("terminal_consistency_violation");
  }, 90000);
});
