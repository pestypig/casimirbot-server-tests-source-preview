import { describe, expect, it } from "vitest";
import type { HelixAgentProvider } from "../../agent-providers/types";
import { createHelixCapabilityLaneGoalBindingStore } from "../goal-binding";
import {
  buildHelixCapabilityLaneGoalBindingDebugSummaries,
  buildHelixCapabilityLaneGoalBindingDebugSummary,
} from "../goal-binding-summary";
import { createHelixCapabilityLaneSessionStore } from "../session-manager";

const buildProvider = (id: "helix" | "codex"): HelixAgentProvider => ({
  id,
  label: id === "helix" ? "Helix Ask Native" : "Codex Workstation Mode",
  permissionProfile: {
    id: id === "helix" ? "helix-native" : "read-observe-act",
    label: "Read/observe plus non-mutating workstation action",
    allows: {
      observe: true,
      read: true,
      act: true,
      write: false,
      shell: false,
      codeMutation: false,
    },
  },
  enabled: () => true,
  supports: {
    streaming: id === "helix",
    workstationTools: true,
    capabilityLanes: true,
    capabilityLaneOneShot: true,
    capabilityLaneSessions: false,
    codeMutation: false,
  },
  runTurn: async () => ({
    ok: false,
    runtime: id,
    response_type: "test",
    final_status: "test",
  }),
});

const backendDecision = {
  schema: "helix.capability_lane.backend_selection_decision.v1" as const,
  owner: "helix" as const,
  outcome: "fallback_selected" as const,
  reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
  requested_backend_provider: "google_gemini",
  requested_backend_provider_known: true,
  selected_backend_provider: "live_translation.local_runtime",
  fallback_backend_provider: "live_translation.local_runtime",
  selected_runtime_provider_remains_root: true as const,
  backend_provider_becomes_root_agent: false as const,
  dynamic_switching_executed: false as const,
  live_backend_execution_enabled: false as const,
  terminal_authority_owner: "helix" as const,
  terminal_eligible: false as const,
  assistant_answer: false as const,
  raw_content_included: false as const,
};

