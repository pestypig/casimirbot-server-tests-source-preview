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

describe("helix ask turn e9.4 authoritative executor + strict pending ownership", () => {
  it("emits pending request ownership fields on clarify terminals", async () => {
    const app = createApp();
    const sessionId = "e94-pending-fields";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create a note", mode: "read", sessionId })
      .expect(200);

    expect(String(response.body?.route_reason_code ?? "")).toContain("clarify:");
    expect(response.body?.pending_server_request?.request_id).toBeTruthy();
    expect(response.body?.pending_server_request?.turn_id).toBe(response.body?.turn_id);
    expect(response.body?.pending_server_request?.session_id).toBe(sessionId);
  });

  it("blocks unrelated replanning while clarify pending remains unresolved", async () => {
    const app = createApp();
    const sessionId = "e94-pending-lock";
    const first = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create a note", mode: "read", sessionId })
      .expect(200);

    const pendingRequestId = first.body?.pending_server_request?.request_id;
    expect(String(first.body?.route_reason_code ?? "")).toContain("clarify:");
    expect(pendingRequestId).toBeTruthy();

    const second = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open docs", mode: "read", sessionId })
      .expect(200);

    expect(String(second.body?.route_reason_code ?? "")).toContain("clarify:");
    expect(second.body?.dispatch?.dispatch_hint).toBe(false);
    expect(second.body?.pending_server_request?.request_id).toBe(pendingRequestId);
  });

  it("keeps deterministic lifecycle for executed workspace step", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open notes", mode: "read", sessionId: "e94-lifecycle" })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    const lifecycle = Array.isArray(response.body?.execution_lifecycle) ? response.body.execution_lifecycle : [];
    const started = lifecycle.filter((event: { step_id?: string; event?: string }) => event.step_id === "workspace_action" && event.event === "started");
    const completed = lifecycle.filter((event: { step_id?: string; event?: string }) => event.step_id === "workspace_action" && event.event === "completed");
    expect(started.length).toBe(1);
    expect(completed.length).toBe(1);
  });
});

