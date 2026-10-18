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

describe("helix ask turn e8.27 typed transition errors", () => {
  it("emits typed double-terminal transition error", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "[[TEST_PREEMIT_TERMINAL]] hello",
        mode: "read",
        sessionId: "e827-double-terminal",
      })
      .expect(500);

    expect(response.body?.terminal_error_code).toBe("double_terminal_emit");
    expect(response.body?.turn_transition_error_code).toBe("turn_transition_double_terminal");
    expect(response.body?.turn_transition_error_class).toBe("turnTransition");
  });

  it("emits typed pending-expired transition error", async () => {
    const app = createApp();
    const sessionId = "e827-pending-expired";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const expired = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "[[TEST_FORCE_EXPIRE_PENDING]] docs",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(expired.body?.terminal_error_code).toBe("pending_resolution_expired");
    expect(expired.body?.turn_transition_error_code).toBe("turn_transition_pending_expired");
    expect(expired.body?.turn_transition_error_class).toBe("turnTransition");
  });

  it("emits typed pending-abort transition code when prior pending turn is superseded", async () => {
    const app = createApp();
    const sessionId = "e827-pending-abort";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const followup = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open up notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(Array.isArray(followup.body?.pending_transition_trace)).toBe(true);
    expect(followup.body?.pending_transition_trace).toContain("turn_transition_pending_abort");
    expect(followup.body?.turn_transition_error_code).toBe("turn_transition_pending_abort");
    expect(followup.body?.turn_transition_error_class).toBe("turnTransition");
  });
});
