import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import { helixStagePlayRouter } from "../routes/helix/stage-play";
import {
  recordLiveSourceObservation,
  resetLiveSourceObservationStoreForTest,
} from "../services/live-source/live-source-observation-store";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  analyzeVisualFrame,
  recordVisualFrame,
  resetVisualSnapshotStoreForTest,
  startVisualSnapshotSource,
} from "../services/situation-room/visual-snapshot-store";
import {
  resetLiveSourceChunkBufferForTest,
  upsertLiveSourceProducer,
} from "../services/situation-room/live-source-chunk-buffer";
import {
  resetLiveSourceDescriptorsForTest,
  upsertLiveSourceDescriptor,
} from "../services/situation-room/live-source-descriptor-builder";
import {
  classifyLiveSourceContinuationIntent,
  isLiveSourceMailLoopPrompt,
} from "../services/helix-ask/live-source-continuation-intent";
import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";
import { STAGE_PLAY_LIVE_ANSWER_LINE_SCHEMA } from "../services/stage-play/stage-play-output-lane-reducer";
import { evaluateTerminalBoundaryEligibility } from "../services/helix-ask/runtime-authority-contract";
import { WORKSTATION_AGENT_GOAL_DEFAULT_FINAL_REPORT_REQUIREMENTS } from "@shared/contracts/workstation-goal-context.v1";
import { buildStagePlayGraphFromWorld } from "../services/stage-play/stage-play-badge-graph-builder";
import { resetStagePlayAskCheckpointReceiptsForTest } from "../services/stage-play/stage-play-ask-checkpoint-store";
import { resetStagePlayCheckpointQueueForTest } from "../services/stage-play/stage-play-checkpoint-queue";
import {
  configureStagePlayLiveSourceWatchJobPolicy,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import { listStagePlayLiveSourceNarrativeStates } from "../services/stage-play/stage-play-live-source-narrative-store";
import { resetStagePlayLiveSourceMailWakeStoreForTest } from "../services/stage-play/stage-play-live-source-mail-wake-store";
import { resetStagePlayLiveSourceMailTranscriptStoreForTest } from "../services/stage-play/stage-play-live-source-mail-transcript-store";
import { resetStagePlayGoalContextStoreForTest } from "../services/stage-play/stage-play-goal-context-store";
import { resetHelixAskTurnAdmissionForTests } from "../services/helix-ask/ask-turn-admission";
import { resetRuntimeMemoryGovernorForTests } from "../services/runtime/runtime-memory-governor";

const threadId = "helix-ask:desktop";
const roomId = "room:stage-play-routing";
const sourceId = "visual_source:stage_play_visual_tab";
const lowPressureMemoryUsage = (): NodeJS.MemoryUsage => ({
  rss: 128 * 1024 * 1024,
  heapTotal: 96 * 1024 * 1024,
  heapUsed: 48 * 1024 * 1024,
  external: 8 * 1024 * 1024,
  arrayBuffers: 2 * 1024 * 1024,
});
const lowPressureHostMemory = () => ({
  freeMiB: 16_384,
  totalMiB: 32_768,
  freeRatio: 0.5,
});

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  app.use("/api/helix/stage-play", helixStagePlayRouter);
  return app;
};

beforeEach(() => {
  resetHelixAskTurnAdmissionForTests();
  resetRuntimeMemoryGovernorForTests({
    memoryReader: lowPressureMemoryUsage,
    hostMemoryReader: lowPressureHostMemory,
  });
  resetLiveAnswerEnvironments();
  resetLiveSourceObservationStoreForTest();
  resetLiveSourceDescriptorsForTest();
  resetLiveSourceChunkBufferForTest();
  resetVisualSnapshotStoreForTest();
  resetStagePlayAskCheckpointReceiptsForTest();
  resetStagePlayCheckpointQueueForTest();
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayLiveSourceMailWakeStoreForTest();
  resetStagePlayLiveSourceMailTranscriptStoreForTest();
  resetStagePlayGoalContextStoreForTest();
});

it("creates an agent goal session from a prompt-only Ask goal command", async () => {
  const app = createApp();
  const sessionId = "helix-ask:goal-session-prompt-regression";
  const prompt =
    "Create a goal to refactor the goal-session UI so it supports pause, resume, edit, archive, and expanded details. Work until tests pass.";

  const ask = await request(app)
    .post("/api/agi/ask/turn")
    .send({
      sessionId,
      question: prompt,
      prompt,
      mode: "read",
      debug: true,
    })
    .expect(200);

  const debug = await request(app)
    .get(`/api/agi/ask/turn/${encodeURIComponent(String(ask.body.turn_id))}/debug-export`)
    .expect(200);
  const payload = debug.body.payload ?? debug.body;

  expect(payload.canonical_goal_frame).toMatchObject({
    goal_kind: "workstation_goal_context",
    required_terminal_kind: "workstation_tool_evaluation",
  });
  expect(payload.source_target_intent).toMatchObject({
    target_source: "live_environment",
  });
  expect(payload.capability_plan).toMatchObject({
    selected_capability: "live_env.start_agent_goal_session",
    admission_status: "needs_evidence",
    operator_command_present: true,
  });
  expect(payload.current_turn_artifact_ledger).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "live_environment_tool_observation",
        payload: expect.objectContaining({
          tool_name: "live_env.start_agent_goal_session",
          observation: expect.objectContaining({
            schema: "stage_play_agent_goal_session_tool_result/v1",
          }),
        }),
      }),
    ]),
  );

  const context = await request(app)
    .get("/api/helix/stage-play/goal-context")
    .query({ threadId: sessionId, limit: 20 })
    .expect(200);

  expect(context.body.agentGoalSessions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objective: prompt,
      }),
    ]),
  );
});

it("starts Stage Play goal sessions with explicit context feeds and actuator policy", async () => {
  const response = await request(createApp())
    .post("/api/helix/stage-play/goal-session")
    .send({
      threadId,
      roomId,
      goalId: "goal:route-session-policy",
      objective: "Monitor visual and translated transcript packets for operator evidence.",
      sourceRefs: [sourceId, "audio_source:earbuds"],
      loopRefs: ["stage_play_translation_loop:route"],
      constructRefs: ["stage_play_badge_graph:route"],
      contextFeeds: [
        {
          feedId: "feed:visual",
          sourceKind: "visual_summaries",
          freshnessMs: 15000,
          relevancePolicy: "same-source-or-goal-id",
        },
        {
          feedId: "feed:translation",
          sourceKind: "translated_transcripts",
          query: "operator translation",
          freshnessMs: 45000,
          relevancePolicy: "same-source-or-goal-id",
        },
        {
          feedId: "feed:wake",
          sourceKind: "wake_candidates",
          freshnessMs: 1,
        },
      ],
      allowedActuators: [
        "query_visual_summaries",
        "query_translation_segments",
        "narrator_bind_stream",
        "wake_agent",
      ],
      cadence: { kind: "event_accumulation", min_updates: 2 },
      stopConditions: ["terminal authority produces a final report"],
      finalReportRequirements: {
        ...WORKSTATION_AGENT_GOAL_DEFAULT_FINAL_REPORT_REQUIREMENTS,
        completedSolverPathRequired: false,
        requiredEvidenceKinds: [
          "goal_context_update",
          "translated_transcript",
          "terminal_authority_single_writer",
        ],
      },
      checkpointSummary: "Goal session initialized by Stage Play route.",
      actionsTaken: ["bind_translation_loop"],
      evidenceRefs: ["stage_play_processed_mail_packet:translation-route"],
    })
    .expect(200);

  expect(response.body).toMatchObject({
    ok: true,
    schema: "stage_play_goal_session_response/v1",
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
    session: {
      goalId: "goal:route-session-policy",
      objective: "Monitor visual and translated transcript packets for operator evidence.",
      sourceRefs: expect.arrayContaining([sourceId, "audio_source:earbuds"]),
      loopRefs: expect.arrayContaining(["stage_play_translation_loop:route"]),
      constructRefs: ["stage_play_badge_graph:route"],
      contextFeeds: expect.arrayContaining([
        expect.objectContaining({
          feedId: "feed:visual",
          sourceKind: "visual_summaries",
          freshnessMs: 15000,
        }),
        expect.objectContaining({
          feedId: "feed:translation",
          sourceKind: "translated_transcripts",
          query: "operator translation",
          freshnessMs: 45000,
        }),
      ]),
      allowedActuators: expect.arrayContaining([
        "query_visual_summaries",
        "query_translation_segments",
        "narrator_bind_stream",
      ]),
      cadence: { kind: "event_accumulation", minUpdates: 2 },
      stopConditions: expect.arrayContaining(["terminal authority produces a final report"]),
      authority: {
        assistantAnswer: false,
        finalReportsRequireTerminalAuthority: true,
        finalReportRequirements: expect.objectContaining({
          completedSolverPathRequired: true,
          evidenceReentryRequired: true,
          routeAuthorityRequired: true,
          terminalAuthoritySingleWriterRequired: true,
        }),
      },
    },
  });
  expect(response.body.session.authority.finalReportRequirements.requiredEvidenceKinds).toEqual(
    expect.arrayContaining([
      "goal_context_update",
      "translated_transcript",
      "terminal_authority_single_writer",
    ]),
  );
  expect(response.body.session.contextFeeds.some((feed: any) => feed.sourceKind === "wake_candidates")).toBe(false);
  expect(response.body.session.allowedActuators).not.toContain("wake_agent");
  expect(response.body.session.checkpoints.at(-1)).toMatchObject({
    summary: "Goal session initialized by Stage Play route.",
    evidenceRefs: expect.arrayContaining(["stage_play_processed_mail_packet:translation-route"]),
    actionsTaken: expect.arrayContaining(["bind_translation_loop", "start_agent_goal_session"]),
    nextStep: "continue",
  });
});

afterEach(() => {
  delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
  delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
  delete process.env.HELIX_POST_OBSERVATION_COMPOSER_TEST_RESPONSE;
});

