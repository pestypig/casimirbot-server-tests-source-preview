import { beforeEach, describe, expect, it } from "vitest";
import {
  HELIX_LIVE_AGENT_STEP_DECISION_SCHEMA,
  type HelixLiveEnvironmentToolName,
} from "@shared/helix-live-agent-step";
import type { LiveSourceTurnPhaseResolutionV1 } from "@shared/contracts/stage-play-live-source-mail.v1";
import { runLiveEnvironmentAgentLoop } from "../services/helix-ask/live-environment-agent-loop";
import { executeLiveEnvironmentTool } from "../services/helix-ask/live-environment-tool-adapter";
import {
  resetInterimVoiceCalloutsForTest,
  retryQueuedInterimVoiceCalloutDeliveries,
} from "../services/helix-ask/interim-voice-callout-store";
import {
  listPendingVoiceSteeringEvents,
  recordVoiceSteeringEvent,
  resetVoiceSteeringEventsForTest,
} from "../services/helix-ask/voice-steering-event-store";
import { runtimeMemoryGovernor } from "../services/runtime/runtime-memory-governor";
import { buildCapabilityPlan } from "../services/helix-ask/capability-planner";
import { evaluateTerminalBoundaryEligibility } from "../services/helix-ask/runtime-authority-contract";
import { buildToolCallAdmissionDecision } from "../services/helix-ask/tool-call-admission";
import {
  WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS,
  executableAliasesForWorkstationContextFeedQuerySpec,
} from "../services/helix-ask/workstation-context-feed-query-tool-contracts";
import { buildLiveEnvironmentRuntimePacket } from "../services/situation-room/live-environment-runtime-packet-builder";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  appendInterpretedEvent,
  clearInterpretedEventLogForTest,
  listInterpretedEvents,
} from "../services/situation-room/interpreted-event-log-store";
import {
  listLiveEnvironmentCommentary,
  resetLiveEnvironmentCommentaryForTest,
} from "../services/situation-room/live-environment-commentary-store";
import { resetSituationSourceCapabilitiesForTest } from "../services/situation-room/situation-source-capability-store";
import { resetLiveSituationRunsForTest } from "../services/situation-room/live-situation-run-store";
import { resetLiveFieldWorkersForTest } from "../services/situation-room/live-field-worker-registry";
import {
  resetSituationConstructStoreForTest,
  upsertSituationConstruct,
} from "../services/situation-room/situation-construct-store";
import { resetStagePlayGoalContextStoreForTest } from "../services/stage-play/stage-play-goal-context-store";

const resetAll = () => {
  resetLiveAnswerEnvironments();
  clearInterpretedEventLogForTest();
  resetLiveEnvironmentCommentaryForTest();
  resetSituationSourceCapabilitiesForTest();
  resetLiveSituationRunsForTest();
  resetLiveFieldWorkersForTest();
  resetSituationConstructStoreForTest();
  resetStagePlayGoalContextStoreForTest();
  resetInterimVoiceCalloutsForTest();
  resetVoiceSteeringEventsForTest();
  runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests();
};

const seedEnvironment = () => createLiveAnswerEnvironment({
  thread_id: "thread:live-env-loop",
  created_turn_id: "turn:seed",
  objective: "Use live environment evidence to answer route and source questions.",
  preset: "minecraft_run_monitor",
  room_id: "room:minecraft",
  source_ids: ["source:minecraft"],
  now: "2026-05-26T12:00:00.000Z",
}).environment;

const lockedRecordDecisionPhase = (): LiveSourceTurnPhaseResolutionV1 => ({
  artifactId: "live_source_turn_phase_resolution",
  schemaVersion: "live_source_turn_phase_resolution/v1",
  phase: "record_decision",
  reason: "Processed packet recommends a voice callout.",
  canonicalGoal: "processed_mail_voice_decision",
  allowedTools: ["live_env.record_live_source_mail_decision"],
  fallbackTools: [],
  forbiddenTools: [
    "live_env.read_processed_live_source_mail",
    "live_env.process_live_source_mail",
    "live_env.request_interim_voice_callout",
    "final_answer",
  ],
  requiredEvidence: ["stage_play_processed_mail_packet"],
  completionEvidence: ["stage_play_live_source_mail_decision"],
  nextPhase: "request_voice_after_decision",
  phaseLock: {
    locked: true,
    reason: "Decision authority must be recorded before voice output.",
  },
  evidenceRefs: ["stage_play_processed_mail_packet:voice"],
  assistant_answer: false,
  terminal_eligible: false,
  context_role: "tool_policy",
});

