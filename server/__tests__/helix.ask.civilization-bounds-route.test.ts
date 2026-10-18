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

const parseSseEvents = (text: string): Array<{ event: string; data: any }> => {
  return text
    .split(/\n\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const eventLine = chunk.split(/\n/).find((line) => line.startsWith("event: "));
      const dataLine = chunk.split(/\n/).find((line) => line.startsWith("data: "));
      return {
        event: eventLine?.slice("event: ".length) ?? "message",
        data: dataLine ? JSON.parse(dataLine.slice("data: ".length)) : null,
      };
    });
};

const civilizationBoundsPrompt =
  "Reflect this as a civilization bounds roadmap: compare energy budget, material inventory, manufacturing resolution, governance review, and Moral procedural gates.";

describe("Helix Ask Civilization Bounds route", () => {
  it("executes civilization bounds as workstation evidence via ask/turn", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: civilizationBoundsPrompt,
        mode: "read",
        debug: true,
        sessionId: `civilization-bounds-route-${Date.now()}`,
      })
      .expect(200);

    const body = response.body;
    const answer = String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "");

    expect(body?.route_reason_code).toBe("civilization_bounds_reflection");
    expect(body?.route).toBe("civilization_bounds_reflection");
    expect(body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(body?.final_answer_source).toBe("final_answer_draft");
    expect(body?.workstation_tool_plan?.intent).toBe("civilization_bounds_reflection");
    expect(body?.civilization_scenario_frame_tool_result?.frame?.schemaVersion).toBe("civilization_scenario_frame/v1");
    expect(body?.civilization_scenario_frame_tool_result?.frame?.evidenceMode).toBe("user_hypothesis");
    expect(body?.civilization_bounds_roadmap_tool_result?.roadmap?.schemaVersion).toBe("civilization_bounds_roadmap/v1");
    expect(body?.civilization_bounds_roadmap_tool_result?.roadmap?.scenarioId).toBe(
      body?.civilization_scenario_frame_tool_result?.frame?.frameId,
    );
    expect(body?.civilization_bounds_roadmap_tool_result?.roadmap?.authority).toMatchObject({
      assistant_answer: false,
      terminal_eligible: false,
      agent_executable: false,
    });
    expect(body?.workstation_tool_evaluation?.summary).toContain(
      "Civilization Bounds Roadmap produced evidence-only system bounds",
    );
    expect(body?.ask_turn_solver_trace?.completed_solver_path).toBe(true);
    expect(body?.ask_turn_solver_trace?.evidence_reentry_gate?.evidence_reentered).toBe(true);
    expect(body?.terminal_answer_authority).toMatchObject({
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
      route: "civilization_bounds_reflection",
    });
    expect(body?.current_turn_artifact_ledger?.map((artifact: any) => artifact.kind)).toEqual(
      expect.arrayContaining([
        "helix_civilization_scenario_frame_tool_result",
        "helix_civilization_bounds_tool_result",
        "workstation_tool_evaluation",
        "final_answer_draft",
      ]),
    );
    expect(answer).toContain("situational bounds receipt");
    expect(answer).toContain("bounded system frame");
    expect(answer).toContain("does not decide what should happen");
    expect(body?.route).not.toBe("conversation:simple");
  }, 60_000);

  it("streams civilization bounds through the same terminal workstation evaluation", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question: civilizationBoundsPrompt,
        mode: "read",
        debug: true,
        sessionId: `civilization-bounds-stream-${Date.now()}`,
      })
      .expect(200);

    const events = parseSseEvents(response.text);
    const terminalEvent = events.find(
      (entry) => entry.event === "turn_transcript_event" && entry.data?.source_event_type === "terminal_answer",
    );
    const finalEvent = events.find((entry) => entry.event === "turn_final");
    const body = finalEvent?.data;

    expect(terminalEvent?.data?.final_answer_source).toBe("final_answer_draft");
    expect(body?.route_reason_code).toBe("civilization_bounds_reflection");
    expect(body?.route).toBe("civilization_bounds_reflection");
    expect(body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(body?.final_answer_source).toBe("final_answer_draft");
    expect(body?.civilization_scenario_frame_tool_result?.frame?.schemaVersion).toBe("civilization_scenario_frame/v1");
    expect(body?.civilization_bounds_roadmap_tool_result?.roadmap?.schemaVersion).toBe("civilization_bounds_roadmap/v1");
    expect(body?.ask_turn_solver_trace?.evidence_reentry_gate?.evidence_reentered).toBe(true);
    expect(body?.terminal_surface_parity_invariant?.ok).toBe(true);
    expect(String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "")).toContain("situational bounds receipt");
  }, 60_000);

  it("falls back when the composer falsely claims civilization observations are missing", async () => {
    const previous = process.env.HELIX_CIVILIZATION_BOUNDS_FINAL_ANSWER_TEST_RESPONSE;
    process.env.HELIX_CIVILIZATION_BOUNDS_FINAL_ANSWER_TEST_RESPONSE =
      "No compact observations or excerpts were provided to support this analysis. The goal satisfaction evaluation indicates necessary information is missing. Please provide relevant data or observations.";
    try {
      const app = createApp();

      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question:
            "Use Civilization Bounds to assess whether a ceasefire claim based on marginal battlefield cost, defensive denial capacity, infrastructure stability, and resource buildout rates is an ultimatum or only a conditional decision model.",
          mode: "read",
          debug: true,
          sessionId: `civilization-bounds-composer-guard-${Date.now()}`,
        })
        .expect(200);

      const body = response.body;
      const answer = String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "");

      expect(body?.route).toBe("civilization_bounds_reflection");
      expect(body?.terminal_artifact_kind).toBe("model_synthesized_answer");
      expect(body?.final_answer_source).toBe("final_answer_draft");
      expect(body?.final_answer_draft?.authority).toBe("deterministic_receipt_fallback");
      expect(body?.final_answer_draft?.llm_error_code).toBe("civilization_bounds_composer_contradicted_receipts");
      expect(answer).toContain("plausible constraint model, not an ultimatum or proof");
      expect(answer).toContain("Resource proof boundary");
      expect(answer).not.toContain("No compact observations");
    } finally {
      if (previous === undefined) {
        delete process.env.HELIX_CIVILIZATION_BOUNDS_FINAL_ANSWER_TEST_RESPONSE;
      } else {
        process.env.HELIX_CIVILIZATION_BOUNDS_FINAL_ANSWER_TEST_RESPONSE = previous;
      }
    }
  }, 60_000);

  it("keeps Theory/Moral bridge continuity from the desktop Ask endpoint", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask")
      .send({
        question:
          "Use the Theory Moral bridge with civilization bounds for entropy, conservation, material inventory, fairness, and review.",
        mode: "read",
        debug: true,
        sessionId: `civilization-bounds-bridge-${Date.now()}`,
      })
      .expect(200);

    const body = response.body;
    const stepIds = body?.workstation_tool_plan?.steps?.map((step: { step_id?: string }) => step.step_id) ?? [];

    expect(body?.route_reason_code).toBe("civilization_bounds_reflection");
    expect(stepIds).toEqual(
      expect.arrayContaining([
        "reflect_theory_context",
        "reflect_moral_graph_context",
        "build_civilization_scenario_frame",
        "reflect_civilization_bounds",
        "bridge_theory_ideology_context",
      ]),
    );
    expect(body?.civilization_scenario_frame_tool_result?.frame?.schemaVersion).toBe("civilization_scenario_frame/v1");
    expect(body?.civilization_bounds_roadmap_tool_result?.roadmap?.schemaVersion).toBe("civilization_bounds_roadmap/v1");
    expect(body?.theory_ideology_bridge_tool_result?.bridge?.schemaVersion).toBe("theory_ideology_bridge/v1");
    expect(body?.current_turn_artifact_ledger?.map((artifact: any) => artifact.kind)).toEqual(
      expect.arrayContaining([
        "helix_civilization_scenario_frame_tool_result",
        "helix_theory_context_reflection_tool_receipt",
        "helix_moral_graph_reflection_tool_result",
        "helix_civilization_bounds_tool_result",
        "helix_theory_ideology_bridge_tool_result",
        "workstation_tool_evaluation",
        "final_answer_draft",
      ]),
    );
  }, 60_000);
});
