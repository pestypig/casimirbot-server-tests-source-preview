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

describe("helix ask turn e10.26 context-aware tool continuation", () => {
  it("does not treat an open docs panel as valid deictic doc context without an active path", async () => {
    const app = createApp();
    const sessionId = `e1026-doc-context-missing-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: null,
          hasDocContext: true,
        },
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.workspace_context_snapshot?.hasDocContext).toBe(false);
    expect(response.body?.workspace_context_snapshot?.docContextValid).toBe(false);
    expect(answerText(response.body)).toMatch(/No active document|current document context/i);
  });

  it("uses active doc path artifacts when deictic doc context is actually valid", async () => {
    const app = createApp();
    const sessionId = `e1026-doc-context-valid-${Date.now()}`;
    const path = "/docs/research/example.md";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what paper am I viewing?",
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

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("identify_current_doc");
    expect(response.body?.workspace_action?.args?.path).toBe(path);
    expect(response.body?.workspace_context_snapshot?.hasDocContext).toBe(true);
    expect(response.body?.workspace_context_snapshot?.docContextValid).toBe(true);
    expect(answerText(response.body)).toContain(path);
  });
});