describe("Helix Ask live environment agent loop", () => {
  beforeEach(resetAll);

  it("builds a model-visible runtime packet with live-env tools as evidence only", () => {
    const environment = seedEnvironment();
    appendInterpretedEvent({
      thread_id: environment.thread_id,
      room_id: environment.room_id,
      source_family: "minecraft_events",
      kind: "tool_trace",
      title: "Route watcher",
      summary: "Route drift candidate exists but policy has not approved surfacing.",
      evidence_refs: ["route_drift:event:1"],
      deterministic: true,
      model_invoked: false,
      created_at: "2026-05-26T12:00:02.000Z",
    });

    const packet = buildLiveEnvironmentRuntimePacket({
      threadId: environment.thread_id,
      environmentId: environment.environment_id,
      now: "2026-05-26T12:00:03.000Z",
    });

    expect(packet.assistant_answer).toBe(false);
    expect(packet.raw_content_included).toBe(false);
    expect(packet.context_role).toBe("tool_evidence");
    expect(packet.available_tools.map((tool) => tool.tool_id)).toEqual(expect.arrayContaining([
      "live_env.query_event_log",
      "live_env.query_constructs",
      "live_env.query_navigation_state",
      "live_env.record_voice_steering",
      "live_env.request_interim_voice_callout",
      "live_env.request_probe",
    ]));
    expect(packet.policy.may_surface_user_text).toBe(false);
    expect(packet.recent_commentary_refs.length).toBeGreaterThan(0);
  });

  it("advertises the goal-directed workstation query and control surface with governed confirmation policy", () => {
    const environment = seedEnvironment();

    const packet = buildLiveEnvironmentRuntimePacket({
      threadId: environment.thread_id,
      environmentId: environment.environment_id,
      now: "2026-05-26T12:00:04.000Z",
    });
    const toolById = new Map(packet.available_tools.map((tool) => [tool.tool_id, tool]));
    const queryTools = [
      "live_env.query_workstation_goal_context",
      "live_env.start_agent_goal_session",
      "live_env.query_trace_memory",
      "live_env.query_packet_traces",
      "live_env.query_visual_summaries",
      "live_env.query_audio_transcripts",
      "live_env.query_translation_segments",
      "live_env.query_microdeck_outputs",
      "live_env.query_live_answer_state",
      "live_env.query_source_health",
      "live_env.query_narrator_events",
      "live_env.query_route_evidence",
      "live_env.query_automation_policies",
      "live_env.evaluate_goal_satisfaction",
    ];
    const controlTools = [
      "live_env.change_workstation_preset",
      "live_env.set_visual_preset",
      "live_env.set_audio_preset",
      "live_env.bind_workstation_source",
      "live_env.unbind_workstation_source",
      "live_env.pause_workstation_loop",
      "live_env.resume_workstation_loop",
      "live_env.set_workstation_loop_state",
      "live_env.repair_loop",
      "live_env.repair_workstation_source",
      "live_env.configure_route_watch",
      "live_env.configure_live_source_watch_job",
      "live_env.update_live_answer_projection",
      "live_env.focus_process_graph",
      "live_env.narrator_say",
      "live_env.narrator_bind_stream",
    ];

    for (const toolId of queryTools) {
      expect(toolById.get(toolId)).toMatchObject({
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      });
    }

    for (const toolId of controlTools) {
      expect(toolById.get(toolId)).toMatchObject({
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: true,
        can_run_automatically: false,
      });
    }
    expect(toolById.get("live_env.narrator_say")).toMatchObject({
      tool_aliases: ["narrator.say", "narrator_say"],
    });
    expect(toolById.get("live_env.narrator_bind_stream")).toMatchObject({
      tool_aliases: ["narrator.bind_stream", "narrator_bind_stream"],
    });
    for (const spec of WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS) {
      expect(toolById.get(spec.capability)).toMatchObject({
        tool_aliases: executableAliasesForWorkstationContextFeedQuerySpec(spec),
      });
    }
  });

  it("projects active AgentGoalSession feed and actuator policy into the model-visible runtime packet", () => {
    const environment = seedEnvironment();
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        room_id: environment.room_id,
        source_id: "visual-source:runtime-packet",
        goal_id: "goal:runtime-packet-context",
        objective: "Monitor the visual source through packet traces and narrator events.",
        context_feeds: ["visual_summaries", "packet_traces", "narrator_events"],
        allowed_actuators: ["query_visual_summaries", "query_packet_traces", "query_narrator_events", "narrator_bind_stream"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const packet = buildLiveEnvironmentRuntimePacket({
      threadId: environment.thread_id,
      environmentId: environment.environment_id,
      now: "2026-05-26T12:00:04.000Z",
    });

    expect(packet.goal_context_snapshot).toMatchObject({
      active_goal_session_count: 1,
      recent_goal_context_update_count: 0,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(packet.goal_context_snapshot?.active_goal_sessions[0]).toMatchObject({
      goal_id: "goal:runtime-packet-context",
      status: "active",
      source_refs: expect.arrayContaining(["visual-source:runtime-packet"]),
      context_feed_kinds: expect.arrayContaining(["visual_summaries", "packet_traces", "narrator_events"]),
      context_feed_refs: expect.arrayContaining([
        expect.stringMatching(/^agent_goal_context_feed:/),
      ]),
      allowed_actuators: expect.arrayContaining([
        "query_visual_summaries",
        "query_packet_traces",
        "query_narrator_events",
        "narrator_bind_stream",
      ]),
      allowed_actuator_refs: expect.arrayContaining([
        "agent_goal_allowed_actuator:query_visual_summaries",
        "agent_goal_allowed_actuator:query_packet_traces",
        "agent_goal_allowed_actuator:query_narrator_events",
        "agent_goal_allowed_actuator:narrator_bind_stream",
      ]),
      checkpoint_refs: expect.arrayContaining([expect.stringMatching(/^stage_play_goal_checkpoint:/)]),
      final_reports_require_terminal_authority: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  });

  it("carries runtime goal-context snapshot refs into loop evidence before terminal review", async () => {
    const environment = seedEnvironment();
    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        room_id: environment.room_id,
        source_id: "visual-source:loop-context",
        goal_id: "goal:loop-context",
        objective: "Keep visual packet context available for terminal review.",
        context_feeds: ["visual_summaries", "packet_traces"],
        allowed_actuators: ["query_visual_summaries", "query_packet_traces"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const loop = await runLiveEnvironmentAgentLoop({
      threadId: environment.thread_id,
      environmentId: environment.environment_id,
      maxIterations: 1,
      now: "2026-05-26T12:00:04.000Z",
      chooser: ({ packet, stepIndex }) => {
        const visibleSession = packet.goal_context_snapshot?.active_goal_sessions.find((session) =>
          session.goal_id === "goal:loop-context"
        );
        expect(packet.goal_context_snapshot?.active_goal_session_count).toBeGreaterThanOrEqual(1);
        expect(visibleSession?.allowed_actuator_refs).toEqual(expect.arrayContaining([
          "agent_goal_allowed_actuator:query_visual_summaries",
          "agent_goal_allowed_actuator:query_packet_traces",
        ]));
        return {
          schema: HELIX_LIVE_AGENT_STEP_DECISION_SCHEMA,
          decision_id: "live_step:runtime_context_terminal_review",
          thread_id: environment.thread_id,
          environment_id: environment.environment_id,
          step_index: stepIndex,
          decision_authority: "model",
          decision_timing: "terminal_review",
          next_step: "answer",
          selected_tool: null,
          tool_args: null,
          rationale_summary: "The model can see goal-context feed policy before terminal review.",
          expected_evidence_kind: null,
          evidence_refs: [],
          assistant_answer: false,
          raw_content_included: false,
        };
      },
    });

    expect(loop.goal_context_snapshot).toMatchObject({
      active_goal_session_count: 1,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(loop.runtime_context_refs).toEqual(expect.arrayContaining([
      "goal:loop-context",
      "visual-source:loop-context",
      "agent_goal_allowed_actuator:query_visual_summaries",
      "agent_goal_allowed_actuator:query_packet_traces",
      "terminal_authority_required:goal:loop-context",
      expect.stringMatching(/^agent_goal_context_feed:/),
      expect.stringMatching(/^stage_play_goal_checkpoint:/),
    ]));
    expect(loop.evidence_refs).toEqual(expect.arrayContaining(loop.runtime_context_refs ?? []));
    expect(loop.transcriptRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rowKind: "goal_context_snapshot",
        title: "Goal context snapshot",
        source: expect.objectContaining({
          toolName: "live_env.runtime_packet",
          artifactKind: "helix.live_environment_runtime_goal_context_snapshot.v1",
        }),
        evidenceRefs: expect.arrayContaining(loop.runtime_context_refs ?? []),
        authority: "tool_evidence",
        assistantAnswer: false,
        terminalEligible: false,
      }),
    ]));
    expect(loop.assistant_answer).toBe(false);
    expect(loop.raw_content_included).toBe(false);
  });

  it("executes advertised workstation tool aliases through the agent loop as canonical non-terminal observations", async () => {
    const environment = seedEnvironment();

    const loop = await runLiveEnvironmentAgentLoop({
      threadId: environment.thread_id,
      environmentId: environment.environment_id,
      maxIterations: 2,
      now: "2026-05-26T12:00:04.000Z",
      chooser: ({ stepIndex }) => stepIndex === 0
        ? {
            schema: HELIX_LIVE_AGENT_STEP_DECISION_SCHEMA,
            decision_id: "live_step:alias_query:0",
            thread_id: environment.thread_id,
            environment_id: environment.environment_id,
            step_index: stepIndex,
            decision_authority: "model",
            decision_timing: "pre_observation",
            next_step: "call_tool",
            selected_tool: "visual_summaries" as HelixLiveEnvironmentToolName,
            tool_args: {
              room_id: environment.room_id,
              source_id: "visual-source:alias-query",
            },
            rationale_summary: "Use the runtime-advertised alias for the visual summaries feed.",
            expected_evidence_kind: "stage_play_workstation_context_feed_query_result",
            evidence_refs: [],
            assistant_answer: false,
            raw_content_included: false,
          }
        : {
            schema: HELIX_LIVE_AGENT_STEP_DECISION_SCHEMA,
            decision_id: "live_step:alias_query:1",
            thread_id: environment.thread_id,
            environment_id: environment.environment_id,
            step_index: stepIndex,
            decision_authority: "model",
            decision_timing: "post_observation",
            next_step: "answer",
            selected_tool: null,
            tool_args: null,
            rationale_summary: "The alias-produced observation has re-entered the loop.",
            expected_evidence_kind: null,
            evidence_refs: ["stage_play_workstation_context_feed_query_result:visual_summaries"],
            assistant_answer: false,
            raw_content_included: false,
          },
    });

    expect(loop.iterations[0]?.tool_observation).toMatchObject({
      tool_name: "live_env.query_visual_summaries",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(loop.iterations[0]?.tool_observation?.observation).toMatchObject({
      requestedToolName: "visual_summaries",
      canonicalToolName: "live_env.query_visual_summaries",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(loop.terminal_decision).toBe("answer_allowed");
  });

  it("records interim voice callout requests as provisional tool evidence", () => {
    const environment = seedEnvironment();

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.request_interim_voice_callout",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        turn_id: "turn:interim-voice",
        kind: "tool_progress",
        text: "I am checking the live environment evidence now.",
        evidence_refs: ["tool_call:query_event_log"],
        reason_codes: ["tool_progress"],
        route_metadata: {
          wakeRequestId: "stage_play_mail_wake:test-voice",
          askTurnId: "ask:test-voice",
        },
      },
    });

    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.request_interim_voice_callout",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    const voicePayload = observation.observation as any;
    expect(observation.producedRefs).toEqual(expect.arrayContaining([
      voicePayload.request.requestId,
      voicePayload.receipt.receiptId,
    ]));
    expect(observation.artifactRefs).toMatchObject({
      voiceReceiptIds: expect.arrayContaining([voicePayload.receipt.receiptId]),
      wakeRequestId: "stage_play_mail_wake:test-voice",
      askTurnId: "ask:test-voice",
    });
    expect(observation.observation).toMatchObject({
      schema: "helix.interim_voice_callout_tool_result.v1",
      request: {
        artifactId: "helix_interim_voice_callout_request",
        turnId: "turn:interim-voice",
        threadId: environment.thread_id,
        voicePlaybackKind: "tool_receipt",
        authority: "provisional",
        assistant_answer: false,
        terminal_eligible: false,
      },
      receipt: {
        artifactId: "helix_interim_voice_callout_receipt",
        status: "awaiting_client_playback",
        delivery: {
          playbackConfirmationRequired: true,
          playbackAuthority: "client_runtime_required",
          playbackStatus: "awaiting_client_receipt",
        },
        assistant_answer: false,
        terminal_eligible: false,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("records voice steering as queued tool evidence for the active turn", () => {
    const environment = seedEnvironment();

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.record_voice_steering",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        turn_id: "turn:voice-steering",
        expected_turn_id: "turn:voice-steering",
        transcript_text: "Actually use meters instead.",
        source: "voice_capture",
        timing: "during_tool_call",
        evidence_refs: ["voice_transcript:1"],
        reason_codes: ["operator_correction"],
      },
    });

    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.record_voice_steering",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(observation.observation).toMatchObject({
      schema: "helix.voice_steering_tool_result.v1",
      queuedForSafeBoundary: true,
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
      steeringEvent: {
        artifactId: "helix_voice_steering_event",
        turnId: "turn:voice-steering",
        expectedTurnId: "turn:voice-steering",
        classification: "correction",
        queueDecision: "queued_for_safe_boundary",
        target: "active_turn",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        instruction_authority: "none",
        ask_instruction_authority: "none",
        context_role: "tool_evidence",
        ask_context_policy: "evidence_only",
      },
    });
    expect((observation as any).transcriptRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rowKind: "voice_steering_received",
        title: "Voice steering received",
        body: "Actually use meters instead.",
        authority: "tool_evidence",
        assistantAnswer: false,
        terminalEligible: false,
      }),
      expect.objectContaining({
        rowKind: "voice_steering_queued",
        title: "Voice steering queued",
        authority: "tool_evidence",
        assistantAnswer: false,
        terminalEligible: false,
      }),
    ]));
    expect(observation.evidence_refs).toEqual(expect.arrayContaining(["voice_transcript:1"]));
    const steeringEvent = (observation.observation as any).steeringEvent;
    expect(observation.evidence_refs).toContain(steeringEvent.steeringEventId);
    expect(listPendingVoiceSteeringEvents({
      threadId: environment.thread_id,
      turnId: "turn:voice-steering",
    }).map((event) => event.steeringEventId)).toEqual([steeringEvent.steeringEventId]);
  });

  it("allows one immediate voice ack per turn and keeps later status callouts available", () => {
    const environment = seedEnvironment();

    const firstAck = executeLiveEnvironmentTool({
      tool_name: "live_env.request_interim_voice_callout",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        turn_id: "turn:immediate-ack",
        kind: "immediate_ack",
        text: "Okay, I will check that now and keep the full answer separate.",
        max_chars: 220,
        timing_hint_ms: 800,
        reason_codes: ["immediate_ack"],
      },
    });

    expect(firstAck.ok).toBe(true);
    expect(firstAck.observation).toMatchObject({
      request: {
        kind: "immediate_ack",
        maxChars: 96,
        timingHintMs: 800,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      receipt: {
        status: "awaiting_client_playback",
        assistant_answer: false,
        terminal_eligible: false,
      },
      post_tool_model_step_required: true,
    });

    const duplicateAck = executeLiveEnvironmentTool({
      tool_name: "live_env.request_interim_voice_callout",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        turn_id: "turn:immediate-ack",
        kind: "immediate_ack",
        text: "Still starting.",
      },
    });

    expect(duplicateAck.ok).toBe(false);
    expect(duplicateAck.observation).toMatchObject({
      request: {
        kind: "immediate_ack",
        assistant_answer: false,
        terminal_eligible: false,
      },
      receipt: {
        status: "blocked_policy",
        assistant_answer: false,
        terminal_eligible: false,
      },
    });

    const progress = executeLiveEnvironmentTool({
      tool_name: "live_env.request_interim_voice_callout",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        turn_id: "turn:immediate-ack",
        kind: "tool_progress",
        text: "I found the live-source mailbox and I am checking the latest item.",
        evidence_refs: ["tool_call:read_live_source_mail"],
        reason_codes: ["tool_progress"],
      },
    });

    expect(progress.ok).toBe(true);
    expect(progress.observation).toMatchObject({
      request: {
        kind: "tool_progress",
        assistant_answer: false,
        terminal_eligible: false,
      },
      receipt: {
        status: "awaiting_client_playback",
        assistant_answer: false,
        terminal_eligible: false,
      },
    });
  });

  it("allows one steering acknowledgement per voice steering event without blocking immediate ack", () => {
    const environment = seedEnvironment();
    const steeringEventId = "helix_voice_steering_event:ack-1";
    const steeringDecisionId = "helix_voice_steering_decision:ack-1";

    const immediateAck = executeLiveEnvironmentTool({
      tool_name: "live_env.request_interim_voice_callout",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        turn_id: "turn:steering-ack",
        kind: "immediate_ack",
        text: "Okay, I will check that now.",
        reason_codes: ["immediate_ack"],
      },
    });
    expect(immediateAck.ok).toBe(true);

    const steeringAck = executeLiveEnvironmentTool({
      tool_name: "live_env.request_interim_voice_callout",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        turn_id: "turn:steering-ack",
        kind: "steering_ack",
        source: "voice_steering_queue",
        text: "I heard the correction. I'll apply it after this step.",
        max_chars: 220,
        evidence_refs: [steeringEventId, steeringDecisionId],
        reason_codes: ["voice_steering_ack"],
      },
    });

    expect(steeringAck.ok).toBe(true);
    expect(steeringAck.observation).toMatchObject({
      request: {
        kind: "steering_ack",
        source: "voice_steering_queue",
        maxChars: 96,
        voicePlaybackKind: "tool_receipt",
        authority: "provisional",
        evidenceRefs: [steeringEventId, steeringDecisionId],
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      receipt: {
        status: "awaiting_client_playback",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      post_tool_model_step_required: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect((steeringAck as any).transcriptRows).toEqual([
      expect.objectContaining({
        rowKind: "steering_ack_receipt",
        title: "Steering acknowledgement receipt",
        body: "I heard the correction. I'll apply it after this step.",
        authority: "tool_evidence",
        assistantAnswer: false,
        terminalEligible: false,
      }),
    ]);

    const duplicateAck = executeLiveEnvironmentTool({
      tool_name: "live_env.request_interim_voice_callout",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        turn_id: "turn:steering-ack",
        kind: "steering_ack",
        source: "voice_steering_queue",
        text: "I heard that. I'll fold it in next.",
        evidence_refs: [steeringEventId],
      },
    });

    expect(duplicateAck.ok).toBe(false);
    expect(duplicateAck.observation).toMatchObject({
      receipt: {
        status: "blocked_policy",
        delivery: {
          message: "Only one steering acknowledgement may be queued per voice steering event.",
        },
      },
    });
  });

  it("blocks steering acknowledgements without steering evidence or with final-answer claims", () => {
    const environment = seedEnvironment();

    const missingRef = executeLiveEnvironmentTool({
      tool_name: "live_env.request_interim_voice_callout",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        turn_id: "turn:steering-ack-policy",
        kind: "steering_ack",
        source: "voice_steering_queue",
        text: "I heard the correction. I'll apply it after this step.",
        evidence_refs: ["helix_voice_steering_decision:missing-event"],
      },
    });

    expect(missingRef.ok).toBe(false);
    expect(missingRef.observation).toMatchObject({
      receipt: {
        status: "blocked_policy",
        delivery: {
          message: "Steering acknowledgements require a voice steering event evidence ref.",
        },
      },
    });

    const finalClaim = executeLiveEnvironmentTool({
      tool_name: "live_env.request_interim_voice_callout",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        turn_id: "turn:steering-ack-policy",
        kind: "steering_ack",
        source: "voice_steering_queue",
        text: "The final answer is complete.",
        evidence_refs: ["helix_voice_steering_event:final-claim"],
      },
    });

    expect(finalClaim.ok).toBe(false);
    expect(finalClaim.observation).toMatchObject({
      request: {
        kind: "steering_ack",
        authority: "provisional",
        assistant_answer: false,
        terminal_eligible: false,
      },
      receipt: {
        status: "blocked_policy",
        delivery: {
          message: "Steering acknowledgements cannot claim final answer status.",
        },
      },
    });
  });

  it("queues interim voice callouts for retry when voice TTS capacity is occupied", () => {
    const environment = seedEnvironment();
    const occupied = runtimeMemoryGovernor.admitRuntimeTask({
      taskClass: "voice_tts",
      source: "test.voice_tts_occupied",
    });
    expect(occupied.admitted).toBe(true);

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.request_interim_voice_callout",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        turn_id: "turn:interim-voice-capacity",
        kind: "tool_progress",
        text: "I am still checking the evidence.",
        evidence_refs: ["tool_call:query_event_log"],
      },
    });

    expect(observation.ok).toBe(true);
    expect(observation.assistant_answer).toBe(false);
    expect(observation.observation).toMatchObject({
      request: {
        assistant_answer: false,
        terminal_eligible: false,
      },
      receipt: {
        status: "queued_for_retry",
        assistant_answer: false,
        terminal_eligible: false,
      },
    });
    occupied.lease?.release("completed");

    const retryReceipts = retryQueuedInterimVoiceCalloutDeliveries({
      threadId: environment.thread_id,
      turnId: "turn:interim-voice-capacity",
      force: true,
    });

    expect(retryReceipts.at(-1)).toMatchObject({
      status: "awaiting_client_playback",
      delivery: {
        utteranceId: expect.stringContaining("interim_voice:"),
        playbackConfirmationRequired: true,
        playbackAuthority: "client_runtime_required",
        playbackStatus: "awaiting_client_receipt",
      },
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("runs model-chosen live-env tool steps before terminal answer permission", async () => {
    const environment = seedEnvironment();
    appendInterpretedEvent({
      thread_id: environment.thread_id,
      room_id: environment.room_id,
      source_family: "minecraft_events",
      kind: "tool_trace",
      title: "Navigation state check",
      summary: "Navigation state says route_status=wrong_direction_candidate.",
      evidence_refs: ["navigation_state:1"],
      deterministic: true,
      model_invoked: false,
      created_at: "2026-05-26T12:00:02.000Z",
    });

    const loop = await runLiveEnvironmentAgentLoop({
      threadId: environment.thread_id,
      environmentId: environment.environment_id,
      maxIterations: 3,
      now: "2026-05-26T12:00:05.000Z",
      chooser: ({ stepIndex }) => stepIndex === 0
        ? {
            schema: HELIX_LIVE_AGENT_STEP_DECISION_SCHEMA,
            decision_id: "live_step:query_event_log",
            thread_id: environment.thread_id,
            environment_id: environment.environment_id,
            step_index: stepIndex,
            decision_authority: "model",
            decision_timing: "pre_observation",
            next_step: "call_tool",
            selected_tool: "live_env.query_event_log",
            tool_args: { limit: 10 },
            rationale_summary: "Read the event/commentary feed before answering.",
            expected_evidence_kind: "interpreted_event_log",
            evidence_refs: [],
            assistant_answer: false,
            raw_content_included: false,
          }
        : {
            schema: HELIX_LIVE_AGENT_STEP_DECISION_SCHEMA,
            decision_id: "live_step:answer",
            thread_id: environment.thread_id,
            environment_id: environment.environment_id,
            step_index: stepIndex,
            decision_authority: "model",
            decision_timing: "post_observation",
            next_step: "answer",
            selected_tool: null,
            tool_args: null,
            rationale_summary: "The compact event log has enough evidence for terminal Ask review.",
            expected_evidence_kind: null,
            evidence_refs: ["navigation_state:1"],
            assistant_answer: false,
            raw_content_included: false,
          },
    });

    expect(loop.schema).toBe("helix.live_environment_agent_loop.v1");
    expect(loop.terminal_decision).toBe("answer_allowed");
    expect(loop.assistant_answer).toBe(false);
    expect(loop.raw_content_included).toBe(false);
    expect(loop.iterations).toHaveLength(2);
    expect(loop.iterations[0]?.step_decision.decision_authority).toBe("model");
    expect(loop.iterations[0]?.tool_observation).toMatchObject({
      tool_name: "live_env.query_event_log",
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(loop.evidence_refs).toEqual(expect.arrayContaining(["navigation_state:1"]));
  });

  it("forces locked live-source phase tools before terminal answers", async () => {
    const environment = seedEnvironment();
    const phase = lockedRecordDecisionPhase();

    const loop = await runLiveEnvironmentAgentLoop({
      threadId: environment.thread_id,
      environmentId: environment.environment_id,
      maxIterations: 2,
      now: "2026-05-26T12:00:05.000Z",
      phaseResolver: ({ history }) => history.length === 0 ? phase : null,
      chooser: ({ stepIndex }) => ({
        schema: HELIX_LIVE_AGENT_STEP_DECISION_SCHEMA,
        decision_id: `live_step:premature_answer:${stepIndex}`,
        thread_id: environment.thread_id,
        environment_id: environment.environment_id,
        step_index: stepIndex,
        decision_authority: "model",
        decision_timing: stepIndex === 0 ? "pre_observation" : "post_observation",
        next_step: "answer",
        selected_tool: null,
        tool_args: null,
        rationale_summary: "The model tried to answer before the live-source mail decision receipt existed.",
        expected_evidence_kind: null,
        evidence_refs: [],
        assistant_answer: false,
        raw_content_included: false,
      }),
    });

    expect(loop.iterations[0]?.step_decision).toMatchObject({
      decision_authority: "deterministic_policy_fallback",
      next_step: "call_tool",
      selected_tool: "live_env.record_live_source_mail_decision",
      expected_evidence_kind: "stage_play_live_source_mail_decision",
    });
    expect(loop.iterations[0]?.step_decision.tool_args).toMatchObject({
      processed_packet_ids: ["stage_play_processed_mail_packet:voice"],
      live_source_mail_output_intent: expect.objectContaining({
        wantsVoiceCallout: true,
      }),
    });
    expect(loop.iterations[0]?.tool_observation?.tool_name).toBe("live_env.record_live_source_mail_decision");
    expect(loop.iterations[1]?.step_decision.next_step).toBe("answer");
    expect(loop.terminal_decision).toBe("answer_allowed");
  });

  it("forbids repeated read/process choices while record_decision is mandatory", async () => {
    const environment = seedEnvironment();
    const phase = lockedRecordDecisionPhase();

    const loop = await runLiveEnvironmentAgentLoop({
      threadId: environment.thread_id,
      environmentId: environment.environment_id,
      maxIterations: 1,
      now: "2026-05-26T12:00:05.000Z",
      phaseResolver: () => phase,
      chooser: ({ stepIndex }) => ({
        schema: HELIX_LIVE_AGENT_STEP_DECISION_SCHEMA,
        decision_id: `live_step:stale_read:${stepIndex}`,
        thread_id: environment.thread_id,
        environment_id: environment.environment_id,
        step_index: stepIndex,
        decision_authority: "model",
        decision_timing: "pre_observation",
        next_step: "call_tool",
        selected_tool: "live_env.read_processed_live_source_mail",
        tool_args: {},
        rationale_summary: "The model tried to repeat the processed-mail read instead of recording the decision.",
        expected_evidence_kind: "stage_play_processed_mail_packet",
        evidence_refs: [],
        assistant_answer: false,
        raw_content_included: false,
      }),
    });

    expect(loop.iterations).toHaveLength(1);
    expect(loop.iterations[0]?.step_decision).toMatchObject({
      decision_authority: "deterministic_policy_fallback",
      next_step: "call_tool",
      selected_tool: "live_env.record_live_source_mail_decision",
      expected_evidence_kind: "stage_play_live_source_mail_decision",
    });
    expect(loop.iterations[0]?.tool_observation?.tool_name).toBe("live_env.record_live_source_mail_decision");
    expect(loop.terminal_decision).toBe("budget_exhausted");
    expect(loop.evidence_refs).toContain("live_source_turn_phase_resolution");
  });

  it("uses the remaining budget for mandatory live-source decisions instead of stale generic fallback", async () => {
    const environment = seedEnvironment();
    const phase = lockedRecordDecisionPhase();

    const loop = await runLiveEnvironmentAgentLoop({
      threadId: environment.thread_id,
      environmentId: environment.environment_id,
      maxIterations: 1,
      now: "2026-05-26T12:00:05.000Z",
      phaseResolver: () => phase,
      chooser: ({ stepIndex }) => ({
        schema: HELIX_LIVE_AGENT_STEP_DECISION_SCHEMA,
        decision_id: `live_step:stale_failure:${stepIndex}`,
        thread_id: environment.thread_id,
        environment_id: environment.environment_id,
        step_index: stepIndex,
        decision_authority: "model",
        decision_timing: "pre_observation",
        next_step: "fail_closed",
        selected_tool: null,
        tool_args: null,
        rationale_summary: "The model tried to fail closed before the mandatory decision receipt existed.",
        expected_evidence_kind: null,
        evidence_refs: [],
        assistant_answer: false,
        raw_content_included: false,
      }),
    });

    expect(loop.iterations).toHaveLength(1);
    expect(loop.iterations[0]?.step_decision).toMatchObject({
      decision_authority: "deterministic_policy_fallback",
      next_step: "call_tool",
      selected_tool: "live_env.record_live_source_mail_decision",
    });
    expect(loop.terminal_decision).toBe("budget_exhausted");
    expect(loop.iterations[0]?.tool_observation).toMatchObject({
      tool_name: "live_env.record_live_source_mail_decision",
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("fails closed with missing_required_mailbox_tool_execution when a locked phase tool is unavailable", async () => {
    const environment = seedEnvironment();
    const phase: LiveSourceTurnPhaseResolutionV1 = {
      ...lockedRecordDecisionPhase(),
      allowedTools: ["live_env.not_registered_for_phase"],
    };

    const loop = await runLiveEnvironmentAgentLoop({
      threadId: environment.thread_id,
      environmentId: environment.environment_id,
      maxIterations: 1,
      now: "2026-05-26T12:00:05.000Z",
      phaseResolver: () => phase,
      chooser: ({ stepIndex }) => ({
        schema: HELIX_LIVE_AGENT_STEP_DECISION_SCHEMA,
        decision_id: `live_step:premature_answer_unavailable:${stepIndex}`,
        thread_id: environment.thread_id,
        environment_id: environment.environment_id,
        step_index: stepIndex,
        decision_authority: "model",
        decision_timing: "pre_observation",
        next_step: "answer",
        selected_tool: null,
        tool_args: null,
        rationale_summary: "The model tried to answer before the mandatory tool existed.",
        expected_evidence_kind: null,
        evidence_refs: [],
        assistant_answer: false,
        raw_content_included: false,
      }),
    });

    expect(loop.terminal_decision).toBe("fail_closed");
    expect(loop.iterations[0]?.step_decision).toMatchObject({
      decision_authority: "deterministic_policy_fallback",
      next_step: "call_tool",
      selected_tool: "live_env.not_registered_for_phase",
    });
    expect(loop.iterations[0]?.tool_observation).toMatchObject({
      ok: false,
      tool_name: "live_env.not_registered_for_phase",
      terminal_eligible: false,
      summary: expect.stringContaining("missing_required_mailbox_tool_execution"),
      observation: expect.objectContaining({
        failure_code: "missing_required_mailbox_tool_execution",
        terminal_eligible: false,
      }),
    });
    expect(loop.evidence_refs).toContain("missing_required_mailbox_tool_execution");
  });

  it("fails closed with missing_voice_callout_draft when mandatory voice tool has no draft", async () => {
    const environment = seedEnvironment();
    const phase: LiveSourceTurnPhaseResolutionV1 = {
      ...lockedRecordDecisionPhase(),
      phase: "request_voice_after_decision",
      allowedTools: ["live_env.request_interim_voice_callout"],
      forbiddenTools: ["final_answer", "live_env.record_live_source_mail_decision"],
      completionEvidence: ["live_source_interim_voice_callout_receipt"],
      phaseLock: {
        locked: true,
        reason: "Voice output is only allowed after a recorded request_voice_callout decision.",
      },
    };

    const loop = await runLiveEnvironmentAgentLoop({
      threadId: environment.thread_id,
      environmentId: environment.environment_id,
      maxIterations: 1,
      now: "2026-05-26T12:00:05.000Z",
      phaseResolver: () => phase,
      chooser: ({ stepIndex }) => ({
        schema: HELIX_LIVE_AGENT_STEP_DECISION_SCHEMA,
        decision_id: `live_step:premature_voice_answer:${stepIndex}`,
        thread_id: environment.thread_id,
        environment_id: environment.environment_id,
        step_index: stepIndex,
        decision_authority: "model",
        decision_timing: "pre_observation",
        next_step: "answer",
        selected_tool: null,
        tool_args: null,
        rationale_summary: "The model tried to answer before voice receipt.",
        expected_evidence_kind: null,
        evidence_refs: [],
        assistant_answer: false,
        raw_content_included: false,
      }),
    });

    expect(loop.terminal_decision).toBe("fail_closed");
    expect(loop.iterations[0]?.step_decision).toMatchObject({
      selected_tool: "live_env.request_interim_voice_callout",
      tool_args: expect.not.objectContaining({
        text: expect.any(String),
      }),
    });
    expect(loop.iterations[0]?.tool_observation).toMatchObject({
      ok: false,
      tool_name: "live_env.request_interim_voice_callout",
      terminal_eligible: false,
      summary: expect.stringContaining("missing_voice_callout_draft"),
      observation: expect.objectContaining({
        failure_code: "missing_voice_callout_draft",
        terminal_eligible: false,
      }),
    });
    expect(loop.evidence_refs).toContain("missing_voice_callout_draft");
  });

  it("drains pending voice steering before the next model step as compact evidence", async () => {
    const environment = seedEnvironment();
    const steering = recordVoiceSteeringEvent({
      threadId: environment.thread_id,
      turnId: "turn:steering-loop",
      transcriptText: "Actually use meters per second, not feet.",
      evidenceRefs: ["voice_transcript:unit-correction"],
      capturedAt: "2026-05-26T12:00:04.000Z",
    });
    const packets: any[] = [];

    const loop = await runLiveEnvironmentAgentLoop({
      threadId: environment.thread_id,
      turnId: "turn:steering-loop",
      environmentId: environment.environment_id,
      maxIterations: 1,
      now: "2026-05-26T12:00:05.000Z",
      chooser: ({ packet, stepIndex }) => {
        packets.push(packet);
        return {
          schema: HELIX_LIVE_AGENT_STEP_DECISION_SCHEMA,
          decision_id: "live_step:answer-after-steering",
          thread_id: environment.thread_id,
          environment_id: environment.environment_id,
          step_index: stepIndex,
          decision_authority: "model",
          decision_timing: "pre_observation",
          next_step: "answer",
          selected_tool: null,
          tool_args: null,
          rationale_summary: "Voice steering is available as evidence for terminal review.",
          expected_evidence_kind: null,
          evidence_refs: [steering.steeringEventId],
          assistant_answer: false,
          raw_content_included: false,
        };
      },
    });

    expect(packets).toHaveLength(1);
    expect(packets[0]).toMatchObject({
      pending_voice_steering_refs: [steering.steeringEventId],
      voice_steering_summary: {
        count: 1,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        context_role: "tool_evidence",
        ask_context_policy: "evidence_only",
      },
    });
    expect(packets[0].voice_steering_summary.items[0]).toMatchObject({
      steeringEventId: steering.steeringEventId,
      classification: "correction",
      modelVisibleSummary: "User voice steering received: Actually use meters per second, not feet.",
      confidence: "high",
      evidenceRefs: expect.arrayContaining([steering.steeringEventId, "voice_transcript:unit-correction"]),
    });
    expect(listPendingVoiceSteeringEvents({
      threadId: environment.thread_id,
      turnId: "turn:steering-loop",
    })).toEqual([]);
    expect(loop.terminal_decision).toBe("answer_allowed");
    expect(loop.evidence_refs).toContain(steering.steeringEventId);
    expect(loop.transcriptRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rowKind: "voice_steering_applied",
        title: "Voice steering applied",
        body: "User voice steering received: Actually use meters per second, not feet.",
        authority: "tool_evidence",
        assistantAnswer: false,
        terminalEligible: false,
      }),
    ]));
  });

  it("records live commentary as interpreted evidence, not an assistant answer", () => {
    const environment = seedEnvironment();

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.record_commentary",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        kind: "agentic_review",
        title: "Route evidence review",
        summary: "Route watcher needs another world-event sample before surfacing.",
        evidence_refs: ["route_rehearsal:1"],
        confidence: 0.61,
      },
    });

    const events = listInterpretedEvents({
      threadId: environment.thread_id,
      roomId: environment.room_id,
      limit: 10,
    });
    const commentary = listLiveEnvironmentCommentary({
      threadId: environment.thread_id,
      roomId: environment.room_id,
      limit: 10,
    });

    expect(observation.assistant_answer).toBe(false);
    expect(observation.raw_content_included).toBe(false);
    expect(observation.context_role).toBe("tool_evidence");
    expect(observation.evidence_refs.some((ref) => ref.startsWith("live_commentary:"))).toBe(true);
    expect(commentary.at(-1)).toMatchObject({
      schema: "helix.live_environment_commentary.v1",
      kind: "field_evaluation",
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
    });
    expect(events.at(-1)).toMatchObject({
      kind: "line_tool_evaluation",
      assistant_answer: false,
      raw_logs_included: false,
    });
    expect(events.at(-1)?.evidence_refs).toContain(commentary.at(-1)?.commentary_id);
  });

  it("queries Situation Room constructs as evidence-only live environment tool observations", () => {
    const environment = seedEnvironment();
    const construct = upsertSituationConstruct({
      construct_id: "construct:dottie:test",
      type: "observer",
      name: "Auntie Dottie",
      status: "active",
      thread_id: environment.thread_id,
      room_id: environment.room_id ?? "room:minecraft",
      environment_id: environment.environment_id,
      source_ids: ["source:minecraft"],
      artifact_refs: ["dottie:observer:receipt"],
      receipt_refs: ["dottie:observer:receipt"],
      evidence_refs: ["agent_commentary:orientation"],
      output_bindings: [
        {
          output_kind: "typed_commentary",
          artifact_ref: "agent_commentary:orientation",
          status: "active",
        },
      ],
    });

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_constructs",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        room_id: environment.room_id,
        type: "observer",
        status: "active",
        limit: 10,
      },
    });

    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.query_constructs",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(observation.observation).toMatchObject({
      schema: "helix.situation_construct_query_result.v1",
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
      constructs: expect.arrayContaining([
        expect.objectContaining({
          construct_id: construct.construct_id,
          type: "observer",
          status: "active",
          safety: expect.objectContaining({
            assistant_answer: false,
            ask_context_policy: "evidence_only",
          }),
        }),
      ]),
    });
    expect(observation.evidence_refs).toEqual(expect.arrayContaining([
      construct.construct_id,
      "dottie:observer:receipt",
      "agent_commentary:orientation",
    ]));
  });

  it("admits live environment review as evidence-only capability authority", () => {
    const turnId = "turn:live-env-admission";
    const promptText = "Dottie, check the live environment event log and route context before answering.";
    const sourceTargetIntent = {
      schema: "helix.ask_source_target_intent.v1",
      target_source: "live_environment",
      target_kind: "live_environment",
      suppressed_routes: [],
    };
    const routeProductContract = {
      source_target: "live_environment",
      forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_only_concept"],
    };
    const admission = buildToolCallAdmissionDecision({
      turnId,
      sourceTargetIntent,
      routeProductContract,
      promptText,
    });
    const plan = buildCapabilityPlan({
      turnId,
      promptText,
      sourceTargetIntent,
      routeProductContract,
      toolCallAdmissionDecision: admission,
      canonicalGoalFrame: {
        goal_kind: "live_environment_review",
        required_terminal_kind: "live_environment_tool_observation",
      },
    });
    const report = evaluateTerminalBoundaryEligibility({
      canonical_goal_frame: {
        goal_kind: "live_environment_review",
      },
      terminal_artifact_kind: "live_environment_tool_observation",
      final_answer_source: "artifact_synthesis",
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "decision:1",
            chosen_capability: "live_env.query_event_log",
            decision_timing: "pre_action",
            decision_authority: "deterministic_policy_fallback",
            observed_artifact_refs: ["artifact:live-env-tool"],
          },
          {
            decision_id: "decision:2",
            next_step: "answer",
            decision_timing: "post_observation",
            decision_authority: "deterministic_policy_fallback",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "artifact:live-env-tool",
          kind: "live_environment_tool_observation",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.query_event_log",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    });

    expect(admission.required).toBe(true);
    expect(admission.admitted_tool_families).toContain("live_environment");
    expect(admission.forbidden_terminal_artifact_kinds).toContain("direct_answer_text");
    expect(plan.capability_family).toBe("live_environment");
    expect(plan.admission_status).toBe("needs_evidence");
    expect(report.checks.selected_capability_observation).toBe(true);
    expect(report.eligible).toBe(true);
  });
});
