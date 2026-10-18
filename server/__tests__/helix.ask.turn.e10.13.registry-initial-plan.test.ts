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

const selectedCapabilities = (body: any): string[] =>
  (body?.turn_runtime?.capability_selection_trace ?? [])
    .map((entry: { selected_capability?: string | null }) => entry.selected_capability)
    .filter(Boolean);

describe("helix ask turn e10.13 registry initial plan canary", () => {
  it("uses the registry as initial planner input for open notes", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open notes", mode: "read", sessionId: `e1013-notes-${Date.now()}` })
      .expect(200);

    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.planner_contract?.plan_items?.[0]?.id).toBe("workspace_action_note_context");
    expect(selectedCapabilities(response.body)).toContain("workstation-notes.open");
    expect(response.body?.assistant_answer ?? response.body?.text).not.toMatch(/Planning reasoning turn|queued reasoning/i);
  });

  it("uses the registry as initial planner input for open docs", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open docs", mode: "read", sessionId: `e1013-docs-${Date.now()}` })
      .expect(200);

    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.planner_contract?.plan_items?.[0]?.id).toBe("workspace_action_doc_context");
    expect(selectedCapabilities(response.body)).toContain("docs-viewer.resolve_context");
  });

  it("uses the registry as initial planner input for read clipboard", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "read clipboard", mode: "read", sessionId: `e1013-clip-${Date.now()}` })
      .expect(200);

    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-clipboard-history");
    expect(response.body?.workspace_action?.action_id).toBe("read_clipboard");
    expect(selectedCapabilities(response.body)).toContain("workstation-clipboard-history.read_clipboard");
  });

  it("combines initial exact locate with runtime variant capability continuation", async () => {
    const app = createApp();
    const sessionId = `e1013-locate-${Date.now()}`;
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "pull up a recent NHM2 mission time paper", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "where does this document mention centerline alpha?", mode: "read", sessionId })
      .expect(200);

    const capabilities = selectedCapabilities(response.body);
    expect(capabilities).toContain("docs-viewer.locate_in_doc.exact");
    expect(capabilities).toContain("docs-viewer.locate_in_doc.variant");
    expect(response.body?.planner_contract?.plan_items?.some((step: { id?: string }) => step.id === "workspace_action_locate_exact")).toBe(true);
    expect(response.body?.planner_contract?.plan_items?.some((step: { id?: string }) => step.id === "workspace_action_locate_variant")).toBe(true);
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(response.body?.assistant_answer).toMatch(/^Locations:/i);
    expect(response.body?.assistant_answer).toMatch(/\/docs\/.*:L\d+-L\d+/i);
  });

  it("builds compare doc-notes initial plan from registry-selected context steps", async () => {
    const app = createApp();
    const sessionId = `e1013-compare-${Date.now()}`;
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create note called e1013 compare", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "compare this doc with my notes", mode: "read", sessionId })
      .expect(200);

    const capabilities = selectedCapabilities(response.body);
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(capabilities).toContain("docs-viewer.resolve_context");
    expect(capabilities).toContain("workstation-notes.open");
    expect(capabilities).toContain("reasoning.followup");
    expect(response.body?.planner_contract?.plan_items?.some((step: { id?: string }) => step.id === "reasoning_followup")).toBe(true);
    expect(response.body?.invariant_violations ?? []).toEqual([]);
  });
});
