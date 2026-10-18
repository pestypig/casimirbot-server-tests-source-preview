import { describe, expect, it } from "vitest";
import type { HelixAgentProvider } from "../../agent-providers/types";
import type { HelixCapabilityLaneMailLoopDebugSummary } from "@shared/helix-capability-lane-mail-loop";
import type { HelixCapabilityLaneGoalBinding } from "@shared/helix-capability-lane-goal-binding";
import { createHelixCapabilityLaneGoalBindingStore } from "../goal-binding";
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

const startTranslationSession = () => {
  const sessionStore = createHelixCapabilityLaneSessionStore();
  sessionStore.start({
    provider: buildProvider("codex"),
    laneId: "live_translation",
    laneSessionId: "lane-session-goal",
    sourceBinding: {
      source_id: "docs:goal",
      source_hash: "sha256:goal-v1",
      source_text_hash: "sha256:text-goal",
      source_text_char_count: 42,
      source_kind: "docs",
      projection_target: "docs_chunk",
      account_locale: "es-US",
    },
    requestedBackendProvider: "google_gemini",
    env: {} as NodeJS.ProcessEnv,
    nowMs: 100,
  });
  return sessionStore;
};

const mailLoopSummary = (input: Partial<HelixCapabilityLaneMailLoopDebugSummary> = {}): HelixCapabilityLaneMailLoopDebugSummary => ({
  schema: "helix.capability_lane.mail_loop_debug_summary.v1",
  lane_session_id: "lane-session-goal",
  lane_id: "live_translation",
  capability: "live_translation.translate_text",
  observation_ref: "ask:lane:translation:mail-obs",
  receipt_ref: null,
  stage_play_mail_id: "stage-play-mail-goal",
  stage_play_wake_expected: true,
  stage_play_wake_kind: "mailbox_wake",
  mailbox_thread_id: "ask-thread-goal",
  source_id: "docs:goal",
  source_hash: "sha256:goal-v1",
  source_kind: "document_markdown",
  chunk_id: "chunk-goal",
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
  source_text_hash: "sha256:text-goal",
  source_text_char_count: 42,
  blocked_reason: null,
  mail_status: "unread",
  evidence_refs: [
    "lane-session-goal",
    "stage-play-mail-goal",
    "ask:lane:translation:mail-obs",
  ],
  reentry_required: true,
  terminal_authority_status: "pending_helix_terminal_authority",
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
  ...input,
});

const expectGoalBindingRemainsLaneBoundNonTerminal = (
  binding: HelixCapabilityLaneGoalBinding | null | undefined,
) => {
  expect(binding).toBeTruthy();
  expect(binding).toMatchObject({
    backend_provider_becomes_root_agent: false,
    final_reports_require_terminal_authority: true,
    context_role: "tool_evidence",
    answer_authority: false,
    terminal_eligible: false,
    assistant_answer: false,
    raw_content_included: false,
  });
  expect(binding?.backend_selection_decision).toMatchObject({
    selected_runtime_provider_remains_root: true,
    backend_provider_becomes_root_agent: false,
    terminal_authority_owner: "helix",
    terminal_eligible: false,
    assistant_answer: false,
    raw_content_included: false,
  });
  expect(binding?.debug_history.every((event) => (
    event.terminal_authority_status !== "terminal_authority_granted"
    && event.context_role === "tool_evidence"
    && event.answer_authority === false
    && event.terminal_eligible === false
    && event.assistant_answer === false
    && event.raw_content_included === false
  ))).toBe(true);
  expect(binding?.latest_mail_loop_summary).toSatisfy((summary: HelixCapabilityLaneMailLoopDebugSummary | null) => (
    summary === null
    || (
      summary.terminal_authority_status !== "terminal_authority_granted"
      && summary.terminal_eligible === false
      && summary.assistant_answer === false
      && summary.raw_content_included === false
    )
  ));
};