const buildReportedBinding = () => {
  const sessionStore = createHelixCapabilityLaneSessionStore();
  sessionStore.start({
    provider: buildProvider("codex"),
    laneId: "live_translation",
    laneSessionId: "lane-session-summary",
    sourceBinding: {
      source_id: "docs:summary",
      source_hash: "sha256:summary-v1",
      source_kind: "docs",
      projection_target: "docs_chunk",
      account_locale: "es-US",
      target_language: "es",
    },
    requestedBackendProvider: "google_gemini",
    env: {} as NodeJS.ProcessEnv,
    nowMs: 100,
  });
  const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
  store.bind({
    goalId: "goal:translate-summary",
    laneSessionId: "lane-session-summary",
    goalBindingId: "goal-binding-summary",
    activationPolicy: "while_goal_active",
    attentionPolicy: "quiet_until_salient",
    stopCondition: "goal_complete",
    reportPolicy: "terminal_authorized_summary",
    quietBehavior: "record_only",
    nowMs: 110,
  });
  sessionStore.recordObservation({
    laneSessionId: "lane-session-summary",
    observationRef: "ask:lane:translation:summary-obs",
    receiptRef: "ask:lane:translation:summary-obs:projection:receipt",
    chunkId: "chunk-summary-session",
    chunkIndex: 7,
    dedupeKey: "docs:summary:chunk-summary-session:es",
    sourceEventId: "docs:summary:event-session",
    sourceEventMs: 95,
    observedAtMs: 120,
    freshnessStatus: "fresh",
    sourceId: "docs:summary",
    sourceHash: "sha256:summary-v1",
    targetLanguage: "es",
    projectionTarget: "docs_chunk",
    cancelRequested: true,
    nowMs: 120,
  });
  store.recordMailLoopEvidence({
    goalBindingId: "goal-binding-summary",
    nowMs: 125,
    mailLoopSummary: {
      schema: "helix.capability_lane.mail_loop_debug_summary.v1",
      lane_session_id: "lane-session-summary",
      lane_id: "live_translation",
      capability: "live_translation.translate_text",
      observation_ref: "ask:lane:translation:summary-obs",
      receipt_ref: "ask:lane:translation:summary-obs:projection:receipt",
      stage_play_mail_id: "stage-play-mail-summary",
      stage_play_wake_expected: true,
      stage_play_wake_kind: "mailbox_wake",
      mailbox_thread_id: "ask-thread-summary",
      observation_lane_session_id: "lane-session-summary",
      source_id: "docs:summary",
      source_hash: "sha256:summary-v1",
      source_kind: "document_markdown",
      account_locale: "es-US",
      chunk_id: "chunk-summary",
      projection_target: "docs_chunk",
      target_language: "es",
      selected_backend_provider: "live_translation.local_runtime",
      requested_backend_provider: "google_gemini",
      cost_class: "free_local",
      latency_class: "interactive",
      privacy_class: "local_only",
      fallback_backend_provider: null,
      backend_selection_decision: backendDecision,
      freshness_status: "fresh",
      source_text_hash: "sha256:text-summary",
      source_text_char_count: 42,
      blocked_reason: null,
      mail_status: "unread",
      evidence_refs: ["lane-session-summary", "stage-play-mail-summary"],
      reentry_required: true,
      terminal_authority_status: "pending_helix_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    },
  });
  const reported = store.recordReportRequest({
    goalBindingId: "goal-binding-summary",
    reportRef: "ask:terminal:summary-report",
    terminalAuthorized: true,
    nowMs: 130,
  });

  if (!reported.goal_binding) {
    throw new Error("expected reported goal binding");
  }

  return reported.goal_binding;
};

describe("capability lane goal binding debug summary", () => {
  it("projects a goal-bound lane session without promoting backend or lane output to answer authority", () => {
    const binding = buildReportedBinding();
    const summary = buildHelixCapabilityLaneGoalBindingDebugSummary(binding);

    expect(summary).toMatchObject({
      schema: "helix.capability_lane.goal_binding_debug_summary.v1",
      goal_binding_id: "goal-binding-summary",
      goal_binding_key: "goal:translate-summary::goal-binding-summary::lane-session-summary::live_translation",
      goal_id: "goal:translate-summary",
      lane_session_id: "lane-session-summary",
      lane_id: "live_translation",
      selected_runtime_agent_provider: "codex",
      selected_backend_provider: "live_translation.local_runtime",
      cost_class: "free_local",
      latency_class: "interactive",
      privacy_class: "local_only",
      fallback_backend_provider: null,
      lifecycle_action: "record_observation",
      session_lifecycle_action: "record_observation",
      session_action: "record_observation",
      backend_selection_decision: expect.objectContaining({
        outcome: "fallback_selected",
        requested_backend_provider: "google_gemini",
        selected_backend_provider: "live_translation.local_runtime",
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        live_backend_execution_enabled: false,
        terminal_authority_owner: "helix",
      }),
      session_status: "running",
      session_health: "healthy",
      source_id: "docs:summary",
      source_hash: "sha256:summary-v1",
      source_kind: "docs",
      source_projection_target: "docs_chunk",
      account_locale: "es-US",
      session_control_key: "lane-session-summary::docs:summary::sha256:summary-v1::docs_chunk::es-US::es",
      source_binding_key: "docs:summary::sha256:summary-v1::docs_chunk::es-US::es",
      permissions: {
        read: true,
        observe: true,
        act: true,
        write: false,
        shell: false,
        code_mutation: false,
      },
      permission_profile: "permissions non-mutating",
      last_observation_ref: "ask:lane:translation:summary-obs",
      last_receipt_ref: "ask:lane:translation:summary-obs:projection:receipt",
      latest_event_id: "lane-session-summary:record_observation:120",
      session_event_count: 2,
      has_observation: true,
      latest_chunk_id: "chunk-summary-session",
      latest_chunk_index: 7,
      latest_source_id: "docs:summary",
      latest_source_hash: "sha256:summary-v1",
      latest_source_kind: "docs",
      latest_target_language: "es",
      latest_dedupe_key: "docs:summary:chunk-summary-session:es",
      latest_source_event_id: "docs:summary:event-session",
      latest_source_event_ms: 95,
      latest_observed_at_ms: 120,
      latest_freshness_status: "fresh",
      source_text_hash: "sha256:text-summary",
      source_text_char_count: 42,
      latest_projection_target: "docs_chunk",
      target_language: "es",
      latest_cancel_requested: true,
      latest_mail_loop_wake_kind: "mailbox_wake",
      latest_observation_key: [
        "docs:summary",
        "sha256:summary-v1",
        "docs",
        "docs_chunk",
        "es-US",
        "es",
        "chunk-summary-session",
        "ask:lane:translation:summary-obs:projection:receipt",
      ].join("::"),
      latest_mail_loop_summary: {
        schema: "helix.capability_lane.mail_loop_debug_summary.v1",
        source_hash: "sha256:summary-v1",
        stage_play_mail_id: "stage-play-mail-summary",
        observation_lane_session_id: "lane-session-summary",
        observation_ref: "ask:lane:translation:summary-obs",
        receipt_ref: "ask:lane:translation:summary-obs:projection:receipt",
        target_language: "es",
        selected_backend_provider: "live_translation.local_runtime",
        requested_backend_provider: "google_gemini",
        cost_class: "free_local",
        latency_class: "interactive",
        privacy_class: "local_only",
        fallback_backend_provider: null,
        source_text_hash: "sha256:text-summary",
        source_text_char_count: 42,
        backend_selection_decision: expect.objectContaining({
          outcome: "fallback_selected",
          selected_backend_provider: "live_translation.local_runtime",
        }),
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      latest_mail_loop_observation_lane_session_id: "lane-session-summary",
      latest_mail_loop_observation_key: [
        "docs:summary",
        "sha256:summary-v1",
        "document_markdown",
        "docs_chunk",
        "es-US",
        "es",
        "chunk-summary",
        "ask:lane:translation:summary-obs:projection:receipt",
      ].join("::"),
      mail_loop_refs: ["stage-play-mail-summary"],
      report_summary_text: [
        "goal lane record only",
        "reason goal_lane_evidence_recorded_for_debug_only",
        "evidence ask:lane:translation:summary-obs",
        "mail stage-play-mail-summary",
        "receipt ask:lane:translation:summary-obs:projection:receipt",
        "terminal authority pending_helix_terminal_authority",
      ].join(" | "),
      report_decision: {
        schema: "helix.capability_lane.goal_report_decision.v1",
        action: "record_only",
        reason: "goal_lane_evidence_recorded_for_debug_only",
        summary_text: [
          "goal lane record only",
          "reason goal_lane_evidence_recorded_for_debug_only",
          "evidence ask:lane:translation:summary-obs",
          "mail stage-play-mail-summary",
          "receipt ask:lane:translation:summary-obs:projection:receipt",
          "terminal authority pending_helix_terminal_authority",
        ].join(" | "),
        attention_policy: "quiet_until_salient",
        report_policy: "terminal_authorized_summary",
        quiet_behavior: "record_only",
        quiet_behavior_applied: true,
        wake_expected: false,
        surface_badge_expected: false,
        terminal_report_requested: false,
        terminal_report_authorized: true,
        terminal_report_requires_authority: true,
        terminal_authority_status: "pending_helix_terminal_authority",
        evidence_ref: "ask:lane:translation:summary-obs",
        mail_loop_ref: "stage-play-mail-summary",
        receipt_ref: "ask:lane:translation:summary-obs:projection:receipt",
        reentry_required: true,
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      dispatch_plan: {
        schema: "helix.capability_lane.goal_dispatch_plan.v1",
        target: "none",
        status: "planned_not_dispatched",
        reason: "goal_binding_policy_records_without_dispatch",
        source_report_action: "record_only",
        goal_binding_id: "goal-binding-summary",
        goal_id: "goal:translate-summary",
        lane_session_id: "lane-session-summary",
        session_control_key: "lane-session-summary::docs:summary::sha256:summary-v1::docs_chunk::es-US::es",
        source_binding_key: "docs:summary::sha256:summary-v1::docs_chunk::es-US::es",
        latest_mail_loop_observation_key: [
          "docs:summary",
          "sha256:summary-v1",
          "document_markdown",
          "docs_chunk",
          "es-US",
          "es",
          "chunk-summary",
          "ask:lane:translation:summary-obs:projection:receipt",
        ].join("::"),
        lane_id: "live_translation",
        source_id: "docs:summary",
        source_hash: "sha256:summary-v1",
        source_kind: "docs",
        source_projection_target: "docs_chunk",
        account_locale: "es-US",
        latest_chunk_id: "chunk-summary-session",
        latest_chunk_index: 7,
        latest_source_id: "docs:summary",
        latest_source_hash: "sha256:summary-v1",
        latest_source_kind: "docs",
        latest_target_language: "es",
        latest_dedupe_key: "docs:summary:chunk-summary-session:es",
        latest_source_event_id: "docs:summary:event-session",
        latest_source_event_ms: 95,
        latest_observed_at_ms: 120,
        latest_freshness_status: "fresh",
        source_text_hash: "sha256:text-summary",
        source_text_char_count: 42,
        latest_projection_target: "docs_chunk",
        target_language: "es",
        latest_cancel_requested: true,
        latest_mail_loop_wake_kind: "mailbox_wake",
        permissions: {
          read: true,
          observe: true,
          act: true,
          write: false,
          shell: false,
          code_mutation: false,
        },
        evidence_ref: "ask:lane:translation:summary-obs",
        mail_loop_ref: "stage-play-mail-summary",
        receipt_ref: "ask:lane:translation:summary-obs:projection:receipt",
        requires_live_mail_loop: false,
        requires_terminal_authority: false,
        side_effects_executed: false,
        wake_dispatched: false,
        badge_projected: false,
        terminal_report_emitted: false,
        terminal_authority_status: "pending_helix_terminal_authority",
        reentry_required: true,
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      dispatch_admission: {
        schema: "helix.capability_lane.goal_dispatch_admission.v1",
        status: "admitted_debug_only",
        reason: "goal_dispatch_admission_admitted_debug_only",
        target: "none",
        goal_binding_id: "goal-binding-summary",
        goal_id: "goal:translate-summary",
        lane_session_id: "lane-session-summary",
        session_control_key: "lane-session-summary::docs:summary::sha256:summary-v1::docs_chunk::es-US::es",
        source_binding_key: "docs:summary::sha256:summary-v1::docs_chunk::es-US::es",
        latest_mail_loop_observation_key: [
          "docs:summary",
          "sha256:summary-v1",
          "document_markdown",
          "docs_chunk",
          "es-US",
          "es",
          "chunk-summary",
          "ask:lane:translation:summary-obs:projection:receipt",
        ].join("::"),
        lane_id: "live_translation",
        source_id: "docs:summary",
        source_kind: "docs",
        source_projection_target: "docs_chunk",
        account_locale: "es-US",
        latest_chunk_id: "chunk-summary-session",
        latest_chunk_index: 7,
        latest_source_id: "docs:summary",
        latest_source_hash: "sha256:summary-v1",
        latest_source_kind: "docs",
        latest_target_language: "es",
        latest_dedupe_key: "docs:summary:chunk-summary-session:es",
        latest_source_event_id: "docs:summary:event-session",
        latest_source_event_ms: 95,
        latest_observed_at_ms: 120,
        latest_freshness_status: "fresh",
        source_text_hash: "sha256:text-summary",
        source_text_char_count: 42,
        latest_projection_target: "docs_chunk",
        target_language: "es",
        latest_cancel_requested: true,
        latest_mail_loop_wake_kind: "mailbox_wake",
        permissions: {
          read: true,
          observe: true,
          act: true,
          write: false,
          shell: false,
          code_mutation: false,
        },
        evidence_ref: "ask:lane:translation:summary-obs",
        mail_loop_ref: "stage-play-mail-summary",
        receipt_ref: "ask:lane:translation:summary-obs:projection:receipt",
        blocked_reason: null,
        requires_live_mail_loop: false,
        requires_terminal_authority: false,
        side_effects_allowed: false,
        side_effects_executed: false,
        wake_dispatch_allowed: false,
        badge_projection_allowed: false,
        terminal_report_allowed: false,
        terminal_authority_status: "pending_helix_terminal_authority",
        reentry_required: true,
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      activation_policy: "while_goal_active",
      attention_policy: "quiet_until_salient",
      stop_condition: "goal_complete",
      report_policy: "terminal_authorized_summary",
      quiet_behavior: "record_only",
      binding_status: "bound",
      last_report_ref: "ask:terminal:summary-report",
      backend_provider_becomes_root_agent: false,
      final_reports_require_terminal_authority: true,
      terminal_authority_status: "pending_helix_terminal_authority",
      reentry_required: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(summary.latest_session_event).toMatchObject({
      lane_session_id: "lane-session-summary",
      lane_id: "live_translation",
      selected_runtime_agent_provider: "codex",
      selected_backend_provider: "live_translation.local_runtime",
      cost_class: "free_local",
      latency_class: "interactive",
      privacy_class: "local_only",
      fallback_backend_provider: null,
      backend_selection_decision: expect.objectContaining({
        outcome: "fallback_selected",
        selected_backend_provider: "live_translation.local_runtime",
      }),
      reason: "lane_session_observation_recorded",
      source_identity_key: "docs:summary::sha256:summary-v1::docs::docs_chunk::es-US::es",
      target_language: "es",
      observation_ref: "ask:lane:translation:summary-obs",
      receipt_ref: "ask:lane:translation:summary-obs:projection:receipt",
      chunk_id: "chunk-summary-session",
      chunk_index: 7,
      dedupe_key: "docs:summary:chunk-summary-session:es",
      source_event_id: "docs:summary:event-session",
      source_event_ms: 95,
      observed_at_ms: 120,
      freshness_status: "fresh",
      projection_target: "docs_chunk",
      cancel_requested: true,
      terminal_authority_status: "pending_helix_terminal_authority",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(summary.latest_goal_binding_event).toMatchObject({
      event: "report_requested",
      lane_session_observation_ref: "ask:lane:translation:summary-obs",
      receipt_ref: "ask:lane:translation:summary-obs:projection:receipt",
      source_id: "docs:summary",
      source_hash: "sha256:summary-v1",
      source_identity_key:
        "docs:summary::sha256:summary-v1::sha256:text-summary::42::docs::docs_chunk::es-US::es",
      target_language: "es",
      latest_chunk_id: "chunk-summary-session",
      latest_chunk_index: 7,
      latest_source_id: "docs:summary",
      latest_source_hash: "sha256:summary-v1",
      latest_source_kind: "docs",
      latest_target_language: "es",
      latest_dedupe_key: "docs:summary:chunk-summary-session:es",
      latest_source_event_id: "docs:summary:event-session",
      latest_source_event_ms: 95,
      latest_observed_at_ms: 120,
      latest_freshness_status: "fresh",
      source_text_hash: "sha256:text-summary",
      source_text_char_count: 42,
      latest_projection_target: "docs_chunk",
      latest_cancel_requested: true,
      terminal_authority_status: "pending_helix_terminal_authority",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("prefers the current mail-loop receipt over a stale session last receipt", () => {
    const binding = buildReportedBinding();
    binding.lane_session_last_receipt_ref = "ask:lane:translation:summary-previous:projection:receipt";

    const summary = buildHelixCapabilityLaneGoalBindingDebugSummary(binding);

    expect(summary.last_receipt_ref).toBe("ask:lane:translation:summary-obs:projection:receipt");
    expect(summary.report_decision.receipt_ref).toBe("ask:lane:translation:summary-obs:projection:receipt");
    expect(summary.dispatch_plan.receipt_ref).toBe("ask:lane:translation:summary-obs:projection:receipt");
    expect(summary.report_summary_text).toContain("receipt ask:lane:translation:summary-obs:projection:receipt");
    expect(summary.report_summary_text).not.toContain("summary-previous");
  });

  it("builds array summaries while preserving non-terminal lane invariants", () => {
    const binding = buildReportedBinding();
    const summaries = buildHelixCapabilityLaneGoalBindingDebugSummaries([binding]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      goal_binding_id: "goal-binding-summary",
      goal_binding_key: "goal:translate-summary::goal-binding-summary::lane-session-summary::live_translation",
      lane_session_id: "lane-session-summary",
      selected_backend_provider: "live_translation.local_runtime",
      cost_class: "free_local",
      latency_class: "interactive",
      privacy_class: "local_only",
      fallback_backend_provider: null,
      lifecycle_action: "record_observation",
      latest_event_id: "lane-session-summary:record_observation:120",
      session_event_count: 2,
      has_observation: true,
      latest_chunk_id: "chunk-summary-session",
      latest_source_id: "docs:summary",
      latest_source_hash: "sha256:summary-v1",
      latest_source_kind: "docs",
      latest_target_language: "es",
      latest_dedupe_key: "docs:summary:chunk-summary-session:es",
      session_control_key: "lane-session-summary::docs:summary::sha256:summary-v1::docs_chunk::es-US::es",
      source_binding_key: "docs:summary::sha256:summary-v1::docs_chunk::es-US::es",
      latest_observation_key: [
        "docs:summary",
        "sha256:summary-v1",
        "docs",
        "docs_chunk",
        "es-US",
        "es",
        "chunk-summary-session",
        "ask:lane:translation:summary-obs:projection:receipt",
      ].join("::"),
      latest_freshness_status: "fresh",
      latest_cancel_requested: true,
      permission_profile: "permissions non-mutating",
      latest_mail_loop_summary: expect.objectContaining({
        stage_play_mail_id: "stage-play-mail-summary",
        observation_lane_session_id: "lane-session-summary",
        selected_backend_provider: "live_translation.local_runtime",
        cost_class: "free_local",
        latency_class: "interactive",
        privacy_class: "local_only",
        fallback_backend_provider: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      latest_mail_loop_observation_lane_session_id: "lane-session-summary",
      latest_mail_loop_observation_key: [
        "docs:summary",
        "sha256:summary-v1",
        "document_markdown",
        "docs_chunk",
        "es-US",
        "es",
        "chunk-summary",
        "ask:lane:translation:summary-obs:projection:receipt",
      ].join("::"),
      mail_loop_refs: ["stage-play-mail-summary"],
      report_decision: expect.objectContaining({
        schema: "helix.capability_lane.goal_report_decision.v1",
        action: "record_only",
        summary_text: expect.stringContaining("goal lane record only"),
        attention_policy: "quiet_until_salient",
        report_policy: "terminal_authorized_summary",
        quiet_behavior: "record_only",
        quiet_behavior_applied: true,
        terminal_report_requires_authority: true,
        context_role: "tool_evidence",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      dispatch_plan: expect.objectContaining({
        schema: "helix.capability_lane.goal_dispatch_plan.v1",
        target: "none",
        status: "planned_not_dispatched",
        source_binding_key: "docs:summary::sha256:summary-v1::docs_chunk::es-US::es",
        latest_mail_loop_observation_key: [
          "docs:summary",
          "sha256:summary-v1",
          "document_markdown",
          "docs_chunk",
          "es-US",
          "es",
          "chunk-summary",
          "ask:lane:translation:summary-obs:projection:receipt",
        ].join("::"),
      source_id: "docs:summary",
      source_kind: "docs",
      source_projection_target: "docs_chunk",
      account_locale: "es-US",
      latest_chunk_id: "chunk-summary-session",
        latest_source_id: "docs:summary",
        latest_source_hash: "sha256:summary-v1",
        latest_source_kind: "docs",
        latest_target_language: "es",
        latest_dedupe_key: "docs:summary:chunk-summary-session:es",
        source_text_hash: "sha256:text-summary",
        source_text_char_count: 42,
        latest_projection_target: "docs_chunk",
        latest_cancel_requested: true,
        latest_mail_loop_wake_kind: "mailbox_wake",
        side_effects_executed: false,
        wake_dispatched: false,
        badge_projected: false,
        terminal_report_emitted: false,
        context_role: "tool_evidence",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      dispatch_admission: expect.objectContaining({
        schema: "helix.capability_lane.goal_dispatch_admission.v1",
        status: "admitted_debug_only",
        target: "none",
        source_binding_key: "docs:summary::sha256:summary-v1::docs_chunk::es-US::es",
        latest_mail_loop_observation_key: [
          "docs:summary",
          "sha256:summary-v1",
          "document_markdown",
          "docs_chunk",
          "es-US",
          "es",
          "chunk-summary",
          "ask:lane:translation:summary-obs:projection:receipt",
        ].join("::"),
        source_id: "docs:summary",
        source_hash: "sha256:summary-v1",
        latest_chunk_id: "chunk-summary-session",
        latest_source_id: "docs:summary",
        latest_source_hash: "sha256:summary-v1",
        latest_source_kind: "docs",
        latest_target_language: "es",
        latest_dedupe_key: "docs:summary:chunk-summary-session:es",
        source_text_hash: "sha256:text-summary",
        source_text_char_count: 42,
        latest_projection_target: "docs_chunk",
        latest_cancel_requested: true,
        latest_mail_loop_wake_kind: "mailbox_wake",
        side_effects_allowed: false,
        wake_dispatch_allowed: false,
        badge_projection_allowed: false,
        terminal_report_allowed: false,
        context_role: "tool_evidence",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      terminal_authority_status: "pending_helix_terminal_authority",
      backend_provider_becomes_root_agent: false,
      final_reports_require_terminal_authority: true,
      reentry_required: true,
      context_role: "tool_evidence",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("uses the lane session target language before mail-loop evidence exists", () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    sessionStore.start({
      provider: buildProvider("codex"),
      laneId: "live_translation",
      laneSessionId: "lane-session-pre-mail",
      sourceBinding: {
        source_id: "docs:pre-mail",
        source_kind: "docs",
        projection_target: "docs_chunk",
        account_locale: "fr-FR",
        target_language: "fr",
      },
      env: {} as NodeJS.ProcessEnv,
      nowMs: 100,
    });
    sessionStore.recordObservation({
      laneSessionId: "lane-session-pre-mail",
      observationRef: "ask:lane:translation:pre-mail-obs",
      receiptRef: "ask:lane:translation:pre-mail-obs:projection:receipt",
      chunkId: "chunk-pre-mail",
      dedupeKey: "docs:pre-mail:chunk-pre-mail:fr",
      sourceTextHash: "sha256:text-pre-mail",
      sourceTextCharCount: 58,
      projectionTarget: "docs_chunk",
      nowMs: 110,
    });
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    const result = store.bind({
      goalId: "goal:pre-mail",
      laneSessionId: "lane-session-pre-mail",
      goalBindingId: "goal-binding-pre-mail",
      quietBehavior: "surface_badge",
      nowMs: 120,
    });

    if (!result.goal_binding) {
      throw new Error("expected goal binding");
    }

    const summary = buildHelixCapabilityLaneGoalBindingDebugSummary(result.goal_binding);

    expect(summary).toMatchObject({
      goal_binding_id: "goal-binding-pre-mail",
      latest_mail_loop_summary: null,
      latest_event_id: "lane-session-pre-mail:record_observation:110",
      session_event_count: 2,
      has_observation: true,
      latest_mail_loop_observation_lane_session_id: null,
      target_language: "fr",
      source_text_hash: "sha256:text-pre-mail",
      source_text_char_count: 58,
      source_kind: "docs",
      source_projection_target: "docs_chunk",
      account_locale: "fr-FR",
      latest_session_event: expect.objectContaining({
        action: "record_observation",
        target_language: "fr",
      }),
      latest_goal_binding_event: expect.objectContaining({
        event: "bound",
        source_kind: "docs",
        source_projection_target: "docs_chunk",
        account_locale: "fr-FR",
        target_language: "fr",
      }),
      dispatch_plan: expect.objectContaining({
        target: "ui_badge",
        source_kind: "docs",
        source_projection_target: "docs_chunk",
        account_locale: "fr-FR",
        target_language: "fr",
        source_text_hash: "sha256:text-pre-mail",
        source_text_char_count: 58,
        mail_loop_ref: null,
        receipt_ref: "ask:lane:translation:pre-mail-obs:projection:receipt",
      }),
      dispatch_admission: expect.objectContaining({
        status: "admitted_projection_only",
        source_kind: "docs",
        source_projection_target: "docs_chunk",
        account_locale: "fr-FR",
        target_language: "fr",
        source_text_hash: "sha256:text-pre-mail",
        source_text_char_count: 58,
        mail_loop_ref: null,
        receipt_ref: "ask:lane:translation:pre-mail-obs:projection:receipt",
      }),
    });
  });

  it("keeps bound source-text identity visible before observations or mail-loop packets exist", () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    sessionStore.start({
      provider: buildProvider("codex"),
      laneId: "live_translation",
      laneSessionId: "lane-session-bound-source-text",
      sourceBinding: {
        source_id: "docs:bound-source-text",
        source_hash: "sha256:bound-source-text-v1",
        source_text_hash: "sha256:text-bound-source",
        source_text_char_count: 64,
        source_kind: "docs",
        projection_target: "docs_chunk",
        account_locale: "es-US",
        target_language: "es",
      },
      requestedBackendProvider: "google_gemini",
      env: {} as NodeJS.ProcessEnv,
      nowMs: 100,
    });
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    const result = store.bind({
      goalId: "goal:bound-source-text",
      laneSessionId: "lane-session-bound-source-text",
      goalBindingId: "goal-binding-bound-source-text",
      quietBehavior: "surface_badge",
      nowMs: 110,
    });

    if (!result.goal_binding) {
      throw new Error("expected goal binding");
    }

    const summary = buildHelixCapabilityLaneGoalBindingDebugSummary(result.goal_binding);
    const sourceIdentityKey = [
      "docs:bound-source-text",
      "sha256:bound-source-text-v1",
      "sha256:text-bound-source",
      "64",
      "docs",
      "docs_chunk",
      "es-US",
      "es",
    ].join("::");

    expect(summary).toMatchObject({
      goal_binding_id: "goal-binding-bound-source-text",
      has_observation: false,
      source_identity_key: sourceIdentityKey,
      source_text_hash: "sha256:text-bound-source",
      source_text_char_count: 64,
      latest_mail_loop_summary: null,
      latest_mail_loop_observation_key: null,
      dispatch_plan: expect.objectContaining({
        target: "ui_badge",
        source_identity_key: sourceIdentityKey,
        source_text_hash: "sha256:text-bound-source",
        source_text_char_count: 64,
      }),
      dispatch_admission: expect.objectContaining({
        status: "blocked",
        blocked_reason: "missing_evidence_ref",
        source_text_hash: "sha256:text-bound-source",
        source_text_char_count: 64,
      }),
    });
  });

  it("computes report decisions for badge, wake, review, and terminal-authority policies", () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    sessionStore.start({
      provider: buildProvider("helix"),
      laneId: "live_translation",
      laneSessionId: "lane-session-policy",
      sourceBinding: {
        source_id: "docs:policy",
        source_kind: "docs",
        projection_target: "docs_chunk",
      },
      env: {} as NodeJS.ProcessEnv,
      nowMs: 100,
    });
    sessionStore.recordObservation({
      laneSessionId: "lane-session-policy",
      observationRef: "ask:lane:translation:policy-obs",
      nowMs: 110,
    });
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    store.bind({
      goalId: "goal:badge",
      laneSessionId: "lane-session-policy",
      goalBindingId: "goal-binding-badge",
      quietBehavior: "surface_badge",
    });
    store.bind({
      goalId: "goal:wake",
      laneSessionId: "lane-session-policy",
      goalBindingId: "goal-binding-wake",
      reportPolicy: "ask_on_salience",
      quietBehavior: "wake_on_salience",
    });
    store.bind({
      goalId: "goal:review",
      laneSessionId: "lane-session-policy",
      goalBindingId: "goal-binding-review",
      attentionPolicy: "manual_review",
    });
    store.bind({
      goalId: "goal:report",
      laneSessionId: "lane-session-policy",
      goalBindingId: "goal-binding-report",
      attentionPolicy: "report_each_observation",
      reportPolicy: "terminal_authorized_summary",
    });

    const summaries = buildHelixCapabilityLaneGoalBindingDebugSummaries(store.list());
    const actionByGoal = new Map(summaries.map((summary) => [
      summary.goal_id,
      summary.report_decision,
    ]));

    expect(actionByGoal.get("goal:badge")).toMatchObject({
      action: "surface_badge",
      summary_text: expect.stringContaining("goal lane surface badge"),
      quiet_behavior: "surface_badge",
      quiet_behavior_applied: true,
      surface_badge_expected: true,
      terminal_report_requested: false,
      terminal_report_requires_authority: true,
      evidence_ref: "ask:lane:translation:policy-obs",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(actionByGoal.get("goal:wake")).toMatchObject({
      action: "wake_on_salience",
      summary_text: expect.stringContaining("goal lane wake on salience"),
      quiet_behavior: "wake_on_salience",
      quiet_behavior_applied: false,
      wake_expected: true,
      terminal_report_requested: false,
      terminal_report_requires_authority: true,
    });
    expect(actionByGoal.get("goal:review")).toMatchObject({
      action: "manual_review",
      summary_text: expect.stringContaining("reason goal_binding_waiting_for_manual_review"),
      attention_policy: "manual_review",
      quiet_behavior_applied: false,
      reason: "goal_binding_waiting_for_manual_review",
      terminal_report_requested: false,
    });
    expect(actionByGoal.get("goal:report")).toMatchObject({
      action: "request_terminal_authority",
      summary_text: expect.stringContaining(
        "reason goal_binding_policy_requests_terminal_authorized_summary",
      ),
      attention_policy: "report_each_observation",
      report_policy: "terminal_authorized_summary",
      quiet_behavior_applied: false,
      reason: "goal_binding_policy_requests_terminal_authorized_summary",
      terminal_report_requested: true,
      terminal_report_authorized: false,
      terminal_report_requires_authority: true,
    });
    const dispatchByGoal = new Map(summaries.map((summary) => [
      summary.goal_id,
      summary.dispatch_plan,
    ]));

    expect(dispatchByGoal.get("goal:badge")).toMatchObject({
      target: "ui_badge",
      status: "planned_not_dispatched",
      source_report_action: "surface_badge",
      side_effects_executed: false,
      badge_projected: false,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(dispatchByGoal.get("goal:wake")).toMatchObject({
      target: "ask_wake",
      source_report_action: "wake_on_salience",
      requires_live_mail_loop: true,
      wake_dispatched: false,
      side_effects_executed: false,
    });
    expect(dispatchByGoal.get("goal:review")).toMatchObject({
      target: "manual_review",
      source_report_action: "manual_review",
      side_effects_executed: false,
    });
    expect(dispatchByGoal.get("goal:report")).toMatchObject({
      target: "terminal_authority_review",
      source_report_action: "request_terminal_authority",
      requires_terminal_authority: true,
      terminal_report_emitted: false,
      side_effects_executed: false,
    });
    const admissionByGoal = new Map(summaries.map((summary) => [
      summary.goal_id,
      summary.dispatch_admission,
    ]));

    expect(admissionByGoal.get("goal:badge")).toMatchObject({
      status: "admitted_projection_only",
      target: "ui_badge",
      blocked_reason: null,
      side_effects_allowed: false,
      badge_projection_allowed: false,
    });
    expect(admissionByGoal.get("goal:wake")).toMatchObject({
      status: "blocked",
      target: "ask_wake",
      blocked_reason: "missing_mail_loop_ref",
      side_effects_allowed: false,
      wake_dispatch_allowed: false,
    });
    expect(admissionByGoal.get("goal:review")).toMatchObject({
      status: "eligible_manual_review",
      target: "manual_review",
      blocked_reason: null,
      side_effects_allowed: false,
    });
    expect(admissionByGoal.get("goal:report")).toMatchObject({
      status: "eligible_pending_terminal_authority",
      target: "terminal_authority_review",
      blocked_reason: null,
      requires_terminal_authority: true,
      terminal_report_allowed: false,
    });
  });

  it("marks wake-on-salience goal bindings eligible only after mail-loop evidence exists", () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    sessionStore.start({
      provider: buildProvider("codex"),
      laneId: "live_translation",
      laneSessionId: "lane-session-wake-mail",
      sourceBinding: {
        source_id: "docs:wake-mail",
        source_hash: "sha256:wake-mail-v1",
        source_kind: "docs",
        projection_target: "docs_chunk",
        account_locale: "es-US",
        target_language: "es",
      },
      requestedBackendProvider: "google_gemini",
      env: {} as NodeJS.ProcessEnv,
      nowMs: 100,
    });
    sessionStore.recordObservation({
      laneSessionId: "lane-session-wake-mail",
      observationRef: "ask:lane:translation:wake-mail-obs",
      receiptRef: "ask:lane:translation:wake-mail-obs:projection:receipt",
      chunkId: "chunk-wake-mail",
      sourceId: "docs:wake-mail",
      sourceHash: "sha256:wake-mail-v1",
      targetLanguage: "es",
      projectionTarget: "docs_chunk",
      nowMs: 110,
    });
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    const bound = store.bind({
      goalId: "goal:wake-mail",
      laneSessionId: "lane-session-wake-mail",
      goalBindingId: "goal-binding-wake-mail",
      reportPolicy: "ask_on_salience",
      quietBehavior: "wake_on_salience",
      nowMs: 120,
    });
    if (!bound.goal_binding) {
      throw new Error("expected wake-mail goal binding");
    }

    const beforeMail = buildHelixCapabilityLaneGoalBindingDebugSummary(bound.goal_binding);
    expect(beforeMail.dispatch_admission).toMatchObject({
      target: "ask_wake",
      status: "blocked",
      blocked_reason: "missing_mail_loop_ref",
      wake_dispatch_allowed: false,
      side_effects_executed: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });

    const updated = store.recordMailLoopEvidence({
      goalBindingId: "goal-binding-wake-mail",
      nowMs: 130,
      mailLoopSummary: {
        schema: "helix.capability_lane.mail_loop_debug_summary.v1",
        lane_session_id: "lane-session-wake-mail",
        lane_id: "live_translation",
        capability: "live_translation.translate_text",
        observation_ref: "ask:lane:translation:wake-mail-obs",
        receipt_ref: "ask:lane:translation:wake-mail-obs:projection:receipt",
        stage_play_mail_id: "stage-play-mail-wake",
        stage_play_wake_expected: true,
        stage_play_wake_kind: "mailbox_wake",
        mailbox_thread_id: "ask-thread-wake",
        observation_lane_session_id: "lane-session-wake-mail",
        source_id: "docs:wake-mail",
        source_hash: "sha256:wake-mail-v1",
        source_kind: "document_markdown",
        chunk_id: "chunk-wake-mail",
        projection_target: "docs_chunk",
        target_language: "es",
        selected_backend_provider: "live_translation.local_runtime",
        requested_backend_provider: "google_gemini",
        cost_class: "free_local",
        latency_class: "interactive",
        privacy_class: "local_only",
        fallback_backend_provider: null,
        backend_selection_decision: backendDecision,
        freshness_status: "fresh",
        blocked_reason: null,
        mail_status: "unread",
        evidence_refs: ["stage-play-mail-wake", "ask:lane:translation:wake-mail-obs"],
        reentry_required: true,
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    if (!updated.goal_binding) {
      throw new Error("expected wake-mail goal binding update");
    }
    const afterMail = buildHelixCapabilityLaneGoalBindingDebugSummary(updated.goal_binding);

    expect(afterMail.report_decision).toMatchObject({
      action: "wake_on_salience",
      wake_expected: true,
      terminal_report_requested: false,
      terminal_report_requires_authority: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(afterMail.dispatch_plan).toMatchObject({
      target: "ask_wake",
      requires_live_mail_loop: true,
      mail_loop_ref: "stage-play-mail-wake",
      side_effects_executed: false,
      wake_dispatched: false,
      terminal_report_emitted: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(afterMail.dispatch_admission).toMatchObject({
      target: "ask_wake",
      status: "eligible_waiting_for_mail_loop",
      blocked_reason: null,
      mail_loop_ref: "stage-play-mail-wake",
      wake_dispatch_allowed: false,
      side_effects_allowed: false,
      side_effects_executed: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("keeps stopped goal binding summaries tied to the latest observation authority state", () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    sessionStore.start({
      provider: buildProvider("codex"),
      laneId: "live_translation",
      laneSessionId: "lane-session-goal-stopped",
      sourceBinding: {
        source_id: "docs:goal-stopped",
        source_hash: "sha256:goal-stopped-v1",
        source_kind: "docs",
        projection_target: "docs_chunk",
        account_locale: "es-US",
        target_language: "es",
      },
      requestedBackendProvider: "google_gemini",
      env: {} as NodeJS.ProcessEnv,
      nowMs: 500,
    });
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    store.bind({
      goalId: "goal:translate-stopped",
      laneSessionId: "lane-session-goal-stopped",
      goalBindingId: "goal-binding-stopped",
      activationPolicy: "while_goal_active",
      attentionPolicy: "quiet_until_salient",
      stopCondition: "goal_complete",
      reportPolicy: "terminal_authorized_summary",
      quietBehavior: "record_only",
      nowMs: 510,
    });
    sessionStore.recordObservation({
      laneSessionId: "lane-session-goal-stopped",
      observationRef: "ask:lane:translation:goal-stopped-obs",
      receiptRef: "ask:lane:translation:goal-stopped-obs:projection:receipt",
      chunkId: "chunk-goal-stopped",
      chunkIndex: 1,
      dedupeKey: "docs:goal-stopped:chunk-goal-stopped:es",
      sourceEventId: "docs:goal-stopped:event-1",
      sourceEventMs: 515,
      observedAtMs: 520,
      freshnessStatus: "fresh",
      sourceId: "docs:goal-stopped",
      sourceHash: "sha256:goal-stopped-v1",
      targetLanguage: "es",
      projectionTarget: "docs_chunk",
      nowMs: 520,
    });
    const stopped = store.stop({
      goalBindingId: "goal-binding-stopped",
      reason: "goal_complete",
      nowMs: 530,
    });
    if (!stopped.goal_binding) throw new Error("expected stopped goal binding");

    expect(buildHelixCapabilityLaneGoalBindingDebugSummary(stopped.goal_binding)).toMatchObject({
      goal_binding_id: "goal-binding-stopped",
      binding_status: "stopped",
      lifecycle_action: "record_observation",
      latest_goal_binding_event: expect.objectContaining({
        event: "stopped",
        terminal_authority_status: "not_terminal_authority",
      }),
      last_observation_ref: "ask:lane:translation:goal-stopped-obs",
      last_receipt_ref: "ask:lane:translation:goal-stopped-obs:projection:receipt",
      has_observation: true,
      latest_chunk_id: "chunk-goal-stopped",
      latest_source_event_id: "docs:goal-stopped:event-1",
      latest_observed_at_ms: 520,
      report_decision: expect.objectContaining({
        action: "stopped",
        reason: "goal_binding_stopped",
        summary_text: expect.stringContaining("goal lane stopped"),
        evidence_ref: "ask:lane:translation:goal-stopped-obs",
        receipt_ref: "ask:lane:translation:goal-stopped-obs:projection:receipt",
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      dispatch_plan: expect.objectContaining({
        target: "none",
        evidence_ref: "ask:lane:translation:goal-stopped-obs",
        receipt_ref: "ask:lane:translation:goal-stopped-obs:projection:receipt",
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      terminal_authority_status: "pending_helix_terminal_authority",
      final_reports_require_terminal_authority: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });
});
