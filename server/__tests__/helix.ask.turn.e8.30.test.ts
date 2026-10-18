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

describe("helix ask turn e8.30 pending-confirm replay + terminal honesty + policy de-escalation", () => {
  it("keeps create-note intents with compare-in-title as workspace-only", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "create note called compare figures",
        mode: "read",
        sessionId: "e830-create-note-workspace-only",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.dispatch_policy).toBe("workspace_only");
    const reasoningPlan = (response.body?.planner_contract?.plan_items ?? []).some(
      (step: { lane?: string }) => step.lane === "reasoning",
    );
    expect(reasoningPlan).toBe(false);
  });

  it("does not emit false success text when workspace step fails", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "copy receipt to clipboard",
        mode: "read",
        sessionId: "e830-workspace-failure-text",
      })
      .expect(200);

    const trace = Array.isArray(response.body?.execution_trace)
      ? response.body.execution_trace
      : response.body?.execution_trace
        ? [response.body.execution_trace]
        : [];
    const workspaceStep = trace.find((step: { id?: string }) => step.id === "workspace_action");
    if (workspaceStep?.status === "failed") {
      const text = String(response.body?.text ?? "");
      expect(text).not.toBe("Executed workspace action.");
      expect(text.toLowerCase()).toContain("failed");
    }
  });
});
