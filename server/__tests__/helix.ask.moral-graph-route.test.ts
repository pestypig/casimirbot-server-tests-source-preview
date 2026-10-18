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

describe("Helix Ask MoralGraph reflection route", () => {
  it("does not let contextual scholarly words inside a MoralGraph reflection prompt hijack the route", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Use the Moral Badge Graph to reflect this conversation as procedural next moves. The quoted conversation mentions research papers, data, and decisions, but do not search external sources; use the MoralGraph receipt as evidence for model synthesis.",
        mode: "read",
        debug: true,
        sessionId: `moral-graph-contextual-research-${Date.now()}`,
      });

    if (response.status !== 200) {
      console.error(JSON.stringify({
        error: response.body?.error,
        route: response.body?.route,
        route_reason_code: response.body?.route_reason_code,
        final_answer_source: response.body?.final_answer_source,
        terminal_artifact_kind: response.body?.terminal_artifact_kind,
        selected_target_source: response.body?.evidence_target_arbitration?.selected_target_source,
        selected_candidate_id: response.body?.evidence_target_arbitration?.selected_candidate_id,
      }, null, 2));
    }
    expect(response.status).toBe(200);

    const body = response.body;
    const scholarlyCandidate = body?.evidence_target_arbitration?.evidence_target_candidates?.find(
      (candidate: any) => candidate?.candidate_id === "scholarly_research.external_sources",
    );

    expect(body?.route_reason_code).toBe("moral_graph_reflection");
    expect(body?.canonical_goal_frame?.goal_kind).toBe("moral_graph_reflection");
    expect(body?.workstation_tool_plan?.intent).toBe("moral_graph_reflection");
    if (body?.evidence_target_arbitration) {
      expect(body.evidence_target_arbitration.selected_candidate_id).toBe("workstation_panel.moral_graph_reflection");
      expect(scholarlyCandidate?.reason_codes).toEqual(
        expect.arrayContaining([
          "contextual_research_mention_only",
          "no_external_research_operator_command",
        ]),
      );
    }
    expect(body?.moral_graph_reflection_tool_result?.reflection?.schemaVersion).toBe("ideology_context_reflection/v1");
    expect(String(body?.selected_final_answer ?? "")).toMatch(/MoralGraph applied reflection/i);
  }, 60_000);

  it("routes Moral Badge Graph and Fruition prompts through non-terminal MoralGraph evidence", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Use the Moral Badge Graph to reflect this situation: I need to respond to a teammate who made an uncertain safety claim. Plot direct observation, right speech, and two-key review, then show what Fruition would solve before any action.",
        mode: "read",
        debug: true,
        sessionId: `moral-graph-route-${Date.now()}`,
      });

    if (response.status !== 200) {
      console.error(JSON.stringify({
        error: response.body?.error,
        route: response.body?.route,
        route_reason_code: response.body?.route_reason_code,
        final_answer_source: response.body?.final_answer_source,
        terminal_artifact_kind: response.body?.terminal_artifact_kind,
        invariant_violations: response.body?.invariant_violations,
        workstation_intent: response.body?.planner_contract?.workstation_tool_plan?.intent,
        selection_fail_reason: response.body?.planner_contract?.selection_fail_reason,
      }, null, 2));
    }
    expect(response.status).toBe(200);

    const body = response.body;
    const answer = String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "");

    expect(body?.route_reason_code).toBe("moral_graph_reflection");
    expect(body?.route).toBe("moral_graph_reflection");
    expect(body?.final_answer_source).toBe("final_answer_draft");
    expect(body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(body?.canonical_goal_frame?.goal_kind).toBe("moral_graph_reflection");
    expect(body?.canonical_goal_frame?.required_terminal_kind).toBe("model_synthesized_answer");
    expect(body?.route_product_contract?.allowed_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["model_synthesized_answer"]),
    );
    expect(body?.route_product_contract?.forbidden_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["workspace_action_receipt", "direct_answer_text"]),
    );
    expect(body?.workstation_tool_plan?.intent).toBe("moral_graph_reflection");
    expect(body?.source_target_intent?.suppressed_routes).toEqual(
      expect.arrayContaining(["calculator_solve", "calculator_compound_chain"]),
    );
    expect(body?.ideology_context_reflection?.schemaVersion).toBe("ideology_context_reflection/v1");
    expect(body?.moral_badge_locator?.schemaVersion).toBe("moral_badge_locator/v1");
    expect(body?.fruition_procedure_expression?.schemaVersion).toBe("fruition_procedure_expression/v1");
    expect(body?.moral_graph_reflection_tool_result?.admissions?.[0]?.authority?.agent_executable).toBe(false);
    expect(body?.action_envelope?.workstation_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          panel_id: "fruition-calculator",
          action_id: "open",
        }),
      ]),
    );
    expect(body?.action_envelope?.workstation_actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          panel_id: "scientific-calculator",
        }),
      ]),
    );
    expect(body?.current_turn_artifact_ledger?.map((artifact: any) => artifact.kind)).toEqual(
      expect.arrayContaining(["helix_moral_graph_reflection_tool_result", "workstation_tool_evaluation", "final_answer_draft"]),
    );
    expect(body?.moral_graph_reflection_tool_result?.admissions?.[0]?.authority?.terminal_eligible).toBe(false);
    expect(body?.final_answer_draft).toMatchObject({
      schema: "helix.final_answer_draft.v1",
      goal_kind: "moral_graph_reflection",
    });
    expect(answer).toMatch(/MoralGraph applied reflection/i);
    expect(answer).toMatch(/Restated through MoralGraph:/i);
    expect(answer).toMatch(/Activated lenses:/i);
    expect(answer).toMatch(/Applied to the prompt:/i);
    expect(answer).toMatch(/Path to root:/i);
    expect(answer).toMatch(/Next evidence question:/i);
    expect(answer).toMatch(/agent_executable=false/i);
  }, 60_000);

  it("streams Moral Badge Graph and Fruition prompts through the same workstation evaluation terminal product", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question:
          "Use the Moral Badge Graph to reflect this situation: I need to respond to a teammate who made an uncertain safety claim. Plot direct observation, right speech, and two-key review, then show what Fruition would solve before any action.",
        mode: "read",
        debug: true,
        sessionId: `moral-graph-stream-route-${Date.now()}`,
      });

    expect(response.status).toBe(200);
    const events = parseSseEvents(response.text);
    const terminalEvent = events.find((entry) => entry.event === "turn_transcript_event" && entry.data?.source_event_type === "terminal_answer");
    const finalEvent = events.find((entry) => entry.event === "turn_final");
    const body = finalEvent?.data;

    expect(terminalEvent?.data?.final_answer_source).toBe("final_answer_draft");
    expect(body?.route_reason_code).toBe("moral_graph_reflection");
    expect(body?.route).toBe("moral_graph_reflection");
    expect(body?.final_answer_source).toBe("final_answer_draft");
    expect(body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(body?.canonical_goal_frame?.goal_kind).toBe("moral_graph_reflection");
    expect(body?.canonical_goal_frame?.required_terminal_kind).toBe("model_synthesized_answer");
    expect(body?.workstation_tool_plan?.intent).toBe("moral_graph_reflection");
    expect(body?.ideology_context_reflection?.schemaVersion).toBe("ideology_context_reflection/v1");
    expect(body?.moral_badge_locator?.schemaVersion).toBe("moral_badge_locator/v1");
    expect(body?.fruition_procedure_expression?.schemaVersion).toBe("fruition_procedure_expression/v1");
    expect(body?.moral_graph_reflection_tool_result?.admissions?.[0]?.authority?.agent_executable).toBe(false);
    expect(body?.terminal_answer_authority?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(body?.terminal_answer_authority?.final_answer_source).toBe("final_answer_draft");
    expect(body?.terminal_surface_parity_invariant?.ok).toBe(true);
    expect(body?.terminal_surface_parity_invariant?.failure_codes ?? []).not.toEqual(
      expect.arrayContaining(["controller_decision_not_terminal", "controller_goal_terminal_mismatch"]),
    );
    expect(body?.current_turn_artifact_ledger?.map((artifact: any) => artifact.kind)).toEqual(
      expect.arrayContaining(["helix_moral_graph_reflection_tool_result", "workstation_tool_evaluation", "final_answer_draft"]),
    );
    expect(String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "")).toMatch(/Restated through MoralGraph:|Applied to the prompt:/i);
  }, 60_000);

  it("keeps the desktop Ask endpoint and debug export aligned for MoralGraph/Fruition evidence", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask")
      .send({
        question: "Use the Moral Badge Graph to plot right speech and two-key review, then load the comparison into Fruition.",
        mode: "read",
        debug: true,
        sessionId: `moral-graph-desktop-route-${Date.now()}`,
      });

    expect(response.status).toBe(200);
    const body = response.body;
    expect(body?.route_reason_code).toBe("moral_graph_reflection");
    expect(body?.route).toBe("moral_graph_reflection");
    expect(body?.final_answer_source).toBe("final_answer_draft");
    expect(body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(body?.canonical_goal_frame).toMatchObject({
      goal_kind: "moral_graph_reflection",
      required_terminal_kind: "model_synthesized_answer",
    });
    expect(body?.route_product_contract?.allowed_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["model_synthesized_answer"]),
    );
    expect(body?.route_product_contract?.forbidden_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["workspace_action_receipt", "direct_answer_text"]),
    );
    expect(body?.ideology_context_reflection?.schemaVersion).toBe("ideology_context_reflection/v1");
    expect(body?.moral_badge_locator?.schemaVersion).toBe("moral_badge_locator/v1");
    expect(body?.fruition_procedure_expression?.schemaVersion).toBe("fruition_procedure_expression/v1");
    expect(body?.action_envelope?.workstation_actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          panel_id: "docs-viewer",
        }),
      ]),
    );
    expect(body?.terminal_answer_authority).toMatchObject({
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
      route: "moral_graph_reflection",
    });
    expect(body?.terminal_surface_parity_invariant?.ok).toBe(true);
    expect(body?.final_route_reconciliation?.ok).toBe(true);
    expect(body?.solver_controller_decision).toMatchObject({
      decision: "allow_terminal",
      canonical_goal_kind: "moral_graph_reflection",
      required_terminal_kind: "model_synthesized_answer",
      selected_terminal_artifact_kind: "model_synthesized_answer",
    });

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(String(body?.turn_id))}/debug-export`)
      .expect(200);
    const exported = debugExport.body?.payload;
    expect(exported?.resolved_turn_summary?.resolved_route_label).toContain("moral_graph_reflection");
    expect(exported?.resolved_turn_summary?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(exported?.final_answer_source).toBe("final_answer_draft");
    expect(exported?.solver_controller_summary).toMatchObject({
      decision: "allow_terminal",
      final_route: "moral_graph_reflection",
      required_terminal_kind: "model_synthesized_answer",
      selected_terminal_artifact_kind: "model_synthesized_answer",
      final_route_reconciliation_ok: true,
    });
    expect(exported?.current_turn_artifact_ledger?.map((artifact: any) => artifact.kind)).toEqual(
      expect.arrayContaining(["helix_moral_graph_reflection_tool_result", "workstation_tool_evaluation", "final_answer_draft"]),
    );
    expect(exported?.terminal_surface_parity_invariant?.ok).toBe(true);
  }, 60_000);
});
