import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
  HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
} from "@shared/helix-scholarly-research-observation";
import { HELIX_INTERNET_SEARCH_CAPABILITY } from "@shared/helix-internet-search-observation";
import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";
import { buildCapabilityPlan } from "../services/helix-ask/capability-planner";
import { buildCapabilityResultGate } from "../services/helix-ask/capability-result-gate";
import { buildEvidenceReentryGate } from "../services/helix-ask/evidence-reentry-gate";
import { evaluateFinalAnswerDraftQualityGate } from "../services/helix-ask/final-answer-draft-quality-gate";
import { materializeFinalAnswerDraftTerminal } from "../services/helix-ask/final-answer-draft-terminal-materializer";
import { buildRouteProductContract } from "../services/helix-ask/route-product-contract";
import { buildToolCallAdmissionDecision } from "../services/helix-ask/tool-call-admission";
import {
  contextualToolSuppressionBlocksFamily,
  detectContextualToolAdmissionSuppression,
} from "../services/helix-ask/contextual-tool-admission";
import { buildHelixCapabilityItinerary } from "../services/helix-ask/capability-itinerary";
import { detectScholarlyResearchIntent } from "../services/helix-ask/scholarly-research-intent";
import { buildToolUseRestatement } from "../services/helix-ask/internet-search-intent";
import { buildHelixCapabilityItineraryExecutionState } from "../services/helix-ask/capability-itinerary-execution";
import {
  __testHelixAgentStepDecisionHints,
  __testHelixAgentStepRepairHints,
  __testHelixGoalSatisfaction,
  __testHelixRuntimeToolCallValidation,
  __testHelixScholarlyTerminalAuthorityRefresh,
  __testHelixScholarlyFinalFallback,
  planRouter,
} from "../routes/agi.plan";
import {
  runScholarlyResearchLookup,
  type ScholarlyFetch,
} from "../services/helix-ask/retrieval/scholarly-research-lookup";
import { runScholarlyFullTextFetch } from "../services/helix-ask/retrieval/scholarly-full-text-fetch";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const canonicalGoal = (goal_kind: string, required_terminal_kind: string | null) => ({
  turn_id: "ask:scholarly",
  goal_kind,
  answer_scope: "external_scholarly_research",
  required_terminal_kind,
  allows_workspace_context: false,
  allows_prior_artifacts: false,
  corpus_anchors: [],
  numeric_tokens: [],
  concept_tokens: [],
  confidence: "high",
  classifier_reasons: ["test"],
});

const compoundScholarlyLocatorItinerary = (turnId: string) => ({
  schema: "helix.capability_itinerary.v1",
  turn_id: turnId,
  prompt_shape: "compound_tool",
  relevant_tool_families: ["scholarly_research", "theory_locator"],
  admitted_tool_families: ["scholarly_research", "theory_locator"],
  terminal_success_criteria: {
    requires_post_observation_synthesis: true,
    required_observation_families: ["scholarly_research", "theory_locator"],
  },
});

