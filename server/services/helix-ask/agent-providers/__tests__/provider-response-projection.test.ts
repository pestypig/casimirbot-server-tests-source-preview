import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listWorkstationGatewayCapabilities } from "../../workstation-tool-gateway/registry";
import { seedBackendLiveVisualSourceSwitchForAskTest } from "../../../situation-room/live-visual-test-harness";
import { buildHelixAgentRuntimeSelectionTrace } from "../runtime-debug";
import { buildHelixAgentProviderAskPayload } from "../provider-response-projection";
import type { HelixAgentProvider, HelixAgentRunRoute, HelixAgentRunResult } from "../types";

const buildProvider = (id: "codex" | "future"): HelixAgentProvider => ({
  id,
  label: id === "codex" ? "Codex Workstation Mode" : "Future Agent Wrapper",
  permissionProfile: {
    id: id === "codex" ? "read-observe-act" : "read-observe",
    label: id === "codex" ? "Read/observe plus non-mutating workstation action" : "Read/observe only",
    allows: {
      observe: true,
      read: true,
      act: id === "codex",
      write: false,
      shell: false,
      codeMutation: false,
    },
  },
  enabled: () => true,
  supports: {
    streaming: false,
    workstationTools: true,
    capabilityLanes: true,
    capabilityLaneOneShot: true,
    capabilityLaneSessions: id === "codex",
    codeMutation: false,
  },
  runTurn: async () => ({
    ok: true,
    runtime: id,
    response_type: "final_answer",
    final_status: "completed",
  }),
});

const buildPayload = (input: {
  provider: HelixAgentProvider;
  route: HelixAgentRunRoute;
  turnId: string;
  providerResult: HelixAgentRunResult;
  requestBody?: Record<string, unknown>;
}) => {
  const gatewayManifest = listWorkstationGatewayCapabilities({
    agentRuntime: input.provider.id,
    mode: input.provider.id === "codex" ? "act" : "observe",
  });
  const runtimeSelectionTrace = buildHelixAgentRuntimeSelectionTrace({
    route: input.route,
    requestedRuntime: input.provider.id,
    provider: input.provider,
    gatewayManifest,
  });

  return buildHelixAgentProviderAskPayload({
    provider: input.provider,
    providerResult: input.providerResult,
    requestBody: input.requestBody,
    runtimeSelectionTrace,
    gatewayManifest,
    turnId: input.turnId,
  });
};

