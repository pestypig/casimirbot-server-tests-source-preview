import { beforeEach, describe, expect, it } from "vitest";
import {
  configureStagePlayLiveSourceWatchJobPolicy,
  enqueueStagePlayLiveSourceMailItem,
  recordStagePlayMailDecision,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import { recordStagePlayLiveSourceNarrativeState } from "../services/stage-play/stage-play-live-source-narrative-store";
import {
  recordStagePlayLiveSourceConversationEvent,
  resetStagePlayLiveSourceConversationStoreForTest,
} from "../services/stage-play/stage-play-live-source-conversation-store";
import {
  evaluateStagePlayLiveSourceMemoryConsolidationQuietWindow,
  maybeQueueStagePlayLiveSourceMemoryConsolidation,
  recordStagePlayLiveSourceMemoryConsolidation,
  resetStagePlayLiveSourceMemoryConsolidationForTest,
} from "../services/stage-play/stage-play-live-source-memory-consolidation";
import {
  listStagePlayLiveSourceTasks,
  resetStagePlayLiveSourceTaskQueueForTest,
} from "../services/stage-play/stage-play-live-source-task-queue";

const threadId = "thread:live-source-memory-consolidation";
const roomId = "room:memory-consolidation";
const sourceId = "visual_source:memory-consolidation";

const setupPolicy = () => configureStagePlayLiveSourceWatchJobPolicy({
  threadId,
  roomId,
  sourceIds: [sourceId],
  objectiveText: "Watch the source for meaningful changes and keep the running story compressed.",
  importanceCriteria: ["new scene", "risk appears", "objective changes"],
  suppressCriteria: ["static frame", "minor visual jitter"],
  outputPolicy: {
    allowTextAnswer: true,
    allowVoiceCallout: true,
    voiceRequiresUrgency: true,
    confirmationRequired: false,
  },
  now: "2026-06-04T12:00:00.000Z",
});

const recordProcessedMail = (input: {
  count: number;
  jobId: string;
  startMinute?: number;
}) => {
  const mail = [];
  for (let index = 0; index < input.count; index += 1) {
    const minute = input.startMinute ?? 1;
    const createdAt = `2026-06-04T12:${String(minute + index).padStart(2, "0")}:00.000Z`;
    const item = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: `visual_frame:memory-consolidation:${index}`,
      evidenceRef: `visual_evidence:memory-consolidation:${index}`,
      summaryText: `Compact source summary ${index}: the scene changes without urgent risk.`,
      createdAt,
    });
    recordStagePlayMailDecision({
      threadId,
      roomId,
      mailIds: [item.mailId],
      activeJobId: input.jobId,
      decision: "record_interpretation",
      rationalePreview: `Recorded interpretation for compact summary ${index}.`,
      evidenceRefs: [`decision_evidence:${index}`],
      createdAt: createdAt.replace(":00.000Z", ":30.000Z"),
    });
    mail.push(item);
  }
  return mail;
};

beforeEach(() => {
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayLiveSourceConversationStoreForTest();
  resetStagePlayLiveSourceTaskQueueForTest();
  resetStagePlayLiveSourceMemoryConsolidationForTest();
});

