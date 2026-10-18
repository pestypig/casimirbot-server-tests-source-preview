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

const actionsOf = (body: any): any[] =>
  (body?.execution_trace ?? []).map((step: any) => step?.action).filter(Boolean);

const answerText = (body: any): string =>
  String(body?.selected_final_answer ?? body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

describe("helix ask E47 tool-choice arbitration", () => {
  it("routes conceptual background questions to model-only arbitration instead of retrieval recovery", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "background question: in GR, what is an extrinsic curvature tensor and why would a warp solver track it?",
        mode: "read",
        debug: true,
        sessionId: `e47-model-only-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.tool_choice_arbitration?.answer_scope).toBe("model_only");
    expect(response.body?.tool_choice_arbitration?.evidence_need).toBe("none");
    expect(response.body?.tool_choice_arbitration?.first_step).toBe("model");
    expect(actionsOf(response.body).some((action) => action?.panel_id === "docs-viewer")).toBe(false);
    expect(response.body?.terminal_error_code).not.toBe("retrieval_recovery_failed");
    expect(response.body?.retrieval_recovery_failed).not.toBe(true);
    expect(answerText(response.body)).not.toMatch(/retrieval recovery|current document|No active document/i);
  }, 60000);

  it("does not let ambient active-doc context hijack conceptual versus questions", async () => {
    const app = createApp();
    const activePath = "/docs/research/nhm2-frontier-distance-report.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Can you explain proper time vs coordinate time in simple terms?",
        mode: "read",
        debug: true,
        sessionId: `e47-conceptual-vs-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs",
          activeDocPath: activePath,
          docViewer: {
            currentPath: activePath,
          },
        },
      })
      .expect(200);

    expect(response.body?.tool_choice_arbitration?.answer_scope).toBe("model_only");
    expect(response.body?.tool_choice_arbitration?.evidence_need).toBe("none");
    expect(response.body?.terminal_artifact_kind).not.toBe("doc_summary");
    expect(answerText(response.body)).not.toMatch(/Explained\s+\/docs|Compared\s+\//i);
    expect(response.body?.rejected_terminal_candidates ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "active_doc_path",
          rejection_reason: "ambient_workspace_context",
        }),
      ]),
    );
  }, 60000);

  it("keeps active-doc concept explanations workspace grounded and seeds a concept locate step", async () => {
    const app = createApp();
    const activePath =
      "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-shift-lapse-transport-result-2026-04-27.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "explain what alpha 0p7000 means in this doc in normal scientific language",
        mode: "read",
        debug: true,
        sessionId: `e47-active-doc-concept-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs",
          activeDocPath: activePath,
          docViewer: {
            currentPath: activePath,
          },
        },
      })
      .expect(200);

    expect(response.body?.tool_choice_arbitration?.answer_scope).toBe("hybrid");
    expect(response.body?.tool_choice_arbitration?.evidence_need).toBe("active_doc");
    expect(
      actionsOf(response.body).some(
        (action) =>
          action?.panel_id === "docs-viewer" &&
          action?.action_id === "locate_in_doc" &&
          /alpha\s+0p7000/i.test(String(action?.args?.query ?? "")),
      ),
    ).toBe(true);
    expect(actionsOf(response.body).some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "summarize_doc")).toBe(true);
    expect(response.body?.terminal_error_code).not.toBe("retrieval_recovery_failed");
  }, 60000);

  it("cleans open-doc topic tails before search arbitration", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "find the latest doc about NHM2 frontier distance from 0p995 and tell me which doc is best",
        mode: "read",
        debug: true,
        sessionId: `e47-topic-tail-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.tool_choice_arbitration?.answer_scope).toBe("workspace_grounded");
    const searchQueries = actionsOf(response.body)
      .filter((action) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")
      .map((action) => String(action?.args?.query ?? ""));
    expect(searchQueries.length).toBeGreaterThan(0);
    expect(searchQueries[0]).toContain("NHM2 frontier distance from 0p995");
    expect(searchQueries[0]).not.toMatch(/\band\s*$/i);
    expect(searchQueries[0]).not.toMatch(/\band tell me/i);
  }, 60000);
});
