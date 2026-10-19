import { describe, expect, it } from "vitest";
import type { HelixAgentProvider } from "../../agent-providers/types";
import { createHelixCapabilityLaneSessionStore } from "../session-manager";
import {
  buildHelixCapabilityLaneSessionDebugSummaries,
  buildHelixCapabilityLaneSessionDebugSummary,
} from "../session-summary";
import { buildHelixCapabilityLaneSessionListTimeline } from "../session-list-timeline";

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

const buildObservedSession = () => {
  const store = createHelixCapabilityLaneSessionStore();
  store.start({
    provider: buildProvider("codex"),
    laneId: "live_translation",
    laneSessionId: "lane-session-summary-only",
    sourceBinding: {
      source_id: "docs:session-summary",
      source_hash: "sha256:session-summary-v1",
      source_text_hash: "sha256:text-session-summary",
      source_text_char_count: 43,
      source_kind: "docs",
      projection_target: "docs_chunk",
      account_locale: "es-US",
      target_language: "es",
      source_binding_key:
        "docs:session-summary::sha256:session-summary-v1::docs_chunk::es-US::es",
    },
    requestedBackendProvider: "google_gemini",
    env: {} as NodeJS.ProcessEnv,
    nowMs: 100,
  });
  const observed = store.recordObservation({
    laneSessionId: "lane-session-summary-only",
    observationRef: "ask:lane:translation:session-obs",
    receiptRef: "ask:lane:translation:session-obs:projection:receipt",
    chunkId: "chunk-summary",
    chunkIndex: 1,
    dedupeKey: "docs:session-summary:chunk-summary:es",
    sourceEventId: "docs:session-summary:event-1",
    sourceEventMs: 90,
    observedAtMs: 120,
    freshnessStatus: "fresh",
    sourceTextHash: "sha256:text-session-summary",
    sourceTextCharCount: 43,
    sourceId: "docs:session-summary",
    sourceHash: "sha256:session-summary-v1",
    targetLanguage: "es",
    projectionTarget: "docs_chunk",
    cancelRequested: true,
    nowMs: 120,
  });
  if (!observed.lane_session) throw new Error("expected observed lane session");
  return observed.lane_session;
};

