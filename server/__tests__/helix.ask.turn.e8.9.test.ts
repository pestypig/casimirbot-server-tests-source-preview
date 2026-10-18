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

describe("helix ask turn e8.9 planner repair pass", () => {
  it("keeps navigation prompts in workspace_only and repairs to docs open action", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "ok go to docs",
        mode: "read",
        sessionId: "e89-go-to-docs",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("open");
    expect(response.body?.turn_contract?.lane).toBe("conversation");
  });

  it("returns typed planner repair clarify when navigation target is ambiguous", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId: "e89-ambiguous-target",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:planner_repair_required");
    expect(response.body?.terminal_error_code).toBe("planner_repair_required");
    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.pending_server_request?.required_fields).toContain("target_panel");
    expect(response.body?.planner_contract?.planner_repair_attempted).toBe(true);
  });

  it("does not regress hello fast-path final terminal", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello",
        mode: "read",
        sessionId: "e89-hello",
      })
      .expect(200);

    expect(response.body?.final_status).toBe("final_answer");
    expect(String(response.body?.text ?? "").trim().length).toBeGreaterThan(0);
    expect(response.body?.turn_contract?.single_terminal_required).toBe(true);
  });
});
