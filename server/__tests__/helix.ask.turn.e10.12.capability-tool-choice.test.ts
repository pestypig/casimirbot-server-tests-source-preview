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

describe("helix ask turn e10.12 capability-driven runtime tool choice", () => {
  it("selects the locate variant capability when doc location matches are missing", async () => {
    const app = createApp();
    const sessionId = `e1012-locate-${Date.now()}`;
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "pull up a recent NHM2 mission time paper", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "where does this document mention centerline alpha?", mode: "read", sessionId })
      .expect(200);

    const trace = response.body?.turn_runtime?.capability_selection_trace ?? [];
    expect(trace.some((entry: { selected_capability?: string }) => entry.selected_capability === "docs-viewer.locate_in_doc.variant")).toBe(true);
    expect(response.body?.planner_contract?.plan_items?.some((step: { id?: string }) => step.id === "workspace_action_locate_variant")).toBe(true);
    expect(response.body?.assistant_answer).toMatch(/^Locations:/i);
    expect(response.body?.assistant_answer).toMatch(/\/docs\/.*:L\d+-L\d+/i);
  });

  it("selects clipboard read capability before clipboard-dependent note transfer", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "copy latest clipboard entry to note research", mode: "read", sessionId: `e1012-clipboard-${Date.now()}` })
      .expect(200);

    const trace = response.body?.turn_runtime?.capability_selection_trace ?? [];
    expect(trace.some((entry: { selected_capability?: string }) => entry.selected_capability === "workstation-clipboard-history.read_clipboard")).toBe(true);
    expect(response.body?.turn_runtime?.appended_steps?.[0]?.step_id).toContain("workspace_action_clipboard_context");
    expect(response.body?.turn_runtime?.appended_steps?.[0]?.source).toBe("capability_registry");
  });

  it("keeps missing required args as typed pending input instead of fake final answers", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create a note", mode: "read", sessionId: `e1012-pending-${Date.now()}` })
      .expect(200);

    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.turn_runtime?.terminal?.kind).toBe("pending_input");
    expect(response.body?.assistant_answer ?? response.body?.text).toMatch(/name/i);
  });
});
