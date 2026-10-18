import { beforeEach, describe, expect, it } from "vitest";
import { validateStagePlayMicroReasonerRunV1 } from "@shared/contracts/stage-play-live-source-mail.v1";
import {
  buildStagePlayProcessedMailPacket,
  buildStagePlayProcessedMailPacketWithPromptedReasoners,
  type StagePlayPromptedMicroReasonerExecutor,
} from "../services/stage-play/stage-play-processed-mail-packet";
import { resetStagePlayProcessedMailPacketStoreForTest } from "../services/stage-play/stage-play-processed-mail-packet-store";

beforeEach(() => {
  resetStagePlayProcessedMailPacketStoreForTest();
});

describe("prompted stage-play micro-reasoners", () => {
  it("keeps neutral Minecraft shade objects from becoming recovery predictions", () => {
    const neutralShade = JSON.stringify({
      frame_overview: "The player is in a cave room with stone blocks, a torch, and a sword visible in the hotbar.",
      hud: {
        health_hearts: "full",
        armor_icons: "not visible",
        hunger_icons: "mostly full",
        xp_level: "8",
        selected_slot: "sword",
      },
      hotbar: {
        selected_slot: "sword",
        slots: [
          { slot: 1, visible_item: "sword", count_or_durability: "visible", confidence: "high" },
          { slot: 2, visible_item: "torch", count_or_durability: "unknown", confidence: "medium" },
        ],
        unreadable_slots: [],
      },
      near_field: ["stone floor", "torch on wall"],
      mid_field: ["cave passage", "decorative fire behind glass"],
      far_field: ["dark stone corridor"],
      salience_candidates: {
        risks: [],
        opportunities: [{ label: "route", evidence: "cave passage visible" }],
        routine_context: ["navigation"],
      },
      uncertainty: ["armor not visible"],
    });

    const result = buildStagePlayProcessedMailPacket({
      jobId: "stage_play_live_source_job:neutral",
      sourceId: "visual_source:neutral",
      now: "2026-06-04T12:00:00.000Z",
      mailItems: [{
        mailId: "mail:neutral:1",
        sourceId: "visual_source:neutral",
        sourceKind: "visual_frame",
        summary: {
          text: neutralShade,
          preview: neutralShade,
        },
        sourceRefs: {
          sourceId: "visual_source:neutral",
          evidenceRef: "visual_evidence:neutral",
          frameRef: "visual_frame:neutral",
          observationRef: "visual_observation:neutral",
        },
        evidenceRefs: ["visual_evidence:neutral", "visual_frame:neutral"],
      } as any],
      immersionState: {
        immersionStateId: "stage_play_immersion_state:neutral",
        policyId: null,
        profileId: null,
        sourceIds: ["visual_source:neutral"],
        latestMailIds: ["mail:neutral:1"],
        latestEvidenceRefs: ["visual_evidence:neutral"],
        sourceIdentity: { label: "Minecraft", confidence: 0.8, stable: true },
        stableFacts: ["Minecraft-like visual domain"],
        currentSceneFacts: ["cave, stone, mining, or low-light cue is visible"],
        changedFacts: ["cave, stone, mining, or low-light cue is visible"],
        uncertainties: [],
        currentActivity: "mining_or_cave",
        salience: {
          level: "medium",
          reasons: ["cave/mining context may require closer watch"],
          voiceCandidate: false,
        },
        prediction: null,
        lastValidation: null,
        evidenceRefs: ["stage_play_immersion_state:neutral"],
        createdAt: "2026-06-04T12:00:00.000Z",
        assistant_answer: false,
        terminal_eligible: false,
        context_role: "tool_evidence",
      } as any,
      predictionValidation: {
        validationId: "stage_play_prediction_validation:neutral",
        priorPredictionId: null,
        result: "no_prior_prediction",
        supportedSignals: [],
        contradictedSignals: [],
        newSignals: [],
        salienceHint: "medium",
        recommendedNext: "wait_for_next_summary",
        evidenceRefs: ["stage_play_prediction_validation:neutral"],
        createdAt: "2026-06-04T12:00:00.000Z",
      } as any,
    });

    expect(result.packet.riskMatches).toEqual([]);
    expect(result.packet.answer_authority).toBe(false);
    expect(result.packet.effortEstimate?.currentEffort).toBe("cave_exploration");
    expect(result.packet.actionPredictions?.map((prediction) => prediction.predictedAction).join("\n"))
      .not.toMatch(/recover|retreat|hazard navigation/i);
    expect(result.packet.observedFacts.join("\n")).toContain("frame_overview");
    expect(result.packet.opportunityMatches.join("\n")).toContain("cave passage visible");
  });

  it("lets bounded LLM receipts ground salience before the deterministic wake decision", async () => {
    const calls: string[] = [];
    const executor: StagePlayPromptedMicroReasonerExecutor = async (input) => {
      calls.push(input.role);
      const jsonByRole: Record<string, Record<string, unknown>> = {
        claim_extractor: {
          observedFacts: ["mail:1 scene: stone cave walkway; no visible fire or damage indicator"],
          inferredFacts: ["mail:1 likely cave traversal, not combat"],
          uncertainties: ["HUD details are not readable enough to infer damage"],
          sceneTags: ["cave"],
          activityTags: ["navigation"],
          objectTags: ["stone"],
          riskTags: [],
          opportunityTags: [],
        },
        observation_classifier: {
          stableFactsUsed: [],
          changedFacts: ["cave walkway remains visible"],
          contradictions: ["summary risk words are not grounded by the prompted visual claim"],
          uncertainties: ["damage/fire cues absent in the grounded claim"],
        },
        salience_scorer: {
          salienceLevel: "low",
          reasons: ["no grounded urgent risk cue"],
          voiceCandidate: false,
          calloutDraft: null,
          recommendedNext: "wait_for_next_summary",
        },
        hypothesis_arbiter: {
          recommendedNext: "wait_for_next_summary",
          wakeAsk: false,
          reason: "Prompted claim extraction did not ground the fire/damage warning.",
          confidence: "high",
          selectedHypothesis: null,
          voiceCandidate: false,
          calloutDraft: null,
          missingEvidence: [],
        },
        decision_selector: {
          selectedDecision: "wait_for_next_summary",
          recommendedNextTool: null,
          confidence: "high",
          reasons: ["grounded micro-reasoner receipts suppress the baseline warning"],
          missingEvidence: [],
        },
      };
      const json = jsonByRole[input.role] ?? {};
      return {
        ok: true,
        text: JSON.stringify(json),
        json,
        model: "test-micro-llm",
        latencyMs: 7,
        tokenEstimateIn: 90,
        tokenEstimateOut: 35,
      };
    };

    const result = await buildStagePlayProcessedMailPacketWithPromptedReasoners({
      jobId: "stage_play_live_source_job:test",
      sourceId: "visual_source:test",
      now: "2026-06-04T12:00:00.000Z",
      mailItems: [{
        mailId: "mail:1",
        sourceId: "visual_source:test",
        sourceKind: "visual_frame",
        summary: {
          text: "Minecraft cave scene with low light and the player near fire damage.",
          preview: "Minecraft cave scene with low light and the player near fire damage.",
        },
        sourceRefs: {
          evidenceRef: "visual_evidence:test",
          frameRef: "visual_frame:test",
          observationRef: "visual_observation:test",
        },
        evidenceRefs: ["visual_evidence:test", "visual_frame:test"],
      } as any],
      immersionState: {
        immersionStateId: "stage_play_immersion_state:test",
        policyId: null,
        profileId: null,
        sourceIds: ["visual_source:test"],
        latestMailIds: ["mail:1"],
        latestEvidenceRefs: ["visual_evidence:test"],
        sourceIdentity: { label: "Minecraft", confidence: 0.8, stable: true },
        stableFacts: [],
        currentSceneFacts: ["Minecraft cave scene with low light and the player near fire damage."],
        changedFacts: ["combat, fire, damage, or hostile cue is visible"],
        uncertainties: [],
        currentActivity: "cave_exploration",
        salience: {
          level: "urgent",
          reasons: ["risk/voice criteria matched: fire, damage"],
          voiceCandidate: true,
          calloutDraft: "Possible fire damage visible.",
        },
        prediction: null,
        lastValidation: null,
        evidenceRefs: ["stage_play_immersion_state:test"],
        createdAt: "2026-06-04T12:00:00.000Z",
        assistant_answer: false,
        terminal_eligible: false,
        context_role: "tool_evidence",
      } as any,
      predictionValidation: {
        validationId: "stage_play_prediction_validation:test",
        priorPredictionId: null,
        result: "no_prior_prediction",
        supportedSignals: [],
        contradictedSignals: [],
        newSignals: [],
        salienceHint: "low",
        recommendedNext: "wait_for_next_summary",
        evidenceRefs: ["stage_play_prediction_validation:test"],
        createdAt: "2026-06-04T12:00:00.000Z",
      } as any,
      promptedMicroReasoners: {
        enabled: true,
        executor,
      },
    });

    expect(calls).toEqual([
      "claim_extractor",
      "observation_classifier",
      "salience_scorer",
      "hypothesis_arbiter",
      "decision_selector",
    ]);
    expect(result.packet.recommendedNext).toBe("wait_for_next_summary");
    expect(result.packet.answer_authority).toBe(false);
    expect(result.packet.salience).toMatchObject({
      level: "low",
      voiceCandidate: false,
    });
    expect(result.packet.observedFacts.join("\n")).toContain("no visible fire or damage indicator");
    expect(result.microReasonerRuns.find((run) => run.role === "claim_extractor")).toMatchObject({
      modelUsed: "test-micro-llm",
      raw_content_included: false,
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "micro_reasoner_evidence",
    });
    expect(result.microReasonerRuns.find((run) => run.role === "decision_selector")).toMatchObject({
      selectedDecision: "wait_for_next_summary",
      recommendedNextTool: null,
    });
  });

  it("keeps MicroDeck product roles independent when helper roles fail", async () => {
    const calls: string[] = [];
    const executor: StagePlayPromptedMicroReasonerExecutor = async (input) => {
      calls.push(input.role);
      if (input.role === "claim_extractor") {
        return {
          ok: false,
          text: "",
          json: null,
          model: "test-micro-llm",
          latencyMs: 5,
          error: "classifier unavailable",
        };
      }
      if (input.role === "packet_composer") {
        const json = {
          inlineTranslations: [
            { unitId: "u0001", sourceText: "Final answer", translatedText: "Pane hope", confidence: "medium" },
          ],
          warnings: [],
          evidenceRefs: ["mail:doc:1"],
        };
        return {
          ok: true,
          text: JSON.stringify(json),
          json,
          model: "test-micro-llm",
          latencyMs: 9,
          tokenEstimateIn: 90,
          tokenEstimateOut: 35,
        };
      }
      const json = { retainTerms: ["Helix"], orthographyNotes: ["Use okina/kahako when known"], evidenceRefs: ["mail:doc:1"] };
      return {
        ok: true,
        text: JSON.stringify(json),
        json,
        model: "test-micro-llm",
        latencyMs: 6,
        tokenEstimateIn: 70,
        tokenEstimateOut: 24,
      };
    };

    const result = await buildStagePlayProcessedMailPacketWithPromptedReasoners({
      jobId: "stage_play_live_source_job:doc",
      sourceId: "document_markdown:docs/test.md",
      now: "2026-06-04T12:00:00.000Z",
      mailItems: [{
        mailId: "mail:doc:1",
        sourceId: "document_markdown:docs/test.md",
        sourceKind: "document_markdown",
        summary: {
          text: "Final answer",
          preview: "Final answer",
        },
        sourceRefs: {
          evidenceRef: "document_markdown:docs/test.md:u0001",
          frameRef: "document_markdown:docs/test.md",
          observationRef: "document_markdown_visible_unit:u0001",
        },
        evidenceRefs: ["document_markdown:docs/test.md:u0001"],
      } as any],
      immersionState: {
        immersionStateId: "stage_play_immersion_state:doc",
        policyId: null,
        profileId: null,
        sourceIds: ["document_markdown:docs/test.md"],
        latestMailIds: ["mail:doc:1"],
        latestEvidenceRefs: ["document_markdown:docs/test.md:u0001"],
        sourceIdentity: { label: "Document Markdown", confidence: 0.8, stable: true },
        stableFacts: [],
        currentSceneFacts: ["Visible document text: Final answer"],
        changedFacts: ["document visible unit changed"],
        uncertainties: [],
        currentActivity: "document_reading",
        salience: {
          level: "low",
          reasons: ["document packet"],
          voiceCandidate: false,
        },
        prediction: null,
        lastValidation: null,
        evidenceRefs: ["stage_play_immersion_state:doc"],
        createdAt: "2026-06-04T12:00:00.000Z",
        assistant_answer: false,
        terminal_eligible: false,
        context_role: "tool_evidence",
      } as any,
      predictionValidation: {
        validationId: "stage_play_prediction_validation:doc",
        priorPredictionId: null,
        result: "no_prior_prediction",
        supportedSignals: [],
        contradictedSignals: [],
        newSignals: [],
        salienceHint: "low",
        recommendedNext: "wait_for_next_summary",
        evidenceRefs: ["stage_play_prediction_validation:doc"],
        createdAt: "2026-06-04T12:00:00.000Z",
      } as any,
      promptedMicroReasoners: {
        enabled: true,
        executor,
      },
    });

    expect(calls).toEqual(["claim_extractor", "observation_classifier", "packet_composer"]);
    expect(result.microReasonerRuns.find((run) => run.role === "claim_extractor")).toMatchObject({
      status: "failed",
      error: "classifier unavailable",
    });
    const composer = result.microReasonerRuns.find((run) => run.role === "packet_composer");
    expect(composer).toMatchObject({
      status: "completed",
      deckProductRole: true,
      deckExecutionMode: "uses_prior_outputs",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "micro_reasoner_evidence",
      outputPreview: expect.stringContaining("\"schema\":\"stage_play_document_inline_translation_output/v1\""),
    });
    expect(validateStagePlayMicroReasonerRunV1(composer)).toEqual([]);
    expect(result.packet.microReasonerRunRefs).toContain(composer?.runId);
    expect(result.packet.answer_authority).toBe(false);
    const packetRunRoles = result.packet.microReasonerRunRefs
      .map((runId) => result.microReasonerRuns.find((run) => run.runId === runId)?.role)
      .filter(Boolean)
      .sort();
    expect(packetRunRoles).toEqual(["claim_extractor", "observation_classifier", "packet_composer"]);
    expect(result.packet.evidenceRefs).toContain("prompted_micro_reasoner:packet_composer");
  });
});
