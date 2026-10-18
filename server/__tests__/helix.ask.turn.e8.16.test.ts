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

describe("helix ask turn e8.16 explicit cancel contract", () => {
  it("returns typed cancel:no_pending when cancel is sent without pending input", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "cancel",
        mode: "read",
        sessionId: "e816-no-pending-cancel",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("cancel:no_pending");
    expect(response.body?.route).toBe("cancel:no_pending");
    expect(response.body?.lane).toBe("conversation");
    expect(response.body?.dispatch_policy).toBe("conversation_only");
    expect(String(response.body?.text ?? "")).toContain("No pending action to cancel.");
    expect(response.body?.pending_server_request ?? null).toBeNull();
    expect(response.body?.pending_transition_trace).toContain("cancel_no_pending");
  });

  it("cancels pending clarify requests with explicit cancel", async () => {
    const app = createApp();
    const sessionId = "e816-clarify-cancel";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open document",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const canceled = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "cancel",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(canceled.body?.route_reason_code).toBe("suppressed:low_salience");
    expect(String(canceled.body?.text ?? "").toLowerCase()).toContain("canceled");
    expect(canceled.body?.pending_server_request ?? null).toBeNull();
    expect(canceled.body?.pending_transition_trace).toContain("pending_clarify_canceled");
  });

  it("cancels pending confirmation requests with explicit cancel", async () => {
    const app = createApp();
    const sessionId = "e816-confirm-cancel";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "delete note nhm2 scratchpad",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const canceled = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "cancel",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(canceled.body?.route_reason_code).toBe("suppressed:low_salience");
    expect(String(canceled.body?.text ?? "").toLowerCase()).toContain("canceled");
    expect(canceled.body?.pending_server_request ?? null).toBeNull();
    expect(canceled.body?.pending_transition_trace).toContain("pending_confirmation_canceled");
  });
});
