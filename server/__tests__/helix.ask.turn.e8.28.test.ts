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

describe("helix ask turn e8.28 workspace-context reasoning attach", () => {
  it("routes deictic follow-up through workspace_context_reasoning when doc context is active", async () => {
    const app = createApp();
    const sessionId = "e828-deictic-attached";

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open up a doc",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const followup = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this?",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(followup.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(followup.body?.route_reason_code).toBe("dispatch:act");
    expect(followup.body?.turn_contract?.terminal_kind).toBe("reasoning");
    expect(followup.body?.workspace_context_mode).toBe("attached");
    expect(followup.body?.workspace_context_snapshot?.hasDocContext).toBe(true);
    expect(followup.body?.planner_contract?.selected_action?.panel_id).toBe("docs-viewer");
    expect(followup.body?.planner_contract?.selected_action?.action_id).toBe("summarize_doc");
    expect(Array.isArray(followup.body?.planner_contract?.plan_items)).toBe(true);
    expect(followup.body?.planner_contract?.plan_items?.map((step: { id?: string }) => step.id)).toEqual([
      "workspace_action",
      "reasoning_followup",
    ]);
  });

  it("returns typed clarify pending when deictic request has no active doc context", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this?",
        mode: "read",
        sessionId: "e828-deictic-missing-doc",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    expect(response.body?.dispatch_policy).toBe("needs_user_input");
    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.pending_server_request?.pending_scope).toBe("artifact_gate");
    expect(response.body?.pending_server_request?.required_fields).toContain("doc_reference");
  });

  it("respects isolated mode and skips workspace-context attach lock", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this?",
        mode: "read",
        context_mode: "isolated",
        sessionId: "e828-deictic-isolated",
      })
      .expect(200);

    expect(response.body?.workspace_context_mode).toBe("isolated");
    expect(response.body?.dispatch_policy).toBe("reasoning_only");
    expect(response.body?.route_reason_code).toBe("dispatch:observe_explore");
  }, 20000);

  it("keeps workspace-only behavior for direct workspace prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open notes",
        mode: "read",
        sessionId: "e828-regression-open-notes",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(String(response.body?.text ?? "")).toContain("Executed workstation-notes.open.");
  });
});
