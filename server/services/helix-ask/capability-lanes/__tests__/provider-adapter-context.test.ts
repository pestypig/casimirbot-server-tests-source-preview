import { beforeEach, describe, expect, it } from "vitest";
import type { HelixCapabilityLaneMailLoopDebugSummary } from "@shared/helix-capability-lane-mail-loop";
import { runtimeMemoryGovernor } from "../../../runtime/runtime-memory-governor";
import type { HelixAgentProvider } from "../../agent-providers/types";
import { resetInterimVoiceCalloutsForTest } from "../../interim-voice-callout-store";
import { createHelixCapabilityLaneGoalBindingStore } from "../goal-binding";
import {
  buildHelixCapabilityLaneProviderAdapterContext,
  compactCapabilityLaneModelValue,
  reconcileCapabilityLaneProviderTimelineReentry,
} from "../provider-adapter-context";
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
    capabilityLaneSessions: true,
    codeMutation: false,
  },
  runTurn: async () => ({
    ok: false,
    runtime: id,
    response_type: "test",
    final_status: "test",
  }),
});

it("omits inline image payloads from model-visible capability re-entry", () => {
  const compacted = compactCapabilityLaneModelValue({
    source_image_ref: `data:image/png;base64,${"a".repeat(500_000)}`,
    text_candidate: "equation (47) extracted text",
  });
  const serialized = JSON.stringify(compacted);
  expect(serialized).not.toContain("data:image");
  expect(serialized).toContain("inline_image_payload_omitted");
  expect(serialized).toContain("equation (47) extracted text");
  expect(serialized.length).toBeLessThan(1_000);
});

it("reconciles capability-lane re-entry only for the exact returned observation", () => {
  const timeline = [
    {
      schema: "helix.capability_lane.provider_timeline_event.v1" as const,
      stage: "lane_reentered" as const,
      adapter_boundary: "helix_agent_provider_edge" as const,
      selected_runtime_agent_provider: "codex",
      lane_id: "visual_analysis",
      capability_id: "visual_analysis.inspect_image_region",
      status: "pending",
      lane_visible: false,
      lane_requested: true,
      lane_executed: false,
      observation_reentered: false,
      observation_ref: "observation:image-region:expected",
      terminal_authority_status: "pending_helix_terminal_authority" as const,
      terminal_eligible: false,
      assistant_answer: false as const,
      raw_content_included: false as const,
    },
  ];

  expect(reconcileCapabilityLaneProviderTimelineReentry({
    timeline,
    reenteredObservationRefs: ["observation:image-region:other"],
  })[0]).toMatchObject({
    status: "pending",
    observation_reentered: false,
  });
  expect(reconcileCapabilityLaneProviderTimelineReentry({
    timeline,
    reenteredObservationRefs: ["observation:image-region:expected"],
  })[0]).toMatchObject({
    status: "completed",
    lane_executed: false,
    observation_reentered: true,
  });
});

const body = {
  turn_id: "turn-provider-adapter-context",
  capability_lane_call: {
    capability: "utility_text.normalize_text",
    text: "  HELLO   WORKSTATION  ",
    normalization_mode: "lowercase",
    requested_backend_provider: "utility_text.openai_compatible",
  },
};

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
  assistant_answer: false as const,
  terminal_eligible: false as const,
  raw_content_included: false as const,
};

const mailLoopSummary = (
  input: Partial<HelixCapabilityLaneMailLoopDebugSummary> = {},
): HelixCapabilityLaneMailLoopDebugSummary => ({
  schema: "helix.capability_lane.mail_loop_debug_summary.v1",
  lane_session_id: "lane-session-provider-goal-mail",
  lane_id: "live_translation",
  capability: "live_translation.translate_text",
  observation_ref: "ask:lane:translation:mail-obs",
  receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
  stage_play_mail_id: "stage-play-mail-provider-goal",
  stage_play_wake_expected: true,
  stage_play_wake_kind: "mailbox_wake",
  mailbox_thread_id: "ask-thread-provider-goal",
  source_id: "document_markdown:docs/research/nhm2.md",
  source_kind: "document_markdown",
  source_identity_key:
    "document_markdown:docs/research/nhm2.md::fnv1a32:mail-doc::fnv1a32:mail-source-text::6144::document_markdown::docs_chunk::es-US::es",
  latest_source_identity_key:
    "document_markdown:docs/research/nhm2.md::fnv1a32:mail-doc::fnv1a32:mail-source-text-latest::2048::document_markdown::docs_chunk::es-US::es",
  chunk_id: "chunk-provider-goal",
  chunk_index: 4,
  dedupe_key: "docs/research/nhm2.md:chunk-provider-goal:es",
  source_event_id: "docs/research/nhm2.md:event-provider-goal",
  source_event_ms: 240,
  observed_at_ms: 250,
  projection_target: "docs_chunk",
  target_language: "es",
  cancel_requested: false,
  selected_backend_provider: "live_translation.local_runtime",
  requested_backend_provider: "google_gemini",
  backend_selection_decision: backendDecision,
  cost_class: "free_local",
  latency_class: "interactive",
  privacy_class: "local_only",
  fallback_backend_provider: null,
  freshness_status: "fresh",
  blocked_reason: null,
  mail_status: "unread",
  evidence_refs: [
    "lane-session-provider-goal-mail",
    "stage-play-mail-provider-goal",
    "ask:lane:translation:mail-obs",
  ],
  reentry_required: true,
  terminal_authority_status: "pending_helix_terminal_authority",
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
  ...input,
});

