import { beforeEach, describe, expect, it } from "vitest";
import { executeLiveEnvironmentTool } from "../services/helix-ask/live-environment-tool-adapter";
import { buildLiveEnvironmentRuntimePacket } from "../services/situation-room/live-environment-runtime-packet-builder";
import { resetSituationSourceCapabilitiesForTest } from "../services/situation-room/situation-source-capability-store";
import {
  analyzeVisualFrame,
  recordVisualFrame,
  resetVisualSnapshotStoreForTest,
  startVisualSnapshotSource,
} from "../services/situation-room/visual-snapshot-store";
import {
  listStagePlayLiveSourceMailItems,
  recordStagePlayMailDecision,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import {
  queueStagePlayLiveSourceMailWakeRequest,
  markStagePlayMailWakeRetryable,
  resetStagePlayLiveSourceMailWakeStoreForTest,
} from "../services/stage-play/stage-play-live-source-mail-wake-store";
import {
  runNextMailWakeRequest,
  type AskWakeTurnRunner,
} from "../services/stage-play/stage-play-live-source-mail-wake-runner";
import {
  listStagePlayLiveSourceMailTranscriptEntries,
  resetStagePlayLiveSourceMailTranscriptStoreForTest,
} from "../services/stage-play/stage-play-live-source-mail-transcript-store";
import { resetStagePlayLiveSourceNarrativeStoreForTest } from "../services/stage-play/stage-play-live-source-narrative-store";
import {
  queryStagePlayLiveSourceQuality,
  summarizeStagePlayLiveSourceCurrentState,
} from "../services/stage-play/stage-play-live-source-current-state";
import {
  getLiveSourceBudgetState,
  listLiveSourceBudgetStates,
  resetLiveSourceBudgetStoreForTest,
} from "../services/stage-play/stage-play-live-source-budget-store";
import {
  listStagePlayGoalContextUpdates,
  resetStagePlayGoalContextStoreForTest,
} from "../services/stage-play/stage-play-goal-context-store";

const threadId = "thread:live-source-current-state";
const roomId = "room:live-source-current-state";
const sourceId = "visual_source:live-source-current-state";

beforeEach(() => {
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayLiveSourceMailWakeStoreForTest();
  resetStagePlayLiveSourceNarrativeStoreForTest();
  resetStagePlayLiveSourceMailTranscriptStoreForTest();
  resetLiveSourceBudgetStoreForTest();
  resetStagePlayGoalContextStoreForTest();
  resetVisualSnapshotStoreForTest();
  resetSituationSourceCapabilitiesForTest();
});

const seedVisualSummary = (input: {
  ts: string;
  summary?: string;
  confidence?: number;
  cadenceMs?: number;
}) => {
  startVisualSnapshotSource({
    source_id: sourceId,
    thread_id: threadId,
    room_id: roomId,
    source_surface: "browser_tab",
    capture_mode: "interval",
    cadence_ms: input.cadenceMs ?? 10_000,
    status: "active",
  });
  const frame = recordVisualFrame({
    source_id: sourceId,
    thread_id: threadId,
    room_id: roomId,
    frame_id: `visual_frame:current-state:${input.ts}`,
    ts: input.ts,
  });
  return analyzeVisualFrame({
    thread_id: threadId,
    frame_id: frame.frame_id,
    evidence_id: `visual_evidence:current-state:${input.ts}`,
    ts: input.ts,
    summary: input.summary ?? "Minecraft-like scene with a player looking at a moonlit mountain.",
    supports_claims: [
      {
        claim: "The compact visual summary is available.",
        support_status: "supports",
        confidence: input.confidence ?? 0.82,
      },
    ],
  });
};

const makeDecisionAskRunner = (): AskWakeTurnRunner =>
  async ({ wakeRequest }) => {
    const decision = recordStagePlayMailDecision({
      mailIds: wakeRequest.mailIds,
      threadId: wakeRequest.threadId,
      roomId: wakeRequest.roomId ?? null,
      environmentId: wakeRequest.environmentId ?? null,
      decision: "draft_text_answer",
      rationalePreview: "The compact mail batch was processed.",
      textAnswerDraft: "The latest compact visual mail was processed.",
      textAnswerTerminalEligible: false,
      activeJobId: wakeRequest.jobId ?? null,
      evidenceRefs: wakeRequest.evidenceRefs,
      createdAt: "2026-06-04T12:10:05.000Z",
    });
    return {
      turn_id: `ask_turn:${wakeRequest.wakeRequestId}`,
      current_turn_artifact_ledger: [
        {
          payload: decision,
        },
      ],
    };
  };

describe("live-source current state and source quality", () => {
  it("advertises current-state and quality tools as evidence-only capabilities", () => {
    const packet = buildLiveEnvironmentRuntimePacket({
      threadId,
      roomId,
      now: "2026-06-04T12:10:05.000Z",
    });

    expect(packet.available_tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool_id: "live_env.query_live_source_quality",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.summarize_live_source_current_state",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
    ]));
  });

  it("reports fresh source quality from compact visual evidence", () => {
    seedVisualSummary({
      ts: "2026-06-04T12:10:00.000Z",
      summary: "A Minecraft player stands near a cat and an enchantment table.",
    });

    const quality = queryStagePlayLiveSourceQuality({
      threadId,
      roomId,
      sourceId,
      expectedCadenceMs: 10_000,
      now: "2026-06-04T12:10:06.000Z",
    });

    expect(quality).toMatchObject({
      artifactId: "stage_play_live_source_quality",
      schemaVersion: "stage_play_live_source_quality/v1",
      sourceId,
      freshness: "fresh",
      quality: "good",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(quality.modality.visualAvailable).toBe(true);
    expect(quality.modality.audioMissing).toBe(true);
    expect(quality.latestRefs.mailId).toMatch(/^stage_play_live_source_mail:/);
    expect(quality.evidenceRefs).toContain(sourceId);
  });

  it("reports stale or degraded quality instead of fake real-time confidence", () => {
    seedVisualSummary({
      ts: "2026-06-04T12:00:00.000Z",
      summary: "An old compact visual summary exists.",
      confidence: 0.7,
    });

    const quality = queryStagePlayLiveSourceQuality({
      threadId,
      roomId,
      sourceId,
      expectedCadenceMs: 10_000,
      now: "2026-06-04T12:05:30.000Z",
    });

    expect(quality.freshness).toBe("stale");
    expect(quality.quality).toBe("stale");
    expect(quality.limitations.join(" ")).toMatch(/stale/i);
    expect(quality.assistant_answer).toBe(false);
  });

  it("surfaces backlog and deferred wake pressure", () => {
    seedVisualSummary({
      ts: "2026-06-04T12:10:00.000Z",
      summary: "A browser screen shows a stable app grid.",
    });
    const mail = listStagePlayLiveSourceMailItems({ threadId, roomId, sourceId, limit: 1 }).at(-1);
    expect(mail).toBeTruthy();
    const wake = queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: [mail!.mailId],
      sourceIds: [sourceId],
      reason: "unread_mail",
      evidenceRefs: [mail!.mailId],
      causalTraces: [mail!.causalTrace],
      now: "2026-06-04T12:10:01.000Z",
    });
    expect(wake).toBeTruthy();
    markStagePlayMailWakeRetryable({
      wakeRequestId: wake!.wakeRequestId,
      status: "deferred_for_pressure",
      failureReason: "memory_pressure",
      nextRetryAt: "2026-06-04T12:10:30.000Z",
      now: "2026-06-04T12:10:02.000Z",
    });

    const quality = queryStagePlayLiveSourceQuality({
      threadId,
      roomId,
      sourceId,
      now: "2026-06-04T12:10:03.000Z",
    });

    expect(quality.quality).toBe("degraded");
    expect(quality.backlog.deferredWakeCount).toBe(1);
    expect(quality.pressure).toMatchObject({
      askBusy: false,
      deferredForPressure: true,
      reason: "wake_deferred_for_pressure",
    });
    expect(quality.limitations.join(" ")).toMatch(/deferred|real-time/i);
  });

  it("summarizes current state from compact mail, narrative, quality, and next tool hint", () => {
    seedVisualSummary({
      ts: "2026-06-04T12:10:00.000Z",
      summary: "A Minecraft-like scene shows a character beside a cat and a book stand.",
    });

    const currentState = summarizeStagePlayLiveSourceCurrentState({
      threadId,
      roomId,
      sourceId,
      now: "2026-06-04T12:10:03.000Z",
    });

    expect(currentState).toMatchObject({
      artifactId: "stage_play_live_source_current_state",
      schemaVersion: "stage_play_live_source_current_state/v1",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(currentState.latestMailItems).toHaveLength(1);
    expect(currentState.latestMailItems[0].preview).toMatch(/Minecraft-like scene/);
    expect(currentState.quality.freshness).toBe("fresh");
    expect(currentState.whatAskCanSafelySay.join(" ")).toMatch(/Latest compact live-source summary is fresh/);
    expect(currentState.nextUsefulTool).toBe("live_env.read_processed_live_source_mail");
    expect(currentState.causalTrace?.producedRefs).toContain(currentState.currentStateId);
  });

  it("returns an insufficient evidence-only current state when no source evidence exists", () => {
    const currentState = summarizeStagePlayLiveSourceCurrentState({
      threadId,
      roomId,
      now: "2026-06-04T12:10:03.000Z",
    });

    expect(currentState.quality.freshness).toBe("missing");
    expect(currentState.quality.quality).toBe("insufficient");
    expect(currentState.latestMailItems).toEqual([]);
    expect(currentState.whatAskCanSafelySay.join(" ")).toMatch(/No compact live-source summary/);
    expect(currentState.assistant_answer).toBe(false);
    expect(currentState.terminal_eligible).toBe(false);
  });

  it("executes current-state tools through the live environment adapter as evidence only", () => {
    seedVisualSummary({
      ts: "2026-06-04T12:10:00.000Z",
      summary: "The active visual source shows a Minecraft scene with mountains.",
    });

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.summarize_live_source_current_state",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        expected_cadence_ms: 10_000,
      },
    });

    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.summarize_live_source_current_state",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(observation.summary).toMatch(/quality good|quality degraded|quality stale|quality insufficient/);
    const payload = observation.observation as any;
    expect(payload).toMatchObject({
      artifactId: "stage_play_live_source_current_state",
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload.latestMailItems[0].preview).toMatch(/Minecraft scene/);
  });

  it("executes source-quality tools through the live environment adapter as evidence only", () => {
    seedVisualSummary({
      ts: "2026-06-04T12:10:00.000Z",
      summary: "The compact visual source summary is ready.",
    });

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_live_source_quality",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        expected_cadence_ms: 10_000,
      },
    });

    expect(observation).toMatchObject({
      tool_name: "live_env.query_live_source_quality",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    const payload = observation.observation as any;
    expect(payload).toMatchObject({
      artifactId: "stage_play_live_source_quality",
      schemaVersion: "stage_play_live_source_quality/v1",
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:source_health:/),
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(payload.latestRefs.mailId).toMatch(/^stage_play_live_source_mail:/);
    const qualityUpdate = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "source_health",
      updateKind: "source_status",
      limit: 1,
    })[0];
    expect(qualityUpdate).toMatchObject({
      updateId: payload.goalContextUpdateId,
      contentRef: payload.qualityId,
      toolIdentity: {
        requestedToolName: "live_env.query_live_source_quality",
        canonicalToolName: "live_env.query_live_source_quality",
        matchedAllowedActuators: [],
        matchedAllowedActuatorRefs: [],
      },
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
  });

  it("records a processed budget receipt for a completed wake", async () => {
    seedVisualSummary({
      ts: "2026-06-04T12:10:00.000Z",
      summary: "A fresh compact visual summary is ready for a wake.",
    });
    const mail = listStagePlayLiveSourceMailItems({ threadId, roomId, sourceId, limit: 1 }).at(-1);
    expect(mail).toBeTruthy();
    queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: [mail!.mailId],
      sourceIds: [sourceId],
      evidenceRefs: [mail!.mailId],
      causalTraces: [mail!.causalTrace],
      now: "2026-06-04T12:10:01.000Z",
    });

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      askTurnRunner: makeDecisionAskRunner(),
      pressureCheck: () => ({ deferred: false }),
      now: "2026-06-04T12:10:02.000Z",
    });

    expect(result).toMatchObject({
      status: "completed",
      budgetStateRef: expect.stringMatching(/^live_source_budget_state:/),
    });
    const budget = getLiveSourceBudgetState(result!.budgetStateRef!);
    expect(budget).toMatchObject({
      artifactId: "live_source_budget_state",
      schemaVersion: "live_source_budget_state/v1",
      action: "processed",
      reason: "wake_processed",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
      mailCounts: {
        wakeMailCount: 1,
        processedMailCount: 1,
        retainedMailCount: 0,
      },
    });
    const entries = listStagePlayLiveSourceMailTranscriptEntries({ threadId, roomId, limit: 50 });
    expect(entries.some((entry) =>
      entry.row.rowKind === "budget_state" &&
      /processed: wake_processed/i.test(entry.row.body)
    )).toBe(true);
  });

  it("records a batched budget receipt when wake mail is split by batch limit", async () => {
    const previousLimit = process.env.STAGE_PLAY_MAIL_WAKE_ASK_BATCH_LIMIT;
    process.env.STAGE_PLAY_MAIL_WAKE_ASK_BATCH_LIMIT = "1";
    try {
      seedVisualSummary({
        ts: "2026-06-04T12:10:00.000Z",
        summary: "First compact summary in a batch.",
      });
      seedVisualSummary({
        ts: "2026-06-04T12:10:01.000Z",
        summary: "Second compact summary retained for a later batch.",
      });
      const mail = listStagePlayLiveSourceMailItems({ threadId, roomId, sourceId, limit: 10 });
      expect(mail).toHaveLength(2);
      queueStagePlayLiveSourceMailWakeRequest({
        threadId,
        roomId,
        mailIds: mail.map((item) => item.mailId),
        sourceIds: [sourceId],
        evidenceRefs: mail.map((item) => item.mailId),
        causalTraces: mail.map((item) => item.causalTrace),
        now: "2026-06-04T12:10:02.000Z",
      });

      const result = await runNextMailWakeRequest({
        threadId,
        roomId,
        askTurnRunner: makeDecisionAskRunner(),
        pressureCheck: () => ({ deferred: false }),
        now: "2026-06-04T12:10:03.000Z",
      });

      const budget = getLiveSourceBudgetState(result!.budgetStateRef!);
      expect(result?.status).toBe("completed");
      expect(budget).toMatchObject({
        action: "batched",
        reason: "wake_batch_split",
        mailCounts: {
          wakeMailCount: 1,
          processedMailCount: 1,
          retainedMailCount: 1,
        },
        allowedNextAction: "batch",
      });
      const currentState = summarizeStagePlayLiveSourceCurrentState({
        threadId,
        roomId,
        sourceId,
        now: "2026-06-04T12:10:04.000Z",
      });
      expect(currentState.budget?.action).toBe("batched");
      expect(currentState.whatAskCanSafelySay.join(" ")).toMatch(/Latest budget action: batched/);
    } finally {
      if (previousLimit === undefined) {
        delete process.env.STAGE_PLAY_MAIL_WAKE_ASK_BATCH_LIMIT;
      } else {
        process.env.STAGE_PLAY_MAIL_WAKE_ASK_BATCH_LIMIT = previousLimit;
      }
    }
  });

  it("records a pressure-blocked budget receipt when wake admission defers", async () => {
    seedVisualSummary({
      ts: "2026-06-04T12:10:00.000Z",
      summary: "A compact summary waits behind runtime pressure.",
    });
    const mail = listStagePlayLiveSourceMailItems({ threadId, roomId, sourceId, limit: 1 }).at(-1);
    expect(mail).toBeTruthy();
    queueStagePlayLiveSourceMailWakeRequest({
      threadId,
      roomId,
      mailIds: [mail!.mailId],
      sourceIds: [sourceId],
      evidenceRefs: [mail!.mailId],
      causalTraces: [mail!.causalTrace],
      now: "2026-06-04T12:10:01.000Z",
    });

    const result = await runNextMailWakeRequest({
      threadId,
      roomId,
      askTurnRunner: makeDecisionAskRunner(),
      pressureCheck: () => ({
        deferred: true,
        reason: "runtime_memory_host_memory_limit",
      }),
      now: "2026-06-04T12:10:02.000Z",
    });

    expect(result).toMatchObject({
      status: "deferred_for_pressure",
      budgetStateRef: expect.stringMatching(/^live_source_budget_state:/),
    });
    const budget = getLiveSourceBudgetState(result!.budgetStateRef!);
    expect(budget).toMatchObject({
      action: "pressure_blocked",
      reason: "runtime_memory_host_memory_limit",
      pressure: {
        deferredForPressure: true,
        pressureReason: "runtime_memory_host_memory_limit",
        memoryPressure: "high",
      },
      allowedNextAction: "retry_later",
    });
    expect(listLiveSourceBudgetStates({ threadId, roomId })).toHaveLength(1);
    const entries = listStagePlayLiveSourceMailTranscriptEntries({ threadId, roomId, limit: 50 });
    expect(entries.some((entry) =>
      entry.row.rowKind === "budget_state" &&
      /pressure_blocked: runtime_memory_host_memory_limit/i.test(entry.row.body)
    )).toBe(true);
  });
});
