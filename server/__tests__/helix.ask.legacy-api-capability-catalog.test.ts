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

describe("Helix Ask legacy API capability catalog", () => {
  it("routes desktop Ask capability-surface questions through the capability catalog terminal contract", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask")
      .send({
        question: "What tools are available for the helix ask to use?",
        mode: "read",
        debug: true,
        sessionId: `legacy-capability-catalog-${Date.now()}`,
      })
      .expect(200);

    const body = response.body;
    const answerText = String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "");

    expect(answerText).toMatch(/tool|capabilit|calculator|docs/i);
    expect(body?.canonical_goal_frame).toMatchObject({
      goal_kind: "capability_help",
      required_terminal_kind: "capability_help_summary",
    });
    expect(body?.final_answer_source).toBe("capability_help_summary");
    expect(body?.terminal_artifact_kind).toBe("capability_help_summary");
    expect(body?.capability_plan).toMatchObject({
      capability_family: "capability_catalog",
      selected_capability: "helix_ask.inspect_capability_catalog",
    });
    expect(body?.tool_call_admission_decision?.admitted_tool_families ?? []).toEqual(
      expect.arrayContaining(["capability_catalog"]),
    );
    expect(body?.terminal_answer_authority).toMatchObject({
      final_answer_source: "capability_help_summary",
      terminal_artifact_kind: "capability_help_summary",
    });
    expect(body?.solver_controller_decision).toMatchObject({
      decision: "allow_terminal",
      required_terminal_kind: "capability_help_summary",
      selected_terminal_artifact_kind: "capability_help_summary",
    });

    const availableCapabilities =
      body?.initial_available_capabilities ??
      body?.available_capabilities ??
      body?.debug?.initial_available_capabilities ??
      body?.debug?.available_capabilities;
    const capabilityRows = Array.isArray(availableCapabilities?.capabilities)
      ? availableCapabilities.capabilities
      : [];
    const capabilityByKey = (key: string) =>
      capabilityRows.find((entry: Record<string, unknown>) => entry?.capability_key === key);

    expect(capabilityByKey("live_env.query_source_health")).toMatchObject({
      expected_artifacts: expect.arrayContaining([
        "live_environment_tool_observation",
        "helix.situation_source_capability_read.v1",
        "helix.workstation_goal_context_update.v1",
      ]),
    });
    expect(capabilityByKey("live_env.query_trace_memory")).toMatchObject({
      expected_artifacts: expect.arrayContaining([
        "live_environment_tool_observation",
        "helix.workstation_reasoning_trace_query_result.v1",
        "helix.workstation_goal_context_update.v1",
      ]),
    });
    expect(capabilityByKey("live_env.query_narrator_events")).toMatchObject({
      expected_artifacts: expect.arrayContaining([
        "live_environment_tool_observation",
        "stage_play_workstation_context_feed_query_result/v1",
        "helix.workstation_goal_context_update.v1",
      ]),
    });
    expect(capabilityByKey("live_env.evaluate_goal_satisfaction")).toMatchObject({
      expected_artifacts: expect.arrayContaining([
        "live_environment_tool_observation",
        "helix.live_environment_goal_satisfaction.v1",
        "helix.workstation_goal_context_update.v1",
      ]),
    });
    expect(capabilityByKey("live_env.repair_loop")).toMatchObject({
      expected_artifacts: expect.arrayContaining([
        "live_environment_tool_observation",
        "stage_play_workstation_control_receipt",
      ]),
      model_visible_input_schema: expect.objectContaining({
        properties: expect.objectContaining({
          loop_ref: expect.any(Object),
          state: expect.any(Object),
        }),
      }),
    });
    expect(capabilityByKey("live_env.repair_workstation_source")).toMatchObject({
      expected_artifacts: expect.arrayContaining([
        "live_environment_tool_observation",
        "stage_play_workstation_control_receipt",
      ]),
    });
  }, 60_000);
});
