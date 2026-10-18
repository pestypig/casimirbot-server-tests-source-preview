import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __testHelixAskPendingInputStore, __testHelixGoalSatisfaction, planRouter } from "../routes/agi.plan";
import { executeLiveEnvironmentTool } from "../services/helix-ask/live-environment-tool-adapter";
import {
  analyzeVisualFrame,
  recordVisualFrame,
  resetVisualSnapshotStoreForTest,
  startVisualSnapshotSource,
} from "../services/situation-room/visual-snapshot-store";
import {
  configureStagePlayLiveSourceWatchJobPolicy,
  enqueueStagePlayLiveSourceMailItem,
  listStagePlayLiveSourceMailItems,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import {
  listStagePlayLiveSourceMailWakeRequests,
  resetStagePlayLiveSourceMailWakeStoreForTest,
} from "../services/stage-play/stage-play-live-source-mail-wake-store";
import {
  listStagePlayLiveSourceMailTranscriptEntries,
  resetStagePlayLiveSourceMailTranscriptStoreForTest,
} from "../services/stage-play/stage-play-live-source-mail-transcript-store";
import { resetStagePlayLiveSourceInterpreterProfileStoreForTest } from "../services/stage-play/stage-play-live-source-interpreter-profile-store";
import { resetStagePlayLiveSourceMailboxThreadResolverForTest } from "../services/stage-play/stage-play-live-source-mailbox-thread-resolver";
import { resetStagePlayProcessedMailPacketStoreForTest } from "../services/stage-play/stage-play-processed-mail-packet-store";
import { recordLiveSourceMailDecisionForAsk } from "../services/stage-play/stage-play-visual-summary-mail-ingest";

const threadId = "helix-ask:desktop";
const roomId = "room:mail-interpretation-routing";
const sourceId = "visual_source:mail-interpretation-routing";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const resetLiveSourceMailRoutingState = (): void => {
  resetVisualSnapshotStoreForTest();
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayLiveSourceMailboxThreadResolverForTest();
  resetStagePlayLiveSourceMailWakeStoreForTest();
  resetStagePlayLiveSourceMailTranscriptStoreForTest();
  resetStagePlayLiveSourceInterpreterProfileStoreForTest();
  resetStagePlayProcessedMailPacketStoreForTest();
  __testHelixAskPendingInputStore.delete(threadId);
};

const setAgentStepResponses = (responses: Array<Record<string, unknown>>): void => {
  process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
  process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify(responses);
};

beforeEach(() => {
  resetLiveSourceMailRoutingState();
  setAgentStepResponses([
    {
      next_step: "next_action",
      chosen_capability: "live_env.read_processed_live_source_mail",
      reason: "Read the processed mailbox packet.",
      args: {},
      expected_artifacts: ["stage_play_processed_mail_packet"],
      confidence: 0.9,
    },
    {
      next_step: "next_action",
      chosen_capability: "live_env.record_live_source_mail_decision",
      reason: "Let decision repair enforce the correct mailbox decision.",
      args: {
        decision: "wait_for_next_summary",
        rationale_preview: "No user-facing update selected.",
        next_loop_state: "armed_for_next_summary",
      },
      expected_artifacts: ["stage_play_live_source_mail_decision"],
      confidence: 0.8,
    },
  ]);
  process.env.HELIX_POST_OBSERVATION_COMPOSER_TEST_RESPONSE =
    "Live-source mail decision recorded: wait_for_next_summary.";
});

afterEach(() => {
  delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
  delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
  delete process.env.HELIX_POST_OBSERVATION_COMPOSER_TEST_RESPONSE;
  __testHelixAskPendingInputStore.delete(threadId);
});

const seedVisualMail = (summary: string): void => {
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
    frame_id: `visual_frame:${Math.random().toString(16).slice(2)}`,
    ts: "2026-06-04T12:00:00.000Z",
  });
  analyzeVisualFrame({
    thread_id: threadId,
    frame_id: frame.frame_id,
    evidence_id: `visual_evidence:${Math.random().toString(16).slice(2)}`,
    summary,
    supports_claims: [
      {
        claim: "The latest mailbox item includes compact visual summary text.",
        support_status: "supports",
        confidence: 0.9,
      },
    ],
  });
};

const askMailbox = async (question: string, extraBody: Record<string, unknown> = {}) => {
  const response = await request(createApp())
    .post("/api/agi/ask/turn")
    .send({
      question,
      sessionId: threadId,
      debug: true,
      ...extraBody,
    })
    .expect(200);
  const decisionArtifact = response.body?.current_turn_artifact_ledger?.filter((artifact: any) =>
    artifact?.kind === "live_environment_tool_observation" &&
    artifact?.payload?.tool_name === "live_env.record_live_source_mail_decision"
  ).at(-1);
  const readArtifact = response.body?.current_turn_artifact_ledger?.filter((artifact: any) =>
    artifact?.kind === "live_environment_tool_observation" &&
    (
      artifact?.payload?.tool_name === "live_env.read_processed_live_source_mail" ||
      artifact?.payload?.tool_name === "live_env.read_live_source_mail"
    )
  ).at(-1);
  const liveEnvironmentToolNames = (response.body?.current_turn_artifact_ledger ?? [])
    .filter((artifact: any) => artifact?.kind === "live_environment_tool_observation")
    .map((artifact: any) => artifact?.payload?.tool_name)
    .filter(Boolean);
  return {
    response,
    decision: decisionArtifact?.payload?.observation,
    readObservation: readArtifact?.payload?.observation,
    liveEnvironmentToolNames,
    debug: JSON.stringify(response.body, null, 2),
  };
};

const expectNoRawMailboxReceiptFinal = (answer: unknown, debug: string): void => {
  expect(String(answer ?? ""), debug).not.toMatch(/unread live-source mail item\(s\) were read/i);
  expect(String(answer ?? ""), debug).not.toMatch(/require a recorded agent decision/i);
  expect(String(answer ?? ""), debug).not.toMatch(/Latest preview:/i);
};