describe("agent provider response projection", () => {
  it("redacts inline image bytes from the public response and debug mirrors", () => {
    const provider = buildProvider("codex");
    const inlineImage = `data:image/png;base64,${"a".repeat(40_000)}`;
    const payload = buildPayload({
      provider,
      route: "/ask/turn",
      turnId: "turn-public-image-redaction",
      providerResult: {
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        debug: {
          capability_lane_observation_packets: [{
            state_delta: { crop_image_ref: inlineImage },
          }],
          runtime_lane_request_loop: `candidate=${inlineImage}`,
        },
      },
    });
    const serialized = JSON.stringify(payload);
    const sizeControl = payload.provider_response_size_control as Record<string, unknown>;

    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("a".repeat(1_000));
    expect(serialized).toContain("helix-inline-image-ref:redacted");
    expect(sizeControl).toMatchObject({
      inline_image_references_redacted: 2,
      unique_inline_images_redacted: 1,
      raw_inline_images_included: false,
    });
  });

  it("projects bounded conversational referent diagnostics to payload and debug", () => {
    const provider = buildProvider("codex");
    const providerResult: HelixAgentRunResult = {
      ok: true,
      runtime: "codex",
      text: "Specific follow-up answer.",
      response_type: "final_answer",
      final_status: "completed",
      debug: {
        conversational_referent_resolution: {
          schema: "helix.ask.conversational_referent_resolution.v1",
          referent_detected: true,
          resolved_source_ref: "chat.final_answer.previous:turn-current",
          resolution_confidence: "high",
          raw_content_included: false,
        },
        chat_referent_context_presence: {
          schema: "helix.ask.chat_referent_context_presence.v1",
          present: true,
          previous_assistant_final_answer_ref: "chat.final_answer.previous:turn-current",
          previous_assistant_final_answer_hash: "hash-current",
          raw_content_included: false,
        },
        chat_referent_context_source_summary: {
          schema: "helix.ask.chat_referent_context_source_summary.v1",
          selected_source_name: "visible_ask_transcript",
          total_reply_count: 4,
          readable_reply_count: 4,
          context_present: true,
          raw_content_included: false,
        },
      },
    };

    const payload = buildPayload({
      provider,
      route: "/ask/turn",
      turnId: "turn-referent-projection",
      providerResult,
    });
    const debug = payload.debug as Record<string, unknown>;

    expect(payload.conversational_referent_resolution).toMatchObject({
      resolved_source_ref: "chat.final_answer.previous:turn-current",
      resolution_confidence: "high",
    });
    expect(payload.chat_referent_context_presence).toMatchObject({
      previous_assistant_final_answer_ref: "chat.final_answer.previous:turn-current",
    });
    expect(payload.chat_referent_context_source_summary).toMatchObject({
      selected_source_name: "visible_ask_transcript",
      context_present: true,
    });
    expect(debug.conversational_referent_resolution).toEqual(
      payload.conversational_referent_resolution,
    );
    expect(debug.chat_referent_context_source_summary).toEqual(
      payload.chat_referent_context_source_summary,
    );
  });

  it("preserves the committed request route on provider responses and debug mirrors", () => {
    const provider = buildProvider("codex");
    const committedRoute = {
      schema: "helix.committed_ask_route.v1",
      turn_id: "turn-route-projection",
    };
    const routeEvidenceAuthority = {
      schema: "helix.route_evidence_authority.v1",
      turn_id: "turn-route-projection",
    };
    const routeProductContract = {
      schema: "helix.route_product_contract.v1",
      source_target: "visual_capture",
      required_terminal_kind: "image_lens_named_receipt_evaluation",
      allowed_terminal_artifact_kinds: ["image_lens_named_receipt_evaluation", "typed_failure"],
    };
    const payload = buildPayload({
      provider,
      route: "/ask/turn",
      turnId: "turn-route-projection",
      providerResult: {
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        text: "model-authored answer",
      },
      requestBody: {
        committed_ask_route: committedRoute,
        route_evidence_authority: routeEvidenceAuthority,
        route_product_contract: routeProductContract,
      },
    });

    expect(payload.committed_ask_route).toEqual(committedRoute);
    expect(payload.route_evidence_authority).toEqual(routeEvidenceAuthority);
    expect(payload.route_product_contract).toEqual(routeProductContract);
    expect((payload.debug as Record<string, unknown>).committed_ask_route).toEqual(committedRoute);
    expect((payload.debug as Record<string, unknown>).route_evidence_authority).toEqual(routeEvidenceAuthority);
    expect((payload.debug as Record<string, unknown>).route_product_contract).toEqual(routeProductContract);
  });

  it("preserves provider-selected terminal authority when the debug mirror omits it", () => {
    const provider = buildProvider("codex");
    const terminalAuthority = {
      schema: "helix.turn_terminal_authority.v1",
      server_authoritative: true,
      terminal_kind: "answer",
      terminal_artifact_kind: "scholarly_research_answer",
      final_answer_source: "scientific_image_evidence_continuity_summary",
      terminal_text: "Recovered scientific evidence packet.",
    };
    const payload = buildPayload({
      provider,
      route: "/ask/turn",
      turnId: "turn-provider-terminal-fallback",
      providerResult: {
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        answer: "Recovered scientific evidence packet.",
        selected_final_answer: "Recovered scientific evidence packet.",
        final_answer_source: "scientific_image_evidence_continuity_summary",
        terminal_artifact_kind: "scholarly_research_answer",
        terminal_answer_authority: terminalAuthority,
        debug: {
          terminal_authority_status: "selected",
        },
      } as HelixAgentRunResult,
    });
    const debug = payload.debug as Record<string, unknown>;

    expect(payload.final_answer_source).toBe("scientific_image_evidence_continuity_summary");
    expect(payload.terminal_artifact_kind).toBe("scholarly_research_answer");
    expect(payload.terminal_answer_authority).toEqual(terminalAuthority);
    expect(debug.final_answer_source).toBe("scientific_image_evidence_continuity_summary");
    expect(debug.terminal_artifact_kind).toBe("scholarly_research_answer");
    expect(debug.terminal_answer_authority).toEqual(terminalAuthority);
  });

  it("projects Codex non-stream payload and debug fields with capability lane metadata", () => {
    const provider = buildProvider("codex");
    const providerResult: HelixAgentRunResult = {
      ok: true,
      runtime: "codex",
      response_type: "final_answer",
      final_status: "completed",
      answer: "calculator result",
      action_envelope: {
        schema: "helix.action_envelope.v1",
      },
      turn_transcript_events: [
        {
          event: "agent_final",
        },
      ],
      support_refs: ["artifact:calculator"],
      tool_output_refs: ["tool:calculator"],
      debug: {
        agent_runtime_adapter_contract: {
          schema: "helix.agent_runtime_adapter_contract.v1",
        },
        capability_lane_manifest: {
          schema: "helix.capability_lane_manifest.v1",
        },
        capability_lane_ids: ["utility_text", "workstation_tool_reference"],
        capability_lane_statuses: {
          utility_text: "available",
        },
        capability_lane_resolve_trace_shape: {
          schema: "helix.capability_lane_resolve_trace.v1",
        },
        capability_lane_resolve_traces: [
          {
            schema: "helix.capability_lane_resolve_trace.v1",
            requested_lane: "live_translation",
            selected_backend_provider: "live_translation.local_runtime",
            execution_status: "executed_observation_only",
          },
        ],
        capability_lane_backend_selections: [
          {
            schema: "helix.capability_lane.backend_selection_summary.v1",
            lane_id: "live_translation",
            capability: "live_translation.translate_text",
            selected_backend_provider: "live_translation.local_runtime",
          },
        ],
        capability_lane_call_results: [
          {
            schema: "helix.live_translation.one_shot_result.v1",
            capability: "live_translation.translate_text",
          },
        ],
        capability_lane_observation_packets: [
          {
            schema: "helix.agent_step_observation_packet.v1",
            capability_key: "live_translation.translate_text",
          },
        ],
        capability_lane_projection_receipts: [
          {
            schema: "helix.capability_lane.provider_adapter_receipt.v1",
            receipt_ref: "ask:lane:translation:obs:projection:receipt",
            observation_ref: "ask:lane:translation:obs",
            capability_key: "live_translation.translate_text",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
        capability_lane_turn_timeline: [
          {
            schema: "helix.capability_lane.provider_timeline_event.v1",
            seq: 0,
            stage: "lane_visible",
            selected_runtime_agent_provider: "codex",
            lane_id: "live_translation",
            capability_id: "live_translation.translate_text",
            status: "available",
            lane_visible: true,
            lane_requested: false,
            lane_executed: false,
            observation_reentered: false,
            selected_backend_provider: "live_translation.local_runtime",
            observation_ref: null,
            receipt_ref: null,
            terminal_authority_status: "not_terminal_authority",
            reentry_required: true,
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
          {
            schema: "helix.capability_lane.provider_timeline_event.v1",
            seq: 1,
            stage: "lane_observation",
            selected_runtime_agent_provider: "codex",
            lane_id: "live_translation",
            capability_id: "live_translation.translate_text",
            status: "completed",
            lane_visible: false,
            lane_requested: true,
            lane_executed: true,
            observation_reentered: false,
            selected_backend_provider: "live_translation.local_runtime",
            observation_ref: "ask:lane:translation:obs",
            receipt_ref: "ask:lane:translation:obs:projection:receipt",
            terminal_authority_status: "pending_helix_terminal_authority",
            reentry_required: true,
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
        capability_lane_session_results: [
          {
            ok: true,
            action: "start",
            blocked_reason: null,
            lane_session: {
              schema: "helix.capability_lane.session.v1",
              lane_session_id: "lane-session-debug",
              lane_id: "live_translation",
              selected_runtime_agent_provider: "codex",
              selected_backend_provider: "live_translation.local_runtime",
              status: "running",
              health: "healthy",
              terminal_eligible: false,
              assistant_answer: false,
              raw_content_included: false,
            },
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
        capability_lane_session_debug_summaries: [
          {
            schema: "helix.capability_lane.session_debug_summary.v1",
            lane_session_id: "lane-session-debug",
            lane_id: "live_translation",
            selected_runtime_agent_provider: "codex",
            selected_backend_provider: "live_translation.local_runtime",
            session_status: "running",
            session_health: "healthy",
            last_receipt_ref: null,
            terminal_authority_status: "pending_helix_terminal_authority",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
        capability_lane_goal_binding_results: [
          {
            ok: true,
            goal_binding: {
              schema: "helix.capability_lane.goal_binding.v1",
              goal_binding_id: "goal-binding-debug",
              goal_id: "goal:translate-docs",
              lane_session_id: "lane-session-debug",
              lane_id: "live_translation",
              selected_runtime_agent_provider: "codex",
              selected_backend_provider: "live_translation.local_runtime",
              status: "bound",
              backend_provider_becomes_root_agent: false,
              final_reports_require_terminal_authority: true,
              terminal_eligible: false,
              assistant_answer: false,
              raw_content_included: false,
            },
            blocked_reason: null,
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
        capability_lane_mail_loop_debug_summaries: [
          {
            schema: "helix.capability_lane.mail_loop_debug_summary.v1",
            lane_session_id: "lane-session-debug",
            lane_id: "live_translation",
            capability: "live_translation.translate_text",
            observation_ref: "ask:lane:translation:obs",
            receipt_ref: null,
            stage_play_mail_id: "stage-play-mail-debug",
            stage_play_wake_expected: true,
            stage_play_wake_kind: "mailbox_wake",
            mailbox_thread_id: "ask-thread-debug",
            terminal_authority_status: "pending_helix_terminal_authority",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
        capability_lane_goal_binding_debug_summaries: [
          {
            schema: "helix.capability_lane.goal_binding_debug_summary.v1",
            goal_binding_id: "goal-binding-debug",
            goal_id: "goal:translate-docs",
            lane_session_id: "lane-session-debug",
            lane_id: "live_translation",
            selected_runtime_agent_provider: "codex",
            selected_backend_provider: "live_translation.local_runtime",
            terminal_authority_status: "pending_helix_terminal_authority",
            report_decision: {
              schema: "helix.capability_lane.goal_report_decision.v1",
              action: "wake_on_salience",
              reason: "goal_binding_policy_requests_wake_on_salience",
              wake_expected: true,
              surface_badge_expected: false,
              terminal_report_requested: false,
              terminal_report_authorized: false,
              terminal_report_requires_authority: true,
              terminal_authority_status: "pending_helix_terminal_authority",
              evidence_ref: "ask:lane:translation:obs",
              mail_loop_ref: "stage-play-mail-debug",
              receipt_ref: null,
              reentry_required: true,
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
            dispatch_plan: {
              schema: "helix.capability_lane.goal_dispatch_plan.v1",
              target: "ask_wake",
              status: "planned_not_dispatched",
              reason: "goal_binding_policy_plans_ask_wake",
              source_report_action: "wake_on_salience",
              goal_binding_id: "goal-binding-debug",
              goal_id: "goal:translate-docs",
              lane_session_id: "lane-session-debug",
              lane_id: "live_translation",
              evidence_ref: "ask:lane:translation:obs",
              mail_loop_ref: "stage-play-mail-debug",
              receipt_ref: null,
              requires_live_mail_loop: true,
              requires_terminal_authority: false,
              side_effects_executed: false,
              wake_dispatched: false,
              badge_projected: false,
              terminal_report_emitted: false,
              terminal_authority_status: "pending_helix_terminal_authority",
              reentry_required: true,
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
            dispatch_admission: {
              schema: "helix.capability_lane.goal_dispatch_admission.v1",
              status: "eligible_waiting_for_mail_loop",
              reason: "goal_dispatch_admission_eligible_waiting_for_mail_loop",
              target: "ask_wake",
              goal_binding_id: "goal-binding-debug",
              goal_id: "goal:translate-docs",
              lane_session_id: "lane-session-debug",
              lane_id: "live_translation",
              evidence_ref: "ask:lane:translation:obs",
              mail_loop_ref: "stage-play-mail-debug",
              receipt_ref: null,
              blocked_reason: null,
              requires_live_mail_loop: true,
              requires_terminal_authority: false,
              side_effects_allowed: false,
              side_effects_executed: false,
              wake_dispatch_allowed: false,
              badge_projection_allowed: false,
              terminal_report_allowed: false,
              terminal_authority_status: "pending_helix_terminal_authority",
              reentry_required: true,
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
        workstation_gateway_call_results: [{ capability_id: "scientific-calculator.solve_expression" }],
        workstation_gateway_observation_packets: [{ observation_ref: "obs:calculator" }],
        tool_lifecycle_traces: [{ capability_id: "scientific-calculator.solve_expression" }],
        tool_followup_decisions: [{ decision: "reenter_observation" }],
        runtime_lane_request_contract: {
          schema: "helix.runtime_agent_lane_request_contract.v1",
          pending_capability_lane_request: false,
        },
        provider_solver_completion_audit: {
          schema: "helix.provider_solver_completion_audit.v1",
          provider_solver_path_completed: true,
          provider_goal_satisfied: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        provider_terminal_candidate: { text: "calculator result" },
        provider_reasoning_reentry: { status: "complete" },
        terminal_authority_candidate_review: { status: "accepted" },
        provider_terminal_authority_bridge: { status: "bridged" },
        terminal_answer_authority: { terminal_authority_ok: true },
        terminal_presentation: { final_answer: "calculator result" },
        final_answer_source: "provider_terminal_candidate",
        terminal_artifact_kind: "final_answer",
        provider_gateway_debug_summary: { gateway_call_count: 1 },
        codex_runtime_status: { launchable: true },
      },
    };

    const payload = buildPayload({
      provider,
      route: "/ask/turn",
      turnId: "turn-codex",
      providerResult,
    });
    const debug = payload.debug as Record<string, unknown>;

    expect(payload.answer).toBe("calculator result");
    expect(payload.turn_id).toBe("turn-codex");
    expect(payload.agent_runtime).toBe("codex");
    expect(payload.selected_agent_provider).toMatchObject({
      id: "codex",
      label: "Codex Workstation Mode",
    });
    expect(payload.workstation_gateway_capability_ids).toContain("scientific-calculator.solve_expression");
    expect(payload.agent_runtime_adapter_contract).toMatchObject({
      schema: "helix.agent_runtime_adapter_contract.v1",
    });
    expect(payload.capability_lane_manifest).toMatchObject({
      schema: "helix.capability_lane_manifest.v1",
    });
    expect(payload.capability_lane_ids).toContain("workstation_tool_reference");
    expect(payload.capability_lane_statuses).toMatchObject({
      utility_text: "available",
    });
    expect(payload.capability_lane_resolve_trace_shape).toMatchObject({
      schema: "helix.capability_lane_resolve_trace.v1",
    });
    expect(payload.capability_lane_resolve_traces).toEqual([
      {
        schema: "helix.capability_lane_resolve_trace.v1",
        requested_lane: "live_translation",
        selected_backend_provider: "live_translation.local_runtime",
        execution_status: "executed_observation_only",
      },
    ]);
    expect(payload.capability_lane_backend_selections).toEqual([
      {
        schema: "helix.capability_lane.backend_selection_summary.v1",
        lane_id: "live_translation",
        capability: "live_translation.translate_text",
        selected_backend_provider: "live_translation.local_runtime",
      },
    ]);
    expect(payload.capability_lane_call_results).toEqual([
      {
        schema: "helix.live_translation.one_shot_result.v1",
        capability: "live_translation.translate_text",
      },
    ]);
    expect(payload.capability_lane_observation_packets).toEqual([
      {
        schema: "helix.agent_step_observation_packet.v1",
        capability_key: "live_translation.translate_text",
      },
    ]);
    expect(payload.capability_lane_projection_receipts).toEqual([
      {
        schema: "helix.capability_lane.provider_adapter_receipt.v1",
        receipt_ref: "ask:lane:translation:obs:projection:receipt",
        observation_ref: "ask:lane:translation:obs",
        capability_key: "live_translation.translate_text",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    ]);
    expect(payload.capability_lane_session_results).toEqual([
      {
        ok: true,
        action: "start",
        blocked_reason: null,
        lane_session: {
          schema: "helix.capability_lane.session.v1",
          lane_session_id: "lane-session-debug",
          lane_id: "live_translation",
          selected_runtime_agent_provider: "codex",
          selected_backend_provider: "live_translation.local_runtime",
          status: "running",
          health: "healthy",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    ]);
    expect(payload.capability_lane_session_debug_summaries).toEqual([
      {
        schema: "helix.capability_lane.session_debug_summary.v1",
        lane_session_id: "lane-session-debug",
        lane_id: "live_translation",
        selected_runtime_agent_provider: "codex",
        selected_backend_provider: "live_translation.local_runtime",
        session_status: "running",
        session_health: "healthy",
        last_receipt_ref: null,
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    ]);
    expect(payload.capability_lane_goal_binding_results).toEqual([
      {
        ok: true,
        goal_binding: {
          schema: "helix.capability_lane.goal_binding.v1",
          goal_binding_id: "goal-binding-debug",
          goal_id: "goal:translate-docs",
          lane_session_id: "lane-session-debug",
          lane_id: "live_translation",
          selected_runtime_agent_provider: "codex",
          selected_backend_provider: "live_translation.local_runtime",
          status: "bound",
          backend_provider_becomes_root_agent: false,
          final_reports_require_terminal_authority: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        blocked_reason: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    ]);
    expect(payload.capability_lane_mail_loop_debug_summaries).toEqual([
      {
        schema: "helix.capability_lane.mail_loop_debug_summary.v1",
        lane_session_id: "lane-session-debug",
        lane_id: "live_translation",
        capability: "live_translation.translate_text",
        observation_ref: "ask:lane:translation:obs",
        receipt_ref: null,
        stage_play_mail_id: "stage-play-mail-debug",
        stage_play_wake_expected: true,
        stage_play_wake_kind: "mailbox_wake",
        mailbox_thread_id: "ask-thread-debug",
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    ]);
    expect(payload.capability_lane_goal_binding_debug_summaries).toEqual([
      {
        schema: "helix.capability_lane.goal_binding_debug_summary.v1",
        goal_binding_id: "goal-binding-debug",
        goal_id: "goal:translate-docs",
        lane_session_id: "lane-session-debug",
        lane_id: "live_translation",
        selected_runtime_agent_provider: "codex",
        selected_backend_provider: "live_translation.local_runtime",
        terminal_authority_status: "pending_helix_terminal_authority",
        report_decision: {
          schema: "helix.capability_lane.goal_report_decision.v1",
          action: "wake_on_salience",
          reason: "goal_binding_policy_requests_wake_on_salience",
          wake_expected: true,
          surface_badge_expected: false,
          terminal_report_requested: false,
          terminal_report_authorized: false,
          terminal_report_requires_authority: true,
          terminal_authority_status: "pending_helix_terminal_authority",
          evidence_ref: "ask:lane:translation:obs",
          mail_loop_ref: "stage-play-mail-debug",
          receipt_ref: null,
          reentry_required: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        dispatch_plan: {
          schema: "helix.capability_lane.goal_dispatch_plan.v1",
          target: "ask_wake",
          status: "planned_not_dispatched",
          reason: "goal_binding_policy_plans_ask_wake",
          source_report_action: "wake_on_salience",
          goal_binding_id: "goal-binding-debug",
          goal_id: "goal:translate-docs",
          lane_session_id: "lane-session-debug",
          lane_id: "live_translation",
          evidence_ref: "ask:lane:translation:obs",
          mail_loop_ref: "stage-play-mail-debug",
          receipt_ref: null,
          requires_live_mail_loop: true,
          requires_terminal_authority: false,
          side_effects_executed: false,
          wake_dispatched: false,
          badge_projected: false,
          terminal_report_emitted: false,
          terminal_authority_status: "pending_helix_terminal_authority",
          reentry_required: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        dispatch_admission: {
          schema: "helix.capability_lane.goal_dispatch_admission.v1",
          status: "eligible_waiting_for_mail_loop",
          reason: "goal_dispatch_admission_eligible_waiting_for_mail_loop",
          target: "ask_wake",
          goal_binding_id: "goal-binding-debug",
          goal_id: "goal:translate-docs",
          lane_session_id: "lane-session-debug",
          lane_id: "live_translation",
          evidence_ref: "ask:lane:translation:obs",
          mail_loop_ref: "stage-play-mail-debug",
          receipt_ref: null,
          blocked_reason: null,
          requires_live_mail_loop: true,
          requires_terminal_authority: false,
          side_effects_allowed: false,
          side_effects_executed: false,
          wake_dispatch_allowed: false,
          badge_projection_allowed: false,
          terminal_report_allowed: false,
          terminal_authority_status: "pending_helix_terminal_authority",
          reentry_required: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    ]);
    expect(payload.capability_lane_goal_dispatch_plans).toEqual([
      {
        schema: "helix.capability_lane.goal_dispatch_plan.v1",
        target: "ask_wake",
        status: "planned_not_dispatched",
        reason: "goal_binding_policy_plans_ask_wake",
        source_report_action: "wake_on_salience",
        goal_binding_id: "goal-binding-debug",
        goal_id: "goal:translate-docs",
        lane_session_id: "lane-session-debug",
        lane_id: "live_translation",
        evidence_ref: "ask:lane:translation:obs",
        mail_loop_ref: "stage-play-mail-debug",
        receipt_ref: null,
        requires_live_mail_loop: true,
        requires_terminal_authority: false,
        side_effects_executed: false,
        wake_dispatched: false,
        badge_projected: false,
        terminal_report_emitted: false,
        terminal_authority_status: "pending_helix_terminal_authority",
        reentry_required: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    ]);
    expect(payload.capability_lane_goal_dispatch_admissions).toEqual([
      {
        schema: "helix.capability_lane.goal_dispatch_admission.v1",
        status: "eligible_waiting_for_mail_loop",
        reason: "goal_dispatch_admission_eligible_waiting_for_mail_loop",
        target: "ask_wake",
        goal_binding_id: "goal-binding-debug",
        goal_id: "goal:translate-docs",
        lane_session_id: "lane-session-debug",
        lane_id: "live_translation",
        evidence_ref: "ask:lane:translation:obs",
        mail_loop_ref: "stage-play-mail-debug",
        receipt_ref: null,
        blocked_reason: null,
        requires_live_mail_loop: true,
        requires_terminal_authority: false,
        side_effects_allowed: false,
        side_effects_executed: false,
        wake_dispatch_allowed: false,
        badge_projection_allowed: false,
        terminal_report_allowed: false,
        terminal_authority_status: "pending_helix_terminal_authority",
        reentry_required: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    ]);
    expect(payload.capability_lane_goal_dispatch_readiness).toMatchObject({
      schema: "helix.capability_lane.goal_dispatch_readiness.v1",
      total_plans: 1,
      total_admissions: 1,
      admitted_count: 1,
      blocked_count: 0,
      pending_wake_count: 1,
      next_lane_ids: ["live_translation"],
      next_lane_session_ids: ["lane-session-debug"],
      next_dispatch_targets: ["ask_wake"],
      next_goal_binding_ids: ["goal-binding-debug"],
      next_evidence_refs: ["ask:lane:translation:obs"],
      next_receipt_refs: [],
      side_effects_allowed: false,
      side_effects_executed: false,
      wake_dispatch_allowed: false,
      badge_projection_allowed: false,
      terminal_report_allowed: false,
      terminal_report_emitted: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(payload.workstation_gateway_call_results).toEqual([
      { capability_id: "scientific-calculator.solve_expression" },
    ]);
    expect(payload.terminal_answer_authority).toMatchObject({
      terminal_authority_ok: true,
    });
    expect(payload.action_envelope).toMatchObject({
      schema: "helix.action_envelope.v1",
    });
    expect(payload.support_refs).toEqual(["artifact:calculator"]);
    expect(payload.tool_output_refs).toEqual(["tool:calculator"]);
    expect(debug.agent_runtime).toBe("codex");
    expect(debug.capability_lane_manifest).toEqual(payload.capability_lane_manifest);
    expect(debug.capability_lane_call_results).toEqual(payload.capability_lane_call_results);
    expect(debug.capability_lane_observation_packets).toEqual(payload.capability_lane_observation_packets);
    expect(debug.capability_lane_projection_receipts).toEqual(payload.capability_lane_projection_receipts);
    expect(debug.capability_lane_backend_selections).toEqual(payload.capability_lane_backend_selections);
    expect(payload.capability_lane_turn_timeline).toEqual([
      expect.objectContaining({
        schema: "helix.capability_lane.provider_timeline_event.v1",
        stage: "lane_visible",
        lane_visible: true,
        lane_requested: false,
        lane_executed: false,
        observation_reentered: false,
      }),
      expect.objectContaining({
        stage: "lane_observation",
        lane_visible: false,
        lane_requested: true,
        lane_executed: true,
        observation_ref: "ask:lane:translation:obs",
      }),
    ]);
    expect(debug.capability_lane_turn_timeline).toEqual(payload.capability_lane_turn_timeline);
    expect(debug.capability_lane_session_results).toEqual(payload.capability_lane_session_results);
    expect(debug.capability_lane_session_debug_summaries).toEqual(
      payload.capability_lane_session_debug_summaries,
    );
    expect(debug.capability_lane_goal_binding_results).toEqual(
      payload.capability_lane_goal_binding_results,
    );
    expect(debug.capability_lane_mail_loop_debug_summaries).toEqual(
      payload.capability_lane_mail_loop_debug_summaries,
    );
    expect(debug.capability_lane_goal_binding_debug_summaries).toEqual(
      payload.capability_lane_goal_binding_debug_summaries,
    );
    expect(debug.capability_lane_goal_dispatch_plans).toEqual(
      payload.capability_lane_goal_dispatch_plans,
    );
    expect(debug.capability_lane_goal_dispatch_admissions).toEqual(
      payload.capability_lane_goal_dispatch_admissions,
    );
    expect(debug.capability_lane_goal_dispatch_readiness).toEqual(
      payload.capability_lane_goal_dispatch_readiness,
    );
    expect(debug.workstation_gateway_call_results).toEqual(payload.workstation_gateway_call_results);
    expect(payload.runtime_lane_request_contract).toMatchObject({
      schema: "helix.runtime_agent_lane_request_contract.v1",
      pending_capability_lane_request: false,
    });
    expect(payload.provider_solver_completion_audit).toMatchObject({
      schema: "helix.provider_solver_completion_audit.v1",
      provider_solver_path_completed: true,
      provider_goal_satisfied: true,
    });
    expect(debug.provider_solver_completion_audit).toEqual(
      payload.provider_solver_completion_audit,
    );
    expect(debug.provider_terminal_candidate).toEqual(payload.provider_terminal_candidate);
    expect(debug.codex_runtime_status).toEqual({ launchable: true });
  });

  it("projects stream fallback payloads through the same provider envelope", () => {
    const provider = buildProvider("codex");
    const payload = buildPayload({
      provider,
      route: "/ask/turn/stream",
      turnId: "turn-stream",
      providerResult: {
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        answer: "stream final",
        debug: {
          capability_lane_manifest: {
            schema: "helix.capability_lane_manifest.v1",
          },
          capability_lane_ids: ["utility_text"],
          workstation_gateway_call_results: [{ capability_id: "workspace.status" }],
        },
      },
    });
    const debug = payload.debug as Record<string, unknown>;

    expect(payload.turn_id).toBe("turn-stream");
    expect((payload.agent_runtime_selection_trace as Record<string, unknown>).route).toBe("/ask/turn/stream");
    expect(payload.capability_lane_manifest).toMatchObject({
      schema: "helix.capability_lane_manifest.v1",
    });
    expect(payload.capability_lane_ids).toEqual(["utility_text"]);
    expect(payload.capability_lane_goal_binding_results).toEqual([]);
    expect(payload.workstation_gateway_call_results).toEqual([{ capability_id: "workspace.status" }]);
    expect(debug.capability_lane_ids).toEqual(["utility_text"]);
    expect(debug.capability_lane_goal_binding_results).toEqual([]);
    expect(debug.workstation_gateway_call_results).toEqual(payload.workstation_gateway_call_results);
  });

  it("derives mail-loop debug summaries from goal-binding summaries when explicit summaries are absent", () => {
    const provider = buildProvider("codex");
    const payload = buildPayload({
      provider,
      route: "/ask/turn",
      turnId: "turn-derived-mail-loop",
      providerResult: {
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        answer: "mail-loop derived",
        debug: {
          capability_lane_goal_binding_debug_summaries: [
            {
              schema: "helix.capability_lane.goal_binding_debug_summary.v1",
              goal_binding_id: "goal-binding-derived-mail",
              goal_id: "goal:translate-docs",
              lane_session_id: "lane-session-derived-mail",
              lane_id: "live_translation",
              latest_mail_loop_summary: {
                schema: "helix.capability_lane.mail_loop_debug_summary.v1",
                lane_session_id: "lane-session-derived-mail",
                lane_id: "live_translation",
                capability: "live_translation.translate_text",
                observation_ref: "ask:lane:translation:derived-mail-obs",
                receipt_ref: "ask:lane:translation:derived-mail-receipt",
                stage_play_mail_id: "stage-play-mail-derived",
                stage_play_wake_expected: true,
                stage_play_wake_kind: "mailbox_wake",
                mailbox_thread_id: "ask-thread-derived",
                terminal_authority_status: "pending_helix_terminal_authority",
                terminal_eligible: false,
                assistant_answer: false,
                raw_content_included: false,
              },
              terminal_eligible: false,
              assistant_answer: false,
              raw_content_included: false,
            },
          ],
        },
      },
    });
    const debug = payload.debug as Record<string, unknown>;

    expect(payload.capability_lane_mail_loop_debug_summaries).toEqual([
      {
        schema: "helix.capability_lane.mail_loop_debug_summary.v1",
        lane_session_id: "lane-session-derived-mail",
        lane_id: "live_translation",
        capability: "live_translation.translate_text",
        observation_ref: "ask:lane:translation:derived-mail-obs",
        receipt_ref: "ask:lane:translation:derived-mail-receipt",
        stage_play_mail_id: "stage-play-mail-derived",
        stage_play_wake_expected: true,
        stage_play_wake_kind: "mailbox_wake",
        mailbox_thread_id: "ask-thread-derived",
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    ]);
    expect(debug.capability_lane_mail_loop_debug_summaries).toEqual(
      payload.capability_lane_mail_loop_debug_summaries,
    );
  });

  it("derives goal dispatch admissions from direct dispatch plans when summaries are absent", () => {
    const provider = buildProvider("codex");
    const payload = buildPayload({
      provider,
      route: "/ask/turn",
      turnId: "turn-direct-dispatch-plan",
      providerResult: {
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        answer: "direct dispatch plan visible",
        debug: {
          capability_lane_goal_dispatch_plans: [
            {
              schema: "helix.capability_lane.goal_dispatch_plan.v1",
              target: "ask_wake",
              status: "planned_not_dispatched",
              reason: "goal_binding_policy_plans_ask_wake",
              source_report_action: "wake_on_salience",
              goal_binding_id: "goal-binding-direct-plan",
              goal_id: "goal:direct-plan",
              lane_session_id: "lane-session-direct-plan",
              lane_id: "live_translation",
              evidence_ref: "ask:lane:translation:direct-plan-obs",
              mail_loop_ref: null,
              receipt_ref: null,
              requires_live_mail_loop: true,
              requires_terminal_authority: false,
              side_effects_executed: false,
              wake_dispatched: false,
              badge_projected: false,
              terminal_report_emitted: false,
              terminal_authority_status: "pending_helix_terminal_authority",
              reentry_required: true,
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
          ],
        },
      },
    });
    const debug = payload.debug as Record<string, unknown>;

    expect(payload.capability_lane_goal_binding_debug_summaries).toEqual([]);
    expect(payload.capability_lane_goal_dispatch_plans).toHaveLength(1);
    expect(payload.capability_lane_goal_dispatch_admissions).toEqual([
      {
        schema: "helix.capability_lane.goal_dispatch_admission.v1",
        status: "blocked",
        reason: "goal_dispatch_admission_blocked:missing_mail_loop_ref",
        target: "ask_wake",
        goal_binding_id: "goal-binding-direct-plan",
        goal_id: "goal:direct-plan",
        lane_session_id: "lane-session-direct-plan",
        lane_id: "live_translation",
        source_id: null,
        source_hash: null,
        source_kind: null,
        source_projection_target: null,
        account_locale: null,
        latest_chunk_id: null,
        latest_chunk_index: null,
        latest_source_id: null,
        latest_source_hash: null,
        latest_source_kind: null,
        latest_target_language: null,
        latest_event_id: null,
        latest_dedupe_key: null,
        latest_source_event_id: null,
        latest_source_event_ms: null,
        latest_observed_at_ms: null,
        latest_freshness_status: null,
        source_text_hash: null,
        source_text_char_count: null,
        latest_projection_target: null,
        target_language: null,
        latest_cancel_requested: null,
        permissions: undefined,
        session_event_count: null,
        has_observation: false,
        evidence_ref: "ask:lane:translation:direct-plan-obs",
        mail_loop_ref: null,
        receipt_ref: null,
        blocked_reason: "missing_mail_loop_ref",
        requires_live_mail_loop: true,
        requires_terminal_authority: false,
        side_effects_allowed: false,
        side_effects_executed: false,
        wake_dispatch_allowed: false,
        badge_projection_allowed: false,
        terminal_report_allowed: false,
        terminal_authority_status: "pending_helix_terminal_authority",
        reentry_required: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    ]);
    expect(payload.capability_lane_goal_dispatch_readiness).toMatchObject({
      schema: "helix.capability_lane.goal_dispatch_readiness.v1",
      total_plans: 1,
      total_admissions: 1,
      admitted_count: 0,
      blocked_count: 1,
      pending_wake_count: 0,
      blocked_reasons: ["missing_mail_loop_ref"],
      next_lane_ids: [],
      next_lane_session_ids: [],
      next_dispatch_targets: [],
      next_goal_binding_ids: [],
      next_evidence_refs: [],
      next_receipt_refs: [],
      side_effects_allowed: false,
      side_effects_executed: false,
      wake_dispatch_allowed: false,
      badge_projection_allowed: false,
      terminal_report_allowed: false,
      terminal_report_emitted: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(debug.capability_lane_goal_dispatch_admissions).toEqual(
      payload.capability_lane_goal_dispatch_admissions,
    );
    expect(debug.capability_lane_goal_dispatch_readiness).toEqual(
      payload.capability_lane_goal_dispatch_readiness,
    );
  });

  it("rebuilds stale goal dispatch readiness objects that do not expose receipt refs", () => {
    const provider = buildProvider("codex");
    const payload = buildPayload({
      provider,
      route: "/ask/turn",
      turnId: "turn-stale-readiness",
      providerResult: {
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        answer: "readiness rebuilt",
        debug: {
          capability_lane_goal_dispatch_plans: [
            {
              schema: "helix.capability_lane.goal_dispatch_plan.v1",
              target: "ask_wake",
              status: "planned_not_dispatched",
              reason: "goal_binding_policy_plans_ask_wake",
              source_report_action: "wake_on_salience",
              goal_binding_id: "goal-binding-stale-readiness",
              goal_id: "goal:stale-readiness",
              lane_session_id: "lane-session-stale-readiness",
              lane_id: "live_translation",
              source_id: "docs:stale-readiness",
              source_hash: "sha256:stale-readiness",
              evidence_ref: "ask:lane:translation:stale-readiness-obs",
              mail_loop_ref: "stage-play-mail-stale-readiness",
              receipt_ref: "ask:lane:translation:stale-readiness-obs:projection:receipt",
              requires_live_mail_loop: true,
              requires_terminal_authority: false,
              side_effects_executed: false,
              wake_dispatched: false,
              badge_projected: false,
              terminal_report_emitted: false,
              terminal_authority_status: "pending_helix_terminal_authority",
              reentry_required: true,
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
          ],
          capability_lane_goal_dispatch_admissions: [
            {
              schema: "helix.capability_lane.goal_dispatch_admission.v1",
              status: "eligible_waiting_for_mail_loop",
              reason: "goal_dispatch_admission_eligible_waiting_for_mail_loop",
              target: "ask_wake",
              goal_binding_id: "goal-binding-stale-readiness",
              goal_id: "goal:stale-readiness",
              lane_session_id: "lane-session-stale-readiness",
              lane_id: "live_translation",
              source_id: "docs:stale-readiness",
              source_hash: "sha256:stale-readiness",
              evidence_ref: "ask:lane:translation:stale-readiness-obs",
              mail_loop_ref: "stage-play-mail-stale-readiness",
              receipt_ref: "ask:lane:translation:stale-readiness-obs:projection:receipt",
              blocked_reason: null,
              requires_live_mail_loop: true,
              requires_terminal_authority: false,
              side_effects_allowed: false,
              side_effects_executed: false,
              wake_dispatch_allowed: false,
              badge_projection_allowed: false,
              terminal_report_allowed: false,
              terminal_authority_status: "pending_helix_terminal_authority",
              reentry_required: true,
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
          ],
          capability_lane_goal_dispatch_readiness: {
            schema: "helix.capability_lane.goal_dispatch_readiness.v1",
            total_plans: 1,
            total_admissions: 1,
            admitted_count: 1,
            blocked_count: 0,
            pending_wake_count: 1,
            pending_terminal_authority_count: 0,
            projection_only_count: 0,
            manual_review_count: 0,
            debug_only_count: 0,
            blocked_reasons: [],
            next_dispatch_targets: ["ask_wake"],
            next_goal_binding_ids: ["goal-binding-stale-readiness"],
            side_effects_allowed: false,
            side_effects_executed: false,
            wake_dispatch_allowed: false,
            badge_projection_allowed: false,
            terminal_report_allowed: false,
            terminal_report_emitted: false,
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      },
    });
    const debug = payload.debug as Record<string, unknown>;

    expect(payload.capability_lane_goal_dispatch_readiness).toMatchObject({
      schema: "helix.capability_lane.goal_dispatch_readiness.v1",
      total_plans: 1,
      total_admissions: 1,
      admitted_count: 1,
      blocked_count: 0,
      next_lane_ids: ["live_translation"],
      next_lane_session_ids: ["lane-session-stale-readiness"],
      next_dispatch_targets: ["ask_wake"],
      next_goal_binding_ids: ["goal-binding-stale-readiness"],
      next_source_ids: ["docs:stale-readiness"],
      next_source_hashes: ["sha256:stale-readiness"],
      next_evidence_refs: ["ask:lane:translation:stale-readiness-obs"],
      next_receipt_refs: ["ask:lane:translation:stale-readiness-obs:projection:receipt"],
      side_effects_allowed: false,
      wake_dispatch_allowed: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(debug.capability_lane_goal_dispatch_readiness).toEqual(
      payload.capability_lane_goal_dispatch_readiness,
    );
  });

  it("rebuilds goal dispatch readiness when source hashes are missing from the rollup", () => {
    const provider = buildProvider("codex");
    const payload = buildPayload({
      provider,
      route: "/ask/turn",
      turnId: "turn-stale-readiness-source-hash",
      providerResult: {
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        answer: "readiness source hash rebuilt",
        debug: {
          capability_lane_goal_dispatch_admissions: [
            {
              schema: "helix.capability_lane.goal_dispatch_admission.v1",
              status: "eligible_waiting_for_mail_loop",
              reason: "goal_dispatch_admission_eligible_waiting_for_mail_loop",
              target: "ask_wake",
              goal_binding_id: "goal-binding-hash-readiness",
              goal_id: "goal:hash-readiness",
              lane_session_id: "lane-session-hash-readiness",
              lane_id: "live_translation",
              source_id: "docs:hash-readiness",
              source_hash: "sha256:hash-readiness",
              evidence_ref: "ask:lane:translation:hash-readiness-obs",
              mail_loop_ref: "stage-play-mail-hash-readiness",
              receipt_ref: "ask:lane:translation:hash-readiness-obs:projection:receipt",
              blocked_reason: null,
              requires_live_mail_loop: true,
              requires_terminal_authority: false,
              side_effects_allowed: false,
              side_effects_executed: false,
              wake_dispatch_allowed: false,
              badge_projection_allowed: false,
              terminal_report_allowed: false,
              terminal_authority_status: "pending_helix_terminal_authority",
              reentry_required: true,
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
          ],
          capability_lane_goal_dispatch_readiness: {
            schema: "helix.capability_lane.goal_dispatch_readiness.v1",
            total_plans: 0,
            total_admissions: 1,
            admitted_count: 1,
            blocked_count: 0,
            pending_wake_count: 1,
            pending_terminal_authority_count: 0,
            projection_only_count: 0,
            manual_review_count: 0,
            debug_only_count: 0,
            blocked_reasons: [],
            next_lane_ids: ["live_translation"],
            next_lane_session_ids: ["lane-session-hash-readiness"],
            next_dispatch_targets: ["ask_wake"],
            next_goal_binding_ids: ["goal-binding-hash-readiness"],
            next_source_ids: ["docs:hash-readiness"],
            next_evidence_refs: ["ask:lane:translation:hash-readiness-obs"],
            next_receipt_refs: ["ask:lane:translation:hash-readiness-obs:projection:receipt"],
            side_effects_allowed: false,
            side_effects_executed: false,
            wake_dispatch_allowed: false,
            badge_projection_allowed: false,
            terminal_report_allowed: false,
            terminal_report_emitted: false,
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      },
    });

    expect(payload.capability_lane_goal_dispatch_readiness).toMatchObject({
      total_admissions: 1,
      next_source_ids: ["docs:hash-readiness"],
      next_source_hashes: ["sha256:hash-readiness"],
      next_receipt_refs: ["ask:lane:translation:hash-readiness-obs:projection:receipt"],
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("replaces a stale provider answer with an authoritative fresh-source identity failure", () => {
    const provider = buildProvider("codex");
    const threadId = "helix-ask:provider-projection:fresh-unbound";
    const turnId = "turn-provider-projection-fresh-unbound";
    const seed = seedBackendLiveVisualSourceSwitchForAskTest({
      thread_id: threadId,
      bound_source_id: "visual_source:provider-bound",
      unbound_source_id: "visual_source:provider-fresh",
    });
    const staleAnswer = "This answer must not survive the identity boundary.";
    const staleRef = `${turnId}:situation_context_pack`;
    const payload = buildPayload({
      provider,
      route: "/ask/turn",
      turnId,
      requestBody: {
        thread_id: threadId,
        question: "What is happening right now in the visual screen capture?",
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          source_target: "visual_capture",
          required_terminal_kind: "situation_context_pack",
          allowed_terminal_artifact_kinds: [
            "situation_context_pack",
            "typed_failure",
          ],
        },
      },
      providerResult: {
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        answer: staleAnswer,
        text: staleAnswer,
        selected_final_answer: staleAnswer,
        final_answer_source: "situation_context_pack",
        terminal_artifact_kind: "situation_context_pack",
        source_target_intent: {
          target_source: "visual_capture",
          strength: "hard",
        },
        situation_evidence_selection: {
          situation_run_id: seed.bound_seed.situation_run_id,
          selected_observation_refs: [seed.bound_seed.observation_ref],
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: `${turnId}:observation`,
            kind: "situation_context_pack",
            turn_id: turnId,
            payload: {},
          },
        ],
        loop_parity_trace: {
          actual_tool_calls: ["situation-room.describe_visual_capture"],
          observations_created: [{ ref: `${turnId}:observation` }],
        },
        ask_turn_solver_trace: {
          completed_solver_path: false,
          evidence_reentry: { required: true, completed: true },
          followup_reasoning: { required: true, completed: true },
        },
        terminal_answer_authority: {
          schema: "helix.turn_terminal_authority.v1",
          turn_id: turnId,
          terminal_kind: "answer",
          final_answer_source: "situation_context_pack",
          terminal_artifact_kind: "situation_context_pack",
          terminal_text_preview: staleAnswer,
          server_authoritative: true,
        },
        terminal_authority_single_writer: {
          schema: "helix.terminal_authority_single_writer_result.v1",
          turn_id: turnId,
          selectedArtifactKind: "situation_context_pack",
          selectedArtifactRef: staleRef,
          selected_terminal_artifact_kind: "situation_context_pack",
          selected_terminal_artifact_ref: staleRef,
          visible_text: staleAnswer,
          source: "situation_context_pack",
          integrity: { single_writer_applied: true },
        },
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          turn_id: turnId,
          terminal_artifact_kind: "situation_context_pack",
          concise_text: staleAnswer,
          assistant_answer: false,
          raw_content_included: false,
        },
      } as HelixAgentRunResult,
    });
    const writer = payload.terminal_authority_single_writer as Record<string, unknown>;
    const audit = payload.live_source_identity_audit as Record<string, unknown>;
    const solver = payload.ask_turn_solver_trace as Record<string, unknown>;

    expect(audit).toMatchObject({
      identity_ok: false,
      diagnosis: "fresh_source_unbound",
    });
    expect(payload).toMatchObject({
      ok: false,
      response_type: "final_failure",
      final_status: "final_failure",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "fresh_source_unbound",
    });
    expect(payload.selected_final_answer).not.toBe(staleAnswer);
    expect(writer).toMatchObject({
      selectedArtifactKind: "typed_failure",
      selected_terminal_artifact_kind: "typed_failure",
      source: "typed_failure",
    });
    expect(solver.completed_solver_path).toBe(true);
    expect(payload.current_turn_artifact_ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "typed_failure",
          payload: expect.objectContaining({
            error_code: "fresh_source_unbound",
          }),
        }),
      ]),
    );
  });

  it("keeps route-local provider projection out of agi.plan.ts", () => {
    const routeSource = readFileSync(resolve(process.cwd(), "server/routes/agi.plan.ts"), "utf8");

    expect(routeSource).toContain("buildHelixAgentProviderAskPayload");
    expect(routeSource).not.toContain("providerDebug.");
    expect(routeSource).not.toContain("capability_lane_manifest: providerDebug.capability_lane_manifest");
    expect(routeSource).not.toContain("workstation_gateway_call_results: providerDebug.workstation_gateway_call_results");
    expect(routeSource).not.toContain("provider_terminal_candidate: providerDebug.provider_terminal_candidate");
  });
});
