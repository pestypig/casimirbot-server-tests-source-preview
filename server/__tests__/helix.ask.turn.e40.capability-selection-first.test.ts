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

const workspaceSnapshot = (sessionId: string, noteTitle = "e40 scratch") => ({
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

const actions = (body: any): any[] => [
  ...(Array.isArray(body?.execution_trace) ? body.execution_trace.map((step: any) => step?.action).filter(Boolean) : []),
  ...(Array.isArray(body?.action_envelope?.workstation_actions) ? body.action_envelope.workstation_actions : []),
];
const artifacts = (body: any): any[] =>
  (Array.isArray(body?.step_results) ? body.step_results : [])
    .map((step: any) => step?.result_artifact)
    .filter(Boolean);
const decisionMap = (body: any): any => body?.turn_decision_source_map ?? body?.turn_runtime?.turn_decision_source_map;

describe("helix ask E40 capability selection first", () => {
  it("does not turn a style-only summary into a note write", async () => {
    const app = createApp();
    const sessionId = `e40-style-only-${Date.now()}`;

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

    expect(response.body?.universal_goal_frame?.style_modifiers?.some((entry: any) => /normal words/i.test(entry.value))).toBe(true);
    expect(response.body?.universal_goal_frame?.mutation_targets).toHaveLength(0);
    expect(response.body?.capability_selection_result?.capability_id).toBe("docs-viewer.summarize_doc");
    expect(response.body?.capability_selection_result?.required_artifacts).toContain("doc_summary");
    expect(actions(response.body).some((action) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note")).toBe(false);
    expect(artifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt")).toBe(false);
    expect(String(response.body?.selected_final_answer ?? response.body?.answer ?? "")).not.toMatch(/Updated normal words/i);
    expect(decisionMap(response.body)?.goal_frame_used).toBe(true);
    expect(decisionMap(response.body)?.capability_selector_source).toBe("goal_frame");
  }, 60000);

  it("still allows explicit summary-to-note when the goal frame has a note mutation target", async () => {
    const app = createApp();
    const sessionId = `e40-summary-note-${Date.now()}`;
    const noteTitle = "e40 scratch";

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

    expect(response.body?.universal_goal_frame?.style_modifiers?.some((entry: any) => /normal words/i.test(entry.value))).toBe(true);
    expect(response.body?.universal_goal_frame?.mutation_targets?.some((entry: any) => entry.kind === "note" && entry.value === noteTitle)).toBe(true);
    expect(actions(response.body).some((action) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note" && action?.args?.title === noteTitle)).toBe(true);
    expect(artifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === noteTitle)).toBe(true);
    expect(response.body?.capability_selection_result?.capability_id).toBe("docs-viewer.summarize_doc");
    expect(response.body?.capability_selection_result?.expected_observation?.summary).toMatch(noteTitle);
  }, 60000);

  it("keeps no-tool conversation as a null capability", async () => {
    const app = createApp();
    const sessionId = `e40-no-tool-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello, can you answer without workspace actions?",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(response.body?.final_answer_source).toBe("no_tool_direct");
    expect(response.body?.workspace_action ?? null).toBeNull();
    expect(response.body?.capability_selection_result?.capability_id).toBeNull();
    expect(response.body?.capability_selection_result?.source).toBe("goal_frame");
    expect(decisionMap(response.body)?.goal_frame_goal_kind).toBe("conversation");
  });

  it("does not literalize deictic 'that' as a note target", async () => {
    const app = createApp();
    const sessionId = `e40-deictic-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "drop that into the note",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(response.body?.universal_goal_frame?.workspace_refs?.some((entry: any) => entry.kind === "prior_turn" && entry.source === "deictic")).toBe(true);
    expect(response.body?.universal_goal_frame?.mutation_targets?.some((entry: any) => /^that$/i.test(entry.value))).toBe(false);
    expect(response.body?.capability_selection_result?.capability_id).toBe("workstation-notes.append_to_note");
  }, 60000);
});
