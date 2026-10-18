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

const activePath =
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-route-time-worldline-2026-04-25.md";

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const trace = (body: any): any[] => body?.execution_trace ?? [];
const traceActions = (body: any): string[] =>
  trace(body)
    .map((step: any) => step?.action)
    .filter(Boolean)
    .map((action: any) => `${action.panel_id}.${action.action_id}`);

const workspaceSnapshot = (overrides: Record<string, unknown> = {}) => ({
  activePanel: "docs-viewer",
  activeDocPath: activePath,
  activeNoteTitle: "scrambled NHM2 compare scratch",
  lastCreatedNoteTitle: "scrambled NHM2 compare scratch",
  hasDocContext: true,
  hasNoteContext: true,
  ...overrides,
});

describe("helix ask E23 intent isolation and no-tool turns", () => {
  it("routes greeting/status prompts through the no-tool simple turn contract", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello, are you awake?",
        mode: "read",
        sessionId: `e23-simple-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);

    const text = answerText(response.body);
    expect(text).toMatch(/Helix Ask is responding|Hello/i);
    expect(text).not.toMatch(/summarize|retrieval|No active document|workspace context/i);
    expect(traceActions(response.body)).toEqual([]);
    expect(response.body?.final_answer_contract_family).toBe("simple");
    expect(response.body?.pending_server_request).toBeFalsy();
  }, 60000);

  it("treats compare words inside create-note titles as data, not compare intent", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "make a note called scrambled NHM2 compare scratch",
        mode: "read",
        sessionId: `e23-create-note-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot({ activeNoteTitle: null, lastCreatedNoteTitle: null }),
      })
      .expect(200);

    const text = answerText(response.body);
    const actions = traceActions(response.body);
    expect(actions).toContain("workstation-notes.create_note");
    expect(actions).not.toContain("docs-viewer.summarize_doc");
    expect(actions).not.toContain("workstation-notes.list_notes");
    expect(text).toBe("Created note: scrambled NHM2 compare scratch.");
    expect(text).not.toMatch(/Compared|Key differences|missing second document/i);
    expect(response.body?.planner_contract?.selected_action?.args?.title).toBe("scrambled NHM2 compare scratch");
    expect(response.body?.final_answer_contract_family).toBe("workspace_mutation");
  }, 60000);

  it("still allows a later explicit doc-vs-note compare against the full note title", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this document with scrambled NHM2 compare scratch and tell me the main differences",
        mode: "read",
        sessionId: `e23-real-compare-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);

    const text = answerText(response.body);
    const actions = traceActions(response.body);
    expect(actions).toContain("docs-viewer.summarize_doc");
    expect(actions).toContain("workstation-notes.list_notes");
    expect(text).toMatch(/Compared .* against note "scrambled NHM2 compare scratch"/i);
    expect(text).toMatch(/Key differences:/i);
    expect(text).not.toMatch(/missing second document reference/i);
  }, 60000);
});
