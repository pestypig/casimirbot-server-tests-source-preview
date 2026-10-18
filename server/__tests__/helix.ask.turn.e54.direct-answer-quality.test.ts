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

describe("helix ask E54 direct-answer quality", () => {
  it("treats model.direct_answer as a terminal model step, not a tool call", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Explain why momentum is conserved in an isolated two-object collision. Do not use workstation tools unless genuinely needed.",
        mode: "read",
        debug: true,
        sessionId: `e54-model-direct-answer-${Date.now()}`,
      })
      .expect(200);

    const body = response.body;
    const answer = answerText(body).toLowerCase();
    const debugText = JSON.stringify(body).toLowerCase();

    expect(body?.terminal_artifact_kind).toBe("direct_answer_text");
    expect(body?.final_answer_source).toBe("model_direct_answer");
    expect(answer).toContain("isolated");
    expect(answer).toMatch(/external (force|impulse)|net external/);
    expect(answer).toMatch(/equal and opposite|newton|internal forces?/);
    expect(answer).toMatch(/total momentum/);

    expect(body?.direct_answer_text?.text).toBeTruthy();
    expect(body?.final_answer_draft?.text).toBeTruthy();
    expect(body?.goal_satisfaction_evaluation?.satisfaction).toBe("satisfied");
    expect(body?.terminal_answer_authority?.server_authoritative).toBe(true);

    const loopIterations = body?.agent_runtime_loop?.iterations ?? [];
    expect(loopIterations.some((iteration: any) =>
      iteration?.next_step === "answer" &&
      iteration?.chosen_capability === "model.direct_answer" &&
      iteration?.observation_role === "model_answer_draft"
    )).toBe(true);

    const actualCalls = body?.loop_parity_trace?.actual_tool_calls ?? [];
    expect(actualCalls.some((call: any) => call?.tool_id === "model.direct_answer")).toBe(false);
    expect(debugText).not.toContain("invalid_args");
    expect(debugText).not.toContain("capability_lifecycle_incomplete");
    expect(debugText).not.toContain("budget_exhausted");
  }, 60000);

  it("does not accept the retry placeholder as a successful background-only final answer", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Background only: explain why alpha less than 1 shortens proper time.",
        mode: "read",
        debug: true,
        sessionId: `e54-direct-quality-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs",
          activeDocPath:
            "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/envelope/warp-nhm2-envelope-perturbation-suite-2026-04-26.md",
        },
      })
      .expect(200);

    expect(response.body?.retrieval_required_signal?.required).toBe(false);
    expect(["direct_answer_text", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    expect(answerText(response.body)).not.toMatch(/I couldn.?t produce a final answer for that turn|Please retry once/i);
    expect(answerText(response.body)).not.toMatch(/^Explained\s+\//i);
    if (response.body?.terminal_artifact_kind === "typed_failure") {
      expect(["direct_answer_unavailable", "model_only_answer_unavailable"]).toContain(
        response.body?.terminal_error_code,
      );
    }
  }, 60000);

  it("answers workspace onboarding with Helix-specific capabilities without retrieval", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What can you help me do in this workspace?",
        mode: "read",
        debug: true,
        sessionId: `e54-workspace-help-${Date.now()}`,
      })
      .expect(200);

    const answer = answerText(response.body).toLowerCase();
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("workspace_help");
    expect(response.body?.retrieval_required_signal?.required).toBe(false);
    expect(response.body?.execution_trace?.some((step: any) => step?.action?.action_id === "search_docs")).not.toBe(true);
    for (const expected of ["docs", "notes", "clipboard", "calculator", "live-source", "information reflection", "utility"]) {
      expect(answer).toContain(expected);
    }
    expect(answer).toContain("dottie");
    expect(answer).toContain("preset/context");
  }, 60000);
});
