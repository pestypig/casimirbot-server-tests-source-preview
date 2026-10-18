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

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const actions = (body: any): any[] => body?.action_envelope?.workstation_actions ?? body?.execution_trace?.map((step: any) => step?.action).filter(Boolean) ?? [];

describe("helix ask turn e13 pending and artifact carryover", () => {
  it("resolves a pending panel clarification when the user replies with a bare target", async () => {
    const app = createApp();
    const sessionId = `e13-pending-panel-${Date.now()}`;

    const pending = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open the panel", mode: "read", sessionId })
      .expect(200);

    expect(pending.body?.pending_server_request?.kind).toBe("clarify");
    expect(pending.body?.pending_server_request?.required_fields ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/target_panel|action_command/)]),
    );

    const resolved = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "notes", mode: "read", sessionId })
      .expect(200);

    expect(resolved.body?.pending_resolution_applied).toBe(true);
    expect(resolved.body?.route_reason_code).toBe("dispatch:act");
    expect(resolved.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(resolved.body?.workspace_action?.action_id).toBe("open");
    expect(answerText(resolved.body)).not.toMatch(/I heard|Share one specific goal/i);
  });

  it("handles create-note plus deictic latest-location carryover as a two-step workspace plan", async () => {
    const app = createApp();
    const sessionId = `e13-location-carryover-${Date.now()}`;
    const path =
      "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md";

    const locate = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "where does this document mention mission time?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: path,
          hasDocContext: true,
        },
      })
      .expect(200);

    expect(answerText(locate.body)).toMatch(/Locations:/i);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "start a note called oddball alpha refs and put that location in it",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "workstation-notes",
          activeDocPath: path,
          hasDocContext: true,
          hasNoteContext: true,
        },
      })
      .expect(200);

    const traceActions = actions(response.body);
    expect(traceActions.some((action: any) => action?.panel_id === "workstation-notes" && action?.action_id === "create_note" && action?.args?.title === "oddball alpha refs")).toBe(true);
    expect(traceActions.some((action: any) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note" && action?.args?.title === "oddball alpha refs" && /Locations:/i.test(String(action?.args?.text ?? "")))).toBe(true);
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(answerText(response.body)).not.toMatch(/missing_required|What should I name/i);
  }, 20000);

  it("defaults preserve-somewhere-useful requests to notes instead of asking notes-or-clipboard", async () => {
    const app = createApp();
    const sessionId = `e13-preserve-default-note-${Date.now()}`;
    const path =
      "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "I want to preserve the key falsifier condition from this paper somewhere useful; decide whether that should go to notes or clipboard and do it",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: path,
          activeNoteTitle: "UI flow scratch",
          hasDocContext: true,
          hasNoteContext: true,
        },
      })
      .expect(200);

    const traceActions = actions(response.body);
    expect(response.body?.pending_server_request).toBeNull();
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(traceActions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "locate_in_doc" && /falsifier/i.test(String(action?.args?.query ?? "")))).toBe(true);
    expect(traceActions.some((action: any) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note" && action?.args?.title === "UI flow scratch")).toBe(true);
    expect(answerText(response.body)).not.toMatch(/need one target|docs, notes, or clipboard/i);
  }, 20000);

  it("maps natural docs navigation variants through the same workspace action", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "switch me over to the docs panel", mode: "read", sessionId: `e13-docs-nav-${Date.now()}` })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("open");
  });
});
