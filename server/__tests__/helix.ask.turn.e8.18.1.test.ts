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

describe("helix ask turn e8.18.1 selection_valid normalization", () => {
  it("normalizes selection_valid=true for resolved dispatch turns with completed workspace action", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "ok pull up the latest nhm2 doc from today",
        mode: "read",
        sessionId: "e8181-latest-doc",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("open");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("open");
    expect(response.body?.planner_contract?.selection_valid).toBe(true);
    expect(response.body?.planner_contract?.selection_fail_reason).toBe("none");
  });

  it("keeps selection_valid=false for clarify turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId: "e8181-clarify-control",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:planner_repair_required");
    expect(response.body?.planner_contract?.selection_valid).toBe(false);
    expect(response.body?.planner_contract?.selected_action ?? null).toBeNull();
  });

  it("keeps selection_valid=false for invalid action candidates", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "rename note foo",
        mode: "read",
        sessionId: "e8181-invalid-candidate",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    expect(response.body?.planner_contract?.selection_valid).toBe(false);
    expect(response.body?.planner_contract?.selection_fail_reason).toBe("missing_required_args");
  });
});