describe("capability lane session debug summary", () => {
  it("projects a standalone lane session without goal binding or terminal authority", () => {
    const summary = buildHelixCapabilityLaneSessionDebugSummary(
      buildObservedSession(),
    );

    expect(summary).toMatchObject({
      schema: "helix.capability_lane.session_debug_summary.v1",
      lane_session_id: "lane-session-summary-only",
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
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        live_backend_execution_enabled: false,
        terminal_authority_owner: "helix",
      }),
      session_status: "running",
      session_health: "healthy",
      latest_session_reason: "lane_session_observation_recorded",
      session_reason: "lane_session_observation_recorded",
      session_debug_phase: "running:record_observation:observation_recorded",
      session_observation_status: "observation_recorded",
      source_id: "docs:session-summary",
      source_hash: "sha256:session-summary-v1",
      source_kind: "docs",
      projection_target: "docs_chunk",
      account_locale: "es-US",
      target_language: "es",
      source_identity_key:
        "docs:session-summary::sha256:session-summary-v1::sha256:text-session-summary::43::docs::docs_chunk::es-US::es",
      session_control_key: [
        "lane-session-summary-only",
        "docs:session-summary",
        "sha256:session-summary-v1",
        "docs_chunk",
        "es-US",
        "es",
      ].join("::"),
      permissions: {
        read: true,
        observe: true,
        act: true,
        write: false,
        shell: false,
        code_mutation: false,
      },
      permission_profile: "permissions non-mutating",
      created_at_ms: 100,
      updated_at_ms: 120,
      last_observation_ref: "ask:lane:translation:session-obs",
      last_receipt_ref: "ask:lane:translation:session-obs:projection:receipt",
      permissions: expect.objectContaining({
        read: true,
        observe: true,
        write: false,
        shell: false,
        code_mutation: false,
      }),
      latest_chunk_id: "chunk-summary",
      latest_chunk_index: 1,
      latest_source_id: "docs:session-summary",
      latest_source_hash: "sha256:session-summary-v1",
      latest_source_binding_key:
        "docs:session-summary::sha256:session-summary-v1::docs_chunk::es-US::es",
      latest_source_identity_key:
        "docs:session-summary::sha256:session-summary-v1::sha256:text-session-summary::43::docs::docs_chunk::es-US::es",
      latest_source_kind: "docs",
      latest_account_locale: "es-US",
      latest_target_language: "es",
      latest_dedupe_key: "docs:session-summary:chunk-summary:es",
      latest_source_event_id: "docs:session-summary:event-1",
      latest_source_event_ms: 90,
      latest_observed_at_ms: 120,
      latest_freshness_status: "fresh",
      source_text_hash: "sha256:text-session-summary",
      source_text_char_count: 43,
      latest_projection_target: "docs_chunk",
      latest_cancel_requested: true,
      latest_observation_key: [
        "docs:session-summary",
        "sha256:session-summary-v1",
        "docs",
        "docs_chunk",
        "es-US",
        "es",
        "chunk-summary",
        "ask:lane:translation:session-obs:projection:receipt",
      ].join("::"),
      evidence_refs: expect.arrayContaining([
        "lane-session-summary-only",
        "lane-session-summary-only:record_observation:120",
        [
          "lane-session-summary-only",
          "docs:session-summary",
          "sha256:session-summary-v1",
          "docs_chunk",
          "es-US",
          "es",
        ].join("::"),
        "docs:session-summary::sha256:session-summary-v1::docs_chunk::es-US::es",
        "docs:session-summary::sha256:session-summary-v1::sha256:text-session-summary::43::docs::docs_chunk::es-US::es",
        "ask:lane:translation:session-obs",
        "ask:lane:translation:session-obs:projection:receipt",
        [
          "docs:session-summary",
          "sha256:session-summary-v1",
          "docs",
          "docs_chunk",
          "es-US",
          "es",
          "chunk-summary",
          "ask:lane:translation:session-obs:projection:receipt",
        ].join("::"),
      ]),
      latest_event_id: "lane-session-summary-only:record_observation:120",
      latest_receipt_ref: "ask:lane:translation:session-obs:projection:receipt",
      session_event_count: 2,
      has_observation: true,
      terminal_authority_status: "pending_helix_terminal_authority",
      reentry_required: true,
      backend_provider_becomes_root_agent: false,
      final_reports_require_terminal_authority: true,
      context_role: "tool_evidence",
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(summary.latest_session_event).toMatchObject({
      lane_session_id: "lane-session-summary-only",
      action: "record_observation",
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
      observation_ref: "ask:lane:translation:session-obs",
      receipt_ref: "ask:lane:translation:session-obs:projection:receipt",
      chunk_id: "chunk-summary",
      chunk_index: 1,
      dedupe_key: "docs:session-summary:chunk-summary:es",
      source_event_id: "docs:session-summary:event-1",
      source_id: "docs:session-summary",
      source_hash: "sha256:session-summary-v1",
      source_identity_key:
        "docs:session-summary::sha256:session-summary-v1::sha256:text-session-summary::43::docs::docs_chunk::es-US::es",
      source_kind: "docs",
      account_locale: "es-US",
      target_language: "es",
      source_event_ms: 90,
      observed_at_ms: 120,
      freshness_status: "fresh",
      source_text_hash: "sha256:text-session-summary",
      source_text_char_count: 43,
      projection_target: "docs_chunk",
      cancel_requested: true,
      context_role: "tool_evidence",
      terminal_authority_status: "pending_helix_terminal_authority",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("builds array summaries for debug export projection", () => {
    const summaries = buildHelixCapabilityLaneSessionDebugSummaries([
      buildObservedSession(),
    ]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      lane_session_id: "lane-session-summary-only",
      selected_backend_provider: "live_translation.local_runtime",
      cost_class: "free_local",
      latency_class: "interactive",
      privacy_class: "local_only",
      fallback_backend_provider: null,
      backend_selection_decision: expect.objectContaining({
        outcome: "fallback_selected",
        selected_backend_provider: "live_translation.local_runtime",
      }),
      last_receipt_ref: "ask:lane:translation:session-obs:projection:receipt",
      latest_chunk_id: "chunk-summary",
      source_hash: "sha256:session-summary-v1",
      latest_source_id: "docs:session-summary",
      latest_source_hash: "sha256:session-summary-v1",
      latest_source_binding_key:
        "docs:session-summary::sha256:session-summary-v1::docs_chunk::es-US::es",
      latest_source_identity_key:
        "docs:session-summary::sha256:session-summary-v1::sha256:text-session-summary::43::docs::docs_chunk::es-US::es",
      latest_source_kind: "docs",
      latest_account_locale: "es-US",
      latest_target_language: "es",
      latest_dedupe_key: "docs:session-summary:chunk-summary:es",
      latest_freshness_status: "fresh",
      source_binding_key:
        "docs:session-summary::sha256:session-summary-v1::docs_chunk::es-US::es",
      session_control_key: [
        "lane-session-summary-only",
        "docs:session-summary",
        "sha256:session-summary-v1",
        "docs_chunk",
        "es-US",
        "es",
      ].join("::"),
      latest_observation_key: [
        "docs:session-summary",
        "sha256:session-summary-v1",
        "docs",
        "docs_chunk",
        "es-US",
        "es",
        "chunk-summary",
        "ask:lane:translation:session-obs:projection:receipt",
      ].join("::"),
      evidence_refs: expect.arrayContaining([
        "lane-session-summary-only",
        "lane-session-summary-only:record_observation:120",
        "lane-session-summary-only::docs:session-summary::sha256:session-summary-v1::docs_chunk::es-US::es",
        "docs:session-summary::sha256:session-summary-v1::docs_chunk::es-US::es",
        "docs:session-summary::sha256:session-summary-v1::sha256:text-session-summary::43::docs::docs_chunk::es-US::es",
        "ask:lane:translation:session-obs",
        "ask:lane:translation:session-obs:projection:receipt",
      ]),
      source_text_hash: "sha256:text-session-summary",
      source_text_char_count: 43,
      latest_cancel_requested: true,
      latest_event_id: "lane-session-summary-only:record_observation:120",
      latest_receipt_ref: "ask:lane:translation:session-obs:projection:receipt",
      has_observation: true,
      permission_profile: "permissions non-mutating",
      terminal_authority_status: "pending_helix_terminal_authority",
      reentry_required: true,
      backend_provider_becomes_root_agent: false,
      final_reports_require_terminal_authority: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("keeps session identity explicit in list timeline rows", () => {
    const summaries = buildHelixCapabilityLaneSessionDebugSummaries([
      buildObservedSession(),
    ]);
    const timeline = buildHelixCapabilityLaneSessionListTimeline(summaries);

    expect(timeline).toEqual([
      expect.objectContaining({
        schema: "helix.capability_lane.provider_timeline_event.v1",
        stage: "lane_session",
        lane_id: "live_translation",
        lane_session_id: "lane-session-summary-only",
        requested_backend_provider: "google_gemini",
        requested_backend_provider_known: true,
        selected_backend_provider: "live_translation.local_runtime",
        selection_reason:
          "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
        cost_class: "free_local",
        latency_class: "interactive",
        privacy_class: "local_only",
        backend_selection_decision: expect.objectContaining({
          requested_backend_provider: "google_gemini",
          selected_backend_provider: "live_translation.local_runtime",
          selected_runtime_provider_remains_root: true,
          backend_provider_becomes_root_agent: false,
        }),
        session_control_key: [
          "lane-session-summary-only",
          "docs:session-summary",
          "sha256:session-summary-v1",
          "docs_chunk",
          "es-US",
          "es",
        ].join("::"),
        session_event_count: 2,
        session_created_at_ms: 100,
        session_updated_at_ms: 120,
        permission_profile: "permissions non-mutating",
        permissions: expect.objectContaining({
          read: true,
          observe: true,
          act: true,
          write: false,
          shell: false,
          code_mutation: false,
        }),
        source_binding_key:
          "docs:session-summary::sha256:session-summary-v1::docs_chunk::es-US::es",
        latest_source_binding_key:
          "docs:session-summary::sha256:session-summary-v1::docs_chunk::es-US::es",
        latest_account_locale: "es-US",
        evidence_refs: expect.arrayContaining([
          "lane-session-summary-only::docs:session-summary::sha256:session-summary-v1::docs_chunk::es-US::es",
          "docs:session-summary::sha256:session-summary-v1::docs_chunk::es-US::es",
          "docs:session-summary::sha256:session-summary-v1::sha256:text-session-summary::43::docs::docs_chunk::es-US::es",
          "ask:lane:translation:session-obs",
          "ask:lane:translation:session-obs:projection:receipt",
        ]),
        lane_requested: true,
        lane_executed: true,
        observation_reentered: false,
        observation_ref: "ask:lane:translation:session-obs",
        receipt_ref: "ask:lane:translation:session-obs:projection:receipt",
        latest_receipt_ref: "ask:lane:translation:session-obs:projection:receipt",
        reentry_required: true,
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        final_reports_require_terminal_authority: true,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
  });

  it("treats receipt-only session summaries as executed lane activity", () => {
    const summaries = buildHelixCapabilityLaneSessionDebugSummaries([
      buildObservedSession(),
    ]);
    const receiptOnlySummary = {
      ...summaries[0],
      has_observation: false,
      last_observation_ref: null,
      last_receipt_ref: "ask:lane:translation:session-obs:projection:receipt:previous",
      latest_receipt_ref: "ask:lane:translation:session-obs:projection:receipt",
      latest_observation_key: null,
    };
    const timeline = buildHelixCapabilityLaneSessionListTimeline([
      receiptOnlySummary,
    ]);

    expect(timeline).toEqual([
      expect.objectContaining({
        stage: "lane_session",
        lane_session_id: "lane-session-summary-only",
        lane_requested: true,
        lane_executed: true,
        observation_ref: null,
        receipt_ref: "ask:lane:translation:session-obs:projection:receipt",
        latest_receipt_ref: "ask:lane:translation:session-obs:projection:receipt",
        terminal_authority_status: "pending_helix_terminal_authority",
        context_role: "tool_evidence",
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
  });

  it("builds receipt-only session summaries as observed non-terminal evidence", () => {
    const observedSession = buildObservedSession();
    const receiptOnlyEvent = {
      ...observedSession.debug_history.at(-1)!,
      event_id: "lane-session-summary-only:record_receipt_only:125",
      observation_ref: null,
      receipt_ref: "ask:lane:translation:session-receipt-only",
      terminal_authority_status: "pending_helix_terminal_authority" as const,
    };
    const receiptOnlySession = {
      ...observedSession,
      last_observation_ref: null,
      last_receipt_ref: "ask:lane:translation:session-receipt-only",
      debug_history: [
        observedSession.debug_history[0]!,
        receiptOnlyEvent,
      ],
    };

    const summary = buildHelixCapabilityLaneSessionDebugSummary(receiptOnlySession);

    expect(summary).toMatchObject({
      lane_session_id: "lane-session-summary-only",
      session_debug_phase: "running:record_observation:observation_recorded",
      session_observation_status: "observation_recorded",
      has_observation: true,
      last_observation_ref: null,
      last_receipt_ref: "ask:lane:translation:session-receipt-only",
      latest_event_id: "lane-session-summary-only:record_receipt_only:125",
      latest_receipt_ref: "ask:lane:translation:session-receipt-only",
      latest_observation_key: [
        "docs:session-summary",
        "sha256:session-summary-v1",
        "docs",
        "docs_chunk",
        "es-US",
        "es",
        "chunk-summary",
        "ask:lane:translation:session-receipt-only",
      ].join("::"),
      evidence_refs: expect.arrayContaining([
        "ask:lane:translation:session-receipt-only",
        [
          "docs:session-summary",
          "sha256:session-summary-v1",
          "docs",
          "docs_chunk",
          "es-US",
          "es",
          "chunk-summary",
          "ask:lane:translation:session-receipt-only",
        ].join("::"),
      ]),
      terminal_authority_status: "pending_helix_terminal_authority",
      context_role: "tool_evidence",
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });

    expect(buildHelixCapabilityLaneSessionListTimeline([summary])).toEqual([
      expect.objectContaining({
        stage: "lane_session",
        lane_session_id: "lane-session-summary-only",
        lane_executed: true,
        observation_ref: null,
        receipt_ref: "ask:lane:translation:session-receipt-only",
        latest_receipt_ref: "ask:lane:translation:session-receipt-only",
        latest_observation_key: [
          "docs:session-summary",
          "sha256:session-summary-v1",
          "docs",
          "docs_chunk",
          "es-US",
          "es",
          "chunk-summary",
          "ask:lane:translation:session-receipt-only",
        ].join("::"),
        has_observation: true,
        terminal_authority_status: "pending_helix_terminal_authority",
        context_role: "tool_evidence",
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
  });

  it("prefers the canonical session source identity over a reconstructed summary key", () => {
    const observedSession = buildObservedSession();
    const canonicalSession = {
      ...observedSession,
      source_binding: {
        ...observedSession.source_binding,
        source_identity_key: "canonical:session-source-identity",
      },
    };

    expect(
      buildHelixCapabilityLaneSessionDebugSummary(canonicalSession)
        .source_identity_key,
    ).toBe("canonical:session-source-identity");
  });

  it("distinguishes a started session from one that has observed lane evidence", () => {
    const store = createHelixCapabilityLaneSessionStore();
    const started = store.start({
      provider: buildProvider("codex"),
      laneId: "live_translation",
      laneSessionId: "lane-session-started-only",
      sourceBinding: {
        source_id: "docs:started-only",
        source_hash: "sha256:started-only",
        source_kind: "docs",
        projection_target: "docs_chunk",
        account_locale: "fr-FR",
        target_language: "fr",
      },
      env: {} as NodeJS.ProcessEnv,
      nowMs: 300,
    });
    if (!started.lane_session) throw new Error("expected started lane session");

    const summary = buildHelixCapabilityLaneSessionDebugSummary(
      started.lane_session,
    );
    expect(summary).toMatchObject({
      lane_session_id: "lane-session-started-only",
      lifecycle_action: "start",
      session_lifecycle_action: "start",
      session_action: "start",
      latest_session_reason: "lane_session_started",
      session_reason: "lane_session_started",
      session_debug_phase: "running:start:no_observation",
      session_observation_status: "no_observation",
      latest_event_id: "lane-session-started-only:start:300",
      latest_receipt_ref: null,
      session_event_count: 1,
      has_observation: false,
      last_observation_ref: null,
      last_receipt_ref: null,
      latest_chunk_id: null,
      latest_source_id: null,
      latest_source_hash: null,
      latest_source_binding_key: null,
      latest_source_identity_key: null,
      latest_account_locale: "fr-FR",
      latest_target_language: null,
      source_binding_key:
        "docs:started-only::sha256:started-only::docs_chunk::fr-FR::fr",
      source_identity_key:
        "docs:started-only::sha256:started-only::docs::docs_chunk::fr-FR::fr",
      session_control_key:
        "lane-session-started-only::docs:started-only::sha256:started-only::docs_chunk::fr-FR::fr",
      latest_observation_key: null,
      evidence_refs: [
        "lane-session-started-only",
        "lane-session-started-only:start:300",
        "lane-session-started-only::docs:started-only::sha256:started-only::docs_chunk::fr-FR::fr",
        "docs:started-only::sha256:started-only::docs_chunk::fr-FR::fr",
        "docs:started-only::sha256:started-only::docs::docs_chunk::fr-FR::fr",
      ],
      terminal_authority_status: "not_terminal_authority",
      reentry_required: true,
      backend_provider_becomes_root_agent: false,
      final_reports_require_terminal_authority: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });

    expect(buildHelixCapabilityLaneSessionListTimeline([summary])).toEqual([
      expect.objectContaining({
        stage: "lane_session",
        lane_session_id: "lane-session-started-only",
        session_status: "running",
        session_health: "healthy",
        session_lifecycle_action: "start",
        session_observation_status: "no_observation",
        lane_requested: true,
        lane_executed: false,
        observation_reentered: false,
        observation_ref: null,
        receipt_ref: null,
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        final_reports_require_terminal_authority: true,
        terminal_authority_status: "not_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
  });

  it("keeps stopped session summaries tied to the latest observation authority state", () => {
    const store = createHelixCapabilityLaneSessionStore();
    const started = store.start({
      provider: buildProvider("codex"),
      laneId: "live_translation",
      laneSessionId: "lane-session-stopped-after-observation",
      sourceBinding: {
        source_id: "docs:stopped-after-observation",
        source_hash: "sha256:stopped-after-observation",
        source_kind: "docs",
        projection_target: "docs_chunk",
        account_locale: "es-US",
        target_language: "es",
      },
      env: {} as NodeJS.ProcessEnv,
      nowMs: 400,
    });
    if (!started.lane_session) throw new Error("expected started lane session");

    const observed = store.recordObservation({
      laneSessionId: "lane-session-stopped-after-observation",
      observationRef: "ask:lane:translation:stopped-observation",
      receiptRef: "ask:lane:translation:stopped-observation:projection:receipt",
      chunkId: "chunk-stopped",
      chunkIndex: 1,
      dedupeKey: "docs:stopped-after-observation:chunk-stopped:es",
      sourceEventId: "docs:stopped-after-observation:event-1",
      sourceEventMs: 410,
      observedAtMs: 420,
      freshnessStatus: "fresh",
      targetLanguage: "es",
      projectionTarget: "docs_chunk",
      nowMs: 420,
    });
    if (!observed.lane_session)
      throw new Error("expected observed lane session");

    const stopped = store.stop({
      laneSessionId: "lane-session-stopped-after-observation",
      reason: "goal_complete",
      nowMs: 430,
    });
    if (!stopped.lane_session) throw new Error("expected stopped lane session");

    expect(
      buildHelixCapabilityLaneSessionDebugSummary(stopped.lane_session),
    ).toMatchObject({
      lane_session_id: "lane-session-stopped-after-observation",
      lifecycle_action: "stop",
      session_lifecycle_action: "stop",
      session_action: "stop",
      session_status: "stopped",
      session_health: "stopped",
      latest_session_reason: "goal_complete",
      session_reason: "goal_complete",
      session_debug_phase: "stopped:stop:observation_recorded",
      session_observation_status: "observation_recorded",
      latest_event_id: "lane-session-stopped-after-observation:stop:430",
      session_event_count: 3,
      has_observation: true,
      last_observation_ref: "ask:lane:translation:stopped-observation",
      last_receipt_ref:
        "ask:lane:translation:stopped-observation:projection:receipt",
      latest_chunk_id: "chunk-stopped",
      latest_source_binding_key:
        "docs:stopped-after-observation::sha256:stopped-after-observation::docs_chunk::es-US::es",
      latest_source_identity_key:
        "docs:stopped-after-observation::sha256:stopped-after-observation::docs::docs_chunk::es-US::es",
      latest_source_event_id: "docs:stopped-after-observation:event-1",
      latest_observed_at_ms: 420,
      source_binding_key:
        "docs:stopped-after-observation::sha256:stopped-after-observation::docs_chunk::es-US::es",
      source_identity_key:
        "docs:stopped-after-observation::sha256:stopped-after-observation::docs::docs_chunk::es-US::es",
      session_control_key: [
        "lane-session-stopped-after-observation",
        "docs:stopped-after-observation",
        "sha256:stopped-after-observation",
        "docs_chunk",
        "es-US",
        "es",
      ].join("::"),
      latest_observation_key: [
        "docs:stopped-after-observation",
        "sha256:stopped-after-observation",
        "docs",
        "docs_chunk",
        "es-US",
        "es",
        "chunk-stopped",
        "ask:lane:translation:stopped-observation:projection:receipt",
      ].join("::"),
      evidence_refs: expect.arrayContaining([
        "lane-session-stopped-after-observation",
        "lane-session-stopped-after-observation:stop:430",
        "lane-session-stopped-after-observation:record_observation:420",
        "ask:lane:translation:stopped-observation",
        "ask:lane:translation:stopped-observation:projection:receipt",
      ]),
      terminal_authority_status: "pending_helix_terminal_authority",
      reentry_required: true,
      backend_provider_becomes_root_agent: false,
      final_reports_require_terminal_authority: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });
});
