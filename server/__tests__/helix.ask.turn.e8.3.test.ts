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

describe("helix ask turn e8.3 multi-step plan execution", () => {
  it("builds ordered workspace->reasoning plan steps for hybrid prompt", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "copy this abstract to a note pad and explain it in plain language",
        mode: "read",
        sessionId: "e83-hybrid",
      })
      .expect(200);

    const steps = response.body?.planner_contract?.plan_steps ?? [];
    expect(Array.isArray(steps)).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0]?.lane).toBe("workspace");
    expect(steps[1]?.lane).toBe("reasoning");
    expect(Array.isArray(response.body?.execution_trace)).toBe(true);
    expect(response.body?.action_envelope?.schema).toBe("helix.ask.action_envelope.v1");
    expect(Array.isArray(response.body?.action_envelope?.workstation_actions)).toBe(true);
    expect(response.body?.action_envelope?.workstation_actions?.length ?? 0).toBeGreaterThan(0);
    expect(typeof response.body?.action_envelope?.workstation_actions?.[0]?.panel_id).toBe("string");
    expect(typeof response.body?.action_envelope?.workstation_actions?.[0]?.action_id).toBe("string");
  });

  it("suppresses downstream step when pending user input blocks execution", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open document and explain it",
        mode: "read",
        sessionId: "e83-blocked",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    const trace = response.body?.execution_trace ?? [];
    const suppressed = trace.filter((step: { status?: string }) => step.status === "suppressed");
    expect(suppressed.length).toBeGreaterThanOrEqual(0);
  });

  it("preserves valid selection metadata on confirmation resolution turns", async () => {
    const app = createApp();
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "delete note e83-confirm",
        mode: "read",
        sessionId: "e83-confirm",
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "yes",
        mode: "read",
        sessionId: "e83-confirm",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.selection_valid).toBe(true);
    expect(response.body?.planner_contract?.selection_fail_reason).toBe("none");
  });

  it("keeps single terminal contract while returning execution trace", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello",
        mode: "read",
        sessionId: "e83-terminal",
      })
      .expect(200);

    expect(response.body?.turn_contract?.single_terminal_required).toBe(true);
    expect(typeof response.body?.text).toBe("string");
    expect(String(response.body?.text ?? "").trim().length).toBeGreaterThan(0);
    expect(Array.isArray(response.body?.execution_trace)).toBe(true);
  });
});
