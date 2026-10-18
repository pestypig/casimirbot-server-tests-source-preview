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

const latestSolvePath =
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/attempts/attempt-002/warp-nhm2-warp-worldline-proof-2026-04-27.md";
const stalePath =
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-full-loop-audit-2026-04-26.md";

const noteTitle = "e43 binding scratch";
const noteBody = [
  `Source: ${latestSolvePath}`,
  "Summary: This note captures the solve-backed NHM2 worldline proof and its bounded diagnostic scope.",
  "Location: L45-L49 sourceAuditArtifactPath.",
].join("\n");

const workspaceSnapshot = (overrides: Record<string, unknown> = {}) => ({
  activePanel: "docs-viewer",
  activeDocPath: latestSolvePath,
  hasDocContext: true,
  hasNoteContext: true,
  activeNoteId: "note:e43-binding-scratch",
  activeNoteTitle: noteTitle,
  activeNoteBody: noteBody,
  lastCreatedNoteId: "note:e43-binding-scratch",
  lastCreatedNoteTitle: noteTitle,
  lastCreatedNoteBody: noteBody,
  recentNotes: [{ id: "note:e43-binding-scratch", title: noteTitle, body: noteBody }],
  ...overrides,
});

const answerText = (body: any): string => String(body?.selected_final_answer ?? body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const artifacts = (body: any): any[] =>
  (Array.isArray(body?.step_results) ? body.step_results : [])
    .map((step: any) => step?.result_artifact)
    .filter(Boolean);

describe("helix ask E43 active workspace binding", () => {
  it("binds this-note/the-doc compare prompts to active note and active doc", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this note against the doc and tell me if it captured the main point",
        mode: "read",
        debug: true,
        sessionId: `e43-deictic-compare-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);

    expect(response.body?.response_type).not.toBe("pending_input");
    expect(response.body?.pending_server_request).toBeFalsy();
    expect(answerText(response.body)).toMatch(new RegExp(`Compared: .* vs "${noteTitle}"`, "i"));
    expect(answerText(response.body)).not.toMatch(/note named "the doc"|Which note should I compare/i);
    expect(response.body?.workspace_ref_binding?.deicticBindings?.active_doc_reference).toBe("active_doc");
    expect(response.body?.workspace_ref_binding?.deicticBindings?.active_note_reference).toBe("active_note");
    const compareArtifact = artifacts(response.body).find((artifact) => artifact?.kind === "doc_vs_note_compare");
    expect(compareArtifact?.doc_path).toBe(latestSolvePath);
    expect(compareArtifact?.note_title).toBe(noteTitle);
  }, 60000);

  it("preserves server-opened active doc when a notes-panel snapshot carries a stale doc path", async () => {
    const app = createApp();
    const sessionId = `e43-doc-drift-${Date.now()}`;
    const open = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to the latest NHM2 warp solve doc",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot({ activeDocPath: null, hasDocContext: false }),
      })
      .expect(200);

    expect(open.body?.workspace_context_snapshot?.activeDocPath).toBe(latestSolvePath);

    const compare = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare latest solve scratch notes against the active doc and tell me if it captured the main point",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot({
          activePanel: "workstation-notes",
          activeDocPath: stalePath,
          activeNoteTitle: "latest solve scratch notes",
          lastCreatedNoteTitle: "latest solve scratch notes",
          activeNoteBody: noteBody,
          lastCreatedNoteBody: noteBody,
          recentNotes: [{ id: "note:latest-solve-scratch-notes", title: "latest solve scratch notes", body: noteBody }],
        }),
      })
      .expect(200);

    expect(compare.body?.workspace_context_snapshot?.activeDocPath).toBe(latestSolvePath);
    expect(compare.body?.workspace_ref_binding?.activeDocPath).toBe(latestSolvePath);
    const compareArtifact = artifacts(compare.body).find((artifact) => artifact?.kind === "doc_vs_note_compare");
    expect(compareArtifact?.doc_path).toBe(latestSolvePath);
    expect(answerText(compare.body)).not.toContain(stalePath);
  }, 60000);

  it("uses location artifact wording and strips trailing discourse particles from note targets", async () => {
    const app = createApp();
    const sessionId = `e43-location-note-${Date.now()}`;
    const locate = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "where does this document mention source audit artifact path?",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);
    expect(artifacts(locate.body).some((artifact) => artifact?.kind === "doc_location_matches")).toBe(true);

    const append = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `drop that location into ${noteTitle} too`,
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);

    expect(answerText(append.body)).toMatch(new RegExp(`^Updated ${noteTitle} with the .*location\\.`, "i"));
    expect(answerText(append.body)).not.toMatch(/document summary|too with/i);
    expect(artifacts(append.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === noteTitle)).toBe(true);
  }, 60000);

  it("reports terminal truth alignment for pending-input turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this note against the doc and tell me if it captured the main point",
        mode: "read",
        debug: true,
        sessionId: `e43-pending-truth-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot({
          activeNoteId: null,
          activeNoteTitle: null,
          activeNoteBody: null,
          lastCreatedNoteId: null,
          lastCreatedNoteTitle: null,
          lastCreatedNoteBody: null,
          recentNotes: [],
          hasNoteContext: false,
        }),
      })
      .expect(200);

    expect(response.body?.response_type).toBe("pending_input");
    expect(response.body?.final_answer_source).toBe("request_user_input");
    expect(response.body?.terminal_truth).toMatchObject({
      backend_terminal: "pending_input",
      visible_terminal: "pending_input",
      mismatch: false,
      selected_final_answer_source: "request_user_input",
    });
    expect(answerText(response.body)).toMatch(/Which note should I compare/i);
  }, 60000);
});
