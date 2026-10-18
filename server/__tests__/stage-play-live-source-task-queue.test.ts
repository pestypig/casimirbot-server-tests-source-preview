import { beforeEach, describe, expect, it } from "vitest";
import {
  blockStagePlayLiveSourceTask,
  buildStagePlayLiveSourceTaskTranscriptRows,
  claimNextStagePlayLiveSourceTask,
  completeStagePlayLiveSourceTask,
  deferStagePlayLiveSourceTask,
  enqueueStagePlayLiveSourceTask,
  getStagePlayLiveSourceTask,
  getStagePlayLiveSourceTaskQueueSnapshot,
  listStagePlayLiveSourceTasks,
  resetStagePlayLiveSourceTaskQueueForTest,
} from "../services/stage-play/stage-play-live-source-task-queue";

const threadId = "thread:live-source-task-queue";
const jobId = "stage_play_live_source_job:task-queue";
const policyId = "stage_play_live_source_watch_job_policy:task-queue";

beforeEach(() => {
  resetStagePlayLiveSourceTaskQueueForTest();
});

describe("stage play live-source task queue", () => {
  it("orders one-agent work by priority and task kind", () => {
    const projection = enqueueStagePlayLiveSourceTask({
      threadId,
      jobId,
      policyId,
      taskKind: "long_horizon_projection",
      priority: "background",
      now: "2026-06-04T12:00:00.000Z",
    });
    const interpretation = enqueueStagePlayLiveSourceTask({
      threadId,
      jobId,
      policyId,
      taskKind: "mail_batch_interpretation",
      priority: "normal",
      now: "2026-06-04T12:00:01.000Z",
    });
    const userPrompt = enqueueStagePlayLiveSourceTask({
      threadId,
      jobId,
      policyId,
      taskKind: "user_prompt_response",
      priority: "high",
      now: "2026-06-04T12:00:02.000Z",
    });
    const voice = enqueueStagePlayLiveSourceTask({
      threadId,
      jobId,
      policyId,
      taskKind: "voice_callout_candidate",
      priority: "urgent",
      now: "2026-06-04T12:00:03.000Z",
    });

    expect(listStagePlayLiveSourceTasks({ threadId, status: "queued" }).map((task) => task.taskId)).toEqual([
      voice.taskId,
      userPrompt.taskId,
      interpretation.taskId,
      projection.taskId,
    ]);
  });

  it("claims only one running task per thread", () => {
    const first = enqueueStagePlayLiveSourceTask({
      threadId,
      taskKind: "mail_batch_interpretation",
      priority: "normal",
    });
    enqueueStagePlayLiveSourceTask({
      threadId,
      taskKind: "prediction_error_review",
      priority: "high",
    });

    const claimed = claimNextStagePlayLiveSourceTask({ threadId });
    const secondClaim = claimNextStagePlayLiveSourceTask({ threadId });

    expect(claimed?.taskKind).toBe("prediction_error_review");
    expect(claimed?.status).toBe("running");
    expect(secondClaim).toBeNull();
    expect(getStagePlayLiveSourceTask(first.taskId)?.status).toBe("queued");
  });

  it("releases the next queued task after completing the active task", () => {
    enqueueStagePlayLiveSourceTask({
      threadId,
      taskKind: "user_prompt_response",
      priority: "high",
    });
    const background = enqueueStagePlayLiveSourceTask({
      threadId,
      taskKind: "memory_consolidation",
      priority: "background",
    });

    const active = claimNextStagePlayLiveSourceTask({ threadId });
    expect(active?.taskKind).toBe("user_prompt_response");
    completeStagePlayLiveSourceTask({ taskId: active?.taskId ?? "", reason: "user_prompt_answered" });

    const next = claimNextStagePlayLiveSourceTask({ threadId });
    expect(next?.taskId).toBe(background.taskId);
    expect(next?.status).toBe("running");
  });

  it("supersedes queued task refs when a newer task replaces them", () => {
    const oldTask = enqueueStagePlayLiveSourceTask({
      threadId,
      taskKind: "immediate_prediction_check",
      mailIds: ["mail:old"],
    });
    const replacement = enqueueStagePlayLiveSourceTask({
      threadId,
      taskKind: "prediction_error_review",
      mailIds: ["mail:new"],
      supersedesTaskRefs: [oldTask.taskId],
    });

    expect(getStagePlayLiveSourceTask(oldTask.taskId)).toMatchObject({
      status: "superseded",
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(replacement.supersedesTaskRefs).toEqual([oldTask.taskId]);
  });

  it("recommends urgent soft interrupt for background running work without hard interrupting it", () => {
    const background = enqueueStagePlayLiveSourceTask({
      threadId,
      taskKind: "long_horizon_projection",
      priority: "background",
    });
    const running = claimNextStagePlayLiveSourceTask({ threadId });
    const urgent = enqueueStagePlayLiveSourceTask({
      threadId,
      taskKind: "voice_callout_candidate",
      priority: "urgent",
      mailIds: ["mail:urgent"],
    });

    const snapshot = getStagePlayLiveSourceTaskQueueSnapshot({ threadId });

    expect(running?.taskId).toBe(background.taskId);
    expect(getStagePlayLiveSourceTask(background.taskId)?.status).toBe("running");
    expect(getStagePlayLiveSourceTask(urgent.taskId)?.status).toBe("queued");
    expect(snapshot).toMatchObject({
      softInterruptRecommended: true,
      softInterruptReason: "Urgent task should be admitted at the next safe boundary; no hard interrupt is requested.",
      runningTask: {
        taskId: background.taskId,
        status: "running",
      },
      queuedTasks: [
        expect.objectContaining({
          taskId: urgent.taskId,
          priority: "urgent",
        }),
      ],
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("defer, block, complete, and transcript rows preserve evidence-only authority", () => {
    const task = enqueueStagePlayLiveSourceTask({
      threadId,
      taskKind: "immediate_prediction_check",
      mailIds: ["mail:prediction"],
      evidenceRefs: ["evidence:prediction"],
    });
    const running = claimNextStagePlayLiveSourceTask({ threadId });
    const deferred = deferStagePlayLiveSourceTask({
      taskId: running?.taskId ?? "",
      reason: "active_user_prompt_has_priority",
      activeTaskRef: "task:user_prompt",
    });
    const blocked = blockStagePlayLiveSourceTask({
      taskId: task.taskId,
      reason: "source_missing",
    });
    const completed = completeStagePlayLiveSourceTask({
      taskId: task.taskId,
      reason: "prediction_recorded",
    });
    const rows = buildStagePlayLiveSourceTaskTranscriptRows({
      tasks: [task, deferred!, blocked!, completed!],
      createdAt: "2026-06-04T12:00:00.000Z",
    });

    expect(deferred).toMatchObject({
      status: "deferred",
      activeTaskRef: "task:user_prompt",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(blocked?.status).toBe("blocked");
    expect(completed?.status).toBe("completed");
    expect(rows.map((row) => row.title)).toEqual(expect.arrayContaining([
      "Task queued",
      "Task deferred",
      "Task completed",
    ]));
    expect(rows.every((row) => row.authority === "tool_evidence")).toBe(true);
    expect(rows.every((row) => row.assistantAnswer === false)).toBe(true);
    expect(rows.every((row) => row.terminalEligible === false)).toBe(true);
  });
});
