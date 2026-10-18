import { beforeEach, describe, expect, it } from "vitest";
import type {
  StagePlayMicroReasonerRunV1,
  StagePlayProcessedMailPacketV1,
} from "@shared/contracts/stage-play-live-source-mail.v1";
import {
  getStagePlayMicroReasonerRun,
  getStagePlayProcessedMailPacket,
  recordStagePlayMicroReasonerRun,
  recordStagePlayProcessedMailPacket,
  resetStagePlayProcessedMailPacketStoreForTest,
} from "../services/stage-play/stage-play-processed-mail-packet-store";

const runFixture = (
  overrides: Partial<StagePlayMicroReasonerRunV1> = {},
): StagePlayMicroReasonerRunV1 => ({
  artifactId: "stage_play_micro_reasoner_run",
  schemaVersion: "stage_play_micro_reasoner_run/v1",
  runId: "stage_play_micro_reasoner_run:frog-claims",
  promptId: "stage_play_micro_reasoner_prompt:claim_extractor:v1",
  deckPresetId: "stage_play_micro_reasoner_prompt_preset:frog-classifier:v1",
  deckPresetTitle: "Frog classifier",
  deckRunPlan: "baseline_plus_prompted",
  deckRoleIndex: 1,
  deckRoleCount: 2,
  deckExecutionMode: "independent",
  deckProductRole: false,
  role: "claim_extractor",
  jobId: "stage_play_live_source_job:frog",
  sourceId: "visual_source:screen",
  mailIds: ["stage_play_live_source_mail:visual-1"],
  inputRefs: ["stage_play_live_source_mail:visual-1"],
  outputRefs: ["microdeck_output:frog-claims"],
  inputPreview: "Frog image visible in ImageLens.",
  outputPreview: "Likely frog classification cues are visible.",
  status: "completed",
  reasoningMode: "micro_live_interval",
  selectedDecision: "record_interpretation",
  salienceLevel: "medium",
  voiceCandidate: false,
  confidence: "high",
  missingEvidence: [],
  startedAt: "2026-06-17T14:00:00.000Z",
  completedAt: "2026-06-17T14:00:01.000Z",
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
  context_role: "micro_reasoner_evidence",
  ...overrides,
});

const packetFixture = (
  overrides: Partial<StagePlayProcessedMailPacketV1> = {},
): Omit<StagePlayProcessedMailPacketV1, "answer_authority" | "raw_content_included"> => ({
  artifactId: "stage_play_processed_mail_packet",
  schemaVersion: "stage_play_processed_mail_packet/v1",
  packetId: "stage_play_processed_mail_packet:frog",
  jobId: "stage_play_live_source_job:frog",
  sourceId: "visual_source:screen",
  mailIds: ["stage_play_live_source_mail:visual-1"],
  visualEvidenceRefs: ["visual_evidence:frog"],
  observedFacts: ["Frog image visible in ImageLens."],
  inferredFacts: ["Frog classification cues may be present."],
  uncertainties: ["Species remains unverified."],
  stableFactsUsed: ["ImageLens source is active."],
  changedFacts: ["New visual source mail arrived."],
  sceneTags: ["image_lens"],
  activityTags: ["classification"],
  objectTags: ["frog"],
  matchedCriteria: ["frog_classification_candidate"],
  suppressedCriteria: [],
  riskMatches: [],
  opportunityMatches: ["classification_evidence"],
  voiceCalloutMatches: [],
  salience: {
    level: "medium",
    reasons: ["classification evidence available"],
    voiceCandidate: false,
  },
  recommendedNext: "record_interpretation",
  watchNext: ["frog markings"],
  resolutionState: "processed_packet_ready",
  microReasonerRunRefs: ["stage_play_micro_reasoner_run:frog-claims"],
  evidenceRefs: ["stage_play_processed_mail_packet:frog", "microdeck_output:frog-claims"],
  createdAt: "2026-06-17T14:00:02.000Z",
  assistant_answer: false,
  terminal_eligible: false,
  context_role: "tool_evidence",
  ...overrides,
});

describe("stage play MicroReasoner run store", () => {
  beforeEach(() => {
    resetStagePlayProcessedMailPacketStoreForTest();
  });

  it("records valid evidence-only MicroReasoner runs", () => {
    const run = recordStagePlayMicroReasonerRun(runFixture());

    expect(run.assistant_answer).toBe(false);
    expect(run.terminal_eligible).toBe(false);
    expect(run.raw_content_included).toBe(false);
    expect(run.evidenceRefs).toEqual(expect.arrayContaining([
      run.runId,
      "stage_play_live_source_mail:visual-1",
      "microdeck_output:frog-claims",
    ]));
    expect(run.goalContextUpdateRefs).toEqual([]);
    expect(getStagePlayMicroReasonerRun(run.runId)).toEqual(run);
  });

  it("rejects MicroReasoner runs before they can enter trace memory as answers", () => {
    const invalidRun = {
      ...runFixture(),
      assistant_answer: true,
      terminal_eligible: true,
      raw_content_included: true,
    } as unknown as StagePlayMicroReasonerRunV1;

    expect(() => recordStagePlayMicroReasonerRun(invalidRun)).toThrow(
      /assistant_answer must be false; terminal_eligible must be false; raw_content_included must be false/,
    );
    expect(getStagePlayMicroReasonerRun(invalidRun.runId)).toBeNull();
  });

  it("normalizes processed mail packets as evidence-only packets without raw content authority", () => {
    const packet = recordStagePlayProcessedMailPacket(packetFixture());

    expect(packet.answer_authority).toBe(false);
    expect(packet.assistant_answer).toBe(false);
    expect(packet.terminal_eligible).toBe(false);
    expect(packet.raw_content_included).toBe(false);
    expect(packet.context_role).toBe("tool_evidence");
    expect(packet.evidenceRefs).toEqual(expect.arrayContaining([
      packet.packetId,
      "stage_play_live_source_mail:visual-1",
      "visual_evidence:frog",
      "stage_play_micro_reasoner_run:frog-claims",
      "microdeck_output:frog-claims",
    ]));
    expect(getStagePlayProcessedMailPacket(packet.packetId)).toEqual(packet);
  });

  it("rejects processed mail packets before they can enter trace memory as answers", () => {
    const invalidPacket = {
      ...packetFixture(),
      answer_authority: true,
      assistant_answer: true,
      terminal_eligible: true,
      raw_content_included: true,
    } as unknown as StagePlayProcessedMailPacketV1;

    expect(() => recordStagePlayProcessedMailPacket(invalidPacket)).toThrow(
      /answer_authority must be false/,
    );
    expect(getStagePlayProcessedMailPacket(invalidPacket.packetId)).toBeNull();
  });
});
