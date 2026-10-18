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

const workspaceSnapshot = (sessionId: string, noteTitle = "e41 scratch") => ({
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

const trace = (body: any): any[] => body?.observe_then_decide_trace ?? body?.turn_runtime?.observe_then_decide_trace ?? [];
const actions = (body: any): any[] => [
  ...(Array.isArray(body?.execution_trace) ? body.execution_trace.map((step: any) => step?.action).filter(Boolean) : []),
  ...(Array.isArray(body?.action_envelope?.workstation_actions) ? body.action_envelope.workstation_actions : []),
];
const artifacts = (body: any): any[] =>
  (Array.isArray(body?.step_results) ? body.step_results : [])
    .map((step: any) => step?.result_artifact)
    .filter(Boolean);

describe("helix ask E41 observe then decide", () => {
  it("records continuation and finalization decisions for summary-only turns", async () => {
    const app = createApp();
    const sessionId = `e41-summary-${Date.now()}`;

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

    const observed = trace(response.body);
    expect(observed.length).toBeGreaterThanOrEqual(2);
    expect(observed[0]?.decision).toBe("continue");
    expect(observed[0]?.terminal_allowed).toBe(false);
    expect(observed.some((entry) => entry.decision === "finalize" && entry.terminal_allowed === true)).toBe(true);
    expect(actions(response.body).some((action) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note")).toBe(false);
  }, 60000);

  it("continues from doc summary to note append before finalizing summary-to-note turns", async () => {
    const app = createApp();
    const sessionId = `e41-summary-note-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "explain this paper in normal words and put the takeaway in e41 scratch",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const observed = trace(response.body);
    expect(observed.length).toBeGreaterThanOrEqual(3);
    expect(observed.some((entry) => entry.decision === "continue" && entry.next_capability_id === "workstation-notes.append_to_note")).toBe(true);
    expect(observed[observed.length - 1]?.decision).toBe("finalize");
    expect(observed[observed.length - 1]?.terminal_allowed).toBe(true);
    expect(artifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === "e41 scratch")).toBe(true);
  }, 60000);

  it("blocks terminal finalization when locate-to-note is missing location artifacts", async () => {
    const app = createApp();
    const sessionId = `e41-missing-location-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put the impossible phrase zzznotfound location into e41 scratch",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const observed = trace(response.body);
    expect(response.body?.final_answer_source).toBe("request_user_input");
    expect(response.body?.response_type).toBe("pending_input");
    expect(observed.some((entry) => entry.decision === "request_user_input" && entry.terminal_allowed === false)).toBe(true);
    expect(String(response.body?.selected_final_answer ?? response.body?.answer ?? "")).toMatch(/doc_location_matches/i);
  }, 60000);

  it("keeps no-tool conversation as direct terminal output", async () => {
    const app = createApp();
    const sessionId = `e41-no-tool-${Date.now()}`;

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
    expect(response.body?.workspace_action ?? null).toBeNull();
    expect(actions(response.body)).toHaveLength(0);
  }, 60000);
});