describe("Helix Ask Stage Play routing", () => {
  it("keeps Stage Play reflection prompts out of live source continuation", () => {
    expect(
      classifyLiveSourceContinuationIntent(
        "Use the active Stage Play Badge Graph for the current visual source. Reflect the source, project/update Live Answer from Stage Play, and tell me what evidence is still missing before this can become a model-reviewed answer snapshot.",
      ),
    ).toBeNull();
    expect(
      classifyLiveSourceContinuationIntent(
        "Use the routed visual source in narrative_stage_play to predict next scene and show checkpoint freshness for the live interpretation.",
      ),
    ).toBeNull();
  });

  it("keeps explicit Stage Play capture cadence prompts on live source control", () => {
    const intent = classifyLiveSourceContinuationIntent(
      "Start Stage Play visual capture every 10 seconds.",
    );

    expect(intent).toMatchObject({
      kind: "live_pipeline_control",
      requested_rate_ms: 10_000,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("keeps structured Stage Play mail wake turns in the live source mailbox lane", async () => {
    const app = createApp();
    const wakeRequestId = "stage_play_live_source_mail_wake:test-hard-route";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Review the latest live-source mailbox finding.",
        sessionId: threadId,
        debug: true,
        route_metadata: {
          invocationKind: "stage_play_mail_wake",
          wakeRequestId,
          mailboxThreadId: threadId,
          sourceTarget: "live_source_mailbox",
          requiredCanonicalGoal: "processed_mail_voice_decision",
          requiredPhase: "record_decision",
          allowedCapabilities: [
            "live_env.read_processed_live_source_mail",
            "live_env.record_live_source_mail_decision",
          ],
          forbiddenCapabilities: [
            "workspace_os.status",
            "internet-search.search_web",
            "docs-viewer.open",
          ],
          evidenceRefs: ["stage_play_processed_mail_packet:test-hard-route"],
        },
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          source: "stage_play_mail_wake_route_metadata",
          wakeRequestId,
          stage_play_live_source_mail_wake_request_id: wakeRequestId,
          target_source: "live_source_mailbox",
          target_kind: "live_source_mailbox",
          targetSource: "live_source_mailbox",
          targetKind: "live_source_mailbox",
          strength: "hard",
          requiredPhase: "record_decision",
          mandatoryNextTool: "live_env.record_live_source_mail_decision",
        },
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      turnId: response.body?.turn_id,
      sourceTarget: response.body?.source_target_intent,
      canonical: response.body?.canonical_goal_frame,
      available: response.body?.available_capabilities,
      answer: response.body?.answer,
      terminal: response.body?.terminal_artifact_kind,
    }, null, 2);

    expect(response.body?.turn_id, routeDebug).toMatch(/^ask:/);
    expect(response.body?.source_target_intent, routeDebug).toMatchObject({
      target_source: "live_source_mailbox",
      target_kind: "live_source_mailbox",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.source_target_intent?.suppressed_routes, routeDebug).toEqual(expect.arrayContaining([
      "visual_capture_describe",
    ]));
    expect(response.body?.canonical_goal_frame, routeDebug).toMatchObject({
      goal_kind: expect.stringMatching(/^live_(?:source_processed_mail_interpretation|environment_review)$/),
      answer_scope: "live_environment_state",
      required_terminal_kind: "model_synthesized_answer",
    });
    expect(response.body?.canonical_goal_frame?.classifier_reasons, routeDebug).toEqual(expect.arrayContaining([
      "live_source_mail_loop_intent",
    ]));
    expect(response.body?.available_capabilities?.recommended_capability_key, routeDebug)
      .not.toBe("workspace_os.status");
    expect(response.body?.available_capabilities?.recommended_capability_key, routeDebug)
      .toMatch(/^live_env\./);
  }, 60_000);

  it("lets live-source mailbox route metadata hard-lock source and capability admission over internet, repo, and visual prompt bait", async () => {
    const app = createApp();
    const wakeRequestId = "stage_play_live_source_mail_wake:test-metadata-hard-route";
    const forbiddenCapabilities = [
      "internet-search.search_web",
      "repo-code.search_concept",
      "situation-room.describe_visual_capture",
      "visual_capture_describe",
      "model.direct_answer",
      "workspace_os.status",
    ];
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Search the latest internet update, inspect repo-code.search_concept, describe the visual capture, or answer directly. Use the structured mailbox route metadata attached to this turn.",
        sessionId: `${threadId}:metadata-hard-route`,
        debug: true,
        route_metadata: {
          invocationKind: "stage_play_mail_wake",
          wakeRequestId,
          mailboxThreadId: threadId,
          sourceTarget: "live_source_mailbox",
          requiredCanonicalGoal: "processed_mail_interpretation",
          requiredPhase: "read_mailbox",
          allowedCapabilities: [
            "live_env.read_processed_live_source_mail",
          ],
          forbiddenCapabilities,
          evidenceRefs: ["stage_play_processed_mail_packet:test-metadata-hard-route"],
        },
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      route: response.body?.route_reason_code,
      evidenceTarget: response.body?.evidence_target_arbitration,
      sourceTarget: response.body?.source_target_intent,
      canonical: response.body?.canonical_goal_frame,
      available: response.body?.available_capabilities,
      capabilityPlan: response.body?.capability_plan,
      admission: response.body?.agent_runtime_loop_admission,
      loop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
    }, null, 2);
    const selectedCapability =
      response.body?.capability_plan?.selected_capability ??
      response.body?.capability_plan?.requested_action ??
      response.body?.available_capabilities?.recommended_capability_key;
    const executedCapabilities =
      response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability) ?? [];

    expect(response.body?.evidence_target_arbitration, routeDebug).toMatchObject({
      schema: "helix.ask_evidence_target_arbitration.v1",
      selected_target_source: "live_source_mailbox",
      selected_target_kind: "live_source_mailbox",
      selected_candidate_id: "live_source_mailbox.stage_play_mail_wake_route_metadata",
      locked: true,
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(response.body?.evidence_target_arbitration?.reason_codes, routeDebug).toEqual(expect.arrayContaining([
      "route_metadata_stage_play_mail_wake",
      "live_source_mailbox_route_metadata_authoritative",
    ]));
    expect(response.body?.evidence_target_arbitration?.source_targets, routeDebug).toEqual(["live_source_mailbox"]);
    const arbitrationCapabilities = response.body?.evidence_target_arbitration?.available_capabilities ?? [];
    expect(arbitrationCapabilities, routeDebug).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
    ]));
    expect(arbitrationCapabilities.every((capability: unknown) =>
      typeof capability === "string" && capability.startsWith("live_env.")
    ), routeDebug).toBe(true);
    expect(arbitrationCapabilities, routeDebug).not.toEqual(expect.arrayContaining([
      "internet-search.search_web",
      "repo-code.search_concept",
      "situation-room.describe_visual_capture",
      "visual_capture_describe",
      "model.direct_answer",
      "workspace_os.status",
    ]));

    expect(response.body?.source_target_intent, routeDebug).toMatchObject({
      target_source: "live_source_mailbox",
      target_kind: "live_source_mailbox",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.source_target_intent?.suppressed_routes, routeDebug).toEqual(expect.arrayContaining([
      "internet-search.search_web",
      "repo-code.search_concept",
      "situation_room.describe_visual_capture",
      "visual_capture_describe",
      "model_only_concept",
      "no_tool_direct",
    ]));

    expect(response.body?.capability_plan, routeDebug).toMatchObject({
      capability_family: "live_environment",
      source_target: "live_source_mailbox",
      selected_capability: "live_env.read_processed_live_source_mail",
      requested_action: "live_env.read_processed_live_source_mail",
    });
    expect(selectedCapability, routeDebug).toBe("live_env.read_processed_live_source_mail");
    expect(selectedCapability, routeDebug).not.toBe("internet-search.search_web");
    expect(selectedCapability, routeDebug).not.toBe("repo-code.search_concept");
    expect(selectedCapability, routeDebug).not.toBe("situation-room.describe_visual_capture");
    expect(selectedCapability, routeDebug).not.toBe("visual_capture_describe");
    expect(selectedCapability, routeDebug).not.toBe("model.direct_answer");
    expect(executedCapabilities, routeDebug).not.toEqual(expect.arrayContaining(forbiddenCapabilities));
  }, 60_000);

  it("executes the locked mailbox read phase instead of asking for pending input", async () => {
    const app = createApp();
    const wakeRequestId = "stage_play_live_source_mail_wake:test-locked-read-phase";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Review the latest Stage Play live-source mailbox finding.",
        sessionId: `${threadId}:locked-read-phase`,
        debug: true,
        route_metadata: {
          invocationKind: "stage_play_mail_wake",
          wakeRequestId,
          mailboxThreadId: threadId,
          sourceTarget: "live_source_mailbox",
          requiredCanonicalGoal: "processed_mail_interpretation",
          requiredPhase: "read_mailbox",
          allowedCapabilities: [
            "live_env.read_processed_live_source_mail",
          ],
          forbiddenCapabilities: [
            "workspace_os.status",
            "internet-search.search_web",
            "docs-viewer.open",
            "model.direct_answer",
          ],
          evidenceRefs: ["stage_play_live_source_mail_wake:test-locked-read-phase"],
        },
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          source: "stage_play_mail_wake_route_metadata",
          wakeRequestId,
          stage_play_live_source_mail_wake_request_id: wakeRequestId,
          target_source: "live_source_mailbox",
          target_kind: "live_source_mailbox",
          targetSource: "live_source_mailbox",
          targetKind: "live_source_mailbox",
          strength: "hard",
          requiredPhase: "read_mailbox",
          mandatoryNextTool: "live_env.read_processed_live_source_mail",
          must_enter_backend_ask: true,
          allow_client_shortcut: false,
          allow_no_tool_direct: false,
        },
        live_source_turn_phase_resolution: {
          phase: "read_processed_mail",
          canonicalGoal: "processed_mail_interpretation",
          allowedTools: ["live_env.read_processed_live_source_mail"],
          forbiddenTools: [
            "workspace_os.status",
            "internet-search.search_web",
            "docs-viewer.open",
            "model.direct_answer",
            "final_answer",
          ],
          phaseLock: {
            locked: true,
            reason: "Stage Play mail wake route metadata is authoritative for the mailbox read phase.",
          },
          terminalAllowed: false,
        },
        mandatory_next_tool: {
          schema: "helix.mandatory_next_tool.v1",
          tool_name: "live_env.read_processed_live_source_mail",
          allowed_tools: ["live_env.read_processed_live_source_mail"],
          terminal_forbidden: true,
          reason: "locked mailbox read phase must execute the processed mailbox read tool",
          canonical_goal: "processed_mail_interpretation",
        },
      })
      .expect(200);

    const executedCapabilities =
      response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability) ?? [];
    const routeDebug = JSON.stringify({
      route: response.body?.route_reason_code,
      sourceTarget: response.body?.source_target_intent,
      phase: response.body?.live_source_turn_phase_resolution,
      mandatory: response.body?.mandatory_next_tool,
      admission: response.body?.agent_runtime_loop_admission,
      loop: response.body?.agent_runtime_loop,
      pending: response.body?.pending_server_request,
      answer: response.body?.answer,
    }, null, 2);

    expect(response.body?.source_target_intent?.target_source, routeDebug).toBe("live_source_mailbox");
    expect(response.body?.mandatory_next_tool, routeDebug).toMatchObject({
      phase: "read_processed_mail",
      tool_name: "live_env.read_processed_live_source_mail",
      allowed_tools: ["live_env.read_processed_live_source_mail"],
      terminal_forbidden: true,
    });
    expect(response.body?.mandatory_next_tool?.tool_name, routeDebug).toBe("live_env.read_processed_live_source_mail");
    expect(response.body?.agent_runtime_loop_admission, routeDebug).toMatchObject({
      admitted: true,
      mode: "execute_or_record",
    });
    expect(response.body?.agent_runtime_loop_admission?.reason, routeDebug).not.toBe("pending_user_input");
    expect(response.body?.route_reason_code, routeDebug).not.toBe("clarify:missing_args");
    expect(response.body?.pending_server_request ?? null, routeDebug).toBeNull();
    expect(response.body?.agent_runtime_loop?.executed_tool_call_count ?? 0, routeDebug).toBeGreaterThanOrEqual(1);
    expect(executedCapabilities, routeDebug).toContain("live_env.read_processed_live_source_mail");
  }, 60_000);

  it("executes MicroDeck preset queries without processed-mail tools and projects the selected tool", async () => {
    startVisualSnapshotSource({
      source_id: sourceId,
      thread_id: threadId,
      room_id: roomId,
      source_surface: "browser_tab",
      capture_mode: "interval",
      status: "active",
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "Query the MicroDeck preset assembly for the active visual source.",
        sessionId: `${threadId}:microdeck-query`,
        debug: true,
      })
      .expect(200);

    const iterations = Array.isArray(response.body?.agent_runtime_loop?.iterations)
      ? response.body.agent_runtime_loop.iterations
      : [];
    const executedCapabilities = iterations.flatMap((iteration: any) => [
      iteration?.chosen_capability,
      iteration?.executed_action_key,
      iteration?.tool_observation?.tool_name,
    ]).filter(Boolean);
    const responseText = JSON.stringify(response.body);
    const routeDebug = JSON.stringify({
      selectedTool: response.body?.selected_tool,
      selectedCapability: response.body?.selected_capability,
      lifecycle: response.body?.tool_lifecycle_trace,
      phase: response.body?.live_source_turn_phase_resolution,
      mandatory: response.body?.mandatory_next_tool,
      iterations: iterations.map((iteration: any) => ({
        chosen_capability: iteration?.chosen_capability,
        executed_action_key: iteration?.executed_action_key,
        observation_role: iteration?.observation_role,
        tool_name: iteration?.tool_observation?.tool_name,
      })),
      answer: response.body?.answer,
    }, null, 2);

    expect(response.body?.live_source_turn_phase_resolution, routeDebug).toMatchObject({
      phase: "query_micro_reasoner_deck",
      allowedTools: ["live_env.query_micro_reasoner_presets"],
      fallbackTools: [],
      requiredEvidence: ["stage_play_micro_reasoner_prompt_preset_query_result"],
      completionEvidence: ["stage_play_micro_reasoner_prompt_preset_query_result"],
    });
    expect(response.body?.mandatory_next_tool, routeDebug).toMatchObject({
      tool_name: "live_env.query_micro_reasoner_presets",
      allowed_tools: ["live_env.query_micro_reasoner_presets"],
      terminal_forbidden: true,
    });
    expect(executedCapabilities, routeDebug).toContain("live_env.query_micro_reasoner_presets");
    expect(executedCapabilities, routeDebug).not.toContain("live_env.read_processed_live_source_mail");
    expect(executedCapabilities, routeDebug).not.toContain("live_env.process_live_source_mail");
    expect(responseText, routeDebug)
      .toContain("stage_play_micro_reasoner_prompt_preset_query_result/v1");
    expect(response.body?.selected_tool, routeDebug).toBe("live_env.query_micro_reasoner_presets");
    expect(response.body?.selected_tool, routeDebug).toBe(response.body?.selected_capability);
    expect(response.body?.tool_lifecycle_trace, routeDebug).toMatchObject({
      requested_capability: "live_env.query_micro_reasoner_presets",
      admitted_capability: "live_env.query_micro_reasoner_presets",
      executed_capability: "live_env.query_micro_reasoner_presets",
    });
    expect(response.body?.stage_play_live_source_mailbox_debug?.executed_capabilities_seen ?? [], routeDebug)
      .not.toEqual(expect.arrayContaining([
        "live_env.read_processed_live_source_mail",
        "live_env.process_live_source_mail",
      ]));
  }, 60_000);

  it("executes MicroDeck preset drafts without processed-mail tools and projects the selected tool", async () => {
    startVisualSnapshotSource({
      source_id: sourceId,
      thread_id: threadId,
      room_id: roomId,
      source_surface: "browser_tab",
      capture_mode: "interval",
      status: "active",
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "Draft a MicroDeck preset for a visual automation scenario that chooses between preparing a tool call, appending a wake-bound Ask contract, or asking the operator for confirmation.",
        sessionId: `${threadId}:microdeck-draft`,
        debug: true,
      })
      .expect(200);

    const iterations = Array.isArray(response.body?.agent_runtime_loop?.iterations)
      ? response.body.agent_runtime_loop.iterations
      : [];
    const executedCapabilities = iterations.flatMap((iteration: any) => [
      iteration?.chosen_capability,
      iteration?.executed_action_key,
      iteration?.tool_observation?.tool_name,
    ]).filter(Boolean);
    const responseText = JSON.stringify(response.body);
    const routeDebug = JSON.stringify({
      selectedTool: response.body?.selected_tool,
      selectedCapability: response.body?.selected_capability,
      lifecycle: response.body?.tool_lifecycle_trace,
      phase: response.body?.live_source_turn_phase_resolution,
      mandatory: response.body?.mandatory_next_tool,
      iterations: iterations.map((iteration: any) => ({
        chosen_capability: iteration?.chosen_capability,
        executed_action_key: iteration?.executed_action_key,
        observation_role: iteration?.observation_role,
        tool_name: iteration?.tool_observation?.tool_name,
      })),
      answer: response.body?.answer,
    }, null, 2);

    expect(response.body?.live_source_turn_phase_resolution, routeDebug).toMatchObject({
      phase: "query_micro_reasoner_deck",
      allowedTools: ["live_env.draft_micro_reasoner_preset"],
      fallbackTools: [],
      requiredEvidence: ["stage_play_micro_reasoner_prompt_preset_draft"],
      completionEvidence: ["stage_play_micro_reasoner_prompt_preset_draft"],
    });
    expect(response.body?.mandatory_next_tool, routeDebug).toMatchObject({
      tool_name: "live_env.draft_micro_reasoner_preset",
      allowed_tools: ["live_env.draft_micro_reasoner_preset"],
      terminal_forbidden: true,
    });
    expect(executedCapabilities, routeDebug).toContain("live_env.draft_micro_reasoner_preset");
    expect(executedCapabilities, routeDebug).not.toContain("live_env.read_processed_live_source_mail");
    expect(executedCapabilities, routeDebug).not.toContain("live_env.process_live_source_mail");
    expect(responseText, routeDebug).toContain("stage_play_micro_reasoner_prompt_preset_draft/v1");
    expect(response.body?.selected_tool, routeDebug).toBe("live_env.draft_micro_reasoner_preset");
    expect(response.body?.selected_tool, routeDebug).toBe(response.body?.selected_capability);
    expect(response.body?.tool_lifecycle_trace, routeDebug).toMatchObject({
      requested_capability: "live_env.draft_micro_reasoner_preset",
      admitted_capability: "live_env.draft_micro_reasoner_preset",
      executed_capability: "live_env.draft_micro_reasoner_preset",
    });
  }, 60_000);

  it("executes MicroDeck prompt routing as a delegation observation without processed-mail tools", async () => {
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "live_env.route_micro_reasoner_prompt",
        reason: "Route the candidate prompts from the live-source summary.",
        args: {
          source_id: sourceId,
          source_summary: "The visual source shows a calculator workflow with a multiplication result and a tool-call shaped expression.",
          candidate_prompts: [
            {
              candidateId: "tool_call",
              title: "Calculator tool call",
              promptText: "Create a calculator tool call when the live source shows equations, arithmetic, multiplication, or a computed result.",
            },
            {
              candidateId: "combat",
              title: "Minecraft combat",
              promptText: "Assess hostile mobs, damage, weapons, armor, and urgent survival risk in Minecraft.",
            },
            {
              candidateId: "ui_navigation",
              title: "Browser navigation",
              promptText: "Identify page navigation, menus, forms, tabs, and browser workflow blockers.",
            },
          ],
          confidence_threshold: 0.2,
          escalation_mode: "handoff_only_if_confident",
          allow_none: true,
        },
        expected_artifacts: ["stage_play_micro_reasoner_prompt_delegation_result"],
        confidence: 0.91,
      },
      {
        next_step: "answer",
        chosen_capability: "model.direct_answer",
        reason: "Summarize the delegation receipt after observation re-entry.",
        args: {},
        expected_artifacts: ["model_synthesized_answer"],
        confidence: 0.8,
      },
    ]);

    startVisualSnapshotSource({
      source_id: sourceId,
      thread_id: threadId,
      room_id: roomId,
      source_surface: "browser_tab",
      capture_mode: "interval",
      status: "active",
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "Use the MicroDeck prompt router to choose one of these three candidate prompts for the current live-source summary.",
        sessionId: `${threadId}:microdeck-prompt-router`,
        debug: true,
      })
      .expect(200);

    const iterations = Array.isArray(response.body?.agent_runtime_loop?.iterations)
      ? response.body.agent_runtime_loop.iterations
      : [];
    const executedCapabilities = iterations.flatMap((iteration: any) => [
      iteration?.chosen_capability,
      iteration?.executed_action_key,
      iteration?.tool_observation?.tool_name,
    ]).filter(Boolean);
    const responseText = JSON.stringify(response.body);
    const routeDebug = JSON.stringify({
      selectedTool: response.body?.selected_tool,
      selectedCapability: response.body?.selected_capability,
      lifecycle: response.body?.tool_lifecycle_trace,
      sourceTarget: response.body?.source_target_intent,
      iterations: iterations.map((iteration: any) => ({
        chosen_capability: iteration?.chosen_capability,
        executed_action_key: iteration?.executed_action_key,
        observation_role: iteration?.observation_role,
        tool_name: iteration?.tool_observation?.tool_name,
      })),
      answer: response.body?.answer,
    }, null, 2);

    expect(executedCapabilities, routeDebug).toContain("live_env.route_micro_reasoner_prompt");
    expect(executedCapabilities, routeDebug).not.toContain("live_env.read_processed_live_source_mail");
    expect(executedCapabilities, routeDebug).not.toContain("live_env.process_live_source_mail");
    expect(responseText, routeDebug)
      .toContain("stage_play_micro_reasoner_prompt_delegation_result/v1");
    expect(responseText, routeDebug)
      .toContain("tool_call");
    expect(response.body?.selected_tool, routeDebug).toBe("live_env.route_micro_reasoner_prompt");
    expect(response.body?.selected_tool, routeDebug).toBe(response.body?.selected_capability);
    expect(response.body?.tool_lifecycle_trace, routeDebug).toMatchObject({
      requested_capability: "live_env.route_micro_reasoner_prompt",
      admitted_capability: "live_env.route_micro_reasoner_prompt",
      executed_capability: "live_env.route_micro_reasoner_prompt",
    });
  }, 60_000);

  it("keeps interpreter profile setup on configure_interpreter_profile without reading mail", async () => {
    startVisualSnapshotSource({
      source_id: sourceId,
      thread_id: threadId,
      room_id: roomId,
      source_surface: "browser_tab",
      capture_mode: "interval",
      status: "active",
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "Create a Minecraft Survival Coach interpreter profile for this source.",
        sessionId: `${threadId}:profile-setup-no-mail-read`,
        debug: true,
      })
      .expect(200);

    const executedCapabilities =
      response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability) ?? [];
    const routeDebug = JSON.stringify({
      route: response.body?.route_reason_code,
      sourceTarget: response.body?.source_target_intent,
      canonical: response.body?.canonical_goal_frame,
      available: response.body?.available_capabilities,
      phase: response.body?.live_source_turn_phase_resolution,
      mandatory: response.body?.mandatory_next_tool,
      admission: response.body?.agent_runtime_loop_admission,
      loop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
    }, null, 2);

    expect(response.body?.available_capabilities?.recommended_capability_key, routeDebug)
      .toBe("live_env.configure_interpreter_profile");
    expect(response.body?.mandatory_next_tool?.tool_name, routeDebug)
      .toBe("live_env.configure_interpreter_profile");
    expect(response.body?.agent_runtime_loop_admission, routeDebug).toMatchObject({
      admitted: true,
      mode: "execute_or_record",
    });
    expect(executedCapabilities, routeDebug).toContain("live_env.configure_interpreter_profile");
    expect(executedCapabilities, routeDebug).not.toContain("live_env.read_processed_live_source_mail");
    expect(executedCapabilities, routeDebug).not.toContain("live_env.read_live_source_mail");
    expect(executedCapabilities, routeDebug).not.toContain("live_env.process_live_source_mail");
    expect(response.body?.stage_play_live_source_mailbox_debug?.executed_capabilities_seen ?? [], routeDebug)
      .not.toEqual(expect.arrayContaining(["live_env.read_processed_live_source_mail"]));
  }, 60_000);

  it("does not let hard mailbox wake metadata skip execution behind stale pending input", async () => {
    const app = createApp();
    const sessionId = `${threadId}:hard-mailbox-pending-supersede`;
    const pending = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open the panel",
        sessionId,
        debug: true,
      })
      .expect(200);
    expect(pending.body?.pending_server_request, JSON.stringify(pending.body, null, 2)).toBeTruthy();

    const wakeRequestId = "stage_play_live_source_mail_wake:test-hard-route-pending";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Review the latest Stage Play live-source mailbox finding.",
        sessionId,
        debug: true,
        route_metadata: {
          invocationKind: "stage_play_mail_wake",
          wakeRequestId,
          mailboxThreadId: sessionId,
          sourceTarget: "live_source_mailbox",
          requiredCanonicalGoal: "processed_mail_voice_decision",
          requiredPhase: "record_decision",
          allowedCapabilities: [
            "live_env.record_live_source_mail_decision",
          ],
          forbiddenCapabilities: [
            "workspace_os.status",
            "internet-search.search_web",
            "docs-viewer.open",
          ],
          evidenceRefs: ["stage_play_processed_mail_packet:test-hard-route-pending"],
        },
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      route: response.body?.route_reason_code,
      canonical: response.body?.canonical_goal_frame,
      phase: response.body?.live_source_turn_phase_resolution,
      mandatory: response.body?.mandatory_next_tool,
      admission: response.body?.agent_runtime_loop_admission,
      loop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
    }, null, 2);

    expect(response.body?.source_target_intent?.target_source, routeDebug).toBe("live_source_mailbox");
    expect(response.body?.agent_runtime_loop_admission, routeDebug).toMatchObject({
      admitted: true,
      mode: "execute_or_record",
    });
    expect(response.body?.agent_runtime_loop_admission?.reason, routeDebug).not.toBe("pending_user_input");
    expect(response.body?.route_reason_code, routeDebug).not.toBe("clarify:missing_args");
    expect(response.body?.mandatory_next_tool?.tool_name, routeDebug).toBe("live_env.read_processed_live_source_mail");
    expect(response.body?.agent_runtime_loop?.executed_tool_call_count ?? 0, routeDebug).toBeGreaterThan(0);
  }, 60_000);

  it("routes visual watch prompts to watch-job policy configuration without reading mail", async () => {
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
      frame_id: "visual_frame:stage-play-mail-route",
      ts: "2026-06-04T16:30:00.000Z",
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: frame.frame_id,
      evidence_id: "visual_evidence:stage-play-mail-route",
      summary: "Minecraft-like scene with a player near a cat, book stand, and distant mountains.",
      supports_claims: [
        {
          claim: "The active visual source has compact evidence.",
          support_status: "supports",
          confidence: 0.82,
        },
      ],
    });

    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Watch this visual source and tell me if anything important happens.",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      route: response.body?.route_reason_code,
      canonical: response.body?.canonical_goal_frame,
      terminalContract: response.body?.goal_satisfaction_evaluation?.terminal_contract,
      runtimeLoop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
      currentTurnArtifactKinds: response.body?.current_turn_artifact_ledger?.map((artifact: any) => artifact?.kind),
    }, null, 2);

    expect(response.body?.canonical_goal_frame, routeDebug).toMatchObject({
      goal_kind: "live_environment_review",
      required_terminal_kind: "model_synthesized_answer",
    });
    expect(response.body?.canonical_goal_frame?.classifier_reasons, routeDebug).toEqual(expect.arrayContaining([
      "live_source_mail_loop_intent",
      "live_source_watch_job_setup_intent",
      "prefer_configure_live_source_watch_job",
    ]));
    expect(response.body?.canonical_goal_frame?.classifier_reasons ?? [], routeDebug).not.toContain("prefer_read_live_source_mail");
    expect(response.body?.source_target_intent, routeDebug).toMatchObject({
      target_source: "live_source_mailbox",
      target_kind: "live_source_mailbox",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.available_capabilities?.recommended_capability_key, routeDebug).toBe("live_env.configure_live_source_watch_job");
    expect(response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability), routeDebug)
      .toContain("live_env.configure_live_source_watch_job");
    expect(response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability) ?? [], routeDebug)
      .not.toContain("live_env.read_live_source_mail");
    expect(response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability) ?? [], routeDebug)
      .not.toContain("live_env.record_live_source_mail_decision");
    const liveToolArtifacts = response.body?.current_turn_artifact_ledger
      ?.filter((artifact: any) => artifact?.kind === "live_environment_tool_observation")
      ?? [];
    const policyArtifact = liveToolArtifacts.find((artifact: any) =>
      artifact?.payload?.tool_name === "live_env.configure_live_source_watch_job"
    );
    expect(policyArtifact?.payload?.observation, routeDebug).toMatchObject({
      artifactId: "stage_play_live_source_watch_job_policy_config_result",
      watchJobPolicyRef: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
      policy: {
        objectiveText: "Watch this visual source and tell me if anything important happens.",
        decisionPolicyPrompt: expect.stringContaining("If there is no meaningful user-facing change, record wait_for_next_summary."),
        outputPolicy: {
          allowTextAnswer: true,
          allowVoiceCallout: false,
          voiceRequiresUrgency: true,
          confirmationRequired: true,
        },
        importanceCriteria: [
          "Risk, actor/object change, or a user-mentioned target appearing should produce a user-facing decision.",
        ],
        suppressCriteria: [
          "If no meaningful user-facing change is present, record wait_for_next_summary.",
        ],
        assistant_answer: false,
        terminal_eligible: false,
      },
      jobState: {
        watchJobPolicyRef: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
        nextLoopState: "armed_for_next_summary",
      },
    });
    expect(response.body?.terminal_artifact_kind, routeDebug).not.toBe("stage_play_live_source_mail_read_result");
    expect(response.body?.agent_runtime_loop?.iterations?.[0]?.satisfaction, routeDebug).toBe("satisfied");
    expect(response.body?.solver_controller_decision?.blocking_reasons ?? [], routeDebug).not.toContain("terminal_route_mismatch");
    expect(response.body?.answer, routeDebug).not.toContain("visual evidence is unavailable");
    expect(response.body?.answer, routeDebug).not.toContain("visual capture evidence is unavailable");
    expect(response.body?.answer, routeDebug).not.toContain("wait_for_next_summary");
    expect(response.body?.answer, routeDebug).not.toContain("one unread live-source mail item requiring a decision");

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(response.body.turn_id)}/debug-export`)
      .expect(200);
    expect(debugExport.body?.payload?.source_target_intent, routeDebug).toMatchObject({
      target_source: "live_source_mailbox",
      target_kind: "live_source_mailbox",
    });
    expect(debugExport.body?.payload?.stage_play_live_source_mailbox_debug, routeDebug).toMatchObject({
      route_admission: expect.objectContaining({
        status: "won",
        reason: expect.stringMatching(/mail/i),
      }),
      source_target_intent: expect.objectContaining({
        target_source: "live_source_mailbox",
        target_kind: "live_source_mailbox",
      }),
      capability: "live_env.configure_live_source_watch_job",
      ask_turn_id: response.body?.turn_id,
      watch_job_policy_ref: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
    });
    expect(debugExport.body?.payload?.evidence_target_arbitration, routeDebug).toMatchObject({
      selected_target_source: "live_source_mailbox",
      selected_target_kind: "live_source_mailbox",
    });
  }, 30_000);

  it("configures visual watch-job policy without reading mail when the user gives a standing watch objective", async () => {
    const question = "Watch the active visual source and describe each new mail batch in one sentence.";
    const expectedObjective = "Watch the active visual source and describe each new visual-summary mail batch in one sentence.";
    process.env.HELIX_POST_OBSERVATION_COMPOSER_TEST_RESPONSE =
      "The active visual live-source mailbox has been checked, and there are currently no new mail batches to describe.";

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question,
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      canonical: response.body?.canonical_goal_frame,
      availableCapabilities: response.body?.available_capabilities,
      runtimeLoop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
      currentTurnArtifacts: response.body?.current_turn_artifact_ledger,
    }, null, 2);

    expect(response.body?.canonical_goal_frame, routeDebug).toMatchObject({
      goal_kind: "live_environment_review",
      required_terminal_kind: "model_synthesized_answer",
    });
    expect(response.body?.canonical_goal_frame?.classifier_reasons, routeDebug).toEqual(expect.arrayContaining([
      "live_source_mail_loop_intent",
      "live_source_watch_job_setup_intent",
      "prefer_configure_live_source_watch_job",
    ]));
    expect(response.body?.canonical_goal_frame?.classifier_reasons ?? [], routeDebug).not.toContain("prefer_read_live_source_mail");
    expect(response.body?.available_capabilities?.recommended_capability_key, routeDebug).toBe("live_env.configure_live_source_watch_job");
    const chosenCapabilities = response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability) ?? [];
    expect(chosenCapabilities, routeDebug).toContain("live_env.configure_live_source_watch_job");
    expect(chosenCapabilities, routeDebug).not.toContain("live_env.read_live_source_mail");
    expect(chosenCapabilities, routeDebug).not.toContain("live_env.record_live_source_mail_decision");
    expect(response.body?.agent_runtime_loop?.stop_reason, routeDebug).not.toBe("budget_exhausted");
    expect(response.body?.terminal_error_code, routeDebug).not.toBe("agent_loop_budget_exhausted");

    const liveToolArtifact = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "live_environment_tool_observation" &&
      artifact?.payload?.tool_name === "live_env.configure_live_source_watch_job"
    );
    expect(liveToolArtifact?.payload?.observation, routeDebug).toMatchObject({
      artifactId: "stage_play_live_source_watch_job_policy_config_result",
      schema: "stage_play_live_source_watch_job_policy_config_result/v1",
      schemaVersion: "stage_play_live_source_watch_job_policy_config_result/v1",
      watchJobPolicyRef: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
      watch_job_policy_ref: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
      policyCount: expect.any(Number),
      policy: {
        objectiveText: expectedObjective,
        interpretationMode: "latest_scene_answer",
        decisionPolicyPrompt: [
          "For each unread mail batch, read the listed mail refs as the current observation window.",
          "If the mail batch contains any compact visual summary, record draft_text_answer.",
          "The textAnswerDraft must be one sentence describing what was observed.",
          "If the batch is empty, record wait_for_next_summary.",
          "Do not claim visual evidence is unavailable when mail refs or compact summaries exist.",
          "After recording the decision, set nextLoopState to armed_for_next_summary.",
        ].join("\n"),
        outputPolicy: {
          allowTextAnswer: true,
          allowVoiceCallout: false,
          voiceRequiresUrgency: true,
          confirmationRequired: true,
        },
        importanceCriteria: [
          "Any new visual-summary mail batch should produce a one-sentence text answer.",
        ],
        suppressCriteria: [
          "Suppress only if no unread mail items exist or mail lacks compact summary text.",
        ],
        assistant_answer: false,
        terminal_eligible: false,
      },
      jobState: {
        objective: expectedObjective,
        watchJobPolicyRef: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
        nextLoopState: "armed_for_next_summary",
      },
      transcriptRows: [
        expect.objectContaining({
          rowKind: "loop_state",
          title: "Watch job configured",
        }),
        expect.objectContaining({
          rowKind: "loop_state",
          title: "Objective",
          body: `Objective: ${expectedObjective}`,
        }),
        expect.objectContaining({
          rowKind: "loop_state",
          title: "Source",
          body: "Source: all active live sources",
        }),
        expect.objectContaining({
          rowKind: "loop_state",
          title: "Policy",
          body: expect.stringContaining("text answer allowed"),
        }),
        expect.objectContaining({
          rowKind: "loop_state",
          title: "Loop state",
          body: "Loop state: armed for next summary.",
        }),
      ],
    });
    expect(response.body?.answer, routeDebug).not.toContain("Reviewed");
    expect(response.body?.answer, routeDebug).not.toContain("latest unread source update");
    expect(response.body?.answer, routeDebug).not.toContain("wait_for_next_summary");
    expect(response.body?.answer, routeDebug).toContain("Watch job configured and armed");
    expect(response.body?.answer, routeDebug).toContain("No live-source mail was interpreted in this setup turn");
    expect(response.body?.answer, routeDebug).toContain(expectedObjective);
    expect(response.body?.answer, routeDebug).not.toContain("mailbox has been checked");
    expect(response.body?.answer, routeDebug).not.toContain("no new mail batches");

    const debugExport = await request(createApp())
      .get(`/api/agi/ask/turn/${encodeURIComponent(response.body.turn_id)}/debug-export`)
      .expect(200);
    const exportedObservation = debugExport.body?.payload?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "live_environment_tool_observation" &&
      artifact?.payload?.tool_name === "live_env.configure_live_source_watch_job"
    );
    expect(exportedObservation?.payload?.observation?.watchJobPolicyRef, routeDebug).toMatch(/^stage_play_live_source_watch_job_policy:/);
    expect(exportedObservation?.payload?.observation?.watch_job_policy_ref, routeDebug).toMatch(/^stage_play_live_source_watch_job_policy:/);
  }, 30_000);

  it("configures a prediction-watch policy for natural interpret/watch-next mail loop wording", async () => {
    const question = "Watch the active visual source and interpret each new visual mail batch. Say what changed and what should be watched next.";
    process.env.HELIX_POST_OBSERVATION_COMPOSER_TEST_RESPONSE =
      "Watch job configured and armed; no mail read yet.";

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question,
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      canonical: response.body?.canonical_goal_frame,
      availableCapabilities: response.body?.available_capabilities,
      runtimeLoop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
      currentTurnArtifacts: response.body?.current_turn_artifact_ledger,
    }, null, 2);

    expect(isLiveSourceMailLoopPrompt(question)).toBe(true);
    expect(response.body?.canonical_goal_frame?.classifier_reasons, routeDebug).toEqual(expect.arrayContaining([
      "live_source_mail_loop_intent",
      "live_source_watch_job_setup_intent",
      "prefer_configure_live_source_watch_job",
    ]));
    expect(response.body?.canonical_goal_frame?.classifier_reasons ?? [], routeDebug).not.toContain("prefer_read_live_source_mail");
    expect(response.body?.available_capabilities?.recommended_capability_key, routeDebug).toBe("live_env.configure_live_source_watch_job");
    const chosenCapabilities = response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability) ?? [];
    expect(chosenCapabilities, routeDebug).toContain("live_env.configure_live_source_watch_job");
    expect(chosenCapabilities, routeDebug).not.toContain("live_env.read_live_source_mail");

    const liveToolArtifact = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "live_environment_tool_observation" &&
      artifact?.payload?.tool_name === "live_env.configure_live_source_watch_job"
    );
    expect(liveToolArtifact?.payload?.observation, routeDebug).toMatchObject({
      artifactId: "stage_play_live_source_watch_job_policy_config_result",
      watchJobPolicyRef: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
      policy: {
        objectiveText: question,
        interpretationMode: "prediction_watch",
        mailProcessingMode: "chronological_batch",
        outputCadence: "only_salient",
        decisionPolicyPrompt: expect.stringContaining("record the decision record_interpretation"),
      },
      jobState: {
        objective: question,
        watchJobPolicyRef: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
        nextLoopState: "armed_for_next_summary",
      },
    });
    expect(response.body?.answer, routeDebug).toContain("Watch job configured and armed");
    expect(response.body?.answer, routeDebug).toContain("No live-source mail was interpreted in this setup turn");
    expect(response.body?.answer, routeDebug).not.toContain("Reviewed");
    expect(response.body?.answer, routeDebug).not.toContain("latest unread source update");
  }, 30_000);

  it("forces policy configuration when the model tries to read mail during standing watch setup", async () => {
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "live_env.read_live_source_mail",
        reason: "Incorrectly try to read current mail before storing the standing policy.",
        args: {},
        expected_artifacts: ["stage_play_live_source_mail_read_result"],
        confidence: 0.91,
      },
      {
        next_step: "answer",
        chosen_capability: "model.direct_answer",
        reason: "Answer after the policy receipt.",
        args: {},
        expected_artifacts: ["model_synthesized_answer"],
        confidence: 0.8,
      },
    ]);

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
      frame_id: "visual_frame:standing-watch-wrong-read",
      ts: "2026-06-04T16:30:30.000Z",
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: frame.frame_id,
      evidence_id: "visual_evidence:standing-watch-wrong-read",
      summary: "Minecraft-like scene with stable terrain and no urgent change.",
      supports_claims: [
        {
          claim: "The active visual source has compact evidence.",
          support_status: "supports",
          confidence: 0.81,
        },
      ],
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "Watch the active visual source and describe each new mail batch in one sentence.",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      canonical: response.body?.canonical_goal_frame,
      runtimeLoop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
      artifacts: response.body?.current_turn_artifact_ledger,
    }, null, 2);
    const chosenCapabilities = response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability) ?? [];

    expect(response.body?.canonical_goal_frame?.classifier_reasons, routeDebug).toContain("prefer_configure_live_source_watch_job");
    expect(chosenCapabilities, routeDebug).toContain("live_env.configure_live_source_watch_job");
    expect(chosenCapabilities, routeDebug).not.toContain("live_env.read_live_source_mail");
    expect(chosenCapabilities, routeDebug).not.toContain("live_env.record_live_source_mail_decision");
    const liveToolArtifacts = response.body?.current_turn_artifact_ledger
      ?.filter((artifact: any) => artifact?.kind === "live_environment_tool_observation")
      ?? [];
    expect(liveToolArtifacts.map((artifact: any) => artifact?.payload?.tool_name), routeDebug)
      .toEqual(["live_env.configure_live_source_watch_job"]);
    expect(response.body?.answer, routeDebug).not.toContain("Three unread live-source mail items");
    expect(response.body?.answer, routeDebug).not.toContain("decision is required");
    expect(response.body?.answer, routeDebug).toContain("Watch job configured and armed");
    expect(response.body?.answer, routeDebug).toContain("No live-source mail was interpreted in this setup turn");
    expect(response.body?.answer, routeDebug).not.toMatch(/\bno\s+(?:mail|live-source\s+updates?)\s+(?:was|were)?\s*(?:available|found)\b/i);
    expect(response.body?.solver_controller_decision?.decision, routeDebug).toBe("allow_terminal");
    expect(response.body?.solver_controller_decision?.blocking_reasons ?? [], routeDebug).toEqual([]);
    expect(response.body?.goal_satisfaction_evaluation, routeDebug).toMatchObject({
      satisfaction: "satisfied",
      next_decision: "allow_terminal",
      reason: "watch_job_policy_receipt_satisfies_setup_turn",
    });
    expect(response.body?.terminal_equivalence_harness_result?.ok, routeDebug).toBe(true);
  }, 30_000);

  it("lets hard live-source mailbox watch setup supersede unrelated pending user input", async () => {
    const app = createApp();
    const sessionId = `${threadId}:pending-supersede`;

    const pending = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open the panel",
        mode: "read",
        sessionId,
        debug: true,
      })
      .expect(200);
    expect(pending.body?.pending_server_request, JSON.stringify(pending.body, null, 2)).toBeTruthy();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Watch the active visual source and describe each new mail batch in one sentence.",
        sessionId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      canonical: response.body?.canonical_goal_frame,
      runtimeLoop: response.body?.agent_runtime_loop,
      admission: response.body?.agent_runtime_loop_admission,
      answer: response.body?.answer,
      pending: response.body?.pending_server_request,
      stalePending: response.body?.stale_pending_server_request,
      mailbox: response.body?.stage_play_live_source_mailbox_debug,
    }, null, 2);
    const chosenCapabilities = response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability) ?? [];

    expect(response.body?.canonical_goal_frame?.classifier_reasons, routeDebug).toContain("prefer_configure_live_source_watch_job");
    expect(response.body?.route_reason_code, routeDebug).not.toBe("clarify:missing_args");
    expect(response.body?.pending_server_request ?? null, routeDebug).toBeNull();
    expect(response.body?.agent_runtime_loop_admission?.admitted, routeDebug).toBe(true);
    expect(response.body?.agent_runtime_loop_admission?.reason, routeDebug).not.toBe("pending_user_input");
    expect(chosenCapabilities, routeDebug).toContain("live_env.configure_live_source_watch_job");
    expect(response.body?.stage_play_live_source_mailbox_debug, routeDebug).toMatchObject({
      capability: "live_env.configure_live_source_watch_job",
      executed_capabilities_seen: expect.arrayContaining(["live_env.configure_live_source_watch_job"]),
    });
    expect(response.body?.answer, routeDebug).toContain("Watch job configured and armed");
    expect(response.body?.answer, routeDebug).toContain("No live-source mail was interpreted in this setup turn");
    expect(response.body?.answer, routeDebug).not.toMatch(/active_doc_path|missing artifact|Provide the missing artifact/i);
    expect(response.body?.solver_controller_decision?.decision, routeDebug).toBe("allow_terminal");
    expect(response.body?.solver_controller_decision?.blocking_reasons ?? [], routeDebug).toEqual([]);
    expect(response.body?.terminal_equivalence_harness_result?.ok, routeDebug).toBe(true);
  }, 30_000);

  it("routes explicit live-source mail wake prompts through the mailbox loop", async () => {
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
      frame_id: "visual_frame:stage-play-mail-wake-route",
      ts: "2026-06-04T16:31:00.000Z",
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: frame.frame_id,
      evidence_id: "visual_evidence:stage-play-mail-wake-route",
      summary: "Minecraft-like scene with a player HUD and stable terrain.",
      supports_claims: [
        {
          claim: "The active visual source has compact evidence.",
          support_status: "supports",
          confidence: 0.8,
        },
      ],
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: [
          "Read the active live-source mailbox and decide what to do with the latest unread source update.",
          "Use live_env.read_live_source_mail first, then record the decision with live_env.record_live_source_mail_decision.",
          "Wake request: stage_play_live_source_mail_wake:test",
          "Mail refs: stage_play_live_source_mail:test",
          `Source refs: ${sourceId}`,
        ].join("\n"),
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      route: response.body?.route_reason_code,
      canonical: response.body?.canonical_goal_frame,
      runtimeLoop: response.body?.agent_runtime_loop,
      terminal: response.body?.terminal_artifact_kind,
      answer: response.body?.answer,
    }, null, 2);

    expect(response.body?.route_reason_code, routeDebug).not.toBe("live_pipeline_control");
    expect(response.body?.terminal_artifact_kind, routeDebug).not.toBe("live_pipeline_receipt");
    expect(response.body?.canonical_goal_frame, routeDebug).toMatchObject({
      goal_kind: "live_environment_review",
      required_terminal_kind: "model_synthesized_answer",
    });
    expect(response.body?.canonical_goal_frame?.classifier_reasons, routeDebug).toContain("prefer_read_live_source_mail");
    expect(response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability), routeDebug)
      .toEqual(expect.arrayContaining([
        "live_env.read_processed_live_source_mail",
        "live_env.record_live_source_mail_decision",
      ]));
    const liveToolArtifacts = response.body?.current_turn_artifact_ledger
      ?.filter((artifact: any) => artifact?.kind === "live_environment_tool_observation")
      ?? [];
    const decisionArtifact = liveToolArtifacts.find((artifact: any) =>
      artifact?.payload?.tool_name === "live_env.record_live_source_mail_decision"
    );
    expect(decisionArtifact?.payload?.observation, routeDebug).toMatchObject({
      artifactId: "stage_play_live_source_mail_decision",
    });
    expect(response.body?.stage_play_live_source_mailbox_debug, routeDebug).toMatchObject({
      route_admission: expect.objectContaining({
        status: "won",
        selected_target_source: "live_source_mailbox",
      }),
      capability: "live_env.read_processed_live_source_mail",
      wake_request_id: "stage_play_live_source_mail_wake:test",
      wake_request_ids: expect.arrayContaining(["stage_play_live_source_mail_wake:test"]),
      mail_ids: expect.arrayContaining(["stage_play_live_source_mail:test"]),
      ask_turn_id: response.body?.turn_id,
      decision_ids: expect.arrayContaining([decisionArtifact?.payload?.observation?.decisionId]),
    });
  }, 30_000);

  it("forces a draft_text_answer decision after reading mail for a describe-each-batch policy", async () => {
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "live_env.read_live_source_mail",
        reason: "Read the mailbox batch.",
        args: {},
        expected_artifacts: ["stage_play_live_source_mail_read_result"],
        confidence: 0.9,
      },
      {
        next_step: "answer",
        chosen_capability: "model.direct_answer",
        reason: "Incorrectly try to answer before recording the mail decision.",
        args: {},
        expected_artifacts: ["model_synthesized_answer"],
        confidence: 0.8,
      },
    ]);
    configureStagePlayLiveSourceWatchJobPolicy({
      threadId,
      sourceIds: [sourceId],
      objectiveText: "Watch the active visual source and describe each new visual-summary mail batch in one sentence.",
      decisionPolicyPrompt: [
        "For each unread mail batch, read the listed mail refs as the current observation window.",
        "If the mail batch contains any compact visual summary, record draft_text_answer.",
        "The textAnswerDraft must be one sentence describing what was observed.",
      ].join("\n"),
      outputPolicy: {
        allowTextAnswer: true,
        allowVoiceCallout: false,
        voiceRequiresUrgency: true,
        confirmationRequired: true,
      },
      importanceCriteria: ["Any new visual-summary mail batch should produce a one-sentence text answer."],
      suppressCriteria: ["Suppress only if no unread mail items exist or mail lacks compact summary text."],
    });
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
      frame_id: "visual_frame:describe-policy-read",
      ts: "2026-06-04T16:31:30.000Z",
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: frame.frame_id,
      evidence_id: "visual_evidence:describe-policy-read",
      summary: "Minecraft-like scene with a player near a book stand, a cat, and moonlit mountains.",
      supports_claims: [
        {
          claim: "The active visual source has compact evidence.",
          support_status: "supports",
          confidence: 0.84,
        },
      ],
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "Check the active visual live-source mailbox now. Read the latest visual summary mail and record the decision.",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      canonical: response.body?.canonical_goal_frame,
      runtimeLoop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
      artifacts: response.body?.current_turn_artifact_ledger,
    }, null, 2);
    const chosenCapabilities = response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability) ?? [];
    expect(chosenCapabilities, routeDebug).toEqual(expect.arrayContaining([
      "live_env.read_live_source_mail",
      "live_env.record_live_source_mail_decision",
    ]));
    const decisionArtifact = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "live_environment_tool_observation" &&
      artifact?.payload?.tool_name === "live_env.record_live_source_mail_decision"
    );
    expect(decisionArtifact?.payload?.observation, routeDebug).toMatchObject({
      artifactId: "stage_play_live_source_mail_decision",
      decision: "draft_text_answer",
      textAnswerDraft: {
        text: expect.stringContaining("Minecraft-like scene with a player near a book stand"),
        terminalEligible: true,
      },
      nextLoopState: "armed_for_next_summary",
    });
    expect(response.body?.answer, routeDebug).not.toContain("decision is required");
    expect(response.body?.answer, routeDebug).toContain("Minecraft-like scene with a player near a book stand");
    expect(response.body?.answer, routeDebug).not.toContain("Live-source mail decision recorded");
    expect(response.body?.answer, routeDebug).not.toContain("draft_text_answer");
    expect(response.body?.answer, routeDebug).not.toContain("wait_for_next_summary");
  }, 30_000);

  it("forces a text draft after a one-shot mailbox read prompt asks what the latest mail shows", async () => {
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "live_env.read_live_source_mail",
        reason: "Read the latest mailbox items.",
        args: {},
        expected_artifacts: ["stage_play_live_source_mail_read_result"],
        confidence: 0.9,
      },
      {
        next_step: "next_action",
        chosen_capability: "live_env.record_live_source_mail_decision",
        reason: "Incorrectly wait after the read.",
        args: {
          decision: "wait_for_next_summary",
          rationale_preview: "No user-facing callout was selected.",
          next_loop_state: "armed_for_next_summary",
        },
        expected_artifacts: ["stage_play_live_source_mail_decision"],
        confidence: 0.8,
      },
    ]);
    process.env.HELIX_POST_OBSERVATION_COMPOSER_TEST_RESPONSE =
      "The latest visual summary mail indicates that there are three unread items requiring a decision.";

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
      frame_id: "visual_frame:one-shot-mail-answer",
      ts: "2026-06-04T16:32:30.000Z",
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: frame.frame_id,
      evidence_id: "visual_evidence:one-shot-mail-answer",
      summary: "A dark app-launcher interface with Google Docs, Gmail, Drive, YouTube, and Instagram icons.",
      supports_claims: [
        {
          claim: "The latest mailbox item includes compact visual summary text.",
          support_status: "supports",
          confidence: 0.9,
        },
      ],
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "Check the active visual live-source mailbox now. Use live_env.read_live_source_mail to read unread visual-summary mail, then answer in one sentence what the latest mail shows.",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      canonical: response.body?.canonical_goal_frame,
      runtimeLoop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
      mailboxDebug: response.body?.stage_play_live_source_mailbox_debug,
      artifacts: response.body?.current_turn_artifact_ledger,
    }, null, 2);
    const decisionArtifact = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "live_environment_tool_observation" &&
      artifact?.payload?.tool_name === "live_env.record_live_source_mail_decision"
    );
    expect(decisionArtifact?.payload?.observation, routeDebug).toMatchObject({
      artifactId: "stage_play_live_source_mail_decision",
      decision: "draft_text_answer",
      textAnswerDraft: {
        text: expect.stringContaining("dark app-launcher interface"),
        terminalEligible: true,
      },
      nextLoopState: "armed_for_next_summary",
    });
    expect(decisionArtifact?.payload?.observation?.decision_validation_result, routeDebug)
      .toBe("forced_draft_text_answer_for_read_mail_output_intent");
    expect(response.body?.stage_play_live_source_mailbox_debug, routeDebug).toMatchObject({
      live_source_mail_output_intent: expect.objectContaining({
        wantsTextAnswer: true,
        wantsOneSentence: true,
      }),
      decision_validation_result: "forced_draft_text_answer_for_read_mail_output_intent",
      text_answer_draft_present: true,
    });
    expect(response.body?.answer, routeDebug).toContain("dark app-launcher interface");
    expect(response.body?.answer, routeDebug).not.toContain("three unread items requiring a decision");
    expect(response.body?.answer, routeDebug).not.toContain("wait_for_next_summary");
  }, 30_000);

  it("records an interpretation projection when the prompt asks what changed in live-source mail", async () => {
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "live_env.read_live_source_mail",
        reason: "Read the latest mailbox items.",
        args: {},
        expected_artifacts: ["stage_play_live_source_mail_read_result"],
        confidence: 0.9,
      },
      {
        next_step: "next_action",
        chosen_capability: "live_env.record_live_source_mail_decision",
        reason: "Incorrectly wait after the interpretation request.",
        args: {
          decision: "wait_for_next_summary",
          rationale_preview: "No callout selected.",
          next_loop_state: "armed_for_next_summary",
        },
        expected_artifacts: ["stage_play_live_source_mail_decision"],
        confidence: 0.8,
      },
    ]);
    process.env.HELIX_POST_OBSERVATION_COMPOSER_TEST_RESPONSE =
      "Live-source mail decision recorded: wait_for_next_summary.";

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
      frame_id: "visual_frame:mail-interpretation",
      ts: "2026-06-04T16:33:30.000Z",
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: frame.frame_id,
      evidence_id: "visual_evidence:mail-interpretation",
      summary: "A productivity app grid changed to show Docs, Gmail, Drive, YouTube, and Instagram icons on a dark screen.",
      supports_claims: [
        {
          claim: "The latest mailbox item includes compact visual summary text.",
          support_status: "supports",
          confidence: 0.9,
        },
      ],
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "Check the active visual live-source mailbox now. Read the latest visual summary mail, interpret what changed, and say what should be watched next.",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      canonical: response.body?.canonical_goal_frame,
      runtimeLoop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
      mailboxDebug: response.body?.stage_play_live_source_mailbox_debug,
      artifacts: response.body?.current_turn_artifact_ledger,
    }, null, 2);
    const decisionArtifact = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "live_environment_tool_observation" &&
      artifact?.payload?.tool_name === "live_env.record_live_source_mail_decision"
    );
    expect(decisionArtifact?.payload?.observation, routeDebug).toMatchObject({
      artifactId: "stage_play_live_source_mail_decision",
      decision: "record_interpretation",
      nextLoopState: "armed_for_next_summary",
      decision_validation_result: "forced_record_interpretation_for_read_mail_interpretation_intent",
      narrativeState: expect.objectContaining({
        artifactId: "stage_play_live_source_narrative_state",
        currentSceneSummary: expect.stringContaining("productivity app grid"),
        watchNext: expect.objectContaining({
          targets: expect.any(Array),
        }),
      }),
    });
    expect(decisionArtifact?.payload?.observation?.textAnswerDraft, routeDebug).toBeFalsy();
    const narratives = listStagePlayLiveSourceNarrativeStates({ threadId, limit: 5 });
    expect(narratives, routeDebug).toHaveLength(1);
    expect(response.body?.stage_play_live_source_mailbox_debug, routeDebug).toMatchObject({
      live_source_mail_output_intent: expect.objectContaining({
        wantsInterpretation: true,
      }),
      decision_validation_result: "forced_record_interpretation_for_read_mail_interpretation_intent",
      narrative_state_ref: narratives[0].narrativeStateId,
    });
    expect(response.body?.answer, routeDebug).toContain("productivity app grid");
    expect(response.body?.answer, routeDebug).toMatch(/Watch next/i);
    expect(response.body?.answer, routeDebug).toMatch(/Prediction/i);
    expect(response.body?.answer, routeDebug).not.toContain("Interpretation:");
    expect(response.body?.answer, routeDebug).not.toContain("Mail read:");
    expect(response.body?.answer, routeDebug).not.toContain("wait_for_next_summary");
  }, 30_000);

  it("forces interpretation for compare/predict summary prompts after unread mail is read", async () => {
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "live_env.read_live_source_mail",
        reason: "Read the unread summary batch before comparing it.",
        args: {},
        expected_artifacts: ["stage_play_live_source_mail_read_result"],
        confidence: 0.9,
      },
      {
        next_step: "next_action",
        chosen_capability: "live_env.record_live_source_mail_decision",
        reason: "Incorrectly wait after the compare/predict request.",
        args: {
          decision: "wait_for_next_summary",
          rationale_preview: "No callout selected.",
          next_loop_state: "armed_for_next_summary",
        },
        expected_artifacts: ["stage_play_live_source_mail_decision"],
        confidence: 0.8,
      },
    ]);
    process.env.HELIX_POST_OBSERVATION_COMPOSER_TEST_RESPONSE =
      "Live-source mail decision recorded: wait_for_next_summary.";

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
      frame_id: "visual_frame:mail-compare-predict",
      ts: "2026-06-04T16:35:30.000Z",
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: frame.frame_id,
      evidence_id: "visual_evidence:mail-compare-predict",
      summary: "The unread visual summary now shows the app grid replaced by a document editor on a dark desktop.",
      supports_claims: [
        {
          claim: "The latest mailbox item includes compact visual summary text.",
          support_status: "supports",
          confidence: 0.9,
        },
      ],
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "Compare these summaries from the active visual source and predict what might happen next.",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      sourceTarget: response.body?.source_target_intent,
      availableCapabilities: response.body?.available_capabilities,
      answer: response.body?.answer,
      mailboxDebug: response.body?.stage_play_live_source_mailbox_debug,
      artifacts: response.body?.current_turn_artifact_ledger,
    }, null, 2);
    const decisionArtifact = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "live_environment_tool_observation" &&
      artifact?.payload?.tool_name === "live_env.record_live_source_mail_decision"
    );
    expect(response.body?.source_target_intent, routeDebug).toMatchObject({
      target_source: "live_source_mailbox",
      target_kind: "live_source_mailbox",
    });
    expect(response.body?.available_capabilities?.recommended_capability_key, routeDebug).toBe("live_env.read_processed_live_source_mail");
    expect(decisionArtifact?.payload?.observation, routeDebug).toMatchObject({
      artifactId: "stage_play_live_source_mail_decision",
      decision: "record_interpretation",
      nextLoopState: "armed_for_next_summary",
      decision_validation_result: "forced_record_interpretation_for_read_mail_interpretation_intent",
      narrativeState: expect.objectContaining({
        artifactId: "stage_play_live_source_narrative_state",
        prediction: expect.objectContaining({
          horizon: "next_mail",
        }),
      }),
    });
    expect(decisionArtifact?.payload?.observation?.textAnswerDraft, routeDebug).toBeFalsy();
    expect(response.body?.stage_play_live_source_mailbox_debug, routeDebug).toMatchObject({
      live_source_mail_output_intent: expect.objectContaining({
        wantsInterpretation: true,
      }),
      decision_validation_result: "forced_record_interpretation_for_read_mail_interpretation_intent",
    });
    expect(response.body?.answer, routeDebug).toMatch(/document editor|Watch next/i);
    expect(response.body?.answer, routeDebug).toMatch(/Prediction/i);
    expect(response.body?.answer, routeDebug).not.toContain("Mail read:");
    expect(response.body?.answer, routeDebug).not.toContain("wait_for_next_summary");
  }, 30_000);

  it("does not execute mailbox tools from a negated live-source mail mention", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "Do not read live source mail right now; explain conceptually what that mailbox is for.",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      canonical: response.body?.canonical_goal_frame,
      runtimeLoop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
    }, null, 2);

    expect(response.body?.canonical_goal_frame?.classifier_reasons ?? [], routeDebug).not.toContain("prefer_read_live_source_mail");
    expect(response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability) ?? [], routeDebug)
      .not.toContain("live_env.read_live_source_mail");
    expect(response.body?.stage_play_live_source_mailbox_debug, routeDebug).toMatchObject({
      route_admission: expect.objectContaining({
        status: "rejected",
        selected_target_source: expect.any(String),
      }),
      capability: null,
    });
    const debugExport = await request(createApp())
      .get(`/api/agi/ask/turn/${encodeURIComponent(response.body.turn_id)}/debug-export`)
      .expect(200);
    expect(debugExport.body?.payload?.stage_play_live_source_mailbox_debug, routeDebug).toMatchObject({
      route_admission: expect.objectContaining({
        status: "rejected",
        reason: expect.stringMatching(/selected/i),
      }),
      capability: null,
    });
  }, 30_000);

  it.each([
    [
      "future mailbox command",
      "In the future, use live_env.read_live_source_mail when I ask you to watch the mailbox; for now explain what that tool is.",
    ],
    [
      "quoted mailbox command",
      "\"live_env.read_live_source_mail\" is the literal command text I saw; explain what it means without running it.",
    ],
    [
      "screen-visible mailbox command",
      "The screen says \"read live source mail\" on a button. Do not press or execute it; just explain the label.",
    ],
  ])("does not execute mailbox tools from %s", async (_label, question) => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question,
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      canonical: response.body?.canonical_goal_frame,
      sourceTarget: response.body?.source_target_intent,
      mailboxDebug: response.body?.stage_play_live_source_mailbox_debug,
      runtimeLoop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
    }, null, 2);

    const chosenCapabilities = response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability) ?? [];
    expect(chosenCapabilities, routeDebug).not.toContain("live_env.read_live_source_mail");
    expect(chosenCapabilities, routeDebug).not.toContain("live_env.record_live_source_mail_decision");
    expect(response.body?.stage_play_live_source_mailbox_debug?.route_admission?.status, routeDebug).not.toBe("won");

    const debugExport = await request(createApp())
      .get(`/api/agi/ask/turn/${encodeURIComponent(response.body.turn_id)}/debug-export`)
      .expect(200);
    expect(debugExport.body?.payload?.stage_play_live_source_mailbox_debug?.route_admission?.status, routeDebug)
      .not.toBe("won");
  }, 45_000);

  it("routes natural active visual mailbox prompts away from Situation Room visual capture", async () => {
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
      frame_id: "visual_frame:natural-mailbox-route",
      ts: "2026-06-04T16:32:00.000Z",
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: frame.frame_id,
      evidence_id: "visual_evidence:natural-mailbox-route",
      summary: "Cosmic ambient YouTube scene with a planet and star field.",
      supports_claims: [
        {
          claim: "The active visual mailbox has compact evidence.",
          support_status: "supports",
          confidence: 0.82,
        },
      ],
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "Check the active visual live-source mailbox now. Read the latest visual summary mail, record the decision, and wait for next summary if nothing important changed.",
        sessionId: threadId,
        workspace_context_snapshot: {
          visual_context_capability: {
            status: "error",
            evidence_available: false,
            error: "visual capture evidence is unavailable",
          },
        },
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      canonical: response.body?.canonical_goal_frame,
      sourceTarget: response.body?.source_target_intent,
      availableCapabilities: response.body?.available_capabilities,
      runtimeLoop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
      terminalErrorCode: response.body?.terminal_error_code,
    }, null, 2);

    expect(response.body?.canonical_goal_frame?.classifier_reasons, routeDebug).toContain("prefer_read_live_source_mail");
    expect(response.body?.source_target_intent, routeDebug).toMatchObject({
      target_source: "live_source_mailbox",
      target_kind: "live_source_mailbox",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(response.body?.source_target_intent?.requested_outputs, routeDebug).toEqual(expect.arrayContaining([
      "stage_play_live_source_mail_read_result",
      "stage_play_live_source_mail_decision",
    ]));
    expect(response.body?.source_target_intent?.suppressed_routes, routeDebug).toContain("visual_capture_describe");
    expect(response.body?.available_capabilities?.recommended_capability_key, routeDebug).toBe("live_env.read_live_source_mail");
    expect(response.body?.route_reason_code, routeDebug).not.toBe("clarify:missing_args");
    expect(response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability), routeDebug)
      .toEqual(expect.arrayContaining([
        "live_env.read_live_source_mail",
        "live_env.record_live_source_mail_decision",
      ]));
    expect(response.body?.answer, routeDebug).not.toMatch(/visual capture evidence is unavailable|can't inspect the screen/i);
  }, 60_000);

  it("lets explicit observer mailbox wording suppress screen-capture routing", () => {
    const prompt = "Check the observer mailbox for the latest visual summary, not screen capture.";

    expect(isLiveSourceMailLoopPrompt(prompt)).toBe(true);
    const sourceTarget = arbitrateAskSourceTarget({
      turnId: "ask:test-observer-mailbox",
      threadId,
      promptText: prompt,
    });

    expect(sourceTarget).toMatchObject({
      target_source: "live_source_mailbox",
      target_kind: "live_source_mailbox",
      precedence_reason: "explicit_live_source_mail_loop_source_target",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(sourceTarget.suppressed_routes).toContain("visual_capture_describe");
  });

  it.each([
    "keep watching and tell me what is observed",
    "every time a summary comes in, describe it",
    "announce if anything important happens",
    "watch this source and speak if something changes",
    "keep an eye on this",
  ])("treats standing watch wording as live-source mailbox intent: %s", (prompt) => {
    expect(isLiveSourceMailLoopPrompt(prompt)).toBe(true);
    const sourceTarget = arbitrateAskSourceTarget({
      turnId: `ask:test-standing-watch:${prompt}`,
      threadId,
      promptText: prompt,
    });

    expect(sourceTarget).toMatchObject({
      target_source: "live_source_mailbox",
      target_kind: "live_source_mailbox",
      precedence_reason: "explicit_live_source_mail_loop_source_target",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
  });

  it.each([
    "interpret the mail",
    "what is happening across the summaries",
    "compare the unread mail",
    "compare these summaries",
    "record an interpretation for the visual summary mail",
    "summarize the story so far from the observations",
    "what do these observations mean",
    "predict what might happen next from the visual summaries",
    "watch the visual source and say what should be watched next",
  ])("treats live-source interpretation wording as mailbox intent: %s", (prompt) => {
    expect(isLiveSourceMailLoopPrompt(prompt)).toBe(true);
    const sourceTarget = arbitrateAskSourceTarget({
      turnId: `ask:test-mail-interpretation:${prompt}`,
      threadId,
      promptText: prompt,
    });

    expect(sourceTarget).toMatchObject({
      target_source: "live_source_mailbox",
      target_kind: "live_source_mailbox",
      precedence_reason: "explicit_live_source_mail_loop_source_target",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(sourceTarget.requested_outputs).toEqual(expect.arrayContaining([
      "stage_play_live_source_mail_read_result",
      "stage_play_live_source_mail_decision",
    ]));
  });

  it.each([
    "what changed?",
    "predict what might happen next",
    "interpret what is happening",
  ])("does not route generic interpretation wording to mailbox without source context: %s", (prompt) => {
    expect(isLiveSourceMailLoopPrompt(prompt)).toBe(false);
  });

  it("forces a wait decision after a no-mail read instead of repeating the read tool", async () => {
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "live_env.read_live_source_mail",
        reason: "Read the live-source mailbox first.",
        args: {},
        expected_artifacts: ["stage_play_live_source_mail_read_result"],
        confidence: 0.9,
      },
      {
        next_step: "next_action",
        chosen_capability: "live_env.read_live_source_mail",
        reason: "Incorrectly repeat the mailbox read.",
        args: {},
        expected_artifacts: ["stage_play_live_source_mail_read_result"],
        confidence: 0.9,
      },
      {
        next_step: "next_action",
        chosen_capability: "live_env.read_live_source_mail",
        reason: "Incorrectly repeat the mailbox read again.",
        args: {},
        expected_artifacts: ["stage_play_live_source_mail_read_result"],
        confidence: 0.9,
      },
    ]);

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "Use live_env.read_live_source_mail for the active Stage Play live-source mailbox. Watch this visual source and tell me if anything important happens.",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      terminal: response.body?.terminal_artifact_kind,
      error: response.body?.terminal_error_code,
      runtimeLoop: response.body?.agent_runtime_loop,
      answer: response.body?.answer,
      currentTurnArtifactKinds: response.body?.current_turn_artifact_ledger?.map((artifact: any) => artifact?.kind),
    }, null, 2);

    expect(response.body?.terminal_error_code, routeDebug).not.toBe("agent_loop_budget_exhausted");
    expect(response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration?.chosen_capability), routeDebug)
      .toEqual(expect.arrayContaining([
        "live_env.read_live_source_mail",
        "live_env.record_live_source_mail_decision",
      ]));
    const liveToolArtifacts = response.body?.current_turn_artifact_ledger
      ?.filter((artifact: any) => artifact?.kind === "live_environment_tool_observation")
      ?? [];
    const readArtifacts = liveToolArtifacts.filter((artifact: any) =>
      artifact?.payload?.tool_name === "live_env.read_live_source_mail"
    );
    expect(readArtifacts, routeDebug).toHaveLength(1);
    const decisionArtifact = liveToolArtifacts.find((artifact: any) =>
      artifact?.payload?.tool_name === "live_env.record_live_source_mail_decision"
    );
    expect(decisionArtifact?.payload?.observation, routeDebug).toMatchObject({
      artifactId: "stage_play_live_source_mail_decision",
      decision: "wait_for_next_summary",
      mailIds: [],
      nextLoopState: "armed_for_next_summary",
    });
    expect(response.body?.answer, routeDebug).toContain("No unread live-source updates were available at this check");
    expect(response.body?.answer, routeDebug).toContain("live-source mailbox is still armed");
    expect(response.body?.answer, routeDebug).not.toMatch(/visual evidence is unavailable|next visual summary/i);
  }, 30_000);

  it("answers Stage Play panel concept questions from repo/product evidence instead of live environment state", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "ok what is the stage play panel?",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      route: response.body?.route_reason_code,
      canonical: response.body?.canonical_goal_frame,
      sourceTarget: response.body?.source_target_intent,
      evidenceTargetArbitration: response.body?.evidence_target_arbitration,
      recommendedCapability: response.body?.available_capabilities?.recommended_capability_key,
      runtimeLoopStopReason: response.body?.agent_runtime_loop?.stop_reason,
      runtimeLoopIterations: response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => ({
        chosen_capability: iteration?.chosen_capability,
        produced_artifacts: iteration?.produced_artifacts,
        satisfaction: iteration?.satisfaction,
        stop_reason: iteration?.stop_reason,
      })),
      repoEvidenceRelevanceGate: response.body?.repo_evidence_relevance_gate,
      terminalErrorCode: response.body?.terminal_error_code,
      terminalBoundaryEligibility: response.body?.terminal_boundary_eligibility,
      terminalAnswerEnvelope: response.body?.terminal_answer_envelope,
      terminalAuthoritySingleWriter: response.body?.terminal_authority_single_writer,
      projectionMismatchRepoRepairProbe: response.body?.projection_mismatch_repo_repair_probe,
      projectionMismatchRepoRepairResult: response.body?.projection_mismatch_repo_repair_result,
      repoCodeEvidenceAnswer: response.body?.repo_code_evidence_answer
        ? {
            artifact_id: response.body.repo_code_evidence_answer.artifact_id,
            answer_text_present: Boolean(response.body.repo_code_evidence_answer.answer_text),
            support_refs_count: Array.isArray(response.body.repo_code_evidence_answer.support_refs)
              ? response.body.repo_code_evidence_answer.support_refs.length
              : 0,
          }
        : null,
      currentTurnArtifactKinds: Array.isArray(response.body?.current_turn_artifact_ledger)
        ? response.body.current_turn_artifact_ledger.map((artifact: any) => ({
            kind: artifact?.kind,
            artifact_id: artifact?.artifact_id,
            payload_kind: artifact?.payload?.kind,
            payload_schema: artifact?.payload?.schema,
          }))
        : null,
      answer: response.body?.answer,
      terminalArtifactKind: response.body?.terminal_artifact_kind,
      finalAnswerSource: response.body?.final_answer_source,
    }, null, 2);

    expect(response.body?.evidence_target_arbitration, routeDebug).toMatchObject({
      schema: "helix.ask_evidence_target_arbitration.v1",
      selected_target_source: "repo_code",
      selected_target_kind: "repo_code",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(response.body?.evidence_target_arbitration?.evidence_target_candidates, routeDebug).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_source: "repo_code",
          capability_keys: expect.arrayContaining(["repo-code.search_concept"]),
        }),
        expect.objectContaining({
          target_source: "live_environment",
          reason_codes: expect.arrayContaining(["stage_play_lexical_candidate_only"]),
        }),
      ]),
    );
    expect(response.body?.canonical_goal_frame, routeDebug).toMatchObject({
      goal_kind: "repo_entity_definition",
      required_terminal_kind: "repo_code_evidence_answer",
    });
    expect(response.body?.source_target_intent, routeDebug).toMatchObject({
      target_source: "repo_code",
      target_kind: "repo_code",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("repo-code.search_concept");
    expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) =>
      iteration?.chosen_capability === "repo-code.search_concept"
    ), routeDebug).toBe(true);
    expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) =>
      String(iteration?.chosen_capability ?? "").startsWith("live_env.")
    ), routeDebug).toBe(false);
    expect(response.body?.repo_evidence_relevance_gate, routeDebug).toMatchObject({
      terminal_allowed: true,
      selected_evidence_roles: expect.arrayContaining(["runtime_contract"]),
    });
    expect(response.body?.terminal_artifact_kind, routeDebug).toBe("repo_code_evidence_answer");
    expect(response.body?.answer, routeDebug).toMatch(/Stage Play|stage_play|Badge Graph/i);
    expect(response.body?.answer, routeDebug).not.toMatch(/currently not accessible|absence of a live answer environment/i);
  }, 60_000);

  it("plans a Stage Play visual prediction job instead of treating attach as live-source control", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question:
          "I'm about to attach a YouTube tab and I want you to predict what happens next based on visual capture.",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      route: response.body?.route_reason_code,
      canonical: response.body?.canonical_goal_frame,
      sourceTarget: response.body?.source_target_intent,
      selectedAction: response.body?.selected_action,
      answer: response.body?.answer,
      finalAnswerSource: response.body?.final_answer_source,
      terminalArtifactKind: response.body?.terminal_artifact_kind,
      terminalErrorCode: response.body?.terminal_error_code,
      routeProductContract: response.body?.route_product_contract,
      terminalArtifactSelectionGuard: response.body?.terminal_artifact_selection_guard,
      finalRouteReconciliation: response.body?.final_route_reconciliation,
      solverControllerDecision: response.body?.solver_controller_decision,
      runtimeLoop: response.body?.agent_runtime_loop,
    }, null, 2);

    expect(response.body?.canonical_goal_frame, routeDebug).toMatchObject({
      goal_kind: "live_environment_review",
      required_terminal_kind: "direct_answer_text",
    });
    expect(response.body?.route_reason_code, routeDebug).not.toBe("live_source_continuation");
    expect(response.body?.live_source_continuation_intent, routeDebug).toBeFalsy();
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("live_env.plan_stage_play_job");
    expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) =>
      iteration?.chosen_capability === "live_env.plan_stage_play_job"
    )).toBe(true);
    const liveToolArtifact = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "live_environment_tool_observation" &&
      artifact?.payload?.tool_name === "live_env.plan_stage_play_job"
    );
    expect(liveToolArtifact?.payload?.observation).toMatchObject({
      artifactId: "stage_play_job_plan",
      schemaVersion: "stage_play_job_plan/v1",
      domain: "narrative_media",
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    expect(liveToolArtifact.payload.observation.requiredSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        modality: "visual_frame",
        required: true,
        routeTo: "narrative_stage_play",
      }),
      expect.objectContaining({
        modality: "audio_transcript",
        required: false,
        routeTo: "narrative_stage_play",
      }),
    ]));
    expect(response.body?.answer).toContain("Stage Play job planned");
    expect(response.body?.answer).toContain("Needed: Browser tab visual source");
    expect(response.body?.answer).toContain("Optional: Optional audio transcript source");
    expect(response.body?.answer).toContain("did not start capture");
    expect(response.body?.answer).not.toContain("\"artifactId\":\"stage_play_job_plan\"");
    expect(response.body?.final_answer_source).not.toBe("typed_failure");
    expect(response.body?.final_answer_source).not.toBe("live_pipeline_receipt");
    expect(response.body?.terminal_artifact_kind).not.toBe("live_pipeline_receipt");
    const boundaryReport = evaluateTerminalBoundaryEligibility(response.body as Record<string, unknown>);
    expect(boundaryReport.checks.agent_runtime_loop).toBe(true);
    expect(boundaryReport.checks.agent_step_decision).toBe(true);
    expect(boundaryReport.checks.selected_capability_observation).toBe(true);
    expect(boundaryReport.checks.post_observation_model_decision).toBe(true);
    expect(boundaryReport.eligible).toBe(true);
  }, 60_000);

  it("routes Stage Play checkpoint requests to the checkpoint queue tool", async () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:seed-stage-play-checkpoint-routing",
      objective: "Run the Stage Play checkpoint for the active visual source.",
      preset: "narrative_scene_monitor",
      room_id: roomId,
      source_ids: [sourceId],
      line_schema: STAGE_PLAY_LIVE_ANSWER_LINE_SCHEMA,
      now: "2026-06-02T12:25:00.000Z",
    });
    upsertLiveSourceDescriptor({
      source_id: sourceId,
      thread_id: threadId,
      environment_id: environment.environment_id,
      modality: "visual_frame",
      user_label: "Browser tab visual",
      serving_context: {
        surface: "browser_tab",
        source_origin: "browser_getDisplayMedia",
        app_hint: "Chrome",
      },
      current_state: "active_interval",
      cadence_ms: 10000,
      latest_observation_refs: ["live_source_observation:stage-play-checkpoint-routing"],
    });
    upsertLiveSourceProducer({
      sourceId,
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:stage-play-checkpoint-routing",
      now: "2026-06-02T12:25:01.000Z",
    });
    recordLiveSourceObservation({
      schema: "helix.live_source_observation.v1",
      observation_id: "live_source_observation:stage-play-checkpoint-routing",
      thread_id: threadId,
      room_id: roomId,
      environment_id: environment.environment_id,
      source_id: sourceId,
      source_kind: "visual_frame",
      event_kind: "visual_frame_summary",
      observed_at: "2026-06-02T12:25:02.000Z",
      freshness: { status: "fresh", age_ms: 20 },
      provenance: { adapter: "browser.visual", confidence: "medium" },
      compact_summary: "The active visual source has a compact frame summary ready for a Stage Play checkpoint.",
      evidence_refs: ["evidence:stage-play-checkpoint-routing"],
      assistant_answer: false,
      raw_content_included: false,
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Run the Stage Play checkpoint for the active visual source.",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      route: response.body?.route_reason_code,
      canonical: response.body?.canonical_goal_frame,
      sourceTarget: response.body?.source_target_intent,
      selectedAction: response.body?.selected_action,
      answer: response.body?.answer,
      finalAnswerSource: response.body?.final_answer_source,
      terminalArtifactKind: response.body?.terminal_artifact_kind,
      terminalErrorCode: response.body?.terminal_error_code,
      productAuthorityGuard: response.body?.product_authority_guard,
      finalRouteReconciliation: response.body?.final_route_reconciliation,
      solverControllerDecision: response.body?.solver_controller_decision,
      runtimeLoop: response.body?.agent_runtime_loop,
    }, null, 2);

    expect(
      classifyLiveSourceContinuationIntent(
        "Run the Stage Play checkpoint for the active visual source.",
      ),
    ).toBeNull();
    expect(response.body?.canonical_goal_frame, routeDebug).toMatchObject({
      goal_kind: "live_environment_review",
      required_terminal_kind: "model_synthesized_answer",
    });
    expect(response.body?.route_reason_code, routeDebug).not.toBe("live_source_continuation");
    expect(response.body?.live_source_continuation_intent, routeDebug).toBeFalsy();
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("live_env.request_stage_play_checkpoint");
    expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) =>
      iteration?.chosen_capability === "live_env.request_stage_play_checkpoint"
    )).toBe(true);
    const liveToolArtifact = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "live_environment_tool_observation" &&
      artifact?.payload?.tool_name === "live_env.request_stage_play_checkpoint"
    );
    expect(liveToolArtifact?.payload?.observation).toMatchObject({
      schema: "stage_play_checkpoint_request_result/v1",
      checkpointRequest: {
        artifactId: "stage_play_checkpoint_request",
        schemaVersion: "stage_play_checkpoint_request/v1",
        status: "running",
        assistant_answer: false,
        context_role: "tool_evidence",
      },
      readyToRun: true,
      queueState: {
        schema: "stage_play_checkpoint_queue/v1",
        assistant_answer: false,
        context_role: "tool_evidence",
      },
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    expect(liveToolArtifact.payload.observation.queueState.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifactId: "stage_play_checkpoint_request",
        schemaVersion: "stage_play_checkpoint_request/v1",
        status: "running",
        assistant_answer: false,
        context_role: "tool_evidence",
      }),
    ]));
    expect(response.body?.answer, routeDebug).toContain("Stage Play checkpoint request running");
    expect(response.body?.answer, routeDebug).toContain("tool evidence only");
    expect(response.body?.answer, routeDebug).toContain("did not produce the final answer snapshot");
    expect(response.body?.answer).not.toContain("\"schema\":\"stage_play_checkpoint_request_result/v1\"");
    expect(response.body?.final_answer_source).not.toBe("typed_failure");
    expect(response.body?.final_answer_source).not.toBe("live_pipeline_receipt");
    expect(response.body?.final_answer_source).not.toBe("live_environment_tool_observation");
    expect(response.body?.terminal_artifact_kind).not.toBe("live_environment_tool_observation");
    const boundaryReport = evaluateTerminalBoundaryEligibility(response.body as Record<string, unknown>);
    expect(boundaryReport.checks.agent_runtime_loop).toBe(true);
    expect(boundaryReport.checks.agent_step_decision).toBe(true);
    expect(boundaryReport.checks.selected_capability_observation).toBe(true);
    expect(boundaryReport.checks.post_observation_model_decision).toBe(true);
    expect(boundaryReport.eligible).toBe(true);
  }, 60_000);

  it("prefers reflect_stage_play_context over generic visual Live Answer setup", async () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:seed-stage-play-routing",
      objective: "Project Stage Play graph into Live Interpretation.",
      preset: "custom",
      room_id: roomId,
      source_ids: [sourceId],
      line_schema: STAGE_PLAY_LIVE_ANSWER_LINE_SCHEMA,
      now: "2026-06-02T12:30:00.000Z",
    });
    upsertLiveSourceDescriptor({
      source_id: sourceId,
      thread_id: threadId,
      environment_id: environment.environment_id,
      modality: "visual_frame",
      user_label: "Browser tab visual",
      serving_context: {
        surface: "browser_tab",
        source_origin: "browser_getDisplayMedia",
        app_hint: "Chrome",
      },
      current_state: "active_interval",
      cadence_ms: 10000,
      latest_observation_refs: ["visual_observation:stage-play-routing"],
    });
    upsertLiveSourceProducer({
      sourceId,
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:stage-play-routing",
      now: "2026-06-02T12:30:01.000Z",
    });

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: [
          "Use the Stage Play reflection capability live_env.reflect_stage_play_context.",
          "Reflect the active Stage Play Badge Graph and project the current Live Interpretation.",
          "Stage Play checkpoint handle: stage_play_checkpoint_request:ui-handoff.",
          "Stage Play graph handle: stage_play_badge_graph:ui-handoff.",
          "Stage Play evidence handles: live_source_descriptor:stage-play-routing, live_source_producer:stage-play-routing, visual_observation:stage-play-routing.",
          "Checkpoint focus: Given the first usable Stage Play observation, what checkpoint answer should be summarized for the active visual evidence?",
          "Report checkpoint freshness, missing evidence, and whether a current model-reviewed Answer Snapshot exists after the reflection.",
          "Leave visual/audio capture cadence unchanged.",
        ].join("\n"),
        sessionId: threadId,
        workspace_context_snapshot: {
          visual_context_capability: {
            status: "error",
            evidence_available: false,
            error: "visual capture evidence is unavailable",
          },
        },
        debug: true,
      })
      .expect(200);

    const routeDebug = JSON.stringify({
      route: response.body?.route_reason_code,
      canonical: {
        goal_kind: response.body?.canonical_goal_frame?.goal_kind,
        required_terminal_kind: response.body?.canonical_goal_frame?.required_terminal_kind,
      },
      sourceTarget: {
        target_source: response.body?.source_target_intent?.target_source,
        target_kind: response.body?.source_target_intent?.target_kind,
        reasons: response.body?.source_target_intent?.reasons,
      },
      selectedAction: response.body?.selected_action,
      workstationPlan: response.body?.workstation_tool_plan,
      actionEnvelope: response.body?.action_envelope?.governance,
      capabilityPlan: {
        requested_action: response.body?.capability_plan?.requested_action,
        admission_status: response.body?.capability_plan?.admission_status,
      },
      capabilityResult: {
        status: response.body?.capability_result?.status,
        selected_for_answer: response.body?.capability_result?.selected_for_answer,
        reentered_solver: response.body?.capability_result?.reentered_solver,
      },
      capabilityLifecycleLedger: {
        ok: response.body?.capability_lifecycle_ledger?.ok,
        failure_codes: response.body?.capability_lifecycle_ledger?.failure_codes,
      },
      solverControllerDecision: {
        decision: response.body?.solver_controller_decision?.decision,
        selected_terminal_artifact_kind: response.body?.solver_controller_decision?.selected_terminal_artifact_kind,
        blocking_reasons: response.body?.solver_controller_decision?.blocking_reasons,
      },
      goalSatisfaction: {
        satisfaction: response.body?.goal_satisfaction_evaluation?.satisfaction,
        next_decision: response.body?.goal_satisfaction_evaluation?.next_decision,
        required_terminal_kind: response.body?.goal_satisfaction_evaluation?.required_terminal_kind,
      },
      terminalAuthority: {
        final_answer_source: response.body?.terminal_answer_authority?.final_answer_source,
        terminal_artifact_kind: response.body?.terminal_answer_authority?.terminal_artifact_kind,
      },
      finalAnswerSource: response.body?.final_answer_source,
      terminalArtifactKind: response.body?.terminal_artifact_kind,
      finalAnswerDraftAuthority: response.body?.final_answer_draft?.authority,
      finalAnswerDraftText: response.body?.final_answer_draft?.text,
      receiptStatusText: response.body?.receipt_status_text,
      terminalProjectionGuard: response.body?.terminal_projection_guard,
      terminalAuthoritySingleWriter: response.body?.terminal_authority_single_writer,
      runtimeAuthorityAuditChecks: response.body?.runtime_authority_audit?.checks,
      runtimeLoopIterations: response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => ({
        chosen_capability: iteration?.chosen_capability,
        executed_action_key: iteration?.executed_action_key,
        produced_artifacts: iteration?.produced_artifacts,
        satisfaction: iteration?.satisfaction,
        stop_reason: iteration?.stop_reason,
      })),
      askTurnSolverTrace: {
        completed_solver_path: response.body?.ask_turn_solver_trace?.completed_solver_path,
        final_arbitration: response.body?.ask_turn_solver_trace?.final_arbitration,
      },
      stagePlayAskCheckpointReceipt: response.body?.stage_play_ask_checkpoint_receipt,
      stagePlayCheckpointQueueCompletion: response.body?.stage_play_checkpoint_queue_completion,
      currentTurnArtifactKinds: response.body?.current_turn_artifact_ledger?.map((artifact: any) => artifact?.kind),
      stagePlayReceiptArtifacts: response.body?.current_turn_artifact_ledger
        ?.filter((artifact: any) => artifact?.kind === "stage_play_ask_checkpoint_receipt")
        ?.map((artifact: any) => artifact?.payload),
      answer: response.body?.answer,
    }, null, 2);

    expect(response.body?.canonical_goal_frame, routeDebug).toMatchObject({
      goal_kind: "live_environment_review",
      required_terminal_kind: "direct_answer_text",
    });
    expect(response.body?.route_reason_code, routeDebug).not.toBe("live_source_continuation");
    expect(response.body?.live_source_continuation_intent, routeDebug).toBeFalsy();
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "live_environment",
      target_kind: "live_environment",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.route_product_contract).toMatchObject({
      source_target: "live_environment",
      precedence_reason: "live_environment_source_target_requires_tool_observation_then_model_synthesis",
    });
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("live_env.reflect_stage_play_context");
    expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) =>
      iteration?.chosen_capability === "live_env.reflect_stage_play_context"
    ), routeDebug).toBe(true);
    const dynamicToolActionNames = response.body?.current_turn_artifact_ledger
      ?.filter((artifact: any) => artifact?.kind === "dynamic_tool_call")
      ?.map((artifact: any) => artifact?.payload?.tool_action_name ?? artifact?.payload?.action_name ?? artifact?.payload?.name)
      ?? [];
    expect(dynamicToolActionNames, routeDebug).not.toContain("situation-room.pipeline.compose");
    expect(dynamicToolActionNames, routeDebug).not.toContain("situation-room.pipeline.execute");

    const liveToolArtifact = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "live_environment_tool_observation" &&
      artifact?.payload?.tool_name === "live_env.reflect_stage_play_context"
    );
    expect(liveToolArtifact?.payload?.observation).toMatchObject({
      schema: "stage_play_reflection_result/v1",
      graph: { artifactId: "stage_play_badge_graph" },
      outputLaneProjection: { artifactId: "stage_play_output_lane_projection" },
      liveAnswerProjection: {
        attempted: true,
        projected: true,
      },
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
    });
    expect(liveToolArtifact.payload.observation.debugReceipt).toMatchObject({
      schema: "stage_play_tool_receipt_debug/v1",
      toolName: "live_env.reflect_stage_play_context",
      graphId: expect.stringContaining("stage_play_badge_graph:"),
      sourceRefs: expect.arrayContaining([
        expect.stringMatching(/live_source_descriptor|live_source_producer|visual_observation|live_source_chunk/),
      ]),
      visualSourceStatus: expect.arrayContaining([
        expect.objectContaining({
          sourceId,
          modality: "visual_frame",
          status: "active",
          selectedForStagePlay: true,
          routeTo: expect.any(String),
        }),
      ]),
      outputProjectionKeys: expect.arrayContaining(["risk", "possibilities", "unknowns", "next_check"]),
      checkpointFreshness: expect.objectContaining({
        reason: "no_checkpoint",
        modelReviewed: false,
        fresh: false,
      }),
      checkpointRequestId: expect.any(String),
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    expect(liveToolArtifact.payload.observation.liveAnswerProjection.changedLineKeys).toEqual(
      expect.arrayContaining(["risk", "possibilities", "unknowns", "next_check"]),
    );
    expect(response.body?.answer, routeDebug).toContain("Stage Play reflected the active visual source and queued a checkpoint.");
    expect(response.body?.answer).toContain("No model-reviewed answer snapshot exists yet.");
    expect(response.body?.answer).toContain("Stage Play reflected the active visual source");
    expect(response.body?.answer).toContain("queued a checkpoint");
    expect(response.body?.answer).not.toContain("visual capture evidence is unavailable");
    expect(response.body?.receipt_status_text, routeDebug).toContain("Stage Play reflected the active visual source");
    expect(response.body?.selected_final_answer, routeDebug).toBeUndefined();
    expect(response.body?.finalAnswer, routeDebug).toBeUndefined();
    expect(response.body?.terminal_error_code).not.toBe("visual_evidence_missing");
    expect(response.body?.answer).not.toContain("\"artifactId\":\"stage_play_badge_graph\"");
    expect(response.body?.final_answer_draft?.authority, routeDebug).toBe("deterministic_receipt_fallback");
    expect(response.body?.terminal_artifact_kind, routeDebug).toBe("tool_receipt");
    expect(response.body?.terminal_artifact_kind, routeDebug).not.toBe("model_synthesized_answer");
    expect(response.body?.final_answer_source, routeDebug).toBe("deterministic_receipt_fallback");
    expect(response.body?.terminal_eligible, routeDebug).toBe(false);
    expect(response.body?.assistant_answer, routeDebug).toBe(false);
    expect(response.body?.terminal_answer_authority, routeDebug).toMatchObject({
      terminal_artifact_kind: "tool_receipt",
      final_answer_source: "deterministic_receipt_fallback",
      server_authoritative: false,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(response.body?.terminal_presentation, routeDebug).toMatchObject({
      terminal_artifact_kind: "tool_receipt",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(response.body?.stage_play_checkpoint_queue_completion, routeDebug).toBeFalsy();
    expect(response.body?.stage_play_ask_checkpoint_receipt, routeDebug).toBeFalsy();
    const boundaryReport = evaluateTerminalBoundaryEligibility(response.body as Record<string, unknown>);
    expect(boundaryReport.checks.agent_runtime_loop).toBe(true);
    expect(boundaryReport.checks.agent_step_decision).toBe(true);
    expect(boundaryReport.checks.selected_capability_observation).toBe(true);
    expect(boundaryReport.checks.post_observation_model_decision).toBe(true);
    expect(boundaryReport.eligible).toBe(true);

    const refreshedGraph = buildStagePlayGraphFromWorld({
      threadId,
      roomId,
      environmentId: environment.environment_id,
      now: new Date("2026-06-02T12:30:03.000Z"),
    });
    expect(refreshedGraph.badges.find((badge) => badge.id === "helix_ask.checkpoint.latest")).toMatchObject({
      status: "missing_evidence",
      checkpoint: expect.objectContaining({
        askTurnId: null,
        solverTraceRef: null,
        terminalArtifactKind: null,
        finalAnswerSource: null,
        modelReviewed: false,
      }),
    });
    expect(refreshedGraph.badges.find((badge) => badge.id === "answer_snapshot.latest")).toMatchObject({
      status: "missing_evidence",
      output: expect.objectContaining({
        state: "stale",
      }),
    });
    expect(refreshedGraph.badges.find((badge) => badge.id === "live_output.current")).toMatchObject({
      status: "missing_evidence",
      output: expect.objectContaining({
        state: "stale",
        voiceEligible: false,
      }),
    });
  }, 60_000);
});
