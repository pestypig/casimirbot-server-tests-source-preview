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
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/attempts/attempt-002/warp-nhm2-warp-worldline-proof-2026-04-27.md";

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const stepArtifacts = (body: any): any[] =>
  (Array.isArray(body?.step_results) ? body.step_results : [])
    .map((step: any) => step?.result_artifact)
    .filter(Boolean);
const actions = (body: any): any[] => [
  ...(Array.isArray(body?.execution_trace) ? body.execution_trace.map((step: any) => step?.action).filter(Boolean) : []),
  ...(Array.isArray(body?.action_envelope?.workstation_actions) ? body.action_envelope.workstation_actions : []),
];
const jobLabels = (body: any): string[] =>
  (Array.isArray(body?.job_ready_links) ? body.job_ready_links : [])
    .map((link: any) => String(link?.label ?? link?.title ?? ""))
    .filter(Boolean);

const baseWorkspace = (sessionId: string, noteTitle?: string) => ({
  sessionId,
  activePanel: "docs-viewer",
  activeDocPath: activePath,
  hasDocContext: true,
  hasNoteContext: Boolean(noteTitle),
  activeNoteId: noteTitle ? `note:${noteTitle.replace(/\s+/g, "-")}` : undefined,
  activeNoteTitle: noteTitle,
  lastCreatedNoteId: noteTitle ? `note:${noteTitle.replace(/\s+/g, "-")}` : undefined,
  lastCreatedNoteTitle: noteTitle,
  recentNotes: noteTitle ? [{ id: `note:${noteTitle.replace(/\s+/g, "-")}`, title: noteTitle }] : [],
});

describe("helix ask E36 summary-to-existing-note", () => {
  it("summarizes the active document into a bare existing note title", async () => {
    const app = createApp();
    const sessionId = `e36-summary-bare-${Date.now()}`;
    const noteTitle = "scrambled status scratch 1777439912934";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `save the current doc summary into ${noteTitle}`,
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId, noteTitle),
      })
      .expect(200);

    expect(answerText(response.body)).toMatch(new RegExp(`^Updated ${noteTitle} with the document summary\\.`));
    expect(answerText(response.body)).not.toMatch(/could not map|known capability|which note/i);
    expect(response.body?.final_answer_source).toBe("final_answer_draft");
    expect(response.body?.universal_final_composer?.presentation_renderer).toBe("direct_answer");
    expect(response.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "doc_summary")).toBe(true);
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === noteTitle)).toBe(true);
    expect(actions(response.body).some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "summarize_doc")).toBe(true);
    expect(actions(response.body).some((action) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note" && action?.args?.title === noteTitle)).toBe(true);
    expect(jobLabels(response.body).some((label) => /copy final answer/i.test(label))).toBe(true);
  }, 60000);

  it("strips generic note wrappers from note-called summary destinations", async () => {
    const app = createApp();
    const sessionId = `e36-summary-called-${Date.now()}`;
    const noteTitle = "scrambled status scratch";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `save the current doc summary into a note called ${noteTitle}`,
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId, noteTitle),
      })
      .expect(200);

    expect(answerText(response.body)).toMatch(new RegExp(`^Updated ${noteTitle} with the document summary\\.`));
    expect(answerText(response.body)).not.toMatch(/Updated a note|Open note: a note/i);
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === noteTitle)).toBe(true);
    expect(jobLabels(response.body).some((label) => /copy final answer/i.test(label))).toBe(true);
  }, 60000);

  it("asks for a note title instead of mapping a summary append with no note context", async () => {
    const app = createApp();
    const sessionId = `e36-summary-missing-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "save the current doc summary into the note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    expect(response.body?.pending_server_request?.required_fields).toContain("note_title");
    expect(actions(response.body).some((action) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note")).toBe(false);
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt")).toBe(false);
    expect(response.body?.pending_server_request?.prompt ?? answerText(response.body)).toMatch(/Which note|name.*note|target note/i);
    expect(answerText(response.body)).not.toMatch(/could not map|known capability/i);
  }, 60000);

  it("preserves explicit note creation title parsing", async () => {
    const app = createApp();
    const sessionId = `e36-create-${Date.now()}`;
    const noteTitle = "scrambled status scratch";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `create a note called ${noteTitle}`,
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    expect(answerText(response.body)).toMatch(new RegExp(`^Created workstation note "${noteTitle}"\\.`));
    expect(stepArtifacts(response.body).some((artifact) => /^note_.*receipt$/.test(String(artifact?.kind ?? "")) && artifact?.title === noteTitle)).toBe(true);
  }, 60000);
});

