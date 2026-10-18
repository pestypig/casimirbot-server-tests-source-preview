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

const selectedCapabilities = (body: any): string[] =>
  (body?.turn_runtime?.capability_selection_trace ?? [])
    .map((entry: { selected_capability?: string | null }) => entry.selected_capability)
    .filter(Boolean);

describe("helix ask turn e10.14 registry coverage expansion", () => {
  it("selects create note from the registry when a title is provided", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create note called research scratch", mode: "read", sessionId: `e1014-create-${Date.now()}` })
      .expect(200);

    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("create_note");
    expect(selectedCapabilities(response.body)).toContain("workstation-notes.create_note");
    expect(response.body?.assistant_answer ?? response.body?.text).toMatch(/created note/i);
    expect(response.body?.assistant_answer ?? response.body?.text).not.toMatch(/failed to execute/i);
    expect(response.body?.assistant_answer ?? response.body?.text).not.toMatch(/queued reasoning|Planning reasoning turn/i);
  });

  it("preserves note titles that contain action-like words", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create note called ui append retest", mode: "read", sessionId: `e1014-title-boundary-${Date.now()}` })
      .expect(200);

    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.action_id).toBe("create_note");
    expect(response.body?.workspace_action?.args?.title).toBe("ui append retest");
    expect(response.body?.assistant_answer ?? response.body?.text).toContain("ui append retest");
  });

  it("keeps create note without a title as typed pending input", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create a note", mode: "read", sessionId: `e1014-create-pending-${Date.now()}` })
      .expect(200);

    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.turn_runtime?.terminal?.kind).toBe("pending_input");
    expect(response.body?.assistant_answer ?? response.body?.text).toMatch(/name|title/i);
  });

  it("selects append-to-note from the registry", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "append centerline alpha notes to note research scratch", mode: "read", sessionId: `e1014-append-${Date.now()}` })
      .expect(200);

    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("append_to_note");
    expect(response.body?.workspace_action?.args?.text).toMatch(/centerline alpha/i);
    expect(response.body?.workspace_action?.args?.title).toMatch(/research scratch/i);
    expect(selectedCapabilities(response.body)).toContain("workstation-notes.append_to_note");
  });

  it("does not clarify natural append text before note target", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "append centerline alpha notes to note research scratch", mode: "read", sessionId: `e1014-append-natural-${Date.now()}` })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.pending_server_request).toBeNull();
    expect(response.body?.workspace_action?.action_id).toBe("append_to_note");
    expect(response.body?.workspace_action?.args?.text).toBe("centerline alpha notes");
    expect(response.body?.workspace_action?.args?.title).toBe("research scratch");
    expect(response.body?.assistant_answer ?? response.body?.text).not.toMatch(/need text|what exact text/i);
  });

  it("selects list notes from the registry", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "list notes", mode: "read", sessionId: `e1014-list-${Date.now()}` })
      .expect(200);

    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("list_notes");
    expect(selectedCapabilities(response.body)).toContain("workstation-notes.list_notes");
  });

  it("selects current-doc identity from the registry", async () => {
    const app = createApp();
    const sessionId = `e1014-doc-id-${Date.now()}`;
    const open = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open the latest NHM2 doc", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what paper am I viewing?", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.workspace_action?.action_id).toBe("identify_current_doc");
    expect(selectedCapabilities(response.body)).toContain("docs-viewer.identify_current_doc");
    expect(response.body?.assistant_answer).toContain(open.body?.workspace_action?.args?.path);
    expect(response.body?.assistant_answer).not.toMatch(/Completed reasoning for|Tool selected:/i);
  });

  it("selects summarize doc from the registry with a reasoning follow-up", async () => {
    const app = createApp();
    const sessionId = `e1014-summary-${Date.now()}`;
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "summarize this doc", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(response.body?.workspace_action?.action_id).toBe("summarize_doc");
    expect(selectedCapabilities(response.body)).toContain("docs-viewer.summarize_doc");
    expect(selectedCapabilities(response.body)).toContain("reasoning.followup");
  });

  it("selects copy latest result to clipboard from the registry", async () => {
    const app = createApp();
    const sessionId = `e1014-copy-clip-${Date.now()}`;
    await request(app).post("/api/agi/ask/turn").send({ question: "hello", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "copy latest result to clipboard", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.workspace_action?.panel_id).toBe("workstation-clipboard-history");
    expect(response.body?.workspace_action?.action_id).toBe("copy_receipt_to_clipboard");
    expect(selectedCapabilities(response.body)).toContain("workstation-clipboard-history.copy_receipt_to_clipboard");
    expect(response.body?.assistant_answer ?? response.body?.text).not.toMatch(/failed to execute/i);
  });
});
