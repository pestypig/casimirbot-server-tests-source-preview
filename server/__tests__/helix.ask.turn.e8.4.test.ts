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

describe("helix ask turn e8.4 request_user_input protocol", () => {
  it("creates typed missing-args pending request for open document", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open document",
        mode: "read",
        sessionId: "e84-open-document",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.pending_server_request?.required_fields).toContain("path");
    expect(response.body?.pending_server_request?.unresolved_fields).toContain("path");
    expect(response.body?.pending_server_request?.status).toBe("pending");
  });

  it("does not resolve pending clarify on unrelated follow-up text", async () => {
    const app = createApp();
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open document",
        mode: "read",
        sessionId: "e84-unrelated-followup",
      })
      .expect(200);

    const followup = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "read this doc to me",
        mode: "read",
        sessionId: "e84-unrelated-followup",
      })
      .expect(200);

    expect(followup.body?.route_reason_code).toBe("clarify:missing_args");
    expect(followup.body?.pending_server_request?.kind).toBe("clarify");
    expect(followup.body?.pending_server_request?.unresolved_fields).toContain("path");
    expect(String(followup.body?.text ?? "").toLowerCase()).toContain("still need");
  });

  it("resolves pending clarify when required path field is provided", async () => {
    const app = createApp();
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open document",
        mode: "read",
        sessionId: "e84-resolve-with-path",
      })
      .expect(200);

    const followup = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "docs/research/example.md",
        mode: "read",
        sessionId: "e84-resolve-with-path",
      })
      .expect(200);

    expect(followup.body?.route_reason_code).toBe("dispatch:act");
    expect(followup.body?.dispatch?.dispatch_hint).toBe(true);
    expect(followup.body?.pending_server_request ?? null).toBeNull();
  });

  it("cancels pending clarify when user says cancel", async () => {
    const app = createApp();
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open document",
        mode: "read",
        sessionId: "e84-cancel",
      })
      .expect(200);

    const followup = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "cancel",
        mode: "read",
        sessionId: "e84-cancel",
      })
      .expect(200);

    expect(followup.body?.route_reason_code).toBe("suppressed:low_salience");
    expect(String(followup.body?.text ?? "").toLowerCase()).toContain("canceled");
    expect(followup.body?.pending_server_request ?? null).toBeNull();
  });

  it("canonicalizes open up notes to workstation-notes.open", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open up notes",
        mode: "read",
        sessionId: "e84-open-up-notes",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.selection_valid).toBe(true);
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("open");
  });
});
