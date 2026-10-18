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

describe("helix ask turn e8.13 multi-step executor", () => {
  it("executes workspace->workspace ordered plan in one turn", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open notes and then list my notes",
        mode: "read",
        sessionId: "e813-workspace-workspace",
      })
      .expect(200);

    const trace = response.body?.execution_trace ?? [];
    expect(trace.length).toBeGreaterThanOrEqual(2);
    expect(trace[0]?.lane).toBe("workspace");
    expect(trace[1]?.lane).toBe("workspace");
    expect(trace[0]?.status).toBe("completed");
    expect(trace[1]?.status).toBe("completed");
    expect(response.body?.turn_contract?.single_terminal_required).toBe(true);
  });

  it("executes workspace->reasoning and returns reasoning terminal", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "copy this abstract to a note pad and explain it in plain language",
        mode: "read",
        sessionId: "e813-workspace-reasoning",
      })
      .expect(200);

    const trace = response.body?.execution_trace ?? [];
    expect(trace.length).toBeGreaterThanOrEqual(2);
    expect(trace[0]?.lane).toBe("workspace");
    expect(trace[0]?.status).toBe("completed");
    expect(trace[1]?.lane).toBe("reasoning");
    expect(trace[1]?.status).toBe("completed");
    expect(response.body?.turn_contract?.lane).toBe("reasoning");
    expect(response.body?.final_status).toBe("final_answer");
  });

  it("emits step_results aligned with execution_trace statuses", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open notes and then list my notes",
        mode: "read",
        sessionId: "e813-step-results",
      })
      .expect(200);

    const trace = response.body?.execution_trace ?? [];
    const stepResults = response.body?.step_results ?? [];
    expect(Array.isArray(stepResults)).toBe(true);
    expect(stepResults.length).toBe(trace.length);
    if (trace.length > 0) {
      expect(stepResults[0]?.step_id).toBe(trace[0]?.id);
      expect(stepResults[0]?.status).toBe(trace[0]?.status);
    }
  });

  it("keeps single-step workspace prompts unchanged", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open up notes",
        mode: "read",
        sessionId: "e813-single-step",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.turn_contract?.single_terminal_required).toBe(true);
  });
});
