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

const expectLifecycleForTerminalSteps = (body: any) => {
  const started = new Set(
    (body?.execution_lifecycle ?? [])
      .filter((event: { event?: string }) => event.event === "started")
      .map((event: { step_id?: string }) => event.step_id),
  );
  for (const step of body?.execution_trace ?? []) {
    if (step.status === "completed" || step.status === "failed") {
      expect(started.has(step.id)).toBe(true);
    }
  }
};

describe("helix ask turn e10.11 general runtime continuation loop", () => {
  it("appends a variant locate step before finalizing doc location answers", async () => {
    const app = createApp();
    const sessionId = `e1011-locate-${Date.now()}`;
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "pull up a recent NHM2 mission time paper", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "where does this document mention centerline alpha?", mode: "read", sessionId })
      .expect(200);

    const locateSteps = (response.body?.step_results ?? []).filter(
      (step: { artifact?: { action_id?: string } }) => step.artifact?.action_id === "locate_in_doc",
    );
    expect(locateSteps.some((step: { contract_pass?: boolean }) => step.contract_pass === false)).toBe(true);
    expect(
      locateSteps.some(
        (step: { contract_pass?: boolean; artifact?: { args?: { locate_strategy?: string } }; actual_artifacts?: string[] }) =>
          step.contract_pass === true &&
          step.artifact?.args?.locate_strategy === "variant" &&
          step.actual_artifacts?.includes("doc_location_matches"),
      ),
    ).toBe(true);
    expect(response.body?.planner_contract?.plan_items?.some((step: { id?: string }) => step.id === "workspace_action_locate_variant")).toBe(true);
    expect(response.body?.assistant_answer).toMatch(/^Locations:/i);
    expect(response.body?.assistant_answer).toMatch(/\/docs\/.*:L\d+-L\d+/i);
    expectLifecycleForTerminalSteps(response.body);
  });

  it("keeps current-document identity as workspace-only with a user-facing final answer", async () => {
    const app = createApp();
    const sessionId = `e1011-doc-id-${Date.now()}`;
    const openResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open the latest NHM2 doc", mode: "read", sessionId })
      .expect(200);
    const openedPath = openResponse.body?.workspace_action?.args?.path;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what paper am I viewing?", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.action_id).toBe("identify_current_doc");
    expect(response.body?.assistant_answer).toContain(openedPath);
    expect(response.body?.assistant_answer).not.toMatch(/Completed reasoning for|Steps:|Tool selected:/i);
  });

  it("executes doc-note compare only after required context artifacts are available", async () => {
    const app = createApp();
    const sessionId = `e1011-compare-${Date.now()}`;
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create note called e1011 compare", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "compare this doc with my notes and tell me the differences", mode: "read", sessionId })
      .expect(200);

    const reasoningStep = (response.body?.step_results ?? []).find(
      (step: { step_id?: string }) => step.step_id === "reasoning_followup",
    );
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(reasoningStep?.status).toBe("completed");
    expect(reasoningStep?.consumed_artifacts).toEqual(expect.arrayContaining(["doc_context", "note_context"]));
    expect(reasoningStep?.actual_artifacts).toContain("reasoning_context");
    expect(response.body?.assistant_answer).not.toMatch(/Planning reasoning turn|I am thinking through this in the background/i);
    expectLifecycleForTerminalSteps(response.body);
  });
});
