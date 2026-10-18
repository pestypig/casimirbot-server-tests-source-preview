import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HELIX_LIVE_TRANSLATION_ONE_SHOT_REQUEST_SCHEMA,
  type HelixLiveTranslationOneShotRequest,
} from "@shared/helix-live-translation-lane";
import type { HelixAgentProvider } from "../../agent-providers/types";
import { runLiveTranslationTranslateText } from "../live-translation";

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

const request = (input: Partial<HelixLiveTranslationOneShotRequest>): HelixLiveTranslationOneShotRequest => ({
  schema: HELIX_LIVE_TRANSLATION_ONE_SHOT_REQUEST_SCHEMA,
  capability: "live_translation.translate_text",
  text: "hello",
  source_language: "en",
  target_language: "es",
  requested_backend_provider: null,
  assistant_answer: false,
  terminal_eligible: false,
  ...input,
});

describe("live_translation.translate_text one-shot lane", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a deterministic translation observation and non-terminal observation packet", async () => {
    const result = await runLiveTranslationTranslateText({
      provider: buildProvider("codex"),
      request: request({ requested_backend_provider: "google_gemini" }),
      turnId: "turn-translation",
      iteration: 2,
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      schema: "helix.live_translation.one_shot_result.v1",
      ok: true,
      lane_id: "live_translation",
      capability: "live_translation.translate_text",
      selected_runtime_agent_provider: "codex",
      translated_text: "hola",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.lane_resolve_trace).toMatchObject({
      requested_lane: "live_translation",
      admission_status: "admitted_shadow_only",
      lane_status: "dry_run",
      requested_backend_provider: "google_gemini",
      requested_backend_provider_known: true,
      requested_backend_configuration_status: "missing",
      requested_backend_availability_status: "unconfigured",
      requested_backend_permission_status: "configuration_missing",
      requested_backend_cost_class: "standard",
      requested_backend_latency_class: "realtime",
      requested_backend_privacy_class: "external_provider",
      requested_backend_fallback_provider: "live_translation.local_runtime",
      selected_backend_provider: "live_translation.local_runtime",
      selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
      availability_status: "dry_run",
      permission_status: "admitted",
      cost_class: "free_local",
      latency_class: "interactive",
      privacy_class: "local_only",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.lane_resolve_trace.observation_ref).toBe(result.observation?.observation_ref);
    expect(result.observation).toMatchObject({
      schema: "helix.live_translation.observation.v1",
      lane_id: "live_translation",
      capability: "live_translation.translate_text",
      selected_runtime_agent_provider: "codex",
      requested_backend_provider: "google_gemini",
      selected_backend_provider: "live_translation.local_runtime",
      backend_selection_decision: expect.objectContaining({
        outcome: "fallback_selected",
        selected_backend_provider: "live_translation.local_runtime",
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        dynamic_switching_executed: false,
        live_backend_execution_enabled: false,
        terminal_authority_owner: "helix",
      }),
      lane_session_id: null,
      source_language: "en",
      target_language: "es",
      translated_text: "hola",
      deterministic: true,
      reentry_required: true,
      terminal_authority_status: "pending_helix_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.source_text_hash).toBeTruthy();
    expect(result.observation).not.toHaveProperty("source_text");
    expect(result.observation_packet).toMatchObject({
      schema: "helix.agent_step_observation_packet.v1",
      turn_id: "turn-translation",
      iteration: 2,
      capability_key: "live_translation.translate_text",
      panel_id: "capability_lane",
      action: "translate_text",
      status: "succeeded",
      observation_summary: "Translation observation ready for en -> es.",
      backend_selection_decision: expect.objectContaining({
        outcome: "fallback_selected",
        selected_backend_provider: "live_translation.local_runtime",
        terminal_authority_owner: "helix",
      }),
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet.produced_artifact_refs).toEqual(result.artifact_refs);
  });

  it("executes the OpenAI-compatible backend only when Helix selects live external translation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({ translated_text: "bonjour" }),
          },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const result = await runLiveTranslationTranslateText({
      provider: buildProvider("codex"),
      request: request({
        text: "hello",
        source_language: "en",
        target_language: "fr",
        requested_backend_provider: "live_translation.openai_compatible",
      }),
      turnId: "turn-translation-openai-compatible",
      iteration: 1,
      env: {
        OPENAI_API_KEY: "test-key",
        LLM_HTTP_BASE: "https://translation-provider.test",
        LLM_HTTP_MODEL: "translation-test-model",
        HELIX_LIVE_TRANSLATION_EXTERNAL_BACKENDS_ENABLED: "1",
      } as NodeJS.ProcessEnv,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://translation-provider.test/v1/chat/completions");
    expect(init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer test-key",
      }),
    });
    expect(JSON.stringify(init)).not.toContain("do-not-leak");
    expect(result).toMatchObject({
      ok: true,
      translated_text: "bonjour",
      selected_runtime_agent_provider: "codex",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.lane_resolve_trace).toMatchObject({
      requested_backend_provider: "live_translation.openai_compatible",
      selected_backend_provider: "live_translation.openai_compatible",
      execution_status: "executed_observation_only",
      backend_selection_decision: expect.objectContaining({
        outcome: "requested_selected",
        live_backend_execution_enabled: true,
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        terminal_authority_owner: "helix",
      }),
    });
    expect(result.observation).toMatchObject({
      selected_backend_provider: "live_translation.openai_compatible",
      translated_text: "bonjour",
      deterministic: false,
      reentry_required: true,
      terminal_authority_status: "pending_helix_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("defaults unqualified translation requests to the configured OpenAI-compatible backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              translated_text: "El equipo de navegacion esta listo para la proxima ventana de encendido.",
            }),
          },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const result = await runLiveTranslationTranslateText({
      provider: buildProvider("codex"),
      request: request({
        text: "The navigation team is ready for the next burn window.",
        source_language: "en",
        target_language: "es",
        requested_backend_provider: null,
      }),
      turnId: "turn-translation-default-openai-compatible",
      iteration: 1,
      env: {
        LLM_HTTP_API_KEY: "llm-http-key",
        LLM_HTTP_BASE: "https://translation-provider.test",
        LLM_HTTP_MODEL: "translation-test-model",
      } as NodeJS.ProcessEnv,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://translation-provider.test/v1/chat/completions");
    expect(init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer llm-http-key",
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      translated_text: "El equipo de navegacion esta listo para la proxima ventana de encendido.",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.lane_resolve_trace).toMatchObject({
      requested_backend_provider: null,
      selected_backend_provider: "live_translation.openai_compatible",
      execution_status: "executed_observation_only",
      backend_selection_decision: expect.objectContaining({
        outcome: "default_selected",
        live_backend_execution_enabled: true,
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        terminal_authority_owner: "helix",
        terminal_eligible: false,
        assistant_answer: false,
      }),
    });
    expect(result.observation).toMatchObject({
      selected_backend_provider: "live_translation.openai_compatible",
      deterministic: false,
      terminal_authority_status: "pending_helix_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("normalizes OpenAI-compatible provider failures as non-terminal failed receipts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("provider down", {
      status: 503,
    }));

    const result = await runLiveTranslationTranslateText({
      provider: buildProvider("codex"),
      request: request({
        text: "hello",
        target_language: "fr",
        requested_backend_provider: "live_translation.openai_compatible",
      }),
      turnId: "turn-translation-openai-compatible-failed",
      env: {
        OPENAI_API_KEY: "test-key",
        LLM_HTTP_BASE: "https://translation-provider.test",
        HELIX_LIVE_TRANSLATION_EXTERNAL_BACKENDS_ENABLED: "1",
      } as NodeJS.ProcessEnv,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("translation_provider_http_503");
    expect(result.observation).toBeNull();
    expect(result.lane_resolve_trace).toMatchObject({
      selected_backend_provider: "live_translation.openai_compatible",
      execution_status: "not_executed_shadow_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      backend_selection_decision: expect.objectContaining({
        live_backend_execution_enabled: true,
        terminal_authority_owner: "helix",
      }),
    });
    expect(result.observation_packet).toMatchObject({
      status: "failed",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet.state_delta.live_translation_projection_receipt).toMatchObject({
      projection_status: "failed",
      translated_text: null,
      terminal_authority_status: "not_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("keeps Helix and Codex on the same one-shot lane contract", async () => {
    const helix = await runLiveTranslationTranslateText({
      provider: buildProvider("helix"),
      request: request({ text: "The result is 72.", target_language: "fr" }),
      turnId: "turn-helix-translation",
      env: {} as NodeJS.ProcessEnv,
    });
    const codex = await runLiveTranslationTranslateText({
      provider: buildProvider("codex"),
      request: request({ text: "The result is 72.", target_language: "fr" }),
      turnId: "turn-codex-translation",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(helix.ok).toBe(true);
    expect(codex.ok).toBe(true);
    expect(helix.translated_text).toBe("le resultat est 72.");
    expect(codex.translated_text).toBe("le resultat est 72.");
    expect(helix.lane_resolve_trace.selected_backend_provider).toBe("live_translation.local_runtime");
    expect(codex.lane_resolve_trace.selected_backend_provider).toBe("live_translation.local_runtime");
    expect(helix.observation_packet.terminal_eligible).toBe(false);
    expect(codex.observation_packet.terminal_eligible).toBe(false);
  });

  it("records chunk identity, ordering, dedupe, freshness, and projection target as observation metadata", async () => {
    const result = await runLiveTranslationTranslateText({
      provider: buildProvider("codex"),
      request: request({
        text: "thank you",
        lane_session_id: "lane-session-chunk",
        session_control_key: "lane-session-chunk::docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::docs_chunk::es-US::fr",
        source_binding_key: "docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::docs_chunk::es-US::fr",
        source_identity_key:
          "docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::sha256:whitepaper-source::9::docs::docs_chunk::es-US::fr",
        latest_observation_key: "docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::docs_chunk::fr::chunk-7",
        latest_mail_loop_observation_key: "docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::docs_chunk::fr::chunk-7::mail",
        goal_binding_id: "goal-binding-docs-translation",
        goal_binding_key: "goal:docs-translation::goal-binding-docs-translation::lane-session-chunk::live_translation",
        source_language: "en",
        target_language: "fr",
        source_id: "docs:nhm2:whitepaper",
        panel_id: "docs-viewer",
        region_id: "docs-viewer:summary",
        bbox: { x: 12, y: 24, width: 360, height: 80, source: "docs-visible-region" },
        doc_path: "docs/research/nhm2.md",
        source_hash: "fnv1a32:whitepaper-v2",
        source_kind: "docs",
        account_locale: "es-US",
        chunk_id: "chunk-7",
        chunk_index: 7,
        dedupe_key: "docs:nhm2:whitepaper:chunk-7:fr",
        source_event_id: "docs:nhm2:whitepaper:event-7",
        source_event_ms: 1,
        projection_target: "docs_chunk",
      }),
      turnId: "turn-translation-chunk",
      env: {} as NodeJS.ProcessEnv,
      nowMs: 1783000031000,
    });

    expect(result.ok).toBe(true);
    expect(result.translated_text).toBe("merci");
    expect(result.observation).toMatchObject({
      lane_session_id: "lane-session-chunk",
      session_control_key: "lane-session-chunk::docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::docs_chunk::es-US::fr",
      source_binding_key: "docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::docs_chunk::es-US::fr",
      source_identity_key:
        "docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::sha256:whitepaper-source::9::docs::docs_chunk::es-US::fr",
      latest_observation_key: "docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::docs_chunk::fr::chunk-7",
      latest_mail_loop_observation_key: "docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::docs_chunk::fr::chunk-7::mail",
      goal_binding_id: "goal-binding-docs-translation",
      goal_binding_key: "goal:docs-translation::goal-binding-docs-translation::lane-session-chunk::live_translation",
      source_id: "docs:nhm2:whitepaper",
      panel_id: "docs-viewer",
      region_id: "docs-viewer:summary",
      bbox: { x: 12, y: 24, width: 360, height: 80, source: "docs-visible-region" },
      doc_path: "docs/research/nhm2.md",
      source_hash: "fnv1a32:whitepaper-v2",
      source_kind: "docs",
      account_locale: "es-US",
      chunk_id: "chunk-7",
      chunk_index: 7,
      dedupe_key: "docs:nhm2:whitepaper:chunk-7:fr",
      source_event_id: "docs:nhm2:whitepaper:event-7",
      source_event_ms: 1,
      observed_at_ms: 1783000031000,
      freshness_status: "stale",
      projection_target: "docs_chunk",
      cancel_requested: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(typeof result.observation?.observed_at_ms).toBe("number");
    expect(result.observation_packet.state_delta).toMatchObject({
      live_translation_chunk: {
        lane_session_id: "lane-session-chunk",
        session_control_key: "lane-session-chunk::docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::docs_chunk::es-US::fr",
        source_binding_key: "docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::docs_chunk::es-US::fr",
        source_identity_key:
          "docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::sha256:whitepaper-source::9::docs::docs_chunk::es-US::fr",
        latest_observation_key: "docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::docs_chunk::fr::chunk-7",
        latest_mail_loop_observation_key: "docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::docs_chunk::fr::chunk-7::mail",
        goal_binding_id: "goal-binding-docs-translation",
        goal_binding_key: "goal:docs-translation::goal-binding-docs-translation::lane-session-chunk::live_translation",
        source_id: "docs:nhm2:whitepaper",
        panel_id: "docs-viewer",
        region_id: "docs-viewer:summary",
        bbox: { x: 12, y: 24, width: 360, height: 80, source: "docs-visible-region" },
        doc_path: "docs/research/nhm2.md",
        source_hash: "fnv1a32:whitepaper-v2",
        source_kind: "docs",
        account_locale: "es-US",
        chunk_id: "chunk-7",
        chunk_index: 7,
        dedupe_key: "docs:nhm2:whitepaper:chunk-7:fr",
        source_event_id: "docs:nhm2:whitepaper:event-7",
        source_event_ms: 1,
        observed_at_ms: 1783000031000,
        freshness_status: "stale",
        projection_target: "docs_chunk",
        cancel_requested: false,
        observation_ref: result.observation?.observation_ref,
        terminal_authority_status: "pending_helix_terminal_authority",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(result.observation_packet.receipts).toEqual([
      {
        receipt_ref: result.observation_packet.state_delta.live_translation_projection_receipt?.receipt_ref,
        kind: "live_translation_projection",
        status: "stale",
      },
    ]);
    expect(result.observation_packet.state_delta.live_translation_projection_receipt).toMatchObject({
      schema: "helix.live_translation.projection_receipt.v1",
      observation_ref: result.observation?.observation_ref,
      lane_id: "live_translation",
      capability: "live_translation.translate_text",
      projection_target: "docs_chunk",
      projection_status: "stale",
      source_id: "docs:nhm2:whitepaper",
      panel_id: "docs-viewer",
      region_id: "docs-viewer:summary",
      bbox: { x: 12, y: 24, width: 360, height: 80, source: "docs-visible-region" },
      doc_path: "docs/research/nhm2.md",
      source_hash: "fnv1a32:whitepaper-v2",
      source_identity_key:
        "docs:nhm2:whitepaper::fnv1a32:whitepaper-v2::sha256:whitepaper-source::9::docs::docs_chunk::es-US::fr",
      source_kind: "docs",
      account_locale: "es-US",
      chunk_id: "chunk-7",
      chunk_index: 7,
      dedupe_key: "docs:nhm2:whitepaper:chunk-7:fr",
      source_event_id: "docs:nhm2:whitepaper:event-7",
      source_event_ms: 1,
      observed_at_ms: 1783000031000,
      freshness_status: "stale",
      target_language: "fr",
      source_text_hash: result.observation?.source_text_hash,
      source_text_char_count: "thank you".length,
      translated_text: "merci",
      stale: true,
      cancel_requested: false,
      reentry_required: true,
      terminal_authority_status: "pending_helix_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet.state_delta.live_translation_projection_receipt?.receipt_ref).toContain(
      `${result.observation?.observation_ref}:projection:`,
    );
    expect(result.observation_packet.state_delta.live_translation_projection_receipt?.observed_at_ms).toBe(
      1783000031000,
    );
  });

  it("normalizes legacy docs inline projection targets to docs chunk observations", async () => {
    const result = await runLiveTranslationTranslateText({
      provider: buildProvider("codex"),
      request: request({
        text: "thank you",
        target_language: "fr",
        source_id: "docs:nhm2:whitepaper",
        source_hash: "fnv1a32:whitepaper-v2",
        source_kind: "docs",
        account_locale: "es-US",
        chunk_id: "chunk-legacy-inline",
        projection_target: "docs_viewer.inline_translation" as never,
      }),
      turnId: "turn-translation-legacy-inline-target",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.ok).toBe(true);
    expect(result.observation).toMatchObject({
      projection_target: "docs_chunk",
      source_id: "docs:nhm2:whitepaper",
      source_hash: "fnv1a32:whitepaper-v2",
      source_kind: "docs",
      account_locale: "es-US",
      chunk_id: "chunk-legacy-inline",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet.state_delta.live_translation_projection_receipt).toMatchObject({
      projection_target: "docs_chunk",
      source_kind: "docs",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("keeps same-text chunks distinct by source and chunk identity", async () => {
    const first = await runLiveTranslationTranslateText({
      provider: buildProvider("codex"),
      request: request({
        text: "hello",
        target_language: "es",
        source_id: "docs:nhm2:whitepaper",
        source_hash: "fnv1a32:whitepaper-v2",
        chunk_id: "chunk-1",
        chunk_index: 1,
        dedupe_key: "docs:nhm2:whitepaper:chunk-1:es",
        source_event_id: "docs:nhm2:whitepaper:event-1",
        projection_target: "docs_chunk",
      }),
      turnId: "turn-translation-chunk-identity",
      env: {} as NodeJS.ProcessEnv,
    });
    const second = await runLiveTranslationTranslateText({
      provider: buildProvider("codex"),
      request: request({
        text: "hello",
        target_language: "es",
        source_id: "docs:nhm2:whitepaper",
        source_hash: "fnv1a32:whitepaper-v2",
        chunk_id: "chunk-2",
        chunk_index: 2,
        dedupe_key: "docs:nhm2:whitepaper:chunk-2:es",
        source_event_id: "docs:nhm2:whitepaper:event-2",
        projection_target: "docs_chunk",
      }),
      turnId: "turn-translation-chunk-identity",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.translated_text).toBe(second.translated_text);
    expect(first.observation?.observation_ref).not.toBe(second.observation?.observation_ref);
    expect(first.observation?.observation_id).toBe(first.observation?.observation_ref);
    expect(second.observation?.observation_id).toBe(second.observation?.observation_ref);
    expect(first.observation_packet.produced_artifact_refs).toEqual([
      first.observation?.observation_ref,
    ]);
    expect(second.observation_packet.produced_artifact_refs).toEqual([
      second.observation?.observation_ref,
    ]);
    expect(first.observation_packet.state_delta.live_translation_projection_receipt?.observation_ref).toBe(
      first.observation?.observation_ref,
    );
    expect(second.observation_packet.state_delta.live_translation_projection_receipt?.observation_ref).toBe(
      second.observation?.observation_ref,
    );
  });

  it("normalizes cancelled chunks as non-terminal cancelled evidence without backend execution", async () => {
    const result = await runLiveTranslationTranslateText({
      provider: buildProvider("codex"),
      request: request({
        text: "hello",
        target_language: "es",
        source_id: "docs:hover",
        source_hash: "fnv1a32:hover-v1",
        chunk_id: "hover-1",
        projection_target: "docs_hover",
        cancel_requested: true,
      }),
      turnId: "turn-translation-cancelled",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("translation_chunk_cancelled");
    expect(result.translated_text).toBeUndefined();
    expect(result.observation).toBeNull();
    expect(result.lane_resolve_trace).toMatchObject({
      execution_status: "not_executed_shadow_only",
      blocked_reason: "translation_chunk_cancelled",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet).toMatchObject({
      status: "blocked",
      observation_summary: "Translation chunk cancelled before backend execution.",
      backend_selection_decision: expect.objectContaining({
        outcome: "default_selected",
        selected_backend_provider: "live_translation.local_runtime",
        live_backend_execution_enabled: false,
      }),
      state_delta: {
        live_translation_chunk: {
          lane_session_id: null,
          source_id: "docs:hover",
          source_hash: "fnv1a32:hover-v1",
          chunk_id: "hover-1",
          projection_target: "docs_hover",
          cancel_requested: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet.receipts).toEqual([
      {
        receipt_ref: result.observation_packet.state_delta.live_translation_projection_receipt?.receipt_ref,
        kind: "live_translation_projection",
        status: "cancelled",
      },
    ]);
    expect(result.observation_packet.state_delta.live_translation_projection_receipt).toMatchObject({
      schema: "helix.live_translation.projection_receipt.v1",
      observation_ref: result.observation_packet.produced_artifact_refs[0],
      lane_id: "live_translation",
      capability: "live_translation.translate_text",
      projection_target: "docs_hover",
      projection_status: "cancelled",
      source_id: "docs:hover",
      source_hash: "fnv1a32:hover-v1",
      chunk_id: "hover-1",
      target_language: "es",
      source_text_hash: expect.any(String),
      source_text_char_count: "hello".length,
      translated_text: null,
      stale: false,
      cancel_requested: true,
      reentry_required: true,
      terminal_authority_status: "not_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("normalizes missing text or target language as missing-input observation evidence", async () => {
    const result = await runLiveTranslationTranslateText({
      provider: buildProvider("codex"),
      request: request({ text: "", target_language: "" }),
      turnId: "turn-translation-missing",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing_text");
    expect(result.observation).toBeNull();
    expect(result.lane_resolve_trace).toMatchObject({
      requested_lane: "live_translation",
      admission_status: "admitted_shadow_only",
      execution_status: "not_executed_shadow_only",
      blocked_reason: "missing_text",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet).toMatchObject({
      status: "missing_input",
      observation_summary: "Translation lane missing required input.",
      backend_selection_decision: expect.objectContaining({
        outcome: "default_selected",
        selected_backend_provider: "live_translation.local_runtime",
        terminal_authority_owner: "helix",
      }),
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet.missing_requirements.map((entry) => entry.code)).toEqual([
      "missing_text",
      "missing_target_language",
    ]);
  });
});
