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

describe("helix ask turn e8.14 capability graph artifact chaining", () => {
  it("surfaces consumed/produced artifacts for a successful workspace->reasoning chain", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "copy this abstract to a note pad and compare this doc with my notes",
        mode: "read",
        sessionId: "e814-artifact-chain",
      })
      .expect(200);

    const stepResults = response.body?.step_results ?? [];
    expect(stepResults.length).toBeGreaterThanOrEqual(2);
    const reasoningStep = stepResults.find((step: { step_id?: string }) => step.step_id === "reasoning_followup");
    expect(reasoningStep).toBeTruthy();
    expect(Array.isArray(reasoningStep?.consumed_artifacts)).toBe(true);
    expect(reasoningStep?.consumed_artifacts).toContain("doc_context");
    expect(reasoningStep?.consumed_artifacts).toContain("note_context");
    const workspaceStep = stepResults.find((step: { step_id?: string }) => step.step_id === "workspace_action");
    expect(workspaceStep?.produced_artifacts).toContain("workspace_context");
  });

  it("blocks downstream reasoning when required artifacts are missing and emits typed clarify", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open docs and then compare differences",
        mode: "read",
        sessionId: "e814-missing-artifact",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.pending_server_request?.required_fields).toContain("note_context");
  });

  it("keeps single-step workspace prompt behavior unchanged", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open up notes",
        mode: "read",
        sessionId: "e814-regression",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.turn_contract?.single_terminal_required).toBe(true);
    expect(response.body?.planner_contract?.dispatch_policy).toBe("workspace_only");
  });
});
