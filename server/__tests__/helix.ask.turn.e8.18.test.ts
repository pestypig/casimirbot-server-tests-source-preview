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

describe("helix ask turn e8.18 clarify contract purity", () => {
  it("does not expose selected action for planner-repair clarify turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId: "e818-clarify-planner-repair",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:planner_repair_required");
    expect(response.body?.workspace_action ?? null).toBeNull();
    expect(response.body?.planner_contract?.selected_action ?? null).toBeNull();
    expect(response.body?.planner_contract?.selection_valid).toBe(false);
    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.pending_server_request?.required_fields).toContain("target_panel");
  });

  it("does not expose selected action for typo-doc clarify turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to focs",
        mode: "read",
        sessionId: "e818-clarify-typo",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:ambiguous_intent");
    expect(response.body?.workspace_action ?? null).toBeNull();
    expect(response.body?.planner_contract?.selected_action ?? null).toBeNull();
    expect(response.body?.planner_contract?.selection_valid).toBe(false);
  });

  it("restores selected action after clarify resolution", async () => {
    const app = createApp();
    const sessionId = "e818-clarify-resolve";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const resolved = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "docs",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(resolved.body?.route_reason_code).toBe("dispatch:act");
    expect(resolved.body?.planner_contract?.selected_action?.panel_id).toBe("docs-viewer");
    expect(resolved.body?.planner_contract?.selected_action?.action_id).toBe("open");
    expect(resolved.body?.workspace_action?.panel_id).toBe("docs-viewer");
  });

  it("keeps destructive confirmation dispatch functional", async () => {
    const app = createApp();
    const sessionId = "e818-confirm-regression";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "delete note e818-test-note",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const confirmed = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "yes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(confirmed.body?.route_reason_code).toBe("dispatch:act");
    expect(confirmed.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(confirmed.body?.workspace_action?.action_id).toBe("delete_note");
    const trace = Array.isArray(confirmed.body?.execution_trace)
      ? confirmed.body.execution_trace
      : confirmed.body?.execution_trace
        ? [confirmed.body.execution_trace]
        : [];
    const workspaceStep = trace.find((step: { id?: string }) => step.id === "workspace_action");
    expect(workspaceStep?.status).toBe("completed");
    expect(workspaceStep?.action?.action_id).toBe("delete_note");
  });
});
