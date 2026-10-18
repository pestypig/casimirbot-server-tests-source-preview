import { describe, expect, it } from "vitest";

import { auditHelixAskContextForPoison } from "../services/helix-ask/ask-context-poison-audit";
import { auditTerminalPresentationCoverage } from "../services/helix-ask/terminal-presentation-coverage-audit";
import { applyTerminalAnswerEnvelope, resolveTerminalAnswerEnvelope } from "../services/helix-ask/terminal-answer-envelope";
import { applyHelixTerminalAuthoritySingleWriter } from "../services/helix-ask/terminal-authority-single-writer";
import { buildHelixTurnTerminalAuthority } from "../services/helix-ask/turn-terminal-authority";
import {
  ALL_ROUTE_TERMINAL_PRODUCTS,
  buildRouteProductContract,
  isStructuredDocsViewerPrompt,
} from "../services/helix-ask/route-product-contract";

const allTerminalSurfacesEqual = (body: Record<string, any>): void => {
  const isPendingInput =
    body.terminal_artifact_kind === "request_user_input" ||
    body.final_answer_source === "request_user_input" ||
    body.resolved_turn_summary?.final_status === "pending_input";
  const expected = String(body.selected_final_answer ?? body.pending_server_request?.prompt ?? "");
  const events = Array.isArray(body.current_turn_events)
    ? body.current_turn_events
    : Array.isArray(body.turn_events)
      ? body.turn_events
      : [body.current_turn_events?.terminal_answer];
  const terminalEvent = [...events].reverse().find((event) =>
    event?.type === (isPendingInput ? "request_user_input" : "terminal_answer")
  );
  expect(body.terminal_presentation?.concise_text).toBe(expected);
  expect(body.terminal_answer_authority?.terminal_text_preview).toBe(expected);
  expect(terminalEvent?.text).toBe(expected);
  expect(body.answer ?? body.text ?? body.finalAnswer).toBe(expected);
  if (isPendingInput) expect(body.assistant_answer).toBe(false);
};

