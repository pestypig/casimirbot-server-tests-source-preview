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
const expectNoRetrievalPlaceholder = (text: string): void => {
  expect(text).not.toMatch(/I need retrieval before finalizing|do not yet have grounded evidence|Needs retrieval/i);
};

describe("helix ask turn e10.16 terminal source of truth", () => {
  it("emits a compact turn truth table for conversation terminals", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "hello", mode: "read", debug: true, sessionId: `e1016-truth-hello-${Date.now()}` })
      .expect(200);

    expect(response.body?.turn_truth_table?.schema).toBe("helix.ask.turn_truth_table.v1");
    expect(response.body?.turn_truth_table?.question).toBe("hello");
    expect(response.body?.turn_truth_table?.dispatch_policy).toBe("conversation_only");
    expect(response.body?.turn_truth_table?.terminal?.kind).toBe("final_answer");
    expect(response.body?.turn_truth_table?.terminal?.text).toBe(answerText(response.body));
    expect(response.body?.agent_loop_audit?.turn_truth_table?.terminal?.text).toBe(answerText(response.body));
    expect(response.body?.debug?.turn_truth_table?.terminal?.text).toBe(answerText(response.body));
  });

  it("emits pending-input truth table state for missing note names", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create a note", mode: "read", sessionId: `e1016-truth-pending-${Date.now()}` })
      .expect(200);

    expect(response.body?.turn_truth_table?.dispatch_policy).toBe("needs_user_input");
    expect(response.body?.turn_truth_table?.terminal?.kind).toBe("pending_input");
    expect(response.body?.turn_truth_table?.pending_transition?.status_after).toBe("pending");
    expect(response.body?.turn_truth_table?.pending_transition?.request_id).toBeTruthy();
  });

  it("keeps create-note workspace final authoritative", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "make a new note called quick audit scratch", mode: "verify", sessionId: `e1016-create-${Date.now()}` })
      .expect(200);

    const text = answerText(response.body);
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("create_note");
    expect(response.body?.turn_truth_table?.selected_tool?.panel_id).toBe("workstation-notes");
    expect(response.body?.turn_truth_table?.selected_tool?.action_id).toBe("create_note");
    expect(response.body?.turn_truth_table?.terminal?.text).toBe("Created note: quick audit scratch.");
    expect(text).toBe("Created note: quick audit scratch.");
    expectNoRetrievalPlaceholder(text);
  });

  it("maps scrambled scratch-note creation phrasing to create_note", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "can you start a scratch note named wandering comparison bin",
        mode: "verify",
        sessionId: `e1016-scratch-note-${Date.now()}`,
      })
      .expect(200);

    const text = answerText(response.body);
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("create_note");
    expect(response.body?.workspace_action?.args?.title).toBe("wandering comparison bin");
    expect(response.body?.turn_truth_table?.terminal?.text).toBe("Created note: wandering comparison bin.");
    expect(text).toBe("Created note: wandering comparison bin.");
  });

  it("keeps copy-latest-clipboard-to-note workspace final authoritative", async () => {
    const app = createApp();
    const sessionId = `e1016-copy-note-${Date.now()}`;
    await request(app).post("/api/agi/ask/turn").send({ question: "hello", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "copy latest clipboard entry to note quick audit scratch", mode: "verify", sessionId })
      .expect(200);

    const text = answerText(response.body);
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-clipboard-history");
    expect(response.body?.workspace_action?.action_id).toBe("copy_receipt_to_note");
    expect(response.body?.workspace_action?.args?.note_title).toBe("quick audit scratch");
    expect(response.body?.turn_truth_table?.runtime_observations ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step_id: "workspace_action_clipboard_context", status: "completed" }),
        expect.objectContaining({ step_id: "workspace_action", status: "completed" }),
      ]),
    );
    expect(text).toBe("Copied the latest result to quick audit scratch.");
    expectNoRetrievalPlaceholder(text);
  });

  it("routes current-viewer document identity questions to docs-viewer.identify_current_doc", async () => {
    const app = createApp();
    const sessionId = `e1016-doc-viewer-identity-${Date.now()}`;
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open docs panel please", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "which document is in the viewer right now?", mode: "read", sessionId })
      .expect(200);

    const text = answerText(response.body);
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("identify_current_doc");
    expect(response.body?.turn_truth_table?.selected_tool?.action_id).toBe("identify_current_doc");
    expect(response.body?.turn_truth_table?.terminal?.text).toBe(text);
    expect(text).not.toMatch(/Reasoning completed/i);
  });

  it("routes docs viewer navigation variants to docs-viewer.open", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "move me over to the docs viewer", mode: "read", sessionId: `e1016-doc-nav-${Date.now()}` })
      .expect(200);

    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("open");
    expect(response.body?.turn_truth_table?.selected_tool?.action_id).toBe("open");
    expect(answerText(response.body)).toBe("Executed docs-viewer.open.");
  });

  it("maps scrambled stash clipboard result phrasing to copy_receipt_to_note", async () => {
    const app = createApp();
    const sessionId = `e1016-stash-note-${Date.now()}`;
    await request(app).post("/api/agi/ask/turn").send({ question: "hello", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "stash the clipboard result inside wandering comparison bin", mode: "verify", sessionId })
      .expect(200);

    const text = answerText(response.body);
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-clipboard-history");
    expect(response.body?.workspace_action?.action_id).toBe("copy_receipt_to_note");
    expect(response.body?.workspace_action?.args?.note_title).toBe("wandering comparison bin");
    expect(text).toBe("Copied the latest result to wandering comparison bin.");
  });

  it("does not let a stale clarification block a scrambled executable goal", async () => {
    const app = createApp();
    const sessionId = `e1016-pending-supersede-${Date.now()}`;
    await request(app).post("/api/agi/ask/turn").send({ question: "hello", mode: "read", sessionId }).expect(200);

    const pending = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create a note", mode: "verify", sessionId })
      .expect(200);
    expect(pending.body?.pending_server_request?.kind).toBe("clarify");
    expect(pending.body?.turn_truth_table?.terminal?.kind).toBe("pending_input");

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "stash the clipboard result inside wandering comparison bin", mode: "verify", sessionId })
      .expect(200);

    expect(response.body?.pending_server_request ?? null).toBeNull();
    expect(response.body?.workspace_action?.action_id).toBe("copy_receipt_to_note");
    expect(response.body?.workspace_action?.args?.note_title).toBe("wandering comparison bin");
    expect(answerText(response.body)).toBe("Copied the latest result to wandering comparison bin.");
  });

  it("normalizes put clipboard result in note-title phrasing to workspace result-to-note action", async () => {
    const app = createApp();
    const sessionId = `e1016-put-note-${Date.now()}`;
    await request(app).post("/api/agi/ask/turn").send({ question: "hello", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "put the clipboard result in quick audit scratch", mode: "verify", sessionId })
      .expect(200);

    const text = answerText(response.body);
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-clipboard-history");
    expect(response.body?.workspace_action?.action_id).toBe("copy_receipt_to_note");
    expect(response.body?.workspace_action?.args?.note_title).toBe("quick audit scratch");
    expect(text).toBe("Copied the latest result to quick audit scratch.");
    expectNoRetrievalPlaceholder(text);
  });

  it("preserves trailing note when it is part of a bare note title", async () => {
    const app = createApp();
    const sessionId = `e1016-bare-note-title-${Date.now()}`;
    await request(app).post("/api/agi/ask/turn").send({ question: "hello", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "put the clipboard result in restart truth table note", mode: "verify", sessionId })
      .expect(200);

    expect(response.body?.workspace_action?.panel_id).toBe("workstation-clipboard-history");
    expect(response.body?.workspace_action?.action_id).toBe("copy_receipt_to_note");
    expect(response.body?.workspace_action?.args?.note_title).toBe("restart truth table note");
    expect(answerText(response.body)).toBe("Copied the latest result to restart truth table note.");
  });

  it("repairs completed doc-note compare into key differences instead of retrieval placeholder", async () => {
    const app = createApp();
    const sessionId = `e1016-compare-${Date.now()}`;
    await request(app).post("/api/agi/ask/turn").send({ question: "open the latest NHM2 doc", mode: "read", sessionId }).expect(200);
    await request(app).post("/api/agi/ask/turn").send({ question: "make a note called alpha scratchpad", mode: "read", sessionId }).expect(200);
    await request(app).post("/api/agi/ask/turn").send({ question: "append centerline alpha baseline note to note alpha scratchpad", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "compare this document with my note alpha scratchpad and tell me the differences", mode: "read", sessionId })
      .expect(200);

    const text = answerText(response.body);
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(response.body?.needs_retrieval).toBe(false);
    expect(response.body?.quality_contract_pass).toBe(true);
    expect(text).toMatch(/Key differences:/i);
    expectNoRetrievalPlaceholder(text);
  });
});
