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

const noteTitle = "mixed loop scratch";
const noteBody = [
  `Source: ${activePath}`,
  "Summary: Existing note captures the NHM2 route-time worldline document.",
  "Centerline alpha location: line L17-L21.",
].join("\n");
const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const trace = (body: any): any[] => body?.execution_trace ?? [];
const traceActions = (body: any): string[] =>
  trace(body)
    .map((step: any) => step?.action)
    .filter(Boolean)
    .map((action: any) => `${action.panel_id}.${action.action_id}`);
const bodyJson = (body: any): string => JSON.stringify(body);

const workspaceSnapshot = (overrides: Record<string, unknown> = {}) => ({
  activePanel: "docs-viewer",
  activeDocPath: activePath,
  activeNoteTitle: noteTitle,
  activeNoteBody: noteBody,
  lastCreatedNoteTitle: noteTitle,
  lastCreatedNoteBody: noteBody,
  recentNotes: [{ id: "note:mixed-loop-scratch", title: noteTitle, body: noteBody }],
  hasDocContext: true,
  hasNoteContext: true,
  ...overrides,
});

describe("helix ask E22 doc-vs-note compare contract", () => {
  it("compares the active document against an explicitly named note instead of requesting a second document", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this document with mixed loop scratch and tell me the main differences",
        mode: "read",
        sessionId: `e22-doc-note-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);

    const text = answerText(response.body);
    const actions = traceActions(response.body);
    expect(actions).toContain("docs-viewer.summarize_doc");
    expect(actions).toContain("workstation-notes.list_notes");
    expect(text).toMatch(/Compared: .* vs "mixed loop scratch"/i);
    expect(text).toMatch(/Already in note:/i);
    expect(text).toMatch(/Missing from note:/i);
    expect(text).not.toMatch(/\b(?:may contain|could include|might have|use it as)\b/i);
    expect(text).not.toMatch(/missing second document reference/i);
    expect(response.body?.pending_server_request).toBeFalsy();
    expect(response.body?.route_reason_code).not.toMatch(/^clarify:/);
    expect(bodyJson(response.body)).toMatch(/comparison_summary/);
  }, 60000);

  it("resolves deictic note targets to the active or last-created note for doc-vs-note compare", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this document with that note and list the deltas",
        mode: "read",
        sessionId: `e22-that-note-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);

    const text = answerText(response.body);
    expect(traceActions(response.body)).toContain("workstation-notes.list_notes");
    expect(text).toMatch(/mixed loop scratch/i);
    expect(text).toMatch(/Already in note:/i);
    expect(text).toMatch(/Missing from note:/i);
    expect(text).not.toMatch(/\b(?:may contain|could include|might have|use it as)\b/i);
    expect(text).not.toMatch(/that note|missing second document reference/i);
    expect(response.body?.pending_server_request).toBeFalsy();
  }, 60000);

  it("uses typed pending input when a doc-vs-note compare has no resolvable note target", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this document with that note and tell me the main differences",
        mode: "read",
        sessionId: `e22-missing-note-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot({
          activeNoteTitle: null,
          activeNoteBody: null,
          lastCreatedNoteTitle: null,
          lastCreatedNoteBody: null,
          recentNotes: [],
          hasNoteContext: false,
        }),
      })
      .expect(200);

    const text = answerText(response.body);
    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.pending_server_request?.required_fields).toContain("note_title");
    expect(response.body?.planner_contract?.dispatch_policy).toBe("needs_user_input");
    expect(text).not.toMatch(/Compared .*Key differences|missing second document reference|Already in note:/i);
  }, 60000);
});
