import { beforeEach, describe, expect, it } from "vitest";
import type { HelixMinecraftRouteSolverObservation } from "../../shared/helix-minecraft-evidence";
import { validateStagePlayBadgeGraphV1 } from "../../shared/contracts/stage-play-badge-graph.v1";
import { validateHelixRecommendedActionAdmissionV1 } from "../../shared/contracts/helix-recommended-action-admission.v1";
import {
  recordLiveSourceObservation,
  resetLiveSourceObservationStoreForTest,
} from "../services/live-source/live-source-observation-store";
import {
  ingestEnvironmentStateSnapshot,
  normalizeEnvironmentStateSnapshot,
  resetEnvironmentStateSnapshotWindowsForTest,
} from "../services/situation-room/environment-state-snapshot-window";
import { clearEventJournalForTest } from "../services/situation-room/event-journal-store";
import {
  resetLiveSourceChunkBufferForTest,
  upsertLiveSourceProducer,
} from "../services/situation-room/live-source-chunk-buffer";
import {
  analyzeVisualFrame,
  recordVisualFrame,
  resetVisualSnapshotStoreForTest,
} from "../services/situation-room/visual-snapshot-store";
import {
  resetLiveSourceDescriptorsForTest,
  upsertLiveSourceDescriptor,
} from "../services/situation-room/live-source-descriptor-builder";
import { resetSituationSourceCapabilitiesForTest } from "../services/situation-room/situation-source-capability-store";
import {
  recordMinecraftRouteSolverObservation,
  resetMinecraftNavigationStateStoreForTest,
} from "../services/situation-room/minecraft-navigation-state-store";
import { resetMinecraftWorldDeltaOverlaysForTest } from "../services/situation-room/minecraft-world-delta-overlay";
import { resetMinecraftWorldSenseWindows } from "../services/situation-room/minecraft-world-sense-window";
import {
  resetStagePlaySourceRouteOverridesForTest,
  upsertStagePlaySourceRouteOverride,
} from "../services/situation-room/stage-play-source-window";
import {
  buildStagePlayGraphFromWorld,
  buildStagePlayRecommendedActionAdmissionV1,
} from "../services/stage-play/stage-play-badge-graph-builder";
import {
  recordStagePlayAskCheckpointReceipt,
  resetStagePlayAskCheckpointReceiptsForTest,
} from "../services/stage-play/stage-play-ask-checkpoint-store";
import { resetStagePlayPerturbationEventsForTest } from "../services/stage-play/stage-play-perturbation-event-store";
import { resetStagePlayCheckpointQueueForTest } from "../services/stage-play/stage-play-checkpoint-queue";
import { resetStagePlayRawSessionBufferForTest } from "../services/stage-play/stage-play-raw-session-buffer-store";
import {
  recordStagePlayMicroReasonerRun,
  recordStagePlayProcessedMailPacket,
  resetStagePlayProcessedMailPacketStoreForTest,
} from "../services/stage-play/stage-play-processed-mail-packet-store";
import {
  ensureStagePlayAgentGoalSession,
  recordStagePlayGoalContextUpdate,
  resetStagePlayGoalContextStoreForTest,
} from "../services/stage-play/stage-play-goal-context-store";
import { WORKSTATION_GOAL_CONTEXT_UPDATE_SCHEMA } from "../../shared/contracts/workstation-goal-context.v1";

const threadId = "thread:stage-play-reducer";
const roomId = "room:minecraft-stage-play-reducer";
const worldId = "minecraft:the_end";

beforeEach(() => {
  resetLiveSourceObservationStoreForTest();
  resetEnvironmentStateSnapshotWindowsForTest();
  resetMinecraftWorldDeltaOverlaysForTest();
  resetMinecraftNavigationStateStoreForTest();
  resetMinecraftWorldSenseWindows();
  resetStagePlaySourceRouteOverridesForTest();
  resetLiveSourceDescriptorsForTest();
  resetLiveSourceChunkBufferForTest();
  resetVisualSnapshotStoreForTest();
  resetSituationSourceCapabilitiesForTest();
  resetStagePlayRawSessionBufferForTest();
  resetStagePlayAskCheckpointReceiptsForTest();
  resetStagePlayPerturbationEventsForTest();
  resetStagePlayCheckpointQueueForTest();
  resetStagePlayProcessedMailPacketStoreForTest();
  resetStagePlayGoalContextStoreForTest();
  clearEventJournalForTest();
});

