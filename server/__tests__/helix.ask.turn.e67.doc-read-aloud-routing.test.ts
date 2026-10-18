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

const activePath = "docs/research/nhm2-current-status-whitepaper.md";

const collectActions = (body: any): Array<{ panel_id?: string; action_id?: string; args?: Record<string, unknown> }> => {
  const envelopeActions = Array.isArray(body?.action_envelope?.workstation_actions)
    ? body.action_envelope.workstation_actions
    : [];
  const traceActions = Array.isArray(body?.execution_trace)
    ? body.execution_trace.map((step: any) => step?.action).filter(Boolean)
    : [];
  return [body?.workspace_action, ...(envelopeActions ?? []), ...(traceActions ?? [])].filter(Boolean);
};

describe("helix ask E67 docs read-aloud routing", () => {
  it("routes active-doc read-aloud prompts to open_doc_and_read instead of no-tool direct answers", async () => {
    const app = createApp();
    const sessionId = `e67-read-active-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "read this doc outloud",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          hasDocContext: true,
        },
      })
      .expect(200);

    const actions = collectActions(response.body);
    expect(response.body?.dispatch_policy).not.toBe("direct_answer_only");
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          panel_id: "docs-viewer",
          action_id: "open_doc_and_read",
          args: expect.objectContaining({ path: activePath }),
        }),
      ]),
    );
  }, 90000);

  it("routes named whitepaper read-aloud prompts through docs acquisition and read start", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Ok read Nhm2 Current Status Whitepaper to me",
        mode: "read",
        debug: true,
        sessionId: `e67-read-named-${Date.now()}`,
      })
      .expect(200);

    const actions = collectActions(response.body);
    const serialized = JSON.stringify(response.body);
    expect(response.body?.canonical_goal_frame?.goal_kind).not.toBe("model_only_concept");
    expect(response.body?.dispatch_policy).not.toBe("direct_answer_only");
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "open_doc_and_read")).toBe(true);
    expect(serialized).toContain("docs/research/nhm2-current-status-whitepaper.md");
  }, 90000);
});
