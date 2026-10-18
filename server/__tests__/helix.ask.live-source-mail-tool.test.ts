import { beforeEach, describe, expect, it } from "vitest";
import type { HelixLiveEnvironmentToolName } from "@shared/helix-live-agent-step";
import { executeLiveEnvironmentTool } from "../services/helix-ask/live-environment-tool-adapter";
import {
  WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS,
  executableAliasesForWorkstationContextFeedQuerySpec,
} from "../services/helix-ask/workstation-context-feed-query-tool-contracts";
import { buildLiveEnvironmentRuntimePacket } from "../services/situation-room/live-environment-runtime-packet-builder";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
  updateLiveAnswerEnvironment,
} from "../services/situation-room/live-answer-environment-store";
import {
  analyzeVisualFrame,
  recordVisualFrame,
  resetVisualSnapshotStoreForTest,
  startVisualSnapshotSource,
} from "../services/situation-room/visual-snapshot-store";
import {
  listStagePlayLiveSourceMailItems,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import {
  appendInterpretedEvent,
  clearInterpretedEventLogForTest,
} from "../services/situation-room/interpreted-event-log-store";
import { enqueueAudioTranscriptMailFromChunk } from "../services/stage-play/stage-play-audio-transcript-mail-ingest";
import { resetStagePlayLiveSourceMailWakeStoreForTest } from "../services/stage-play/stage-play-live-source-mail-wake-store";
import { resetStagePlayLiveSourceNarrativeStoreForTest } from "../services/stage-play/stage-play-live-source-narrative-store";
import { resetStagePlayLiveSourceInterpreterProfileStoreForTest } from "../services/stage-play/stage-play-live-source-interpreter-profile-store";
import { resetStagePlayProcessedMailPacketStoreForTest } from "../services/stage-play/stage-play-processed-mail-packet-store";
import { resetStagePlayVisualObserverProfileStoreForTest } from "../services/stage-play/stage-play-visual-observer-profile-store";
import {
  listStagePlayAgentGoalSessions,
  listStagePlayGoalContextUpdates,
  recordStagePlayGoalContextUpdate,
  resetStagePlayGoalContextStoreForTest,
} from "../services/stage-play/stage-play-goal-context-store";
import {
  clearWorkstationReasoningTracesForTest,
  recordWorkstationReasoningTrace,
} from "../services/helix-ask/workstation-reasoning-trace-store";
import {
  resetSituationConstructStoreForTest,
  upsertSituationConstruct,
} from "../services/situation-room/situation-construct-store";

const threadId = "thread:helix-ask-live-source-mail-tool";
const roomId = "room:helix-ask-live-source-mail-tool";
const sourceId = "visual_source:helix-ask-live-source-mail-tool";

const genericContextFeedQuerySpecs = WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS.filter((spec) =>
  [
    "visual_summaries",
    "audio_transcripts",
    "translated_transcripts",
    "microdeck_outputs",
    "live_answer_lines",
    "narrator_events",
    "route_evidence",
    "automation_policies",
  ].includes(spec.feedKind),
);

const hardenedGoalSessionAuthority = (additionalFinalReportRequirements: Record<string, unknown> = {}) =>
  expect.objectContaining({
    assistantAnswer: false,
    finalReportsRequireTerminalAuthority: true,
    finalReportRequirements: expect.objectContaining({
      completedSolverPathRequired: true,
      evidenceReentryRequired: true,
      routeAuthorityRequired: true,
      terminalAuthoritySingleWriterRequired: true,
      ...additionalFinalReportRequirements,
    }),
  });

beforeEach(() => {
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayLiveSourceMailWakeStoreForTest();
  resetStagePlayLiveSourceNarrativeStoreForTest();
  resetStagePlayLiveSourceInterpreterProfileStoreForTest();
  resetStagePlayProcessedMailPacketStoreForTest();
  resetStagePlayVisualObserverProfileStoreForTest();
  resetStagePlayGoalContextStoreForTest();
  clearWorkstationReasoningTracesForTest();
  clearInterpretedEventLogForTest();
  resetSituationConstructStoreForTest();
  resetVisualSnapshotStoreForTest();
  resetLiveAnswerEnvironments();
});

const seedVisualSummary = () => {
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
    frame_id: "visual_frame:helix-ask-live-source-mail-tool",
    ts: "2026-06-04T12:10:00.000Z",
  });
  analyzeVisualFrame({
    thread_id: threadId,
    frame_id: frame.frame_id,
    evidence_id: "visual_evidence:helix-ask-live-source-mail-tool",
    summary: "Minecraft-like scene with a player, cat, book stand, and distant mountains.",
    supports_claims: [
      {
        claim: "The active visual source has compact evidence.",
        support_status: "supports",
        confidence: 0.78,
      },
    ],
  });
};

const seedVisualSummaryText = (
  summary: string,
  suffix: string,
  scope: { threadId?: string; roomId?: string; sourceId?: string } = {},
) => {
  const seededThreadId = scope.threadId ?? threadId;
  const seededRoomId = scope.roomId ?? roomId;
  const seededSourceId = scope.sourceId ?? sourceId;
  startVisualSnapshotSource({
    source_id: seededSourceId,
    thread_id: seededThreadId,
    room_id: seededRoomId,
    source_surface: "browser_tab",
    capture_mode: "interval",
    status: "active",
  });
  const frame = recordVisualFrame({
    source_id: seededSourceId,
    thread_id: seededThreadId,
    room_id: seededRoomId,
    frame_id: `visual_frame:helix-ask-live-source-mail-tool:${suffix}`,
    ts: "2026-06-04T12:10:00.000Z",
  });
  analyzeVisualFrame({
    thread_id: seededThreadId,
    frame_id: frame.frame_id,
    evidence_id: `visual_evidence:helix-ask-live-source-mail-tool:${suffix}`,
    summary,
    supports_claims: [
      {
        claim: "The active visual source has compact evidence.",
        support_status: "supports",
        confidence: 0.78,
      },
    ],
  });
};

const seedVisualSummaries = (count: number) => {
  startVisualSnapshotSource({
    source_id: sourceId,
    thread_id: threadId,
    room_id: roomId,
    source_surface: "browser_tab",
    capture_mode: "interval",
    status: "active",
  });
  for (let index = 0; index < count; index += 1) {
    const frame = recordVisualFrame({
      source_id: sourceId,
      thread_id: threadId,
      room_id: roomId,
      frame_id: `visual_frame:helix-ask-live-source-mail-tool:${index}`,
      ts: `2026-06-04T12:10:${String(index).padStart(2, "0")}.000Z`,
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: frame.frame_id,
      evidence_id: `visual_evidence:helix-ask-live-source-mail-tool:${index}`,
      summary: `Live frame ${index + 1} shows a fabric recommendation interface with cotton ripstop option ${index + 1}.`,
      supports_claims: [
        {
          claim: "The active visual source has compact evidence.",
          support_status: "supports",
          confidence: 0.78,
        },
      ],
    });
  }
};

