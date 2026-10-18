import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
  updateLiveAnswerEnvironment,
} from "../services/situation-room/live-answer-environment-store";

const threadId = "helix-ask:desktop";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

describe("Helix Ask live answer evidence retrieval", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
  });

  it("answers calculator live-source state by reading the active live answer card", async () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:seed-live-calculator",
      objective: "Use calculator equations as a live source and call out when value crosses threshold 10.",
      preset: "calculator_equation_interpreter",
      source_ids: ["source:calculator-equation-live"],
      now: "2026-05-29T12:00:00.000Z",
    });
    updateLiveAnswerEnvironment({
      environment_id: environment.environment_id,
      reason: "computation_tick",
      line_values: {
        current_equation: {
          value: "3*4",
          confidence: 0.94,
          evidence_refs: ["calculator:threshold-12"],
          source_event_ids: ["live_source_event:calculator-threshold-12"],
          source: "deterministic_reducer",
          model_invoked: false,
          deterministic: true,
        },
        latest_result: {
          value: "12",
          confidence: 0.88,
          evidence_refs: ["calculator:threshold-12"],
          source_event_ids: ["live_source_event:calculator-threshold-12"],
          source: "deterministic_reducer",
          model_invoked: false,
          deterministic: true,
        },
        interpretation: {
          value: "With value, the current solve returns 12. In context: threshold watch 10.",
          confidence: 0.76,
          evidence_refs: ["calculator:threshold-12"],
          source_event_ids: ["live_source_event:calculator-threshold-12"],
          source: "deterministic_reducer",
          model_invoked: false,
          deterministic: true,
        },
      },
      latest_summary: "Equation source evaluated: 12. Threshold watch: call out when value crosses 10.",
      evidence_refs: ["calculator:threshold-12"],
      source_event_count: 1,
      now: "2026-05-29T12:00:01.000Z",
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Using the active calculator live answer environment, what is the latest result and did it cross threshold 10?",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    expect(response.body.canonical_goal_frame).toMatchObject({
      goal_kind: "live_environment_review",
      required_terminal_kind: "live_environment_tool_observation",
    });
    expect(response.body.route_reason_code).not.toMatch(/calculator_solve|calculator_compound_chain/);
    expect(response.body.available_capabilities?.recommended_capability_key).toBe("live_env.read_card");
    expect(JSON.stringify(response.body.current_turn_artifact_ledger)).toContain("live_env.read_card");
    const runtimeSummary = response.body.current_turn_artifact_ledger
      .filter((artifact: { kind?: string }) =>
        artifact.kind === "runtime_tool_call" ||
        artifact.kind === "runtime_tool_call_validation" ||
        artifact.kind === "runtime_tool_observation" ||
        artifact.kind === "runtime_goal_satisfaction_observation"
      )
      .map((artifact: { kind?: string; payload?: unknown }) => artifact.payload);
    expect(response.body.answer, JSON.stringify({
      runtimeSummary,
      poisonAudit: response.body.poison_audit,
      routeProductContract: response.body.route_product_contract,
      terminalArtifactSelectionGuard: response.body.terminal_artifact_selection_guard,
      productAuthorityGuard: response.body.product_authority_guard,
      solverControllerDecision: response.body.solver_controller_decision,
      finalAnswerDraft: response.body.final_answer_draft,
      terminalPresentation: response.body.terminal_presentation,
      terminalAnswerEnvelope: response.body.terminal_answer_envelope,
    }, null, 2)).toContain("12");
    expect(response.body.answer).toContain("Threshold 10");
    expect(response.body.answer).toContain("crossed");
    expect(response.body.answer).not.toContain("Dottie spoke");
  }, 20_000);
});
