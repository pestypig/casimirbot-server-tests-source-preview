import { beforeEach, describe, expect, it } from "vitest";
import {
  buildStagePlayProcessedMailPacketWithPromptedReasoners,
  type StagePlayPromptedMicroReasonerExecutor,
} from "../services/stage-play/stage-play-processed-mail-packet";
import {
  applyStagePlayMicroReasonerPromptPreset,
  ensureDefaultStagePlayMicroReasonerPromptPresets,
  getActiveStagePlayMicroReasonerPromptForRole,
  getActiveStagePlayMicroReasonerPromptPresetForSource,
  listStagePlayActiveMicroReasonerPromptsForSource,
  listStagePlayMicroReasonerPromptPresets,
  resetStagePlayProcessedMailPacketStoreForTest,
} from "../services/stage-play/stage-play-processed-mail-packet-store";
import {
  listStagePlayLiveSourceMailWakeRequests,
  listStagePlayLiveSourceMailWakeResults,
  queueStagePlayLiveSourceMailWakeRequest,
  recordStagePlayMailWakeResult,
  resetStagePlayLiveSourceMailWakeStoreForTest,
} from "../services/stage-play/stage-play-live-source-mail-wake-store";
import {
  ADAPTIVE_VISUAL_LENS_CONTROLLER_PRESET_ID,
} from "../../shared/contracts/stage-play-adaptive-visual-lens.v1";

