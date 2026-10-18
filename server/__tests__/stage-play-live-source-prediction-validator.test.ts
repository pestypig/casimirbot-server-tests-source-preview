import { describe, expect, it } from "vitest";
import {
  STAGE_PLAY_LIVE_SOURCE_MAIL_ITEM_SCHEMA,
  STAGE_PLAY_LIVE_SOURCE_PREDICTION_VALIDATION_SCHEMA,
  type StagePlayLiveSourceImmersionStateV1,
  type StagePlayLiveSourceMailItemV1,
  type StagePlayLiveSourcePredictionValidationV1,
} from "@shared/contracts/stage-play-live-source-mail.v1";
import { extractStagePlayLiveSourceDelta } from "../services/stage-play/stage-play-live-source-delta-extractor";
import { validateStagePlayLiveSourcePredictionFromMail } from "../services/stage-play/stage-play-live-source-prediction-validator";

const mail = (id: string, summary: string): StagePlayLiveSourceMailItemV1 => ({
  artifactId: "stage_play_live_source_mail_item",
  schemaVersion: STAGE_PLAY_LIVE_SOURCE_MAIL_ITEM_SCHEMA,
  mailId: `stage_play_live_source_mail:${id}`,
  threadId: "helix-ask:desktop",
  roomId: null,
  environmentId: null,
  sourceId: "visual_source:test",
  sourceKind: "visual_frame",
  sourceRefs: {
    sourceId: "visual_source:test",
    frameRef: `visual_frame:${id}`,
    evidenceRef: `visual_evidence:${id}`,
    observationRef: null,
  },
  summary: {
    text: summary,
    preview: summary,
    confidence: 0.86,
    analysisState: "analysis_ready",
  },
  priorContext: {
    previousMailId: null,
    previousEvidenceRef: null,
    previousSummaryPreview: null,
  },
  hints: {
    deterministicChangeHint: "summary_changed",
    elapsedMsSincePrevious: 10_000,
    sourceFreshness: "fresh",
  },
  status: "unread",
  evidenceRefs: [`visual_evidence:${id}`],
  createdAt: "2026-06-08T23:30:00.000Z",
  updatedAt: "2026-06-08T23:30:00.000Z",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  context_role: "tool_evidence",
  raw_content_included: false,
});

const immersionWithPrediction = (
  prediction: NonNullable<StagePlayLiveSourceImmersionStateV1["prediction"]>,
): StagePlayLiveSourceImmersionStateV1 => ({
  artifactId: "stage_play_live_source_immersion_state",
  schemaVersion: "stage_play_live_source_immersion_state/v1",
  immersionStateId: "stage_play_live_source_immersion_state:prior",
  jobId: "stage_play_live_source_job:test",
  policyId: null,
  profileId: null,
  threadId: "helix-ask:desktop",
  roomId: null,
  environmentId: null,
  sourceIds: ["visual_source:test"],
  latestMailIds: ["stage_play_live_source_mail:prior"],
  latestEvidenceRefs: ["visual_evidence:prior"],
  sourceIdentity: {
    label: "Minecraft visual source",
    confidence: 0.88,
    stable: true,
  },
  stableFacts: ["Minecraft-like visual domain"],
  currentSceneFacts: ["inventory or storage interface cues are visible"],
  changedFacts: [],
  uncertainties: ["audio context unavailable"],
  currentActivity: "inventory_management",
  salience: {
    level: "low",
    reasons: [],
    voiceCandidate: false,
  },
  prediction,
  staleness: {
    state: "current",
    staleAfterMailId: null,
    supersededByStateId: null,
  },
  evidenceRefs: ["stage_play_live_source_immersion_state:prior"],
  createdAt: "2026-06-08T23:29:00.000Z",
  assistant_answer: false,
  terminal_eligible: false,
  context_role: "tool_evidence",
  raw_content_included: false,
});