describe("Stage Play world-state badge reducer", () => {
  it("projects goal-context updates and active goal sessions into the graph circuit", () => {
    const sourceId = "visual_source:live-answer";
    const loopRef = "stage_play_live_source_watch_job:goal-circuit";
    const goalId = "goal:stage-play-circuit";
    ensureStagePlayAgentGoalSession({
      threadId,
      roomId,
      objectiveId: goalId,
      objectiveText: "Monitor visual packets and route-watch automation as graph-native goal context.",
      sourceRefs: [sourceId],
      loopRefs: [loopRef],
      constructRefs: ["stage_play_badge_graph:goal-circuit"],
      contextFeeds: [
        {
          feedId: "feed:visual",
          sourceKind: "visual_summaries",
          freshnessMs: 30000,
        },
        {
          feedId: "feed:automation",
          sourceKind: "automation_policies",
          freshnessMs: 120000,
        },
        {
          feedId: "feed:translation",
          sourceKind: "translated_transcripts",
          freshnessMs: 45000,
        },
      ],
      allowedActuators: ["query_visual_summaries", "query_translation_segments", "configure_route_watch", "set_loop_state", "focus_process_graph", "narrator_bind_stream"],
      cadence: { kind: "event_accumulation", minUpdates: 2 },
      checkpoint: {
        summary: "Route-watch automation attached to goal-context circuit.",
        evidenceRefs: ["stage_play_goal_context_update:automation:goal-circuit"],
        actionsTaken: ["configure_route_watch"],
      },
      nowMs: Date.parse("2026-06-17T14:00:00.000Z"),
    });
    recordStagePlayGoalContextUpdate({
      schemaVersion: WORKSTATION_GOAL_CONTEXT_UPDATE_SCHEMA,
      updateId: "stage_play_goal_context_update:automation:goal-circuit",
      createdAtMs: Date.parse("2026-06-17T14:00:01.000Z"),
      sourceRefs: [sourceId],
      loopRefs: [`thread:${threadId}`, loopRef],
      producerKind: "automation",
      updateKind: "automation_status",
      contentRef: "stage_play_live_source_watch_job_policy:goal-circuit",
      preview: "Configured route-watch automation as deterministic goal-context evidence.",
      evidenceRefs: [
        "stage_play_live_source_watch_job_policy:goal-circuit",
        loopRef,
        "agent_goal_allowed_actuator:set_loop_state",
      ],
      receiptRefs: ["stage_play_live_source_watch_job_policy:goal-circuit"],
      freshness: {
        observedAtMs: Date.parse("2026-06-17T14:00:01.000Z"),
        staleAfterMs: 120000,
        status: "fresh",
      },
      goalRelevance: {
        goalId,
        relevance: 0.82,
        reason: "Automation policy contributes deterministic process state for this goal.",
      },
      suggestedDispatch: [
        { kind: "log_receipt", receiptRef: "stage_play_live_source_watch_job_policy:goal-circuit" },
        { kind: "update_panel", panelId: "stage-play-badge-graph" },
        { kind: "set_loop_state", loopRef, state: "running" },
        { kind: "wake_agent", interruptKind: "policy_triggered", reason: "operator policy requests review of loop state" },
      ],
      toolIdentity: {
        requestedToolName: "live_env.set_workstation_loop_state",
        canonicalToolName: "live_env.set_workstation_loop_state",
        matchedAllowedActuators: ["set_loop_state"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:set_loop_state"],
      },
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    recordStagePlayGoalContextUpdate({
      schemaVersion: WORKSTATION_GOAL_CONTEXT_UPDATE_SCHEMA,
      updateId: "stage_play_goal_context_update:translation:goal-circuit",
      createdAtMs: Date.parse("2026-06-17T14:00:01.500Z"),
      sourceRefs: [sourceId, "audio_source:earbuds"],
      loopRefs: [
        `thread:${threadId}`,
        "translation_loop:earbuds",
        "workstation_context_feed:translated_transcripts",
        "workstation_actuator:query_translation_segments",
      ],
      producerKind: "translation_loop",
      updateKind: "translated_transcript",
      contentRef: "stage_play_processed_mail_packet:earbud-translation",
      preview: "Translated transcript candidate is ready for Live Answer and Narrator output.",
      evidenceRefs: [
        "stage_play_processed_mail_packet:earbud-translation",
        "microdeck_output:earbud-translation",
        "context_feed:translated_transcripts",
        "allowed_actuator:query_translation_segments",
      ],
      receiptRefs: ["stage_play_context_feed_query:translated_transcripts:goal-circuit"],
      freshness: {
        observedAtMs: Date.parse("2026-06-17T14:00:01.500Z"),
        staleAfterMs: 45000,
        status: "fresh",
      },
      goalRelevance: {
        goalId,
        relevance: 0.78,
        reason: "Translated transcript feeds the goal session without becoming a terminal answer.",
      },
      suggestedDispatch: [
        { kind: "update_live_answer", lineKey: "line:earbud-translation" },
        {
          kind: "bind_narrator_stream",
          sourceRef: "audio_source:earbuds",
          streamKind: "translated_transcript",
          deliveryMode: "visible_only",
        },
      ],
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });

    const graph = buildStagePlayGraphFromWorld({
      threadId,
      sourceId,
      objective: "Inspect the workstation reasoning circuit.",
      now: new Date("2026-06-17T14:00:02.000Z"),
      readOnly: true,
    });

    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(graph.badges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "workstation_state_plane.goal_context_bus",
        kind: "workstation_state_plane",
        status: "observed",
        reasonCodes: expect.arrayContaining(["goal_context_bus", "not_terminal_authority"]),
        dataTray: expect.objectContaining({
          transformLabel: "goal context update index",
          outputRefs: expect.arrayContaining([
            "stage_play_goal_context_update:automation:goal-circuit",
            goalId,
          ]),
        }),
      }),
      expect.objectContaining({
        id: "workstation_state_plane.context_feed_index",
        kind: "workstation_state_plane",
        status: "observed",
        tags: expect.arrayContaining([
          "context_feed_index",
          "queryable_goal_context",
          "agent_read_model",
          "not_terminal_authority",
        ]),
        reasonCodes: expect.arrayContaining([
          "context_feed_index",
          "queryable_goal_context",
          "agent_reads_deterministic_feeds",
          "observation_not_terminal_authority",
        ]),
        dataTray: expect.objectContaining({
          transformLabel: "AgentGoalSession feeds -> query policy index",
          inputPreview: expect.stringContaining("translated_transcripts"),
          outputRefs: expect.arrayContaining([
            "context_feed:translated_transcripts",
            "workstation_actuator:query_translation_segments",
            "allowed_actuator:query_translation_segments",
          ]),
          skipped: expect.arrayContaining([
            "assistant_answer=false",
            "terminal_eligible=false",
            "raw_content_included=false",
          ]),
          blockedUntil: "completed solver path selects terminal answer",
        }),
      }),
      expect.objectContaining({
        id: "workstation_state_plane.terminal_authority",
        kind: "workstation_state_plane",
        status: "blocked",
        tags: expect.arrayContaining([
          "terminal_authority",
          "awaiting_completed_solver_path",
          "goal_sessions_require_terminal_authority",
          "receipts_not_answers",
        ]),
        reasonCodes: expect.arrayContaining([
          "terminal_authority_state",
          "terminal_authority_pending",
          "receipts_and_goal_context_are_observations",
        ]),
        dataTray: expect.objectContaining({
          transformLabel: "completed solver path / terminal authority boundary",
          outputPreview: "terminal answer pending",
          blockedUntil: "completed solver path selects terminal answer",
          skipped: expect.arrayContaining([
            "goal_context_updates",
            "workstation_control_receipts",
            "microdeck_outputs",
            "narrator_events",
            "panel_projections",
          ]),
        }),
      }),
      expect.objectContaining({
        kind: "agent_goal_session",
        status: "observed",
        sourceRefs: expect.arrayContaining([
          expect.objectContaining({ kind: "agent_goal_session", id: goalId }),
        ]),
        reasonCodes: expect.arrayContaining(["terminal_authority_required"]),
        dataTray: expect.objectContaining({
          transformLabel: "agent goal session policy",
          blockedUntil: "completed solver path selects final report",
        }),
      }),
      expect.objectContaining({
        kind: "goal_context_update",
        status: "observed",
        sourceRefs: expect.arrayContaining([
          expect.objectContaining({
            kind: "workstation_goal_context_update",
            id: "stage_play_goal_context_update:automation:goal-circuit",
          }),
        ]),
        reasonCodes: expect.arrayContaining([
          "goal_context_update",
          "automation",
          "observation_not_terminal_authority",
          "tool_identity_provenance",
        ]),
        dataTray: expect.objectContaining({
          transformLabel: "automation -> automation_status",
          toolRefs: expect.arrayContaining([
            "requested_tool:live_env.set_workstation_loop_state",
            "canonical_tool:live_env.set_workstation_loop_state",
            "matched_actuator:set_loop_state",
            "agent_goal_allowed_actuator:set_loop_state",
          ]),
          toolPreview: "tool live_env.set_workstation_loop_state -> live_env.set_workstation_loop_state; matched set_loop_state",
          outputPreview: expect.stringContaining("set_loop_state"),
          skipped: expect.arrayContaining([
            "assistant_answer=false",
            "terminal_eligible=false",
            "raw_content_included=false",
          ]),
        }),
      }),
    ]));
    const updateBadge = graph.badges.find((badge) => badge.kind === "goal_context_update" && badge.subjects.includes("stage_play_goal_context_update:automation:goal-circuit"));
    const translationUpdateBadge = graph.badges.find((badge) =>
      badge.kind === "goal_context_update" &&
      badge.subjects.includes("stage_play_goal_context_update:translation:goal-circuit")
    );
    const sessionBadge = graph.badges.find((badge) => badge.kind === "agent_goal_session");
    expect(updateBadge?.admission).toBe("auto");
    expect(translationUpdateBadge?.admission).toBe("auto");
    expect(translationUpdateBadge?.reasonCodes).toEqual(expect.arrayContaining([
      "feed_query_policy",
      "agent_goal_feed_policy",
      "actuator_policy_ref",
    ]));
    expect(translationUpdateBadge?.dataTray?.outputRefs).toEqual(expect.arrayContaining([
      "context_feed:translated_transcripts",
      "allowed_actuator:query_translation_segments",
    ]));
    expect(sessionBadge?.admission).toBe("auto");
    const dispatchBadges = graph.badges.filter((badge) => badge.kind === "workstation_dispatch_action");
    const wakeDispatchBadge = dispatchBadges.find((badge) => badge.tags.includes("dispatch:wake_agent"));
    expect(dispatchBadges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "workstation_dispatch_action",
        tags: expect.arrayContaining(["dispatch:set_loop_state"]),
        reasonCodes: expect.arrayContaining(["goal_context_dispatch_action", "not_terminal_authority", "tool_identity_provenance"]),
        dataTray: expect.objectContaining({
          toolRefs: expect.arrayContaining([
            "requested_tool:live_env.set_workstation_loop_state",
            "canonical_tool:live_env.set_workstation_loop_state",
            "matched_actuator:set_loop_state",
            "agent_goal_allowed_actuator:set_loop_state",
          ]),
        }),
      }),
      expect.objectContaining({
        kind: "workstation_dispatch_action",
        tags: expect.arrayContaining(["dispatch:update_live_answer"]),
      }),
      expect.objectContaining({
        kind: "workstation_dispatch_action",
        tags: expect.arrayContaining(["dispatch:bind_narrator_stream"]),
      }),
      expect.objectContaining({
        kind: "workstation_dispatch_action",
        admission: "ask_user",
        tags: expect.arrayContaining(["dispatch:wake_agent", "wake_interrupt", "policy_triggered"]),
        reasonCodes: expect.arrayContaining(["wake_demoted_to_interrupt_dispatch"]),
        dataTray: expect.objectContaining({
          outputPreview: "classified interrupt only",
          skipped: expect.arrayContaining([
            "agent_executable=false",
            "assistant_answer=false",
            "terminal_eligible=false",
          ]),
        }),
      }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: "workstation_state_plane.current",
        to: "workstation_state_plane.goal_context_bus",
        relation: "contains",
      }),
      expect.objectContaining({
        from: "workstation_state_plane.current",
        to: "workstation_state_plane.terminal_authority",
        relation: "contains",
      }),
      expect.objectContaining({
        from: "workstation_state_plane.gates",
        to: "workstation_state_plane.terminal_authority",
        relation: "constrains",
        reasonCodes: expect.arrayContaining(["gates_constrain_terminal_authority"]),
      }),
      expect.objectContaining({
        from: "workstation_state_plane.goal_context_bus",
        to: "workstation_state_plane.context_feed_index",
        relation: "contains",
        reasonCodes: expect.arrayContaining(["goal_context_bus_contains_context_feed_index", "queryable_goal_context"]),
      }),
      expect.objectContaining({
        from: "workstation_state_plane.context_feed_index",
        to: "workstation_state_plane.terminal_authority",
        relation: "needs_check",
        reasonCodes: expect.arrayContaining(["context_feed_index_requires_terminal_authority", "observations_not_answers"]),
      }),
      expect.objectContaining({
        from: "workstation_state_plane.goal_context_bus",
        to: "workstation_state_plane.terminal_authority",
        relation: "needs_check",
        reasonCodes: expect.arrayContaining(["goal_context_requires_terminal_authority", "observations_not_answers"]),
      }),
      expect.objectContaining({
        from: "workstation_state_plane.terminal_authority",
        to: "workstation_state_plane.output_bus",
        relation: "constrains",
        reasonCodes: expect.arrayContaining(["terminal_authority_constrains_output_bus", "single_writer_final_answer"]),
      }),
      expect.objectContaining({
        from: sessionBadge?.id,
        to: "workstation_state_plane.control_signals",
        relation: "constrains",
        reasonCodes: expect.arrayContaining(["agent_goal_session_bounds_control_signals"]),
      }),
      expect.objectContaining({
        from: sessionBadge?.id,
        to: "workstation_state_plane.terminal_authority",
        relation: "requires",
        reasonCodes: expect.arrayContaining(["agent_goal_session_requires_terminal_authority"]),
      }),
      expect.objectContaining({
        from: sessionBadge?.id,
        to: "workstation_state_plane.context_feed_index",
        relation: "constrains",
        reasonCodes: expect.arrayContaining(["agent_goal_session_declares_context_feeds", "query_actuator_policy"]),
      }),
      expect.objectContaining({
        from: sessionBadge?.id,
        to: "workstation_state_plane.output_bus",
        relation: "constrains",
        reasonCodes: expect.arrayContaining(["narrator_actuator_policy"]),
      }),
      expect.objectContaining({
        from: updateBadge?.id,
        to: sessionBadge?.id,
        relation: "feeds",
      }),
      expect.objectContaining({
        from: updateBadge?.id,
        to: "workstation_state_plane.control_signals",
        relation: "feeds",
        reasonCodes: expect.arrayContaining(["automation_update_feeds_control"]),
      }),
      expect.objectContaining({
        from: updateBadge?.id,
        to: "workstation_state_plane.process_loop",
        relation: "feeds",
      }),
      expect.objectContaining({
        from: translationUpdateBadge?.id,
        to: "workstation_state_plane.source_bus",
        relation: "feeds",
        reasonCodes: expect.arrayContaining(["stream_goal_context_update_feeds_source_bus", "translation_loop"]),
      }),
      expect.objectContaining({
        from: translationUpdateBadge?.id,
        to: "workstation_state_plane.process_loop",
        relation: "feeds",
        reasonCodes: expect.arrayContaining(["stream_goal_context_update_feeds_process_loop", "translation_loop"]),
      }),
      expect.objectContaining({
        from: translationUpdateBadge?.id,
        to: "workstation_state_plane.output_bus",
        relation: "feeds",
        reasonCodes: expect.arrayContaining(["goal_context_update_feeds_output_bus", "translation_loop", "translated_transcript"]),
      }),
      expect.objectContaining({
        from: translationUpdateBadge?.id,
        to: sessionBadge?.id,
        relation: "feeds",
      }),
      expect.objectContaining({
        from: translationUpdateBadge?.id,
        to: "workstation_state_plane.context_feed_index",
        relation: "feeds",
        reasonCodes: expect.arrayContaining(["goal_context_update_feeds_context_feed_index", "feed_query_policy"]),
      }),
      expect.objectContaining({
        from: translationUpdateBadge?.id,
        to: "workstation_state_plane.control_signals",
        relation: "constrains",
        reasonCodes: expect.arrayContaining(["feed_query_policy_bounds_actuator"]),
        evidenceRefs: expect.arrayContaining([
          "context_feed:translated_transcripts",
          "allowed_actuator:query_translation_segments",
        ]),
      }),
      expect.objectContaining({
        from: updateBadge?.id,
        to: expect.stringMatching(/^workstation_dispatch_action\./),
        relation: "produces",
        reasonCodes: expect.arrayContaining(["goal_context_update_produces_dispatch_action"]),
      }),
      expect.objectContaining({
        from: wakeDispatchBadge?.id,
        to: "workstation_state_plane.control_signals",
        relation: "recommends",
        reasonCodes: expect.arrayContaining(["wake_demoted_to_interrupt_dispatch", "wake_agent"]),
      }),
    ]));
    expect(graph.authority).toMatchObject({
      assistant_answer: false,
      terminal_eligible: false,
      agent_executable: false,
    });
  });

  it("renders thread-only visual producers in Observer source custody before a room is bound", () => {
    const producer = upsertLiveSourceProducer({
      sourceId: "visual_source:live-answer",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:live-answer",
      now: "2026-06-02T12:09:55.000Z",
    });
    const frame = recordVisualFrame({
      thread_id: threadId,
      source_id: "visual_source:live-answer",
      frame_id: "visual_frame:live-answer",
      image_ref: "ephemeral://frame/live-answer",
      image_sha256: "a".repeat(64),
      ts: "2026-06-02T12:09:56.000Z",
    });
    const evidence = analyzeVisualFrame({
      thread_id: threadId,
      frame_id: frame.frame_id,
      evidence_id: "visual_evidence:live-answer",
      summary: "Minecraft-like scene with character, book/crafting station, enchantment table, and cat.",
      detected_objects: ["character", "book", "crafting station", "enchantment table", "cat"],
      ts: "2026-06-02T12:09:57.000Z",
    });

    const graph = buildStagePlayGraphFromWorld({
      threadId,
      now: new Date("2026-06-02T12:10:00.000Z"),
    });

    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(graph.description).toBe("Deterministic badge graph reducer over the compact Stage Play source window.");
    expect(graph.sourceWindow.roomId).toBeNull();
    expect(graph.sourceWindow.latestSourceProducerRefs).toEqual([producer.producer_id]);
    expect(graph.sourceWindow.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "visual_source:live-answer",
        modality: "visual_frame",
        status: "active",
        selectedForStagePlay: true,
        cadenceMs: 10000,
        evidenceRefs: expect.arrayContaining([
          producer.producer_id,
          "live_source_chunk:live-answer",
        ]),
      }),
    ]));
    expect(graph.badges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "observer.live_sources",
        kind: "observer",
        status: "observed",
      }),
      expect.objectContaining({
        kind: "source",
        subjects: ["visual_source:live-answer"],
        evidenceRefs: expect.arrayContaining([producer.producer_id]),
      }),
      expect.objectContaining({
        id: "compact_observation.latest",
        kind: "compact_observation",
      }),
      expect.objectContaining({
        id: "source.visual_frame.active",
        kind: "source",
      }),
      expect.objectContaining({
        id: "compact_observation.latest_visual",
        kind: "compact_observation",
      }),
      expect.objectContaining({
        id: "interpreter.visual_scene",
        kind: "interpreter",
      }),
      expect.objectContaining({
        id: "possibilities.current",
        kind: "procedural_binding",
      }),
      expect.objectContaining({
        id: "perturbation.latest",
        kind: "perturbation",
      }),
      expect.objectContaining({
        id: "checkpoint_request.queued",
        kind: "checkpoint_request",
      }),
      expect.objectContaining({
        id: "stage_interpretation.current",
        kind: "stage_interpretation",
      }),
      expect.objectContaining({
        id: "procedural_binding.active",
        kind: "procedural_binding",
      }),
      expect.objectContaining({
        id: "helix_ask.checkpoint.latest",
        kind: "helix_ask_checkpoint",
        status: "missing_evidence",
        checkpoint: expect.objectContaining({
          modelReviewed: false,
        }),
        dataTray: expect.objectContaining({
          summary: "No answer snapshot yet.",
        }),
      }),
      expect.objectContaining({
        id: "answer_snapshot.latest",
        kind: "answer_snapshot",
        status: "missing_evidence",
      }),
      expect.objectContaining({
        id: "live_output.current",
        kind: "live_output",
        status: "missing_evidence",
        output: expect.objectContaining({
          state: "stale",
          voiceEligible: false,
        }),
      }),
      expect.objectContaining({
        kind: "checkpoint_request",
        status: "ask_user_required",
        sourceRefs: expect.arrayContaining([
          expect.objectContaining({
            kind: "stage_play_checkpoint_request",
          }),
        ]),
      }),
      expect.objectContaining({
        id: "workstation_state_plane.current",
        kind: "workstation_state_plane",
        status: "observed",
        reasonCodes: expect.arrayContaining(["workstation_state_plane", "process_graph_reflection"]),
      }),
      expect.objectContaining({
        id: "workstation_state_plane.microdeck_buffer",
        kind: "workstation_state_plane",
        status: "observed",
        dataTray: expect.objectContaining({
          transformLabel: "MicroDeck prompt/run buffer",
          summary: expect.stringMatching(/\d+ prompt\(s\), \d+ run\(s\), \d+ processed packet\(s\)\./),
        }),
      }),
      expect.objectContaining({
        id: "workstation_state_plane.gates",
        kind: "workstation_state_plane",
        missingEvidence: expect.arrayContaining([
          "A fresh model-reviewed checkpoint is needed before output lanes can be upheld as current.",
        ]),
      }),
      expect.objectContaining({
        id: "workstation_state_plane.output_bus",
        kind: "workstation_state_plane",
        dataTray: expect.objectContaining({
          transformLabel: "authority-gated output projection",
          outputRefs: expect.arrayContaining(["answer_snapshot.latest", "live_output.current"]),
        }),
      }),
    ]));
    const sourceNode = graph.badges.find((badge) => badge.id === "source.visual_frame.active");
    expect(sourceNode?.dataTray).toEqual(expect.objectContaining({
      inputRefs: ["visual_source:live-answer"],
      transformLabel: "Visual frame producer / source descriptor",
      outputRefs: expect.arrayContaining([frame.frame_id]),
      outputPreview: expect.stringContaining(frame.frame_id),
    }));
    const visualEvidenceNode = graph.badges.find((badge) => badge.id === "compact_observation.latest_visual");
    expect(visualEvidenceNode?.dataTray).toEqual(expect.objectContaining({
      inputRefs: expect.arrayContaining([frame.frame_id]),
      transformLabel: "visual frame analyze -> compact evidence",
      outputRefs: expect.arrayContaining([evidence.evidence_id]),
      outputPreview: expect.stringContaining("Minecraft-like scene"),
    }));
    const interpreterNode = graph.badges.find((badge) => badge.id === "interpreter.visual_scene");
    expect(interpreterNode?.dataTray).toEqual(expect.objectContaining({
      inputRefs: expect.arrayContaining([evidence.evidence_id]),
      transformLabel: "reflect_stage_play_context",
      outputRefs: expect.arrayContaining([graph.graphId]),
      outputPreview: expect.stringMatching(/graph badges: \d+; affordances: \d+; blocked: \d+/),
    }));
    const answerSnapshotNode = graph.badges.find((badge) => badge.id === "answer_snapshot.latest");
    expect(answerSnapshotNode?.dataTray).toEqual(expect.objectContaining({
      inputRefs: expect.arrayContaining(["helix_ask.checkpoint.latest"]),
      outputPreview: "No answer snapshot yet.",
      blockedUntil: "model-reviewed Helix Ask checkpoint",
    }));
    const liveOutputNode = graph.badges.find((badge) => badge.id === "live_output.current");
    expect(liveOutputNode?.dataTray).toEqual(expect.objectContaining({
      transformLabel: "output lane reducer",
      outputRefs: ["risk", "possibilities", "unknowns", "next_check"],
      skipped: ["recommendation", "answer_snapshot", "voice_output"],
    }));
    const checkpointRequestNode = graph.badges.find((badge) => badge.id === "checkpoint_request.queued");
    expect(checkpointRequestNode?.dataTray).toEqual(expect.objectContaining({
      transformLabel: "checkpoint request queue",
      outputRefs: expect.arrayContaining([expect.stringMatching(/^stage_play_checkpoint_request:/)]),
      outputPreview: expect.stringContaining("status: queued"),
    }));
    expect(graph.checkpointRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifactId: "stage_play_checkpoint_request",
        reason: "first_usable_observation",
        status: "queued",
        assistant_answer: false,
        context_role: "tool_evidence",
      }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: "observer.live_sources",
        to: "source.visual_frame.active",
        relation: "feeds",
      }),
      expect.objectContaining({
        from: "source.visual_frame.active",
        to: "compact_observation.latest_visual",
        relation: "feeds",
      }),
      expect.objectContaining({
        from: "compact_observation.latest_visual",
        to: "interpreter.visual_scene",
        relation: "feeds",
      }),
      expect.objectContaining({
        from: "possibilities.current",
        to: "checkpoint_request.queued",
        relation: "recommends",
      }),
      expect.objectContaining({
        from: "checkpoint_request.queued",
        to: "helix_ask.checkpoint.latest",
        relation: "needs_check",
      }),
      expect.objectContaining({
        from: "observer.live_sources",
        to: "compact_observation.latest",
        relation: "feeds",
      }),
      expect.objectContaining({
        from: "helix_ask.checkpoint.latest",
        to: "answer_snapshot.latest",
        relation: "produces",
      }),
      expect.objectContaining({
        from: "answer_snapshot.latest",
        to: "live_output.current",
        relation: "produces",
      }),
      expect.objectContaining({
        from: "workstation_state_plane.current",
        to: "workstation_state_plane.source_bus",
        relation: "contains",
      }),
      expect.objectContaining({
        from: "workstation_state_plane.microdeck_buffer",
        to: "interpreter.stage_play_reflection",
        relation: "feeds",
      }),
      expect.objectContaining({
        from: "workstation_state_plane.gates",
        to: "workstation_state_plane.output_bus",
        relation: "constrains",
      }),
    ]));
  });

  it("renders individual processed-mail packet circuits for separate MicroDeck routes", () => {
    upsertLiveSourceProducer({
      sourceId: "visual_source:packet-circuit",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 5000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:visual-packet",
      now: "2026-06-02T12:20:00.000Z",
    });
    upsertLiveSourceProducer({
      sourceId: "audio_transcript:packet-circuit",
      threadId,
      modality: "audio_transcript",
      status: "active",
      cadenceMs: 3000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:audio-packet",
      now: "2026-06-02T12:20:01.000Z",
    });

    recordStagePlayMicroReasonerRun({
      artifactId: "stage_play_micro_reasoner_run",
      schemaVersion: "stage_play_micro_reasoner_run/v1",
      runId: "stage_play_micro_reasoner_run:visual-shade",
      promptId: "stage_play_micro_reasoner_prompt:claim_extractor:v1",
      deckPresetId: "stage_play_micro_reasoner_prompt_preset:science-visual:v1",
      deckPresetTitle: "Science visual",
      deckRunPlan: "baseline_plus_prompted",
      deckRoleIndex: 1,
      deckRoleCount: 2,
      deckExecutionMode: "independent",
      deckProductRole: false,
      role: "claim_extractor",
      jobId: "stage_play_mail_job:visual-shade",
      sourceId: "visual_source:packet-circuit",
      mailIds: ["stage_play_live_source_mail:visual-shade"],
      inputRefs: ["stage_play_live_source_mail:visual-shade", "visual_frame:shade"],
      outputRefs: ["microdeck_output:visual-shade:claims"],
      evidenceRefs: ["microdeck_evidence:visual-shade-extra"],
      goalContextUpdateRefs: ["stage_play_goal_context_update:microdeck:visual-shade"],
      inputPreview: "Live Answer screen packet with shade preset output.",
      outputPreview: "Shade preset appears active and routes back to visual capture.",
      status: "completed",
      reasoningMode: "micro_live_interval",
      selectedDecision: "record_interpretation",
      salienceLevel: "medium",
      voiceCandidate: false,
      confidence: "high",
      startedAt: "2026-06-02T12:20:02.000Z",
      completedAt: "2026-06-02T12:20:03.000Z",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "micro_reasoner_evidence",
    });
    recordStagePlayMicroReasonerRun({
      artifactId: "stage_play_micro_reasoner_run",
      schemaVersion: "stage_play_micro_reasoner_run/v1",
      runId: "stage_play_micro_reasoner_run:audio-translation",
      promptId: "stage_play_micro_reasoner_prompt:earbud-translate-english:packet_composer:v1",
      deckPresetId: "stage_play_micro_reasoner_prompt_preset:earbud-translate-english:v1",
      deckPresetTitle: "Earbud translate English",
      deckRunPlan: "minimal_prompted_arbiter",
      deckRoleIndex: 1,
      deckRoleCount: 1,
      deckExecutionMode: "independent",
      deckProductRole: true,
      role: "packet_composer",
      jobId: "stage_play_mail_job:audio-translation",
      sourceId: "audio_transcript:packet-circuit",
      mailIds: ["stage_play_live_source_mail:audio-translation"],
      inputRefs: ["stage_play_live_source_mail:audio-translation", "audio_chunk:translation"],
      outputRefs: ["microdeck_output:audio-translation:text"],
      inputPreview: "Earbud transcript packet needing translation.",
      outputPreview: "Translated text is ready for the Live Answer output lane.",
      status: "completed",
      reasoningMode: "micro_live_interval",
      selectedDecision: "draft_text_answer",
      salienceLevel: "high",
      voiceCandidate: true,
      confidence: "high",
      startedAt: "2026-06-02T12:20:04.000Z",
      completedAt: "2026-06-02T12:20:05.000Z",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "micro_reasoner_evidence",
    });
    recordStagePlayProcessedMailPacket({
      artifactId: "stage_play_processed_mail_packet",
      schemaVersion: "stage_play_processed_mail_packet/v1",
      packetId: "stage_play_processed_mail_packet:visual-shade",
      jobId: "stage_play_mail_job:visual-shade",
      sourceId: "visual_source:packet-circuit",
      mailIds: ["stage_play_live_source_mail:visual-shade"],
      visualEvidenceRefs: ["visual_frame:shade"],
      observedFacts: ["Shade preset output is visible in Live Answer."],
      inferredFacts: ["The visual packet route can return to the visual capture source."],
      uncertainties: [],
      stableFactsUsed: ["visual source active"],
      changedFacts: ["shade preset changed"],
      sceneTags: ["live_answer"],
      activityTags: ["shade_preset"],
      objectTags: ["screen"],
      matchedCriteria: ["visual_source_packet"],
      suppressedCriteria: [],
      riskMatches: [],
      opportunityMatches: ["debug_packet_route"],
      voiceCalloutMatches: [],
      salience: {
        level: "medium",
        reasons: ["visual output changed"],
        voiceCandidate: false,
      },
      recommendedNext: "record_interpretation",
      watchNext: ["visual capture source"],
      resolutionState: "processed_packet_ready",
      microReasonerRunRefs: ["stage_play_micro_reasoner_run:visual-shade"],
      evidenceRefs: ["stage_play_processed_mail_packet:visual-shade", "microdeck_output:visual-shade:claims"],
      createdAt: "2026-06-02T12:20:06.000Z",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
    });
    recordStagePlayProcessedMailPacket({
      artifactId: "stage_play_processed_mail_packet",
      schemaVersion: "stage_play_processed_mail_packet/v1",
      packetId: "stage_play_processed_mail_packet:audio-translation",
      jobId: "stage_play_mail_job:audio-translation",
      sourceId: "audio_transcript:packet-circuit",
      mailIds: ["stage_play_live_source_mail:audio-translation"],
      visualEvidenceRefs: [],
      observedFacts: ["Earbud transcript packet is available."],
      inferredFacts: ["The audio route can produce text without crossing the visual packet route."],
      uncertainties: ["translation should stay marked as projection until reviewed"],
      stableFactsUsed: ["audio transcript source active"],
      changedFacts: ["new transcript chunk"],
      sceneTags: ["live_answer"],
      activityTags: ["translation"],
      objectTags: ["earbuds"],
      matchedCriteria: ["audio_translation_packet"],
      suppressedCriteria: [],
      riskMatches: [],
      opportunityMatches: ["debug_independent_packet_route"],
      voiceCalloutMatches: ["translation_candidate"],
      salience: {
        level: "high",
        reasons: ["translation requested"],
        voiceCandidate: true,
        calloutDraft: "Translation ready.",
      },
      recommendedNext: "draft_text_answer",
      watchNext: ["audio transcript source"],
      resolutionState: "ask_decision_needed",
      microReasonerRunRefs: ["stage_play_micro_reasoner_run:audio-translation"],
      evidenceRefs: ["stage_play_processed_mail_packet:audio-translation", "microdeck_output:audio-translation:text"],
      createdAt: "2026-06-02T12:20:07.000Z",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
    });

    const graph = buildStagePlayGraphFromWorld({
      threadId,
      now: new Date("2026-06-02T12:20:10.000Z"),
    });

    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    const packetBadges = graph.badges.filter((badge) => badge.tags.includes("processed_mail_packet"));
    const runBadges = graph.badges.filter((badge) => badge.tags.includes("microdeck_run"));
    const promptBadges = graph.badges.filter((badge) => badge.tags.includes("microdeck_prompt"));
    expect(packetBadges).toHaveLength(2);
    expect(runBadges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subjects: expect.arrayContaining(["stage_play_micro_reasoner_run:visual-shade"]),
      }),
      expect.objectContaining({
        subjects: expect.arrayContaining(["stage_play_micro_reasoner_run:audio-translation"]),
      }),
    ]));
    expect(promptBadges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subjects: expect.arrayContaining(["stage_play_micro_reasoner_prompt:claim_extractor:v1"]),
      }),
      expect.objectContaining({
        subjects: expect.arrayContaining(["stage_play_micro_reasoner_prompt:earbud-translate-english:packet_composer:v1"]),
      }),
    ]));

    const visualPacket = packetBadges.find((badge) =>
      badge.subjects.includes("stage_play_processed_mail_packet:visual-shade")
    );
    const audioPacket = packetBadges.find((badge) =>
      badge.subjects.includes("stage_play_processed_mail_packet:audio-translation")
    );
    const visualRun = runBadges.find((badge) =>
      badge.subjects.includes("stage_play_micro_reasoner_run:visual-shade")
    );
    const audioRun = runBadges.find((badge) =>
      badge.subjects.includes("stage_play_micro_reasoner_run:audio-translation")
    );

    expect(visualPacket?.dataTray).toEqual(expect.objectContaining({
      transformLabel: "source mail -> MicroDeck packet circuit",
      inputRefs: expect.arrayContaining(["visual_source:packet-circuit", "stage_play_live_source_mail:visual-shade"]),
      outputPreview: expect.stringContaining("recommended: record_interpretation"),
    }));
    expect(audioPacket?.dataTray).toEqual(expect.objectContaining({
      blockedUntil: "route authority / checkpoint gate",
      inputRefs: expect.arrayContaining(["audio_transcript:packet-circuit", "stage_play_live_source_mail:audio-translation"]),
      outputPreview: expect.stringContaining("recommended: draft_text_answer"),
    }));
    expect(visualRun).toEqual(expect.objectContaining({
      evidenceRefs: expect.arrayContaining([
        "stage_play_micro_reasoner_run:visual-shade",
        "stage_play_live_source_mail:visual-shade",
        "visual_frame:shade",
        "microdeck_output:visual-shade:claims",
        "microdeck_evidence:visual-shade-extra",
        "stage_play_goal_context_update:microdeck:visual-shade",
      ]),
      dataTray: expect.objectContaining({
        evidenceRefs: expect.arrayContaining([
          "microdeck_evidence:visual-shade-extra",
          "stage_play_goal_context_update:microdeck:visual-shade",
        ]),
      }),
    }));
    expect(audioRun?.dataTray).toEqual(expect.objectContaining({
      evidenceRefs: expect.arrayContaining([
        "stage_play_micro_reasoner_run:audio-translation",
        "stage_play_live_source_mail:audio-translation",
        "audio_chunk:translation",
        "microdeck_output:audio-translation:text",
      ]),
    }));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: "workstation_state_plane.source_bus",
        to: visualPacket?.id,
        relation: "feeds",
      }),
      expect.objectContaining({
        from: "workstation_state_plane.source_bus",
        to: audioPacket?.id,
        relation: "feeds",
      }),
      expect.objectContaining({
        from: visualRun?.id,
        to: visualPacket?.id,
        relation: "produces",
      }),
      expect.objectContaining({
        from: audioRun?.id,
        to: audioPacket?.id,
        relation: "produces",
      }),
      expect.objectContaining({
        from: audioPacket?.id,
        to: "workstation_state_plane.gates",
        relation: "needs_check",
      }),
      expect.objectContaining({
        from: audioPacket?.id,
        to: "workstation_state_plane.output_bus",
        relation: "feeds",
      }),
    ]));
  });

  it("applies source route overrides across later room and environment binding", () => {
    const producer = upsertLiveSourceProducer({
      sourceId: "visual_source:route-fallback",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:route-fallback",
      now: "2026-06-02T12:09:55.000Z",
    });
    const override = upsertStagePlaySourceRouteOverride({
      threadId,
      sourceId: "visual_source:route-fallback",
      modality: "visual_frame",
      routeTo: "narrative_stage_play",
      selectedForStagePlay: true,
      evidenceRefs: ["ui:source-route"],
      now: "2026-06-02T12:09:56.000Z",
    });

    const graph = buildStagePlayGraphFromWorld({
      threadId,
      roomId,
      environmentId: "live_env:route-fallback",
      sourceId: "visual_source:route-fallback",
      now: new Date("2026-06-02T12:10:00.000Z"),
    });

    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(graph.sourceWindow.latestSourceProducerRefs).toEqual([producer.producer_id]);
    expect(graph.sourceWindow.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "visual_source:route-fallback",
        modality: "visual_frame",
        status: "active",
        routeTo: "narrative_stage_play",
        selectedForStagePlay: true,
        evidenceRefs: expect.arrayContaining([
          producer.producer_id,
          override.overrideId,
          "ui:source-route",
        ]),
      }),
    ]));
    expect(graph.badges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "binding.scene_checkpoint",
        kind: "procedural_binding",
      }),
      expect.objectContaining({
        id: "binding.narrative_context_gap",
        kind: "procedural_binding",
      }),
    ]));
    expect(graph.recommendedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "stage-action:attach-audio-transcript",
        admission: "auto",
        agentExecutable: false,
      }),
    ]));
  });

  it("prioritizes current-graph checkpoint requests over stale queued requests", () => {
    recordLiveSourceObservation({
      schema: "helix.live_source_observation.v1",
      observation_id: "live_source_observation:checkpoint-old",
      thread_id: threadId,
      room_id: roomId,
      environment_id: "env:checkpoint-priority",
      source_id: "source:visual-checkpoint",
      source_kind: "screen_capture",
      event_kind: "visual_summary",
      observed_at: "2026-06-02T12:15:00.000Z",
      freshness: { status: "fresh", age_ms: 0 },
      provenance: { adapter: "browser.visual", confidence: "medium" },
      compact_summary: "Old visual frame shows the opening scene.",
      payload_summary: { visual: { scene_summary: "Opening scene.", confidence: "medium" } },
      evidence_refs: ["visual_evidence:checkpoint-old"],
      assistant_answer: false,
      raw_content_included: false,
    });
    upsertLiveSourceDescriptor({
      source_id: "source:visual-checkpoint",
      thread_id: threadId,
      environment_id: "env:checkpoint-priority",
      modality: "visual_frame",
      user_label: "Checkpoint visual tab",
      serving_context: { surface: "browser_tab", source_origin: "browser_getDisplayMedia" },
      current_state: "active",
      cadence_ms: 10000,
      latest_observation_refs: ["live_source_observation:checkpoint-old"],
    });
    upsertLiveSourceProducer({
      sourceId: "source:visual-checkpoint",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:checkpoint-old",
      now: "2026-06-02T12:15:00.500Z",
    });

    const oldGraph = buildStagePlayGraphFromWorld({
      threadId,
      roomId,
      environmentId: "env:checkpoint-priority",
      objective: "track scene checkpoint priority",
      now: new Date("2026-06-02T12:15:01.000Z"),
    });
    const oldRequest = oldGraph.checkpointRequests[0];
    expect(oldRequest?.graphId).toBe(oldGraph.graphId);

    recordLiveSourceObservation({
      schema: "helix.live_source_observation.v1",
      observation_id: "live_source_observation:checkpoint-current",
      thread_id: threadId,
      room_id: roomId,
      environment_id: "env:checkpoint-priority",
      source_id: "source:visual-checkpoint",
      source_kind: "screen_capture",
      event_kind: "visual_summary",
      observed_at: "2026-06-02T12:15:10.000Z",
      freshness: { status: "fresh", age_ms: 0 },
      provenance: { adapter: "browser.visual", confidence: "high" },
      compact_summary: "Current visual frame changes the scene.",
      payload_summary: { visual: { scene_summary: "Scene changed.", confidence: "high" } },
      evidence_refs: ["visual_evidence:checkpoint-current"],
      assistant_answer: false,
      raw_content_included: false,
    });
    upsertLiveSourceDescriptor({
      source_id: "source:visual-checkpoint",
      thread_id: threadId,
      environment_id: "env:checkpoint-priority",
      modality: "visual_frame",
      user_label: "Checkpoint visual tab",
      serving_context: { surface: "browser_tab", source_origin: "browser_getDisplayMedia" },
      current_state: "active",
      cadence_ms: 10000,
      latest_observation_refs: ["live_source_observation:checkpoint-current"],
    });
    upsertLiveSourceProducer({
      sourceId: "source:visual-checkpoint",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:checkpoint-current",
      now: "2026-06-02T12:15:10.500Z",
    });
    upsertStagePlaySourceRouteOverride({
      threadId,
      roomId,
      environmentId: "env:checkpoint-priority",
      sourceId: "source:visual-checkpoint",
      modality: "visual_frame",
      routeTo: "narrative_stage_play",
      selectedForStagePlay: true,
      evidenceRefs: ["visual_evidence:checkpoint-current"],
      now: "2026-06-02T12:15:10.750Z",
    });

    const currentGraph = buildStagePlayGraphFromWorld({
      threadId,
      roomId,
      environmentId: "env:checkpoint-priority",
      objective: "track scene checkpoint priority",
      now: new Date("2026-06-02T12:15:11.000Z"),
    });
    const currentRequest = currentGraph.checkpointRequests[0];
    const stableCheckpointBadge = currentGraph.badges.find((badge) => badge.id === "checkpoint_request.queued");

    expect(validateStagePlayBadgeGraphV1(currentGraph)).toEqual([]);
    expect(currentRequest?.graphId).toBe(currentGraph.graphId);
    expect(currentRequest?.checkpointRequestId).not.toBe(oldRequest?.checkpointRequestId);
    expect(stableCheckpointBadge?.evidenceRefs).toEqual(expect.arrayContaining([
      currentRequest?.checkpointRequestId,
    ]));
    expect(stableCheckpointBadge?.evidenceRefs).not.toContain(oldRequest?.checkpointRequestId);
  });

  it("marks the Ask checkpoint as model reviewed only with a completed Ask receipt", () => {
    const producer = upsertLiveSourceProducer({
      sourceId: "visual_source:live-answer",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:live-answer",
      now: "2026-06-02T12:09:55.000Z",
    });

    const graph = buildStagePlayGraphFromWorld({
      threadId,
      now: new Date("2026-06-02T12:10:00.000Z"),
      askCheckpointReceipt: {
        askTurnId: "ask:turn:stage-play",
        solverTraceRef: "ask_turn_solver_trace:stage-play",
        terminalArtifactKind: "model_synthesized_answer",
        finalAnswerSource: "final_answer_draft",
        completedSolverPath: true,
        answerText: "The next useful check is to compare the next visual frame and attach audio.",
        evidenceRefs: [producer.producer_id, "ask_turn_solver_trace:stage-play"],
      },
    });

    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(graph.badges.find((badge) => badge.id === "helix_ask.checkpoint.latest")).toMatchObject({
      kind: "helix_ask_checkpoint",
      status: "observed",
      checkpoint: {
        askTurnId: "ask:turn:stage-play",
        solverTraceRef: "ask_turn_solver_trace:stage-play",
        terminalArtifactKind: "model_synthesized_answer",
        finalAnswerSource: "final_answer_draft",
        modelReviewed: true,
      },
      dataTray: expect.objectContaining({
        summary: "Model-reviewed checkpoint is available for this stage.",
      }),
    });
    expect(graph.badges.find((badge) => badge.id === "answer_snapshot.latest")).toMatchObject({
      kind: "answer_snapshot",
      status: "observed",
      output: expect.objectContaining({
        text: "The next useful check is to compare the next visual frame and attach audio.",
        state: "model_reviewed",
        voiceEligible: false,
      }),
    });
    expect(graph.badges.find((badge) => badge.id === "live_output.current")).toMatchObject({
      kind: "live_output",
      status: "observed",
      output: expect.objectContaining({
        state: "model_reviewed",
        voiceEligible: false,
      }),
    });
    expect(graph.badges.find((badge) => badge.id === "voice_output.current")).toBeUndefined();
  });

  it("re-enters the latest stored Ask checkpoint receipt when rebuilding the graph", () => {
    const producer = upsertLiveSourceProducer({
      sourceId: "visual_source:live-answer",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:live-answer",
      now: "2026-06-02T12:09:55.000Z",
    });

    recordStagePlayAskCheckpointReceipt({
      threadId,
      askTurnId: "ask:turn:stored-stage-play",
      solverTraceRef: "ask:turn:stored-stage-play:ask_turn_solver_trace",
      terminalArtifactKind: "model_synthesized_answer",
      finalAnswerSource: "final_answer_draft",
      completedSolverPath: true,
      answerText: "Stage Play projected the current risk and next check from the active source.",
      evidenceRefs: [producer.producer_id, "ask:turn:stored-stage-play:final_answer_draft"],
      sourceArtifactRefs: ["ask:turn:stored-stage-play:live_env_tool_observation"],
      createdAt: "2026-06-02T12:10:05.000Z",
    });

    const graph = buildStagePlayGraphFromWorld({
      threadId,
      now: new Date("2026-06-02T12:10:06.000Z"),
    });

    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(graph.badges.find((badge) => badge.id === "helix_ask.checkpoint.latest")).toMatchObject({
      status: "observed",
      checkpoint: {
        askTurnId: "ask:turn:stored-stage-play",
        modelReviewed: true,
      },
    });
    expect(graph.badges.find((badge) => badge.id === "answer_snapshot.latest")).toMatchObject({
      status: "observed",
      output: expect.objectContaining({
        state: "model_reviewed",
        text: "Stage Play projected the current risk and next check from the active source.",
      }),
    });
  });

  it("does not attach a stored Ask checkpoint after a newer source observation", () => {
    const producer = upsertLiveSourceProducer({
      sourceId: "visual_source:live-answer",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:live-answer",
      now: "2026-06-02T12:09:55.000Z",
    });

    recordStagePlayAskCheckpointReceipt({
      threadId,
      askTurnId: "ask:turn:stale-stage-play",
      solverTraceRef: "ask:turn:stale-stage-play:ask_turn_solver_trace",
      terminalArtifactKind: "model_synthesized_answer",
      finalAnswerSource: "final_answer_draft",
      completedSolverPath: true,
      answerText: "This checkpoint should be stale after the next source event.",
      evidenceRefs: [producer.producer_id, "ask:turn:stale-stage-play:final_answer_draft"],
      sourceArtifactRefs: ["ask:turn:stale-stage-play:live_env_tool_observation"],
      createdAt: "2026-06-02T12:10:05.000Z",
    });
    recordLiveSourceObservation({
      schema: "helix.live_source_observation.v1",
      observation_id: "live_source_observation:stage-play-after-checkpoint",
      thread_id: threadId,
      room_id: null,
      environment_id: null,
      source_id: "visual_source:live-answer",
      source_kind: "visual_frame",
      event_kind: "visual_frame",
      observed_at: "2026-06-02T12:10:06.000Z",
      freshness: { status: "fresh", age_ms: 20 },
      provenance: { adapter: "browser_capture", confidence: "high" },
      compact_summary: "New visual frame after checkpoint.",
      evidence_refs: ["evidence:visual-after-checkpoint"],
      assistant_answer: false,
      raw_content_included: false,
    });

    const graph = buildStagePlayGraphFromWorld({
      threadId,
      now: new Date("2026-06-02T12:10:07.000Z"),
    });

    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(graph.badges.find((badge) => badge.id === "helix_ask.checkpoint.latest")).toMatchObject({
      status: "missing_evidence",
      checkpoint: expect.objectContaining({
        modelReviewed: false,
      }),
      reasonCodes: expect.arrayContaining(["checkpoint_freshness_checkpoint_expired"]),
      dataTray: expect.objectContaining({
        summary: "No current model-reviewed checkpoint.",
      }),
    });
    expect(graph.badges.find((badge) => badge.id === "answer_snapshot.latest")).toMatchObject({
      status: "missing_evidence",
      output: expect.objectContaining({
        state: "stale",
        text: "No current model-reviewed checkpoint.",
      }),
    });
  });

  it("emits policy-gated voice output when the Ask checkpoint receipt allows voice", () => {
    const producer = upsertLiveSourceProducer({
      sourceId: "visual_source:live-answer",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:live-answer",
      now: "2026-06-02T12:09:55.000Z",
    });

    const graph = buildStagePlayGraphFromWorld({
      threadId,
      now: new Date("2026-06-02T12:10:00.000Z"),
      askCheckpointReceipt: {
        askTurnId: "ask:turn:stage-play",
        solverTraceRef: "ask_turn_solver_trace:stage-play",
        terminalArtifactKind: "model_synthesized_answer",
        finalAnswerSource: "final_answer_draft",
        completedSolverPath: true,
        answerText: "Keep observing the visual source and attach audio before prediction.",
        evidenceRefs: [producer.producer_id, "ask_turn_solver_trace:stage-play"],
        voicePolicy: {
          voiceEligible: true,
          evidenceRefs: ["voice_policy:stage-play"],
          reasonCodes: ["explicit_voice_policy_allowed"],
        },
      },
    });

    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(graph.badges.find((badge) => badge.id === "voice_output.current")).toMatchObject({
      kind: "voice_output",
      status: "observed",
      tags: expect.arrayContaining(["voice_policy"]),
      reasonCodes: expect.arrayContaining(["explicit_voice_policy", "voice_cites_answer_snapshot"]),
      evidenceRefs: expect.arrayContaining(["answer_snapshot.latest", "voice_policy:stage-play"]),
      output: expect.objectContaining({
        lineKey: "voice_output",
        state: "model_reviewed",
        voiceEligible: true,
      }),
    });
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: "answer_snapshot.latest",
        to: "voice_output.current",
        relation: "produces",
      }),
    ]));
  });

  it("assembles world facts into deterministic Stage Play badges and procedural bindings", () => {
    const snapshot = normalizeEnvironmentStateSnapshot({
      threadId,
      snapshot: {
        snapshot_id: "snapshot:stage-play-reducer",
        domain: "minecraft",
        domain_adapter: "minecraft.adapter.v1",
        room_id: roomId,
        world_id: worldId,
        source_id: "source:minecraft-server",
        actor_id: "player:datdampig",
        actor_label: "DatDamPig",
        ts: "2026-06-02T12:10:00.000Z",
        actor_state: {
          pose: { position: { x: 10, y: 64, z: 10 }, facing: "north" },
          health: 6,
        },
        inventory_state: {
          selected_item: { item_type: "minecraft:shield", count: 1 },
          carried_items: [
            { item_type: "minecraft:cobblestone", count: 32 },
          ],
          equipped_items: [
            { item_type: "minecraft:shield", count: 1 },
          ],
        },
        object_state: {
          nearby_entities: [
            {
              object_ref: "entity:creeper:1",
              object_type: "minecraft:creeper",
              distance: 5,
              tags: ["hostile"],
              classification: ["hostile"],
            },
            {
              object_ref: "entity:zombie:1",
              object_type: "minecraft:zombie",
              distance: 8,
              tags: ["hostile"],
            },
          ],
          nearby_containers: [
            {
              container_ref: "container:chest:1",
              container_type: "minecraft:chest",
              contents_known: false,
            },
          ],
        },
        local_map: {
          radius: 4,
          salient_cells: [
            {
              cell_ref: "cell:walkable",
              cell_type: "minecraft:end_stone",
              position: { x: 10, y: 63, z: 11 },
              tags: ["walkable", "traversable"],
            },
            {
              cell_ref: "cell:door",
              cell_type: "minecraft:oak_door",
              position: { x: 11, y: 64, z: 10 },
              tags: ["door"],
            },
          ],
          map_hash: "local-map-hash",
          changed_since_last_snapshot: true,
        },
        chunk_snapshot_summary: {
          sampled_radius_chunks: 1,
          loaded_chunks_sampled: 3,
          surface_cells: [
            { cell_ref: "cell:surface", cell_type: "minecraft:end_stone", tags: ["walkable"] },
          ],
          route_corridor_cells: [
            { cell_ref: "cell:route", cell_type: "minecraft:cobblestone", tags: ["route_corridor", "bridge_like", "traversable"] },
          ],
          gateway_blocks: [
            { cell_ref: "cell:gateway", cell_type: "minecraft:end_gateway", tags: ["portal_or_gateway"] },
          ],
          bridge_like_blocks: [
            { cell_ref: "cell:bridge", cell_type: "minecraft:cobblestone", tags: ["bridge_like"] },
          ],
          hazard_cells: [
            { cell_ref: "cell:void", cell_type: "minecraft:air", tags: ["void_or_drop_risk"] },
            { cell_ref: "cell:lava", cell_type: "minecraft:lava", tags: ["lava", "hazard"] },
          ],
          map_hash: "chunk-map-hash",
          changed_since_last_snapshot: true,
          raw_chunk_included: false,
        },
        changed_sections: ["actor_state", "inventory_state", "object_state", "local_map", "chunk_snapshot_summary"],
        section_hashes: {
          actor_state: "actor",
          inventory_state: "inventory",
          object_state: "objects",
          local_map: "local-map-hash",
          chunk_snapshot_summary: "chunk-map-hash",
        },
        evidence_refs: ["evidence:snapshot"],
      },
    });
    expect(snapshot).not.toBeNull();
    ingestEnvironmentStateSnapshot(snapshot!);

    recordLiveSourceObservation({
      schema: "helix.live_source_observation.v1",
      observation_id: "live_source_observation:stage-play-reducer",
      thread_id: threadId,
      room_id: roomId,
      environment_id: "env:minecraft",
      source_id: "source:minecraft-server",
      source_kind: "minecraft_world_events",
      event_kind: "position_update",
      observed_at: "2026-06-02T12:10:01.000Z",
      freshness: { status: "fresh", age_ms: 20 },
      provenance: { adapter: "minecraft.plugin", confidence: "high" },
      compact_summary: "Position update.",
      evidence_refs: ["evidence:observation", snapshot!.snapshot_id],
      assistant_answer: false,
      raw_content_included: false,
    });
    const descriptor = upsertLiveSourceDescriptor({
      source_id: "source:minecraft-server",
      thread_id: threadId,
      environment_id: "env:minecraft",
      modality: "world_event",
      user_label: "Minecraft world events",
      serving_context: {
        surface: "game",
        source_origin: "minehut_plugin",
        app_hint: "Minecraft",
      },
      current_state: "active",
      cadence_ms: 1000,
      latest_observation_refs: ["live_source_observation:stage-play-reducer"],
    });
    const producer = upsertLiveSourceProducer({
      sourceId: "source:minecraft-server",
      threadId,
      modality: "world_event",
      status: "active",
      cadenceMs: 1000,
      captureMode: "push",
      latestChunkId: "live_source_chunk:minecraft-server",
      now: "2026-06-02T12:10:01.500Z",
    });

    const routeObservation: HelixMinecraftRouteSolverObservation = {
      schema: "helix.minecraft_route_solver_observation.v1",
      observation_id: "minecraft_route_solver_observation:reducer",
      room_id: roomId,
      world_id: worldId,
      actor_label: "DatDamPig",
      provider: "helix_chunk_graph",
      evidence_layer: "observed_current_world",
      evidence_trust: "server_observation",
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
      creates_ask_turn: false,
      turn_triggered: false,
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      raw_user_text_included: false,
      from: { dimension: "minecraft:the_end", x: 10, y: 64, z: 10 },
      target: {
        ask_context_admissible: false,
        dimension: "minecraft:the_end",
        x: 20,
        y: 64,
        z: 20,
        target_type: "end_gateway",
      },
      result_status: "partial_route",
      planner_observation_mode: "path_preview",
      planner_execution_state: "planning_only",
      planner_side_effect_risk: "none_observation_only",
      world_state_dependency: "server_observed",
      movement_requirements: ["walk", "bridge", "dig"],
      risk_flags: ["void_fall", "lava", "hostiles", "unknown_gateway"],
      provider_confidence: 0.72,
      confidence_basis: ["server_blocks"],
      missing_evidence_codes: ["unknown_gateway"],
      missing_evidence: ["Gateway destination is not confirmed."],
      evidence_refs: ["evidence:route-solver"],
      reported_by_provider: true,
      normalized_by_deterministic_reducer: true,
      model_invoked_by_helix: false,
      ts: "2026-06-02T12:10:02.000Z",
    };
    recordMinecraftRouteSolverObservation(routeObservation);

    const graph = buildStagePlayGraphFromWorld({
      threadId,
      roomId,
      environmentId: "env:minecraft",
      objective: "tunnel forward toward the gateway while avoiding the creeper",
      now: new Date("2026-06-02T12:10:03.000Z"),
    });
    const badgeIds = graph.badges.map((badge) => badge.id);

    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(badgeIds).toEqual(expect.arrayContaining([
      "observer.live_sources",
      expect.stringMatching(/^source\./),
      "interpreter.stage_play_reflection",
      "setting.end",
      "setting.local_map",
      "setting.route_corridor",
      "setting.tunnel",
      "setting.bridge",
      "setting.gateway_area",
      "actor.player",
      "actor.creeper.nearby",
      "actor.zombie.nearby",
      "resource.cobblestone.available",
      "resource.shield.equipped",
      "prop.door.nearby",
      "prop.gateway_block.visible",
      "prop.bridge_like_block.nearby",
      "hazard.lava_nearby",
      "hazard.void_drop",
      "hazard.hostile_nearby",
      "hazard.low_health",
      "hazard.fall_risk",
      "affordance.observe",
      "affordance.move_forward",
      "affordance.mine_block",
      "affordance.place_block",
      "affordance.bridge",
      "affordance.retreat",
      "affordance.equip_shield",
      "affordance.open_door",
      "affordance.enter_portal",
      "blocked.engage_close_range",
      "blocked.drop_down",
      "blocked.step_into_lava",
      "blocked.mine_without_escape",
      "blocked.path_unknown_chunk",
      "blocked.enter_gateway_unconfirmed",
      "intent.move_away",
      "intent.preserve_self",
      "intent.maintain_line_of_sight",
      "intent.place_block",
      "intent.preserve_floor",
      "intent.update_passability",
      "intent.replan_path",
      "binding.tactical_retreat_tracking_threat",
      "binding.bridge_forward",
      "binding.tunnel_advance",
      "binding.defensive_retreat_barrier",
      "compact_observation.latest",
      "stage_interpretation.current",
      "procedural_binding.active",
      "helix_ask.checkpoint.latest",
      "answer_snapshot.latest",
      "live_output.current",
    ]));
    const observerBadge = graph.badges.find((badge) => badge.id === "observer.live_sources");
    expect(observerBadge).toMatchObject({
      kind: "observer",
      admission: "auto",
    });
    expect(graph.summary.kindCounts.observer).toBe(1);
    expect(graph.sourceWindow.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "source:minecraft-server",
        status: "active",
        selectedForStagePlay: true,
        routeTo: "world_stage_play",
      }),
      expect.objectContaining({
        modality: "visual_frame",
        selectedForStagePlay: false,
        routeTo: "visual_context",
        nextRequiredAction: "Start visual interval",
      }),
      expect.objectContaining({
        modality: "audio_transcript",
        selectedForStagePlay: false,
        routeTo: "narrative_stage_play",
        nextRequiredAction: "Attach audio transcript",
      }),
    ]));
    expect(graph.sourceWindow.sourceRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "source:minecraft-server",
        modality: "world_event",
        routeTo: "world_stage_play",
        selected: true,
        freshness: "active",
      }),
      expect.objectContaining({
        modality: "visual_frame",
        routeTo: "visual_context",
        selected: false,
      }),
      expect.objectContaining({
        modality: "audio_transcript",
        routeTo: "narrative_stage_play",
        selected: false,
      }),
    ]));
    const sourceBadge = graph.badges.find((badge) => badge.kind === "source");
    expect(sourceBadge).toMatchObject({
      kind: "source",
      admission: "auto",
      subjects: ["source:minecraft-server"],
    });
    expect(sourceBadge?.sourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "live_source_descriptor", id: descriptor.descriptor_id }),
      expect.objectContaining({ kind: "live_source_producer", id: producer.producer_id }),
    ]));
    expect(graph.badges.find((badge) => badge.id === "interpreter.stage_play_reflection")).toMatchObject({
      kind: "interpreter",
      admission: "auto",
    });
    expect(graph.badges.find((badge) => badge.id === "procedural_binding.active")).toMatchObject({
      kind: "procedural_binding",
      status: "candidate",
      dataTray: expect.objectContaining({
        summary: "4 procedural binding(s) are available for review.",
      }),
    });
    expect(graph.badges.find((badge) => badge.id === "helix_ask.checkpoint.latest")).toMatchObject({
      kind: "helix_ask_checkpoint",
      status: "missing_evidence",
      checkpoint: expect.objectContaining({
        modelReviewed: false,
      }),
      dataTray: expect.objectContaining({
        summary: "No answer snapshot yet.",
      }),
    });
    expect(graph.badges.find((badge) => badge.id === "answer_snapshot.latest")).toMatchObject({
      kind: "answer_snapshot",
      status: "missing_evidence",
      output: expect.objectContaining({
        state: "stale",
        voiceEligible: false,
      }),
    });
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: "observes", from: "observer.live_sources" }),
      expect.objectContaining({ relation: "feeds", to: "interpreter.stage_play_reflection" }),
      expect.objectContaining({ relation: "feeds", from: "observer.live_sources", to: "interpreter.stage_play_reflection" }),
      expect.objectContaining({ relation: "interprets", from: "interpreter.stage_play_reflection", to: "actor.player" }),
      expect.objectContaining({ relation: "feeds", from: "observer.live_sources", to: "compact_observation.latest" }),
      expect.objectContaining({ relation: "feeds", from: "compact_observation.latest", to: "interpreter.stage_play_reflection" }),
      expect.objectContaining({ relation: "interprets", from: "interpreter.stage_play_reflection", to: "stage_interpretation.current" }),
      expect.objectContaining({ relation: "produces", from: "stage_interpretation.current", to: "procedural_binding.active" }),
      expect.objectContaining({ relation: "feeds", from: "procedural_binding.active", to: "helix_ask.checkpoint.latest" }),
      expect.objectContaining({ relation: "produces", from: "helix_ask.checkpoint.latest", to: "answer_snapshot.latest" }),
      expect.objectContaining({ relation: "produces", from: "answer_snapshot.latest", to: "live_output.current" }),
    ]));
    expect(graph.sourceWindow.latestSourceDescriptorRefs).toEqual([descriptor.descriptor_id]);
    expect(graph.sourceWindow.latestSourceProducerRefs).toEqual([producer.producer_id]);
    expect(graph.badges.find((badge) => badge.id === "binding.bridge_forward")?.plainMeaning).toContain(
      "intent.place_block + intent.preserve_floor + affordance.move_forward",
    );
    expect(graph.badges.find((badge) => badge.id === "blocked.enter_gateway_unconfirmed")).toMatchObject({
      kind: "blocked_affordance",
      admission: "blocked",
    });
    expect(graph.recommendedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "stage-action:defensive-retreat-barrier",
        actionType: "navigation_hint",
        admission: "ask_user",
        agentExecutable: false,
        reasonCodes: expect.arrayContaining([
          "live_world_hazard_nearby",
          "low_health_constraint",
          "requires_user_world_action",
        ]),
      }),
      expect.objectContaining({
        id: "stage-action:engage-close-range",
        actionType: "blocked_move_notice",
        admission: "blocked",
        agentExecutable: false,
        reasonCodes: expect.arrayContaining([
          "explosive_threat_nearby",
          "low_health_constraint",
        ]),
      }),
    ]));
    expect(graph.recommendedActions.every((action) => action.agentExecutable === false)).toBe(true);
    expect(graph.recommendedActions.map((action) => JSON.stringify(action)).join("\n")).not.toMatch(
      /baritone|pathmind|terminal|run_command|minecraft_movement_api|inventory_mutation|block_placement_api/i,
    );
    const admission = buildStagePlayRecommendedActionAdmissionV1({
      graph,
      prompt: "What should I do while low health near a creeper?",
    });
    expect(validateHelixRecommendedActionAdmissionV1(admission)).toEqual([]);
    expect(admission.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionId: "stage-action:defensive-retreat-barrier",
        admission: "ask_user",
        risk: "mutating",
        requiresConfirmation: true,
        agentExecutable: false,
        display_policy: "actionable",
      }),
      expect.objectContaining({
        actionId: "stage-action:engage-close-range",
        admission: "blocked",
        risk: "unknown",
        requiresConfirmation: true,
        agentExecutable: false,
        display_policy: "diagnostic_only",
      }),
    ]));
    expect(admission.actions.every((action) => action.agentExecutable === false)).toBe(true);
    expect(admission.authority.agent_executable).toBe(false);
    expect(graph.sourceWindow.latestObservationRefs).toEqual(["live_source_observation:stage-play-reducer"]);
    expect(graph.sourceWindow.latestSnapshotRefs).toEqual(["snapshot:stage-play-reducer"]);
    expect(graph.sourceWindow.latestNavigationRefs).toEqual(expect.arrayContaining([
      "minecraft_route_solver_observation:reducer",
      "chunk_snapshot_sample:snapshot:stage-play-reducer:chunk-map-hash",
    ]));
    expect(graph.authority.agent_executable).toBe(false);
    expect(JSON.stringify(graph)).not.toContain("raw_chunk");
    expect(JSON.stringify(graph)).not.toContain("raw_user_text");
  });

  it("adds routed fusion badges when active audio, visual, and world sources overlap", () => {
    const snapshot = normalizeEnvironmentStateSnapshot({
      threadId,
      snapshot: {
        snapshot_id: "snapshot:stage-play-fusion",
        domain: "minecraft",
        domain_adapter: "minecraft.adapter.v1",
        room_id: roomId,
        world_id: worldId,
        source_id: "source:minecraft-server",
        actor_id: "player:datdampig",
        actor_label: "DatDamPig",
        ts: "2026-06-02T13:00:00.000Z",
        actor_state: {
          pose: { position: { x: 0, y: 64, z: 0 }, facing: "east" },
          health: 20,
        },
        changed_sections: ["actor_state"],
        section_hashes: { actor_state: "actor-fusion" },
        evidence_refs: ["evidence:world-snapshot"],
      },
    });
    expect(snapshot).not.toBeNull();
    ingestEnvironmentStateSnapshot(snapshot!);

    recordLiveSourceObservation({
      schema: "helix.live_source_observation.v1",
      observation_id: "live_source_observation:visual-fusion",
      thread_id: threadId,
      room_id: roomId,
      environment_id: "env:fusion",
      source_id: "source:visual-tab",
      source_kind: "screen_capture",
      event_kind: "visual_summary",
      observed_at: "2026-06-02T13:00:01.000Z",
      freshness: { status: "fresh", age_ms: 10 },
      provenance: { adapter: "browser.visual", confidence: "high" },
      compact_summary: "Visual frame shows a command bridge.",
      payload_summary: { visual: { scene_summary: "Command bridge.", confidence: "high" } },
      evidence_refs: ["evidence:visual-frame"],
      assistant_answer: false,
      raw_content_included: false,
    });
    recordLiveSourceObservation({
      schema: "helix.live_source_observation.v1",
      observation_id: "live_source_observation:audio-fusion",
      thread_id: threadId,
      room_id: roomId,
      environment_id: "env:fusion",
      source_id: "source:browser-audio",
      source_kind: "browser_audio",
      event_kind: "transcript_segment",
      observed_at: "2026-06-02T13:00:02.000Z",
      freshness: { status: "fresh", age_ms: 10 },
      provenance: { adapter: "browser.audio", confidence: "high" },
      compact_summary: "Transcript mentions a commander delaying the order.",
      payload_summary: {
        transcript: {
          text: "The commander delays the order.",
          speaker_label: "Commander",
        },
      },
      evidence_refs: ["evidence:audio-transcript"],
      assistant_answer: false,
      raw_content_included: false,
    });
    recordLiveSourceObservation({
      schema: "helix.live_source_observation.v1",
      observation_id: "live_source_observation:world-fusion",
      thread_id: threadId,
      room_id: roomId,
      environment_id: "env:fusion",
      source_id: "source:minecraft-server",
      source_kind: "minecraft_world_events",
      event_kind: "position_update",
      observed_at: "2026-06-02T13:00:03.000Z",
      freshness: { status: "fresh", age_ms: 10 },
      provenance: { adapter: "minecraft.plugin", confidence: "high" },
      compact_summary: "World event reports player position.",
      evidence_refs: ["evidence:world-event", snapshot!.snapshot_id],
      assistant_answer: false,
      raw_content_included: false,
    });

    upsertLiveSourceDescriptor({
      source_id: "source:visual-tab",
      thread_id: threadId,
      environment_id: "env:fusion",
      modality: "visual_frame",
      user_label: "Browser tab visual",
      serving_context: {
        surface: "browser_tab",
        source_origin: "browser_getDisplayMedia",
      },
      current_state: "active",
      cadence_ms: 10000,
      latest_observation_refs: ["live_source_observation:visual-fusion"],
    });
    upsertLiveSourceDescriptor({
      source_id: "source:browser-audio",
      thread_id: threadId,
      environment_id: "env:fusion",
      modality: "audio_transcript",
      user_label: "Browser tab audio",
      serving_context: {
        surface: "browser_tab",
        source_origin: "browser_getDisplayMedia",
      },
      current_state: "active",
      cadence_ms: 10000,
      latest_observation_refs: ["live_source_observation:audio-fusion"],
    });
    upsertLiveSourceDescriptor({
      source_id: "source:minecraft-server",
      thread_id: threadId,
      environment_id: "env:fusion",
      modality: "world_event",
      user_label: "Minecraft world events",
      serving_context: {
        surface: "game",
        source_origin: "minehut_plugin",
      },
      current_state: "active",
      cadence_ms: 1000,
      latest_observation_refs: ["live_source_observation:world-fusion"],
    });

    upsertLiveSourceProducer({
      sourceId: "source:visual-tab",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:visual-fusion",
      now: "2026-06-02T13:00:01.500Z",
    });
    upsertLiveSourceProducer({
      sourceId: "source:browser-audio",
      threadId,
      modality: "audio_transcript",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:audio-fusion",
      now: "2026-06-02T13:00:02.500Z",
    });
    upsertLiveSourceProducer({
      sourceId: "source:minecraft-server",
      threadId,
      modality: "world_event",
      status: "active",
      cadenceMs: 1000,
      captureMode: "push",
      latestChunkId: "live_source_chunk:world-fusion",
      now: "2026-06-02T13:00:03.500Z",
    });

    const graph = buildStagePlayGraphFromWorld({
      threadId,
      roomId,
      environmentId: "env:fusion",
      objective: "track the active scene and the world state together",
      now: new Date("2026-06-02T13:00:05.000Z"),
    });

    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(graph.sourceWindow.sourceRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "source:visual-tab",
        modality: "visual_frame",
        routeTo: "visual_context",
        selected: true,
        freshness: "active",
      }),
      expect.objectContaining({
        sourceId: "source:browser-audio",
        modality: "audio_transcript",
        routeTo: "narrative_stage_play",
        selected: true,
        freshness: "active",
      }),
      expect.objectContaining({
        sourceId: "source:minecraft-server",
        modality: "world_event",
        routeTo: "world_stage_play",
        selected: true,
        freshness: "active",
      }),
    ]));
    expect(graph.badges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "fusion.audio_visual_scene",
        kind: "fusion",
        status: "observed",
        admission: "auto",
      }),
      expect.objectContaining({
        id: "fusion.world_event_visual_alignment",
        kind: "fusion",
        status: "observed",
        admission: "auto",
      }),
    ]));
    expect(graph.badges.find((badge) => badge.id === "fusion.audio_visual_scene")?.liveBindings.map((binding) => binding.compactValue))
      .toEqual(expect.arrayContaining([
        expect.stringContaining("audio_transcript->narrative_stage_play:active"),
        expect.stringContaining("visual_frame->visual_context:active"),
      ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: "fusion.audio_visual_scene",
        to: "interpreter.stage_play_reflection",
        relation: "feeds",
      }),
      expect.objectContaining({
        from: "fusion.world_event_visual_alignment",
        to: "interpreter.stage_play_reflection",
        relation: "feeds",
      }),
    ]));
    expect(JSON.stringify(graph)).not.toContain("raw_transcript");
    expect(JSON.stringify(graph)).not.toContain("raw_chunk");
  });

  it("marks missing modality fusion when visual evidence lacks audio grounding", () => {
    recordLiveSourceObservation({
      schema: "helix.live_source_observation.v1",
      observation_id: "live_source_observation:visual-only",
      thread_id: threadId,
      room_id: roomId,
      environment_id: "env:visual-only",
      source_id: "source:visual-tab",
      source_kind: "screen_capture",
      event_kind: "visual_summary",
      observed_at: "2026-06-02T13:20:01.000Z",
      freshness: { status: "fresh", age_ms: 10 },
      provenance: { adapter: "browser.visual", confidence: "high" },
      compact_summary: "Visual frame shows two actors in a meeting room.",
      payload_summary: { visual: { scene_summary: "Meeting room.", confidence: "high" } },
      evidence_refs: ["evidence:visual-only"],
      assistant_answer: false,
      raw_content_included: false,
    });
    upsertLiveSourceDescriptor({
      source_id: "source:visual-tab",
      thread_id: threadId,
      environment_id: "env:visual-only",
      modality: "visual_frame",
      user_label: "Browser tab visual",
      serving_context: {
        surface: "browser_tab",
        source_origin: "browser_getDisplayMedia",
      },
      current_state: "active",
      cadence_ms: 10000,
      latest_observation_refs: ["live_source_observation:visual-only"],
    });
    upsertLiveSourceProducer({
      sourceId: "source:visual-tab",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:visual-only",
      now: "2026-06-02T13:20:01.500Z",
    });
    const routeOverride = upsertStagePlaySourceRouteOverride({
      threadId,
      roomId,
      environmentId: "env:visual-only",
      sourceId: "source:visual-tab",
      modality: "visual_frame",
      routeTo: "narrative_stage_play",
      selectedForStagePlay: true,
      evidenceRefs: ["evidence:visual-only"],
      now: "2026-06-02T13:20:01.750Z",
    });

    const graph = buildStagePlayGraphFromWorld({
      threadId,
      roomId,
      environmentId: "env:visual-only",
      objective: "prepare a narrative Stage Play window",
      now: new Date("2026-06-02T13:20:02.000Z"),
    });

    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(graph.sourceWindow.sourceRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "source:visual-tab",
        modality: "visual_frame",
        selected: true,
        routeTo: "narrative_stage_play",
      }),
      expect.objectContaining({
        modality: "audio_transcript",
        selected: false,
        routeTo: "narrative_stage_play",
      }),
    ]));
    expect(graph.badges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "fusion.missing_modality",
        kind: "fusion",
        status: "missing_evidence",
        reasonCodes: expect.arrayContaining(["visual_active_audio_missing", "missing_modality"]),
        missingEvidence: expect.arrayContaining([
          "Attach browser audio transcript or microphone transcript for narrative Stage Play fusion.",
        ]),
      }),
      expect.objectContaining({
        id: "setting.visual_scene",
        kind: "setting",
        status: "candidate",
        missingEvidence: expect.arrayContaining([
          "Attach audio transcript or declare a narrative objective before treating the scene as fully grounded.",
        ]),
      }),
      expect.objectContaining({
        id: "actor.observed_subject",
        kind: "actor",
        status: "candidate",
        missingEvidence: expect.arrayContaining([
          "Confirm actor identity or role before using this as a named narrative actor.",
        ]),
      }),
      expect.objectContaining({
        id: "affordance.observe",
        kind: "affordance",
        status: "available",
      }),
      expect.objectContaining({
        id: "intent.observe",
        kind: "intent_module",
        status: "candidate",
      }),
      expect.objectContaining({
        id: "intent.seek_confirmation",
        kind: "intent_module",
        status: "candidate",
      }),
      expect.objectContaining({
        id: "intent.compare_next_frame",
        kind: "intent_module",
        status: "candidate",
      }),
      expect.objectContaining({
        id: "missing_evidence.audio_transcript",
        kind: "missing_evidence",
        status: "missing_evidence",
        missingEvidence: expect.arrayContaining([
          "Audio/transcript source is needed for narrative intent.",
        ]),
      }),
      expect.objectContaining({
        id: "recommended_check.attach_audio_transcript",
        kind: "recommended_check",
        status: "candidate",
        missingEvidence: expect.arrayContaining([
          "Audio/transcript source is needed for narrative intent.",
        ]),
      }),
      expect.objectContaining({
        id: "binding.scene_checkpoint",
        kind: "procedural_binding",
        status: "candidate",
      }),
      expect.objectContaining({
        id: "binding.narrative_context_gap",
        kind: "procedural_binding",
        status: "candidate",
      }),
      expect.objectContaining({
        id: "binding.continuity_check",
        kind: "procedural_binding",
        status: "candidate",
      }),
    ]));
    expect(graph.recommendedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "stage-action:attach-audio-transcript",
        label: "Attach audio transcript for narrative intent and dialogue.",
        actionType: "observe_more",
        admission: "auto",
        agentExecutable: false,
        reasonCodes: expect.arrayContaining(["visual_active_audio_missing", "narrative_stage_play"]),
        missingEvidence: expect.arrayContaining([
          "Audio/transcript source is needed for narrative intent.",
        ]),
      }),
      expect.objectContaining({
        id: "stage-action:capture-compare-next-frame",
        label: "Capture and compare the next visual frame.",
        actionType: "safe_diagnostic_overlay",
        admission: "auto",
        agentExecutable: false,
        reasonCodes: expect.arrayContaining(["visual_continuity_check", "narrative_stage_play"]),
      }),
      expect.objectContaining({
        id: "stage-action:ask-user-objective",
        label: "Ask user what narrative question or prediction target to track.",
        actionType: "ask_user",
        admission: "ask_user",
        agentExecutable: false,
        reasonCodes: expect.arrayContaining(["missing_user_objective", "narrative_stage_play"]),
        missingEvidence: expect.arrayContaining([
          "User objective for narrative prediction is not set.",
        ]),
      }),
    ]));
    expect(JSON.stringify(graph)).toContain(routeOverride.overrideId);
    expect(graph.authority.agent_executable).toBe(false);
  });
});
