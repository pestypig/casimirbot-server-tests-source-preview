import { describe, expect, it } from "vitest";

import {
  LIVE_SOURCE_TURN_PHASE_TABLE,
  isLockedExecutableLiveSourcePhase,
  mandatoryToolForPhase,
  resolveLiveSourceTurnPhase,
} from "../services/helix-ask/live-source-turn-phase-resolver";
import { WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS } from "../services/helix-ask/workstation-context-feed-query-tool-contracts";

describe("resolveLiveSourceTurnPhase", () => {
  it("aligns context-feed query phases with the canonical workstation query contract", () => {
    for (const spec of WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS) {
      const entry = LIVE_SOURCE_TURN_PHASE_TABLE[spec.actuator];
      expect(entry).toMatchObject({
        allowedTools: [spec.capability],
        fallbackTools: [],
        requiredEvidence: [spec.plannerExpectedReceiptKind],
        completionEvidence: [spec.plannerExpectedReceiptKind],
        next: "terminal_checkpoint",
        terminalAllowed: false,
      });
      expect(entry.forbiddenTools).toEqual(expect.arrayContaining([
        "live_env.query_workstation_goal_context",
        "live_env.read_processed_live_source_mail",
        "live_env.process_live_source_mail",
        "live_env.record_live_source_mail_decision",
        "live_env.request_interim_voice_callout",
        "final_answer",
      ]));
      for (const otherSpec of WORKSTATION_CONTEXT_FEED_QUERY_TOOL_CONTRACT_SPECS) {
        if (otherSpec.capability === spec.capability) continue;
        expect(entry.forbiddenTools).toContain(otherSpec.capability);
      }
    }
  });

  it("defines the core phase transition table for live-source tool admission", () => {
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.configure_interpreter_profile).toMatchObject({
      allowedTools: ["live_env.configure_interpreter_profile"],
      completionEvidence: ["stage_play_live_source_interpreter_profile"],
      next: "terminal_checkpoint",
    });
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.configure_interpreter_profile.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.request_interim_voice_callout",
    ]));
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.read_processed_mail).toMatchObject({
      allowedTools: ["live_env.read_processed_live_source_mail"],
      fallbackTools: ["live_env.process_live_source_mail"],
      completionEvidence: ["stage_play_processed_mail_packet"],
      next: "record_decision",
    });
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.query_micro_reasoner_deck).toMatchObject({
      allowedTools: ["live_env.query_micro_reasoner_presets"],
      fallbackTools: [],
      requiredEvidence: ["stage_play_micro_reasoner_prompt_preset_query_result"],
      completionEvidence: ["stage_play_micro_reasoner_prompt_preset_query_result"],
      next: "terminal_checkpoint",
    });
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.query_micro_reasoner_deck.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
    ]));
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.query_workstation_goal_context).toMatchObject({
      allowedTools: ["live_env.query_workstation_goal_context"],
      fallbackTools: [],
      requiredEvidence: ["stage_play_workstation_goal_context_read_result"],
      completionEvidence: ["stage_play_workstation_goal_context_read_result"],
      next: "terminal_checkpoint",
    });
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.query_workstation_goal_context.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
      "final_answer",
    ]));
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.query_packet_traces).toMatchObject({
      allowedTools: ["live_env.query_packet_traces"],
      fallbackTools: [],
      requiredEvidence: ["stage_play_packet_trace_query_result"],
      completionEvidence: ["stage_play_packet_trace_query_result"],
      next: "terminal_checkpoint",
    });
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.query_packet_traces.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.query_workstation_goal_context",
      "live_env.query_trace_memory",
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "final_answer",
    ]));
    for (const [phaseName, toolName, requiredEvidence] of [
      ["query_visual_summaries", "live_env.query_visual_summaries", "stage_play_workstation_context_feed_query_result"],
      ["query_audio_transcripts", "live_env.query_audio_transcripts", "stage_play_workstation_context_feed_query_result"],
      ["query_translation_segments", "live_env.query_translation_segments", "stage_play_workstation_context_feed_query_result"],
      ["query_microdeck_outputs", "live_env.query_microdeck_outputs", "stage_play_workstation_context_feed_query_result"],
      ["query_live_answer_state", "live_env.query_live_answer_state", "stage_play_workstation_context_feed_query_result"],
      ["query_source_health", "live_env.query_source_health", "helix.situation_source_capability_read.v1"],
    ] as const) {
      expect(LIVE_SOURCE_TURN_PHASE_TABLE[phaseName]).toMatchObject({
        allowedTools: [toolName],
        fallbackTools: [],
        requiredEvidence: [requiredEvidence],
        completionEvidence: [requiredEvidence],
        next: "terminal_checkpoint",
      });
      expect(LIVE_SOURCE_TURN_PHASE_TABLE[phaseName].forbiddenTools).toEqual(expect.arrayContaining([
        "live_env.query_workstation_goal_context",
        "live_env.query_trace_memory",
        "live_env.query_packet_traces",
        "live_env.read_processed_live_source_mail",
        "live_env.process_live_source_mail",
        "final_answer",
      ]));
    }
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.query_route_evidence).toMatchObject({
      allowedTools: ["live_env.query_route_evidence"],
      fallbackTools: [],
      requiredEvidence: ["stage_play_workstation_context_feed_query_result"],
      completionEvidence: ["stage_play_workstation_context_feed_query_result"],
      next: "terminal_checkpoint",
    });
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.query_route_evidence.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.query_workstation_goal_context",
      "live_env.query_trace_memory",
      "live_env.query_packet_traces",
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "final_answer",
    ]));
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.query_automation_policies).toMatchObject({
      allowedTools: ["live_env.query_automation_policies"],
      fallbackTools: [],
      requiredEvidence: ["stage_play_workstation_context_feed_query_result"],
      completionEvidence: ["stage_play_workstation_context_feed_query_result"],
      next: "terminal_checkpoint",
    });
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.query_automation_policies.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.query_workstation_goal_context",
      "live_env.query_trace_memory",
      "live_env.query_packet_traces",
      "live_env.query_route_evidence",
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "final_answer",
    ]));
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.query_narrator_events).toMatchObject({
      allowedTools: ["live_env.query_narrator_events"],
      fallbackTools: [],
      requiredEvidence: ["stage_play_workstation_context_feed_query_result"],
      completionEvidence: ["stage_play_workstation_context_feed_query_result"],
      next: "terminal_checkpoint",
    });
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.query_narrator_events.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.query_workstation_goal_context",
      "live_env.query_trace_memory",
      "live_env.query_packet_traces",
      "live_env.query_route_evidence",
      "live_env.query_automation_policies",
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "final_answer",
    ]));
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.dispatch_workstation_control).toMatchObject({
      allowedTools: expect.arrayContaining([
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
        "live_env.update_live_answer_projection",
        "live_env.focus_process_graph",
        "live_env.narrator_say",
        "live_env.narrator_bind_stream",
        "live_env.start_agent_goal_session",
      ]),
      fallbackTools: [],
      requiredEvidence: expect.arrayContaining([
        "stage_play_workstation_control_receipt",
        "helix.narrator_say_request",
        "helix.narrator_bind_stream_request",
        "stage_play_agent_goal_session_tool_result",
      ]),
      completionEvidence: expect.arrayContaining([
        "stage_play_workstation_control_receipt",
        "helix.narrator_say_request",
        "helix.narrator_bind_stream_request",
        "stage_play_agent_goal_session_tool_result",
      ]),
      next: "terminal_checkpoint",
    });
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.dispatch_workstation_control.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
      "final_answer",
    ]));
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.reflect_mail_loop).toMatchObject({
      allowedTools: ["live_env.reflect_live_source_mail_loop"],
      fallbackTools: [],
      requiredEvidence: ["stage_play_live_source_mail_loop_reflection"],
      completionEvidence: ["stage_play_live_source_mail_loop_reflection"],
      next: "terminal_checkpoint",
    });
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.reflect_mail_loop.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
    ]));
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.record_decision).toMatchObject({
      allowedTools: ["live_env.record_live_source_mail_decision"],
      completionEvidence: ["stage_play_live_source_mail_decision"],
    });
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.record_decision.next).toEqual(expect.arrayContaining([
      "request_voice_after_decision",
      "terminal_checkpoint",
      "queue_continuation",
    ]));
    expect(LIVE_SOURCE_TURN_PHASE_TABLE.request_voice_after_decision).toMatchObject({
      allowedTools: ["live_env.request_interim_voice_callout"],
      requiredEvidence: ["stage_play_live_source_mail_decision"],
      completionEvidence: [
        "live_source_interim_voice_callout_receipt",
        "voice_hold_receipt",
        "voice_block_receipt",
        "voice_receipt",
      ],
      next: "terminal_checkpoint",
    });
  });

  it("routes goal-context prompts to read-only workstation context instead of mailbox decision flow", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Inspect the workstation goal context updates and active goal sessions for the active visual source.",
      selectedTargetSource: "live_source_mailbox",
    });

    expect(phase.phase).toBe("query_workstation_goal_context");
    expect(phase.canonicalGoal).toBe("workstation_goal_context");
    expect(phase.allowedTools).toEqual(["live_env.query_workstation_goal_context"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
      "final_answer",
    ]));
    expect(phase.phaseLock).toMatchObject({
      locked: true,
      reason: "Goal-context inspection is a read-only workstation evidence query, not mailbox processing or wake dispatch.",
    });
    expect(mandatoryToolForPhase(phase)).toBe("live_env.query_workstation_goal_context");
  });

  it("routes trace-memory prompts to read-only trace query evidence", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Inspect the latest workstation reasoning trace memory for this live goal.",
      selectedTargetSource: "live_source_mailbox",
    });

    expect(phase.phase).toBe("query_trace_memory");
    expect(phase.canonicalGoal).toBe("workstation_goal_context");
    expect(phase.allowedTools).toEqual(["live_env.query_trace_memory"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.query_workstation_goal_context",
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
      "final_answer",
    ]));
    expect(phase.phaseLock).toMatchObject({
      locked: true,
      reason: "Trace-memory inspection is a read-only workstation evidence query, not mailbox processing or wake dispatch.",
    });
    expect(mandatoryToolForPhase(phase)).toBe("live_env.query_trace_memory");
  });

  it("routes packet-trace prompts to read-only packet trace evidence", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Show per-packet traces for the visual capture deck path and terminal destination.",
      selectedTargetSource: "live_source_mailbox",
    });

    expect(phase.phase).toBe("query_packet_traces");
    expect(phase.canonicalGoal).toBe("workstation_goal_context");
    expect(phase.allowedTools).toEqual(["live_env.query_packet_traces"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.query_workstation_goal_context",
      "live_env.query_trace_memory",
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
      "final_answer",
    ]));
    expect(phase.phaseLock).toMatchObject({
      locked: true,
      reason: "Packet trace inspection is a read-only workstation evidence query, not mailbox processing or wake dispatch.",
    });
    expect(mandatoryToolForPhase(phase)).toBe("live_env.query_packet_traces");
  });

  it("terminalizes packet-trace receipts before any answer authority", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Show per-packet traces for the visual capture deck path and terminal destination.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.query_packet_traces",
      latestToolReceipts: [{
        toolName: "live_env.query_packet_traces",
        observation: {
          schema: "stage_play_packet_trace_query_result/v1",
          artifactId: "stage_play_packet_trace_query_result",
          packetTraceIds: ["stage_play_packet_trace:visual-1"],
        },
      }],
    });

    expect(phase).toMatchObject({
      phase: "terminal_checkpoint",
      allowedTools: [],
      requiredEvidence: ["stage_play_packet_trace_query_result"],
      completionEvidence: ["model_synthesized_answer"],
      phaseLock: {
        locked: true,
        reason: "Packet trace observations require model re-entry and terminal authority before any answer.",
      },
    });
    expect(mandatoryToolForPhase(phase)).toBeNull();
  });

  it("routes feed-specific workstation prompts to read-only context feed queries", () => {
    for (const entry of [
      {
        prompt: "Show visual summaries for the active visual source.",
        phaseName: "query_visual_summaries",
        toolName: "live_env.query_visual_summaries",
      },
      {
        prompt: "Inspect audio transcripts for the earbud source.",
        phaseName: "query_audio_transcripts",
        toolName: "live_env.query_audio_transcripts",
      },
      {
        prompt: "Show translation segments for the translated transcript stream.",
        phaseName: "query_translation_segments",
        toolName: "live_env.query_translation_segments",
      },
      {
        prompt: "Inspect MicroDeck outputs for the frog visual packet.",
        phaseName: "query_microdeck_outputs",
        toolName: "live_env.query_microdeck_outputs",
      },
      {
        prompt: "Show Live Answer state for the active projection.",
        phaseName: "query_live_answer_state",
        toolName: "live_env.query_live_answer_state",
      },
      {
        prompt: "Check source health for the visual capture source.",
        phaseName: "query_source_health",
        toolName: "live_env.query_source_health",
      },
    ] as const) {
      const phase = resolveLiveSourceTurnPhase({
        prompt: entry.prompt,
        selectedTargetSource: "live_source_mailbox",
      });

      expect(phase.phase).toBe(entry.phaseName);
      expect(phase.canonicalGoal).toBe("workstation_goal_context");
      expect(phase.allowedTools).toEqual([entry.toolName]);
      expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
        "live_env.query_workstation_goal_context",
        "live_env.query_trace_memory",
        "live_env.query_packet_traces",
        "live_env.read_processed_live_source_mail",
        "live_env.process_live_source_mail",
        "live_env.record_live_source_mail_decision",
        "live_env.request_interim_voice_callout",
        "final_answer",
      ]));
    expect(phase.phaseLock).toMatchObject({
      locked: true,
      reason: expect.stringContaining("read-only workstation evidence query"),
    });
      expect(mandatoryToolForPhase(phase)).toBe(entry.toolName);
    }
  });

  it("terminalizes feed-specific workstation query receipts before any answer authority", () => {
    for (const entry of [
      {
        prompt: "Show visual summaries for the active visual source.",
        toolName: "live_env.query_visual_summaries",
        feedKind: "visual_summaries",
        requiredEvidence: "stage_play_workstation_context_feed_query_result",
      },
      {
        prompt: "Inspect audio transcripts for the earbud source.",
        toolName: "live_env.query_audio_transcripts",
        feedKind: "audio_transcripts",
        requiredEvidence: "stage_play_workstation_context_feed_query_result",
      },
      {
        prompt: "Show translation segments for the translated transcript stream.",
        toolName: "live_env.query_translation_segments",
        feedKind: "translated_transcripts",
        requiredEvidence: "stage_play_workstation_context_feed_query_result",
      },
      {
        prompt: "Inspect MicroDeck outputs for the frog visual packet.",
        toolName: "live_env.query_microdeck_outputs",
        feedKind: "microdeck_outputs",
        requiredEvidence: "stage_play_workstation_context_feed_query_result",
      },
      {
        prompt: "Show Live Answer state for the active projection.",
        toolName: "live_env.query_live_answer_state",
        feedKind: "live_answer_lines",
        requiredEvidence: "stage_play_workstation_context_feed_query_result",
      },
      {
        prompt: "Check source health for the visual capture source.",
        toolName: "live_env.query_source_health",
        feedKind: "source_health",
        requiredEvidence: "helix.situation_source_capability_read.v1",
      },
    ] as const) {
      const phase = resolveLiveSourceTurnPhase({
        prompt: entry.prompt,
        selectedTargetSource: "live_source_mailbox",
        selectedCapability: entry.toolName,
        latestToolReceipts: [{
          toolName: entry.toolName,
          observation: {
            schema: "stage_play_workstation_context_feed_query_result/v1",
            feed_kind: entry.feedKind,
            artifactId: "stage_play_workstation_context_feed_query_result",
            feedId: `stage_play_workstation_context_feed:${entry.feedKind}`,
          },
        }],
      });

      expect(phase).toMatchObject({
        phase: "terminal_checkpoint",
        allowedTools: [],
        requiredEvidence: [entry.requiredEvidence],
        completionEvidence: ["model_synthesized_answer"],
        phaseLock: {
          locked: true,
          reason: expect.stringContaining("require model re-entry and terminal authority"),
        },
      });
      expect(mandatoryToolForPhase(phase)).toBeNull();
    }
  });

  it("routes route-evidence prompts to read-only route evidence feed query", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Show route-watch evidence for goal_id=goal:frog-monitor.",
      selectedTargetSource: "live_source_mailbox",
    });

    expect(phase.phase).toBe("query_route_evidence");
    expect(phase.canonicalGoal).toBe("workstation_goal_context");
    expect(phase.allowedTools).toEqual(["live_env.query_route_evidence"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.query_workstation_goal_context",
      "live_env.query_trace_memory",
      "live_env.query_packet_traces",
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
      "final_answer",
    ]));
    expect(phase.phaseLock).toMatchObject({
      locked: true,
      reason: expect.stringContaining("read-only workstation evidence query"),
    });
    expect(mandatoryToolForPhase(phase)).toBe("live_env.query_route_evidence");
  });

  it("terminalizes route-evidence receipts before any answer authority", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Show route-watch evidence for goal_id=goal:frog-monitor.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.query_route_evidence",
      latestToolReceipts: [{
        toolName: "live_env.query_route_evidence",
        observation: {
          schema: "stage_play_workstation_context_feed_query_result/v1",
          feed_kind: "route_evidence",
          artifactId: "stage_play_workstation_context_feed_query_result",
          feedId: "stage_play_workstation_context_feed:route-evidence",
        },
      }],
    });

    expect(phase).toMatchObject({
      phase: "terminal_checkpoint",
      allowedTools: [],
      requiredEvidence: ["stage_play_workstation_context_feed_query_result"],
      completionEvidence: ["model_synthesized_answer"],
      phaseLock: {
        locked: true,
        reason: expect.stringContaining("require model re-entry and terminal authority"),
      },
    });
    expect(mandatoryToolForPhase(phase)).toBeNull();
  });

  it("routes automation-policy prompts to read-only automation policy feed query", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Show automation policies for goal_id=goal:frog-monitor.",
      selectedTargetSource: "live_source_mailbox",
    });

    expect(phase.phase).toBe("query_automation_policies");
    expect(phase.canonicalGoal).toBe("workstation_goal_context");
    expect(phase.allowedTools).toEqual(["live_env.query_automation_policies"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.query_workstation_goal_context",
      "live_env.query_trace_memory",
      "live_env.query_packet_traces",
      "live_env.query_route_evidence",
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
      "final_answer",
    ]));
    expect(phase.phaseLock).toMatchObject({
      locked: true,
      reason: expect.stringContaining("read-only workstation evidence query"),
    });
    expect(mandatoryToolForPhase(phase)).toBe("live_env.query_automation_policies");
  });

  it("terminalizes automation-policy receipts before any answer authority", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Show automation policies for goal_id=goal:frog-monitor.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.query_automation_policies",
      latestToolReceipts: [{
        toolName: "live_env.query_automation_policies",
        observation: {
          schema: "stage_play_workstation_context_feed_query_result/v1",
          feed_kind: "automation_policies",
          artifactId: "stage_play_workstation_context_feed_query_result",
          feedId: "stage_play_workstation_context_feed:automation-policies",
        },
      }],
    });

    expect(phase).toMatchObject({
      phase: "terminal_checkpoint",
      allowedTools: [],
      requiredEvidence: ["stage_play_workstation_context_feed_query_result"],
      completionEvidence: ["model_synthesized_answer"],
      phaseLock: {
        locked: true,
        reason: expect.stringContaining("require model re-entry and terminal authority"),
      },
    });
    expect(mandatoryToolForPhase(phase)).toBeNull();
  });

  it("routes narrator-event prompts to read-only narrator event feed query", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Show narrator events for the translated transcript stream.",
      selectedTargetSource: "live_source_mailbox",
    });

    expect(phase.phase).toBe("query_narrator_events");
    expect(phase.canonicalGoal).toBe("workstation_goal_context");
    expect(phase.allowedTools).toEqual(["live_env.query_narrator_events"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.query_workstation_goal_context",
      "live_env.query_trace_memory",
      "live_env.query_packet_traces",
      "live_env.query_route_evidence",
      "live_env.query_automation_policies",
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
      "final_answer",
    ]));
      expect(phase.phaseLock).toMatchObject({
        locked: true,
        reason: expect.stringContaining("read-only workstation evidence query"),
      });
    expect(mandatoryToolForPhase(phase)).toBe("live_env.query_narrator_events");
  });

  it("terminalizes narrator-event receipts before any answer authority", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Show narrator events for the translated transcript stream.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.query_narrator_events",
      latestToolReceipts: [{
        toolName: "live_env.query_narrator_events",
        observation: {
          schema: "stage_play_workstation_context_feed_query_result/v1",
          feed_kind: "narrator_events",
          artifactId: "stage_play_workstation_context_feed_query_result",
          feedId: "stage_play_workstation_context_feed:narrator-events",
        },
      }],
    });

    expect(phase).toMatchObject({
      phase: "terminal_checkpoint",
      allowedTools: [],
      requiredEvidence: ["stage_play_workstation_context_feed_query_result"],
      completionEvidence: ["model_synthesized_answer"],
      phaseLock: {
        locked: true,
        reason: expect.stringContaining("require model re-entry and terminal authority"),
      },
    });
    expect(mandatoryToolForPhase(phase)).toBeNull();
  });

  it("routes explicit workstation control prompts to a single non-terminal dispatch phase", () => {
    for (const entry of [
      {
        prompt: "Run live_env.change_workstation_preset goal_id=goal:frog target_ref=source:visual preset_id=preset:frog.",
        toolName: "live_env.change_workstation_preset",
      },
      {
        prompt: "Run live_env.set_visual_preset goal_id=goal:frog target_ref=source:visual preset_id=preset:frog.",
        toolName: "live_env.set_visual_preset",
      },
      {
        prompt: "Run live_env.set_audio_preset goal_id=goal:translate target_ref=source:audio preset_id=preset:earbud-translation.",
        toolName: "live_env.set_audio_preset",
      },
      {
        prompt: "Run live_env.bind_workstation_source goal_id=goal:frog source_ref=source:visual target_ref=live-answer:visual.",
        toolName: "live_env.bind_workstation_source",
      },
      {
        prompt: "Run live_env.unbind_workstation_source goal_id=goal:frog source_ref=source:visual.",
        toolName: "live_env.unbind_workstation_source",
      },
      {
        prompt: "Run live_env.pause_workstation_loop goal_id=goal:frog loop_ref=loop:visual.",
        toolName: "live_env.pause_workstation_loop",
      },
      {
        prompt: "Run live_env.resume_workstation_loop goal_id=goal:frog loop_ref=loop:visual.",
        toolName: "live_env.resume_workstation_loop",
      },
      {
        prompt: "Run live_env.set_workstation_loop_state goal_id=goal:frog loop_ref=loop:visual state=paused.",
        toolName: "live_env.set_workstation_loop_state",
      },
      {
        prompt: "Run live_env.repair_loop goal_id=goal:frog loop_ref=loop:visual.",
        toolName: "live_env.repair_loop",
      },
      {
        prompt: "Run live_env.repair_workstation_source goal_id=goal:frog loop_ref=loop:visual.",
        toolName: "live_env.repair_workstation_source",
      },
      {
        prompt: "Run live_env.update_live_answer_projection goal_id=goal:frog line_key=translation.",
        toolName: "live_env.update_live_answer_projection",
      },
      {
        prompt: "Run live_env.focus_process_graph goal_id=goal:frog node_ref=packet:visual.",
        toolName: "live_env.focus_process_graph",
      },
      {
        prompt: "Run live_env.narrator_say goal_id=goal:frog text='Translation ready.'",
        toolName: "live_env.narrator_say",
      },
      {
        prompt: "Run live_env.narrator_bind_stream goal_id=goal:frog source_ref=source:audio stream_kind=translated_transcript.",
        toolName: "live_env.narrator_bind_stream",
      },
      {
        prompt: "Run live_env.start_agent_goal_session goal_id=goal:frog objective='Monitor frog classification.'",
        toolName: "live_env.start_agent_goal_session",
      },
      {
        prompt: "Create a goal to refactor the goal-session UI and work until tests pass.",
        toolName: "live_env.start_agent_goal_session",
      },
    ] as const) {
      const phase = resolveLiveSourceTurnPhase({
        prompt: entry.prompt,
        selectedTargetSource: "live_source_mailbox",
      });

      expect(phase.phase).toBe("dispatch_workstation_control");
      expect(phase.canonicalGoal).toBe("workstation_goal_context");
      expect(phase.allowedTools).toEqual([entry.toolName]);
      expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
        "live_env.read_processed_live_source_mail",
        "live_env.process_live_source_mail",
        "live_env.record_live_source_mail_decision",
        "live_env.request_interim_voice_callout",
        "final_answer",
      ]));
      expect(phase.phaseLock).toMatchObject({
        locked: true,
        reason: expect.stringContaining("non-terminal evidence"),
      });
      expect(mandatoryToolForPhase(phase)).toBe(entry.toolName);
    }
  });

  it("routes explicit route-watch alias commands to watch-job setup evidence", () => {
    for (const toolName of ["live_env.configure_route_watch", "live_env.configure_live_source_watch_job"] as const) {
      const phase = resolveLiveSourceTurnPhase({
        prompt: `Run ${toolName} goal_id=goal:frog source_id=source:visual objective='Watch route evidence.'`,
        selectedTargetSource: "live_source_mailbox",
      });

      expect(phase.phase).toBe("configure_watch_job");
      expect(phase.canonicalGoal).toBe("configure_watch_job");
      expect(phase.allowedTools).toEqual([toolName]);
      expect(phase.requiredEvidence).toEqual([toolName]);
      expect(phase.completionEvidence).toEqual(["stage_play_live_source_watch_job_policy"]);
      expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
        "live_env.read_processed_live_source_mail",
        "live_env.process_live_source_mail",
        "live_env.read_live_source_mail",
        "live_env.record_live_source_mail_decision",
      ]));
      expect(phase.phaseLock.locked).toBe(true);
      expect(mandatoryToolForPhase(phase)).toBe(toolName);
    }
  });

  it("terminalizes workstation control receipts before answer authority", () => {
    for (const entry of [
      {
        toolName: "live_env.change_workstation_preset",
        observation: {
          schema: "stage_play_workstation_control_receipt/v1",
          controlKind: "change_preset",
          requiredActuator: "change_preset",
        },
      },
      {
        toolName: "live_env.set_visual_preset",
        observation: {
          schema: "stage_play_workstation_control_receipt/v1",
          controlKind: "change_preset",
          requiredActuator: "set_visual_preset",
        },
      },
      {
        toolName: "live_env.set_audio_preset",
        observation: {
          schema: "stage_play_workstation_control_receipt/v1",
          controlKind: "change_preset",
          requiredActuator: "set_audio_preset",
        },
      },
      {
        toolName: "live_env.focus_process_graph",
        observation: {
          schema: "stage_play_workstation_control_receipt/v1",
          controlKind: "focus_process_graph",
          requiredActuator: "focus_process_graph",
        },
      },
      {
        toolName: "live_env.narrator_say",
        observation: {
          schema: "helix.narrator_say_request.v1",
          requestId: "helix:narrator:say:1",
        },
      },
      {
        toolName: "live_env.narrator_bind_stream",
        observation: {
          schema: "helix.narrator_bind_stream_request.v1",
          requestId: "helix:narrator:bind:1",
        },
      },
    ] as const) {
      const phase = resolveLiveSourceTurnPhase({
        prompt: `Run ${entry.toolName} goal_id=goal:frog.`,
        selectedTargetSource: "live_source_mailbox",
        selectedCapability: entry.toolName,
        latestToolReceipts: [{
          toolName: entry.toolName,
          observation: entry.observation,
        }],
      });

      expect(phase).toMatchObject({
        phase: "terminal_checkpoint",
        allowedTools: [],
        requiredEvidence: expect.arrayContaining(["stage_play_workstation_control_receipt"]),
        completionEvidence: ["model_synthesized_answer"],
        phaseLock: {
          locked: true,
          reason: expect.stringContaining("terminal authority"),
        },
      });
      expect(mandatoryToolForPhase(phase)).toBeNull();
    }
  });

  it("does not dispatch workstation controls from contextual control mentions", () => {
    for (const prompt of [
      "Do not run live_env.change_workstation_preset; explain what evidence would be needed.",
      "If we run live_env.set_visual_preset later, what target refs should we collect?",
      'The UI label says "live_env.focus_process_graph"; summarize it.',
      'The dropdown shows "live_env.configure_route_watch"; summarize it.',
      'The dropdown shows "live_env.configure_live_source_watch_job"; summarize it.',
      "Could we run live_env.repair_loop later?",
      "Could we run live_env.repair_workstation_source later?",
      "Previously you used live_env.narrator_say; what did it do?",
    ]) {
      const phase = resolveLiveSourceTurnPhase({
        prompt,
        selectedTargetSource: "live_source_mailbox",
      });

      expect(phase.phase).not.toBe("dispatch_workstation_control");
      expect(phase.allowedTools).not.toEqual(expect.arrayContaining([
        "live_env.change_workstation_preset",
        "live_env.set_visual_preset",
        "live_env.configure_route_watch",
        "live_env.configure_live_source_watch_job",
        "live_env.focus_process_graph",
        "live_env.repair_loop",
        "live_env.repair_workstation_source",
        "live_env.narrator_say",
      ]));
    }
  });

  it("does not route contextual goal-context mentions into live-env tool execution", () => {
    for (const prompt of [
      "Do not query workstation goal context; explain the architecture.",
      'The UI label says "workstation goal context updates"; what does that mean?',
      "Could we inspect per-packet traces later?",
      "Do not query trace memory; explain the architecture.",
      'The UI label says "live_env.query_narrator_events"; what does it mean?',
      "Could we inspect narrator events later?",
      'The UI label says "live_env.query_visual_summaries"; what does it mean?',
      'The UI label says "live_env.query_audio_transcripts"; what does it mean?',
      'The UI label says "live_env.query_translation_segments"; what does it mean?',
      'The UI label says "live_env.query_microdeck_outputs"; what does it mean?',
      'The UI label says "live_env.query_live_answer_state"; what does it mean?',
      'The UI label says "live_env.query_source_health"; what does it mean?',
      "Could we inspect visual summaries later?",
      "Do not query MicroDeck outputs; explain the architecture.",
      'The UI label says "live_env.query_route_evidence"; what does it mean?',
      'The UI label says "live_env.query_automation_policies"; what does it mean?',
      "Could we inspect route-watch evidence later?",
      "Could we inspect automation policies later?",
    ]) {
      const phase = resolveLiveSourceTurnPhase({
        prompt,
        selectedTargetSource: "live_source_mailbox",
      });
      expect(phase.phase).not.toBe("query_workstation_goal_context");
      expect(phase.phase).not.toBe("query_packet_traces");
      expect(phase.phase).not.toBe("query_visual_summaries");
      expect(phase.phase).not.toBe("query_audio_transcripts");
      expect(phase.phase).not.toBe("query_translation_segments");
      expect(phase.phase).not.toBe("query_microdeck_outputs");
      expect(phase.phase).not.toBe("query_live_answer_state");
      expect(phase.phase).not.toBe("query_source_health");
      expect(phase.phase).not.toBe("query_narrator_events");
      expect(phase.phase).not.toBe("query_route_evidence");
      expect(phase.phase).not.toBe("query_automation_policies");
      expect(phase.allowedTools).not.toContain("live_env.query_workstation_goal_context");
      expect(phase.allowedTools).not.toContain("live_env.query_packet_traces");
      expect(phase.allowedTools).not.toContain("live_env.query_visual_summaries");
      expect(phase.allowedTools).not.toContain("live_env.query_audio_transcripts");
      expect(phase.allowedTools).not.toContain("live_env.query_translation_segments");
      expect(phase.allowedTools).not.toContain("live_env.query_microdeck_outputs");
      expect(phase.allowedTools).not.toContain("live_env.query_live_answer_state");
      expect(phase.allowedTools).not.toContain("live_env.query_source_health");
      expect(phase.allowedTools).not.toContain("live_env.query_narrator_events");
      expect(phase.allowedTools).not.toContain("live_env.query_route_evidence");
      expect(phase.allowedTools).not.toContain("live_env.query_automation_policies");
    }
  });

  it("lets Stage Play mail wake metadata force record_decision over ambiguous setup or status prompt text", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt:
        "Status check: create a Minecraft profile later, but for this wake decide whether the latest mailbox finding needs voice.",
      selectedTargetSource: "visual_capture",
      selectedCapability: "workspace_os.status",
      processedPackets: [{
        artifactId: "stage_play_processed_mail_packet",
        packetId: "stage_play_processed_mail_packet:metadata-voice",
        observedFacts: ["The player is near fire."],
        recommendedNext: "request_voice_callout",
        salience: {
          level: "urgent",
          voiceCandidate: true,
          calloutDraft: "Fire nearby; move clear.",
        },
      }],
      routeMetadata: {
        invocationKind: "stage_play_mail_wake",
        wakeRequestId: "stage_play_live_source_mail_wake:metadata-force",
        mailboxThreadId: "helix-ask:desktop",
        sourceTarget: "live_source_mailbox",
        requiredCanonicalGoal: "processed_mail_voice_decision",
        requiredPhase: "record_decision",
        evidenceRefs: ["stage_play_processed_mail_packet:metadata-voice"],
        allowedCapabilities: ["live_env.record_live_source_mail_decision"],
        forbiddenCapabilities: ["workspace_os.status", "visual_capture_describe", "situation_context_pack"],
      },
    });

    expect(phase.phase).toBe("record_decision");
    expect(phase.canonicalGoal).toBe("processed_mail_voice_decision");
    expect(phase.allowedTools).toEqual(["live_env.record_live_source_mail_decision"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.read_live_source_mail",
      "live_env.request_interim_voice_callout",
      "final_answer",
    ]));
    expect(phase.phaseLock).toMatchObject({
      locked: true,
      reason: "Stage Play mail wake route metadata is authoritative for the mailbox decision phase.",
    });
    expect(phase.evidenceRefs).toEqual(expect.arrayContaining([
      "stage_play_processed_mail_packet:metadata-voice",
    ]));
    expect(isLockedExecutableLiveSourcePhase(phase)).toBe(true);
    expect(mandatoryToolForPhase(phase)).toBe("live_env.record_live_source_mail_decision");
  });

  it("forces processed-mail materialization before metadata voice decisions when no packet is attached", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt:
        "Continuing live-source watch job compact Ask handoff. Micro-reasoner recommendation: request voice callout.",
      selectedTargetSource: "live_source_mailbox",
      routeMetadata: {
        invocationKind: "stage_play_mail_wake",
        wakeRequestId: "stage_play_live_source_mail_wake:metadata-needs-packet",
        mailboxThreadId: "helix-ask:desktop",
        sourceTarget: "live_source_mailbox",
        requiredCanonicalGoal: "processed_mail_voice_decision",
        requiredPhase: "record_decision",
        evidenceRefs: ["stage_play_processed_mail_packet:metadata-needs-packet"],
        allowedCapabilities: ["live_env.record_live_source_mail_decision"],
        forbiddenCapabilities: ["workspace_os.status", "visual_capture_describe", "situation_context_pack"],
      },
    });

    expect(phase.phase).toBe("read_processed_mail");
    expect(phase.canonicalGoal).toBe("processed_mail_voice_decision");
    expect(phase.allowedTools).toEqual(["live_env.read_processed_live_source_mail"]);
    expect(phase.nextPhase).toBe("record_decision");
    expect(phase.phaseLock).toMatchObject({
      locked: true,
      reason: "Stage Play mail wake route metadata is authoritative, but decision routing requires materialized processed mailbox evidence.",
    });
    expect(mandatoryToolForPhase(phase)).toBe("live_env.read_processed_live_source_mail");
  });

  it("locks live mail loop causality prompts to read-only reflection before terminal synthesis", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Can you read the live mail loop as it is working, like inspect via a tool call of stage play badge graph?",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.reflect_live_source_mail_loop",
    });

    expect(phase).toMatchObject({
      phase: "reflect_mail_loop",
      canonicalGoal: "processed_mail_interpretation",
      allowedTools: ["live_env.reflect_live_source_mail_loop"],
      fallbackTools: [],
      requiredEvidence: ["stage_play_live_source_mail_loop_reflection"],
      completionEvidence: ["stage_play_live_source_mail_loop_reflection"],
      nextPhase: "terminal_checkpoint",
      phaseLock: {
        locked: true,
        reason: "Mail-loop reflection is read-only causal inspection; packet materialization must be explicit.",
      },
    });
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
      "final_answer",
    ]));
    expect(mandatoryToolForPhase(phase)).toBe("live_env.reflect_live_source_mail_loop");
  });

  it("terminalizes after a mail-loop reflection receipt without forcing voice receipts", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Explain why the final answer feels disconnected from the processed mail loop and MicroDeck causality.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.reflect_live_source_mail_loop",
      latestToolReceipts: [{
        toolName: "live_env.reflect_live_source_mail_loop",
        observation: {
          artifactId: "stage_play_live_source_mail_loop_reflection",
          schemaVersion: "stage_play_live_source_mail_loop_reflection/v1",
          reflectionId: "stage_play_live_source_mail_loop_reflection:test",
        },
      }],
    });

    expect(phase).toMatchObject({
      phase: "terminal_checkpoint",
      allowedTools: [],
      requiredEvidence: ["stage_play_live_source_mail_loop_reflection"],
      completionEvidence: ["model_synthesized_answer"],
      phaseLock: {
        locked: true,
        reason: "Reflection turns terminalize from the evidence-only causal reflection packet after model re-entry.",
      },
    });
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.reflect_live_source_mail_loop",
      "live_env.request_interim_voice_callout",
    ]));
  });

  it("exposes mandatory tools only for locked executable live-source phases", () => {
    const executable = resolveLiveSourceTurnPhase({
      prompt: "Use the structured mailbox route metadata attached to this turn.",
      selectedTargetSource: "live_source_mailbox",
      routeMetadata: {
        invocationKind: "stage_play_mail_wake",
        wakeRequestId: "stage_play_live_source_mail_wake:mandatory-helper",
        mailboxThreadId: "helix-ask:desktop",
        sourceTarget: "live_source_mailbox",
        requiredCanonicalGoal: "processed_mail_voice_decision",
        requiredPhase: "request_voice_after_decision",
        evidenceRefs: [
          "stage_play_processed_mail_packet:mandatory-helper",
          "stage_play_live_source_mail_decision:mandatory-helper",
        ],
      },
      latestToolReceipts: [{
        toolName: "live_env.record_live_source_mail_decision",
        observation: {
          artifactId: "stage_play_live_source_mail_decision",
          decisionId: "stage_play_live_source_mail_decision:mandatory-helper",
          decision: "request_voice_callout",
        },
      }],
    });

    expect(executable.phase).toBe("request_voice_after_decision");
    expect(isLockedExecutableLiveSourcePhase(executable)).toBe(true);
    expect(mandatoryToolForPhase(executable)).toBe("live_env.request_interim_voice_callout");

    const terminal = resolveLiveSourceTurnPhase({
      prompt: "Use the structured mailbox route metadata attached to this turn.",
      selectedTargetSource: "live_source_mailbox",
      latestToolReceipts: [
        {
          toolName: "live_env.record_live_source_mail_decision",
          observation: {
            artifactId: "stage_play_live_source_mail_decision",
            decisionId: "stage_play_live_source_mail_decision:terminal-helper",
            decision: "request_voice_callout",
          },
        },
        {
          toolName: "live_env.request_interim_voice_callout",
          observation: {
            schema: "helix.interim_voice_callout_tool_result.v1",
            receipt: {
              receiptId: "live_source_interim_voice_callout_receipt:terminal-helper",
              status: "awaiting_client_playback",
            },
          },
        },
      ],
    });

    expect(terminal.phase).toBe("terminal_checkpoint");
    expect(isLockedExecutableLiveSourcePhase(terminal)).toBe(false);
    expect(mandatoryToolForPhase(terminal)).toBeNull();
  });

  it("lets Stage Play mail wake metadata map read_mailbox to read_processed_mail without generic visual scope", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Describe the current visual capture and use the situation context pack.",
      selectedTargetSource: "visual_capture",
      routeMetadata: {
        invocationKind: "stage_play_mail_wake",
        wakeRequestId: "stage_play_live_source_mail_wake:metadata-read",
        mailboxThreadId: "helix-ask:desktop",
        sourceTarget: "live_source_mailbox",
        requiredCanonicalGoal: "processed_mail_interpretation",
        requiredPhase: "read_mailbox",
        evidenceRefs: ["stage_play_live_source_mail_wake:metadata-read"],
        allowedCapabilities: ["live_env.read_processed_live_source_mail"],
        forbiddenCapabilities: ["visual_capture_describe", "situation_context_pack"],
      },
    });

    expect(phase.phase).toBe("read_processed_mail");
    expect(phase.canonicalGoal).toBe("processed_mail_interpretation");
    expect(phase.allowedTools).toEqual(["live_env.read_processed_live_source_mail"]);
    expect(phase.fallbackTools).toEqual(["live_env.process_live_source_mail"]);
    expect(phase.requiredEvidence).toEqual(["stage_play_processed_mail_packet"]);
    expect(phase.phaseLock.locked).toBe(true);
  });

  it("locks interpreter profile setup before mail-reading or voice wording", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt:
        "Create a Minecraft Survival Coach interpreter profile for this source. Call out danger, predict risk, and use voice only for urgent threats.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.read_processed_live_source_mail",
    });

    expect(phase).toMatchObject({
      phase: "configure_interpreter_profile",
      canonicalGoal: "configure_interpreter_profile",
      allowedTools: ["live_env.configure_interpreter_profile"],
      phaseLock: {
        locked: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_policy",
    });
    expect(phase.forbiddenTools).toContain("live_env.read_processed_live_source_mail");
  });

  it("treats survival coach contract criteria as locked interpreter profile setup", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt:
        "Make a survival coach profile for this source. Call out danger, rare resources, and strategic decisions; ignore routine walking.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.read_processed_live_source_mail",
    });

    expect(phase.phase).toBe("configure_interpreter_profile");
    expect(phase.canonicalGoal).toBe("configure_interpreter_profile");
    expect(phase.allowedTools).toEqual(["live_env.configure_interpreter_profile"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.read_live_source_mail",
    ]));
    expect(phase.completionEvidence).toEqual(["stage_play_live_source_interpreter_profile"]);
    expect(phase.phaseLock).toMatchObject({
      locked: true,
    });
  });

  it("keeps overlapping profile prediction and danger wording in interpreter profile setup", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Create a profile for this source that predicts what to watch next and calls out danger.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.read_processed_live_source_mail",
    });

    expect(phase.phase).toBe("configure_interpreter_profile");
    expect(phase.canonicalGoal).toBe("configure_interpreter_profile");
    expect(phase.allowedTools).toEqual(["live_env.configure_interpreter_profile"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.read_live_source_mail",
    ]));
    expect(phase.phaseLock.locked).toBe(true);
  });

  it("splits create-profile-then-read wording by locking the setup phase first", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt:
        "Create the Minecraft Survival Coach interpreter profile and then read the latest mail.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.read_processed_live_source_mail",
    });

    expect(phase.phase).toBe("configure_interpreter_profile");
    expect(phase.nextPhase).toBe("terminal_checkpoint");
    expect(phase.allowedTools).toEqual(["live_env.configure_interpreter_profile"]);
    expect(phase.forbiddenTools).toContain("live_env.read_processed_live_source_mail");
    expect(phase.phaseLock.locked).toBe(true);
  });

  it("terminalizes profile setup after the interpreter profile receipt without reading mail", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt:
        "Make a Minecraft Survival Coach profile for this source. Call out danger and ignore routine walking.",
      latestToolReceipts: [{
        tool_name: "live_env.configure_interpreter_profile",
        observation: {
          artifactId: "stage_play_live_source_interpreter_profile",
          schemaVersion: "stage_play_live_source_interpreter_profile/v1",
          profileId: "stage_play_live_source_interpreter_profile:minecraft-survival-coach",
          title: "Minecraft Survival Coach",
        },
      }],
    });

    expect(phase.phase).toBe("terminal_checkpoint");
    expect(phase.canonicalGoal).toBe("configure_interpreter_profile");
    expect(phase.allowedTools).toEqual([]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.read_live_source_mail",
    ]));
    expect(phase.completionEvidence).toEqual(["stage_play_live_source_interpreter_profile"]);
    expect(phase.phaseLock.locked).toBe(true);
  });

  it("locks standing watch setup before processed-mail interpretation wording", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt:
        "Watch the active visual source as a Minecraft video predictor. Interpret chronological micro-batches and only use short checkpoints unless danger appears.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.read_processed_live_source_mail",
    });

    expect(phase.phase).toBe("configure_watch_job");
    expect(phase.canonicalGoal).toBe("configure_watch_job");
    expect(phase.allowedTools).toEqual(["live_env.configure_live_source_watch_job"]);
    expect(phase.phaseLock.locked).toBe(true);
  });

  it("locks bare standing watch language before mailbox reading", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Watch this source.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.read_processed_live_source_mail",
    });

    expect(phase.phase).toBe("configure_watch_job");
    expect(phase.canonicalGoal).toBe("configure_watch_job");
    expect(phase.allowedTools).toEqual(["live_env.configure_live_source_watch_job"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.read_live_source_mail",
    ]));
    expect(phase.completionEvidence).toEqual(["stage_play_live_source_watch_job_policy"]);
    expect(phase.phaseLock.locked).toBe(true);
  });

  it("locks commentate and every-batch watch prompts as watch-job setup", () => {
    for (const prompt of [
      "Keep watching and describe each batch.",
      "Every new mail batch should be described in one sentence.",
      "Announce if anything important happens.",
      "Commentate while I play.",
    ]) {
      const phase = resolveLiveSourceTurnPhase({
        prompt,
        selectedTargetSource: "live_source_mailbox",
        selectedCapability: "live_env.read_processed_live_source_mail",
      });

      expect(phase.phase).toBe("configure_watch_job");
      expect(phase.canonicalGoal).toBe("configure_watch_job");
      expect(phase.allowedTools).toEqual(["live_env.configure_live_source_watch_job"]);
      expect(phase.forbiddenTools).toContain("live_env.read_processed_live_source_mail");
      expect(phase.completionEvidence).toEqual(["stage_play_live_source_watch_job_policy"]);
      expect(phase.phaseLock.locked).toBe(true);
    }
  });

  it("terminalizes watch-job setup after policy receipt without reading mail", () => {
    for (const toolName of ["live_env.configure_live_source_watch_job", "live_env.configure_route_watch"] as const) {
      const phase = resolveLiveSourceTurnPhase({
        prompt: "Watch this source and describe each new mail batch.",
        latestToolReceipts: [{
          tool_name: toolName,
          observation: {
            schema: "stage_play_live_source_watch_job_policy_config_result/v1",
            watchJobPolicyRef: "stage_play_live_source_watch_job_policy:watch-1",
            policy: {
              artifactId: "stage_play_live_source_watch_job_policy",
              policyId: "stage_play_live_source_watch_job_policy:watch-1",
            },
          },
        }],
      });

      expect(phase.phase).toBe("terminal_checkpoint");
      expect(phase.canonicalGoal).toBe("configure_watch_job");
      expect(phase.allowedTools).toEqual([]);
      expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
        "live_env.read_processed_live_source_mail",
        "live_env.process_live_source_mail",
        "live_env.read_live_source_mail",
      ]));
      expect(phase.completionEvidence).toEqual(["stage_play_live_source_watch_job_policy"]);
      expect(phase.phaseLock.locked).toBe(true);
    }
  });

  it("locks MicroDeck inspection to the read-only preset query without processed-mail fallback", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Query the MicroDeck preset assembly for the active visual source.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.read_processed_live_source_mail",
    });

    expect(phase.phase).toBe("query_micro_reasoner_deck");
    expect(phase.canonicalGoal).toBe("live_source_status");
    expect(phase.allowedTools).toEqual(["live_env.query_micro_reasoner_presets"]);
    expect(phase.fallbackTools).toEqual([]);
    expect(phase.requiredEvidence).toEqual(["stage_play_micro_reasoner_prompt_preset_query_result"]);
    expect(phase.completionEvidence).toEqual(["stage_play_micro_reasoner_prompt_preset_query_result"]);
    expect(phase.nextPhase).toBe("terminal_checkpoint");
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
    ]));
    expect(phase.phaseLock).toMatchObject({
      locked: true,
      reason: "MicroDeck inspection is a read-only source-prompt query, not mailbox processing.",
    });
    expect(isLockedExecutableLiveSourcePhase(phase)).toBe(true);
    expect(mandatoryToolForPhase(phase)).toBe("live_env.query_micro_reasoner_presets");
  });

  it("recognizes MicroDeck prompt and active deck inspection wording", () => {
    for (const prompt of [
      "Show the active MicroDeck prompts for this source.",
      "Inspect the micro-reasoner deck that is assembled for the live source.",
      "List the prompt presets in the source deck assembly.",
      "Show the earbud translation presets for the audio transcript source.",
    ]) {
      const phase = resolveLiveSourceTurnPhase({
        prompt,
        selectedTargetSource: "live_source_mailbox",
      });

      expect(phase.phase).toBe("query_micro_reasoner_deck");
      expect(phase.allowedTools).toEqual(["live_env.query_micro_reasoner_presets"]);
      expect(phase.fallbackTools).toEqual([]);
      expect(phase.requiredEvidence).toEqual(["stage_play_micro_reasoner_prompt_preset_query_result"]);
    }
  });

  it("locks MicroDeck setup drafting to the read-only draft tool without processed-mail fallback", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Draft a MicroDeck preset for a visual automation scenario that chooses between three candidate prompts.",
      selectedTargetSource: "live_source_mailbox",
      selectedCapability: "live_env.read_processed_live_source_mail",
    });

    expect(phase.phase).toBe("query_micro_reasoner_deck");
    expect(phase.canonicalGoal).toBe("live_source_status");
    expect(phase.allowedTools).toEqual(["live_env.draft_micro_reasoner_preset"]);
    expect(phase.fallbackTools).toEqual([]);
    expect(phase.requiredEvidence).toEqual(["stage_play_micro_reasoner_prompt_preset_draft"]);
    expect(phase.completionEvidence).toEqual(["stage_play_micro_reasoner_prompt_preset_draft"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.read_live_source_mail",
    ]));
    expect(phase.phaseLock).toMatchObject({
      locked: true,
      reason: "MicroDeck setup drafting is a read-only source-prompt planning query, not mailbox processing or preset mutation.",
    });
    expect(isLockedExecutableLiveSourcePhase(phase)).toBe(true);
    expect(mandatoryToolForPhase(phase)).toBe("live_env.draft_micro_reasoner_preset");
  });

  it("does not execute MicroDeck query from quoted, negated, future, historical, or screen-visible mentions", () => {
    for (const prompt of [
      "Do not query the MicroDeck right now; explain what it is for.",
      "Do not query the earbud translation presets right now; explain what they are for.",
      "Later we might inspect the micro-reasoner deck.",
      "If we inspect the audio translation deck tomorrow, what should we watch for?",
      "If we inspect the MicroDeck presets tomorrow, what should we watch for?",
      "Earlier we queried the MicroDeck preset assembly during the smoke test.",
      "The UI button says MicroDeck presets.",
      "The UI button says Earbud MicroDeck.",
      "The current screen-visible label reads Query MicroDeck presets.",
      "The operator said \"query the MicroDeck presets\" in the old transcript.",
      "The phrase `live_env.query_micro_reasoner_presets` is shown in the docs.",
    ]) {
      const phase = resolveLiveSourceTurnPhase({
        prompt,
        selectedTargetSource: "live_source_mailbox",
        selectedCapability: "live_env.query_micro_reasoner_presets",
      });

      expect(phase.phase).not.toBe("query_micro_reasoner_deck");
      expect(phase.allowedTools).not.toContain("live_env.query_micro_reasoner_presets");
    }
  });

  it("does not execute MicroDeck draft from quoted, negated, future, historical, or screen-visible mentions", () => {
    for (const prompt of [
      "Do not draft a MicroDeck right now; explain the idea first.",
      "Do not draft an earbud translation preset right now; explain the idea first.",
      "Later we might design a micro-reasoner deck for this.",
      "If we design an audio transcript deck tomorrow, what inputs should we collect?",
      "If we draft the MicroDeck preset tomorrow, what inputs should we collect?",
      "Earlier we recommended a MicroDeck setup during the smoke test.",
      "The UI button says Draft MicroDeck preset.",
      "The operator said \"draft a MicroDeck preset\" in the old transcript.",
      "The phrase `live_env.draft_micro_reasoner_preset` is shown in the docs.",
    ]) {
      const phase = resolveLiveSourceTurnPhase({
        prompt,
        selectedTargetSource: "live_source_mailbox",
        selectedCapability: "live_env.draft_micro_reasoner_preset",
      });

      expect(phase.phase).not.toBe("query_micro_reasoner_deck");
      expect(phase.allowedTools).not.toContain("live_env.draft_micro_reasoner_preset");
    }
  });

  it("requires a recorded decision before voice for processed voice candidates", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Read the processed Minecraft mail and call out if danger appears.",
      selectedTargetSource: "live_source_mailbox",
      processedPackets: [{
        artifactId: "stage_play_processed_mail_packet",
        packetId: "stage_play_processed_mail_packet:voice-candidate",
        observedFacts: ["The player is on fire."],
        recommendedNext: "request_voice_callout",
        salience: {
          level: "urgent",
          voiceCandidate: true,
          calloutDraft: "The player appears to be on fire.",
        },
      }],
    });

    expect(phase).toMatchObject({
      phase: "record_decision",
      canonicalGoal: "processed_mail_voice_decision",
      allowedTools: ["live_env.record_live_source_mail_decision"],
      nextPhase: "request_voice_after_decision",
      terminal_eligible: false,
    });
    expect(phase.phaseLock.locked).toBe(true);
    expect(phase.requiredEvidence).toEqual(["stage_play_processed_mail_packet"]);
    expect(phase.completionEvidence).toEqual(["stage_play_live_source_mail_decision"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.request_interim_voice_callout",
      "final_answer",
    ]));
  });

  it("treats high or urgent salience as a voice candidate requiring decision first", () => {
    for (const level of ["high", "urgent"]) {
      const phase = resolveLiveSourceTurnPhase({
        prompt: "Read the processed Minecraft mail.",
        selectedTargetSource: "live_source_mailbox",
        processedPackets: [{
          artifactId: "stage_play_processed_mail_packet",
          packetId: `stage_play_processed_mail_packet:${level}`,
          observedFacts: ["The player is near lava."],
          recommendedNext: "record_interpretation",
          salience: {
            level,
            reasons: ["Visible danger cue."],
          },
        }],
      });

      expect(phase.phase).toBe("record_decision");
      expect(phase.canonicalGoal).toBe("processed_mail_voice_decision");
      expect(phase.allowedTools).toEqual(["live_env.record_live_source_mail_decision"]);
      expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
        "live_env.request_interim_voice_callout",
        "final_answer",
      ]));
      expect(phase.requiredEvidence).toEqual(["stage_play_processed_mail_packet"]);
      expect(phase.completionEvidence).toEqual(["stage_play_live_source_mail_decision"]);
      expect(phase.nextPhase).toBe("request_voice_after_decision");
      expect(phase.phaseLock.locked).toBe(true);
    }
  });

  it("allows interim voice only after the request_voice_callout decision receipt exists", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Read the processed Minecraft mail and call out if danger appears.",
      selectedTargetSource: "live_source_mailbox",
      processedPackets: [{
        artifactId: "stage_play_processed_mail_packet",
        packetId: "stage_play_processed_mail_packet:voice-candidate",
        observedFacts: ["The player is on fire."],
        recommendedNext: "request_voice_callout",
        salience: {
          level: "urgent",
          voiceCandidate: true,
          calloutDraft: "The player appears to be on fire.",
        },
      }],
      latestToolReceipts: [{
        tool_name: "live_env.record_live_source_mail_decision",
        observation: {
          artifactId: "stage_play_live_source_mail_decision",
          schemaVersion: "stage_play_live_source_mail_decision/v1",
          decisionId: "stage_play_live_source_mail_decision:voice-1",
          decision: "request_voice_callout",
          voiceCalloutDraft: {
            text: "The player appears to be on fire.",
            voiceEligible: true,
            requiresConfirmation: false,
          },
        },
      }],
    });

    expect(phase.phase).toBe("request_voice_after_decision");
    expect(phase.canonicalGoal).toBe("processed_mail_voice_decision");
    expect(phase.allowedTools).toEqual(["live_env.request_interim_voice_callout"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.record_live_source_mail_decision",
      "final_answer",
    ]));
    expect(phase.requiredEvidence).toEqual(["stage_play_live_source_mail_decision"]);
    expect(phase.completionEvidence).toEqual([
      "live_source_interim_voice_callout_receipt",
      "voice_hold_receipt",
      "voice_block_receipt",
      "voice_receipt",
    ]);
    expect(phase.nextPhase).toBe("terminal_checkpoint");
    expect(phase.phaseLock.locked).toBe(true);
    expect(phase.terminal_eligible).toBe(false);
  });

  it("locks to interim voice after a recorded request_voice_callout decision even without re-derived packet voice candidacy", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Continue the active Stage Play live-source mailbox flow after the recorded decision.",
      selectedTargetSource: "live_source_mailbox",
      latestToolReceipts: [{
        tool_name: "live_env.record_live_source_mail_decision",
        observation: {
          artifactId: "stage_play_live_source_mail_decision",
          schemaVersion: "stage_play_live_source_mail_decision/v1",
          decisionId: "stage_play_live_source_mail_decision:voice-2",
          decision: "request_voice_callout",
          voiceCalloutDraft: {
            text: "Lava is nearby; keep distance.",
            voiceEligible: true,
            requiresConfirmation: false,
          },
        },
      }],
    });

    expect(phase.phase).toBe("request_voice_after_decision");
    expect(phase.allowedTools).toEqual(["live_env.request_interim_voice_callout"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_live_source_mail",
      "live_env.record_live_source_mail_decision",
      "final_answer",
    ]));
    expect(phase.completionEvidence).toEqual([
      "live_source_interim_voice_callout_receipt",
      "voice_hold_receipt",
      "voice_block_receipt",
      "voice_receipt",
    ]);
    expect(phase.phaseLock.locked).toBe(true);
  });

  it("terminalizes after a voice decision has a voice receipt instead of repeating the callout tool", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Read the processed Minecraft mail and call out if danger appears.",
      selectedTargetSource: "live_source_mailbox",
      processedPackets: [{
        artifactId: "stage_play_processed_mail_packet",
        packetId: "stage_play_processed_mail_packet:voice-complete",
        observedFacts: ["The player is taking fire damage."],
        recommendedNext: "request_voice_callout",
        salience: {
          level: "urgent",
          voiceCandidate: true,
          calloutDraft: "You are taking fire damage.",
        },
      }],
      latestToolReceipts: [
        {
          tool_name: "live_env.record_live_source_mail_decision",
          observation: {
            artifactId: "stage_play_live_source_mail_decision",
            schemaVersion: "stage_play_live_source_mail_decision/v1",
            decisionId: "stage_play_live_source_mail_decision:voice-complete",
            decision: "request_voice_callout",
          },
        },
        {
          tool_name: "live_env.request_interim_voice_callout",
          observation: {
            schema: "helix.interim_voice_callout_tool_result.v1",
            receipt: {
              status: "awaiting_client_playback",
              assistant_answer: false,
              raw_content_included: false,
            },
          },
        },
      ],
    });

    expect(phase.phase).toBe("terminal_checkpoint");
    expect(phase.canonicalGoal).toBe("processed_mail_voice_decision");
    expect(phase.allowedTools).toEqual([]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.request_interim_voice_callout",
      "live_env.record_live_source_mail_decision",
    ]));
    expect(phase.requiredEvidence).toEqual([
      "stage_play_processed_mail_packet",
      "stage_play_live_source_mail_decision",
      "live_source_interim_voice_callout_receipt",
    ]);
    expect(phase.completionEvidence).toEqual(["model_synthesized_answer"]);
    expect(phase.nextPhase).toBe(null);
  });

  it("routes processed-mail interpretation prompts to read processed mail with process fallback", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Read the visual mail and interpret what is happening. Predict what should be watched next.",
    });

    expect(phase.phase).toBe("read_processed_mail");
    expect(phase.canonicalGoal).toBe("processed_mail_interpretation");
    expect(phase.allowedTools).toEqual(["live_env.read_processed_live_source_mail"]);
    expect(phase.fallbackTools).toEqual(["live_env.process_live_source_mail"]);
    expect(phase.completionEvidence).toEqual(["stage_play_processed_mail_packet"]);
    expect(phase.requiredEvidence).toEqual(["stage_play_processed_mail_packet"]);
    expect(phase.requiredEvidence).not.toEqual(expect.arrayContaining([
      "doc_summary",
      "visual_observation",
      "field_evaluation",
      "situation_context_pack",
    ]));
  });

  it("requires record_decision after processed packets that recommend interpretation", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Compare mail and say what is happening.",
      processedPackets: [{
        artifactId: "stage_play_processed_mail_packet",
        packetId: "stage_play_processed_mail_packet:interpret",
        observedFacts: ["The player moved from inventory to a cave."],
        recommendedNext: "record_interpretation",
        salience: {
          level: "medium",
          voiceCandidate: false,
        },
      }],
    });

    expect(phase.phase).toBe("record_decision");
    expect(phase.canonicalGoal).toBe("processed_mail_interpretation");
    expect(phase.allowedTools).toEqual(["live_env.record_live_source_mail_decision"]);
    expect(phase.requiredEvidence).toEqual(["stage_play_processed_mail_packet"]);
    expect(phase.completionEvidence).toEqual(["stage_play_live_source_mail_decision"]);
    expect(phase.nextPhase).toBe("terminal_checkpoint");
    expect(phase.terminal_eligible).toBe(false);
    expect(phase.phaseLock.locked).toBe(true);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.read_processed_live_source_mail",
      "live_env.process_live_source_mail",
      "live_env.request_interim_voice_callout",
      "final_answer",
    ]));
  });

  it("requires record_decision when the processed packet is nested in a shared gateway observation", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Read the latest processed Minecraft mail, tell me what changed, and revise the next step.",
      selectedTargetSource: "live_source_mailbox",
      latestToolReceipts: [{
        kind: "live_environment_tool_observation",
        payload: {
          tool_name: "live_env.read_processed_live_source_mail",
          observation: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.read_processed_live_source_mail",
            observation: {
              schema: "stage_play_processed_live_source_mail_read_result/v1",
              packets: [{
                artifactId: "stage_play_processed_mail_packet",
                packetId: "stage_play_processed_mail_packet:gateway-nested",
                observedFacts: ["The bounded movement workflow succeeded."],
                recommendedNext: "record_interpretation",
                salience: { level: "medium", voiceCandidate: false },
              }],
            },
          },
        },
      }],
    });

    expect(phase).toMatchObject({
      phase: "record_decision",
      canonicalGoal: "processed_mail_interpretation",
      allowedTools: ["live_env.record_live_source_mail_decision"],
      completionEvidence: ["stage_play_live_source_mail_decision"],
      nextPhase: "terminal_checkpoint",
      phaseLock: { locked: true },
    });
    expect(phase.evidenceRefs).toContain("stage_play_processed_mail_packet:gateway-nested");
  });

  it("requires a canonical processed read after process fallback before decision", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Read the visual mail and interpret what changed.",
      latestToolReceipts: [
        {
          tool_name: "live_env.read_processed_live_source_mail",
          observation: {
            packets: [],
            missingRawMailIds: ["stage_play_live_source_mail:1"],
          },
        },
        {
          tool_name: "live_env.process_live_source_mail",
          observation: {
            packets: [{
              artifactId: "stage_play_processed_mail_packet",
              packetId: "stage_play_processed_mail_packet:processed-fallback",
              observedFacts: ["The source changed from inventory to cave."],
              recommendedNext: "record_interpretation",
              salience: {
                level: "medium",
                voiceCandidate: false,
              },
            }],
          },
        },
      ],
    });

    expect(phase.phase).toBe("read_processed_mail");
    expect(phase.allowedTools).toEqual(["live_env.read_processed_live_source_mail"]);
    expect(phase.fallbackTools).toEqual(["live_env.process_live_source_mail"]);
    expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
      "live_env.record_live_source_mail_decision",
      "live_env.request_interim_voice_callout",
    ]));
    expect(phase.nextPhase).toBe("record_decision");
  });

  it("allows direct terminal checkpoint for draft_text_answer or wait processed packets", () => {
    for (const recommendedNext of ["draft_text_answer", "wait_for_next_summary"]) {
      const phase = resolveLiveSourceTurnPhase({
        prompt: "Read the visual mail and interpret what is happening.",
        processedPackets: [{
          artifactId: "stage_play_processed_mail_packet",
          packetId: `stage_play_processed_mail_packet:${recommendedNext}`,
          observedFacts: ["The source shows stable Minecraft inventory management."],
          changedFacts: [],
          recommendedNext,
          salience: {
            level: "low",
            voiceCandidate: false,
          },
        }],
      });

      expect(phase.phase).toBe("terminal_checkpoint");
      expect(phase.canonicalGoal).toBe("processed_mail_interpretation");
      expect(phase.allowedTools).toEqual([]);
      expect(phase.forbiddenTools).toEqual(expect.arrayContaining([
        "live_env.read_processed_live_source_mail",
        "live_env.process_live_source_mail",
        "live_env.record_live_source_mail_decision",
      ]));
      expect(phase.requiredEvidence).toEqual(["stage_play_processed_mail_packet"]);
      expect(phase.completionEvidence).toEqual(["model_synthesized_answer"]);
      expect(phase.nextPhase).toBe(null);
    }
  });

  it("terminalizes after a processed-mail decision receipt without another read", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Read the visual mail and interpret what is happening.",
      processedPackets: [{
        artifactId: "stage_play_processed_mail_packet",
        packetId: "stage_play_processed_mail_packet:decision-complete",
        observedFacts: ["The Minecraft source changed from forest to cave."],
        recommendedNext: "record_interpretation",
        salience: {
          level: "medium",
          voiceCandidate: false,
        },
      }],
      latestToolReceipts: [{
        tool_name: "live_env.record_live_source_mail_decision",
        observation: {
          artifactId: "stage_play_live_source_mail_decision",
          schemaVersion: "stage_play_live_source_mail_decision/v1",
          decisionId: "stage_play_live_source_mail_decision:interpret-1",
          decision: "record_interpretation",
        },
      }],
    });

    expect(phase.phase).toBe("terminal_checkpoint");
    expect(phase.canonicalGoal).toBe("processed_mail_interpretation");
    expect(phase.allowedTools).toEqual([]);
    expect(phase.forbiddenTools).toContain("live_env.read_processed_live_source_mail");
    expect(phase.requiredEvidence).toEqual([
      "stage_play_processed_mail_packet",
      "stage_play_live_source_mail_decision",
    ]);
    expect(phase.completionEvidence).toEqual(["model_synthesized_answer"]);
  });

  it("uses process fallback after a processed-mail read without packet coverage", () => {
    const phase = resolveLiveSourceTurnPhase({
      prompt: "Read the visual mail and interpret what changed.",
      selectedTargetSource: "live_source_mailbox",
      latestToolReceipts: [{
        tool_name: "live_env.read_processed_live_source_mail",
        ok: true,
        observation: {
          packets: [],
        },
      }],
    });

    expect(phase.phase).toBe("process_mail_fallback");
    expect(phase.allowedTools).toEqual(["live_env.process_live_source_mail"]);
    expect(phase.nextPhase).toBe("read_processed_mail");
  });
});