describe("capability lane goal binding", () => {
  it("binds an active lane session to a goal without making the backend provider the root agent", () => {
    const sessionStore = startTranslationSession();
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });

    const result = store.bind({
      goalId: "goal:translate-docs",
      laneSessionId: "lane-session-goal",
      goalBindingId: "goal-binding-1",
      activationPolicy: "while_goal_active",
      attentionPolicy: "quiet_until_salient",
      stopCondition: "goal_complete",
      reportPolicy: "terminal_authorized_summary",
      quietBehavior: "record_only",
      nowMs: 200,
    });

    expect(result).toMatchObject({
      ok: true,
      blocked_reason: null,
      context_role: "tool_evidence",
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.goal_binding).toMatchObject({
      schema: "helix.capability_lane.goal_binding.v1",
      goal_binding_id: "goal-binding-1",
      goal_id: "goal:translate-docs",
      lane_session_id: "lane-session-goal",
      lane_id: "live_translation",
      selected_runtime_agent_provider: "codex",
      selected_backend_provider: "live_translation.local_runtime",
      cost_class: "free_local",
      latency_class: "interactive",
      privacy_class: "local_only",
      fallback_backend_provider: null,
      backend_selection_decision: expect.objectContaining({
        outcome: "fallback_selected",
        requested_backend_provider: "google_gemini",
        selected_backend_provider: "live_translation.local_runtime",
        terminal_authority_owner: "helix",
      }),
      lane_session_status: "running",
      lane_session_health: "healthy",
      lane_session_source_id: "docs:goal",
      lane_session_source_hash: "sha256:goal-v1",
      lane_session_source_text_hash: "sha256:text-goal",
      lane_session_source_text_char_count: 42,
      lane_session_source_kind: "docs",
      lane_session_projection_target: "docs_chunk",
      lane_session_account_locale: "es-US",
      lane_session_last_observation_ref: null,
      lane_session_last_receipt_ref: null,
      latest_lane_session_event: expect.objectContaining({
        action: "start",
        source_id: "docs:goal",
        source_hash: "sha256:goal-v1",
        terminal_authority_status: "not_terminal_authority",
      }),
      lane_session_debug_history: [
        expect.objectContaining({
          action: "start",
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
          source_id: "docs:goal",
          source_hash: "sha256:goal-v1",
          reentry_required: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      ],
      activation_policy: "while_goal_active",
      attention_policy: "quiet_until_salient",
      stop_condition: "goal_complete",
      report_policy: "terminal_authorized_summary",
      quiet_behavior: "record_only",
      status: "bound",
      last_report_ref: null,
      backend_provider_becomes_root_agent: false,
      final_reports_require_terminal_authority: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.goal_binding?.debug_history.map((event) => event.event)).toEqual(["bound"]);
    expect(result.goal_binding?.debug_history[0]).toMatchObject({
      goal_id: "goal:translate-docs",
      lane_session_id: "lane-session-goal",
      lane_id: "live_translation",
      lane_session_status: "running",
      lane_session_health: "healthy",
      lane_session_observation_ref: null,
      source_id: "docs:goal",
      source_hash: "sha256:goal-v1",
      source_kind: "docs",
      source_projection_target: "docs_chunk",
      account_locale: "es-US",
      receipt_ref: null,
      terminal_authority_status: "not_terminal_authority",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expectGoalBindingRemainsLaneBoundNonTerminal(result.goal_binding);
  });

  it("updates attention policy and refuses report refs without terminal authority", () => {
    const sessionStore = startTranslationSession();
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    store.bind({
      goalId: "goal:translate-docs",
      laneSessionId: "lane-session-goal",
      goalBindingId: "goal-binding-2",
      nowMs: 200,
    });

    const updated = store.updateAttention({
      goalBindingId: "goal-binding-2",
      attentionPolicy: "report_each_observation",
      quietBehavior: "surface_badge",
      reason: "operator_requested_visible_progress",
      nowMs: 210,
    });
    const blockedReport = store.recordReportRequest({
      goalBindingId: "goal-binding-2",
      reportRef: "ask:terminal-summary",
      terminalAuthorized: false,
      nowMs: 220,
    });
    sessionStore.recordObservation({
      laneSessionId: "lane-session-goal",
      observationRef: "ask:lane:translation:goal-obs",
      receiptRef: "ask:lane:translation:goal-obs:projection:receipt",
      chunkId: "chunk-report",
      chunkIndex: 2,
      dedupeKey: "docs:goal:chunk-report:es",
      sourceEventId: "docs:goal:event-report",
      sourceEventMs: 200,
      observedAtMs: 225,
      freshnessStatus: "fresh",
      projectionTarget: "docs_chunk",
      cancelRequested: true,
      nowMs: 225,
    });
    const acceptedReport = store.recordReportRequest({
      goalBindingId: "goal-binding-2",
      reportRef: "ask:terminal-summary",
      terminalAuthorized: true,
      nowMs: 230,
    });

    expect(updated.goal_binding).toMatchObject({
      attention_policy: "report_each_observation",
      quiet_behavior: "surface_badge",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(blockedReport).toMatchObject({
      ok: false,
      goal_binding: null,
      blocked_reason: "terminal_authority_required_for_goal_lane_report",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(acceptedReport).toMatchObject({
      ok: true,
      blocked_reason: null,
      goal_binding: {
        last_report_ref: "ask:terminal-summary",
        lane_session_last_observation_ref: "ask:lane:translation:goal-obs",
        latest_lane_session_event: expect.objectContaining({
          reason: "lane_session_observation_recorded",
          observation_ref: "ask:lane:translation:goal-obs",
          terminal_authority_status: "pending_helix_terminal_authority",
        }),
        lane_session_debug_history: [
          expect.objectContaining({ action: "start" }),
          expect.objectContaining({
            reason: "lane_session_observation_recorded",
            observation_ref: "ask:lane:translation:goal-obs",
            reentry_required: true,
          }),
        ],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(acceptedReport.goal_binding?.debug_history.map((event) => event.event)).toEqual([
      "bound",
      "attention_updated",
      "report_requested",
    ]);
    expect(acceptedReport.goal_binding?.debug_history.at(-1)).toMatchObject({
      event: "report_requested",
      lane_session_observation_ref: "ask:lane:translation:goal-obs",
      source_id: "docs:goal",
      source_kind: "docs",
      source_projection_target: "docs_chunk",
      account_locale: "es-US",
      latest_chunk_id: "chunk-report",
      latest_chunk_index: 2,
      latest_source_id: "docs:goal",
      latest_source_hash: "sha256:goal-v1",
      latest_source_kind: "docs",
      latest_dedupe_key: "docs:goal:chunk-report:es",
      latest_source_event_id: "docs:goal:event-report",
      latest_source_event_ms: 200,
      latest_observed_at_ms: 225,
      latest_freshness_status: "fresh",
      latest_projection_target: "docs_chunk",
      latest_cancel_requested: true,
      receipt_ref: null,
      terminal_authority_status: "pending_helix_terminal_authority",
      reentry_required: true,
    });
    expectGoalBindingRemainsLaneBoundNonTerminal(acceptedReport.goal_binding);
  });

  it("records mail-loop evidence for a goal-bound lane without creating a terminal report", () => {
    const sessionStore = startTranslationSession();
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    store.bind({
      goalId: "goal:translate-docs",
      laneSessionId: "lane-session-goal",
      goalBindingId: "goal-binding-mail",
      nowMs: 200,
    });
    sessionStore.recordObservation({
      laneSessionId: "lane-session-goal",
      observationRef: "stage-play-mail-goal",
      receiptRef: "ask:lane:translation:mail-obs:projection:receipt",
      chunkId: "chunk-mail",
      chunkIndex: 3,
      dedupeKey: "docs:goal:chunk-mail:es",
      sourceEventId: "docs:goal:event-mail",
      sourceEventMs: 205,
      observedAtMs: 210,
      freshnessStatus: "fresh",
      projectionTarget: "docs_chunk",
      cancelRequested: false,
      nowMs: 210,
    });

    const recorded = store.recordMailLoopEvidence({
      goalBindingId: "goal-binding-mail",
      mailLoopSummary: mailLoopSummary({
        receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
      }),
      nowMs: 220,
    });

    expect(recorded).toMatchObject({
      ok: true,
      blocked_reason: null,
      goal_binding: {
        last_report_ref: null,
        latest_mail_loop_summary: {
          schema: "helix.capability_lane.mail_loop_debug_summary.v1",
          lane_session_id: "lane-session-goal",
          stage_play_mail_id: "stage-play-mail-goal",
          observation_ref: "ask:lane:translation:mail-obs",
          receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
          selected_backend_provider: "live_translation.local_runtime",
          requested_backend_provider: "google_gemini",
          cost_class: "free_local",
          latency_class: "interactive",
          privacy_class: "local_only",
          fallback_backend_provider: null,
          backend_selection_decision: expect.objectContaining({
            outcome: "fallback_selected",
            selected_backend_provider: "live_translation.local_runtime",
          }),
          source_text_hash: "sha256:text-goal",
          source_text_char_count: 42,
          terminal_authority_status: "pending_helix_terminal_authority",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        lane_session_mail_loop_refs: ["stage-play-mail-goal"],
        lane_session_last_observation_ref: "stage-play-mail-goal",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(recorded.goal_binding?.debug_history.map((event) => event.event)).toEqual([
      "bound",
      "mail_loop_recorded",
    ]);
    expect(recorded.goal_binding?.debug_history.at(-1)).toMatchObject({
      event: "mail_loop_recorded",
      mail_loop_ref: "stage-play-mail-goal",
      receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
      lane_session_observation_ref: "stage-play-mail-goal",
      source_id: "docs:goal",
      source_kind: "docs",
      source_projection_target: "docs_chunk",
      account_locale: "es-US",
      latest_chunk_id: "chunk-mail",
      latest_chunk_index: 3,
      latest_source_id: "docs:goal",
      latest_source_hash: "sha256:goal-v1",
      latest_source_kind: "docs",
      latest_dedupe_key: "docs:goal:chunk-mail:es",
      latest_source_event_id: "docs:goal:event-mail",
      latest_source_event_ms: 205,
      latest_observed_at_ms: 210,
      latest_freshness_status: "fresh",
      source_text_hash: "sha256:text-goal",
      source_text_char_count: 42,
      latest_projection_target: "docs_chunk",
      latest_cancel_requested: false,
      terminal_authority_status: "pending_helix_terminal_authority",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expectGoalBindingRemainsLaneBoundNonTerminal(recorded.goal_binding);
  });

  it("accepts equivalent mail-loop projection target aliases for a goal-bound lane", () => {
    const sessionStore = startTranslationSession();
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    store.bind({
      goalId: "goal:translate-docs",
      laneSessionId: "lane-session-goal",
      goalBindingId: "goal-binding-mail-projection-alias",
      nowMs: 200,
    });
    sessionStore.recordObservation({
      laneSessionId: "lane-session-goal",
      observationRef: "stage-play-mail-goal",
      receiptRef: "ask:lane:translation:mail-obs:projection:receipt",
      projectionTarget: "docs_chunk",
      nowMs: 210,
    });

    const recorded = store.recordMailLoopEvidence({
      goalBindingId: "goal-binding-mail-projection-alias",
      mailLoopSummary: mailLoopSummary({
        projection_target: "docs_viewer_inline",
        receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
      }),
      nowMs: 220,
    });

    expect(recorded).toMatchObject({
      ok: true,
      blocked_reason: null,
      goal_binding: {
        latest_mail_loop_summary: {
          projection_target: "docs_viewer_inline",
          terminal_authority_status: "pending_helix_terminal_authority",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        lane_session_mail_loop_refs: ["stage-play-mail-goal"],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(recorded.goal_binding?.debug_history.at(-1)).toMatchObject({
      event: "mail_loop_recorded",
      source_projection_target: "docs_chunk",
      latest_projection_target: "docs_chunk",
      terminal_authority_status: "pending_helix_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expectGoalBindingRemainsLaneBoundNonTerminal(recorded.goal_binding);
  });

  it("fails closed when recording mail-loop evidence for the wrong lane session", () => {
    const sessionStore = startTranslationSession();
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    store.bind({
      goalId: "goal:translate-docs",
      laneSessionId: "lane-session-goal",
      goalBindingId: "goal-binding-mail-mismatch",
    });

    expect(store.recordMailLoopEvidence({
      goalBindingId: "goal-binding-mail-mismatch",
      mailLoopSummary: mailLoopSummary({ lane_session_id: "different-session" }),
    })).toMatchObject({
      ok: false,
      goal_binding: null,
      blocked_reason: "lane_session_mismatch",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("fails closed when mail-loop evidence does not match the goal-bound lane source or target", () => {
    const sessionStore = startTranslationSession();
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    store.bind({
      goalId: "goal:translate-docs",
      laneSessionId: "lane-session-goal",
      goalBindingId: "goal-binding-mail-source-mismatch",
      nowMs: 200,
    });

    expect(store.recordMailLoopEvidence({
      goalBindingId: "goal-binding-mail-source-mismatch",
      mailLoopSummary: mailLoopSummary({ source_id: "docs:other" }),
      nowMs: 205,
    })).toMatchObject({
      ok: false,
      goal_binding: null,
      blocked_reason: "source_id_mismatch",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(store.recordMailLoopEvidence({
      goalBindingId: "goal-binding-mail-source-mismatch",
      mailLoopSummary: mailLoopSummary({ source_hash: "sha256:old-doc" }),
      nowMs: 210,
    })).toMatchObject({
      ok: false,
      goal_binding: null,
      blocked_reason: "source_hash_mismatch",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(store.recordMailLoopEvidence({
      goalBindingId: "goal-binding-mail-source-mismatch",
      mailLoopSummary: mailLoopSummary({ source_text_hash: "sha256:text-old" }),
      nowMs: 215,
    })).toMatchObject({
      ok: false,
      goal_binding: null,
      blocked_reason: "source_text_hash_mismatch",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(store.recordMailLoopEvidence({
      goalBindingId: "goal-binding-mail-source-mismatch",
      mailLoopSummary: mailLoopSummary({ source_text_char_count: 41 }),
      nowMs: 216,
    })).toMatchObject({
      ok: false,
      goal_binding: null,
      blocked_reason: "source_text_char_count_mismatch",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(store.recordMailLoopEvidence({
      goalBindingId: "goal-binding-mail-source-mismatch",
      mailLoopSummary: mailLoopSummary({ projection_target: "docs_hover" }),
      nowMs: 220,
    })).toMatchObject({
      ok: false,
      goal_binding: null,
      blocked_reason: "projection_target_mismatch",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(store.recordMailLoopEvidence({
      goalBindingId: "goal-binding-mail-source-mismatch",
      mailLoopSummary: mailLoopSummary({ target_language: "fr" }),
      nowMs: 230,
    })).toMatchObject({
      ok: false,
      goal_binding: null,
      blocked_reason: "target_language_mismatch",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });

    expect(store.get("goal-binding-mail-source-mismatch")).toMatchObject({
      status: "bound",
      last_report_ref: null,
      latest_mail_loop_summary: null,
      lane_session_mail_loop_refs: [],
      debug_history: [
        expect.objectContaining({ event: "bound" }),
      ],
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("fails closed for missing goals, unknown sessions, and stopped bindings", () => {
    const sessionStore = startTranslationSession();
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });

    expect(store.bind({
      goalId: "",
      laneSessionId: "lane-session-goal",
    })).toMatchObject({
      ok: false,
      blocked_reason: "missing_goal_id",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(store.bind({
      goalId: "goal:missing-session",
      laneSessionId: "missing-session",
    })).toMatchObject({
      ok: false,
      blocked_reason: "unknown_lane_session",
    });

    store.bind({
      goalId: "goal:translate-docs",
      laneSessionId: "lane-session-goal",
      goalBindingId: "goal-binding-3",
    });
    const stopped = store.stop({
      goalBindingId: "goal-binding-3",
      reason: "goal_complete",
      nowMs: 300,
    });
    const duplicateStop = store.stop({
      goalBindingId: "goal-binding-3",
      reason: "goal_complete_again",
      nowMs: 310,
    });
    expect(stopped.goal_binding).toMatchObject({
      status: "stopped",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(duplicateStop).toMatchObject({
      ok: false,
      goal_binding: null,
      blocked_reason: "goal_binding_stopped",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(store.get("goal-binding-3")?.debug_history.map((event) => event.event)).toEqual([
      "bound",
      "stopped",
    ]);
    expect(store.updateAttention({
      goalBindingId: "goal-binding-3",
      attentionPolicy: "manual_review",
      quietBehavior: "record_only",
    })).toMatchObject({
      ok: false,
      blocked_reason: "goal_binding_stopped",
    });
  });

  it("fails closed on duplicate goal binding ids without replacing the original goal link", () => {
    const sessionStore = startTranslationSession();
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    const original = store.bind({
      goalId: "goal:translate-docs",
      laneSessionId: "lane-session-goal",
      goalBindingId: "goal-binding-duplicate",
      activationPolicy: "while_goal_active",
      attentionPolicy: "quiet_until_salient",
      stopCondition: "goal_complete",
      reportPolicy: "terminal_authorized_summary",
      quietBehavior: "record_only",
      nowMs: 200,
    });
    const duplicate = store.bind({
      goalId: "goal:replacement",
      laneSessionId: "lane-session-goal",
      goalBindingId: "goal-binding-duplicate",
      activationPolicy: "manual",
      attentionPolicy: "manual_review",
      stopCondition: "manual_stop",
      reportPolicy: "debug_only",
      quietBehavior: "surface_badge",
      nowMs: 250,
    });

    expect(duplicate).toMatchObject({
      ok: false,
      goal_binding: null,
      blocked_reason: "goal_binding_already_exists",
      context_role: "tool_evidence",
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(store.get("goal-binding-duplicate")).toEqual(original.goal_binding);
    expect(store.get("goal-binding-duplicate")).toMatchObject({
      goal_id: "goal:translate-docs",
      goal_binding_id: "goal-binding-duplicate",
      activation_policy: "while_goal_active",
      attention_policy: "quiet_until_salient",
      stop_condition: "goal_complete",
      report_policy: "terminal_authorized_summary",
      quiet_behavior: "record_only",
      debug_history: [
        expect.objectContaining({
          event: "bound",
          goal_id: "goal:translate-docs",
          at_ms: 200,
          terminal_authority_status: "not_terminal_authority",
          reentry_required: true,
          context_role: "tool_evidence",
          answer_authority: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      ],
      backend_provider_becomes_root_agent: false,
      final_reports_require_terminal_authority: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(store.list()).toHaveLength(1);
  });

  it("fails closed when a goal-bound lane session has already stopped", () => {
    const sessionStore = startTranslationSession();
    const store = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    store.bind({
      goalId: "goal:translate-docs",
      laneSessionId: "lane-session-goal",
      goalBindingId: "goal-binding-stopped-session",
      nowMs: 200,
    });
    sessionStore.stop({
      laneSessionId: "lane-session-goal",
      reason: "source_stopped",
      nowMs: 240,
    });

    expect(store.updateAttention({
      goalBindingId: "goal-binding-stopped-session",
      attentionPolicy: "manual_review",
      quietBehavior: "record_only",
      nowMs: 250,
    })).toMatchObject({
      ok: false,
      goal_binding: null,
      blocked_reason: "lane_session_stopped",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(store.recordMailLoopEvidence({
      goalBindingId: "goal-binding-stopped-session",
      mailLoopSummary: mailLoopSummary(),
      nowMs: 260,
    })).toMatchObject({
      ok: false,
      goal_binding: null,
      blocked_reason: "lane_session_stopped",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(store.recordReportRequest({
      goalBindingId: "goal-binding-stopped-session",
      reportRef: "ask:terminal-summary-after-stop",
      terminalAuthorized: true,
      nowMs: 270,
    })).toMatchObject({
      ok: false,
      goal_binding: null,
      blocked_reason: "lane_session_stopped",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });

    expect(store.get("goal-binding-stopped-session")).toMatchObject({
      status: "bound",
      last_report_ref: null,
      latest_mail_loop_summary: null,
      lane_session_mail_loop_refs: [],
      debug_history: [
        expect.objectContaining({ event: "bound" }),
      ],
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });
});
