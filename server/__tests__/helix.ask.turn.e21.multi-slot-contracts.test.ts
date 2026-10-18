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
  "/docs/audits/research/halobank-warp-gr-foundations-bridge-2026-03-24.md";

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const trace = (body: any): any[] => body?.execution_trace ?? [];
const traceActions = (body: any): string[] =>
  trace(body)
    .map((step: any) => step?.action)
    .filter(Boolean)
    .map((action: any) => `${action.panel_id}.${action.action_id}`);
const bodyJson = (body: any): string => JSON.stringify(body);

describe("helix ask E21 multi-slot planner contracts", () => {
  it("answers both active note and active doc for composite workspace context prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "quick check: what note am I editing and what doc is open?",
        mode: "read",
        sessionId: `e21-context-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "workstation-notes",
          activeDocPath: activePath,
          activeNoteTitle: "artifact handoff browser e21",
          lastCreatedNoteTitle: "artifact handoff browser e21",
          hasDocContext: true,
          hasNoteContext: true,
        },
      })
      .expect(200);

    const text = answerText(response.body);
    expect(text).toMatch(/Active note: artifact handoff browser e21/i);
    expect(text).toMatch(/Active doc: \/docs\/audits\/research\/halobank-warp-gr-foundations-bridge-2026-03-24\.md/i);
    expect(traceActions(response.body)).toContain("workstation-notes.list_notes");
    expect(traceActions(response.body)).toContain("docs-viewer.identify_current_doc");
    expect(response.body?.pending_server_request).toBeFalsy();
    expect(response.body?.dispatch?.reason).not.toMatch(/^clarify:/);
    expect(response.body?.planner_contract?.dispatch_policy).not.toBe("needs_user_input");
  });

  it("does not leave a pending request after a satisfied active note/doc status answer", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what note am I editing, and what document is currently open?",
        mode: "read",
        sessionId: `e21-context-pending-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "workstation-notes",
          activeDocPath: activePath,
          activeNoteTitle: "artifact handoff browser e21",
          lastCreatedNoteTitle: "artifact handoff browser e21",
          hasDocContext: true,
          hasNoteContext: true,
        },
      })
      .expect(200);

    expect(answerText(response.body)).toMatch(/Active note: artifact handoff browser e21/i);
    expect(answerText(response.body)).toMatch(/Active doc: \/docs\//i);
    expect(response.body?.pending_server_request).toBeFalsy();
    expect(response.body?.route_reason_code).not.toMatch(/^clarify:/);
    expect(response.body?.planner_contract?.dispatch_policy).not.toBe("needs_user_input");
  });

  it("routes find-and-open topic doc prompts through search/open, not locate-in-current-doc", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find and open a doc about NHM2 clocking targets, then tell me which doc you chose and why.",
        mode: "read",
        sessionId: `e21-open-doc-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          activeNoteTitle: "artifact handoff browser e21",
          hasDocContext: true,
          hasNoteContext: true,
        },
      })
      .expect(200);

    const actions = traceActions(response.body);
    expect(actions).toContain("docs-viewer.search_docs");
    expect(actions).toContain("docs-viewer.open_doc_by_path");
    expect(actions).not.toContain("docs-viewer.locate_in_doc");
    expect(answerText(response.body)).toMatch(/Opened document: \/docs\//i);
    expect(answerText(response.body)).not.toMatch(/doc_location_matches|stopped before required artifacts/i);
  });

  it("composes concise doc-about final answers while preserving doc_summary artifacts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about?",
        mode: "read",
        sessionId: `e21-doc-about-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          activeNoteTitle: "artifact handoff browser e21",
          hasDocContext: true,
          hasNoteContext: true,
        },
      })
      .expect(200);

    const text = answerText(response.body);
    expect(text.length).toBeLessThan(900);
    expect(text).not.toMatch(/^Explained\s+\/docs\//i);
    expect(text).toMatch(/Main points:/i);
    expect(text).toMatch(/Active doc: \/docs\//i);
    expect(text).not.toMatch(/[a-f0-9]{40}/i);
    expect(bodyJson(response.body)).toMatch(/doc_summary/);
  }, 60000);

  it("allows richer doc-about output when evidence is explicitly requested", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about? include evidence",
        mode: "read",
        sessionId: `e21-doc-about-evidence-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          activeNoteTitle: "artifact handoff browser e21",
          hasDocContext: true,
          hasNoteContext: true,
        },
      })
      .expect(200);

    expect(answerText(response.body)).toMatch(/Explained|Key claim|evidence|Abstract/i);
    expect(bodyJson(response.body)).toMatch(/doc_summary/);
  }, 60000);

  it("composes create-note then open-topic-doc without a planner-repair clarification", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "make a note called oddball NHM2 scratch, then open a doc about warp profile mission time comparisons",
        mode: "read",
        sessionId: `e21-create-open-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "workstation-notes",
          activeDocPath: activePath,
          activeNoteTitle: "artifact handoff browser e21",
          hasDocContext: true,
          hasNoteContext: true,
        },
      })
      .expect(200);

    const actions = traceActions(response.body);
    expect(actions).toContain("workstation-notes.create_note");
    expect(actions).toContain("docs-viewer.search_docs");
    expect(actions).toContain("docs-viewer.open_doc_by_path");
    expect(response.body?.pending_server_request).toBeFalsy();
    expect(response.body?.route_reason_code).not.toMatch(/^clarify:/);
    expect(answerText(response.body)).toMatch(/Created note: oddball NHM2 scratch/i);
    expect(answerText(response.body)).toMatch(/Opened document: \/docs\//i);
  });

  it("keeps artifact references typed in planned locate-to-note args and concrete in execution", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "In that doc, where does it mention centerline alpha? Put a one sentence reminder into the note I am editing.",
        mode: "read",
        sessionId: `e21-locate-note-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-cruise-envelope-preflight-latest.md",
          activeNoteTitle: "artifact handoff browser e21",
          lastCreatedNoteTitle: "artifact handoff browser e21",
          hasDocContext: true,
          hasNoteContext: true,
        },
      })
      .expect(200);

    const planned = response.body?.planner_contract?.plan_items ?? [];
    const plannedAppend = planned.find((step: any) => step?.action?.action_id === "append_to_note");
    expect(plannedAppend?.action?.args?.artifact_ref).toBe("doc_location_reminder_text");
    expect(bodyJson(response.body?.planner_contract)).not.toContain("{{doc_location_reminder_text}}");
    const executedAppend = trace(response.body).find((step: any) => step?.action?.action_id === "append_to_note");
    expect(String(executedAppend?.action?.args?.text ?? "")).toMatch(/Reminder: Review|L\d+/i);
    expect(answerText(response.body)).toMatch(/Found the requested document location and updated artifact handoff browser e21/i);
  }, 60000);

  it("summarizes workspace changes from workspace_change_log instead of document retrieval", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Now summarize what changed in my workspace in two bullets.",
        mode: "read",
        sessionId: `e21-workspace-changes-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "workstation-notes",
          activeDocPath: activePath,
          activeNoteTitle: "artifact handoff browser e21",
          hasDocContext: true,
          hasNoteContext: true,
          lastWorkspaceAction: {
            panel_id: "workstation-notes",
            action_id: "append_to_note",
            args: { title: "artifact handoff browser e21" },
          },
        },
      })
      .expect(200);

    expect(answerText(response.body)).toMatch(/Workspace changes:/i);
    expect(answerText(response.body)).toMatch(/workstation-notes\.append_to_note|workspace_change_log\.inspect/i);
    expect(traceActions(response.body)).not.toContain("docs-viewer.summarize_doc");
    expect(traceActions(response.body)).not.toContain("docs-viewer.search_docs");
  });

  it("uses the server action ledger over stale incoming lastWorkspaceAction", async () => {
    const app = createApp();
    const sessionId = `e21-workspace-ledger-${Date.now()}`;
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "In that doc, where does it mention centerline alpha? Put a one sentence reminder into the note I am editing.",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-cruise-envelope-preflight-latest.md",
          activeNoteTitle: "artifact handoff browser e21",
          lastCreatedNoteTitle: "artifact handoff browser e21",
          hasDocContext: true,
          hasNoteContext: true,
        },
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Now summarize what changed in my workspace in two bullets.",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          activeNoteTitle: "artifact handoff browser e21",
          lastCreatedNoteTitle: "artifact handoff browser e21",
          hasDocContext: true,
          hasNoteContext: true,
          lastWorkspaceAction: {
            panel_id: "docs-viewer",
            action_id: "summarize_doc",
            args: {},
          },
        },
      })
      .expect(200);

    const text = answerText(response.body);
    expect(text).toMatch(/Workspace changes:/i);
    expect(text.split("\n")[1]).toMatch(/workstation-notes\.append_to_note/i);
    expect(traceActions(response.body)).not.toContain("docs-viewer.summarize_doc");
    expect(bodyJson(response.body)).not.toMatch(/model_step_[^"]*docs_viewer_summarize_doc/i);
    expect(bodyJson(response.body)).toMatch(/workspace_change_summary/i);
    expect(bodyJson(response.body)).toMatch(/turn_final_text/i);
    expect(response.body?.workspace_context_snapshot?.workspaceActionLedger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          panel_id: "workstation-notes",
          action_id: "append_to_note",
          status: "completed",
        }),
      ]),
    );
  }, 60000);

  it("resolves deictic just-created note targets to the concrete note title", async () => {
    const app = createApp();
    const sessionId = `e21-deictic-note-${Date.now()}`;
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "create a note called fresh loop scratch",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          activePanel: "workstation-notes",
          activeDocPath: activePath,
          hasDocContext: true,
        },
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "summarize this document into the note I just created",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          activeNoteId: "note:fresh-loop-scratch",
          activeNoteTitle: "I just created",
          lastCreatedNoteId: "note:fresh-loop-scratch",
          lastCreatedNoteTitle: "I just created",
          hasDocContext: true,
          hasNoteContext: true,
        },
      })
      .expect(200);

    const executedAppend = trace(response.body).find((step: any) => step?.action?.action_id === "append_to_note");
    expect(executedAppend?.action?.args?.title).toBe("fresh loop scratch");
    expect(bodyJson(response.body)).not.toMatch(/Open note: I just created|title":"I just created/);
    const text = answerText(response.body);
    expect(text).toMatch(/fresh loop scratch/i);
    expect(text).toMatch(/document summary/i);
    expect(text.length).toBeLessThan(500);
    expect(text).not.toMatch(/\bAbstract\b|Key claim|Casimir tiles|amplification-to-mass proxy/i);
    expect(bodyJson(response.body)).toMatch(/note_update_receipt/);
  }, 60000);
});
