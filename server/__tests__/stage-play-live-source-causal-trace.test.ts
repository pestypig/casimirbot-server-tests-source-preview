import { beforeEach, describe, expect, it } from "vitest";
import {
  buildStagePlayLiveSourceInterpreterProfileV1,
} from "@shared/contracts/stage-play-live-source-interpreter-profile.v1";
import {
  enqueueStagePlayLiveSourceMailItem,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import {
  listStagePlayLiveSourceMailWakeRequests,
  recordStagePlayMailWakeResult,
  resetStagePlayLiveSourceMailWakeStoreForTest,
} from "../services/stage-play/stage-play-live-source-mail-wake-store";
import {
  readLiveSourceMailForAsk,
  recordLiveSourceMailDecisionForAsk,
} from "../services/stage-play/stage-play-visual-summary-mail-ingest";
import {
  recordStagePlayLiveSourceMailTranscriptEntries,
  resetStagePlayLiveSourceMailTranscriptStoreForTest,
} from "../services/stage-play/stage-play-live-source-mail-transcript-store";
import {
  compareMailToInterpreterProfile,
} from "../services/stage-play/stage-play-live-source-interpreter-profile-comparison";
import {
  recordStagePlayLiveSourceInterpreterProfile,
  resetStagePlayLiveSourceInterpreterProfileStoreForTest,
} from "../services/stage-play/stage-play-live-source-interpreter-profile-store";
import {
  maybeRunStagePlayLiveSourceVoiceDelivery,
} from "../services/stage-play/stage-play-live-source-mail-voice-bridge";

describe("live-source causal trace envelope", () => {
  beforeEach(() => {
    resetStagePlayLiveSourceMailboxForTest();
    resetStagePlayLiveSourceMailWakeStoreForTest();
    resetStagePlayLiveSourceMailTranscriptStoreForTest();
    resetStagePlayLiveSourceInterpreterProfileStoreForTest();
  });

  it("threads one trace through mail, wake, read, comparison, decision, narrative, voice, and transcript rows", async () => {
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId: "thread:trace",
      roomId: "room:trace",
      environmentId: "env:trace",
      sourceId: "visual_source:trace",
      sourceKind: "visual_frame",
      frameRef: "visual_frame:1",
      evidenceRef: "visual_evidence:1",
      summaryText: "Minecraft cave entrance with low light and a hostile mob nearby.",
      createdAt: "2026-06-08T12:00:00.000Z",
    });
    expect(mail.causalTrace?.producedRefs).toContain(mail.mailId);

    const wake = listStagePlayLiveSourceMailWakeRequests({ threadId: "thread:trace", limit: 1 }).at(-1);
    expect(wake?.causalTrace?.traceId).toBe(mail.causalTrace?.traceId);
    expect(wake?.causalTrace?.parentRefs).toContain(mail.mailId);

    const readResult = readLiveSourceMailForAsk({
      threadId: "thread:trace",
      roomId: "room:trace",
      environmentId: "env:trace",
      mailIds: [mail.mailId],
      includeRead: true,
      now: "2026-06-08T12:00:01.000Z",
    });
    expect(readResult.causalTrace?.traceId).toBe(mail.causalTrace?.traceId);
    expect(readResult.causalTrace?.producedRefs).toContain(readResult.readId);

    const profile = recordStagePlayLiveSourceInterpreterProfile(buildStagePlayLiveSourceInterpreterProfileV1({
      profileId: "stage_play_live_source_interpreter_profile:trace",
      title: "Minecraft Survival Coach",
      threadId: "thread:trace",
      roomId: "room:trace",
      environmentId: "env:trace",
      jobId: wake?.jobId ?? null,
      policyId: null,
      sourceKinds: ["visual_frame"],
      domain: "minecraft",
      objectiveText: "Watch for danger.",
      interpretationGuidelines: "Compare observations against Minecraft survival risks.",
      lenses: ["survival"],
      salienceCriteria: ["cave exploration"],
      suppressCriteria: ["routine walking"],
      riskCriteria: ["low light", "hostile mob"],
      opportunityCriteria: ["rare resource"],
      voiceCalloutCriteria: ["hostile mob"],
      evidenceRules: {
        preserveRawObservation: true,
        distinguishObservedVsInferred: true,
        requireEvidenceRefs: true,
        askWhenUncertain: true,
      },
      outputStyle: {
        textAnswerStyle: "brief_explanation",
        voiceStyle: "warning_only",
      },
      status: "active",
      evidenceRefs: ["profile:evidence"],
      createdAt: "2026-06-08T12:00:01.000Z",
      updatedAt: "2026-06-08T12:00:01.000Z",
    }));
    const comparison = compareMailToInterpreterProfile({
      profile,
      mailItems: [mail],
      jobId: wake?.jobId ?? null,
      createdAt: "2026-06-08T12:00:02.000Z",
    });
    expect(comparison.causalTrace?.traceId).toBe(mail.causalTrace?.traceId);
    expect(comparison.causalTrace?.profileId).toBe(profile.profileId);
    expect(comparison.causalTrace?.producedRefs).toContain(comparison.comparisonId);

    const interpretationDecision = recordLiveSourceMailDecisionForAsk({
      threadId: "thread:trace",
      roomId: "room:trace",
      environmentId: "env:trace",
      mailIds: [mail.mailId],
      decision: "record_interpretation",
      rationalePreview: "Low light and a hostile mob make this a risk interpretation.",
      interpretation: {
        currentSceneSummary: "Minecraft cave entrance with low light and a hostile mob nearby.",
        runningStorySummary: "The source has moved into a risky cave-like Minecraft scene.",
        userRelevantMeaning: "The player may need to respond to a nearby hostile mob and low-light cave risk.",
        watchNextTargets: ["hostile mob", "light level", "cave entrance"],
        watchNextReason: "Check whether the player retreats, attacks, or lights the cave.",
      },
      interpreterProfileRef: profile.profileId,
      profileComparisonRefs: [comparison.comparisonId],
      matchedCriteria: comparison.matchedCriteria,
      observedFacts: comparison.observedFacts,
      inferredMeaning: comparison.inferredMeaning,
      evidenceRefs: [comparison.comparisonId],
      now: "2026-06-08T12:00:03.000Z",
    });
    expect(interpretationDecision.causalTrace?.traceId).toBe(mail.causalTrace?.traceId);
    expect(interpretationDecision.narrativeStateRef).toBeTruthy();
    expect(interpretationDecision.causalTrace?.producedRefs).toContain(interpretationDecision.narrativeStateRef);

    const decision = recordLiveSourceMailDecisionForAsk({
      threadId: "thread:trace",
      roomId: "room:trace",
      environmentId: "env:trace",
      mailIds: [mail.mailId],
      decision: "request_voice_callout",
      rationalePreview: "Hostile mob near a low-light cave should be called out.",
      voiceCalloutDraft: "Hostile mob near the cave.",
      voiceEnabled: true,
      voiceAllowedNow: true,
      requestedTool: {
        toolName: "live_env.request_interim_voice_callout",
        args: {
          text: "Hostile mob near the cave.",
        },
      },
      interpreterProfileRef: profile.profileId,
      profileComparisonRefs: [comparison.comparisonId],
      matchedCriteria: comparison.matchedCriteria,
      observedFacts: comparison.observedFacts,
      inferredMeaning: comparison.inferredMeaning,
      evidenceRefs: [comparison.comparisonId, interpretationDecision.narrativeStateRef ?? ""],
      now: "2026-06-08T12:00:04.000Z",
    });
    expect(decision.causalTrace?.traceId).toBe(mail.causalTrace?.traceId);
    expect(decision.causalTrace?.producedRefs).toContain(decision.decisionId);

    const voiceReceipt = await maybeRunStagePlayLiveSourceVoiceDelivery({
      decision,
      now: "2026-06-08T12:00:05.000Z",
    });
    expect(voiceReceipt?.causalTrace?.traceId).toBe(mail.causalTrace?.traceId);
    expect(voiceReceipt?.causalTrace?.parentRefs).toContain(decision.decisionId);

    const wakeResult = recordStagePlayMailWakeResult({
      wakeRequestId: wake?.wakeRequestId ?? "missing",
      threadId: "thread:trace",
      roomId: "room:trace",
      environmentId: "env:trace",
      status: "completed",
      askTurnId: "ask:trace",
      decisionIds: [interpretationDecision.decisionId, decision.decisionId],
      evidenceRefs: [decision.decisionId],
      createdAt: "2026-06-08T12:00:06.000Z",
    });
    expect(wakeResult.causalTrace?.traceId).toBe(mail.causalTrace?.traceId);
    expect(wakeResult.causalTrace?.askTurnId).toBe("ask:trace");

    const transcriptEntries = recordStagePlayLiveSourceMailTranscriptEntries({
      threadId: "thread:trace",
      roomId: "room:trace",
      environmentId: "env:trace",
      wakeRequestId: wake?.wakeRequestId ?? null,
      wakeResultId: wakeResult.wakeResultId,
      askTurnId: "ask:trace",
      decisionIds: [interpretationDecision.decisionId, decision.decisionId],
      mailIds: [mail.mailId],
      sourceIds: [mail.sourceId],
      rows: [{
        rowId: "row:decision",
        rowKind: "agent_decision",
        title: "Agent decision",
        body: decision.rationalePreview,
        source: {
          toolName: "live_env.record_live_source_mail_decision",
          artifactId: decision.decisionId,
          artifactKind: decision.artifactId,
        },
        evidenceRefs: decision.evidenceRefs,
        causalTrace: decision.causalTrace,
        authority: "model_decision_receipt",
        assistantAnswer: false,
        terminalEligible: false,
        createdAt: "2026-06-08T12:00:07.000Z",
      }],
      causalTrace: wakeResult.causalTrace,
      createdAt: "2026-06-08T12:00:07.000Z",
    });
    expect(transcriptEntries[0].causalTrace?.traceId).toBe(mail.causalTrace?.traceId);
    expect(transcriptEntries[0].causalTrace?.producedRefs).toContain(transcriptEntries[0].entryId);
    expect(transcriptEntries[0].row.causalTrace?.askTurnId).toBe("ask:trace");
  });
});