describe.sequential("Helix Ask live-source mail interpretation routing", () => {
  it("normalizes processed-mail read observations with predictable artifact refs even when empty", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_processed_live_source_mail",
      thread_id: threadId,
      environment_id: "env:mail-refs",
      args: {
        mailbox_thread_id: threadId,
        auto_process_missing: false,
        read_only: true,
        route_metadata: {
          wakeRequestId: "stage_play_live_source_mail_wake:read-normalized",
          askTurnId: "ask:read-normalized",
        },
      },
    });

    expect(observation).toMatchObject({
      tool_name: "live_env.read_processed_live_source_mail",
      producedRefs: [],
      artifactRefs: {
        processedPacketIds: [],
        decisionIds: [],
        voiceReceiptIds: [],
        wakeRequestId: "stage_play_live_source_mail_wake:read-normalized",
        askTurnId: "ask:read-normalized",
      },
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
    });
  });

  it("normalizes mail decision observations with decision refs, wake id, and Ask turn id", () => {
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:decision-normalized",
      evidenceRef: "visual_evidence:decision-normalized",
      summaryText: "The live source shows routine movement.",
      createdAt: "2026-06-04T12:06:00.000Z",
    });

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.record_live_source_mail_decision",
      thread_id: threadId,
      environment_id: "env:mail-refs",
      args: {
        mail_ids: [mail.mailId],
        decision: "record_interpretation",
        rationale_preview: "Record the processed finding.",
        route_metadata: {
          wakeRequestId: "stage_play_live_source_mail_wake:decision-normalized",
          askTurnId: "ask:decision-normalized",
        },
      },
    });

    const decisionIds = observation.artifactRefs?.decisionIds ?? [];
    expect(decisionIds).toHaveLength(1);
    expect(observation).toMatchObject({
      tool_name: "live_env.record_live_source_mail_decision",
      producedRefs: decisionIds,
      artifactRefs: {
        processedPacketIds: [],
        decisionIds,
        voiceReceiptIds: [],
        wakeRequestId: "stage_play_live_source_mail_wake:decision-normalized",
        askTurnId: "ask:decision-normalized",
      },
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
    });
  });

  it("resolves interpreter profile setup as a locked configure phase", () => {
    const phase = __testHelixGoalSatisfaction.liveSourceTurnPhaseResolution({
      transcript:
        "Create a Minecraft Survival Coach interpreter profile for this source. Call out danger and ignore routine walking.",
      canonicalGoalKind: "live_environment_review",
      classifierReasons: ["prefer_configure_interpreter_profile"],
      currentTurnArtifacts: [],
    });

    expect(phase?.phase).toBe("configure_interpreter_profile");
    expect(phase?.phaseLock.locked).toBe(true);
    expect(phase?.allowedTools).toContain("live_env.configure_interpreter_profile");
    expect(phase?.forbiddenTools).toContain("live_env.read_processed_live_source_mail");
  });

  it("resolves processed voice candidates as decision-before-voice phase", () => {
    const phase = __testHelixGoalSatisfaction.liveSourceTurnPhaseResolution({
      transcript:
        "Read the processed visual mail and call out if danger appears in the Minecraft video predictor.",
      canonicalGoalKind: "live_source_processed_mail_interpretation",
      classifierReasons: ["live_source_mail_loop_intent"],
      currentTurnArtifacts: [
        {
          artifact_id: "artifact:packet",
          turn_id: "turn:phase",
          producer_item_id: "test",
          kind: "live_environment_tool_observation",
          created_at_ms: Date.now(),
          source_scope: "current_turn",
          goal_hash: "hash",
          payload: {
            tool_name: "live_env.read_processed_live_source_mail",
            ok: true,
            packets: [
              {
                artifactId: "stage_play_processed_mail_packet",
                schemaVersion: "stage_play_processed_mail_packet/v1",
                packetId: "stage_play_processed_mail_packet:phase",
                mailIds: ["stage_play_live_source_mail:1"],
                observedFacts: ["player appears to be on fire"],
                changedFacts: ["fire/damage cue appeared"],
                recommendedNext: "request_voice_callout",
                salience: {
                  level: "urgent",
                  reasons: ["fire/damage cue"],
                  voiceCandidate: true,
                  calloutDraft: "The player appears to be on fire.",
                },
              },
            ],
          },
        },
      ] as any,
    });

    expect(phase?.phase).toBe("record_decision");
    expect(phase?.canonicalGoal).toBe("processed_mail_voice_decision");
    expect(phase?.allowedTools).toEqual(["live_env.record_live_source_mail_decision"]);
    expect(phase?.forbiddenTools).toContain("live_env.request_interim_voice_callout");
  });

  it("classifies new processed mail refs as tool progress", () => {
    const receipt = __testHelixGoalSatisfaction.buildMailLoopToolProgressReceipt({
      turnId: "ask:mail-loop-progress",
      iteration: 1,
      toolName: "live_env.read_processed_live_source_mail",
      previousRefs: new Set(),
      observation: {
        schema: "stage_play_processed_live_source_mail_read_result/v1",
        packets: [
          {
            artifactId: "stage_play_processed_mail_packet",
            schemaVersion: "stage_play_processed_mail_packet/v1",
            packetId: "stage_play_processed_mail_packet:progress-new",
            observedFacts: ["Minecraft gameplay is visible."],
            recommendedNext: "draft_text_answer",
          },
        ],
      },
    });

    expect(receipt).toMatchObject({
      toolName: "live_env.read_processed_live_source_mail",
      producedRefs: ["stage_play_processed_mail_packet:progress-new"],
      newRefs: ["stage_play_processed_mail_packet:progress-new"],
      progressKind: "processed_packet",
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("classifies repeated live-source refs as no_progress", () => {
    const previousRefs = new Set(["stage_play_processed_mail_packet:progress-repeat"]);
    const receipt = __testHelixGoalSatisfaction.buildMailLoopToolProgressReceipt({
      turnId: "ask:mail-loop-progress-repeat",
      iteration: 2,
      toolName: "live_env.read_processed_live_source_mail",
      previousRefs,
      observation: {
        schema: "stage_play_processed_live_source_mail_read_result/v1",
        packets: [
          {
            artifactId: "stage_play_processed_mail_packet",
            schemaVersion: "stage_play_processed_mail_packet/v1",
            packetId: "stage_play_processed_mail_packet:progress-repeat",
            observedFacts: ["Minecraft gameplay is still visible."],
            recommendedNext: "draft_text_answer",
          },
        ],
      },
    });

    expect(receipt).toMatchObject({
      toolName: "live_env.read_processed_live_source_mail",
      producedRefs: ["stage_play_processed_mail_packet:progress-repeat"],
      newRefs: [],
      progressKind: "no_progress",
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("builds record_interpretation final answer from processed-mail packet fields", () => {
    const text = __testHelixGoalSatisfaction.buildHelixRuntimeProcessedMailTerminalText({
      packet: {
        artifactId: "stage_play_processed_mail_packet",
        schemaVersion: "stage_play_processed_mail_packet/v1",
        packetId: "stage_play_processed_mail_packet:terminal-interpretation",
        observedFacts: [
          "Minecraft player is in a cave-like area.",
          "A pickaxe is visible.",
        ],
        inferredFacts: ["The player may be mining or exploring underground."],
        changedFacts: ["The scene moved from base inventory to cave exploration."],
        predictionValidation: {
          result: "partially_supported",
          supportedSignals: ["cave setting remained visible"],
          contradictedSignals: ["inventory view disappeared"],
          newSignals: ["pickaxe visible"],
        },
        salience: {
          level: "medium",
          reasons: ["underground exploration may become risky"],
          voiceCandidate: false,
        },
        recommendedNext: "record_interpretation",
        watchNext: ["mob movement", "lava", "ore discovery"],
      },
      decision: {
        decision: "record_interpretation",
        rationalePreview: "The processed packet should be interpreted as the current checkpoint.",
      },
      narrativeState: {
        interpretedSituation: {
          userRelevantMeaning: "The clip is shifting from routine setup toward underground exploration.",
        },
      },
    });

    expect(text).toContain("Observed:");
    expect(text).toContain("Minecraft player is in a cave-like area.");
    expect(text).toContain("Cautious interpretation:");
    expect(text).toContain("shifting from routine setup");
    expect(text).toContain("Prediction:");
    expect(text).toContain("partially supported");
    expect(text).toContain("Watch next:");
    expect(text).toContain("mob movement");
    expect(text).toContain("Loop:");
    expect(text).toContain("Armed for next update.");
    expect(text).not.toMatch(/processed live-source packet\(s\) were read and require a recorded agent decision/i);
  });

  it("builds request_voice_callout final answer from processed-mail salience", () => {
    const text = __testHelixGoalSatisfaction.buildHelixRuntimeProcessedMailTerminalText({
      packet: {
        artifactId: "stage_play_processed_mail_packet",
        schemaVersion: "stage_play_processed_mail_packet/v1",
        packetId: "stage_play_processed_mail_packet:terminal-voice",
        observedFacts: ["The player appears to be on fire."],
        changedFacts: ["Damage/fire cue appeared."],
        salience: {
          level: "urgent",
          reasons: ["fire or damage cue"],
          voiceCandidate: true,
          calloutDraft: "The player appears to be on fire; watch for recovery or danger.",
        },
        recommendedNext: "request_voice_callout",
        watchNext: ["health", "fire recovery"],
      },
      decision: {
        decisionId: "stage_play_live_source_mail_decision:voice-terminal",
        decision: "request_voice_callout",
        voiceCalloutDraft: {
          text: "The player appears to be on fire; watch for recovery or danger.",
          voiceEligible: true,
          requiresConfirmation: false,
        },
      },
      artifacts: [{
        artifact_id: "ask:voice-terminal:voice",
        turn_id: "ask:voice-terminal",
        producer_item_id: "agent_runtime_tool_executor",
        kind: "live_environment_tool_observation",
        created_at_ms: Date.now(),
        source_scope: "current_turn",
        goal_hash: "hash",
        payload: {
          tool_name: "live_env.request_interim_voice_callout",
          observation: {
            schema: "helix.interim_voice_callout_tool_result.v1",
            receipt: {
              status: "queued",
              receiptId: "voice_receipt:queued",
              evidenceRefs: ["stage_play_live_source_mail_decision:voice-terminal"],
            },
          },
        },
      } as any],
    });

    expect(text).toContain("Processed mail identified a high-salience voice candidate:");
    expect(text).toContain("The player appears to be on fire");
    expect(text).toContain("Decision: stage_play_live_source_mail_decision:voice-terminal");
    expect(text).toContain("Voice status:");
    expect(text).toContain("voice requested");
    expect(text).toContain("Loop:");
    expect(text).toContain("Armed for next update.");
  });

  it("builds held voice terminal text when confirmation blocks the voice tool", () => {
    const text = __testHelixGoalSatisfaction.buildHelixRuntimeProcessedMailTerminalText({
      packet: {
        artifactId: "stage_play_processed_mail_packet",
        schemaVersion: "stage_play_processed_mail_packet/v1",
        packetId: "stage_play_processed_mail_packet:terminal-voice-held",
        observedFacts: ["A hostile mob appears near the player."],
        salience: {
          level: "urgent",
          reasons: ["hostile mob nearby"],
          voiceCandidate: true,
          calloutDraft: "Hostile mob nearby.",
        },
        recommendedNext: "request_voice_callout",
        watchNext: ["health", "mob distance"],
      },
      decision: {
        decisionId: "stage_play_live_source_mail_decision:voice-held",
        decision: "request_voice_callout",
        voicePolicyReason: "confirmation_required",
        voiceCalloutDraft: {
          text: "Hostile mob nearby.",
          voiceEligible: true,
          requiresConfirmation: true,
        },
      },
    });

    expect(text).toContain("Decision: stage_play_live_source_mail_decision:voice-held");
    expect(text).toContain("voice held: confirmation required");
    expect(text).toContain("Policy: confirmation_required.");
    expect(text).toContain("Armed for next update.");
  });

  it("builds wait_for_next_summary final answer from low-salience processed mail", () => {
    const text = __testHelixGoalSatisfaction.buildHelixRuntimeProcessedMailTerminalText({
      packet: {
        artifactId: "stage_play_processed_mail_packet",
        schemaVersion: "stage_play_processed_mail_packet/v1",
        packetId: "stage_play_processed_mail_packet:terminal-wait",
        observedFacts: ["The scene remains in a stable inventory view."],
        changedFacts: [],
        predictionValidation: {
          result: "supported",
          supportedSignals: ["inventory/base view remained stable"],
          contradictedSignals: [],
          newSignals: [],
        },
        salience: {
          level: "low",
          reasons: ["stable scene"],
          voiceCandidate: false,
        },
        recommendedNext: "wait_for_next_summary",
        watchNext: ["scene transition"],
      },
    });

    expect(text).toContain("Processed mail did not require a user-facing update.");
    expect(text).toContain("Packet: stage_play_processed_mail_packet:terminal-wait");
    expect(text).toContain("Reason: stable scene.");
    expect(text).toContain("Loop remains armed.");
    expect(text).toContain("Armed for next update.");
    expect(text).not.toMatch(/visual evidence (?:is|was) unavailable/i);
  });

  it("builds configure_interpreter_profile terminal text from profile setup evidence only", () => {
    const text = __testHelixGoalSatisfaction.buildHelixRuntimeLiveSourceMailFallbackText({
      prompt: "Create a Minecraft Survival Coach interpreter profile for this source.",
      artifacts: [{
        artifact_id: "ask:profile-terminal:profile",
        turn_id: "ask:profile-terminal",
        producer_item_id: "agent_runtime_tool_executor",
        kind: "live_environment_tool_observation",
        created_at_ms: Date.now(),
        source_scope: "current_turn",
        goal_hash: "hash",
        payload: {
          tool_name: "live_env.configure_interpreter_profile",
          observation: {
            schema: "stage_play_interpreter_profile_config_result/v1",
            profile: {
              profileId: "stage_play_live_source_interpreter_profile:terminal",
              title: "Minecraft Survival Coach",
              status: "active",
              objectiveText: "Watch Minecraft as a survival coach.",
              salienceCriteria: ["danger", "rare resources"],
              suppressCriteria: ["routine walking"],
              voiceCalloutCriteria: ["hostile mob"],
            },
            interpreterProfileRef: "stage_play_live_source_interpreter_profile:terminal",
          },
        },
      } as any],
    });

    expect(text).toContain("Profile configured: Minecraft Survival Coach.");
    expect(text).toContain("Profile: stage_play_live_source_interpreter_profile:terminal");
    expect(text).toContain("Status: active.");
    expect(text).toContain("Criteria:");
    expect(text).toContain("Salience: danger; rare resources");
    expect(text).toContain("Suppress: routine walking");
    expect(text).toContain("No live-source mail was interpreted in this setup turn.");
    expect(text).not.toContain("Observed:");
  });

  it("builds configure_watch_job terminal text from policy setup evidence only", () => {
    const text = __testHelixGoalSatisfaction.buildHelixRuntimeLiveSourceMailFallbackText({
      prompt: "Watch the active visual source and describe each new mail batch.",
      artifacts: [{
        artifact_id: "ask:watch-terminal:policy",
        turn_id: "ask:watch-terminal",
        producer_item_id: "agent_runtime_tool_executor",
        kind: "live_environment_tool_observation",
        created_at_ms: Date.now(),
        source_scope: "current_turn",
        goal_hash: "hash",
        payload: {
          tool_name: "live_env.configure_live_source_watch_job",
          observation: {
            schema: "stage_play_live_source_watch_job_policy_config_result/v1",
            watchJobPolicyRef: "stage_play_live_source_watch_job_policy:terminal",
            policy: {
              policyId: "stage_play_live_source_watch_job_policy:terminal",
              objectiveText: "Watch the active visual source and describe each new mail batch.",
              status: "armed",
            },
            jobState: {
              nextLoopState: "armed_for_next_summary",
            },
          },
        },
      } as any],
    });

    expect(text).toContain("Watch job configured and armed.");
    expect(text).toContain("Policy: stage_play_live_source_watch_job_policy:terminal");
    expect(text).toContain("Objective: Watch the active visual source");
    expect(text).toContain("Loop state: armed for next summary.");
    expect(text).toContain("No live-source mail was interpreted in this setup turn.");
    expect(text).not.toContain("Observed:");
  });

  it("queues a backend continuation wake after a processed-mail checkpoint without reusing the current batch", () => {
    const firstMail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:checkpoint-current",
      evidenceRef: "visual_evidence:checkpoint-current",
      summaryText: "Minecraft gameplay shows the current processed checkpoint batch.",
      createdAt: "2026-06-04T12:00:00.000Z",
    });
    const secondMail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:checkpoint-retained",
      evidenceRef: "visual_evidence:checkpoint-retained",
      summaryText: "Minecraft gameplay has a newer unread update retained after the checkpoint.",
      createdAt: "2026-06-04T12:00:10.000Z",
    });
    configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceIds: [sourceId],
      objectiveText: "Watch the active visual source and interpret retained mail.",
      decisionPolicyPrompt: "Read retained mail as the next checkpoint.",
      interpretationMode: "batch_interpretation",
      mailProcessingMode: "micro_batch",
      outputCadence: "every_batch",
    });
    resetStagePlayLiveSourceMailWakeStoreForTest();
    const prompt = "Read the visual mail and interpret what is happening. Say what should be watched next.";
    const canonicalGoalFrame = __testHelixGoalSatisfaction.buildAskTurnCanonicalGoalFrame({
      turnId: "ask:checkpoint-continuation",
      goalFrame: {
        schema: "helix.ask.universal_goal_frame.v1",
        turn_id: "ask:checkpoint-continuation",
        user_goal: {
          raw: prompt,
          normalized: prompt,
          goal_kind: "unknown",
          goal_hash: "test-goal-hash",
        },
        requested_outputs: [],
        evidence_requirements: [],
        constraints: [],
        risks: [],
        confidence: "medium",
        assistant_answer: false,
        raw_content_included: false,
      } as any,
    });
    const payload: Record<string, unknown> = {
      thread_id: threadId,
      debug: {},
    };
    const artifacts: any[] = [{
      artifact_id: "ask:checkpoint-continuation:read_processed_mail",
      kind: "live_environment_tool_observation",
      turn_id: "ask:checkpoint-continuation",
      producer_item_id: "live_env.read_processed_live_source_mail",
      created_at_ms: Date.now(),
      source_scope: "current_turn",
      goal_hash: "checkpoint-continuation-test",
      payload: {
        schema: "helix.live_environment_tool_observation.v1",
        ok: true,
        tool_name: "live_env.read_processed_live_source_mail",
        observation: {
          schema: "stage_play_processed_live_source_mail_read_result/v1",
          mailboxThreadId: threadId,
          packets: [{
            artifactId: "stage_play_processed_mail_packet",
            schemaVersion: "stage_play_processed_mail_packet/v1",
            packetId: "stage_play_processed_mail_packet:checkpoint-current",
            jobId: "stage_play_live_source_job:checkpoint-continuation",
            sourceId,
            mailIds: [firstMail.mailId],
            visualEvidenceRefs: ["visual_evidence:checkpoint-current"],
            observedFacts: ["Minecraft gameplay is visible in the current checkpoint."],
            inferredFacts: [],
            uncertainties: [],
            stableFactsUsed: [],
            changedFacts: ["current checkpoint batch interpreted"],
            sceneTags: ["minecraft"],
            activityTags: ["gameplay"],
            objectTags: [],
            matchedCriteria: [],
            suppressedCriteria: [],
            riskMatches: [],
            opportunityMatches: [],
            voiceCalloutMatches: [],
            salience: {
              level: "medium",
              reasons: ["checkpoint batch"],
              voiceCandidate: false,
            },
            recommendedNext: "draft_text_answer",
            watchNext: ["next retained visual update"],
            resolutionState: "processed_packet_ready",
            microReasonerRunRefs: [],
            evidenceRefs: [firstMail.mailId, "visual_evidence:checkpoint-current"],
            createdAt: "2026-06-04T12:00:11.000Z",
            assistant_answer: false,
            terminal_eligible: false,
            context_role: "tool_evidence",
          }],
        },
      },
    }];

    const result = __testHelixGoalSatisfaction.applyMailLoopCheckpointContinuationToPayload({
      payload,
      turnId: "ask:checkpoint-continuation",
      transcript: prompt,
      canonicalGoalFrame,
      artifacts,
    });

    const continuation = payload.stage_play_mail_loop_checkpoint_continuation as any;
    expect(result.artifact?.kind).toBe("stage_play_mail_loop_checkpoint_continuation");
    expect(continuation).toMatchObject({
      checkpoint_state: "checkpoint_completed",
      continuation: "scheduled",
      unread_retained: 1,
      loop_state: "armed_for_next_summary",
    });
    expect(continuation.current_batch_mail_ids).toContain(firstMail.mailId);
    expect(continuation.retained_mail_ids).toEqual([secondMail.mailId]);
    expect(continuation.queued_wake_id).toMatch(/^stage_play_live_source_mail_wake:/);
    const queuedWakes = listStagePlayLiveSourceMailWakeRequests({ threadId, limit: 10 });
    expect(queuedWakes).toHaveLength(1);
    expect(queuedWakes[0].mailIds).toEqual([secondMail.mailId]);
    expect(queuedWakes[0].mailIds).not.toContain(firstMail.mailId);
    const transcriptEntries = listStagePlayLiveSourceMailTranscriptEntries({ threadId, limit: 10 });
    const rowKinds = transcriptEntries.map((entry) => entry.row.rowKind);
    expect(rowKinds).toEqual(expect.arrayContaining([
      "checkpoint_summary",
      "processed_mail_goal_satisfied",
      "continuation_scheduled",
      "loop_state",
    ]));
    const continuationRow = transcriptEntries.find((entry) => entry.row.rowKind === "continuation_scheduled")?.row;
    expect(continuationRow?.body).toContain("Checkpoint complete.");
    expect(continuationRow?.body).toContain("Continuation: scheduled.");
    expect(continuationRow?.body).toContain("Unread retained: 1.");
  });

  it("classifies processed visual-mail interpretation as the canonical processed-mail checkpoint goal", () => {
    const prompt =
      "Read the visual mail from the active Minecraft video predictor and interpret what is happening. Predict what should be watched next.";
    const canonicalGoalFrame = __testHelixGoalSatisfaction.buildAskTurnCanonicalGoalFrame({
      turnId: "ask:processed-mail-canonical-goal",
      goalFrame: {
        schema: "helix.ask.universal_goal_frame.v1",
        turn_id: "ask:processed-mail-canonical-goal",
        user_goal: {
          raw: prompt,
          normalized: prompt,
          goal_kind: "unknown",
          goal_hash: "test-goal-hash",
        },
        requested_outputs: [],
        evidence_requirements: [],
        constraints: [],
        risks: [],
        confidence: "medium",
        assistant_answer: false,
        raw_content_included: false,
      } as any,
    });
    expect(canonicalGoalFrame).toMatchObject({
      goal_kind: "live_source_processed_mail_interpretation",
      answer_scope: "live_environment_state",
      required_terminal_kind: "model_synthesized_answer",
      classifier_reasons: expect.arrayContaining([
        "processed_mail_interpretation_goal",
        "forbid_visual_capture_describe_goal",
      ]),
    });

    const evaluation = __testHelixGoalSatisfaction.buildHelixGoalSatisfactionEvaluation({
      turnId: "ask:processed-mail-canonical-goal",
      transcript: prompt,
      canonicalGoalFrame,
      currentTurnArtifacts: [
        {
          artifact_id: "ask:processed-mail-canonical-goal:read_processed_mail",
          kind: "live_environment_tool_observation",
          turn_id: "ask:processed-mail-canonical-goal",
          producer_item_id: "live_env.read_processed_live_source_mail",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            ok: true,
            tool_name: "live_env.read_processed_live_source_mail",
            observation: {
              schema: "stage_play_processed_live_source_mail_read_result/v1",
              packets: [
                {
                  artifactId: "stage_play_processed_mail_packet",
                  schemaVersion: "stage_play_processed_mail_packet/v1",
                  packetId: "stage_play_processed_mail_packet:test",
                  observedFacts: ["Minecraft gameplay is visible."],
                  changedFacts: ["The scene moved outdoors."],
                  salience: {
                    level: "medium",
                    reasons: ["scene transition"],
                    voiceCandidate: false,
                  },
                  recommendedNext: "draft_text_answer",
                },
              ],
            },
          },
        } as any,
      ],
      satisfactionReport: {
        satisfied: true,
        terminal_kind: "final_answer",
        terminal_artifact_id: "ask:processed-mail-canonical-goal:model_synthesized_answer",
        terminal_artifact_kind: "model_synthesized_answer",
        terminal_source: "artifact_synthesis",
        missing_artifacts: [],
        confidence: "high",
      },
      selectedAction: null,
    });

    expect(evaluation).toMatchObject({
      canonical_goal_kind: "live_source_processed_mail_interpretation",
      required_terminal_kind: "model_synthesized_answer",
      satisfaction: "satisfied",
      terminal_contract: expect.objectContaining({
        required_terminal_kinds: ["model_synthesized_answer"],
        required_actions: ["live_env.read_processed_live_source_mail"],
        required_evidence: [
          "processed_mail_packet",
          "live_source_decision_or_checkpoint_summary",
          "loop_state",
        ],
        forbidden_terminal_kinds: expect.arrayContaining([
          "visual_context_pack",
          "situation_context_pack",
          "focused_doc_answer",
          "doc_summary",
        ]),
      }),
      required_actions: [
        expect.objectContaining({
          action_key: "live_env.read_processed_live_source_mail",
          satisfied: true,
        }),
      ],
      required_evidence: [
        expect.objectContaining({
          kind: "processed_mail_packet",
          satisfied: true,
        }),
        expect.objectContaining({
          kind: "live_source_decision_or_checkpoint_summary",
          satisfied: true,
        }),
        expect.objectContaining({
          kind: "loop_state",
          satisfied: true,
        }),
      ],
    });
  });

  it("treats compact UI wake handoffs as hard processed-mail mailbox turns", async () => {
    configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceId,
      objective: "Watch the active visual source and wake Ask only for salient findings.",
    });
    seedVisualMail("The Minecraft scene shows an urgent combat cue while the player holds a sword.");

    const compactWakePrompt = [
      "Continuing live-source watch job compact Ask handoff:",
      "Wake request: stage_play_live_source_mail_wake:ui-compact.",
      "phase requirement: record live_env.record_live_source_mail_decision first; then request live_env.request_interim_voice_callout; do not terminal-answer until voice receipt/hold/block exists.",
      "Processed packet: stage_play_processed_mail_packet:ui-compact.",
      "Micro-reasoner recommended next: request_voice_callout.",
      "Current effort: combat_or_recovery.",
      "Hypothesis arbiter: request_voice_callout; wake yes.",
    ].join("\n");

    const { response, liveEnvironmentToolNames, debug } = await askMailbox(compactWakePrompt);

    expect(response.body?.canonical_goal_frame, debug).toMatchObject({
      goal_kind: "live_source_processed_mail_interpretation",
      classifier_reasons: expect.arrayContaining([
        "live_source_mailbox_intent",
        "processed_mail_interpretation_goal",
        "forbid_visual_capture_describe_goal",
      ]),
    });
    expect(response.body?.source_target_intent?.target_source, debug).toBe("live_source_mailbox");
    expect(response.body?.source_target_intent?.suppressed_routes, debug).toEqual(
      expect.arrayContaining([
        "visual_capture_describe",
        "no_tool_direct",
      ]),
    );
    expect(response.body?.planner_contract?.selected_action, debug).toBeNull();
    expect(response.body?.tool_use_restatement?.requiredToolFamilies, debug).not.toContain("internet_search");
    expect(liveEnvironmentToolNames, debug).toContain("live_env.read_processed_live_source_mail");
    expect(liveEnvironmentToolNames, debug).toContain("live_env.record_live_source_mail_decision");
    expect(liveEnvironmentToolNames, debug).not.toContain("situation-room.describe_visual_capture");
    expect(response.body?.canonical_goal_frame?.goal_kind, debug).not.toBe("visual_capture_describe");
  }, 60_000);

  it("treats current compact mailbox wake wording as route-locked mailbox work", async () => {
    configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceId,
      objective: "Watch the active visual source and wake Ask only for salient findings.",
    });
    seedVisualMail("The Minecraft scene shows an urgent combat cue while the player holds a sword.");

    const compactWakePrompt = [
      "Review the latest Stage Play live-source mailbox finding.",
      "Current effort: combat or recovery.",
      "Micro-reasoner recommendation: request voice callout.",
      "Use the structured mailbox route metadata attached to this turn; keep the visible answer concise and evidence-bound.",
    ].join("\n");

    const { response, liveEnvironmentToolNames, debug } = await askMailbox(compactWakePrompt);

    expect(response.body?.source_target_intent?.target_source, debug).toBe("live_source_mailbox");
    expect(response.body?.canonical_goal_frame, debug).toMatchObject({
      goal_kind: "live_source_processed_mail_interpretation",
      classifier_reasons: expect.arrayContaining([
        "stage_play_mail_wake_route_metadata",
        "live_source_mailbox_intent",
        "processed_mail_interpretation_goal",
      ]),
    });
    expect(response.body?.planner_contract?.selection_fail_reason, debug).toBe("compact_mailbox_wake_forbids_workspace_action");
    expect(response.body?.tool_use_restatement?.requiredToolFamilies, debug).not.toContain("internet_search");
    expect(liveEnvironmentToolNames, debug).not.toContain("workspace_os.status");
    expect(liveEnvironmentToolNames, debug).not.toContain("internet-search.search_web");
  }, 60_000);

  it("materializes processed mailbox evidence before generic missing-args handling for stage_play_mail_wake metadata", async () => {
    configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      roomId,
      sourceId,
      objective: "Watch the active visual source and wake Ask only for salient findings.",
    });
    seedVisualMail("The Minecraft player is in a dark area with low visibility and visible hotbar tools.");
    const latestMail = listStagePlayLiveSourceMailItems({ threadId, roomId, sourceId, limit: 1 }).at(-1);
    expect(latestMail?.mailId).toMatch(/^stage_play_live_source_mail:/);

    const compactWakePrompt = [
      "Review the latest Stage Play live-source mailbox finding.",
      "Current effort: the latest live-source finding.",
      "Micro-reasoner recommendation: review required.",
      "Use the structured mailbox route metadata attached to this turn; keep the visible answer concise and evidence-bound.",
    ].join("\n");

    const { response, liveEnvironmentToolNames, debug } = await askMailbox(compactWakePrompt, {
      routeMetadata: {
        invocationKind: "stage_play_mail_wake",
        wakeRequestId: "stage_play_live_source_mail_wake:metadata-regression",
        mailboxThreadId: threadId,
        sourceTarget: "live_source_mailbox",
        requiredCanonicalGoal: "processed_mail_interpretation",
        requiredPhase: "read_mailbox",
        evidenceRefs: [latestMail!.mailId],
        allowedCapabilities: [],
        forbiddenCapabilities: [],
      },
    });

    expect(response.body?.source_target_intent?.target_source, debug).toBe("live_source_mailbox");
    expect(response.body?.canonical_goal_frame, debug).toMatchObject({
      goal_kind: "live_source_processed_mail_interpretation",
      classifier_reasons: expect.arrayContaining([
        "stage_play_mail_wake_route_metadata",
        "live_source_mailbox_intent",
        "processed_mail_interpretation_goal",
      ]),
    });
    expect(response.body?.planner_contract?.plan_items ?? [], debug).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "request_user_input",
        }),
      ]),
    );
    expect(response.body?.selected_final_answer, debug).not.toMatch(/The turn stopped before required artifacts were satisfied/i);
    expect(response.body?.terminal_error_code, debug).not.toBe("missing_required_live_source_mailbox_observation");
    expect(liveEnvironmentToolNames, debug).toContain("live_env.read_processed_live_source_mail");
    expect(liveEnvironmentToolNames, debug).toContain("live_env.record_live_source_mail_decision");
    expect(response.body?.goal_satisfaction_evaluation?.required_evidence ?? [], debug).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "doc_summary",
        }),
      ]),
    );
  }, 60_000);

  it("requires a decision receipt when processed mail recommends interpretation", () => {
    const prompt =
      "Read the visual mail and interpret what is happening. Predict what happens next and say what should be watched next.";
    const canonicalGoalFrame = __testHelixGoalSatisfaction.buildAskTurnCanonicalGoalFrame({
      turnId: "ask:processed-mail-decision-required",
      goalFrame: {
        schema: "helix.ask.universal_goal_frame.v1",
        turn_id: "ask:processed-mail-decision-required",
        user_goal: {
          raw: prompt,
          normalized: prompt,
          goal_kind: "unknown",
          goal_hash: "test-goal-hash",
        },
        requested_outputs: [],
        evidence_requirements: [],
        constraints: [],
        risks: [],
        confidence: "medium",
        assistant_answer: false,
        raw_content_included: false,
      } as any,
    });
    const readArtifact = {
      artifact_id: "ask:processed-mail-decision-required:read_processed_mail",
      kind: "live_environment_tool_observation",
      turn_id: "ask:processed-mail-decision-required",
      producer_item_id: "live_env.read_processed_live_source_mail",
      payload: {
        schema: "helix.live_environment_tool_observation.v1",
        ok: true,
        tool_name: "live_env.read_processed_live_source_mail",
        observation: {
          schema: "stage_play_processed_live_source_mail_read_result/v1",
          packets: [
            {
              artifactId: "stage_play_processed_mail_packet",
              schemaVersion: "stage_play_processed_mail_packet/v1",
              packetId: "stage_play_processed_mail_packet:interpretation-required",
              observedFacts: ["Minecraft gameplay is visible."],
              changedFacts: ["The player moved from an interior base to an outdoor area."],
              salience: {
                level: "medium",
                reasons: ["scene transition"],
                voiceCandidate: false,
              },
              recommendedNext: "record_interpretation",
            },
          ],
        },
      },
    } as any;
    const satisfiedTerminal = {
      satisfied: true,
      terminal_kind: "final_answer",
      terminal_artifact_id: "ask:processed-mail-decision-required:model_synthesized_answer",
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_source: "artifact_synthesis",
      missing_artifacts: [],
      confidence: "high",
    } as any;

    const withoutDecision = __testHelixGoalSatisfaction.buildHelixGoalSatisfactionEvaluation({
      turnId: "ask:processed-mail-decision-required",
      transcript: prompt,
      canonicalGoalFrame,
      currentTurnArtifacts: [readArtifact],
      satisfactionReport: satisfiedTerminal,
      selectedAction: null,
    });

    expect(withoutDecision).toMatchObject({
      canonical_goal_kind: "live_source_processed_mail_interpretation",
      satisfaction: "partially_satisfied",
      required_evidence: [
        expect.objectContaining({ kind: "processed_mail_packet", satisfied: true }),
        expect.objectContaining({ kind: "live_source_decision_or_checkpoint_summary", satisfied: false }),
        expect.objectContaining({ kind: "loop_state", satisfied: true }),
      ],
    });

    const withDecision = __testHelixGoalSatisfaction.buildHelixGoalSatisfactionEvaluation({
      turnId: "ask:processed-mail-decision-required",
      transcript: prompt,
      canonicalGoalFrame,
      currentTurnArtifacts: [
        readArtifact,
        {
          artifact_id: "ask:processed-mail-decision-required:decision",
          kind: "live_environment_tool_observation",
          turn_id: "ask:processed-mail-decision-required",
          producer_item_id: "live_env.record_live_source_mail_decision",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            ok: true,
            tool_name: "live_env.record_live_source_mail_decision",
            observation: {
              artifactId: "stage_play_live_source_mail_decision",
              schemaVersion: "stage_play_live_source_mail_decision/v1",
              decisionId: "stage_play_live_source_mail_decision:interpretation-required",
              decision: "record_interpretation",
              nextLoopState: "armed_for_next_summary",
            },
          },
        } as any,
      ],
      satisfactionReport: satisfiedTerminal,
      selectedAction: null,
    });

    expect(withDecision).toMatchObject({
      satisfaction: "satisfied",
      required_evidence: [
        expect.objectContaining({ kind: "processed_mail_packet", satisfied: true }),
        expect.objectContaining({ kind: "live_source_decision_or_checkpoint_summary", satisfied: true }),
        expect.objectContaining({ kind: "loop_state", satisfied: true }),
      ],
    });
  });

  it("routes interpreter profile setup prompts to configure_interpreter_profile before mailbox reads", async () => {
    seedVisualMail("A Minecraft menu is visible, but this turn is only configuring interpretation policy.");
    setAgentStepResponses([
      {
        next_step: "next_action",
        chosen_capability: "live_env.configure_interpreter_profile",
        reason: "Configure the requested interpreter profile.",
        args: {},
        expected_artifacts: ["stage_play_live_source_interpreter_profile"],
        confidence: 0.95,
      },
    ]);

    const { response, liveEnvironmentToolNames, debug } = await askMailbox(
      "Create a Minecraft Survival Coach interpreter profile for this source. Call out danger, rare resources, and strategic decisions; ignore routine walking.",
    );

    expect(liveEnvironmentToolNames, debug).toContain("live_env.configure_interpreter_profile");
    expect(liveEnvironmentToolNames, debug).not.toContain("live_env.read_live_source_mail");
    expect(response.body?.source_target_intent?.target_source, debug).toBe("live_source_mailbox");
    expect(response.body?.source_target_intent?.requested_outputs, debug).toContain(
      "stage_play_live_source_interpreter_profile",
    );
    const profileArtifact = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "live_environment_tool_observation" &&
      artifact?.payload?.tool_name === "live_env.configure_interpreter_profile"
    );
    expect(profileArtifact?.payload?.observation, debug).toMatchObject({
      profile: expect.objectContaining({
        title: "Minecraft Survival Coach",
        domain: "minecraft",
        assistant_answer: false,
        terminal_eligible: false,
      }),
    });
    expect(response.body?.stage_play_live_source_mailbox_debug, debug).toMatchObject({
      capability: "live_env.configure_interpreter_profile",
      interpreter_profile_ref: expect.stringMatching(/^stage_play_live_source_interpreter_profile:/),
    });
    expect(response.body?.terminal_error_code, debug).not.toBe("terminal_consistency_violation");
    expect(response.body?.answer, debug).toMatch(/Interpreter profile configured|Minecraft Survival Coach/i);
  }, 60_000);

  it("repairs forbidden mailbox reads during interpreter profile setup before tool budget is spent", async () => {
    seedVisualMail("A Minecraft frame exists, but the current turn is profile setup only.");
    setAgentStepResponses([
      {
        next_step: "next_action",
        chosen_capability: "live_env.read_processed_live_source_mail",
        reason: "Wrongly tried to read mail during profile setup.",
        args: {},
        expected_artifacts: ["stage_play_processed_mail_packet"],
        confidence: 0.8,
      },
    ]);

    const { response, liveEnvironmentToolNames, debug } = await askMailbox(
      "Create a Minecraft Survival Coach interpreter profile for this source. Call out danger, rare resources, and strategic decision points. Ignore routine walking.",
    );

    expect(liveEnvironmentToolNames, debug).toContain("live_env.configure_interpreter_profile");
    expect(liveEnvironmentToolNames, debug).not.toContain("live_env.read_processed_live_source_mail");
    if (response.body?.live_source_phase_repair) {
      expect(response.body.live_source_phase_repair, debug).toMatchObject({
        phase: "configure_interpreter_profile",
        repaired_to: "live_env.configure_interpreter_profile",
      });
    } else {
      expect(response.body?.live_source_turn_phase_resolution, debug).toMatchObject({
        canonicalGoal: "configure_interpreter_profile",
        phaseLock: expect.objectContaining({ locked: true }),
      });
      expect(["configure_interpreter_profile", "terminal_checkpoint"], debug).toContain(
        response.body?.live_source_turn_phase_resolution?.phase,
      );
    }
    expect(response.body?.terminal_error_code, debug).not.toBe("agent_loop_budget_exhausted");
    expect(response.body?.terminal_error_code, debug).not.toBe("live_source_phase_violation");
  }, 60_000);

  it("configures a Minecraft video predictor profile without terminal consistency failure", async () => {
    seedVisualMail("A Minecraft YouTube video frame is visible, but profile setup should not consume the mail.");
    setAgentStepResponses([
      {
        next_step: "next_action",
        chosen_capability: "live_env.configure_interpreter_profile",
        reason: "Configure the requested Minecraft video predictor profile.",
        args: {},
        expected_artifacts: ["stage_play_live_source_interpreter_profile"],
        confidence: 0.95,
      },
    ]);

    const { response, liveEnvironmentToolNames, debug } = await askMailbox(
      "Create a Minecraft Video Predictor interpreter profile for this source. Separate observed facts from cautious inferences, predict the next likely scene beat, and say what should be watched next.",
    );

    expect(liveEnvironmentToolNames, debug).toContain("live_env.configure_interpreter_profile");
    expect(liveEnvironmentToolNames, debug).not.toContain("live_env.read_live_source_mail");
    expect(response.body?.terminal_error_code, debug).not.toBe("terminal_consistency_violation");
    const profileArtifact = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "live_environment_tool_observation" &&
      artifact?.payload?.tool_name === "live_env.configure_interpreter_profile"
    );
    expect(profileArtifact?.payload?.observation, debug).toMatchObject({
      profile: expect.objectContaining({
        title: "Minecraft Video Predictor",
        domain: "minecraft",
        assistant_answer: false,
        terminal_eligible: false,
      }),
    });
    expect(response.body?.answer, debug).toMatch(/Interpreter profile configured|Minecraft Video Predictor/i);
  }, 60_000);

  it("routes standing Minecraft predictor watch prompts to configure a watch job before mailbox reads", async () => {
    seedVisualMail("A Minecraft YouTube video frame is visible, but this turn is arming a standing watch job.");

    const { response, liveEnvironmentToolNames, debug } = await askMailbox(
      "Watch the active visual source as a Minecraft video predictor. Interpret chronological micro-batches, make cautious predictions, and say what should be watched next. Do not narrate every frame; only use short text checkpoints unless danger or a major scene transition appears.",
    );

    expect(liveEnvironmentToolNames, debug).toContain("live_env.configure_live_source_watch_job");
    expect(liveEnvironmentToolNames, debug).not.toContain("live_env.read_live_source_mail");
    expect(response.body?.source_target_intent?.target_source, debug).toBe("live_source_mailbox");
    expect(response.body?.source_target_intent?.requested_outputs, debug).toContain(
      "stage_play_live_source_watch_job_policy",
    );
    const policyArtifact = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "live_environment_tool_observation" &&
      artifact?.payload?.tool_name === "live_env.configure_live_source_watch_job"
    );
    expect(policyArtifact?.payload?.observation, debug).toMatchObject({
      policy: expect.objectContaining({
        interpretationMode: "prediction_watch",
        mailProcessingMode: "chronological_batch",
        outputCadence: "only_salient",
        assistant_answer: false,
        terminal_eligible: false,
      }),
      watchJobPolicyRef: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
    });
    expect(response.body?.answer, debug).toMatch(/Watch job configured|armed/i);
  }, 60_000);

  it("routes active-profile interpretation prompts through read, compare, then decision", async () => {
    seedVisualMail("The player stands in a dim Minecraft cave with visible ore and no hostile mob in frame.");
    const profileObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_interpreter_profile",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        domain: "minecraft",
        objective_text: "Watch Minecraft as a survival coach.",
        interpretation_guidelines: "Compare visual mail against hazards, resources, and navigation opportunities.",
        salience_criteria: ["cave", "ore"],
        suppress_criteria: ["unchanged menu"],
        risk_criteria: ["hostile mob", "lava"],
        opportunity_criteria: ["ore"],
        voice_callout_criteria: ["hostile mob"],
      },
    });
    expect(profileObservation.ok).toBe(true);

    const { response, decision, liveEnvironmentToolNames, debug } = await askMailbox(
      "Interpret the active visual live-source mailbox using the active profile.",
    );

    expect(liveEnvironmentToolNames, debug).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.compare_mail_to_interpreter_profile",
      "live_env.record_live_source_mail_decision",
    ]));
    expect(liveEnvironmentToolNames.indexOf("live_env.compare_mail_to_interpreter_profile"), debug).toBeGreaterThan(
      liveEnvironmentToolNames.indexOf("live_env.read_processed_live_source_mail"),
    );
    expect(liveEnvironmentToolNames.indexOf("live_env.record_live_source_mail_decision"), debug).toBeGreaterThan(
      liveEnvironmentToolNames.indexOf("live_env.compare_mail_to_interpreter_profile"),
    );
    expect(decision, debug).toMatchObject({
      decision: "record_interpretation",
      interpreterProfileRef: expect.stringMatching(/^stage_play_live_source_interpreter_profile:/),
      profileComparisonRefs: [expect.stringMatching(/^stage_play_live_source_interpreter_profile_comparison:/)],
      matchedCriteria: expect.arrayContaining(["cave", "ore"]),
    });
    expect(response.body?.source_target_intent?.requested_outputs, debug).toContain(
      "stage_play_live_source_interpreter_profile_comparison",
    );
    expectNoRawMailboxReceiptFinal(response.body?.answer, debug);
  }, 60_000);

  it("does not execute profile tools for future, quoted, or negated profile-control wording", async () => {
    const prompts = [
      "In the future, create an interpreter profile for the live source, but for now just explain what that would mean.",
      "The screen says \"open the profile note\"; explain that label without using the profile tool.",
      "Do not use the Minecraft Survival Coach profile right now; just explain the profile idea.",
    ];

    for (const prompt of prompts) {
      const { liveEnvironmentToolNames, debug } = await askMailbox(prompt);
      expect(liveEnvironmentToolNames, debug).not.toContain("live_env.configure_interpreter_profile");
      expect(liveEnvironmentToolNames, debug).not.toContain("live_env.compare_mail_to_interpreter_profile");
      expect(liveEnvironmentToolNames, debug).not.toContain("live_env.read_live_source_mail");
    }
  }, 30_000);

  it("routes latest-mail visibility prompts to draft_text_answer", async () => {
    seedVisualMail("A dark app launcher shows Docs, Gmail, Drive, YouTube, and Instagram icons.");

    const { response, decision, debug } = await askMailbox(
      "Check the active visual live-source mailbox. What does the latest mail show?",
    );

    expect(decision, debug).toMatchObject({
      decision: "draft_text_answer",
      textAnswerDraft: {
        text: expect.stringContaining("dark app launcher"),
      },
    });
    expect(response.body?.answer, debug).toContain("dark app launcher");
    expectNoRawMailboxReceiptFinal(response.body?.answer, debug);
  }, 30_000);

  it("routes interpretation and watch-next prompts to record_interpretation", async () => {
    seedVisualMail("The visual summary changed from an app launcher to a document editor on a dark desktop.");

    const { response, decision, debug } = await askMailbox(
      "Check the active visual live-source mailbox. Interpret the mail and say what should be watched next.",
    );

    expect(decision, debug).toMatchObject({
      decision: "record_interpretation",
      narrativeState: expect.objectContaining({
        currentSceneSummary: expect.stringContaining("document editor"),
        watchNext: expect.objectContaining({
          targets: expect.any(Array),
        }),
      }),
    });
    expect(decision?.evidenceRefs, debug).toContain(response.body?.turn_id);
    expect(response.body?.answer, debug).toMatch(/document editor|Watch next/i);
    expectNoRawMailboxReceiptFinal(response.body?.answer, debug);
  }, 60_000);

  it("routes playbook visual-mail interpretation wording to record_interpretation", async () => {
    seedVisualMail("The visual summary shows a dark icon grid with multiple productivity apps.");

    const { response, decision, liveEnvironmentToolNames, debug } = await askMailbox(
      "Read the visual mail and interpret what is happening. Say what should be watched next.",
    );

    expect(decision, debug).toMatchObject({
      decision: "record_interpretation",
      decision_validation_result: "forced_record_interpretation_for_read_mail_interpretation_intent",
      narrativeStateRef: expect.stringMatching(/^stage_play_live_source_narrative_state:/),
    });
    const firstProcessedReadIndex = liveEnvironmentToolNames.indexOf("live_env.read_processed_live_source_mail");
    const processIndex = liveEnvironmentToolNames.indexOf("live_env.process_live_source_mail");
    const secondProcessedReadIndex = liveEnvironmentToolNames.lastIndexOf("live_env.read_processed_live_source_mail");
    const decisionIndex = liveEnvironmentToolNames.indexOf("live_env.record_live_source_mail_decision");
    expect(firstProcessedReadIndex, debug).toBeGreaterThanOrEqual(0);
    expect(processIndex, debug).toBeGreaterThan(firstProcessedReadIndex);
    expect(secondProcessedReadIndex, debug).toBeGreaterThan(processIndex);
    expect(decisionIndex, debug).toBeGreaterThan(secondProcessedReadIndex);
    expect(decision?.evidenceRefs, debug).toContain(response.body?.turn_id);
    expect(response.body?.answer, debug).toMatch(/icon grid|Watch next/i);
    expect(response.body?.canonical_goal_frame, debug).toMatchObject({
      goal_kind: "live_source_processed_mail_interpretation",
      required_terminal_kind: "model_synthesized_answer",
    });
    expect(response.body?.goal_satisfaction_evaluation, debug).toMatchObject({
      canonical_goal_kind: "live_source_processed_mail_interpretation",
      terminal_contract: expect.objectContaining({
        required_evidence: [
          "processed_mail_packet",
          "live_source_decision_or_checkpoint_summary",
          "loop_state",
        ],
        forbidden_terminal_kinds: expect.arrayContaining([
          "visual_context_pack",
          "situation_context_pack",
          "focused_doc_answer",
          "doc_summary",
        ]),
      }),
    });
    expect(response.body?.goal_satisfaction_evaluation?.required_evidence, debug).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "processed_mail_packet",
          satisfied: true,
        }),
        expect.objectContaining({
          kind: "live_source_decision_or_checkpoint_summary",
          satisfied: true,
        }),
        expect.objectContaining({
          kind: "loop_state",
          satisfied: true,
        }),
      ]),
    );
    expect(response.body?.stage_play_live_source_mailbox_debug?.trajectory, debug).toMatchObject({
      route: "live_source_mailbox",
      capability: "live_env.read_processed_live_source_mail",
      mailIds: [expect.stringMatching(/^stage_play_live_source_mail:/)],
      decisionId: expect.stringMatching(/^stage_play_live_source_mail_decision:/),
      narrativeStateId: expect.stringMatching(/^stage_play_live_source_narrative_state:/),
      traceId: expect.stringMatching(/^live_source_trace:/),
      cycleId: expect.stringMatching(/^live_source_cycle:/),
      askTurnId: response.body?.turn_id,
    });
    expect(response.body?.stage_play_live_source_mailbox_debug, debug).toMatchObject({
      canonical_goal: "live_source_processed_mail_interpretation",
      evidence_requirement: "processed_mail_packet",
      decision_requirement: "record_live_source_mail_decision",
      authority_summary: expect.objectContaining({
        artifactId: "live_source_mailbox_authority_summary",
        schemaVersion: "helix.live_source_mailbox_authority_summary.v1",
        routeFamily: "live_source_mailbox",
        canonicalGoal: "live_source_processed_mail_interpretation",
        genericPlannerTraceDisplayRole: "secondary_runtime_trace",
        genericPlannerTraceSupersededBy: "live_source_mailbox_authority_summary",
        debugNoiseSuppressed: expect.arrayContaining([
          "planner_contract",
          "single_capability_lifecycle_flattening",
        ]),
      }),
    });
    expect(response.body?.live_source_mailbox_authority_summary, debug).toMatchObject({
      artifactId: "live_source_mailbox_authority_summary",
      schemaVersion: "helix.live_source_mailbox_authority_summary.v1",
      routeFamily: "live_source_mailbox",
      canonicalGoal: "live_source_processed_mail_interpretation",
      genericPlannerTraceDisplayRole: "secondary_runtime_trace",
      phasedToolSequence: expect.arrayContaining([
        expect.objectContaining({
          tool_name: "live_env.read_processed_live_source_mail",
        }),
        expect.objectContaining({
          tool_name: "live_env.record_live_source_mail_decision",
        }),
      ]),
    });
    expect(response.body?.generic_runtime_trace, debug).toMatchObject({
      display_role: "secondary_runtime_trace",
      superseded_by: "live_source_mailbox_authority_summary",
    });
    expect(response.body?.planner_contract, debug).toMatchObject({
      display_role: "secondary_runtime_trace",
      superseded_by: "live_source_mailbox_authority_summary",
    });
    const debugExport = await request(createApp())
      .get(`/api/agi/ask/turn/${encodeURIComponent(response.body?.turn_id)}/debug-export`)
      .expect(200);
    expect(debugExport.body?.payload?.live_source_mailbox_authority_summary, debug).toMatchObject({
      artifactId: "live_source_mailbox_authority_summary",
      routeFamily: "live_source_mailbox",
      genericPlannerTraceDisplayRole: "secondary_runtime_trace",
      phasedToolSequence: expect.arrayContaining([
        expect.objectContaining({
          tool_name: "live_env.read_processed_live_source_mail",
        }),
        expect.objectContaining({
          tool_name: "live_env.record_live_source_mail_decision",
        }),
      ]),
    });
    expect(debugExport.body?.payload?.tool_lifecycle_trace, debug).toMatchObject({
      lifecycle_shape: "phased_tool_sequence",
      phased_tool_sequence: expect.arrayContaining([
        expect.objectContaining({
          tool_name: "live_env.read_processed_live_source_mail",
        }),
      ]),
    });
    expect(response.body?.stage_play_live_source_mailbox_debug?.wake_continuation, debug).toMatchObject({
      checkpoint_state: "checkpoint_completed",
      continuation: expect.stringContaining("Backend wake loop remains armed"),
      backend_wake_loop_armed: true,
      loop_state: "armed_for_next_summary",
      unread_retained: 0,
      assistant_answer: false,
      terminal_eligible: false,
    });
    expectNoRawMailboxReceiptFinal(response.body?.answer, debug);
  }, 60_000);

  it("lets current-turn predictor interpretation override a one-sentence standing watch policy", async () => {
    executeLiveEnvironmentTool({
      tool_name: "live_env.configure_live_source_watch_job",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        objective: "Watch the active visual source and describe each new mail batch in one sentence.",
      },
    });
    seedVisualMail("The Minecraft video shows a player moving from a wooden cabin interior into a birch forest while holding a sword.");

    const { response, decision, liveEnvironmentToolNames, debug } = await askMailbox(
      "Read the visual mail from the active Minecraft YouTube live source and interpret what is happening. Use a Minecraft video predictor contract: separate observed facts from cautious inferences, predict the next likely scene beat, and say what should be watched next.",
    );

    expect(decision, debug).toMatchObject({
      decision: "record_interpretation",
      decision_validation_result: "forced_record_interpretation_for_read_mail_interpretation_intent",
      narrativeStateRef: expect.stringMatching(/^stage_play_live_source_narrative_state:/),
      mailCoverage: {
        mode: "chronological_batch",
        interpretedMailIds: expect.arrayContaining([expect.stringMatching(/^stage_play_live_source_mail:/)]),
      },
    });
    expect(decision?.textAnswerDraft, debug).toBeFalsy();
    expect(liveEnvironmentToolNames, debug).toContain("live_env.read_processed_live_source_mail");
    expect(liveEnvironmentToolNames, debug).toContain("live_env.record_live_source_mail_decision");
    expect(liveEnvironmentToolNames, debug).not.toContain("live_env.read_live_source_mail");
    expect(response.body?.source_target_intent?.target_source, debug).toBe("live_source_mailbox");
    expect(response.body?.stage_play_live_source_mailbox_debug, debug).toMatchObject({
      route: "live_source_mailbox",
      capability: "live_env.read_processed_live_source_mail",
      canonical_goal: "live_source_processed_mail_interpretation",
      evidence_requirement: "processed_mail_packet",
      decision_requirement: "record_live_source_mail_decision",
    });
    expect(response.body?.answer, debug).toMatch(/Observed:/i);
    expect(response.body?.canonical_goal_frame, debug).toMatchObject({
      goal_kind: "live_source_processed_mail_interpretation",
      required_terminal_kind: "model_synthesized_answer",
      classifier_reasons: expect.arrayContaining([
        "processed_mail_interpretation_goal",
        "forbid_visual_capture_describe_goal",
      ]),
    });
    expect(response.body?.canonical_goal_frame?.goal_kind, debug).not.toBe("visual_capture_describe");
    expect(response.body?.canonical_goal_frame?.goal_kind, debug).not.toBe("situation_context_pack");
    expect(response.body?.canonical_goal_frame?.goal_kind, debug).not.toBe("doc_summary");
    expect(response.body?.goal_satisfaction_evaluation?.terminal_contract?.forbidden_terminal_kinds, debug).toEqual(
      expect.arrayContaining([
        "visual_context_pack",
        "situation_context_pack",
        "focused_doc_answer",
        "doc_summary",
      ]),
    );
    expect(response.body?.terminal_error_code, debug).not.toBe("missing_visual_observation");
    expect(response.body?.terminal_error_code, debug).not.toBe("missing_doc_summary");
    expect(response.body?.answer, debug).toMatch(/Prediction:/i);
    expect(response.body?.answer, debug).toMatch(/Watch next:/i);
    expect(response.body?.answer, debug).toMatch(/Minecraft|birch forest/i);
    expect(response.body?.answer, debug).toMatch(/Observed:/i);
    expect(response.body?.answer, debug).toMatch(/Cautious interpretation:/i);
    expectNoRawMailboxReceiptFinal(response.body?.answer, debug);
  }, 60_000);

  it("repairs premature final answers in record_decision phase to record_live_source_mail_decision", async () => {
    setAgentStepResponses([
      {
        next_step: "next_action",
        chosen_capability: "live_env.read_processed_live_source_mail",
        reason: "Read processed mail first.",
        args: {},
        expected_artifacts: ["stage_play_processed_mail_packet"],
        confidence: 0.9,
      },
      {
        next_step: "next_action",
        chosen_capability: "live_env.process_live_source_mail",
        reason: "Process raw visual mail into packet evidence.",
        args: {},
        expected_artifacts: ["stage_play_processed_mail_packet"],
        confidence: 0.9,
      },
      {
        next_step: "next_action",
        chosen_capability: "live_env.read_processed_live_source_mail",
        reason: "Read canonical processed packet after fallback processing.",
        args: {},
        expected_artifacts: ["stage_play_processed_mail_packet"],
        confidence: 0.9,
      },
      {
        next_step: "answer",
        chosen_capability: null,
        reason: "Wrongly tried to answer before recording the packet decision.",
        args: {},
        expected_artifacts: ["model_synthesized_answer"],
        confidence: 0.7,
      },
    ]);
    seedVisualMail("The Minecraft player leaves an interior base and moves outdoors with a sword; watch for combat or exploration.");

    const { response, decision, liveEnvironmentToolNames, debug } = await askMailbox(
      "Read the visual mail from the active Minecraft YouTube live source and interpret what is happening. Predict what should be watched next.",
    );

    expect(liveEnvironmentToolNames, debug).toContain("live_env.record_live_source_mail_decision");
    expect(decision, debug).toMatchObject({
      decision: "record_interpretation",
      nextLoopState: "armed_for_next_summary",
    });
    expect(response.body?.live_source_phase_repair, debug).toMatchObject({
      phase: "record_decision",
      repaired_to: "live_env.record_live_source_mail_decision",
    });
    expect(response.body?.live_source_phase_repair?.selected_operation, debug).not.toBe("live_env.record_live_source_mail_decision");
    expect(response.body?.terminal_error_code, debug).not.toBe("agent_loop_budget_exhausted");
    expect(response.body?.answer, debug).toMatch(/Observed:|Watch next:/i);
  }, 60_000);

  it("records coverage semantics for multi-mail interpretation instead of flattening the batch", async () => {
    executeLiveEnvironmentTool({
      tool_name: "live_env.configure_live_source_watch_job",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        objective: "Watch the active visual source and describe each new mail batch in one sentence.",
      },
    });
    [
      "Mail 15 shows the Minecraft player inside a base near inventory and chest UI.",
      "Mail 16 shows the player still managing inventory near storage.",
      "Mail 17 shows the scene moving outside into a forest path.",
      "Mail 18 shows outdoor movement with the player holding a sword.",
      "Mail 19 shows a brief combat-risk moment with the player on fire.",
      "Mail 20 shows a return toward base or inventory interaction with valuable items visible.",
    ].forEach(seedVisualMail);

    const { response, decision, readObservation, debug } = await askMailbox(
      "Read the visual mail from the active Minecraft YouTube live source and interpret what is happening. Use the Minecraft video predictor contract, predict what happens next, and say what should be watched next.",
    );

    expect(decision, debug).toMatchObject({
      decision: "record_interpretation",
      decision_validation_result: "forced_record_interpretation_for_read_mail_interpretation_intent",
      narrativeStateRef: expect.stringMatching(/^stage_play_live_source_narrative_state:/),
      mailCoverage: {
        mode: "chronological_batch",
        readMailIds: expect.arrayContaining([expect.stringMatching(/^stage_play_live_source_mail:/)]),
        interpretedMailIds: expect.arrayContaining([expect.stringMatching(/^stage_play_live_source_mail:/)]),
      },
    });
    expect(decision?.mailCoverage?.readMailIds, debug).toHaveLength(4);
    expect(decision?.mailCoverage?.interpretedMailIds, debug).toHaveLength(4);
    expect(readObservation?.readWindow, debug).toMatchObject({
      unreadBeforeRead: 6,
      effectiveLimit: 4,
      remainingUnreadCount: 2,
    });
    expect(decision?.textAnswerDraft, debug).toBeFalsy();
    expect(response.body?.answer, debug).toMatch(/current chronological batch mail batch/i);
    expect(response.body?.answer, debug).toMatch(/Prediction:/i);
    expect(response.body?.answer, debug).toMatch(/Watch next:/i);
    expect(response.body?.answer, debug).toMatch(/inventory|forest|sword|fire|valuable/i);
    expect(response.body?.answer, debug).not.toMatch(/Observed facts:|Cautious inferences:|Coverage:/i);
    expectNoRawMailboxReceiptFinal(response.body?.answer, debug);
  }, 90_000);

  it("routes natural mailbox/update wording to the intended text or interpretation decision", async () => {
    const cases = [
      {
        question: "What does the latest visual update show?",
        summary: "The latest visual update shows a desktop launcher with a calendar and browser icon.",
        expectedDecision: "draft_text_answer",
        answerPattern: /desktop launcher|calendar/i,
      },
      {
        question: "Review the new source mail and say what changed.",
        summary: "The new source mail shows the browser tab changed from a launcher to a document page.",
        expectedDecision: "record_interpretation",
        answerPattern: /document page|Watch next/i,
      },
      {
        question: "Interpret these observations and say what should be watched next.",
        summary: "These observations show a video timeline paused on a dark interface with a preview panel.",
        expectedDecision: "record_interpretation",
        answerPattern: /video timeline|Watch next/i,
      },
      {
        question: "What changed in the latest visual update?",
        summary: "The latest visual update shows a chat window replacing the previous app icon grid.",
        expectedDecision: "record_interpretation",
        answerPattern: /chat window|Watch next/i,
      },
    ];

    for (const testCase of cases) {
      resetLiveSourceMailRoutingState();
      seedVisualMail(testCase.summary);

      const { response, decision, debug } = await askMailbox(testCase.question);

      expect(decision, debug).toMatchObject({
        decision: testCase.expectedDecision,
      });
      if (testCase.expectedDecision === "record_interpretation") {
        expect(decision?.narrativeStateRef, debug).toEqual(
          expect.stringMatching(/^stage_play_live_source_narrative_state:/),
        );
      }
      expect(decision?.evidenceRefs, debug).toContain(response.body?.turn_id);
      expect(response.body?.answer, debug).toMatch(testCase.answerPattern);
      expectNoRawMailboxReceiptFinal(response.body?.answer, debug);
    }
  }, 180_000);

  it("routes change-across-summaries prompts to record_interpretation", async () => {
    seedVisualMail("The latest visual summary shows a new browser tab replacing the previous launcher grid.");

    const { decision, debug } = await askMailbox(
      "Check the active visual live-source mailbox. What changed across these summaries?",
    );

    expect(decision, debug).toMatchObject({
      decision: "record_interpretation",
      decision_validation_result: "forced_record_interpretation_for_read_mail_interpretation_intent",
    });
  }, 30_000);

  it("keeps importance-only prompts waiting when no salience fixture is present", async () => {
    seedVisualMail("The same dark launcher remains visible with no obvious user-facing risk.");

    const { response, decision, debug } = await askMailbox(
      "Check the active visual live-source mailbox, but only tell me if important.",
    );

    expect(decision, debug).toMatchObject({
      decision: "wait_for_next_summary",
      nextLoopState: "armed_for_next_summary",
    });
    expect(decision?.textAnswerDraft, debug).toBeFalsy();
    expect(decision?.narrativeStateRef, debug).toBeFalsy();
    expectNoRawMailboxReceiptFinal(response.body?.answer, debug);
  }, 60_000);

  it("routes explicit important voice prompts to request_voice_callout without terminalizing the raw mail receipt", async () => {
    seedVisualMail("A hostile mob appears near the player and should be called out quickly.");

    const { response, decision, debug } = await askMailbox(
      "Check the active visual live-source mailbox and announce if important.",
    );

    expect(decision, debug).toMatchObject({
      decision: "request_voice_callout",
      decision_validation_result: "forced_request_voice_callout_for_read_mail_voice_intent",
      voiceCalloutDraft: {
        text: expect.stringMatching(/hostile mob/i),
        voiceEligible: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(response.body?.answer, debug).toMatch(/hostile mob/i);
    expectNoRawMailboxReceiptFinal(response.body?.answer, debug);
  }, 30_000);

  it("promotes salient Minecraft commentary mail to a decision-backed interim voice callout", async () => {
    setAgentStepResponses([
      {
        next_step: "next_action",
        chosen_capability: "live_env.read_processed_live_source_mail",
        reason: "Read processed mail first.",
        args: {},
        expected_artifacts: ["stage_play_processed_mail_packet"],
        confidence: 0.9,
      },
      {
        next_step: "next_action",
        chosen_capability: "live_env.process_live_source_mail",
        reason: "Process raw mail into packet coverage.",
        args: {},
        expected_artifacts: ["stage_play_processed_mail_packet"],
        confidence: 0.9,
      },
      {
        next_step: "next_action",
        chosen_capability: "live_env.read_processed_live_source_mail",
        reason: "Read the processed packet after processing.",
        args: {},
        expected_artifacts: ["stage_play_processed_mail_packet"],
        confidence: 0.9,
      },
      {
        next_step: "next_action",
        chosen_capability: "live_env.record_live_source_mail_decision",
        reason: "Record the voice callout decision.",
        args: {
          decision: "request_voice_callout",
          rationale_preview: "Salient Minecraft damage/fire cue requires a callout decision.",
          next_loop_state: "armed_for_next_summary",
        },
        expected_artifacts: ["stage_play_live_source_mail_decision"],
        confidence: 0.9,
      },
    ]);
    executeLiveEnvironmentTool({
      tool_name: "live_env.configure_live_source_watch_job",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        objective: "Commentate while I play from the active Minecraft visual source. Call out danger, rare resources, major scene transitions, or damage cues.",
        allow_voice_callout: true,
        confirmation_required: false,
      },
    });
    seedVisualMail("Mail 20 shows the Minecraft player outdoors with the character visibly on fire while holding a sword.");

    const { response, decision, debug } = await askMailbox(
      "Read the visual mail from the active Minecraft YouTube live source and interpret what is happening. Predict what happens next and say what should be watched next.",
    );

    expect(decision, debug).toMatchObject({
      decision: "request_voice_callout",
      decision_validation_result: "forced_request_voice_callout_for_read_mail_voice_intent",
      voiceCalloutDraft: {
        text: expect.stringMatching(/fire|damage/i),
        voiceEligible: true,
        requiresConfirmation: false,
      },
      requestedTool: {
        toolName: "live_env.request_interim_voice_callout",
        args: {
          text: expect.stringMatching(/fire|damage/i),
          reason_codes: expect.arrayContaining(["minecraft_fire_or_damage_cue"]),
        },
      },
      nextLoopState: "armed_for_next_summary",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(response.body?.answer, debug).toMatch(/fire|damage/i);
    expectNoRawMailboxReceiptFinal(response.body?.answer, debug);
  }, 60_000);

  it("records voice callouts only when voice policy allows the decision", () => {
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId,
      roomId,
      sourceId,
      sourceKind: "visual_frame",
      frameRef: "visual_frame:voice-policy",
      evidenceRef: "visual_evidence:voice-policy",
      summaryText: "A hostile mob appears near the player.",
      createdAt: "2026-06-04T12:10:00.000Z",
    });

    const disabled = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [mail.mailId],
      decision: "request_voice_callout",
      rationalePreview: "Announce if important.",
      voiceCalloutDraft: "Hostile mob appeared near the player.",
      voiceEnabled: false,
      voiceAllowedNow: false,
      nextLoopState: "armed_for_next_summary",
    });
    expect(disabled).toMatchObject({
      decision: "request_voice_callout",
      voiceCalloutDraft: {
        text: "Hostile mob appeared near the player.",
        voiceEligible: false,
      },
      textAnswerDraft: {
        text: "Hostile mob appeared near the player.",
      },
      requestedTool: null,
    });

    const allowed = recordLiveSourceMailDecisionForAsk({
      threadId,
      roomId,
      mailIds: [mail.mailId],
      decision: "request_voice_callout",
      rationalePreview: "Announce if important.",
      voiceCalloutDraft: "Hostile mob appeared near the player.",
      voiceEnabled: true,
      voiceAllowedNow: true,
      nextLoopState: "armed_for_next_summary",
    });
    expect(allowed).toMatchObject({
      decision: "request_voice_callout",
      voiceCalloutDraft: {
        text: "Hostile mob appeared near the player.",
        voiceEligible: true,
      },
    });
  });
});