describe("stage play live-source memory consolidation", () => {
  it("does not queue consolidation before processed-mail and context-pressure thresholds", () => {
    const { policy } = setupPolicy();
    recordProcessedMail({ count: 2, jobId: policy.jobId });

    const queued = maybeQueueStagePlayLiveSourceMemoryConsolidation({
      threadId,
      roomId,
      jobId: policy.jobId,
      policyId: policy.policyId,
      processedMailBatchThreshold: 5,
      contextPressureThreshold: 10,
      now: "2026-06-04T12:20:00.000Z",
    });

    expect(queued.task).toBeNull();
    expect(queued.quietWindow).toMatchObject({
      quiet: false,
      reason: "insufficient_processed_mail_batches",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
    });
  });

  it("blocks quiet-window consolidation when urgent unread mail is present", () => {
    const { policy } = setupPolicy();
    recordProcessedMail({ count: 5, jobId: policy.jobId });
    const urgent = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:urgent",
      evidenceRef: "visual_evidence:urgent",
      summaryText: "Urgent warning: a critical risk appears in the live source.",
      createdAt: "2026-06-04T12:20:00.000Z",
    });

    const quietWindow = evaluateStagePlayLiveSourceMemoryConsolidationQuietWindow({
      threadId,
      roomId,
      jobId: policy.jobId,
      processedMailBatchThreshold: 5,
      contextPressureThreshold: 5,
    });

    expect(quietWindow.reason).toBe("urgent_mail_present");
    expect(quietWindow.quiet).toBe(false);
    expect(quietWindow.evidenceRefs).toContain(urgent.mailId);
  });

  it("blocks quiet-window consolidation while an active user prompt is present", () => {
    const { policy } = setupPolicy();
    recordProcessedMail({ count: 5, jobId: policy.jobId });
    const conversationEvent = recordStagePlayLiveSourceConversationEvent({
      threadId,
      jobId: policy.jobId,
      source: "user_text",
      text: "What should I do next with this live source?",
      now: "2026-06-04T12:20:00.000Z",
    });

    const queued = maybeQueueStagePlayLiveSourceMemoryConsolidation({
      threadId,
      roomId,
      jobId: policy.jobId,
      processedMailBatchThreshold: 5,
      contextPressureThreshold: 5,
    });

    expect(queued.task).toBeNull();
    expect(queued.quietWindow.reason).toBe("active_user_prompt_present");
    expect(queued.quietWindow.evidenceRefs).toContain(conversationEvent.eventId);
  });

  it("queues one background memory_consolidation task in a quiet window", () => {
    const { policy } = setupPolicy();
    recordProcessedMail({ count: 5, jobId: policy.jobId });

    const first = maybeQueueStagePlayLiveSourceMemoryConsolidation({
      threadId,
      roomId,
      jobId: policy.jobId,
      policyId: policy.policyId,
      sourceIds: [sourceId],
      processedMailBatchThreshold: 5,
      contextPressureThreshold: 5,
      now: "2026-06-04T12:30:00.000Z",
    });
    const second = maybeQueueStagePlayLiveSourceMemoryConsolidation({
      threadId,
      roomId,
      jobId: policy.jobId,
      policyId: policy.policyId,
      sourceIds: [sourceId],
      processedMailBatchThreshold: 5,
      contextPressureThreshold: 5,
      now: "2026-06-04T12:30:01.000Z",
    });

    expect(first.quietWindow.reason).toBe("quiet_window_ready");
    expect(first.task).toMatchObject({
      taskKind: "memory_consolidation",
      priority: "background",
      status: "queued",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
    });
    expect(second.task).toBeNull();
    expect(second.quietWindow.reason).toBe("memory_consolidation_already_queued_or_running");
    expect(listStagePlayLiveSourceTasks({ threadId, jobId: policy.jobId, status: "queued" })
      .filter((task) => task.taskKind === "memory_consolidation")).toHaveLength(1);
  });

  it("records an evidence-only consolidation artifact with compressed story fields", () => {
    const { policy } = setupPolicy();
    const mail = recordProcessedMail({ count: 5, jobId: policy.jobId });
    const firstNarrative = recordStagePlayLiveSourceNarrativeState({
      threadId,
      roomId,
      jobId: policy.jobId,
      policyId: policy.policyId,
      sourceIds: [sourceId],
      mailBatchRefs: [mail[0].mailId],
      currentSceneSummary: "The source showed the player near a cave entrance.",
      runningStorySummary: "The user is watching a cave route while deciding whether to continue or retreat.",
      interpretedSituation: {
        setting: "game screen",
        objects: ["cave entrance", "inventory bar"],
        activities: ["route scouting"],
        userRelevantMeaning: "The source is about route choice and risk assessment.",
      },
      prediction: {
        text: "The next mail should show whether the player enters the cave or backs away.",
        horizon: "next_mail",
        confidence: 0.7,
        validationSignals: ["player enters cave", "player backs away"],
      },
      createdAt: "2026-06-04T12:10:00.000Z",
    });
    recordStagePlayLiveSourceNarrativeState({
      threadId,
      roomId,
      jobId: policy.jobId,
      policyId: policy.policyId,
      sourceIds: [sourceId],
      mailBatchRefs: [mail[1].mailId],
      currentSceneSummary: "The source showed the player entering the cave.",
      runningStorySummary: "The player moved from cave approach into cave exploration.",
      interpretedSituation: {
        objects: ["cave path", "torch"],
        activities: ["cave exploration"],
        userRelevantMeaning: "The watch target should shift from route choice to cave hazards.",
      },
      watchNext: {
        targets: ["hostile mobs", "low light", "blocked path"],
        reason: "Watch for hazards inside the cave.",
      },
      createdAt: "2026-06-04T12:11:00.000Z",
    });
    recordStagePlayLiveSourceConversationEvent({
      threadId,
      jobId: policy.jobId,
      source: "user_text",
      text: "Only call out danger or diamonds, and keep the voice short.",
      now: "2026-06-04T12:12:00.000Z",
    });

    const consolidation = recordStagePlayLiveSourceMemoryConsolidation({
      threadId,
      roomId,
      jobId: policy.jobId,
      policyId: policy.policyId,
      sourceIds: [sourceId],
      now: "2026-06-04T12:30:00.000Z",
    });

    expect(consolidation).toMatchObject({
      artifactId: "stage_play_live_source_memory_consolidation",
      threadId,
      jobId: policy.jobId,
      processedMailBatchCount: 5,
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(consolidation.consolidatedRunningStory).toContain("cave exploration");
    expect(consolidation.sourcePatterns).toEqual(expect.arrayContaining(["cave path", "cave exploration", "record_interpretation"]));
    expect(consolidation.currentObjective).toContain("Watch the source");
    expect(consolidation.stalePredictions.some((entry) => entry.includes(firstNarrative.narrativeStateId))).toBe(true);
    expect(consolidation.policyRelevantMemories).toEqual(expect.arrayContaining([
      "importance: new scene",
      "suppress: static frame",
      "voice: Only call out danger or diamonds, and keep the voice short.",
    ]));
    expect(consolidation.evidenceRefs).toContain(policy.policyId);
  });
});
