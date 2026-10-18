import { describe, expect, it } from "vitest";

import { __testHelixAskReliabilityGuards } from "../routes/agi.plan";
import { applyHelixAskSuccessSurface } from "../services/helix-ask/surface/ask-answer-surface";

describe("helix ask p0 slot hard/soft split", () => {
  const {
    buildHelixAskTurnObjectiveSlots,
    buildHelixAskTurnObjectiveQueryHints,
  } = __testHelixAskReliabilityGuards;

  it("does not force transcription/context-persistence slots for docs plain-language explain prompts", () => {
    const label =
      "Explain this paper from the current docs viewer context in plain language. Document path: /docs/research/nhm2-full-solve-overview-v2-2026-04-23.md";

    const slots = buildHelixAskTurnObjectiveSlots(label, "definition_overview");
    const hints = buildHelixAskTurnObjectiveQueryHints(label, "repo", "definition_overview");

    expect(slots).not.toContain("transcription-translation");
    expect(slots).not.toContain("context-persistence");
    expect(hints).not.toContain("transcription translation routing");
    expect(hints).not.toContain("context persistence storage profile history");
  });

  it("keeps transcription/context-persistence slots when intent is explicit", () => {
    const transcriptionLabel =
      "Explain this paper in plain language and detail transcription translation routing for the docs viewer.";
    const contextLabel =
      "Explain this paper in plain language and detail context persistence storage profile history for the docs viewer.";

    const transcriptionSlots = buildHelixAskTurnObjectiveSlots(
      transcriptionLabel,
      "definition_overview",
    );
    const transcriptionHints = buildHelixAskTurnObjectiveQueryHints(
      transcriptionLabel,
      "repo",
      "definition_overview",
    );
    const contextSlots = buildHelixAskTurnObjectiveSlots(
      contextLabel,
      "definition_overview",
    );
    const contextHints = buildHelixAskTurnObjectiveQueryHints(
      contextLabel,
      "repo",
      "definition_overview",
    );

    expect(transcriptionSlots).toContain("transcription-translation");
    expect(transcriptionHints).toContain("transcription translation routing");
    expect(contextSlots).toContain("context-persistence");
    expect(contextHints).toContain("context persistence storage profile history");
  });
});

describe("helix ask p0 non-empty final answer invariant", () => {
  it("fills empty successful payloads with a non-empty grounded fallback", () => {
    const payload: Record<string, unknown> = {
      ok: true,
      debug: {
        intent_domain: "repo",
      },
    };

    const surfaced = applyHelixAskSuccessSurface({
      payload,
      requestMetadata: {},
      requestData: {
        question:
          "Explain this paper from the current docs viewer context in plain language.",
      },
      includeMultilangMetadata: false,
      dispatchState: null,
      multilangRollout: {
        stage: "off",
        active: false,
        shadow: false,
        canaryHit: false,
        activePercent: 0,
        promotionFrozen: false,
      },
      threadId: "thread-test",
      turnId: "turn-test",
      outputContractVersion: "v1",
      interpreterSchemaVersion: "v1",
      buildMemoryCitation: () => null,
      extractResponseEvidenceRefs: () => [],
      extractMemoryCitationRolloutIds: () => [],
      clampNumber: (value: number) => value,
      normalizeLanguageTag: () => null,
      isEnglishLikeLanguage: () => true,
      canonicalTermPreservationRatio: () => 1,
      metrics: {
        recordHelixAskMultilangTranslation: () => undefined,
        recordHelixAskMultilangLanguageMatch: () => undefined,
        recordHelixAskMultilangFallback: () => undefined,
        recordHelixAskMultilangCanonicalTerm: () => undefined,
        observeHelixAskMultilangAddedLatency: () => undefined,
      },
      multilangRuntimeState: {
        stage: "off",
        killSwitch: false,
        consecutive15mBreaches: 0,
        freezePromotionUntilMs: null,
        lastRollbackReason: null,
      },
      multilangPromotionSlo: 0,
      multilangRollback15mSlo: 0,
      multilangRollback24hSlo: 0,
      recordMultilangObservation: () => undefined,
    });

    expect(String(surfaced.text ?? "").trim().length).toBeGreaterThan(0);
    expect(String(surfaced.answer ?? "").trim().length).toBeGreaterThan(0);
    expect(String(surfaced.text)).toContain("could not assemble a complete grounded answer");
  });
});

