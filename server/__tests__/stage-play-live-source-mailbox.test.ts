import { beforeEach, describe, expect, it } from "vitest";
import { buildStagePlayLiveSourceInterpreterProfileV1 } from "@shared/contracts/stage-play-live-source-interpreter-profile.v1";
import {
  buildMailLoopTranscriptRows,
  enqueueLatestVisualSummaryMailIfNeeded,
  enqueueVisualSummaryMailFromEvidence,
  readLiveSourceMailForAsk,
  recordLiveSourceMailDecisionForAsk,
} from "../services/stage-play/stage-play-visual-summary-mail-ingest";
import { enqueueAudioTranscriptMailFromChunk } from "../services/stage-play/stage-play-audio-transcript-mail-ingest";
import {
  configureStagePlayLiveSourceWatchJobPolicy,
  enqueueStagePlayLiveSourceMailItem,
  listStagePlayMailDecisions,
  listStagePlayLiveSourceJobStates,
  listStagePlayLiveSourceMailItems,
  listStagePlayLiveSourceWatchJobPolicies,
  recordStagePlayMailDecision,
  resetStagePlayLiveSourceMailboxForTest,
  subscribeStagePlayLiveSourceMailEnqueued,
  upsertStagePlayLiveSourceJobState,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import {
  getLatestStagePlayLiveSourceNarrativeState,
  getStagePlayLiveSourceNarrativeState,
  recordStagePlayLiveSourceNarrativeState,
} from "../services/stage-play/stage-play-live-source-narrative-store";
import { buildStagePlayLiveSourceMailContextPack } from "../services/stage-play/stage-play-live-source-mail-context-pack";
import { resetStagePlayLiveSourceMailboxThreadResolverForTest } from "../services/stage-play/stage-play-live-source-mailbox-thread-resolver";
import { executeLiveEnvironmentTool } from "../services/helix-ask/live-environment-tool-adapter";
import {
  attachDeckTraceToWakeRequest,
  dismissStagePlayMailWakeRequest,
  listStagePlayLiveSourceMailWakeResults,
  listStagePlayLiveSourceMailWakeRequests,
  expireStaleStagePlayLiveSourceMailWakeRequests,
  markStagePlayMailWakeCompleted,
  markStagePlayMailWakeRetryable,
  markStagePlayMailWakeRunning,
  markStagePlayMailWakeUiHandoffRequired,
  queueStagePlayLiveSourceMailWakeRequest,
  reconcileStagePlayMailWakeRequestFromAskTurn,
  reconcileStagePlayMailWakeRequestsWithDecisions,
  resetStagePlayLiveSourceMailWakeStoreForTest,
} from "../services/stage-play/stage-play-live-source-mail-wake-store";
import {
  listStagePlayLiveSourceMailTranscriptEntries,
  resetStagePlayLiveSourceMailTranscriptStoreForTest,
} from "../services/stage-play/stage-play-live-source-mail-transcript-store";
import {
  queueMailWakeForUnreadItems,
  runNextMailWakeRequest,
} from "../services/stage-play/stage-play-live-source-mail-wake-runner";
import {
  enqueueStagePlayLiveSourceTask,
  resetStagePlayLiveSourceTaskQueueForTest,
} from "../services/stage-play/stage-play-live-source-task-queue";
import {
  recordStagePlayLiveSourceConversationEvent,
  resetStagePlayLiveSourceConversationStoreForTest,
} from "../services/stage-play/stage-play-live-source-conversation-store";
import {
  recordStagePlayHeldCallout,
  resetStagePlayHeldCalloutStoreForTest,
} from "../services/stage-play/stage-play-held-callout-store";
import {
  recordStagePlayLiveSourceInterpreterProfile,
  resetStagePlayLiveSourceInterpreterProfileStoreForTest,
} from "../services/stage-play/stage-play-live-source-interpreter-profile-store";
import {
  listStagePlayMicroReasonerPrompts,
  listStagePlayMicroReasonerRuns,
  getLatestStagePlayProcessedMailPacket,
  listStagePlayProcessedMailPackets,
  resetStagePlayProcessedMailPacketStoreForTest,
} from "../services/stage-play/stage-play-processed-mail-packet-store";
import { runStagePlayLiveSourceMailWakeAdmissionCycle } from "../services/stage-play/stage-play-live-source-mail-wake-service";
import { buildStagePlayLiveSourceWatchJobPolicyDefaults } from "../services/stage-play/stage-play-live-source-watch-policy-defaults";
import { runtimeMemoryGovernor, type RuntimeMemoryReader } from "../services/runtime/runtime-memory-governor";
import {
  resetLiveSourceChunkBufferForTest,
  upsertLiveSourceProducer,
} from "../services/situation-room/live-source-chunk-buffer";
import {
  analyzeVisualFrame,
  recordVisualFrame,
  resetVisualSnapshotStoreForTest,
  startVisualSnapshotSource,
} from "../services/situation-room/visual-snapshot-store";
import { resetInterimVoiceCalloutsForTest } from "../services/helix-ask/interim-voice-callout-store";

const threadId = "thread:stage-play-mailbox";
const roomId = "room:stage-play-mailbox";
const sourceId = "visual_source:stage-play-mailbox";
const mib = 1024 * 1024;

const memoryReader = (heapUsedMiB: number, rssMiB: number): RuntimeMemoryReader => () => ({
  heapUsed: heapUsedMiB * mib,
  heapTotal: Math.max(heapUsedMiB, 800) * mib,
  rss: rssMiB * mib,
  external: 20 * mib,
  arrayBuffers: 5 * mib,
});

beforeEach(() => {
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayLiveSourceMailboxThreadResolverForTest();
  resetStagePlayLiveSourceMailWakeStoreForTest();
  resetStagePlayLiveSourceMailTranscriptStoreForTest();
  resetVisualSnapshotStoreForTest();
  resetInterimVoiceCalloutsForTest();
  resetStagePlayLiveSourceTaskQueueForTest();
  resetStagePlayLiveSourceConversationStoreForTest();
  resetStagePlayHeldCalloutStoreForTest();
  resetStagePlayLiveSourceInterpreterProfileStoreForTest();
  resetStagePlayProcessedMailPacketStoreForTest();
  resetLiveSourceChunkBufferForTest();
  runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests();
  delete process.env.STAGE_PLAY_MAIL_WAKE_LOCAL_PRESSURE_BYPASS;
  delete process.env.STAGE_PLAY_MAIL_WAKE_LOCAL_BYPASS_MAX_HEAP_MB;
  delete process.env.STAGE_PLAY_MAIL_WAKE_LOCAL_BYPASS_MAX_RSS_MB;
});

const seedVisualEvidence = () => {
  startVisualSnapshotSource({
    source_id: sourceId,
    thread_id: threadId,
    room_id: roomId,
    source_surface: "browser_tab",
    capture_mode: "interval",
    status: "active",
  });
  const frame = recordVisualFrame({
    source_id: sourceId,
    thread_id: threadId,
    room_id: roomId,
    frame_id: "visual_frame:stage-play-mailbox",
    ts: "2026-06-04T12:00:00.000Z",
  });
  const evidence = analyzeVisualFrame({
    thread_id: threadId,
    frame_id: frame.frame_id,
    evidence_id: "visual_evidence:stage-play-mailbox",
    summary: "Minecraft-like scene with a character near a book stand, cat, moonlit mountains, and waterfalls.",
    detected_objects: ["character", "book stand", "cat"],
    uncertainty: ["audio context missing"],
    supports_claims: [
      {
        claim: "A compact visual summary is available.",
        support_status: "supports",
        confidence: 0.82,
      },
    ],
  });
  return { frame, evidence };
};

describe("Stage Play live-source mailbox", () => {
  it("enqueues analysis-ready visual summaries as compact mail only", () => {
    const mail = enqueueVisualSummaryMailFromEvidence({
      threadId,
      roomId,
      environmentId: "live_env:stage-play-mailbox",
      sourceId,
      visualFrameRef: "visual_frame:compact-only",
      visualEvidenceRef: "visual_evidence:compact-only",
      summary: "Compact visual evidence summary with no raw image payload.",
      confidence: 0.74,
      analysisState: "analysis_ready",
      now: "2026-06-04T11:59:59.000Z",
    });

    expect(mail).toMatchObject({
      artifactId: "stage_play_live_source_mail_item",
      sourceId,
      sourceKind: "visual_frame",
      sourceRefs: {
        sourceId,
        frameRef: "visual_frame:compact-only",
        evidenceRef: "visual_evidence:compact-only",
      },
      summary: {
        confidence: 0.74,
        analysisState: "analysis_ready",
      },
      evidenceRefs: [
        sourceId,
        "visual_frame:compact-only",
        "visual_evidence:compact-only",
      ],
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(JSON.stringify(mail)).not.toMatch(/raw_image|image_ref|data:image|base64/i);
  });

  it("enqueues visual summary mail at the visual analysis producer boundary", () => {
    const { evidence } = seedVisualEvidence();

    const mailItems = listStagePlayLiveSourceMailItems({ threadId, sourceId });
    expect(mailItems).toHaveLength(1);
    expect(mailItems[0]).toMatchObject({
      status: "unread",
      sourceRefs: {
        frameRef: evidence.frame_id,
        evidenceRef: evidence.evidence_id,
      },
      summary: {
        text: evidence.summary,
        analysisState: "analysis_ready",
      },
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(listStagePlayLiveSourceJobStates({ threadId })[0]).toMatchObject({
      status: "armed",
      lastMailId: mailItems[0].mailId,
      nextLoopState: "continue_with_unread_mail",
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })).toHaveLength(1);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "queued",
      mailIds: [mailItems[0].mailId],
      sourceIds: [sourceId],
      reason: "unread_mail",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(JSON.stringify(mailItems[0])).not.toMatch(/raw_image|image_ref|data:image|base64/i);
  });

  it("enqueues audio transcript chunks as Stage Play mail for earbud MicroDeck processing", () => {
    const mail = enqueueAudioTranscriptMailFromChunk({
      threadId,
      roomId,
      environmentId: "live_env:stage-play-mailbox",
      sourceId: "audio_transcript:helix-ask:desktop",
      transcript: "splitting off, which is important when considering Madagascar's split during the Cretaceous period",
      eventRef: "voice:transcribe:capture:test",
      chunkRef: "live_source_chunk:audio-test",
      analysisJobRef: "live_source_analysis_job:audio-test",
      evidenceRefs: ["transcript:audio-test"],
      durationMs: 10_000,
      now: "2026-06-04T12:00:10.000Z",
    });

    expect(mail).toMatchObject({
      artifactId: "stage_play_live_source_mail_item",
      sourceId: "audio_transcript:helix-ask:desktop",
      sourceKind: "audio_transcript",
      sourceRefs: {
        sourceId: "audio_transcript:helix-ask:desktop",
        evidenceRef: "live_source_chunk:audio-test",
        observationRef: "voice:transcribe:capture:test",
      },
      summary: {
        text: expect.stringContaining("Audio transcript chunk: splitting off"),
        analysisState: "analysis_ready",
      },
      evidenceRefs: expect.arrayContaining([
        "audio_transcript:helix-ask:desktop",
        "voice:transcribe:capture:test",
        "live_source_chunk:audio-test",
        "live_source_analysis_job:audio-test",
      ]),
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "queued",
      mailIds: [mail.mailId],
      sourceIds: ["audio_transcript:helix-ask:desktop"],
      reason: "unread_mail",
    });
    expect(JSON.stringify(mail)).not.toMatch(/raw_audio|audio_data|base64/i);
  });

  it("stales narrative projections on new same-source mail and supersedes them on the next interpretation", () => {
    const jobState = upsertStagePlayLiveSourceJobState({
      threadId,
      roomId,
      sourceIds: [sourceId],
      status: "armed",
      updatedAt: "2026-06-04T12:00:00.000Z",
    });
    const firstNarrative = recordStagePlayLiveSourceNarrativeState({
      threadId,
      roomId,
      jobId: jobState.jobId,
      sourceIds: [sourceId],
      mailBatchRefs: ["stage_play_live_source_mail:first"],
      sourceEvidenceRefs: ["visual_evidence:first"],
      currentSceneSummary: "The first compact scene shows a quiet base interior.",
      runningStorySummary: "A quiet base interior is visible.",
      createdAt: "2026-06-04T12:00:01.000Z",
    });

    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:narrative-stale",
      evidenceRef: "visual_evidence:narrative-stale",
      summaryText: "The camera has shifted to a moonlit exterior with mountains.",
      createdAt: "2026-06-04T12:00:10.000Z",
    });

    expect(getStagePlayLiveSourceNarrativeState(firstNarrative.narrativeStateId)).toMatchObject({
      staleness: {
        state: "stale_after_new_mail",
        staleAfterMailId: mail.mailId,
        supersededByStateId: null,
      },
    });
    expect(getLatestStagePlayLiveSourceNarrativeState({
      threadId,
      roomId,
      jobId: jobState.jobId,
      sourceId,
      stalenessState: "current",
    })).toBeNull();

    const secondNarrative = recordStagePlayLiveSourceNarrativeState({
      threadId,
      roomId,
      jobId: jobState.jobId,
      sourceIds: [sourceId],
      mailBatchRefs: [mail.mailId],
      sourceEvidenceRefs: [mail.sourceRefs.evidenceRef ?? ""],
      currentSceneSummary: "The latest compact scene shows a moonlit exterior with mountains.",
      createdAt: "2026-06-04T12:00:20.000Z",
    });

    expect(secondNarrative).toMatchObject({
      staleness: {
        state: "current",
        staleAfterMailId: null,
        supersededByStateId: null,
      },
      priorNarrativeStateRef: firstNarrative.narrativeStateId,
    });
    expect(getStagePlayLiveSourceNarrativeState(firstNarrative.narrativeStateId)).toMatchObject({
      staleness: {
        state: "superseded",
        staleAfterMailId: mail.mailId,
        supersededByStateId: secondNarrative.narrativeStateId,
      },
    });
    expect(getLatestStagePlayLiveSourceNarrativeState({
      threadId,
      roomId,
      jobId: jobState.jobId,
      sourceId,
      stalenessState: "current",
    })?.narrativeStateId).toBe(secondNarrative.narrativeStateId);
  });

  it("emits a wake-ready mail event when new unread mail is queued for an armed job", () => {
    const events: Array<{
      mailId: string;
      jobId: string;
      wakeRequestId: string | null;
      nextLoopState: string;
    }> = [];
    const unsubscribe = subscribeStagePlayLiveSourceMailEnqueued((event) => {
      events.push({
        mailId: event.mail.mailId,
        jobId: event.jobState.jobId,
        wakeRequestId: event.wakeRequestId,
        nextLoopState: event.jobState.nextLoopState,
      });
    });

    try {
      const mail = enqueueVisualSummaryMailFromEvidence({
        threadId,
        roomId,
        environmentId: "live_env:stage-play-mailbox",
        sourceId,
        visualFrameRef: "visual_frame:auto-wake-event",
        visualEvidenceRef: "visual_evidence:auto-wake-event",
        summary: "Compact visual summary for automatic wake admission.",
        confidence: 0.8,
        analysisState: "analysis_ready",
        now: "2026-06-04T12:00:05.000Z",
      });

      expect(events).toEqual([
        expect.objectContaining({
          mailId: mail.mailId,
          jobId: expect.stringMatching(/^stage_play_live_source_job:/),
          wakeRequestId: expect.stringMatching(/^stage_play_live_source_mail_wake:/),
          nextLoopState: "continue_with_unread_mail",
        }),
      ]);
      expect(listStagePlayLiveSourceJobStates({ threadId })[0]).toMatchObject({
        lastMailId: mail.mailId,
        nextLoopState: "continue_with_unread_mail",
      });
    } finally {
      unsubscribe();
    }
  });

  it("turns latest compact visual evidence into unread Ask mail without raw content", () => {
    seedVisualEvidence();

    const readResult = readLiveSourceMailForAsk({
      threadId,
      roomId,
      sourceId,
      limit: 1,
      now: "2026-06-04T12:00:01.000Z",
    });

    expect(readResult).toMatchObject({
      artifactId: "stage_play_live_source_mail_read_result",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(readResult.items).toHaveLength(1);
    expect(readResult.items[0]).toMatchObject({
      artifactId: "stage_play_live_source_mail_item",
      status: "delivered_to_ask",
      sourceId,
      sourceRefs: {
        frameRef: "visual_frame:stage-play-mailbox",
        evidenceRef: "visual_evidence:stage-play-mailbox",
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(readResult.items[0].summary.preview).toMatch(/Minecraft-like scene/);
    expect(readResult.evidenceRefs).toEqual(expect.arrayContaining([
      sourceId,
      "visual_frame:stage-play-mailbox",
      "visual_evidence:stage-play-mailbox",
      readResult.items[0].mailId,
    ]));

    const rows = buildMailLoopTranscriptRows({
      mailItems: readResult.items,
      readResult,
    });
    expect(rows.map((row) => row.rowKind)).toEqual(expect.arrayContaining([
      "mail_received",
      "mail_read_tool_call",
      "mail_read_receipt",
    ]));
    expect(rows.every((row) => row.assistantAnswer === false && row.terminalEligible === false)).toBe(true);
  });

  it("resolves an Ask session thread to the populated Stage Play mailbox for tool reads and decisions", () => {
    const askThreadId = "6a0976f7-aec2-4b9e-b9e3-72da639d3a0f";
    const desktopThreadId = "helix-ask:desktop";
    const mail = enqueueVisualSummaryMailFromEvidence({
      threadId: desktopThreadId,
      roomId,
      environmentId: "live_env:desktop-mailbox",
      sourceId,
      visualFrameRef: "visual_frame:desktop-mailbox",
      visualEvidenceRef: "visual_evidence:desktop-mailbox",
      summary: "Compact visual summary stored under the desktop Stage Play mailbox namespace.",
      confidence: 0.81,
      analysisState: "analysis_ready",
      now: "2026-06-04T12:00:02.000Z",
    });

    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_live_source_mail",
      thread_id: askThreadId,
      args: {
        source_kind: "visual_frame",
        limit: 3,
      },
    });

    expect(readObservation.ok).toBe(true);
    expect(readObservation.observation).toMatchObject({
      askThreadId,
      mailboxThreadId: desktopThreadId,
      mailboxThreadResolution: {
        mailboxThreadId: desktopThreadId,
        reason: "desktop_stage_play_mailbox_has_state",
      },
      items: [
        {
          mailId: mail.mailId,
        },
      ],
    });

    const decisionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.record_live_source_mail_decision",
      thread_id: askThreadId,
      args: {
        mail_ids: [mail.mailId],
        decision: "wait_for_next_summary",
        rationale_preview: "No user-facing change yet.",
      },
    });

    expect(decisionObservation.ok).toBe(true);
    expect(decisionObservation.observation).toMatchObject({
      askThreadId,
      mailboxThreadId: desktopThreadId,
      mailboxThreadResolution: {
        mailboxThreadId: desktopThreadId,
        reason: "mail_id_owner_thread",
      },
      threadId: desktopThreadId,
      decision: "wait_for_next_summary",
      mailIds: [mail.mailId],
    });
  });

  it("reads only exact wake mail ids instead of widening to all unread mail", () => {
    const first = enqueueVisualSummaryMailFromEvidence({
      threadId,
      roomId,
      sourceId,
      visualFrameRef: "visual_frame:exact-first",
      visualEvidenceRef: "visual_evidence:exact-first",
      summary: "First compact visual summary.",
      analysisState: "analysis_ready",
      now: "2026-06-04T12:00:01.000Z",
    });
    const second = enqueueVisualSummaryMailFromEvidence({
      threadId,
      roomId,
      sourceId,
      visualFrameRef: "visual_frame:exact-second",
      visualEvidenceRef: "visual_evidence:exact-second",
      summary: "Second compact visual summary.",
      analysisState: "analysis_ready",
      now: "2026-06-04T12:00:02.000Z",
    });

    const readResult = readLiveSourceMailForAsk({
      threadId,
      roomId,
      sourceId,
      mailIds: [second.mailId],
      limit: 3,
      now: "2026-06-04T12:00:03.000Z",
    });

    expect(readResult.items.map((item) => item.mailId)).toEqual([second.mailId]);
    expect(readResult.evidenceRefs).toEqual(expect.arrayContaining([
      second.mailId,
      "visual_frame:exact-second",
      "visual_evidence:exact-second",
    ]));
    expect(listStagePlayLiveSourceMailItems({ threadId }).map((item) => ({
      mailId: item.mailId,
      status: item.status,
    }))).toEqual([
      { mailId: first.mailId, status: "unread" },
      { mailId: second.mailId, status: "delivered_to_ask" },
    ]);
  });

  it("records a model decision as a receipt and re-arms for the next source update", () => {
    seedVisualEvidence();
    const readResult = readLiveSourceMailForAsk({ threadId, roomId, sourceId, limit: 1 });
    const mailId = readResult.items[0].mailId;

    const decision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [mailId],
      decision: "request_voice_callout",
      rationalePreview: "The compact visual summary shows a notable scene change worth announcing.",
      voiceCalloutDraft: "The active visual source now shows a Minecraft-like scene near a book stand.",
      voiceEnabled: true,
      voiceRequiresConfirmation: false,
      voiceAllowedNow: true,
      evidenceRefs: readResult.evidenceRefs,
      now: "2026-06-04T12:00:02.000Z",
    });

    expect(decision).toMatchObject({
      artifactId: "stage_play_live_source_mail_decision",
      decision: "request_voice_callout",
      nextLoopState: "armed_for_next_summary",
      modelReviewed: true,
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(decision.voiceCalloutDraft).toMatchObject({
      voiceEligible: true,
      requiresConfirmation: false,
    });
    expect(listStagePlayLiveSourceMailItems({ threadId, status: "decision_recorded" })).toHaveLength(1);
    expect(listStagePlayLiveSourceJobStates({ threadId })[0]).toMatchObject({
      status: "armed",
      nextLoopState: "armed_for_next_summary",
      lastDecisionId: decision.decisionId,
    });

    const rows = buildMailLoopTranscriptRows({ decision });
    expect(rows.map((row) => row.rowKind)).toEqual(expect.arrayContaining([
      "agent_decision",
      "voice_callout_request",
      "loop_state",
    ]));
    expect(rows.find((row) => row.rowKind === "voice_callout_request")?.terminalEligible).toBe(false);
    const continuationRow = rows.find((row) => row.title === "Continuation state");
    expect(continuationRow?.body).toContain("Manual checkpoint completed.");
    expect(continuationRow?.body).toContain("Standing watch job continues only if a watch policy is armed.");
    expect(continuationRow?.body).toContain("Loop state: armed_for_next_summary.");
  });

  it("records interpreter profile comparison refs on mailbox decisions", () => {
    seedVisualEvidence();
    const readResult = readLiveSourceMailForAsk({ threadId, roomId, sourceId, limit: 1 });
    const mailId = readResult.items[0].mailId;
    const profileRef = "stage_play_live_source_interpreter_profile:mailbox-decision";
    const comparisonRef = "stage_play_live_source_interpreter_profile_comparison:mailbox-decision";

    const decision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [mailId],
      decision: "wait_for_next_summary",
      rationalePreview: "Routine walking matched the suppress criteria.",
      interpreterProfileRef: profileRef,
      profileComparisonRefs: [comparisonRef],
      matchedCriteria: ["routine walking"],
      suppressedCriteria: ["stable daylight scenery"],
      observedFacts: ["The compact summary shows stable daylight scenery."],
      inferredMeaning: ["The Minecraft Survival Coach profile recommends waiting."],
      evidenceRefs: readResult.evidenceRefs.concat(comparisonRef),
      now: "2026-06-04T12:00:02.000Z",
    });

    expect(decision).toMatchObject({
      decision: "wait_for_next_summary",
      interpreterProfileRef: profileRef,
      profileComparisonRefs: [comparisonRef],
      matchedCriteria: ["routine walking"],
      suppressedCriteria: ["stable daylight scenery"],
      observedFacts: ["The compact summary shows stable daylight scenery."],
      inferredMeaning: ["The Minecraft Survival Coach profile recommends waiting."],
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(decision.evidenceRefs).toEqual(expect.arrayContaining([
      profileRef,
      comparisonRef,
      mailId,
    ]));
    const rows = buildMailLoopTranscriptRows({ decision });
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rowKind: "profile_comparison",
        title: "Interpreter profile context",
        body: expect.stringContaining(`Profile: ${profileRef}.`),
      }),
      expect.objectContaining({
        rowKind: "agent_decision",
        title: "Agent decision",
      }),
    ]));
  });

  it("includes voice policy in mail reads and suppresses voice options when disabled", () => {
    seedVisualEvidence();
    const readResult = readLiveSourceMailForAsk({
      threadId,
      roomId,
      sourceId,
      limit: 1,
      voicePolicy: {
        voiceEnabled: false,
        requiresConfirmation: false,
        allowedNow: false,
        reason: "operator_disabled_voice",
      },
    });

    expect(readResult.voicePolicy).toEqual({
      voiceEnabled: false,
      requiresConfirmation: false,
      allowedNow: false,
      reason: "operator_disabled_voice",
    });
    expect(readResult.suggestedDecisionOptions).not.toContain("request_voice_callout");
  });

  it("keeps disabled voice callout requests visible and blocks voice tools", () => {
    seedVisualEvidence();
    const readResult = readLiveSourceMailForAsk({ threadId, roomId, sourceId, limit: 1 });
    const mailId = readResult.items[0].mailId;

    const decision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [mailId],
      decision: "request_voice_callout",
      rationalePreview: "Risk appeared, but voice output is disabled.",
      voiceCalloutDraft: "Hostile mob appeared near the player.",
      voiceEnabled: false,
      voiceRequiresConfirmation: false,
      voiceAllowedNow: false,
      voicePolicyReason: "voice_disabled",
      requestedTool: {
        toolName: "situation-room-pipelines.voice_delivery.confirm_speak",
        args: { text: "Hostile mob appeared near the player." },
      },
      evidenceRefs: readResult.evidenceRefs,
      now: "2026-06-04T12:00:02.100Z",
    });

    expect(decision.voicePolicy).toMatchObject({
      voiceEnabled: false,
      allowedNow: false,
      reason: "voice_disabled",
    });
    expect(decision.decision).toBe("request_voice_callout");
    expect(decision.voiceCalloutDraft).toMatchObject({
      text: "Hostile mob appeared near the player.",
      voiceEligible: false,
    });
    expect(decision.textAnswerDraft).toMatchObject({
      text: "Hostile mob appeared near the player.",
      terminalEligible: false,
    });
    expect(decision.requestedTool).toBeNull();
    const rows = buildMailLoopTranscriptRows({ decision });
    expect(rows.map((row) => row.rowKind)).toContain("text_answer");
    expect(rows.map((row) => row.rowKind)).toContain("voice_callout_request");
    expect(rows.map((row) => row.rowKind)).not.toContain("voice_tool_call");
    expect(rows.find((row) => row.rowKind === "voice_callout_request")?.body).toContain("Voice callout held by policy");
  });

  it("keeps confirmation-required voice callouts as drafts and blocks voice tools", () => {
    seedVisualEvidence();
    const readResult = readLiveSourceMailForAsk({ threadId, roomId, sourceId, limit: 1 });
    const mailId = readResult.items[0].mailId;

    const decision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [mailId],
      decision: "request_voice_callout",
      rationalePreview: "Risk appeared, but voice output requires confirmation.",
      voiceCalloutDraft: "Hostile mob appeared near the player.",
      voiceEnabled: true,
      voiceRequiresConfirmation: true,
      voiceAllowedNow: false,
      voicePolicyReason: "voice_requires_confirmation",
      requestedTool: {
        toolName: "situation-room-pipelines.voice_delivery.confirm_speak",
        args: { text: "Hostile mob appeared near the player." },
      },
      evidenceRefs: readResult.evidenceRefs,
      now: "2026-06-04T12:00:02.200Z",
    });

    expect(decision.voicePolicy).toMatchObject({
      voiceEnabled: true,
      requiresConfirmation: true,
      allowedNow: false,
      reason: "voice_requires_confirmation",
    });
    expect(decision.voiceCalloutDraft).toMatchObject({
      text: "Hostile mob appeared near the player.",
      voiceEligible: false,
      requiresConfirmation: true,
    });
    expect(decision.requestedTool).toBeNull();
    const rows = buildMailLoopTranscriptRows({ decision });
    expect(rows.map((row) => row.rowKind)).toContain("voice_callout_request");
    expect(rows.map((row) => row.rowKind)).not.toContain("voice_tool_call");
  });

  it("allows a separate voice tool request only after an allowed voice decision", () => {
    seedVisualEvidence();
    const readResult = readLiveSourceMailForAsk({ threadId, roomId, sourceId, limit: 1 });
    const mailId = readResult.items[0].mailId;

    const decision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [mailId],
      decision: "request_voice_callout",
      rationalePreview: "New risk appeared and voice policy allows a callout now.",
      voiceCalloutDraft: "Hostile mob appeared near the player.",
      voiceEnabled: true,
      voiceRequiresConfirmation: false,
      voiceAllowedNow: true,
      requestedTool: {
        toolName: "situation-room-pipelines.voice_delivery.confirm_speak",
        args: { text: "Hostile mob appeared near the player." },
      },
      evidenceRefs: readResult.evidenceRefs,
      now: "2026-06-04T12:00:02.300Z",
    });

    expect(decision.voicePolicy).toMatchObject({
      voiceEnabled: true,
      requiresConfirmation: false,
      allowedNow: true,
    });
    expect(decision.voiceCalloutDraft).toMatchObject({
      voiceEligible: true,
      requiresConfirmation: false,
    });
    expect(decision.requestedTool).toMatchObject({
      toolName: "situation-room-pipelines.voice_delivery.confirm_speak",
    });
    const rows = buildMailLoopTranscriptRows({ decision });
    expect(rows.map((row) => row.rowKind)).toEqual(expect.arrayContaining([
      "voice_callout_request",
      "voice_tool_call",
    ]));
    expect(rows.find((row) => row.rowKind === "voice_tool_call")?.terminalEligible).toBe(false);
  });

  it("records wait as a visible decision receipt instead of silent no-op", () => {
    seedVisualEvidence();
    const readResult = readLiveSourceMailForAsk({ threadId, roomId, sourceId, limit: 1 });
    const mailId = readResult.items[0].mailId;

    const decision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [mailId],
      decision: "wait_for_next_summary",
      rationalePreview: "No high-salience change yet; keep the mailbox armed for the next interval summary.",
      evidenceRefs: readResult.evidenceRefs,
      now: "2026-06-04T12:00:02.500Z",
    });

    expect(decision).toMatchObject({
      decision: "wait_for_next_summary",
      nextLoopState: "armed_for_next_summary",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
    });

    const rows = buildMailLoopTranscriptRows({ decision });
    expect(rows.map((row) => row.rowKind)).toEqual(expect.arrayContaining([
      "agent_decision",
      "loop_state",
    ]));
    expect(rows.map((row) => row.rowKind)).not.toContain("text_answer");
    expect(rows.map((row) => row.rowKind)).not.toContain("voice_callout_request");
    expect(rows.every((row) => row.assistantAnswer === false && row.terminalEligible === false)).toBe(true);
  });

  it("does not re-deliver a visual summary mail item after a decision is recorded", () => {
    seedVisualEvidence();
    const firstRead = readLiveSourceMailForAsk({
      threadId,
      roomId,
      sourceId,
      limit: 1,
      now: "2026-06-04T12:00:13.000Z",
    });
    const mailId = firstRead.items[0].mailId;

    const decision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [mailId],
      decision: "wait_for_next_summary",
      rationalePreview: "No high-salience change yet; wait for the next interval summary.",
      evidenceRefs: firstRead.evidenceRefs,
      now: "2026-06-04T12:00:14.000Z",
    });

    const secondRead = readLiveSourceMailForAsk({
      threadId,
      roomId,
      sourceId,
      limit: 1,
      now: "2026-06-04T12:00:15.000Z",
    });

    expect(secondRead.items).toEqual([]);
    expect(secondRead.priorDecisionRefs).toContain(decision.decisionId);
    expect(listStagePlayLiveSourceMailItems({ threadId, status: "decision_recorded" }).map((item) => item.mailId)).toEqual([
      mailId,
    ]);
    expect(listStagePlayMailDecisions({ threadId, mailId })).toHaveLength(1);
    expect(listStagePlayLiveSourceJobStates({ threadId })[0]).toMatchObject({
      status: "armed",
      mailboxCursor: mailId,
      lastDecisionId: decision.decisionId,
      nextLoopState: "armed_for_next_summary",
    });
  });

  it("persists a requested next tool on the mail decision receipt", () => {
    seedVisualEvidence();
    const readResult = readLiveSourceMailForAsk({ threadId, roomId, sourceId, limit: 1 });
    const mailId = readResult.items[0].mailId;

    const decision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [mailId],
      decision: "request_more_evidence",
      rationalePreview: "The compact summary is ambiguous; request another visual mail check before drafting.",
      requestedTool: {
        toolName: "live_env.read_live_source_mail",
        args: {
          source_kind: "visual_frame",
          limit: 1,
        },
      },
      evidenceRefs: readResult.evidenceRefs,
      now: "2026-06-04T12:00:02.750Z",
    });

    expect(decision.requestedTool).toEqual({
      toolName: "live_env.read_live_source_mail",
      args: {
        source_kind: "visual_frame",
        limit: 1,
      },
    });
    const rows = buildMailLoopTranscriptRows({ decision });
    expect(rows.map((row) => row.rowKind)).toContain("requested_tool");
    expect(rows.find((row) => row.rowKind === "requested_tool")?.body).toContain("live_env.read_live_source_mail");
  });

  it("returns a wait receipt instead of a visual-unavailable answer when no summary mail exists", () => {
    const readResult = readLiveSourceMailForAsk({
      threadId,
      roomId,
      sourceId,
      limit: 1,
      now: "2026-06-04T12:00:03.000Z",
    });

    expect(readResult.items).toEqual([]);
    expect(readResult.assistant_answer).toBe(false);
    expect(readResult.terminal_eligible).toBe(false);
    const rows = buildMailLoopTranscriptRows({ readResult });
    expect(rows.map((row) => row.rowKind)).toContain("wait_for_next_summary");
    expect(rows.map((row) => row.body).join("\n")).not.toMatch(/visual capture evidence is unavailable/i);
  });

  it("polling fallback enqueues latest visual evidence once per evidence ref", () => {
    seedVisualEvidence();

    const first = enqueueLatestVisualSummaryMailIfNeeded({
      threadId,
      roomId,
      sourceId,
      now: "2026-06-04T12:00:09.000Z",
    });
    const second = enqueueLatestVisualSummaryMailIfNeeded({
      threadId,
      roomId,
      sourceId,
      now: "2026-06-04T12:00:10.000Z",
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.mailId).toBe(first?.mailId);
    expect(first).toMatchObject({
      sourceRefs: {
        frameRef: "visual_frame:stage-play-mailbox",
        evidenceRef: "visual_evidence:stage-play-mailbox",
      },
      raw_content_included: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(listStagePlayLiveSourceMailItems({ threadId, sourceId })).toHaveLength(1);
    expect(JSON.stringify(first)).not.toMatch(/raw_image|image_ref|data:image|base64/i);
  });

  it("collapses exact evidence duplicates without deciding salience", () => {
    const first = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:duplicate",
      evidenceRef: "visual_evidence:duplicate",
      summaryText: "A compact visual summary.",
      createdAt: "2026-06-04T12:00:04.000Z",
    });
    const duplicate = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:duplicate",
      evidenceRef: "visual_evidence:duplicate",
      summaryText: "A compact visual summary.",
      createdAt: "2026-06-04T12:00:05.000Z",
    });
    const changed = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:changed",
      evidenceRef: "visual_evidence:changed",
      summaryText: "A different compact visual summary.",
      createdAt: "2026-06-04T12:00:06.000Z",
    });

    expect(duplicate.mailId).toBe(first.mailId);
    expect(changed.mailId).not.toBe(first.mailId);
    expect(listStagePlayLiveSourceMailItems({ threadId })).toHaveLength(2);
    const wakeRequests = listStagePlayLiveSourceMailWakeRequests({ threadId });
    expect(wakeRequests).toHaveLength(1);
    expect(wakeRequests[0].mailIds).toEqual([first.mailId, changed.mailId]);
    expect(listStagePlayLiveSourceMailItems({ threadId, status: "unread" }).map((item) => item.mailId)).toEqual([
      first.mailId,
      changed.mailId,
    ]);
  });

  it("batches unread mail from the same live source into one chronological wake", () => {
    const first = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:batch-first",
      evidenceRef: "visual_evidence:batch-first",
      summaryText: "First compact visual summary.",
      createdAt: "2026-06-04T12:00:04.000Z",
    });
    const second = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:batch-second",
      evidenceRef: "visual_evidence:batch-second",
      summaryText: "Second compact visual summary.",
      createdAt: "2026-06-04T12:00:05.000Z",
    });
    const third = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:batch-third",
      evidenceRef: "visual_evidence:batch-third",
      summaryText: "Third compact visual summary.",
      createdAt: "2026-06-04T12:00:06.000Z",
    });

    const wakeRequests = listStagePlayLiveSourceMailWakeRequests({ threadId });
    expect(wakeRequests).toHaveLength(1);
    expect(wakeRequests[0]).toMatchObject({
      status: "queued",
      wakeIntent: "process_unread_mail",
      sourceIds: [sourceId],
      mailIds: [first.mailId, second.mailId, third.mailId],
    });
    expect(wakeRequests[0].evidenceRefs).toEqual(expect.arrayContaining([
      first.mailId,
      second.mailId,
      third.mailId,
      "visual_evidence:batch-first",
      "visual_evidence:batch-second",
      "visual_evidence:batch-third",
    ]));
  });

  it("promotes raw processing wakes to Ask handoff only after a packet-backed deck verdict", () => {
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:packet-journey"],
      sourceIds: [sourceId],
      evidenceRefs: ["stage_play_live_source_mail:packet-journey"],
      now: "2026-06-04T12:00:06.500Z",
    });

    expect(wake).toMatchObject({
      reason: "unread_mail",
      wakeIntent: "process_unread_mail",
      packetIds: [],
      deckVerdict: null,
    });

    const promoted = attachDeckTraceToWakeRequest({
      wakeRequestId: wake?.wakeRequestId ?? "",
      deckPresetId: "stage_play_micro_reasoner_prompt_preset:minecraft_minimal_operator:v1",
      deckPresetTitle: "Minecraft Minimal Operator",
      deckRunPlan: "minimal_prompted_arbiter",
      packetIds: ["stage_play_processed_mail_packet:packet-journey"],
      deckVerdict: {
        recommendedNext: "request_voice_callout",
        wakeAsk: true,
        voiceCandidate: true,
        reason: "Minimal operator saw a danger cue.",
      },
      evidenceRefs: [
        "stage_play_processed_mail_packet:packet-journey",
        "stage_play_micro_reasoner_run:packet-journey-arbiter",
      ],
      now: "2026-06-04T12:00:06.750Z",
    });

    expect(promoted).toMatchObject({
      wakeIntent: "ask_from_processed_packet",
      deckPresetTitle: "Minecraft Minimal Operator",
      deckRunPlan: "minimal_prompted_arbiter",
      packetIds: ["stage_play_processed_mail_packet:packet-journey"],
      deckVerdict: {
        recommendedNext: "request_voice_callout",
        wakeAsk: true,
        voiceCandidate: true,
      },
    });
  });

  it("keeps different live sources in separate wake batches", () => {
    const visualMail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId: "visual_source:batch-visual",
      sourceKind: "visual_frame",
      frameRef: "visual_frame:batch-visual",
      evidenceRef: "visual_evidence:batch-visual",
      summaryText: "Visual source compact summary.",
      createdAt: "2026-06-04T12:00:04.000Z",
    });
    const screenMail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId: "screen_source:batch-screen",
      sourceKind: "screen_summary",
      observationRef: "screen_observation:batch-screen",
      summaryText: "Screen source compact summary.",
      createdAt: "2026-06-04T12:00:05.000Z",
    });

    const wakeRequests = listStagePlayLiveSourceMailWakeRequests({ threadId });
    expect(wakeRequests).toHaveLength(2);
    expect(wakeRequests.map((wake) => wake.mailIds)).toEqual([
      [visualMail.mailId],
      [screenMail.mailId],
    ]);
  });

  it("only supersedes unread mail when the caller explicitly names replacement ids", () => {
    const oldMail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:old",
      evidenceRef: "visual_evidence:old",
      summaryText: "Older compact visual summary.",
      createdAt: "2026-06-04T12:00:07.000Z",
    });
    const replacement = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:new",
      evidenceRef: "visual_evidence:new",
      summaryText: "Newer compact visual summary.",
      supersedesMailIds: [oldMail.mailId],
      createdAt: "2026-06-04T12:00:08.000Z",
    });

    expect(listStagePlayLiveSourceMailItems({ threadId, status: "superseded" }).map((item) => item.mailId)).toEqual([
      oldMail.mailId,
    ]);
    expect(listStagePlayLiveSourceMailItems({ threadId, status: "unread" }).map((item) => item.mailId)).toEqual([
      replacement.mailId,
    ]);
  });

  it("filters unread mail by source kind without consuming other kinds", () => {
    const visualMail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId: "visual_source:kind-filter",
      sourceKind: "visual_frame",
      frameRef: "visual_frame:kind-filter",
      evidenceRef: "visual_evidence:kind-filter",
      summaryText: "Visual frame summary.",
      createdAt: "2026-06-04T12:00:11.000Z",
    });
    const audioMail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId: "audio_source:kind-filter",
      sourceKind: "audio_transcript",
      observationRef: "audio_observation:kind-filter",
      summaryText: "Audio transcript summary.",
      createdAt: "2026-06-04T12:00:12.000Z",
    });

    const readResult = readLiveSourceMailForAsk({
      threadId,
      roomId,
      sourceKind: "audio_transcript",
      limit: 5,
    });

    expect(readResult.items.map((item) => item.mailId)).toEqual([audioMail.mailId]);
    expect(listStagePlayLiveSourceMailItems({ threadId, status: "delivered_to_ask" }).map((item) => item.mailId)).toEqual([
      audioMail.mailId,
    ]);
    expect(listStagePlayLiveSourceMailItems({ threadId, status: "unread" }).map((item) => item.mailId)).toEqual([
      visualMail.mailId,
    ]);
  });

  it("does not queue a wake for a paused live-source job", () => {
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:paused",
      evidenceRef: "visual_evidence:paused",
      summaryText: "Paused source summary.",
      createdAt: "2026-06-04T12:00:16.000Z",
    });
    upsertStagePlayLiveSourceJobState({
      threadId,
      roomId,
      sourceIds: [sourceId],
      status: "paused",
      lastMailId: mail.mailId,
      nextLoopState: "paused_by_user",
      updatedAt: "2026-06-04T12:00:16.500Z",
    });

    const wake = queueMailWakeForUnreadItems({
      threadId,
      roomId,
      sourceId,
      now: "2026-06-04T12:00:17.000Z",
    });

    expect(wake).toBeNull();
  });

  it("expires stale fast-lane wake requests instead of keeping old predictions active", () => {
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:stale-wake"],
      sourceIds: [sourceId],
      evidenceRefs: ["stage_play_live_source_mail:stale-wake"],
      now: "2026-06-04T12:00:21.000Z",
      expiresAfterMs: 1_000,
    });

    expect(wake).toMatchObject({
      status: "queued",
      expiresAt: "2026-06-04T12:00:22.000Z",
    });

    const expired = expireStaleStagePlayLiveSourceMailWakeRequests({
      threadId,
      roomId,
      now: "2026-06-04T12:00:23.000Z",
    });

    expect(expired.map((entry) => entry.wakeRequestId)).toEqual([wake?.wakeRequestId]);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId, status: "queued" })).toHaveLength(0);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId, status: "expired_stale" })[0]).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      failureReason: "wake_relevance_ttl_expired",
    });
    expect(listStagePlayLiveSourceMailWakeResults({ threadId })[0]).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "expired_stale",
      failedReason: "wake_relevance_ttl_expired",
    });
  });

  it("lets the operator dismiss unresolved wake requests without deleting evidence", () => {
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:operator-dismiss"],
      sourceIds: [sourceId],
      evidenceRefs: ["stage_play_live_source_mail:operator-dismiss"],
      now: "2026-06-04T12:00:24.000Z",
    });

    const dismissed = dismissStagePlayMailWakeRequest({
      wakeRequestId: wake?.wakeRequestId ?? "",
      reason: "operator_dismissed",
      now: "2026-06-04T12:00:25.000Z",
    });

    expect(dismissed?.wakeRequest).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "skipped",
      lifecycleStage: "completed",
      lifecycleReason: "operator_dismissed",
      nextRetryAt: null,
    });
    expect(dismissed?.wakeResult).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "skipped",
      skippedReason: "operator_dismissed",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId, status: "queued" })).toHaveLength(0);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId, status: "skipped" })).toHaveLength(1);
  });

  it("does not dismiss wake requests after Ask or decision evidence exists", () => {
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:operator-dismiss-running"],
      sourceIds: [sourceId],
      evidenceRefs: ["stage_play_live_source_mail:operator-dismiss-running"],
      now: "2026-06-04T12:00:26.000Z",
    });
    markStagePlayMailWakeRunning(wake?.wakeRequestId ?? "", "2026-06-04T12:00:27.000Z", {
      askTurnId: "ask:operator-dismiss-running",
    });

    expect(dismissStagePlayMailWakeRequest({
      wakeRequestId: wake?.wakeRequestId ?? "",
      reason: "operator_dismissed",
      now: "2026-06-04T12:00:28.000Z",
    })).toBeNull();
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "running",
      askTurnId: "ask:operator-dismiss-running",
    });
  });

  it("supersedes older same-source wakes when a newer visual packet arrives", () => {
    const firstWake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:first-present"],
      sourceIds: [sourceId],
      evidenceRefs: ["stage_play_live_source_mail:first-present"],
      now: "2026-06-04T12:00:31.000Z",
      expiresAfterMs: 30_000,
    });
    const secondWake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:second-present"],
      sourceIds: [sourceId],
      evidenceRefs: ["stage_play_live_source_mail:second-present"],
      now: "2026-06-04T12:00:36.000Z",
      expiresAfterMs: 30_000,
    });

    expect(secondWake?.wakeRequestId).not.toBe(firstWake?.wakeRequestId);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId, status: "queued" }).map((entry) => entry.wakeRequestId)).toEqual([
      secondWake?.wakeRequestId,
    ]);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId, status: "expired_superseded" })[0]).toMatchObject({
      wakeRequestId: firstWake?.wakeRequestId,
      supersededByWakeRequestId: secondWake?.wakeRequestId,
      failureReason: "wake_superseded_by_newer_source_packet",
    });
  });

  it("coalesces fresh same-source queued wakes instead of creating duplicate pressure", () => {
    const firstWake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:fresh-coalesce-first"],
      sourceIds: [sourceId],
      evidenceRefs: ["stage_play_live_source_mail:fresh-coalesce-first"],
      now: "2026-06-04T12:00:36.100Z",
    });
    const secondWake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:fresh-coalesce-second"],
      sourceIds: [sourceId],
      evidenceRefs: ["stage_play_live_source_mail:fresh-coalesce-second"],
      now: "2026-06-04T12:00:36.200Z",
    });

    expect(secondWake?.wakeRequestId).toBe(firstWake?.wakeRequestId);
    expect(secondWake?.mailIds).toEqual(expect.arrayContaining([
      "stage_play_live_source_mail:fresh-coalesce-first",
      "stage_play_live_source_mail:fresh-coalesce-second",
    ]));
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId, status: "queued" })).toHaveLength(1);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId, status: "expired_superseded" })).toHaveLength(0);
  });

  it("supersedes deferred same-source wakes when a newer present packet arrives", () => {
    const firstWake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:deferred-first-present"],
      sourceIds: [sourceId],
      evidenceRefs: ["stage_play_live_source_mail:deferred-first-present"],
      now: "2026-06-04T12:00:36.300Z",
    });
    markStagePlayMailWakeRetryable({
      wakeRequestId: firstWake?.wakeRequestId ?? "",
      status: "deferred_for_pressure",
      failureReason: "runtime_memory_queue_deferrable",
      nextRetryAt: "2026-06-04T12:00:51.000Z",
      now: "2026-06-04T12:00:36.400Z",
    });

    const secondWake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:deferred-second-present"],
      sourceIds: [sourceId],
      evidenceRefs: ["stage_play_live_source_mail:deferred-second-present"],
      now: "2026-06-04T12:00:40.000Z",
    });

    expect(secondWake?.wakeRequestId).not.toBe(firstWake?.wakeRequestId);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId, status: "queued" }).map((entry) => entry.wakeRequestId)).toEqual([
      secondWake?.wakeRequestId,
    ]);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId, status: "expired_superseded" })[0]).toMatchObject({
      wakeRequestId: firstWake?.wakeRequestId,
      supersededByWakeRequestId: secondWake?.wakeRequestId,
      failureReason: "wake_superseded_by_newer_source_packet",
    });
    expect(listStagePlayLiveSourceMailWakeResults({ threadId })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        wakeRequestId: firstWake?.wakeRequestId,
        status: "expired_superseded",
        failedReason: "wake_superseded_by_newer_source_packet",
      }),
    ]));
  });

  it("does not supersede same-source wakes that already have voice checkpoint evidence", () => {
    const firstWake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:voice-checkpoint-present"],
      sourceIds: [sourceId],
      evidenceRefs: [
        "stage_play_live_source_mail:voice-checkpoint-present",
        "helix_interim_voice_callout_receipt:voice-checkpoint-present",
      ],
      now: "2026-06-04T12:00:40.100Z",
      expiresAfterMs: 1_000,
    });
    const secondWake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:voice-checkpoint-newer-present"],
      sourceIds: [sourceId],
      evidenceRefs: ["stage_play_live_source_mail:voice-checkpoint-newer-present"],
      now: "2026-06-04T12:00:45.000Z",
      expiresAfterMs: 30_000,
    });

    expect(secondWake?.wakeRequestId).not.toBe(firstWake?.wakeRequestId);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId }).find((entry) =>
      entry.wakeRequestId === firstWake?.wakeRequestId
    )).toMatchObject({
      status: "queued",
      evidenceRefs: expect.arrayContaining(["helix_interim_voice_callout_receipt:voice-checkpoint-present"]),
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId, status: "expired_superseded" })).toHaveLength(0);
  });

  it("does not expire phase-locked running wakes before decision and voice reconciliation", () => {
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:phase-locked"],
      sourceIds: [sourceId],
      evidenceRefs: ["stage_play_live_source_mail:phase-locked"],
      now: "2026-06-04T12:00:41.000Z",
      expiresAfterMs: 1_000,
    });
    markStagePlayMailWakeRunning(wake?.wakeRequestId ?? "", "2026-06-04T12:00:41.500Z", {
      askTurnId: "ask:phase-locked",
    });

    const expired = expireStaleStagePlayLiveSourceMailWakeRequests({
      threadId,
      roomId,
      now: "2026-06-04T12:00:45.000Z",
    });

    expect(expired).toHaveLength(0);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "running",
    });
  });

  it("runs the next queued wake through the Ask turn runner and records completion", async () => {
    seedVisualEvidence();
    const wake = listStagePlayLiveSourceMailWakeRequests({ threadId })[0];
    expect(wake).toMatchObject({ status: "queued" });

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      askTurnRunner: async ({ wakeRequest }) => ({
        turn_id: "ask:wake-test",
        current_turn_artifact_ledger: [
          {
            kind: "live_environment_tool_observation",
            payload: {
              tool_name: "live_env.record_live_source_mail_decision",
              observation: {
                artifactId: "stage_play_live_source_mail_decision",
                decisionId: "stage_play_live_source_mail_decision:wake-test",
              },
            },
          },
        ],
        wakeRequestId: wakeRequest.wakeRequestId,
      }),
    });

    expect(result).toMatchObject({
      artifactId: "stage_play_live_source_mail_wake_result",
      status: "completed",
      askTurnId: "ask:wake-test",
      decisionIds: ["stage_play_live_source_mail_decision:wake-test"],
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "completed",
      askTurnId: "ask:wake-test",
      decisionIds: ["stage_play_live_source_mail_decision:wake-test"],
    });
  });

  it("records durable transcript entries when a wake completes", async () => {
    seedVisualEvidence();
    const wake = listStagePlayLiveSourceMailWakeRequests({ threadId })[0];

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      askTurnRunner: async ({ wakeRequest }) => {
        const decision = recordLiveSourceMailDecisionForAsk({
          threadId: wakeRequest.threadId,
          roomId: wakeRequest.roomId,
          environmentId: wakeRequest.environmentId,
          mailIds: wakeRequest.mailIds,
          decision: "request_voice_callout",
          rationalePreview: "The visual mail contains a high-salience update.",
          voiceCalloutDraft: "A notable visual update appeared.",
          voiceEnabled: true,
          voiceRequiresConfirmation: false,
          voiceAllowedNow: true,
          evidenceRefs: wakeRequest.evidenceRefs,
          now: "2026-06-04T12:00:03.000Z",
        });
        return {
          turn_id: "ask:wake-durable-transcript",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: decision,
              },
            },
          ],
        };
      },
    });

    const entries = listStagePlayLiveSourceMailTranscriptEntries({ threadId });
    expect(entries.map((entry) => entry.row.rowKind)).toEqual(expect.arrayContaining([
      "mail_received",
      "mail_wake_requested",
      "mail_read_tool_call",
      "mail_read_receipt",
      "agent_decision",
      "voice_callout_request",
      "loop_state",
    ]));
    expect(entries.every((entry) =>
      entry.artifactId === "stage_play_live_source_mail_transcript_entry" &&
      entry.assistant_answer === false &&
      entry.terminal_eligible === false &&
      entry.context_role === "tool_evidence" &&
      entry.raw_content_included === false
    )).toBe(true);
    expect(entries.every((entry) => entry.wakeRequestId === wake.wakeRequestId)).toBe(true);
    expect(entries.every((entry) => entry.askTurnId === "ask:wake-durable-transcript")).toBe(true);
    expect(result?.evidenceRefs).toEqual(expect.arrayContaining(entries.map((entry) => entry.entryId)));
    expect(JSON.stringify(entries)).not.toMatch(/raw_image|data:image|base64/i);
  });

  it("surfaces Minecraft-style prediction, decision, voice, and loop rows without fake user prompts", async () => {
    const { policy } = configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceIds: [sourceId],
      objectiveText: "Watch the Minecraft live source and call out important risk.",
      decisionPolicyPrompt: "Wait on safe daylight scenes. Request a voice callout when darkness risk appears outdoors.",
      importanceCriteria: ["night approaching", "danger outdoors"],
      suppressCriteria: ["safe daylight scene"],
      outputPolicy: {
        allowTextAnswer: true,
        allowVoiceCallout: true,
        voiceRequiresUrgency: true,
        confirmationRequired: false,
      },
      now: "2026-06-04T12:20:00.000Z",
    });
    const daylightMail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:minecraft-daylight",
      evidenceRef: "visual_evidence:minecraft-daylight",
      summaryText: "Forest daylight scene; player visible.",
      createdAt: "2026-06-04T12:20:01.000Z",
    });

    let daylightAskCalls = 0;
    await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:20:02.000Z",
      askTurnRunner: async ({ wakeRequest }) => {
        daylightAskCalls += 1;
        const decision = recordLiveSourceMailDecisionForAsk({
          threadId,
          roomId,
          mailIds: wakeRequest.mailIds,
          decision: "wait_for_next_summary",
          rationalePreview: "Safe daylight scene; wait for next summary.",
          activeJobId: policy.jobId,
          now: "2026-06-04T12:20:03.000Z",
        });
        return {
          turn_id: "ask:minecraft-daylight",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: decision,
              },
            },
          ],
        };
      },
    });
    expect(daylightAskCalls).toBe(0);

    const daylightRows = listStagePlayLiveSourceMailTranscriptEntries({ threadId })
      .filter((entry) => entry.mailIds.includes(daylightMail.mailId))
      .map((entry) => entry.row);
    expect(daylightRows.map((row) => row.title)).toEqual(expect.arrayContaining([
      "Observation mail",
      "Immersion state",
      "Prediction validation",
      "Processed mail packet",
      "Decision selected",
      "Prediction check",
      "Immediate prediction",
      "Agent decision",
      "Loop state",
    ]));
    const daylightPacket = getLatestStagePlayProcessedMailPacket({
      jobId: policy.jobId,
      sourceId,
      mailId: daylightMail.mailId,
    });
    expect(daylightPacket).toMatchObject({
      artifactId: "stage_play_processed_mail_packet",
      context_role: "tool_evidence",
      assistant_answer: false,
      terminal_eligible: false,
      recommendedNext: "record_interpretation",
      salience: expect.objectContaining({
        level: "low",
        voiceCandidate: false,
      }),
    });
    expect(daylightPacket?.microReasonerRunRefs.length).toBeGreaterThanOrEqual(7);
    const defaultPrompts = listStagePlayMicroReasonerPrompts({ active: true });
    expect(defaultPrompts.map((prompt) => prompt.role)).toEqual(expect.arrayContaining([
      "claim_extractor",
      "observation_classifier",
      "profile_comparator",
      "delta_extractor",
      "prediction_validator",
      "salience_scorer",
      "decision_selector",
      "voice_callout_drafter",
      "packet_composer",
    ]));
    const daylightRuns = listStagePlayMicroReasonerRuns({
      jobId: policy.jobId,
      sourceId,
      mailId: daylightMail.mailId,
    });
    expect(daylightRuns.map((run) => run.role)).toEqual(expect.arrayContaining([
      "claim_extractor",
      "observation_classifier",
      "delta_extractor",
      "prediction_validator",
      "salience_scorer",
      "decision_selector",
      "packet_composer",
    ]));
    expect(daylightRuns.find((run) => run.role === "decision_selector")).toMatchObject({
      selectedDecision: "record_interpretation",
      recommendedNextTool: "live_env.record_live_source_mail_decision",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "micro_reasoner_evidence",
    });
    expect(daylightRuns.every((run) => run.promptId)).toBe(true);
    expect(daylightRows.map((row) => row.rowKind)).toEqual(expect.arrayContaining([
      "micro_reasoner_run",
    ]));
    expect(daylightRows.find((row) => row.title === "Observation mail")?.body).toBe("Forest daylight scene; player visible.");
    expect(daylightRows.find((row) => row.title === "Processed mail packet")?.body).toContain("processed_packet_ready");
    expect(daylightRows.find((row) => row.title === "Decision selected")?.body).toContain("Decision: record_interpretation");
    expect(daylightRows.find((row) => row.title === "Decision selected")?.body).toContain("Recommended next tool: live_env.record_live_source_mail_decision");
    expect(daylightRows.find((row) => row.title === "Wake requested")?.body).toContain("decision_selector selected record_interpretation");
    expect(daylightRows.find((row) => row.title === "Prediction check")?.body).toBe("No prior prediction.");
    expect(daylightRows.find((row) => row.title === "Immediate prediction")?.body).toContain("Likely next: gathering wood or scanning resources.");
    expect(daylightRows.find((row) => row.title === "Agent decision")?.body).toContain("record_interpretation");
    expect(daylightRows.find((row) => row.title === "Loop state")?.body).toBe("Armed for the next live-source update.");

    const priorNarrative = recordStagePlayLiveSourceNarrativeState({
      threadId,
      roomId,
      jobId: policy.jobId,
      policyId: policy.policyId,
      sourceIds: [sourceId],
      mailBatchRefs: [daylightMail.mailId],
      currentSceneSummary: "Forest daylight scene; player visible.",
      runningStorySummary: "The Minecraft player is outside in daylight.",
      interpretedSituation: {
        setting: "Minecraft outdoors",
        objects: ["forest", "player"],
        activities: ["scanning resources"],
        userRelevantMeaning: "The player appears safe outside in daylight.",
      },
      watchNext: {
        targets: ["lighting", "shelter", "hostile mobs"],
        reason: "Watch whether the daylight-safe assumption changes.",
      },
      prediction: {
        text: "The next mail will likely remain daylight-safe while the player gathers resources.",
        horizon: "next_mail",
        confidence: 0.68,
        validationSignals: ["daylight remains", "player gathers resources"],
      },
      createdAt: "2026-06-04T12:20:04.000Z",
    });
    const darkerMail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:minecraft-darker",
      evidenceRef: "visual_evidence:minecraft-darker",
      summaryText: "Lighting darker; player outdoors.",
      createdAt: "2026-06-04T12:20:05.000Z",
    });

    await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:20:06.000Z",
      askTurnRunner: async ({ wakeRequest }) => {
        const decision = recordLiveSourceMailDecisionForAsk({
          threadId,
          roomId,
          mailIds: wakeRequest.mailIds,
          decision: "request_voice_callout",
          rationalePreview: "Prior daylight-safe assumption is stale and darkness risk is relevant outdoors.",
          voiceCalloutDraft: "Night appears to be approaching while you are outside; consider shelter or light.",
          voicePolicy: {
            voiceEnabled: true,
            requiresConfirmation: false,
            allowedNow: true,
            reason: "urgent_voice_allowed",
          },
          requestedTool: {
            toolName: "live_env.request_interim_voice_callout",
            args: {
              kind: "tool_result",
              text: "Night appears to be approaching while you are outside; consider shelter or light.",
              max_chars: 140,
              evidence_refs: [darkerMail.mailId],
              reason_codes: ["minecraft_darkness_risk"],
            },
          },
          activeJobId: policy.jobId,
          now: "2026-06-04T12:20:07.000Z",
        });
        return {
          turn_id: "ask:minecraft-darker",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: decision,
              },
            },
          ],
        };
      },
    });

    expect(getStagePlayLiveSourceNarrativeState(priorNarrative.narrativeStateId)?.staleness.state).toBe("stale_after_new_mail");
    const darkerRows = listStagePlayLiveSourceMailTranscriptEntries({ threadId, askTurnId: "ask:minecraft-darker" })
      .map((entry) => entry.row);
    const rowKinds = darkerRows.map((row) => row.rowKind);
    expect(rowKinds.indexOf("prediction_check")).toBeGreaterThan(rowKinds.indexOf("mail_received"));
    expect(rowKinds.indexOf("agent_decision")).toBeGreaterThan(rowKinds.indexOf("prediction_check"));
    expect(rowKinds.indexOf("voice_tool_call")).toBeGreaterThan(rowKinds.indexOf("voice_callout_request"));
    expect(darkerRows.find((row) => row.title === "Observation mail")?.body).toBe("Lighting darker; player outdoors.");
    expect(darkerRows.find((row) => row.title === "Prediction check")?.body).toContain("Prior prediction is stale after new mail");
    expect(darkerRows.find((row) => row.title === "Agent decision")?.body).toContain("request_voice_callout");
    expect(darkerRows.find((row) => row.title === "Voice callout draft")?.body)
      .toBe("Night appears to be approaching while you are outside; consider shelter or light.");
    expect(darkerRows.find((row) => row.title === "Voice tool call")?.body).toContain("live_env.request_interim_voice_callout");
    expect(darkerRows.find((row) => row.title === "Loop state")?.body).toBe("Armed for the next live-source update.");
    expect(JSON.stringify([...daylightRows, ...darkerRows])).not.toMatch(/\"question\":|fake user|raw_image|data:image|base64/i);
  });

  it("binds wake Ask prompts to the active watch-job objective and compact mail batch", async () => {
    const priorDecision = recordStagePlayMailDecision({
      threadId,
      roomId,
      mailIds: ["stage_play_live_source_mail:prior-policy-bound"],
      decision: "wait_for_next_summary",
      rationalePreview: "Prior harmless camera movement did not match the hostile mob objective.",
      createdAt: "2026-06-04T12:00:15.000Z",
    });
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:policy-bound-harmless",
      evidenceRef: "visual_evidence:policy-bound-harmless",
      summaryText: "Harmless Minecraft-like scene change: camera pans across the base and a cat remains nearby.",
      createdAt: "2026-06-04T12:00:20.000Z",
    });
    const { policy } = configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceIds: [sourceId],
      objectiveText: "Watch the visual source and only announce if a hostile mob appears.",
      decisionPolicyPrompt: "Only announce hostile mobs. Ignore harmless camera movement and ordinary scene changes.",
      importanceCriteria: ["hostile mob appears"],
      suppressCriteria: ["harmless camera movement", "ordinary scene changes"],
      outputPolicy: {
        allowTextAnswer: true,
        allowVoiceCallout: true,
        voiceRequiresUrgency: true,
        confirmationRequired: false,
      },
    });
    const task = enqueueStagePlayLiveSourceTask({
      threadId,
      roomId,
      jobId: policy.jobId,
      policyId: policy.policyId,
      sourceIds: [sourceId],
      mailIds: [mail.mailId],
      taskKind: "voice_callout_candidate",
      priority: "urgent",
      evidenceRefs: [mail.mailId],
      now: "2026-06-04T12:00:21.000Z",
    });
    const conversationEvent = recordStagePlayLiveSourceConversationEvent({
      threadId,
      jobId: policy.jobId,
      source: "user_text",
      text: "Should I go back or keep mining if a hostile mob appears?",
      mailIds: [mail.mailId],
      watchJobPolicyRef: policy.policyId,
      now: "2026-06-04T12:00:22.000Z",
    });
    const heldCallout = recordStagePlayHeldCallout({
      threadId,
      roomId,
      jobId: policy.jobId,
      decisionId: priorDecision.decisionId,
      mailIds: [mail.mailId],
      text: "Hostile mob may be approaching.",
      status: "held_user_speaking",
      evidenceRefs: [priorDecision.decisionId, mail.mailId],
      now: "2026-06-04T12:00:23.000Z",
    });

    let prompt = "";
    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      askTurnRunner: async (input) => {
        prompt = input.prompt;
        return {
          turn_id: "ask:wake-policy-bound-hostile",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: {
                  artifactId: "stage_play_live_source_mail_decision",
                  decisionId: "stage_play_live_source_mail_decision:wake-policy-bound-hostile",
                  decision: "wait_for_next_summary",
                  mailIds: input.wakeRequest.mailIds,
                },
              },
            },
          ],
        };
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      decisionIds: ["stage_play_live_source_mail_decision:wake-policy-bound-hostile"],
    });
    expect(prompt).toContain("Continuing live-source watch job:");
    expect(prompt).toContain("Watch the visual source and only announce if a hostile mob appears.");
    expect(prompt).toContain("Decision policy:");
    expect(prompt).toContain("Only announce hostile mobs.");
    expect(prompt).toContain("The mail is perturbation evidence for this continuing job.");
    expect(prompt).toContain("Do not claim visual evidence is unavailable when the unread mail refs or compact summaries below exist.");
    expect(prompt).toContain("Prior decisions:");
    expect(prompt).toContain(priorDecision.decisionId);
    expect(prompt).toContain("Prior harmless camera movement did not match the hostile mob objective.");
    expect(prompt).toContain(mail.mailId);
    expect(prompt).toContain("Harmless Minecraft-like scene change");
    expect(prompt).toContain("voiceEnabled: true");
    expect(prompt).toContain("Current task: voice_callout_candidate");
    expect(prompt).toContain("Active user prompt context: true");
    expect(prompt).toContain("Task queue state:");
    expect(prompt).toContain(task.taskId);
    expect(prompt).toContain("If current task is voice_callout_candidate: confirm salience and voice policy before requesting voice callout");
    expect(prompt).toContain("If active user prompt context is true: answer the user first, and merge or recheck held callouts");
    expect(prompt).toContain("Conversation steering context:");
    expect(prompt).toContain(conversationEvent.eventId);
    expect(prompt).toContain("Should I go back or keep mining");
    expect(prompt).toContain("Held callouts:");
    expect(prompt).toContain(heldCallout.calloutId);
    expect(prompt).toContain("Hostile mob may be approaching.");
    expect(prompt).toContain("Latest prediction error receipt:");
    expect(prompt).toContain("Live-source voice must come from a model-reviewed mail decision.");
    expect(prompt).toContain(policy.policyId);
  });

  it("binds generated describe-each-batch policy into future wake prompts and records draft text for non-empty mail", async () => {
    const configureObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_live_source_watch_job",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        objective: "Watch the active visual source and describe each new mail batch in one sentence.",
      },
    });
    const configured = configureObservation.observation as any;
    const policy = configured.policy;
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:describe-each-batch",
      evidenceRef: "visual_evidence:describe-each-batch",
      summaryText: "Minecraft-like scene with a player near a book stand, a cat, and moonlit mountains.",
      createdAt: "2026-06-04T12:00:40.000Z",
    });

    let prompt = "";
    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      askTurnRunner: async (input) => {
        prompt = input.prompt;
        return {
          turn_id: "ask:wake-describe-each-batch",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: {
                  artifactId: "stage_play_live_source_mail_decision",
                  decisionId: "stage_play_live_source_mail_decision:wake-describe-each-batch:draft_text_answer",
                  decision: "draft_text_answer",
                  mailIds: input.wakeRequest.mailIds,
                  textAnswerDraft: {
                    text: "The visual summary shows a Minecraft-like scene with a player near a book stand, a cat, and moonlit mountains.",
                    terminalEligible: true,
                  },
                },
              },
            },
          ],
        };
      },
    });

    expect(configured).toMatchObject({
      artifactId: "stage_play_live_source_watch_job_policy_config_result",
      policy: {
        objectiveText: "Watch the active visual source and describe each new visual-summary mail batch in one sentence.",
        interpretationMode: "latest_scene_answer",
        decisionPolicyPrompt: expect.stringContaining("If the mail batch contains any compact visual summary, record draft_text_answer."),
      },
    });
    expect(result).toMatchObject({
      status: "completed",
      askTurnId: "ask:wake-describe-each-batch",
      decisionIds: ["stage_play_live_source_mail_decision:wake-describe-each-batch:draft_text_answer"],
    });
    expect(prompt).toContain("Continuing live-source watch job:");
    expect(prompt).toContain("Watch the active visual source and describe each new visual-summary mail batch in one sentence.");
    expect(prompt).toContain(`Watch policy ref: ${policy.policyId}`);
    expect(prompt).toContain("Interpretation mode: latest_scene_answer");
    expect(prompt).toContain("Decision policy:");
    expect(prompt).toContain("For each unread mail batch, read the listed mail refs as the current observation window.");
    expect(prompt).toContain("If the mail batch contains any compact visual summary, record draft_text_answer.");
    expect(prompt).toContain("The textAnswerDraft must be one sentence describing what was observed.");
    expect(prompt).toContain("Do not claim visual evidence is unavailable when the unread mail refs or compact summaries below exist.");
    expect(prompt).toContain("Importance criteria:");
    expect(prompt).toContain("Any new visual-summary mail batch should produce a one-sentence text answer.");
    expect(prompt).toContain("Suppress criteria:");
    expect(prompt).toContain("Suppress only if no unread mail items exist or mail lacks compact summary text.");
    expect(prompt).toContain(mail.mailId);
    expect(prompt).toContain("Minecraft-like scene with a player near a book stand");
  });

  it("injects the active interpreter profile into wake prompts", async () => {
    const { policy } = configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceIds: [sourceId],
      objectiveText: "Watch the Minecraft visual source and interpret each mail batch like a survival coach.",
      decisionPolicyPrompt: "Interpret each non-empty visual-summary mail batch against the active survival-coach profile.",
      importanceCriteria: ["hostile mobs", "low light", "strategic resources"],
      suppressCriteria: ["routine walking"],
      interpretationMode: "batch_interpretation",
    });
    const profile = recordStagePlayLiveSourceInterpreterProfile(
      buildStagePlayLiveSourceInterpreterProfileV1({
        profileId: "stage_play_live_source_interpreter_profile:minecraft-survival-coach",
        title: "Minecraft Survival Coach",
        threadId,
        roomId,
        environmentId: null,
        jobId: policy.jobId,
        policyId: policy.policyId,
        sourceKinds: ["visual_frame"],
        domain: "minecraft",
        objectiveText: "Coach the user through Minecraft survival decisions from compact visual summaries.",
        interpretationGuidelines: "Preserve visible observations, separate them from inferred danger, and compare updates to survival priorities.",
        lenses: ["survival", "hazards", "resources"],
        salienceCriteria: ["hostile mob", "cave exploration", "low health"],
        suppressCriteria: ["routine walking", "unchanged menu"],
        riskCriteria: ["low light", "lava", "hostile mob nearby"],
        opportunityCriteria: ["rare resource", "shelter", "crafting table"],
        voiceCalloutCriteria: ["urgent danger", "hostile mob nearby"],
        evidenceRules: {
          preserveRawObservation: true,
          distinguishObservedVsInferred: true,
          requireEvidenceRefs: true,
          askWhenUncertain: true,
        },
        outputStyle: {
          textAnswerStyle: "brief_explanation",
          voiceStyle: "short_callout",
        },
        linkedNoteId: null,
        linkedNoteTitle: null,
        status: "active",
        evidenceRefs: [policy.policyId],
        createdAt: "2026-06-04T12:00:50.000Z",
        updatedAt: "2026-06-04T12:00:50.000Z",
      }),
    );
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:profile-wake",
      evidenceRef: "visual_evidence:profile-wake",
      summaryText: "Minecraft-like scene in a dim cave corridor with a visible crafting table and no confirmed hostile mob.",
      createdAt: "2026-06-04T12:00:55.000Z",
    });

    let prompt = "";
    let evidenceRefs: string[] = [];
    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      askTurnRunner: async (input) => {
        prompt = input.prompt;
        evidenceRefs = input.evidenceRefs;
        return {
          turn_id: "ask:wake-with-active-interpreter-profile",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: {
                  artifactId: "stage_play_live_source_mail_decision",
                  decisionId: "stage_play_live_source_mail_decision:wake-with-active-interpreter-profile",
                  decision: "record_interpretation",
                  mailIds: input.wakeRequest.mailIds,
                  interpreterProfileRef: profile.profileId,
                },
              },
            },
          ],
        };
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      askTurnId: "ask:wake-with-active-interpreter-profile",
      decisionIds: ["stage_play_live_source_mail_decision:wake-with-active-interpreter-profile"],
    });
    expect(evidenceRefs).toEqual(expect.arrayContaining([profile.profileId, policy.policyId, mail.mailId]));
    expect(prompt).toContain("Active interpreter profile:");
    expect(prompt).toContain(`Profile ref: ${profile.profileId}`);
    expect(prompt).toContain("Title: Minecraft Survival Coach");
    expect(prompt).toContain("Domain: minecraft");
    expect(prompt).toContain("Objective: Coach the user through Minecraft survival decisions from compact visual summaries.");
    expect(prompt).toContain("Guidelines:");
    expect(prompt).toContain("Preserve visible observations, separate them from inferred danger");
    expect(prompt).toContain("Salience criteria:");
    expect(prompt).toContain("- cave exploration");
    expect(prompt).toContain("Suppress criteria:");
    expect(prompt).toContain("- routine walking");
    expect(prompt).toContain("Risk criteria:");
    expect(prompt).toContain("- low light");
    expect(prompt).toContain("Opportunity criteria:");
    expect(prompt).toContain("- crafting table");
    expect(prompt).toContain("Voice callout criteria:");
    expect(prompt).toContain("- hostile mob nearby");
    expect(prompt).toContain("Evidence rules:");
    expect(prompt).toContain("- preserve raw observation: true");
    expect(prompt).toContain("- distinguish observed vs inferred: true");
    expect(prompt).toContain("- require evidence refs: true");
    expect(prompt).toContain("- ask when uncertain: true");
    expect(prompt).toContain("Interpreter profile instructions:");
    expect(prompt).toContain("Preserve observed facts from the mail summaries.");
    expect(prompt).toContain("Compare observed facts against the active interpreter profile when one exists.");
    expect(prompt).toContain("Do not overwrite observations with profile assumptions.");
    expect(prompt).toContain("State matched and suppressed criteria when a profile is active.");
    expect(prompt).toContain("Use profile comparison to choose wait, interpretation, text, voice, or checkpoint.");
    expect(prompt).toContain(mail.mailId);
    expect(prompt).toContain("dim cave corridor");
  });

  it("binds generated interpretation policy into future wake prompts", () => {
    const configureObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_live_source_watch_job",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        objective: "Watch the active visual source, interpret what is happening across the summaries, predict what might happen next, and say what should be watched next.",
      },
    });
    const configured = configureObservation.observation as any;

    expect(configured).toMatchObject({
      artifactId: "stage_play_live_source_watch_job_policy_config_result",
      policy: {
        objectiveText: "Watch the active visual source, interpret what is happening across the summaries, predict what might happen next, and say what should be watched next.",
        interpretationMode: "prediction_watch",
        decisionPolicyPrompt: expect.stringContaining("record the decision record_interpretation"),
        outputPolicy: expect.objectContaining({
          allowTextAnswer: true,
          allowVoiceCallout: false,
        }),
        importanceCriteria: expect.arrayContaining([
          expect.stringContaining("interpret, compare, predict, or decide what to watch next"),
        ]),
      },
    });
    expect(configured.transcriptRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rowKind: "loop_state",
        body: "Loop state: armed for next summary.",
      }),
    ]));
  });

  it("does not treat negated narration wording as a voice commentary watch policy", () => {
    const defaults = buildStagePlayLiveSourceWatchJobPolicyDefaults(
      "Watch the active visual source as a Minecraft video predictor. Interpret chronological micro-batches, make cautious predictions, and say what should be watched next. Do not narrate every frame; only use short text checkpoints unless danger or a major scene transition appears.",
    );

    expect(defaults).toMatchObject({
      interpretationMode: "prediction_watch",
      mailProcessingMode: "chronological_batch",
      outputCadence: "only_salient",
      outputPolicy: expect.objectContaining({
        allowTextAnswer: true,
        allowVoiceCallout: false,
      }),
    });
  });

  it("includes latest narrative state in wake prompts before interpreting new mail", async () => {
    const { policy } = configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceIds: [sourceId],
      objectiveText: "Watch the visual source, interpret what is happening, predict likely next changes, and say what to watch next.",
      decisionPolicyPrompt: "Interpret each non-empty visual-summary mail batch against the current story and update watch-next targets.",
      importanceCriteria: ["scene changes", "new app/window content", "risk appears"],
      suppressCriteria: ["no meaningful visual change"],
    });
    const narrative = recordStagePlayLiveSourceNarrativeState({
      threadId,
      roomId,
      jobId: policy.jobId,
      policyId: policy.policyId,
      sourceIds: [sourceId],
      mailBatchRefs: ["stage_play_live_source_mail:prior-story"],
      sourceEvidenceRefs: ["visual_evidence:prior-story"],
      currentSceneSummary: "The source showed a dark app-launcher interface.",
      runningStorySummary: "The live source has been stable on a dark app-launcher/productivity interface.",
      interpretedSituation: {
        setting: "desktop visual source",
        activeWindowOrScene: "dark app launcher",
        objects: ["icon grid", "productivity apps"],
        activities: ["app navigation"],
        userRelevantMeaning: "The visual source appears stable and focused on app navigation rather than active gameplay or video.",
      },
      meaningfulChanges: ["No active app has opened yet."],
      uncertainties: ["The exact selected app is unknown from compact mail only."],
      watchNext: {
        targets: ["active window change", "opened app", "new content replacing the grid"],
        reason: "Watch for the launcher to transition into a specific app or content view.",
      },
      prediction: {
        text: "The next mail may show either the same launcher grid or an opened app replacing it.",
        horizon: "next_mail",
        confidence: 0.58,
        validationSignals: ["same launcher grid remains", "opened app replaces icon grid"],
      },
      createdAt: "2026-06-04T12:01:00.000Z",
    });
    expect(policy.interpretationMode).toBe("prediction_watch");
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:narrative-wake-next",
      evidenceRef: "visual_evidence:narrative-wake-next",
      summaryText: "The dark app launcher is still visible, with a grid of productivity and social app icons.",
      createdAt: "2026-06-04T12:01:10.000Z",
    });

    let prompt = "";
    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      askTurnRunner: async (input) => {
        prompt = input.prompt;
        return {
          turn_id: "ask:wake-with-prior-narrative",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: {
                  artifactId: "stage_play_live_source_mail_decision",
                  decisionId: "stage_play_live_source_mail_decision:wake-with-prior-narrative",
                  decision: "record_interpretation",
                  mailIds: input.wakeRequest.mailIds,
                  narrativeStateRef: "stage_play_live_source_narrative_state:wake-with-prior-narrative",
                },
              },
            },
          ],
        };
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      askTurnId: "ask:wake-with-prior-narrative",
    });
    expect(getStagePlayLiveSourceNarrativeState(narrative.narrativeStateId)).toMatchObject({
      staleness: {
        state: "stale_after_new_mail",
        staleAfterMailId: mail.mailId,
      },
    });
    expect(prompt).toContain("Interpretation mode: prediction_watch");
    expect(prompt).toContain("Latest narrative state:");
    expect(prompt).toContain(narrative.narrativeStateId);
    expect(prompt).toContain("staleness: stale_after_new_mail");
    expect(prompt).toContain("running_story_summary: The live source has been stable on a dark app-launcher/productivity interface.");
    expect(prompt).toContain("active_window_or_scene: dark app launcher");
    expect(prompt).toContain("user_relevant_meaning: The visual source appears stable and focused on app navigation rather than active gameplay or video.");
    expect(prompt).toContain("targets: active window change, opened app, new content replacing the grid");
    expect(prompt).toContain("last_prediction:");
    expect(prompt).toContain("The next mail may show either the same launcher grid or an opened app replacing it.");
    expect(prompt).toContain("Prior prediction:");
    expect(prompt).toContain("validation_signals: same launcher grid remains | opened app replaces icon grid");
    expect(prompt).toContain("If the new mail supports the prediction, include a meaningfulChanges entry beginning with \"Prediction supported:\".");
    expect(prompt).toContain("If the new mail contradicts the prediction, include a meaningfulChanges entry beginning with \"Prediction contradicted:\".");
    expect(prompt).toContain("If a prior prediction is listed below, compare the unread mail batch to its validation signals.");
    expect(prompt).toContain("If the policy asks to interpret, compare, explain what is happening, predict, or say what to watch next, choose record_interpretation.");
    expect(prompt).toContain("When choosing record_interpretation: include a concise batch interpretation, update the running story");
    expect(prompt).toContain(mail.mailId);
  });

  it("lets the same mail summary produce different wake decisions under different job policies", async () => {
    const runWithPolicy = async (input: {
      objectiveText: string;
      decisionPolicyPrompt: string;
      expectedDecision: "wait_for_next_summary" | "draft_text_answer";
      turnId: string;
    }) => {
      resetStagePlayLiveSourceMailboxForTest();
      resetStagePlayLiveSourceMailWakeStoreForTest();
      const mail = enqueueStagePlayLiveSourceMailItem({
        threadId,
        roomId,
        sourceId,
        sourceKind: "visual_frame",
        frameRef: "visual_frame:same-summary-scene-change",
        evidenceRef: "visual_evidence:same-summary-scene-change",
        summaryText: "Minecraft-like scene change: the camera pans from the base interior to the moonlit mountain view. No hostile mobs are visible.",
        createdAt: "2026-06-04T12:00:30.000Z",
      });
      configureStagePlayLiveSourceWatchJobPolicy({
        threadId,
        roomId,
        sourceIds: [sourceId],
        objectiveText: input.objectiveText,
        decisionPolicyPrompt: input.decisionPolicyPrompt,
        importanceCriteria: [input.expectedDecision === "draft_text_answer" ? "every scene change" : "hostile mob appears"],
        suppressCriteria: [input.expectedDecision === "wait_for_next_summary" ? "harmless scene changes" : "none"],
      });

      let prompt = "";
      const result = await runNextMailWakeRequest({
        threadId,
        roomId,
        askTurnRunner: async (runnerInput) => {
          prompt = runnerInput.prompt;
          const decisionId = `stage_play_live_source_mail_decision:${input.turnId}:${input.expectedDecision}`;
          return {
            turn_id: input.turnId,
            current_turn_artifact_ledger: [
              {
                kind: "live_environment_tool_observation",
                payload: {
                  tool_name: "live_env.record_live_source_mail_decision",
                  observation: {
                    artifactId: "stage_play_live_source_mail_decision",
                    decisionId,
                    decision: input.expectedDecision,
                    mailIds: runnerInput.wakeRequest.mailIds,
                  },
                },
              },
            ],
          };
        },
      });
      return { mail, prompt, result };
    };

    const hostileOnly = await runWithPolicy({
      objectiveText: "Watch the visual source and only announce if a hostile mob appears.",
      decisionPolicyPrompt: "Only announce hostile mobs. Harmless scene changes should wait for the next summary.",
      expectedDecision: "wait_for_next_summary",
      turnId: "ask:wake-same-mail-hostile-policy",
    });
    const everySceneChange = await runWithPolicy({
      objectiveText: "Watch the visual source and tell me every scene change.",
      decisionPolicyPrompt: "Tell me every scene change. Draft a text answer when the compact summary reports a scene change.",
      expectedDecision: "draft_text_answer",
      turnId: "ask:wake-same-mail-scene-policy",
    });

    expect(hostileOnly.mail.summary.text).toBe(everySceneChange.mail.summary.text);
    expect(hostileOnly.prompt).toContain("Only announce hostile mobs.");
    expect(everySceneChange.prompt).toContain("Tell me every scene change.");
    expect(hostileOnly.result?.decisionIds[0]).toContain("wait_for_next_summary");
    expect(everySceneChange.result?.decisionIds[0]).toContain("draft_text_answer");
    expect(hostileOnly.prompt).toContain("Do not claim visual evidence is unavailable when the unread mail refs or compact summaries below exist.");
    expect(everySceneChange.prompt).toContain("Do not claim visual evidence is unavailable when the unread mail refs or compact summaries below exist.");
  });

  it("does not complete a wake from a generic agent-step decision without a mail decision receipt", async () => {
    seedVisualEvidence();

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      askTurnRunner: async () => ({
        turn_id: "ask:wake-missing-mail-decision",
        current_turn_artifact_ledger: [
          {
            kind: "agent_step_decision",
            payload: {
              decision_id: "ask:wake-missing-mail-decision:agent_step_decision",
              chosen_capability: "model.direct_answer",
            },
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      artifactId: "stage_play_live_source_mail_wake_result",
      status: "failed_terminal",
      askTurnId: "ask:wake-missing-mail-decision",
      failedReason: "mail_wake_decision_missing",
      decisionIds: [],
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "failed_terminal",
      decisionIds: [],
    });
  });

  it("does not treat an Ask launch payload without a turn id as entered into Ask", async () => {
    seedVisualEvidence();

    const startedAtMs = Date.now();
    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:00:45.000Z",
      askTurnRunner: async () => ({
        current_turn_artifact_ledger: [
          {
            kind: "live_environment_tool_observation",
            payload: {
              tool_name: "live_env.record_live_source_mail_decision",
              observation: {
                artifactId: "stage_play_live_source_mail_decision",
                decisionId: "stage_play_live_source_mail_decision:missing-ask-turn-id",
              },
            },
          },
        ],
      }),
    });
    const elapsedMs = Date.now() - startedAtMs;

    expect(result).toMatchObject({
      artifactId: "stage_play_live_source_mail_wake_result",
      status: "failed_retryable",
      askTurnId: null,
      failedReason: "ask_launch_missing_ask_turn_id",
      decisionIds: [],
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(elapsedMs).toBeLessThan(5_000);
    expect(result?.failedReason).not.toMatch(/^ask_launch_no_response_timeout:/);
    expect(result?.evidenceRefs).toEqual(expect.arrayContaining([
      "stage_play_wake_ask_launch_missing_ask_turn_id",
    ]));
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "failed_retryable",
      askTurnId: null,
      askLaunchId: expect.stringMatching(/^stage_play_live_source_mail_wake_launch:/),
      askLaunchStatus: "missing_turn_id",
      askLaunchStartedAt: expect.any(String),
      askLaunchCompletedAt: expect.any(String),
      failureReason: "ask_launch_missing_ask_turn_id",
      decisionIds: [],
    });
    expect(listStagePlayMailDecisions({ threadId })).toHaveLength(0);
    const transcriptEntries = listStagePlayLiveSourceMailTranscriptEntries({ threadId });
    expect(transcriptEntries.map((entry) => entry.row.title)).toEqual(expect.arrayContaining([
      "Wake Ask launch missing turn id",
      "Loop state",
    ]));
    expect(transcriptEntries.map((entry) => entry.row.body).join("\n")).toContain(
      "Ask returned a launch payload without an Ask turn id",
    );
  });

  it("passes structured live-source mailbox route metadata to Ask wake launches", async () => {
    seedVisualEvidence();
    let capturedRouteMetadata: Record<string, unknown> | null = null;

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:00:47.000Z",
      askTurnRunner: async (input) => {
        capturedRouteMetadata = input.routeMetadata ?? null;
        return {
          turn_id: "ask:wake-route-metadata",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: {
                  artifactId: "stage_play_live_source_mail_decision",
                  decisionId: "stage_play_live_source_mail_decision:wake-route-metadata",
                },
              },
            },
          ],
        };
      },
    });

    expect(result?.askTurnId).toBe("ask:wake-route-metadata");
    expect(capturedRouteMetadata).toMatchObject({
      invocationKind: "stage_play_mail_wake",
      sourceTarget: "live_source_mailbox",
      mailboxThreadId: threadId,
      requiredCanonicalGoal: "processed_mail_interpretation",
      requiredPhase: "record_interpretation",
      mandatoryNextTool: "live_env.record_live_source_mail_decision",
    });
    expect(capturedRouteMetadata?.wakeRequestId).toMatch(/^stage_play_live_source_mail_wake:/);
    expect(capturedRouteMetadata?.allowedCapabilities).toEqual(expect.arrayContaining([
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
    ]));
    expect(capturedRouteMetadata?.forbiddenCapabilities).toEqual(expect.arrayContaining([
      "workspace_os.status",
      "internet-search.search_web",
    ]));
  });

  it("normalizes structured Ask wake launch results and stores launch projection metadata", async () => {
    seedVisualEvidence();

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:00:48.000Z",
      askTurnRunner: async (input) => ({
        ok: true,
        askTurnId: "ask:wake-launch-result",
        selectedTargetSource: "live_source_mailbox",
        selectedCapability: "live_env.record_live_source_mail_decision",
        routeMetadata: input.routeMetadata ?? undefined,
        response: {
          turn_id: "ask:wake-launch-result",
          selected_target_source: "live_source_mailbox",
          selected_capability: "live_env.record_live_source_mail_decision",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: {
                  artifactId: "stage_play_live_source_mail_decision",
                  decisionId: "stage_play_live_source_mail_decision:wake-launch-result",
                },
              },
            },
          ],
        },
        errorCode: null,
        errorMessage: null,
      }),
    });

    expect(result?.askTurnId).toBe("ask:wake-launch-result");
    const wake = listStagePlayLiveSourceMailWakeRequests({ threadId })[0];
    expect(wake).toMatchObject({
      askTurnId: "ask:wake-launch-result",
      askLaunchStatus: "completed",
      askLaunchRouteMetadata: expect.objectContaining({
        selectedTargetSource: "live_source_mailbox",
        selectedCapability: "live_env.record_live_source_mail_decision",
        sourceTarget: "live_source_mailbox",
      }),
    });
  });

  it("defers 503 wake failures for retry without recording a mail decision", async () => {
    seedVisualEvidence();

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:00.000Z",
      askTurnRunner: async () => {
        throw new Error("mail_wake_ask_turn_failed:503");
      },
    });

    expect(result).toMatchObject({
      status: "deferred_for_pressure",
      failedReason: "ask_turn_pressure_503",
      decisionIds: [],
    });
    const wake = listStagePlayLiveSourceMailWakeRequests({ threadId })[0];
    expect(wake).toMatchObject({
      status: "deferred_for_pressure",
      attemptCount: 1,
      lastAttemptAt: "2026-06-04T12:01:00.000Z",
      nextRetryAt: "2026-06-04T12:01:15.000Z",
      failureReason: "ask_turn_pressure_503",
    });
    expect(listStagePlayLiveSourceMailItems({ threadId })[0].status).toBe("unread");
    expect(listStagePlayMailDecisions({ threadId })).toHaveLength(0);
    const transcriptEntries = listStagePlayLiveSourceMailTranscriptEntries({ threadId });
    expect(transcriptEntries.map((entry) => entry.row.rowKind)).toEqual(expect.arrayContaining([
      "mail_received",
      "processed_mail_packet",
      "micro_reasoner_run",
      "mail_wake_requested",
      "mail_wake_deferred",
      "loop_state",
    ]));
    expect(transcriptEntries.map((entry) => entry.row.title)).toEqual(expect.arrayContaining([
      "Processed mail packet",
      "Decision selected",
    ]));
    expect(transcriptEntries.find((entry) => entry.row.title === "Wake requested")?.row.body)
      .toContain("decision_selector selected");
    expect(transcriptEntries.every((entry) => entry.wakeResultId === result?.wakeResultId)).toBe(true);
    expect(result?.evidenceRefs).toEqual(expect.arrayContaining(transcriptEntries.map((entry) => entry.entryId)));
  });

  it("records an Ask timeout as a retryable non-authoritative wake transcript", async () => {
    seedVisualEvidence();

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:10.000Z",
      askTurnRunner: async () => {
        throw new Error("mail_wake_ask_turn_timeout:120000");
      },
    });

    expect(result).toMatchObject({
      status: "failed_retryable",
      failedReason: "ask_launch_no_response_timeout:120000",
      askTurnId: null,
      decisionIds: [],
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(listStagePlayLiveSourceMailItems({ threadId })[0].status).toBe("unread");
    expect(listStagePlayMailDecisions({ threadId })).toHaveLength(0);
    const transcriptEntries = listStagePlayLiveSourceMailTranscriptEntries({ threadId });
    expect(transcriptEntries.map((entry) => entry.row.title)).toEqual(expect.arrayContaining([
      "Processed mail packet",
      "Decision selected",
      "Wake Ask launch timed out",
      "Loop state",
    ]));
    expect(transcriptEntries.map((entry) => entry.row.rowKind)).toEqual(expect.arrayContaining([
      "micro_reasoner_run",
    ]));
    expect(transcriptEntries.find((entry) => entry.row.title === "Wake requested")?.row.body)
      .toContain("decision_selector selected");
    expect(transcriptEntries.map((entry) => entry.row.body).join("\n")).toContain(
      "Ask did not return a turn id or mailbox decision",
    );
  });

  it("records a completed wake result when reconciliation finds a later mailbox decision", () => {
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:reconcile",
      evidenceRef: "visual_evidence:reconcile",
      summaryText: "A visual summary arrived before a direct Ask mailbox decision.",
      createdAt: "2026-06-04T12:01:12.000Z",
    });
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: [mail.mailId],
      sourceIds: [sourceId],
      reason: "unread_mail",
      evidenceRefs: [mail.mailId, ...mail.evidenceRefs],
      now: "2026-06-04T12:01:13.000Z",
    });
    expect(wake?.status).toBe("queued");

    const decision = recordStagePlayMailDecision({
      mailIds: [mail.mailId],
      threadId,
      roomId,
      decision: "record_interpretation",
      rationalePreview: "Direct Ask recorded a model-reviewed mailbox interpretation.",
      nextLoopState: "armed_for_next_summary",
      evidenceRefs: [mail.mailId, "ask:direct-mailbox-turn"],
      modelReviewed: true,
      createdAt: "2026-06-04T12:01:14.000Z",
    });

    const reconciled = reconcileStagePlayMailWakeRequestsWithDecisions({
      threadId,
      roomId,
      decisions: [decision],
      now: "2026-06-04T12:01:15.000Z",
    });

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "completed",
      lifecycleStage: "completed",
      askTurnId: "ask:direct-mailbox-turn",
      decisionIds: [decision.decisionId],
    });
    expect(listStagePlayLiveSourceMailWakeResults({ threadId })).toEqual([
      expect.objectContaining({
        wakeRequestId: wake?.wakeRequestId,
        status: "completed",
        lifecycleStage: "completed",
        askTurnId: "ask:direct-mailbox-turn",
        decisionIds: [decision.decisionId],
      }),
    ]);
  });

  it("does not complete a voice wake from a decision receipt without a voice checkpoint", () => {
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:voice-reconcile-no-checkpoint",
      evidenceRef: "visual_evidence:voice-reconcile-no-checkpoint",
      summaryText: "A visual summary produced a voice candidate.",
      createdAt: "2026-06-04T12:01:16.000Z",
    });
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: [mail.mailId],
      sourceIds: [sourceId],
      reason: "unread_mail",
      evidenceRefs: [mail.mailId, ...mail.evidenceRefs],
      now: "2026-06-04T12:01:17.000Z",
    });
    expect(wake?.status).toBe("queued");

    const decision = recordStagePlayMailDecision({
      mailIds: [mail.mailId],
      threadId,
      roomId,
      decision: "request_voice_callout",
      rationalePreview: "Direct Ask recorded a voice callout decision.",
      voiceCalloutDraft: "Damage cue detected; create distance.",
      voiceEligible: true,
      requestedTool: {
        toolName: "live_env.request_interim_voice_callout",
        args: { text: "Damage cue detected; create distance." },
      },
      nextLoopState: "armed_for_next_summary",
      evidenceRefs: [mail.mailId, "ask:voice-decision-without-checkpoint"],
      modelReviewed: true,
      createdAt: "2026-06-04T12:01:18.000Z",
    });

    const reconciled = reconcileStagePlayMailWakeRequestsWithDecisions({
      threadId,
      roomId,
      decisions: [decision],
      now: "2026-06-04T12:01:19.000Z",
    });

    expect(reconciled).toEqual([]);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "running",
      lifecycleStage: "voice_pending",
      lifecycleReason: "decision_recorded_waiting_for_voice_receipt",
      decisionIds: [decision.decisionId],
    });
    expect(listStagePlayLiveSourceMailWakeResults({ threadId })).toEqual([]);

    const uiReconciliation = reconcileStagePlayMailWakeRequestFromAskTurn({
      wakeRequestIds: [wake!.wakeRequestId],
      askTurnId: "ask:voice-decision-without-checkpoint",
      decisionIds: [decision.decisionId],
      requiresVoiceCheckpoint: true,
      mailIds: [mail.mailId],
      now: "2026-06-04T12:01:20.000Z",
    });
    expect(uiReconciliation.reconciledWakeIds).toEqual([]);
    expect(uiReconciliation.skippedWakeIds).toEqual([
      {
        wakeRequestId: wake?.wakeRequestId,
        reason: "missing_decision_or_voice_receipt",
      },
    ]);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "running",
      lifecycleStage: "voice_pending",
      lifecycleReason: "decision_recorded_waiting_for_voice_receipt",
      askTurnId: "ask:voice-decision-without-checkpoint",
      askLaunchStatus: "launched",
      decisionIds: [decision.decisionId],
    });
  });

  it("keeps direct wake completion in voice-pending state when a voice checkpoint is required", () => {
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:direct-complete-without-voice",
      evidenceRef: "visual_evidence:direct-complete-without-voice",
      summaryText: "A visual summary produced an urgent voice candidate.",
      createdAt: "2026-06-04T12:01:24.000Z",
    });
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: [mail.mailId],
      sourceIds: [sourceId],
      reason: "unread_mail",
      evidenceRefs: [mail.mailId, ...mail.evidenceRefs],
      now: "2026-06-04T12:01:25.000Z",
    });
    const decision = recordStagePlayMailDecision({
      mailIds: [mail.mailId],
      threadId,
      roomId,
      decision: "request_voice_callout",
      rationalePreview: "The mailbox Ask turn decided this needs voice.",
      voiceCalloutDraft: "Damage cue detected; create distance.",
      voiceEligible: true,
      requestedTool: {
        toolName: "live_env.request_interim_voice_callout",
        args: { text: "Damage cue detected; create distance." },
      },
      nextLoopState: "armed_for_next_summary",
      evidenceRefs: [mail.mailId, "ask:direct-complete-without-voice"],
      modelReviewed: true,
      createdAt: "2026-06-04T12:01:26.000Z",
    });

    const completed = markStagePlayMailWakeCompleted({
      wakeRequestId: wake!.wakeRequestId,
      askTurnId: "ask:direct-complete-without-voice",
      decisionIds: [decision.decisionId],
      evidenceRefs: [mail.mailId, decision.decisionId, "ask:direct-complete-without-voice"],
      requiresVoiceCheckpoint: true,
      now: "2026-06-04T12:01:27.000Z",
    });

    expect(completed).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "running",
      askTurnId: "ask:direct-complete-without-voice",
      askLaunchStatus: "launched",
      decisionIds: [decision.decisionId],
      lifecycleStage: "voice_pending",
      lifecycleReason: "decision_recorded_waiting_for_voice_receipt",
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "running",
      lifecycleStage: "voice_pending",
      decisionIds: [decision.decisionId],
    });
    expect(listStagePlayLiveSourceMailWakeResults({ threadId })).toEqual([]);
  });

  it("reconciles a UI-bridged Ask wake by wake id after decision and voice receipt evidence", () => {
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:ui-bridge-reconcile",
      evidenceRef: "visual_evidence:ui-bridge-reconcile",
      summaryText: "A live Minecraft packet produced a voice candidate.",
      createdAt: "2026-06-04T12:01:20.000Z",
    });
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: [mail.mailId],
      sourceIds: [sourceId],
      reason: "unread_mail",
      evidenceRefs: [mail.mailId, ...mail.evidenceRefs],
      now: "2026-06-04T12:01:21.000Z",
    });
    expect(wake?.status).toBe("queued");

    const decision = recordStagePlayMailDecision({
      mailIds: [mail.mailId],
      threadId,
      roomId,
      decision: "request_voice_callout",
      rationalePreview: "UI-bridged Ask recorded the voice callout decision.",
      voiceCalloutDraft: "Damage cue detected; create distance.",
      voiceEligible: true,
      requestedTool: {
        toolName: "live_env.request_interim_voice_callout",
        args: {
          text: "Damage cue detected; create distance.",
        },
      },
      nextLoopState: "armed_for_next_summary",
      evidenceRefs: [mail.mailId, "ask:ui-bridge-mailbox-turn"],
      modelReviewed: true,
      createdAt: "2026-06-04T12:01:22.000Z",
    });

    const reconciliation = reconcileStagePlayMailWakeRequestFromAskTurn({
      wakeRequestIds: [wake!.wakeRequestId],
      askTurnId: "ask:ui-bridge-mailbox-turn",
      decisionIds: [decision.decisionId],
      voiceReceiptRefs: ["helix_interim_voice_callout_receipt:queued-for-retry"],
      mailIds: [mail.mailId],
      evidenceRefs: ["stage_play_processed_mail_packet:ui-bridge"],
      now: "2026-06-04T12:01:23.000Z",
    });

    expect(reconciliation).toMatchObject({
      schema: "stage_play_live_source_mail_wake_reconciliation/v1",
      reconciledWakeIds: [wake?.wakeRequestId],
      wakeResultIds: [expect.stringMatching(/^stage_play_live_source_mail_wake_result:/)],
      askTurnId: "ask:ui-bridge-mailbox-turn",
      decisionIds: [decision.decisionId],
      voiceReceiptRefs: ["helix_interim_voice_callout_receipt:queued-for-retry"],
      reason: "ui_bridge_ask_turn_reconciled",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "completed",
      lifecycleStage: "voice_queued_retry",
      askTurnId: "ask:ui-bridge-mailbox-turn",
      decisionIds: [decision.decisionId],
      evidenceRefs: expect.arrayContaining([
        "helix_interim_voice_callout_receipt:queued-for-retry",
        "stage_play_processed_mail_packet:ui-bridge",
      ]),
    });
    expect(listStagePlayLiveSourceMailWakeResults({ threadId })).toEqual([
      expect.objectContaining({
        wakeRequestId: wake?.wakeRequestId,
        status: "completed",
        lifecycleStage: "voice_queued_retry",
        askTurnId: "ask:ui-bridge-mailbox-turn",
        decisionIds: [decision.decisionId],
        voiceCheckpointRefs: ["helix_interim_voice_callout_receipt:queued-for-retry"],
        evidenceRefs: expect.arrayContaining([
          "ui_bridge_ask_turn_reconciled",
          "helix_interim_voice_callout_receipt:queued-for-retry",
        ]),
      }),
    ]);
  });

  it("completes a voice wake only after read, decision, and voice checkpoint evidence", async () => {
    configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceIds: [sourceId],
      objectiveText: "Watch the Minecraft source and call out immediate combat or hazard risk.",
      decisionPolicyPrompt: "Request a voice callout when fire, damage, hostile mobs, combat, or visible danger appears.",
      outputPolicy: {
        allowTextAnswer: true,
        allowVoiceCallout: true,
        voiceRequiresUrgency: true,
        confirmationRequired: false,
      },
      importanceCriteria: ["fire, damage, hostile mobs, combat, and visible danger are urgent."],
      suppressCriteria: ["routine safe movement is not user-facing."],
      now: "2026-06-04T12:01:28.000Z",
    });
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:voice-trajectory",
      evidenceRef: "visual_evidence:voice-trajectory",
      summaryText: "Minecraft player is on fire with visible damage while holding a sword near hostile mobs.",
      createdAt: "2026-06-04T12:01:29.000Z",
    });
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: [mail.mailId],
      sourceIds: [sourceId],
      reason: "unread_mail",
      evidenceRefs: [mail.mailId, ...mail.evidenceRefs],
      now: "2026-06-04T12:01:30.000Z",
    });
    expect(wake?.status).toBe("queued");

    const simulatedAskToolOrder: string[] = [];
    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:31.000Z",
      pressureCheck: () => ({ deferred: false }),
      askTurnRunner: async ({ wakeRequest }) => {
        const packet = getLatestStagePlayProcessedMailPacket({
          sourceId,
          mailId: mail.mailId,
        });
        simulatedAskToolOrder.push("live_env.read_processed_live_source_mail");
        const decision = recordLiveSourceMailDecisionForAsk({
          threadId: wakeRequest.threadId,
          roomId: wakeRequest.roomId,
          environmentId: wakeRequest.environmentId,
          mailIds: wakeRequest.mailIds,
          decision: "request_voice_callout",
          rationalePreview: "Processed packet recommended request_voice_callout for urgent fire/damage danger.",
          voiceCalloutDraft: "Fire and damage risk visible; create distance or recover.",
          voicePolicy: {
            voiceEnabled: true,
            requiresConfirmation: false,
            allowedNow: true,
            reason: "urgent_voice_allowed",
          },
          requestedTool: {
            toolName: "live_env.request_interim_voice_callout",
            args: {
              kind: "tool_result",
              text: "Fire and damage risk visible; create distance or recover.",
              max_chars: 140,
              evidence_refs: [mail.mailId, packet?.packetId].filter(Boolean),
              reason_codes: ["minecraft_fire_or_damage_cue", "processed_packet_voice_candidate"],
            },
          },
          evidenceRefs: [mail.mailId, packet?.packetId, "ask:voice-trajectory"].filter(Boolean) as string[],
          modelReviewed: true,
          now: "2026-06-04T12:01:32.000Z",
        });
        simulatedAskToolOrder.push("live_env.record_live_source_mail_decision");
        return {
          ok: true,
          askTurnId: "ask:voice-trajectory",
          selectedTargetSource: "live_source_mailbox",
          selectedCapability: "live_env.request_interim_voice_callout",
          response: {
            turn_id: "ask:voice-trajectory",
            current_turn_artifact_ledger: [
              {
                kind: "live_environment_tool_observation",
                payload: {
                  tool_name: "live_env.read_processed_live_source_mail",
                  observation: {
                    artifactId: "stage_play_processed_mail_packet",
                    packetId: packet?.packetId,
                    packets: packet ? [packet] : [],
                  },
                },
              },
              {
                kind: "live_environment_tool_observation",
                payload: {
                  tool_name: "live_env.record_live_source_mail_decision",
                  observation: decision,
                },
              },
            ],
          },
          errorCode: null,
        };
      },
    });

    const packet = getLatestStagePlayProcessedMailPacket({
      sourceId,
      mailId: mail.mailId,
    });
    expect(packet).toMatchObject({
      recommendedNext: "request_voice_callout",
      salience: expect.objectContaining({
        level: "urgent",
        voiceCandidate: true,
      }),
    });
    expect(simulatedAskToolOrder).toEqual([
      "live_env.read_processed_live_source_mail",
      "live_env.record_live_source_mail_decision",
    ]);
    expect(result).toMatchObject({
      status: "completed",
      askTurnId: "ask:voice-trajectory",
    });
    expect(result?.decisionIds ?? []).toHaveLength(1);
    expect(result?.voiceCheckpointRefs ?? []).toEqual(expect.arrayContaining([
      expect.stringMatching(/^(?:stage_play_live_source_voice_delivery_receipt|helix_interim_voice_callout_receipt):/),
    ]));
    expect(result?.evidenceRefs ?? []).toEqual(expect.arrayContaining([
      mail.mailId,
      packet!.packetId,
      result!.decisionIds[0],
      expect.stringMatching(/^(?:stage_play_live_source_voice_delivery_receipt|helix_interim_voice_callout_receipt):/),
    ]));
    const wakeAfter = listStagePlayLiveSourceMailWakeRequests({ threadId })[0];
    expect(wakeAfter).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "completed",
      askTurnId: "ask:voice-trajectory",
      askLaunchStatus: "completed",
      decisionIds: result?.decisionIds,
    });
    expect(wakeAfter.evidenceRefs).toEqual(expect.arrayContaining(result?.voiceCheckpointRefs ?? []));
    const rows = listStagePlayLiveSourceMailTranscriptEntries({ threadId, askTurnId: "ask:voice-trajectory" })
      .map((entry) => entry.row);
    const rowKinds = rows.map((row) => row.rowKind);
    expect(rowKinds.indexOf("agent_decision")).toBeGreaterThan(rowKinds.indexOf("micro_reasoner_run"));
    expect(rowKinds.indexOf("voice_callout_request")).toBeGreaterThan(rowKinds.indexOf("agent_decision"));
    expect(rowKinds.indexOf("voice_tool_call")).toBeGreaterThan(rowKinds.indexOf("voice_callout_request"));
    expect(rowKinds.indexOf("voice_receipt")).toBeGreaterThan(rowKinds.indexOf("voice_tool_call"));
    expect(rows.find((row) => row.title === "Agent decision")?.body).toContain("request_voice_callout");
    expect(rows.find((row) => row.title === "Voice tool call")?.body).toContain("live_env.request_interim_voice_callout");
    expect(rows.find((row) => row.rowKind === "voice_receipt")?.body).toMatch(/queued|delivered|awaiting_client_playback/i);
  });

  it("reconciles a waiting UI-handoff wake from Ask transaction evidence", () => {
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:waiting-ui-transaction",
      evidenceRef: "visual_evidence:waiting-ui-transaction",
      summaryText: "A waiting UI handoff wake later produced a voice checkpoint.",
      createdAt: "2026-06-04T12:01:24.000Z",
    });
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: [mail.mailId],
      sourceIds: [sourceId],
      reason: "unread_mail",
      evidenceRefs: [mail.mailId, ...mail.evidenceRefs],
      now: "2026-06-04T12:01:25.000Z",
    });
    expect(wake?.status).toBe("queued");
    markStagePlayMailWakeUiHandoffRequired({
      wakeRequestId: wake!.wakeRequestId,
      now: "2026-06-04T12:01:26.000Z",
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "waiting_for_ui_handoff",
      lifecycleStage: "waiting_for_ui_handoff",
    });

    const decision = recordStagePlayMailDecision({
      mailIds: [mail.mailId],
      threadId,
      roomId,
      decision: "request_voice_callout",
      rationalePreview: "Transaction evidence recorded the voice callout decision.",
      voiceCalloutDraft: "Fire cue detected; recover now.",
      voiceEligible: true,
      requestedTool: {
        toolName: "live_env.request_interim_voice_callout",
        args: {
          text: "Fire cue detected; recover now.",
        },
      },
      nextLoopState: "armed_for_next_summary",
      evidenceRefs: [mail.mailId, "ask:waiting-ui-transaction-turn"],
      modelReviewed: true,
      createdAt: "2026-06-04T12:01:27.000Z",
    });

    const reconciliation = reconcileStagePlayMailWakeRequestFromAskTurn({
      wakeRequestIds: [wake!.wakeRequestId],
      askTurnId: "ask:waiting-ui-transaction-turn",
      decisionIds: [decision.decisionId],
      requiresVoiceCheckpoint: true,
      voiceReceiptRefs: ["helix_interim_voice_callout_receipt:waiting-ui-transaction"],
      evidenceRefs: [
        "stage_play_wake_transaction_debug_reconciled",
        "stage_play_processed_mail_packet:waiting-ui-transaction",
      ],
      now: "2026-06-04T12:01:28.000Z",
    });

    expect(reconciliation).toMatchObject({
      reconciledWakeIds: [wake?.wakeRequestId],
      skippedWakeIds: [],
      askTurnId: "ask:waiting-ui-transaction-turn",
      decisionIds: [decision.decisionId],
      voiceReceiptRefs: ["helix_interim_voice_callout_receipt:waiting-ui-transaction"],
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "completed",
      askTurnId: "ask:waiting-ui-transaction-turn",
      askLaunchStatus: "completed",
      decisionIds: [decision.decisionId],
      lifecycleStage: "voice_unknown",
      evidenceRefs: expect.arrayContaining([
        "stage_play_wake_transaction_debug_reconciled",
        "helix_interim_voice_callout_receipt:waiting-ui-transaction",
      ]),
    });
    expect(listStagePlayLiveSourceMailWakeResults({ threadId })[0]).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "completed",
      askTurnId: "ask:waiting-ui-transaction-turn",
      decisionIds: [decision.decisionId],
      voiceCheckpointRefs: ["helix_interim_voice_callout_receipt:waiting-ui-transaction"],
    });
  });

  it("reconciles active voice-pending wakes attached to the same Ask turn id", () => {
    const secondSourceId = "visual_source:stage-play-mailbox-secondary";
    const first = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:same-ask-first",
      evidenceRef: "visual_evidence:same-ask-first",
      summaryText: "First live packet in the same Ask turn voice batch.",
      createdAt: "2026-06-04T12:01:28.000Z",
    });
    const second = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId: secondSourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:same-ask-second",
      evidenceRef: "visual_evidence:same-ask-second",
      summaryText: "Second live packet in the same Ask turn voice batch.",
      createdAt: "2026-06-04T12:01:29.000Z",
    });
    const firstWake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: [first.mailId],
      sourceIds: [sourceId],
      reason: "unread_mail",
      evidenceRefs: [first.mailId, ...first.evidenceRefs],
      now: "2026-06-04T12:01:30.000Z",
    });
    const secondWake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: [second.mailId],
      sourceIds: [secondSourceId],
      reason: "unread_mail",
      evidenceRefs: [second.mailId, ...second.evidenceRefs],
      now: "2026-06-04T12:01:31.000Z",
    });
    const decision = recordStagePlayMailDecision({
      mailIds: [first.mailId, second.mailId],
      threadId,
      roomId,
      decision: "request_voice_callout",
      rationalePreview: "Same Ask turn decided both pending wakes require one voice checkpoint.",
      voiceCalloutDraft: "Create distance from danger.",
      voiceEligible: true,
      requestedTool: {
        toolName: "live_env.request_interim_voice_callout",
        args: { text: "Create distance from danger." },
      },
      nextLoopState: "armed_for_next_summary",
      evidenceRefs: [first.mailId, second.mailId, "ask:same-turn-voice"],
      modelReviewed: true,
      createdAt: "2026-06-04T12:01:32.000Z",
    });
    for (const wake of [firstWake, secondWake]) {
      markStagePlayMailWakeCompleted({
        wakeRequestId: wake!.wakeRequestId,
        askTurnId: "ask:same-turn-voice",
        decisionIds: [decision.decisionId],
        evidenceRefs: [decision.decisionId, "ask:same-turn-voice", ...(wake?.mailIds ?? [])],
        requiresVoiceCheckpoint: true,
        now: "2026-06-04T12:01:33.000Z",
      });
    }

    const reconciliation = reconcileStagePlayMailWakeRequestFromAskTurn({
      wakeRequestIds: [firstWake!.wakeRequestId],
      askTurnId: "ask:same-turn-voice",
      decisionIds: [decision.decisionId],
      voiceReceiptRefs: ["helix_interim_voice_callout_receipt:same-turn-voice"],
      mailIds: [first.mailId, second.mailId],
      now: "2026-06-04T12:01:34.000Z",
    });

    expect(reconciliation.reconciledWakeIds).toEqual([
      firstWake?.wakeRequestId,
      secondWake?.wakeRequestId,
    ]);
    expect(reconciliation.wakeResultIds).toHaveLength(2);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        wakeRequestId: firstWake?.wakeRequestId,
        status: "completed",
        lifecycleStage: "voice_unknown",
        askTurnId: "ask:same-turn-voice",
      }),
      expect.objectContaining({
        wakeRequestId: secondWake?.wakeRequestId,
        status: "completed",
        lifecycleStage: "voice_unknown",
        askTurnId: "ask:same-turn-voice",
      }),
    ]));
    expect(listStagePlayLiveSourceMailWakeResults({ threadId })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        wakeRequestId: firstWake?.wakeRequestId,
        status: "completed",
        voiceCheckpointRefs: ["helix_interim_voice_callout_receipt:same-turn-voice"],
      }),
      expect.objectContaining({
        wakeRequestId: secondWake?.wakeRequestId,
        status: "completed",
        voiceCheckpointRefs: ["helix_interim_voice_callout_receipt:same-turn-voice"],
      }),
    ]));
  });

  it("does not complete a queued wake when a later decision covers only part of the wake batch", () => {
    const first = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:reconcile-partial-first",
      evidenceRef: "visual_evidence:reconcile-partial-first",
      summaryText: "First visual summary in the queued wake batch.",
      createdAt: "2026-06-04T12:01:12.000Z",
    });
    const second = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:reconcile-partial-second",
      evidenceRef: "visual_evidence:reconcile-partial-second",
      summaryText: "Second visual summary in the queued wake batch.",
      createdAt: "2026-06-04T12:01:13.000Z",
    });
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: [first.mailId, second.mailId],
      sourceIds: [sourceId],
      reason: "unread_mail",
      evidenceRefs: [first.mailId, second.mailId, ...first.evidenceRefs, ...second.evidenceRefs],
      now: "2026-06-04T12:01:14.000Z",
    });
    expect(wake?.status).toBe("queued");

    const partialDecision = recordStagePlayMailDecision({
      mailIds: [second.mailId],
      threadId,
      roomId,
      decision: "record_interpretation",
      rationalePreview: "Direct Ask interpreted only the second mail item.",
      nextLoopState: "armed_for_next_summary",
      evidenceRefs: [second.mailId, "ask:partial-direct-mailbox-turn"],
      modelReviewed: true,
      createdAt: "2026-06-04T12:01:15.000Z",
    });

    const reconciled = reconcileStagePlayMailWakeRequestsWithDecisions({
      threadId,
      roomId,
      decisions: [partialDecision],
      now: "2026-06-04T12:01:16.000Z",
    });

    expect(reconciled).toEqual([]);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      wakeRequestId: wake?.wakeRequestId,
      status: "queued",
      decisionIds: [],
    });
    expect(listStagePlayLiveSourceMailWakeResults({ threadId })).toEqual([]);
  });

  it("defers a wake before Ask when runtime pressure admission rejects it", async () => {
    seedVisualEvidence();
    let askCalls = 0;

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:30.000Z",
      pressureCheck: () => ({
        deferred: true,
        reason: "runtime_memory_queue_deferrable",
      }),
      askTurnRunner: async () => {
        askCalls += 1;
        throw new Error("should_not_call_ask_under_pressure");
      },
    });

    expect(askCalls).toBe(0);
    expect(result).toMatchObject({
      status: "deferred_for_pressure",
      failedReason: "runtime_memory_queue_deferrable",
      decisionIds: [],
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "deferred_for_pressure",
      attemptCount: 1,
      lastAttemptAt: "2026-06-04T12:01:30.000Z",
      nextRetryAt: "2026-06-04T12:01:45.000Z",
      failureReason: "runtime_memory_queue_deferrable",
    });
    expect(listStagePlayLiveSourceMailItems({ threadId })[0].status).toBe("unread");
    const transcriptEntries = listStagePlayLiveSourceMailTranscriptEntries({ threadId });
    expect(transcriptEntries.map((entry) => entry.row.rowKind)).toEqual(expect.arrayContaining([
      "mail_received",
      "processed_mail_packet",
      "micro_reasoner_run",
      "mail_wake_requested",
      "mail_wake_deferred",
      "loop_state",
    ]));
    expect(transcriptEntries.map((entry) => entry.row.title)).toEqual(expect.arrayContaining([
      "Processed mail packet",
      "Decision selected",
    ]));
    expect(transcriptEntries.find((entry) => entry.row.title === "Wake requested")?.row.body)
      .toContain("decision_selector selected");
    expect(transcriptEntries.every((entry) => entry.wakeResultId === result?.wakeResultId)).toBe(true);
    expect(result?.evidenceRefs).toEqual(expect.arrayContaining(transcriptEntries.map((entry) => entry.entryId)));
  });

  it("lets urgent voice wakes bypass deferrable runtime pressure using processed-packet authority", async () => {
    configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceIds: [sourceId],
      objectiveText: "Watch the Minecraft source and call out immediate combat or hazard risk.",
      decisionPolicyPrompt: "Request a voice callout when fire, lava, damage, hostile mobs, or combat risk appears.",
      outputPolicy: {
        allowTextAnswer: true,
        allowVoiceCallout: true,
        voiceRequiresUrgency: true,
        confirmationRequired: false,
      },
      importanceCriteria: ["fire, lava, damage, hostile mobs, and combat risk are urgent."],
      suppressCriteria: ["routine safe movement is not user-facing."],
      now: "2026-06-04T12:01:20.000Z",
    });
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:urgent-pressure-bypass",
      evidenceRef: "visual_evidence:urgent-pressure-bypass",
      summaryText: "Minecraft player is on fire with a sword visible and damage risk near hostile mobs.",
      createdAt: "2026-06-04T12:01:21.000Z",
    });
    queueMailWakeForUnreadItems({
      threadId,
      roomId,
      sourceId,
      now: "2026-06-04T12:01:22.000Z",
    });
    let askCalls = 0;

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:30.000Z",
      pressureCheck: () => ({
        deferred: true,
        reason: "runtime_memory_queue_deferrable",
      }),
      askTurnRunner: async ({ wakeRequest }) => {
        askCalls += 1;
        const decision = recordLiveSourceMailDecisionForAsk({
          threadId: wakeRequest.threadId,
          roomId: wakeRequest.roomId,
          environmentId: wakeRequest.environmentId,
          mailIds: wakeRequest.mailIds,
          decision: "request_voice_callout",
          rationalePreview: "Urgent fire and damage cues should bypass deferrable pressure and request voice.",
          voiceCalloutDraft: "Fire and damage risk visible.",
          voiceEnabled: true,
          voiceAllowedNow: true,
          voiceRequiresConfirmation: false,
          voicePolicyReason: "urgent_voice_allowed",
          now: "2026-06-04T12:01:31.000Z",
        });
        return {
          turn_id: "ask:urgent-pressure-bypass",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: decision,
              },
            },
          ],
        };
      },
    });

    expect(askCalls).toBe(1);
    expect(result).toMatchObject({
      status: "completed",
      askTurnId: "ask:urgent-pressure-bypass",
    });
    expect(result?.evidenceRefs).toEqual(expect.arrayContaining([
      "stage_play_wake_priority:urgent_voice",
      expect.stringMatching(/^stage_play_wake_pressure_bypass:urgent_voice:runtime_memory_queue_deferrable$/),
    ]));
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "completed",
      askTurnId: "ask:urgent-pressure-bypass",
      mailIds: expect.arrayContaining([mail.mailId]),
      failureReason: null,
    });
    const packet = getLatestStagePlayProcessedMailPacket({
      sourceId,
      mailId: mail.mailId,
    });
    expect(packet).toMatchObject({
      recommendedNext: "request_voice_callout",
      salience: expect.objectContaining({
        level: "urgent",
        voiceCandidate: true,
      }),
    });
  });

  it("keeps urgent voice wakes blocked under hard pressure with an explicit urgent reason", async () => {
    configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceIds: [sourceId],
      objectiveText: "Watch the Minecraft source and call out immediate combat or hazard risk.",
      decisionPolicyPrompt: "Request a voice callout when fire, lava, damage, hostile mobs, or combat risk appears.",
      outputPolicy: {
        allowTextAnswer: true,
        allowVoiceCallout: true,
        voiceRequiresUrgency: true,
        confirmationRequired: false,
      },
      importanceCriteria: ["fire, lava, damage, hostile mobs, and combat risk are urgent."],
      suppressCriteria: ["routine safe movement is not user-facing."],
      now: "2026-06-04T12:01:20.000Z",
    });
    enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:urgent-pressure-blocked",
      evidenceRef: "visual_evidence:urgent-pressure-blocked",
      summaryText: "Minecraft player is on fire with visible damage risk near hostile mobs.",
      createdAt: "2026-06-04T12:01:21.000Z",
    });
    queueMailWakeForUnreadItems({
      threadId,
      roomId,
      sourceId,
      now: "2026-06-04T12:01:22.000Z",
    });
    let askCalls = 0;

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:30.000Z",
      pressureCheck: () => ({
        deferred: true,
        reason: "runtime_memory_host_memory_limit",
      }),
      askTurnRunner: async () => {
        askCalls += 1;
        throw new Error("should_not_call_ask_under_hard_pressure");
      },
    });

    expect(askCalls).toBe(0);
    expect(result).toMatchObject({
      status: "deferred_for_pressure",
      failedReason: "urgent_pressure_blocked:runtime_memory_host_memory_limit",
      decisionIds: [],
    });
    expect(result?.evidenceRefs).toEqual(expect.arrayContaining([
      "stage_play_wake_priority:urgent_voice",
      "stage_play_wake_pressure_blocked:runtime_memory_host_memory_limit",
    ]));
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "deferred_for_pressure",
      failureReason: "urgent_pressure_blocked:runtime_memory_host_memory_limit",
    });
  });

  it("records a mandatory fallback decision when an urgent voice Ask wake omits the mail decision receipt", async () => {
    configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceIds: [sourceId],
      objectiveText: "Watch the Minecraft source and call out immediate combat or hazard risk.",
      decisionPolicyPrompt: "Request a voice callout when fire, lava, damage, hostile mobs, or combat risk appears.",
      outputPolicy: {
        allowTextAnswer: true,
        allowVoiceCallout: true,
        voiceRequiresUrgency: true,
        confirmationRequired: false,
      },
      importanceCriteria: ["fire, lava, damage, hostile mobs, and combat risk are urgent."],
      suppressCriteria: ["routine safe movement is not user-facing."],
      now: "2026-06-04T12:01:20.000Z",
    });
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:urgent-missing-decision",
      evidenceRef: "visual_evidence:urgent-missing-decision",
      summaryText: "Minecraft player is on fire with a sword visible and damage risk near hostile mobs.",
      createdAt: "2026-06-04T12:01:21.000Z",
    });
    queueMailWakeForUnreadItems({
      threadId,
      roomId,
      sourceId,
      now: "2026-06-04T12:01:22.000Z",
    });

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:30.000Z",
      pressureCheck: () => ({ deferred: false }),
      askTurnRunner: async () => ({
        turn_id: "ask:urgent-missing-decision",
        current_turn_artifact_ledger: [
          {
            kind: "agent_step_decision",
            payload: {
              decision_id: "ask:urgent-missing-decision:agent_step_decision",
              chosen_capability: "model.direct_answer",
            },
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      askTurnId: "ask:urgent-missing-decision",
    });
    expect(result?.decisionIds).toHaveLength(1);
    expect(result?.evidenceRefs).toEqual(expect.arrayContaining([
      "stage_play_mail_wake_decision_fallback:ask_missing_decision",
      expect.stringMatching(/^stage_play_live_source_voice_delivery_receipt:/),
      expect.stringMatching(/^helix_interim_voice_callout_receipt:/),
    ]));
    expect(result?.voiceCheckpointRefs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^stage_play_live_source_voice_delivery_receipt:/),
      expect.stringMatching(/^helix_interim_voice_callout_receipt:/),
    ]));
    const decision = listStagePlayMailDecisions({ threadId })[0];
    expect(decision).toMatchObject({
      decision: "request_voice_callout",
      modelReviewed: false,
      mailIds: expect.arrayContaining([mail.mailId]),
      requestedTool: expect.objectContaining({
        toolName: "live_env.request_interim_voice_callout",
      }),
    });
    expect(decision.evidenceRefs).toEqual(expect.arrayContaining([
      "stage_play_mail_wake_decision_fallback:ask_missing_decision",
      "ask:urgent-missing-decision",
    ]));
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "completed",
      askTurnId: "ask:urgent-missing-decision",
      decisionIds: [decision.decisionId],
    });
  });

  it("labels manual pressure deferrals without reading or deciding mail", async () => {
    seedVisualEvidence();
    let askCalls = 0;

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:30.000Z",
      manualRun: true,
      pressureCheck: () => ({
        deferred: true,
        reason: "runtime_memory_host_memory_limit",
      }),
      askTurnRunner: async () => {
        askCalls += 1;
        throw new Error("should_not_call_ask_under_pressure");
      },
    });

    expect(askCalls).toBe(0);
    expect(result).toMatchObject({
      status: "deferred_for_pressure",
      failedReason: "manual_wake_deferred_for_pressure:runtime_memory_host_memory_limit",
      askTurnId: null,
      decisionIds: [],
    });
    expect(listStagePlayLiveSourceMailItems({ threadId })[0].status).toBe("unread");
    expect(listStagePlayMailDecisions({ threadId })).toHaveLength(0);
    expect(listStagePlayLiveSourceMailTranscriptEntries({ threadId }).map((entry) => entry.row.rowKind))
      .toEqual(expect.arrayContaining(["mail_wake_deferred", "loop_state"]));
  });

  it("coalesces repeated pressure deferrals for the same wake batch", async () => {
    seedVisualEvidence();

    const first = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:30.000Z",
      manualRun: true,
      pressureCheck: () => ({
        deferred: true,
        reason: "runtime_memory_host_memory_limit",
      }),
    });
    const transcriptCount = listStagePlayLiveSourceMailTranscriptEntries({ threadId }).length;

    const second = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:45.000Z",
      manualRun: true,
      pressureCheck: () => ({
        deferred: true,
        reason: "runtime_memory_host_memory_limit",
      }),
    });

    expect(second?.wakeResultId).toBe(first?.wakeResultId);
    expect(listStagePlayLiveSourceMailTranscriptEntries({ threadId })).toHaveLength(transcriptCount);
    expect(listStagePlayLiveSourceMailItems({ threadId })[0].status).toBe("unread");
  });

  it("supersedes an existing deferred wake when newer same-source unread mail arrives", async () => {
    seedVisualEvidence();
    const first = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:30.000Z",
      pressureCheck: () => ({
        deferred: true,
        reason: "runtime_memory_queue_deferrable",
      }),
    });

    enqueueVisualSummaryMailFromEvidence({
      threadId,
      roomId,
      sourceId,
      visualFrameRef: "visual_frame:stage-play-mailbox-second",
      visualEvidenceRef: "visual_evidence:stage-play-mailbox-second",
      summary: "A second compact visual summary arrived from the same source.",
      analysisState: "analysis_ready",
      now: "2026-06-04T12:01:35.000Z",
    });
    queueMailWakeForUnreadItems({
      threadId,
      roomId,
      sourceId,
      now: "2026-06-04T12:01:35.000Z",
    });

    const allWakes = listStagePlayLiveSourceMailWakeRequests({ threadId });
    const queuedWake = allWakes.find((wake) => wake.status === "queued");
    expect(queuedWake?.wakeRequestId).not.toBe(first?.wakeRequestId);
    expect(queuedWake?.mailIds).toEqual(expect.arrayContaining([
      listStagePlayLiveSourceMailItems({ threadId })[1].mailId,
    ]));
    expect(allWakes.find((wake) => wake.wakeRequestId === first?.wakeRequestId)).toMatchObject({
      status: "expired_superseded",
      supersededByWakeRequestId: queuedWake?.wakeRequestId,
      failureReason: "wake_superseded_by_newer_source_packet",
    });
  });

  it("runs a retryable pressure wake after nextRetryAt while preserving exact mail ids", async () => {
    seedVisualEvidence();
    await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:00.000Z",
      askTurnRunner: async () => {
        throw new Error("mail_wake_ask_turn_failed:503");
      },
    });
    const mailId = listStagePlayLiveSourceMailItems({ threadId })[0].mailId;

    const early = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:10.000Z",
      askTurnRunner: async () => {
        throw new Error("should_not_run_before_retry");
      },
    });
    expect(early).toBeNull();

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:15.000Z",
      askTurnRunner: async ({ wakeRequest }) => ({
        turn_id: "ask:wake-retry",
        current_turn_artifact_ledger: [
          {
            kind: "live_environment_tool_observation",
            payload: {
              tool_name: "live_env.record_live_source_mail_decision",
              observation: {
                artifactId: "stage_play_live_source_mail_decision",
                decisionId: "stage_play_live_source_mail_decision:wake-retry",
                mailIds: wakeRequest.mailIds,
              },
            },
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      askTurnId: "ask:wake-retry",
      decisionIds: ["stage_play_live_source_mail_decision:wake-retry"],
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "completed",
      attemptCount: 2,
      mailIds: [mailId],
      nextRetryAt: null,
    });
  });

  it("splits oversized same-source wake batches before calling Ask", async () => {
    const mailIds = Array.from({ length: 6 }, (_unused, index) =>
      enqueueStagePlayLiveSourceMailItem({
        threadId,
        roomId,
        sourceId,
        sourceKind: "visual_frame",
        frameRef: `visual_frame:bounded-${index}`,
        evidenceRef: `visual_evidence:bounded-${index}`,
        summaryText: `Compact visual summary ${index}.`,
        createdAt: `2026-06-04T12:02:0${index}.000Z`,
      }).mailId
    );

    let prompt = "";
    let askMailIds: string[] = [];
    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:02:10.000Z",
      askTurnRunner: async ({ prompt: wakePrompt, wakeRequest }) => {
        prompt = wakePrompt;
        askMailIds = wakeRequest.mailIds;
        return {
          turn_id: "ask:bounded-wake",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: {
                  artifactId: "stage_play_live_source_mail_decision",
                  decisionId: "stage_play_live_source_mail_decision:bounded-wake",
                  mailIds: wakeRequest.mailIds,
                },
              },
            },
          ],
        };
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      askTurnId: "ask:bounded-wake",
    });
    expect(askMailIds).toEqual(mailIds.slice(0, 4));
    expect(prompt).toContain("Retained unread mail outside this Ask batch: 2");
    expect(prompt).toContain(`Mail refs: ${mailIds.slice(0, 4).join(", ")}`);
    expect(prompt).not.toContain(mailIds[5]);

    const wakeRequests = listStagePlayLiveSourceMailWakeRequests({ threadId });
    expect(wakeRequests.map((wake) => wake.status)).toEqual(["completed", "queued"]);
    expect(wakeRequests[0].mailIds).toEqual(mailIds.slice(0, 4));
    expect(wakeRequests[1].mailIds).toEqual(mailIds.slice(4));
  });

  it("uses small batches for latest-scene watch policies before calling Ask", async () => {
    const previousGenericLimit = process.env.STAGE_PLAY_MAIL_WAKE_MAX_BATCH;
    const previousLatestLimit = process.env.STAGE_PLAY_MAIL_WAKE_LATEST_SCENE_BATCH_LIMIT;
    process.env.STAGE_PLAY_MAIL_WAKE_MAX_BATCH = "8";
    process.env.STAGE_PLAY_MAIL_WAKE_LATEST_SCENE_BATCH_LIMIT = "1";
    try {
      configureStagePlayLiveSourceWatchJobPolicy({
        threadId,
        roomId,
        sourceIds: [sourceId],
        objectiveText: "Watch the active visual source and describe each new mail batch in one sentence.",
        interpretationMode: "latest_scene_answer",
        mailProcessingMode: "latest_only",
        outputCadence: "every_batch",
        now: "2026-06-04T12:02:30.000Z",
      });
      const mailIds = Array.from({ length: 4 }, (_unused, index) =>
        enqueueStagePlayLiveSourceMailItem({
          threadId,
          roomId,
          sourceId,
          sourceKind: "visual_frame",
          frameRef: `visual_frame:latest-policy-${index}`,
          evidenceRef: `visual_evidence:latest-policy-${index}`,
          summaryText: `Latest-scene compact summary ${index}.`,
          createdAt: `2026-06-04T12:02:3${index}.000Z`,
        }).mailId
      );

      let prompt = "";
      let askMailIds: string[] = [];
      await runNextMailWakeRequest({
        threadId,
        roomId,
        now: "2026-06-04T12:02:40.000Z",
        askTurnRunner: async ({ prompt: wakePrompt, wakeRequest }) => {
          prompt = wakePrompt;
          askMailIds = wakeRequest.mailIds;
          return {
            turn_id: "ask:latest-scene-policy-batch",
            current_turn_artifact_ledger: [
              {
                kind: "live_environment_tool_observation",
                payload: {
                  tool_name: "live_env.record_live_source_mail_decision",
                  observation: {
                    artifactId: "stage_play_live_source_mail_decision",
                    decisionId: "stage_play_live_source_mail_decision:latest-scene-policy-batch",
                    mailIds: wakeRequest.mailIds,
                  },
                },
              },
            ],
          };
        },
      });

      expect(askMailIds).toEqual(mailIds.slice(0, 1));
      expect(prompt).toContain("Interpretation mode: latest_scene_answer");
      expect(prompt).toContain("Mail processing mode: latest_only");
      expect(prompt).toContain("Wake batch size for this policy: 1");
      expect(prompt).toContain("Retained unread mail outside this Ask batch: 3");
      const wakeRequests = listStagePlayLiveSourceMailWakeRequests({ threadId });
      expect(wakeRequests.map((wake) => wake.mailIds)).toEqual([
        mailIds.slice(0, 1),
        mailIds.slice(1),
      ]);
    } finally {
      if (previousGenericLimit === undefined) delete process.env.STAGE_PLAY_MAIL_WAKE_MAX_BATCH;
      else process.env.STAGE_PLAY_MAIL_WAKE_MAX_BATCH = previousGenericLimit;
      if (previousLatestLimit === undefined) delete process.env.STAGE_PLAY_MAIL_WAKE_LATEST_SCENE_BATCH_LIMIT;
      else process.env.STAGE_PLAY_MAIL_WAKE_LATEST_SCENE_BATCH_LIMIT = previousLatestLimit;
    }
  });

  it("uses chronological micro-batches for prediction watch policies before calling Ask", async () => {
    const previousGenericLimit = process.env.STAGE_PLAY_MAIL_WAKE_MAX_BATCH;
    const previousPredictionLimit = process.env.STAGE_PLAY_MAIL_WAKE_PREDICTION_MICRO_BATCH_LIMIT;
    process.env.STAGE_PLAY_MAIL_WAKE_MAX_BATCH = "9";
    process.env.STAGE_PLAY_MAIL_WAKE_PREDICTION_MICRO_BATCH_LIMIT = "3";
    try {
      configureStagePlayLiveSourceWatchJobPolicy({
        threadId,
        roomId,
        sourceIds: [sourceId],
        objectiveText: "Interpret the Minecraft video mail, predict what might happen next, and say what should be watched next.",
        interpretationMode: "prediction_watch",
        mailProcessingMode: "chronological_batch",
        outputCadence: "every_batch",
        now: "2026-06-04T12:02:50.000Z",
      });
      const mailIds = Array.from({ length: 7 }, (_unused, index) =>
        enqueueStagePlayLiveSourceMailItem({
          threadId,
          roomId,
          sourceId,
          sourceKind: "visual_frame",
          frameRef: `visual_frame:prediction-policy-${index}`,
          evidenceRef: `visual_evidence:prediction-policy-${index}`,
          summaryText: `Prediction compact summary ${index}.`,
          createdAt: `2026-06-04T12:02:5${index}.000Z`,
        }).mailId
      );

      let prompt = "";
      let askMailIds: string[] = [];
      await runNextMailWakeRequest({
        threadId,
        roomId,
        now: "2026-06-04T12:03:00.000Z",
        askTurnRunner: async ({ prompt: wakePrompt, wakeRequest }) => {
          prompt = wakePrompt;
          askMailIds = wakeRequest.mailIds;
          return {
            turn_id: "ask:prediction-policy-batch",
            current_turn_artifact_ledger: [
              {
                kind: "live_environment_tool_observation",
                payload: {
                  tool_name: "live_env.record_live_source_mail_decision",
                  observation: {
                    artifactId: "stage_play_live_source_mail_decision",
                    decisionId: "stage_play_live_source_mail_decision:prediction-policy-batch",
                    mailIds: wakeRequest.mailIds,
                  },
                },
              },
            ],
          };
        },
      });

      expect(askMailIds).toEqual(mailIds.slice(0, 3));
      expect(prompt).toContain("Interpretation mode: prediction_watch");
      expect(prompt).toContain("Mail processing mode: chronological_batch");
      expect(prompt).toContain("Wake batch size for this policy: 3");
      expect(prompt).toContain("Output cadence: every_batch");
      expect(prompt).toContain("Retained unread mail outside this Ask batch: 4");
      expect(prompt).toContain("- prediction_watch: produce record_interpretation with prediction and validation signals.");
      const wakeRequests = listStagePlayLiveSourceMailWakeRequests({ threadId });
      expect(wakeRequests.map((wake) => wake.mailIds)).toEqual([
        mailIds.slice(0, 3),
        mailIds.slice(3),
      ]);
    } finally {
      if (previousGenericLimit === undefined) delete process.env.STAGE_PLAY_MAIL_WAKE_MAX_BATCH;
      else process.env.STAGE_PLAY_MAIL_WAKE_MAX_BATCH = previousGenericLimit;
      if (previousPredictionLimit === undefined) delete process.env.STAGE_PLAY_MAIL_WAKE_PREDICTION_MICRO_BATCH_LIMIT;
      else process.env.STAGE_PLAY_MAIL_WAKE_PREDICTION_MICRO_BATCH_LIMIT = previousPredictionLimit;
    }
  });

  it("uses salience windows for voice commentary policies before calling Ask", async () => {
    const previousGenericLimit = process.env.STAGE_PLAY_MAIL_WAKE_MAX_BATCH;
    const previousVoiceLimit = process.env.STAGE_PLAY_MAIL_WAKE_VOICE_SALIENCE_BATCH_LIMIT;
    process.env.STAGE_PLAY_MAIL_WAKE_MAX_BATCH = "9";
    process.env.STAGE_PLAY_MAIL_WAKE_VOICE_SALIENCE_BATCH_LIMIT = "5";
    try {
      configureStagePlayLiveSourceWatchJobPolicy({
        threadId,
        roomId,
        sourceIds: [sourceId],
        objectiveText: "Commentate while I play and speak only when something important changes.",
        interpretationMode: "voice_commentary_watch",
        mailProcessingMode: "salience_window",
        outputCadence: "voice_only_salient",
        outputPolicy: {
          allowTextAnswer: true,
          allowVoiceCallout: true,
          voiceRequiresUrgency: true,
          confirmationRequired: false,
        },
        now: "2026-06-04T12:03:10.000Z",
      });
      const mailIds = Array.from({ length: 8 }, (_unused, index) =>
        enqueueStagePlayLiveSourceMailItem({
          threadId,
          roomId,
          sourceId,
          sourceKind: "visual_frame",
          frameRef: `visual_frame:voice-policy-${index}`,
          evidenceRef: `visual_evidence:voice-policy-${index}`,
          summaryText: index === 2
            ? "Voice commentary compact summary 2: hostile mob appears near the Minecraft player."
            : `Voice commentary compact summary ${index}.`,
          createdAt: `2026-06-04T12:03:1${index}.000Z`,
        }).mailId
      );

      let prompt = "";
      let askMailIds: string[] = [];
      await runNextMailWakeRequest({
        threadId,
        roomId,
        now: "2026-06-04T12:03:20.000Z",
        askTurnRunner: async ({ prompt: wakePrompt, wakeRequest }) => {
          prompt = wakePrompt;
          askMailIds = wakeRequest.mailIds;
          return {
            turn_id: "ask:voice-commentary-policy-batch",
            current_turn_artifact_ledger: [
              {
                kind: "live_environment_tool_observation",
                payload: {
                  tool_name: "live_env.record_live_source_mail_decision",
                  observation: {
                    artifactId: "stage_play_live_source_mail_decision",
                    decisionId: "stage_play_live_source_mail_decision:voice-commentary-policy-batch",
                    mailIds: wakeRequest.mailIds,
                  },
                },
              },
            ],
          };
        },
      });

      expect(askMailIds).toEqual(mailIds.slice(0, 5));
      expect(prompt).toContain("Interpretation mode: voice_commentary_watch");
      expect(prompt).toContain("Mail processing mode: salience_window");
      expect(prompt).toContain("Output cadence: voice_only_salient");
      expect(prompt).toContain("Wake batch size for this policy: 5");
      expect(prompt).toContain("Retained unread mail outside this Ask batch: 3");
      expect(prompt).toContain("- salience_window: scan the batch for policy-relevant changes and suppress routine updates.");
      const wakeRequests = listStagePlayLiveSourceMailWakeRequests({ threadId });
      expect(wakeRequests.map((wake) => wake.mailIds)).toEqual([
        mailIds.slice(0, 5),
        mailIds.slice(5),
      ]);
    } finally {
      if (previousGenericLimit === undefined) delete process.env.STAGE_PLAY_MAIL_WAKE_MAX_BATCH;
      else process.env.STAGE_PLAY_MAIL_WAKE_MAX_BATCH = previousGenericLimit;
      if (previousVoiceLimit === undefined) delete process.env.STAGE_PLAY_MAIL_WAKE_VOICE_SALIENCE_BATCH_LIMIT;
      else process.env.STAGE_PLAY_MAIL_WAKE_VOICE_SALIENCE_BATCH_LIMIT = previousVoiceLimit;
    }
  });

  it("records a typed preflight failure instead of calling Ask when the wake prompt is too large", async () => {
    const previousMaxChars = process.env.STAGE_PLAY_MAIL_WAKE_PROMPT_MAX_CHARS;
    process.env.STAGE_PLAY_MAIL_WAKE_PROMPT_MAX_CHARS = "200";
    try {
      const mail = enqueueStagePlayLiveSourceMailItem({
        threadId,
        roomId,
        sourceId,
        sourceKind: "visual_frame",
        frameRef: "visual_frame:preflight",
        evidenceRef: "visual_evidence:preflight",
        summaryText: "A compact visual summary that should never reach Ask because the preflight prompt limit is intentionally tiny.",
        createdAt: "2026-06-04T12:02:20.000Z",
      });

      let askCalls = 0;
      const result = await runNextMailWakeRequest({
        threadId,
        roomId,
        now: "2026-06-04T12:02:21.000Z",
        askTurnRunner: async () => {
          askCalls += 1;
          throw new Error("ask_should_not_run_after_prompt_preflight_block");
        },
      });

      expect(askCalls).toBe(0);
      expect(result).toMatchObject({
        status: "failed_retryable",
        askTurnId: null,
        failedReason: expect.stringMatching(/^wake_preflight_blocked:prompt_too_large:/),
      });
      expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
        status: "failed_retryable",
        mailIds: [mail.mailId],
        attemptCount: 0,
        failureReason: expect.stringMatching(/^wake_preflight_blocked:prompt_too_large:/),
      });
      expect(listStagePlayLiveSourceMailWakeResults({ threadId })[0]).toMatchObject({
        status: "failed_retryable",
        failedReason: expect.stringMatching(/^wake_preflight_blocked:prompt_too_large:/),
      });
      expect(listStagePlayLiveSourceMailTranscriptEntries({ threadId })
        .map((entry) => entry.row.body).join("\n")).toContain("wake_preflight_blocked:prompt_too_large:");
      expect(listStagePlayLiveSourceMailTranscriptEntries({ threadId })
        .map((entry) => entry.row.title)).toContain("Wake preflight blocked");
    } finally {
      if (previousMaxChars === undefined) {
        delete process.env.STAGE_PLAY_MAIL_WAKE_PROMPT_MAX_CHARS;
      } else {
        process.env.STAGE_PLAY_MAIL_WAKE_PROMPT_MAX_CHARS = previousMaxChars;
      }
    }
  });

  it("auto-arms a micro-reasoner watch policy for interval jobs before queueing wake mail", async () => {
    upsertStagePlayLiveSourceJobState({
      jobId: "stage_play_live_source_job:auto-arm",
      threadId,
      roomId,
      sourceIds: [sourceId],
      status: "armed",
      nextWakePolicy: {
        sourceKind: "visual_frame",
        afterMs: 10_000,
        maxConsecutiveReads: 3,
      },
      updatedAt: "2026-06-04T12:02:00.000Z",
    });
    enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:auto-arm",
      evidenceRef: "visual_evidence:auto-arm",
      summaryText: "A routine Minecraft interval summary near a crafting table.",
      createdAt: "2026-06-04T12:02:01.000Z",
    });

    await runStagePlayLiveSourceMailWakeAdmissionCycle({
      threadId,
      roomId,
      now: "2026-06-04T12:02:02.000Z",
      pressureCheck: () => ({ deferred: false }),
      askTurnRunner: async () => {
        throw new Error("routine_auto_arm_should_not_need_slow_ask");
      },
    });

    const policies = listStagePlayLiveSourceWatchJobPolicies({ threadId, roomId });
    const policy = policies.find((entry) => entry.jobId === "stage_play_live_source_job:auto-arm");
    expect(policy).toBeTruthy();
    expect(policy).toMatchObject({
      interpretationMode: "prediction_watch",
      mailProcessingMode: "salience_window",
      outputCadence: "voice_only_salient",
      outputPolicy: expect.objectContaining({
        allowVoiceCallout: true,
        confirmationRequired: false,
      }),
    });
    const autoArmJob = listStagePlayLiveSourceJobStates({ threadId, roomId })
      .find((entry) => entry.jobId === "stage_play_live_source_job:auto-arm");
    expect(autoArmJob?.watchJobPolicyRef).toBe(policy?.policyId);
  });

  it("uses live-source producer cadence when visual snapshot source cadence is unavailable", () => {
    const liveProducerSourceId = "visual_source:producer-cadence";
    upsertLiveSourceProducer({
      sourceId: liveProducerSourceId,
      threadId,
      modality: "visual_frame",
      status: "active",
      captureMode: "interval",
      cadenceMs: 10_000,
      now: "2026-06-04T12:03:00.000Z",
    });
    recordVisualFrame({
      thread_id: threadId,
      room_id: roomId,
      source_id: liveProducerSourceId,
      frame_id: "visual_frame:producer-cadence",
      ts: "2026-06-04T12:03:01.000Z",
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: "visual_frame:producer-cadence",
      summary: "Minecraft cave frame with a useful interval cadence.",
      ts: "2026-06-04T12:03:02.000Z",
    });

    const job = listStagePlayLiveSourceJobStates({ threadId }).find((entry) =>
      entry.sourceIds.includes(liveProducerSourceId)
    );
    expect(job?.nextWakePolicy).toMatchObject({
      sourceKind: "visual_frame",
      afterMs: 10_000,
      maxConsecutiveReads: 3,
    });
  });

  it("auto-arms policy and runs local wake when stage-play refresh pressure is deferrable but within local caps", async () => {
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: memoryReader(700, 1200),
    });
    upsertStagePlayLiveSourceJobState({
      jobId: "stage_play_live_source_job:local-pressure-bypass",
      threadId,
      roomId,
      sourceIds: [sourceId],
      status: "armed",
      nextWakePolicy: {
        sourceKind: "visual_frame",
        afterMs: 10_000,
        maxConsecutiveReads: 3,
      },
      updatedAt: "2026-06-04T12:04:00.000Z",
    });
    enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:local-pressure-bypass",
      evidenceRef: "visual_evidence:local-pressure-bypass",
      summaryText: "Minecraft player is next to lava and fire with visible damage risk.",
      createdAt: "2026-06-04T12:04:01.000Z",
    });

    let askCalls = 0;
    const cycle = await runStagePlayLiveSourceMailWakeAdmissionCycle({
      threadId,
      roomId,
      now: "2026-06-04T12:04:02.000Z",
      askTurnRunner: async ({ wakeRequest }) => {
        askCalls += 1;
        const decision = recordLiveSourceMailDecisionForAsk({
          threadId: wakeRequest.threadId,
          roomId: wakeRequest.roomId,
          environmentId: wakeRequest.environmentId,
          mailIds: wakeRequest.mailIds,
          decision: "request_voice_callout",
          rationalePreview: "Urgent Minecraft lava/fire/damage cue should wake Ask and request voice.",
          voiceCalloutDraft: "Lava and fire risk visible.",
          voiceEnabled: true,
          voiceAllowedNow: true,
          voiceRequiresConfirmation: false,
          voicePolicyReason: "watch_policy_allows_urgent_voice_callout",
          nextLoopState: "armed_for_next_summary",
          now: "2026-06-04T12:04:03.000Z",
        });
        return {
          turn_id: "ask:local-pressure-bypass",
          current_turn_artifact_ledger: [{
            kind: "live_environment_tool_observation",
            payload: {
              tool_name: "live_env.record_live_source_mail_decision",
              observation: decision,
            },
          }],
        };
      },
    });

    expect(askCalls).toBe(1);
    expect(cycle.status).toBe("completed");
    expect(cycle.runtimeAdmission).toMatchObject({
      admitted: false,
      action: "queue",
      reason: "queue_deferrable",
      pressureLevel: "hard_pressure",
      localBypass: expect.objectContaining({
        applied: true,
      }),
    });
    expect(cycle.result).toMatchObject({
      status: "completed",
      askTurnId: "ask:local-pressure-bypass",
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "completed",
      failureReason: null,
    });
    expect(listStagePlayLiveSourceWatchJobPolicies({ threadId, roomId })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        interpretationMode: "prediction_watch",
        mailProcessingMode: "salience_window",
      }),
    ]));
  });

  it("falls back to a compact processed-packet handoff when the full wake prompt exceeds preflight budget", async () => {
    const previousMaxChars = process.env.STAGE_PLAY_MAIL_WAKE_PROMPT_MAX_CHARS;
    const previousBatchLimit = process.env.STAGE_PLAY_MAIL_WAKE_VOICE_SALIENCE_BATCH_LIMIT;
    process.env.STAGE_PLAY_MAIL_WAKE_PROMPT_MAX_CHARS = "9000";
    process.env.STAGE_PLAY_MAIL_WAKE_VOICE_SALIENCE_BATCH_LIMIT = "12";
    try {
      configureStagePlayLiveSourceWatchJobPolicy({
        jobId: "stage_play_live_source_job:compact-prompt",
        threadId,
        roomId,
        sourceIds: [sourceId],
        objectiveText: "Use micro-reasoners to watch the Minecraft interval source and request voice only for urgent risk.",
        interpretationMode: "prediction_watch",
        mailProcessingMode: "salience_window",
        outputCadence: "voice_only_salient",
        outputPolicy: {
          allowTextAnswer: true,
          allowVoiceCallout: true,
          voiceRequiresUrgency: true,
          confirmationRequired: false,
        },
        importanceCriteria: ["lava, fire, damage, hostile mobs, and low health are urgent."],
        suppressCriteria: ["routine movement and repeated interior frames are not user-facing."],
        now: "2026-06-04T12:03:00.000Z",
      });
      for (let index = 0; index < 12; index += 1) {
        enqueueStagePlayLiveSourceMailItem({
          threadId,
          roomId,
          sourceId,
          sourceKind: "visual_frame",
          frameRef: `visual_frame:compact-${index}`,
          evidenceRef: `visual_evidence:compact-${index}`,
          summaryText: `Minecraft player is near lava and fire with possible damage risk while moving forward. Observation ${index}. ${"repeat salient scene detail ".repeat(18)}`,
          createdAt: `2026-06-04T12:03:${String(index).padStart(2, "0")}.000Z`,
        });
      }

      let prompt = "";
      const result = await runNextMailWakeRequest({
        threadId,
        roomId,
        now: "2026-06-04T12:03:20.000Z",
        askTurnRunner: async ({ prompt: wakePrompt, wakeRequest }) => {
          prompt = wakePrompt;
          return {
            turn_id: "ask:compact-wake",
            current_turn_artifact_ledger: [
              {
                kind: "live_environment_tool_observation",
                payload: {
                  tool_name: "live_env.record_live_source_mail_decision",
                  observation: {
                    artifactId: "stage_play_live_source_mail_decision",
                    decisionId: "stage_play_live_source_mail_decision:compact-wake",
                    mailIds: wakeRequest.mailIds,
                  },
                },
              },
            ],
          };
        },
      });

      expect(result?.status).toBe("completed");
      expect(prompt).toContain("compact Ask handoff");
      expect(prompt).toContain("Processed packet:");
      expect(prompt).toContain("Latest micro-reasoner finding:");
      expect(prompt).not.toMatch(/\blive_env\./);
      expect(prompt.length).toBeLessThanOrEqual(9000);
      expect(prompt).not.toContain("Active interpreter profile:");
      expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0].status).toBe("completed");
    } finally {
      if (previousMaxChars === undefined) delete process.env.STAGE_PLAY_MAIL_WAKE_PROMPT_MAX_CHARS;
      else process.env.STAGE_PLAY_MAIL_WAKE_PROMPT_MAX_CHARS = previousMaxChars;
      if (previousBatchLimit === undefined) delete process.env.STAGE_PLAY_MAIL_WAKE_VOICE_SALIENCE_BATCH_LIMIT;
      else process.env.STAGE_PLAY_MAIL_WAKE_VOICE_SALIENCE_BATCH_LIMIT = previousBatchLimit;
    }
  });

  it("lets manual wake retry a pressure-deferred wake before nextRetryAt", async () => {
    seedVisualEvidence();
    await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:00.000Z",
      pressureCheck: () => ({
        deferred: true,
        reason: "runtime_memory_queue_deferrable",
      }),
    });

    const earlyAutomatic = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:10.000Z",
      pressureCheck: () => ({
        deferred: false,
      }),
      askTurnRunner: async () => {
        throw new Error("automatic_should_wait_for_next_retry");
      },
    });
    expect(earlyAutomatic).toBeNull();

    let manualAskCalls = 0;
    const manual = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:10.000Z",
      manualRun: true,
      pressureCheck: () => ({
        deferred: true,
        reason: "runtime_memory_queue_deferrable",
      }),
      askTurnRunner: async ({ wakeRequest }) => {
        manualAskCalls += 1;
        const decision = recordLiveSourceMailDecisionForAsk({
          threadId: wakeRequest.threadId,
          roomId: wakeRequest.roomId,
          environmentId: wakeRequest.environmentId,
          mailIds: wakeRequest.mailIds,
          decision: "record_interpretation",
          rationalePreview: "Manual wake consumed retained mail under deferrable pressure.",
          interpretation: {
            currentSceneSummary: "Manual wake read the retained visual summary.",
            runningStorySummary: "Manual wake restored the retained mailbox loop.",
            userRelevantMeaning: "The operator-requested wake can process retained mail even when automatic wakes are deferrable.",
            watchNextTargets: ["next visual summary"],
            watchNextReason: "Watch for the next compact visual summary after the retained batch is processed.",
          },
          nextLoopState: "armed_for_next_summary",
          now: "2026-06-04T12:01:11.000Z",
        });
        return {
          turn_id: "ask:manual-pressure-override",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: decision,
              },
            },
          ],
        };
      },
    });

    expect(manualAskCalls).toBe(1);
    expect(manual).toMatchObject({
      status: "completed",
      askTurnId: "ask:manual-pressure-override",
      decisionIds: [expect.stringMatching(/^stage_play_live_source_mail_decision:/)],
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "completed",
      attemptCount: 2,
      failureReason: null,
    });
    expect(listStagePlayLiveSourceMailItems({ threadId })[0].status).toBe("decision_recorded");
    expect(listStagePlayLiveSourceMailTranscriptEntries({ threadId, askTurnId: "ask:manual-pressure-override" })
      .map((entry) => entry.row.rowKind)).toEqual(expect.arrayContaining([
        "mail_read_tool_call",
        "mail_read_receipt",
        "agent_decision",
        "interpretation",
        "watch_next",
        "narrative_state",
        "loop_state",
      ]));
  });

  it("still defers manual wake on non-deferrable hard pressure reasons", async () => {
    seedVisualEvidence();
    await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:00.000Z",
      pressureCheck: () => ({
        deferred: true,
        reason: "runtime_memory_queue_deferrable",
      }),
    });

    let askCalls = 0;
    const manual = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:01:10.000Z",
      manualRun: true,
      pressureCheck: () => ({
        deferred: true,
        reason: "runtime_memory_host_memory_limit",
      }),
      askTurnRunner: async () => {
        askCalls += 1;
        throw new Error("manual_should_not_call_ask_under_host_pressure");
      },
    });

    expect(askCalls).toBe(0);
    expect(manual).toMatchObject({
      status: "deferred_for_pressure",
      failedReason: "manual_wake_deferred_for_pressure:runtime_memory_host_memory_limit",
      askTurnId: null,
      decisionIds: [],
    });
  });

  it("blocks later wakes while a non-stale wake is running", async () => {
    enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:block-first",
      evidenceRef: "visual_evidence:block-first",
      summaryText: "First summary.",
      createdAt: "2026-06-04T12:02:00.000Z",
    });
    enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:block-second",
      evidenceRef: "visual_evidence:block-second",
      summaryText: "Second summary.",
      createdAt: "2026-06-04T12:02:01.000Z",
    });
    const first = listStagePlayLiveSourceMailWakeRequests({ threadId })[0];
    markStagePlayMailWakeRunning(first.wakeRequestId, "2026-06-04T12:02:02.000Z", {
      askTurnId: "ask:block-first-running",
    });
    const skipped = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:02:10.000Z",
      askTurnRunner: async () => {
        throw new Error("should_not_run_while_prior_running");
      },
    });

    expect(skipped).toBeNull();
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId, mailId: first.mailIds[0] })[0]).toMatchObject({
      status: "running",
      attemptCount: 1,
    });
  });

  it("server admission cycle owns one same-source unread batch in chronological order", async () => {
    const first = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:cycle-first",
      evidenceRef: "visual_evidence:cycle-first",
      summaryText: "First cycle summary.",
      createdAt: "2026-06-04T12:02:40.000Z",
    });
    const second = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:cycle-second",
      evidenceRef: "visual_evidence:cycle-second",
      summaryText: "Second cycle summary.",
      createdAt: "2026-06-04T12:02:41.000Z",
    });
    let wakeMailIds: string[] = [];

    const cycle = await runStagePlayLiveSourceMailWakeAdmissionCycle({
      threadId,
      roomId,
      now: "2026-06-04T12:02:42.000Z",
      pressureCheck: () => ({ deferred: false }),
      askTurnRunner: async ({ wakeRequest }) => {
        wakeMailIds = wakeRequest.mailIds;
        return {
          turn_id: "ask:wake-cycle-batch",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: {
                  artifactId: "stage_play_live_source_mail_decision",
                  decisionId: "stage_play_live_source_mail_decision:wake-cycle-batch",
                  mailIds: wakeRequest.mailIds,
                },
              },
            },
          ],
        };
      },
    });

    expect(wakeMailIds).toEqual([first.mailId, second.mailId]);
    expect(cycle).toMatchObject({
      schema: "stage_play_live_source_mail_wake_admission_cycle/v1",
      status: "completed",
      reason: "wake_admitted",
      result: {
        status: "completed",
        askTurnId: "ask:wake-cycle-batch",
        decisionIds: ["stage_play_live_source_mail_decision:wake-cycle-batch"],
      },
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "completed",
      mailIds: [first.mailId, second.mailId],
    });
  });

  it("server admission cycle leaves Ask-worthy wakes queued for visible UI handoff by default", async () => {
    configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      jobId: "stage_play_live_source_job:ui-handoff",
      sourceIds: [sourceId],
      interpretationMode: "voice_commentary_watch",
      objectiveText: "Watch the Minecraft source and call out immediate combat or hazard risk.",
      decisionPolicyPrompt: "Request a voice callout when fire, lava, damage, hostile mobs, or combat risk appears.",
      voicePolicy: {
        enabled: true,
        allowUrgentCallouts: true,
        requireConfirmation: false,
        importanceCriteria: ["fire, lava, damage, hostile mobs, and combat risk are urgent."],
        suppressionCriteria: [],
        maxCalloutLength: 160,
      },
      now: "2026-06-04T12:02:43.000Z",
    });
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:ui-handoff",
      evidenceRef: "visual_evidence:ui-handoff",
      summaryText: "Minecraft player is on fire with visible damage risk near hostile mobs.",
      createdAt: "2026-06-04T12:02:44.000Z",
    });

    const cycle = await runStagePlayLiveSourceMailWakeAdmissionCycle({
      threadId,
      roomId,
      now: "2026-06-04T12:02:45.000Z",
      pressureCheck: () => ({ deferred: false }),
    });

    expect(cycle).toMatchObject({
      status: "waiting_for_ui_handoff",
      reason: "wake_ui_handoff_required",
      result: null,
    });
    const wake = listStagePlayLiveSourceMailWakeRequests({ threadId, mailId: mail.mailId })[0];
    expect(wake).toMatchObject({
      status: "waiting_for_ui_handoff",
      askTurnId: null,
      askLaunchStatus: "not_started",
      lifecycleStage: "waiting_for_ui_handoff",
      lifecycleReason: "ui_handoff_required",
    });
    expect(wake.askLaunchRouteMetadata).toMatchObject({
      invocationKind: "stage_play_mail_wake",
      wakeRequestId: wake.wakeRequestId,
      sourceTarget: "live_source_mailbox",
      requiredCanonicalGoal: "processed_mail_voice_decision",
      mandatoryNextTool: "live_env.record_live_source_mail_decision",
    });
    const packetCountAfterFirstCycle = listStagePlayProcessedMailPackets({ jobId: "stage_play_live_source_job:ui-handoff" }).length;
    const resultCountAfterFirstCycle = listStagePlayLiveSourceMailWakeResults({ threadId }).length;
    expect(resultCountAfterFirstCycle).toBe(0);

    const secondCycle = await runStagePlayLiveSourceMailWakeAdmissionCycle({
      threadId,
      roomId,
      now: "2026-06-04T12:02:46.000Z",
      pressureCheck: () => ({ deferred: false }),
    });

    expect(secondCycle).toMatchObject({
      status: "waiting_for_ui_handoff",
      reason: "wake_ui_handoff_required",
      result: null,
    });
    expect(listStagePlayProcessedMailPackets({ jobId: "stage_play_live_source_job:ui-handoff" })).toHaveLength(packetCountAfterFirstCycle);
    expect(listStagePlayLiveSourceMailWakeResults({ threadId })).toHaveLength(resultCountAfterFirstCycle);
  });

  it("reports immediate continuation when a bounded wake leaves runnable retained mail", async () => {
    const previousBatchLimit = process.env.STAGE_PLAY_MAIL_WAKE_ASK_BATCH_LIMIT;
    process.env.STAGE_PLAY_MAIL_WAKE_ASK_BATCH_LIMIT = "1";
    try {
      const first = enqueueStagePlayLiveSourceMailItem({
        threadId,
        roomId,
        sourceId,
        sourceKind: "visual_frame",
        frameRef: "visual_frame:cycle-retained-first",
        evidenceRef: "visual_evidence:cycle-retained-first",
        summaryText: "First retained-cycle summary.",
        createdAt: "2026-06-04T12:02:50.000Z",
      });
      const second = enqueueStagePlayLiveSourceMailItem({
        threadId,
        roomId,
        sourceId,
        sourceKind: "visual_frame",
        frameRef: "visual_frame:cycle-retained-second",
        evidenceRef: "visual_evidence:cycle-retained-second",
        summaryText: "Second retained-cycle summary.",
        createdAt: "2026-06-04T12:02:51.000Z",
      });

      const cycle = await runStagePlayLiveSourceMailWakeAdmissionCycle({
        threadId,
        roomId,
        now: "2026-06-04T12:02:52.000Z",
        pressureCheck: () => ({ deferred: false }),
        askTurnRunner: async ({ wakeRequest }) => ({
          turn_id: "ask:wake-cycle-retained",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: {
                  artifactId: "stage_play_live_source_mail_decision",
                  decisionId: "stage_play_live_source_mail_decision:wake-cycle-retained",
                  mailIds: wakeRequest.mailIds,
                },
              },
            },
          ],
        }),
      });

      const wakes = listStagePlayLiveSourceMailWakeRequests({ threadId });
      const completedWake = wakes.find((wake) => wake.status === "completed");
      const retainedWake = wakes.find((wake) => wake.status === "queued");

      expect(completedWake).toMatchObject({
        mailIds: [first.mailId],
        askTurnId: "ask:wake-cycle-retained",
      });
      expect(retainedWake).toMatchObject({
        mailIds: [second.mailId],
        status: "queued",
      });
      expect(cycle.continuation).toMatchObject({
        scheduled: false,
        reason: "wake_runner_disabled",
        runnableWakeIds: [retainedWake?.wakeRequestId],
      });
      const transcriptEntries = listStagePlayLiveSourceMailTranscriptEntries({ threadId });
      const continuationRows = transcriptEntries.filter((entry) => entry.row.title === "Continuation state");
      expect(continuationRows).toHaveLength(1);
      expect(continuationRows[0].row.body).toContain("Batch checkpoint completed.");
      expect(continuationRows[0].row.body).toContain("Continuation: deferred; wake runner disabled.");
      expect(continuationRows[0].row.body).toContain("Loop state: armed_for_next_summary.");
      expect(continuationRows[0].row.body).toContain("Unread retained: 1.");
    } finally {
      if (previousBatchLimit === undefined) {
        delete process.env.STAGE_PLAY_MAIL_WAKE_ASK_BATCH_LIMIT;
      } else {
        process.env.STAGE_PLAY_MAIL_WAKE_ASK_BATCH_LIMIT = previousBatchLimit;
      }
    }
  });

  it("retries a stale no-turn launch attempt as queued work instead of treating it as running", async () => {
    seedVisualEvidence();
    const wake = listStagePlayLiveSourceMailWakeRequests({ threadId })[0];
    markStagePlayMailWakeRunning(wake.wakeRequestId, "2026-06-04T12:03:00.000Z");
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "queued",
      askTurnId: null,
      askLaunchStatus: "not_started",
      lifecycleReason: "wake_attempt_started_before_launch",
    });

    const retry = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:04:31.000Z",
      askTurnRunner: async () => ({
        turn_id: "ask:wake-stale-retry",
        current_turn_artifact_ledger: [
          {
            kind: "live_environment_tool_observation",
            payload: {
              tool_name: "live_env.record_live_source_mail_decision",
              observation: {
                artifactId: "stage_play_live_source_mail_decision",
                decisionId: "stage_play_live_source_mail_decision:wake-stale-retry",
              },
            },
          },
        ],
      }),
    });

    expect(retry).toMatchObject({
      status: "completed",
      askTurnId: "ask:wake-stale-retry",
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "completed",
      attemptCount: 2,
      askTurnId: "ask:wake-stale-retry",
      failureReason: null,
    });
  });

  it("keeps no-turn launch attempts non-locking when a newer queued wake runs first", async () => {
    seedVisualEvidence();
    const firstWake = listStagePlayLiveSourceMailWakeRequests({ threadId })[0];
    markStagePlayMailWakeRunning(firstWake.wakeRequestId, "2026-06-04T12:03:00.000Z");
    const newerMail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:newer-urgent",
      evidenceRef: "visual_evidence:newer-urgent",
      summaryText: "Newer visual summary reports fire damage and a sword visible on screen.",
      createdAt: "2026-06-04T12:03:18.000Z",
    });
    const newerWake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: [newerMail.mailId],
      sourceIds: [sourceId],
      reason: "unread_mail",
      evidenceRefs: [newerMail.mailId, ...newerMail.evidenceRefs],
      now: "2026-06-04T12:03:19.000Z",
    });
    expect(newerWake?.status).toBe("queued");

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:03:25.000Z",
      askTurnRunner: async ({ wakeRequest }) => ({
        turn_id: "ask:wake-newer-after-entry-stale",
        current_turn_artifact_ledger: [
          {
            kind: "live_environment_tool_observation",
            payload: {
              tool_name: "live_env.record_live_source_mail_decision",
              observation: {
                artifactId: "stage_play_live_source_mail_decision",
                decisionId: `stage_play_live_source_mail_decision:${wakeRequest.wakeRequestId}`,
                mailIds: wakeRequest.mailIds,
              },
            },
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      status: "completed",
      askTurnId: "ask:wake-newer-after-entry-stale",
      wakeRequestId: newerWake?.wakeRequestId,
    });
    const firstWakeAfter = listStagePlayLiveSourceMailWakeRequests({ threadId })
      .find((wake) => wake.wakeRequestId === firstWake.wakeRequestId);
    expect(firstWakeAfter).toMatchObject({
      status: "queued",
      askTurnId: null,
      failureReason: null,
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })
      .find((wake) => wake.wakeRequestId === newerWake?.wakeRequestId)).toMatchObject({
        status: "completed",
        askTurnId: "ask:wake-newer-after-entry-stale",
      });
    expect(listStagePlayLiveSourceMailWakeResults({ threadId })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        wakeRequestId: newerWake?.wakeRequestId,
        status: "completed",
        askTurnId: "ask:wake-newer-after-entry-stale",
      }),
    ]));
  });

  it("server admission cycle releases a stale running wake before dispatching Ask", async () => {
    seedVisualEvidence();
    const wake = listStagePlayLiveSourceMailWakeRequests({ threadId })[0];
    markStagePlayMailWakeRunning(wake.wakeRequestId, "2026-06-04T12:03:00.000Z", {
      askTurnId: "ask:wake-cycle-stale-running",
    });

    const cycle = await runStagePlayLiveSourceMailWakeAdmissionCycle({
      threadId,
      roomId,
      now: "2026-06-04T12:05:20.000Z",
      pressureCheck: () => ({ deferred: false }),
      askTurnRunner: async ({ wakeRequest }) => ({
        turn_id: "ask:wake-cycle-stale-release",
        current_turn_artifact_ledger: [
          {
            kind: "live_environment_tool_observation",
            payload: {
              tool_name: "live_env.record_live_source_mail_decision",
              observation: {
                artifactId: "stage_play_live_source_mail_decision",
                decisionId: "stage_play_live_source_mail_decision:wake-cycle-stale-release",
                mailIds: wakeRequest.mailIds,
              },
            },
          },
        ],
      }),
    });

    expect(cycle).toMatchObject({
      status: "completed",
      reason: "wake_admitted",
      lockState: {
        runningWakeIdsBeforeRelease: [wake.wakeRequestId],
        runningWakeIdsAfterRelease: [],
        releasedStaleWakeIds: [wake.wakeRequestId],
        status: "released_stale_wakes",
        reason: "wake_cycle_stale_released",
      },
      result: {
        status: "completed",
        askTurnId: "ask:wake-cycle-stale-release",
        decisionIds: ["stage_play_live_source_mail_decision:wake-cycle-stale-release"],
      },
    });
    const wakeResults = listStagePlayLiveSourceMailWakeResults({ threadId });
    expect(wakeResults.some((result) =>
      result.status === "failed_retryable" &&
      result.failedReason === "wake_cycle_stale_released" &&
      result.wakeRequestId === wake.wakeRequestId
    )).toBe(true);
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "completed",
      attemptCount: 2,
    });
  });

  it("server admission cycle keeps a fresh running wake locked and does not call Ask", async () => {
    seedVisualEvidence();
    const wake = listStagePlayLiveSourceMailWakeRequests({ threadId })[0];
    markStagePlayMailWakeRunning(wake.wakeRequestId, "2026-06-04T12:05:00.000Z", {
      askTurnId: "ask:wake-cycle-fresh-running",
    });

    const cycle = await runStagePlayLiveSourceMailWakeAdmissionCycle({
      threadId,
      roomId,
      now: "2026-06-04T12:05:20.000Z",
      pressureCheck: () => ({ deferred: false }),
      askTurnRunner: async () => {
        throw new Error("should_not_run_while_fresh_wake_running");
      },
    });

    expect(cycle).toMatchObject({
      status: "running",
      reason: "no_runnable_wake",
      lockState: {
        runningWakeIdsBeforeRelease: [wake.wakeRequestId],
        runningWakeIdsAfterRelease: [wake.wakeRequestId],
        releasedStaleWakeIds: [],
        status: "held",
        reason: "wake_request_running",
      },
      result: null,
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "running",
      attemptCount: 1,
    });
  });

  it("does not inject unrelated live-source mail context without an explicitly armed watch job", () => {
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:unarmed-context",
      evidenceRef: "visual_evidence:unarmed-context",
      summaryText: "Unarmed visual summary should stay out of future Ask context.",
      createdAt: "2026-06-04T12:05:00.000Z",
    });
    recordStagePlayMailDecision({
      threadId,
      roomId,
      mailIds: [mail.mailId],
      decision: "draft_text_answer",
      rationalePreview: "This unrelated decision must not enter consensual chat context.",
      textAnswerDraft: "Unrelated draft.",
      createdAt: "2026-06-04T12:05:01.000Z",
    });

    const pack = buildStagePlayLiveSourceMailContextPack({
      threadId,
      roomId,
      now: "2026-06-04T12:05:02.000Z",
    });

    expect(pack).toMatchObject({
      artifactId: "stage_play_live_source_mail_context_pack",
      includedReason: "none",
      activeWatchJobs: [],
      latestMailItems: [],
      latestDecisions: [],
      latestTextAnswerDrafts: [],
      latestVoiceCalloutDrafts: [],
      currentMailboxCursor: null,
      evidenceRefs: [],
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
  });

  it("builds compact future-Ask context from armed watch jobs, mail, and decisions", () => {
    const { policy } = configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceIds: [sourceId],
      objectiveText: "Watch the visual source and only announce if a hostile mob appears.",
      decisionPolicyPrompt: "Wait on harmless scene changes. Draft a callout only for hostile mobs.",
      importanceCriteria: ["hostile mob appears"],
      suppressCriteria: ["harmless camera movement"],
      outputPolicy: {
        allowTextAnswer: true,
        allowVoiceCallout: true,
        voiceRequiresUrgency: true,
        confirmationRequired: false,
      },
      now: "2026-06-04T12:06:00.000Z",
    });
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:armed-context",
      evidenceRef: "visual_evidence:armed-context",
      summaryText: "Compact visual summary: a hostile mob appears near the player. No raw image is included.",
      createdAt: "2026-06-04T12:06:01.000Z",
    });
    const decision = recordStagePlayMailDecision({
      threadId,
      roomId,
      mailIds: [mail.mailId],
      decision: "request_voice_callout",
      rationalePreview: "The watch policy asks for a callout when a hostile mob appears.",
      voiceCalloutDraft: "Hostile mob appeared near the player.",
      voiceEligible: true,
      voiceRequiresConfirmation: false,
      activeJobId: policy.jobId,
      createdAt: "2026-06-04T12:06:02.000Z",
    });

    const pack = buildStagePlayLiveSourceMailContextPack({
      threadId,
      roomId,
      now: "2026-06-04T12:06:03.000Z",
    });

    expect(pack.includedReason).toBe("armed_watch_job");
    expect(pack.activeWatchJobs).toHaveLength(1);
    expect(pack.activeWatchJobs[0]).toMatchObject({
      jobId: policy.jobId,
      policyId: policy.policyId,
      objectiveText: "Watch the visual source and only announce if a hostile mob appears.",
      decisionPolicyPrompt: "Wait on harmless scene changes. Draft a callout only for hostile mobs.",
      interpretationMode: "salience_watch",
      mailProcessingMode: "salience_window",
      outputCadence: "voice_only_salient",
      sourceIds: [sourceId],
      status: "armed",
    });
    expect(pack.latestMailItems).toEqual([
      expect.objectContaining({
        mailId: mail.mailId,
        sourceId,
        summaryPreview: expect.stringContaining("hostile mob appears"),
        evidenceRefs: expect.arrayContaining([
          sourceId,
          "visual_frame:armed-context",
          "visual_evidence:armed-context",
        ]),
      }),
    ]);
    expect(pack.latestDecisions).toEqual([
      expect.objectContaining({
        decisionId: decision.decisionId,
        decision: "request_voice_callout",
        voiceCalloutDraft: "Hostile mob appeared near the player.",
        activeJobId: policy.jobId,
        mailboxCursor: mail.mailId,
      }),
    ]);
    expect(pack.latestVoiceCalloutDrafts).toEqual([
      expect.objectContaining({
        decisionId: decision.decisionId,
        text: "Hostile mob appeared near the player.",
        voiceEligible: true,
      }),
    ]);
    expect(pack.currentMailboxCursor).toBe(mail.mailId);
    expect(pack.evidenceRefs).toEqual(expect.arrayContaining([
      policy.policyId,
      policy.jobId,
      mail.mailId,
      decision.decisionId,
    ]));
    expect(JSON.stringify(pack)).not.toMatch(/raw_image|data:image|base64/i);
  });

  it("keeps voice-disabled callouts as text-only decisions without voice tools", () => {
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:voice-disabled",
      evidenceRef: "visual_evidence:voice-disabled",
      summaryText: "A visual summary that would otherwise be announced.",
      createdAt: "2026-06-04T12:07:00.000Z",
    });

    const decision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [mail.mailId],
      decision: "request_voice_callout",
      rationalePreview: "Important update, but voice is off.",
      voiceCalloutDraft: "Important update near the player.",
      voicePolicy: {
        voiceEnabled: false,
        requiresConfirmation: false,
        allowedNow: false,
        reason: "voice_disabled_by_policy",
      },
      requestedTool: {
        toolName: "voice_delivery.confirm_speak",
        args: { text: "Important update near the player." },
      },
      now: "2026-06-04T12:07:01.000Z",
    });

    expect(decision.decision).toBe("request_voice_callout");
    expect(decision.textAnswerDraft?.text).toBe("Important update near the player.");
    expect(decision.voiceCalloutDraft).toMatchObject({
      text: "Important update near the player.",
      voiceEligible: false,
    });
    expect(decision.requestedTool).toBeNull();
    const rows = buildMailLoopTranscriptRows({ decision });
    expect(rows.map((row) => row.rowKind)).toContain("text_answer");
    expect(rows.map((row) => row.rowKind)).toContain("voice_callout_request");
    expect(rows.map((row) => row.rowKind)).not.toContain("voice_tool_call");
  });

  it("holds voice callouts for confirmation without requesting the voice tool", () => {
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:voice-confirm",
      evidenceRef: "visual_evidence:voice-confirm",
      summaryText: "A compact summary with an operator-relevant change.",
      createdAt: "2026-06-04T12:08:00.000Z",
    });

    const decision = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [mail.mailId],
      decision: "request_voice_callout",
      rationalePreview: "Voice requires confirmation, so draft only.",
      voiceCalloutDraft: "Operator-relevant change detected.",
      voicePolicy: {
        voiceEnabled: true,
        requiresConfirmation: true,
        allowedNow: false,
        reason: "confirmation_required",
      },
      requestedTool: {
        toolName: "voice_delivery.confirm_speak",
        args: { text: "Operator-relevant change detected." },
      },
      now: "2026-06-04T12:08:01.000Z",
    });

    expect(decision.decision).toBe("request_voice_callout");
    expect(decision.voiceCalloutDraft).toMatchObject({
      text: "Operator-relevant change detected.",
      voiceEligible: false,
      requiresConfirmation: true,
    });
    expect(decision.requestedTool).toBeNull();
    const rows = buildMailLoopTranscriptRows({ decision });
    expect(rows.map((row) => row.rowKind)).toContain("voice_callout_request");
    expect(rows.map((row) => row.rowKind)).not.toContain("voice_tool_call");
    expect(rows.find((row) => row.rowKind === "voice_callout_request")?.body).toMatch(/Awaiting confirmation/);
  });

  it("records allowed voice delivery as decision, voice tool, then voice receipt rows", async () => {
    configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceIds: [sourceId],
      objectiveText: "Watch the source and announce urgent changes.",
      decisionPolicyPrompt: "Request a voice callout when an urgent change appears.",
      outputPolicy: {
        allowTextAnswer: true,
        allowVoiceCallout: true,
        voiceRequiresUrgency: true,
        confirmationRequired: false,
      },
      importanceCriteria: ["urgent change"],
      now: "2026-06-04T12:09:00.000Z",
    });
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:voice-allowed",
      evidenceRef: "visual_evidence:voice-allowed",
      summaryText: "Urgent compact summary: hostile mob appeared near the player.",
      createdAt: "2026-06-04T12:09:01.000Z",
    });
    const wake = listStagePlayLiveSourceMailWakeRequests({ threadId }).find((entry) => entry.mailIds.includes(mail.mailId));
    expect(wake).toBeTruthy();
    let wakePrompt = "";
    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      now: "2026-06-04T12:09:02.000Z",
      askTurnRunner: async ({ wakeRequest, prompt }) => {
        wakePrompt = prompt;
        const decision = recordLiveSourceMailDecisionForAsk({
          threadId,
          roomId,
          mailIds: wakeRequest.mailIds,
          decision: "request_voice_callout",
          rationalePreview: "Urgent hostile mob update should be announced.",
          voiceCalloutDraft: "Hostile mob appeared near the player.",
          voicePolicy: {
            voiceEnabled: true,
            requiresConfirmation: false,
            allowedNow: true,
            reason: "urgent_voice_allowed",
          },
          requestedTool: {
            toolName: "live_env.request_interim_voice_callout",
            args: {
              kind: "tool_result",
              text: "Hostile mob appeared near the player.",
              max_chars: 120,
              reason_codes: ["urgent_live_source_policy_match"],
            },
          },
          now: "2026-06-04T12:09:03.000Z",
        });
        return {
          turn_id: "ask:wake-voice-allowed",
          current_turn_artifact_ledger: [
            {
              kind: "live_environment_tool_observation",
              payload: {
                tool_name: "live_env.record_live_source_mail_decision",
                observation: decision,
              },
            },
          ],
        };
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      askTurnId: "ask:wake-voice-allowed",
    });
    expect(result.evidenceRefs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^stage_play_live_source_voice_delivery_receipt:/),
      expect.stringMatching(/^helix_interim_voice_callout_receipt:/),
    ]));
    expect(listStagePlayLiveSourceMailWakeRequests({ threadId })[0]).toMatchObject({
      status: "completed",
      askTurnId: "ask:wake-voice-allowed",
      evidenceRefs: expect.arrayContaining([
        expect.stringMatching(/^stage_play_live_source_voice_delivery_receipt:/),
        expect.stringMatching(/^helix_interim_voice_callout_receipt:/),
      ]),
    });
    expect(wakePrompt).toContain("Current task: voice_callout_candidate");
    expect(wakePrompt).toContain("Voice candidate receipt:");
    expect(wakePrompt).toContain("Processed mail packet:");
    expect(wakePrompt).toContain("Use the processed mail packet as the primary compact evidence packet");
    expect(wakePrompt).toContain("decision_required: choose request_voice_callout, draft_text_answer, or wait_for_next_summary");
    expect(wakePrompt).toContain("Minecraft voice candidates include player on fire, hostile mob, lava, fall, low health");
    expect(wakePrompt).toContain("Suppress voice for stable chest/inventory frames");
    const packet = getLatestStagePlayProcessedMailPacket({
      sourceId,
      mailId: mail.mailId,
    });
    expect(packet).toMatchObject({
      artifactId: "stage_play_processed_mail_packet",
      context_role: "tool_evidence",
      assistant_answer: false,
      terminal_eligible: false,
      recommendedNext: "request_voice_callout",
      salience: expect.objectContaining({
        voiceCandidate: true,
      }),
      resolutionState: "voice_candidate_prepared",
    });
    expect(packet?.observedFacts.join("\n")).toMatch(/hostile mob/i);
    const entries = listStagePlayLiveSourceMailTranscriptEntries({ threadId, askTurnId: "ask:wake-voice-allowed" });
    const rowKinds = entries.map((entry) => entry.row.rowKind);
    const decisionIndex = rowKinds.indexOf("agent_decision");
    const toolIndex = rowKinds.indexOf("voice_tool_call");
    const receiptIndex = rowKinds.indexOf("voice_receipt");
    expect(decisionIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeGreaterThan(decisionIndex);
    expect(receiptIndex).toBeGreaterThan(toolIndex);
    expect(entries.find((entry) => entry.row.rowKind === "voice_tool_call")?.row.body).toMatch(/live_env\.request_interim_voice_callout/);
    expect(entries.find((entry) => entry.row.rowKind === "voice_receipt")?.row.body).toMatch(/Interim voice callout accepted|queued for retry/i);
    expect(entries.find((entry) => entry.row.rowKind === "voice_receipt")?.row.body).toMatch(/helix_interim_voice_callout_receipt:/);
    expect(entries.find((entry) => entry.row.rowKind === "processed_mail_packet")?.row.body).toContain("voice_candidate_prepared");
  });
});
