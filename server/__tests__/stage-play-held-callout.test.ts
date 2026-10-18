import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordStagePlayMailDecision, resetStagePlayLiveSourceMailboxForTest } from "../services/stage-play/stage-play-live-source-mailbox-store";
import {
  getStagePlayHeldCallout,
  listStagePlayHeldCalloutRechecks,
  recordStagePlayHeldCallout,
  resetStagePlayHeldCalloutStoreForTest,
} from "../services/stage-play/stage-play-held-callout-store";
import {
  maybeRunStagePlayLiveSourceVoiceDelivery,
  type StagePlayLiveSourceVoiceDeliveryRunner,
} from "../services/stage-play/stage-play-live-source-mail-voice-bridge";
import type { StagePlayLiveSourceMailDecisionV1 } from "@shared/contracts/stage-play-live-source-mail.v1";

const threadId = "thread:held-callout";
const roomId = "room:held-callout";
const jobId = "stage_play_live_source_job:held-callout";

beforeEach(() => {
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayHeldCalloutStoreForTest();
});

const makeVoiceDecision = (text = "Night is approaching near the mining area."): StagePlayLiveSourceMailDecisionV1 =>
  recordStagePlayMailDecision({
    threadId,
    roomId,
    mailIds: ["stage_play_live_source_mail_item:night-warning"],
    activeJobId: jobId,
    decision: "request_voice_callout",
    rationalePreview: "The live source shows a salient warning that should be spoken if policy allows.",
    voiceCalloutDraft: text,
    voiceEligible: true,
    voiceRequiresConfirmation: false,
    voicePolicy: {
      voiceEnabled: true,
      requiresConfirmation: false,
      allowedNow: true,
      reason: null,
    },
    requestedTool: {
      toolName: "situation-room-pipelines.voice_delivery.confirm_speak",
      args: { text },
    },
    evidenceRefs: ["visual_evidence:night-warning"],
    modelReviewed: true,
    createdAt: "2026-06-07T14:00:00.000Z",
  });

describe("stage play held callouts", () => {
  it("holds a voice callout while the user is speaking and does not call the runner", async () => {
    const decision = makeVoiceDecision();
    const runner = vi.fn<StagePlayLiveSourceVoiceDeliveryRunner>();

    const receipt = await maybeRunStagePlayLiveSourceVoiceDelivery({
      decision,
      runner,
      userSpeaking: true,
      now: "2026-06-07T14:00:01.000Z",
    });

    expect(runner).not.toHaveBeenCalled();
    expect(receipt).toMatchObject({
      status: "held_user_speaking",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(receipt?.delivery?.artifactRef).toMatch(/^stage_play_held_callout:/);
    const held = getStagePlayHeldCallout(receipt?.delivery?.artifactRef ?? "");
    expect(held).toMatchObject({
      status: "held_user_speaking",
      jobId,
      decisionId: decision.decisionId,
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("holds a voice callout while manual prompt input is active", async () => {
    const decision = makeVoiceDecision("A high-priority visual change is ready to announce.");
    const runner = vi.fn<StagePlayLiveSourceVoiceDeliveryRunner>();

    const receipt = await maybeRunStagePlayLiveSourceVoiceDelivery({
      decision,
      runner,
      manualPromptActive: true,
      now: "2026-06-07T14:00:02.000Z",
    });

    expect(runner).not.toHaveBeenCalled();
    expect(receipt?.status).toBe("held_manual_prompt_active");
    const held = getStagePlayHeldCallout(receipt?.delivery?.artifactRef ?? "");
    expect(held?.status).toBe("held_manual_prompt_active");
  });

  it("merges a related held warning into the next answer instead of speaking it separately", async () => {
    const decision = makeVoiceDecision();
    const held = recordStagePlayHeldCallout({
      threadId,
      roomId,
      jobId,
      decisionId: decision.decisionId,
      mailIds: decision.mailIds,
      text: decision.voiceCalloutDraft?.text ?? "",
      status: "held_user_speaking",
      evidenceRefs: decision.evidenceRefs,
      now: "2026-06-07T14:00:03.000Z",
    });
    const runner = vi.fn<StagePlayLiveSourceVoiceDeliveryRunner>();

    const receipt = await maybeRunStagePlayLiveSourceVoiceDelivery({
      decision,
      runner,
      heldCalloutId: held.calloutId,
      userPromptText: "Should I go back or keep mining now that night is approaching?",
      userPromptRef: "user_prompt:strategy",
      answerRef: "assistant_answer:strategy",
      now: "2026-06-07T14:00:04.000Z",
    });

    expect(runner).not.toHaveBeenCalled();
    expect(receipt?.status).toBe("merged_into_answer");
    expect(getStagePlayHeldCallout(held.calloutId)).toMatchObject({
      status: "merged_into_answer",
      mergedAnswerRef: "assistant_answer:strategy",
    });
    expect(listStagePlayHeldCalloutRechecks({ calloutId: held.calloutId })[0]).toMatchObject({
      result: "merge_into_answer",
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("drops stale held callouts when new live-source mail supersedes them", async () => {
    const decision = makeVoiceDecision();
    const held = recordStagePlayHeldCallout({
      threadId,
      roomId,
      jobId,
      decisionId: decision.decisionId,
      mailIds: decision.mailIds,
      text: decision.voiceCalloutDraft?.text ?? "",
      status: "held_user_speaking",
      evidenceRefs: decision.evidenceRefs,
      now: "2026-06-07T14:00:05.000Z",
    });
    const runner = vi.fn<StagePlayLiveSourceVoiceDeliveryRunner>();

    const receipt = await maybeRunStagePlayLiveSourceVoiceDelivery({
      decision,
      runner,
      heldCalloutId: held.calloutId,
      newMailIds: ["stage_play_live_source_mail_item:newer-scene"],
      now: "2026-06-07T14:00:06.000Z",
    });

    expect(runner).not.toHaveBeenCalled();
    expect(receipt?.status).toBe("stale_after_new_mail");
    expect(getStagePlayHeldCallout(held.calloutId)).toMatchObject({
      status: "stale_after_new_mail",
      staleAfterMailId: "stage_play_live_source_mail_item:newer-scene",
    });
  });

  it("delivers a held callout that remains relevant after recheck", async () => {
    const decision = makeVoiceDecision("A critical danger warning remains active near the player.");
    const held = recordStagePlayHeldCallout({
      threadId,
      roomId,
      jobId,
      decisionId: decision.decisionId,
      mailIds: decision.mailIds,
      text: decision.voiceCalloutDraft?.text ?? "",
      status: "held_user_speaking",
      evidenceRefs: decision.evidenceRefs,
      now: "2026-06-07T14:00:07.000Z",
    });
    const runner = vi.fn<StagePlayLiveSourceVoiceDeliveryRunner>().mockResolvedValue({
      ok: true,
      status: "delivered",
      provider: "test_voice",
      artifactRef: "voice_receipt:delivered",
    });

    const receipt = await maybeRunStagePlayLiveSourceVoiceDelivery({
      decision,
      runner,
      heldCalloutId: held.calloutId,
      now: "2026-06-07T14:00:08.000Z",
    });

    expect(runner).toHaveBeenCalledTimes(1);
    expect(receipt?.status).toBe("delivered");
    expect(getStagePlayHeldCallout(held.calloutId)?.status).toBe("delivered");
    expect(listStagePlayHeldCalloutRechecks({ calloutId: held.calloutId })[0]?.result).toBe("still_relevant");
  });
});
