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

const activeDocPath =
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/attempts/attempt-002/warp-nhm2-warp-worldline-proof-2026-04-27.md";

const workspaceSnapshot = (sessionId: string, noteTitle = "e42 scratch") => ({
  sessionId,
  activePanel: "docs-viewer",
  activeDocPath,
  hasDocContext: true,
  hasNoteContext: true,
  activeNoteId: `note:${noteTitle.replace(/\s+/g, "-")}`,
  activeNoteTitle: noteTitle,
  activeNoteBody: "Existing scratch note body.",
  lastCreatedNoteId: `note:${noteTitle.replace(/\s+/g, "-")}`,
  lastCreatedNoteTitle: noteTitle,
  lastCreatedNoteBody: "Existing scratch note body.",
  recentNotes: [{ id: `note:${noteTitle.replace(/\s+/g, "-")}`, title: noteTitle, body: "Existing scratch note body." }],
});

const answerText = (body: any): string => String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "");
const artifacts = (body: any): any[] =>
  (Array.isArray(body?.step_results) ? body.step_results : [])
    .map((step: any) => step?.result_artifact)
    .filter(Boolean);

describe("helix ask E42 universal final composer", () => {
  it("keeps no-tool direct answers under the composer contract", async () => {
    const app = createApp();
    const sessionId = `e42-no-tool-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello, are you working?",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(response.body?.final_answer_source).toBe("no_tool_direct");
    expect(response.body?.universal_final_composer?.used).toBe(true);
    expect(response.body?.universal_final_composer?.source).toBe("no_tool_direct");
    expect(response.body?.universal_final_composer?.terminal_allowed).toBe(true);
    expect(response.body?.workspace_action ?? null).toBeNull();
  }, 60000);

  it("composes active doc summaries from doc_summary artifacts", async () => {
    const app = createApp();
    const sessionId = `e42-summary-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about?",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(response.body?.final_answer_source).toBe("universal_composer");
    expect(response.body?.universal_final_composer?.source).toBe("universal_composer");
    expect(response.body?.universal_final_composer?.presentation_renderer).toBe("doc_summary");
    expect(response.body?.universal_final_composer?.consumed_artifacts).toContain("doc_summary");
    expect(answerText(response.body)).toMatch(/Summary:/i);
    expect(answerText(response.body)).not.toMatch(/^You are currently on:/i);
  }, 60000);

  it("routes exact docs path where/find prompts to doc location instead of summary", async () => {
    const app = createApp();
    const sessionId = `e42-doc-location-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Find where /docs/research/nhm2-current-status-whitepaper.md discusses assumptions. Return the section or nearby anchors and a short explanation.",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_evidence_location");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("doc_evidence_location");
    expect(JSON.stringify(response.body)).toContain("docs-viewer.locate_in_doc");
    expect(JSON.stringify(response.body)).not.toContain("docs_viewer_summary_precedence");
    expect(response.body?.terminal_artifact_kind).not.toBe("typed_failure");
    expect(
      response.body?.agent_runtime_loop?.iterations?.some(
        (iteration: any) =>
          iteration?.chosen_capability === "docs-viewer.locate_in_doc" &&
          ["executed_tool_result", "preobserved_tool_result"].includes(iteration?.observation_role) &&
          Array.isArray(iteration?.observed_artifact_refs) &&
          iteration.observed_artifact_refs.length > 0,
      ),
    ).toBe(true);
  }, 60000);

  it("composes summary-to-note final answers from synthesized answers backed by note update receipts", async () => {
    const app = createApp();
    const sessionId = `e42-summary-note-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "summarize this doc and put the takeaway in e42 scratch",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(response.body?.final_answer_source).toBe("universal_composer");
    expect(response.body?.universal_final_composer?.presentation_renderer).toBe("final_answer_draft");
    expect(response.body?.universal_final_composer?.consumed_artifacts).toContain("note_update_receipt");
    expect(response.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(artifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === "e42 scratch")).toBe(true);
    expect(answerText(response.body)).toMatch(/Updated e42 scratch/i);
  }, 60000);

  it("preserves pending input when required locate artifacts are missing", async () => {
    const app = createApp();
    const sessionId = `e42-missing-location-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put the impossible phrase zzznotfound location into e42 scratch",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(response.body?.final_answer_source).toBe("request_user_input");
    expect(response.body?.response_type).toBe("pending_input");
    expect(response.body?.universal_final_composer?.source).toBe("pending_input");
    expect(response.body?.universal_final_composer?.terminal_allowed).toBe(false);
    expect(answerText(response.body)).toMatch(/doc_location_matches/i);
  }, 60000);

  it("does not let forced empty terminal fallback override artifact-backed summaries", async () => {
    const app = createApp();
    const sessionId = `e42-empty-terminal-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about? [[TEST_FORCE_EMPTY_TERMINAL]]",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(response.body?.universal_final_composer?.used).toBe(true);
    expect(response.body?.final_answer_source).not.toBe("legacy_fallback");
    if (response.body?.final_answer_source === "universal_composer") {
      expect(response.body?.universal_final_composer?.consumed_artifacts).toContain("doc_summary");
      expect(answerText(response.body)).toMatch(/Summary:/i);
    } else {
      expect(response.body?.final_answer_source).toBe("typed_failure");
      expect(response.body?.universal_final_composer?.terminal_allowed).toBe(false);
    }
  }, 60000);
});
