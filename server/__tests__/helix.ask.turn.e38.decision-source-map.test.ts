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

const workspaceSnapshot = (sessionId: string, noteTitle = "e38 scratch") => ({
  sessionId,
  activePanel: "docs-viewer",
  activeDocPath,
  hasDocContext: true,
  hasNoteContext: true,
  activeNoteId: `note:${noteTitle.replace(/\s+/g, "-")}`,
  activeNoteTitle: noteTitle,
  lastCreatedNoteId: `note:${noteTitle.replace(/\s+/g, "-")}`,
  lastCreatedNoteTitle: noteTitle,
  recentNotes: [{ id: `note:${noteTitle.replace(/\s+/g, "-")}`, title: noteTitle }],
});

const decisionMap = (body: any): any => body?.turn_decision_source_map ?? body?.turn_runtime?.turn_decision_source_map;
const actions = (body: any): any[] => [
  ...(Array.isArray(body?.execution_trace) ? body.execution_trace.map((step: any) => step?.action).filter(Boolean) : []),
  ...(Array.isArray(body?.action_envelope?.workstation_actions) ? body.action_envelope.workstation_actions : []),
];
const stepArtifacts = (body: any): any[] =>
  (Array.isArray(body?.step_results) ? body.step_results : [])
    .map((step: any) => step?.result_artifact)
    .filter(Boolean);

describe("helix ask E38 decision source map", () => {
  it("exposes no-tool greeting as a non-fallback model/direct terminal path", async () => {
    const app = createApp();
    const sessionId = `e38-greeting-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello, is this working?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const map = decisionMap(response.body);
    expect(map).toBeTruthy();
    expect(response.body?.final_answer_source).toBe("no_tool_direct");
    expect(response.body?.workspace_action ?? null).toBeNull();
    expect(map.selected_action_source).toBe("model_planner");
    expect(map.terminal_source).toBe("model_planner");
    expect(map.fallback_used).toBe(false);
  });

  it("exposes topic doc opening source without hiding phrase-driven selection", async () => {
    const app = createApp();
    const sessionId = `e38-open-topic-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open a doc about light crossing speed",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const map = decisionMap(response.body);
    expect(map).toBeTruthy();
    expect(actions(response.body).some((action) => action?.panel_id === "docs-viewer")).toBe(true);
    expect(["phrase_detector", "capability_registry", "model_planner"]).toContain(map.selected_action_source);
    expect(map.plan_step_sources.length).toBeGreaterThan(0);
    expect(map.fallback_used).toBe(false);
    expect(map.terminal_source).not.toBe("legacy_fallback");
  }, 30000);

  it("exposes lay summary-to-note composition sources and keeps modifier text out of note target", async () => {
    const app = createApp();
    const sessionId = `e38-summary-note-${Date.now()}`;
    const noteTitle = "e38 scratch";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `explain this paper in normal words and put the takeaway in ${noteTitle}`,
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId, noteTitle),
      })
      .expect(200);

    const map = decisionMap(response.body);
    expect(map).toBeTruthy();
    expect(map.phrase_detector_used || map.capability_registry_used || map.model_planner_used).toBe(true);
    expect(map.terminal_source).toBe("artifact_policy");
    expect(map.fallback_used).toBe(false);
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "doc_summary")).toBe(true);
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === noteTitle)).toBe(true);
    expect(actions(response.body).some((action) => action?.action_id === "append_to_note" && action?.args?.title === noteTitle)).toBe(true);
  }, 60000);

  it("exposes ambiguous temporal follow-up as artifact-policy pending input, not fallback", async () => {
    const app = createApp();
    const sessionId = `e38-temporal-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "this was before the passing NHM2 solve right?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          ...workspaceSnapshot(sessionId),
          activeDocPath: "/docs/audits/research/warp-nhm2-solve-authority-audit-2026-04-02.md",
        },
      })
      .expect(200);

    const map = decisionMap(response.body);
    expect(map).toBeTruthy();
    expect(response.body?.final_status).toBe("pending_input");
    expect(response.body?.final_answer_source).toBe("request_user_input");
    expect(map.terminal_source).toBe("artifact_policy");
    expect(map.artifact_policy_used).toBe(true);
    expect(map.fallback_used).toBe(false);
    expect(response.body?.turn_truth_table?.event_audit?.terminal_mismatch).toBe(false);
  }, 60000);
});
