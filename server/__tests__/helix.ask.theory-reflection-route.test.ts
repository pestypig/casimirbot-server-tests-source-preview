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

const parseSseEvents = (text: string): Array<{ event: string; data: any }> =>
  text
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

describe("Helix Ask theory reflection route", () => {
  it("routes explicit Theory Graph plus MoralGraph bridge prompts through bridge receipts instead of model-only concept", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Reflect fairness and due process through entropy, conservation, and self-organization in the Theory Badge Graph and MoralGraph. Keep it evidence-only and do not treat physics as moral proof.",
        mode: "read",
        debug: true,
        sessionId: `theory-ideology-bridge-route-${Date.now()}`,
      })
      .expect(200);

    const body = response.body;
    const answer = String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "");

    expect(body?.route_reason_code).toBe("theory_ideology_bridge_reflection");
    expect(body?.final_answer_source).toBe("workstation_tool_evaluation");
    expect(body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(body?.canonical_goal_frame?.goal_kind).not.toBe("model_only_concept");
    expect(body?.model_only_concept_source_signal?.should_prefer_model_only_concept).not.toBe(true);
    expect(body?.workstation_tool_plan?.intent).toBe("theory_ideology_bridge_reflection");
    expect(body?.workstation_tool_plan?.steps?.map((step: { tool_id?: string }) => step.tool_id)).toEqual(
      expect.arrayContaining([
        "helix_ask.reflect_theory_context",
        "helix_ask.reflect_ideology_context",
        "helix_ask.bridge_theory_ideology_context",
      ]),
    );
    const topTheoryBadgeIds =
      body?.theory_context_reflection_tool_receipt?.reflectionV1?.exactMatches
        ?.slice(0, 3)
        ?.map((match: { badgeId?: string }) => match.badgeId) ?? [];
    expect(topTheoryBadgeIds).toEqual(
      expect.arrayContaining([
        "biophysics.membrane.open_system_entropy_flow",
        expect.stringMatching(/conservation/),
      ]),
    );
    expect(topTheoryBadgeIds.join(" ")).not.toMatch(/astrochemistry|spectroscopy|pah|fullerene/i);
    expect(answer).toMatch(/physics|conservation|entropy|self-organization/i);
    expect(answer).toMatch(/do not prove moral certainty|moral certainty|moral proof/i);
    expect(answer).toMatch(/procedural|evidence-only|missing checks/i);
    expect(answer).not.toMatch(/Missing checks:\s*theory_context_reflection/i);
    expect(answer).toMatch(/theory counterpart/i);

    const debugResponse = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(String(body?.turn_id))}/debug-export`)
      .expect(200);
    const debugPayload = debugResponse.body?.payload;
    expect(debugPayload?.solver_controller_summary).toEqual(
      expect.objectContaining({
        decision: "allow_terminal",
        route_authority_ok: true,
        terminal_authority_route: "theory_ideology_bridge_reflection",
        selected_terminal_artifact_kind: "workstation_tool_evaluation",
      }),
    );
    expect(debugPayload?.tool_lifecycle_trace).toEqual(
      expect.objectContaining({
        requested_capability: "helix_ask.bridge_theory_ideology_context",
        executed_capability: "helix_ask.bridge_theory_ideology_context",
        lifecycle_stage: "reentered_solver",
        status: "completed",
      }),
    );
    expect(debugPayload?.tool_followup_decision).toEqual(
      expect.objectContaining({
        evidence_reentered: true,
        next_action: "terminal_answer",
      }),
    );
  });

  it("streams explicit Theory Graph plus MoralGraph bridge prompts through bridge receipts", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question:
          "Reflect fairness and due process through entropy, conservation, and self-organization in the Theory Badge Graph and MoralGraph. Keep it evidence-only and do not treat physics as moral proof.",
        mode: "read",
        debug: true,
        sessionId: `theory-ideology-bridge-stream-${Date.now()}`,
      })
      .expect(200);

    const events = parseSseEvents(response.text);
    const terminalEvent = events.find((entry) => entry.event === "turn_transcript_event" && entry.data?.source_event_type === "terminal_answer");
    const finalEvent = events.find((entry) => entry.event === "turn_final");
    const body = finalEvent?.data;

    expect(terminalEvent?.data?.final_answer_source).toBe("workstation_tool_evaluation");
    expect(body?.route_reason_code).toBe("theory_ideology_bridge_reflection");
    expect(body?.final_answer_source).toBe("workstation_tool_evaluation");
    expect(body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(body?.workstation_tool_plan?.intent).toBe("theory_ideology_bridge_reflection");
    expect(body?.theory_ideology_bridge_tool_result?.bridge?.schemaVersion).toBe("theory_ideology_bridge/v1");
    expect(String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "")).toMatch(
      /physics|conservation|entropy|self-organization/i,
    );
    expect(String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "")).toMatch(
      /moral certainty|moral proof/i,
    );
  }, 15_000);

  it("routes reflection-only theory graph prompts through synthesized theory answers", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Where does E=hf fit in the theory graph?",
        mode: "read",
        debug: true,
        sessionId: `theory-reflection-route-${Date.now()}`,
      })
      .expect(200);

    const body = response.body;
    const answer = String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "");
    const actions = body?.action_envelope?.workstation_actions ?? [];

    expect(body?.route_reason_code).toBe("theory_context_reflection");
    expect(body?.final_answer_source).toBe("final_answer_draft");
    expect(body?.terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(body?.terminal_answer_authority?.terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(body?.debug?.terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(body?.debug?.terminal_answer_authority?.terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(body?.canonical_goal_frame?.goal_kind).toBe("theory_context_reflection");
    expect(body?.goal_satisfaction_evaluation?.canonical_goal_kind).toBe("theory_context_reflection");
    expect(body?.goal_satisfaction_evaluation?.terminal_contract?.goal_kind).toBe("theory_context_reflection");
    expect(body?.workstation_tool_plan?.intent).toBe("theory_context_reflection");
    expect(body?.workstation_tool_evaluation?.supports_goal).toBe(true);
    expect(actions).toEqual([]);
    expect(body?.theory_context_reflection_tool_receipt?.artifactId).toBe(
      "helix_theory_context_reflection_tool_receipt",
    );
    expect(body?.post_tool_synthesis_plan?.artifactId).toBe("helix_post_tool_synthesis_plan");
    expect(answer).toMatch(/E = hf means a photon's energy is proportional to its frequency/i);
    expect(answer).toMatch(/Theory Badge Graph|graph reflection observed|context evidence/i);
    expect(answer).toMatch(/not a solve/i);
    expect(answer).not.toBe(
      body?.theory_context_reflection_tool_receipt?.reflectionV1?.evidenceForAsk?.summary,
    );
  });

  it("materializes frontier search candidates and exact verification as non-terminal ledger artifacts", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Run the Theory Frontier Seed Finder for missing intermediate badges in the Theory Badge Graph. Keep it non-terminal evidence only.",
        mode: "read",
        debug: true,
        sessionId: `theory-frontier-materialization-route-${Date.now()}`,
      })
      .expect(200);

    const body = response.body;
    const ledger = Array.isArray(body?.current_turn_artifact_ledger) ? body.current_turn_artifact_ledger : [];
    const ledgerKinds = ledger.map((artifact: { kind?: string }) => artifact.kind);

    expect(body?.route_reason_code).toBe("theory_context_reflection");
    expect(body?.theory_context_reflection_tool_receipt?.frontierSearchV1?.artifactId).toBe("theory_frontier_search");
    expect(body?.theory_context_reflection_tool_receipt?.frontierSearchV1?.candidates?.length).toBeGreaterThan(0);
    expect(body?.theory_context_reflection_tool_receipt?.frontierExactVerificationResultsV1?.length).toBe(
      body?.theory_context_reflection_tool_receipt?.frontierSearchV1?.candidates?.length,
    );
    const frontierScholarlyActions = (
      body?.theory_context_reflection_tool_receipt?.recommendedNextActions ?? []
    ).filter(
      (action: { actionId?: string }) =>
        action.actionId === "theory-badge-graph.request_frontier_scholarly_lookup",
    );
    expect(frontierScholarlyActions.length).toBe(
      body?.theory_context_reflection_tool_receipt?.frontierSearchV1?.scholarlyLookupRequests?.length,
    );
    expect(frontierScholarlyActions[0]?.args).toEqual(
      expect.objectContaining({
        target_source: "scholarly_research",
        mutating: false,
        no_auto_promote_literature: true,
      }),
    );
    expect(ledgerKinds).toEqual(expect.arrayContaining([
      "helix_theory_context_reflection_tool_receipt",
      "theory_frontier_search",
      "theory_frontier_candidate",
      "theory_frontier_exact_contract_verification",
    ]));
    expect(ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "theory_frontier_candidate",
        payload: expect.objectContaining({
          assistant_answer: false,
          raw_content_included: false,
          terminal_eligible: false,
        }),
      }),
      expect.objectContaining({
        kind: "theory_frontier_exact_contract_verification",
        payload: expect.objectContaining({
          assistant_answer: false,
          raw_content_included: false,
          terminal_eligible: false,
        }),
      }),
    ]));
  });

  it("routes NHM2/QEI mapping prompts through reflection instead of direct answers", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Map source residual and QEI margin in the theory graph.",
        mode: "read",
        debug: true,
        sessionId: `theory-reflection-qei-route-${Date.now()}`,
      })
      .expect(200);

    const body = response.body;

    expect(body?.route_reason_code).toBe("theory_context_reflection");
    expect(body?.action_envelope?.workstation_actions).toEqual([]);
    expect(body?.theory_context_reflection_tool_receipt?.artifactId).toBe(
      "helix_theory_context_reflection_tool_receipt",
    );
    expect(body?.post_tool_synthesis_plan?.artifactId).toBe("helix_post_tool_synthesis_plan");
    expect(String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "")).toMatch(/first-principles explanation route|context evidence/i);
  });

  it("keeps theory reflection in the live route for mapped calculator prompts", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Calculate photon energy for f=5e14 Hz and show where E=hf fits in the theory graph.",
        mode: "read",
        debug: true,
        sessionId: `theory-reflection-calculator-route-${Date.now()}`,
      })
      .expect(200);

    const body = response.body;
    const actions = body?.action_envelope?.workstation_actions ?? [];
    const answer = String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "");

    expect(body?.route_reason_code).toBe("theory_context_reflection");
    expect(body?.workstation_tool_plan?.intent).toBe("physics_calculation_context");
    expect(body?.current_turn_artifact_ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "helix_theory_context_reflection_tool_receipt",
        }),
      ]),
    );
    expect(body?.theory_context_reflection_tool_receipt?.artifactId).toBe(
      "helix_theory_context_reflection_tool_receipt",
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          panel_id: "scientific-calculator",
          action_id: "open",
        }),
        expect.objectContaining({
          panel_id: "scientific-calculator",
          action_id: "ingest_latex",
        }),
        expect.objectContaining({
          panel_id: "scientific-calculator",
          action_id: "solve_expression",
        }),
      ]),
    );
    expect(answer).toMatch(/Evidence note: theory graph reflection supplied context; Scientific Calculator receipts supplied the numeric result/i);
    expect(body?.post_tool_synthesis_plan?.artifactId).toBe("helix_post_tool_synthesis_plan");
    expect(body?.current_turn_artifact_ledger).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "helix_post_tool_synthesis_plan" })]),
    );
    const finalDraftText = String(body?.final_answer_draft?.text ?? body?.debug?.final_answer_draft?.text ?? "");
    if (finalDraftText) {
      expect(finalDraftText).toMatch(
        /Evidence note: theory graph reflection supplied context; Scientific Calculator receipts supplied the numeric result/i,
      );
    }
    const calculatorDraftText = String(
      body?.calculator_final_answer_draft?.text ?? body?.debug?.calculator_final_answer_draft?.text ?? "",
    );
    if (calculatorDraftText) {
      expect(calculatorDraftText).toMatch(
        /Evidence note: theory graph reflection supplied context; Scientific Calculator receipts supplied the numeric result/i,
      );
    }
    expect(answer).toMatch(/3\.313035/i);

    const debugResponse = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(String(body?.turn_id))}/debug-export`)
      .expect(200);
    const debugPayload = debugResponse.body?.payload;
    expect(debugPayload?.tool_trace_disclosure?.action_keys).toEqual(
      expect.arrayContaining([
        "helix_ask.reflect_theory_context",
        "scientific-calculator.solve_expression",
      ]),
    );
    expect(debugPayload?.tool_trace_disclosure?.answerNote).toBe(
      "Evidence note: theory graph reflection supplied context; Scientific Calculator receipts supplied the numeric result.",
    );
  });

  it("routes mapped first-principles Casimir scalar prompts through theory reflection plus calculator receipts", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Map Casimir cavity mode energy to first principles, then calculate a mode frequency for L=1e-6 m and n=1, and the photon energy of that mode.",
        mode: "read",
        debug: true,
        sessionId: `theory-reflection-casimir-calculator-route-${Date.now()}`,
      })
      .expect(200);

    const body = response.body;
    const answer = String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "");

    expect(body?.route_reason_code).toBe("calculator_solve / calculator_compound_chain");
    expect(body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(body?.theory_context_reflection_tool_receipt?.artifactId).toBe(
      "helix_theory_context_reflection_tool_receipt",
    );
    expect(body?.current_turn_artifact_ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "helix_theory_context_reflection_tool_receipt" }),
        expect.objectContaining({ kind: "calculator_receipt" }),
      ]),
    );
    expect(answer).toMatch(/Mode frequency:\s*1\.5e\+14 Hz/i);
    expect(answer).toMatch(/Photon energy:\s*9\.939105e-20 J/i);
    expect(answer).toMatch(/Theory context:/i);
    expect(answer).toMatch(/graph reflection is context evidence only/i);
    expect(answer).toMatch(/Evidence note: theory graph reflection supplied context; Scientific Calculator receipts supplied the numeric result/i);
    expect(answer).not.toMatch(/model-only/i);
  }, 15_000);
});