describe("validateStagePlayLiveSourcePredictionFromMail", () => {
  it("creates an evidence-only no-prior-prediction receipt", () => {
    const items = [mail("1", "Minecraft frame shows a chest and crafting table inside a base.")];
    const delta = extractStagePlayLiveSourceDelta({ latestMailItems: items });
    const validation = validateStagePlayLiveSourcePredictionFromMail({
      jobId: "stage_play_live_source_job:test",
      latestMailItems: items,
      delta,
      createdAt: "2026-06-08T23:30:01.000Z",
    });

    expect(validation).toMatchObject<Partial<StagePlayLiveSourcePredictionValidationV1>>({
      artifactId: "stage_play_live_source_prediction_validation",
      schemaVersion: STAGE_PLAY_LIVE_SOURCE_PREDICTION_VALIDATION_SCHEMA,
      priorPredictionId: null,
      result: "no_prior_prediction",
      recommendedNext: "record_interpretation",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
    });
    expect(validation.evidenceRefs).toEqual(expect.arrayContaining([
      validation.validationId,
      "stage_play_live_source_mail:1",
      "visual_evidence:1",
    ]));
  });

  it("marks a prior prediction supported when newer mail matches validation signals", () => {
    const prior = immersionWithPrediction({
      predictionId: "stage_play_live_source_prediction:fire-watch",
      text: "The next scene may clarify whether fire damage continues.",
      horizonMs: 10_000,
      watchTargets: ["fire damage", "health/fire cues"],
      validationSignals: ["fire", "damage"],
      confidence: 0.62,
    });
    const items = [mail("2", "The player is visibly on fire and appears to be taking damage while holding a sword.")];
    const delta = extractStagePlayLiveSourceDelta({
      latestMailItems: items,
      priorImmersionState: prior,
    });
    const validation = validateStagePlayLiveSourcePredictionFromMail({
      jobId: prior.jobId,
      priorImmersionState: prior,
      latestMailItems: items,
      delta,
      createdAt: "2026-06-08T23:30:10.000Z",
    });

    expect(validation.priorPredictionId).toBe("stage_play_live_source_prediction:fire-watch");
    expect(validation.result).toBe("supported");
    expect(validation.supportedSignals).toEqual(expect.arrayContaining([
      "validation_signal:fire",
      "validation_signal:damage",
      "activity:combat_or_damage",
    ]));
    expect(validation.contradictedSignals).toEqual([]);
    expect(validation.salienceHint).toBe("urgent");
    expect(validation.recommendedNext).toBe("request_voice_callout");
  });

  it("marks a prior prediction contradicted when newer mail enters a different activity window", () => {
    const prior = immersionWithPrediction({
      predictionId: "stage_play_live_source_prediction:inventory-watch",
      text: "The next scene will likely continue inventory management inside the base.",
      horizonMs: 10_000,
      watchTargets: ["inventory", "chest contents"],
      validationSignals: ["inventory", "chest"],
      confidence: 0.7,
    });
    const items = [mail("3", "The Minecraft player is outdoors in a forest with grass, trees, and daylight sky.")];
    const delta = extractStagePlayLiveSourceDelta({
      latestMailItems: items,
      priorImmersionState: prior,
    });
    const validation = validateStagePlayLiveSourcePredictionFromMail({
      jobId: prior.jobId,
      priorImmersionState: prior,
      latestMailItems: items,
      delta,
      createdAt: "2026-06-08T23:30:20.000Z",
    });

    expect(validation.result).toBe("contradicted");
    expect(validation.supportedSignals).toEqual([]);
    expect(validation.contradictedSignals).toEqual(expect.arrayContaining([
      "observed_activity:outdoor_exploration",
    ]));
    expect(validation.recommendedNext).toBe("record_interpretation");
    expect(validation.newSignals).toEqual(expect.arrayContaining([
      "activity:outdoor_exploration",
    ]));
  });
});