describe("Helix scholarly research tool admission", () => {
  it("publishes scholarly lookup as executable for compound scholarly plus theory locator asks", async () => {
    const app = createApp();
    const promptText =
      "Do not write files. Use scholarly papers and citations to research microtubule coherence, then place it on the theory badge graph with scale bands and uncertainty mode. Explain what evidence was actually used.";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:test:scholarly-compound-menu",
        question: promptText,
        mode: "read",
        debug: true,
      })
      .expect(200);

    const availableCapabilities =
      response.body?.available_capabilities ??
      response.body?.initial_available_capabilities;
    const scholarlyLookup = availableCapabilities?.capabilities?.find(
      (capability: any) => capability?.capability_key === HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
    );
    const directAnswer = availableCapabilities?.capabilities?.find(
      (capability: any) => capability?.capability_key === "model.direct_answer",
    );

    expect(response.body?.canonical_goal_frame?.goal_kind).toEqual(
      expect.stringMatching(/^(scholarly_research_lookup|theory_context_reflection)$/),
    );
    expect(response.body?.tool_call_admission_decision?.admitted_tool_families).toEqual(
      expect.arrayContaining(["scholarly_research"]),
    );
    expect(response.body?.capability_itinerary?.prompt_shape).toBe("compound_tool");
    expect(response.body?.capability_itinerary?.relevant_tool_families).toEqual(
      expect.arrayContaining(["scholarly_research", "theory_locator"]),
    );
    expect(availableCapabilities?.recommended_capability_key).toBe(HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY);
    expect(scholarlyLookup).toMatchObject({
      capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      goal_fit: "primary",
    });
    expect(directAnswer?.goal_fit).toBe("forbidden");
    expect(response.body?.tool_choice_arbitration).toMatchObject({
      answer_scope: "source_tool_backed",
      evidence_need: "scholarly_research",
      first_step: "tool",
    });
    expect(response.body?.capability_selection_result).toMatchObject({
      capability_id: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      expected_observation: {
        kind: "scholarly_research_observation",
      },
    });
    if (response.body?.compound_prompt_coverage_gate?.decision === "FAIL_CLOSED") {
      expect(response.body?.ok).toBe(false);
      expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
      expect(response.body?.final_answer_source).toBe("typed_failure");
      expect(response.body?.terminal_error_code).not.toBe("terminal_consistency_violation");
    }
    expect(response.body?.live_source_turn_phase_resolution).toBeFalsy();
    expect(response.body?.terminal_error_code).not.toBe("live_source_phase_violation");
  }, 90000);

  it("does not let negated workspace mutation language activate live-source phase suppression", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:test:scholarly-negated-write-not-live-source",
        question:
          "Use scholarly research to find papers about quantum coherence in photosynthesis, then use the Theory Badge Graph locator to place the claim and synthesize uncertainty with citations. Do not write files, do not create notes, and do not mutate workspace state.",
        mode: "read",
        debug: true,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("compound_research_locator");
    expect(response.body?.source_target_intent?.target_source).toBe("scholarly_research");
    expect(response.body?.tool_call_admission_decision?.admitted_tool_families).toEqual(
      expect.arrayContaining(["scholarly_research", "theory_locator"]),
    );
    expect(response.body?.available_capabilities?.recommended_capability_key ?? response.body?.initial_available_capabilities?.recommended_capability_key)
      .toBe(HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY);
    expect(response.body?.live_source_turn_phase_resolution).toBeFalsy();
    expect(response.body?.terminal_error_code).not.toBe("live_source_phase_violation");
  }, 90000);

  it("preserves multi-source compound prompts instead of collapsing theory locator to workstation panel control", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:test:multi-source-compound-not-panel-shortcut",
        question:
          "Use scholarly research, the Theory Badge Graph locator, and repo/code evidence together to explain whether Helix Ask correctly treats tool receipts as observations rather than answer authority. Do not write files.",
        mode: "read",
        debug: true,
      });

    expect(response.status, JSON.stringify(response.body, null, 2).slice(0, 6000)).toBe(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).not.toBe("panel_control");
    expect(response.body?.source_target_intent?.target_source).not.toBe("workstation_panel");
    expect(response.body?.tool_call_admission_decision?.admitted_tool_families ?? []).toEqual(
      expect.arrayContaining(["theory_locator"]),
    );
    expect(response.body?.tool_call_admission_decision?.admitted_tool_families ?? []).toEqual(
      expect.arrayContaining(["scholarly_research"]),
    );
    expect(response.body?.terminal_error_code).not.toBe("solver_path_incomplete_before_terminal");
  }, 90000);

  it("attaches compound coverage for source-targeted scholarly plus locator phrasings", async () => {
    const app = createApp();
    const promptText =
      "Use scholarly research to find papers about photosynthesis quantum coherence and microtubule Orch-OR claims, then use the Theory Badge Graph locator / theory locator to place the relevant claims and synthesize the uncertainty with citations. Do not write files.";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:test:source-targeted-compound-contract",
        question: promptText,
        mode: "read",
        debug: true,
      });

    expect(response.status, JSON.stringify(response.body, null, 2).slice(0, 6000)).toBe(200);

    const compoundContract =
      response.body?.compound_prompt_contract ??
      response.body?.ask_turn_solver_trace?.compound_prompt_contract ??
      response.body?.prompt_interpretation?.compound_contract;

    expect(response.body?.capability_itinerary).toMatchObject({
      prompt_shape: "compound_tool",
      relevant_tool_families: expect.arrayContaining(["scholarly_research", "theory_locator"]),
    });
    expect(response.body?.tool_call_admission_decision?.admitted_tool_families).toEqual(
      expect.arrayContaining(["scholarly_research", "theory_locator"]),
    );
    expect(compoundContract).toMatchObject({
      schema: "helix.compound_prompt_contract.v1",
    });
    expect(compoundContract?.requirements?.length).toBeGreaterThanOrEqual(2);
    expect(response.body?.compound_prompt_coverage_gate).toMatchObject({
      schema: "helix.compound_prompt_coverage_gate.v1",
      applies: true,
    });
    expect(response.body?.terminal_error_code).not.toBe("terminal_consistency_violation");
  }, 90000);

  it("continues to the theory locator after scholarly evidence when compound itinerary is incomplete", () => {
    const turnId = "ask:scholarly-locator-continuation";
    const promptText =
      "Use scholarly research to find papers about photosynthesis quantum coherence and microtubule Orch-OR claims, then use the Theory Badge Graph locator to place the relevant claims and synthesize uncertainty with citations.";

    const decision = __testHelixAgentStepDecisionHints.buildHelixAgentStepDecisionArtifact({
      turnId,
      transcript: promptText,
      canonicalGoalFrame: canonicalGoal("scholarly_research_lookup", "scholarly_research_answer") as any,
      capabilityItinerary: compoundScholarlyLocatorItinerary(turnId),
      availableCapabilities: {
        schema: "helix.available_capabilities.v1",
        turn_id: turnId,
        recommended_capability_key: "helix_ask.reflect_theory_context",
        tool_admission_suppressed: false,
        capabilities: [
          {
            capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
            requires_action: true,
            availability: "available",
            goal_fit: "possible",
            expected_artifacts: ["scholarly_research_observation"],
            reason: "Scholarly evidence has already been observed.",
          },
          {
            capability_key: "helix_ask.reflect_theory_context",
            requires_action: true,
            availability: "available",
            goal_fit: "primary",
            expected_artifacts: ["helix_theory_context_reflection_tool_receipt"],
            reason: "The compound prompt still requires badge-graph placement evidence.",
          },
          {
            capability_key: "model.direct_answer",
            requires_action: false,
            availability: "available",
            goal_fit: "forbidden",
            expected_artifacts: ["direct_answer_text"],
            reason: "Direct answer is forbidden before required observations are complete.",
          },
        ],
      } as any,
      artifacts: [
        {
          artifact_id: `${turnId}:lookup:scholarly_research_observation`,
          turn_id: turnId,
          kind: "scholarly_research_observation",
          payload: {
            schema: "helix.scholarly_research_observation.v1",
            artifact_id: `${turnId}:lookup:scholarly_research_observation`,
            query: "quantum coherence in photosynthesis",
            result_count: 2,
          },
        },
      ] as any,
      goalSatisfactionEvaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        turn_id: turnId,
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        observed_results: [
          {
            ref: `${turnId}:lookup:scholarly_research_observation`,
            kind: "scholarly_research_observation",
            status: "observed",
            supports_goal: true,
            reason: "Scholarly lookup produced source evidence.",
          },
        ],
      } as any,
      capabilityItineraryRef: `${turnId}:capability_itinerary`,
      decisionTiming: "post_observation",
    });

    expect(decision.decision).toBe("execute");
    expect(decision.next_step).toBe("next_action");
    expect(decision.chosen_capability).toBe("helix_ask.reflect_theory_context");
    expect(decision.action_authorization).toMatchObject({
      required_before_tool_execution: true,
      authorizes_tool_execution: true,
      authorized_capability: "helix_ask.reflect_theory_context",
    });
    expect(decision.stop_condition).toMatch(/theory_locator/);
    expect(decision.continuation_policy).not.toBe("terminal_only");
  });

  it("does not let satisfied goal status preempt a missing compound itinerary family", () => {
    const turnId = "ask:scholarly-locator-terminal-shortcut";
    const promptText =
      "Use scholarly research to find papers about photosynthesis quantum coherence, then use the Theory Badge Graph locator and synthesize uncertainty.";
    const itineraryExecutionState = buildHelixCapabilityItineraryExecutionState({
      capabilityItinerary: compoundScholarlyLocatorItinerary(turnId),
      artifacts: [
        {
          artifact_id: `${turnId}:lookup:scholarly_research_observation`,
          turn_id: turnId,
          kind: "scholarly_research_observation",
          payload: {
            schema: "helix.scholarly_research_observation.v1",
            query: "quantum coherence in photosynthesis",
            result_count: 8,
          },
        },
      ] as any,
    });

    expect(itineraryExecutionState).toMatchObject({
      applies: true,
      complete: false,
      observed_families: ["scholarly_research"],
      missing_observation_families: ["theory_locator"],
      next_missing_family: "theory_locator",
    });
    expect(
      __testHelixAgentStepDecisionHints.shouldPromoteSatisfiedGoalToTerminalInRuntimeLoop({
        goalSatisfactionEvaluation: {
          schema: "helix.goal_satisfaction_evaluation.v1",
          turn_id: turnId,
          satisfaction: "satisfied",
          next_decision: "allow_terminal",
          required_evidence: [],
          observed_results: [
            {
              ref: `${turnId}:lookup:scholarly_research_observation`,
              kind: "scholarly_research_observation",
              status: "observed",
              supports_goal: true,
              reason: "Scholarly lookup produced source evidence.",
            },
          ],
          missing_requirements: [],
          required_actions: [],
          confidence: "medium",
        } as any,
        capabilityItineraryExecutionState: itineraryExecutionState,
        decisionNextStep: "next_action",
        transcript: promptText,
      }),
    ).toBe(false);
  });

  it("requires post-observation synthesis when the compound itinerary observations are complete but no draft exists", () => {
    const turnId = "ask:scholarly-locator-complete";
    const promptText =
      "Use scholarly research to find papers about photosynthesis quantum coherence, then use the Theory Badge Graph locator and synthesize uncertainty.";

    const decision = __testHelixAgentStepDecisionHints.buildHelixAgentStepDecisionArtifact({
      turnId,
      transcript: promptText,
      canonicalGoalFrame: canonicalGoal("scholarly_research_lookup", "scholarly_research_answer") as any,
      capabilityItinerary: compoundScholarlyLocatorItinerary(turnId),
      availableCapabilities: {
        schema: "helix.available_capabilities.v1",
        turn_id: turnId,
        recommended_capability_key: "model.direct_answer",
        tool_admission_suppressed: false,
        capabilities: [
          {
            capability_key: "helix_ask.reflect_theory_context",
            requires_action: true,
            availability: "available",
            goal_fit: "possible",
            expected_artifacts: ["helix_theory_context_reflection_tool_receipt"],
            reason: "Theory locator already produced graph evidence.",
          },
          {
            capability_key: "model.direct_answer",
            requires_action: false,
            availability: "available",
            goal_fit: "fallback",
            expected_artifacts: ["direct_answer_text"],
            reason: "Terminal synthesis is available after itinerary completion.",
          },
        ],
      } as any,
      artifacts: [
        {
          artifact_id: `${turnId}:lookup:scholarly_research_observation`,
          turn_id: turnId,
          kind: "scholarly_research_observation",
          payload: {
            schema: "helix.scholarly_research_observation.v1",
            artifact_id: `${turnId}:lookup:scholarly_research_observation`,
          },
        },
        {
          artifact_id: `${turnId}:theory:helix_theory_context_reflection_tool_receipt`,
          turn_id: turnId,
          kind: "helix_theory_context_reflection_tool_receipt",
          payload: {
            schema: "helix.theory_context_reflection_tool_receipt.v1",
            artifact_id: `${turnId}:theory:helix_theory_context_reflection_tool_receipt`,
          },
        },
      ] as any,
      goalSatisfactionEvaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        turn_id: turnId,
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        observed_results: [],
      } as any,
      capabilityItineraryRef: `${turnId}:capability_itinerary`,
      decisionTiming: "post_observation",
    });

    expect(decision.decision).toBe("answer_directly");
    expect(decision.next_step).toBe("answer");
    expect(decision.chosen_capability).toBe("model.direct_answer");
    expect(decision.expected_artifacts).toEqual(
      expect.arrayContaining(["final_answer_draft", "compound_research_locator_answer"]),
    );
    expect(decision.continuation_policy).not.toBe("terminal_only");
  });

  it("allows terminal when the compound itinerary observations are complete and a final draft exists", () => {
    const turnId = "ask:scholarly-locator-complete-with-draft";
    const promptText =
      "Use scholarly research to find papers about photosynthesis quantum coherence, then use the Theory Badge Graph locator and synthesize uncertainty.";

    const decision = __testHelixAgentStepDecisionHints.buildHelixAgentStepDecisionArtifact({
      turnId,
      transcript: promptText,
      canonicalGoalFrame: canonicalGoal("scholarly_research_lookup", "scholarly_research_answer") as any,
      capabilityItinerary: compoundScholarlyLocatorItinerary(turnId),
      availableCapabilities: {
        schema: "helix.available_capabilities.v1",
        turn_id: turnId,
        recommended_capability_key: "model.direct_answer",
        tool_admission_suppressed: false,
        capabilities: [
          {
            capability_key: "helix_ask.reflect_theory_context",
            requires_action: true,
            availability: "available",
            goal_fit: "possible",
            expected_artifacts: ["helix_theory_context_reflection_tool_receipt"],
            reason: "Theory locator already produced graph evidence.",
          },
          {
            capability_key: "model.direct_answer",
            requires_action: false,
            availability: "available",
            goal_fit: "fallback",
            expected_artifacts: ["final_answer_draft", "compound_research_locator_answer"],
            reason: "Terminal synthesis is available after itinerary completion.",
          },
        ],
      } as any,
      artifacts: [
        {
          artifact_id: `${turnId}:lookup:scholarly_research_observation`,
          turn_id: turnId,
          kind: "scholarly_research_observation",
          payload: {
            schema: "helix.scholarly_research_observation.v1",
            artifact_id: `${turnId}:lookup:scholarly_research_observation`,
          },
        },
        {
          artifact_id: `${turnId}:theory:helix_theory_context_reflection_tool_receipt`,
          turn_id: turnId,
          kind: "helix_theory_context_reflection_tool_receipt",
          payload: {
            schema: "helix.theory_context_reflection_tool_receipt.v1",
            artifact_id: `${turnId}:theory:helix_theory_context_reflection_tool_receipt`,
          },
        },
        {
          artifact_id: `${turnId}:final_answer_draft`,
          turn_id: turnId,
          kind: "final_answer_draft",
          payload: {
            schema: "helix.final_answer_draft.v1",
            text: "Synthesized uncertainty from both observed subgoals.",
            support_refs: [
              `${turnId}:lookup:scholarly_research_observation`,
              `${turnId}:theory:helix_theory_context_reflection_tool_receipt`,
            ],
          },
        },
        {
          artifact_id: `${turnId}:model_synthesized_answer`,
          turn_id: turnId,
          kind: "model_synthesized_answer",
          payload: {
            schema: "helix.model_synthesized_answer.v1",
            kind: "model_synthesized_answer",
            text: "Synthesized uncertainty from both observed subgoals.",
            support_refs: [
              `${turnId}:lookup:scholarly_research_observation`,
              `${turnId}:theory:helix_theory_context_reflection_tool_receipt`,
            ],
          },
        },
        {
          artifact_id: `${turnId}:compound_research_locator_answer`,
          turn_id: turnId,
          kind: "compound_research_locator_answer",
          payload: {
            schema: "helix.compound_research_locator_answer.v1",
            kind: "compound_research_locator_answer",
            text: "Synthesized uncertainty from both observed subgoals.",
            answer_text: "Synthesized uncertainty from both observed subgoals.",
            support_refs: [
              `${turnId}:lookup:scholarly_research_observation`,
              `${turnId}:theory:helix_theory_context_reflection_tool_receipt`,
            ],
            source_observation_refs: [
              `${turnId}:lookup:scholarly_research_observation`,
              `${turnId}:theory:helix_theory_context_reflection_tool_receipt`,
            ],
          },
        },
      ] as any,
      goalSatisfactionEvaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        turn_id: turnId,
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        observed_results: [],
      } as any,
      capabilityItineraryRef: `${turnId}:capability_itinerary`,
      decisionTiming: "post_observation",
    });

    expect(decision.decision).toBe("allow_terminal");
    expect(decision.next_step).toBe("answer");
    expect(decision.continuation_policy).toBe("terminal_only");
  });

  it("selects theory locator evidence refs when a compound itinerary observed both families", () => {
    const turnId = "ask:compound-evidence-reentry";
    const scholarlyRef = `${turnId}:lookup:scholarly_research_observation`;
    const locatorRef = `${turnId}:theory:helix_theory_context_reflection_tool_receipt`;
    const payload = {
      capability_itinerary: {
        ...compoundScholarlyLocatorItinerary(turnId),
        execution_state: {
          applies: true,
          complete: true,
          required_observation_families: ["scholarly_research", "theory_locator"],
          observed_families: ["scholarly_research", "theory_locator"],
          missing_observation_families: [],
        },
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: scholarlyRef,
          kind: "scholarly_research_observation",
          payload: {
            schema: "helix.scholarly_research_observation.v1",
            artifact_id: scholarlyRef,
          },
        },
        {
          artifact_id: locatorRef,
          kind: "helix_theory_context_reflection_tool_receipt",
          payload: {
            schema: "helix.theory_context_reflection_tool_receipt.v1",
            artifact_id: locatorRef,
            capability: "helix_ask.reflect_theory_context",
          },
        },
      ],
    };

    const gate = buildEvidenceReentryGate({
      turnId,
      payload,
      loopTrace: {
        evidence_selected_for_answer: [scholarlyRef],
        actual_tool_calls: [],
        observations_created: [],
      },
      primaryIntent: "question_answering" as any,
      terminalArtifactKind: "compound_research_locator_answer",
      finalAnswerSource: "final_answer_draft",
      finalArbitrationRan: true,
      sourceEvidenceRequired: true,
      allowedTerminalProducts: ["compound_research_locator_answer"],
    });

    expect(gate.selected_evidence_refs).toEqual(expect.arrayContaining([scholarlyRef, locatorRef]));
    expect(gate.completed).toBe(true);
    expect(gate.violation_codes).not.toContain("source_observation_terminal_without_selection");
  });

  it("materializes completed scholarly plus theory locator itineraries as compound answers", () => {
    const turnId = "ask:compound-terminal-kind";
    const scholarlyRef = `${turnId}:lookup:scholarly_research_observation`;
    const locatorRef = `${turnId}:theory:helix_theory_context_reflection_tool_receipt`;
    const draftRef = `${turnId}:draft:final_answer_draft`;
    const routeProductContract = {
      schema: "helix.route_product_contract.v1",
      turn_id: turnId,
      source_target: "scholarly_research",
      allowed_terminal_artifact_kinds: ["scholarly_research_answer", "compound_research_locator_answer"],
    };
    const payload: Record<string, unknown> = {
      active_prompt:
        "Use scholarly research about quantum coherence in photosynthesis and place it on the theory locator with uncertainty.",
      route_product_contract: routeProductContract,
      capability_itinerary: {
        ...compoundScholarlyLocatorItinerary(turnId),
        execution_state: {
          applies: true,
          complete: true,
          required_observation_families: ["scholarly_research", "theory_locator"],
          observed_families: ["scholarly_research", "theory_locator"],
          missing_observation_families: [],
        },
      },
    };
    const artifactLedger = [
      {
        artifact_id: scholarlyRef,
        kind: "scholarly_research_observation",
        payload: {
          schema: "helix.scholarly_research_observation.v1",
          artifact_id: scholarlyRef,
          papers: [{ result_id: "paper:coherence", title: "Quantum coherence in photosynthesis" }],
        },
      },
      {
        artifact_id: locatorRef,
        kind: "helix_theory_context_reflection_tool_receipt",
        payload: {
          schema: "helix.theory_context_reflection_tool_receipt.v1",
          artifact_id: locatorRef,
          capability: "helix_ask.reflect_theory_context",
        },
      },
      {
        artifact_id: draftRef,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          artifact_id: draftRef,
          text: "Scholarly evidence supports photosynthetic coherence as biology-scale physics context; the locator places it as a diagnostic bridge, not consciousness validation.",
          artifact_refs: [scholarlyRef, locatorRef],
        },
      },
    ];

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger,
      routeProductContract,
    });

    expect(result).toMatchObject({
      ok: true,
      materialized_terminal_artifact_kind: "compound_research_locator_answer",
    });
    expect(payload.compound_research_locator_answer).toMatchObject({
      schema: "helix.compound_research_locator_answer.v1",
      support_refs: expect.arrayContaining([scholarlyRef, locatorRef]),
      source_families: ["scholarly_research", "theory_locator"],
    });
    expect(payload.scholarly_research_answer).toBeUndefined();
  });

  it("fails closed when a missing itinerary family has no admitted executable capability", () => {
    const turnId = "ask:scholarly-locator-missing-capability";
    const promptText =
      "Use scholarly research and an internet search, then synthesize uncertainty with citations.";

    const decision = __testHelixAgentStepDecisionHints.buildHelixAgentStepDecisionArtifact({
      turnId,
      transcript: promptText,
      canonicalGoalFrame: canonicalGoal("scholarly_research_lookup", "scholarly_research_answer") as any,
      capabilityItinerary: {
        schema: "helix.capability_itinerary.v1",
        turn_id: turnId,
        prompt_shape: "compound_tool",
        relevant_tool_families: ["scholarly_research", "internet_search"],
        admitted_tool_families: ["scholarly_research"],
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
          required_observation_families: ["scholarly_research", "internet_search"],
        },
      },
      availableCapabilities: {
        schema: "helix.available_capabilities.v1",
        turn_id: turnId,
        recommended_capability_key: "model.direct_answer",
        tool_admission_suppressed: false,
        capabilities: [
          {
            capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
            requires_action: true,
            availability: "available",
            goal_fit: "possible",
            expected_artifacts: ["scholarly_research_observation"],
            reason: "Scholarly evidence has already been observed.",
          },
          {
            capability_key: "model.direct_answer",
            requires_action: false,
            availability: "available",
            goal_fit: "forbidden",
            expected_artifacts: ["direct_answer_text"],
            reason: "Direct answer is forbidden before required observations are complete.",
          },
        ],
      } as any,
      artifacts: [
        {
          artifact_id: `${turnId}:lookup:scholarly_research_observation`,
          turn_id: turnId,
          kind: "scholarly_research_observation",
          payload: {
            schema: "helix.scholarly_research_observation.v1",
            artifact_id: `${turnId}:lookup:scholarly_research_observation`,
          },
        },
      ] as any,
      goalSatisfactionEvaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        turn_id: turnId,
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        observed_results: [],
      } as any,
      capabilityItineraryRef: `${turnId}:capability_itinerary`,
      decisionTiming: "post_observation",
    });

    expect(decision.decision).toBe("fail_closed");
    expect(decision.next_step).toBe("fail");
    expect(decision.chosen_capability).toBeNull();
    expect(decision.why_this_capability_satisfies_goal).toMatch(/internet_search/);
  });

  it("rejects empty scholarly runtime tool args instead of falling back to the full prompt", () => {
    const availableCapabilities = {
      schema: "helix.available_capabilities.v1",
      turn_id: "ask:scholarly-validation",
      tool_admission_suppressed: false,
      capabilities: [
        {
          capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
        {
          capability_key: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
      ],
    } as any;

    const emptyLookup = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:scholarly-validation",
        call_id: "call:lookup-empty",
        capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        args: {},
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(emptyLookup.validation.valid).toBe(false);
    expect(emptyLookup.validation.args_valid).toBe(false);
    expect(emptyLookup.validation.errors).toContain("missing_required_arg:query");

    const emptyFullText = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:scholarly-validation",
        call_id: "call:full-text-empty",
        capability_key: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        args: {},
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(emptyFullText.validation.valid).toBe(false);
    expect(emptyFullText.validation.args_valid).toBe(false);
    expect(emptyFullText.validation.errors).toContain("missing_required_arg:paper_result_or_source");

    const exactLookup = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:scholarly-validation",
        call_id: "call:lookup-arxiv",
        capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        args: { arxiv_id: "1402.3952" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(exactLookup.validation.valid).toBe(true);

    const aliasLookup = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:scholarly-validation",
        call_id: "call:lookup-alias",
        capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        args: { query_or_identifier: "quantum coherence in photosynthesis" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(aliasLookup.validation.valid).toBe(true);

    const selectedPaperFetch = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:scholarly-validation",
        call_id: "call:full-text-result",
        capability_key: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        args: { paper_result_id: "arxiv:1402.3952" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(selectedPaperFetch.validation.valid).toBe(true);
  });

  it("normalizes photosynthesis scholarly lookup aliases before observation materialization", async () => {
    const inputSchema = __testHelixRuntimeToolCallValidation.buildHelixCapabilityInputSchema({
      capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      requires_action: true,
    } as any);
    expect(inputSchema).toMatchObject({
      type: "object",
      properties: {
        query: expect.objectContaining({ type: "string" }),
        query_or_identifier: expect.objectContaining({ type: "string" }),
        doi: expect.objectContaining({ type: "string" }),
        arxiv_id: expect.objectContaining({ type: "string" }),
        title: expect.objectContaining({ type: "string" }),
        journal: expect.objectContaining({ type: "string" }),
        reference: expect.objectContaining({ type: "string" }),
        citation: expect.objectContaining({ type: "string" }),
      },
    });

    const normalizedArgs = __testHelixRuntimeToolCallValidation.normalizeHelixRuntimeToolArgsForCapability(
      HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      { query_or_identifier: "quantum coherence in photosynthesis" },
    );
    expect(normalizedArgs).toMatchObject({
      query: "quantum coherence in photosynthesis",
      runtime_arg_repair: {
        source: "query_or_identifier",
        target: "query",
        reason: "scholarly_lookup_alias_normalized",
      },
    });

    const availableCapabilities = {
      schema: "helix.available_capabilities.v1",
      turn_id: "ask:scholarly-photosynthesis",
      tool_admission_suppressed: false,
      capabilities: [
        {
          capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
      ],
    } as any;
    const firstScholarlyCall = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:scholarly-photosynthesis",
        call_id: "call:photosynthesis-lookup",
        capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        args: normalizedArgs,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(firstScholarlyCall.validation.valid).toBe(true);

    const fetchImpl: ScholarlyFetch = async (url) => {
      expect(url).toContain("api.crossref.org/works");
      expect(decodeURIComponent(url)).toContain("query.bibliographic=quantum coherence in photosynthesis");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            items: [
              {
                title: ["Long-lived quantum coherence in photosynthetic complexes at physiological temperature"],
                DOI: "10.1038/nature08811",
                author: [{ given: "Elisabetta", family: "Collini" }],
                published: { "date-parts": [[2010]] },
                "container-title": ["Nature"],
                "is-referenced-by-count": 1500,
                "reference-count": 30,
                URL: "https://doi.org/10.1038/nature08811",
              },
            ],
          },
        }),
      };
    };

    const observation = await runScholarlyResearchLookup({
      turnId: "ask:scholarly-photosynthesis",
      callId: "call:photosynthesis-lookup",
      query: String(normalizedArgs.query),
      providers: ["crossref"],
      limit: 3,
      fetchImpl,
    });

    expect(observation).toMatchObject({
      schema: "helix.scholarly_research_observation.v1",
      artifact_id: "call:photosynthesis-lookup:scholarly_research_observation",
      capability: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      providers_called: ["crossref"],
      selected_for_answer: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(observation.papers).toHaveLength(1);
    expect(observation.papers[0]).toMatchObject({
      title: "Long-lived quantum coherence in photosynthetic complexes at physiological temperature",
      identifiers: { doi: "10.1038/nature08811" },
      source_providers: ["crossref"],
    });
  });

  it("builds a model-visible preferred scholarly lookup step without becoming execution authority", () => {
    const naturalPrompt =
      "Do research using scholarly papers, DOI links, journals, and citations about quantum coherence in photosynthesis. Find relevant papers first, then answer with citations.";
    const explicitPrompt =
      "Research query: quantum coherence in photosynthesis. Use scholarly papers and DOI links before answering.";

    expect(
      __testHelixAgentStepDecisionHints.extractHelixScholarlyLookupQueryHint(
        naturalPrompt,
        canonicalGoal("scholarly_research_lookup", "scholarly_research_answer") as any,
      ),
    ).toBe("quantum coherence in photosynthesis");
    expect(
      __testHelixAgentStepDecisionHints.extractHelixScholarlyLookupQueryHint(
        explicitPrompt,
        canonicalGoal("scholarly_research_lookup", "scholarly_research_answer") as any,
      ),
    ).toBe("quantum coherence in photosynthesis");

    const availableCapabilities = {
      schema: "helix.available_capabilities.v1",
      turn_id: "ask:scholarly-preferred-step",
      manifest_role: "model_visible_tool_menu",
      tool_manifest_version: "helix.ask.capability_manifest.v1",
      user_goal_summary: naturalPrompt,
      canonical_goal_kind: "scholarly_research_lookup",
      recommended_capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      classifier_hints: [],
      capabilities: [
        {
          capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          label: "Do research on papers, DOI, citations, journals, and references",
          lane: "retrieval",
          requires_action: true,
          expected_artifacts: ["scholarly_research_observation"],
          goal_fit: "primary",
          reason: "Primary match for canonical goal scholarly_research_lookup.",
          model_visible_name: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          model_visible_description: "Lookup scholarly papers.",
          model_visible_input_schema: { properties: { query: { type: "string" } } },
          availability: "available",
        },
      ],
      model_visible_capability_keys: [HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY],
      assistant_answer: false,
      raw_content_included: false,
    } as any;

    const preferred = __testHelixAgentStepDecisionHints.buildHelixPreferredScholarlyLookupDecisionJson({
      transcript: naturalPrompt,
      canonicalGoalFrame: canonicalGoal("scholarly_research_lookup", "scholarly_research_answer") as any,
      availableCapabilities,
      currentTurnArtifacts: [],
    });

    expect(preferred).toMatchObject({
      next_step: "next_action",
      chosen_capability: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      args: { query: "quantum coherence in photosynthesis" },
      expected_artifacts: ["scholarly_research_observation"],
    });

    const afterObservation = __testHelixAgentStepDecisionHints.buildHelixPreferredScholarlyLookupDecisionJson({
      transcript: naturalPrompt,
      canonicalGoalFrame: canonicalGoal("scholarly_research_lookup", "scholarly_research_answer") as any,
      availableCapabilities,
      currentTurnArtifacts: [
        {
          artifact_id: "ask:scholarly-preferred-step:scholarly_research_observation",
          kind: "scholarly_research_observation",
          producer_item_id: "agent_runtime_scholarly_research_tool",
          payload_ref: "inline",
          payload: {
            schema: "helix.scholarly_research_observation.v1",
            papers: [],
          },
          assistant_answer: false,
          raw_content_included: false,
        },
      ] as any,
    });
    expect(afterObservation).toBeNull();
  });

  it("builds a preferred scholarly lookup step from frontier search replay requests", () => {
    const availableCapabilities = {
      schema: "helix.available_capabilities.v1",
      turn_id: "ask:frontier-preferred-scholarly-step",
      manifest_role: "model_visible_tool_menu",
      tool_manifest_version: "helix.ask.capability_manifest.v1",
      user_goal_summary: "Run the Theory Frontier Seed Finder and inspect unresolved candidate regions.",
      canonical_goal_kind: "theory_context_reflection",
      recommended_capability_key: "helix_ask.reflect_theory_context",
      classifier_hints: [],
      capabilities: [
        {
          capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          label: "Do research on papers, DOI, citations, journals, and references",
          lane: "retrieval",
          requires_action: true,
          expected_artifacts: ["scholarly_research_observation"],
          goal_fit: "primary",
          reason: "Visible because frontier search produced a bounded scholarly lookup request.",
          model_visible_name: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          model_visible_description: "Lookup scholarly papers.",
          model_visible_input_schema: { properties: { query: { type: "string" } } },
          availability: "available",
        },
      ],
      model_visible_capability_keys: [HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY],
      assistant_answer: false,
      raw_content_included: false,
    } as any;
    const frontierSearchArtifact = {
      artifact_id: "frontier_search:preferred-scholarly",
      kind: "theory_frontier_search",
      producer_item_id: "agent_runtime_theory_locator_tool",
      payload_ref: "inline",
      payload: {
        kind: "theory_frontier_search",
        artifact_v1: {
          artifactId: "theory_frontier_search",
          schemaVersion: "theory_frontier_search/v1",
          scholarlyLookupRequests: [
            {
              requestId: "scholarly_lookup:frontier-test",
              candidateId: "frontier:test",
              targetSource: "scholarly_research",
              requestedOutputs: ["scholarly_paper_refs", "doi_metadata", "scholarly_full_text", "paper_pdf_pages"],
              query: "qei_margin source residual first principles",
              badgeIds: ["nhm2.qei.sampling_window"],
              renderChunkIds: ["render:qei"],
              semanticChunkIds: ["semantic:qei"],
              reason: "High-value unresolved frontier candidate requires scholarly references as bounded evidence only.",
              mutating: false,
              noAutoPromoteLiterature: true,
            },
          ],
        },
      },
      assistant_answer: false,
      raw_content_included: false,
    };

    const preferred = __testHelixAgentStepDecisionHints.buildHelixPreferredFrontierScholarlyLookupDecisionJson({
      availableCapabilities,
      currentTurnArtifacts: [frontierSearchArtifact] as any,
    });

    expect(preferred).toMatchObject({
      next_step: "next_action",
      chosen_capability: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      args: { query: "qei_margin source residual first principles" },
      expected_artifacts: ["scholarly_research_observation"],
      commentary: {
        observation_summary: "Frontier candidate frontier:test has no scholarly observation yet.",
      },
    });

    const afterObservation = __testHelixAgentStepDecisionHints.buildHelixPreferredFrontierScholarlyLookupDecisionJson({
      availableCapabilities,
      currentTurnArtifacts: [
        frontierSearchArtifact,
        {
          artifact_id: "ask:frontier-preferred-scholarly-step:scholarly_research_observation",
          kind: "scholarly_research_observation",
          producer_item_id: "agent_runtime_scholarly_research_tool",
          payload_ref: "inline",
          payload: {
            schema: "helix.scholarly_research_observation.v1",
            papers: [],
          },
          assistant_answer: false,
          raw_content_included: false,
        },
      ] as any,
    });
    expect(afterObservation).toBeNull();
  });

  it("builds a preferred full-text step from frontier scholarly lookup results", () => {
    const availableCapabilities = {
      schema: "helix.available_capabilities.v1",
      turn_id: "ask:frontier-preferred-full-text-step",
      manifest_role: "model_visible_tool_menu",
      tool_manifest_version: "helix.ask.capability_manifest.v1",
      user_goal_summary: "Run the Theory Frontier Seed Finder and inspect unresolved candidate regions.",
      canonical_goal_kind: "theory_context_reflection",
      recommended_capability_key: "helix_ask.reflect_theory_context",
      classifier_hints: [],
      capabilities: [
        {
          capability_key: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
          label: "Fetch and extract scholarly PDF or full text",
          lane: "retrieval",
          requires_action: true,
          expected_artifacts: ["scholarly_full_text_observation"],
          goal_fit: "primary",
          reason: "Visible because frontier search requested full text for a bounded scholarly candidate.",
          model_visible_name: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
          model_visible_description: "Fetch scholarly full text.",
          model_visible_input_schema: { properties: { paper_result_id: { type: "string" } } },
          availability: "available",
        },
      ],
      model_visible_capability_keys: [HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY],
      assistant_answer: false,
      raw_content_included: false,
    } as any;
    const frontierSearchArtifact = {
      artifact_id: "frontier_search:preferred-full-text",
      kind: "theory_frontier_search",
      producer_item_id: "agent_runtime_theory_locator_tool",
      payload_ref: "inline",
      payload: {
        kind: "theory_frontier_search",
        artifact_v1: {
          artifactId: "theory_frontier_search",
          schemaVersion: "theory_frontier_search/v1",
          scholarlyLookupRequests: [
            {
              requestId: "scholarly_lookup:frontier-full-text",
              candidateId: "frontier:full-text",
              targetSource: "scholarly_research",
              requestedOutputs: ["scholarly_paper_refs", "doi_metadata", "scholarly_full_text", "paper_pdf_pages"],
              query: "negative energy density quantum inequalities first principles",
              badgeIds: ["nhm2.qei.sampling_window"],
              renderChunkIds: ["render:qei"],
              semanticChunkIds: ["semantic:qei"],
              reason: "High-value unresolved frontier candidate requires full-text evidence as bounded context only.",
              mutating: false,
              noAutoPromoteLiterature: true,
            },
          ],
        },
      },
      assistant_answer: false,
      raw_content_included: false,
    };
    const scholarlyObservation = {
      artifact_id: "ask:frontier-preferred-full-text-step:scholarly_research_observation",
      kind: "scholarly_research_observation",
      producer_item_id: "agent_runtime_scholarly_research_tool",
      payload_ref: "inline",
      payload: {
        schema: "helix.scholarly_research_observation.v1",
        papers: [
          {
            result_id: "paper:qei-1",
            title: "Quantum inequalities and negative energy density",
            identifiers: {
              doi: "10.1000/qei",
              pdf_url: "https://example.test/qei.pdf",
            },
          },
        ],
      },
      assistant_answer: false,
      raw_content_included: false,
    };

    const preferred = __testHelixAgentStepDecisionHints.buildHelixPreferredFrontierScholarlyFullTextDecisionJson({
      availableCapabilities,
      currentTurnArtifacts: [frontierSearchArtifact, scholarlyObservation] as any,
    });

    expect(preferred).toMatchObject({
      next_step: "next_action",
      chosen_capability: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      args: {
        query: "negative energy density quantum inequalities first principles",
        paper_result_id: "paper:qei-1",
        source_url: "https://example.test/qei.pdf",
      },
      expected_artifacts: ["scholarly_full_text_observation"],
      commentary: {
        observation_summary: "Frontier candidate frontier:full-text has scholarly metadata but no full-text observation yet.",
      },
    });

    const afterFullText = __testHelixAgentStepDecisionHints.buildHelixPreferredFrontierScholarlyFullTextDecisionJson({
      availableCapabilities,
      currentTurnArtifacts: [
        frontierSearchArtifact,
        scholarlyObservation,
        {
          artifact_id: "ask:frontier-preferred-full-text-step:scholarly_full_text_observation",
          kind: "scholarly_full_text_observation",
          producer_item_id: "agent_runtime_scholarly_research_tool",
          payload_ref: "inline",
          payload: {
            schema: "helix.scholarly_full_text_observation.v1",
            pages_parsed: 1,
            selected_chunks: [],
            assistant_answer: false,
            raw_content_included: false,
          },
          assistant_answer: false,
          raw_content_included: false,
        },
      ] as any,
    });
    expect(afterFullText).toBeNull();
  });

  it("rejects runtime tool calls outside the admitted tool family", () => {
    const availableCapabilities = {
      schema: "helix.available_capabilities.v1",
      turn_id: "ask:runtime-admission-gate",
      tool_admission_suppressed: false,
      capabilities: [
        {
          capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
        {
          capability_key: "docs-viewer.locate_in_doc",
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
      ],
    } as any;
    const docsOnlyAdmission = {
      schema: "helix.tool_call_admission_decision.v1",
      turn_id: "ask:runtime-admission-gate",
      source_target: "docs_viewer",
      required: true,
      admitted_tool_families: ["docs_viewer"],
      forbidden_terminal_artifact_kinds: [],
      forbidden_routes: [],
      reason: "docs_viewer_requires_document_tool_path",
      assistant_answer: false,
      raw_content_included: false,
    };

    const rejectedScholarlyLookup = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      toolCallAdmissionDecision: docsOnlyAdmission,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:runtime-admission-gate",
        call_id: "call:scholarly-under-docs-policy",
        capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        args: { query: "NHM2 theory white paper" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(rejectedScholarlyLookup.validation.valid).toBe(false);
    expect(rejectedScholarlyLookup.validation.errors).toContain(
      `runtime_capability_not_admitted_by_tool_policy:${HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY}:scholarly_research`,
    );

    const admittedDocsLocate = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      toolCallAdmissionDecision: docsOnlyAdmission,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:runtime-admission-gate",
        call_id: "call:docs-under-docs-policy",
        capability_key: "docs-viewer.locate_in_doc",
        args: { query: "NHM2 theory white paper" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(admittedDocsLocate.validation.valid).toBe(true);
  });

  it("admits unknown artifact requests to bounded read-only discovery without external research tools", () => {
    const unknownIntent = {
      schema: "helix.ask_source_target_intent.v1",
      turn_id: "ask:unknown-source-discovery",
      target_source: "unknown",
      target_kind: "unknown",
      requested_outputs: [],
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
      confidence: "low",
      precedence_reason: "ambiguous_source_target",
      reasons: ["test"],
      suppressed_routes: [],
      assistant_answer: false,
      raw_content_included: false,
    };
    const admission = buildToolCallAdmissionDecision({
      turnId: "ask:unknown-source-discovery",
      promptText: "find NHM2 theory white paper",
      sourceTargetIntent: unknownIntent,
    });

    expect(admission).toMatchObject({
      source_target: "unknown",
      admission_mode: "unknown_source_discovery",
      required: true,
      reason: "unknown_source_artifact_request_requires_bounded_readonly_discovery",
    });
    expect(admission.admitted_tool_families).toEqual(
      expect.arrayContaining(["workspace_directory", "docs_viewer", "repo_code", "runtime_evidence"]),
    );
    expect(admission.forbidden_tool_families).toEqual(
      expect.arrayContaining(["scholarly_research", "internet_search"]),
    );
    expect(admission.discovery_policy).toMatchObject({
      state: "bounded_readonly",
      on_not_found: "ask_or_explain_searched_scope",
    });

    const availableCapabilities = {
      schema: "helix.available_capabilities.v1",
      turn_id: "ask:unknown-source-discovery",
      tool_admission_suppressed: false,
      capabilities: [
        {
          capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
        {
          capability_key: HELIX_INTERNET_SEARCH_CAPABILITY,
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
        {
          capability_key: "workspace-directory.resolve",
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
        {
          capability_key: "docs-viewer.search_docs",
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
        {
          capability_key: "docs-viewer.open_doc_by_path",
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
        {
          capability_key: "repo-code.search_concept",
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
      ],
    } as any;

    const admittedWorkspaceDirectoryResolve = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      toolCallAdmissionDecision: admission,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:unknown-source-discovery",
        call_id: "call:workspace-directory",
        capability_key: "workspace-directory.resolve",
        args: { query: "NHM2 theory white paper" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(admittedWorkspaceDirectoryResolve.validation.valid).toBe(true);

    const admittedDocsSearch = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      toolCallAdmissionDecision: admission,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:unknown-source-discovery",
        call_id: "call:docs-search",
        capability_key: "docs-viewer.search_docs",
        args: { query: "NHM2 theory white paper" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(admittedDocsSearch.validation.valid).toBe(true);

    const rejectedDocOpen = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      toolCallAdmissionDecision: admission,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:unknown-source-discovery",
        call_id: "call:docs-open",
        capability_key: "docs-viewer.open_doc_by_path",
        args: { path: "docs/research/nhm2-current-status-whitepaper.md" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(rejectedDocOpen.validation.valid).toBe(false);
    expect(rejectedDocOpen.validation.errors).toContain(
      "runtime_tool_forbidden_by_tool_policy:docs-viewer.open_doc_by_path",
    );

    const admittedRepoSearch = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      toolCallAdmissionDecision: admission,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:unknown-source-discovery",
        call_id: "call:repo-search",
        capability_key: "repo-code.search_concept",
        args: { query: "NHM2 theory white paper" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(admittedRepoSearch.validation.valid).toBe(true);

    const rejectedScholarlyLookup = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      toolCallAdmissionDecision: admission,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:unknown-source-discovery",
        call_id: "call:scholarly-search",
        capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        args: { query: "NHM2 theory white paper" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(rejectedScholarlyLookup.validation.valid).toBe(false);
    expect(rejectedScholarlyLookup.validation.errors).toContain(
      `runtime_capability_family_forbidden_by_tool_policy:${HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY}:scholarly_research`,
    );

    const rejectedInternetSearch = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      toolCallAdmissionDecision: admission,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:unknown-source-discovery",
        call_id: "call:internet-search",
        capability_key: HELIX_INTERNET_SEARCH_CAPABILITY,
        args: { query: "NHM2 theory white paper" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(rejectedInternetSearch.validation.valid).toBe(false);
    expect(rejectedInternetSearch.validation.errors).toContain(
      `runtime_capability_family_forbidden_by_tool_policy:${HELIX_INTERNET_SEARCH_CAPABILITY}:internet_search`,
    );
  });

  it("re-enters rejected scholarly args as compact repair hints for the model step", () => {
    const hints = __testHelixAgentStepRepairHints.buildHelixAgentStepInvalidArgsHintSummary([
      {
        artifact_id: "call:lookup-empty",
        turn_id: "ask:scholarly-validation",
        producer_item_id: "agent_runtime_tool_executor",
        kind: "runtime_tool_call",
        created_at_ms: 1,
        source_scope: "current_turn",
        goal_hash: "test",
        payload: {
          schema: "helix.runtime_tool_call.v1",
          turn_id: "ask:scholarly-validation",
          call_id: "call:lookup-empty",
          capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          args: {},
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: "call:lookup-empty:runtime_tool_call_validation",
        turn_id: "ask:scholarly-validation",
        producer_item_id: "agent_runtime_tool_executor",
        kind: "runtime_tool_call_validation",
        created_at_ms: 2,
        source_scope: "current_turn",
        goal_hash: "test",
        payload: {
          schema: "helix.runtime_tool_call_validation.v1",
          turn_id: "ask:scholarly-validation",
          call_id: "call:lookup-empty",
          capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          valid: false,
          errors: ["missing_required_arg:query_or_identifier"],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: "call:lookup-empty:runtime_tool_observation",
        turn_id: "ask:scholarly-validation",
        producer_item_id: "agent_runtime_tool_executor",
        kind: "runtime_tool_observation",
        created_at_ms: 3,
        source_scope: "current_turn",
        goal_hash: "test",
        payload: {
          schema: "helix.runtime_tool_observation.v1",
          turn_id: "ask:scholarly-validation",
          call_id: "call:lookup-empty",
          capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          status: "invalid_args",
          summary: "Runtime tool call rejected before execution: missing_required_arg:query_or_identifier.",
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ] as any);

    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      capability_key: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      attempted_args: {},
      validation_errors: ["missing_required_arg:query_or_identifier"],
      occurrence_count: 1,
      latest_call_id: "call:lookup-empty",
    });
    expect(hints[0]?.repair_instruction).toContain("query");
    expect(hints[0]?.repair_instruction).toContain("user goal");
  });

  it("routes DOI citations and references to external scholarly research instead of Docs Viewer", () => {
    const promptText = "Do research: find citations and references for DOI 10.1103/PhysRevD.84.024020.";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:scholarly",
      threadId: "helix-ask:test",
      promptText,
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "scholarly_research",
      target_kind: "scholarly_research",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(sourceTargetIntent.requested_outputs).toEqual(expect.arrayContaining([
      "scholarly_paper_refs",
      "doi_metadata",
      "citation_graph",
      "typed_failure",
    ]));
    expect(sourceTargetIntent.suppressed_routes).toEqual(expect.arrayContaining([
      "active_doc_identity",
      "active_doc_summary",
      "doc_open_best",
      "repo_code_evidence_question",
      "model_only_concept",
    ]));

    const routeProductContract = buildRouteProductContract({
      turnId: "ask:scholarly",
      threadId: "helix-ask:test",
      sourceTargetIntent,
      promptText,
    });
    expect(routeProductContract).toMatchObject({
      source_target: "scholarly_research",
      precedence_reason: "scholarly_research_source_target_allows_only_external_paper_evidence_terminal_products",
    });
    expect(routeProductContract.allowed_terminal_artifact_kinds).toContain("scholarly_research_answer");
    expect(routeProductContract.forbidden_terminal_artifact_kinds).toEqual(expect.arrayContaining([
      "docs_viewer_receipt",
      "active_doc_identity",
      "doc_summary",
      "repo_code_evidence_answer",
      "direct_answer_text",
      "model_only_concept",
    ]));

    const toolAdmission = buildToolCallAdmissionDecision({
      turnId: "ask:scholarly",
      sourceTargetIntent,
      routeProductContract,
      promptText,
    });
    expect(toolAdmission).toMatchObject({
      source_target: "scholarly_research",
      required: true,
      admitted_tool_families: ["scholarly_research"],
      reason: "scholarly_research_requires_external_paper_evidence_path",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(toolAdmission.forbidden_routes).toEqual(expect.arrayContaining([
      "active_doc_identity",
      "active_doc_summary",
      "doc_open_best",
      "repo_code_evidence_question",
      "model_only_concept",
      "no_tool_direct",
    ]));

    const plan = buildCapabilityPlan({
      turnId: "ask:scholarly",
      promptText,
      sourceTargetIntent,
      routeProductContract,
      toolCallAdmissionDecision: toolAdmission,
      canonicalGoalFrame: canonicalGoal("scholarly_research_lookup", "scholarly_research_answer"),
    });
    expect(plan).toMatchObject({
      capability_family: "scholarly_research",
      requested_action: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      source_target: "scholarly_research",
      required_terminal_kind: "scholarly_research_answer",
      mutating: false,
      operator_command_required: false,
      operator_command_present: false,
      admission_status: "needs_evidence",
    });

    const result = buildCapabilityResultGate({
      plan,
      terminalArtifactKind: "scholarly_research_observation",
      terminalArtifactId: "ask:scholarly:scholarly_research_observation",
      currentTurnArtifacts: [
        {
          artifact_id: "ask:scholarly:scholarly_research_observation",
          kind: "scholarly_research_observation",
          turn_id: "ask:scholarly",
          payload: {
            schema: "helix.scholarly_research_observation.v1",
            artifact_id: "ask:scholarly:scholarly_research_observation",
            evidence_refs: ["crossref:10.1103/physrevd.84.024020"],
          },
        },
      ],
      reenteredRefs: ["ask:scholarly:scholarly_research_observation"],
    });
    expect(result).toMatchObject({
      status: "succeeded",
      selected_for_answer: true,
      reentered_solver: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("recovers scholarly admission from an affirmative prompt when a payload refresh drops the source target", () => {
    const promptText = "Find scholarly references supporting the quantum-inequality claims we discussed. Search arXiv and the other scholarly providers, and fetch the best three accessible sources.";
    const admission = buildToolCallAdmissionDecision({
      turnId: "ask:scholarly-missing-source-target",
      sourceTargetIntent: null,
      routeProductContract: null,
      promptText,
    });

    expect(admission).toMatchObject({
      source_target: "scholarly_research",
      required: true,
      admitted_tool_families: ["scholarly_research"],
      reason: "scholarly_research_requires_external_paper_evidence_path",
    });
  });

  it.each([
    "Do not search arXiv for quantum inequalities; just explain what the database is.",
    '"Search arXiv for quantum inequalities" is a prompt I used yesterday; explain why it failed.',
    "If I searched scholarly providers for quantum inequalities, what would happen?",
  ])("does not recover scholarly admission from a contextual command when the source target is missing: %s", (promptText) => {
    const admission = buildToolCallAdmissionDecision({
      turnId: "ask:scholarly-contextual-missing-source-target",
      sourceTargetIntent: null,
      routeProductContract: null,
      promptText,
    });

    expect(admission).toMatchObject({
      required: false,
      admitted_tool_families: ["model_only"],
    });
    expect(admission.admitted_tool_families).not.toContain("scholarly_research");
  });

  it("suppresses contextual scholarly lookup mentions instead of executing from lexical DOI cues", () => {
    const prompts = [
      ["Do not look up DOI 10.1103/PhysRevD.84.024020; just explain what a DOI is.", "negated_tool_instruction"],
      ["Do not fetch the PDF for arXiv:2401.00001; just explain what arXiv is.", "negated_tool_instruction"],
      ['"Search Crossref for this DOI" is the command I typed earlier; explain what it means.', "quoted_tool_command"],
      ["I looked up the DOI earlier; what is a DOI used for?", "historical_tool_reference"],
      ["Explain what would happen if I searched Semantic Scholar for citations.", "hypothetical_tool_reference"],
    ] as const;

    for (const [promptText, suppressionReason] of prompts) {
      const sourceTargetIntent = arbitrateAskSourceTarget({
        turnId: "ask:scholarly-contextual",
        threadId: "helix-ask:test",
        promptText,
      });
      expect(sourceTargetIntent.target_source).toBe("model_only");

      const plan = buildCapabilityPlan({
        turnId: "ask:scholarly-contextual",
        promptText,
        sourceTargetIntent,
        toolCallAdmissionDecision: {
          schema: "helix.tool_call_admission_decision.v1",
          turn_id: "ask:scholarly-contextual",
          source_target: "model_only",
          required: false,
          admitted_tool_families: ["model_only"],
          forbidden_terminal_artifact_kinds: [],
          forbidden_routes: [],
          reason: "contextual_tool_reference_suppressed",
          assistant_answer: false,
          raw_content_included: false,
        },
        canonicalGoalFrame: canonicalGoal("model_only_concept", "direct_answer_text"),
      });
      expect(plan).toMatchObject({
        capability_family: "debug_export",
        requested_action: "suppressed_contextual_tool_reference",
        tool_admission_suppressed: true,
        suppression_reason: suppressionReason,
      });
      expect(plan.capability_family).not.toBe("scholarly_research");
    }
  });

  it("preserves an affirmative full-text workflow when conditional retry language follows", () => {
    const promptText = [
      "Find three unique, directly relevant primary papers supporting quantum-inequality constraints on negative energy, traversable wormholes, or warp drives.",
      "Search the scholarly providers, deduplicate papers across DOI, arXiv, title, and provider records, and fetch full text for three unique sources.",
      "A duplicate provider record must not count as another source.",
      "If a fetch fails or duplicates an existing paper, continue searching.",
      "Build a claim-to-citation map using page- or equation-level support from fetched text, and clearly separate full-text evidence from metadata-only evidence.",
      "Do not describe unfetched papers as full-text support.",
    ].join(" ");

    const suppression = detectContextualToolAdmissionSuppression(promptText);
    expect(contextualToolSuppressionBlocksFamily(suppression, "scholarly_research")).toBe(false);
    expect(buildToolUseRestatement(promptText).requiredToolFamilies).not.toContain("docs_viewer");

    const intent = detectScholarlyResearchIntent(promptText);
    expect(intent).toMatchObject({
      researchRequested: true,
      fullTextRequested: true,
      normalizedQuery: "quantum-inequality constraints on negative energy, traversable wormholes, or warp drives",
      scholarlyIntent: {
        requested_workflow: "full_text_summary",
        terminal_evidence_requirement: "full_text",
      },
    });
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities).toEqual([
      HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
    ]);

    const itinerary = buildHelixCapabilityItinerary({
      turnId: "ask:scholarly-conditional-retry",
      promptText,
      availableCapabilities: [],
    });
    expect(itinerary.relevant_tool_families).toContain("scholarly_research");
    expect(itinerary.relevant_tool_families).not.toContain("docs_viewer");
    expect(itinerary.terminal_success_criteria.required_observation_families).toContain("scholarly_research");
  });

  it("keeps metadata lookup admitted when only downstream full-text work is negated", () => {
    const promptText = [
      "LOOKUP_SMOKE_02 — Search arXiv for Quantum Field Theory Constrains Traversable Wormhole Geometries by Ford and Roman.",
      "Use scholarly lookup only and return title, authors, DOI, and arXiv ID.",
      "Do not fetch full text or inspect PDF pages.",
    ].join(" ");

    expect(detectContextualToolAdmissionSuppression(promptText)).toBeNull();

    const intent = detectScholarlyResearchIntent(promptText);
    expect(intent).toMatchObject({
      researchRequested: true,
      fullTextRequested: false,
      scholarlyIntent: {
        requested_workflow: "metadata_search",
        terminal_evidence_requirement: "metadata",
      },
    });
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities).toEqual([
      HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
    ]);

    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:scholarly-lookup-only",
      threadId: "helix-ask:test",
      promptText,
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "scholarly_research",
      target_kind: "scholarly_research",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });

    const admission = buildToolCallAdmissionDecision({
      turnId: "ask:scholarly-lookup-only",
      sourceTargetIntent,
      routeProductContract: buildRouteProductContract({
        turnId: "ask:scholarly-lookup-only",
        threadId: "helix-ask:test",
        sourceTargetIntent,
        promptText,
      }),
      promptText,
    });
    expect(admission).toMatchObject({
      source_target: "scholarly_research",
      required: true,
    });
    expect(admission.admitted_tool_families).toContain("scholarly_research");
  });

  it("keeps an affirmative direct full-text fetch on the scholarly route when broader search is negated", () => {
    const promptText =
      "FULLTEXT_SMOKE_01 — Fetch and parse the full text for arXiv gr-qc/9510071. Return the title, parsed page count, and one page-numbered equation. Do not search for other papers.";

    const suppression = detectContextualToolAdmissionSuppression(promptText);
    expect(suppression?.verb_or_cue).toMatch(/^(?:internet_search\.web_research|scholarly-research\.lookup_papers)$/);

    const intent = detectScholarlyResearchIntent(promptText);
    expect(intent).toMatchObject({
      researchRequested: true,
      arxivId: "gr-qc/9510071",
      fullTextRequested: true,
    });

    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:scholarly-direct-full-text-with-search-negation",
      threadId: "helix-ask:test",
      promptText,
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "scholarly_research",
      target_kind: "scholarly_research",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });

    const admission = buildToolCallAdmissionDecision({
      turnId: "ask:scholarly-direct-full-text-with-search-negation",
      sourceTargetIntent,
      routeProductContract: buildRouteProductContract({
        turnId: "ask:scholarly-direct-full-text-with-search-negation",
        threadId: "helix-ask:test",
        sourceTargetIntent,
        promptText,
      }),
      promptText,
    });
    expect(admission).toMatchObject({
      source_target: "scholarly_research",
      required: true,
    });
    expect(admission.admitted_tool_families).toContain("scholarly_research");
  });

  it("keeps contextual scholarly references suppressed when no current lookup is requested", () => {
    const prompts = [
      "Do not search arXiv for Ford and Roman. Do not fetch full text; answer from general knowledge.",
      '"Search arXiv for Ford and Roman" was the prior instruction. Do not fetch full text; explain the instruction.',
      "I searched arXiv for Ford and Roman earlier. Do not fetch full text; summarize what the request means.",
      "Later, if needed, search arXiv for Ford and Roman. Do not fetch full text; for now answer from general knowledge.",
    ];

    for (const promptText of prompts) {
      const suppression = detectContextualToolAdmissionSuppression(promptText);
      expect(suppression).not.toBeNull();
      const sourceTargetIntent = arbitrateAskSourceTarget({
        turnId: "ask:scholarly-contextual-lookup-only",
        threadId: "helix-ask:test",
        promptText,
      });
      expect(sourceTargetIntent.target_source).toBe("model_only");
    }
  });

  it("plans the explicit full-text capability for PDF and paper text requests", () => {
    const promptText = "Do research: fetch the PDF/full text for arXiv:2401.00001 and extract the methods section.";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:scholarly-full-text",
      threadId: "helix-ask:test",
      promptText,
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "scholarly_research",
      target_kind: "scholarly_research",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(sourceTargetIntent.requested_outputs).toEqual(expect.arrayContaining([
      "scholarly_full_text",
      "paper_pdf_pages",
      "typed_failure",
    ]));

    const toolAdmission = buildToolCallAdmissionDecision({
      turnId: "ask:scholarly-full-text",
      sourceTargetIntent,
      routeProductContract: buildRouteProductContract({
        turnId: "ask:scholarly-full-text",
        threadId: "helix-ask:test",
        sourceTargetIntent,
        promptText,
      }),
      promptText,
    });
    const plan = buildCapabilityPlan({
      turnId: "ask:scholarly-full-text",
      promptText,
      sourceTargetIntent,
      toolCallAdmissionDecision: toolAdmission,
      canonicalGoalFrame: canonicalGoal("scholarly_research_lookup", "scholarly_research_answer"),
    });
    expect(plan).toMatchObject({
      capability_family: "scholarly_research",
      requested_action: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      source_target: "scholarly_research",
      admission_status: "needs_evidence",
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("marks scholarly lookup plus full-text observations satisfied before terminal synthesis", () => {
    const turnId = "ask:scholarly-full-text-satisfaction";
    const promptText = "Do research: fetch the PDF/full text for arXiv:1706.03762 and extract the model architecture details.";
    const evaluation = __testHelixGoalSatisfaction.buildHelixGoalSatisfactionEvaluation({
      turnId,
      transcript: promptText,
      canonicalGoalFrame: {
        ...canonicalGoal("scholarly_research_lookup", "scholarly_research_answer"),
        turn_id: turnId,
        corpus_anchors: ["1706.03762"],
        concept_tokens: ["paper_search", "arxiv_id", "scholarly_full_text_or_pdf"],
      },
      currentTurnArtifacts: [
        {
          artifact_id: `${turnId}:lookup:scholarly_research_observation`,
          turn_id: turnId,
          producer_item_id: "agent_runtime_scholarly_research_tool",
          kind: "scholarly_research_observation",
          created_at_ms: 1,
          source_scope: "current_turn",
          payload: {
            schema: "helix.scholarly_research_observation.v1",
            capability: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
            papers: [{ result_id: "arxiv:1706.03762", title: "Attention Is All You Need" }],
            evidence_refs: ["arxiv:1706.03762"],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: `${turnId}:full-text:scholarly_full_text_observation`,
          turn_id: turnId,
          producer_item_id: "agent_runtime_scholarly_research_tool",
          kind: "scholarly_full_text_observation",
          created_at_ms: 2,
          source_scope: "current_turn",
          payload: {
            schema: "helix.scholarly_full_text_observation.v1",
            capability: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
            paper_result_id: "arxiv:1706.03762",
            selected_for_answer: true,
            selected_chunks: [{ chunk_ref: "page:2#chunk:1", page_start: 2, text_excerpt: "The Transformer uses encoder and decoder stacks." }],
            page_text_refs: ["page:2#text"],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ] as any,
      satisfactionReport: {
        satisfied: false,
        terminal_kind: "final_failure",
        terminal_source: "typed_failure",
        missing_artifacts: ["scholarly_research_answer"],
        missing_reason: "terminal_artifact_unavailable",
        confidence: "medium",
        rejected_terminal_candidates: [],
      } as any,
    });

    expect(evaluation.terminal_contract.required_actions).toEqual([
      HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
    ]);
    expect(evaluation.required_actions.every((action) => action.satisfied)).toBe(true);
    expect(evaluation.required_evidence.every((evidence) => evidence.satisfied)).toBe(true);
    expect(evaluation.satisfaction).toBe("satisfied");
    expect(evaluation.next_decision).toBe("allow_terminal");
    expect(evaluation.observed_results.filter((result) => result.supports_goal).map((result) => result.kind)).toEqual([
      "scholarly_research_observation",
      "scholarly_full_text_observation",
    ]);
  });

  it("keeps frontier scholarly observations incomplete until literature is mapped back to the graph", () => {
    const turnId = "ask:frontier-scholarly-map-required";
    const promptText =
      "Use scholarly papers and full text to run the Theory Frontier Seed Finder, then map extracted equations back to semantic chunks.";
    const baseArtifacts = [
      {
        artifact_id: `${turnId}:lookup:scholarly_research_observation`,
        turn_id: turnId,
        producer_item_id: "agent_runtime_scholarly_research_tool",
        kind: "scholarly_research_observation",
        created_at_ms: 1,
        source_scope: "current_turn",
        payload: {
          schema: "helix.scholarly_research_observation.v1",
          capability: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          selected_for_answer: true,
          papers: [{ result_id: "arxiv:frontier", title: "Frontier Evidence" }],
          evidence_refs: ["arxiv:frontier"],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:full-text:scholarly_full_text_observation`,
        turn_id: turnId,
        producer_item_id: "agent_runtime_scholarly_research_tool",
        kind: "scholarly_full_text_observation",
        created_at_ms: 2,
        source_scope: "current_turn",
        payload: {
          schema: "helix.scholarly_full_text_observation.v1",
          capability: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
          selected_for_answer: true,
          paper_result_id: "arxiv:frontier",
          selected_chunks: [{ chunk_ref: "page:2#chunk:1", page_start: 2, text_excerpt: "qei_margin requires source residual closure." }],
          page_text_refs: ["page:2#text"],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];

    const evaluation = __testHelixGoalSatisfaction.buildHelixGoalSatisfactionEvaluation({
      turnId,
      transcript: promptText,
      canonicalGoalFrame: {
        ...canonicalGoal("scholarly_research_lookup", "scholarly_research_answer"),
        turn_id: turnId,
        concept_tokens: ["paper_search", "scholarly_full_text_or_pdf", "theory_frontier"],
      },
      currentTurnArtifacts: baseArtifacts as any,
      satisfactionReport: {
        satisfied: false,
        terminal_kind: "final_failure",
        terminal_source: "typed_failure",
        missing_artifacts: ["theory_frontier_literature_map"],
        missing_reason: "frontier_literature_map_required",
        confidence: "medium",
        rejected_terminal_candidates: [],
      } as any,
    });

    expect(evaluation.terminal_contract.required_actions).toEqual([
      HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      "helix_ask.reflect_theory_context",
    ]);
    expect(evaluation.terminal_contract.required_evidence).toEqual([
      "scholarly_research_observation",
      "scholarly_full_text_observation",
      "theory_frontier_search",
      "theory_frontier_candidate",
      "theory_frontier_exact_contract_verification",
      "theory_frontier_literature_map",
    ]);
    expect(evaluation.required_evidence.find((entry) => entry.kind === "scholarly_research_observation")?.satisfied).toBe(true);
    expect(evaluation.required_evidence.find((entry) => entry.kind === "scholarly_full_text_observation")?.satisfied).toBe(true);
    expect(evaluation.required_evidence.find((entry) => entry.kind === "theory_frontier_literature_map")?.satisfied).toBe(false);
    expect(evaluation.satisfaction).toBe("partially_satisfied");
    expect(evaluation.next_decision).toBe("continue");
  });

  it("allows frontier scholarly turns to proceed only after mapped literature evidence exists", () => {
    const turnId = "ask:frontier-scholarly-map-complete";
    const promptText =
      "Use scholarly papers and full text to run the Theory Frontier Seed Finder, then map extracted equations back to semantic chunks.";
    const currentTurnArtifacts = [
      {
        artifact_id: `${turnId}:lookup:scholarly_research_observation`,
        turn_id: turnId,
        producer_item_id: "agent_runtime_scholarly_research_tool",
        kind: "scholarly_research_observation",
        created_at_ms: 1,
        source_scope: "current_turn",
        payload: {
          schema: "helix.scholarly_research_observation.v1",
          capability: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          selected_for_answer: true,
          papers: [{ result_id: "arxiv:frontier", title: "Frontier Evidence" }],
          evidence_refs: ["arxiv:frontier"],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:full-text:scholarly_full_text_observation`,
        turn_id: turnId,
        producer_item_id: "agent_runtime_scholarly_research_tool",
        kind: "scholarly_full_text_observation",
        created_at_ms: 2,
        source_scope: "current_turn",
        payload: {
          schema: "helix.scholarly_full_text_observation.v1",
          capability: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
          selected_for_answer: true,
          paper_result_id: "arxiv:frontier",
          selected_chunks: [{ chunk_ref: "page:2#chunk:1", page_start: 2, text_excerpt: "qei_margin requires source residual closure." }],
          page_text_refs: ["page:2#text"],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:theory-reflection`,
        turn_id: turnId,
        producer_item_id: "agent_runtime_theory_locator_tool",
        kind: "helix_theory_context_reflection_tool_receipt",
        created_at_ms: 3,
        source_scope: "current_turn",
        payload: {
          kind: "helix_theory_context_reflection_tool_receipt",
          tool_id: "helix_ask.reflect_theory_context",
          assistant_answer: false,
          raw_content_included: false,
          terminal_eligible: false,
        },
      },
      {
        artifact_id: `${turnId}:frontier-search`,
        turn_id: turnId,
        producer_item_id: "agent_runtime_theory_locator_tool",
        kind: "theory_frontier_search",
        created_at_ms: 4,
        source_scope: "current_turn",
        payload: { artifact_v1: { artifactId: "theory_frontier_search", schemaVersion: "theory_frontier_search/v1" } },
      },
      {
        artifact_id: `${turnId}:frontier-candidate`,
        turn_id: turnId,
        producer_item_id: "agent_runtime_theory_locator_tool",
        kind: "theory_frontier_candidate",
        created_at_ms: 5,
        source_scope: "current_turn",
        payload: { artifact_v1: { artifactId: "theory_frontier_candidate", schemaVersion: "theory_frontier_candidate/v1" } },
      },
      {
        artifact_id: `${turnId}:frontier-exact`,
        turn_id: turnId,
        producer_item_id: "agent_runtime_theory_locator_tool",
        kind: "theory_frontier_exact_contract_verification",
        created_at_ms: 6,
        source_scope: "current_turn",
        payload: { artifact_v1: { artifactId: "theory_frontier_exact_contract_verification", schemaVersion: "theory_frontier_exact_contract_verification/v1" } },
      },
      {
        artifact_id: `${turnId}:frontier-literature-map`,
        turn_id: turnId,
        producer_item_id: "agent_runtime_theory_locator_tool",
        kind: "theory_frontier_literature_map",
        created_at_ms: 7,
        source_scope: "current_turn",
        payload: {
          artifact_v1: {
            artifactId: "theory_frontier_literature_map",
            schemaVersion: "theory_frontier_literature_map/v1",
            authority: {
              assistant_answer: false,
              terminal_eligible: false,
              promotionAllowed: false,
            },
          },
        },
      },
    ];

    const evaluation = __testHelixGoalSatisfaction.buildHelixGoalSatisfactionEvaluation({
      turnId,
      transcript: promptText,
      canonicalGoalFrame: {
        ...canonicalGoal("scholarly_research_lookup", "scholarly_research_answer"),
        turn_id: turnId,
        concept_tokens: ["paper_search", "scholarly_full_text_or_pdf", "theory_frontier"],
      },
      currentTurnArtifacts: currentTurnArtifacts as any,
      satisfactionReport: {
        satisfied: false,
        terminal_kind: "final_failure",
        terminal_source: "typed_failure",
        missing_artifacts: ["scholarly_research_answer"],
        missing_reason: "terminal_artifact_unavailable",
        confidence: "medium",
        rejected_terminal_candidates: [],
      } as any,
    });

    expect(evaluation.required_actions.every((action) => action.satisfied)).toBe(true);
    expect(evaluation.required_evidence.every((evidence) => evidence.satisfied)).toBe(true);
    expect(evaluation.satisfaction).toBe("satisfied");
    expect(evaluation.next_decision).toBe("allow_terminal");
    expect(evaluation.observed_results.find((result) => result.kind === "theory_frontier_literature_map")).toEqual(
      expect.objectContaining({
        supports_goal: true,
      }),
    );
  });

  it("keeps failed zero-chunk full-text observations from satisfying page-evidence requirements", () => {
    const turnId = "ask:scholarly-full-text-403";
    const promptText = "Do research: fetch a Hawking radiation paper with PDF/full text and summarize it with page evidence.";
    const evaluation = __testHelixGoalSatisfaction.buildHelixGoalSatisfactionEvaluation({
      turnId,
      transcript: promptText,
      canonicalGoalFrame: {
        ...canonicalGoal("scholarly_research_lookup", "scholarly_research_answer"),
        turn_id: turnId,
        concept_tokens: ["paper_search", "scholarly_full_text_or_pdf"],
      },
      currentTurnArtifacts: [
        {
          artifact_id: `${turnId}:lookup:scholarly_research_observation`,
          turn_id: turnId,
          producer_item_id: "agent_runtime_scholarly_research_tool",
          kind: "scholarly_research_observation",
          created_at_ms: 1,
          source_scope: "current_turn",
          payload: {
            schema: "helix.scholarly_research_observation.v1",
            capability: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
            selected_for_answer: true,
            papers: [{ result_id: "openalex:hawking-radiation", title: "Particle Creation by Black Holes" }],
            evidence_refs: ["openalex:hawking-radiation"],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: `${turnId}:full-text:scholarly_full_text_observation`,
          turn_id: turnId,
          producer_item_id: "agent_runtime_scholarly_research_tool",
          kind: "scholarly_full_text_observation",
          created_at_ms: 2,
          source_scope: "current_turn",
          payload: {
            schema: "helix.scholarly_full_text_observation.v1",
            capability: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
            paper_result_id: "openalex:hawking-radiation",
            selected_for_answer: false,
            selected_chunks: [],
            pages_parsed: 0,
            missing_requirements: ["full_text_http_403"],
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: `${turnId}:full-text:runtime_tool_observation`,
          turn_id: turnId,
          producer_item_id: "agent_runtime_tool_executor",
          kind: "runtime_tool_observation",
          created_at_ms: 3,
          source_scope: "current_turn",
          payload: {
            schema: "helix.runtime_tool_observation.v1",
            capability_key: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
            call_id: "call:full-text-403",
            status: "failed",
            summary: "Full text fetch failed: HTTP 403.",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ] as any,
      satisfactionReport: {
        satisfied: false,
        terminal_kind: "final_failure",
        terminal_source: "typed_failure",
        missing_artifacts: ["scholarly_full_text_observation", "scholarly_research_answer"],
        missing_reason: "scholarly_full_text_unavailable",
        confidence: "high",
        rejected_terminal_candidates: [],
      } as any,
    });

    const lookupAction = evaluation.required_actions.find((action) => action.action_key === HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY);
    const fullTextAction = evaluation.required_actions.find((action) => action.action_key === HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY);
    const lookupEvidence = evaluation.required_evidence.find((evidence) => evidence.kind === "scholarly_research_observation");
    const fullTextEvidence = evaluation.required_evidence.find((evidence) => evidence.kind === "scholarly_full_text_observation");
    const failedFullTextObservation = evaluation.observed_results.find(
      (result) => result.ref === `${turnId}:full-text:scholarly_full_text_observation`,
    );

    expect(lookupAction?.satisfied).toBe(true);
    expect(lookupEvidence?.satisfied).toBe(true);
    expect(fullTextAction?.satisfied).toBe(false);
    expect(fullTextEvidence?.satisfied).toBe(false);
    expect(evaluation.satisfaction).toBe("partially_satisfied");
    expect(failedFullTextObservation?.supports_goal).toBe(false);
  });

  it("builds a scholarly fallback draft from compact full-text evidence and rejects retry boilerplate", () => {
    const turnId = "ask:scholarly-fallback";
    const artifacts = [
      {
        artifact_id: `${turnId}:lookup:scholarly_research_observation`,
        turn_id: turnId,
        producer_item_id: "agent_runtime_scholarly_research_tool",
        kind: "scholarly_research_observation",
        created_at_ms: 1,
        source_scope: "current_turn",
        payload: {
          schema: "helix.scholarly_research_observation.v1",
          capability: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
          papers: [{
            result_id: "arxiv:1706.03762",
            title: "Attention Is All You Need",
            year: 2017,
            authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
            identifiers: { arxiv_id: "1706.03762" },
          }],
          evidence_refs: ["arxiv:1706.03762"],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:full-text:scholarly_full_text_observation`,
        turn_id: turnId,
        producer_item_id: "agent_runtime_scholarly_research_tool",
        kind: "scholarly_full_text_observation",
        created_at_ms: 2,
        source_scope: "current_turn",
        payload: {
          schema: "helix.scholarly_full_text_observation.v1",
          capability: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
          selected_chunks: [{
            chunk_ref: "arxiv:1706.03762:p2:c1",
            page_start: 2,
            source_text_ref: "arxiv:1706.03762:p2#text",
            text_excerpt: "The Transformer uses stacked self-attention and point-wise fully connected layers for both the encoder and decoder.",
          }],
          page_text_refs: [{ text_ref: "arxiv:1706.03762:p2#text" }],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ] as any;

    const fallbackText = __testHelixScholarlyFinalFallback.buildHelixScholarlyResearchFallbackText({
      prompt: "Do research: fetch the PDF/full text and extract architecture details.",
      artifacts,
    });
    expect(fallbackText).toContain("Attention Is All You Need");
    expect(fallbackText).toContain("Relevant PDF/full-text excerpts");
    expect(fallbackText).toContain("stacked self-attention");
    expect(fallbackText).toContain("arxiv:1706.03762:p2:c1");

    const qualityGate = evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:final_answer_draft`,
      draftText: "I couldn't produce a final answer for that turn. Please retry once.",
      payload: {
        canonical_goal_frame: canonicalGoal("scholarly_research_lookup", "scholarly_research_answer"),
      },
      artifactLedger: artifacts,
    });
    expect(qualityGate.ok).toBe(false);
    expect(qualityGate.violations).toContain("fallback_like_answer");
  });

  it("normalizes provider metadata into one scholarly observation without answer authority", async () => {
    const fetchImpl: ScholarlyFetch = async (url) => {
      if (url.includes("api.openalex.org")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                id: "https://openalex.org/W123",
                title: "Warp Field Mechanics 101",
                publication_year: 2011,
                doi: "https://doi.org/10.1103/PhysRevD.84.024020",
                cited_by_count: 42,
                referenced_works_count: 17,
                authorships: [{ author: { display_name: "Harold White" } }],
                primary_location: { source: { display_name: "Physical Review D" } },
                open_access: { is_oa: true },
              },
            ],
          }),
        };
      }
      if (url.includes("api.crossref.org")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              title: ["Warp Field Mechanics 101"],
              DOI: "10.1103/PhysRevD.84.024020",
              author: [{ given: "Harold", family: "White" }],
              "container-title": ["Physical Review D"],
              "is-referenced-by-count": 42,
              "reference-count": 17,
              URL: "https://doi.org/10.1103/PhysRevD.84.024020",
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const observation = await runScholarlyResearchLookup({
      turnId: "ask:scholarly-service",
      callId: "call:scholarly",
      query: "Find citations for DOI 10.1103/PhysRevD.84.024020",
      providers: ["openalex", "crossref"],
      limit: 5,
      fetchImpl,
    });

    expect(observation).toMatchObject({
      schema: "helix.scholarly_research_observation.v1",
      artifact_id: "call:scholarly:scholarly_research_observation",
      capability: HELIX_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
      intent: "citation_lookup",
      providers_called: ["openalex", "crossref"],
      provider_record_count: 2,
      unique_paper_count: 1,
      deduplication: {
        provider_record_count: 2,
        unique_paper_count: 1,
        duplicate_record_count: 1,
      },
      selected_for_answer: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(observation.papers).toHaveLength(1);
    expect(observation).toMatchObject({
      provider_record_count: 2,
      unique_paper_count: 1,
      deduplication: {
        provider_record_count: 2,
        unique_paper_count: 1,
        duplicate_record_count: 1,
      },
    });
    expect(observation.papers[0]).toMatchObject({
      title: "Warp Field Mechanics 101",
      identifiers: { doi: "10.1103/physrevd.84.024020" },
      citation_count: 42,
      reference_count: 17,
      source_providers: expect.arrayContaining(["openalex", "crossref"]),
    });
    expect(observation.evidence_refs.map((ref) => ref.provider)).toEqual(["openalex", "crossref"]);
  });

  it("deduplicates DOI and arXiv provider records for the same paper identity", async () => {
    const title = "Quantum Field Theory Constrains Traversable Wormhole Geometries";
    const fetchImpl: ScholarlyFetch = async (url) => {
      if (url.includes("api.semanticscholar.org")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{
              paperId: "semantic-ford-roman",
              title,
              authors: [{ name: "L. H. Ford" }, { name: "Thomas A. Roman" }],
              year: 1996,
              abstract: "Quantum inequalities constrain negative energy and traversable wormholes.",
              externalIds: { DOI: "10.1103/PhysRevD.53.5496" },
              isOpenAccess: true,
              openAccessPdf: { url: "https://arxiv.org/pdf/gr-qc/9510071" },
            }],
          }),
        };
      }
      if (url.includes("export.arxiv.org")) {
        return {
          ok: true,
          status: 200,
          text: async () => [
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
            "<feed xmlns=\"http://www.w3.org/2005/Atom\">",
            "<entry>",
            "<id>https://arxiv.org/abs/gr-qc/9510071</id>",
            `<title>${title}</title>`,
            "<summary>Quantum inequalities constrain negative energy and traversable wormholes.</summary>",
            "<published>1995-10-31T00:00:00Z</published>",
            "<author><name>L. H. Ford</name></author>",
            "<author><name>Thomas A. Roman</name></author>",
            "</entry>",
            "</feed>",
          ].join(""),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const observation = await runScholarlyResearchLookup({
      turnId: "ask:scholarly-cross-provider-identity",
      callId: "call:scholarly-cross-provider-identity",
      query: `${title} negative energy quantum inequalities`,
      providers: ["semantic_scholar", "arxiv"],
      limit: 5,
      fetchImpl,
    });

    expect(observation.papers).toHaveLength(1);
    expect(observation.papers[0]).toMatchObject({
      title,
      identifiers: {
        doi: "10.1103/physrevd.53.5496",
        arxiv_id: "gr-qc/9510071",
      },
      source_providers: expect.arrayContaining(["semantic_scholar", "arxiv"]),
    });
  });

  it("pins explicit arXiv identifiers to exact arXiv-capable results", async () => {
    const arxivXml = `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/1706.03762</id>
          <updated>2023-08-02T00:00:00Z</updated>
          <published>2017-06-12T00:00:00Z</published>
          <title>Attention Is All You Need</title>
          <summary>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.</summary>
          <author><name>Ashish Vaswani</name></author>
        </entry>
      </feed>`;
    const fetchImpl: ScholarlyFetch = async (url) => {
      if (url.includes("api.openalex.org")) {
        throw new Error("broad OpenAlex search should not run for an explicit arXiv ID");
      }
      if (url.includes("export.arxiv.org")) {
        expect(url).toContain("id_list=1706.03762");
        return { ok: true, status: 200, text: async () => arxivXml };
      }
      if (url.includes("api.semanticscholar.org")) {
        expect(url).toContain("ARXIV:1706.03762");
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const observation = await runScholarlyResearchLookup({
      turnId: "ask:scholarly-exact-arxiv",
      callId: "call:scholarly-exact-arxiv",
      query: "Do research: fetch the PDF/full text for arXiv:1706.03762.",
      providers: ["openalex", "arxiv", "semantic_scholar"],
      limit: 8,
      fetchImpl,
    });

    expect(observation.providers_called).toEqual(["arxiv", "semantic_scholar"]);
    expect(observation.papers).toHaveLength(1);
    expect(observation.papers[0]).toMatchObject({
      title: "Attention Is All You Need",
      identifiers: {
        arxiv_id: "1706.03762",
        pdf_url: "https://arxiv.org/pdf/1706.03762.pdf",
        full_text_url: "http://arxiv.org/abs/1706.03762",
      },
      source_providers: ["arxiv"],
      confidence: "high",
    });
  });

  it("fetches a selected PDF source and returns compact page chunks without answer authority", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const observation = await runScholarlyFullTextFetch({
      turnId: "ask:scholarly-full-text-service",
      callId: "call:scholarly-full-text",
      query: "extract methods and results for warp field mechanics",
      paper: {
        result_id: "arxiv:warp-field-mechanics",
        title: "Warp Field Mechanics 101",
        authors: [{ name: "Harold White" }],
        year: 2011,
        identifiers: {
          arxiv_id: "2401.00001",
          pdf_url: "https://arxiv.org/pdf/2401.00001.pdf",
        },
        evidence_refs: ["arxiv:2401.00001"],
        source_providers: ["arxiv"],
        confidence: "high",
      },
      cachePdf: false,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/pdf" },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }),
      extractPdfTextImpl: async () => ({
        totalPages: 3,
        pages: [
          { page: 1, text: "Abstract. Warp field mechanics are summarized here." },
          { page: 2, text: "Methods. The paper derives a compact field metric and extraction procedure, then documents the boundary conditions and numerical validation steps used for the reported constraints." },
          { page: 3, text: "Results. The model reports constraints and caveats for the proposed field." },
        ],
      }),
      maxPages: 3,
      maxChunks: 2,
    });

    expect(observation).toMatchObject({
      schema: "helix.scholarly_full_text_observation.v1",
      artifact_id: "call:scholarly-full-text:scholarly_full_text_observation",
      capability: HELIX_SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      source_kind: "pdf",
      pages_parsed: 3,
      selected_for_answer: true,
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
    });
    expect(observation.source_pdf_ref).toMatch(/^artifact:\/\/scholarly-pdf\//);
    expect(observation.page_text_refs).toHaveLength(3);
    expect(observation.selected_chunks).toHaveLength(2);
    expect(observation.selected_chunks[0]).toMatchObject({
      page_start: expect.any(Number),
      text_excerpt: expect.any(String),
      source_text_ref: expect.stringContaining("#text"),
    });
    expect(observation.selected_chunks[0].text_excerpt.length).toBeLessThanOrEqual(1400);
  });

  it("refreshes stale fail-closed debug after scholarly terminal materialization", () => {
    const turnId = "ask:scholarly-terminal-refresh";
    const lookupRef = `${turnId}:lookup`;
    const fullTextRef = `${turnId}:full_text`;
    const terminalText = [
      "Hawking radiation is commonly framed as quantum field emission associated with black-hole horizons.",
      "The fetched full-text evidence supports the answer from the selected PDF chunks.",
      "",
      "Citations",
      "- [Hawking Radiation As Tunneling](https://arxiv.org/pdf/hep-th/9907001.pdf) (PDF/full text; 5 parsed pages)",
    ].join("\n");
    const artifacts = [
      {
        artifact_id: lookupRef,
        turn_id: turnId,
        kind: "scholarly_research_observation",
        source_scope: "current_turn",
        payload: {
          schema: "helix.scholarly_research_observation.v1",
          papers: [{
            result_id: "arxiv:hep-th/9907001",
            title: "Hawking Radiation As Tunneling",
            identifiers: { arxiv_id: "hep-th/9907001", pdf_url: "https://arxiv.org/pdf/hep-th/9907001.pdf" },
          }],
        },
      },
      {
        artifact_id: fullTextRef,
        turn_id: turnId,
        kind: "scholarly_full_text_observation",
        source_scope: "current_turn",
        payload: {
          schema: "helix.scholarly_full_text_observation.v1",
          paper_result_id: "arxiv:hep-th/9907001",
          title: "Hawking Radiation As Tunneling",
          source_url: "https://arxiv.org/pdf/hep-th/9907001.pdf",
          pages_parsed: 5,
          selected_chunks: [{
            chunk_ref: "artifact://scholarly-pdf/hawking/page/1#chunk/1",
            source_text_ref: "artifact://scholarly-pdf/hawking/page/1#text",
            text_excerpt: "Hawking radiation can be described as tunneling across the horizon.",
          }],
          page_text_refs: ["artifact://scholarly-pdf/hawking/page/1#text"],
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Use scholarly research papers about Hawking radiation and cite the references.",
      canonical_goal_frame: {
        ...canonicalGoal("scholarly_research_lookup", "scholarly_research_answer"),
        turn_id: turnId,
      },
      current_turn_artifact_ledger: artifacts,
      source_target_intent: {
        schema: "helix.ask_source_target_intent.v1",
        turn_id: turnId,
        thread_id: "thread:test",
        target_source: "scholarly_research",
        target_kind: "scholarly_research_lookup",
        strength: "hard",
        requested_outputs: ["scholarly_research_answer"],
        must_enter_backend_ask: true,
        allow_client_shortcut: false,
        allow_no_tool_direct: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_authority_single_writer: {
        schema: "helix.terminal_authority_single_writer_result.v1",
        selected_terminal_artifact_kind: "scholarly_research_answer",
        visible_text: terminalText,
        source: "final_answer_draft",
      },
      scholarly_research_answer: {
        schema: "helix.scholarly_research_answer.v1",
        artifact_id: `${turnId}:scholarly_research_answer`,
        answer_text: terminalText,
        text: terminalText,
        support_refs: [lookupRef, fullTextRef],
      },
      terminal_artifact_id: `${turnId}:scholarly_research_answer`,
      terminal_artifact_kind: "scholarly_research_answer",
      final_answer_source: "final_answer_draft",
      selected_final_answer: terminalText,
      answer: terminalText,
      text: terminalText,
      final_status: "final_answer",
      response_type: "final_answer",
      route_authority_audit: {
        schema: "helix.route_authority_audit.v1",
        terminal_artifact_kind: "model_synthesized_answer",
        route_authority_ok: false,
        route_authority_violation_code: "terminal_product_authority_mismatch",
      },
      solver_controller_decision: {
        schema: "helix.solver_controller_decision.v1",
        decision: "fail_closed",
        selected_terminal_artifact_kind: "model_synthesized_answer",
        blocking_reasons: ["route_authority_failed"],
      },
      agent_runtime_loop: {
        iterations: [
          {
            iteration: 1,
            decision_id: `${turnId}:agent-step:1`,
            next_step: "next_action",
            chosen_capability: "scholarly-research.lookup_papers",
            decision_authority: "llm",
            observed_artifact_refs: [lookupRef],
          },
          {
            iteration: 2,
            decision_id: `${turnId}:agent-step:2`,
            next_step: "next_action",
            chosen_capability: "scholarly-research.fetch_full_text",
            decision_authority: "llm",
            observed_artifact_refs: [fullTextRef],
          },
          {
            iteration: 3,
            decision_id: `${turnId}:agent-step:3`,
            next_step: "answer",
            chosen_capability: "model.synthesize_from_scholarly_research",
            decision_authority: "llm",
            decision_timing: "post_observation",
          },
        ],
      },
      agent_step_decision: {
        decision_id: `${turnId}:agent-step:3`,
        next_step: "answer",
        chosen_capability: "model.synthesize_from_scholarly_research",
        decision_authority: "llm",
        decision_timing: "post_observation",
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        turn_id: turnId,
        canonical_goal_kind: "scholarly_research_lookup",
        required_terminal_kind: "scholarly_research_answer",
        terminal_contract: {
          goal_kind: "scholarly_research_lookup",
          required_terminal_kinds: ["scholarly_research_answer"],
          acceptable_fallbacks: [],
          forbidden_terminal_kinds: ["direct_answer_text", "model_synthesized_answer"],
        },
        required_actions: [],
        required_evidence: [],
        observed_results: [],
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        assistant_answer: false,
        raw_content_included: false,
      },
      debug: {
        terminal_artifact_kind: "model_synthesized_answer",
        final_answer_source: "typed_failure",
        solver_controller_decision: {
          decision: "fail_closed",
          blocking_reasons: ["route_authority_failed"],
        },
      },
    };

    const refreshed = __testHelixScholarlyTerminalAuthorityRefresh.refreshScholarlyTerminalAuthorityAfterMaterialization({
      payload,
      threadId: "thread:test",
      turnId,
      route: "scholarly_research_lookup",
      prompt: "Use scholarly research papers about Hawking radiation and cite the references.",
    });

    expect(refreshed).toBe(true);
    expect(payload.route_authority_audit).toMatchObject({
      terminal_artifact_kind: "scholarly_research_answer",
      route_authority_ok: true,
    });
    expect(payload.terminal_consistency_check).toMatchObject({
      selected_terminal_kind: "scholarly_research_answer",
      consistent: true,
    });
    expect(payload.solver_controller_decision).toMatchObject({
      decision: "allow_terminal",
      selected_terminal_artifact_kind: "scholarly_research_answer",
      blocking_reasons: [],
    });
    expect(payload.terminal_equivalence_harness_result).toMatchObject({ ok: true });
    expect(payload.debug).toMatchObject({
      terminal_artifact_kind: "scholarly_research_answer",
      final_answer_source: "final_answer_draft",
      solver_controller_decision: expect.objectContaining({
        decision: "allow_terminal",
        selected_terminal_artifact_kind: "scholarly_research_answer",
      }),
    });
  });

  it("materializes a scholarly terminal answer from a source-backed final draft when stale state still points at the observation", () => {
    const turnId = "ask:scholarly-terminal-materialize-from-draft";
    const scholarlyObservationRef = `${turnId}:runtime_tool_call:1:scholarly_research_observation`;
    const theoryReceiptRef = "helix-theory-reflection-tool-receipt:test";
    const sourceBackedFinalDraftRef = `${turnId}:final_answer_draft`;
    const staleModelOnlyDraftText = "A stale model-only draft should not become the scholarly terminal answer.";
    const finalDraftText =
      "Scholarly lookup found paper metadata for quantum coherence in photosynthesis, and the Theory Badge Graph locator placed the claim near photosynthetic light-harvesting and coherence lifetime gates. The answer should treat microtubule/Orch-OR comparisons as uncertain and boundary-constrained.";
    const artifacts = [
      {
        artifact_id: scholarlyObservationRef,
        turn_id: turnId,
        producer_item_id: "agent_runtime_tool_executor",
        kind: "scholarly_research_observation",
        created_at_ms: 1,
        source_scope: "current_turn",
        goal_hash: "scholarly",
        payload: {
          schema: "helix.scholarly_research_observation.v1",
          query: "quantum coherence in photosynthesis",
          selected_for_answer: true,
          papers: [{
            title: "Quantum coherence in photosynthesis",
            year: 2007,
            authors: [{ name: "Engel" }],
          }],
        },
      },
      {
        artifact_id: theoryReceiptRef,
        turn_id: turnId,
        producer_item_id: "agent_runtime_theory_locator_tool",
        kind: "helix_theory_context_reflection_tool_receipt",
        created_at_ms: 2,
        source_scope: "current_turn",
        goal_hash: "theory",
        payload: {
          schema: "helix.theory_context_reflection_tool_receipt.v1",
          tool_id: "helix_ask.reflect_theory_context",
          status: "completed",
        },
      },
      {
        artifact_id: sourceBackedFinalDraftRef,
        turn_id: turnId,
        producer_item_id: "runtime_final_answer_composer",
        kind: "final_answer_draft",
        created_at_ms: 3,
        source_scope: "current_turn",
        goal_hash: "source-backed-draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          artifact_id: sourceBackedFinalDraftRef,
          turn_id: turnId,
          goal_kind: "scholarly_research_lookup",
          required_terminal_kind: "scholarly_research_answer",
          authority: "llm_post_observation_composer",
          composer_scope: "source_tool_backed",
          llm_error_code: null,
          duration_ms: 12,
          text: finalDraftText,
          artifact_refs: [scholarlyObservationRef, theoryReceiptRef],
          support_refs: [scholarlyObservationRef],
          receipt_refs: [theoryReceiptRef],
          coverage_refs: [`${turnId}:goal_satisfaction_evaluation`],
          grounded_in_observation_refs: [scholarlyObservationRef],
          unsupported_claim_guard: {
            source_targeted: true,
            policy: "selected_artifacts_only",
          },
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt:
        "Use scholarly research to find papers about quantum coherence in photosynthesis. After the scholarly observation, use the Theory Badge Graph locator to place the claim. Then synthesize uncertainty with citations.",
      canonical_goal_frame: {
        ...canonicalGoal("scholarly_research_lookup", "scholarly_research_answer"),
        turn_id: turnId,
      },
      current_turn_artifact_ledger: artifacts,
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        applies: true,
        required_observation_families: ["scholarly_research", "theory_locator"],
        admitted_tool_families: ["scholarly_research", "theory_locator"],
        observed_families: ["scholarly_research", "theory_locator"],
        missing_observation_families: [],
        next_missing_family: null,
        complete: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      solver_hard_gate: {
        schema: "helix.ask_turn_solver_hard_gate.v1",
        applies: true,
        failed: false,
        failure_codes: [],
        primary_failure_code: null,
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: `${turnId}:model_only_concept_final_draft`,
        turn_id: turnId,
        goal_kind: "scholarly_research_lookup",
        required_terminal_kind: "scholarly_research_answer",
        authority: "model_turn_assistant_message",
        composer_scope: "model_only",
        llm_error_code: null,
        duration_ms: 0,
        text: staleModelOnlyDraftText,
        artifact_refs: [],
        support_refs: [],
        receipt_refs: [],
        coverage_refs: [],
        grounded_in_observation_refs: [],
        unsupported_claim_guard: {
          source_targeted: false,
          policy: "not_applicable",
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_artifact_id: scholarlyObservationRef,
      terminal_artifact_kind: "scholarly_research_observation",
      final_answer_source: "no_tool_direct",
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      answer: "I could not produce a terminal answer for this turn.",
      text: "I could not produce a terminal answer for this turn.",
      terminal_error_code: "typed_failure",
      terminal_consistency_check: {
        selected_terminal_kind: "scholarly_research_observation",
        final_answer_source: "no_tool_direct",
        consistent: false,
        violations: ["invalid_terminal_artifact_shape"],
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        turn_id: turnId,
        canonical_goal_kind: "scholarly_research_lookup",
        required_terminal_kind: "scholarly_research_answer",
        terminal_contract: {
          goal_kind: "scholarly_research_lookup",
          required_terminal_kinds: ["scholarly_research_answer"],
          acceptable_fallbacks: [],
          forbidden_terminal_kinds: ["scholarly_research_observation", "no_tool_direct", "model_direct_answer"],
          required_actions: ["scholarly-research.lookup_papers", "helix_ask.reflect_theory_context"],
          required_evidence: ["scholarly_research_observation", "helix_theory_context_reflection_tool_receipt"],
        },
        required_actions: [],
        required_evidence: [],
        observed_results: [],
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        assistant_answer: false,
        raw_content_included: false,
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        stop_reason: "terminal_satisfied",
        executed_tool_call_count: 2,
        iterations: [
          {
            iteration: 1,
            decision_ref: `${turnId}:agent-step:1`,
            next_step: "next_action",
            chosen_capability: "scholarly-research.lookup_papers",
            executed_action_key: "scholarly-research.lookup_papers",
            observation_role: "executed_tool_result",
            produced_artifacts: ["runtime_tool_call", "runtime_tool_call_validation", "scholarly_research_observation", "runtime_tool_observation"],
            observed_artifact_refs: [scholarlyObservationRef],
            satisfaction: "satisfied",
            missing_requirement_ids: [],
          },
          {
            iteration: 2,
            decision_ref: `${turnId}:agent-step:2`,
            next_step: "next_action",
            chosen_capability: "helix_ask.reflect_theory_context",
            executed_action_key: "helix_ask.reflect_theory_context",
            observation_role: "executed_tool_result",
            produced_artifacts: ["runtime_tool_call", "runtime_tool_call_validation", "helix_theory_context_reflection_tool_receipt", "runtime_tool_observation"],
            observed_artifact_refs: [theoryReceiptRef],
            satisfaction: "satisfied",
            missing_requirement_ids: [],
          },
          {
            iteration: 3,
            decision_ref: `${turnId}:agent-step:3`,
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            executed_action_key: null,
            observation_role: "terminal_decision",
            produced_artifacts: ["direct_answer_text", "final_answer_draft"],
            observed_artifact_refs: [`${turnId}:final_answer_draft`],
            satisfaction: "satisfied",
            missing_requirement_ids: [],
          },
        ],
      },
      agent_step_decision: {
        decision_id: `${turnId}:agent-step:3`,
        next_step: "answer",
        decision: "allow_terminal",
        chosen_capability: "model.direct_answer",
        decision_timing: "terminal_review",
        action_authorization: {
          required_before_tool_execution: false,
          authorizes_tool_execution: false,
          authorized_capability: null,
        },
      },
      debug: {
        terminal_artifact_kind: "scholarly_research_observation",
        final_answer_source: "no_tool_direct",
        terminal_error_code: "typed_failure",
      },
    };

    const refreshed = __testHelixScholarlyTerminalAuthorityRefresh.refreshScholarlyTerminalAuthorityAfterMaterialization({
      payload,
      threadId: "thread:test",
      turnId,
      route: "scholarly_research_lookup",
      prompt: String(payload.active_prompt),
    });

    expect(refreshed).toBe(true);
    expect(payload.ok).toBe(true);
    expect(payload.response_type).toBe("final_answer");
    expect(payload.terminal_artifact_kind).toBe("scholarly_research_answer");
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect(payload.selected_final_answer).toBe(finalDraftText);
    expect((payload.final_answer_draft as any).artifact_id).toBe(sourceBackedFinalDraftRef);
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.scholarly_research_answer).toMatchObject({
      schema: "helix.scholarly_research_answer.v1",
      artifact_id: `${turnId}:scholarly_research_answer`,
      answer_text: finalDraftText,
      support_refs: expect.arrayContaining([scholarlyObservationRef, theoryReceiptRef]),
      receipt_refs: expect.arrayContaining([theoryReceiptRef]),
    });
    expect((payload.current_turn_artifact_ledger as any[]).some((artifact) =>
      artifact.kind === "scholarly_research_answer" &&
      artifact.payload?.text === finalDraftText
    )).toBe(true);
    expect(payload.terminal_consistency_check).toMatchObject({
      selected_terminal_kind: "scholarly_research_answer",
      final_answer_source: "final_answer_draft",
      consistent: true,
      violations: [],
    });
    expect(payload.solver_controller_decision).toMatchObject({
      decision: "allow_terminal",
      selected_terminal_artifact_kind: "scholarly_research_answer",
      blocking_reasons: [],
    });
  });
});
