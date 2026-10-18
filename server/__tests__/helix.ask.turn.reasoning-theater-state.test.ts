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

describe("helix ask reasoning theater live contract", () => {
  it("attaches canonical reasoning theater state to debug ask-turn responses", async () => {
    const app = createApp();
    const sessionId = `reasoning-theater-contract-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open panel docs-viewer",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(response.body?.debug?.reasoning_theater_state_v1).toMatchObject({
      contract_version: "reasoning_theater.v1",
      trace_id: expect.any(String),
      phase: expect.any(String),
      archetype: expect.any(String),
      certainty_class: expect.any(String),
      stance: expect.any(String),
      telemetry: expect.any(Object),
      indices: expect.any(Object),
      scenario_id: expect.any(String),
      seed: expect.any(Number),
      ts: expect.any(String),
    });
    expect(
      response.body.debug.reasoning_theater_state_v1.suppression_reason === null ||
        typeof response.body.debug.reasoning_theater_state_v1.suppression_reason === "string",
    ).toBe(true);
    expect(response.body.debug.reasoning_theater_state_v1.trace_id).toBe(response.body.debug.trace_id);
    expect(response.body.debug.trace_events).toEqual(expect.any(Array));
    expect(response.body.debug.trace_events.length).toBeGreaterThan(0);
  }, 60000);
});
