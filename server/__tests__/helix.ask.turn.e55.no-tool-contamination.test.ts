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

const answerText = (body: any): string => String(body?.selected_final_answer ?? body?.text ?? "");

describe("helix ask E55 no-tool contamination", () => {
  it("treats ignore-open-document explanation as model-only and blocks active-doc context", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Ignore the open document for this one: explain why alpha less than 1 shortens proper time.",
        mode: "read",
        debug: true,
        sessionId: `e55-ignore-open-doc-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs",
          activeDocPath:
            "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/envelope/warp-nhm2-envelope-perturbation-suite-2026-04-26.md",
        },
      })
      .expect(200);

    expect(response.body?.turn_scope_contract?.answer_scope).toBe("model_only");
    expect(response.body?.turn_scope_contract?.workspace_policy?.allow_workspace_lookup).toBe(false);
    expect(response.body?.turn_scope_contract?.workspace_policy?.allow_active_doc_context).toBe(false);
    expect(response.body?.terminal_artifact_kind).toMatch(/direct_answer_text|typed_failure/);
    expect(response.body?.execution_trace?.some((step: any) => step?.action?.action_id === "open_doc_by_path")).not.toBe(true);
    expect(answerText(response.body)).not.toMatch(/Explained the active document|Key claim|Useful anchors|\/docs\//i);
  }, 60000);

  it("rejects workspace-shaped prose on no-workspace prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Without checking the workspace, explain alpha compressing proper time.",
        mode: "read",
        debug: true,
        sessionId: `e55-no-workspace-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs",
          activeDocPath:
            "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/envelope/warp-nhm2-envelope-perturbation-suite-2026-04-26.md",
        },
      })
      .expect(200);

    expect(response.body?.turn_scope_contract?.workspace_policy?.allow_workspace_lookup).toBe(false);
    expect(response.body?.execution_trace?.some((step: any) => step?.action?.action_id === "search_docs")).not.toBe(true);
    expect(response.body?.no_tool_contamination_check?.verdict).toMatch(/clean|typed_failure/);
    expect(answerText(response.body)).not.toMatch(/Explained the active document|Key claim|Useful anchors|Locations:|\/docs\//i);
    if (response.body?.terminal_artifact_kind !== "typed_failure") {
      expect(response.body?.no_tool_contamination_check?.verdict).toBe("clean");
    }
  }, 60000);
});
