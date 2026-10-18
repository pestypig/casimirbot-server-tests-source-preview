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

describe("helix ask turn e8.12 transition precedence + uncertainty-safe finalization", () => {
  it("uses resolved transition as final reason after turn-transition abort during docs disambiguation", async () => {
    const app = createApp();
    const sessionId = "e812-resolve-precedence";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "docs",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.pending_status_after).toBe("resolved");
    expect(response.body?.pending_transition_reason).toBe("pending_clarify_resolved");
    expect(Array.isArray(response.body?.pending_transition_trace)).toBe(true);
    expect(response.body?.pending_transition_trace).toContain("turn_transition_pending_abort");
    expect(response.body?.pending_transition_trace).toContain("pending_clarify_resolved");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
  });

  it("uses canceled transition as final reason and does not emit terminal error code", async () => {
    const app = createApp();
    const sessionId = "e812-cancel-precedence";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "cancel",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(response.body?.pending_status_after).toBe("canceled");
    expect(response.body?.pending_transition_reason).toBe("pending_clarify_canceled");
    expect(response.body?.pending_transition_trace).toContain("turn_transition_pending_abort");
    expect(response.body?.pending_transition_trace).toContain("pending_clarify_canceled");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
  });

  it("keeps expired transition as typed terminal error", async () => {
    const app = createApp();
    const sessionId = "e812-expired";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "[[TEST_FORCE_EXPIRE_PENDING]] docs",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(response.body?.pending_status_after).toBe("expired");
    expect(response.body?.pending_transition_reason).toBe("pending_resolution_expired");
    expect(response.body?.terminal_error_code).toBe("pending_resolution_expired");
  });

  it("keeps compare prompt uncertainty-safe when evidence is missing", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this doc with my notes and tell me differences",
        mode: "read",
        sessionId: "e812-needs-retrieval",
      })
      .expect(200);

    expect(response.body?.needs_retrieval).toBe(true);
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("needs retrieval");
  });
});
