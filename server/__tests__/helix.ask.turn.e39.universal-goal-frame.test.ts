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

const workspaceSnapshot = (sessionId: string, noteTitle = "e39 scratch") => ({
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

const goalFrame = (body: any): any => body?.universal_goal_frame;
const decisionMap = (body: any): any => body?.turn_decision_source_map ?? body?.turn_runtime?.turn_decision_source_map;

describe("helix ask E39 universal goal frame", () => {
  it("exposes a normalized no-tool conversation frame without mutation targets", async () => {
    const app = createApp();
    const sessionId = `e39-conversation-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello, is this working?",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const frame = goalFrame(response.body);
    expect(frame).toBeTruthy();
    expect(frame.user_goal.goal_kind).toBe("conversation");
    expect(frame.requested_outputs.some((entry: any) => entry.kind === "answer")).toBe(true);
    expect(frame.mutation_targets).toHaveLength(0);
    expect(frame.workspace_refs).toHaveLength(0);
    expect(response.body?.debug?.universal_goal_frame?.user_goal?.goal_kind).toBe("conversation");
    expect(response.body?.turn_truth_table?.universal_goal_frame?.user_goal?.goal_kind).toBe("conversation");
    expect(response.body?.agent_loop_audit?.universal_goal_frame?.user_goal?.goal_kind).toBe("conversation");
    expect(decisionMap(response.body)?.goal_frame_used).toBe(true);
    expect(decisionMap(response.body)?.goal_frame_goal_kind).toBe("conversation");
  });

  it("classifies plain-language doc explanation as style, not a note target", async () => {
    const app = createApp();
    const sessionId = `e39-style-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "explain this paper in normal words",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const frame = goalFrame(response.body);
    expect(frame.user_goal.goal_kind).toBe("summarize_doc");
    expect(frame.style_modifiers.some((entry: any) => /normal words/i.test(entry.value))).toBe(true);
    expect(frame.mutation_targets).toHaveLength(0);
    expect(frame.workspace_refs.some((entry: any) => entry.kind === "active_doc" && entry.source === "deictic")).toBe(true);
    expect(frame.evidence_requirements.some((entry: any) => entry.artifact === "doc_summary")).toBe(true);
  }, 60000);

  it("separates note target from style/output phrasing in summary-to-note turns", async () => {
    const app = createApp();
    const sessionId = `e39-summary-note-${Date.now()}`;
    const noteTitle = "e39 scratch";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `explain this paper in normal words and put the takeaway in ${noteTitle}`,
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId, noteTitle),
      })
      .expect(200);

    const frame = goalFrame(response.body);
    expect(frame.user_goal.goal_kind).toBe("summarize_doc");
    expect(frame.style_modifiers.some((entry: any) => /normal words/i.test(entry.value))).toBe(true);
    expect(frame.mutation_targets.some((entry: any) => entry.kind === "note" && entry.value === noteTitle)).toBe(true);
    expect(frame.mutation_targets.some((entry: any) => /normal words|takeaway/i.test(entry.value))).toBe(false);
    expect(frame.requested_outputs.some((entry: any) => entry.kind === "answer")).toBe(true);
    expect(frame.requested_outputs.some((entry: any) => entry.kind === "note_update")).toBe(true);
    expect(frame.evidence_requirements.some((entry: any) => entry.artifact === "note_update_receipt")).toBe(true);
  }, 60000);

  it("represents deictic artifact-to-note turns as context-dependent instead of literalizing 'that'", async () => {
    const app = createApp();
    const sessionId = `e39-deictic-${Date.now()}`;
    const noteTitle = "e39 scratch";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "drop that into the note",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId, noteTitle),
      })
      .expect(200);

    const frame = goalFrame(response.body);
    expect(frame.workspace_refs.some((entry: any) => entry.kind === "prior_turn" && entry.source === "deictic")).toBe(true);
    expect(frame.mutation_targets.some((entry: any) => entry.kind === "note" && entry.value === noteTitle)).toBe(true);
    expect(frame.mutation_targets.some((entry: any) => /^that$/i.test(entry.value))).toBe(false);
    expect(frame.evidence_requirements.some((entry: any) => entry.artifact === "note_update_receipt")).toBe(true);
  }, 60000);

  it("classifies explicit doc-to-note comparison with active-doc and note evidence requirements", async () => {
    const app = createApp();
    const sessionId = `e39-compare-${Date.now()}`;
    const noteTitle = "e39 scratch";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `compare this doc to ${noteTitle}`,
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId, noteTitle),
      })
      .expect(200);

    const frame = goalFrame(response.body);
    expect(frame.user_goal.goal_kind).toBe("compare");
    expect(frame.workspace_refs.some((entry: any) => entry.kind === "active_doc")).toBe(true);
    expect(frame.workspace_refs.some((entry: any) => entry.kind === "note_title" && entry.value === noteTitle)).toBe(true);
    expect(frame.evidence_requirements.some((entry: any) => entry.artifact === "comparison_summary")).toBe(true);
    expect(decisionMap(response.body)?.goal_frame_goal_kind).toBe("compare");
  }, 60000);
});