describe("capability lane provider adapter context", () => {
  beforeEach(() => {
    resetInterimVoiceCalloutsForTest();
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests();
  });

  it("packages one-shot lane execution for any selected runtime provider", async () => {
    const helix = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("helix"),
      body,
      env: { STT_LOCAL_URL: "http://127.0.0.1:9000" } as NodeJS.ProcessEnv,
    });
    const codex = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      body,
      env: { STT_LOCAL_URL: "http://127.0.0.1:9000" } as NodeJS.ProcessEnv,
    });

    expect(helix).toMatchObject({
      schema: "helix.capability_lane.provider_adapter_context.v1",
      calls_succeeded: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex).toMatchObject({
      schema: "helix.capability_lane.provider_adapter_context.v1",
      calls_succeeded: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(helix.debug_projection.capability_lane_call_results).toEqual([
      expect.objectContaining({
        capability: "utility_text.normalize_text",
        selected_runtime_agent_provider: "helix",
        normalized_text: "hello workstation",
      }),
    ]);
    expect(codex.debug_projection.capability_lane_call_results).toEqual([
      expect.objectContaining({
        capability: "utility_text.normalize_text",
        selected_runtime_agent_provider: "codex",
        normalized_text: "hello workstation",
      }),
    ]);
    expect(helix.observation_packets[0]).toMatchObject({
      capability_key: "utility_text.normalize_text",
      status: "succeeded",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.observation_packets[0]).toMatchObject({
      capability_key: "utility_text.normalize_text",
      status: "succeeded",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.artifact_ledger).toEqual([
      expect.objectContaining({
        schema: "helix.current_turn_artifact.v1",
        kind: "capability_lane_observation_packet",
        observation_kind: "utility_text.normalize_text",
        capability_key: "utility_text.normalize_text",
        lane_id: "utility_text",
        selected_backend_provider: "utility_text.local_runtime",
        lane_execution_status: "executed_observation_only",
        backend_selection_decision: expect.objectContaining({
          selected_backend_provider: "utility_text.local_runtime",
          terminal_authority_owner: "helix",
        }),
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(codex.model_visible_capability_lane_manifest).toMatchObject({
      schema: "helix.agent_model_visible_capability_lane_manifest.v1",
      selected_runtime_agent_provider: "codex",
      authority_rules: expect.objectContaining({
        helix_owns_backend_selection: true,
        lane_outputs_are_not_final_answers: true,
        terminal_authority_owner: "helix",
      }),
    });
    expect(codex.debug_projection.model_visible_capability_lane_manifest).toEqual(
      codex.model_visible_capability_lane_manifest,
    );
    expect(codex.debug_projection.capability_lane_turn_timeline).toEqual(
      codex.capability_lane_turn_timeline,
    );
    expect(codex.capability_lane_turn_timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        schema: "helix.capability_lane.provider_timeline_event.v1",
        stage: "lane_visible",
        selected_runtime_agent_provider: "codex",
        adapter_boundary: "helix_agent_provider_edge",
        lane_id: "live_translation",
        capability_id: "live_translation.translate_text",
        lane_visible: true,
        lane_requested: false,
        lane_executed: false,
        observation_reentered: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        stage: "lane_requested",
        adapter_boundary: "helix_agent_provider_edge",
        lane_id: "utility_text",
        capability_id: "utility_text.normalize_text",
        requested_backend_provider: "utility_text.openai_compatible",
        requested_backend_provider_known: true,
        selected_backend_provider: "utility_text.local_runtime",
        fallback_backend_provider: null,
        selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
        lane_visible: false,
        lane_requested: true,
        lane_executed: false,
      }),
      expect.objectContaining({
        stage: "lane_backend_selected",
        adapter_boundary: "helix_agent_provider_edge",
        lane_id: "utility_text",
        capability_id: "utility_text.normalize_text",
        requested_backend_provider: "utility_text.openai_compatible",
        requested_backend_provider_known: true,
        selected_backend_provider: "utility_text.local_runtime",
        fallback_backend_provider: null,
        selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
        lane_visible: false,
        lane_requested: true,
        lane_executed: false,
      }),
      expect.objectContaining({
        stage: "lane_observation",
        adapter_boundary: "helix_agent_provider_edge",
        lane_id: "utility_text",
        capability_id: "utility_text.normalize_text",
        status: "completed",
        requested_backend_provider: "utility_text.openai_compatible",
        requested_backend_provider_known: true,
        selected_backend_provider: "utility_text.local_runtime",
        fallback_backend_provider: null,
        selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
        lane_visible: false,
        lane_requested: true,
        lane_executed: true,
        terminal_authority_status: "pending_helix_terminal_authority",
      }),
      expect.objectContaining({
        stage: "lane_reentered",
        adapter_boundary: "helix_agent_provider_edge",
        lane_id: "utility_text",
        capability_id: "utility_text.normalize_text",
        observation_ref: expect.stringContaining("turn-provider-adapter-context:capability_lane:utility_text.normalize_text:"),
        status: "pending",
        observation_reentered: false,
        terminal_authority_status: "pending_helix_terminal_authority",
      }),
    ]));
    const promptVisibleTranslation = codex.model_visible_capability_lane_manifest.lanes
      .flatMap((lane) => lane.capabilities)
      .find((capability) => capability.capability_id === "live_translation.translate_text");
    expect(promptVisibleTranslation).toMatchObject({
      required_input_fields: ["text", "target_language"],
      result_authority: "observation_or_receipt_only",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(promptVisibleTranslation?.when_not_to_use).toContain("docs-viewer.read_active_translation");
    const promptVisibleSpeechToText = codex.model_visible_capability_lane_manifest.lanes
      .flatMap((lane) => lane.capabilities)
      .find((capability) => capability.capability_id === "speech_to_text.transcribe_audio");
    expect(promptVisibleSpeechToText).toMatchObject({
      required_input_fields: ["audio_ref"],
      result_authority: "observation_or_receipt_only",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(codex.prompt_observation_block).toContain("hello workstation");
    expect(codex.prompt_observation_block).toContain("utility_text.normalize_text");
    expect(codex.prompt_observation_block).toContain("model_visible_capability_lane_manifest");
    expect(codex.prompt_observation_block).toContain("live_translation.translate_text");
    expect(codex.prompt_observation_block).toContain("speech_to_text.transcribe_audio");
    expect(codex.prompt_observation_block).toContain("docs-viewer.read_active_translation");
    expect(codex.prompt_observation_block).toContain("lane_outputs_are_not_final_answers");
    expect(codex.prompt_observation_block).toContain("capability_lane_observation_packets");
    expect(codex.prompt_observation_block).toContain("capability_lane_backend_selections");
    expect(codex.prompt_observation_block).toContain("capability_lane_turn_timeline");
    expect(codex.prompt_observation_block).toContain("lane_visible");
    expect(codex.prompt_observation_block).toContain("lane_observation");
    expect(codex.prompt_observation_block).toContain("capability_lane_session_debug_summaries");
    expect(codex.prompt_observation_block).toContain("capability_lane_reentry_status");
    expect(codex.reentry_observation_block).toContain("hello workstation");
    expect(codex.reentry_observation_block).toContain("utility_text.normalize_text");
    expect(codex.reentry_observation_block).toContain("capability_lane_observation_packets");
    expect(codex.reentry_observation_block).toContain("capability_lane_reentry_status");
    expect(codex.reentry_observation_block).not.toContain("model_visible_capability_lane_manifest");
    expect(codex.reentry_observation_block).not.toContain("lane_outputs_are_not_final_answers");
    expect(codex.reentry_observation_block).not.toContain("capability_lane_session_debug_summaries");
  });

  it("keeps successive capability observation reentry blocks free of planning scaffolds", async () => {
    const contexts = await Promise.all([
      buildHelixCapabilityLaneProviderAdapterContext({
        provider: buildProvider("codex"),
        body: {
          turn_id: "turn-provider-adapter-reentry-step-1",
          capability_lane_call: {
            capability: "utility_text.normalize_text",
            text: "first crop observation",
            normalization_mode: "lowercase",
          },
        },
      }),
      buildHelixCapabilityLaneProviderAdapterContext({
        provider: buildProvider("codex"),
        body: {
          turn_id: "turn-provider-adapter-reentry-step-2",
          capability_lane_call: {
            capability: "utility_text.normalize_text",
            text: "second narrower crop observation",
            normalization_mode: "lowercase",
          },
        },
      }),
    ]);

    expect(contexts[0].reentry_observation_block).toContain("first crop observation");
    expect(contexts[1].reentry_observation_block).toContain("second narrower crop observation");
    for (const context of contexts) {
      expect(context.reentry_observation_block).toContain("capability_lane_observation_packets");
      expect(context.reentry_observation_block).toContain("capability_lane_reentry_status");
      expect(context.reentry_observation_block).not.toContain("model_visible_capability_lane_manifest");
      expect(context.reentry_observation_block).not.toContain("lane_outputs_are_not_final_answers");
      expect(context.reentry_observation_block).not.toContain("capability_lane_session_debug_summaries");
    }
  });

  it("keeps pending text-to-speech playback visible as executed non-terminal evidence", async () => {
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: () => ({
        heapUsed: 120 * 1024 * 1024,
        heapTotal: 512 * 1024 * 1024,
        rss: 640 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
      }),
      hostMemoryReader: () => ({
        freeMiB: 16_000,
        totalMiB: 32_000,
        freeRatio: 0.5,
      }),
    });
    const context = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-adapter-tts-pending",
        capability_lane_call: {
          capability: "text_to_speech.speak_text",
          text: "governed playback pending",
          source_observation_ref: "obs:translation-for-tts",
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(context.calls_succeeded).toBe(true);
    expect(context.one_shot.observation_packets[0]).toMatchObject({
      capability_key: "text_to_speech.speak_text",
      status: "client_pending",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(context.one_shot.debug_events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "lane_observation",
        lane_id: "text_to_speech",
        capability: "text_to_speech.speak_text",
        status: "pending",
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]));
    expect(context.capability_lane_turn_timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "lane_observation",
        lane_id: "text_to_speech",
        capability_id: "text_to_speech.speak_text",
        status: "pending",
        lane_requested: true,
        lane_executed: true,
        observation_reentered: false,
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]));
  });

  it("projects visible translation collector source identity into provider timeline rows", async () => {
    const context = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-visible-collector",
        capability_lane_call: {
          capability: "workstation_tool_reference.collect_visible_translation_targets",
          active_panel_id: "docs-viewer",
          doc_path: "docs/research/nhm2.md",
          source_hash: "sha256:full-document-hash",
          projection_target: "docs_chunk",
          account_locale: "es-US",
          target_language: "es",
          visible_only: true,
          max_chunks: 1,
          title_text: "NHM2 frontier status",
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(context.calls_succeeded).toBe(true);
    expect(context.capability_lane_turn_timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        schema: "helix.capability_lane.provider_timeline_event.v1",
        stage: "lane_observation",
        selected_runtime_agent_provider: "codex",
        adapter_boundary: "helix_agent_provider_edge",
        lane_id: "workstation_tool_reference",
        capability_id: "workstation_tool_reference.collect_visible_translation_targets",
        lane_requested: true,
        lane_executed: true,
        observation_reentered: false,
        source_id: "document_markdown:docs/research/nhm2.md#visible-chunk-1",
        doc_path: "docs/research/nhm2.md",
        source_hash: "sha256:full-document-hash",
        source_kind: "docs_viewer",
        source_projection_target: "docs_chunk",
        account_locale: "es-US",
        latest_chunk_id: "visible-chunk-1",
        latest_chunk_index: 0,
        latest_dedupe_key: expect.stringContaining("visible-chunk-1"),
        latest_source_event_id: expect.stringContaining("visible-chunk-1"),
        source_text_hash: expect.stringMatching(/^sha256:/),
        source_text_char_count: "NHM2 frontier status".length,
        target_language: "es",
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]));
  });

  it("packages governed lane session lifecycle calls for the selected runtime provider", async () => {
    const context = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-adapter-session",
        capability_lane_session_call: {
          action: "start",
          lane_id: "live_translation",
          lane_session_id: "lane-session-provider-context",
          requested_backend_provider: "google_gemini",
          now_ms: 200,
          source_binding: {
            source_id: "docs:nhm2",
            source_kind: "docs",
            projection_target: "docs_chunk",
            account_locale: "es-US",
          },
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(context.calls_succeeded).toBe(true);
    expect(context.sessions).toMatchObject({
      schema: "helix.capability_lane.session_runner_result.v1",
      requested: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(context.debug_projection.capability_lane_session_results).toEqual([
      expect.objectContaining({
        ok: true,
        action: "start",
        blocked_reason: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(context.debug_projection.capability_lane_session_debug_summaries).toEqual([
      expect.objectContaining({
        schema: "helix.capability_lane.session_debug_summary.v1",
        lane_session_id: "lane-session-provider-context",
        lane_id: "live_translation",
        selected_runtime_agent_provider: "codex",
        selected_backend_provider: "live_translation.local_runtime",
        backend_selection_decision: expect.objectContaining({
          outcome: "fallback_selected",
          requested_backend_provider: "google_gemini",
          selected_backend_provider: "live_translation.local_runtime",
          selected_runtime_provider_remains_root: true,
          backend_provider_becomes_root_agent: false,
          terminal_authority_owner: "helix",
        }),
        session_status: "running",
        session_health: "healthy",
        source_id: "docs:nhm2",
        projection_target: "docs_chunk",
        account_locale: "es-US",
        latest_event_id: "lane-session-provider-context:start:200",
        latest_source_identity_key: null,
        has_observation: false,
        last_observation_ref: null,
        last_receipt_ref: null,
        backend_provider_becomes_root_agent: false,
        final_reports_require_terminal_authority: true,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(context.capability_lane_turn_timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "lane_session",
        selected_runtime_agent_provider: "codex",
        lane_id: "live_translation",
        lane_session_id: "lane-session-provider-context",
        capability_id: null,
        status: "running",
        lane_visible: false,
        lane_requested: true,
        lane_executed: false,
        observation_reentered: false,
        requested_backend_provider: "google_gemini",
        requested_backend_provider_known: true,
        selected_backend_provider: "live_translation.local_runtime",
        selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
        cost_class: "free_local",
        latency_class: "interactive",
        privacy_class: "local_only",
        backend_selection_decision: expect.objectContaining({
          requested_backend_provider: "google_gemini",
          selected_backend_provider: "live_translation.local_runtime",
          selected_runtime_provider_remains_root: true,
          backend_provider_becomes_root_agent: false,
        }),
        observation_ref: null,
        receipt_ref: null,
        latest_event_id: "lane-session-provider-context:start:200",
        lifecycle_action: "start",
        session_lifecycle_action: "start",
        session_action: "start",
        session_control_key: "lane-session-provider-context::docs:nhm2::docs_chunk::es-US::es",
        source_binding_key: "docs:nhm2::docs_chunk::es-US::es",
        source_identity_key: "docs:nhm2::docs::docs_chunk::es-US::es",
        latest_source_identity_key: null,
        latest_observation_key: null,
        has_observation: false,
        source_id: "docs:nhm2",
        source_kind: "docs",
        source_projection_target: "docs_chunk",
        account_locale: "es-US",
        latest_projection_target: "docs_chunk",
        terminal_authority_status: "not_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]));
    expect(context.prompt_observation_block).toContain("capability_lane_session_results");
    expect(context.prompt_observation_block).toContain("capability_lane_session_debug_summaries");
    expect(context.prompt_observation_block).toContain("lane-session-provider-context");
    expect(context.prompt_observation_block).toContain("has_observation");
    expect(context.prompt_observation_block).toContain("latest_event_id");
    expect(context.prompt_observation_block).toContain("session_lifecycle_action");
    expect(context.prompt_observation_block).toContain("source_binding_key");
    expect(context.prompt_observation_block).toContain("fallback_selected");
    expect(context.prompt_observation_block).toContain("final_reports_require_terminal_authority");
  });

  it("keeps pause and resume lifecycle events visible through the provider timeline", async () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const context = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      sessionStore,
      body: {
        turn_id: "turn-provider-adapter-session-pause-resume",
        capability_lane_session_call: [
          {
            action: "start",
            lane_id: "live_translation",
            lane_session_id: "lane-session-provider-pause-resume",
            requested_backend_provider: "google_gemini",
            now_ms: 200,
            source_binding: {
              source_id: "docs:nhm2",
              source_kind: "docs",
              source_hash: "sha256:provider-pause-resume",
              projection_target: "docs_chunk",
              account_locale: "es-US",
              target_language: "es",
            },
          },
          {
            action: "pause",
            lane_session_id: "lane-session-provider-pause-resume",
            now_ms: 240,
            reason: "user_paused_account_language_translation",
          },
          {
            action: "resume",
            lane_session_id: "lane-session-provider-pause-resume",
            now_ms: 280,
            reason: "user_resumed_account_language_translation",
          },
        ],
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(context.calls_succeeded).toBe(true);
    expect(context.debug_projection.capability_lane_session_results).toEqual([
      expect.objectContaining({
        ok: true,
        action: "start",
        blocked_reason: null,
      }),
      expect.objectContaining({
        ok: true,
        action: "pause",
        blocked_reason: null,
        lane_session: expect.objectContaining({
          status: "paused",
          health: "degraded",
          updated_at_ms: 240,
        }),
      }),
      expect.objectContaining({
        ok: true,
        action: "resume",
        blocked_reason: null,
        lane_session: expect.objectContaining({
          status: "running",
          health: "healthy",
          updated_at_ms: 280,
        }),
      }),
    ]);
    expect(context.debug_projection.capability_lane_session_debug_summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        lane_session_id: "lane-session-provider-pause-resume",
        session_status: "paused",
        session_health: "degraded",
        lifecycle_action: "pause",
        session_lifecycle_action: "pause",
        session_action: "pause",
        latest_event_id: "lane-session-provider-pause-resume:pause:240",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        lane_session_id: "lane-session-provider-pause-resume",
        session_status: "running",
        session_health: "healthy",
        lifecycle_action: "resume",
        session_lifecycle_action: "resume",
        session_action: "resume",
        latest_event_id: "lane-session-provider-pause-resume:resume:280",
        session_control_key:
          "lane-session-provider-pause-resume::docs:nhm2::sha256:provider-pause-resume::docs_chunk::es-US::es",
        source_binding_key: "docs:nhm2::sha256:provider-pause-resume::docs_chunk::es-US::es",
        source_identity_key: "docs:nhm2::sha256:provider-pause-resume::docs::docs_chunk::es-US::es",
        has_observation: false,
        backend_provider_becomes_root_agent: false,
        final_reports_require_terminal_authority: true,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]));
    expect(context.capability_lane_turn_timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "lane_session",
        selected_runtime_agent_provider: "codex",
        lane_id: "live_translation",
        status: "running",
        lifecycle_action: "resume",
        session_lifecycle_action: "resume",
        session_action: "resume",
        latest_event_id: "lane-session-provider-pause-resume:resume:280",
        session_control_key:
          "lane-session-provider-pause-resume::docs:nhm2::sha256:provider-pause-resume::docs_chunk::es-US::es",
        source_binding_key: "docs:nhm2::sha256:provider-pause-resume::docs_chunk::es-US::es",
        source_identity_key: "docs:nhm2::sha256:provider-pause-resume::docs::docs_chunk::es-US::es",
        lane_executed: false,
        observation_reentered: false,
        has_observation: false,
        terminal_authority_status: "not_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]));
    expect(context.prompt_observation_block).toContain("lane-session-provider-pause-resume:resume:280");
    expect(context.prompt_observation_block).toContain("session_lifecycle_action");
    expect(context.prompt_observation_block).toContain("user_resumed_account_language_translation");
  });

  it("keeps read-only lane session list controls visible without implying execution", async () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const provider = buildProvider("codex");

    const started = await buildHelixCapabilityLaneProviderAdapterContext({
      provider,
      sessionStore,
      body: {
        turn_id: "turn-provider-adapter-session-list-start",
        capability_lane_session_call: {
          action: "start",
          lane_id: "live_translation",
          lane_session_id: "lane-session-provider-list",
          requested_backend_provider: "google_gemini",
          now_ms: 200,
          source_binding: {
            source_id: "docs:list-provider",
            source_hash: "sha256:provider-list",
            source_text_hash: "sha256:provider-list-text",
            source_text_char_count: 72,
            source_kind: "docs",
            projection_target: "docs_chunk",
            account_locale: "es-US",
            target_language: "es",
          },
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(started.calls_succeeded).toBe(true);
    expect(started.debug_projection.capability_lane_session_debug_summaries).toEqual([
      expect.objectContaining({
        lane_session_id: "lane-session-provider-list",
        session_lifecycle_action: "start",
        session_event_count: 1,
      }),
    ]);

    const listed = await buildHelixCapabilityLaneProviderAdapterContext({
      provider,
      sessionStore,
      body: {
        turn_id: "turn-provider-adapter-session-list",
        capability_lane_session_call: {
          action: "list",
          lane_session_id: "lane-session-provider-list",
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(listed.calls_succeeded).toBe(true);
    expect(listed.debug_projection.capability_lane_session_results).toEqual([
      expect.objectContaining({
        ok: true,
        action: "list",
        lane_session_id: "lane-session-provider-list",
        selected_runtime_agent_provider: "codex",
        session_supported: true,
        lane_session: null,
        blocked_reason: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(listed.debug_projection.capability_lane_session_debug_summaries).toEqual([
      expect.objectContaining({
        schema: "helix.capability_lane.session_debug_summary.v1",
        lane_session_id: "lane-session-provider-list",
        lane_id: "live_translation",
        selected_runtime_agent_provider: "codex",
        selected_backend_provider: "live_translation.local_runtime",
        session_status: "running",
        session_health: "healthy",
        session_lifecycle_action: "start",
        session_event_count: 1,
        source_id: "docs:list-provider",
        source_hash: "sha256:provider-list",
        source_text_hash: "sha256:provider-list-text",
        source_text_char_count: 72,
        projection_target: "docs_chunk",
        account_locale: "es-US",
        target_language: "es",
        has_observation: false,
        last_observation_ref: null,
        last_receipt_ref: null,
        backend_selection_decision: expect.objectContaining({
          selected_runtime_provider_remains_root: true,
          backend_provider_becomes_root_agent: false,
          terminal_authority_owner: "helix",
        }),
        backend_provider_becomes_root_agent: false,
        final_reports_require_terminal_authority: true,
        terminal_authority_status: "not_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(listed.capability_lane_turn_timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "lane_session",
        selected_runtime_agent_provider: "codex",
        lane_id: "live_translation",
        lane_session_id: "lane-session-provider-list",
        status: "running",
        lane_visible: false,
        lane_requested: true,
        lane_executed: false,
        observation_reentered: false,
        lifecycle_action: "start",
        session_lifecycle_action: "start",
        session_action: "start",
        has_observation: false,
        observation_ref: null,
        receipt_ref: null,
        terminal_authority_status: "not_terminal_authority",
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        final_reports_require_terminal_authority: true,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]));
    expect(listed.prompt_observation_block).toContain("capability_lane_session_results");
    expect(listed.prompt_observation_block).toContain('"action": "list"');
    expect(listed.prompt_observation_block).toContain("capability_lane_session_debug_summaries");
    expect(listed.prompt_observation_block).toContain("lane-session-provider-list");
    expect(listed.prompt_observation_block).toContain("session_lifecycle_action");
    expect(listed.prompt_observation_block).toContain("selected_runtime_provider_remains_root");
    expect(listed.prompt_observation_block).toContain("final_reports_require_terminal_authority");
  });

  it("packages goal-bound lane session calls for the selected runtime provider", async () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const context = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      sessionStore,
      body: {
        turn_id: "turn-provider-adapter-goal-binding",
        capability_lane_session_call: {
          action: "start",
          lane_id: "live_translation",
          lane_session_id: "lane-session-provider-goal",
          requested_backend_provider: "google_gemini",
          now_ms: 200,
          source_binding: {
            source_id: "document_markdown:docs/research/nhm2.md",
            source_kind: "docs",
            projection_target: "docs_chunk",
            account_locale: "es-US",
          },
        },
        capability_lane_goal_binding_call: {
          action: "bind",
          goal_binding_id: "goal-binding-provider-context",
          goal_id: "goal:account-language-translation",
          lane_session_id: "lane-session-provider-goal",
          activation_policy: "while_goal_active",
          attention_policy: "quiet_until_salient",
          stop_condition: "goal_complete",
          report_policy: "debug_only",
          quiet_behavior: "record_only",
          now_ms: 225,
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(context.calls_succeeded).toBe(true);
    expect(context.goal_bindings).toMatchObject({
      schema: "helix.capability_lane.goal_binding_runner_result.v1",
      requested: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(context.debug_projection.capability_lane_goal_binding_results).toEqual([
      expect.objectContaining({
        ok: true,
        blocked_reason: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(context.debug_projection.capability_lane_goal_binding_debug_summaries).toEqual([
      expect.objectContaining({
        schema: "helix.capability_lane.goal_binding_debug_summary.v1",
        goal_binding_id: "goal-binding-provider-context",
        goal_id: "goal:account-language-translation",
        lane_session_id: "lane-session-provider-goal",
        lane_id: "live_translation",
        selected_runtime_agent_provider: "codex",
        selected_backend_provider: "live_translation.local_runtime",
        binding_status: "bound",
        session_status: "running",
        session_health: "healthy",
        activation_policy: "while_goal_active",
        attention_policy: "quiet_until_salient",
        stop_condition: "goal_complete",
        report_policy: "debug_only",
        quiet_behavior: "record_only",
        backend_provider_becomes_root_agent: false,
        final_reports_require_terminal_authority: true,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(context.prompt_observation_block).toContain("capability_lane_goal_binding_results");
    expect(context.prompt_observation_block).toContain("capability_lane_goal_binding_debug_summaries");
    expect(context.prompt_observation_block).toContain("goal-binding-provider-context");
    expect(context.prompt_observation_block).toContain("goal:account-language-translation");
    expect(context.prompt_observation_block).toContain("backend_provider_becomes_root_agent");
    expect(context.prompt_observation_block).toContain("final_reports_require_terminal_authority");
    expect(context.prompt_observation_block).toContain('"answer_authority": false');
  });

  it("fails closed for malformed goal-bound lane calls without creating debug summaries", async () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const context = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      sessionStore,
      body: {
        turn_id: "turn-provider-adapter-malformed-goal-binding",
        capability_lane_goal_binding_call: [
          {
            action: "bind",
            goal_id: "goal:missing-session-id",
          },
          {
            action: "record_mail_loop",
            goal_binding_id: "goal-binding-missing-mail-loop",
          },
          {
            action: "record_report",
            goal_binding_id: "goal-binding-missing-report-ref",
          },
        ],
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(context.calls_succeeded).toBe(false);
    expect(context.goal_bindings).toMatchObject({
      schema: "helix.capability_lane.goal_binding_runner_result.v1",
      requested: true,
      goal_binding_debug_summaries: [],
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(context.debug_projection.capability_lane_goal_binding_results).toEqual([
      expect.objectContaining({
        ok: false,
        goal_binding: null,
        blocked_reason: "missing_lane_session_id",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        ok: false,
        goal_binding: null,
        blocked_reason: "missing_mail_loop_summary",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        ok: false,
        goal_binding: null,
        blocked_reason: "missing_report_ref",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(context.debug_projection.capability_lane_goal_binding_debug_summaries).toEqual([]);
    expect(context.debug_projection.capability_lane_turn_timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "lane_visible",
          lane_visible: true,
          lane_executed: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      ]),
    );
    expect(context.prompt_observation_block).toContain("missing_lane_session_id");
    expect(context.prompt_observation_block).toContain("missing_mail_loop_summary");
    expect(context.prompt_observation_block).toContain("missing_report_ref");
    expect(context.prompt_observation_block).not.toContain("goal_binding_debug_summary.v1");
  });

  it("packages goal-bound speech, translation, and voice lane sessions as one non-terminal workflow", async () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const goalBindingStore = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    const context = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      sessionStore,
      goalBindingStore,
      body: {
        turn_id: "turn-provider-adapter-audio-goal-composition",
        capability_lane_session_call: [
          {
            action: "start",
            lane_id: "speech_to_text",
            lane_session_id: "lane-session-audio-goal-stt",
            source_binding: {
              source_id: "microphone:desktop",
              source_kind: "audio",
              projection_target: "audio_chunk",
              account_locale: "en-US",
            },
            now_ms: 300,
          },
          {
            action: "record_observation",
            lane_session_id: "lane-session-audio-goal-stt",
            observation_ref: "ask:lane:stt:audio-goal-observation",
            receipt_ref: "stage_play_live_source_mail:audio-goal-stt",
            source_id: "microphone:desktop",
            source_kind: "audio",
            chunk_id: "audio-goal-chunk-0",
            chunk_index: 0,
            observed_at_ms: 325,
            freshness_status: "fresh",
            source_text_hash: "audio-goal-transcript-hash",
            source_text_char_count: 17,
            projection_target: "audio_chunk",
            now_ms: 325,
          },
          {
            action: "start",
            lane_id: "live_translation",
            lane_session_id: "lane-session-audio-goal-translation",
            source_binding: {
              source_id: "audio_transcript:helix-ask:desktop",
              source_kind: "audio",
              projection_target: "audio_chunk",
              account_locale: "en-US",
              target_language: "es",
            },
            now_ms: 330,
          },
          {
            action: "start",
            lane_id: "text_to_speech",
            lane_session_id: "lane-session-audio-goal-tts",
            source_binding: {
              source_id: "ask:lane:translation:audio-goal-observation",
              source_kind: "ask_turn",
              projection_target: "voice_playback",
              account_locale: "es-US",
            },
            now_ms: 335,
          },
        ],
        capability_lane_goal_binding_call: [
          {
            action: "bind",
            goal_binding_id: "goal-binding-audio-goal-stt",
            goal_id: "goal:audio-translation-playback",
            lane_session_id: "lane-session-audio-goal-stt",
            activation_policy: "while_goal_active",
            attention_policy: "quiet_until_salient",
            stop_condition: "goal_complete",
            report_policy: "debug_only",
            quiet_behavior: "record_only",
            now_ms: 340,
          },
          {
            action: "bind",
            goal_binding_id: "goal-binding-audio-goal-translation",
            goal_id: "goal:audio-translation-playback",
            lane_session_id: "lane-session-audio-goal-translation",
            activation_policy: "while_goal_active",
            attention_policy: "quiet_until_salient",
            stop_condition: "goal_complete",
            report_policy: "debug_only",
            quiet_behavior: "record_only",
            now_ms: 345,
          },
          {
            action: "bind",
            goal_binding_id: "goal-binding-audio-goal-tts",
            goal_id: "goal:audio-translation-playback",
            lane_session_id: "lane-session-audio-goal-tts",
            activation_policy: "while_goal_active",
            attention_policy: "quiet_until_salient",
            stop_condition: "goal_complete",
            report_policy: "debug_only",
            quiet_behavior: "record_only",
            now_ms: 350,
          },
        ],
      },
      env: { STT_LOCAL_URL: "http://127.0.0.1:9000" } as NodeJS.ProcessEnv,
    });

    const goalSummaries = context.debug_projection.capability_lane_goal_binding_debug_summaries;

    expect(context.calls_succeeded).toBe(true);
    expect(context.debug_projection.capability_lane_session_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          lane_id: "speech_to_text",
          session_supported: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        expect.objectContaining({
          ok: true,
          lane_id: "live_translation",
          session_supported: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        expect.objectContaining({
          ok: true,
          lane_id: "text_to_speech",
          session_supported: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      ]),
    );
    expect(goalSummaries.map((summary) => summary.lane_id)).toEqual([
      "speech_to_text",
      "live_translation",
      "text_to_speech",
    ]);
    expect(goalSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goal_id: "goal:audio-translation-playback",
          lane_session_id: "lane-session-audio-goal-stt",
          lane_id: "speech_to_text",
          selected_backend_provider: "speech_to_text.openai_compatible",
          last_observation_ref: "ask:lane:stt:audio-goal-observation",
          last_receipt_ref: "stage_play_live_source_mail:audio-goal-stt",
          latest_source_kind: "audio",
          latest_projection_target: "audio_chunk",
          source_text_hash: "audio-goal-transcript-hash",
          source_text_char_count: 17,
          final_reports_require_terminal_authority: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        expect.objectContaining({
          goal_id: "goal:audio-translation-playback",
          lane_session_id: "lane-session-audio-goal-translation",
          lane_id: "live_translation",
          source_id: "audio_transcript:helix-ask:desktop",
          target_language: "es",
          final_reports_require_terminal_authority: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        expect.objectContaining({
          goal_id: "goal:audio-translation-playback",
          lane_session_id: "lane-session-audio-goal-tts",
          lane_id: "text_to_speech",
          source_id: "ask:lane:translation:audio-goal-observation",
          source_projection_target: "voice_playback",
          final_reports_require_terminal_authority: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      ]),
    );
    expect(context.prompt_observation_block).toContain("goal:audio-translation-playback");
    expect(context.prompt_observation_block).toContain("speech_to_text");
    expect(context.prompt_observation_block).toContain("live_translation");
    expect(context.prompt_observation_block).toContain("text_to_speech");
    expect(context.prompt_observation_block).toContain("final_reports_require_terminal_authority");
  });

  it("packages goal-bound mail-loop evidence without terminal answer authority", async () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const goalBindingStore = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    const context = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      sessionStore,
      goalBindingStore,
      body: {
        turn_id: "turn-provider-adapter-goal-mail",
        capability_lane_session_call: [
          {
            action: "start",
            lane_id: "live_translation",
            lane_session_id: "lane-session-provider-goal-mail",
            requested_backend_provider: "google_gemini",
            now_ms: 200,
            source_binding: {
              source_id: "document_markdown:docs/research/nhm2.md",
              source_kind: "docs",
              projection_target: "docs_chunk",
              account_locale: "es-US",
            },
          },
          {
            action: "record_observation",
            lane_session_id: "lane-session-provider-goal-mail",
            observation_ref: "stage-play-mail-provider-goal",
            receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
            chunk_id: "chunk-provider-goal",
            chunk_index: 4,
            dedupe_key: "docs/research/nhm2.md:chunk-provider-goal:es",
            source_event_id: "docs/research/nhm2.md:event-provider-goal",
            source_event_ms: 240,
            observed_at_ms: 250,
            freshness_status: "fresh",
            projection_target: "docs_chunk",
            cancel_requested: false,
            now_ms: 250,
          },
        ],
        capability_lane_goal_binding_call: [
          {
            action: "bind",
            goal_binding_id: "goal-binding-provider-mail",
            goal_id: "goal:account-language-translation",
            lane_session_id: "lane-session-provider-goal-mail",
            activation_policy: "while_goal_active",
            attention_policy: "quiet_until_salient",
            stop_condition: "goal_complete",
            report_policy: "ask_on_salience",
            quiet_behavior: "wake_on_salience",
            now_ms: 260,
          },
          {
            action: "record_mail_loop",
            goal_binding_id: "goal-binding-provider-mail",
            mail_loop_summary: mailLoopSummary(),
            now_ms: 270,
          },
        ],
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(context.calls_succeeded).toBe(true);
    expect(context.debug_projection.capability_lane_goal_binding_results).toEqual([
      expect.objectContaining({ ok: true, blocked_reason: null }),
      expect.objectContaining({
        ok: true,
        blocked_reason: null,
        goal_binding: expect.objectContaining({
          goal_binding_id: "goal-binding-provider-mail",
          latest_mail_loop_summary: expect.objectContaining({
            schema: "helix.capability_lane.mail_loop_debug_summary.v1",
            lane_session_id: "lane-session-provider-goal-mail",
            stage_play_mail_id: "stage-play-mail-provider-goal",
            observation_ref: "ask:lane:translation:mail-obs",
            receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
            target_language: "es",
            terminal_authority_status: "pending_helix_terminal_authority",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          }),
          lane_session_mail_loop_refs: ["stage-play-mail-provider-goal"],
          last_report_ref: null,
          backend_provider_becomes_root_agent: false,
          final_reports_require_terminal_authority: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      }),
    ]);
    expect(context.debug_projection.capability_lane_mail_loop_debug_summaries).toEqual([
      expect.objectContaining({
        schema: "helix.capability_lane.mail_loop_debug_summary.v1",
        lane_session_id: "lane-session-provider-goal-mail",
        lane_id: "live_translation",
        stage_play_mail_id: "stage-play-mail-provider-goal",
        observation_ref: "ask:lane:translation:mail-obs",
        receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
        target_language: "es",
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(context.debug_projection.capability_lane_goal_binding_debug_summaries).toHaveLength(2);
    expect(context.debug_projection.capability_lane_goal_binding_debug_summaries.at(-1)).toEqual(
      expect.objectContaining({
        goal_binding_id: "goal-binding-provider-mail",
        latest_mail_loop_summary: expect.objectContaining({
          stage_play_mail_id: "stage-play-mail-provider-goal",
          target_language: "es",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        mail_loop_refs: ["stage-play-mail-provider-goal"],
        report_decision: expect.objectContaining({
          action: "wake_on_salience",
          mail_loop_ref: "stage-play-mail-provider-goal",
          receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
          wake_expected: true,
          terminal_report_requested: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        dispatch_plan: expect.objectContaining({
          target: "ask_wake",
          mail_loop_ref: "stage-play-mail-provider-goal",
          target_language: "es",
          requires_live_mail_loop: true,
          side_effects_executed: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        dispatch_admission: expect.objectContaining({
          status: "eligible_waiting_for_mail_loop",
          target: "ask_wake",
          mail_loop_ref: "stage-play-mail-provider-goal",
          target_language: "es",
          wake_dispatch_allowed: false,
          side_effects_executed: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        final_reports_require_terminal_authority: true,
      }),
    );
    expect(context.debug_projection.capability_lane_goal_dispatch_plans).toEqual([
      expect.objectContaining({
        schema: "helix.capability_lane.goal_dispatch_plan.v1",
        target: "ask_wake",
        status: "planned_not_dispatched",
        goal_binding_id: "goal-binding-provider-mail",
        goal_id: "goal:account-language-translation",
        lane_session_id: "lane-session-provider-goal-mail",
        lane_id: "live_translation",
        evidence_ref: "stage-play-mail-provider-goal",
        mail_loop_ref: null,
        receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
        requires_live_mail_loop: true,
        wake_dispatched: false,
        side_effects_executed: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        schema: "helix.capability_lane.goal_dispatch_plan.v1",
        target: "ask_wake",
        status: "planned_not_dispatched",
        goal_binding_id: "goal-binding-provider-mail",
        mail_loop_ref: "stage-play-mail-provider-goal",
      }),
    ]);
    expect(context.debug_projection.capability_lane_goal_dispatch_admissions).toEqual([
      expect.objectContaining({
        schema: "helix.capability_lane.goal_dispatch_admission.v1",
        status: "blocked",
        target: "ask_wake",
        goal_binding_id: "goal-binding-provider-mail",
        goal_id: "goal:account-language-translation",
        lane_session_id: "lane-session-provider-goal-mail",
        lane_id: "live_translation",
        evidence_ref: "stage-play-mail-provider-goal",
        mail_loop_ref: null,
        receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
        blocked_reason: "missing_mail_loop_ref",
        wake_dispatch_allowed: false,
        side_effects_allowed: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        schema: "helix.capability_lane.goal_dispatch_admission.v1",
        status: "eligible_waiting_for_mail_loop",
        target: "ask_wake",
        goal_binding_id: "goal-binding-provider-mail",
        mail_loop_ref: "stage-play-mail-provider-goal",
      }),
    ]);
    expect(context.debug_projection.capability_lane_goal_dispatch_readiness).toMatchObject({
      schema: "helix.capability_lane.goal_dispatch_readiness.v1",
      total_plans: 2,
      total_admissions: 2,
      admitted_count: 1,
      blocked_count: 1,
      pending_wake_count: 1,
      blocked_reasons: ["missing_mail_loop_ref"],
      next_lane_ids: ["live_translation"],
      next_goal_binding_ids: ["goal-binding-provider-mail"],
      next_lane_session_ids: ["lane-session-provider-goal-mail"],
      next_runtime_agent_providers: ["codex"],
      next_selected_backend_providers: ["live_translation.local_runtime"],
      next_fallback_backend_providers: [],
      next_backend_selection_reasons: ["requested_backend_unconfigured_default_backend_selected_by_helix_policy"],
      next_cost_classes: ["free_local"],
      next_latency_classes: ["interactive"],
      next_privacy_classes: ["local_only"],
      next_evidence_refs: ["stage-play-mail-provider-goal"],
      next_receipt_refs: ["ask:lane:translation:mail-obs:projection:receipt"],
      wake_dispatch_allowed: false,
      side_effects_allowed: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(context.capability_lane_turn_timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "lane_mail_loop",
        selected_runtime_agent_provider: "codex",
        lane_id: "live_translation",
        capability_id: "live_translation.translate_text",
        status: "created",
        lane_visible: false,
        lane_requested: true,
        lane_executed: true,
        observation_reentered: true,
        selected_backend_provider: "live_translation.local_runtime",
        observation_ref: "ask:lane:translation:mail-obs",
        receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
        latest_event_id: "stage-play-mail-provider-goal",
        lifecycle_action: "mail_loop",
        session_lifecycle_action: "mail_loop",
        session_action: "mail_loop",
        session_control_key:
          "lane-session-provider-goal-mail::document_markdown:docs/research/nhm2.md::docs_chunk::es",
        source_binding_key: "document_markdown:docs/research/nhm2.md::docs_chunk::es",
        source_identity_key:
          "document_markdown:docs/research/nhm2.md::fnv1a32:mail-doc::fnv1a32:mail-source-text::6144::document_markdown::docs_chunk::es-US::es",
        latest_source_identity_key:
          "document_markdown:docs/research/nhm2.md::fnv1a32:mail-doc::fnv1a32:mail-source-text-latest::2048::document_markdown::docs_chunk::es-US::es",
        latest_observation_key:
          "document_markdown:docs/research/nhm2.md::docs_chunk::es::chunk-provider-goal::ask:lane:translation:mail-obs:projection:receipt",
        has_observation: true,
        source_id: "document_markdown:docs/research/nhm2.md",
        source_kind: "document_markdown",
        source_projection_target: "docs_chunk",
        latest_chunk_id: "chunk-provider-goal",
        latest_chunk_index: 4,
        latest_source_id: "document_markdown:docs/research/nhm2.md",
        latest_source_kind: "document_markdown",
        latest_target_language: "es",
        latest_dedupe_key: "docs/research/nhm2.md:chunk-provider-goal:es",
        latest_source_event_id: "docs/research/nhm2.md:event-provider-goal",
        latest_source_event_ms: 240,
        latest_observed_at_ms: 250,
        latest_freshness_status: "fresh",
        latest_projection_target: "docs_chunk",
        target_language: "es",
        latest_cancel_requested: false,
        latest_mail_loop_wake_kind: "mailbox_wake",
        report_action: "mailbox_wake",
        report_reason: "created",
        report_summary_text: "lane mail loop materialized observation evidence",
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        stage: "goal_binding",
        selected_runtime_agent_provider: "codex",
        lane_id: "live_translation",
        status: "bound",
        lane_visible: false,
        lane_requested: true,
        lane_executed: true,
        observation_reentered: true,
        selected_backend_provider: "live_translation.local_runtime",
        observation_ref: "stage-play-mail-provider-goal",
        receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
        latest_event_id: "lane-session-provider-goal-mail:record_observation:250",
        has_observation: true,
        source_id: "document_markdown:docs/research/nhm2.md",
        source_kind: "document_markdown",
        source_projection_target: "docs_chunk",
        account_locale: "es-US",
        latest_chunk_id: "chunk-provider-goal",
        latest_chunk_index: 4,
        latest_source_id: "document_markdown:docs/research/nhm2.md",
        latest_source_kind: "document_markdown",
        latest_dedupe_key: "docs/research/nhm2.md:chunk-provider-goal:es",
        latest_source_event_id: "docs/research/nhm2.md:event-provider-goal",
        latest_source_event_ms: 240,
        latest_observed_at_ms: 250,
        latest_freshness_status: "fresh",
        latest_projection_target: "docs_chunk",
        target_language: "es",
        latest_cancel_requested: false,
        latest_mail_loop_wake_kind: "mailbox_wake",
        report_action: "wake_on_salience",
        report_reason: "goal_binding_policy_requests_wake_on_salience",
        report_summary_text: expect.stringContaining("goal lane wake on salience"),
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        stage: "lane_goal_dispatch_plan",
        selected_runtime_agent_provider: "codex",
        lane_id: "live_translation",
        status: "planned_not_dispatched",
        lane_visible: false,
        lane_requested: true,
        lane_executed: false,
        observation_reentered: false,
        selected_backend_provider: "live_translation.local_runtime",
        fallback_backend_provider: null,
        selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
        cost_class: "free_local",
        latency_class: "interactive",
        privacy_class: "local_only",
        observation_ref: "stage-play-mail-provider-goal",
        receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
        goal_id: "goal:account-language-translation",
        goal_binding_id: "goal-binding-provider-mail",
        lane_session_id: "lane-session-provider-goal-mail",
        mail_loop_ref: null,
        dispatch_target: "ask_wake",
        materialized_mail_loop_evidence: false,
        wake_dispatch_allowed: false,
        side_effects_allowed: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        stage: "lane_goal_dispatch_admission",
        selected_runtime_agent_provider: "codex",
        lane_id: "live_translation",
        status: "blocked",
        selected_backend_provider: "live_translation.local_runtime",
        fallback_backend_provider: null,
        selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
        cost_class: "free_local",
        latency_class: "interactive",
        privacy_class: "local_only",
        observation_ref: "stage-play-mail-provider-goal",
        receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
        goal_id: "goal:account-language-translation",
        goal_binding_id: "goal-binding-provider-mail",
        lane_session_id: "lane-session-provider-goal-mail",
        mail_loop_ref: null,
        dispatch_target: "ask_wake",
        dispatch_admission_status: "blocked",
        dispatch_blocked_reason: "missing_mail_loop_ref",
        materialized_mail_loop_evidence: false,
        wake_dispatch_allowed: false,
        side_effects_allowed: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        stage: "lane_goal_dispatch_readiness",
        selected_runtime_agent_provider: "codex",
        lane_id: "live_translation",
        status: "partial",
        lane_requested: true,
        selected_backend_provider: "live_translation.local_runtime",
        fallback_backend_provider: null,
        selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
        cost_class: "free_local",
        latency_class: "interactive",
        privacy_class: "local_only",
        observation_ref: "stage-play-mail-provider-goal",
        receipt_ref: "ask:lane:translation:mail-obs:projection:receipt",
        goal_binding_id: "goal-binding-provider-mail",
        lane_session_id: "lane-session-provider-goal-mail",
        dispatch_target: "ask_wake",
        dispatch_admission_status: "partial",
        dispatch_blocked_reason: "missing_mail_loop_ref",
        materialized_mail_loop_evidence: true,
        wake_dispatch_allowed: false,
        side_effects_allowed: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]));
    expect(context.prompt_observation_block).toContain("stage-play-mail-provider-goal");
    expect(context.prompt_observation_block).toContain("capability_lane_mail_loop_debug_summaries");
    expect(context.prompt_observation_block).toContain("capability_lane_goal_dispatch_plans");
    expect(context.prompt_observation_block).toContain("capability_lane_goal_dispatch_admissions");
    expect(context.prompt_observation_block).toContain("capability_lane_goal_dispatch_readiness");
    expect(context.prompt_observation_block).toContain("lane_goal_dispatch_readiness");
    expect(context.prompt_observation_block).toContain("next_selected_backend_providers");
    expect(context.prompt_observation_block).toContain("wake_on_salience");
    expect(context.prompt_observation_block).toContain("eligible_waiting_for_mail_loop");
  });

  it("normalizes hostile goal-bound mail-loop payloads back to non-terminal evidence", async () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const goalBindingStore = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    const hostileMailLoopSummary = {
      ...mailLoopSummary({
        lane_session_id: "lane-session-provider-hostile-mail",
        stage_play_mail_id: "stage-play-mail-provider-hostile",
        observation_ref: "ask:lane:translation:hostile-mail-obs",
      }),
      terminal_authority_status: "terminal_authority_granted",
      terminal_eligible: true,
      assistant_answer: true,
      raw_content_included: true,
      backend_selection_decision: {
        ...backendDecision,
        terminal_eligible: true,
        assistant_answer: true,
        raw_content_included: true,
      },
    };

    const context = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      sessionStore,
      goalBindingStore,
      body: {
        turn_id: "turn-provider-adapter-hostile-goal-mail",
        capability_lane_session_call: [
          {
            action: "start",
            lane_id: "live_translation",
            lane_session_id: "lane-session-provider-hostile-mail",
            requested_backend_provider: "google_gemini",
            now_ms: 200,
            source_binding: {
              source_id: "document_markdown:docs/research/nhm2.md",
              source_kind: "docs",
              projection_target: "docs_chunk",
              account_locale: "es-US",
            },
          },
          {
            action: "record_observation",
            lane_session_id: "lane-session-provider-hostile-mail",
            observation_ref: "ask:lane:translation:hostile-mail-obs",
            receipt_ref: "ask:lane:translation:hostile-mail-obs:projection:receipt",
            chunk_id: "chunk-provider-hostile",
            chunk_index: 5,
            dedupe_key: "docs/research/nhm2.md:chunk-provider-hostile:es",
            source_event_id: "docs/research/nhm2.md:event-provider-hostile",
            source_event_ms: 240,
            observed_at_ms: 250,
            freshness_status: "fresh",
            projection_target: "docs_chunk",
            cancel_requested: false,
            now_ms: 250,
          },
        ],
        capability_lane_goal_binding_call: [
          {
            action: "bind",
            goal_binding_id: "goal-binding-provider-hostile-mail",
            goal_id: "goal:hostile-mail-normalization",
            lane_session_id: "lane-session-provider-hostile-mail",
            report_policy: "ask_on_salience",
            quiet_behavior: "wake_on_salience",
            now_ms: 260,
          },
          {
            action: "record_mail_loop",
            goal_binding_id: "goal-binding-provider-hostile-mail",
            mail_loop_summary: hostileMailLoopSummary,
            now_ms: 270,
          },
        ],
      },
      env: {} as NodeJS.ProcessEnv,
    });

    const latestSummary = context.debug_projection.capability_lane_goal_binding_debug_summaries.at(-1);

    expect(context.calls_succeeded).toBe(true);
    expect(latestSummary).toEqual(
      expect.objectContaining({
        goal_binding_id: "goal-binding-provider-hostile-mail",
        latest_mail_loop_summary: expect.objectContaining({
          stage_play_mail_id: "stage-play-mail-provider-hostile",
          observation_ref: "ask:lane:translation:hostile-mail-obs",
          terminal_authority_status: "not_terminal_authority",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          backend_selection_decision: expect.objectContaining({
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          }),
        }),
        report_decision: expect.objectContaining({
          terminal_report_requested: false,
          terminal_report_requires_authority: true,
          terminal_authority_status: "not_terminal_authority",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        dispatch_plan: expect.objectContaining({
          target: "ask_wake",
          side_effects_executed: false,
          terminal_report_emitted: false,
          terminal_authority_status: "not_terminal_authority",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
        backend_provider_becomes_root_agent: false,
        final_reports_require_terminal_authority: true,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(context.prompt_observation_block).toContain("stage-play-mail-provider-hostile");
    expect(context.prompt_observation_block).toContain('"assistant_answer": false');
    expect(context.prompt_observation_block).toContain('"terminal_eligible": false');
    expect(context.prompt_observation_block).not.toContain("terminal_authority_granted");
  });

  it("shows receipt-only mail-loop packets as executed non-terminal evidence", async () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const goalBindingStore = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    const receiptOnlyMailLoopSummary = mailLoopSummary({
      observation_ref: null,
      receipt_ref: "ask:lane:translation:mail-receipt-only:projection:receipt",
      mail_loop_observation_key: "mail-loop:receipt-only:key",
      stage_play_mail_delivery_status: "created",
      materialized_mail_loop_evidence: false,
      evidence_refs: [
        "lane-session-provider-goal-mail",
        "stage-play-mail-provider-goal",
        "ask:lane:translation:mail-receipt-only:projection:receipt",
      ],
    });

    const context = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      sessionStore,
      goalBindingStore,
      body: {
        turn_id: "turn-provider-adapter-receipt-only-mail",
        capability_lane_session_call: [
          {
            action: "start",
            lane_id: "live_translation",
            lane_session_id: "lane-session-provider-goal-mail",
            requested_backend_provider: "google_gemini",
            now_ms: 200,
            source_binding: {
              source_id: "document_markdown:docs/research/nhm2.md",
              source_kind: "docs",
              projection_target: "docs_chunk",
              account_locale: "es-US",
            },
          },
        ],
        capability_lane_goal_binding_call: [
          {
            action: "bind",
            goal_binding_id: "goal-binding-provider-mail",
            goal_id: "goal:account-language-translation",
            lane_session_id: "lane-session-provider-goal-mail",
            activation_policy: "while_goal_active",
            attention_policy: "quiet_until_salient",
            stop_condition: "goal_complete",
            report_policy: "ask_on_salience",
            quiet_behavior: "wake_on_salience",
            now_ms: 260,
          },
          {
            action: "record_mail_loop",
            goal_binding_id: "goal-binding-provider-mail",
            mail_loop_summary: receiptOnlyMailLoopSummary,
            now_ms: 270,
          },
        ],
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(context.capability_lane_turn_timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "lane_mail_loop",
        selected_runtime_agent_provider: "codex",
        lane_id: "live_translation",
        capability_id: "live_translation.translate_text",
        status: "created",
        lane_executed: true,
        observation_reentered: true,
        observation_ref: null,
        receipt_ref: "ask:lane:translation:mail-receipt-only:projection:receipt",
        latest_receipt_ref: "ask:lane:translation:mail-receipt-only:projection:receipt",
        latest_observation_key: "mail-loop:receipt-only:key",
        has_observation: true,
        report_summary_text: "lane mail loop materialized observation evidence",
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      expect.objectContaining({
        stage: "goal_binding",
        selected_runtime_agent_provider: "codex",
        lane_id: "live_translation",
        status: "bound",
        lane_requested: true,
        lane_executed: true,
        observation_reentered: true,
        observation_ref: null,
        receipt_ref: "ask:lane:translation:mail-receipt-only:projection:receipt",
        latest_observation_key: "mail-loop:receipt-only:key",
        has_observation: true,
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]));
  });

  it("uses the current mail-loop receipt in goal-binding timeline rows when session last receipt is stale", async () => {
    const sessionStore = createHelixCapabilityLaneSessionStore();
    const goalBindingStore = createHelixCapabilityLaneGoalBindingStore({ sessionStore });
    const currentMailLoopSummary = mailLoopSummary({
      observation_ref: "ask:lane:translation:current-mail-obs",
      receipt_ref: "ask:lane:translation:current-mail-obs:projection:receipt",
      stage_play_mail_id: "stage-play-mail-current-receipt",
      mail_loop_observation_key: "mail-loop:current-receipt:key",
      evidence_refs: [
        "lane-session-provider-goal-mail",
        "stage-play-mail-current-receipt",
        "ask:lane:translation:current-mail-obs:projection:receipt",
      ],
    });

    const context = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      sessionStore,
      goalBindingStore,
      body: {
        turn_id: "turn-provider-adapter-stale-session-receipt",
        capability_lane_session_call: [
          {
            action: "start",
            lane_id: "live_translation",
            lane_session_id: "lane-session-provider-goal-mail",
            requested_backend_provider: "google_gemini",
            now_ms: 200,
            source_binding: {
              source_id: "document_markdown:docs/research/nhm2.md",
              source_kind: "docs",
              projection_target: "docs_chunk",
              account_locale: "es-US",
            },
          },
          {
            action: "record_observation",
            lane_session_id: "lane-session-provider-goal-mail",
            observation_ref: "ask:lane:translation:previous-session-obs",
            receipt_ref: "ask:lane:translation:previous-session-obs:projection:receipt",
            chunk_id: "chunk-previous",
            chunk_index: 1,
            observed_at_ms: 210,
            freshness_status: "stale",
            now_ms: 210,
          },
        ],
        capability_lane_goal_binding_call: [
          {
            action: "bind",
            goal_binding_id: "goal-binding-provider-mail",
            goal_id: "goal:account-language-translation",
            lane_session_id: "lane-session-provider-goal-mail",
            activation_policy: "while_goal_active",
            attention_policy: "quiet_until_salient",
            stop_condition: "goal_complete",
            report_policy: "ask_on_salience",
            quiet_behavior: "wake_on_salience",
            now_ms: 260,
          },
          {
            action: "record_mail_loop",
            goal_binding_id: "goal-binding-provider-mail",
            mail_loop_summary: currentMailLoopSummary,
            now_ms: 270,
          },
        ],
      },
      env: {} as NodeJS.ProcessEnv,
    });

    const goalBindingRow = context.capability_lane_turn_timeline
      .filter((row) => row.stage === "goal_binding" && row.goal_binding_id === "goal-binding-provider-mail")
      .at(-1);
    const latestGoalSummary = context.debug_projection.capability_lane_goal_binding_debug_summaries.at(-1);

    expect(latestGoalSummary).toEqual(expect.objectContaining({
      goal_binding_id: "goal-binding-provider-mail",
      last_receipt_ref: "ask:lane:translation:current-mail-obs:projection:receipt",
      report_decision: expect.objectContaining({
        receipt_ref: "ask:lane:translation:current-mail-obs:projection:receipt",
      }),
      dispatch_plan: expect.objectContaining({
        receipt_ref: "ask:lane:translation:current-mail-obs:projection:receipt",
      }),
    }));
    expect(goalBindingRow).toEqual(expect.objectContaining({
      receipt_ref: "ask:lane:translation:current-mail-obs:projection:receipt",
      latest_receipt_ref: "ask:lane:translation:current-mail-obs:projection:receipt",
    }));
    expect(goalBindingRow?.receipt_ref).not.toBe("ask:lane:translation:previous-session-obs:projection:receipt");
  });

  it("exposes projection receipts at the provider adapter edge without answer authority", async () => {
    const context = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-adapter-translation-receipt",
        capability_lane_call: {
          capability: "live_translation.translate_text",
          text: "thank you",
          source_language: "en",
          target_language: "fr",
          source_id: "docs:nhm2",
          chunk_id: "chunk-11",
          chunk_index: 11,
          dedupe_key: "docs:nhm2:chunk-11:fr",
          source_identity_key:
            "docs:nhm2::fnv1a32:provider-adapter-doc::sha256:provider-adapter-source::9::docs::docs_chunk::es-US::fr",
          source_event_ms: 1,
          projection_target: "docs_chunk",
          requested_backend_provider: "google_gemini",
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    const receipt = context.projection_receipts[0];
    const receiptPayload = receipt?.payload as Record<string, unknown> | undefined;
    expect(context.calls_succeeded).toBe(true);
    expect(context.projection_receipts).toHaveLength(1);
    expect(receipt).toMatchObject({
      schema: "helix.capability_lane.provider_adapter_receipt.v1",
      kind: "live_translation_projection",
      status: "stale",
      turn_id: "turn-provider-adapter-translation-receipt",
      capability_key: "live_translation.translate_text",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(receipt?.receipt_ref).toContain(`${receipt?.observation_ref}:projection:`);
    expect(receipt?.payload).toMatchObject({
      schema: "helix.live_translation.projection_receipt.v1",
      lane_id: "live_translation",
      capability: "live_translation.translate_text",
      projection_key: expect.any(String),
      projection_target: "docs_chunk",
      projection_status: "stale",
      source_id: "docs:nhm2",
      source_identity_key:
        "docs:nhm2::fnv1a32:provider-adapter-doc::sha256:provider-adapter-source::9::docs::docs_chunk::es-US::fr",
      chunk_id: "chunk-11",
      chunk_index: 11,
      dedupe_key: "docs:nhm2:chunk-11:fr",
      source_event_ms: 1,
      target_language: "fr",
      source_text_hash: expect.any(String),
      source_text_char_count: "thank you".length,
      translated_text: "merci",
      stale: true,
      cancel_requested: false,
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(context.one_shot.resolve_traces[0]?.receipt_ref).toBe(receipt?.receipt_ref);
    expect(String(receiptPayload?.projection_key ?? "")).toContain(receipt?.receipt_ref ?? "");
    expect(context.one_shot.backend_selections[0]?.receipt_ref).toBe(receipt?.receipt_ref);
    expect(context.one_shot.debug_events[2]?.receipt_ref).toBe(receipt?.receipt_ref);
    expect(context.debug_projection.capability_lane_projection_receipts).toEqual([
      expect.objectContaining({
        receipt_ref: receipt?.receipt_ref,
        observation_ref: receipt?.observation_ref,
        capability_key: "live_translation.translate_text",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(context.capability_lane_turn_timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "lane_projection_receipt",
        selected_runtime_agent_provider: "codex",
        lane_id: "live_translation",
        capability_id: "live_translation.translate_text",
        status: "stale",
        lane_visible: false,
        lane_requested: true,
        lane_executed: true,
        observation_reentered: false,
        observation_ref: receipt?.observation_ref,
        receipt_ref: receipt?.receipt_ref,
        source_id: "docs:nhm2",
        source_identity_key:
          "docs:nhm2::fnv1a32:provider-adapter-doc::sha256:provider-adapter-source::9::docs::docs_chunk::es-US::fr",
        latest_source_identity_key:
          "docs:nhm2::fnv1a32:provider-adapter-doc::sha256:provider-adapter-source::9::docs::docs_chunk::es-US::fr",
        latest_chunk_id: "chunk-11",
        latest_chunk_index: 11,
        latest_target_language: "fr",
        latest_dedupe_key: "docs:nhm2:chunk-11:fr",
        latest_source_event_ms: 1,
        latest_freshness_status: "stale",
        source_text_hash: expect.any(String),
        source_text_char_count: "thank you".length,
        latest_projection_target: "docs_chunk",
        target_language: "fr",
        latest_cancel_requested: false,
        terminal_authority_status: "not_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]));
    expect(context.prompt_observation_block).toContain("capability_lane_projection_receipts");
    expect(context.prompt_observation_block).toContain("lane_projection_receipt");
    expect(context.prompt_observation_block).toContain(receipt?.receipt_ref ?? "");
    expect(context.prompt_observation_block).toContain(
      "docs:nhm2::fnv1a32:provider-adapter-doc::sha256:provider-adapter-source::9::docs::docs_chunk::es-US::fr",
    );
    expect(context.prompt_observation_block).toContain("live_translation_projection");
  });

  it("exposes shadow future-lane packets and backend selections to the runtime provider context", async () => {
    const context = await buildHelixCapabilityLaneProviderAdapterContext({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-adapter-shadow-lane",
        capability_lane_call: {
          capability: "visual_analysis.inspect_frame",
          requested_backend_provider: "openai_compatible",
          frame_ref: "frame:test",
        },
      },
      env: {
        OPENAI_API_KEY: "test-openai",
      } as NodeJS.ProcessEnv,
    });

    expect(context.calls_succeeded).toBe(false);
    expect(context.projection_receipts).toEqual([]);
    expect(context.one_shot.call_results[0]).toMatchObject({
      schema: "helix.capability_lane.shadow_one_shot_result.v1",
      ok: false,
      lane_id: "visual_analysis",
      capability: "visual_analysis.inspect_frame",
      error: "capability_lane_shadow_only_not_executed",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(context.observation_packets[0]).toMatchObject({
      capability_key: "visual_analysis.inspect_frame",
      status: "blocked",
      backend_selection_decision: expect.objectContaining({
        outcome: "requested_selected",
        requested_backend_provider: "openai_compatible",
        selected_backend_provider: "visual_analysis.openai_compatible",
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        terminal_authority_owner: "helix",
      }),
      state_delta: {
        capability_lane_shadow_execution: expect.objectContaining({
          lane_id: "visual_analysis",
          capability: "visual_analysis.inspect_frame",
          requested_backend_provider: "openai_compatible",
          selected_backend_provider: "visual_analysis.openai_compatible",
          availability_status: "dry_run",
          permission_status: "admitted",
          cost_class: "standard",
          latency_class: "interactive",
          privacy_class: "external_provider",
          execution_status: "not_executed_shadow_only",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(context.artifact_ledger[0]).toMatchObject({
      schema: "helix.current_turn_artifact.v1",
      kind: "capability_lane_observation_packet",
      observation_kind: "visual_analysis.inspect_frame",
      capability_key: "visual_analysis.inspect_frame",
      lane_id: "visual_analysis",
      selected_backend_provider: "visual_analysis.openai_compatible",
      lane_execution_status: "not_executed_shadow_only",
      lane_availability_status: "dry_run",
      lane_permission_status: "admitted",
      lane_cost_class: "standard",
      lane_latency_class: "interactive",
      lane_privacy_class: "external_provider",
      backend_selection_decision: expect.objectContaining({
        outcome: "requested_selected",
        selected_backend_provider: "visual_analysis.openai_compatible",
        backend_provider_becomes_root_agent: false,
        terminal_authority_owner: "helix",
      }),
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(context.prompt_observation_block).toContain("capability_lane_observation_packets");
    expect(context.prompt_observation_block).toContain("capability_lane_backend_selections");
    expect(context.prompt_observation_block).toContain("visual_analysis.inspect_frame");
    expect(context.prompt_observation_block).toContain("visual_analysis.openai_compatible");
    expect(context.prompt_observation_block).toContain("capability_lane_shadow_only_not_executed");
    expect(context.prompt_observation_block).toContain("not_executed_shadow_only");
    expect(context.prompt_observation_block).toContain("observation_packet_required_for_provider_reentry");
  });
});
