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

describe("helix ask turn e8.10 pending clarify resolution", () => {
  it("resolves target_panel=docs and dispatches docs open action", async () => {
    const app = createApp();
    const sessionId = "e810-target-panel-docs";
    const first = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(first.body?.route_reason_code).toBe("clarify:planner_repair_required");
    expect(first.body?.pending_server_request?.required_fields).toContain("target_panel");

    const second = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "docs",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(second.body?.route_reason_code).toBe("dispatch:act");
    expect(second.body?.planner_contract?.dispatch_policy).toBe("workspace_only");
    expect(second.body?.planner_contract?.selected_action?.panel_id).toBe("docs-viewer");
    expect(second.body?.planner_contract?.selected_action?.action_id).toBe("open");
    expect(second.body?.planner_contract?.pending_resolution_applied).toBe(true);
    expect(second.body?.pending_server_request ?? null).toBeNull();
  });

  it("resolves target_panel=notes and dispatches notes open action", async () => {
    const app = createApp();
    const sessionId = "e810-target-panel-notes";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const second = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(second.body?.route_reason_code).toBe("dispatch:act");
    expect(second.body?.planner_contract?.selected_action?.panel_id).toBe("workstation-notes");
    expect(second.body?.planner_contract?.selected_action?.action_id).toBe("open");
    expect(second.body?.pending_server_request ?? null).toBeNull();
  });

  it("keeps pending clarify on unrelated follow-up and clears on cancel", async () => {
    const app = createApp();
    const sessionId = "e810-unrelated-then-cancel";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const unrelated = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what do you think",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(unrelated.body?.route_reason_code).toBe("clarify:missing_args");
    expect(unrelated.body?.pending_server_request?.kind).toBe("clarify");

    const canceled = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "cancel",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(canceled.body?.route_reason_code).toBe("suppressed:low_salience");
    expect(canceled.body?.pending_server_request ?? null).toBeNull();
  });

  it("keeps hello fast-path unaffected in a fresh session", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello",
        mode: "read",
        sessionId: "e810-hello-fresh",
      })
      .expect(200);

    expect(response.body?.final_status).toBe("final_answer");
    expect(response.body?.route_reason_code).not.toBe("clarify:missing_args");
    expect(String(response.body?.text ?? "").trim().length).toBeGreaterThan(0);
  });
});
