import { describe, expect, it } from "vitest";
import type { HelixAgentProvider } from "../../agent-providers/types";
import { createHelixCapabilityLaneGoalBindingStore } from "../goal-binding";
import { runHelixCapabilityLaneGoalBindingRequests } from "../goal-binding-runner";
import { createHelixCapabilityLaneSessionStore } from "../session-manager";

const buildProvider = (): HelixAgentProvider => ({
  id: "codex",
  label: "Codex Workstation Mode",
  permissionProfile: {
    id: "read-observe-act",
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
    streaming: false,
    workstationTools: true,
    capabilityLanes: true,
    capabilityLaneOneShot: true,
    capabilityLaneSessions: true,
    codeMutation: false,
  },
  runTurn: async () => ({
    ok: false,
    runtime: "codex",
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

const mailLoopSummary = (overrides: Record<string, unknown> = {}) => ({
  schema: "helix.capability_lane.mail_loop_debug_summary.v1",
  lane_session_id: "lane-session-goal-runner-blocked",
  lane_id: "live_translation",
  capability: "live_translation.translate_text",
  observation_ref: "ask:lane:translation:runner-blocked-obs",
  receipt_ref: "ask:lane:translation:runner-blocked-obs:projection:receipt",
  stage_play_mail_id: "stage-play-mail-runner-blocked",
  stage_play_mail_delivery_status: "created",
  materialized_mail_loop_evidence: true,
  previous_stage_play_mail_id: null,
  stage_play_wake_expected: true,
  stage_play_wake_kind: "mailbox_wake",
  mailbox_thread_id: "ask-thread-runner-blocked",
  observation_lane_session_id: "lane-session-goal-runner-blocked",
  source_id: "docs:runner-blocked",
  source_hash: "sha256:runner-blocked-v1",
  source_kind: "document_markdown",
  account_locale: "es-US",
  lane_session_source_id: "docs:runner-blocked",
  lane_session_source_hash: "sha256:runner-blocked-v1",
  lane_session_source_text_hash: "sha256:text-runner-blocked",
  lane_session_source_text_char_count: 42,
  lane_session_projection_target: "docs_chunk",
  lane_session_target_language: "es",
  lane_session_account_locale: "es-US",
  lane_session_control_key:
    "lane-session-goal-runner-blocked::docs:runner-blocked::sha256:runner-blocked-v1::docs_chunk::es-US::es",
  lane_session_source_binding_key:
    "docs:runner-blocked::sha256:runner-blocked-v1::docs_chunk::es-US::es",
  lane_session_source_identity_key:
    "docs:runner-blocked::sha256:runner-blocked-v1::sha256:text-runner-blocked::42::docs::docs_chunk::es-US::es",
  source_identity_key:
    "docs:runner-blocked::sha256:runner-blocked-v1::sha256:text-runner-blocked::42::document_markdown::docs_chunk::es-US::es",
  mail_loop_observation_key:
    "docs:runner-blocked::sha256:runner-blocked-v1::document_markdown::docs_chunk::es-US::es::chunk-runner-blocked::ask:lane:translation:runner-blocked-obs:projection:receipt",
  chunk_id: "chunk-runner-blocked",
  chunk_index: 1,
  dedupe_key: "docs:runner-blocked:chunk-runner-blocked:es",
  source_event_id: "docs:runner-blocked:event-1",
  source_event_ms: 110,
  observed_at_ms: 120,
  projection_target: "docs_chunk",
  target_language: "es",
  cancel_requested: false,
  selected_backend_provider: "live_translation.local_runtime",
  requested_backend_provider: "google_gemini",
  backend_selection_decision: backendDecision,
  cost_class: "free_local",
  latency_class: "interactive",
  privacy_class: "local_only",
  fallback_backend_provider: "live_translation.local_runtime",
  freshness_status: "fresh",
  source_text_hash: "sha256:text-runner-blocked",
  source_text_char_count: 42,
  blocked_reason: null,
  mail_status: "unread",
  evidence_refs: [
    "lane-session-goal-runner-blocked",
    "stage-play-mail-runner-blocked",
    "ask:lane:translation:runner-blocked-obs",
  ],
  reentry_required: true,
  terminal_authority_status: "pending_helix_terminal_authority",
  terminal_eligible: false,
  assistant_answer: false,
  raw_content_included: false,
  ...overrides,
});

describe("capability lane goal binding runner", () => {
  it("lists existing goal bindings without mutating binding history", () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const goalBindingStore = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    sessionStore.start({
      provider: buildProvider(),
      laneId: "live_translation",
      laneSessionId: "lane-session-goal-runner-list",
      requestedBackendProvider: "google_gemini",
      sourceBinding: {
        source_id: "docs:runner-list",
        source_hash: "sha256:runner-list-v1",
        source_text_hash: "sha256:text-runner-list",
        source_text_char_count: 42,
        source_kind: "docs",
        projection_target: "docs_chunk",
        account_locale: "es-US",
        target_language: "es",
      },
      env: {} as NodeJS.ProcessEnv,
      nowMs: 100,
    });

    const bound = runHelixCapabilityLaneGoalBindingRequests({
      sessionStore,
      store: goalBindingStore,
      body: {
        capability_lane_goal_binding_call: {
          action: "bind",
          goal_binding_id: "goal-binding-runner-list",
          goal_id: "goal:runner-list",
          lane_session_id: "lane-session-goal-runner-list",
          report_policy: "ask_on_salience",
          quiet_behavior: "wake_on_salience",
          now_ms: 130,
        },
      },
    });

    expect(bound.goal_binding_debug_summaries).toHaveLength(1);
    expect(bound.goal_binding_debug_summaries[0]).toMatchObject({
      goal_binding_id: "goal-binding-runner-list",
      goal_id: "goal:runner-list",
      lane_session_id: "lane-session-goal-runner-list",
      latest_goal_binding_event: expect.objectContaining({
        event: "bound",
      }),
    });

    const listed = runHelixCapabilityLaneGoalBindingRequests({
      sessionStore,
      store: goalBindingStore,
      body: {
        capability_lane_goal_binding_call: {
          action: "list",
          goal_id: "goal:runner-list",
          lane_session_id: "lane-session-goal-runner-list",
        },
      },
    });

    expect(listed).toMatchObject({
      schema: "helix.capability_lane.goal_binding_runner_result.v1",
      requested: true,
      context_role: "tool_evidence",
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(listed.goal_binding_results).toEqual([
      expect.objectContaining({
        ok: true,
        blocked_reason: null,
        goal_binding: expect.objectContaining({
          goal_binding_id: "goal-binding-runner-list",
          goal_id: "goal:runner-list",
          lane_session_id: "lane-session-goal-runner-list",
          status: "bound",
          context_role: "tool_evidence",
          answer_authority: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        context_role: "tool_evidence",
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(listed.goal_binding_debug_summaries).toHaveLength(1);
    expect(listed.goal_binding_debug_summaries[0]).toMatchObject({
      goal_binding_id: "goal-binding-runner-list",
      goal_id: "goal:runner-list",
      lane_session_id: "lane-session-goal-runner-list",
      binding_status: "bound",
      latest_goal_binding_event: expect.objectContaining({
        event: "bound",
      }),
      backend_provider_becomes_root_agent: false,
      final_reports_require_terminal_authority: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(goalBindingStore.get("goal-binding-runner-list")?.debug_history.map((event) => event.event)).toEqual([
      "bound",
    ]);
  });

  it("treats unmatched goal binding lists as read-only evidence with no bindings", () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const goalBindingStore = createHelixCapabilityLaneGoalBindingStore({ sessionStore });

    const listed = runHelixCapabilityLaneGoalBindingRequests({
      sessionStore,
      store: goalBindingStore,
      body: {
        capabilityLaneGoalBindingCall: {
          action: "list",
          goalBindingId: "missing-goal-binding",
        },
      },
    });

    expect(listed.goal_binding_results).toEqual([
      expect.objectContaining({
        ok: true,
        goal_binding: null,
        blocked_reason: null,
        context_role: "tool_evidence",
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(listed.goal_binding_debug_summaries).toEqual([]);
    expect(goalBindingStore.list()).toEqual([]);
  });

  it("preserves mail-loop account and binding identity from structured goal calls", () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const goalBindingStore = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    sessionStore.start({
      provider: buildProvider(),
      laneId: "live_translation",
      laneSessionId: "lane-session-goal-runner",
      requestedBackendProvider: "google_gemini",
      sourceBinding: {
        source_id: "docs:runner",
        source_hash: "sha256:runner-v1",
        source_text_hash: "sha256:text-runner",
        source_text_char_count: 42,
        source_kind: "docs",
        projection_target: "docs_chunk",
        account_locale: "es-US",
        target_language: "es",
      },
      env: {} as NodeJS.ProcessEnv,
      nowMs: 100,
    });
    sessionStore.recordObservation({
      laneSessionId: "lane-session-goal-runner",
      observationRef: "ask:lane:translation:runner-obs",
      receiptRef: "ask:lane:translation:runner-obs:projection:receipt",
      sourceId: "docs:runner",
      sourceHash: "sha256:runner-v1",
      sourceKind: "docs",
      targetLanguage: "es",
      chunkId: "chunk-runner",
      chunkIndex: 1,
      dedupeKey: "docs:runner:chunk-runner:es",
      sourceEventId: "docs:runner:event-1",
      sourceEventMs: 110,
      observedAtMs: 120,
      freshnessStatus: "fresh",
      sourceTextHash: "sha256:text-runner",
      sourceTextCharCount: 42,
      projectionTarget: "docs_chunk",
      nowMs: 120,
    });

    const result = runHelixCapabilityLaneGoalBindingRequests({
      sessionStore,
      store: goalBindingStore,
      body: {
        capability_lane_goal_binding_call: [
          {
            action: "bind",
            goal_binding_id: "goal-binding-runner",
            goal_id: "goal:runner",
            lane_session_id: "lane-session-goal-runner",
            report_policy: "ask_on_salience",
            quiet_behavior: "wake_on_salience",
            now_ms: 130,
          },
          {
            action: "record_mail_loop",
            goal_binding_id: "goal-binding-runner",
            now_ms: 140,
            mail_loop_summary: {
              schema: "helix.capability_lane.mail_loop_debug_summary.v1",
              lane_session_id: "lane-session-goal-runner",
              lane_id: "live_translation",
              capability: "live_translation.translate_text",
              observation_ref: "ask:lane:translation:runner-obs",
              receipt_ref: "ask:lane:translation:runner-obs:projection:receipt",
              stage_play_mail_id: "stage-play-mail-runner",
              stage_play_mail_delivery_status: "created",
              materialized_mail_loop_evidence: true,
              previous_stage_play_mail_id: null,
              stage_play_wake_expected: true,
              stage_play_wake_kind: "mailbox_wake",
              mailbox_thread_id: "ask-thread-runner",
              observation_lane_session_id: "lane-session-goal-runner",
              source_id: "docs:runner",
              source_hash: "sha256:runner-v1",
              source_kind: "document_markdown",
              account_locale: "es-US",
              lane_session_source_id: "docs:runner",
              lane_session_source_hash: "sha256:runner-v1",
              lane_session_source_text_hash: "sha256:text-runner",
              lane_session_source_text_char_count: 42,
              lane_session_projection_target: "docs_chunk",
              lane_session_target_language: "es",
              lane_session_account_locale: "es-US",
              lane_session_control_key:
                "lane-session-goal-runner::docs:runner::sha256:runner-v1::docs_chunk::es-US::es",
              lane_session_source_binding_key:
                "docs:runner::sha256:runner-v1::docs_chunk::es-US::es",
              lane_session_source_identity_key:
                "docs:runner::sha256:runner-v1::sha256:text-runner::42::docs::docs_chunk::es-US::es",
              source_identity_key:
                "docs:runner::sha256:runner-v1::sha256:text-runner::42::document_markdown::docs_chunk::es-US::es",
              mail_loop_observation_key:
                "docs:runner::sha256:runner-v1::document_markdown::docs_chunk::es-US::es::chunk-runner::ask:lane:translation:runner-obs:projection:receipt",
              chunk_id: "chunk-runner",
              chunk_index: 1,
              dedupe_key: "docs:runner:chunk-runner:es",
              source_event_id: "docs:runner:event-1",
              source_event_ms: 110,
              observed_at_ms: 120,
              projection_target: "docs_chunk",
              target_language: "es",
              cancel_requested: false,
              selected_backend_provider: "live_translation.local_runtime",
              requested_backend_provider: "google_gemini",
              backend_selection_decision: backendDecision,
              cost_class: "free_local",
              latency_class: "interactive",
              privacy_class: "local_only",
              fallback_backend_provider: "live_translation.local_runtime",
              freshness_status: "fresh",
              source_text_hash: "sha256:text-runner",
              source_text_char_count: 42,
              blocked_reason: null,
              mail_status: "unread",
              evidence_refs: [
                "lane-session-goal-runner",
                "stage-play-mail-runner",
                "ask:lane:translation:runner-obs",
              ],
              reentry_required: true,
              terminal_authority_status: "pending_helix_terminal_authority",
              context_role: "tool_evidence",
              answer_authority: false,
              terminal_eligible: false,
              assistant_answer: false,
              raw_content_included: false,
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      requested: true,
      context_role: "tool_evidence",
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.goal_binding_results.at(-1)).toMatchObject({
      ok: true,
      blocked_reason: null,
      context_role: "tool_evidence",
      goal_binding: {
        latest_mail_loop_summary: {
          account_locale: "es-US",
          lane_session_control_key:
            "lane-session-goal-runner::docs:runner::sha256:runner-v1::docs_chunk::es-US::es",
          lane_session_source_binding_key:
            "docs:runner::sha256:runner-v1::docs_chunk::es-US::es",
          lane_session_source_identity_key:
            "docs:runner::sha256:runner-v1::sha256:text-runner::42::docs::docs_chunk::es-US::es",
          source_identity_key:
            "docs:runner::sha256:runner-v1::sha256:text-runner::42::document_markdown::docs_chunk::es-US::es",
          mail_loop_observation_key:
            "docs:runner::sha256:runner-v1::document_markdown::docs_chunk::es-US::es::chunk-runner::ask:lane:translation:runner-obs:projection:receipt",
          context_role: "tool_evidence",
          answer_authority: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    });
    expect(result.goal_binding_debug_summaries.at(-1)).toMatchObject({
      source_identity_key:
        "docs:runner::sha256:runner-v1::sha256:text-runner::42::docs::docs_chunk::es-US::es",
      latest_mail_loop_summary: expect.objectContaining({
        lane_session_source_identity_key:
          "docs:runner::sha256:runner-v1::sha256:text-runner::42::docs::docs_chunk::es-US::es",
        source_identity_key:
          "docs:runner::sha256:runner-v1::sha256:text-runner::42::document_markdown::docs_chunk::es-US::es",
        context_role: "tool_evidence",
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      latest_mail_loop_observation_key:
        "docs:runner::sha256:runner-v1::document_markdown::docs_chunk::es-US::es::chunk-runner::ask:lane:translation:runner-obs:projection:receipt",
      dispatch_plan: expect.objectContaining({
        latest_mail_loop_observation_key:
          "docs:runner::sha256:runner-v1::document_markdown::docs_chunk::es-US::es::chunk-runner::ask:lane:translation:runner-obs:projection:receipt",
        side_effects_executed: false,
        context_role: "tool_evidence",
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      dispatch_admission: expect.objectContaining({
        latest_mail_loop_observation_key:
          "docs:runner::sha256:runner-v1::document_markdown::docs_chunk::es-US::es::chunk-runner::ask:lane:translation:runner-obs:projection:receipt",
        wake_dispatch_allowed: false,
        context_role: "tool_evidence",
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    });
  });

  it("fails closed when goal-bound mail-loop evidence targets the wrong source kind", () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const goalBindingStore = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    sessionStore.start({
      provider: buildProvider(),
      laneId: "live_translation",
      laneSessionId: "lane-session-goal-runner-blocked",
      requestedBackendProvider: "google_gemini",
      sourceBinding: {
        source_id: "docs:runner-blocked",
        source_hash: "sha256:runner-blocked-v1",
        source_text_hash: "sha256:text-runner-blocked",
        source_text_char_count: 42,
        source_kind: "docs",
        projection_target: "docs_chunk",
        account_locale: "es-US",
        target_language: "es",
      },
      env: {} as NodeJS.ProcessEnv,
      nowMs: 100,
    });

    const result = runHelixCapabilityLaneGoalBindingRequests({
      sessionStore,
      store: goalBindingStore,
      body: {
        capability_lane_goal_binding_call: [
          {
            action: "bind",
            goal_binding_id: "goal-binding-runner-blocked",
            goal_id: "goal:runner-blocked",
            lane_session_id: "lane-session-goal-runner-blocked",
            now_ms: 130,
          },
          {
            action: "record_mail_loop",
            goal_binding_id: "goal-binding-runner-blocked",
            now_ms: 140,
            mail_loop_summary: mailLoopSummary({
              source_kind: "audio_transcript",
            }),
          },
        ],
      },
    });

    expect(result.goal_binding_results.at(-1)).toMatchObject({
      ok: false,
      blocked_reason: "source_kind_mismatch",
      goal_binding: null,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(goalBindingStore.get("goal-binding-runner-blocked")).toMatchObject({
      latest_mail_loop_summary: null,
      lane_session_mail_loop_refs: [],
    });
  });

  it("fails closed when goal-bound mail-loop evidence targets the wrong account locale", () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const goalBindingStore = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    sessionStore.start({
      provider: buildProvider(),
      laneId: "live_translation",
      laneSessionId: "lane-session-goal-runner-blocked",
      requestedBackendProvider: "google_gemini",
      sourceBinding: {
        source_id: "docs:runner-blocked",
        source_hash: "sha256:runner-blocked-v1",
        source_text_hash: "sha256:text-runner-blocked",
        source_text_char_count: 42,
        source_kind: "docs",
        projection_target: "docs_chunk",
        account_locale: "es-US",
        target_language: "es",
      },
      env: {} as NodeJS.ProcessEnv,
      nowMs: 100,
    });

    const result = runHelixCapabilityLaneGoalBindingRequests({
      sessionStore,
      store: goalBindingStore,
      body: {
        capability_lane_goal_binding_call: [
          {
            action: "bind",
            goal_binding_id: "goal-binding-runner-blocked",
            goal_id: "goal:runner-blocked",
            lane_session_id: "lane-session-goal-runner-blocked",
            now_ms: 130,
          },
          {
            action: "record_mail_loop",
            goal_binding_id: "goal-binding-runner-blocked",
            now_ms: 140,
            mail_loop_summary: mailLoopSummary({
              account_locale: "fr-FR",
            }),
          },
        ],
      },
    });

    expect(result.goal_binding_results.at(-1)).toMatchObject({
      ok: false,
      blocked_reason: "account_locale_mismatch",
      goal_binding: null,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(goalBindingStore.get("goal-binding-runner-blocked")).toMatchObject({
      latest_mail_loop_summary: null,
      lane_session_mail_loop_refs: [],
    });
  });

  it("keeps stopped goal bindings closed for later mail-loop evidence and reports", () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const goalBindingStore = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    sessionStore.start({
      provider: buildProvider(),
      laneId: "live_translation",
      laneSessionId: "lane-session-goal-runner-stopped",
      requestedBackendProvider: "google_gemini",
      sourceBinding: {
        source_id: "docs:runner-stopped",
        source_hash: "sha256:runner-stopped-v1",
        source_text_hash: "sha256:text-runner-stopped",
        source_text_char_count: 41,
        source_kind: "docs",
        projection_target: "docs_chunk",
        account_locale: "es-US",
        target_language: "es",
      },
      env: {} as NodeJS.ProcessEnv,
      nowMs: 100,
    });
    sessionStore.recordObservation({
      laneSessionId: "lane-session-goal-runner-stopped",
      observationRef: "ask:lane:translation:runner-stopped-obs",
      receiptRef: "ask:lane:translation:runner-stopped-obs:projection:receipt",
      sourceId: "docs:runner-stopped",
      sourceHash: "sha256:runner-stopped-v1",
      sourceKind: "docs",
      targetLanguage: "es",
      chunkId: "chunk-runner-stopped",
      chunkIndex: 1,
      dedupeKey: "docs:runner-stopped:chunk-runner-stopped:es",
      sourceEventId: "docs:runner-stopped:event-1",
      sourceEventMs: 110,
      observedAtMs: 120,
      freshnessStatus: "fresh",
      sourceTextHash: "sha256:text-runner-stopped",
      sourceTextCharCount: 41,
      projectionTarget: "docs_chunk",
      nowMs: 120,
    });

    const result = runHelixCapabilityLaneGoalBindingRequests({
      sessionStore,
      store: goalBindingStore,
      body: {
        capability_lane_goal_binding_call: [
          {
            action: "bind",
            goal_binding_id: "goal-binding-runner-stopped",
            goal_id: "goal:runner-stopped",
            lane_session_id: "lane-session-goal-runner-stopped",
            report_policy: "terminal_authorized_summary",
            quiet_behavior: "record_only",
            now_ms: 130,
          },
          {
            action: "stop",
            goal_binding_id: "goal-binding-runner-stopped",
            reason: "user_stopped_goal_lane",
            now_ms: 140,
          },
          {
            action: "record_mail_loop",
            goal_binding_id: "goal-binding-runner-stopped",
            now_ms: 150,
            mail_loop_summary: mailLoopSummary({
              lane_session_id: "lane-session-goal-runner-stopped",
              observation_lane_session_id: "lane-session-goal-runner-stopped",
              source_id: "docs:runner-stopped",
              source_hash: "sha256:runner-stopped-v1",
              source_text_hash: "sha256:text-runner-stopped",
              source_text_char_count: 41,
              lane_session_source_id: "docs:runner-stopped",
              lane_session_source_hash: "sha256:runner-stopped-v1",
              lane_session_source_text_hash: "sha256:text-runner-stopped",
              lane_session_source_text_char_count: 41,
              stage_play_mail_id: "stage-play-mail-runner-stopped",
              observation_ref: "ask:lane:translation:runner-stopped-obs",
              receipt_ref: "ask:lane:translation:runner-stopped-obs:projection:receipt",
              chunk_id: "chunk-runner-stopped",
              dedupe_key: "docs:runner-stopped:chunk-runner-stopped:es",
            }),
          },
          {
            action: "record_report",
            goal_binding_id: "goal-binding-runner-stopped",
            report_ref: "ask:goal:runner-stopped:terminal-report",
            terminal_authorized: true,
            now_ms: 160,
          },
        ],
      },
    });

    expect(result.goal_binding_results).toHaveLength(4);
    expect(result.goal_binding_results[1]).toMatchObject({
      ok: true,
      blocked_reason: null,
      goal_binding: {
        goal_binding_id: "goal-binding-runner-stopped",
        status: "stopped",
        lane_session_last_observation_ref: "ask:lane:translation:runner-stopped-obs",
        lane_session_last_receipt_ref: "ask:lane:translation:runner-stopped-obs:projection:receipt",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(result.goal_binding_results[2]).toMatchObject({
      ok: false,
      blocked_reason: "goal_binding_stopped",
      goal_binding: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(result.goal_binding_results[3]).toMatchObject({
      ok: false,
      blocked_reason: "goal_binding_stopped",
      goal_binding: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(result.goal_binding_debug_summaries.at(-1)).toMatchObject({
      goal_binding_id: "goal-binding-runner-stopped",
      binding_status: "stopped",
      latest_goal_binding_event: expect.objectContaining({
        event: "stopped",
        reason: "user_stopped_goal_lane",
      }),
      last_observation_ref: "ask:lane:translation:runner-stopped-obs",
      last_receipt_ref: "ask:lane:translation:runner-stopped-obs:projection:receipt",
      backend_provider_becomes_root_agent: false,
      final_reports_require_terminal_authority: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(goalBindingStore.get("goal-binding-runner-stopped")).toMatchObject({
      status: "stopped",
      latest_mail_loop_summary: null,
      last_report_ref: null,
      lane_session_mail_loop_refs: [],
      lane_session_last_observation_ref: "ask:lane:translation:runner-stopped-obs",
      lane_session_last_receipt_ref: "ask:lane:translation:runner-stopped-obs:projection:receipt",
    });
  });
});