describe("stage play micro-reasoner prompt presets", () => {
  beforeEach(() => {
    resetStagePlayProcessedMailPacketStoreForTest();
    resetStagePlayLiveSourceMailWakeStoreForTest();
    ensureDefaultStagePlayMicroReasonerPromptPresets();
  });

  it("lists global MicroDeck presets without treating them as source-applied", () => {
    const presets = listStagePlayMicroReasonerPromptPresets({
      sourceId: "calculator_source:test",
      includePresets: true,
    });

    expect(presets.map((preset) => preset.presetId)).toContain("stage_play_micro_reasoner_prompt_preset:generic-live-source:v1");
    expect(presets.map((preset) => preset.presetId)).toContain("stage_play_micro_reasoner_prompt_preset:calculator-tool-call:v1");
    expect(presets.map((preset) => preset.presetId)).toContain("stage_play_micro_reasoner_prompt_preset:minecraft_minimal_operator:v1");
    expect(presets.map((preset) => preset.presetId)).toEqual(expect.arrayContaining([
      "stage_play_micro_reasoner_prompt_preset:automation-task-delegation:v1",
      "stage_play_micro_reasoner_prompt_preset:escalation-gate:v1",
      "stage_play_micro_reasoner_prompt_preset:wake-bound-contract-appender:v1",
      "stage_play_micro_reasoner_prompt_preset:human-approval-filter:v1",
      "stage_play_micro_reasoner_prompt_preset:workflow-stage-matcher:v1",
      "stage_play_micro_reasoner_prompt_preset:blocker-extractor:v1",
    ]));
    const wakeContractPreset = presets.find((preset) =>
      preset.presetId === "stage_play_micro_reasoner_prompt_preset:wake-bound-contract-appender:v1"
    );
    expect(wakeContractPreset?.wakePromptContract).toMatchObject({
      attachOnlyWhenWakeBound: true,
      title: "Wake-Bound Operator Contract",
    });
    expect(getActiveStagePlayMicroReasonerPromptPresetForSource({ sourceId: "calculator_source:test" })?.presetId)
      .toBe("stage_play_micro_reasoner_prompt_preset:generic-live-source:v1");
  });

  it("lists earbud MicroDeck presets for audio transcript sources without mixing visual presets", () => {
    const presets = listStagePlayMicroReasonerPromptPresets({
      sourceId: "audio_transcript:test",
      sourceKind: "audio_transcript",
      includePresets: true,
    });
    const presetIds = presets.map((preset) => preset.presetId);

    expect(presetIds).toEqual(expect.arrayContaining([
      "stage_play_micro_reasoner_prompt_preset:earbud-translate-english:v1",
      "stage_play_micro_reasoner_prompt_preset:earbud-translate-spanish:v1",
      "stage_play_micro_reasoner_prompt_preset:earbud-explain-plain-english:v1",
    ]));
    expect(presetIds).not.toContain("stage_play_micro_reasoner_prompt_preset:minecraft_minimal_operator:v1");
    expect(getActiveStagePlayMicroReasonerPromptPresetForSource({
      sourceId: "audio_transcript:test",
      sourceKind: "audio_transcript",
    })?.presetId).toBe("stage_play_micro_reasoner_prompt_preset:earbud-translate-english:v1");
  });

  it("lists the adaptive visual lens controller only for visual frame sources", () => {
    const visualPresets = listStagePlayMicroReasonerPromptPresets({
      sourceId: "visual_source:adaptive",
      sourceKind: "visual_frame",
      includePresets: true,
    });
    const audioPresets = listStagePlayMicroReasonerPromptPresets({
      sourceId: "audio_transcript:adaptive",
      sourceKind: "audio_transcript",
      includePresets: true,
    });

    const adaptivePreset = visualPresets.find((preset) => preset.presetId === ADAPTIVE_VISUAL_LENS_CONTROLLER_PRESET_ID);

    expect(adaptivePreset).toMatchObject({
      title: "Adaptive Visual Lens Controller",
      sourceKinds: ["visual_frame"],
      outputPolicy: "record_only",
      promptedRoles: ["observation_classifier", "hypothesis_arbiter"],
    });
    expect(audioPresets.map((preset) => preset.presetId)).not.toContain(ADAPTIVE_VISUAL_LENS_CONTROLLER_PRESET_ID);
    expect(getActiveStagePlayMicroReasonerPromptPresetForSource({
      sourceId: "visual_source:adaptive",
      sourceKind: "visual_frame",
    })?.presetId).not.toBe(ADAPTIVE_VISUAL_LENS_CONTROLLER_PRESET_ID);
  });

  it("applies an earbud translation deck only to audio transcript sources", () => {
    const applied = applyStagePlayMicroReasonerPromptPreset({
      presetId: "stage_play_micro_reasoner_prompt_preset:earbud-translate-spanish:v1",
      sourceIds: ["audio_transcript:test"],
      sourceKind: "audio_transcript",
      now: "2026-06-04T12:00:00.000Z",
    });
    const activePreset = getActiveStagePlayMicroReasonerPromptPresetForSource({
      sourceId: "audio_transcript:test",
      sourceKind: "audio_transcript",
    });
    const prompts = listStagePlayActiveMicroReasonerPromptsForSource({
      sourceId: "audio_transcript:test",
      sourceKind: "audio_transcript",
    });
    const rejected = applyStagePlayMicroReasonerPromptPreset({
      presetId: "stage_play_micro_reasoner_prompt_preset:earbud-translate-spanish:v1",
      sourceIds: ["visual_source:test"],
      sourceKind: "visual_frame",
    });

    expect(applied?.sourceIds).toContain("audio_transcript:test");
    expect(activePreset).toMatchObject({
      presetId: "stage_play_micro_reasoner_prompt_preset:earbud-translate-spanish:v1",
      domain: "audio_translation",
      outputPolicy: "earbud_translation",
      promptedRoles: ["packet_composer"],
    });
    expect(prompts.find((prompt) => prompt.role === "packet_composer")?.promptId)
      .toBe("stage_play_micro_reasoner_prompt:earbud-translate-spanish:packet_composer:v1");
    expect(rejected).toBeNull();
  });

  it("lists document Markdown translation decks separately from audio and visual sources", () => {
    const documentPresets = listStagePlayMicroReasonerPromptPresets({
      sourceId: "document_markdown:docs/example.md",
      sourceKind: "document_markdown",
      includePresets: true,
    });
    const audioPresets = listStagePlayMicroReasonerPromptPresets({
      sourceId: "audio_transcript:docs",
      sourceKind: "audio_transcript",
      includePresets: true,
    });
    const visualPresets = listStagePlayMicroReasonerPromptPresets({
      sourceId: "visual_source:docs",
      sourceKind: "visual_frame",
      includePresets: true,
    });
    const documentPresetIds = documentPresets.map((preset) => preset.presetId);

    expect(documentPresetIds).toContain("stage_play_micro_reasoner_prompt_preset:document-translate-haw-inline:v1");
    expect(documentPresetIds).not.toContain("stage_play_micro_reasoner_prompt_preset:earbud-translate-english:v1");
    expect(audioPresets.map((preset) => preset.presetId)).not.toContain("stage_play_micro_reasoner_prompt_preset:document-translate-haw-inline:v1");
    expect(visualPresets.map((preset) => preset.presetId)).not.toContain("stage_play_micro_reasoner_prompt_preset:document-translate-haw-inline:v1");
    expect(getActiveStagePlayMicroReasonerPromptPresetForSource({
      sourceId: "document_markdown:docs/example.md",
      sourceKind: "document_markdown",
    })?.presetId).toBe("stage_play_micro_reasoner_prompt_preset:document-translate-haw-inline:v1");
  });

  it("applies a document Markdown translation deck only to document Markdown sources", () => {
    const applied = applyStagePlayMicroReasonerPromptPreset({
      presetId: "stage_play_micro_reasoner_prompt_preset:document-translate-haw-inline:v1",
      sourceIds: ["document_markdown:docs/example.md"],
      sourceKind: "document_markdown",
      now: "2026-06-04T12:00:00.000Z",
    });
    const activePreset = getActiveStagePlayMicroReasonerPromptPresetForSource({
      sourceId: "document_markdown:docs/example.md",
      sourceKind: "document_markdown",
    });
    const prompts = listStagePlayActiveMicroReasonerPromptsForSource({
      sourceId: "document_markdown:docs/example.md",
      sourceKind: "document_markdown",
    });
    const classifierPrompt = prompts.find((prompt) => prompt.role === "claim_extractor");
    const glossaryPrompt = prompts.find((prompt) => prompt.role === "observation_classifier");
    const packetComposerPrompt = prompts.find((prompt) => prompt.role === "packet_composer");
    const rejectedAudio = applyStagePlayMicroReasonerPromptPreset({
      presetId: "stage_play_micro_reasoner_prompt_preset:document-translate-haw-inline:v1",
      sourceIds: ["audio_transcript:docs"],
      sourceKind: "audio_transcript",
    });
    const rejectedVisual = applyStagePlayMicroReasonerPromptPreset({
      presetId: "stage_play_micro_reasoner_prompt_preset:document-translate-haw-inline:v1",
      sourceIds: ["visual_source:docs"],
      sourceKind: "visual_frame",
    });

    expect(applied?.sourceIds).toContain("document_markdown:docs/example.md");
    expect(activePreset).toMatchObject({
      presetId: "stage_play_micro_reasoner_prompt_preset:document-translate-haw-inline:v1",
      domain: "document_translation",
      outputPolicy: "inline_document_translation",
      promptedRoles: ["claim_extractor", "observation_classifier", "packet_composer"],
    });
    expect(packetComposerPrompt?.promptId)
      .toBe("stage_play_micro_reasoner_prompt:document-translate-haw-inline:packet_composer:v1");
    expect(packetComposerPrompt?.title).toBe("Document Translate To Target Language Inline");
    expect(packetComposerPrompt?.template).toContain("target_language");
    expect(packetComposerPrompt?.template).toContain("Generate inline translation candidates in target_language");
    expect(classifierPrompt?.template).toContain("may be in any language");
    expect(classifierPrompt?.template).toContain("do not assume English");
    expect(glossaryPrompt?.template).toContain("original language");
    expect(packetComposerPrompt?.template).toContain("original source form");
    expect(prompts.map((prompt) => prompt.template).join("\n")).not.toContain("canonical English");
    expect(packetComposerPrompt?.template).not.toContain("Generate Hawaiian");
    expect(packetComposerPrompt?.template).not.toContain('"locale": "haw"');
    expect(rejectedAudio).toBeNull();
    expect(rejectedVisual).toBeNull();
  });

  it("projects document Markdown translation deck output as structured inline UI evidence", async () => {
    const sourceId = "document_markdown:docs/example.md";
    applyStagePlayMicroReasonerPromptPreset({
      presetId: "stage_play_micro_reasoner_prompt_preset:document-translate-haw-inline:v1",
      sourceIds: [sourceId],
      sourceKind: "document_markdown",
      now: "2026-06-04T12:00:00.000Z",
    });
    const mailItems = [{
      mailId: "mail:document:1",
      sourceId,
      sourceKind: "document_markdown",
      summary: {
        text: JSON.stringify({
          schema: "stage_play.document_markdown_visible_units.v1",
          chunk_id: "doc-inline:fnv1a32:test:u0001",
          chunk_index: 1,
          dedupe_key: `${sourceId}:doc-inline:fnv1a32:test:u0001:haw`,
          source_event_id: "document_markdown_event:doc-inline:fnv1a32:test:u0001",
          source_event_ms: 1780000000000,
          doc_path: "docs/example.md",
          source_hash: "fnv1a32:test",
          source_text_hash: "fnv1a32:text-payload",
          source_text_char_count: "# Account language".length,
          receipt_ref: "receipt:doc-inline",
          lane_session_id: "lane_session:live_translation:docs:fnv1a32:test",
          session_control_key: "lane_session:live_translation:docs:fnv1a32:test::document_markdown:docs/example.md::docs_chunk",
          source_binding_key: "document_markdown:docs/example.md::fnv1a32:test::docs_chunk::haw::haw",
          mail_loop_observation_key:
            "document_markdown:docs/example.md::fnv1a32:test::document_markdown::docs_chunk::haw::haw::doc-inline:fnv1a32:test:u0001::receipt:doc-inline",
          locale: "haw",
          target_language: "haw",
          account_locale: "haw",
          projection_target: "docs_chunk",
          freshness_status: "fresh",
          units: [
            {
              unit_id: "u0001",
              kind: "heading",
              source_markdown: "# Account language",
              translatable: true,
              protected_spans: [],
            },
          ],
        }),
        preview: "docs/example.md: 1 visible Markdown unit for haw inline translation.",
      },
      sourceRefs: {
        sourceId,
        evidenceRef: "document_markdown:docs/example.md:fnv1a32:test:u0001",
        sourceHash: "fnv1a32:test",
        sourceTextHash: "fnv1a32:text-payload",
        sourceTextCharCount: "# Account language".length,
        receiptRef: "receipt:doc-inline",
        laneSessionId: "lane_session:live_translation:docs:fnv1a32:test",
        sessionControlKey: "lane_session:live_translation:docs:fnv1a32:test::document_markdown:docs/example.md::docs_chunk",
        sourceBindingKey: "document_markdown:docs/example.md::fnv1a32:test::docs_chunk::haw::haw",
        sourceIdentityKey:
          "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload::18::docs::docs_chunk::haw::haw",
        latestSourceIdentityKey:
          "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload-latest::18::docs::docs_chunk::haw::haw",
        mailLoopObservationKey:
          "document_markdown:docs/example.md::fnv1a32:test::document_markdown::docs_chunk::haw::haw::doc-inline:fnv1a32:test:u0001::receipt:doc-inline",
      },
      evidenceRefs: [`${sourceId}:unit:u0001`],
    } as any];
    const commonInput = {
      jobId: "stage_play_live_source_job:document",
      sourceId,
      now: "2026-06-04T12:00:00.000Z",
      mailItems,
      immersionState: {
        immersionStateId: "stage_play_immersion_state:document",
        policyId: null,
        profileId: null,
        sourceIds: [sourceId],
        latestMailIds: ["mail:document:1"],
        latestEvidenceRefs: [`${sourceId}:unit:u0001`],
        sourceIdentity: { label: "Document Markdown", confidence: 0.9, stable: true },
        stableFacts: [],
        currentSceneFacts: ["Document Markdown visible unit: Account language."],
        changedFacts: ["visible document unit changed"],
        uncertainties: [],
        currentActivity: "document_translation",
        salience: {
          level: "medium",
          reasons: ["visible document unit"],
          voiceCandidate: false,
          calloutDraft: null,
        },
        prediction: null,
        lastValidation: null,
        evidenceRefs: ["stage_play_immersion_state:document"],
        createdAt: "2026-06-04T12:00:00.000Z",
        assistant_answer: false,
        terminal_eligible: false,
        context_role: "tool_evidence",
      } as any,
      predictionValidation: {
        validationId: "stage_play_prediction_validation:document",
        priorPredictionId: null,
        result: "no_prior_prediction",
        supportedSignals: [],
        contradictedSignals: [],
        newSignals: ["visible document unit changed"],
        salienceHint: "medium",
        recommendedNext: "wait_for_next_summary",
        evidenceRefs: ["stage_play_prediction_validation:document"],
        createdAt: "2026-06-04T12:00:00.000Z",
      } as any,
    };
    const executor: StagePlayPromptedMicroReasonerExecutor = async (input) => {
      if (input.role === "packet_composer") {
        const json = {
          locale: "haw",
          translations: [
            {
              unit_id: "u0001",
              translated_markdown: "Translated account language heading",
              confidence: "medium",
              warnings: [],
            },
          ],
          qualityChecks: [
            { name: "placeholder_parity", status: "pass", detail: "No placeholders." },
          ],
          evidenceRefs: [`${sourceId}:unit:u0001`],
        };
        return { ok: true, text: JSON.stringify(json), json, model: "test-document-translator", latencyMs: 5 };
      }
      const json = input.role === "claim_extractor"
        ? {
            observedFacts: ["u0001 heading is translatable"],
            inferredFacts: [],
            uncertainties: [],
            sceneTags: ["document_markdown"],
            activityTags: ["translation"],
            objectTags: ["u0001"],
            riskTags: [],
            opportunityTags: [],
          }
        : {
            changedFacts: ["u0001 ready for glossary guard"],
            stableFactsUsed: [],
            contradictions: [],
            uncertainties: [],
          };
      return { ok: true, text: JSON.stringify(json), json, model: "test-document-classifier", latencyMs: 4 };
    };

    const prompted = await buildStagePlayProcessedMailPacketWithPromptedReasoners({
      ...commonInput,
      promptedMicroReasoners: {
        enabled: true,
        executor,
      },
    });
    const promptedComposer = prompted.microReasonerRuns.find((run) => run.role === "packet_composer");
    const promptedOutput = JSON.parse(promptedComposer?.outputPreview ?? "{}");

    expect(promptedComposer).toMatchObject({
      deckProductRole: true,
      deckExecutionMode: "uses_prior_outputs",
      status: "completed",
      context_role: "micro_reasoner_evidence",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(promptedOutput).toMatchObject({
      schema: "stage_play_document_inline_translation_output/v1",
      sourceKind: "document_markdown",
      sourceId,
      sourceTextHash: "fnv1a32:text-payload",
      sourceTextCharCount: "# Account language".length,
      receiptRef: "receipt:doc-inline",
      chunkId: "doc-inline:fnv1a32:test:u0001",
      chunkIndex: 1,
      laneSessionId: "lane_session:live_translation:docs:fnv1a32:test",
      sessionControlKey: "lane_session:live_translation:docs:fnv1a32:test::document_markdown:docs/example.md::docs_chunk",
      sourceBindingKey: "document_markdown:docs/example.md::fnv1a32:test::docs_chunk::haw::haw",
      sourceIdentityKey:
        "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload::18::docs::docs_chunk::haw::haw",
      latestSourceIdentityKey:
        "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload-latest::18::docs::docs_chunk::haw::haw",
      mailLoopObservationKey:
        "document_markdown:docs/example.md::fnv1a32:test::document_markdown::docs_chunk::haw::haw::doc-inline:fnv1a32:test:u0001::receipt:doc-inline",
      latestMailLoopObservationKey:
        "document_markdown:docs/example.md::fnv1a32:test::document_markdown::docs_chunk::haw::haw::doc-inline:fnv1a32:test:u0001::receipt:doc-inline",
      dedupeKey: `${sourceId}:doc-inline:fnv1a32:test:u0001:haw`,
      sourceEventId: "document_markdown_event:doc-inline:fnv1a32:test:u0001",
      sourceEventMs: 1780000000000,
      projectionTarget: "docs_chunk",
      locale: "haw",
      targetLanguage: "haw",
      accountLocale: "haw",
      projectionStatus: "projected",
      freshnessStatus: "fresh",
      observedAtMs: Date.parse("2026-06-04T12:00:00.000Z"),
      translations: [
        {
          unit_id: "u0001",
          translated_markdown: "Translated account language heading",
          confidence: "medium",
        },
      ],
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "micro_reasoner_evidence",
    });
    expect(prompted.packet.evidenceHandles?.sourceReceipts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        receiptRef: "receipt:doc-inline",
        evidenceRefs: expect.arrayContaining(["receipt:doc-inline"]),
      }),
    ]));
    expect(prompted.packet.evidenceRefs).toEqual(expect.arrayContaining(["receipt:doc-inline"]));

    resetStagePlayProcessedMailPacketStoreForTest();
    ensureDefaultStagePlayMicroReasonerPromptPresets();
    applyStagePlayMicroReasonerPromptPreset({
      presetId: "stage_play_micro_reasoner_prompt_preset:document-translate-haw-inline:v1",
      sourceIds: [sourceId],
      sourceKind: "document_markdown",
      now: "2026-06-04T12:00:00.000Z",
    });
    const fallbackResult = await buildStagePlayProcessedMailPacketWithPromptedReasoners({
      ...commonInput,
      promptedMicroReasoners: { enabled: false },
    });
    const fallbackComposer = fallbackResult.microReasonerRuns.find((run) => run.role === "packet_composer");
    const fallbackOutput = JSON.parse(fallbackComposer?.outputPreview ?? "{}");

    expect(fallbackOutput).toMatchObject({
      schema: "stage_play_document_inline_translation_output/v1",
      sourceKind: "document_markdown",
      sourceId,
      sourceTextHash: "fnv1a32:text-payload",
      sourceTextCharCount: "# Account language".length,
      receiptRef: "receipt:doc-inline",
      chunkId: "doc-inline:fnv1a32:test:u0001",
      chunkIndex: 1,
      laneSessionId: "lane_session:live_translation:docs:fnv1a32:test",
      sessionControlKey: "lane_session:live_translation:docs:fnv1a32:test::document_markdown:docs/example.md::docs_chunk",
      sourceBindingKey: "document_markdown:docs/example.md::fnv1a32:test::docs_chunk::haw::haw",
      sourceIdentityKey:
        "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload::18::docs::docs_chunk::haw::haw",
      latestSourceIdentityKey:
        "document_markdown:docs/example.md::fnv1a32:test::fnv1a32:text-payload-latest::18::docs::docs_chunk::haw::haw",
      mailLoopObservationKey:
        "document_markdown:docs/example.md::fnv1a32:test::document_markdown::docs_chunk::haw::haw::doc-inline:fnv1a32:test:u0001::receipt:doc-inline",
      latestMailLoopObservationKey:
        "document_markdown:docs/example.md::fnv1a32:test::document_markdown::docs_chunk::haw::haw::doc-inline:fnv1a32:test:u0001::receipt:doc-inline",
      dedupeKey: `${sourceId}:doc-inline:fnv1a32:test:u0001:haw`,
      sourceEventId: "document_markdown_event:doc-inline:fnv1a32:test:u0001",
      sourceEventMs: 1780000000000,
      projectionTarget: "docs_chunk",
      locale: "haw",
      targetLanguage: "haw",
      accountLocale: "haw",
      projectionStatus: "failed",
      freshnessStatus: "fresh",
      observedAtMs: Date.parse("2026-06-04T12:00:00.000Z"),
      translations: [],
      unit_errors: [
        {
          unit_id: "u0001",
          reason: "document_translation_model_output_unavailable",
        },
      ],
      qualityChecks: [
        {
          name: "document_translation_contract",
          status: "fail",
        },
      ],
    });
  });

  it("applies a source preset and resolves role prompts through the selected deck", () => {
    const applied = applyStagePlayMicroReasonerPromptPreset({
      presetId: "stage_play_micro_reasoner_prompt_preset:calculator-tool-call:v1",
      sourceIds: ["calculator_source:test"],
      now: "2026-06-04T12:00:00.000Z",
    });
    const activePreset = getActiveStagePlayMicroReasonerPromptPresetForSource({ sourceId: "calculator_source:test" });
    const decisionPrompt = getActiveStagePlayMicroReasonerPromptForRole("decision_selector", {
      sourceId: "calculator_source:test",
    });
    const deckPrompts = listStagePlayActiveMicroReasonerPromptsForSource({
      sourceId: "calculator_source:test",
    });

    expect(applied?.sourceIds).toContain("calculator_source:test");
    expect(activePreset?.presetId).toBe("stage_play_micro_reasoner_prompt_preset:calculator-tool-call:v1");
    expect(activePreset?.promptedRoles).toEqual(["claim_extractor", "observation_classifier", "salience_scorer", "decision_selector"]);
    expect(decisionPrompt?.title).toBe("Calculator Tool-Call Decision Selector");
    expect(deckPrompts.find((prompt) => prompt.role === "decision_selector")?.promptId).toBe(decisionPrompt?.promptId);
  });

  it("uses the source preset role subset when running prompted micro-reasoners", async () => {
    applyStagePlayMicroReasonerPromptPreset({
      presetId: "stage_play_micro_reasoner_prompt_preset:calculator-tool-call:v1",
      sourceIds: ["calculator_source:test"],
      now: "2026-06-04T12:00:00.000Z",
    });
    const calls: Array<{ role: string; title: string }> = [];
    const executor: StagePlayPromptedMicroReasonerExecutor = async (input) => {
      calls.push({ role: input.role, title: input.promptTitle });
      const jsonByRole: Record<string, Record<string, unknown>> = {
        claim_extractor: {
          observedFacts: ["row: kinetic_energy=42 J"],
          inferredFacts: ["calculator stream is active"],
          uncertainties: [],
          sceneTags: ["calculator"],
          activityTags: ["calculation"],
          objectTags: ["kinetic_energy"],
          riskTags: [],
          opportunityTags: ["tool_followup_candidate"],
        },
        observation_classifier: {
          stableFactsUsed: [],
          changedFacts: ["kinetic_energy row changed"],
          contradictions: [],
          uncertainties: [],
        },
        salience_scorer: {
          salienceLevel: "medium",
          reasons: ["new calculator result"],
          voiceCandidate: false,
          calloutDraft: null,
          recommendedNext: "record_interpretation",
        },
        decision_selector: {
          selectedDecision: "record_interpretation",
          recommendedNextTool: "calculator.record_result",
          confidence: "high",
          reasons: ["calculator row is grounded"],
          missingEvidence: [],
        },
      };
      const json = jsonByRole[input.role] ?? {};
      return {
        ok: true,
        text: JSON.stringify(json),
        json,
        model: "test-micro-llm",
        latencyMs: 5,
      };
    };

    const result = await buildStagePlayProcessedMailPacketWithPromptedReasoners({
      jobId: "stage_play_live_source_job:test",
      sourceId: "calculator_source:test",
      now: "2026-06-04T12:00:00.000Z",
      mailItems: [{
        mailId: "mail:calculator:1",
        sourceId: "calculator_source:test",
        sourceKind: "manual_feed",
        summary: {
          text: "Calculator row updated: kinetic_energy=42 J.",
          preview: "Calculator row updated: kinetic_energy=42 J.",
        },
        sourceRefs: {
          sourceId: "calculator_source:test",
          evidenceRef: "calculator_evidence:test",
        },
        evidenceRefs: ["calculator_evidence:test"],
      } as any],
      immersionState: {
        immersionStateId: "stage_play_immersion_state:test",
        policyId: null,
        profileId: null,
        sourceIds: ["calculator_source:test"],
        latestMailIds: ["mail:calculator:1"],
        latestEvidenceRefs: ["calculator_evidence:test"],
        sourceIdentity: { label: "Calculator", confidence: 0.8, stable: true },
        stableFacts: [],
        currentSceneFacts: ["Calculator row updated: kinetic_energy=42 J."],
        changedFacts: ["calculator row changed"],
        uncertainties: [],
        currentActivity: "calculation",
        salience: {
          level: "medium",
          reasons: ["calculator row changed"],
          voiceCandidate: false,
          calloutDraft: null,
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
        newSignals: ["calculator row changed"],
        salienceHint: "medium",
        recommendedNext: "record_interpretation",
        evidenceRefs: ["stage_play_prediction_validation:test"],
        createdAt: "2026-06-04T12:00:00.000Z",
      } as any,
      promptedMicroReasoners: {
        enabled: true,
        executor,
      },
    });

    expect(calls).toEqual([
      { role: "claim_extractor", title: "Calculator Stream Claim Extractor" },
      { role: "observation_classifier", title: "Observation Classifier" },
      { role: "salience_scorer", title: "Salience / Voice Candidate Scorer" },
      { role: "decision_selector", title: "Calculator Tool-Call Decision Selector" },
    ]);
    expect(result.packet.recommendedNext).toBe("record_interpretation");
    expect(result.packet.answer_authority).toBe(false);
    expect(result.packet.microReasonerDeck).toMatchObject({
      presetId: "stage_play_micro_reasoner_prompt_preset:calculator-tool-call:v1",
      presetTitle: "Calculator Tool-Call Monitor",
      domain: "calculator_stream",
      outputPolicy: "tool_call_candidate",
      promptedRoles: ["claim_extractor", "observation_classifier", "salience_scorer", "decision_selector"],
      sourceId: "calculator_source:test",
      deckRunPlan: "baseline_plus_prompted",
      presetUpdatedAt: "2026-06-04T12:00:00.000Z",
    });
    expect(result.microReasonerRuns.find((run) => run.role === "decision_selector")).toMatchObject({
      promptId: "stage_play_micro_reasoner_prompt:calculator-tool-call:decision_selector:v1",
      deckPresetId: "stage_play_micro_reasoner_prompt_preset:calculator-tool-call:v1",
      deckPresetTitle: "Calculator Tool-Call Monitor",
      deckRunPlan: "baseline_plus_prompted",
      recommendedNextTool: "calculator.record_result",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "micro_reasoner_evidence",
    });
  });

  it("applies the Minecraft Minimal Operator deck as a single prompted arbiter", async () => {
    applyStagePlayMicroReasonerPromptPreset({
      presetId: "stage_play_micro_reasoner_prompt_preset:minecraft_minimal_operator:v1",
      sourceIds: ["visual_source:minecraft"],
      now: "2026-06-04T12:00:00.000Z",
    });
    const activePreset = getActiveStagePlayMicroReasonerPromptPresetForSource({ sourceId: "visual_source:minecraft" });
    const arbiterPrompt = getActiveStagePlayMicroReasonerPromptForRole("hypothesis_arbiter", {
      sourceId: "visual_source:minecraft",
    });
    const calls: Array<{ role: string; title: string }> = [];
    const executor: StagePlayPromptedMicroReasonerExecutor = async (input) => {
      calls.push({ role: input.role, title: input.promptTitle });
      const json = {
        recommendedNext: "request_voice_callout",
        wakeAsk: true,
        reason: "Low health and hostile cue are urgent enough for a callout candidate.",
        confidence: "high",
        currentEffort: "combat_or_recovery",
        axioms: ["health is low", "hostile mob cue is visible"],
        selectedHypothesis: "recover_or_create_distance",
        voiceCandidate: true,
        calloutDraft: "Low health with hostile cue; recover or create distance.",
        missingEvidence: [],
      };
      return {
        ok: true,
        text: JSON.stringify(json),
        json,
        model: "test-minimal-operator",
        latencyMs: 4,
      };
    };

    const result = await buildStagePlayProcessedMailPacketWithPromptedReasoners({
      jobId: "stage_play_live_source_job:minecraft",
      sourceId: "visual_source:minecraft",
      now: "2026-06-04T12:00:00.000Z",
      mailItems: [{
        mailId: "mail:minecraft:1",
        sourceId: "visual_source:minecraft",
        sourceKind: "visual_frame",
        summary: {
          text: "Minecraft cave scene: low health, hostile mob visible.",
          preview: "Minecraft cave scene: low health, hostile mob visible.",
        },
        sourceRefs: {
          sourceId: "visual_source:minecraft",
          evidenceRef: "minecraft_evidence:test",
          frameRef: "minecraft_frame:test",
          observationRef: "minecraft_observation:test",
        },
        evidenceRefs: ["minecraft_evidence:test", "minecraft_frame:test"],
      } as any],
      immersionState: {
        immersionStateId: "stage_play_immersion_state:minecraft",
        policyId: null,
        profileId: null,
        sourceIds: ["visual_source:minecraft"],
        latestMailIds: ["mail:minecraft:1"],
        latestEvidenceRefs: ["minecraft_evidence:test"],
        sourceIdentity: { label: "Minecraft", confidence: 0.8, stable: true },
        stableFacts: [],
        currentSceneFacts: ["Minecraft cave scene: low health, hostile mob visible."],
        changedFacts: ["hostile mob cue is visible"],
        uncertainties: [],
        currentActivity: "combat_or_recovery",
        salience: {
          level: "urgent",
          reasons: ["hostile mob cue", "low health cue"],
          voiceCandidate: true,
          calloutDraft: "Low health with hostile cue.",
        },
        prediction: null,
        lastValidation: null,
        evidenceRefs: ["stage_play_immersion_state:minecraft"],
        createdAt: "2026-06-04T12:00:00.000Z",
        assistant_answer: false,
        terminal_eligible: false,
        context_role: "tool_evidence",
      } as any,
      predictionValidation: {
        validationId: "stage_play_prediction_validation:minecraft",
        priorPredictionId: null,
        result: "no_prior_prediction",
        supportedSignals: [],
        contradictedSignals: [],
        newSignals: ["hostile mob cue is visible"],
        salienceHint: "urgent",
        recommendedNext: "request_voice_callout",
        evidenceRefs: ["stage_play_prediction_validation:minecraft"],
        createdAt: "2026-06-04T12:00:00.000Z",
      } as any,
      promptedMicroReasoners: {
        enabled: true,
        executor,
      },
    });

    expect(activePreset).toMatchObject({
      presetId: "stage_play_micro_reasoner_prompt_preset:minecraft_minimal_operator:v1",
      title: "Minecraft Minimal Operator",
      promptedRoles: ["hypothesis_arbiter"],
      outputPolicy: "voice_candidate",
      deckRunPlan: "minimal_prompted_arbiter",
    });
    expect(arbiterPrompt).toMatchObject({
      promptId: "stage_play_micro_reasoner_prompt:minecraft_minimal_operator_arbiter:v1",
      title: "Minecraft Minimal Operator Arbiter",
    });
    expect(calls).toEqual([
      { role: "hypothesis_arbiter", title: "Minecraft Minimal Operator Arbiter" },
    ]);
    expect(result.packet.microReasonerRunRefs).toEqual([
      expect.stringContaining("stage_play_micro_reasoner_run:"),
    ]);
    expect(result.microReasonerRuns.filter((run) => run.status === "completed").map((run) => run.role)).toEqual([
      "hypothesis_arbiter",
    ]);
    expect(result.microReasonerRuns.filter((run) => run.status === "skipped").map((run) => run.role).sort()).toEqual([
      "axiom_extractor",
      "claim_extractor",
      "decision_selector",
      "delta_extractor",
      "effort_estimator",
      "hypothesis_generator",
      "observation_classifier",
      "packet_composer",
      "prediction_validator",
      "salience_scorer",
      "voice_callout_drafter",
    ]);
    expect(result.packet).toMatchObject({
      answer_authority: false,
      recommendedNext: "request_voice_callout",
      effortEstimate: {
        currentEffort: "combat_or_recovery",
      },
      axioms: {
        axioms: ["health is low", "hostile mob cue is visible"],
      },
      microReasonerDeck: {
        presetId: "stage_play_micro_reasoner_prompt_preset:minecraft_minimal_operator:v1",
        presetTitle: "Minecraft Minimal Operator",
        domain: "minecraft_gameplay",
        outputPolicy: "voice_candidate",
        promptedRoles: ["hypothesis_arbiter"],
        deckRunPlan: "minimal_prompted_arbiter",
      },
    });
    expect(result.microReasonerRuns.find((run) => run.role === "hypothesis_arbiter")).toMatchObject({
      promptId: "stage_play_micro_reasoner_prompt:minecraft_minimal_operator_arbiter:v1",
      deckPresetId: "stage_play_micro_reasoner_prompt_preset:minecraft_minimal_operator:v1",
      deckPresetTitle: "Minecraft Minimal Operator",
      deckRunPlan: "minimal_prompted_arbiter",
      selectedDecision: "request_voice_callout",
      voiceCandidate: true,
      context_role: "micro_reasoner_evidence",
    });

    const deckVerdict = {
      recommendedNext: result.packet.arbiter?.recommendedNext ?? result.packet.recommendedNext,
      wakeAsk: result.packet.arbiter?.wakeAsk ?? true,
      voiceCandidate: result.packet.arbiter?.voiceCandidate ?? result.packet.salience.voiceCandidate,
      reason: result.packet.arbiter?.reason ?? "Minimal Operator selected a voice candidate.",
    };
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId: "helix-ask:desktop",
      jobId: "stage_play_live_source_job:minecraft",
      mailIds: result.packet.mailIds,
      sourceIds: [result.packet.sourceId],
      reason: "unread_mail",
      evidenceRefs: result.packet.evidenceRefs,
      deckPresetId: result.packet.microReasonerDeck?.presetId,
      deckPresetTitle: result.packet.microReasonerDeck?.presetTitle,
      deckRunPlan: result.packet.microReasonerDeck?.deckRunPlan,
      packetIds: [result.packet.packetId],
      deckVerdict,
      now: "2026-06-04T12:00:01.000Z",
    });

    expect(wake).toMatchObject({
      deckPresetId: "stage_play_micro_reasoner_prompt_preset:minecraft_minimal_operator:v1",
      deckPresetTitle: "Minecraft Minimal Operator",
      deckRunPlan: "minimal_prompted_arbiter",
      packetIds: [result.packet.packetId],
      deckVerdict: {
        recommendedNext: "request_voice_callout",
        wakeAsk: true,
        voiceCandidate: true,
        reason: "Low health and hostile cue are urgent enough for a callout candidate.",
      },
      lifecycleReason: "Minecraft Minimal Operator selected request_voice_callout: Low health and hostile cue are urgent enough for a callout candidate.",
    });

    const wakeResult = recordStagePlayMailWakeResult({
      wakeRequestId: wake?.wakeRequestId ?? "missing",
      threadId: "helix-ask:desktop",
      status: "completed",
      askTurnId: null,
      decisionIds: ["stage_play_live_source_mail_decision:test"],
      evidenceRefs: [
        result.packet.packetId,
        "stage_play_live_source_mail_decision:test",
      ],
      skippedReason: "test_completed",
      createdAt: "2026-06-04T12:00:02.000Z",
    });

    expect(wakeResult).toMatchObject({
      deckPresetId: "stage_play_micro_reasoner_prompt_preset:minecraft_minimal_operator:v1",
      deckPresetTitle: "Minecraft Minimal Operator",
      deckRunPlan: "minimal_prompted_arbiter",
      packetIds: [result.packet.packetId],
      deckVerdict,
      stagePlayWakeTransaction: {
        deckPresetId: "stage_play_micro_reasoner_prompt_preset:minecraft_minimal_operator:v1",
        deckPresetTitle: "Minecraft Minimal Operator",
        deckRunPlan: "minimal_prompted_arbiter",
        packetIds: [result.packet.packetId],
        deckVerdict,
        artifactRefs: {
          processedPacketIds: [result.packet.packetId],
        },
      },
    });
  });

  it("coalesces pending same-source same-deck wake verdicts before Ask launch", () => {
    const firstWake = queueStagePlayLiveSourceMailWakeRequest({
      threadId: "helix-ask:desktop",
      jobId: "stage_play_live_source_job:minecraft",
      mailIds: ["stage_play_live_source_mail:first-minimal"],
      sourceIds: ["visual_source:minecraft"],
      reason: "unread_mail",
      deckPresetId: "stage_play_micro_reasoner_prompt_preset:minecraft_minimal_operator:v1",
      deckPresetTitle: "Minecraft Minimal Operator",
      deckRunPlan: "minimal_prompted_arbiter",
      packetIds: ["stage_play_processed_mail_packet:first-minimal"],
      deckVerdict: {
        recommendedNext: "request_voice_callout",
        wakeAsk: true,
        voiceCandidate: true,
        reason: "First urgent packet.",
      },
      evidenceRefs: ["stage_play_processed_mail_packet:first-minimal"],
      now: "2026-06-04T12:01:00.000Z",
    });
    const secondWake = queueStagePlayLiveSourceMailWakeRequest({
      threadId: "helix-ask:desktop",
      jobId: "stage_play_live_source_job:minecraft",
      mailIds: ["stage_play_live_source_mail:second-minimal"],
      sourceIds: ["visual_source:minecraft"],
      reason: "unread_mail",
      deckPresetId: "stage_play_micro_reasoner_prompt_preset:minecraft_minimal_operator:v1",
      deckPresetTitle: "Minecraft Minimal Operator",
      deckRunPlan: "minimal_prompted_arbiter",
      packetIds: ["stage_play_processed_mail_packet:second-minimal"],
      deckVerdict: {
        recommendedNext: "request_voice_callout",
        wakeAsk: true,
        voiceCandidate: true,
        reason: "Second urgent packet supersedes the pending first packet.",
      },
      evidenceRefs: ["stage_play_processed_mail_packet:second-minimal"],
      now: "2026-06-04T12:01:01.000Z",
    });

    expect(secondWake?.wakeRequestId).not.toBe(firstWake?.wakeRequestId);
    expect(secondWake).toMatchObject({
      status: "queued",
      supersededWakeIds: [firstWake?.wakeRequestId],
      packetIds: [
        "stage_play_processed_mail_packet:second-minimal",
        "stage_play_processed_mail_packet:first-minimal",
      ],
    });
    expect(secondWake?.evidenceRefs).toEqual(expect.arrayContaining([
      firstWake?.wakeRequestId,
      "stage_play_live_source_mail:first-minimal",
      "stage_play_processed_mail_packet:first-minimal",
      "stage_play_processed_mail_packet:second-minimal",
    ]));
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId: "helix-ask:desktop", status: "queued" }).map((wake) => wake.wakeRequestId)).toEqual([
      secondWake?.wakeRequestId,
    ]);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId: "helix-ask:desktop", status: "expired_superseded" })[0]).toMatchObject({
      wakeRequestId: firstWake?.wakeRequestId,
      supersededByWakeRequestId: secondWake?.wakeRequestId,
      failureReason: "superseded_by_newer_deck_verdict",
    });
    expect(listStagePlayLiveSourceMailWakeResults({ threadId: "helix-ask:desktop" })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        wakeRequestId: firstWake?.wakeRequestId,
        status: "expired_superseded",
        failedReason: "superseded_by_newer_deck_verdict",
      }),
    ]));
  });
});