describe("Helix Ask terminal authority contracts", () => {
  it("materializes capability help from a registry observation when the catalog route requires it", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:capability-help-from-registry",
      thread_id: "thread:test",
      canonical_goal_frame: {
        goal_kind: "capability_help",
        required_terminal_kind: "capability_help_summary",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_kind: "capability_help_summary",
        allowed_terminal_artifact_kinds: ["capability_help_summary"],
        forbidden_terminal_artifact_kinds: ["tool_receipt"],
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      source_target_intent: {
        target_source: "runtime_evidence",
      },
      tool_call_admission_decision: {
        selected_capability: "helix_ask.inspect_capability_catalog",
      },
      agent_step_decision: {
        decision_id: "decision:catalog:answer",
        chosen_capability: "helix_ask.inspect_capability_catalog",
        next_step: "answer",
        decision_timing: "post_observation_terminal_review",
        decision_authority: "deterministic_policy_fallback",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "decision:catalog:inspect",
            chosen_capability: "helix_ask.inspect_capability_catalog",
            observed_artifact_refs: ["obs:capability-registry"],
          },
        ],
      },
      tool_turn_chain_audit: {
        rail_status: "fail_closed",
        rail_failure_code: "terminal_not_materialized",
        first_broken_rail: "terminal_materialization",
        repair_target: "terminal_materializer",
        selected_capability: "helix_ask.inspect_capability_catalog",
        executed_capability: "helix_ask.inspect_capability_catalog",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "obs:capability-registry",
          kind: "capability_registry",
          payload: {
            kind: "capability_registry",
            capability_catalog_observation: {
              schema: "helix.capability_catalog_observation.v1",
              active_dynamic_tool_count: 59,
              retired_dynamic_tool_count: 91,
              information_reflection: [
                "docs-viewer.locate_in_doc",
                "repo-code.search_concept",
                "scientific-calculator.solve_expression",
              ],
              utility: ["workspace.restore_view_state", "live_env.record_live_source_mail_decision"],
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
        },
      ],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId: "ask:test:capability-help-from-registry",
      threadId: "thread:test",
      payload,
    });

    expect(result.selected_terminal_artifact_kind).toBe("capability_help_summary");
    expect(result.visible_text).toContain("Helix Ask capability catalog is available");
    expect(result.visible_text).toContain("Active tool records: 59");
    expect(payload.terminal_authority_single_writer).toMatchObject({
      selected_terminal_artifact_kind: "capability_help_summary",
    });

    const envelope = applyTerminalAnswerEnvelope(payload, resolveTerminalAnswerEnvelope(payload));
    expect(envelope.terminal_artifact_kind).toBe("capability_help_summary");
    expect(envelope.final_answer_source).toBe("capability_help_summary");
    expect(envelope.terminal_text).toContain("Helix Ask capability catalog is available");
    expect(payload.terminal_artifact_kind).toBe("capability_help_summary");
    expect(payload.final_answer_source).toBe("capability_help_summary");
  });

  it("recovers capability help through the envelope when a stale typed failure is still mirrored", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:capability-help-envelope-repair",
      thread_id: "thread:test",
      ok: false,
      response_type: "final_failure",
      final_status: "final_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "committed_route_terminal_product_mismatch",
      selected_final_answer: "I could not produce a terminal answer because the selected terminal product did not match the committed Ask route.",
      text: "I could not produce a terminal answer because the selected terminal product did not match the committed Ask route.",
      canonical_goal_frame: {
        goal_kind: "capability_help",
        required_terminal_kind: "capability_help_summary",
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        canonical_goal_kind: "capability_help",
        required_terminal_kind: "capability_help_summary",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        required_evidence: [
          {
            kind: "capability_help_summary",
            required: true,
            satisfied: true,
            evidence_ref: "ask:test:capability-help-envelope-repair:capability_help_summary",
          },
        ],
      },
      tool_call_admission_decision: {
        selected_capability: "helix_ask.inspect_capability_catalog",
      },
      agent_step_decision: {
        decision_id: "decision:capability-help:terminal",
        chosen_capability: "helix_ask.inspect_capability_catalog",
        next_step: "answer",
        decision_timing: "post_observation_terminal_review",
        decision_authority: "deterministic_policy_fallback",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "decision:capability-help:inspect",
            chosen_capability: "helix_ask.inspect_capability_catalog",
            observed_artifact_refs: ["ask:test:capability-help-envelope-repair:capability_registry"],
          },
        ],
      },
      tool_lifecycle_trace: {
        lifecycle_stage: "observation_reentered",
        selected_capability: "helix_ask.inspect_capability_catalog",
        executed_capability: "helix_ask.inspect_capability_catalog",
        observation_ref: "ask:test:capability-help-envelope-repair:capability_registry",
      },
      post_tool_observation_reviews: [
        {
          schema: "helix.post_tool_observation_review.v1",
          review_id: "ask:test:capability-help-envelope-repair:post_tool_observation_review:1",
          next_step: "answer",
          selected_capability: "model.direct_answer",
          decision_authority: "llm_post_observation_review",
          assistant_answer: false,
          raw_content_included: false,
        },
      ],
      tool_turn_chain_audit: {
        rail_status: "fail_closed",
        rail_failure_code: "terminal_not_materialized",
        first_broken_rail: "terminal_materialization",
        repair_target: "terminal_materializer",
        selected_capability: "helix_ask.inspect_capability_catalog",
        executed_capability: "helix_ask.inspect_capability_catalog",
        observation_ref: "ask:test:capability-help-envelope-repair:capability_registry",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "ask:test:capability-help-envelope-repair:capability_registry",
          kind: "capability_registry",
          payload: {
            kind: "capability_registry",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        {
          artifact_id: "ask:test:capability-help-envelope-repair:capability_help_summary",
          kind: "capability_help_summary",
          payload: {
            schema: "helix.capability_help_summary.v1",
            kind: "capability_help_summary",
            text: "Helix Ask capability catalog is available from the runtime registry.",
            terminal_eligible: true,
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
    };

    const envelope = applyTerminalAnswerEnvelope(payload, resolveTerminalAnswerEnvelope(payload));
    expect(envelope.terminal_artifact_kind).toBe("capability_help_summary");
    expect(envelope.final_answer_source).toBe("capability_help_summary");
    expect(envelope.terminal_text).toBe("Helix Ask capability catalog is available from the runtime registry.");
    expect(payload.terminal_artifact_kind).toBe("capability_help_summary");
    expect(payload.final_answer_source).toBe("capability_help_summary");
    expect(payload.terminal_error_code).toBeUndefined();
  });

  it("does not let poison audit mint missing terminal authority from visible text", () => {
    const audit = auditHelixAskContextForPoison({
      thread_id: "thread:test",
      turn_id: "ask:test:missing-authority",
      payload: {
        turn_id: "ask:test:missing-authority",
        thread_id: "thread:test",
        selected_final_answer: "A terminal-looking answer.",
        answer: "A terminal-looking answer.",
        text: "A terminal-looking answer.",
        finalAnswer: "A terminal-looking answer.",
        final_answer_source: "artifact_synthesis",
        terminal_artifact_kind: "situation_context_pack",
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          concise_text: "A terminal-looking answer.",
        },
      },
      client_visible_text: "A terminal-looking answer.",
    });

    expect(audit.ok).toBe(false);
    expect(audit.terminal_authority).toBeNull();
    expect(audit.violations.map((violation) => violation.kind)).toContain("missing_terminal_authority");
  });

  it("rejects workstation observation artifacts before terminal envelope authority", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:workstation-observation-terminal",
      thread_id: "thread:test",
      terminal_artifact_kind: "stage_play_packet_trace_query_result",
      final_answer_source: "stage_play_packet_trace_query_result",
      selected_final_answer: "Packet trace says the frog classifier ran.",
      answer: "Packet trace says the frog classifier ran.",
      text: "Packet trace says the frog classifier ran.",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "Packet trace says the frog classifier ran.",
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(payload.workstation_observation_terminal_rejection).toMatchObject({
      schema: "helix.workstation_observation_terminal_rejection.v1",
      rejected_terminal_artifact_kind: "stage_play_packet_trace_query_result",
      reason: "observation_artifact_cannot_terminalize",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("observation_artifact_cannot_terminalize");
    expect(payload.selected_final_answer).not.toBe("Packet trace says the frog classifier ran.");
    expect(payload.terminal_answer_authority).toMatchObject({
      terminal_kind: "failure",
      authority_origin: "typed_failure",
      server_authoritative: true,
    });
    allTerminalSurfacesEqual(payload);
  });

  it("rejects narrator events as terminal artifacts before answer authority", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:narrator-event-terminal",
      thread_id: "thread:test",
      terminal_artifact_kind: "helix.narrator_event/v1",
      final_answer_source: "helix.narrator_event/v1",
      selected_final_answer: "Narrator spoke the translated line.",
      answer: "Narrator spoke the translated line.",
      text: "Narrator spoke the translated line.",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "Narrator spoke the translated line.",
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(payload.workstation_observation_terminal_rejection).toMatchObject({
      schema: "helix.workstation_observation_terminal_rejection.v1",
      rejected_terminal_artifact_kind: "helix.narrator_event/v1",
      reason: "observation_artifact_cannot_terminalize",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("observation_artifact_cannot_terminalize");
    expect(payload.selected_final_answer).not.toBe("Narrator spoke the translated line.");
    expect(payload.terminal_answer_authority).toMatchObject({
      terminal_kind: "failure",
      authority_origin: "typed_failure",
      server_authoritative: true,
    });
    allTerminalSurfacesEqual(payload);
  });

  it("rejects reasoning-circuit observation surfaces as terminal artifacts before solver authority", () => {
    const observationSurfaces = [
      {
        terminalArtifactKind: "helix.agent_goal_session.v1",
        finalAnswerSource: "helix.agent_goal_session.v1",
        text: "The active goal session is monitoring frog classification.",
      },
      {
        terminalArtifactKind: "stage_play_agent_goal_session_tool_result/v1",
        finalAnswerSource: "stage_play_agent_goal_session_tool_result",
        text: "The goal-session tool result says the workstation is monitoring frog classification.",
      },
      {
        terminalArtifactKind: "helix.narrator_say_request.v1",
        finalAnswerSource: "helix.narrator_say_request.v1",
        text: "Narrator was asked to speak the translated segment.",
      },
      {
        terminalArtifactKind: "helix.narrator_bind_stream_request.v1",
        finalAnswerSource: "helix.narrator_bind_stream_request.v1",
        text: "Narrator was bound to the translation stream.",
      },
      {
        terminalArtifactKind: "helix.narrator_event/v1",
        finalAnswerSource: "helix.narrator_event",
        text: "Narrator emitted a spoken translation event.",
      },
      {
        terminalArtifactKind: "helix.workstation_goal_context_update.v1",
        finalAnswerSource: "helix.workstation_goal_context_update.v1",
        text: "Goal context says the frog deck produced a candidate classification.",
      },
      {
        terminalArtifactKind: "helix.live_environment_goal_satisfaction.v1",
        finalAnswerSource: "helix.live_environment_goal_satisfaction.v1",
        text: "Goal satisfaction says the workstation gathered enough frog classification evidence.",
      },
      {
        terminalArtifactKind: "stage_play_workstation_control_receipt/v1",
        finalAnswerSource: "stage_play_workstation_control_receipt",
        text: "The workstation control receipt says the visual preset was changed.",
      },
      {
        terminalArtifactKind: "stage_play_workstation_goal_context_read_result/v1",
        finalAnswerSource: "stage_play_workstation_goal_context_read_result",
        text: "Goal context read returned the latest visual and audio loop updates.",
      },
      {
        terminalArtifactKind: "stage_play_workstation_context_feed_query_result/v1",
        finalAnswerSource: "stage_play_workstation_context_feed_query_result",
        text: "The feed query returned two visual summaries.",
      },
      {
        terminalArtifactKind: "workstation_actuator_ref",
        finalAnswerSource: "workstation_actuator_ref",
        text: "The actuator ref points at the narrator binding control.",
      },
      {
        terminalArtifactKind: "workstation_actuator_refs",
        finalAnswerSource: "workstation_actuator_refs",
        text: "Actuator refs list the live answer preset and narrator controls.",
      },
      {
        terminalArtifactKind: "actuator_refs",
        finalAnswerSource: "actuator_refs",
        text: "Actuator refs show which controls packet traces may dispatch.",
      },
      {
        terminalArtifactKind: "stage_play_workstation_actuator_refs",
        finalAnswerSource: "stage_play_workstation_actuator_refs",
        text: "Stage Play actuator refs show the panel controls attached to packet traffic.",
      },
      {
        terminalArtifactKind: "interrupt_dispatch",
        finalAnswerSource: "interrupt_dispatch",
        text: "The interrupt dispatch says Ask should inspect the latest packet.",
      },
      {
        terminalArtifactKind: "wake_request",
        finalAnswerSource: "wake_request",
        text: "The wake request says a visual packet should enter Ask.",
      },
      {
        terminalArtifactKind: "stage_play_live_source_mail_wake_request",
        finalAnswerSource: "stage_play_live_source_mail_wake_request",
        text: "The Stage Play wake request queued a mailbox handoff.",
      },
      {
        terminalArtifactKind: "stage_play_mail_wake_route_metadata",
        finalAnswerSource: "stage_play_mail_wake_route_metadata",
        text: "Route metadata attached the mailbox packet to an Ask handoff.",
      },
      {
        terminalArtifactKind: "stage_play_mailbox_wake_result",
        finalAnswerSource: "stage_play_mailbox_wake_result",
        text: "The mailbox wake result completed the interrupt dispatch.",
      },
      {
        terminalArtifactKind: "stage_play_packet_trace_query_result.v1",
        finalAnswerSource: "stage_play_packet_trace_query_result",
        text: "Packet trace says the visual source arrived at a microdeck output.",
      },
      {
        terminalArtifactKind: "live_source_causal_trace/v1",
        finalAnswerSource: "live_source_causal_trace",
        text: "The causal trace linked an audio packet to a translation deck.",
      },
      {
        terminalArtifactKind: "helix.workstation_reasoning_trace_query_result.v1",
        finalAnswerSource: "helix.workstation_reasoning_trace_query_result",
        text: "Trace memory returned a route-watch checkpoint.",
      },
      {
        terminalArtifactKind: "microdeck_output",
        finalAnswerSource: "microdeck_output",
        text: "MicroDeck output says the frog might be a tree frog.",
      },
      {
        terminalArtifactKind: "microdeck_outputs",
        finalAnswerSource: "microdeck_outputs",
        text: "MicroDeck outputs include classification and comparison lanes.",
      },
      {
        terminalArtifactKind: "stage_play_microdeck_output",
        finalAnswerSource: "stage_play_microdeck_output",
        text: "Stage Play shows the active frog classifier deck output.",
      },
      {
        terminalArtifactKind: "live_answer_projection",
        finalAnswerSource: "live_answer_projection",
        text: "Live Answer projection displayed the translated audio line.",
      },
      {
        terminalArtifactKind: "stage_play_live_answer_projection",
        finalAnswerSource: "stage_play_live_answer_projection",
        text: "Stage Play projected the latest Live Answer shade output.",
      },
      {
        terminalArtifactKind: "panel_projection",
        finalAnswerSource: "panel_projection",
        text: "The panel projection showed the packet was routed to Narrator.",
      },
      {
        terminalArtifactKind: "visual_summaries",
        finalAnswerSource: "visual_summaries",
        text: "Visual summaries mention a frog-like animal in the image.",
      },
      {
        terminalArtifactKind: "audio_transcripts",
        finalAnswerSource: "audio_transcripts",
        text: "Audio transcripts captured the spoken phrase.",
      },
      {
        terminalArtifactKind: "translated_transcripts",
        finalAnswerSource: "translated_transcripts",
        text: "Translated transcripts produced the English line.",
      },
      {
        terminalArtifactKind: "narrator_events",
        finalAnswerSource: "narrator_events",
        text: "Narrator events show that the translation was spoken.",
      },
      {
        terminalArtifactKind: "narrator_bindings",
        finalAnswerSource: "narrator_bindings",
        text: "Narrator bindings show the stream is connected.",
      },
      {
        terminalArtifactKind: "source_health",
        finalAnswerSource: "source_health",
        text: "Source health says the visual source is fresh.",
      },
      {
        terminalArtifactKind: "automation_policies",
        finalAnswerSource: "automation_policies",
        text: "Automation policies allow route-watch polling.",
      },
      {
        terminalArtifactKind: "automation_status",
        finalAnswerSource: "automation_status",
        text: "Automation status says the loop is paused.",
      },
      {
        terminalArtifactKind: "trace_memory",
        finalAnswerSource: "trace_memory",
        text: "Trace memory contains the previous packet route.",
      },
      {
        terminalArtifactKind: "packet_traces",
        finalAnswerSource: "packet_traces",
        text: "Packet traces show separate audio and visual lanes.",
      },
      {
        terminalArtifactKind: "route_evidence",
        finalAnswerSource: "route_evidence",
        text: "Route evidence contains a non-terminal checkpoint.",
      },
    ];

    for (const { terminalArtifactKind, finalAnswerSource, text } of observationSurfaces) {
      const payload: Record<string, unknown> = {
        turn_id: `ask:test:${terminalArtifactKind}`,
        thread_id: "thread:test",
        terminal_artifact_kind: terminalArtifactKind,
        final_answer_source: finalAnswerSource,
        selected_final_answer: text,
        answer: text,
        text,
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          concise_text: text,
        },
      };

      const envelope = resolveTerminalAnswerEnvelope(payload);
      applyTerminalAnswerEnvelope(payload, envelope);

      expect(payload.workstation_observation_terminal_rejection).toMatchObject({
        schema: "helix.workstation_observation_terminal_rejection.v1",
        rejected_terminal_artifact_kind: terminalArtifactKind,
        reason: "observation_artifact_cannot_terminalize",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      });
      expect(payload.terminal_artifact_kind).toBe("typed_failure");
      expect(payload.final_answer_source).toBe("typed_failure");
      expect(payload.terminal_error_code).toBe("observation_artifact_cannot_terminalize");
      expect(payload.selected_final_answer).not.toBe(text);
      expect(payload.terminal_answer_authority).toMatchObject({
        terminal_kind: "failure",
        authority_origin: "typed_failure",
        server_authoritative: true,
      });
      allTerminalSurfacesEqual(payload);
    }
  });

  it("rejects mailbox wake results as terminal artifacts before answer authority", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:wake-result-terminal",
      thread_id: "thread:test",
      terminal_artifact_kind: "stage_play_live_source_mail_wake_result/v1",
      final_answer_source: "stage_play_mailbox_wake_result",
      selected_final_answer: "The live-source mailbox wake completed.",
      answer: "The live-source mailbox wake completed.",
      text: "The live-source mailbox wake completed.",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "The live-source mailbox wake completed.",
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(payload.workstation_observation_terminal_rejection).toMatchObject({
      schema: "helix.workstation_observation_terminal_rejection.v1",
      rejected_terminal_artifact_kind: "stage_play_live_source_mail_wake_result/v1",
      reason: "observation_artifact_cannot_terminalize",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("observation_artifact_cannot_terminalize");
    expect(payload.selected_final_answer).not.toBe("The live-source mailbox wake completed.");
    expect(payload.terminal_answer_authority).toMatchObject({
      terminal_kind: "failure",
      authority_origin: "typed_failure",
      server_authoritative: true,
    });
    allTerminalSurfacesEqual(payload);
  });

  it("rejects mailbox wake result projections as terminal artifacts before answer authority", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:wake-result-projection-terminal",
      thread_id: "thread:test",
      terminal_artifact_kind: "stage_play_live_source_mail_wake_result_projection/v1",
      final_answer_source: "stage_play_live_source_mail_wake_result_projection",
      selected_final_answer: "Wake projection recorded decision receipts.",
      answer: "Wake projection recorded decision receipts.",
      text: "Wake projection recorded decision receipts.",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "Wake projection recorded decision receipts.",
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(payload.workstation_observation_terminal_rejection).toMatchObject({
      schema: "helix.workstation_observation_terminal_rejection.v1",
      rejected_terminal_artifact_kind: "stage_play_live_source_mail_wake_result_projection/v1",
      reason: "observation_artifact_cannot_terminalize",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("observation_artifact_cannot_terminalize");
    expect(payload.selected_final_answer).not.toBe("Wake projection recorded decision receipts.");
    expect(payload.terminal_answer_authority).toMatchObject({
      terminal_kind: "failure",
      authority_origin: "typed_failure",
      server_authoritative: true,
    });
    allTerminalSurfacesEqual(payload);
  });

  it("uses existing payload terminal authority without rebuilding it", () => {
    const terminalAuthority = buildHelixTurnTerminalAuthority({
      thread_id: "thread:test",
      turn_id: "ask:test:existing-authority",
      final_answer_source: "artifact_synthesis",
      terminal_artifact_kind: "situation_context_pack",
      terminal_text: "A terminal answer.",
      authority_origin: "terminal_presentation",
    });
    const audit = auditHelixAskContextForPoison({
      thread_id: "thread:test",
      turn_id: "ask:test:existing-authority",
      payload: {
        turn_id: "ask:test:existing-authority",
        thread_id: "thread:test",
        selected_final_answer: "A terminal answer.",
        answer: "A terminal answer.",
        text: "A terminal answer.",
        finalAnswer: "A terminal answer.",
        final_answer_source: "artifact_synthesis",
        terminal_artifact_kind: "situation_context_pack",
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          concise_text: "A terminal answer.",
        },
        terminal_answer_authority: terminalAuthority,
        current_turn_events: {
          terminal_answer: { type: "terminal_answer", text: "A terminal answer." },
        },
      },
      client_visible_text: "A terminal answer.",
    });

    expect(audit.ok).toBe(true);
    expect(audit.terminal_authority?.server_terminal_text_hash).toBe(terminalAuthority.terminal_text_hash);
  });

  it("lets selected terminal presentation beat fallback visible text", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:fallback",
      thread_id: "thread:test",
      selected_final_answer: "Correct terminal answer.",
      terminal_artifact_kind: "situation_context_pack",
      final_answer_source: "artifact_synthesis",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "Correct terminal answer.",
      },
      answer: "Retrying after tool timeout...",
      text: "Retrying after tool timeout...",
      assistant_answer: "Retrying after tool timeout...",
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(payload.terminal_answer_authority).toMatchObject({
      authority_origin: "terminal_presentation",
      terminal_text_preview: "Correct terminal answer.",
    });
    expect((payload.terminal_answer_authority as Record<string, unknown>).terminal_text_preview).not.toBe("Retrying after tool timeout...");
    expect((payload.poison_audit as Record<string, unknown>).ok).toBe(true);
    expect((payload.terminal_presentation_coverage_audit as Record<string, unknown>).violations).toEqual([]);
    allTerminalSurfacesEqual(payload);
  });

  it("materializes doc_summary artifact synthesis into all terminal surfaces", () => {
    const summary =
      "Summary of docs/helix-ask-flow.md:\n- Helix Ask starts by framing intent and route authority.\n- Tool observations must re-enter evidence before terminal selection.\n- The selected doc_summary is the only terminal answer.";
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:doc-summary-envelope",
      thread_id: "thread:test",
      selected_final_answer: summary,
      terminal_artifact_kind: "doc_summary",
      final_answer_source: "artifact_synthesis",
      canonical_goal_frame: {
        goal_kind: "doc_summary",
        required_terminal_kind: "doc_summary",
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_step_decision: {
        decision_id: "decision:doc-summary",
        next_step: "answer",
        chosen_capability: "docs-viewer.summarize_doc",
        decision_timing: "post_observation",
        decision_authority: "deterministic_policy_fallback",
      },
      agent_runtime_loop: {
        terminal_state: "terminal_satisfied",
        iterations: [
          {
            decision_id: "decision:doc-summary",
            capability_key: "docs-viewer.summarize_doc",
            chosen_capability: "docs-viewer.summarize_doc",
            observed_artifact_refs: ["artifact:doc-summary"],
            decision_timing: "post_observation",
            decision_authority: "deterministic_policy_fallback",
            next_step: "answer",
            status: "succeeded",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "artifact:doc-summary",
          kind: "doc_summary",
          capability_key: "docs-viewer.summarize_doc",
          payload: {
            schema: "helix.doc_summary.v1",
            text: summary,
          },
        },
      ],
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: summary,
      },
      terminal_error_code: "terminal_authority_missing",
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "terminal_authority_missing",
        text: "I could not complete that turn.\nCause: terminal_authority_missing.",
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(payload.terminal_artifact_kind).toBe("doc_summary");
    expect(payload.final_answer_source).toBe("artifact_synthesis");
    expect(payload.terminal_error_code ?? null).toBeNull();
    expect(payload.typed_failure ?? null).toBeNull();
    expect((payload.terminal_answer_envelope as Record<string, unknown>).terminal_text).toBe(summary);
    expect((payload.terminal_answer_authority as Record<string, unknown>).server_authoritative).toBe(true);
    expect((payload.terminal_presentation_coverage_audit as Record<string, unknown>).violations).toEqual([]);
    allTerminalSurfacesEqual(payload);
  });

  it("does not mint live-source processed mail summaries as typed-failure authority", () => {
    const contentSummary =
      "The processed visual mail shows stage_play_live_source_mail:hud: objective=collect samples; hotbar: selected=compass.";
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:live-source-envelope",
      thread_id: "thread:test",
      ok: false,
      response_type: "final_failure",
      final_status: "final_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "typed_failure",
      terminal_failure_text: contentSummary,
      selected_final_answer: contentSummary,
      answer: contentSummary,
      text: contentSummary,
      finalAnswer: contentSummary,
      content: contentSummary,
      canonical_goal_frame: {
        goal_kind: "live_source_processed_mail_interpretation",
        required_terminal_kind: "model_synthesized_answer",
      },
      source_target_intent: {
        target_source: "live_source_mailbox",
        strength: "hard",
        must_backend: true,
      },
      route_product_contract: {
        source_target: "live_source_mailbox",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer"],
      },
      resolved_turn_summary: {
        resolved_route_label: "live_source_processed_mail_interpretation / model_synthesized_answer",
      },
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "typed_failure",
        message: contentSummary,
        text: contentSummary,
        answer_text: contentSummary,
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(envelope.terminal_artifact_kind).toBe("typed_failure");
    expect(envelope.final_answer_source).toBe("typed_failure");
    expect(envelope.terminal_kind).toBe("failure");
    expect(envelope.terminal_text).toContain("no valid model-synthesized answer passed terminal authority");
    expect(envelope.terminal_text).not.toBe(contentSummary);
    expect(payload.terminal_error_code).toBe("post_tool_model_step_missing");
    expect((payload.typed_failure as Record<string, unknown>).message).toBe(envelope.terminal_text);
    expect((payload.terminal_answer_authority as Record<string, unknown>).terminal_text_preview).toBe(
      envelope.terminal_text,
    );
    allTerminalSurfacesEqual(payload);
  });

  it("clears stale failure metadata when a successful terminal becomes authoritative", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:stale-failure-success",
      thread_id: "thread:test",
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      terminal_error_code: "agent_loop_budget_exhausted",
      terminal_failure_text: "The old loop budget failed.",
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "agent_loop_budget_exhausted",
        text: "The old loop budget failed.",
      },
      satisfaction_report: {
        missing_reason: "agent_loop_budget_exhausted",
      },
      source_target_intent: {
        target_source: "model_only",
        target_kind: "general_background",
      },
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
      },
      agent_step_decision: {
        decision_id: "decision:model-direct",
        next_step: "answer",
        chosen_capability: "model.direct_answer",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "decision:model-direct",
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            decision_timing: "terminal_review",
            decision_authority: "model",
            observation_role: "model_answer_draft",
            observed_artifact_refs: ["direct-answer-1", "final-draft-1"],
          },
        ],
      },
      direct_answer_text: {
        schema: "helix.direct_answer_text.v1",
        artifact_id: "direct-answer-1",
        text: "An electron is a negatively charged elementary particle.",
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "final-draft-1",
        text: "An electron is a negatively charged elementary particle.",
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "An electron is a negatively charged elementary particle.",
      },
      debug: {
        terminal_error_code: "agent_loop_budget_exhausted",
        typed_failure: { error_code: "agent_loop_budget_exhausted" },
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(payload.terminal_artifact_kind).toBe("direct_answer_text");
    expect(payload.final_answer_source).toBe("model_direct_answer");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.terminal_failure_text).toBeUndefined();
    expect(payload.typed_failure).toBeUndefined();
    expect(payload.rejected_typed_failure).toMatchObject({
      error_code: "agent_loop_budget_exhausted",
      rejected_reason: "successful_terminal_authority_superseded_failure",
    });
    expect((payload.satisfaction_report as Record<string, unknown>).missing_reason).toBeNull();
    expect((payload.debug as Record<string, unknown>).terminal_error_code).toBeUndefined();
    expect((payload.debug as Record<string, unknown>).typed_failure).toBeUndefined();
  });

  it("promotes pending request-user-input over stale terminal-boundary typed failure", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:pending-input-over-failure",
      thread_id: "thread:test",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "terminal_boundary_ineligible",
      final_status: "pending_input",
      response_type: "pending_input",
      pending_server_request: {
        schema: "helix.request_user_input.v1",
        prompt: "I can prepare Dottie voice output, but I need the source event or text and your confirmation before speaking.",
      },
      goal_satisfaction_evaluation: {
        satisfaction: "needs_user_input",
        next_decision: "request_user_input",
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(envelope.terminal_artifact_kind).toBe("request_user_input");
    expect(envelope.final_answer_source).toBe("request_user_input");
    expect(envelope.terminal_kind).toBe("request_user_input");
    expect(envelope.terminal_text).toMatch(/need the source event or text/i);
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.terminal_request_user_input_promotion).toMatchObject({
      applied: true,
      prior_terminal_artifact_kind: "typed_failure",
      prior_terminal_error_code: "terminal_boundary_ineligible",
    });
    allTerminalSurfacesEqual(payload);
  });

  it("does not promote unavailable placeholder text into a successful terminal answer", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:placeholder-success",
      thread_id: "thread:test",
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      source_target_intent: {
        target_source: "model_only",
        target_kind: "general_background",
      },
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
      },
      agent_step_decision: {
        decision_id: "decision:model-direct-placeholder",
        next_step: "answer",
        chosen_capability: "model.direct_answer",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "decision:model-direct-placeholder",
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            decision_timing: "terminal_review",
            decision_authority: "model",
            observation_role: "model_answer_draft",
            observed_artifact_refs: ["direct-answer-placeholder", "final-draft-placeholder"],
          },
        ],
      },
      direct_answer_text: {
        schema: "helix.direct_answer_text.v1",
        artifact_id: "direct-answer-placeholder",
        text: "I could not produce a terminal answer for this turn.",
      },
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "final-draft-placeholder",
        text: "I could not produce a terminal answer for this turn.",
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "I could not produce a terminal answer for this turn.",
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("terminal_answer_unavailable");
    expect(payload.final_status).not.toBe("final_answer");
    expect(payload.terminal_answer_authority).toMatchObject({
      terminal_kind: "failure",
      authority_origin: "typed_failure",
    });
  });

  it("does not promote deterministic repo evidence fallback text into a successful terminal", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:repo-fallback-terminal",
      thread_id: "thread:test",
      terminal_artifact_kind: "repo_code_evidence_answer",
      final_answer_source: "model_synthesis_from_repo_evidence",
      selected_final_answer: [
        "I found current repo evidence for Situation Room.",
        "",
        "Key evidence:",
        "- client/src/components/workstation/SituationRoomPipelinesPanel.tsx: export function SituationRoomPipelinesPanel()",
      ].join("\n"),
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "final-draft-repo",
        authority: "deterministic_receipt_fallback",
        text: "I found current repo evidence for Situation Room.",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "repo-obs-1",
          kind: "repo_code_evidence_observation",
          payload: {
            schema: "helix.repo_code_evidence_observation.v1",
            evidence_refs: ["client/src/components/workstation/SituationRoomPipelinesPanel.tsx:1"],
          },
        },
      ],
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: [
          "I found current repo evidence for Situation Room.",
          "",
          "Key evidence:",
          "- client/src/components/workstation/SituationRoomPipelinesPanel.tsx: export function SituationRoomPipelinesPanel()",
        ].join("\n"),
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("repo_evidence_synthesis_failed");
    expect((payload.repo_answer_text_quality_gate as Record<string, unknown>).ok).toBe(false);
    expect((payload.repo_answer_text_quality_gate as Record<string, unknown>).violations).toEqual(
      expect.arrayContaining(["missing_model_synthesis", "canned_fallback_text"]),
    );
  });

  it("does not let stale presentation text override typed failure authority", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:typed-failure-stale-presentation",
      thread_id: "thread:test",
      selected_final_answer: "You're viewing a developer environment.",
      answer: "You're viewing a developer environment.",
      text: "You're viewing a developer environment.",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "terminal_authority_before_solver_completion",
      typed_failure: {
        schema: "helix.typed_failure.v1",
        message: "I could not complete this Ask turn because solver authority failed (terminal_authority_before_solver_completion).",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "You're viewing a developer environment.",
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(envelope).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      authority_origin: "typed_failure",
      terminal_text:
        "I could not complete this Ask turn because solver authority failed (terminal_authority_before_solver_completion).",
    });
    allTerminalSurfacesEqual(payload);
    expect(payload.selected_final_answer).not.toBe("You're viewing a developer environment.");
  });

  it("treats typed failure source as failure even when artifact kind is stale", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:typed-failure-stale-artifact",
      thread_id: "thread:test",
      selected_final_answer: "Created workstation note \"Open document summary\".",
      answer: "Created workstation note \"Open document summary\".",
      text: "Created workstation note \"Open document summary\".",
      terminal_artifact_kind: "note_mutation_result",
      final_answer_source: "typed_failure",
      terminal_failure_text: "I could not complete this turn because the note tool call was missing required arguments.",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "Created workstation note \"Open document summary\".",
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(envelope).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      authority_origin: "typed_failure",
      terminal_text: "I could not complete this turn because the note tool call was missing required arguments.",
    });
    allTerminalSurfacesEqual(payload);
    expect(payload.selected_final_answer).not.toMatch(/Created workstation note/i);
  });

  it("flags stale typed failure presentation text as non-authoritative", () => {
    const failureText =
      "I could not complete this Ask turn because solver authority failed (terminal_authority_before_solver_completion).";
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:typed-failure-coverage",
      thread_id: "thread:test",
      selected_final_answer: "You're viewing a developer environment.",
      answer: "You're viewing a developer environment.",
      terminal_artifact_kind: "typed_failure",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "You're viewing a developer environment.",
      },
      terminal_answer_authority: buildHelixTurnTerminalAuthority({
        thread_id: "thread:test",
        turn_id: "ask:test:typed-failure-coverage",
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
        terminal_text: failureText,
        authority_origin: "typed_failure",
      }),
      poison_audit: {
        schema: "helix.turn_poison_audit.v1",
        ok: true,
      },
      current_turn_events: [{ type: "terminal_answer", text: failureText }],
    };

    const audit = auditTerminalPresentationCoverage({
      payload,
      turnId: "ask:test:typed-failure-coverage",
      route: "situation_context_question",
      terminalArtifactKind: "typed_failure",
      selectedFinalAnswer: failureText,
    });

    expect(audit.violations).toContain("terminal_presentation_not_authority_text");
    expect(audit.canonical_terminal_text_hash).toBe(audit.authority_text_hash);
  });

  it("detects authority text drift from presentation text", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:authority-drift",
      thread_id: "thread:test",
      selected_final_answer: "A",
      answer: "A",
      text: "A",
      finalAnswer: "A",
      terminal_artifact_kind: "situation_context_pack",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "A",
      },
      current_turn_events: {
        terminal_answer: { type: "terminal_answer", text: "A" },
      },
      terminal_answer_authority: buildHelixTurnTerminalAuthority({
        thread_id: "thread:test",
        turn_id: "ask:test:authority-drift",
        final_answer_source: "artifact_synthesis",
        terminal_artifact_kind: "situation_context_pack",
        terminal_text: "B",
        authority_origin: "selected_final_answer",
      }),
    };

    const audit = auditHelixAskContextForPoison({
      thread_id: "thread:test",
      turn_id: "ask:test:authority-drift",
      payload,
      terminal_authority: payload.terminal_answer_authority as any,
      client_visible_text: "A",
    });

    expect(audit.ok).toBe(false);
    expect(audit.violations.map((violation) => violation.kind)).toContain("terminal_authority_presentation_mismatch");
  });

  it("detects current-turn terminal answer event drift", () => {
    const payload: Record<string, unknown> = {
      turn_id: "ask:test:event-drift",
      thread_id: "thread:test",
      selected_final_answer: "A",
      answer: "A",
      text: "A",
      finalAnswer: "A",
      terminal_artifact_kind: "situation_context_pack",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "A",
      },
      current_turn_events: {
        terminal_answer: { type: "terminal_answer", text: "Retrying..." },
      },
      terminal_answer_authority: buildHelixTurnTerminalAuthority({
        thread_id: "thread:test",
        turn_id: "ask:test:event-drift",
        final_answer_source: "artifact_synthesis",
        terminal_artifact_kind: "situation_context_pack",
        terminal_text: "A",
        authority_origin: "terminal_presentation",
      }),
    };

    const audit = auditHelixAskContextForPoison({
      thread_id: "thread:test",
      turn_id: "ask:test:event-drift",
      payload,
      terminal_authority: payload.terminal_answer_authority as any,
      client_visible_text: "A",
    });

    expect(audit.ok).toBe(false);
    expect(audit.violations.map((violation) => violation.kind)).toContain("terminal_event_presentation_mismatch");
  });

  it("makes every route-product contract total over known terminal products", () => {
    const sourceTargets = [
      "visual_capture",
      "procedure_memory",
      "situation_epoch",
      "live_pipeline",
      "world_event",
      "docs_viewer",
      "active_doc",
      "repo_code",
      "runtime_evidence",
      "visual_scene_memory",
      "process_graph",
      "model_only",
      "general_background",
      "unknown",
    ] as const;

    for (const sourceTarget of sourceTargets) {
      const contract = buildRouteProductContract({
        turnId: `ask:test:${sourceTarget}`,
        threadId: "thread:test",
        sourceTargetIntent: {
          schema: "helix.ask_source_target_intent.v1",
          target_source: sourceTarget,
        },
        promptText: "test prompt",
      });

      for (const product of ALL_ROUTE_TERMINAL_PRODUCTS) {
        const allowed = contract.allowed_terminal_artifact_kinds.includes(product);
        const forbidden = contract.forbidden_terminal_artifact_kinds.includes(product);
        expect(allowed).not.toBe(forbidden);
      }
    }
  });

  it("treats natural docs path prompts as docs-viewer product contracts", () => {
    const prompt =
      "summarize /docs/architecture/paper-ingestion-paperrun-contract-v1.md from docs in 4 bullets include the path";

    expect(isStructuredDocsViewerPrompt(prompt)).toBe(true);

    const contract = buildRouteProductContract({
      turnId: "ask:test:natural-docs-path",
      threadId: "thread:test",
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "unknown",
      },
      promptText: prompt,
    });

    expect(contract.source_target).toBe("docs_viewer");
    expect(contract.allowed_terminal_artifact_kinds).toContain("doc_summary");
    expect(contract.forbidden_terminal_artifact_kinds).not.toContain("doc_summary");
  });

  it("treats named Image Lens receipt evaluation as a bounded visual terminal product", () => {
    const contract = buildRouteProductContract({
      turnId: "ask:test:image-lens-named-receipt",
      threadId: "thread:test",
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "scientific_image_evidence",
        target_kind: "scientific_image_named_receipt",
        requested_outputs: ["image_lens_named_receipt_evaluation", "typed_failure"],
      },
      promptText: "Use only the latest Image Lens observation receipt named crop_1 and report its status.",
    });

    expect(contract.source_target).toBe("visual_capture");
    expect(contract.allowed_terminal_artifact_kinds).toContain("image_lens_named_receipt_evaluation");
    expect(contract.allowed_terminal_artifact_kinds).toContain("image_lens_observation_report");
    expect(contract.forbidden_terminal_artifact_kinds).not.toContain("image_lens_named_receipt_evaluation");
    expect(contract.forbidden_terminal_artifact_kinds).toContain("model_synthesized_answer");
    expect(contract.forbidden_terminal_artifact_kinds).toContain("scholarly_research_answer");
  });

  it("treats explicit Dottie manifest prompts as workstation panel product contracts", () => {
    const contract = buildRouteProductContract({
      turnId: "ask:test:dottie-manifest",
      threadId: "thread:test",
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "unknown",
      },
      promptText: "Manifest Auntie Dottie as a witness-only observer preset for this room.",
    });

    expect(contract.source_target).toBe("workstation_panel");
    expect(contract.allowed_terminal_artifact_kinds).toContain("workstation_tool_evaluation");
    expect(contract.forbidden_terminal_artifact_kinds).not.toContain("workstation_tool_evaluation");
  });

  it("keeps repo evidence observations as side evidence and repo answers as terminals", () => {
    const contract = buildRouteProductContract({
      turnId: "ask:test:repo-concept",
      threadId: "thread:test",
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "repo_code",
      },
      promptText: "What is the Situation Room?",
    });

    expect(contract.allowed_terminal_artifact_kinds).toContain("repo_code_evidence_answer");
    expect(contract.allowed_terminal_artifact_kinds).toEqual([
      "repo_code_evidence_answer",
      "request_user_input",
      "typed_failure",
    ]);
    expect(contract.forbidden_terminal_artifact_kinds).toEqual(expect.arrayContaining([
      "direct_answer_text",
      "no_tool_direct",
      "model_only_concept",
      "client_projection",
      "panel_generated_answer",
      "workspace_action_receipt",
      "live_pipeline_receipt",
      "docs_viewer_receipt",
      "repo_entity_definition",
    ]));
    expect(contract.side_artifact_kinds_allowed).toContain("repo_code_evidence_observation");
  });

  it("allows explicit create-note receipts as terminal authority", () => {
    const contract = buildRouteProductContract({
      turnId: "ask:test:create-note-terminal-contract",
      threadId: "thread:test",
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "unknown",
      },
      promptText: 'Make a note for me "hh".',
    });

    expect(contract.allowed_terminal_artifact_kinds).toContain("note_update_receipt");
    expect(contract.allowed_terminal_artifact_kinds).not.toContain("model_synthesized_answer");
    expect(contract.forbidden_terminal_artifact_kinds).toEqual(expect.arrayContaining([
      "model_synthesized_answer",
      "direct_answer_text",
      "panel_generated_answer",
    ]));
    expect(contract.side_artifact_kinds_allowed).toEqual(expect.arrayContaining([
      "workspace_action_receipt",
      "note_action_receipt",
      "note_create_receipt",
    ]));
  });

  it("keeps append-style note mutation receipts as side evidence and requires synthesized terminal text", () => {
    const contract = buildRouteProductContract({
      turnId: "ask:test:note-mutation-terminal-contract",
      threadId: "thread:test",
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "unknown",
      },
      promptText: "Append this summary to the existing note titled Tool Test: receipts are observations.",
    });

    expect(contract.allowed_terminal_artifact_kinds).toContain("model_synthesized_answer");
    expect(contract.allowed_terminal_artifact_kinds).not.toContain("note_update_receipt");
    expect(contract.forbidden_terminal_artifact_kinds).toEqual(expect.arrayContaining([
      "note_update_receipt",
      "note_action_receipt",
      "note_create_receipt",
    ]));
    expect(contract.side_artifact_kinds_allowed).toEqual(expect.arrayContaining([
      "note_update_receipt",
      "note_action_receipt",
      "note_create_receipt",
    ]));
  });
});
