import { beforeEach, describe, expect, it } from "vitest";
import {
  applyStagePlayAdaptiveVisualLensProposal,
  evaluateStagePlayAdaptiveVisualLens,
} from "../services/stage-play/stage-play-adaptive-visual-lens-controller";
import {
  getLatestStagePlayAdaptiveVisualLensProposal,
  resetStagePlayAdaptiveVisualLensStoreForTest,
} from "../services/stage-play/stage-play-adaptive-visual-lens-store";
import {
  enqueueStagePlayLiveSourceMailItem,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import {
  resetStagePlayLiveSourceMailWakeStoreForTest,
} from "../services/stage-play/stage-play-live-source-mail-wake-store";
import {
  applyStagePlayVisualObserverProfile,
  ensureDefaultStagePlayVisualObserverProfiles,
  getActiveStagePlayVisualObserverProfileForSource,
  resetStagePlayVisualObserverProfileStoreForTest,
} from "../services/stage-play/stage-play-visual-observer-profile-store";

const threadId = "helix-ask:desktop";
const sourceId = "visual_source:adaptive-test";

const enqueueVisualMail = (summaryText: string, suffix: string) =>
  enqueueStagePlayLiveSourceMailItem({
    threadId,
    sourceId,
    sourceKind: "visual_frame",
    frameRef: `visual_frame:adaptive:${suffix}`,
    evidenceRef: `visual_evidence:adaptive:${suffix}`,
    summaryText,
    confidence: 0.86,
    createdAt: `2026-06-10T12:00:0${suffix}.000Z`,
  });

describe("stage play adaptive visual lens controller", () => {
  beforeEach(() => {
    resetStagePlayAdaptiveVisualLensStoreForTest();
    resetStagePlayLiveSourceMailboxForTest();
    resetStagePlayLiveSourceMailWakeStoreForTest();
    resetStagePlayVisualObserverProfileStoreForTest();
    ensureDefaultStagePlayVisualObserverProfiles();
  });

  it("suggests the Minecraft shade from recent Minecraft visual mail", () => {
    const mail = enqueueVisualMail(
      "Minecraft cave gameplay is visible with hotbar slots, health hearts, blocks, and a zombie near the crosshair.",
      "1",
    );

    const proposal = evaluateStagePlayAdaptiveVisualLens({
      threadId,
      sourceId,
      now: "2026-06-10T12:00:10.000Z",
    });

    expect(proposal).toMatchObject({
      artifactId: "stage_play_adaptive_visual_lens_proposal",
      sourceId,
      recognizedSubject: "Minecraft gameplay",
      driftState: "new_subject",
      decision: "suggest_profile",
      candidateProfileId: "stage_play_visual_observer_profile:minecraft-gameplay:v1",
      applyable: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(proposal.mailIds).toEqual([mail.mailId]);
    expect(proposal.suggestedProfileDraft?.prompt).toContain("neutral visual evidence");
    expect(getLatestStagePlayAdaptiveVisualLensProposal({ threadId, sourceId })?.proposalId).toBe(proposal.proposalId);
  });

  it("keeps the current shade when the recognized subject already matches", () => {
    applyStagePlayVisualObserverProfile({
      profileId: "stage_play_visual_observer_profile:solar-sdo-aia-193:v1",
      sourceIds: [sourceId],
      now: "2026-06-10T12:00:00.000Z",
    });
    enqueueVisualMail(
      "SDO AIA 193 solar imagery shows coronal holes, active regions, and a possible flare cue near the limb.",
      "1",
    );

    const proposal = evaluateStagePlayAdaptiveVisualLens({
      threadId,
      sourceId,
      now: "2026-06-10T12:00:10.000Z",
    });

    expect(proposal).toMatchObject({
      activeProfileId: "stage_play_visual_observer_profile:solar-sdo-aia-193:v1",
      candidateProfileId: "stage_play_visual_observer_profile:solar-sdo-aia-193:v1",
      driftState: "same_subject",
      decision: "keep_current",
      applyable: false,
    });
  });

  it("returns needs_more_evidence when recent visual mail is weak", () => {
    enqueueVisualMail("A blurry image is visible but the subject is unclear.", "1");

    const proposal = evaluateStagePlayAdaptiveVisualLens({
      threadId,
      sourceId,
      now: "2026-06-10T12:00:10.000Z",
    });

    expect(proposal).toMatchObject({
      recognizedSubject: "unknown visual subject",
      driftState: "uncertain",
      decision: "needs_more_evidence",
      blockedReason: "low_subject_confidence",
      applyable: false,
    });
  });

  it("applies a ready proposal through the existing visual observer profile store", () => {
    enqueueVisualMail(
      "Minecraft gameplay shows a hotbar, health hearts, block tooltip, and cave terrain.",
      "1",
    );
    const proposal = evaluateStagePlayAdaptiveVisualLens({
      threadId,
      sourceId,
      now: "2026-06-10T12:00:10.000Z",
    });

    const result = applyStagePlayAdaptiveVisualLensProposal({
      proposalId: proposal.proposalId,
      sourceId,
      now: "2026-06-10T12:00:11.000Z",
    });

    expect(result).toMatchObject({
      artifactId: "stage_play_adaptive_visual_lens_apply_result",
      applied: true,
      reason: "applied_existing_profile",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(result.profile?.profileId).toBe("stage_play_visual_observer_profile:minecraft-gameplay:v1");
    expect(getActiveStagePlayVisualObserverProfileForSource({ sourceId })?.profileId)
      .toBe("stage_play_visual_observer_profile:minecraft-gameplay:v1");
  });

  it("rejects low-confidence and source-mismatched proposal application", () => {
    enqueueVisualMail("A blurry image is visible but the subject is unclear.", "1");
    const proposal = evaluateStagePlayAdaptiveVisualLens({
      threadId,
      sourceId,
      now: "2026-06-10T12:00:10.000Z",
    });

    const lowConfidence = applyStagePlayAdaptiveVisualLensProposal({
      proposalId: proposal.proposalId,
      sourceId,
      now: "2026-06-10T12:00:11.000Z",
    });
    const sourceMismatch = applyStagePlayAdaptiveVisualLensProposal({
      proposalId: proposal.proposalId,
      sourceId: "visual_source:other",
      now: "2026-06-10T12:00:12.000Z",
    });

    expect(lowConfidence).toMatchObject({
      applied: false,
      reason: "low_subject_confidence",
    });
    expect(sourceMismatch).toMatchObject({
      applied: false,
      reason: "source_mismatch",
    });
  });
});
