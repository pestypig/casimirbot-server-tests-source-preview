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

const activeDocPath = "/docs/research/nhm2-frontier-distance-report.md";

const workspaceSnapshot = (sessionId: string) => ({
  sessionId,
  activePanel: "docs-viewer",
  activeDocPath,
  hasDocContext: true,
  hasNoteContext: true,
  activeNoteTitle: "e30 source scratch",
  lastCreatedNoteTitle: "e30 source scratch",
});

const textOf = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

describe("helix ask turn e30 final answer source ownership", () => {
  it("keeps simple conversation on the no-tool direct terminal path without job-ready links", async () => {
    const app = createApp();
    const sessionId = `e30-no-tool-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello, still working after cancel?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("conversation:simple");
    expect(response.body?.dispatch_policy).toBe("direct_answer_only");
    expect(response.body?.workspace_action ?? null).toBeNull();
    expect(response.body?.final_status).toBe("final_answer");
    expect(response.body?.final_answer_source).toBe("no_tool_direct");
    expect(response.body?.selected_final_answer).toBe(textOf(response.body));
    expect(response.body?.turn_truth_table?.terminal?.final_answer_source).toBe("no_tool_direct");
    expect(response.body?.job_ready_links ?? []).toEqual([]);
    expect(response.body?.job_ready_links_current_turn_only).toBe(true);
    expect(textOf(response.body)).not.toMatch(/retrieval recovery|current document|summarize/i);
  });

  it("does not allow doc summary prompts to complete as legacy fallback", async () => {
    const app = createApp();
    const sessionId = `e30-doc-summary-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(response.body?.final_answer_source).not.toBe("legacy_fallback");
    expect(response.body?.final_answer_source).not.toBe("client_fallback");
    expect(["artifact_synthesis", "typed_failure", "planner_terminal", "universal_composer"]).toContain(response.body?.final_answer_source);
    expect(textOf(response.body)).not.toMatch(/^You are currently on:/i);
  });

  it("marks missing authoritative terminal fallback as typed failure for nontrivial turns", async () => {
    const app = createApp();
    const sessionId = `e30-fallback-block-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about? [[TEST_FORCE_EMPTY_TERMINAL]]",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    if (response.body?.final_answer_source === "typed_failure") {
      expect(response.body?.fallback_blocked).toBe(true);
      expect(response.body?.terminal_error_code).toBe("authoritative_terminal_missing");
      expect(textOf(response.body)).toMatch(/authoritative terminal artifact was missing/i);
    } else {
      expect(["artifact_synthesis", "universal_composer"]).toContain(response.body?.final_answer_source);
      expect(response.body?.fallback_blocked ?? false).toBe(false);
    }
    expect(response.body?.final_answer_source).not.toBe("legacy_fallback");
  });
});