describe("live-source mail live environment tools", () => {
  it("preserves required loop provenance when a goal-context update has a large evidence set", () => {
    const loopRefs = ["thread:room:large-evidence", "stage_play_mail_loop:room:large-evidence"];
    const update = recordStagePlayGoalContextUpdate({
      schemaVersion: "helix.workstation_goal_context_update.v1",
      updateId: "stage_play_goal_context_update:large-evidence",
      createdAtMs: Date.now(),
      sourceRefs: Array.from({ length: 100 }, (_, index) => `source_ref:${index}`),
      loopRefs,
      producerKind: "route_watch",
      updateKind: "route_evidence",
      contentRef: "stage_play_processed_mail_packet:large-evidence",
      preview: "A bounded packet retained its canonical loop provenance.",
      evidenceRefs: Array.from({ length: 180 }, (_, index) => `packet_evidence:${index}`),
      receiptRefs: ["receipt:large-evidence"],
      freshness: { observedAtMs: Date.now(), staleAfterMs: 30_000, status: "fresh" },
      goalRelevance: null,
      suggestedDispatch: [],
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });

    expect(update.sourceRefs).toHaveLength(80);
    expect(update.evidenceRefs).toEqual(expect.arrayContaining([
      update.contentRef,
      ...update.sourceRefs,
      ...loopRefs,
    ]));
    expect(update.evidenceRefs.length).toBeLessThanOrEqual(256);
  });

  it("advertises live-source mail tools as automatic evidence-only capabilities", () => {
    const packet = buildLiveEnvironmentRuntimePacket({
      threadId,
      roomId,
      now: "2026-06-04T12:10:01.000Z",
    });

    expect(packet.available_tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool_id: "live_env.check_live_source_mail",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.read_live_source_mail",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.process_live_source_mail",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.read_processed_live_source_mail",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.reflect_live_source_mail_loop",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_workstation_goal_context",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.start_agent_goal_session",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_trace_memory",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_packet_traces",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_visual_summaries",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_audio_transcripts",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_translation_segments",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_microdeck_outputs",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_live_answer_state",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_narrator_events",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_route_evidence",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_automation_policies",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.change_workstation_preset",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.set_visual_preset",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.set_audio_preset",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.bind_workstation_source",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.unbind_workstation_source",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.pause_workstation_loop",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.resume_workstation_loop",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.set_workstation_loop_state",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.repair_loop",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.repair_workstation_source",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.update_live_answer_projection",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.focus_process_graph",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.narrator_say",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
        tool_aliases: ["narrator.say", "narrator_say"],
      }),
      expect.objectContaining({
        tool_id: "live_env.narrator_bind_stream",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
        tool_aliases: ["narrator.bind_stream", "narrator_bind_stream"],
      }),
      ...WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS.map((spec) =>
        expect.objectContaining({
          tool_id: spec.capability,
          family: "live_env",
          creates_assistant_answer: false,
          requires_user_confirmation: false,
          can_run_automatically: true,
          tool_aliases: executableAliasesForWorkstationContextFeedQuerySpec(spec),
        }),
      ),
      expect.objectContaining({
        tool_id: "live_env.query_micro_reasoner_prompts",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_micro_reasoner_presets",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.draft_micro_reasoner_preset",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.route_micro_reasoner_prompt",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.update_micro_reasoner_prompt",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.test_micro_reasoner_prompt",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.configure_visual_observer_profile",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.apply_visual_observer_profile",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_visual_observer_profiles",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.test_visual_observer_profile",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.configure_route_watch",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.configure_live_source_watch_job",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      }),
      expect.objectContaining({
        tool_id: "live_env.configure_interpreter_profile",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.compare_mail_to_interpreter_profile",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.record_live_source_mail_decision",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.predict_live_source_immediate",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.compare_live_source_prediction",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.project_live_source_narrative",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
    ]));
  });

  it("queries MicroDeck presets as evidence-only preset query observations", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_micro_reasoner_presets",
      thread_id: threadId,
      args: {
        source_id: sourceId,
        include_presets: true,
        limit: 10,
      },
    });

    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.query_micro_reasoner_presets",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(observation.summary).toMatch(/Found \d+ MicroDeck preset\(s\) and \d+ prompt\(s\)\./);
    const payload = observation.observation as any;
    expect(payload).toMatchObject({
      schema: "stage_play_micro_reasoner_prompt_preset_query_result/v1",
      sourceId,
      source_id: sourceId,
      sourceIds: [sourceId],
      source_ids: [sourceId],
      sourceRefs: [sourceId],
      source_refs: [sourceId],
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:microdeck_outputs",
        "workstation_actuator:query_microdeck_outputs",
        "microdeck:preset_state",
        "microdeck:preset_query",
      ]),
      evidenceRefs: expect.arrayContaining([sourceId]),
      producedRefs: expect.arrayContaining([
        expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      ]),
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload.presets.length).toBeGreaterThan(0);
    expect(payload.prompts.length).toBeGreaterThan(0);
    expect(payload.evidenceRefs).toContain(payload.goalContextUpdateId);
    expect(payload.evidence_refs).toContain(payload.goalContextUpdateId);
    expect(observation.producedRefs).toEqual(expect.arrayContaining([
      payload.goalContextUpdateId,
    ]));
    expect(observation.evidence_refs).toEqual(
      expect.arrayContaining([payload.goalContextUpdateId, sourceId]),
    );

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "microdeck",
      updateKind: "preset_state",
    });
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: payload.goalContextUpdateId,
        contentRef: expect.stringMatching(/^stage_play_micro_reasoner_prompt_tool_activity:/),
        sourceRefs: [sourceId],
        loopRefs: expect.arrayContaining([
          "workstation_context_feed:microdeck_outputs",
          "workstation_actuator:query_microdeck_outputs",
          "microdeck:preset_state",
          "microdeck:preset_query",
        ]),
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));
  });

  it("records MicroDeck preset application as durable non-terminal goal context", () => {
    const presetId = "stage_play_micro_reasoner_prompt_preset:science-visual:v1";
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.apply_micro_reasoner_preset",
      thread_id: threadId,
      args: {
        source_id: sourceId,
        source_kind: "visual_frame",
        goal_id: "goal:microdeck-apply",
        preset_id: presetId,
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.apply_micro_reasoner_preset",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_micro_reasoner_prompt_preset_apply_response/v1",
      applied: true,
      reason: "applied",
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      sourceRefs: expect.arrayContaining([sourceId]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:microdeck_outputs",
        "workstation_actuator:query_microdeck_outputs",
        "microdeck:preset_state",
      ]),
      evidenceRefs: expect.arrayContaining([
        presetId,
        sourceId,
      ]),
      producedRefs: expect.arrayContaining([
        presetId,
        expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      ]),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload.evidenceRefs).toContain(payload.goalContextUpdateId);
    expect(payload.evidence_refs).toContain(payload.goalContextUpdateId);
    expect(payload.producedRefs).toEqual(expect.arrayContaining([
      presetId,
      payload.goalContextUpdateId,
    ]));
    expect(observation.producedRefs).toEqual(expect.arrayContaining([
      presetId,
      payload.goalContextUpdateId,
    ]));
    expect(observation.evidence_refs).toEqual(expect.arrayContaining([
      payload.goalContextUpdateId,
      presetId,
      sourceId,
    ]));

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "microdeck",
      updateKind: "preset_state",
    });
    const update = updates.find((item) => item.updateId === payload.goalContextUpdateId);
    expect(update).toMatchObject({
      producerKind: "microdeck",
      updateKind: "preset_state",
      contentRef: expect.stringMatching(/^stage_play_micro_reasoner_prompt_tool_activity:/),
      sourceRefs: expect.arrayContaining([sourceId]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:microdeck_outputs",
        "workstation_actuator:query_microdeck_outputs",
        "microdeck:preset_state",
      ]),
      evidenceRefs: expect.arrayContaining([
        presetId,
        sourceId,
      ]),
      receiptRefs: expect.arrayContaining([expect.stringMatching(/^stage_play_micro_reasoner_prompt_tool_activity:/)]),
      freshness: expect.objectContaining({ status: "fresh" }),
      goalRelevance: expect.objectContaining({
        goalId: "goal:microdeck-apply",
      }),
      toolIdentity: {
        requestedToolName: "live_env.apply_micro_reasoner_preset",
        canonicalToolName: "live_env.apply_micro_reasoner_preset",
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
    expect(update?.suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt" }),
      expect.objectContaining({ kind: "append_goal_context", goalId: "goal:microdeck-apply" }),
      expect.objectContaining({ kind: "update_panel", panelId: "stage-play-badge-graph" }),
      expect.objectContaining({ kind: "update_panel", panelId: "live-answer-environment" }),
    ]));

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_microdeck_outputs",
      thread_id: threadId,
      args: {
        source_id: sourceId,
      },
    });
    const queryPayload = queryObservation.observation as any;
    expect(queryObservation.ok).toBe(true);
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      feedKind: "microdeck_outputs",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(queryPayload.goalContextUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: payload.goalContextUpdateId,
        updateKind: "preset_state",
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));
  });

  it("drafts a MicroDeck setup from a scenario without creating or applying the preset", () => {
    const before = executeLiveEnvironmentTool({
      tool_name: "live_env.query_micro_reasoner_presets",
      thread_id: threadId,
      args: {
        source_id: sourceId,
        include_presets: true,
        limit: 100,
      },
    });
    const beforeCustomCount = (before.observation as any).presets
      .filter((preset: any) => String(preset.presetId).includes(":custom:"))
      .length;

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.draft_micro_reasoner_preset",
      thread_id: threadId,
      args: {
        source_id: sourceId,
        scenario_text: "Use the visual source to choose whether to prepare a tool call, append a wake-bound Ask contract, or ask the operator for confirmation.",
        candidate_prompts: [
          "Prepare the next tool call if the visual summary has enough evidence.",
          "Append a concise wake-bound context contract for Helix Ask.",
          "Ask the operator one confirmation question when the evidence is ambiguous.",
        ],
        wake_contract_prompt: "Only append this contract when the MicroDeck result is wake-bound for Ask handoff.",
        wake_contract_title: "Operator Wake Contract",
      },
    });

    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.draft_micro_reasoner_preset",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    const payload = observation.observation as any;
    expect(payload).toMatchObject({
      artifactId: "stage_play_micro_reasoner_prompt_preset_draft",
      schema: "stage_play_micro_reasoner_prompt_preset_draft/v1",
      schemaVersion: "stage_play_micro_reasoner_prompt_preset_draft/v1",
      confirmationRequired: true,
      createToolCall: {
        toolName: "live_env.create_micro_reasoner_preset",
        args: {
          source_ids: [sourceId],
          candidate_prompts: expect.any(Array),
          wake_prompt_contract: {
            title: "Operator Wake Contract",
            attachOnlyWhenWakeBound: true,
          },
        },
      },
      sourceRefs: [sourceId],
      source_refs: [sourceId],
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:microdeck_outputs",
        "workstation_actuator:query_microdeck_outputs",
        "microdeck:preset_draft",
      ]),
      evidenceRefs: expect.arrayContaining([sourceId]),
      producedRefs: expect.arrayContaining([
        expect.stringMatching(/^stage_play_micro_reasoner_prompt_preset_draft:/),
        expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      ]),
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "micro_reasoner_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload.draft.candidatePrompts).toHaveLength(3);
    expect(payload.evidenceRefs).toContain(payload.goalContextUpdateId);
    expect(payload.evidence_refs).toContain(payload.goalContextUpdateId);
    expect(observation.producedRefs).toEqual([payload.draftId, payload.goalContextUpdateId]);
    expect(observation.evidence_refs).toEqual(expect.arrayContaining([
      payload.goalContextUpdateId,
      payload.draftId,
      sourceId,
    ]));
    const draftUpdates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "microdeck",
      updateKind: "suggested_action",
    });
    expect(draftUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: payload.goalContextUpdateId,
        contentRef: payload.draftId,
        sourceRefs: [sourceId],
        loopRefs: expect.arrayContaining([
          "workstation_context_feed:microdeck_outputs",
          "workstation_actuator:query_microdeck_outputs",
          "microdeck:preset_draft",
        ]),
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));

    const after = executeLiveEnvironmentTool({
      tool_name: "live_env.query_micro_reasoner_presets",
      thread_id: threadId,
      args: {
        source_id: sourceId,
        include_presets: true,
        limit: 100,
      },
    });
    const afterCustomCount = (after.observation as any).presets
      .filter((preset: any) => String(preset.presetId).includes(":custom:"))
      .length;
    expect(afterCustomCount).toBe(beforeCustomCount);
  });

  it("creates and routes a MicroDeck prompt delegation preset from up to three prompts", () => {
    const create = executeLiveEnvironmentTool({
      tool_name: "live_env.create_micro_reasoner_preset",
      thread_id: threadId,
      args: {
        source_id: sourceId,
        title: "Visual Prompt Router",
        candidate_prompts: [
          {
            candidateId: "candidate_a",
            title: "Calculator follow-up",
            promptText: "Explain the calculator result and identify any missing variables.",
          },
          {
            candidateId: "candidate_b",
            title: "Minecraft hazard review",
            promptText: "Review the Minecraft visual capture for lava, mobs, low health, and urgent survival hazards.",
          },
          {
            candidateId: "candidate_c",
            title: "Document summary",
            promptText: "Summarize the visible document section and cite its headings.",
          },
        ],
        confidence_threshold: 0.12,
        escalation_mode: "handoff_only_if_confident",
      },
    });

    expect(create).toMatchObject({
      tool_name: "live_env.create_micro_reasoner_preset",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    const createPayload = create.observation as any;
    const preset = createPayload.preset;
    expect(createPayload).toMatchObject({
      schema: "stage_play_micro_reasoner_prompt_preset_create_response/v1",
      created: true,
      reason: "created_prompt_delegation_router",
      sourceRefs: [sourceId],
      source_refs: [sourceId],
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:microdeck_outputs",
        "workstation_actuator:query_microdeck_outputs",
        "microdeck:preset_state",
        "microdeck:preset_create",
      ]),
      evidenceRefs: expect.arrayContaining([sourceId]),
      producedRefs: expect.arrayContaining([
        expect.stringMatching(/^stage_play_micro_reasoner_prompt_preset:custom:/),
        expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      ]),
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(createPayload.evidenceRefs).toContain(createPayload.goalContextUpdateId);
    expect(createPayload.evidence_refs).toContain(createPayload.goalContextUpdateId);
    expect(create.producedRefs).toEqual(expect.arrayContaining([preset.presetId, createPayload.goalContextUpdateId]));
    const createUpdates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "microdeck",
      updateKind: "preset_state",
    });
    expect(createUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: createPayload.goalContextUpdateId,
        contentRef: preset.presetId,
        sourceRefs: [sourceId],
        loopRefs: expect.arrayContaining([
          "workstation_context_feed:microdeck_outputs",
          "workstation_actuator:query_microdeck_outputs",
          "microdeck:preset_state",
          "microdeck:preset_create",
        ]),
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));
    expect(preset).toMatchObject({
      deckRunPlan: "prompt_delegation_router",
      outputPolicy: "ask_prompt_delegation",
      promptedRoles: ["prompt_router"],
      delegationRouter: {
        confidenceThreshold: 0.12,
        escalationMode: "handoff_only_if_confident",
        allowNone: true,
      },
    });
    expect(preset.delegationRouter.candidates).toHaveLength(3);

    const route = executeLiveEnvironmentTool({
      tool_name: "live_env.route_micro_reasoner_prompt",
      thread_id: threadId,
      args: {
        source_id: sourceId,
        preset_id: preset.presetId,
        source_summary: "The Minecraft scene shows lava beside the player, low health, and a hostile mob nearby.",
      },
    });

    expect(route).toMatchObject({
      tool_name: "live_env.route_micro_reasoner_prompt",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    const routePayload = route.observation as any;
    expect(routePayload).toMatchObject({
      schema: "stage_play_micro_reasoner_prompt_delegation_result/v1",
      schemaVersion: "stage_play_micro_reasoner_prompt_delegation_result/v1",
      selectedCandidateId: "candidate_b",
      shouldHandoffToHelixAsk: true,
      sourceRefs: [sourceId],
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:microdeck_outputs",
        "workstation_actuator:query_microdeck_outputs",
        "microdeck:prompt_route",
        `microdeck_preset:${preset.presetId}`,
      ]),
      evidenceRefs: expect.arrayContaining([
        sourceId,
        preset.presetId,
        "candidate_b",
      ]),
      producedRefs: expect.arrayContaining([
        expect.stringMatching(/^stage_play_micro_reasoner_prompt_delegation:/),
        expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      ]),
      suggestedDispatch: expect.arrayContaining([
        expect.objectContaining({ kind: "log_receipt" }),
        expect.objectContaining({ kind: "update_panel", panelId: "stage-play-badge-graph" }),
        expect.objectContaining({ kind: "wake_agent", interruptKind: "policy_triggered" }),
      ]),
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "micro_reasoner_evidence",
      ask_context_policy: "evidence_only",
      helixAskHandoff: {
        selectedCandidateId: "candidate_b",
        prompt: "Review the Minecraft visual capture for lava, mobs, low health, and urgent survival hazards.",
      },
    });
    expect(routePayload.evidenceRefs).toContain(routePayload.goalContextUpdateId);
    expect(routePayload.evidence_refs).toContain(routePayload.goalContextUpdateId);
    expect(route.producedRefs).toEqual(expect.arrayContaining([
      routePayload.delegationId,
      routePayload.goalContextUpdateId,
    ]));
    const routeUpdates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "microdeck",
      updateKind: "route_evidence",
    });
    expect(routeUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: routePayload.goalContextUpdateId,
        contentRef: routePayload.delegationId,
        sourceRefs: [sourceId],
        loopRefs: expect.arrayContaining([
          "workstation_context_feed:microdeck_outputs",
          "workstation_actuator:query_microdeck_outputs",
          "microdeck:prompt_route",
          `microdeck_preset:${preset.presetId}`,
        ]),
        evidenceRefs: expect.arrayContaining([
          routePayload.delegationId,
          preset.presetId,
          "candidate_b",
          sourceId,
        ]),
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));

    const feedQuery = executeLiveEnvironmentTool({
      tool_name: "live_env.query_microdeck_outputs",
      thread_id: threadId,
      args: {
        source_id: sourceId,
      },
    });
    const feedPayload = feedQuery.observation as any;
    expect(feedPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      feedKind: "microdeck_outputs",
      sourceRef: sourceId,
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(feedPayload.goalContextUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: routePayload.goalContextUpdateId,
        updateKind: "route_evidence",
        suggestedDispatch: expect.arrayContaining([
          expect.objectContaining({ kind: "wake_agent", interruptKind: "policy_triggered" }),
        ]),
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));
    expect(feedQuery.producedRefs).toEqual(expect.arrayContaining([
      routePayload.goalContextUpdateId,
    ]));
  });

  it("creates custom MicroDeck role presets as durable non-terminal goal context", () => {
    const create = executeLiveEnvironmentTool({
      tool_name: "live_env.create_micro_reasoner_preset",
      thread_id: threadId,
      args: {
        source_id: sourceId,
        title: "Frog Visual Classifier",
        role: "observation_classifier",
        template: "Classify visible frog morphology cues without claiming species authority.",
        prompted_roles: ["observation_classifier"],
      },
    });

    const payload = create.observation as any;
    expect(create).toMatchObject({
      tool_name: "live_env.create_micro_reasoner_preset",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_micro_reasoner_prompt_preset_create_response/v1",
      created: true,
      reason: "created",
      sourceRefs: [sourceId],
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:microdeck_outputs",
        "workstation_actuator:query_microdeck_outputs",
        "microdeck:preset_state",
        "microdeck:preset_create",
        "microdeck_prompt:observation_classifier",
      ]),
      evidenceRefs: expect.arrayContaining([sourceId]),
      producedRefs: expect.arrayContaining([
        expect.stringMatching(/^stage_play_micro_reasoner_prompt_preset:custom:/),
        expect.stringMatching(/^stage_play_micro_reasoner_prompt:custom:.*:observation_classifier:/),
        expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      ]),
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.evidenceRefs).toContain(payload.goalContextUpdateId);
    expect(payload.evidence_refs).toContain(payload.goalContextUpdateId);
    expect(create.producedRefs).toEqual(expect.arrayContaining([
      payload.preset.presetId,
      payload.prompt.promptId,
      payload.goalContextUpdateId,
    ]));

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "microdeck",
      updateKind: "preset_state",
    });
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: payload.goalContextUpdateId,
        contentRef: payload.preset.presetId,
        sourceRefs: [sourceId],
        loopRefs: expect.arrayContaining([
          "workstation_context_feed:microdeck_outputs",
          "workstation_actuator:query_microdeck_outputs",
          "microdeck:preset_create",
          "microdeck_prompt:observation_classifier",
        ]),
        evidenceRefs: expect.arrayContaining([
          payload.preset.presetId,
          payload.prompt.promptId,
          sourceId,
        ]),
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));
  });

  it("records MicroDeck prompt query, update, and test results as durable non-terminal goal context", () => {
    const query = executeLiveEnvironmentTool({
      tool_name: "live_env.query_micro_reasoner_prompts",
      thread_id: threadId,
      args: {
        source_id: sourceId,
        role: "observation_classifier",
        limit: 5,
      },
    });
    const queryPayload = query.observation as any;
    expect(queryPayload).toMatchObject({
      schema: "stage_play_micro_reasoner_prompt_query_result/v1",
      sourceRefs: [sourceId],
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:microdeck_outputs",
        "workstation_actuator:query_microdeck_outputs",
        "microdeck:preset_state",
        "microdeck:prompt_query",
      ]),
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(queryPayload.evidenceRefs).toContain(queryPayload.goalContextUpdateId);

    const update = executeLiveEnvironmentTool({
      tool_name: "live_env.update_micro_reasoner_prompt",
      thread_id: threadId,
      args: {
        source_id: sourceId,
        role: "observation_classifier",
        template: "Classify frog visual cues as bounded morphology evidence; do not claim species authority.",
      },
    });
    const updatePayload = update.observation as any;
    expect(updatePayload).toMatchObject({
      schema: "stage_play_micro_reasoner_prompt_update_result/v1",
      updated: true,
      sourceRefs: [sourceId],
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:microdeck_outputs",
        "workstation_actuator:query_microdeck_outputs",
        "microdeck:preset_state",
        "microdeck:prompt_update",
        "microdeck_prompt:observation_classifier",
      ]),
      producedRefs: expect.arrayContaining([
        expect.stringMatching(/^stage_play_micro_reasoner_prompt:observation_classifier:/),
        expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      ]),
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(updatePayload.evidenceRefs).toContain(updatePayload.goalContextUpdateId);
    expect(update.producedRefs).toEqual(expect.arrayContaining([
      updatePayload.prompt.promptId,
      updatePayload.goalContextUpdateId,
    ]));

    seedVisualSummaryText("ImageLens visual summary: green frog with visible toe pads.", "microdeck-prompt-test");
    const promptTest = executeLiveEnvironmentTool({
      tool_name: "live_env.test_micro_reasoner_prompt",
      thread_id: threadId,
      args: {
        source_id: sourceId,
        source_kind: "visual_frame",
        role: "observation_classifier",
        limit: 5,
      },
    });
    const testPayload = promptTest.observation as any;
    expect(testPayload).toMatchObject({
      schema: "stage_play_micro_reasoner_prompt_test_result/v1",
      activated: false,
      sourceRefs: [sourceId],
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:microdeck_outputs",
        "workstation_actuator:query_microdeck_outputs",
        "microdeck:prompt_test",
        "microdeck_prompt:observation_classifier",
      ]),
      producedRefs: expect.arrayContaining([
        expect.stringMatching(/^stage_play_micro_reasoner_prompt_test:/),
        expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      ]),
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(testPayload.evidenceRefs).toContain(testPayload.goalContextUpdateId);
    expect(promptTest.producedRefs).toEqual(expect.arrayContaining([
      testPayload.promptTestId,
      testPayload.goalContextUpdateId,
    ]));

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "microdeck",
    });
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: queryPayload.goalContextUpdateId,
        updateKind: "preset_state",
        sourceRefs: [sourceId],
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
      expect.objectContaining({
        updateId: updatePayload.goalContextUpdateId,
        updateKind: "preset_state",
        contentRef: updatePayload.prompt.promptId,
        sourceRefs: [sourceId],
        loopRefs: expect.arrayContaining(["microdeck:prompt_update"]),
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
      expect.objectContaining({
        updateId: testPayload.goalContextUpdateId,
        updateKind: "reflection",
        contentRef: testPayload.promptTestId,
        sourceRefs: [sourceId],
        loopRefs: expect.arrayContaining(["microdeck:prompt_test"]),
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));

    const feedQuery = executeLiveEnvironmentTool({
      tool_name: "live_env.query_microdeck_outputs",
      thread_id: threadId,
      args: {
        source_id: sourceId,
      },
    });
    const feedPayload = feedQuery.observation as any;
    expect(feedPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      feedKind: "microdeck_outputs",
      sourceRef: sourceId,
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(feedPayload.goalContextUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ updateId: queryPayload.goalContextUpdateId, updateKind: "preset_state" }),
      expect.objectContaining({ updateId: updatePayload.goalContextUpdateId, updateKind: "preset_state" }),
      expect.objectContaining({ updateId: testPayload.goalContextUpdateId, updateKind: "reflection" }),
    ]));
    expect(feedQuery.producedRefs).toEqual(expect.arrayContaining([
      queryPayload.goalContextUpdateId,
      updatePayload.goalContextUpdateId,
      testPayload.goalContextUpdateId,
    ]));
  });

  it("routes wake-bound contract appender presets only into Ask handoff receipts", () => {
    const route = executeLiveEnvironmentTool({
      tool_name: "live_env.route_micro_reasoner_prompt",
      thread_id: threadId,
      args: {
        source_id: sourceId,
        preset_id: "stage_play_micro_reasoner_prompt_preset:wake-bound-contract-appender:v1",
        source_summary: "The live source has a completed result that should wake Ask under the operator contract.",
      },
    });

    expect(route).toMatchObject({
      tool_name: "live_env.route_micro_reasoner_prompt",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    const payload = route.observation as any;
    expect(payload).toMatchObject({
      schema: "stage_play_micro_reasoner_prompt_delegation_result/v1",
      presetId: "stage_play_micro_reasoner_prompt_preset:wake-bound-contract-appender:v1",
      selectedCandidateId: "wake_contract_a",
      shouldHandoffToHelixAsk: true,
      suggestedDispatch: expect.arrayContaining([
        expect.objectContaining({ kind: "log_receipt" }),
        expect.objectContaining({ kind: "update_panel", panelId: "stage-play-badge-graph" }),
        expect.objectContaining({ kind: "wake_agent", interruptKind: "policy_triggered" }),
      ]),
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:microdeck:/),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "micro_reasoner_evidence",
      ask_context_policy: "evidence_only",
      helixAskHandoff: {
        selectedCandidateId: "wake_contract_a",
        wakePromptContract: {
          title: "Wake-Bound Operator Contract",
          attachOnlyWhenWakeBound: true,
        },
      },
    });
    expect(payload.evidenceRefs).toContain(payload.goalContextUpdateId);
    expect(payload.evidence_refs).toContain(payload.goalContextUpdateId);
    expect(payload.helixAskHandoff.appendedPrompt).toContain("Wake-bound contract:");
    expect(payload.helixAskHandoff.appendedPrompt).toContain("If the packet is stale, superseded, or no longer wake-bound, ignore this contract.");
  });

  it("rejects MicroDeck prompt delegation presets with more than three prompts", () => {
    const create = executeLiveEnvironmentTool({
      tool_name: "live_env.create_micro_reasoner_preset",
      thread_id: threadId,
      args: {
        source_id: sourceId,
        candidate_prompts: [
          "Prompt one",
          "Prompt two",
          "Prompt three",
          "Prompt four",
        ],
      },
    });

    expect(create).toMatchObject({
      tool_name: "live_env.create_micro_reasoner_preset",
      ok: false,
      summary: "Custom MicroDeck prompt-router presets accept at most three candidate prompts.",
      observation: {
        schema: "stage_play_micro_reasoner_prompt_preset_create_response/v1",
        created: false,
        reason: "too_many_candidate_prompts",
        candidateCount: 4,
        maxCandidatePrompts: 3,
        assistant_answer: false,
        terminal_eligible: false,
      },
    });
  });

  it("configures an interpreter profile without reading mail or answering", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_interpreter_profile",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        job_id: "stage_play_live_source_job:profile-test",
        policy_id: "stage_play_live_source_watch_job_policy:profile-test",
        domain: "minecraft",
        objective_text: "Watch Minecraft and compare observations against a survival coach profile.",
        interpretation_guidelines: "Treat visible hazards as observed facts and route likely intent as inference.",
        lenses: ["hazards", "resources", "navigation"],
        salience_criteria: ["hostile mob appears"],
        suppress_criteria: ["unchanged camera angle"],
        risk_criteria: ["lava", "hostile mob"],
        opportunity_criteria: ["visible ore"],
        voice_callout_criteria: ["immediate hazard"],
        text_answer_style: "brief_explanation",
        voice_style: "short_callout",
        ask_when_uncertain: true,
        create_linked_note: true,
        evidence_refs: ["stage_play_live_source_mail:profile-test"],
      },
    });

    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.configure_interpreter_profile",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(observation.summary).toContain("Configured interpreter profile");
    expect(observation.summary).toContain("no live-source mail was read");
    const payload = observation.observation as any;
    expect(payload).toMatchObject({
      artifactId: "stage_play_interpreter_profile_config_result",
      schema: "stage_play_interpreter_profile_config_result/v1",
      schemaVersion: "stage_play_interpreter_profile_config_result/v1",
      profile: {
        artifactId: "stage_play_live_source_interpreter_profile",
        schemaVersion: "stage_play_live_source_interpreter_profile/v1",
        title: "Minecraft Survival Coach",
        threadId,
        roomId,
        jobId: "stage_play_live_source_job:profile-test",
        policyId: "stage_play_live_source_watch_job_policy:profile-test",
        sourceKinds: ["visual_frame"],
        domain: "minecraft",
        objectiveText: "Watch Minecraft and compare observations against a survival coach profile.",
        interpretationGuidelines: "Treat visible hazards as observed facts and route likely intent as inference.",
        lenses: ["hazards", "resources", "navigation"],
        salienceCriteria: ["hostile mob appears"],
        suppressCriteria: ["unchanged camera angle"],
        riskCriteria: ["lava", "hostile mob"],
        opportunityCriteria: ["visible ore"],
        voiceCalloutCriteria: ["immediate hazard"],
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
        status: "active",
        assistant_answer: false,
        terminal_eligible: false,
        context_role: "tool_evidence",
        raw_content_included: false,
      },
      linkedNote: {
        noteId: expect.stringMatching(/^note:interpreter_profile:/),
        title: "Minecraft Survival Coach Guidelines",
      },
      transcriptRows: [
        expect.objectContaining({
          rowKind: "interpreter_profile",
          title: "Interpreter profile configured",
          terminalEligible: false,
          assistantAnswer: false,
        }),
        expect.objectContaining({
          rowKind: "interpreter_profile",
          title: "Objective",
          body: "Objective: Watch Minecraft and compare observations against a survival coach profile.",
        }),
        expect.objectContaining({
          rowKind: "interpreter_profile",
          title: "Guidelines",
          body: expect.stringContaining("Treat visible hazards as observed facts"),
        }),
        expect.objectContaining({
          rowKind: "interpreter_profile",
          title: "Scope",
          body: "Domain: minecraft; source kinds: visual_frame; status: active.",
        }),
        expect.objectContaining({
          rowKind: "interpreter_profile",
          title: "Criteria",
          body: expect.stringContaining("hostile mob appears"),
        }),
        expect.objectContaining({
          rowKind: "profile_note_link",
          title: "Linked note",
          body: expect.stringContaining("Minecraft Survival Coach Guidelines"),
        }),
      ],
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
    });
    expect(payload.profile.profileId).toMatch(/^stage_play_live_source_interpreter_profile:/);
    expect(payload.interpreterProfileRef).toBe(payload.profile.profileId);
    expect(payload.profile.evidenceRefs).toEqual(expect.arrayContaining([
      sourceId,
      "stage_play_live_source_job:profile-test",
      "stage_play_live_source_watch_job_policy:profile-test",
      "stage_play_live_source_mail:profile-test",
      payload.linkedNote.noteId,
    ]));
    expect(payload.artifactId).not.toBe("stage_play_live_source_mail_read_result");
    expect(observation.transcriptRows?.map((row: any) => row.title)).toEqual([
      "Interpreter profile configured",
      "Objective",
      "Guidelines",
      "Scope",
      "Criteria",
      "Linked note",
    ]);
  });

  it("manages an existing interpreter profile without reading mail", () => {
    const configured = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_interpreter_profile",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        domain: "minecraft",
        objective_text: "Watch Minecraft like a survival coach.",
        interpretation_guidelines: "Call out danger, resources, and strategic route changes.",
        create_linked_note: true,
      },
    });
    const configuredPayload = configured.observation as any;
    const profileId = configuredPayload.profile.profileId;
    const noteId = configuredPayload.linkedNote.noteId;

    const paused = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_interpreter_profile",
      thread_id: threadId,
      args: {
        room_id: roomId,
        profile_action: "pause",
        profile_id: profileId,
      },
    });

    expect(paused).toMatchObject({
      tool_name: "live_env.configure_interpreter_profile",
      ok: true,
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    expect(paused.summary).toContain("no live-source mail was read");
    expect(paused.observation as any).toMatchObject({
      schema: "stage_play_interpreter_profile_action_result/v1",
      profileAction: "pause",
      profile: {
        profileId,
        status: "paused",
      },
      transcriptRows: [
        expect.objectContaining({
          rowKind: "interpreter_profile",
          title: "Interpreter profile paused",
          terminalEligible: false,
          assistantAnswer: false,
        }),
      ],
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
    });

    const opened = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_interpreter_profile",
      thread_id: threadId,
      args: {
        room_id: roomId,
        profile_action: "open_note",
        profile_id: profileId,
        note_id: noteId,
      },
    });

    expect(opened.summary).toContain("Opened interpreter profile note");
    expect(opened.observation as any).toMatchObject({
      schema: "stage_play_interpreter_profile_action_result/v1",
      profileAction: "open_note",
      note: {
        noteId,
      },
      transcriptRows: [
        expect.objectContaining({
          rowKind: "profile_note_link",
          title: "Profile note opened",
          terminalEligible: false,
          assistantAnswer: false,
        }),
      ],
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
    });
    expect((opened.observation as any).artifactId).not.toBe("stage_play_live_source_mail_read_result");
  });

  it("compares selected mail to the active interpreter profile as evidence only", () => {
    seedVisualSummary();
    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });
    const readPayload = readObservation.observation as any;
    const mailId = readPayload.items[0].mailId;
    const profileObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_interpreter_profile",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        job_id: "stage_play_live_source_job:compare-profile",
        policy_id: "stage_play_live_source_watch_job_policy:compare-profile",
        domain: "minecraft",
        objective_text: "Watch Minecraft like a survival coach.",
        interpretation_guidelines: "Separate observed visible hazards from inferred player strategy.",
        salience_criteria: ["player", "cat", "mountains"],
        suppress_criteria: ["unchanged menu"],
        risk_criteria: ["hostile mob", "lava"],
        opportunity_criteria: ["book stand", "mountains"],
        voice_callout_criteria: ["hostile mob"],
      },
    });
    const profilePayload = profileObservation.observation as any;

    const comparisonObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.compare_mail_to_interpreter_profile",
      thread_id: threadId,
      args: {
        room_id: roomId,
        profile_id: profilePayload.profile.profileId,
        mail_ids: [mailId],
        job_id: "stage_play_live_source_job:compare-profile",
        policy_id: "stage_play_live_source_watch_job_policy:compare-profile",
      },
    });

    expect(comparisonObservation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.compare_mail_to_interpreter_profile",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(comparisonObservation.summary).toContain("recommended record_interpretation");
    const comparison = comparisonObservation.observation as any;
    expect(comparison).toMatchObject({
      artifactId: "stage_play_live_source_interpreter_profile_comparison",
      schemaVersion: "stage_play_live_source_interpreter_profile_comparison/v1",
      profileId: profilePayload.profile.profileId,
      jobId: "stage_play_live_source_job:compare-profile",
      policyId: "stage_play_live_source_watch_job_policy:compare-profile",
      mailIds: [mailId],
      observedFacts: [
        expect.stringContaining("Minecraft-like scene with a player, cat, book stand, and distant mountains."),
      ],
      inferredMeaning: expect.arrayContaining([
        expect.stringContaining("Matched salience criteria"),
        expect.stringContaining("Opportunity criteria matched"),
      ]),
      matchedCriteria: expect.arrayContaining(["player", "cat", "mountains"]),
      opportunityMatches: expect.arrayContaining(["book stand", "mountains"]),
      recommendedDecision: "record_interpretation",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
      post_tool_model_step_required: true,
      ask_context_policy: "evidence_only",
    });
    expect(comparison.riskMatches).not.toEqual(expect.arrayContaining(["hostile mob", "lava"]));
    expect(comparison.evidenceRefs).toEqual(expect.arrayContaining([
      profilePayload.profile.profileId,
      mailId,
      "visual_evidence:helix-ask-live-source-mail-tool",
    ]));
    expect(comparison.transcriptRows).toEqual([
      expect.objectContaining({
        rowKind: "profile_comparison",
        title: "Interpreter profile comparison",
        terminalEligible: false,
        assistantAnswer: false,
      }),
      expect.objectContaining({
        rowKind: "agent_decision",
        title: "Recommended decision",
        body: "Recommended decision: record_interpretation.",
      }),
      expect.objectContaining({
        rowKind: "profile_comparison",
        title: "Criteria matches",
        body: expect.stringContaining("salience="),
      }),
    ]);
  });

  it.each([
    {
      name: "waits on routine daylight movement under a warning-only profile",
      summary: "The player is walking through a daylight forest with no visible threat.",
      suffix: "profile-voice-daylight",
      expectedDecision: "wait_for_next_summary",
      expectedSuppressed: ["routine movement"],
      expectedRiskAbsent: ["minecraft hazard hint", "hostile mob", "lava", "low health"],
      expectedVoiceAbsent: ["minecraft urgent hazard hint", "hostile mob", "lava", "low health"],
    },
    {
      name: "treats cave low light as risk context without auto-speaking",
      summary: "The player approaches a cave entrance with low light and no visible torch cues.",
      suffix: "profile-voice-cave-low-light",
      expectedDecision: "record_interpretation",
      expectedRisk: ["low light", "cave exploration", "minecraft hazard hint"],
      expectedVoiceAbsent: ["minecraft urgent hazard hint", "hostile mob", "lava", "low health"],
    },
    {
      name: "requests a voice callout when hostile mob criteria match",
      summary: "A creeper is near the player at the edge of the cave.",
      suffix: "profile-voice-creeper",
      expectedDecision: "request_voice_callout",
      expectedRisk: ["minecraft hazard hint"],
      expectedVoice: ["minecraft urgent hazard hint", "hostile mob"],
    },
  ])("profile voice behavior: $name", ({
    summary,
    suffix,
    expectedDecision,
    expectedSuppressed,
    expectedRisk,
    expectedRiskAbsent,
    expectedVoice,
    expectedVoiceAbsent,
  }) => {
    seedVisualSummaryText(summary, suffix);
    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });
    const readPayload = readObservation.observation as any;
    const mailId = readPayload.items[0].mailId;
    const profileObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_interpreter_profile",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        job_id: `stage_play_live_source_job:${suffix}`,
        policy_id: `stage_play_live_source_watch_job_policy:${suffix}`,
        domain: "minecraft",
        objective_text: "Watch Minecraft like a warning-only survival coach.",
        interpretation_guidelines: "Call out only urgent hazards; otherwise preserve observed risk context for interpretation.",
        salience_criteria: ["cave exploration", "low light", "hostile mob"],
        suppress_criteria: ["routine movement"],
        risk_criteria: ["low light", "cave exploration", "lava", "hostile mob", "low health"],
        opportunity_criteria: ["rare resource"],
        voice_callout_criteria: ["hostile mob", "lava", "low health", "nightfall without shelter"],
        voice_style: "warning_only",
      },
    });
    const profilePayload = profileObservation.observation as any;

    const comparisonObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.compare_mail_to_interpreter_profile",
      thread_id: threadId,
      args: {
        room_id: roomId,
        profile_id: profilePayload.profile.profileId,
        mail_ids: [mailId],
        job_id: `stage_play_live_source_job:${suffix}`,
        policy_id: `stage_play_live_source_watch_job_policy:${suffix}`,
      },
    });
    const comparison = comparisonObservation.observation as any;

    expect(comparison).toMatchObject({
      recommendedDecision: expectedDecision,
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    if (expectedSuppressed) {
      expect(comparison.suppressedCriteria).toEqual(expect.arrayContaining(expectedSuppressed));
    }
    if (expectedRisk) {
      expect(comparison.riskMatches).toEqual(expect.arrayContaining(expectedRisk));
    }
    if (expectedRiskAbsent) {
      for (const value of expectedRiskAbsent) {
        expect(comparison.riskMatches).not.toContain(value);
      }
    }
    if (expectedVoice) {
      expect(comparison.voiceCalloutMatches).toEqual(expect.arrayContaining(expectedVoice));
    }
    if (expectedVoiceAbsent) {
      for (const value of expectedVoiceAbsent) {
        expect(comparison.voiceCalloutMatches).not.toContain(value);
      }
    }
  });

  it("configures a live-source watch job policy without reading mail or answering", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_live_source_watch_job",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        objective: "Watch the visual source and only announce if a hostile mob appears.",
        decision_policy_prompt: "Only call out hostile mobs. Ignore ordinary camera movement.",
        importance_criteria: ["hostile mob appears"],
        suppress_criteria: ["ordinary camera movement"],
        output_policy: {
          allow_text_answer: true,
          allow_voice_callout: true,
          voice_requires_urgency: true,
          confirmation_required: false,
        },
      },
    });

    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.configure_live_source_watch_job",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(observation.summary).toContain("Configured live-source watch job policy");
    expect(observation.summary).toContain("no mail was read");
    const payload = observation.observation as any;
    expect(payload).toMatchObject({
      artifactId: "stage_play_live_source_watch_job_policy_config_result",
      schema: "stage_play_live_source_watch_job_policy_config_result/v1",
      schemaVersion: "stage_play_live_source_watch_job_policy_config_result/v1",
      watchJobPolicyRef: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
      watch_job_policy_ref: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
      policyCount: 1,
      policy: {
        artifactId: "stage_play_live_source_watch_job_policy",
        objectiveText: "Watch the visual source and only announce if a hostile mob appears.",
        decisionPolicyPrompt: "Only call out hostile mobs. Ignore ordinary camera movement.",
        sourceIds: [sourceId],
        outputPolicy: {
          allowTextAnswer: true,
          allowVoiceCallout: true,
          voiceRequiresUrgency: true,
        },
        importanceCriteria: ["hostile mob appears"],
        suppressCriteria: ["ordinary camera movement"],
        assistant_answer: false,
        terminal_eligible: false,
      },
      jobState: {
        objective: "Watch the visual source and only announce if a hostile mob appears.",
        watchJobPolicyRef: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
        nextLoopState: "armed_for_next_summary",
      },
      transcriptRows: [
        expect.objectContaining({
          rowKind: "loop_state",
          title: "Watch job configured",
          terminalEligible: false,
          assistantAnswer: false,
        }),
        expect.objectContaining({
          rowKind: "loop_state",
          title: "Objective",
          body: "Objective: Watch the visual source and only announce if a hostile mob appears.",
        }),
        expect.objectContaining({
          rowKind: "loop_state",
          title: "Source",
          body: `Source: ${sourceId}`,
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
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:automation:/),
      policyEvidenceRefs: ["allowed_actuator:configure_route_watch"],
      matchedAllowedActuators: [],
      matchedAllowedActuatorRefs: [],
      sourceRefs: expect.arrayContaining([sourceId]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:automation_policies",
        "workstation_context_feed:route_evidence",
        "workstation_actuator:configure_route_watch",
      ]),
      evidenceRefs: expect.arrayContaining([
        "allowed_actuator:configure_route_watch",
        sourceId,
        "workstation_context_feed:automation_policies",
        "workstation_context_feed:route_evidence",
        "workstation_actuator:configure_route_watch",
      ]),
    });
    expect(payload.artifactId).not.toBe("stage_play_live_source_mail_read_result");
    expect(payload.mailboxThreadId).toBe(threadId);
    expect(observation.producedRefs).toEqual(expect.arrayContaining([
      payload.policy.policyId,
      payload.jobState.jobId,
      payload.goalContextUpdateId,
    ]));
    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "automation",
    });
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: payload.goalContextUpdateId,
        contentRef: payload.policy.policyId,
        producerKind: "automation",
        updateKind: "automation_status",
        toolIdentity: {
          requestedToolName: "live_env.configure_live_source_watch_job",
          canonicalToolName: "live_env.configure_live_source_watch_job",
          matchedAllowedActuators: [],
          matchedAllowedActuatorRefs: [],
        },
        sourceRefs: expect.arrayContaining([sourceId]),
        loopRefs: expect.arrayContaining([
          payload.jobState.jobId,
          payload.policy.policyId,
          "workstation_context_feed:automation_policies",
          "workstation_context_feed:route_evidence",
          "workstation_actuator:configure_route_watch",
        ]),
        evidenceRefs: expect.arrayContaining([
          payload.policy.policyId,
          payload.jobState.jobId,
          "allowed_actuator:configure_route_watch",
        ]),
        freshness: expect.objectContaining({
          status: "fresh",
          staleAfterMs: 120_000,
        }),
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));
    const routeWatchUpdate = updates.find((update) => update.updateId === payload.goalContextUpdateId);
    expect(routeWatchUpdate?.suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: payload.policy.policyId }),
      expect.objectContaining({ kind: "update_panel", panelId: "stage-play-badge-graph" }),
      expect.objectContaining({ kind: "set_loop_state", loopRef: payload.jobState.jobId, state: "running" }),
    ]));
    expect(routeWatchUpdate?.suggestedDispatch.map((action) => action.kind)).not.toContain("wake_agent");
  });

  it("checkpoints goal-scoped route-watch automation when the goal allows configuration", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:route-watch-config",
        objective: "Monitor the visual source with a governed route-watch loop.",
        context_feeds: ["route_evidence", "visual_summaries"],
        allowed_actuators: ["configure_route_watch", "query_visual_summaries"],
      },
    });
    expect(sessionObservation.ok).toBe(true);
    const initialCheckpointCount = ((sessionObservation.observation as any).session.checkpoints ?? []).length;

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_live_source_watch_job",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:route-watch-config",
        objective: "Watch visual packets and record route evidence for this goal.",
        decision_policy_prompt: "Record route evidence for new visual summaries without answering directly.",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.configure_live_source_watch_job",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      artifactId: "stage_play_live_source_watch_job_policy_config_result",
      status: "configured",
      goalId: "goal:route-watch-config",
      goalSessionFound: true,
      requiredActuator: "configure_route_watch",
      actuatorAllowed: true,
      missingRequirements: [],
      policyEvidenceRefs: expect.arrayContaining([
        "allowed_actuator:configure_route_watch",
        "agent_goal_allowed_actuator:configure_route_watch",
      ]),
      matchedAllowedActuators: ["configure_route_watch"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:configure_route_watch"],
      sourceRefs: expect.arrayContaining([sourceId]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:automation_policies",
        "workstation_context_feed:route_evidence",
        "workstation_actuator:configure_route_watch",
      ]),
      evidenceRefs: expect.arrayContaining([
        "allowed_actuator:configure_route_watch",
        "agent_goal_allowed_actuator:configure_route_watch",
        sourceId,
        "workstation_context_feed:automation_policies",
        "workstation_context_feed:route_evidence",
        "workstation_actuator:configure_route_watch",
      ]),
      policy: expect.objectContaining({
        objectiveText: "Watch visual packets and record route evidence for this goal.",
        assistant_answer: false,
        terminal_eligible: false,
      }),
      jobState: expect.objectContaining({
        nextLoopState: "armed_for_next_summary",
      }),
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:automation:/),
      agentGoalSession: expect.objectContaining({
        goalId: "goal:route-watch-config",
        authority: hardenedGoalSessionAuthority(),
      }),
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(payload.agentGoalSession.checkpoints).toHaveLength(initialCheckpointCount + 1);
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: "Configured route-watch automation for this goal session.",
      actionsTaken: expect.arrayContaining(["configure_route_watch", "live_env.configure_live_source_watch_job"]),
      evidenceRefs: expect.arrayContaining([
        payload.goalContextUpdateId,
        payload.policy.policyId,
        payload.jobState.jobId,
        "allowed_actuator:configure_route_watch",
        "agent_goal_allowed_actuator:configure_route_watch",
      ]),
      nextStep: "continue",
    });

    const storedSession = listStagePlayAgentGoalSessions({
      threadId,
      goalId: "goal:route-watch-config",
      limit: 1,
    })[0];
    expect(storedSession?.checkpoints).toHaveLength(initialCheckpointCount + 1);
    expect(storedSession?.checkpoints.at(-1)).toMatchObject({
      summary: "Configured route-watch automation for this goal session.",
      actionsTaken: expect.arrayContaining(["configure_route_watch", "live_env.configure_live_source_watch_job"]),
      evidenceRefs: expect.arrayContaining([
        payload.goalContextUpdateId,
        payload.policy.policyId,
        payload.jobState.jobId,
        "agent_goal_allowed_actuator:configure_route_watch",
      ]),
    });
  });

  it("accepts live_env.configure_route_watch as the architecture-level route-watch control alias", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:route-watch-alias",
        objective: "Monitor the visual source with route-watch automation.",
        context_feeds: ["route_evidence", "visual_summaries"],
        allowed_actuators: ["configure_route_watch", "query_visual_summaries"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_route_watch",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:route-watch-alias",
        objective: "Watch visual packets and record route evidence under the route-watch alias.",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.configure_route_watch",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      artifactId: "stage_play_live_source_watch_job_policy_config_result",
      status: "configured",
      goalId: "goal:route-watch-alias",
      requiredActuator: "configure_route_watch",
      actuatorAllowed: true,
      policyEvidenceRefs: expect.arrayContaining([
        "allowed_actuator:configure_route_watch",
        "agent_goal_allowed_actuator:configure_route_watch",
      ]),
      matchedAllowedActuators: ["configure_route_watch"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:configure_route_watch"],
      sourceRefs: expect.arrayContaining([sourceId]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:automation_policies",
        "workstation_context_feed:route_evidence",
        "workstation_actuator:configure_route_watch",
      ]),
      evidenceRefs: expect.arrayContaining([
        "allowed_actuator:configure_route_watch",
        "agent_goal_allowed_actuator:configure_route_watch",
        sourceId,
        "workstation_context_feed:automation_policies",
        "workstation_context_feed:route_evidence",
        "workstation_actuator:configure_route_watch",
      ]),
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:automation:/),
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      agentGoalSession: expect.objectContaining({
        goalId: "goal:route-watch-alias",
      }),
    });
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: "Configured route-watch automation for this goal session.",
      actionsTaken: expect.arrayContaining(["configure_route_watch", "live_env.configure_route_watch"]),
      evidenceRefs: expect.arrayContaining([
        payload.goalContextUpdateId,
        payload.policy.policyId,
        payload.jobState.jobId,
        "agent_goal_allowed_actuator:configure_route_watch",
      ]),
      nextStep: "continue",
    });

    const routeWatchUpdate = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "automation",
      updateKind: "automation_status",
    }).find((update) => update.updateId === payload.goalContextUpdateId);
    expect(routeWatchUpdate).toMatchObject({
      contentRef: payload.policy.policyId,
      toolIdentity: {
        requestedToolName: "live_env.configure_route_watch",
        canonicalToolName: "live_env.configure_route_watch",
        matchedAllowedActuators: ["configure_route_watch"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:configure_route_watch"],
      },
      evidenceRefs: expect.arrayContaining([
        "allowed_actuator:configure_route_watch",
        "agent_goal_allowed_actuator:configure_route_watch",
      ]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:automation_policies",
        "workstation_context_feed:route_evidence",
        "workstation_actuator:configure_route_watch",
      ]),
      freshness: expect.objectContaining({ status: "fresh" }),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(routeWatchUpdate?.suggestedDispatch.map((action) => action.kind)).toEqual(expect.arrayContaining([
      "log_receipt",
      "update_panel",
      "set_loop_state",
    ]));
    expect(routeWatchUpdate?.suggestedDispatch.map((action) => action.kind)).not.toContain("wake_agent");
  });

  it("blocks goal-scoped route-watch automation when the goal omits the configure actuator", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:route-watch-query-only",
        objective: "Read route evidence without changing workstation loops.",
        context_feeds: ["route_evidence"],
        allowed_actuators: ["query_visual_summaries"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_live_source_watch_job",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:route-watch-query-only",
        objective: "Try to arm a route-watch loop without permission.",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.configure_live_source_watch_job",
      ok: false,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      artifactId: "stage_play_live_source_watch_job_policy_config_result",
      status: "blocked",
      policy: null,
      jobState: null,
      policyCount: 0,
      goalId: "goal:route-watch-query-only",
      goalSessionFound: true,
      requiredActuator: "configure_route_watch",
      actuatorAllowed: false,
      missingRequirements: ["allowed_actuator:configure_route_watch"],
      policyEvidenceRefs: ["allowed_actuator:configure_route_watch"],
      matchedAllowedActuators: [],
      matchedAllowedActuatorRefs: [],
      sourceRefs: expect.arrayContaining([sourceId]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:automation_policies",
        "workstation_context_feed:route_evidence",
        "workstation_actuator:configure_route_watch",
      ]),
      evidenceRefs: expect.arrayContaining([
        "allowed_actuator:configure_route_watch",
        sourceId,
        "workstation_context_feed:automation_policies",
        "workstation_context_feed:route_evidence",
        "workstation_actuator:configure_route_watch",
      ]),
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:automation:/),
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(observation.summary).toContain("Cannot configure live-source watch job");
    expect(observation.producedRefs).toEqual(expect.arrayContaining([payload.goalContextUpdateId]));

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "automation",
    });
    const blockedUpdate = updates.find((update) => update.updateId === payload.goalContextUpdateId);
    expect(blockedUpdate).toMatchObject({
      contentRef: expect.stringMatching(/^stage_play_live_source_watch_job_policy_config_blocked:/),
      producerKind: "automation",
      updateKind: "automation_status",
      toolIdentity: {
        requestedToolName: "live_env.configure_live_source_watch_job",
        canonicalToolName: "live_env.configure_live_source_watch_job",
        matchedAllowedActuators: [],
        matchedAllowedActuatorRefs: [],
      },
      sourceRefs: expect.arrayContaining([sourceId]),
      evidenceRefs: expect.arrayContaining(["allowed_actuator:configure_route_watch"]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:automation_policies",
        "workstation_context_feed:route_evidence",
        "workstation_actuator:configure_route_watch",
      ]),
      freshness: expect.objectContaining({ status: "blocked" }),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
      goalRelevance: expect.objectContaining({
        goalId: "goal:route-watch-query-only",
      }),
    });
    expect(blockedUpdate?.suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt" }),
      expect.objectContaining({ kind: "update_panel", panelId: "stage-play-badge-graph" }),
    ]));
    expect(blockedUpdate?.suggestedDispatch.map((action) => action.kind)).not.toContain("set_loop_state");
    expect(blockedUpdate?.suggestedDispatch.map((action) => action.kind)).not.toContain("wake_agent");
  });

  it("generates a strong default decision policy for describe-each-batch visual watch jobs", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_live_source_watch_job",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        objective: "Watch the active visual source and describe each new mail batch in one sentence.",
      },
    });

    const payload = observation.observation as any;
    expect(payload).toMatchObject({
      artifactId: "stage_play_live_source_watch_job_policy_config_result",
      policy: {
        objectiveText: "Watch the active visual source and describe each new visual-summary mail batch in one sentence.",
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
      },
      jobState: {
        objective: "Watch the active visual source and describe each new visual-summary mail batch in one sentence.",
        nextLoopState: "armed_for_next_summary",
      },
    });
    expect(payload.artifactId).not.toBe("stage_play_live_source_mail_read_result");
    expect(payload.transcriptRows.map((row: any) => row.title)).toEqual([
      "Watch job configured",
      "Objective",
      "Source",
      "Policy",
      "Loop state",
    ]);
    expect(payload.transcriptRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rowKind: "loop_state",
        title: "Objective",
        body: "Objective: Watch the active visual source and describe each new visual-summary mail batch in one sentence.",
      }),
      expect.objectContaining({
        rowKind: "loop_state",
        title: "Source",
        body: `Source: ${sourceId}`,
      }),
      expect.objectContaining({
        rowKind: "loop_state",
        title: "Policy",
        body: expect.stringContaining("latest_scene_answer"),
      }),
      expect.objectContaining({
        rowKind: "loop_state",
        title: "Policy",
        body: expect.stringContaining("voice disabled"),
      }),
      expect.objectContaining({
        rowKind: "loop_state",
        title: "Policy",
        body: expect.stringContaining("confirmation required"),
      }),
      expect.objectContaining({
        rowKind: "loop_state",
        title: "Loop state",
        body: "Loop state: armed for next summary.",
      }),
    ]));
    expect(observation.assistant_answer).toBe(false);
    expect(payload.terminal_eligible).toBe(false);
  });

  it.each(["live_env.check_live_source_mail", "live_env.read_live_source_mail"] as const)(
    "reads latest visual summary mail as evidence through %s and requires a follow-up model decision",
    (toolName) => {
    seedVisualSummary();

    const observation = executeLiveEnvironmentTool({
      tool_name: toolName,
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });

    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: toolName,
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(observation.summary).toBe("Read 1 unread live-source mail item(s); decision required.");
    const payload = observation.observation as any;
    expect(payload).toMatchObject({
      artifactId: "stage_play_live_source_mail_read_result",
      items: [
        expect.objectContaining({
          sourceId,
          sourceRefs: expect.objectContaining({
            frameRef: "visual_frame:helix-ask-live-source-mail-tool",
            evidenceRef: "visual_evidence:helix-ask-live-source-mail-tool",
          }),
          assistant_answer: false,
          terminal_eligible: false,
        }),
      ],
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
    });
    expect(payload.transcriptRows.map((row: any) => row.rowKind)).toEqual(expect.arrayContaining([
      "mail_read_tool_call",
      "mail_read_receipt",
    ]));
    expect(observation.evidence_refs).toEqual(expect.arrayContaining([
      sourceId,
      "visual_frame:helix-ask-live-source-mail-tool",
      "visual_evidence:helix-ask-live-source-mail-tool",
    ]));
  });

  it("reads a full default same-source batch through live_env.read_live_source_mail when args are empty", () => {
    seedVisualSummaries(5);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });

    const payload = observation.observation as any;
    expect(observation.summary).toBe("Read 5 unread live-source mail item(s); decision required.");
    expect(payload.items.map((item: any) => item.mailId)).toHaveLength(5);
    expect(payload.items.map((item: any) => item.summary.text)).toEqual([
      expect.stringContaining("Live frame 1"),
      expect.stringContaining("Live frame 2"),
      expect.stringContaining("Live frame 3"),
      expect.stringContaining("Live frame 4"),
      expect.stringContaining("Live frame 5"),
    ]);
  });

  it("processes and reads processed live-source mail packets as evidence-only receipts", () => {
    seedVisualSummaryText("Minecraft cave scene with low light and the player near fire damage.", "processed");

    const processObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });

    const processPayload = processObservation.observation as any;
    expect(processPayload.schema).toBe("stage_play_processed_live_source_mail_read_result/v1");
    expect(processPayload.processedPacketRefs).toHaveLength(1);
    expect(processPayload.packets[0]).toMatchObject({
      artifactId: "stage_play_processed_mail_packet",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
    });
    expect(processPayload.packets[0].salience.voiceCandidate).toBe(true);
    expect(processPayload.packets[0].evidenceHandles).toMatchObject({
      sourceReceipts: expect.arrayContaining([
        expect.objectContaining({
          sourceId,
          sourceKind: "visual_frame",
        }),
      ]),
      frameReceipts: expect.arrayContaining([
        expect.objectContaining({
          sourceId,
          sourceKind: "visual_frame",
          parentMailId: expect.any(String),
        }),
      ]),
      frameIntervals: expect.arrayContaining([
        expect.objectContaining({
          sourceId,
          keyFrameIds: expect.any(Array),
          reasonCaptured: expect.any(String),
        }),
      ]),
      lensProducts: [],
      situationSlices: expect.any(Array),
    });
    expect(processPayload.packets[0].actionPredictions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorId: sourceId,
        basis: expect.arrayContaining(["goal_object"]),
        frameIntervalRefs: expect.any(Array),
        sourceSliceRefs: expect.any(Array),
        recommendedNext: "request_voice_callout",
      }),
    ]));
    expect(processPayload.packets[0].unresolvedLeads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        neededSources: expect.arrayContaining([sourceId]),
        suggestedFrameIntervals: expect.arrayContaining([
          expect.objectContaining({
            lensPresets: expect.arrayContaining(["raw_thumbnail", "motion_delta", "object_track", "occlusion_map"]),
          }),
        ]),
      }),
    ]));
    expect(processPayload.microReasonerRunRefs.length).toBeGreaterThanOrEqual(8);
    expect(processPayload.microReasonerRuns.map((run: any) => run.role)).toEqual(expect.arrayContaining([
      "decision_selector",
      "voice_callout_drafter",
    ]));
    expect(processPayload.microReasonerRuns.find((run: any) => run.role === "decision_selector")).toMatchObject({
      selectedDecision: "request_voice_callout",
      recommendedNextTool: "live_env.record_live_source_mail_decision",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "micro_reasoner_evidence",
    });
    expect(processPayload.transcriptRows.map((row: any) => row.rowKind)).toContain("micro_reasoner_run");
    expect(processPayload.microReasonerRuns.every((run: any) => run.promptId)).toBe(true);

    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_processed_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
        route_metadata: {
          wakeRequestId: "stage_play_mail_wake:test-read",
          askTurnId: "ask:test-read",
        },
      },
    });

    const readPayload = readObservation.observation as any;
    expect(readObservation.summary).toContain("processed live-source packet");
    expect(readObservation.producedRefs).toContain(processPayload.packets[0].packetId);
    expect(readObservation.artifactRefs).toMatchObject({
      processedPacketIds: expect.arrayContaining([processPayload.packets[0].packetId]),
      wakeRequestId: "stage_play_mail_wake:test-read",
      askTurnId: "ask:test-read",
    });
    expect(readPayload.packets.map((packet: any) => packet.packetId)).toContain(processPayload.packets[0].packetId);
    expect(readPayload.missingRawMailIds).toEqual([]);
    expect(readPayload.fallbackTool).toBeNull();
    expect(readPayload.assistant_answer).toBe(false);
    expect(readPayload.terminal_eligible).toBe(false);
  });

  it("keeps a transient model thread argument from overriding the canonical room mailbox", () => {
    const canonicalRoomThreadId = `helix-ask:room:${roomId}`;
    const transientAskThreadId = "ask:current-turn-only";
    seedVisualSummaryText(
      "Minecraft guardian completed a bounded step and released controls.",
      "canonical-room-mailbox",
      { threadId: canonicalRoomThreadId },
    );

    const processed = executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: canonicalRoomThreadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });
    const processedPacketId = (processed.observation as any).processedPacketRefs[0];
    const read = executeLiveEnvironmentTool({
      tool_name: "live_env.read_processed_live_source_mail",
      thread_id: canonicalRoomThreadId,
      args: {
        thread_id: transientAskThreadId,
        room_id: roomId,
        source_id: sourceId,
        read_only: true,
      },
    });
    const payload = read.observation as any;

    expect(read.ok).toBe(true);
    expect(payload.mailboxThreadId).toBe(canonicalRoomThreadId);
    expect(payload.mailboxThreadResolution.reason).not.toBe("explicit_mailbox_thread_id");
    expect(payload.processedPacketRefs).toContain(processedPacketId);
  });

  it("still honors an explicit mailbox_thread_id and does not cross into room mail", () => {
    const canonicalRoomThreadId = `helix-ask:room:${roomId}`;
    const isolatedMailboxThreadId = "helix-ask:room:room:other";
    seedVisualSummaryText(
      "Minecraft guardian completed a bounded step and released controls.",
      "explicit-mailbox-isolation",
      { threadId: canonicalRoomThreadId },
    );
    executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: canonicalRoomThreadId,
      args: { room_id: roomId, source_id: sourceId, source_kind: "visual_frame" },
    });
    const read = executeLiveEnvironmentTool({
      tool_name: "live_env.read_processed_live_source_mail",
      thread_id: canonicalRoomThreadId,
      args: {
        mailbox_thread_id: isolatedMailboxThreadId,
        room_id: "room:other",
        source_id: sourceId,
        read_only: true,
      },
    });
    const payload = read.observation as any;

    expect(read.ok).toBe(false);
    expect(payload.mailboxThreadId).toBe(isolatedMailboxThreadId);
    expect(payload.mailboxThreadResolution.reason).toBe("explicit_mailbox_thread_id");
    expect(payload.processedPacketRefs).toEqual([]);
  });

  it("starts an agent goal session through live_env.start_agent_goal_session as non-terminal tool evidence", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:frog-classification",
        objective: "Monitor the image source and prepare frog classification evidence.",
        construct_refs: ["live_answer_environment:frog"],
        context_feeds: [
          { source_kind: "visual", freshness_ms: 15_000, relevance_policy: "frog classification" },
          { source_kind: "translation", query: "species hints" },
          { source_kind: "trace_memory" },
        ],
        allowed_actuators: [
          "query_visual_summaries",
          "query_translation_segments",
          "query_source_health",
          "configure_route_watch",
          "set_visual_preset",
          "bind_source",
          "bind_narrator",
          "narrator_bind_stream",
          "query_trace_memory",
          "set_loop_state",
          "focus_process_graph",
        ],
        cadence: { kind: "event_accumulation", min_updates: 3 },
        stop_conditions: ["frog classified with terminal authority"],
        final_report_requirements: {
          completed_solver_path_required: false,
          allowed_terminal_artifact_kinds: [
            "final_answer",
            "microdeck_output",
          ],
          required_evidence_kinds: [
            "goal_context_update",
            "packet_trace",
            "terminal_authority_single_writer",
          ],
          prohibited_report_sources: [
            "tool_receipt",
            "panel_projection",
            "microdeck_output",
          ],
        },
        checkpoint_summary: "Goal session initialized from ImageLens frog classification prompt.",
        actions_taken: ["bind_visual_source"],
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.start_agent_goal_session",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_agent_goal_session_tool_result/v1",
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
      session: {
        goalId: "goal:frog-classification",
        objective: "Monitor the image source and prepare frog classification evidence.",
        sourceRefs: expect.arrayContaining([sourceId]),
        constructRefs: ["live_answer_environment:frog"],
        contextFeeds: expect.arrayContaining([
          expect.objectContaining({
            sourceKind: "visual_summaries",
            freshnessMs: 15000,
            relevancePolicy: "frog classification",
          }),
          expect.objectContaining({
            sourceKind: "translated_transcripts",
            query: "species hints",
          }),
          expect.objectContaining({ sourceKind: "trace_memory" }),
        ]),
        allowedActuators: expect.arrayContaining([
          "query_visual_summaries",
          "query_translation_segments",
          "query_source_health",
          "configure_route_watch",
          "set_visual_preset",
          "bind_source",
          "bind_narrator",
          "narrator_bind_stream",
          "query_trace_memory",
          "set_loop_state",
          "focus_process_graph",
        ]),
        cadence: { kind: "event_accumulation", minUpdates: 3 },
        stopConditions: expect.arrayContaining(["frog classified with terminal authority"]),
        checkpoints: expect.arrayContaining([
          expect.objectContaining({
            summary: "Goal session initialized from ImageLens frog classification prompt.",
            actionsTaken: expect.arrayContaining(["bind_visual_source", "start_agent_goal_session"]),
            nextStep: "continue",
          }),
        ]),
        authority: hardenedGoalSessionAuthority({
          allowedTerminalArtifactKinds: expect.arrayContaining(["final_answer"]),
          requiredEvidenceKinds: expect.arrayContaining([
            "goal_context_update",
            "agent_step_observation_packet",
            "route_product_contract",
            "packet_trace",
            "terminal_authority_single_writer",
          ]),
          prohibitedReportSources: expect.arrayContaining([
            "tool_receipt",
            "workstation_control_receipt",
            "panel_projection",
            "live_answer_projection",
            "microdeck_output",
            "narrator_event",
            "narrator_binding",
            "interrupt_dispatch",
            "wake_request",
            "wake_result",
            "actuator_ref",
          ]),
        }),
      },
    });
    expect(payload.session.authority.finalReportRequirements.allowedTerminalArtifactKinds).not.toContain("microdeck_output");
    expect(observation.producedRefs).toEqual(["goal:frog-classification"]);
    expect(observation.evidence_refs).toEqual(expect.arrayContaining([
      "goal:frog-classification",
      sourceId,
    ]));
  });

  it("queries synced workstation goal context through live_env.query_workstation_goal_context", () => {
    seedVisualSummaryText("ImageLens shows a frog image ready for classification.", "goal-context");

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:context-query",
        objective: "Inspect visual goal-context updates and session controls.",
        context_feeds: ["visual_summaries", "microdeck_outputs", "trace_memory"],
        allowed_actuators: ["query_visual_summaries", "query_microdeck_outputs", "query_trace_memory"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const processObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });
    const processPayload = processObservation.observation as any;

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_workstation_goal_context",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });

    const queryPayload = queryObservation.observation as any;
    expect(queryObservation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.query_workstation_goal_context",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_goal_context_read_result/v1",
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
      syncedWindow: {
        mailItemCount: 1,
        processedPacketCount: 1,
      },
    });
    expect(queryPayload.agentGoalSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        goalId: "goal:context-query",
        authority: hardenedGoalSessionAuthority(),
      }),
    ]));
    expect(queryPayload.authoritySummary).toMatchObject({
      schema: "helix.workstation_goal_context_authority_summary.v1",
      updateCount: 2,
      observationOnlyUpdateCount: 2,
      assistantAnswerCount: 0,
      terminalEligibleCount: 0,
      rawContentIncludedCount: 0,
      postToolModelStepRequiredCount: 2,
      activeGoalSessionCount: 1,
      finalReportsRequireTerminalAuthorityCount: 1,
      wakeInterruptCount: 0,
      answerAuthority: "completed_solver_path_required",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      post_tool_model_step_required: true,
    });
    expect(queryPayload.authoritySummary.allowedActuators).toEqual(expect.arrayContaining([
      "query_visual_summaries",
      "query_microdeck_outputs",
      "query_trace_memory",
    ]));
    expect(queryPayload.authoritySummary.dispatchCounts).toMatchObject({
      append_goal_context: expect.any(Number),
      log_receipt: expect.any(Number),
      update_panel: expect.any(Number),
    });
    expect(queryPayload.goalContextUpdates).toHaveLength(2);
    const processedUpdate = queryPayload.goalContextUpdates.find((update: any) => update.contentRef === processPayload.packets[0].packetId);
    expect(processedUpdate).toMatchObject({
      contentRef: processPayload.packets[0].packetId,
      sourceRefs: expect.arrayContaining([sourceId]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(queryPayload.goalContextUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contentRef: processPayload.packets[0].packetId,
      }),
      expect.objectContaining({
        contentRef: expect.stringMatching(/^stage_play_live_source_mail:/),
      }),
    ]));
    expect(processedUpdate.suggestedDispatch.map((action: any) => action.kind)).toEqual(expect.arrayContaining([
      "log_receipt",
      "append_goal_context",
      "update_panel",
    ]));
    expect(queryObservation.producedRefs).toContain(processedUpdate.updateId);
    expect(queryObservation.producedRefs).toContain("goal:context-query");
    expect(queryObservation.evidence_refs).toEqual(expect.arrayContaining([
      processPayload.packets[0].packetId,
      "goal:context-query",
      sourceId,
    ]));
  });

  it("filters workstation goal sessions by context feed and allowed actuator without terminal authority", () => {
    const traceSessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:trace-narrator-context",
        objective: "Inspect trace memory and bind narrator output when translation context is available.",
        context_feeds: ["trace_memory", "translated_transcripts"],
        allowed_actuators: ["query_trace_memory", "narrator_bind_stream"],
      },
    });
    expect(traceSessionObservation.ok).toBe(true);

    const visualSessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:visual-only-context",
        objective: "Inspect visual summaries without narrator dispatch.",
        context_feeds: ["visual_summaries"],
        allowed_actuators: ["query_visual_summaries"],
      },
    });
    expect(visualSessionObservation.ok).toBe(true);

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_workstation_goal_context",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        context_feed_kind: "trace_memory",
        allowed_actuator: "narrator_bind_stream",
      },
    });

    const queryPayload = queryObservation.observation as any;
    expect(queryObservation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.query_workstation_goal_context",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_goal_context_read_result/v1",
      requestedContextFeedKind: "trace_memory",
      requested_context_feed_kind: "trace_memory",
      requestedAllowedActuator: "narrator_bind_stream",
      requested_allowed_actuator: "narrator_bind_stream",
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload.agentGoalSessions.map((session: any) => session.goalId)).toEqual([
      "goal:trace-narrator-context",
    ]);
    expect(queryPayload.agentGoalSessions).toEqual([
      expect.objectContaining({
        goalId: "goal:trace-narrator-context",
        contextFeeds: expect.arrayContaining([
          expect.objectContaining({ sourceKind: "trace_memory" }),
        ]),
        allowedActuators: expect.arrayContaining([
          "narrator_bind_stream",
        ]),
        authority: hardenedGoalSessionAuthority(),
      }),
    ]);
    expect(queryPayload.authoritySummary).toMatchObject({
      activeGoalSessionCount: 1,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      post_tool_model_step_required: true,
    });
    expect(queryObservation.producedRefs).toEqual(["goal:trace-narrator-context"]);
    expect(queryObservation.evidence_refs).toEqual(expect.arrayContaining([
      "agent_goal_session_filter:context_feed:trace_memory",
      "agent_goal_session_filter:allowed_actuator:narrator_bind_stream",
      "goal:trace-narrator-context",
      sourceId,
    ]));
    expect(queryObservation.evidence_refs).not.toContain("goal:visual-only-context");
  });

  it("evaluates goal satisfaction as a non-terminal goal-context update and session checkpoint", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:satisfaction-check",
        objective: "Decide whether the frog-classification workstation goal has enough evidence for final-report preparation.",
        context_feeds: ["visual_summaries", "trace_memory"],
        allowed_actuators: ["query_visual_summaries", "query_trace_memory", "evaluate_goal_satisfaction"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const seededUpdate = recordStagePlayGoalContextUpdate({
      schemaVersion: "helix.workstation_goal_context_update.v1",
      updateId: "stage_play_goal_context_update:frog:satisfaction",
      createdAtMs: 1781736210000,
      sourceRefs: [sourceId],
      loopRefs: [`thread:${threadId}`, "workstation_context_feed:visual_summaries"],
      producerKind: "visual_capture",
      updateKind: "visual_observation",
      contentRef: "visual_evidence:frog:satisfaction",
      preview: "Frog-classification visual evidence is ready for final-report preparation.",
      evidenceRefs: ["visual_evidence:frog:satisfaction", "goal_context_update:frog"],
      receiptRefs: ["visual_evidence:frog:satisfaction"],
      freshness: {
        observedAtMs: 1781736210000,
        staleAfterMs: 30000,
        status: "fresh",
      },
      goalRelevance: {
        goalId: "goal:satisfaction-check",
        relevance: 0.9,
        reason: "Evidence belongs to the frog-classification goal.",
      },
      suggestedDispatch: [{ kind: "log_receipt", receiptRef: "visual_evidence:frog:satisfaction" }],
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });

    const evaluationObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.evaluate_goal_satisfaction",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:satisfaction-check",
        evidence_refs: [
          seededUpdate.updateId,
          "agent_step_observation_packet:frog",
          "route_product_contract:frog",
          "terminal_authority_single_writer:frog",
        ],
      },
    });

    const payload = evaluationObservation.observation as any;
    expect(evaluationObservation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.evaluate_goal_satisfaction",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.live_environment_goal_satisfaction.v1",
      goalId: "goal:satisfaction-check",
      status: "satisfied",
      satisfied: true,
      missingRequirements: [],
      requiredActuator: "evaluate_goal_satisfaction",
      actuatorAllowed: true,
      matchedAllowedActuators: ["evaluate_goal_satisfaction"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:evaluate_goal_satisfaction"],
      policyEvidenceRefs: expect.arrayContaining([
        "allowed_actuator:evaluate_goal_satisfaction",
        "agent_goal_allowed_actuator:evaluate_goal_satisfaction",
      ]),
      sourceRefs: expect.arrayContaining([sourceId]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:trace_memory",
        "workstation_actuator:evaluate_goal_satisfaction",
      ]),
      evidenceRefs: expect.arrayContaining([
        "allowed_actuator:evaluate_goal_satisfaction",
        "agent_goal_allowed_actuator:evaluate_goal_satisfaction",
        sourceId,
        "workstation_context_feed:trace_memory",
        "workstation_actuator:evaluate_goal_satisfaction",
      ]),
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      agentGoalSession: expect.objectContaining({
        goalId: "goal:satisfaction-check",
        status: "satisfied",
        authority: hardenedGoalSessionAuthority(),
        checkpoints: expect.arrayContaining([
          expect.objectContaining({
            actionsTaken: expect.arrayContaining(["evaluate_goal_satisfaction", "live_env.evaluate_goal_satisfaction"]),
            evidenceRefs: expect.arrayContaining([
              "allowed_actuator:evaluate_goal_satisfaction",
              "agent_goal_allowed_actuator:evaluate_goal_satisfaction",
            ]),
            nextStep: "report",
          }),
        ]),
      }),
    });
    expect(payload.goalContextUpdateId).toMatch(/^stage_play_goal_context_update:reflection:/);
    expect(evaluationObservation.evidence_refs).toEqual(expect.arrayContaining([
      "allowed_actuator:evaluate_goal_satisfaction",
      "agent_goal_allowed_actuator:evaluate_goal_satisfaction",
      "workstation_context_feed:trace_memory",
      "workstation_actuator:evaluate_goal_satisfaction",
    ]));
    expect(evaluationObservation.producedRefs).toEqual(expect.arrayContaining([payload.goalContextUpdateId, payload.resultId]));
    const satisfactionUpdate = listStagePlayGoalContextUpdates({ threadId, goalId: "goal:satisfaction-check", limit: 10 })
      .find((update) => update.updateId === payload.goalContextUpdateId);
    expect(satisfactionUpdate).toMatchObject({
      updateId: payload.goalContextUpdateId,
      producerKind: "reflection",
      updateKind: "summary",
      toolIdentity: {
        requestedToolName: "live_env.evaluate_goal_satisfaction",
        canonicalToolName: "live_env.evaluate_goal_satisfaction",
        matchedAllowedActuators: ["evaluate_goal_satisfaction"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:evaluate_goal_satisfaction"],
      },
      sourceRefs: expect.arrayContaining([sourceId]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:trace_memory",
        "workstation_actuator:evaluate_goal_satisfaction",
      ]),
      evidenceRefs: expect.arrayContaining([
        "allowed_actuator:evaluate_goal_satisfaction",
        "agent_goal_allowed_actuator:evaluate_goal_satisfaction",
        "workstation_context_feed:trace_memory",
        "workstation_actuator:evaluate_goal_satisfaction",
      ]),
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      authority: expect.objectContaining({
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
      }),
    });
    expect(listStagePlayAgentGoalSessions({ threadId, goalId: "goal:satisfaction-check", limit: 1 })[0]).toMatchObject({
      status: "satisfied",
    });

    const traceLaneRead = executeLiveEnvironmentTool({
      tool_name: "live_env.query_workstation_goal_context",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:satisfaction-check",
        loop_ref: "workstation_context_feed:trace_memory",
        producer_kind: "reflection",
      },
    });
    const traceLanePayload = traceLaneRead.observation as any;
    expect(traceLaneRead.ok).toBe(true);
    expect(traceLanePayload.goalContextUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: payload.goalContextUpdateId,
        producerKind: "reflection",
        updateKind: "summary",
        loopRefs: expect.arrayContaining(["workstation_context_feed:trace_memory"]),
        authority: expect.objectContaining({
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
        }),
      }),
    ]));
  });

  it("queries per-packet traces through live_env.query_packet_traces as non-terminal evidence", () => {
    seedVisualSummaryText("ImageLens visual summary: frog sitting on a green leaf.", "packet-trace");

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:packet-trace",
        objective: "Debug individual packet travel from visual source through MicroDeck outputs.",
        context_feeds: ["packet_traces", "microdeck_outputs"],
        allowed_actuators: ["query_packet_traces", "query_microdeck_outputs"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const processObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });
    const processPayload = processObservation.observation as any;
    const packetId = processPayload.packets[0].packetId;

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_packet_traces",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
        goal_id: "goal:packet-trace",
        packet_id: packetId,
      },
    });

    const payload = queryObservation.observation as any;
    expect(queryObservation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.query_packet_traces",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
      artifactRefs: {
        processedPacketIds: [packetId],
      },
    });
    expect(payload).toMatchObject({
      schema: "stage_play_packet_trace_query_result/v1",
      packetId,
      goalId: "goal:packet-trace",
      traceCount: 1,
      contractValid: true,
      contractValidationIssues: [],
      requiredFeed: "packet_traces",
      requiredActuator: "query_packet_traces",
      matchedContextFeeds: [
        expect.objectContaining({
          sourceKind: "packet_traces",
        }),
      ],
      matchedContextFeedRefs: [expect.any(String)],
      matchedAllowedActuators: ["query_packet_traces"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_packet_traces"],
      policyEvidenceRefs: expect.arrayContaining([
        "context_feed:packet_traces",
        "allowed_actuator:query_packet_traces",
        "agent_goal_allowed_actuator:query_packet_traces",
      ]),
      sourceRefs: expect.arrayContaining([sourceId]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:packet_traces",
        "workstation_actuator:query_packet_traces",
      ]),
      evidenceRefs: expect.arrayContaining([
        "context_feed:packet_traces",
        "allowed_actuator:query_packet_traces",
        "agent_goal_allowed_actuator:query_packet_traces",
        sourceId,
        "workstation_context_feed:packet_traces",
        "workstation_actuator:query_packet_traces",
      ]),
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload.packetTraces[0]).toMatchObject({
      schema: "helix.stage_play.packet_trace.v1",
      packetId,
      sourceId,
      mailIds: expect.any(Array),
      microReasonerRunRefs: expect.any(Array),
      causalTrace: expect.objectContaining({
        schemaVersion: "live_source_causal_trace/v1",
        traceId: expect.any(String),
        producedRefs: expect.arrayContaining([packetId]),
      }),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.policyEvidenceRefs).toContain(`agent_goal_context_feed:${payload.matchedContextFeedRefs[0]}`);
    expect(payload.evidenceRefs).toEqual(expect.arrayContaining([
      payload.matchedContextFeedRefs[0],
      `agent_goal_context_feed:${payload.matchedContextFeedRefs[0]}`,
    ]));
    expect(payload.goalContextUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contentRef: packetId,
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));
    expect(payload.authoritySummary).toMatchObject({
      answerAuthority: "completed_solver_path_required",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      post_tool_model_step_required: true,
    });
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining(["query_packet_traces", "live_env.query_packet_traces"]),
      evidenceRefs: expect.arrayContaining([
        "context_feed:packet_traces",
        "allowed_actuator:query_packet_traces",
        "agent_goal_allowed_actuator:query_packet_traces",
      ]),
      nextStep: "continue",
    });
    expect(payload.agentGoalSession.loopRefs).toEqual(expect.arrayContaining([
      "workstation_context_feed:packet_traces",
      "workstation_actuator:query_packet_traces",
    ]));
    const routeUpdate = listStagePlayGoalContextUpdates({
      threadId,
      contentRef: payload.resultId,
      limit: 1,
    })[0];
    expect(routeUpdate).toMatchObject({
      producerKind: "route_watch",
      updateKind: "route_evidence",
      toolIdentity: {
        requestedToolName: "live_env.query_packet_traces",
        canonicalToolName: "live_env.query_packet_traces",
        matchedAllowedActuators: ["query_packet_traces"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_packet_traces"],
      },
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(routeUpdate.evidenceRefs).toEqual(expect.arrayContaining([
      "context_feed:packet_traces",
      "allowed_actuator:query_packet_traces",
      "agent_goal_allowed_actuator:query_packet_traces",
    ]));
    expect(routeUpdate.loopRefs).toEqual(expect.arrayContaining([
      "workstation_context_feed:packet_traces",
      "workstation_actuator:query_packet_traces",
    ]));
    expect(routeUpdate.suggestedDispatch.map((action) => action.kind)).not.toContain("wake_agent");
    expect(queryObservation.evidence_refs).toEqual(expect.arrayContaining([
      "context_feed:packet_traces",
      "allowed_actuator:query_packet_traces",
      "agent_goal_allowed_actuator:query_packet_traces",
    ]));
    expect(queryObservation.producedRefs).toEqual(expect.arrayContaining([
      payload.goalContextUpdateId,
      payload.resultId,
      packetId,
    ]));
  });

  it("keeps implicit goal-scoped packet trace queries inside the AgentGoalSession source boundary", () => {
    const targetSourceRef = "visual_source:packet-trace-target";
    const otherSourceRef = "visual_source:packet-trace-unrelated";
    startVisualSnapshotSource({
      source_id: targetSourceRef,
      thread_id: threadId,
      room_id: roomId,
      source_surface: "browser_tab",
      capture_mode: "interval",
      status: "active",
    });
    const targetFrame = recordVisualFrame({
      source_id: targetSourceRef,
      thread_id: threadId,
      room_id: roomId,
      frame_id: "visual_frame:packet-trace-target",
      ts: "2026-06-04T12:11:00.000Z",
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: targetFrame.frame_id,
      evidence_id: "visual_evidence:packet-trace-target",
      summary: "Target source shows a frog classification frame for the active goal.",
      supports_claims: [
        {
          claim: "The target packet belongs to the frog classification source.",
          support_status: "supports",
          confidence: 0.82,
        },
      ],
    });
    startVisualSnapshotSource({
      source_id: otherSourceRef,
      thread_id: threadId,
      room_id: roomId,
      source_surface: "browser_tab",
      capture_mode: "interval",
      status: "active",
    });
    const otherFrame = recordVisualFrame({
      source_id: otherSourceRef,
      thread_id: threadId,
      room_id: roomId,
      frame_id: "visual_frame:packet-trace-unrelated",
      ts: "2026-06-04T12:11:01.000Z",
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: otherFrame.frame_id,
      evidence_id: "visual_evidence:packet-trace-unrelated",
      summary: "Unrelated source shows translation subtitles and should not enter the packet trace goal.",
      supports_claims: [
        {
          claim: "The unrelated packet belongs to another source.",
          support_status: "supports",
          confidence: 0.78,
        },
      ],
    });

    const targetProcessObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: targetSourceRef,
        source_kind: "visual_frame",
      },
    });
    const otherProcessObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: otherSourceRef,
        source_kind: "visual_frame",
      },
    });
    const targetPacketId = (targetProcessObservation.observation as any).packets[0].packetId;
    const otherPacketId = (otherProcessObservation.observation as any).packets[0].packetId;

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_refs: [targetSourceRef],
        loop_refs: ["stage_play_mail_loop:packet-trace-target"],
        goal_id: "goal:packet-trace-source-boundary",
        objective: "Inspect packet travel only for the target frog classification source.",
        context_feeds: ["packet_traces"],
        allowed_actuators: ["query_packet_traces"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_packet_traces",
      thread_id: threadId,
      args: {
        room_id: roomId,
        goal_id: "goal:packet-trace-source-boundary",
      },
    });

    const payload = queryObservation.observation as any;
    expect(queryObservation.ok).toBe(true);
    expect(payload).toMatchObject({
      status: "read",
      goalId: "goal:packet-trace-source-boundary",
      traceCount: 1,
      requiredFeed: "packet_traces",
      requiredActuator: "query_packet_traces",
      matchedAllowedActuators: ["query_packet_traces"],
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.packetTraces).toEqual([
      expect.objectContaining({
        packetId: targetPacketId,
        sourceId: targetSourceRef,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
    ]);
    expect(payload.packetTraces.map((trace: any) => trace.packetId)).not.toContain(otherPacketId);
    expect(payload.sourceRefs).toEqual(expect.arrayContaining([targetSourceRef]));
    expect(payload.sourceRefs).not.toContain(otherSourceRef);
    expect(payload.evidenceRefs).toEqual(expect.arrayContaining([targetPacketId, targetSourceRef]));
    expect(payload.evidenceRefs).not.toContain(otherPacketId);
    expect(payload.evidenceRefs).not.toContain(otherSourceRef);
    expect(payload.goalContextUpdates.map((update: any) => update.contentRef)).toContain(targetPacketId);
    expect(payload.goalContextUpdates.map((update: any) => update.contentRef)).not.toContain(otherPacketId);
    expect(payload.syncedWindow).toMatchObject({
      processedPacketCount: 1,
    });
    expect(queryObservation.artifactRefs).toEqual(expect.objectContaining({
      processedPacketIds: [targetPacketId],
    }));
    expect(queryObservation.producedRefs).toEqual(expect.arrayContaining([targetPacketId, payload.resultId]));
    expect(queryObservation.producedRefs).not.toContain(otherPacketId);
  });

  it("queries route-watch evidence through live_env.query_route_evidence as non-terminal feed evidence", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:route-evidence-query",
        objective: "Inspect route-watch evidence without waking the agent.",
        context_feeds: ["route_evidence"],
        allowed_actuators: ["configure_route_watch", "query_route_evidence"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const configureObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_route_watch",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:route-evidence-query",
        objective: "Record route-watch evidence for visual packets.",
      },
    });
    const configurePayload = configureObservation.observation as any;
    expect(configureObservation.ok).toBe(true);

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_route_evidence",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
        goal_id: "goal:route-evidence-query",
      },
    });

    const queryPayload = queryObservation.observation as any;
    expect(queryObservation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.query_route_evidence",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      contractValid: true,
      contractValidationIssues: [],
      feedKind: "route_evidence",
      goalId: "goal:route-evidence-query",
      status: "read",
      requiredActuator: "query_route_evidence",
      feedAllowed: true,
      actuatorAllowed: true,
      updateCount: expect.any(Number),
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload.goalContextUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: configurePayload.goalContextUpdateId,
        producerKind: "automation",
        updateKind: "automation_status",
        toolIdentity: {
          requestedToolName: "live_env.configure_route_watch",
          canonicalToolName: "live_env.configure_route_watch",
          matchedAllowedActuators: ["configure_route_watch"],
          matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:configure_route_watch"],
        },
        sourceRefs: expect.arrayContaining([sourceId]),
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));
    expect(queryPayload.packetCircuitRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: configurePayload.goalContextUpdateId,
        routeWatchRefs: expect.arrayContaining(["workstation_context_feed:route_evidence"]),
        assistant_answer: false,
        terminal_eligible: false,
      }),
    ]));
    expect(queryPayload.authoritySummary).toMatchObject({
      answerAuthority: "completed_solver_path_required",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      post_tool_model_step_required: true,
    });
    expect(queryPayload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining(["query_route_evidence", "live_env.query_route_evidence"]),
      nextStep: "continue",
    });
    const routeEvidenceQueryUpdate = listStagePlayGoalContextUpdates({
      threadId,
      contentRef: queryPayload.resultId,
      limit: 1,
    })[0];
    expect(routeEvidenceQueryUpdate).toMatchObject({
      producerKind: "route_watch",
      updateKind: "route_evidence",
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(routeEvidenceQueryUpdate.suggestedDispatch.map((action) => action.kind)).not.toContain("wake_agent");
    expect(queryObservation.producedRefs).toEqual(expect.arrayContaining([
      queryPayload.goalContextUpdateId,
      queryPayload.resultId,
      configurePayload.goalContextUpdateId,
    ]));
  });

  it("queries interpreted event logs as goal-scoped route evidence without crossing source boundaries", () => {
    const targetSourceRef = "visual_source:event-log-target";
    const otherSourceRef = "visual_source:event-log-unrelated";
    const targetEvent = appendInterpretedEvent({
      event_id: "interpreted:event-log-target",
      thread_id: threadId,
      room_id: roomId,
      source_family: "visual_source",
      kind: "tool_trace",
      title: "Target route trace",
      summary: "Target source route evidence for the active goal.",
      evidence_refs: [targetSourceRef, "visual_evidence:event-log-target"],
      related_artifact_ids: ["stage_play_processed_mail_packet:event-log-target"],
      related_job_ids: ["stage_play_live_source_job:event-log-target"],
      created_at: "2026-06-17T16:00:00.000Z",
    });
    const otherEvent = appendInterpretedEvent({
      event_id: "interpreted:event-log-unrelated",
      thread_id: threadId,
      room_id: roomId,
      source_family: "visual_source",
      kind: "tool_trace",
      title: "Unrelated route trace",
      summary: "Unrelated source route evidence should not enter this goal.",
      evidence_refs: [otherSourceRef, "visual_evidence:event-log-unrelated"],
      related_artifact_ids: ["stage_play_processed_mail_packet:event-log-unrelated"],
      related_job_ids: ["stage_play_live_source_job:event-log-unrelated"],
      created_at: "2026-06-17T16:01:00.000Z",
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_refs: [targetSourceRef],
        loop_refs: ["stage_play_mail_loop:event-log-target"],
        goal_id: "goal:event-log-route-evidence",
        objective: "Inspect route evidence for only the target visual source.",
        context_feeds: ["route_evidence"],
        allowed_actuators: ["query_route_evidence"],
      },
    });
    expect(sessionObservation.ok).toBe(true);
    const initialCheckpointCount = ((sessionObservation.observation as any).session.checkpoints ?? []).length;

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_event_log",
      thread_id: threadId,
      args: {
        room_id: roomId,
        goal_id: "goal:event-log-route-evidence",
        limit: 10,
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.query_event_log",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.interpreted_log_read.v1",
      status: "read",
      goalId: "goal:event-log-route-evidence",
      requiredFeed: "route_evidence",
      requiredActuator: "query_route_evidence",
      feedAllowed: true,
      actuatorAllowed: true,
      matchedAllowedActuators: ["query_route_evidence"],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.events.map((event: any) => event.event_id)).toEqual([targetEvent.event_id]);
    expect(payload.events.map((event: any) => event.event_id)).not.toContain(otherEvent.event_id);
    expect(payload.sourceRefs).toEqual(expect.arrayContaining([targetSourceRef, targetEvent.event_id]));
    expect(payload.sourceRefs).not.toContain(otherSourceRef);
    expect(payload.evidenceRefs).toEqual(expect.arrayContaining([
      payload.resultId,
      "context_feed:route_evidence",
      "allowed_actuator:query_route_evidence",
      "agent_goal_allowed_actuator:query_route_evidence",
      targetEvent.event_id,
      targetSourceRef,
      "visual_evidence:event-log-target",
    ]));
    expect(payload.evidenceRefs).not.toContain(otherEvent.event_id);
    expect(payload.evidenceRefs).not.toContain(otherSourceRef);
    expect(payload.agentGoalSession.checkpoints).toHaveLength(initialCheckpointCount + 1);
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining(["query_route_evidence", "live_env.query_event_log"]),
      evidenceRefs: expect.arrayContaining([payload.goalContextUpdateId, payload.resultId, targetEvent.event_id]),
      nextStep: "continue",
    });

    const routeUpdate = listStagePlayGoalContextUpdates({
      threadId,
      contentRef: payload.resultId,
      limit: 1,
    })[0];
    expect(routeUpdate).toMatchObject({
      producerKind: "route_watch",
      updateKind: "route_evidence",
      sourceRefs: expect.arrayContaining([targetSourceRef, targetEvent.event_id]),
      toolIdentity: {
        requestedToolName: "live_env.query_event_log",
        canonicalToolName: "live_env.query_event_log",
        matchedAllowedActuators: ["query_route_evidence"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_route_evidence"],
      },
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(routeUpdate.sourceRefs).not.toContain(otherSourceRef);
    expect(routeUpdate.evidenceRefs).not.toContain(otherEvent.event_id);
    expect(routeUpdate.suggestedDispatch.map((action) => action.kind)).not.toContain("wake_agent");
    expect(observation.producedRefs).toEqual(expect.arrayContaining([
      payload.goalContextUpdateId,
      payload.resultId,
      targetEvent.event_id,
    ]));
    expect(observation.producedRefs).not.toContain(otherEvent.event_id);
  });

  it("blocks goal-scoped interpreted event-log reads outside route-evidence feed policy", () => {
    const targetSourceRef = "visual_source:event-log-blocked";
    const targetEvent = appendInterpretedEvent({
      event_id: "interpreted:event-log-blocked",
      thread_id: threadId,
      room_id: roomId,
      source_family: "visual_source",
      kind: "tool_trace",
      title: "Blocked route trace",
      summary: "This route evidence should stay hidden from a visual-only goal.",
      evidence_refs: [targetSourceRef, "visual_evidence:event-log-blocked"],
      related_artifact_ids: ["stage_play_processed_mail_packet:event-log-blocked"],
      created_at: "2026-06-17T16:05:00.000Z",
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_refs: [targetSourceRef],
        goal_id: "goal:event-log-blocked",
        objective: "Inspect visual summaries only, not route evidence.",
        context_feeds: ["visual_summaries"],
        allowed_actuators: ["query_route_evidence"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_event_log",
      thread_id: threadId,
      args: {
        room_id: roomId,
        goal_id: "goal:event-log-blocked",
        limit: 10,
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.query_event_log",
      ok: false,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.interpreted_log_read.v1",
      status: "blocked",
      goalId: "goal:event-log-blocked",
      missingRequirements: ["context_feed:route_evidence"],
      feedAllowed: false,
      actuatorAllowed: true,
      events: [],
      interpreted_events: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.evidenceRefs).not.toContain(targetEvent.event_id);
    expect(payload.evidenceRefs).not.toContain(targetSourceRef);
    expect(observation.evidence_refs).not.toContain(targetEvent.event_id);
    expect(observation.evidence_refs).not.toContain(targetSourceRef);

    const routeUpdate = listStagePlayGoalContextUpdates({
      threadId,
      contentRef: payload.resultId,
      producerKind: "route_watch",
      updateKind: "error",
      limit: 1,
    })[0];
    expect(routeUpdate).toMatchObject({
      freshness: expect.objectContaining({ status: "blocked" }),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(routeUpdate.evidenceRefs).not.toContain(targetEvent.event_id);
    expect(routeUpdate.suggestedDispatch.map((action) => action.kind)).not.toContain("append_goal_context");
  });

  it("queries Situation Room constructs as goal-scoped route evidence without crossing source boundaries", () => {
    const targetSourceRef = "visual_source:construct-target";
    const otherSourceRef = "visual_source:construct-unrelated";
    const targetConstruct = upsertSituationConstruct({
      construct_id: "situation_construct:route_evidence_view:target",
      type: "route_evidence_view",
      name: "Target route evidence view",
      status: "active",
      thread_id: threadId,
      room_id: roomId,
      source_ids: [targetSourceRef],
      artifact_refs: ["route_evidence_view:construct-target"],
      receipt_refs: ["construct_receipt:target"],
      evidence_refs: ["visual_evidence:construct-target"],
      policy: {
        may_execute_tools: true,
        allowed_tools: ["live_env.query_event_log", "live_env.query_packet_traces"],
      },
      output_bindings: [
        {
          output_kind: "route_evidence_view",
          artifact_ref: "route_evidence_view:construct-target",
          status: "active",
        },
      ],
    });
    const otherConstruct = upsertSituationConstruct({
      construct_id: "situation_construct:route_evidence_view:unrelated",
      type: "route_evidence_view",
      name: "Unrelated route evidence view",
      status: "active",
      thread_id: threadId,
      room_id: roomId,
      source_ids: [otherSourceRef],
      artifact_refs: ["route_evidence_view:construct-unrelated"],
      receipt_refs: ["construct_receipt:unrelated"],
      evidence_refs: ["visual_evidence:construct-unrelated"],
      policy: {
        may_execute_tools: true,
        allowed_tools: ["live_env.query_event_log"],
      },
      output_bindings: [
        {
          output_kind: "route_evidence_view",
          artifact_ref: "route_evidence_view:construct-unrelated",
          status: "active",
        },
      ],
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_refs: [targetSourceRef],
        construct_refs: [targetConstruct.construct_id],
        goal_id: "goal:construct-route-evidence",
        objective: "Inspect workstation constructs for only the target visual source.",
        context_feeds: ["route_evidence"],
        allowed_actuators: ["query_route_evidence"],
      },
    });
    expect(sessionObservation.ok).toBe(true);
    const initialCheckpointCount = ((sessionObservation.observation as any).session.checkpoints ?? []).length;

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_constructs",
      thread_id: threadId,
      args: {
        room_id: roomId,
        goal_id: "goal:construct-route-evidence",
        type: "route_evidence_view",
        status: "active",
        limit: 10,
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.query_constructs",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.situation_construct_query_result.v1",
      readStatus: "read",
      goalId: "goal:construct-route-evidence",
      requiredFeed: "route_evidence",
      requiredActuator: "query_route_evidence",
      feedAllowed: true,
      actuatorAllowed: true,
      matchedAllowedActuators: ["query_route_evidence"],
      count: 1,
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.constructs.map((construct: any) => construct.construct_id)).toEqual([targetConstruct.construct_id]);
    expect(payload.constructs.map((construct: any) => construct.construct_id)).not.toContain(otherConstruct.construct_id);
    expect(payload.sourceRefs).toEqual(expect.arrayContaining([
      targetSourceRef,
      targetConstruct.construct_id,
      "route_evidence_view:construct-target",
      "visual_evidence:construct-target",
    ]));
    expect(payload.sourceRefs).not.toContain(otherSourceRef);
    expect(payload.evidenceRefs).toEqual(expect.arrayContaining([
      payload.resultId,
      "context_feed:route_evidence",
      "allowed_actuator:query_route_evidence",
      "agent_goal_allowed_actuator:query_route_evidence",
      targetConstruct.construct_id,
      targetSourceRef,
      "visual_evidence:construct-target",
      "route_evidence_view:construct-target",
    ]));
    expect(payload.evidenceRefs).not.toContain(otherConstruct.construct_id);
    expect(payload.evidenceRefs).not.toContain(otherSourceRef);
    expect(payload.agentGoalSession.checkpoints).toHaveLength(initialCheckpointCount + 1);
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining(["query_route_evidence", "live_env.query_constructs"]),
      evidenceRefs: expect.arrayContaining([payload.goalContextUpdateId, payload.resultId, targetConstruct.construct_id]),
      nextStep: "continue",
    });

    const routeUpdate = listStagePlayGoalContextUpdates({
      threadId,
      contentRef: payload.resultId,
      limit: 1,
    })[0];
    expect(routeUpdate).toMatchObject({
      producerKind: "route_watch",
      updateKind: "route_evidence",
      sourceRefs: expect.arrayContaining([targetSourceRef, targetConstruct.construct_id]),
      toolIdentity: {
        requestedToolName: "live_env.query_constructs",
        canonicalToolName: "live_env.query_constructs",
        matchedAllowedActuators: ["query_route_evidence"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_route_evidence"],
      },
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(routeUpdate.sourceRefs).not.toContain(otherSourceRef);
    expect(routeUpdate.evidenceRefs).not.toContain(otherConstruct.construct_id);
    expect(routeUpdate.suggestedDispatch.map((action) => action.kind)).not.toContain("wake_agent");
    expect(observation.producedRefs).toEqual(expect.arrayContaining([
      payload.goalContextUpdateId,
      payload.resultId,
      targetConstruct.construct_id,
    ]));
    expect(observation.producedRefs).not.toContain(otherConstruct.construct_id);
  });

  it("blocks goal-scoped Situation Room construct reads outside route-evidence feed policy", () => {
    const targetSourceRef = "visual_source:construct-blocked";
    const targetConstruct = upsertSituationConstruct({
      construct_id: "situation_construct:route_evidence_view:blocked",
      type: "route_evidence_view",
      name: "Blocked route evidence view",
      status: "active",
      thread_id: threadId,
      room_id: roomId,
      source_ids: [targetSourceRef],
      artifact_refs: ["route_evidence_view:construct-blocked"],
      receipt_refs: ["construct_receipt:blocked"],
      evidence_refs: ["visual_evidence:construct-blocked"],
      policy: {
        may_execute_tools: true,
        allowed_tools: ["live_env.query_event_log"],
      },
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_refs: [targetSourceRef],
        construct_refs: [targetConstruct.construct_id],
        goal_id: "goal:construct-blocked",
        objective: "Inspect visual summaries only, not construct route evidence.",
        context_feeds: ["visual_summaries"],
        allowed_actuators: ["query_route_evidence"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_constructs",
      thread_id: threadId,
      args: {
        room_id: roomId,
        goal_id: "goal:construct-blocked",
        type: "route_evidence_view",
        status: "active",
        limit: 10,
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.query_constructs",
      ok: false,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.situation_construct_query_result.v1",
      readStatus: "blocked",
      goalId: "goal:construct-blocked",
      missingRequirements: ["context_feed:route_evidence"],
      feedAllowed: false,
      actuatorAllowed: true,
      constructs: [],
      count: 0,
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.evidenceRefs).not.toContain(targetConstruct.construct_id);
    expect(payload.evidenceRefs).not.toContain(targetSourceRef);
    expect(observation.evidence_refs).not.toContain(targetConstruct.construct_id);
    expect(observation.evidence_refs).not.toContain(targetSourceRef);

    const routeUpdate = listStagePlayGoalContextUpdates({
      threadId,
      contentRef: payload.resultId,
      producerKind: "route_watch",
      updateKind: "error",
      limit: 1,
    })[0];
    expect(routeUpdate).toMatchObject({
      freshness: expect.objectContaining({ status: "blocked" }),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(routeUpdate.evidenceRefs).not.toContain(targetConstruct.construct_id);
    expect(routeUpdate.suggestedDispatch.map((action) => action.kind)).not.toContain("append_goal_context");
  });

  it("queries automation policies through live_env.query_automation_policies as non-terminal feed evidence", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:automation-policy-query",
        objective: "Inspect workstation automations without waking the agent.",
        context_feeds: ["automation_policies"],
        allowed_actuators: ["configure_route_watch", "query_automation_policies"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const configureObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_route_watch",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:automation-policy-query",
        objective: "Record automation policy evidence for visual packets.",
      },
    });
    const configurePayload = configureObservation.observation as any;
    expect(configureObservation.ok).toBe(true);

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_automation_policies",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
        goal_id: "goal:automation-policy-query",
      },
    });

    const queryPayload = queryObservation.observation as any;
    expect(queryObservation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.query_automation_policies",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      contractValid: true,
      contractValidationIssues: [],
      feedKind: "automation_policies",
      goalId: "goal:automation-policy-query",
      status: "read",
      requiredActuator: "query_automation_policies",
      feedAllowed: true,
      actuatorAllowed: true,
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload.goalContextUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: configurePayload.goalContextUpdateId,
        producerKind: "automation",
        updateKind: "automation_status",
        sourceRefs: expect.arrayContaining([sourceId]),
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));
    expect(queryPayload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining(["query_automation_policies", "live_env.query_automation_policies"]),
      nextStep: "continue",
    });
    const automationQueryUpdate = listStagePlayGoalContextUpdates({
      threadId,
      contentRef: queryPayload.resultId,
      limit: 1,
    })[0];
    expect(automationQueryUpdate).toMatchObject({
      producerKind: "route_watch",
      updateKind: "route_evidence",
      toolIdentity: {
        requestedToolName: "live_env.query_automation_policies",
        canonicalToolName: "live_env.query_automation_policies",
        matchedAllowedActuators: ["query_automation_policies"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_automation_policies"],
      },
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(automationQueryUpdate.suggestedDispatch.map((action) => action.kind)).not.toContain("wake_agent");
    expect(queryObservation.producedRefs).toEqual(expect.arrayContaining([
      queryPayload.goalContextUpdateId,
      queryPayload.resultId,
      configurePayload.goalContextUpdateId,
    ]));
  });

  it("queries visual summaries through a feed-specific non-terminal tool result", () => {
    seedVisualSummaryText("ImageLens visual summary: frog sitting on a green leaf.", "visual-feed");

    const processObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });
    const processPayload = processObservation.observation as any;

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_visual_summaries",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });

    const queryPayload = queryObservation.observation as any;
    expect(queryObservation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.query_visual_summaries",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      contractValid: true,
      contractValidationIssues: [],
      feedKind: "visual_summaries",
      sourceRef: sourceId,
      goalId: null,
      updateCount: 1,
      policyEvidenceRefs: expect.arrayContaining([
        "context_feed:visual_summaries",
        "allowed_actuator:query_visual_summaries",
      ]),
      sourceRefs: expect.arrayContaining([sourceId]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:visual_summaries",
        "workstation_actuator:query_visual_summaries",
      ]),
      evidenceRefs: expect.arrayContaining([
        "context_feed:visual_summaries",
        "allowed_actuator:query_visual_summaries",
        sourceId,
      ]),
      freshnessStatus: "fresh",
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload.authoritySummary).toMatchObject({
      schema: "helix.workstation_goal_context_authority_summary.v1",
      updateCount: 1,
      observationOnlyUpdateCount: 1,
      assistantAnswerCount: 0,
      terminalEligibleCount: 0,
      rawContentIncludedCount: 0,
      activeGoalSessionCount: 0,
      finalReportsRequireTerminalAuthorityCount: 0,
      answerAuthority: "completed_solver_path_required",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(queryPayload.goalContextUpdates[0]).toMatchObject({
      producerKind: "visual_capture",
      updateKind: "visual_observation",
      contentRef: expect.stringMatching(/^stage_play_live_source_mail:/),
      sourceRefs: expect.arrayContaining([sourceId]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(queryPayload.packetCircuitRefs).toEqual([
      expect.objectContaining({
        updateId: queryPayload.goalContextUpdates[0].updateId,
        producerKind: "visual_capture",
        updateKind: "visual_observation",
        contentRef: queryPayload.goalContextUpdates[0].contentRef,
        packetRefs: expect.arrayContaining([queryPayload.goalContextUpdates[0].contentRef]),
        sourceRefs: expect.arrayContaining([sourceId]),
        actuatorRefs: expect.arrayContaining(["workstation_actuator:query_visual_summaries"]),
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
    ]);
    expect(queryPayload.goalContextUpdateId).toMatch(/^stage_play_goal_context_update:route_watch:/);
    const routeUpdates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "route_evidence",
    });
    expect(routeUpdates.map((update) => update.updateId)).toContain(queryPayload.goalContextUpdateId);
    const routeUpdate = routeUpdates.find((update) => update.updateId === queryPayload.goalContextUpdateId);
    expect(routeUpdate?.evidenceRefs).toEqual(expect.arrayContaining([
      "context_feed:visual_summaries",
      "allowed_actuator:query_visual_summaries",
    ]));
    expect(routeUpdate?.loopRefs).toEqual(expect.arrayContaining([
      "workstation_context_feed:visual_summaries",
      "workstation_actuator:query_visual_summaries",
    ]));
    expect(routeUpdate?.suggestedDispatch.map((action) => action.kind)).toEqual(expect.arrayContaining([
      "log_receipt",
      "update_panel",
    ]));
    expect(queryObservation.producedRefs).toEqual(expect.arrayContaining([
      queryPayload.goalContextUpdateId,
      queryPayload.resultId,
      queryPayload.goalContextUpdates[0].updateId,
    ]));
    expect(queryPayload.goalContextUpdates.some((update: any) => update.producerKind === "microdeck")).toBe(false);
  });

  it("queries MicroDeck outputs through a feed-specific non-terminal tool result", () => {
    seedVisualSummaryText("ImageLens visual summary: frog sitting on a green leaf.", "microdeck-feed");

    const processObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });
    const processPayload = processObservation.observation as any;

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_microdeck_outputs",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });

    const queryPayload = queryObservation.observation as any;
    expect(queryObservation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.query_microdeck_outputs",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      contractValid: true,
      contractValidationIssues: [],
      feedKind: "microdeck_outputs",
      sourceRef: sourceId,
      policyEvidenceRefs: expect.arrayContaining([
        "context_feed:microdeck_outputs",
        "allowed_actuator:query_microdeck_outputs",
      ]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:microdeck_outputs",
        "workstation_actuator:query_microdeck_outputs",
      ]),
      freshnessStatus: "fresh",
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload.updateCount).toBe(queryPayload.goalContextUpdates.length);
    expect(queryPayload.goalContextUpdates.length).toBeGreaterThanOrEqual(1);
    expect(queryPayload.goalContextUpdates.every((update: any) =>
      update.authority?.assistantAnswer === false &&
      update.authority?.terminalEligible === false &&
      update.authority?.rawContentIncluded === false &&
      update.authority?.postToolModelStepRequired === true
    )).toBe(true);
    const packetMicrodeckUpdate = queryPayload.goalContextUpdates.find((update: any) =>
      update.producerKind === "microdeck" &&
      update.updateKind === "visual_observation" &&
      update.contentRef === processPayload.packets[0].packetId
    );
    expect(packetMicrodeckUpdate).toMatchObject({
      producerKind: "microdeck",
      updateKind: "visual_observation",
      contentRef: processPayload.packets[0].packetId,
      sourceRefs: expect.arrayContaining([sourceId]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(queryPayload.packetCircuitRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: packetMicrodeckUpdate.updateId,
        producerKind: "microdeck",
        contentRef: processPayload.packets[0].packetId,
        packetRefs: expect.arrayContaining([processPayload.packets[0].packetId]),
        microDeckRefs: expect.arrayContaining(processPayload.packets[0].microReasonerRunRefs),
        assistant_answer: false,
        terminal_eligible: false,
      }),
    ]));
    expect(queryPayload.goalContextUpdateId).toMatch(/^stage_play_goal_context_update:route_watch:/);
    expect(queryObservation.producedRefs).toEqual(expect.arrayContaining([
      queryPayload.goalContextUpdateId,
      queryPayload.resultId,
      packetMicrodeckUpdate.updateId,
    ]));
    expect(queryObservation.evidence_refs).toEqual(expect.arrayContaining([
      processPayload.packets[0].packetId,
      "context_feed:microdeck_outputs",
      "allowed_actuator:query_microdeck_outputs",
    ]));
  });

  it("keeps simultaneous visual and audio MicroDeck output queries source-scoped", () => {
    const visualSourceRef = "visual_source:frog-lens";
    const audioSourceRef = "audio_source:earbuds-translation";
    const authority = {
      assistantAnswer: false,
      terminalEligible: false,
      rawContentIncluded: false,
      postToolModelStepRequired: true,
    } as const;

    recordStagePlayGoalContextUpdate({
      schemaVersion: "helix.workstation_goal_context_update.v1",
      updateId: "stage_play_goal_context_update:microdeck:visual-frog-source-boundary",
      createdAtMs: Date.parse("2026-06-17T14:05:00.000Z"),
      sourceRefs: [visualSourceRef, "stage_play_processed_mail_packet:visual-frog-source-boundary"],
      loopRefs: [
        `thread:${threadId}`,
        "stage_play_mail_loop:visual-frog-source-boundary",
        "microdeck:preset_state:frog-classifier:v1",
        "microdeck:prompt_route:frog-classifier",
        "workstation_context_feed:microdeck_outputs",
        "workstation_actuator:query_microdeck_outputs",
      ],
      producerKind: "microdeck",
      updateKind: "visual_observation",
      contentRef: "microdeck_output:visual-frog-source-boundary",
      preview: "Visual frog classifier deck output for ImageLens source.",
      evidenceRefs: [
        "stage_play_processed_mail_packet:visual-frog-source-boundary",
        "microdeck_run:visual-frog-source-boundary",
        "context_feed:microdeck_outputs",
        "allowed_actuator:query_microdeck_outputs",
      ],
      receiptRefs: ["microdeck_receipt:visual-frog-source-boundary"],
      freshness: {
        observedAtMs: Date.parse("2026-06-17T14:05:00.000Z"),
        staleAfterMs: 30_000,
        status: "fresh",
      },
      goalRelevance: null,
      suggestedDispatch: [
        { kind: "log_receipt", receiptRef: "microdeck_receipt:visual-frog-source-boundary" },
        { kind: "update_panel", panelId: "live-answer-environment" },
      ],
      authority,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    recordStagePlayGoalContextUpdate({
      schemaVersion: "helix.workstation_goal_context_update.v1",
      updateId: "stage_play_goal_context_update:microdeck:audio-translation-source-boundary",
      createdAtMs: Date.parse("2026-06-17T14:05:01.000Z"),
      sourceRefs: [audioSourceRef, "stage_play_processed_mail_packet:audio-translation-source-boundary"],
      loopRefs: [
        `thread:${threadId}`,
        "stage_play_translation_loop:audio-translation-source-boundary",
        "microdeck:preset_state:earbud-translation:v1",
        "microdeck:prompt_route:earbud-translation",
        "workstation_context_feed:narrator_events",
        "workstation_actuator:narrator_bind_stream",
        "workstation_context_feed:microdeck_outputs",
        "workstation_actuator:query_microdeck_outputs",
      ],
      producerKind: "microdeck",
      updateKind: "translated_transcript",
      contentRef: "microdeck_output:audio-translation-source-boundary",
      preview: "Earbud translation deck output for audio source.",
      evidenceRefs: [
        "stage_play_processed_mail_packet:audio-translation-source-boundary",
        "microdeck_run:audio-translation-source-boundary",
        "workstation_context_feed:narrator_events",
        "workstation_actuator:narrator_bind_stream",
        "context_feed:microdeck_outputs",
        "allowed_actuator:query_microdeck_outputs",
      ],
      receiptRefs: ["microdeck_receipt:audio-translation-source-boundary"],
      freshness: {
        observedAtMs: Date.parse("2026-06-17T14:05:01.000Z"),
        staleAfterMs: 30_000,
        status: "fresh",
      },
      goalRelevance: null,
      suggestedDispatch: [
        { kind: "log_receipt", receiptRef: "microdeck_receipt:audio-translation-source-boundary" },
        { kind: "update_panel", panelId: "live-answer-environment" },
        { kind: "bind_narrator_stream", sourceRef: audioSourceRef, streamKind: "translated_transcript" },
      ],
      authority,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });

    const visualObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_microdeck_outputs",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: visualSourceRef,
      },
    });
    const audioObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_microdeck_outputs",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: audioSourceRef,
      },
    });

    const visualPayload = visualObservation.observation as any;
    const audioPayload = audioObservation.observation as any;
    expect(visualPayload).toMatchObject({
      feedKind: "microdeck_outputs",
      sourceRef: visualSourceRef,
      updateCount: 1,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
      },
    });
    expect(audioPayload).toMatchObject({
      feedKind: "microdeck_outputs",
      sourceRef: audioSourceRef,
      updateCount: 1,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
      },
    });
    expect(visualPayload.goalContextUpdates.map((update: any) => update.updateId)).toEqual([
      "stage_play_goal_context_update:microdeck:visual-frog-source-boundary",
    ]);
    expect(audioPayload.goalContextUpdates.map((update: any) => update.updateId)).toEqual([
      "stage_play_goal_context_update:microdeck:audio-translation-source-boundary",
    ]);
    expect(visualPayload.goalContextUpdates[0].authority).toEqual(authority);
    expect(audioPayload.goalContextUpdates[0].authority).toEqual(authority);
    expect(visualPayload.packetCircuitRefs[0]).toMatchObject({
      updateId: "stage_play_goal_context_update:microdeck:visual-frog-source-boundary",
      microDeckRefs: expect.arrayContaining([
        "microdeck:preset_state:frog-classifier:v1",
        "microdeck:prompt_route:frog-classifier",
      ]),
      sourceRefs: expect.arrayContaining([visualSourceRef]),
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(audioPayload.packetCircuitRefs[0]).toMatchObject({
      updateId: "stage_play_goal_context_update:microdeck:audio-translation-source-boundary",
      microDeckRefs: expect.arrayContaining([
        "microdeck:preset_state:earbud-translation:v1",
        "microdeck:prompt_route:earbud-translation",
      ]),
      narratorRefs: expect.arrayContaining(["workstation_context_feed:narrator_events"]),
      sourceRefs: expect.arrayContaining([audioSourceRef]),
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(visualPayload.goalContextUpdates.map((update: any) => update.updateId)).not.toContain(
      "stage_play_goal_context_update:microdeck:audio-translation-source-boundary",
    );
    expect(audioPayload.goalContextUpdates.map((update: any) => update.updateId)).not.toContain(
      "stage_play_goal_context_update:microdeck:visual-frog-source-boundary",
    );
  });

  it("filters feed-specific goal-context query results by requested freshness status", () => {
    const threadLoopRef = `thread:${threadId}`;
    const mailLoopRef = `stage_play_mail_loop:${threadId}`;
    const staleObservedAtMs = Date.parse("2026-06-04T12:09:00.000Z");
    const freshObservedAtMs = Date.parse("2026-06-04T12:10:00.000Z");
    recordStagePlayGoalContextUpdate({
      schemaVersion: "helix.workstation_goal_context_update.v1",
      updateId: "stage_play_goal_context_update:test:visual-stale",
      createdAtMs: staleObservedAtMs,
      sourceRefs: [sourceId],
      loopRefs: [threadLoopRef, mailLoopRef, "stage_play_mail_loop:test-stale"],
      producerKind: "visual_capture",
      updateKind: "visual_observation",
      contentRef: "visual_frame:test-stale",
      preview: "Stale ImageLens visual summary from an earlier frame.",
      evidenceRefs: [
        "visual_frame:test-stale",
        sourceId,
        threadLoopRef,
        mailLoopRef,
        "stage_play_mail_loop:test-stale",
      ],
      receiptRefs: ["visual_frame:test-stale"],
      freshness: {
        observedAtMs: staleObservedAtMs,
        staleAfterMs: 30_000,
        status: "stale",
      },
      goalRelevance: null,
      suggestedDispatch: [{ kind: "log_receipt", receiptRef: "visual_frame:test-stale" }],
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    recordStagePlayGoalContextUpdate({
      schemaVersion: "helix.workstation_goal_context_update.v1",
      updateId: "stage_play_goal_context_update:test:visual-fresh",
      createdAtMs: freshObservedAtMs,
      sourceRefs: [sourceId],
      loopRefs: [threadLoopRef, mailLoopRef, "stage_play_mail_loop:test-fresh"],
      producerKind: "visual_capture",
      updateKind: "visual_observation",
      contentRef: "visual_frame:test-fresh",
      preview: "Fresh ImageLens visual summary from the current frame.",
      evidenceRefs: [
        "visual_frame:test-fresh",
        sourceId,
        threadLoopRef,
        mailLoopRef,
        "stage_play_mail_loop:test-fresh",
      ],
      receiptRefs: ["visual_frame:test-fresh"],
      freshness: {
        observedAtMs: freshObservedAtMs,
        staleAfterMs: 30_000,
        status: "fresh",
      },
      goalRelevance: null,
      suggestedDispatch: [{ kind: "log_receipt", receiptRef: "visual_frame:test-fresh" }],
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_visual_summaries",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
        freshness_status: "stale",
      },
    });

    const queryPayload = queryObservation.observation as any;
    expect(queryObservation.ok).toBe(true);
    expect(queryPayload).toMatchObject({
      feedKind: "visual_summaries",
      sourceRef: sourceId,
      requestedFreshnessStatus: "stale",
      updateCount: 1,
      policyEvidenceRefs: expect.arrayContaining(["freshness_filter:stale"]),
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(queryPayload.goalContextUpdates).toEqual([
      expect.objectContaining({
        updateId: "stage_play_goal_context_update:test:visual-stale",
        contentRef: "visual_frame:test-stale",
        freshness: expect.objectContaining({ status: "stale" }),
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
    ]);
    expect(queryPayload.goalContextUpdates.map((update: any) => update.updateId)).not.toContain(
      "stage_play_goal_context_update:test:visual-fresh",
    );

    const genericQueryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_workstation_goal_context",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        freshness_status: "fresh",
      },
    });
    const genericQueryPayload = genericQueryObservation.observation as any;
    expect(genericQueryObservation.ok).toBe(true);
    expect(genericQueryObservation.evidence_refs).toEqual(expect.arrayContaining(["freshness_filter:fresh"]));
    expect(genericQueryPayload).toMatchObject({
      schema: "stage_play_workstation_goal_context_read_result/v1",
      requestedFreshnessStatus: "fresh",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(genericQueryPayload.goalContextUpdates.every((update: any) => update.freshness.status === "fresh")).toBe(true);
    expect(genericQueryPayload.goalContextUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: "stage_play_goal_context_update:test:visual-fresh",
        contentRef: "visual_frame:test-fresh",
        freshness: expect.objectContaining({ status: "fresh" }),
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
    ]));
    expect(genericQueryPayload.goalContextUpdates.map((update: any) => update.updateId)).not.toContain(
      "stage_play_goal_context_update:test:visual-stale",
    );
  });

  it("appends agent goal session checkpoints when querying allowed context feeds", () => {
    seedVisualSummaryText("ImageLens visual summary: frog sitting on a mossy rock.", "visual-goal-feed");

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:visual-checkpoint",
        objective: "Track frog visual evidence through goal-context feeds.",
        context_feeds: ["visual_summaries", "microdeck_outputs"],
        allowed_actuators: ["query_visual_summaries", "query_microdeck_outputs"],
      },
    });
    expect(sessionObservation.ok).toBe(true);
    const startSession = (sessionObservation.observation as any).session;
    const startingCheckpointCount = startSession.checkpoints.length;

    executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_visual_summaries",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
        goal_id: "goal:visual-checkpoint",
      },
    });

    const queryPayload = queryObservation.observation as any;
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      contractValid: true,
      contractValidationIssues: [],
      feedKind: "visual_summaries",
      goalId: "goal:visual-checkpoint",
      status: "read",
      matchedContextFeeds: [
        expect.objectContaining({
          sourceKind: "visual_summaries",
        }),
      ],
      matchedContextFeedRefs: [expect.stringMatching(/^agent_goal_feed:/)],
      matchedAllowedActuators: ["query_visual_summaries"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_visual_summaries"],
      policyEvidenceRefs: expect.arrayContaining([
        "context_feed:visual_summaries",
        "allowed_actuator:query_visual_summaries",
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_visual_summaries",
      ]),
      evidenceRefs: expect.arrayContaining([
        expect.stringMatching(/^agent_goal_feed:/),
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_visual_summaries",
      ]),
      agentGoalSession: expect.objectContaining({
        goalId: "goal:visual-checkpoint",
        authority: hardenedGoalSessionAuthority(),
      }),
      authoritySummary: expect.objectContaining({
        activeGoalSessionCount: 1,
        finalReportsRequireTerminalAuthorityCount: 1,
        allowedActuators: expect.arrayContaining(["query_visual_summaries", "query_microdeck_outputs"]),
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(queryPayload.agentGoalSession.checkpoints.length).toBe(startingCheckpointCount + 1);
    const expectedSummary = `Queried visual summaries feed and read ${queryPayload.goalContextUpdates.length} update(s) for this goal session.`;
    expect(queryPayload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: expectedSummary,
      actionsTaken: expect.arrayContaining([
        "query_visual_summaries",
        "live_env.query_visual_summaries",
      ]),
      nextStep: "continue",
    });
    expect(queryPayload.agentGoalSession.checkpoints.at(-1).evidenceRefs).toEqual(expect.arrayContaining([
      queryPayload.goalContextUpdateId,
      queryPayload.resultId,
      queryPayload.goalContextUpdates[0].updateId,
    ]));
    expect(queryPayload.agentGoalSession.loopRefs).toEqual(expect.arrayContaining([
      "workstation_context_feed:visual_summaries",
      "workstation_actuator:query_visual_summaries",
    ]));

    const storedSession = listStagePlayAgentGoalSessions({
      threadId,
      goalId: "goal:visual-checkpoint",
      limit: 1,
    })[0];
    const queryUpdate = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "route_evidence",
    }).find((update) => update.updateId === queryPayload.goalContextUpdateId);
    expect(queryUpdate?.toolIdentity).toEqual({
      requestedToolName: "live_env.query_visual_summaries",
      canonicalToolName: "live_env.query_visual_summaries",
      matchedAllowedActuators: ["query_visual_summaries"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_visual_summaries"],
    });
    expect(queryUpdate?.evidenceRefs).toEqual(expect.arrayContaining([
      "agent_goal_allowed_actuator:query_visual_summaries",
    ]));
    expect(storedSession?.checkpoints.length).toBe(startingCheckpointCount + 1);
    expect(storedSession?.checkpoints.at(-1)?.summary).toBe(expectedSummary);
    expect(queryObservation.producedRefs).toEqual(expect.arrayContaining([
      queryPayload.goalContextUpdateId,
      queryPayload.resultId,
    ]));
  });

  it("keeps goal-scoped feed queries inside the AgentGoalSession source boundary when source_ref is omitted", () => {
    const targetSourceRef = "visual_source:goal-scoped-feed";
    const otherSourceRef = "visual_source:unrelated-feed";
    const threadLoopRef = `thread:${threadId}`;
    const targetLoopRef = "stage_play_mail_loop:goal-scoped-feed";
    const otherLoopRef = "stage_play_mail_loop:unrelated-feed";
    const authority = {
      assistantAnswer: false,
      terminalEligible: false,
      rawContentIncluded: false,
      postToolModelStepRequired: true,
    } as const;

    recordStagePlayGoalContextUpdate({
      schemaVersion: "helix.workstation_goal_context_update.v1",
      updateId: "stage_play_goal_context_update:test:goal-source-visual",
      createdAtMs: Date.parse("2026-06-17T14:00:05.000Z"),
      sourceRefs: [targetSourceRef, "visual_frame:goal-scoped-feed"],
      loopRefs: [threadLoopRef, targetLoopRef],
      producerKind: "visual_capture",
      updateKind: "visual_observation",
      contentRef: "visual_frame:goal-scoped-feed",
      preview: "Goal-scoped visual frame shows the frog classifier target.",
      evidenceRefs: ["visual_evidence:goal-scoped-feed"],
      receiptRefs: ["visual_frame:goal-scoped-feed"],
      freshness: {
        observedAtMs: Date.parse("2026-06-17T14:00:05.000Z"),
        staleAfterMs: 30_000,
        status: "fresh",
      },
      goalRelevance: null,
      suggestedDispatch: [{ kind: "log_receipt", receiptRef: "visual_frame:goal-scoped-feed" }],
      authority,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    recordStagePlayGoalContextUpdate({
      schemaVersion: "helix.workstation_goal_context_update.v1",
      updateId: "stage_play_goal_context_update:test:other-source-visual",
      createdAtMs: Date.parse("2026-06-17T14:00:06.000Z"),
      sourceRefs: [otherSourceRef, "visual_frame:unrelated-feed"],
      loopRefs: [threadLoopRef, otherLoopRef],
      producerKind: "visual_capture",
      updateKind: "visual_observation",
      contentRef: "visual_frame:unrelated-feed",
      preview: "Unrelated visual frame should not enter the goal-scoped feed query.",
      evidenceRefs: ["visual_evidence:unrelated-feed"],
      receiptRefs: ["visual_frame:unrelated-feed"],
      freshness: {
        observedAtMs: Date.parse("2026-06-17T14:00:06.000Z"),
        staleAfterMs: 30_000,
        status: "fresh",
      },
      goalRelevance: null,
      suggestedDispatch: [{ kind: "log_receipt", receiptRef: "visual_frame:unrelated-feed" }],
      authority,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_refs: [targetSourceRef],
        loop_refs: [targetLoopRef],
        goal_id: "goal:goal-scoped-feed",
        objective: "Read only the visual feed attached to this frog classification goal.",
        context_feeds: ["visual_summaries"],
        allowed_actuators: ["query_visual_summaries"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_visual_summaries",
      thread_id: threadId,
      args: {
        room_id: roomId,
        goal_id: "goal:goal-scoped-feed",
      },
    });

    const queryPayload = queryObservation.observation as any;
    expect(queryObservation.ok).toBe(true);
    expect(queryPayload).toMatchObject({
      feedKind: "visual_summaries",
      goalId: "goal:goal-scoped-feed",
      status: "read",
      matchedAllowedActuators: ["query_visual_summaries"],
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(queryPayload.goalContextUpdates).toEqual([
      expect.objectContaining({
        updateId: "stage_play_goal_context_update:test:goal-source-visual",
        sourceRefs: expect.arrayContaining([targetSourceRef]),
        authority,
      }),
    ]);
    expect(queryPayload.goalContextUpdates.map((update: any) => update.updateId)).not.toContain(
      "stage_play_goal_context_update:test:other-source-visual",
    );
    expect(queryPayload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining(["query_visual_summaries", "live_env.query_visual_summaries"]),
      evidenceRefs: expect.arrayContaining([
        "stage_play_goal_context_update:test:goal-source-visual",
        queryPayload.goalContextUpdateId,
      ]),
      nextStep: "continue",
    });
  });

  it("blocks feed-specific queries outside an explicit goal session context-feed policy", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:visual-feed-only",
        objective: "Observe visual summaries without translation feeds.",
        context_feeds: ["visual_summaries"],
        allowed_actuators: ["query_translation_segments", "query_visual_summaries"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_translation_segments",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
        goal_id: "goal:visual-feed-only",
      },
    });

    const queryPayload = queryObservation.observation as any;
    expect(queryObservation).toMatchObject({
      tool_name: "live_env.query_translation_segments",
      ok: false,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      contractValid: true,
      contractValidationIssues: [],
      feedKind: "translated_transcripts",
      status: "blocked",
      goalId: "goal:visual-feed-only",
      goalSessionFound: true,
      feedAllowed: false,
      actuatorAllowed: true,
      matchedContextFeeds: [],
      matchedContextFeedRefs: [],
      matchedAllowedActuators: ["query_translation_segments"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_translation_segments"],
      missingRequirements: ["context_feed:translated_transcripts"],
      policyEvidenceRefs: expect.arrayContaining([
        "context_feed:translated_transcripts",
        "allowed_actuator:query_translation_segments",
        "agent_goal_allowed_actuator:query_translation_segments",
      ]),
      updateCount: 0,
      goalContextUpdates: [],
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "route_evidence",
    });
    const queryUpdate = updates.find((update) => update.updateId === queryPayload.goalContextUpdateId);
    expect(queryUpdate).toMatchObject({
      contentRef: queryPayload.resultId,
      freshness: expect.objectContaining({ status: "blocked" }),
      evidenceRefs: expect.arrayContaining([
        "context_feed:translated_transcripts",
        "allowed_actuator:query_translation_segments",
        "agent_goal_allowed_actuator:query_translation_segments",
      ]),
      loopRefs: expect.arrayContaining([
        "workstation_context_feed:translated_transcripts",
        "workstation_actuator:query_translation_segments",
      ]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
      toolIdentity: {
        requestedToolName: "live_env.query_translation_segments",
        canonicalToolName: "live_env.query_translation_segments",
        matchedAllowedActuators: ["query_translation_segments"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_translation_segments"],
      },
    });
    expect(queryUpdate?.suggestedDispatch.map((action) => action.kind)).not.toContain("append_goal_context");
  });

  it("adds the feed query actuator when a goal session declares a queryable context feed", () => {
    seedVisualSummaryText("ImageLens visual summary: frog on a stone path.", "visual-feed-actuator");

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:visual-feed-no-query-action",
        objective: "Keep visual summaries available for goal-context inspection.",
        context_feeds: ["visual_summaries"],
        allowed_actuators: ["query_source_health"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_visual_summaries",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
        goal_id: "goal:visual-feed-no-query-action",
      },
    });

    const queryPayload = queryObservation.observation as any;
    expect(queryObservation).toMatchObject({
      tool_name: "live_env.query_visual_summaries",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      contractValid: true,
      contractValidationIssues: [],
      feedKind: "visual_summaries",
      status: "read",
      goalId: "goal:visual-feed-no-query-action",
      goalSessionFound: true,
      feedAllowed: true,
      requiredActuator: "query_visual_summaries",
      actuatorAllowed: true,
      matchedAllowedActuators: ["query_visual_summaries"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_visual_summaries"],
      matchedContextFeeds: [
        expect.objectContaining({
          sourceKind: "visual_summaries",
        }),
      ],
      matchedContextFeedRefs: [expect.stringMatching(/^agent_goal_feed:/)],
      missingRequirements: [],
      policyEvidenceRefs: expect.arrayContaining([
        "context_feed:visual_summaries",
        "allowed_actuator:query_visual_summaries",
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_visual_summaries",
      ]),
      evidenceRefs: expect.arrayContaining([
        expect.stringMatching(/^agent_goal_feed:/),
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_visual_summaries",
      ]),
      updateCount: 1,
      goalContextUpdates: expect.arrayContaining([
        expect.objectContaining({
          producerKind: "visual_capture",
          updateKind: "visual_observation",
          authority: {
            assistantAnswer: false,
            terminalEligible: false,
            rawContentIncluded: false,
            postToolModelStepRequired: true,
          },
        }),
      ]),
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(queryPayload.policyEvidenceRefs).toContain("agent_goal_allowed_actuator:query_visual_summaries");
    expect(queryPayload.evidenceRefs).toContain("agent_goal_allowed_actuator:query_visual_summaries");
  });

  it("executes every canonical generic context-feed query through the adapter as non-terminal evidence", () => {
    for (const spec of genericContextFeedQuerySpecs) {
      const observation = executeLiveEnvironmentTool({
        tool_name: spec.capability as HelixLiveEnvironmentToolName,
        thread_id: threadId,
        args: {
          room_id: roomId,
          source_id: sourceId,
        },
      });

      const payload = observation.observation as any;
      expect(observation).toMatchObject({
        schema: "helix.live_environment_tool_observation.v1",
        tool_name: spec.capability,
        ok: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        context_role: "tool_evidence",
        ask_context_policy: "evidence_only",
      });
      expect(payload).toMatchObject({
        schema: "stage_play_workstation_context_feed_query_result/v1",
        contractValid: true,
        contractValidationIssues: [],
        feedKind: spec.feedKind,
        label: spec.label,
        sourceRef: sourceId,
        goalId: null,
        requiredActuator: spec.actuator,
        policyEvidenceRefs: expect.arrayContaining([
          `context_feed:${spec.feedKind}`,
          `allowed_actuator:${spec.actuator}`,
        ]),
        loopRefs: expect.arrayContaining([
          `workstation_context_feed:${spec.feedKind}`,
          `workstation_actuator:${spec.actuator}`,
        ]),
        terminalAuthority: {
          status: "not_terminal",
          finalAnswerEligible: false,
          completedSolverPathRequired: true,
          terminalAuthoritySingleWriterRequired: true,
        },
        post_tool_model_step_required: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        context_role: "tool_evidence",
        ask_context_policy: "evidence_only",
      });
    }
  });

  it("accepts unique context-feed aliases while canonicalizing the non-terminal query receipt", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "visual_summaries" as HelixLiveEnvironmentToolName,
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.query_visual_summaries",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      contractValid: true,
      contractValidationIssues: [],
      requestedToolName: "visual_summaries",
      canonicalToolName: "live_env.query_visual_summaries",
      feedKind: "visual_summaries",
      requiredActuator: "query_visual_summaries",
      policyEvidenceRefs: expect.arrayContaining([
        "context_feed:visual_summaries",
        "allowed_actuator:query_visual_summaries",
      ]),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
  });

  it("queries translation segments from translation-loop packet evidence", () => {
    const audioSourceId = "audio_source:helix-ask-live-source-mail-tool";
    const audioMail = enqueueAudioTranscriptMailFromChunk({
      threadId,
      roomId,
      sourceId: audioSourceId,
      transcript: "la rana esta en la hoja",
      eventRef: "audio_event:helix-ask-live-source-mail-tool",
      chunkRef: "audio_chunk:helix-ask-live-source-mail-tool",
      now: "2026-06-04T12:10:00.000Z",
    });

    const audioQueryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_audio_transcripts",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: audioSourceId,
        source_kind: "audio_transcript",
      },
    });
    const audioQueryPayload = audioQueryObservation.observation as any;
    expect(audioQueryObservation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.query_audio_transcripts",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(audioQueryPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      contractValid: true,
      contractValidationIssues: [],
      feedKind: "audio_transcripts",
      sourceRef: audioSourceId,
      updateCount: 1,
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(audioQueryPayload.goalContextUpdates[0]).toMatchObject({
      producerKind: "audio_capture",
      updateKind: "transcript_window",
      contentRef: audioMail.mailId,
      sourceRefs: expect.arrayContaining([audioSourceId, "audio_event:helix-ask-live-source-mail-tool", "audio_chunk:helix-ask-live-source-mail-tool"]),
      evidenceRefs: expect.arrayContaining([audioMail.mailId, "audio_event:helix-ask-live-source-mail-tool", "audio_chunk:helix-ask-live-source-mail-tool"]),
      freshness: expect.objectContaining({ status: "fresh" }),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(audioQueryPayload.authoritySummary).toMatchObject({
      updateCount: 1,
      observationOnlyUpdateCount: 1,
      assistantAnswerCount: 0,
      terminalEligibleCount: 0,
      rawContentIncludedCount: 0,
      answerAuthority: "completed_solver_path_required",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });

    const processObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: audioSourceId,
        source_kind: "audio_transcript",
      },
    });
    const processPayload = processObservation.observation as any;
    const audioUpdatesAfterProcess = listStagePlayGoalContextUpdates({
      threadId,
      sourceRef: audioSourceId,
      producerKind: "audio_capture",
      updateKind: "transcript_window",
    });
    expect(audioUpdatesAfterProcess).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contentRef: audioMail.mailId,
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));
    const transcriptUpdatesAfterProcess = listStagePlayGoalContextUpdates({
      threadId,
      sourceRef: audioSourceId,
      producerKind: "transcription_loop",
      updateKind: "transcript_window",
    });
    expect(transcriptUpdatesAfterProcess).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contentRef: processPayload.packets[0].packetId,
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]));

    const audioQueryAfterProcess = executeLiveEnvironmentTool({
      tool_name: "live_env.query_audio_transcripts",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: audioSourceId,
        source_kind: "audio_transcript",
      },
    });
    const audioQueryAfterProcessPayload = audioQueryAfterProcess.observation as any;
    expect(audioQueryAfterProcessPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      contractValid: true,
      contractValidationIssues: [],
      feedKind: "audio_transcripts",
      updateCount: 2,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(audioQueryAfterProcessPayload.goalContextUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        producerKind: "audio_capture",
        contentRef: audioMail.mailId,
      }),
      expect.objectContaining({
        producerKind: "transcription_loop",
        contentRef: processPayload.packets[0].packetId,
      }),
    ]));
    expect(audioQueryAfterProcessPayload.packetCircuitRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        producerKind: "audio_capture",
        contentRef: audioMail.mailId,
        transcriptRefs: expect.arrayContaining([
          "workstation_context_feed:audio_transcripts",
          "workstation_actuator:query_audio_transcripts",
        ]),
        actuatorRefs: expect.arrayContaining(["workstation_actuator:query_audio_transcripts"]),
        assistant_answer: false,
        terminal_eligible: false,
      }),
      expect.objectContaining({
        producerKind: "transcription_loop",
        contentRef: processPayload.packets[0].packetId,
        transcriptRefs: expect.arrayContaining([
          "workstation_context_feed:audio_transcripts",
          "workstation_actuator:query_audio_transcripts",
        ]),
        actuatorRefs: expect.arrayContaining(["workstation_actuator:query_audio_transcripts"]),
        assistant_answer: false,
        terminal_eligible: false,
      }),
    ]));
    expect(audioQueryAfterProcessPayload.authoritySummary).toMatchObject({
      updateCount: 2,
      observationOnlyUpdateCount: 2,
      assistantAnswerCount: 0,
      terminalEligibleCount: 0,
      rawContentIncludedCount: 0,
      answerAuthority: "completed_solver_path_required",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_translation_segments",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: audioSourceId,
        source_kind: "audio_transcript",
      },
    });

    const queryPayload = queryObservation.observation as any;
    expect(queryObservation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.query_translation_segments",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      contractValid: true,
      contractValidationIssues: [],
      feedKind: "translated_transcripts",
      sourceRef: audioSourceId,
      updateCount: 1,
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(queryPayload.goalContextUpdates[0]).toMatchObject({
      producerKind: "translation_loop",
      updateKind: "translated_transcript",
      contentRef: processPayload.packets[0].packetId,
      sourceRefs: expect.arrayContaining([audioSourceId]),
      evidenceRefs: expect.arrayContaining([processPayload.packets[0].packetId]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(queryPayload.packetCircuitRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        producerKind: "translation_loop",
        contentRef: processPayload.packets[0].packetId,
        transcriptRefs: expect.arrayContaining([
          "workstation_context_feed:translated_transcripts",
          "workstation_actuator:query_translation_segments",
        ]),
        assistant_answer: false,
        terminal_eligible: false,
      }),
    ]));
    expect(queryObservation.producedRefs).toEqual(expect.arrayContaining([
      queryPayload.goalContextUpdateId,
      queryPayload.resultId,
      queryPayload.goalContextUpdates[0].updateId,
    ]));
  });

  it("prepares workstation preset changes as governed non-terminal control receipts", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.change_workstation_preset",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        target_ref: "source:visual:active",
        preset_id: "preset:frog-classifier",
        reason: "Apply frog classification MicroDeck to the visual source.",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.change_workstation_preset",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "change_preset",
      status: "prepared",
      missingRequirements: [],
      targetRef: "source:visual:active",
      presetId: "preset:frog-classifier",
      policyEvidenceRefs: ["allowed_actuator:change_preset"],
      sourceRefs: expect.arrayContaining([sourceId, "source:visual:active"]),
      loopRefs: expect.arrayContaining(["workstation_control:change_preset", "workstation_actuator:change_preset"]),
      evidenceRefs: expect.arrayContaining([
        "allowed_actuator:change_preset",
        sourceId,
        "source:visual:active",
      ]),
      producedRefs: expect.arrayContaining([payload.receiptId, payload.goalContextUpdateId]),
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: payload.receiptId }),
      expect.objectContaining({ kind: "update_panel", panelId: "stage-play-badge-graph" }),
      expect.objectContaining({ kind: "change_preset", targetRef: "source:visual:active", presetId: "preset:frog-classifier" }),
    ]));
    expect(payload.suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: payload.receiptId }),
      expect.objectContaining({ kind: "update_panel", panelId: "stage-play-badge-graph" }),
      expect.objectContaining({ kind: "change_preset", targetRef: "source:visual:active", presetId: "preset:frog-classifier" }),
    ]));
    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "suggested_action",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      updateId: payload.goalContextUpdateId,
      contentRef: payload.receiptId,
      evidenceRefs: expect.arrayContaining(["allowed_actuator:change_preset"]),
      loopRefs: expect.arrayContaining(["workstation_actuator:change_preset"]),
      freshness: expect.objectContaining({ status: "fresh" }),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(updates[0].suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "change_preset", targetRef: "source:visual:active", presetId: "preset:frog-classifier" }),
    ]));
    expect(observation.producedRefs).toEqual(expect.arrayContaining([payload.receiptId, payload.goalContextUpdateId]));
    expect(observation.evidence_refs).toEqual(expect.arrayContaining([
      payload.goalContextUpdateId,
      payload.receiptId,
      "allowed_actuator:change_preset",
      sourceId,
      "source:visual:active",
    ]));
  });

  it("allows visual preset changes through a modality-specific goal actuator", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:visual-preset-only",
        objective: "Apply visual shade presets for frog classification.",
        allowed_actuators: ["set_visual_preset", "query_visual_summaries"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.change_workstation_preset",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:visual-preset-only",
        target_ref: "source:visual:active",
        preset_id: "preset:frog-classifier",
        reason: "Apply the frog classifier visual shade for this goal.",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.change_workstation_preset",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "change_preset",
      status: "prepared",
      goalId: "goal:visual-preset-only",
      goalSessionFound: true,
      requiredActuator: "change_preset",
      actuatorAllowed: true,
      targetRef: "source:visual:active",
      presetId: "preset:frog-classifier",
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.policyEvidenceRefs).toEqual(expect.arrayContaining([
      "allowed_actuator:change_preset",
      "allowed_actuator:set_visual_preset",
    ]));
    expect(payload.missingRequirements).toEqual([]);
    expect(payload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "change_preset", targetRef: "source:visual:active", presetId: "preset:frog-classifier" }),
    ]));
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining([
        "change_preset",
        "set_visual_preset",
        "live_env.change_workstation_preset",
      ]),
    });

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "suggested_action",
    });
    const controlUpdate = updates.find((update) => update.updateId === payload.goalContextUpdateId);
    expect(controlUpdate).toMatchObject({
      contentRef: payload.receiptId,
      evidenceRefs: expect.arrayContaining([
        "allowed_actuator:change_preset",
        "allowed_actuator:set_visual_preset",
      ]),
      loopRefs: expect.arrayContaining([
        "workstation_actuator:change_preset",
        "workstation_actuator:set_visual_preset",
      ]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
  });

  it("allows audio preset changes through a modality-specific goal actuator", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: "source:browser-audio",
        goal_id: "goal:audio-preset-only",
        objective: "Route earbud translation packets through an audio preset.",
        allowed_actuators: ["set_audio_preset", "query_translation_segments"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.change_workstation_preset",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: "source:browser-audio",
        goal_id: "goal:audio-preset-only",
        target_ref: "source:audio:active",
        preset_id: "preset:earbud-translation",
        reason: "Apply the audio translation preset for the earbud stream.",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.change_workstation_preset",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "change_preset",
      status: "prepared",
      goalId: "goal:audio-preset-only",
      goalSessionFound: true,
      requiredActuator: "change_preset",
      actuatorAllowed: true,
      targetRef: "source:audio:active",
      presetId: "preset:earbud-translation",
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.policyEvidenceRefs).toEqual(expect.arrayContaining([
      "allowed_actuator:change_preset",
      "allowed_actuator:set_audio_preset",
    ]));
    expect(payload.policyEvidenceRefs).not.toContain("allowed_actuator:set_visual_preset");
    expect(payload.missingRequirements).toEqual([]);
    expect(payload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "change_preset", targetRef: "source:audio:active", presetId: "preset:earbud-translation" }),
    ]));
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining([
        "change_preset",
        "set_audio_preset",
        "live_env.change_workstation_preset",
      ]),
    });

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "suggested_action",
    });
    const controlUpdate = updates.find((update) => update.updateId === payload.goalContextUpdateId);
    expect(controlUpdate).toMatchObject({
      contentRef: payload.receiptId,
      evidenceRefs: expect.arrayContaining([
        "allowed_actuator:change_preset",
        "allowed_actuator:set_audio_preset",
      ]),
      loopRefs: expect.arrayContaining([
        "workstation_actuator:change_preset",
        "workstation_actuator:set_audio_preset",
      ]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
  });

  it.each([
    {
      label: "visual",
      toolName: "live_env.set_visual_preset",
      goalId: "goal:visual-alias-preset",
      sourceId,
      targetRef: "source:visual:active",
      presetId: "preset:frog-classifier",
      allowedActuator: "set_visual_preset",
      otherActuator: "set_audio_preset",
      queryActuator: "query_visual_summaries",
      reason: "Apply the frog classifier visual shade through the visual preset alias.",
    },
    {
      label: "audio",
      toolName: "live_env.set_audio_preset",
      goalId: "goal:audio-alias-preset",
      sourceId: "source:browser-audio-alias",
      targetRef: "source:audio:active",
      presetId: "preset:earbud-translation",
      allowedActuator: "set_audio_preset",
      otherActuator: "set_visual_preset",
      queryActuator: "query_translation_segments",
      reason: "Apply the translation shade through the audio preset alias.",
    },
  ] as const)("prepares $label preset alias controls as governed non-terminal receipts", (entry) => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: entry.sourceId,
        goal_id: entry.goalId,
        objective: `Apply ${entry.label} presets through a modality-specific workstation actuator.`,
        allowed_actuators: [entry.allowedActuator, entry.queryActuator],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: entry.toolName,
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: entry.sourceId,
        goal_id: entry.goalId,
        target_ref: entry.targetRef,
        preset_id: entry.presetId,
        reason: entry.reason,
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: entry.toolName,
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "change_preset",
      status: "prepared",
      goalId: entry.goalId,
      goalSessionFound: true,
      requiredActuator: entry.allowedActuator,
      actuatorAllowed: true,
      targetRef: entry.targetRef,
      presetId: entry.presetId,
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.policyEvidenceRefs).toEqual(expect.arrayContaining([
      `allowed_actuator:${entry.allowedActuator}`,
      "allowed_actuator:change_preset",
    ]));
    expect(payload.policyEvidenceRefs).not.toContain(`allowed_actuator:${entry.otherActuator}`);
    expect(payload.missingRequirements).toEqual([]);
    expect(payload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "change_preset", targetRef: entry.targetRef, presetId: entry.presetId }),
    ]));
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining([
        entry.allowedActuator,
        "change_preset",
        entry.toolName,
      ]),
    });

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "suggested_action",
    });
    const controlUpdate = updates.find((update) => update.updateId === payload.goalContextUpdateId);
    expect(controlUpdate).toMatchObject({
      contentRef: payload.receiptId,
      evidenceRefs: expect.arrayContaining([
        `allowed_actuator:${entry.allowedActuator}`,
        "allowed_actuator:change_preset",
      ]),
      loopRefs: expect.arrayContaining([
        `workstation_actuator:${entry.allowedActuator}`,
        "workstation_actuator:change_preset",
      ]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
  });

  it("records Live Answer projection controls as queryable Live Answer goal context", () => {
    const liveAnswerSourceId = "visual_source:live-answer-projection-control";
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:live-answer-projection-control",
      objective: "Project frog classification packets into Live Answer.",
      room_id: roomId,
      source_ids: [liveAnswerSourceId],
      preset: "custom",
      line_schema: [
        {
          key: "classification",
          label: "Classification",
          update_policy: "projection_only",
          visibility: "answer_card",
          priority: "info",
        },
      ],
    });

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.update_live_answer_projection",
      thread_id: threadId,
      environment_id: environment.environment_id,
      args: {
        room_id: roomId,
        source_id: liveAnswerSourceId,
        line_key: "classification",
        reason: "Project the frog classifier packet lane into Live Answer.",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.update_live_answer_projection",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "update_live_answer",
      status: "prepared",
      lineKey: "classification",
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "update_live_answer", lineKey: "classification" }),
      expect.objectContaining({ kind: "update_panel", panelId: "live-answer-environment" }),
    ]));

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      sourceRef: liveAnswerSourceId,
      producerKind: "live_answer",
      updateKind: "summary",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      updateId: payload.goalContextUpdateId,
      producerKind: "live_answer",
      updateKind: "summary",
      contentRef: payload.receiptId,
      sourceRefs: expect.arrayContaining([
        liveAnswerSourceId,
        "live_answer_line:classification",
      ]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    const routeWatchUpdate = recordStagePlayGoalContextUpdate({
      schemaVersion: "helix.workstation_goal_context_update.v1",
      updateId: "stage_play_goal_context_update:route-watch:live-answer-leak-guard",
      createdAtMs: Date.parse("2026-06-17T16:00:00.000Z"),
      sourceRefs: [liveAnswerSourceId],
      loopRefs: ["workstation_context_feed:route_evidence", "workstation_actuator:query_route_evidence"],
      producerKind: "route_watch",
      updateKind: "route_evidence",
      contentRef: "route_watch_evidence:live-answer-leak-guard",
      preview: "Route-watch evidence for the same source must not appear in the Live Answer state feed.",
      evidenceRefs: ["route_watch_evidence:live-answer-leak-guard", liveAnswerSourceId],
      receiptRefs: ["route_watch_evidence:live-answer-leak-guard"],
      freshness: {
        observedAtMs: Date.parse("2026-06-17T16:00:00.000Z"),
        staleAfterMs: 60_000,
        status: "fresh",
      },
      goalRelevance: null,
      suggestedDispatch: [
        { kind: "log_receipt", receiptRef: "route_watch_evidence:live-answer-leak-guard" },
        { kind: "update_panel", panelId: "stage-play-badge-graph" },
      ],
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_live_answer_state",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: liveAnswerSourceId,
      },
    });
    const queryPayload = queryObservation.observation as any;
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      contractValid: true,
      contractValidationIssues: [],
      feedKind: "live_answer_lines",
      updateCount: 1,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      post_tool_model_step_required: true,
    });
    expect(queryPayload.goalContextUpdates[0]).toMatchObject({
      updateId: payload.goalContextUpdateId,
      producerKind: "live_answer",
      contentRef: payload.receiptId,
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(queryPayload.goalContextUpdates.map((update: any) => update.updateId)).not.toContain(routeWatchUpdate.updateId);
  });

  it("blocks workstation controls that are outside an explicit goal session actuator policy", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:visual-query-only",
        objective: "Observe visual summaries without changing workstation presets.",
        allowed_actuators: ["query_visual_summaries", "query_source_health"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.change_workstation_preset",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:visual-query-only",
        target_ref: "source:visual:active",
        preset_id: "preset:frog-classifier",
        reason: "Try to apply a preset from a query-only goal.",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.change_workstation_preset",
      ok: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "change_preset",
      status: "blocked",
      goalId: "goal:visual-query-only",
      goalSessionFound: true,
      requiredActuator: "change_preset",
      actuatorAllowed: false,
      matchedAllowedActuators: [],
      matchedAllowedActuatorRefs: [],
      policyEvidenceRefs: ["allowed_actuator:change_preset"],
      missingRequirements: ["allowed_actuator:change_preset"],
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      targetRef: "source:visual:active",
      presetId: "preset:frog-classifier",
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: payload.receiptId }),
      expect.objectContaining({ kind: "update_panel", panelId: "stage-play-badge-graph" }),
    ]));
    expect(payload.dispatch.map((action: any) => action.kind)).not.toContain("change_preset");

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "suggested_action",
    });
    const controlUpdate = updates.find((update) => update.updateId === payload.goalContextUpdateId);
    expect(controlUpdate).toMatchObject({
      contentRef: payload.receiptId,
      evidenceRefs: expect.arrayContaining(["allowed_actuator:change_preset"]),
      loopRefs: expect.arrayContaining(["workstation_actuator:change_preset"]),
      freshness: expect.objectContaining({ status: "blocked" }),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(controlUpdate?.suggestedDispatch.map((action) => action.kind)).not.toContain("change_preset");
  });

  it("blocks incomplete workstation control receipts without terminalizing them", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.bind_workstation_source",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_ref: "audio_source:earbuds",
      },
    });

    const payload = observation.observation as any;
    expect(observation.ok).toBe(false);
    expect(observation).toMatchObject({
      tool_name: "live_env.bind_workstation_source",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "bind_source",
      status: "blocked",
      missingRequirements: ["target_ref"],
      sourceRef: "audio_source:earbuds",
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "suggested_action",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].freshness.status).toBe("blocked");
    expect(updates[0].suggestedDispatch.map((action) => action.kind)).not.toContain("bind_source");
  });

  it("blocks source binding controls without a source endpoint", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.bind_workstation_source",
      thread_id: threadId,
      args: {
        room_id: roomId,
        target_ref: "live-answer:audio",
      },
    });

    const payload = observation.observation as any;
    expect(observation.ok).toBe(false);
    expect(observation).toMatchObject({
      tool_name: "live_env.bind_workstation_source",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "bind_source",
      status: "blocked",
      missingRequirements: ["source_ref"],
      sourceRef: null,
      targetRef: "live-answer:audio",
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "suggested_action",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].freshness.status).toBe("blocked");
    expect(updates[0].suggestedDispatch.map((action) => action.kind)).not.toContain("bind_source");
  });

  it("prepares source binding as a non-terminal goal-session control", () => {
    const session = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:source-binding-control",
        objective: "Let the agent bind the visual source into the Live Answer lane.",
        allowed_actuators: ["bind_source", "query_source_health"],
      },
    });
    expect(session.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.bind_workstation_source",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:source-binding-control",
        source_ref: "source:visual:active",
        target_ref: "live-answer:visual",
        reason: "Attach the visual source to Live Answer for this goal.",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.bind_workstation_source",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "bind_source",
      status: "prepared",
      goalId: "goal:source-binding-control",
      requiredActuator: "bind_source",
      actuatorAllowed: true,
      matchedAllowedActuators: ["bind_source"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:bind_source"],
      policyEvidenceRefs: expect.arrayContaining([
        "allowed_actuator:bind_source",
        "agent_goal_allowed_actuator:bind_source",
      ]),
      sourceRef: "source:visual:active",
      targetRef: "live-answer:visual",
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: payload.receiptId }),
      expect.objectContaining({ kind: "update_panel", panelId: "live-answer-environment" }),
      expect.objectContaining({ kind: "bind_source", sourceRef: "source:visual:active", targetRef: "live-answer:visual" }),
    ]));
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: "Prepared bind workstation source control dispatch for this goal session.",
      actionsTaken: expect.arrayContaining(["bind_source", "live_env.bind_workstation_source"]),
      evidenceRefs: expect.arrayContaining([payload.goalContextUpdateId, payload.receiptId]),
      nextStep: "continue",
    });

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "suggested_action",
    });
    const bindUpdate = updates.find((update) => update.updateId === payload.goalContextUpdateId);
    expect(bindUpdate).toMatchObject({
      contentRef: payload.receiptId,
      sourceRefs: expect.arrayContaining(["source:visual:active", "live-answer:visual"]),
      evidenceRefs: expect.arrayContaining([
        "allowed_actuator:bind_source",
        "agent_goal_allowed_actuator:bind_source",
      ]),
      loopRefs: expect.arrayContaining(["workstation_control:bind_source", "workstation_actuator:bind_source"]),
      freshness: expect.objectContaining({ status: "fresh" }),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(bindUpdate?.suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "bind_source", sourceRef: "source:visual:active", targetRef: "live-answer:visual" }),
    ]));
  });

  it("canonicalizes visual and audio preset control aliases into non-terminal workstation receipts", () => {
    const session = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:preset-routing-controls",
        objective: "Let the agent route visual and audio packets through selected MicroReasoner presets.",
        allowed_actuators: ["visual_preset", "audio_preset"],
      },
    });
    expect(session.ok).toBe(true);

    const visualObservation = executeLiveEnvironmentTool({
      tool_name: "visual_preset",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:preset-routing-controls",
        target_ref: "live-answer:visual",
        preset_id: "frog-classifier-visual",
        reason: "Route visual packets through the frog classification shade.",
      },
    });
    const visualPayload = visualObservation.observation as any;
    expect(visualObservation).toMatchObject({
      tool_name: "live_env.set_visual_preset",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(visualPayload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      requestedToolName: "visual_preset",
      canonicalToolName: "live_env.set_visual_preset",
      controlKind: "change_preset",
      status: "prepared",
      goalId: "goal:preset-routing-controls",
      requiredActuator: "set_visual_preset",
      actuatorAllowed: true,
      matchedAllowedActuators: ["set_visual_preset"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:set_visual_preset"],
      policyEvidenceRefs: expect.arrayContaining([
        "allowed_actuator:set_visual_preset",
        "agent_goal_allowed_actuator:set_visual_preset",
      ]),
      targetRef: "live-answer:visual",
      presetId: "frog-classifier-visual",
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(visualPayload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: visualPayload.receiptId }),
      expect.objectContaining({ kind: "change_preset", targetRef: "live-answer:visual", presetId: "frog-classifier-visual" }),
    ]));
    expect(visualPayload.evidenceRefs).toContain(visualPayload.goalContextUpdateId);
    expect(visualPayload.evidence_refs).toContain(visualPayload.goalContextUpdateId);
    expect(visualPayload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: "Prepared set visual preset control dispatch for this goal session.",
      actionsTaken: expect.arrayContaining(["set_visual_preset", "live_env.set_visual_preset", "visual_preset"]),
      evidenceRefs: expect.arrayContaining([visualPayload.goalContextUpdateId, visualPayload.receiptId]),
      nextStep: "continue",
    });

    const audioObservation = executeLiveEnvironmentTool({
      tool_name: "audio_preset",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:preset-routing-controls",
        target_ref: "live-answer:audio",
        preset_id: "earbud-translation",
        reason: "Route audio packets through the translation deck.",
      },
    });
    const audioPayload = audioObservation.observation as any;
    expect(audioObservation).toMatchObject({
      tool_name: "live_env.set_audio_preset",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(audioPayload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      requestedToolName: "audio_preset",
      canonicalToolName: "live_env.set_audio_preset",
      controlKind: "change_preset",
      status: "prepared",
      goalId: "goal:preset-routing-controls",
      requiredActuator: "set_audio_preset",
      actuatorAllowed: true,
      matchedAllowedActuators: ["set_audio_preset"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:set_audio_preset"],
      policyEvidenceRefs: expect.arrayContaining([
        "allowed_actuator:set_audio_preset",
        "agent_goal_allowed_actuator:set_audio_preset",
      ]),
      targetRef: "live-answer:audio",
      presetId: "earbud-translation",
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(audioPayload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: audioPayload.receiptId }),
      expect.objectContaining({ kind: "change_preset", targetRef: "live-answer:audio", presetId: "earbud-translation" }),
    ]));
    expect(audioPayload.evidenceRefs).toContain(audioPayload.goalContextUpdateId);
    expect(audioPayload.evidence_refs).toContain(audioPayload.goalContextUpdateId);

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "suggested_action",
      limit: 10,
    });
    expect(updates.map((update) => update.updateId)).toEqual(expect.arrayContaining([
      visualPayload.goalContextUpdateId,
      audioPayload.goalContextUpdateId,
    ]));
    const visualUpdate = updates.find((update) => update.updateId === visualPayload.goalContextUpdateId);
    const audioUpdate = updates.find((update) => update.updateId === audioPayload.goalContextUpdateId);
    expect(visualUpdate).toMatchObject({
      contentRef: visualPayload.receiptId,
      sourceRefs: expect.arrayContaining(["live-answer:visual"]),
      evidenceRefs: expect.arrayContaining([
        visualPayload.receiptId,
        "allowed_actuator:set_visual_preset",
        "agent_goal_allowed_actuator:set_visual_preset",
      ]),
      loopRefs: expect.arrayContaining([
        "workstation_control:change_preset",
        "workstation_actuator:set_visual_preset",
      ]),
      toolIdentity: {
        requestedToolName: "visual_preset",
        canonicalToolName: "live_env.set_visual_preset",
        matchedAllowedActuators: ["set_visual_preset"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:set_visual_preset"],
      },
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(audioUpdate).toMatchObject({
      contentRef: audioPayload.receiptId,
      sourceRefs: expect.arrayContaining(["live-answer:audio"]),
      evidenceRefs: expect.arrayContaining([
        audioPayload.receiptId,
        "allowed_actuator:set_audio_preset",
        "agent_goal_allowed_actuator:set_audio_preset",
      ]),
      loopRefs: expect.arrayContaining([
        "workstation_control:change_preset",
        "workstation_actuator:set_audio_preset",
      ]),
      toolIdentity: {
        requestedToolName: "audio_preset",
        canonicalToolName: "live_env.set_audio_preset",
        matchedAllowedActuators: ["set_audio_preset"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:set_audio_preset"],
      },
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
  });

  it("prepares source unbinding and process-graph focus as non-terminal goal-session controls", () => {
    const session = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:source-routing-controls",
        objective: "Let the agent adjust source routing and inspect packet graph focus without answering from receipts.",
        allowed_actuators: ["unbind_source", "focus_process_graph", "query_packet_traces"],
      },
    });
    expect(session.ok).toBe(true);

    const unbindObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.unbind_workstation_source",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:source-routing-controls",
        source_ref: "source:visual:active",
        target_ref: "live-answer:visual",
        reason: "Detach the visual source from the Live Answer lane before rebinding.",
      },
    });
    const unbindPayload = unbindObservation.observation as any;
    expect(unbindObservation).toMatchObject({
      tool_name: "live_env.unbind_workstation_source",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(unbindPayload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "unbind_source",
      status: "prepared",
      goalId: "goal:source-routing-controls",
      requiredActuator: "unbind_source",
      actuatorAllowed: true,
      matchedAllowedActuators: ["unbind_source"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:unbind_source"],
      policyEvidenceRefs: expect.arrayContaining([
        "allowed_actuator:unbind_source",
        "agent_goal_allowed_actuator:unbind_source",
      ]),
      sourceRef: "source:visual:active",
      targetRef: "live-answer:visual",
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(unbindPayload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: unbindPayload.receiptId }),
      expect.objectContaining({ kind: "update_panel", panelId: "live-answer-environment" }),
      expect.objectContaining({ kind: "unbind_source", sourceRef: "source:visual:active", targetRef: "live-answer:visual" }),
    ]));
    expect(unbindPayload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: "Prepared unbind workstation source control dispatch for this goal session.",
      actionsTaken: expect.arrayContaining(["unbind_source", "live_env.unbind_workstation_source"]),
      evidenceRefs: expect.arrayContaining([unbindPayload.goalContextUpdateId, unbindPayload.receiptId]),
      nextStep: "continue",
    });

    const focusObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.focus_process_graph",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:source-routing-controls",
        node_ref: "stage_play_processed_mail_packet:frog-001",
        reason: "Inspect the packet trace for the frog classifier lane.",
      },
    });
    const focusPayload = focusObservation.observation as any;
    expect(focusObservation).toMatchObject({
      tool_name: "live_env.focus_process_graph",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(focusPayload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "focus_process_graph",
      status: "prepared",
      goalId: "goal:source-routing-controls",
      requiredActuator: "focus_process_graph",
      actuatorAllowed: true,
      matchedAllowedActuators: ["focus_process_graph"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:focus_process_graph"],
      policyEvidenceRefs: expect.arrayContaining([
        "allowed_actuator:focus_process_graph",
        "agent_goal_allowed_actuator:focus_process_graph",
      ]),
      nodeRef: "stage_play_processed_mail_packet:frog-001",
      panelId: "stage-play-badge-graph",
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(focusPayload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: focusPayload.receiptId }),
      expect.objectContaining({ kind: "update_panel", panelId: "stage-play-badge-graph" }),
      expect.objectContaining({ kind: "focus_process_graph", nodeRef: "stage_play_processed_mail_packet:frog-001" }),
    ]));
    expect(focusPayload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: "Prepared focus process graph control dispatch for this goal session.",
      actionsTaken: expect.arrayContaining(["focus_process_graph", "live_env.focus_process_graph"]),
      evidenceRefs: expect.arrayContaining([focusPayload.goalContextUpdateId, focusPayload.receiptId]),
      nextStep: "continue",
    });

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "suggested_action",
      limit: 10,
    });
    expect(updates.map((update) => update.updateId)).toEqual(expect.arrayContaining([
      unbindPayload.goalContextUpdateId,
      focusPayload.goalContextUpdateId,
    ]));
    const unbindUpdate = updates.find((update) => update.updateId === unbindPayload.goalContextUpdateId);
    const focusUpdate = updates.find((update) => update.updateId === focusPayload.goalContextUpdateId);
    expect(unbindUpdate).toMatchObject({
      contentRef: unbindPayload.receiptId,
      evidenceRefs: expect.arrayContaining([
        "allowed_actuator:unbind_source",
        "agent_goal_allowed_actuator:unbind_source",
      ]),
      loopRefs: expect.arrayContaining(["workstation_actuator:unbind_source"]),
      freshness: expect.objectContaining({ status: "fresh" }),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(focusUpdate).toMatchObject({
      contentRef: focusPayload.receiptId,
      sourceRefs: expect.arrayContaining(["stage_play_processed_mail_packet:frog-001"]),
      evidenceRefs: expect.arrayContaining([
        "allowed_actuator:focus_process_graph",
        "agent_goal_allowed_actuator:focus_process_graph",
      ]),
      loopRefs: expect.arrayContaining(["workstation_actuator:focus_process_graph"]),
      freshness: expect.objectContaining({ status: "fresh" }),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(unbindUpdate?.suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "unbind_source", sourceRef: "source:visual:active", targetRef: "live-answer:visual" }),
    ]));
    expect(focusUpdate?.suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "focus_process_graph", nodeRef: "stage_play_processed_mail_packet:frog-001" }),
    ]));

    const storedSession = listStagePlayAgentGoalSessions({
      threadId,
      goalId: "goal:source-routing-controls",
      limit: 1,
    })[0];
    expect(storedSession).toMatchObject({
      authority: hardenedGoalSessionAuthority(),
    });
    expect(storedSession?.checkpoints.at(-2)).toMatchObject({
      actionsTaken: expect.arrayContaining(["unbind_source", "live_env.unbind_workstation_source"]),
    });
    expect(storedSession?.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining(["focus_process_graph", "live_env.focus_process_graph"]),
    });
  });

  it("blocks process-graph focus controls without a target node", () => {
    const session = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:focus-requires-node",
        objective: "Let the agent inspect a specific packet node in the process graph.",
        allowed_actuators: ["focus_process_graph"],
      },
    });
    expect(session.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.focus_process_graph",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:focus-requires-node",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.focus_process_graph",
      ok: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "focus_process_graph",
      status: "blocked",
      goalId: "goal:focus-requires-node",
      requiredActuator: "focus_process_graph",
      actuatorAllowed: true,
      missingRequirements: ["node_ref"],
      nodeRef: null,
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.dispatch.map((action: any) => action.kind)).not.toContain("focus_process_graph");
    expect(payload.suggestedDispatch.map((action: any) => action.kind)).not.toContain("focus_process_graph");

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "route_watch",
      updateKind: "suggested_action",
    });
    const focusUpdate = updates.find((update) => update.updateId === payload.goalContextUpdateId);
    expect(focusUpdate).toMatchObject({
      contentRef: payload.receiptId,
      freshness: expect.objectContaining({ status: "blocked" }),
      evidenceRefs: expect.arrayContaining(["allowed_actuator:focus_process_graph"]),
      loopRefs: expect.arrayContaining(["workstation_actuator:focus_process_graph"]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(focusUpdate?.suggestedDispatch.map((action) => action.kind)).not.toContain("focus_process_graph");
  });

  it("governs loop state controls with state-specific goal actuators and a generic override", () => {
    const pauseSession = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:pause-only-loop",
        objective: "Allow the agent to pause the visual loop without resuming it.",
        allowed_actuators: ["pause_loop"],
      },
    });
    expect(pauseSession.ok).toBe(true);
    const initialPauseCheckpointCount = ((pauseSession.observation as any).session.checkpoints ?? []).length;

    const pauseObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.pause_workstation_loop",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:pause-only-loop",
        loop_ref: "loop:visual-capture",
      },
    });
    const pausePayload = pauseObservation.observation as any;
    expect(pauseObservation.ok).toBe(true);
    expect(pausePayload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "set_loop_state",
      status: "prepared",
      goalId: "goal:pause-only-loop",
      requiredActuator: "pause_loop",
      actuatorAllowed: true,
      matchedAllowedActuators: ["pause_loop"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:pause_loop"],
      loopRef: "loop:visual-capture",
      loopState: "paused",
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(pausePayload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "set_loop_state", loopRef: "loop:visual-capture", state: "paused" }),
    ]));
    expect(pausePayload.agentGoalSession).toMatchObject({
      goalId: "goal:pause-only-loop",
      checkpoints: expect.arrayContaining([
        expect.objectContaining({
          summary: "Prepared pause workstation loop control dispatch for this goal session.",
          actionsTaken: expect.arrayContaining(["pause_loop", "set_loop_state", "live_env.pause_workstation_loop"]),
          evidenceRefs: expect.arrayContaining([pausePayload.goalContextUpdateId, pausePayload.receiptId]),
          nextStep: "continue",
        }),
      ]),
      authority: hardenedGoalSessionAuthority(),
    });
    expect(pausePayload.agentGoalSession.checkpoints).toHaveLength(initialPauseCheckpointCount + 1);
    const storedPauseSession = listStagePlayAgentGoalSessions({
      threadId,
      goalId: "goal:pause-only-loop",
      limit: 1,
    })[0];
    expect(storedPauseSession?.checkpoints.at(-1)).toMatchObject({
      summary: "Prepared pause workstation loop control dispatch for this goal session.",
      actionsTaken: expect.arrayContaining(["pause_loop", "set_loop_state", "live_env.pause_workstation_loop"]),
      evidenceRefs: expect.arrayContaining([pausePayload.goalContextUpdateId, pausePayload.receiptId]),
    });

    const resumeObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.resume_workstation_loop",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:pause-only-loop",
        loop_ref: "loop:visual-capture",
      },
    });
    const resumePayload = resumeObservation.observation as any;
    expect(resumeObservation.ok).toBe(false);
    expect(resumePayload).toMatchObject({
      controlKind: "set_loop_state",
      status: "blocked",
      goalId: "goal:pause-only-loop",
      requiredActuator: "resume_loop",
      actuatorAllowed: false,
      matchedAllowedActuators: [],
      matchedAllowedActuatorRefs: [],
      missingRequirements: ["allowed_actuator:resume_loop"],
      loopState: "running",
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(resumePayload.dispatch.map((action: any) => action.kind)).not.toContain("set_loop_state");

    const genericSession = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:generic-loop-control",
        objective: "Allow generic loop-state control for repair.",
        allowed_actuators: ["live_env.set_workstation_loop_state"],
      },
    });
    expect(genericSession.ok).toBe(true);
    expect((genericSession.observation as any).session.allowedActuators).toEqual(expect.arrayContaining([
      "set_loop_state",
      "query_visual_summaries",
      "query_audio_transcripts",
      "query_translation_segments",
      "query_microdeck_outputs",
      "query_live_answer_state",
      "query_source_health",
      "query_trace_memory",
      "query_narrator_events",
      "query_packet_traces",
      "query_route_evidence",
      "query_automation_policies",
    ]));

    const repairObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.set_workstation_loop_state",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:generic-loop-control",
        loop_ref: "loop:visual-capture",
        state: "repaired",
      },
    });
    const repairPayload = repairObservation.observation as any;
    expect(repairObservation.ok).toBe(true);
    expect(repairPayload).toMatchObject({
      controlKind: "set_loop_state",
      status: "prepared",
      goalId: "goal:generic-loop-control",
      requiredActuator: "repair_loop",
      actuatorAllowed: true,
      matchedAllowedActuators: ["set_loop_state"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:set_loop_state"],
      loopState: "repaired",
      contractValid: true,
      contractValidationIssues: [],
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(repairPayload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "set_loop_state", loopRef: "loop:visual-capture", state: "repaired" }),
      expect.objectContaining({ kind: "repair_loop", loopRef: "loop:visual-capture" }),
    ]));
  });

  it("prepares explicit source repair controls as non-terminal repair-source receipts", () => {
    const session = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:repair-source",
        objective: "Allow the agent to repair the visual source loop.",
        allowed_actuators: ["repair_source", "query_source_health", "repair_loop"],
      },
    });
    expect(session.ok).toBe(true);

    const repairObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.repair_workstation_source",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:repair-source",
        loop_ref: "loop:visual-capture",
        reason: "Visual capture source needs repair before the next goal-context query.",
      },
    });
    const repairPayload = repairObservation.observation as any;
    expect(repairObservation.ok).toBe(true);
    expect(repairPayload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "repair_source",
      status: "prepared",
      goalId: "goal:repair-source",
      requiredActuator: "repair_source",
      actuatorAllowed: true,
      matchedAllowedActuators: ["repair_source"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:repair_source"],
      loopRef: "loop:visual-capture",
      loopState: "repaired",
      contractValid: true,
      contractValidationIssues: [],
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(repairPayload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "repair_source", sourceRef: sourceId, loopRef: "loop:visual-capture" }),
      expect.objectContaining({ kind: "set_loop_state", loopRef: "loop:visual-capture", state: "repaired" }),
    ]));
    expect(repairPayload.dispatch.map((action: any) => action.kind)).not.toContain("repair_loop");
    expect(repairPayload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: "Prepared repair workstation source control dispatch for this goal session.",
      actionsTaken: expect.arrayContaining(["repair_source", "live_env.repair_workstation_source"]),
      nextStep: "continue",
    });

    const sourceOnlyRepairObservation = executeLiveEnvironmentTool({
      tool_name: "repair_source" as any,
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:repair-source",
        reason: "Repair the visual capture source without a loop-specific repair.",
      },
    });
    const sourceOnlyRepairPayload = sourceOnlyRepairObservation.observation as any;
    expect(sourceOnlyRepairObservation.ok).toBe(true);
    expect(sourceOnlyRepairPayload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "repair_source",
      status: "prepared",
      goalId: "goal:repair-source",
      sourceRef: sourceId,
      loopRef: null,
      requiredActuator: "repair_source",
      actuatorAllowed: true,
      missingRequirements: [],
      contractValid: true,
      contractValidationIssues: [],
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(sourceOnlyRepairPayload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "repair_source", sourceRef: sourceId, loopRef: null }),
    ]));
    expect(sourceOnlyRepairPayload.dispatch.map((action: any) => action.kind)).not.toContain("repair_loop");

    const repairLoopObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.repair_loop",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:repair-source",
        loop_ref: "loop:visual-capture",
        reason: "Repair the deterministic visual capture loop directly.",
      },
    });
    const repairLoopPayload = repairLoopObservation.observation as any;
    expect(repairLoopObservation.ok).toBe(true);
    expect(repairLoopPayload).toMatchObject({
      schema: "stage_play_workstation_control_receipt/v1",
      controlKind: "repair_loop",
      status: "prepared",
      goalId: "goal:repair-source",
      requiredActuator: "repair_loop",
      actuatorAllowed: true,
      matchedAllowedActuators: ["repair_loop"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:repair_loop"],
      loopRef: "loop:visual-capture",
      loopState: "repaired",
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(repairLoopPayload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "set_loop_state", loopRef: "loop:visual-capture", state: "repaired" }),
      expect.objectContaining({ kind: "repair_loop", loopRef: "loop:visual-capture" }),
    ]));
    expect(repairLoopPayload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: "Prepared repair workstation loop control dispatch for this goal session.",
      actionsTaken: expect.arrayContaining(["repair_loop", "live_env.repair_loop"]),
      nextStep: "continue",
    });

    const sourceOnlySession = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:source-only-repair",
        objective: "Allow source repair without direct loop repair.",
        allowed_actuators: ["repair_source"],
      },
    });
    expect(sourceOnlySession.ok).toBe(true);

    const sourceOnlyLoopRepair = executeLiveEnvironmentTool({
      tool_name: "live_env.repair_loop",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:source-only-repair",
        loop_ref: "loop:visual-capture",
      },
    });
    const sourceOnlyLoopRepairPayload = sourceOnlyLoopRepair.observation as any;
    expect(sourceOnlyLoopRepair.ok).toBe(false);
    expect(sourceOnlyLoopRepairPayload).toMatchObject({
      controlKind: "repair_loop",
      status: "blocked",
      requiredActuator: "repair_loop",
      actuatorAllowed: false,
      matchedAllowedActuators: [],
      matchedAllowedActuatorRefs: [],
      missingRequirements: ["allowed_actuator:repair_loop"],
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(sourceOnlyLoopRepairPayload.dispatch.map((action: any) => action.kind)).not.toContain("repair_loop");

    const deniedSession = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:pause-only-source-repair-denied",
        objective: "Allow the agent to pause the visual loop without repairing it.",
        allowed_actuators: ["pause_loop"],
      },
    });
    expect(deniedSession.ok).toBe(true);

    const deniedObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.repair_workstation_source",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:pause-only-source-repair-denied",
        loop_ref: "loop:visual-capture",
      },
    });
    const deniedPayload = deniedObservation.observation as any;
    expect(deniedObservation.ok).toBe(false);
    expect(deniedPayload).toMatchObject({
      controlKind: "repair_source",
      status: "blocked",
      requiredActuator: "repair_source",
      actuatorAllowed: false,
      matchedAllowedActuators: [],
      matchedAllowedActuatorRefs: [],
      missingRequirements: ["allowed_actuator:repair_source"],
      contractValid: true,
      contractValidationIssues: [],
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(deniedPayload.dispatch.map((action: any) => action.kind)).not.toContain("repair_loop");
    expect(deniedPayload.dispatch.map((action: any) => action.kind)).not.toContain("repair_source");
  });

  it("prepares narrator say requests as durable non-terminal goal-context updates", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.narrator_say",
      thread_id: threadId,
      args: {
        text: "Translation is now routed through Narrator.",
        source_kind: "helix_console",
        source_id: "helix_ask:translation",
        delivery_mode: "confirm_to_speak",
        evidence_refs: ["translation_segment:latest"],
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.narrator_say",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.narrator_say_request.v1",
      schemaVersion: "helix.narrator_say_request.v1",
      text: "Translation is now routed through Narrator.",
      sourceKind: "helix_console",
      sourceId: "helix_ask:translation",
      deliveryMode: "confirm_to_speak",
      policyEvidenceRefs: ["allowed_actuator:narrator_say"],
      matchedAllowedActuators: [],
      matchedAllowedActuatorRefs: [],
      sourceRefs: expect.arrayContaining(["helix_ask:translation", "helix_console"]),
      loopRefs: expect.arrayContaining(["narrator:say", "workstation_actuator:narrator_say"]),
      evidenceRefs: expect.arrayContaining([
        "translation_segment:latest",
        "allowed_actuator:narrator_say",
      ]),
      producedRefs: expect.arrayContaining([payload.requestId, payload.goalContextUpdateId]),
      post_tool_model_step_required: true,
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: payload.requestId }),
      expect.objectContaining({ kind: "update_panel", panelId: "narrator" }),
      expect.objectContaining({ kind: "speak_narrator", mode: "confirm" }),
    ]));
    expect(payload.suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: payload.requestId }),
      expect.objectContaining({ kind: "update_panel", panelId: "narrator" }),
      expect.objectContaining({ kind: "speak_narrator", mode: "confirm" }),
    ]));
    expect(payload.evidenceRefs).toContain(payload.requestId);
    expect(payload.evidenceRefs).toContain(payload.goalContextUpdateId);
    expect(payload.evidence_refs).toContain(payload.goalContextUpdateId);
    expect(observation.producedRefs).toEqual(expect.arrayContaining([payload.requestId, payload.goalContextUpdateId]));
    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "narrator",
      updateKind: "suggested_action",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      updateId: payload.goalContextUpdateId,
      contentRef: payload.requestId,
      toolIdentity: {
        requestedToolName: "live_env.narrator_say",
        canonicalToolName: "live_env.narrator_say",
        matchedAllowedActuators: [],
        matchedAllowedActuatorRefs: [],
      },
      sourceRefs: expect.arrayContaining(["helix_ask:translation", "helix_console"]),
      evidenceRefs: expect.arrayContaining([payload.requestId, "allowed_actuator:narrator_say", "translation_segment:latest"]),
      loopRefs: expect.arrayContaining(["workstation_actuator:narrator_say"]),
      receiptRefs: [payload.requestId],
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
  });

  it("accepts narrator.say as a public alias while canonicalizing the non-terminal receipt", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "narrator.say",
      thread_id: threadId,
      args: {
        text: "Translation is available.",
        source_kind: "helix_console",
        source_id: "helix_ask:translation",
        delivery_mode: "confirm_to_speak",
        evidence_refs: ["translation_segment:alias"],
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.narrator_say",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload).toMatchObject({
      schema: "helix.narrator_say_request.v1",
      requestedToolName: "narrator.say",
      canonicalToolName: "live_env.narrator_say",
      requiredActuator: "narrator_say",
      text: "Translation is available.",
      sourceId: "helix_ask:translation",
      policyEvidenceRefs: ["allowed_actuator:narrator_say"],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.evidenceRefs).toEqual(expect.arrayContaining([
      payload.requestId,
      payload.goalContextUpdateId,
      "allowed_actuator:narrator_say",
      "translation_segment:alias",
    ]));
  });

  it("accepts narrator_say as an advertised alias while preserving non-terminal authority", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "narrator_say",
      thread_id: threadId,
      args: {
        text: "Translation is available from the underscore alias.",
        source_kind: "helix_console",
        source_id: "helix_ask:translation",
        delivery_mode: "visible_only",
        evidence_refs: ["translation_segment:underscore-alias"],
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.narrator_say",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload).toMatchObject({
      schema: "helix.narrator_say_request.v1",
      requestedToolName: "narrator_say",
      canonicalToolName: "live_env.narrator_say",
      requiredActuator: "narrator_say",
      text: "Translation is available from the underscore alias.",
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.evidenceRefs).toEqual(expect.arrayContaining([
      "allowed_actuator:narrator_say",
      "translation_segment:underscore-alias",
    ]));
  });

  it("blocks narrator say when an explicit goal session does not allow speech actuation", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:narrator-query-only",
        objective: "Observe translated segments without speaking them.",
        allowed_actuators: ["query_translation_segments", "query_trace_memory"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.narrator_say",
      thread_id: threadId,
      args: {
        goal_id: "goal:narrator-query-only",
        text: "Translation is ready.",
        source_kind: "helix_console",
        source_id: "helix_ask:translation",
        delivery_mode: "confirm_to_speak",
        evidence_refs: ["translation_segment:latest"],
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.narrator_say",
      ok: false,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.narrator_say_request.v1",
      status: "blocked",
      goalId: "goal:narrator-query-only",
      goalSessionFound: true,
      requiredActuator: "narrator_say",
      actuatorAllowed: false,
      matchedAllowedActuators: [],
      matchedAllowedActuatorRefs: [],
      policyEvidenceRefs: ["allowed_actuator:narrator_say"],
      missingRequirements: ["allowed_actuator:narrator_say"],
      post_tool_model_step_required: true,
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: payload.requestId }),
      expect.objectContaining({ kind: "update_panel", panelId: "narrator" }),
    ]));
    expect(payload.suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: payload.requestId }),
      expect.objectContaining({ kind: "update_panel", panelId: "narrator" }),
    ]));
    expect(payload.dispatch.map((action: any) => action.kind)).not.toContain("speak_narrator");
    expect(payload.suggestedDispatch.map((action: any) => action.kind)).not.toContain("speak_narrator");

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "narrator",
      updateKind: "suggested_action",
    });
    const narratorUpdate = updates.find((update) => update.updateId === payload.goalContextUpdateId);
    expect(narratorUpdate).toMatchObject({
      contentRef: payload.requestId,
      toolIdentity: {
        requestedToolName: "live_env.narrator_say",
        canonicalToolName: "live_env.narrator_say",
        matchedAllowedActuators: [],
        matchedAllowedActuatorRefs: [],
      },
      freshness: expect.objectContaining({ status: "blocked" }),
      evidenceRefs: expect.arrayContaining([payload.requestId, "allowed_actuator:narrator_say", "translation_segment:latest"]),
      loopRefs: expect.arrayContaining(["workstation_actuator:narrator_say"]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(narratorUpdate?.suggestedDispatch.map((action) => action.kind)).not.toContain("speak_narrator");
  });

  it("prepares narrator stream bindings and blocks missing stream requirements", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: "source:browser-audio",
        goal_id: "goal:narrator-stream",
        objective: "Route translated transcript audio through Narrator.",
        context_feeds: [{ source_kind: "translation" }, { source_kind: "narrator" }],
        allowed_actuators: ["narrator_bind_stream", "query_translation_segments"],
      },
    });
    expect(sessionObservation.ok).toBe(true);
    const initialNarratorCheckpointCount = ((sessionObservation.observation as any).session.checkpoints ?? []).length;

    const prepared = executeLiveEnvironmentTool({
      tool_name: "live_env.narrator_bind_stream",
      thread_id: threadId,
      args: {
        goal_id: "goal:narrator-stream",
        source_ref: "source:browser-audio",
        stream_kind: "translated_transcript",
        delivery_mode: "visible_only",
        voice_policy: "confirm_speak_required",
      },
    });
    const preparedPayload = prepared.observation as any;
    expect(prepared).toMatchObject({
      tool_name: "live_env.narrator_bind_stream",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(preparedPayload).toMatchObject({
      schema: "helix.narrator_bind_stream_request.v1",
      streamKind: "translated_transcript",
      sourceRef: "source:browser-audio",
      sourceRefs: expect.arrayContaining(["source:browser-audio", "translated_transcript"]),
      loopRefs: expect.arrayContaining(["narrator:bind_stream", "workstation_actuator:narrator_bind_stream"]),
      evidenceRefs: expect.arrayContaining([
        preparedPayload.requestId,
        "source:browser-audio",
        "allowed_actuator:narrator_bind_stream",
        "agent_goal_allowed_actuator:narrator_bind_stream",
      ]),
      producedRefs: expect.arrayContaining([preparedPayload.requestId, preparedPayload.goalContextUpdateId]),
      deliveryMode: "visible_only",
      voicePolicy: "confirm_speak_required",
      matchedAllowedActuators: ["narrator_bind_stream"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:narrator_bind_stream"],
      policyEvidenceRefs: expect.arrayContaining([
        "allowed_actuator:narrator_bind_stream",
        "agent_goal_allowed_actuator:narrator_bind_stream",
      ]),
      contractValid: true,
      contractValidationIssues: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(preparedPayload.agentGoalSession).toMatchObject({
      goalId: "goal:narrator-stream",
      contextFeeds: expect.arrayContaining([
        expect.objectContaining({ sourceKind: "translated_transcripts" }),
        expect.objectContaining({ sourceKind: "narrator_events" }),
      ]),
      checkpoints: expect.arrayContaining([
        expect.objectContaining({
          summary: "Prepared narrator translated_transcript binding for this goal session.",
          actionsTaken: expect.arrayContaining(["narrator_bind_stream", "live_env.narrator_bind_stream"]),
          evidenceRefs: expect.arrayContaining([preparedPayload.goalContextUpdateId, preparedPayload.requestId]),
          nextStep: "continue",
        }),
      ]),
      authority: hardenedGoalSessionAuthority(),
    });
    expect(preparedPayload.agentGoalSession.checkpoints).toHaveLength(initialNarratorCheckpointCount + 1);
    expect(preparedPayload.evidenceRefs).toContain(preparedPayload.goalContextUpdateId);
    expect(preparedPayload.evidence_refs).toContain(preparedPayload.goalContextUpdateId);
    expect(preparedPayload.dispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: preparedPayload.requestId }),
      expect.objectContaining({ kind: "bind_narrator_stream", sourceRef: "source:browser-audio", streamKind: "translated_transcript" }),
      expect.objectContaining({ kind: "speak_narrator", mode: "visible_only" }),
    ]));
    expect(preparedPayload.suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "log_receipt", receiptRef: preparedPayload.requestId }),
      expect.objectContaining({ kind: "bind_narrator_stream", sourceRef: "source:browser-audio", streamKind: "translated_transcript" }),
      expect.objectContaining({ kind: "speak_narrator", mode: "visible_only" }),
    ]));
    const storedNarratorSession = listStagePlayAgentGoalSessions({
      threadId,
      goalId: "goal:narrator-stream",
      limit: 1,
    })[0];
    expect(storedNarratorSession?.checkpoints.at(-1)).toMatchObject({
      summary: "Prepared narrator translated_transcript binding for this goal session.",
      actionsTaken: expect.arrayContaining(["narrator_bind_stream", "live_env.narrator_bind_stream"]),
      evidenceRefs: expect.arrayContaining([preparedPayload.goalContextUpdateId, preparedPayload.requestId]),
    });

    const blocked = executeLiveEnvironmentTool({
      tool_name: "live_env.narrator_bind_stream",
      thread_id: threadId,
      args: {
        source_ref: "source:browser-audio",
      },
    });
    const blockedPayload = blocked.observation as any;
    expect(blocked.ok).toBe(false);
    expect(blockedPayload).toMatchObject({
      schema: "helix.narrator_bind_stream_request.v1",
      status: "blocked",
      missingRequirements: ["stream_kind"],
      contractValid: false,
      contractValidationIssues: ["streamKind is invalid"],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      terminal_eligible: false,
      assistant_answer: false,
    });
    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "narrator",
      updateKind: "suggested_action",
    });
    const preparedUpdate = updates.find((update) => update.updateId === preparedPayload.goalContextUpdateId);
    expect(preparedUpdate).toMatchObject({
      contentRef: preparedPayload.requestId,
      toolIdentity: {
        requestedToolName: "live_env.narrator_bind_stream",
        canonicalToolName: "live_env.narrator_bind_stream",
        matchedAllowedActuators: ["narrator_bind_stream"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:narrator_bind_stream"],
      },
      evidenceRefs: expect.arrayContaining([
        preparedPayload.requestId,
        "allowed_actuator:narrator_bind_stream",
        "agent_goal_allowed_actuator:narrator_bind_stream",
      ]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(updates.map((update) => update.freshness.status)).toEqual(expect.arrayContaining(["fresh", "blocked"]));
  });

  it("accepts narrator.bind_stream as a public alias while preserving goal-session authorization", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: "source:browser-audio",
        goal_id: "goal:narrator-stream-alias",
        objective: "Route translated transcript audio through Narrator using the public alias.",
        context_feeds: [{ source_kind: "translation" }, { source_kind: "narrator" }],
        allowed_actuators: ["narrator_bind_stream", "query_translation_segments"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "narrator.bind_stream",
      thread_id: threadId,
      args: {
        goal_id: "goal:narrator-stream-alias",
        source_ref: "source:browser-audio",
        stream_kind: "translated_transcript",
        delivery_mode: "visible_only",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.narrator_bind_stream",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload).toMatchObject({
      schema: "helix.narrator_bind_stream_request.v1",
      requestedToolName: "narrator.bind_stream",
      canonicalToolName: "live_env.narrator_bind_stream",
      goalId: "goal:narrator-stream-alias",
      requiredActuator: "narrator_bind_stream",
      actuatorAllowed: true,
      matchedAllowedActuators: ["narrator_bind_stream"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:narrator_bind_stream"],
      streamKind: "translated_transcript",
      sourceRef: "source:browser-audio",
      policyEvidenceRefs: expect.arrayContaining([
        "allowed_actuator:narrator_bind_stream",
        "agent_goal_allowed_actuator:narrator_bind_stream",
      ]),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining([
        "narrator_bind_stream",
        "live_env.narrator_bind_stream",
        "narrator.bind_stream",
      ]),
    });
  });

  it("accepts narrator_bind_stream as an advertised alias while preserving goal-session authorization", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: "source:browser-audio",
        goal_id: "goal:narrator-stream-underscore-alias",
        objective: "Route translated transcript audio through Narrator using the underscore alias.",
        context_feeds: [{ source_kind: "translation" }, { source_kind: "narrator" }],
        allowed_actuators: ["narrator_bind_stream", "query_translation_segments"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "narrator_bind_stream",
      thread_id: threadId,
      args: {
        goal_id: "goal:narrator-stream-underscore-alias",
        source_ref: "source:browser-audio",
        stream_kind: "translated_transcript",
        delivery_mode: "visible_only",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.narrator_bind_stream",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload).toMatchObject({
      schema: "helix.narrator_bind_stream_request.v1",
      requestedToolName: "narrator_bind_stream",
      canonicalToolName: "live_env.narrator_bind_stream",
      goalId: "goal:narrator-stream-underscore-alias",
      requiredActuator: "narrator_bind_stream",
      actuatorAllowed: true,
      matchedAllowedActuators: ["narrator_bind_stream"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:narrator_bind_stream"],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining([
        "narrator_bind_stream",
        "live_env.narrator_bind_stream",
        "narrator_bind_stream",
      ]),
    });
  });

  it("queries narrator stream events through goal-scoped workstation context", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: "source:browser-audio",
        goal_id: "goal:narrator-context-query",
        objective: "Monitor translated transcript routing through Narrator.",
        context_feeds: [{ source_kind: "translation" }, { source_kind: "narrator" }],
        allowed_actuators: ["narrator_bind_stream", "query_translation_segments", "query_narrator_events"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const prepared = executeLiveEnvironmentTool({
      tool_name: "live_env.narrator_bind_stream",
      thread_id: threadId,
      args: {
        goal_id: "goal:narrator-context-query",
        source_ref: "source:browser-audio",
        stream_kind: "translated_transcript",
        delivery_mode: "visible_only",
        voice_policy: "confirm_speak_required",
      },
    });
    const preparedPayload = prepared.observation as any;
    expect(prepared.ok).toBe(true);

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_narrator_events",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: "source:browser-audio",
        goal_id: "goal:narrator-context-query",
      },
    });
    const queryPayload = queryObservation.observation as any;

    expect(queryObservation).toMatchObject({
      tool_name: "live_env.query_narrator_events",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      contractValid: true,
      contractValidationIssues: [],
      feedKind: "narrator_events",
      requiredActuator: "query_narrator_events",
      matchedContextFeeds: [
        expect.objectContaining({
          sourceKind: "narrator_events",
        }),
      ],
      matchedContextFeedRefs: [expect.stringMatching(/^agent_goal_feed:/)],
      matchedAllowedActuators: ["query_narrator_events"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_narrator_events"],
      policyEvidenceRefs: expect.arrayContaining([
        "context_feed:narrator_events",
        "allowed_actuator:query_narrator_events",
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_narrator_events",
      ]),
      evidenceRefs: expect.arrayContaining([
        expect.stringMatching(/^stage_play_goal_context_update:/),
        expect.stringMatching(/^agent_goal_feed:/),
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_narrator_events",
      ]),
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(queryPayload.evidenceRefs).toContain(queryPayload.goalContextUpdateId);
    expect(queryPayload.goalContextUpdates).toEqual([
      expect.objectContaining({
        updateId: preparedPayload.goalContextUpdateId,
        producerKind: "narrator",
        updateKind: "suggested_action",
        contentRef: preparedPayload.requestId,
        goalRelevance: expect.objectContaining({
          goalId: "goal:narrator-context-query",
          reason: "Narrator stream binding was prepared for the active workstation goal.",
        }),
        sourceRefs: expect.arrayContaining(["source:browser-audio", "translated_transcript"]),
        evidenceRefs: expect.arrayContaining([
          preparedPayload.requestId,
          "allowed_actuator:narrator_bind_stream",
          "source:browser-audio",
        ]),
        loopRefs: expect.arrayContaining([
          "workstation_context_feed:narrator_events",
          "workstation_actuator:narrator_bind_stream",
        ]),
        receiptRefs: [preparedPayload.requestId],
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]);
    expect(queryPayload.packetCircuitRefs).toEqual([
      expect.objectContaining({
        updateId: preparedPayload.goalContextUpdateId,
        contentRef: preparedPayload.requestId,
        narratorRefs: expect.arrayContaining([
          preparedPayload.requestId,
          "narrator:bind_stream",
          "workstation_context_feed:narrator_events",
          "workstation_actuator:narrator_bind_stream",
        ]),
        actuatorRefs: expect.arrayContaining([
          "workstation_actuator:query_narrator_events",
          "workstation_actuator:narrator_bind_stream",
        ]),
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
    ]);
    const queryUpdate = listStagePlayGoalContextUpdates({
      threadId,
      contentRef: queryPayload.resultId,
      limit: 1,
    })[0];
    expect(queryUpdate).toMatchObject({
      producerKind: "route_watch",
      updateKind: "route_evidence",
      toolIdentity: {
        requestedToolName: "live_env.query_narrator_events",
        canonicalToolName: "live_env.query_narrator_events",
        matchedAllowedActuators: ["query_narrator_events"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_narrator_events"],
      },
      evidenceRefs: expect.arrayContaining(["context_feed:narrator_events", "allowed_actuator:query_narrator_events"]),
      loopRefs: expect.arrayContaining(["workstation_context_feed:narrator_events", "workstation_actuator:query_narrator_events"]),
    });
    expect(queryPayload.agentGoalSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        goalId: "goal:narrator-context-query",
        contextFeeds: expect.arrayContaining([
          expect.objectContaining({ sourceKind: "translated_transcripts" }),
          expect.objectContaining({ sourceKind: "narrator_events" }),
        ]),
        allowedActuators: expect.arrayContaining(["query_narrator_events"]),
        loopRefs: expect.arrayContaining(["workstation_context_feed:narrator_events", "workstation_actuator:query_narrator_events"]),
      }),
    ]));
    expect(queryPayload.authoritySummary).toMatchObject({
      updateCount: 1,
      observationOnlyUpdateCount: 1,
      assistantAnswerCount: 0,
      terminalEligibleCount: 0,
      rawContentIncludedCount: 0,
      postToolModelStepRequiredCount: 1,
      activeGoalSessionCount: 1,
      answerAuthority: "completed_solver_path_required",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      post_tool_model_step_required: true,
    });
  });

  it("records source health queries as durable non-terminal goal-context updates", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_source_health",
      thread_id: threadId,
      args: {
        room_id: roomId,
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.query_source_health",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.situation_source_capability_read.v1",
      contractValid: true,
      contractValidationIssues: [],
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:source_health:/),
      policyEvidenceRefs: ["context_feed:source_health", "allowed_actuator:query_source_health"],
      sourceRefs: expect.any(Array),
      loopRefs: expect.arrayContaining(["workstation_context_feed:source_health", "workstation_actuator:query_source_health"]),
      sourceHealthRefs: expect.arrayContaining(["workstation_context_feed:source_health", "workstation_actuator:query_source_health"]),
      evidenceRefs: expect.arrayContaining([
        "context_feed:source_health",
        "allowed_actuator:query_source_health",
      ]),
      freshnessStatus: expect.stringMatching(/^(fresh|stale|blocked|unknown)$/),
      capabilityCount: expect.any(Number),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(payload.evidenceRefs).toContain(payload.goalContextUpdateId);
    expect(payload.evidence_refs).toContain(payload.goalContextUpdateId);
    const payloadEvidenceRefsForUpdate = payload.evidenceRefs.filter(
      (ref: string) => ref !== payload.goalContextUpdateId,
    );

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "source_health",
      updateKind: "source_status",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      updateId: payload.goalContextUpdateId,
      producerKind: "source_health",
      updateKind: "source_status",
      toolIdentity: {
        requestedToolName: "live_env.query_source_health",
        canonicalToolName: "live_env.query_source_health",
        matchedAllowedActuators: [],
        matchedAllowedActuatorRefs: [],
      },
      evidenceRefs: expect.arrayContaining(payloadEvidenceRefsForUpdate),
      loopRefs: expect.arrayContaining(["workstation_context_feed:source_health", "workstation_actuator:query_source_health"]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(updates[0].suggestedDispatch.map((action) => action.kind)).toEqual(expect.arrayContaining([
      "log_receipt",
      "update_panel",
    ]));
    expect(observation.evidence_refs).toEqual(expect.arrayContaining([
      payload.goalContextUpdateId,
      payload.resultId,
      "context_feed:source_health",
      "allowed_actuator:query_source_health",
    ]));
    expect(observation.evidence_refs).toEqual(expect.arrayContaining(payload.evidenceRefs));
    expect(observation.producedRefs).toEqual(expect.arrayContaining([
      payload.goalContextUpdateId,
      payload.resultId,
    ]));
  });

  it("appends agent goal session checkpoints when querying allowed source health", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:source-health-watch",
        objective: "Track source health while monitoring workstation loops.",
        context_feeds: ["source_health"],
        allowed_actuators: ["query_source_health"],
      },
    });
    expect(sessionObservation.ok).toBe(true);
    const initialCheckpointCount = ((sessionObservation.observation as any).session.checkpoints ?? []).length;

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_source_health",
      thread_id: threadId,
      args: {
        room_id: roomId,
        goal_id: "goal:source-health-watch",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.query_source_health",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.situation_source_capability_read.v1",
      contractValid: true,
      contractValidationIssues: [],
      status: "read",
      goalId: "goal:source-health-watch",
      goalSessionFound: true,
      feedAllowed: true,
      actuatorAllowed: true,
      requiredActuator: "query_source_health",
      matchedAllowedActuators: ["query_source_health"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_source_health"],
      matchedContextFeeds: [
        expect.objectContaining({
          sourceKind: "source_health",
        }),
      ],
      matchedContextFeedRefs: [expect.stringMatching(/^agent_goal_feed:/)],
      policyEvidenceRefs: expect.arrayContaining([
        "context_feed:source_health",
        "allowed_actuator:query_source_health",
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_source_health",
      ]),
      sourceRefs: expect.any(Array),
      loopRefs: expect.arrayContaining(["workstation_context_feed:source_health", "workstation_actuator:query_source_health"]),
      evidenceRefs: expect.arrayContaining([
        payload.resultId,
        "context_feed:source_health",
        "allowed_actuator:query_source_health",
        expect.stringMatching(/^agent_goal_feed:/),
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_source_health",
      ]),
      freshnessStatus: expect.stringMatching(/^(fresh|stale|blocked|unknown)$/),
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:source_health:/),
      capabilityCount: expect.any(Number),
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      agentGoalSession: expect.objectContaining({
        goalId: "goal:source-health-watch",
        authority: hardenedGoalSessionAuthority(),
      }),
    });
    expect(payload.agentGoalSession.checkpoints).toHaveLength(initialCheckpointCount + 1);
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: expect.stringMatching(/^Queried source health and read \d+ capability state\(s\) for this goal session\.$/),
      actionsTaken: expect.arrayContaining(["query_source_health", "live_env.query_source_health"]),
      evidenceRefs: expect.arrayContaining([
        payload.goalContextUpdateId,
        payload.resultId,
        "context_feed:source_health",
        "allowed_actuator:query_source_health",
        expect.stringMatching(/^agent_goal_feed:/),
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_source_health",
      ]),
    });
    expect(observation.evidence_refs).toEqual(expect.arrayContaining([
      payload.goalContextUpdateId,
      payload.resultId,
      "context_feed:source_health",
      "allowed_actuator:query_source_health",
      "agent_goal_allowed_actuator:query_source_health",
    ]));
    expect(observation.producedRefs).toEqual(expect.arrayContaining([
      payload.goalContextUpdateId,
      payload.resultId,
    ]));

    const storedSession = listStagePlayAgentGoalSessions({
      threadId,
      goalId: "goal:source-health-watch",
      limit: 1,
    })[0];
    expect(storedSession?.checkpoints).toHaveLength(initialCheckpointCount + 1);
    expect(storedSession?.checkpoints.at(-1)).toMatchObject({
      actionsTaken: expect.arrayContaining(["query_source_health", "live_env.query_source_health"]),
      evidenceRefs: expect.arrayContaining([payload.goalContextUpdateId]),
    });
  });

  it("keeps implicit goal-scoped source-health queries inside the AgentGoalSession source boundary", () => {
    const unrelatedSourceId = "visual_source:source-health-unrelated";
    startVisualSnapshotSource({
      source_id: sourceId,
      thread_id: threadId,
      room_id: roomId,
      source_surface: "browser_tab",
      capture_mode: "interval",
      status: "active",
    });
    recordVisualFrame({
      source_id: sourceId,
      thread_id: threadId,
      room_id: roomId,
      frame_id: "visual_frame:source-health-boundary-target",
      ts: "2026-06-17T16:00:00.000Z",
    });
    startVisualSnapshotSource({
      source_id: unrelatedSourceId,
      thread_id: threadId,
      room_id: roomId,
      source_surface: "browser_tab",
      capture_mode: "interval",
      status: "active",
    });
    recordVisualFrame({
      source_id: unrelatedSourceId,
      thread_id: threadId,
      room_id: roomId,
      frame_id: "visual_frame:source-health-boundary-unrelated",
      ts: "2026-06-17T16:00:01.000Z",
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:source-health-boundary",
        objective: "Inspect only the source health attached to this visual goal.",
        context_feeds: ["source_health"],
        allowed_actuators: ["query_source_health"],
      },
    });
    expect(sessionObservation.ok).toBe(true);
    const initialCheckpointCount = ((sessionObservation.observation as any).session.checkpoints ?? []).length;

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_source_health",
      thread_id: threadId,
      args: {
        room_id: roomId,
        goal_id: "goal:source-health-boundary",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.query_source_health",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.situation_source_capability_read.v1",
      contractValid: true,
      contractValidationIssues: [],
      status: "read",
      goalId: "goal:source-health-boundary",
      feedAllowed: true,
      actuatorAllowed: true,
      requiredActuator: "query_source_health",
      matchedAllowedActuators: ["query_source_health"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_source_health"],
      capabilityCount: 1,
      sourceRefs: [sourceId],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(payload.capabilities.map((capability: any) => capability.source_id)).toEqual([sourceId]);
    expect(payload.capabilities.map((capability: any) => capability.source_id)).not.toContain(unrelatedSourceId);
    expect(payload.evidenceRefs).toEqual(expect.arrayContaining([
      payload.resultId,
      "context_feed:source_health",
      "allowed_actuator:query_source_health",
      "agent_goal_allowed_actuator:query_source_health",
      sourceId,
      `source_health:${sourceId}`,
    ]));
    expect(payload.evidenceRefs).not.toContain(unrelatedSourceId);
    expect(payload.evidenceRefs).not.toContain(`source_health:${unrelatedSourceId}`);
    expect(payload.agentGoalSession.checkpoints).toHaveLength(initialCheckpointCount + 1);
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: "Queried source health and read 1 capability state(s) for this goal session.",
      actionsTaken: expect.arrayContaining(["query_source_health", "live_env.query_source_health"]),
      evidenceRefs: expect.arrayContaining([
        payload.goalContextUpdateId,
        payload.resultId,
        sourceId,
        `source_health:${sourceId}`,
      ]),
      nextStep: "repair",
    });
  });

  it("blocks source health queries outside an explicit goal session context-feed policy", () => {
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:no-source-health",
        objective: "Inspect visual summaries without source-health feed access.",
        context_feeds: ["visual_summaries"],
        allowed_actuators: ["query_source_health", "query_visual_summaries"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_source_health",
      thread_id: threadId,
      args: {
        room_id: roomId,
        goal_id: "goal:no-source-health",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.query_source_health",
      ok: false,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.situation_source_capability_read.v1",
      contractValid: true,
      contractValidationIssues: [],
      status: "blocked",
      goalId: "goal:no-source-health",
      goalSessionFound: true,
      feedAllowed: false,
      actuatorAllowed: true,
      matchedAllowedActuators: ["query_source_health"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_source_health"],
      matchedContextFeeds: [],
      matchedContextFeedRefs: [],
      missingRequirements: ["context_feed:source_health"],
      policyEvidenceRefs: expect.arrayContaining([
        "context_feed:source_health",
        "allowed_actuator:query_source_health",
        "agent_goal_allowed_actuator:query_source_health",
      ]),
      sourceRefs: [threadId],
      loopRefs: expect.arrayContaining(["workstation_context_feed:source_health", "workstation_actuator:query_source_health"]),
      evidenceRefs: expect.arrayContaining([
        payload.resultId,
        threadId,
        "context_feed:source_health",
        "allowed_actuator:query_source_health",
        "agent_goal_allowed_actuator:query_source_health",
      ]),
      freshnessStatus: "blocked",
      capabilities: [],
      capabilityCount: 0,
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:source_health:/),
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(payload.evidenceRefs).toContain(payload.goalContextUpdateId);
    expect(payload.evidence_refs).toContain(payload.goalContextUpdateId);

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "source_health",
      updateKind: "source_status",
    });
    const sourceHealthUpdate = updates.find((update) => update.updateId === payload.goalContextUpdateId);
    expect(sourceHealthUpdate).toMatchObject({
      contentRef: expect.stringMatching(/^stage_play_source_health:/),
      freshness: expect.objectContaining({ status: "blocked" }),
      evidenceRefs: expect.arrayContaining(
        payload.evidenceRefs.filter((ref: string) => ref !== payload.goalContextUpdateId),
      ),
      loopRefs: expect.arrayContaining(["workstation_context_feed:source_health", "workstation_actuator:query_source_health"]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(sourceHealthUpdate?.suggestedDispatch.map((action) => action.kind)).not.toContain("repair_loop");
    expect(observation.evidence_refs).toEqual(expect.arrayContaining([
      payload.goalContextUpdateId,
      payload.resultId,
      "context_feed:source_health",
      "allowed_actuator:query_source_health",
      "agent_goal_allowed_actuator:query_source_health",
    ]));
    expect(observation.evidence_refs).toEqual(expect.arrayContaining(payload.evidenceRefs));
    expect(observation.producedRefs).toEqual(expect.arrayContaining([
      payload.goalContextUpdateId,
      payload.resultId,
    ]));
  });

  it("records current live-source state queries as Live Answer goal-context updates", () => {
    seedVisualSummaryText("Live Answer compact state shows a frog photo in ImageLens.", "current-state");

    executeLiveEnvironmentTool({
      tool_name: "live_env.check_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.summarize_live_source_current_state",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.summarize_live_source_current_state",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schemaVersion: "stage_play_live_source_current_state/v1",
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:live_answer:/),
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
    });

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      sourceRef: sourceId,
      producerKind: "live_answer",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      updateId: payload.goalContextUpdateId,
      contentRef: payload.currentStateId,
      producerKind: "live_answer",
      updateKind: "summary",
      toolIdentity: {
        requestedToolName: "live_env.summarize_live_source_current_state",
        canonicalToolName: "live_env.summarize_live_source_current_state",
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
    expect(updates[0].suggestedDispatch.map((action) => action.kind)).toEqual(expect.arrayContaining([
      "log_receipt",
      "update_live_answer",
      "update_panel",
    ]));
    expect(observation.producedRefs).toEqual([payload.goalContextUpdateId]);
  });

  it("records Live Answer card reads as queryable non-terminal goal-context projection updates", () => {
    const liveAnswerSourceId = "visual_source:live-answer-card-read";
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:live-answer-card-read",
      objective: "Track the ImageLens frog classification card.",
      room_id: roomId,
      source_ids: [liveAnswerSourceId],
      preset: "custom",
      line_schema: [
        {
          key: "scene",
          label: "Scene",
          update_policy: "episode_based",
          visibility: "answer_card",
          priority: "info",
        },
        {
          key: "uncertainty",
          label: "Uncertainty",
          update_policy: "projection_only",
          visibility: "answer_card",
          priority: "warn",
        },
      ],
    });
    updateLiveAnswerEnvironment({
      environment_id: environment.environment_id,
      reason: "subgoal_update",
      line_values: {
        scene: {
          value: "ImageLens shows a frog on a green leaf.",
          confidence: 0.86,
          evidence_refs: ["visual_frame:frog-card"],
        },
      },
      latest_summary: "Live Answer card projected frog classification context.",
      evidence_refs: ["visual_frame:frog-card"],
      now: "2026-06-17T14:05:00.000Z",
    });

    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_card",
      thread_id: threadId,
      environment_id: environment.environment_id,
      args: {
        room_id: roomId,
        line_keys: ["scene"],
      },
    });

    const readPayload = readObservation.observation as any;
    expect(readObservation).toMatchObject({
      tool_name: "live_env.read_card",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(readPayload).toMatchObject({
      schema: "helix.live_environment_card_read.v1",
      resultId: expect.stringMatching(/^live_answer_card_read:/),
      environment_id: environment.environment_id,
      sourceRefs: expect.arrayContaining([
        environment.environment_id,
        liveAnswerSourceId,
        "live_answer_line:scene",
      ]),
      loopRefs: expect.arrayContaining([
        `live_answer_environment:${environment.environment_id}`,
        "workstation_context_feed:live_answer_lines",
        "workstation_actuator:query_live_answer_state",
      ]),
      evidenceRefs: expect.arrayContaining([
        "visual_frame:frog-card",
        environment.environment_id,
      ]),
      producedRefs: expect.arrayContaining([expect.stringMatching(/^live_answer_card_read:/)]),
      assistant_answer: false,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      raw_content_included: false,
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:live_answer:/),
    });
    expect(readPayload.evidenceRefs).toContain(readPayload.goalContextUpdateId);
    expect(readPayload.evidence_refs).toContain(readPayload.goalContextUpdateId);
    expect(readPayload.producedRefs).toEqual(expect.arrayContaining([
      readPayload.resultId,
      readPayload.goalContextUpdateId,
    ]));
    expect(readPayload.lines).toEqual([
      expect.objectContaining({
        key: "scene",
        label: "Scene",
        ui_summary_only: true,
        assistant_answer: false,
      }),
    ]);
    expect(readObservation.producedRefs).toEqual(expect.arrayContaining([
      readPayload.goalContextUpdateId,
    ]));

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      sourceRef: liveAnswerSourceId,
      producerKind: "live_answer",
      updateKind: "summary",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      updateId: readPayload.goalContextUpdateId,
      producerKind: "live_answer",
      updateKind: "summary",
      contentRef: expect.stringMatching(/^live_answer_card_read:/),
      toolIdentity: {
        requestedToolName: "live_env.read_card",
        canonicalToolName: "live_env.read_card",
        matchedAllowedActuators: [],
        matchedAllowedActuatorRefs: [],
      },
      sourceRefs: expect.arrayContaining([
        environment.environment_id,
        liveAnswerSourceId,
        "live_answer_line:scene",
      ]),
      evidenceRefs: expect.arrayContaining([
        environment.environment_id,
        "visual_frame:frog-card",
      ]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(updates[0].suggestedDispatch).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "update_live_answer", lineKey: "scene" }),
      expect.objectContaining({ kind: "update_panel", panelId: "live-answer-environment" }),
    ]));

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_live_answer_state",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: liveAnswerSourceId,
      },
    });
    const queryPayload = queryObservation.observation as any;
    expect(queryPayload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      feedKind: "live_answer_lines",
      updateCount: 1,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      post_tool_model_step_required: true,
    });
    expect(queryPayload.goalContextUpdates[0]).toMatchObject({
      updateId: readPayload.goalContextUpdateId,
      producerKind: "live_answer",
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(queryPayload.packetCircuitRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        updateId: readPayload.goalContextUpdateId,
        projectionRefs: expect.arrayContaining([
          "workstation_context_feed:live_answer_lines",
          "workstation_actuator:query_live_answer_state",
        ]),
        assistant_answer: false,
        terminal_eligible: false,
      }),
    ]));
  });

  it("appends goal checkpoints when reading Live Answer card lines through an allowed goal session", () => {
    const liveAnswerSourceId = "visual_source:live-answer-goal-card-read";
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:live-answer-goal-card-read",
      objective: "Track the frog card as goal-scoped Live Answer context.",
      room_id: roomId,
      source_ids: [liveAnswerSourceId],
      preset: "custom",
      line_schema: [
        {
          key: "scene",
          label: "Scene",
          update_policy: "episode_based",
          visibility: "answer_card",
          priority: "info",
        },
      ],
    });
    updateLiveAnswerEnvironment({
      environment_id: environment.environment_id,
      reason: "subgoal_update",
      line_values: {
        scene: {
          value: "ImageLens goal card shows a frog on a branch.",
          confidence: 0.87,
          evidence_refs: ["visual_frame:goal-frog-card"],
        },
      },
      latest_summary: "Goal-scoped Live Answer frog card is current.",
      evidence_refs: ["visual_frame:goal-frog-card"],
      now: "2026-06-17T14:15:00.000Z",
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: liveAnswerSourceId,
        goal_id: "goal:live-answer-card-read",
        objective: "Read Live Answer card projection lines for this visual source.",
        context_feeds: ["live_answer_lines"],
        allowed_actuators: ["query_live_answer_state"],
      },
    });
    expect(sessionObservation.ok).toBe(true);
    const initialCheckpointCount = ((sessionObservation.observation as any).session.checkpoints ?? []).length;

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_card",
      thread_id: threadId,
      environment_id: environment.environment_id,
      args: {
        room_id: roomId,
        goal_id: "goal:live-answer-card-read",
        line_keys: ["scene"],
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.read_card",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.live_environment_card_read.v1",
      resultId: expect.stringMatching(/^live_answer_card_read:/),
      status: "read",
      goalId: "goal:live-answer-card-read",
      feedAllowed: true,
      actuatorAllowed: true,
      requiredActuator: "query_live_answer_state",
      matchedAllowedActuators: ["query_live_answer_state"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_live_answer_state"],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.evidenceRefs).toContain(payload.goalContextUpdateId);
    expect(payload.evidence_refs).toContain(payload.goalContextUpdateId);
    expect(payload.producedRefs).toEqual(expect.arrayContaining([
      payload.resultId,
      payload.goalContextUpdateId,
    ]));
    expect(payload.lines).toEqual([
      expect.objectContaining({
        key: "scene",
        ui_summary_only: true,
        assistant_answer: false,
      }),
    ]);
    expect(payload.policyEvidenceRefs).toEqual(expect.arrayContaining([
      "context_feed:live_answer_lines",
      "allowed_actuator:query_live_answer_state",
      expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
      "agent_goal_allowed_actuator:query_live_answer_state",
    ]));
    expect(payload.agentGoalSession.checkpoints).toHaveLength(initialCheckpointCount + 1);
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: "Read 1 Live Answer projection line(s) for this goal session.",
      actionsTaken: expect.arrayContaining(["query_live_answer_state", "live_env.read_card"]),
      evidenceRefs: expect.arrayContaining([
        payload.goalContextUpdateId,
        "visual_frame:goal-frog-card",
        environment.environment_id,
      ]),
      nextStep: "continue",
    });

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      goalId: "goal:live-answer-card-read",
      sourceRef: liveAnswerSourceId,
      producerKind: "live_answer",
      updateKind: "summary",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      updateId: payload.goalContextUpdateId,
      toolIdentity: {
        requestedToolName: "live_env.read_card",
        canonicalToolName: "live_env.read_card",
        matchedAllowedActuators: ["query_live_answer_state"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_live_answer_state"],
      },
      goalRelevance: expect.objectContaining({
        goalId: "goal:live-answer-card-read",
      }),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
  });

  it("blocks goal-scoped Live Answer card reads outside the goal session feed policy", () => {
    const liveAnswerSourceId = "visual_source:live-answer-card-read-blocked";
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:live-answer-card-read-blocked",
      objective: "Keep Live Answer card outside this visual-only goal.",
      room_id: roomId,
      source_ids: [liveAnswerSourceId],
      preset: "custom",
      line_schema: [
        {
          key: "scene",
          label: "Scene",
          update_policy: "episode_based",
          visibility: "answer_card",
          priority: "info",
        },
      ],
    });
    updateLiveAnswerEnvironment({
      environment_id: environment.environment_id,
      reason: "subgoal_update",
      line_values: {
        scene: {
          value: "This Live Answer card should not enter the visual-only goal.",
          confidence: 0.77,
          evidence_refs: ["visual_frame:block-live-answer-card"],
        },
      },
      evidence_refs: ["visual_frame:block-live-answer-card"],
      now: "2026-06-17T14:18:00.000Z",
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: liveAnswerSourceId,
        goal_id: "goal:live-answer-card-blocked",
        objective: "Inspect visual summaries only, not Live Answer card state.",
        context_feeds: ["visual_summaries"],
        allowed_actuators: ["query_live_answer_state"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_card",
      thread_id: threadId,
      environment_id: environment.environment_id,
      args: {
        room_id: roomId,
        goal_id: "goal:live-answer-card-blocked",
        line_keys: ["scene"],
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.read_card",
      ok: false,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.live_environment_card_read.v1",
      resultId: expect.stringMatching(/^live_answer_card_read:/),
      status: "blocked",
      goalId: "goal:live-answer-card-blocked",
      missingRequirements: ["context_feed:live_answer_lines"],
      feedAllowed: false,
      actuatorAllowed: true,
      lines: [],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.evidenceRefs).toContain(payload.goalContextUpdateId);
    expect(payload.evidence_refs).toContain(payload.goalContextUpdateId);
    expect(payload.producedRefs).toEqual(expect.arrayContaining([
      payload.resultId,
      payload.goalContextUpdateId,
    ]));
    expect(payload.policyEvidenceRefs).toEqual(expect.arrayContaining([
      "context_feed:live_answer_lines",
      "allowed_actuator:query_live_answer_state",
      "agent_goal_allowed_actuator:query_live_answer_state",
    ]));
    expect(observation.evidence_refs).not.toContain("visual_frame:block-live-answer-card");

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      goalId: "goal:live-answer-card-blocked",
      producerKind: "live_answer",
      updateKind: "error",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      updateId: payload.goalContextUpdateId,
      freshness: expect.objectContaining({ status: "blocked" }),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(updates[0].suggestedDispatch.map((action) => action.kind)).not.toContain("append_goal_context");
  });

  it("queries compact trace memory and records trace-memory goal context", () => {
    const trace = recordWorkstationReasoningTrace({
      schema: "helix.workstation_reasoning_trace.v1",
      trace_id: "workstation_trace:hotbar-total",
      thread_id: threadId,
      turn_id: "turn:hotbar-total",
      source_family: "multimodal",
      user_goal: "Add visible hotbar item counts.",
      route_reason_code: "visual_to_calculator",
      input_item_refs: ["visual_evidence:hotbar"],
      evidence_refs: ["visual_evidence:hotbar", "derived_equation:hotbar"],
      tool_receipt_ids: ["calculator_receipt:hotbar"],
      lifecycle_event_refs: ["tool_lifecycle:hotbar"],
      artifacts: {
        visual_extraction_id: "visual_extraction:hotbar",
        derived_equation_id: "derived_equation:hotbar",
        workstation_tool_evaluation_id: "workstation-tool-eval:hotbar",
        terminal_authority_hash: "hash:hotbar-total",
      },
      requested_extraction_scope: "hotbar",
      actual_extraction_scope: "hotbar",
      scope_match: "exact",
      proof_status: "complete",
      compact_steps: [
        {
          label: "Visual extraction",
          summary: "Extracted compact hotbar counts.",
          artifact_ref: "visual_extraction:hotbar",
          status: "completed",
        },
        {
          label: "Calculator",
          summary: "Added 64 + 12 + 3.",
          artifact_ref: "calculator_receipt:hotbar",
          status: "completed",
        },
      ],
      caveats: [],
      final_answer_snapshot: "The hotbar total is 79.",
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
      created_at: "2026-06-17T15:00:00.000Z",
    });

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_trace_memory",
      thread_id: threadId,
      args: {
        trace_id: trace.trace_id,
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.query_trace_memory",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.workstation_reasoning_trace_query_result.v1",
      contractValid: true,
      contractValidationIssues: [],
      trace_id: trace.trace_id,
      trace_count: 1,
      selectedTrace: {
        trace_id: trace.trace_id,
        assistant_answer: false,
        raw_content_included: false,
      },
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:trace_memory:/),
      policyEvidenceRefs: ["context_feed:trace_memory", "allowed_actuator:query_trace_memory"],
      sourceRefs: expect.arrayContaining([threadId, "multimodal", trace.trace_id]),
      loopRefs: expect.arrayContaining([
        payload.resultId,
        "workstation_context_feed:trace_memory",
        "workstation_actuator:query_trace_memory",
        trace.turn_id,
        "tool_lifecycle:hotbar",
      ]),
      evidenceRefs: expect.arrayContaining([
        payload.resultId,
        "context_feed:trace_memory",
        "allowed_actuator:query_trace_memory",
        threadId,
        trace.trace_id,
        "visual_evidence:hotbar",
        "derived_equation:hotbar",
        "calculator_receipt:hotbar",
        "tool_lifecycle:hotbar",
      ]),
      freshnessStatus: "fresh",
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(payload.evidenceRefs).toContain(payload.goalContextUpdateId);
    expect(payload.evidence_refs).toContain(payload.goalContextUpdateId);
    const payloadEvidenceRefsForUpdate = payload.evidenceRefs.filter(
      (ref: string) => ref !== payload.goalContextUpdateId,
    );

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "trace_memory",
      updateKind: "route_evidence",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      updateId: payload.goalContextUpdateId,
      contentRef: payload.resultId,
      producerKind: "trace_memory",
      updateKind: "route_evidence",
      toolIdentity: {
        requestedToolName: "live_env.query_trace_memory",
        canonicalToolName: "live_env.query_trace_memory",
        matchedAllowedActuators: [],
        matchedAllowedActuatorRefs: [],
      },
      evidenceRefs: expect.arrayContaining(payloadEvidenceRefsForUpdate),
      loopRefs: expect.arrayContaining(["workstation_context_feed:trace_memory", "workstation_actuator:query_trace_memory"]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(updates[0].suggestedDispatch.map((action) => action.kind)).toEqual(expect.arrayContaining([
      "log_receipt",
      "append_goal_context",
      "update_panel",
    ]));
    expect(observation.producedRefs).toEqual(expect.arrayContaining([
      payload.resultId,
      payload.goalContextUpdateId,
      trace.trace_id,
    ]));
    expect(observation.evidence_refs).toEqual(expect.arrayContaining(payload.evidenceRefs));
  });

  it("appends agent goal session checkpoints when querying allowed trace memory", () => {
    const trace = recordWorkstationReasoningTrace({
      schema: "helix.workstation_reasoning_trace.v1",
      trace_id: "workstation_trace:goal-memory",
      thread_id: threadId,
      turn_id: "turn:goal-memory",
      source_family: "multimodal",
      user_goal: "Reuse prior visual reasoning as compact context.",
      route_reason_code: "visual_to_calculator",
      input_item_refs: ["visual_evidence:goal-memory"],
      evidence_refs: ["visual_evidence:goal-memory", "derived_equation:goal-memory"],
      tool_receipt_ids: ["calculator_receipt:goal-memory"],
      lifecycle_event_refs: ["tool_lifecycle:goal-memory"],
      artifacts: {
        visual_extraction_id: "visual_extraction:goal-memory",
        derived_equation_id: "derived_equation:goal-memory",
      },
      requested_extraction_scope: "hotbar",
      actual_extraction_scope: "hotbar",
      scope_match: "exact",
      proof_status: "complete",
      compact_steps: [
        {
          label: "Visual extraction",
          summary: "Captured compact prior reasoning for goal context.",
          artifact_ref: "visual_extraction:goal-memory",
          status: "completed",
        },
      ],
      caveats: [],
      final_answer_snapshot: "Prior compact trace remains observation-only.",
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
      created_at: "2026-06-17T15:02:00.000Z",
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:trace-memory-watch",
        objective: "Use compact trace memory while monitoring visual reasoning.",
        context_feeds: ["trace_memory"],
        allowed_actuators: ["query_trace_memory"],
      },
    });
    expect(sessionObservation.ok).toBe(true);
    const initialCheckpointCount = ((sessionObservation.observation as any).session.checkpoints ?? []).length;

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_trace_memory",
      thread_id: threadId,
      args: {
        goal_id: "goal:trace-memory-watch",
        trace_id: trace.trace_id,
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.query_trace_memory",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.workstation_reasoning_trace_query_result.v1",
      contractValid: true,
      contractValidationIssues: [],
      trace_id: trace.trace_id,
      trace_count: 1,
      status: "read",
      goalId: "goal:trace-memory-watch",
      feedAllowed: true,
      actuatorAllowed: true,
      requiredActuator: "query_trace_memory",
      matchedAllowedActuators: ["query_trace_memory"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_trace_memory"],
      matchedContextFeeds: [
        expect.objectContaining({
          sourceKind: "trace_memory",
        }),
      ],
      matchedContextFeedRefs: [expect.stringMatching(/^agent_goal_feed:/)],
      policyEvidenceRefs: expect.arrayContaining([
        "context_feed:trace_memory",
        "allowed_actuator:query_trace_memory",
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_trace_memory",
      ]),
      sourceRefs: expect.arrayContaining([threadId, "multimodal", trace.trace_id]),
      loopRefs: expect.arrayContaining([
        payload.resultId,
        "workstation_context_feed:trace_memory",
        "workstation_actuator:query_trace_memory",
        trace.turn_id,
        "tool_lifecycle:goal-memory",
      ]),
      evidenceRefs: expect.arrayContaining([
        payload.resultId,
        "context_feed:trace_memory",
        "allowed_actuator:query_trace_memory",
        expect.stringMatching(/^agent_goal_feed:/),
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_trace_memory",
        threadId,
        trace.trace_id,
        "visual_evidence:goal-memory",
        "derived_equation:goal-memory",
        "calculator_receipt:goal-memory",
        "tool_lifecycle:goal-memory",
      ]),
      freshnessStatus: "fresh",
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      selectedTrace: {
        trace_id: trace.trace_id,
        assistant_answer: false,
        raw_content_included: false,
      },
      goalContextUpdateId: expect.stringMatching(/^stage_play_goal_context_update:trace_memory:/),
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      agentGoalSession: expect.objectContaining({
        goalId: "goal:trace-memory-watch",
        authority: hardenedGoalSessionAuthority(),
      }),
    });
    expect(payload.agentGoalSession.checkpoints).toHaveLength(initialCheckpointCount + 1);
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: "Queried trace memory and read 1 compact trace(s) for this goal session.",
      actionsTaken: expect.arrayContaining(["query_trace_memory", "live_env.query_trace_memory"]),
      evidenceRefs: expect.arrayContaining([
        payload.goalContextUpdateId,
        payload.resultId,
        "context_feed:trace_memory",
        "allowed_actuator:query_trace_memory",
        expect.stringMatching(/^agent_goal_feed:/),
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_trace_memory",
        trace.trace_id,
      ]),
      nextStep: "continue",
    });

    const storedSession = listStagePlayAgentGoalSessions({
      threadId,
      goalId: "goal:trace-memory-watch",
      limit: 1,
    })[0];
    expect(storedSession?.checkpoints).toHaveLength(initialCheckpointCount + 1);
    expect(storedSession?.checkpoints.at(-1)).toMatchObject({
      summary: "Queried trace memory and read 1 compact trace(s) for this goal session.",
      actionsTaken: expect.arrayContaining(["query_trace_memory", "live_env.query_trace_memory"]),
      evidenceRefs: expect.arrayContaining([payload.goalContextUpdateId, payload.resultId, trace.trace_id]),
    });
  });

  it("keeps implicit goal-scoped trace-memory queries inside the AgentGoalSession source boundary", () => {
    const targetTrace = recordWorkstationReasoningTrace({
      schema: "helix.workstation_reasoning_trace.v1",
      trace_id: "workstation_trace:goal-source-boundary-target",
      thread_id: threadId,
      turn_id: "turn:goal-source-boundary-target",
      source_family: "multimodal",
      user_goal: "Classify the frog visible in the active visual source.",
      route_reason_code: "visual_to_microdeck",
      input_item_refs: ["visual_evidence:goal-source-boundary-target"],
      evidence_refs: [sourceId, "visual_evidence:goal-source-boundary-target", "microdeck_output:frog-classifier"],
      tool_receipt_ids: ["microdeck_receipt:frog-classifier"],
      lifecycle_event_refs: ["tool_lifecycle:goal-source-boundary-target"],
      artifacts: {
        visual_extraction_id: "visual_extraction:goal-source-boundary-target",
        workstation_tool_evaluation_id: "workstation-tool-eval:goal-source-boundary-target",
      },
      requested_extraction_scope: "scene",
      actual_extraction_scope: "scene",
      scope_match: "exact",
      proof_status: "complete",
      compact_steps: [
        {
          label: "Visual source trace",
          summary: "Bound frog classification trace to the active visual source.",
          artifact_ref: "visual_extraction:goal-source-boundary-target",
          status: "completed",
        },
      ],
      caveats: [],
      final_answer_snapshot: "The frog trace remains compact observation-only context.",
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
      created_at: "2026-06-17T15:10:00.000Z",
    });
    const unrelatedTrace = recordWorkstationReasoningTrace({
      schema: "helix.workstation_reasoning_trace.v1",
      trace_id: "workstation_trace:goal-source-boundary-unrelated",
      thread_id: threadId,
      turn_id: "turn:goal-source-boundary-unrelated",
      source_family: "multimodal",
      user_goal: "Translate audio from an unrelated source.",
      route_reason_code: "audio_to_translation",
      input_item_refs: ["audio_evidence:unrelated-source"],
      evidence_refs: ["audio_source:unrelated", "audio_evidence:unrelated-source", "translation_segment:unrelated"],
      tool_receipt_ids: ["translation_receipt:unrelated"],
      lifecycle_event_refs: ["tool_lifecycle:goal-source-boundary-unrelated"],
      artifacts: {
        workstation_tool_evaluation_id: "workstation-tool-eval:goal-source-boundary-unrelated",
      },
      requested_extraction_scope: "custom",
      actual_extraction_scope: "custom",
      scope_match: "exact",
      proof_status: "complete",
      compact_steps: [
        {
          label: "Audio translation trace",
          summary: "Unrelated trace should stay outside the visual goal session.",
          artifact_ref: "translation_segment:unrelated",
          status: "completed",
        },
      ],
      caveats: [],
      final_answer_snapshot: "The unrelated audio trace remains observation-only.",
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
      created_at: "2026-06-17T15:11:00.000Z",
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:trace-source-boundary",
        objective: "Read only trace memory attached to this visual source.",
        context_feeds: ["trace_memory"],
        allowed_actuators: ["query_trace_memory"],
      },
    });
    expect(sessionObservation.ok).toBe(true);
    const initialCheckpointCount = ((sessionObservation.observation as any).session.checkpoints ?? []).length;

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_trace_memory",
      thread_id: threadId,
      args: {
        goal_id: "goal:trace-source-boundary",
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.query_trace_memory",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.workstation_reasoning_trace_query_result.v1",
      contractValid: true,
      contractValidationIssues: [],
      trace_id: null,
      trace_count: 1,
      selectedTrace: {
        trace_id: targetTrace.trace_id,
        assistant_answer: false,
        raw_content_included: false,
      },
      goalId: "goal:trace-source-boundary",
      status: "read",
      feedAllowed: true,
      actuatorAllowed: true,
      matchedAllowedActuators: ["query_trace_memory"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_trace_memory"],
      freshnessStatus: "fresh",
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(payload.traces.map((trace: any) => trace.trace_id)).toEqual([targetTrace.trace_id]);
    expect(payload.traces.map((trace: any) => trace.trace_id)).not.toContain(unrelatedTrace.trace_id);
    expect(payload.sourceRefs).toEqual(expect.arrayContaining([threadId, "multimodal", targetTrace.trace_id]));
    expect(payload.sourceRefs).not.toContain(unrelatedTrace.trace_id);
    expect(payload.evidenceRefs).toEqual(expect.arrayContaining([
      payload.resultId,
      "context_feed:trace_memory",
      "allowed_actuator:query_trace_memory",
      "agent_goal_allowed_actuator:query_trace_memory",
      sourceId,
      targetTrace.trace_id,
      "visual_evidence:goal-source-boundary-target",
      "microdeck_output:frog-classifier",
      "microdeck_receipt:frog-classifier",
      "tool_lifecycle:goal-source-boundary-target",
    ]));
    expect(payload.evidenceRefs).not.toContain(unrelatedTrace.trace_id);
    expect(payload.evidenceRefs).not.toContain("audio_source:unrelated");
    expect(payload.agentGoalSession.checkpoints).toHaveLength(initialCheckpointCount + 1);
    expect(payload.agentGoalSession.checkpoints.at(-1)).toMatchObject({
      summary: "Queried trace memory and read 1 compact trace(s) for this goal session.",
      actionsTaken: expect.arrayContaining(["query_trace_memory", "live_env.query_trace_memory"]),
      evidenceRefs: expect.arrayContaining([
        payload.goalContextUpdateId,
        payload.resultId,
        targetTrace.trace_id,
        sourceId,
      ]),
      nextStep: "continue",
    });
  });

  it("blocks trace-memory queries outside an explicit goal session context-feed policy", () => {
    const trace = recordWorkstationReasoningTrace({
      schema: "helix.workstation_reasoning_trace.v1",
      trace_id: "trace:blocked-by-feed-policy",
      thread_id: threadId,
      turn_id: "turn:blocked-by-feed-policy",
      source_family: "multimodal",
      user_goal: "Remember prior visual reasoning.",
      route_reason_code: "visual_to_calculator",
      input_item_refs: ["visual_evidence:blocked-feed"],
      evidence_refs: ["visual_evidence:blocked-feed"],
      tool_receipt_ids: ["calculator_receipt:blocked-feed"],
      lifecycle_event_refs: ["tool_lifecycle:blocked-feed"],
      artifacts: {},
      requested_extraction_scope: "visual",
      actual_extraction_scope: "visual",
      scope_match: "exact",
      proof_status: "complete",
      compact_steps: [],
      caveats: [],
      final_answer_snapshot: "Prior trace should not be exposed to this visual-only feed request.",
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
      created_at: "2026-06-17T15:05:00.000Z",
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:visual-no-trace",
        objective: "Inspect visual summaries only.",
        context_feeds: ["visual_summaries"],
        allowed_actuators: ["query_trace_memory", "query_visual_summaries"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_trace_memory",
      thread_id: threadId,
      args: {
        goal_id: "goal:visual-no-trace",
        trace_id: trace.trace_id,
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.query_trace_memory",
      ok: false,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.workstation_reasoning_trace_query_result.v1",
      contractValid: true,
      contractValidationIssues: [],
      trace_id: trace.trace_id,
      goalId: "goal:visual-no-trace",
      status: "blocked",
      goalSessionFound: true,
      feedAllowed: false,
      actuatorAllowed: true,
      matchedAllowedActuators: ["query_trace_memory"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_trace_memory"],
      matchedContextFeeds: [],
      matchedContextFeedRefs: [],
      missingRequirements: ["context_feed:trace_memory"],
      policyEvidenceRefs: expect.arrayContaining([
        "context_feed:trace_memory",
        "allowed_actuator:query_trace_memory",
        "agent_goal_allowed_actuator:query_trace_memory",
      ]),
      sourceRefs: [threadId],
      loopRefs: expect.arrayContaining([
        payload.resultId,
        "workstation_context_feed:trace_memory",
        "workstation_actuator:query_trace_memory",
      ]),
      evidenceRefs: expect.arrayContaining([
        payload.resultId,
        "context_feed:trace_memory",
        "allowed_actuator:query_trace_memory",
        "agent_goal_allowed_actuator:query_trace_memory",
        threadId,
      ]),
      freshnessStatus: "blocked",
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      traces: [],
      trace_count: 0,
      selectedTrace: null,
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(observation.producedRefs).not.toContain(trace.trace_id);

    const updates = listStagePlayGoalContextUpdates({
      threadId,
      producerKind: "trace_memory",
      updateKind: "route_evidence",
    });
    const queryUpdate = updates.find((update) => update.updateId === payload.goalContextUpdateId);
    expect(queryUpdate).toMatchObject({
      contentRef: payload.resultId,
      freshness: expect.objectContaining({ status: "blocked" }),
      evidenceRefs: expect.arrayContaining(["context_feed:trace_memory", "allowed_actuator:query_trace_memory"]),
      loopRefs: expect.arrayContaining(["workstation_context_feed:trace_memory", "workstation_actuator:query_trace_memory"]),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(queryUpdate?.suggestedDispatch.map((action) => action.kind)).not.toContain("append_goal_context");
  });

  it("adds the trace-memory query actuator when a goal session declares the trace feed", () => {
    const trace = recordWorkstationReasoningTrace({
      schema: "helix.workstation_reasoning_trace.v1",
      trace_id: "trace:blocked-by-actuator-policy",
      thread_id: threadId,
      turn_id: "turn:blocked-by-actuator-policy",
      source_family: "multimodal",
      user_goal: "Remember prior trace evidence.",
      route_reason_code: "visual_to_calculator",
      input_item_refs: ["visual_evidence:blocked-actuator"],
      evidence_refs: ["visual_evidence:blocked-actuator"],
      tool_receipt_ids: ["calculator_receipt:blocked-actuator"],
      lifecycle_event_refs: ["tool_lifecycle:blocked-actuator"],
      artifacts: {},
      requested_extraction_scope: "visual",
      actual_extraction_scope: "visual",
      scope_match: "exact",
      proof_status: "complete",
      compact_steps: [],
      caveats: [],
      final_answer_snapshot: "Prior trace should not be exposed without the query actuator.",
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
      created_at: "2026-06-17T15:08:00.000Z",
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        goal_id: "goal:trace-feed-no-query-action",
        objective: "Keep trace memory available for goal-context inspection.",
        context_feeds: ["trace_memory"],
        allowed_actuators: ["query_visual_summaries"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_trace_memory",
      thread_id: threadId,
      args: {
        goal_id: "goal:trace-feed-no-query-action",
        trace_id: trace.trace_id,
      },
    });

    const payload = observation.observation as any;
    expect(observation).toMatchObject({
      tool_name: "live_env.query_trace_memory",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "helix.workstation_reasoning_trace_query_result.v1",
      contractValid: true,
      contractValidationIssues: [],
      trace_id: trace.trace_id,
      goalId: "goal:trace-feed-no-query-action",
      status: "read",
      goalSessionFound: true,
      feedAllowed: true,
      requiredActuator: "query_trace_memory",
      actuatorAllowed: true,
      matchedAllowedActuators: ["query_trace_memory"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_trace_memory"],
      missingRequirements: [],
      matchedContextFeeds: [
        expect.objectContaining({
          sourceKind: "trace_memory",
        }),
      ],
      matchedContextFeedRefs: [expect.stringMatching(/^agent_goal_feed:/)],
      policyEvidenceRefs: expect.arrayContaining([
        "context_feed:trace_memory",
        "allowed_actuator:query_trace_memory",
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_trace_memory",
      ]),
      sourceRefs: expect.arrayContaining([threadId, "multimodal", trace.trace_id]),
      loopRefs: expect.arrayContaining([
        payload.resultId,
        "workstation_context_feed:trace_memory",
        "workstation_actuator:query_trace_memory",
      ]),
      evidenceRefs: expect.arrayContaining([
        payload.resultId,
        "context_feed:trace_memory",
        "allowed_actuator:query_trace_memory",
        expect.stringMatching(/^agent_goal_feed:/),
        expect.stringMatching(/^agent_goal_context_feed:agent_goal_feed:/),
        "agent_goal_allowed_actuator:query_trace_memory",
        threadId,
      ]),
      freshnessStatus: "fresh",
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      trace_count: 1,
      selectedTrace: {
        trace_id: trace.trace_id,
        assistant_answer: false,
        raw_content_included: false,
      },
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(payload.policyEvidenceRefs).toContain("agent_goal_allowed_actuator:query_trace_memory");
    expect(payload.evidenceRefs).toContain("agent_goal_allowed_actuator:query_trace_memory");
    expect(observation.producedRefs).toContain(trace.trace_id);
  });

  it("reflects live-source mail-loop causality as a read-only evidence packet", () => {
    seedVisualSummaryText("Minecraft cave scene with low light and the player near fire damage.", "reflection");

    const processObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });
    const processPayload = processObservation.observation as any;

    const reflectionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.reflect_live_source_mail_loop",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
        read_only: true,
      },
    });

    const reflection = reflectionObservation.observation as any;
    expect(reflectionObservation.summary).toContain("Reflected live-source mail-loop causality");
    expect(reflection).toMatchObject({
      artifactId: "stage_play_live_source_mail_loop_reflection",
      schemaVersion: "stage_play_live_source_mail_loop_reflection/v1",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(reflection.inspectionWindow.processedPacketRefs).toEqual(expect.arrayContaining([
      processPayload.packets[0].packetId,
    ]));
    expect(reflection.inspectionWindow.microReasonerRunRefs.length).toBeGreaterThan(0);
    expect(reflection.inspectionWindow.currentStateRef).toMatch(/^stage_play_live_source_current_state:/);
    expect(reflection.inspectionWindow.loopHealthRef).toMatch(/^stage_play_live_source_loop_health:/);
    expect(reflection.inspectionWindow.stagePlayGraphRef).toMatch(/^stage_play_badge_graph:/);
    expect(reflection.causalGraph).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relation: "processed_into_packet",
        toRef: processPayload.packets[0].packetId,
      }),
      expect.objectContaining({
        relation: "reasoned_by_microdeck",
      }),
      expect.objectContaining({
        relation: "eligible_for_terminal_context",
        fromRef: processPayload.packets[0].packetId,
      }),
    ]));
    expect(reflection.whatEnteredAnswerContext.join(" ")).toContain(processPayload.packets[0].packetId);
    expect(reflection.causalTrace).toMatchObject({
      producedRefs: expect.arrayContaining([reflection.reflectionId]),
      evidenceRefs: expect.arrayContaining([processPayload.packets[0].packetId]),
    });
    expect(reflectionObservation.producedRefs).toContain(reflection.reflectionId);
    expect(reflectionObservation.artifactRefs).toMatchObject({
      processedPacketIds: expect.arrayContaining([processPayload.packets[0].packetId]),
    });
  });

  it("configures visual observer profiles and maps structured Minecraft observer output into processed packets", () => {
    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_visual_observer_profiles",
      thread_id: threadId,
      args: {},
    });
    const queryPayload = queryObservation.observation as any;
    const minecraftProfile = queryPayload.profiles.find((profile: any) => profile.domain === "minecraft_gameplay");
    expect(minecraftProfile).toBeTruthy();
    expect(queryPayload.assistant_answer).toBe(false);
    expect(queryPayload.terminal_eligible).toBe(false);

    const applyObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.apply_visual_observer_profile",
      thread_id: threadId,
      args: {
        profile_id: minecraftProfile.profileId,
        source_ids: [sourceId],
      },
    });
    const applyPayload = applyObservation.observation as any;
    expect(applyPayload.applied).toBe(true);
    expect(applyPayload.profile.sourceIds).toContain(sourceId);

    const structuredSummary = JSON.stringify({
      scene: "underground Minecraft cave",
      hud: "fire overlay visible; health uncertain",
      hotbar: "pickaxe and sword visible",
      selected_item: "pickaxe",
      visible_entities: [],
      current_action: "moving through a dark cave",
      changed_since_last_frame: ["fire or damage cue appeared"],
      risk_cues: ["fire", "low light"],
      opportunity_cues: ["ore may be nearby"],
      next_10s_prediction: "watch for recovery from fire or nearby hostile mobs",
      confidence: 0.82,
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
      frame_id: "visual_frame:helix-ask-live-source-mail-tool:minecraft-observer-json",
      ts: "2026-06-04T12:10:00.000Z",
    });
    analyzeVisualFrame({
      thread_id: threadId,
      frame_id: frame.frame_id,
      evidence_id: "visual_evidence:helix-ask-live-source-mail-tool:minecraft-observer-json",
      summary: structuredSummary,
      visual_observer_profile_id: minecraftProfile.profileId,
      visual_observer_profile_title: minecraftProfile.title,
      visual_prompt_hash: minecraftProfile.promptHash,
      visual_output_mode: minecraftProfile.outputMode,
      visual_observer_structured_output: structuredSummary,
      supports_claims: [
        {
          claim: "The Minecraft observer profile produced compact structured visual evidence.",
          support_status: "supports",
          confidence: 0.82,
        },
      ],
    });
    const stampedMail = listStagePlayLiveSourceMailItems({ threadId, sourceId }).at(-1);
    expect(stampedMail?.sourceRefs).toMatchObject({
      frameRef: frame.frame_id,
      evidenceRef: "visual_evidence:helix-ask-live-source-mail-tool:minecraft-observer-json",
    });
    expect(stampedMail?.evidenceRefs).toEqual(expect.arrayContaining([
      minecraftProfile.profileId,
      `visual_prompt_hash:${minecraftProfile.promptHash}`,
    ]));

    const testObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.test_visual_observer_profile",
      thread_id: threadId,
      args: {
        profile_id: minecraftProfile.profileId,
        source_id: sourceId,
        summary: structuredSummary,
      },
    });
    const testPayload = testObservation.observation as any;
    expect(testPayload.parseOk).toBe(true);
    expect(testPayload.enqueuedAsMail).toBe(false);
    expect(testPayload.parsedProfileOutput.scene).toBe("underground Minecraft cave");

    const processObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });
    const packet = (processObservation.observation as any).packets[0];
    expect(packet.observedFacts).toEqual(expect.arrayContaining([
      expect.stringContaining("scene: underground Minecraft cave"),
      expect.stringContaining("selected_item: pickaxe"),
    ]));
    expect(packet.changedFacts).toEqual(expect.arrayContaining([expect.stringContaining("fire or damage cue appeared")]));
    expect(packet.riskMatches).toEqual(expect.arrayContaining(["fire", "low light"]));
    expect(packet.opportunityMatches).toEqual(expect.arrayContaining(["ore may be nearby"]));
    expect(packet.watchNext).toEqual(expect.arrayContaining(["watch for recovery from fire or nearby hostile mobs"]));
    expect(packet.mailIds).toContain(stampedMail?.mailId);
    expect(packet.visualEvidenceRefs).toEqual(expect.arrayContaining([
      "visual_evidence:helix-ask-live-source-mail-tool:minecraft-observer-json",
    ]));
    expect(packet.evidenceRefs).toEqual(expect.arrayContaining([
      minecraftProfile.profileId,
      `visual_prompt_hash:${minecraftProfile.promptHash}`,
    ]));
    expect(packet.recommendedNext).toBe("request_voice_callout");
    expect(packet.effortEstimate).toMatchObject({
      currentEffort: "combat_or_recovery",
      nextLikelyEfforts: expect.arrayContaining(["recover_or_retreat"]),
    });
    expect(packet.axioms.axioms).toEqual(expect.arrayContaining([
      "current effort: combat_or_recovery",
      "location: cave or underground exploration context",
      "hazard: immediate risk cue present",
    ]));
    expect(packet.hypotheses.map((hypothesis: any) => hypothesis.label)).toEqual(expect.arrayContaining([
      "recover_or_create_distance",
      "continue_engagement",
    ]));
    expect(packet.arbiter).toMatchObject({
      recommendedNext: "request_voice_callout",
      wakeAsk: true,
      voiceCandidate: true,
      confidence: "high",
    });
    expect(packet.actionPredictions[0]).toMatchObject({
      actorId: sourceId,
      recommendedNext: "request_voice_callout",
      basis: expect.arrayContaining(["goal_object", "recovery_pattern", "salience"]),
      frameIntervalRefs: expect.any(Array),
      sourceSliceRefs: expect.any(Array),
    });
    expect(packet.unresolvedLeads.map((lead: any) => lead.urgency)).toContain("high");
    expect(packet.evidenceRefs).toEqual(expect.arrayContaining([
      packet.actionPredictions[0].predictionId,
      packet.evidenceHandles.frameIntervals[0].intervalId,
      packet.unresolvedLeads[0].leadId,
    ]));
    expect(packet.microReasonerRunRefs.length).toBeGreaterThanOrEqual(11);
    const processedRuns = (processObservation.observation as any).microReasonerRuns ?? [];
    expect(processedRuns.map((run: any) => run.role)).toEqual(expect.arrayContaining([
      "effort_estimator",
      "axiom_extractor",
      "hypothesis_generator",
      "hypothesis_arbiter",
    ]));
    expect(packet.assistant_answer).toBe(false);
    expect(packet.terminal_eligible).toBe(false);
  });

  it("records a processed-mail interpretation with recovered mail ids and narrative aliases", () => {
    seedVisualSummaryText("Minecraft cave scene with low light and the player near fire damage.", "processed-default-interpretation");

    const processObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });
    const packet = (processObservation.observation as any).packets[0];

    const decisionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.record_live_source_mail_decision",
      thread_id: threadId,
      args: {
        room_id: roomId,
        decision: "record_interpretation",
        rationale_preview: "Interpret the latest processed Minecraft packet and say what to watch next.",
        route_metadata: {
          wakeRequestId: "stage_play_mail_wake:test-decision",
          askTurnId: "ask:test-decision",
        },
        live_source_mail_output_intent: {
          wants_interpretation: true,
        },
      },
    });

    const payload = decisionObservation.observation as any;
    expect(decisionObservation).toMatchObject({
      tool_name: "live_env.record_live_source_mail_decision",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
    });
    expect(payload).toMatchObject({
      decision: "record_interpretation",
      mailIds: expect.arrayContaining(packet.mailIds),
      narrativeStateRef: expect.stringMatching(/^stage_play_live_source_narrative_state:/),
      narrativeStateId: expect.stringMatching(/^stage_play_live_source_narrative_state:/),
      narrative_state_ref: expect.stringMatching(/^stage_play_live_source_narrative_state:/),
      narrative_state_id: expect.stringMatching(/^stage_play_live_source_narrative_state:/),
      narrativeState: {
        narrativeStateId: expect.stringMatching(/^stage_play_live_source_narrative_state:/),
        mailBatchRefs: expect.arrayContaining(packet.mailIds),
        interpretedSituation: {
          userRelevantMeaning: expect.any(String),
        },
        watchNext: {
          targets: expect.any(Array),
          reason: expect.any(String),
        },
      },
      processedPacketRefs: expect.arrayContaining([packet.packetId]),
      processed_packet_refs: expect.arrayContaining([packet.packetId]),
      post_tool_model_step_required: true,
      terminal_eligible: false,
    });
    expect(decisionObservation.producedRefs).toContain(payload.decisionId);
    expect(decisionObservation.artifactRefs).toMatchObject({
      processedPacketIds: expect.arrayContaining([packet.packetId]),
      decisionIds: expect.arrayContaining([payload.decisionId]),
      wakeRequestId: "stage_play_mail_wake:test-decision",
      askTurnId: "ask:test-decision",
    });
    expect(payload.narrativeStateId).toBe(payload.narrativeStateRef);
    expect(payload.narrative_state_id).toBe(payload.narrativeStateRef);
    expect(payload.narrativeState.currentSceneSummary).toContain("Minecraft");
    expect(payload.transcriptRows.map((row: any) => row.rowKind)).toEqual(expect.arrayContaining([
      "interpretation",
      "watch_next",
      "narrative_state",
    ]));
  });

  it("reads the same-source unread batch through live_env.read_live_source_mail even when model args supply a small limit", () => {
    seedVisualSummaries(6);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
        limit: 3,
      },
    });

    const payload = observation.observation as any;
    expect(observation.summary).toBe("Read 6 unread live-source mail item(s); decision required.");
    expect(payload.items).toHaveLength(6);
    expect(payload.readWindow).toMatchObject({
      sourceId,
      sourceKind: "visual_frame",
      requestedLimit: 3,
      effectiveLimit: 12,
      sameSourceBatch: true,
      unreadBeforeRead: 6,
      remainingUnreadCount: 0,
      retainedUnreadMailIds: [],
    });
    expect(payload.items.map((item: any) => item.summary.text)).toEqual([
      expect.stringContaining("Live frame 1"),
      expect.stringContaining("Live frame 2"),
      expect.stringContaining("Live frame 3"),
      expect.stringContaining("Live frame 4"),
      expect.stringContaining("Live frame 5"),
      expect.stringContaining("Live frame 6"),
    ]);
  });

  it("reports retained same-source unread backlog when read_live_source_mail reaches the batch cap", () => {
    seedVisualSummaries(14);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });

    const payload = observation.observation as any;
    expect(observation.summary).toBe("Read 12 unread live-source mail item(s); 2 same-source unread item(s) remain queued; decision required.");
    expect(payload.items).toHaveLength(12);
    expect(payload.readWindow).toMatchObject({
      sourceId,
      sourceKind: "visual_frame",
      requestedLimit: 12,
      effectiveLimit: 12,
      sameSourceBatch: true,
      unreadBeforeRead: 14,
      remainingUnreadCount: 2,
    });
    expect(payload.readWindow.retainedUnreadMailIds).toHaveLength(2);
    expect(payload.items.at(0).summary.text).toContain("Live frame 1");
    expect(payload.items.at(-1).summary.text).toContain("Live frame 12");
  });

  it("keeps live_env.check_live_source_mail as a lightweight three-item status check", () => {
    seedVisualSummaries(5);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.check_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });

    const payload = observation.observation as any;
    expect(observation.summary).toBe("Read 3 unread live-source mail item(s); decision required.");
    expect(payload.items).toHaveLength(3);
  });

  it.each([
    {
      objective: "Watch the active visual source and describe each new mail batch in one sentence.",
      expectedMode: "latest_scene_answer",
      expectedMailProcessingMode: "latest_only",
      expectedOutputCadence: "every_batch",
    },
    {
      objective: "Watch the active visual source and interpret what is happening across the summaries.",
      expectedMode: "prediction_watch",
      expectedMailProcessingMode: "chronological_batch",
      expectedOutputCadence: "only_salient",
    },
    {
      objective: "Watch the active visual source and do not bother me unless something important changes.",
      expectedMode: "salience_watch",
      expectedMailProcessingMode: "salience_window",
      expectedOutputCadence: "only_salient",
    },
    {
      objective: "Watch the active visual source, interpret the summaries, and predict what might happen next.",
      expectedMode: "prediction_watch",
      expectedMailProcessingMode: "chronological_batch",
      expectedOutputCadence: "only_salient",
    },
    {
      objective: "Watch the active visual source and announce if anything important happens.",
      expectedMode: "salience_watch",
      expectedMailProcessingMode: "salience_window",
      expectedOutputCadence: "voice_only_salient",
    },
    {
      objective: "Commentate while I play from the active visual source.",
      expectedMode: "voice_commentary_watch",
      expectedMailProcessingMode: "micro_batch",
      expectedOutputCadence: "voice_only_salient",
    },
  ])("classifies watch-job policy modes: $expectedMode", ({
    objective,
    expectedMode,
    expectedMailProcessingMode,
    expectedOutputCadence,
  }) => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.configure_live_source_watch_job",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        objective,
      },
    });

    const payload = observation.observation as any;
    expect(payload).toMatchObject({
      artifactId: "stage_play_live_source_watch_job_policy_config_result",
      policy: {
        interpretationMode: expectedMode,
        mailProcessingMode: expectedMailProcessingMode,
        outputCadence: expectedOutputCadence,
      },
    });
    expect(payload.transcriptRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rowKind: "loop_state",
        title: "Policy",
        body: expect.stringContaining(expectedMode),
      }),
    ]));
    expect(payload.transcriptRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rowKind: "loop_state",
        title: "Policy",
        body: expect.stringContaining(expectedMailProcessingMode),
      }),
    ]));
    expect(payload.transcriptRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rowKind: "loop_state",
        title: "Policy",
        body: expect.stringContaining(expectedOutputCadence),
      }),
    ]));
  });

  it("records a wait decision when no unread live-source updates exist", () => {
    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_kind: "visual_frame",
      },
    });

    expect(readObservation).toMatchObject({
      tool_name: "live_env.read_live_source_mail",
      ok: true,
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    const readPayload = readObservation.observation as any;
    expect(readPayload.items).toEqual([]);
    expect(readPayload.transcriptRows.find((row: any) => row.rowKind === "wait_for_next_summary")?.body)
      .toBe("No unread live-source updates. Standing by for the next source update.");

    const decisionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.record_live_source_mail_decision",
      thread_id: threadId,
      args: {
        room_id: roomId,
        mail_ids: [],
        decision: "wait_for_next_summary",
        rationale_preview: "No unread live-source updates. Standing by for the next source update.",
        next_loop_state: "armed_for_next_summary",
      },
    });

    expect(decisionObservation).toMatchObject({
      tool_name: "live_env.record_live_source_mail_decision",
      ok: true,
      summary: "Recorded wait_for_next_summary; no unread live-source updates. Standing by for the next source update.",
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    const decisionPayload = decisionObservation.observation as any;
    expect(decisionPayload).toMatchObject({
      artifactId: "stage_play_live_source_mail_decision",
      decision: "wait_for_next_summary",
      nextLoopState: "armed_for_next_summary",
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("records the model decision as evidence and keeps text/voice drafts non-terminal", () => {
    seedVisualSummary();
    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.check_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
      },
    });
    const mailId = (readObservation.observation as any).items[0].mailId;

    const decisionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.record_live_source_mail_decision",
      thread_id: threadId,
      args: {
        room_id: roomId,
        mail_ids: [mailId],
        decision: "draft_text_answer",
        rationale_preview: "The compact summary is enough to draft a visible text update.",
        text_answer_draft: "The active visual source shows a Minecraft-like scene with a player and cat.",
        text_answer_terminal_eligible: false,
      },
    });

    expect(decisionObservation).toMatchObject({
      tool_name: "live_env.record_live_source_mail_decision",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    const payload = decisionObservation.observation as any;
    expect(payload).toMatchObject({
      artifactId: "stage_play_live_source_mail_decision",
      decision: "draft_text_answer",
      nextLoopState: "armed_for_next_summary",
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
    });
    expect(payload.textAnswerDraft).toMatchObject({
      terminalEligible: false,
    });
    expect(payload.transcriptRows.map((row: any) => row.rowKind)).toEqual(expect.arrayContaining([
      "agent_decision",
      "text_answer",
      "loop_state",
    ]));
    expect(payload.transcriptRows.find((row: any) => row.rowKind === "text_answer").terminalEligible).toBe(false);
  });

  it("records profile comparison refs on live-source mail decisions", () => {
    seedVisualSummary();
    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.check_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
      },
    });
    const mailId = (readObservation.observation as any).items[0].mailId;
    const profileRef = "stage_play_live_source_interpreter_profile:decision-profile";
    const comparisonRef = "stage_play_live_source_interpreter_profile_comparison:decision-profile";

    const decisionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.record_live_source_mail_decision",
      thread_id: threadId,
      args: {
        room_id: roomId,
        mail_ids: [mailId],
        decision: "draft_text_answer",
        rationale_preview: "The profile comparison matched a visible scene update.",
        text_answer_draft: "The active visual source shows a Minecraft-like player scene.",
        interpreter_profile_ref: profileRef,
        profile_comparison_refs: [comparisonRef],
        matched_criteria: ["player scene"],
        suppressed_criteria: ["routine walking"],
        observed_facts: ["Mail summary shows a player and cat."],
        inferred_meaning: ["The survival-coach profile should keep watching for hazards."],
        evidence_refs: [comparisonRef],
      },
    });

    const payload = decisionObservation.observation as any;
    expect(payload).toMatchObject({
      artifactId: "stage_play_live_source_mail_decision",
      decision: "draft_text_answer",
      interpreterProfileRef: profileRef,
      profileComparisonRefs: [comparisonRef],
      matchedCriteria: ["player scene"],
      suppressedCriteria: ["routine walking"],
      observedFacts: ["Mail summary shows a player and cat."],
      inferredMeaning: ["The survival-coach profile should keep watching for hazards."],
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(payload.evidenceRefs).toEqual(expect.arrayContaining([
      profileRef,
      comparisonRef,
      mailId,
    ]));
    expect(payload.transcriptRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rowKind: "profile_comparison",
        title: "Interpreter profile context",
        body: expect.stringContaining(`Profile: ${profileRef}.`),
      }),
      expect.objectContaining({
        rowKind: "profile_comparison",
        title: "Interpreter profile context",
        body: expect.stringContaining(`Comparisons: ${comparisonRef}.`),
      }),
      expect.objectContaining({
        rowKind: "agent_decision",
        title: "Agent decision",
      }),
    ]));
  });

  it("records structured interpretation payloads as narrative state and transcript rows", () => {
    seedVisualSummary();
    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
      },
    });
    const mailId = (readObservation.observation as any).items[0].mailId;

    const decisionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.record_live_source_mail_decision",
      thread_id: threadId,
      args: {
        room_id: roomId,
        mail_ids: [mailId],
        decision: "record_interpretation",
        rationale_preview: "The scene shifted into a readable Minecraft-like overwatch state.",
        interpretation: {
          currentSceneSummary: "A player is near a cat, book stand, and distant mountains.",
          runningStorySummary: "The live source is showing a Minecraft-like scene around a player base.",
          setting: "Minecraft-like game scene",
          activeWindowOrScene: "player base overlook",
          entities: ["player", "cat"],
          objects: ["book stand", "distant mountains"],
          activities: ["standing near base objects"],
          userRelevantMeaning: "The player appears stationary near base objects while the outside scene remains visible.",
          meaningfulChanges: ["The compact summary now highlights base objects and distant terrain."],
          uncertainties: ["The raw frame is not included, so exact inventory or UI state is unknown."],
          watchNextTargets: ["player movement", "nearby mobs", "base objects"],
          watchNextReason: "Watch whether the player moves or a risk appears near the base.",
          predictionText: "The next summary will likely confirm whether the player stays near the base or moves away.",
          predictionHorizon: "next_mail",
          predictionConfidence: 0.62,
          validationSignals: ["player remains near base", "player moves away", "hostile mob appears"],
        },
      },
    });

    expect(decisionObservation).toMatchObject({
      tool_name: "live_env.record_live_source_mail_decision",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
    });
    const payload = decisionObservation.observation as any;
    expect(payload).toMatchObject({
      artifactId: "stage_play_live_source_mail_decision",
      decision: "record_interpretation",
      narrativeStateRef: expect.stringMatching(/^stage_play_live_source_narrative_state:/),
      narrativeState: {
        narrativeStateId: expect.stringMatching(/^stage_play_live_source_narrative_state:/),
        currentSceneSummary: "A player is near a cat, book stand, and distant mountains.",
        runningStorySummary: "The live source is showing a Minecraft-like scene around a player base.",
        interpretedSituation: {
          setting: "Minecraft-like game scene",
          activeWindowOrScene: "player base overlook",
          entities: ["player", "cat"],
          objects: ["book stand", "distant mountains"],
          activities: ["standing near base objects"],
          userRelevantMeaning: "The player appears stationary near base objects while the outside scene remains visible.",
        },
        meaningfulChanges: ["The compact summary now highlights base objects and distant terrain."],
        uncertainties: ["The raw frame is not included, so exact inventory or UI state is unknown."],
        watchNext: {
          targets: ["player movement", "nearby mobs", "base objects"],
          reason: "Watch whether the player moves or a risk appears near the base.",
        },
        prediction: {
          text: "The next summary will likely confirm whether the player stays near the base or moves away.",
          horizon: "next_mail",
          confidence: 0.62,
          validationSignals: ["player remains near base", "player moves away", "hostile mob appears"],
        },
      },
      post_tool_model_step_required: true,
      terminal_eligible: false,
    });
    expect(payload.transcriptRows.map((row: any) => row.title)).toEqual(expect.arrayContaining([
      "Interpretation",
      "Watch next",
      "Prediction",
      "Narrative state",
    ]));
    expect(payload.transcriptRows.map((row: any) => row.rowKind)).toEqual(expect.arrayContaining([
      "interpretation",
      "watch_next",
      "prediction",
      "narrative_state",
    ]));
    expect(payload.transcriptRows.filter((row: any) => (
      row.rowKind === "interpretation" ||
      row.rowKind === "watch_next" ||
      row.rowKind === "narrative_state"
    )).every((row: any) => row.terminalEligible === false)).toBe(true);
    expect(payload.transcriptRows.find((row: any) => row.title === "Watch next")?.body)
      .toContain("player movement");
    expect(payload.transcriptRows.find((row: any) => row.title === "Prediction")?.body)
      .toContain("62%");
  });

  it("predicts the immediate next live-source mail as evidence only", () => {
    seedVisualSummary();
    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
      },
    });
    const mailId = (readObservation.observation as any).items[0].mailId;

    const predictionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.predict_live_source_immediate",
      thread_id: threadId,
      args: {
        room_id: roomId,
        mail_ids: [mailId],
      },
    });

    expect(predictionObservation).toMatchObject({
      tool_name: "live_env.predict_live_source_immediate",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(predictionObservation.observation).toMatchObject({
      schema: "helix.live_source_immediate_prediction.v1",
      predictionHorizon: "next_mail",
      expectedChanges: expect.any(Array),
      watchTargets: expect.arrayContaining(["player"]),
      validationSignals: expect.any(Array),
      salienceHint: expect.stringMatching(/low|medium|high|urgent/),
      evidenceRefs: expect.arrayContaining([mailId]),
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  });

  it("compares latest mail against prior narrative prediction as evidence only", () => {
    seedVisualSummary();
    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
      },
    });
    const mailId = (readObservation.observation as any).items[0].mailId;
    const decisionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.record_live_source_mail_decision",
      thread_id: threadId,
      args: {
        room_id: roomId,
        mail_ids: [mailId],
        decision: "record_interpretation",
        rationale_preview: "Record prediction for the next mail.",
        interpretation: {
          currentSceneSummary: "A player is near a cat, book stand, and distant mountains.",
          userRelevantMeaning: "The scene is stable around a player base.",
          watchNextTargets: ["player", "cat"],
          watchNextReason: "Watch whether the player or cat moves.",
          predictionText: "The next summary will likely still show the player and cat near the base.",
          predictionHorizon: "next_mail",
          predictionConfidence: 0.62,
          validationSignals: ["player remains visible", "cat remains visible"],
        },
      },
    });
    const narrativeStateId = (decisionObservation.observation as any).narrativeStateRef;

    const comparisonObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.compare_live_source_prediction",
      thread_id: threadId,
      args: {
        room_id: roomId,
        mail_ids: [mailId],
        narrative_state_id: narrativeStateId,
      },
    });

    expect(comparisonObservation).toMatchObject({
      tool_name: "live_env.compare_live_source_prediction",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
    });
    expect(comparisonObservation.observation).toMatchObject({
      schema: "helix.live_source_prediction_comparison.v1",
      result: expect.stringMatching(/supported|contradicted|unresolved|no_prior_prediction/),
      meaningfulDifferences: expect.any(Array),
      salienceHint: expect.stringMatching(/low|medium|high|urgent/),
      wakeRecommendation: expect.stringMatching(/wait|record_interpretation|draft_text_answer|request_voice_callout|request_checkpoint/),
      evidenceRefs: expect.arrayContaining([mailId, narrativeStateId]),
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("projects live-source narrative through the existing narrative state store", () => {
    seedVisualSummary();
    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
      },
    });
    const mailId = (readObservation.observation as any).items[0].mailId;

    const projectionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.project_live_source_narrative",
      thread_id: threadId,
      args: {
        room_id: roomId,
        mail_ids: [mailId],
        user_relevant_meaning: "The player base scene should be watched for movement or hostile mobs.",
        watch_next_targets: ["player movement", "hostile mobs"],
        watch_next_reason: "Movement or hostile mobs would change the operator response.",
        prediction_text: "The next mail should confirm whether the player remains near the base.",
        prediction_confidence: 0.57,
      },
    });

    expect(projectionObservation).toMatchObject({
      tool_name: "live_env.project_live_source_narrative",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
    });
    expect(projectionObservation.observation).toMatchObject({
      schema: "helix.live_source_narrative_projection.v1",
      narrativeStateId: expect.stringMatching(/^stage_play_live_source_narrative_state:/),
      runningStorySummary: expect.any(String),
      userRelevantMeaning: "The player base scene should be watched for movement or hostile mobs.",
      watchNext: {
        targets: ["player movement", "hostile mobs"],
        reason: "Movement or hostile mobs would change the operator response.",
      },
      prediction: {
        text: "The next mail should confirm whether the player remains near the base.",
        horizon: "next_mail",
        confidence: 0.57,
      },
      evidenceRefs: expect.arrayContaining([mailId]),
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  });

  it("records requested_tool from the decision tool as the next requested action", () => {
    seedVisualSummary();
    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "visual_frame",
      },
    });
    const mailId = (readObservation.observation as any).items[0].mailId;

    const decisionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.record_live_source_mail_decision",
      thread_id: threadId,
      args: {
        room_id: roomId,
        mail_ids: [mailId],
        decision: "request_more_evidence",
        rationale_preview: "Need the next compact visual summary before answering.",
        requested_tool: {
          tool_name: "live_env.read_live_source_mail",
          args: {
            source_kind: "visual_frame",
            limit: 1,
          },
        },
      },
    });

    const payload = decisionObservation.observation as any;
    expect(payload.requestedTool).toEqual({
      toolName: "live_env.read_live_source_mail",
      args: {
        source_kind: "visual_frame",
        limit: 1,
      },
    });
    expect(payload.transcriptRows.map((row: any) => row.rowKind)).toEqual(expect.arrayContaining([
      "agent_decision",
      "requested_tool",
      "loop_state",
    ]));
    expect(payload.transcriptRows.find((row: any) => row.rowKind === "requested_tool").terminalEligible).toBe(false);
  });

  it("blocks voice requested_tool when mailbox voice policy requires confirmation", () => {
    seedVisualSummary();
    const readObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.read_live_source_mail",
      thread_id: threadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        voice_enabled: true,
        voice_requires_confirmation: true,
        voice_allowed_now: false,
        voice_policy_reason: "voice_requires_confirmation",
      },
    });
    const readPayload = readObservation.observation as any;
    const mailId = readPayload.items[0].mailId;
    expect(readPayload.voicePolicy).toMatchObject({
      voiceEnabled: true,
      requiresConfirmation: true,
      allowedNow: false,
      reason: "voice_requires_confirmation",
    });

    const decisionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.record_live_source_mail_decision",
      thread_id: threadId,
      args: {
        room_id: roomId,
        mail_ids: [mailId],
        decision: "request_voice_callout",
        rationale_preview: "A callout is useful, but confirmation is required before speech.",
        voice_callout_draft: "Hostile mob appeared near the player.",
        voice_enabled: true,
        voice_requires_confirmation: true,
        voice_allowed_now: false,
        voice_policy_reason: "voice_requires_confirmation",
        requested_tool: {
          tool_name: "situation-room-pipelines.voice_delivery.confirm_speak",
          args: {
            text: "Hostile mob appeared near the player.",
          },
        },
      },
    });

    const payload = decisionObservation.observation as any;
    expect(payload.voicePolicy).toMatchObject({
      voiceEnabled: true,
      requiresConfirmation: true,
      allowedNow: false,
      reason: "voice_requires_confirmation",
    });
    expect(payload.voiceCalloutDraft).toMatchObject({
      text: "Hostile mob appeared near the player.",
      voiceEligible: false,
      requiresConfirmation: true,
    });
    expect(payload.requestedTool).toBeNull();
    expect(payload.transcriptRows.map((row: any) => row.rowKind)).toContain("voice_callout_request");
    expect(payload.transcriptRows.map((row: any) => row.rowKind)).not.toContain("voice_tool_call");
  });
});
