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

describe("helix ask turn e8.31 null-action elimination + summarize-add-note composition", () => {
  it("maps pick latest NHM2 doc to a concrete workspace docs action", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "pick the latest NHM2 doc",
        mode: "read",
        sessionId: "e831-pick-latest-doc",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("open");
    const trace = Array.isArray(response.body?.execution_trace)
      ? response.body.execution_trace
      : response.body?.execution_trace
        ? [response.body.execution_trace]
        : [];
    const workspaceStep = trace.find((step: { id?: string }) => step.id === "workspace_action");
    expect(workspaceStep?.status).toBe("completed");
  });

  it("composes summarize-differences-add-to-note into reasoning then append workflow", async () => {
    const app = createApp();
    const sessionId = "e831-summarize-add-note";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open docs",
        mode: "read",
        sessionId,
      })
      .expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "create note called compare figures",
        mode: "read",
        sessionId,
      })
      .expect(200);
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "summarize differences and add to note compare figures",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.dispatch_policy).toBe("workspace_context_reasoning");
    const planItems = response.body?.planner_contract?.plan_items ?? [];
    expect(planItems.map((step: { lane?: string; id?: string }) => `${step.lane}/${step.id}`)).toEqual([
      "reasoning/reasoning_followup",
      "workspace/workspace_action",
    ]);
    const workspaceAction = response.body?.planner_contract?.selected_action;
    expect(workspaceAction?.panel_id).toBe("workstation-notes");
    expect(workspaceAction?.action_id).toBe("append_to_note");
    const trace = Array.isArray(response.body?.execution_trace)
      ? response.body.execution_trace
      : response.body?.execution_trace
        ? [response.body.execution_trace]
        : [];
    expect(trace.some((step: { lane?: string; id?: string; status?: string }) => step.lane === "reasoning" && step.id === "reasoning_followup" && step.status === "completed")).toBe(true);
    expect(trace.some((step: { lane?: string; id?: string; status?: string; action?: { action_id?: string } }) => step.lane === "workspace" && step.id === "workspace_action" && step.status === "completed" && step.action?.action_id === "append_to_note")).toBe(true);
  });
});
