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

const assertIncrementalEventInvariants = (events: any[]): void => {
  expect(Array.isArray(events)).toBe(true);
  expect(events[0]?.type).toBe("turn_started");
  expect(events.at(-1)?.type).toBe("turn_completed");
  expect(events.filter((event) => event?.type === "terminal_answer")).toHaveLength(1);
  expect(events.filter((event) => event?.type === "turn_completed")).toHaveLength(1);

  const started = new Set<string>();
  for (const event of events) {
    if (event?.type === "item_started") {
      started.add(String(event.step_id));
    }
    if (event?.type === "tool_result" || event?.type === "item_completed") {
      expect(started.has(String(event.step_id))).toBe(true);
    }
  }
};

describe("helix ask turn e10.27 incremental runtime events", () => {
  it("emits codex-style turn, plan, item, observation, terminal lifecycle events", async () => {
    const app = createApp();
    const sessionId = `e1027-events-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "look in the docs for helix ask terminal artifact source of truth and put a useful summary into transcript audit note",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const events = response.body?.turn_events ?? [];
    assertIncrementalEventInvariants(events);
    expect(["incremental", "incremental_reconstructed", "async_incremental"]).toContain(response.body?.runtime_loop_mode);
    expect(response.body?.runtime_event_count).toBe(events.length);
    expect(events.some((event: any) => event?.type === "plan_delta")).toBe(true);
    expect(events.some((event: any) => event?.type === "model_decision_started")).toBe(true);
    expect(events.some((event: any) => event?.type === "model_decision_completed")).toBe(true);
    expect(events.some((event: any) => event?.type === "tool_result")).toBe(true);
    expect(events.some((event: any) => event?.type === "observation_recorded")).toBe(true);
    expect(events.some((event: any) => event?.type === "decision_delta")).toBe(true);
    expect(events.find((event: any) => event?.type === "terminal_answer")?.text).toBe(
      "Added summary to transcript audit.",
    );
  });

  it("streams multi-step retrieval-to-note plan deltas after observations", async () => {
    const app = createApp();
    const sessionId = `e1027-multistep-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "look in docs for helix ask agent loop details and put the useful summary into codex runtime note",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const events = response.body?.turn_events ?? [];
    assertIncrementalEventInvariants(events);
    const planDeltaIndexes = events
      .map((event: any, index: number) => (event?.type === "plan_delta" ? index : -1))
      .filter((index: number) => index >= 0);
    const observationIndexes = events
      .map((event: any, index: number) => (event?.type === "observation_recorded" ? index : -1))
      .filter((index: number) => index >= 0);

    expect(planDeltaIndexes.length).toBeGreaterThanOrEqual(3);
    expect(observationIndexes.length).toBeGreaterThanOrEqual(2);
    expect(planDeltaIndexes[1]).toBeGreaterThan(observationIndexes[0]);
    expect(events.some((event: any) => event?.type === "model_decision_completed" && event?.phase === "continuation")).toBe(true);
  });
});
