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

describe("helix ask turn e8.11 pending lifecycle + transition safety", () => {
  it("tracks pending clarify pending->resolved with request id continuity", async () => {
    const app = createApp();
    const sessionId = "e811-resolve";
    const first = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(first.body?.pending_status_before ?? null).toBeNull();
    expect(first.body?.pending_status_after).toBe("pending");
    expect(first.body?.pending_request_id).toContain("pending:");
    const requestId = String(first.body?.pending_request_id ?? "");

    const second = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "docs",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(second.body?.route_reason_code).toBe("dispatch:act");
    expect(second.body?.pending_status_before).toBe("pending");
    expect(second.body?.pending_status_after).toBe("resolved");
    expect(second.body?.pending_request_id).toBe(requestId);
    expect(second.body?.pending_server_request ?? null).toBeNull();
  });

  it("tracks pending clarify pending->canceled on cancel", async () => {
    const app = createApp();
    const sessionId = "e811-cancel";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
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
    expect(canceled.body?.pending_status_before).toBe("pending");
    expect(canceled.body?.pending_status_after).toBe("canceled");
    expect(canceled.body?.pending_server_request ?? null).toBeNull();
  });

  it("returns typed expired pending code when pending is forced expired in test mode", async () => {
    const app = createApp();
    const sessionId = "e811-expired";
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
    expect(expired.body?.pending_status_before).toBe("pending");
    expect(expired.body?.pending_status_after).toBe("expired");
    expect(expired.body?.pending_transition_reason).toBe("pending_resolution_expired");
  });

  it("keeps transition trace for turn abort but reports reopened pending as final reason", async () => {
    const app = createApp();
    const sessionId = "e811-transition-abort";
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
        question: "not sure yet",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(followup.body?.pending_status_before).toBe("pending");
    expect(followup.body?.pending_status_after).toBe("pending");
    expect(followup.body?.pending_transition_reason).toBe("pending_clarify_unresolved");
    expect(followup.body?.pending_transition_trace).toContain("turn_transition_pending_abort");
    expect(followup.body?.terminal_error_code ?? null).toBeNull();
  });
});
