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

describe("helix ask E37 lay-language composition", () => {
  it("separates plain-language style instructions from the note target", async () => {
    const app = createApp();
    const sessionId = `e37-style-target-${Date.now()}`;
    const noteTitle = "e36 live summary scratch";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `can you explain this paper in normal words and put the takeaway in ${noteTitle}`,
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId, noteTitle),
      })
      .expect(200);

    expect(answerText(response.body)).toMatch(new RegExp(`^Updated ${noteTitle} with the document summary\\.`));
    expect(answerText(response.body)).not.toMatch(/normal words and put the takeaway/i);
    expect(response.body?.final_answer_source).toBe("universal_composer");
    expect(response.body?.universal_final_composer?.presentation_renderer).toBe("final_answer_draft");
    expect(response.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "doc_summary")).toBe(true);
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === noteTitle)).toBe(true);
    expect(actions(response.body).some((action) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note" && action?.args?.title === noteTitle)).toBe(true);
  }, 60000);

  it("composes lay find-part phrasing into locate then append-to-note", async () => {
    const app = createApp();
    const sessionId = `e37-locate-note-${Date.now()}`;
    const noteTitle = "e36 live summary scratch";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `find the part where it talks about solve-backed worldline and drop that into ${noteTitle}`,
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId, noteTitle),
      })
      .expect(200);

    const actionIds = actions(response.body).map((action) => `${action?.panel_id}.${action?.action_id}`);
    expect(actionIds).toContain("docs-viewer.locate_in_doc");
    expect(actionIds).toContain("workstation-notes.append_to_note");
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "doc_location_matches")).toBe(true);
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === noteTitle)).toBe(true);
    expect(answerText(response.body)).toMatch(new RegExp(`^Updated ${noteTitle} with the solve-backed worldline location\\.`));
    expect(answerText(response.body)).not.toMatch(/retrieval recovery|could not summarize/i);
  }, 60000);

  it("lets a successful note update receipt dominate stale retrieval recovery failure text", async () => {
    const app = createApp();
    const sessionId = `e37-drop-finding-${Date.now()}`;
    const noteTitle = "e36 live summary scratch";

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "where in this document does it talk about solve-backed worldline?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId, noteTitle),
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `drop that finding into ${noteTitle}`,
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId, noteTitle),
      })
      .expect(200);

    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === noteTitle)).toBe(true);
    expect(answerText(response.body)).toMatch(new RegExp(`^Updated ${noteTitle}`));
    expect(answerText(response.body)).not.toMatch(/retrieval recovery|could not summarize/i);
    expect(response.body?.final_answer_source).toBe("universal_composer");
    expect(response.body?.universal_final_composer?.presentation_renderer).toBe("final_answer_draft");
    expect(response.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
  }, 60000);

  it("routes active-doc usefulness questions through workspace-context summary instead of retrieval recovery", async () => {
    const app = createApp();
    const sessionId = `e37-usefulness-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what would a normal person use this doc for?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    expect(response.body?.route_reason_code ?? response.body?.route).toBe("dispatch:act");
    expect(response.body?.dispatch_policy ?? response.body?.policy).toBe("workspace_context_reasoning");
    expect(actions(response.body).some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "summarize_doc")).toBe(true);
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "doc_summary")).toBe(true);
    expect(answerText(response.body)).not.toMatch(/retrieval recovery|could not summarize|No active document/i);
  }, 60000);
});

