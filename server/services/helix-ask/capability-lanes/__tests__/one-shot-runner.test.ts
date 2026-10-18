import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  callWorkstationGatewayCapability,
  listWorkstationGatewayCapabilities,
} from "../../workstation-tool-gateway/registry";
import { buildHelixAgentRuntimeSelectionTrace } from "../../agent-providers/runtime-debug";
import { buildHelixAgentProviderAskPayload } from "../../agent-providers/provider-response-projection";
import type { HelixAgentProvider } from "../../agent-providers/types";
import { runHelixCapabilityLaneOneShotRequests } from "../one-shot-runner";
import { resolveHelixCapabilityLaneOneShotDispatch } from "../one-shot-runner";
import { HELIX_USER_ACCOUNT_POLICY } from "../../../../../shared/helix-account-session";
import { listAccountAuthorizedWorkstationGatewayCapabilities } from "../../workstation-tool-gateway/account-policy";
import type { HelixWorkstationGatewayAccountContext } from "../../workstation-tool-gateway/account-policy";
import { buildScientificEvidencePacket } from "../../../../../shared/scientific-evidence-adaptor";
import { resetStagePlayLiveSourceMailboxForTest } from "../../../stage-play/stage-play-live-source-mailbox-store";
import { resetStagePlayLiveSourceMailWakeStoreForTest } from "../../../stage-play/stage-play-live-source-mail-wake-store";

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

const body = {
  turn_id: "turn-provider-neutral-lane",
  capability_lane_call: {
    capability: "live_translation.translate_text",
    text: "hello",
    source_language: "en",
    target_language: "es",
    requested_backend_provider: "google_gemini",
    source_id: "document_markdown:docs/example.md",
    source_hash: "fnv1a32:example",
    chunkId: "visible-title",
    chunkIndex: 3,
    sourceEventId: "visible-source-event:title",
    sourceEventMs: 1783000039000,
    nowMs: 1783000040000,
  },
};

const withRuntimeMemoryGuardDisabled = async <T>(
  callback: () => Promise<T>,
): Promise<T> => {
  const previous = process.env.RUNTIME_MEMORY_GUARD;
  process.env.RUNTIME_MEMORY_GUARD = "0";
  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.RUNTIME_MEMORY_GUARD;
    } else {
      process.env.RUNTIME_MEMORY_GUARD = previous;
    }
  }
};

const buildGatewayObservationStub = async (
  input: Parameters<typeof callWorkstationGatewayCapability>[0],
): Promise<Awaited<ReturnType<typeof callWorkstationGatewayCapability>>> => ({
  schema: "helix.workstation_tool_gateway.call_result.v1",
  manifest_version: "test",
  ok: true,
  agent_runtime: String(input.agentRuntime ?? "codex"),
  capability_id: input.capabilityId,
  mode: "act",
  gateway_admission: {} as never,
  observation_packet: {
    schema: "helix.agent_step_observation_packet.v1",
    turn_id: input.turnId ?? "ask:test:gateway-stub",
    iteration: input.iteration ?? 0,
    call_id: input.toolCallId ?? "tool-call:gateway-stub",
    decision_id:
      input.providerExecutionId ?? "provider-execution:gateway-stub",
    capability_key: input.capabilityId,
    panel_id: "test",
    action: input.capabilityId,
    status: "succeeded",
    produced_artifact_refs: [`test:gateway:${input.capabilityId}`],
    observation_summary: "Deterministic governed gateway test observation.",
    receipts: [],
    missing_requirements: [],
    state_delta: {},
    suggested_next_steps: ["answer"],
    answer_authority: false,
    terminal_eligible: false,
    post_tool_model_step_required: true,
    assistant_answer: false,
    raw_content_included: false,
  },
  tool_lifecycle_trace: {} as never,
  tool_followup_decision: {} as never,
  observation: { arguments: input.arguments ?? {} },
  artifact_refs: [`test:gateway:${input.capabilityId}`],
  terminal_eligible: false,
  post_tool_model_step_required: true,
  assistant_answer: false,
  raw_content_included: false,
});

const projectPayload = (
  provider: HelixAgentProvider,
  debugProjection: Record<string, unknown>,
) => {
  const gatewayManifest = listWorkstationGatewayCapabilities({
    agentRuntime: provider.id,
    mode: "act",
  });
  const runtimeSelectionTrace = buildHelixAgentRuntimeSelectionTrace({
    route: "/ask/turn",
    requestedRuntime: provider.id,
    provider,
    gatewayManifest,
  });
  return buildHelixAgentProviderAskPayload({
    provider,
    providerResult: {
      ok: true,
      runtime: provider.id,
      response_type: "final_answer",
      final_status: "completed",
      answer: "provider terminal candidate",
      debug: debugProjection,
    },
    runtimeSelectionTrace,
    gatewayManifest,
    turnId: "turn-provider-neutral-lane",
  });
};

beforeEach(() => {
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayLiveSourceMailWakeStoreForTest();
});

describe("provider-neutral capability lane one-shot runner", () => {
  it("has an executable dispatch for every user-account gateway capability advertised to Codex", () => {
    const manifest = listAccountAuthorizedWorkstationGatewayCapabilities({
      accountContext: {
        session_id: null,
        profile_id: null,
        trusted_account_session: false,
        account_session: null,
        account_policy: HELIX_USER_ACCOUNT_POLICY,
      },
      requestedMode: "act",
      requestedRuntime: "codex",
    });

    const rows = manifest.capabilities.map((capability) => ({
      capability_id: capability.capability_id,
      ...resolveHelixCapabilityLaneOneShotDispatch({
        capability: capability.capability_id,
        authorizedGatewayCapabilities: manifest.capabilities,
      }),
    }));

    expect(rows).not.toHaveLength(0);
    expect(
      rows.filter((row) => !row.handler || row.dispatchKind === "blocked"),
    ).toEqual([]);
    expect(rows.some((row) => row.dispatchKind === "governed_gateway")).toBe(
      true,
    );
    expect(rows.some((row) => row.dispatchKind === "specialized_lane")).toBe(
      true,
    );
  });
  it("lets Helix and Codex request the same one-shot translation lane through the same body contract", async () => {
    const helix = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("helix"),
      body,
      env: {} as NodeJS.ProcessEnv,
    });
    const codex = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body,
      env: {} as NodeJS.ProcessEnv,
    });

    expect(helix).toMatchObject({
      schema: "helix.capability_lane.one_shot_runner_result.v1",
      requested: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex).toMatchObject({
      requested: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(helix.call_results).toHaveLength(1);
    expect(codex.call_results).toHaveLength(1);
    expect(helix.call_results[0]?.translated_text).toBe("hola");
    expect(codex.call_results[0]?.translated_text).toBe("hola");
    expect(helix.call_results[0]?.selected_runtime_agent_provider).toBe(
      "helix",
    );
    expect(codex.call_results[0]?.selected_runtime_agent_provider).toBe(
      "codex",
    );
    expect(helix.resolve_traces[0]).toMatchObject({
      requested_lane: "live_translation",
      requested_backend_provider: "google_gemini",
      requested_backend_provider_known: true,
      requested_backend_configuration_status: "missing",
      requested_backend_availability_status: "unconfigured",
      requested_backend_permission_status: "configuration_missing",
      requested_backend_fallback_provider: "live_translation.local_runtime",
      selected_backend_provider: "live_translation.local_runtime",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(helix.resolve_traces[0]?.receipt_ref).toContain(
      `${helix.resolve_traces[0]?.observation_ref}:projection:`,
    );
    expect(helix.backend_selections[0]).toMatchObject({
      schema: "helix.capability_lane.backend_selection_summary.v1",
      selected_runtime_agent_provider: "helix",
      lane_id: "live_translation",
      capability: "live_translation.translate_text",
      requested_lane: "live_translation",
      requested_backend_provider: "google_gemini",
      requested_backend_provider_known: true,
      requested_backend_configuration_status: "missing",
      requested_backend_availability_status: "unconfigured",
      requested_backend_permission_status: "configuration_missing",
      requested_backend_fallback_provider: "live_translation.local_runtime",
      selected_backend_provider: "live_translation.local_runtime",
      backend_selection_decision: {
        schema: "helix.capability_lane.backend_selection_decision.v1",
        owner: "helix",
        outcome: "fallback_selected",
        reason:
          "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
        requested_backend_provider: "google_gemini",
        requested_backend_provider_known: true,
        selected_backend_provider: "live_translation.local_runtime",
        fallback_backend_provider: "live_translation.local_runtime",
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        dynamic_switching_executed: false,
        live_backend_execution_enabled: false,
        terminal_authority_owner: "helix",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      selection_reason:
        "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
      availability_status: "dry_run",
      permission_status: "admitted",
      cost_class: "free_local",
      latency_class: "interactive",
      privacy_class: "local_only",
      fallback_backend_provider: null,
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(helix.backend_selections[0]?.receipt_ref).toBe(
      helix.resolve_traces[0]?.receipt_ref,
    );
    expect(codex.backend_selections[0]).toMatchObject({
      schema: "helix.capability_lane.backend_selection_summary.v1",
      selected_runtime_agent_provider: "codex",
      lane_id: "live_translation",
      capability: "live_translation.translate_text",
      requested_backend_provider: "google_gemini",
      requested_backend_provider_known: true,
      requested_backend_configuration_status: "missing",
      requested_backend_availability_status: "unconfigured",
      requested_backend_permission_status: "configuration_missing",
      requested_backend_fallback_provider: "live_translation.local_runtime",
      selected_backend_provider: "live_translation.local_runtime",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.backend_selections[0]?.receipt_ref).toBe(
      codex.resolve_traces[0]?.receipt_ref,
    );
    expect(codex.resolve_traces[0]).toMatchObject({
      requested_lane: "live_translation",
      requested_backend_provider: "google_gemini",
      requested_backend_provider_known: true,
      requested_backend_configuration_status: "missing",
      requested_backend_availability_status: "unconfigured",
      requested_backend_permission_status: "configuration_missing",
      requested_backend_fallback_provider: "live_translation.local_runtime",
      selected_backend_provider: "live_translation.local_runtime",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.resolve_traces[0]?.receipt_ref).toContain(
      `${codex.resolve_traces[0]?.observation_ref}:projection:`,
    );
    expect(helix.observation_packets[0]?.capability_key).toBe(
      "live_translation.translate_text",
    );
    expect(codex.observation_packets[0]?.capability_key).toBe(
      "live_translation.translate_text",
    );
    expect(codex.call_results[0]?.observation).toMatchObject({
      source_id: "document_markdown:docs/example.md",
      source_hash: "fnv1a32:example",
      chunk_id: "visible-title",
      chunk_index: 3,
      source_event_id: "visible-source-event:title",
      source_event_ms: 1783000039000,
      observed_at_ms: 1783000040000,
    });
    expect(codex.observation_packets[0]?.state_delta).toMatchObject({
      live_translation_chunk: {
        source_id: "document_markdown:docs/example.md",
        source_hash: "fnv1a32:example",
        chunk_id: "visible-title",
        chunk_index: 3,
        source_event_id: "visible-source-event:title",
        source_event_ms: 1783000039000,
        observed_at_ms: 1783000040000,
      },
      live_translation_projection_receipt: {
        source_id: "document_markdown:docs/example.md",
        source_hash: "fnv1a32:example",
        chunk_id: "visible-title",
        chunk_index: 3,
        source_event_id: "visible-source-event:title",
        source_event_ms: 1783000039000,
        observed_at_ms: 1783000040000,
      },
    });
    expect(helix.debug_events.map((event) => event.stage)).toEqual([
      "lane_requested",
      "lane_backend_selected",
      "lane_observation",
      "lane_reentered",
    ]);
    expect(codex.debug_events.map((event) => event.stage)).toEqual([
      "lane_requested",
      "lane_backend_selected",
      "lane_observation",
      "lane_reentered",
    ]);
    expect(codex.debug_events[1]).toMatchObject({
      schema: "helix.capability_lane.debug_event.v1",
      stage: "lane_backend_selected",
      requested_backend_provider: "google_gemini",
      requested_backend_provider_known: true,
      requested_backend_configuration_status: "missing",
      requested_backend_availability_status: "unconfigured",
      requested_backend_permission_status: "configuration_missing",
      requested_backend_fallback_provider: "live_translation.local_runtime",
      selected_backend_provider: "live_translation.local_runtime",
      selection_reason:
        "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
      availability_status: "dry_run",
      permission_status: "admitted",
      cost_class: "free_local",
      latency_class: "interactive",
      privacy_class: "local_only",
      fallback_backend_provider: null,
      backend_selection_decision: expect.objectContaining({
        outcome: "fallback_selected",
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        dynamic_switching_executed: false,
        live_backend_execution_enabled: false,
        terminal_authority_owner: "helix",
      }),
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.debug_events[2]).toMatchObject({
      schema: "helix.capability_lane.debug_event.v1",
      stage: "lane_observation",
      selected_runtime_agent_provider: "codex",
      lane_id: "live_translation",
      capability: "live_translation.translate_text",
      status: "completed",
      requested_backend_provider: "google_gemini",
      requested_backend_provider_known: true,
      requested_backend_configuration_status: "missing",
      requested_backend_availability_status: "unconfigured",
      requested_backend_permission_status: "configuration_missing",
      requested_backend_fallback_provider: "live_translation.local_runtime",
      selected_backend_provider: "live_translation.local_runtime",
      availability_status: "dry_run",
      permission_status: "admitted",
      cost_class: "free_local",
      latency_class: "interactive",
      privacy_class: "local_only",
      fallback_backend_provider: null,
      backend_selection_decision: expect.objectContaining({
        outcome: "fallback_selected",
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        dynamic_switching_executed: false,
        live_backend_execution_enabled: false,
        terminal_authority_owner: "helix",
      }),
      execution_status: "executed_observation_only",
      reentry_status: "observation_packet_required_for_provider_reentry",
      terminal_authority_status: "pending_helix_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.debug_events[2]?.receipt_ref).toBe(
      codex.resolve_traces[0]?.receipt_ref,
    );
    expect(codex.debug_events[3]).toMatchObject({
      stage: "lane_reentered",
      lane_id: "live_translation",
      capability: "live_translation.translate_text",
      requested_backend_provider: "google_gemini",
      selected_backend_provider: "live_translation.local_runtime",
      execution_status: "executed_observation_only",
      observation_ref: codex.resolve_traces[0]?.observation_ref,
      result_ref: codex.resolve_traces[0]?.result_ref,
      reentry_status: "observation_packet_required_for_provider_reentry",
    });
    expect(codex.debug_events[3]?.receipt_ref).toBe(
      codex.resolve_traces[0]?.receipt_ref,
    );
  });

  it("projects lane call results through the same provider debug/export envelope", async () => {
    const provider = buildProvider("codex");
    const runner = await runHelixCapabilityLaneOneShotRequests({
      provider,
      body,
      env: {} as NodeJS.ProcessEnv,
    });
    const payload = projectPayload(provider, runner.debug_projection);
    const debug = payload.debug as Record<string, unknown>;

    expect(payload.agent_runtime).toBe("codex");
    expect(payload.capability_lane_call_results).toEqual(runner.call_results);
    expect(payload.capability_lane_observation_packets).toEqual(
      runner.observation_packets,
    );
    expect(payload.capability_lane_resolve_traces).toEqual(
      runner.resolve_traces,
    );
    expect(payload.capability_lane_backend_selections).toEqual(
      runner.backend_selections,
    );
    expect(payload.capability_lane_debug_events).toEqual(runner.debug_events);
    expect(debug.capability_lane_call_results).toEqual(runner.call_results);
    expect(debug.capability_lane_observation_packets).toEqual(
      runner.observation_packets,
    );
    expect(debug.capability_lane_resolve_traces).toEqual(runner.resolve_traces);
    expect(debug.capability_lane_backend_selections).toEqual(
      runner.backend_selections,
    );
    expect(debug.capability_lane_debug_events).toEqual(runner.debug_events);
    expect(debug.capability_lane_reentry_status).toBe(
      "observation_packet_required_for_provider_reentry",
    );
    expect(
      (
        payload.capability_lane_call_results as Array<Record<string, unknown>>
      )[0],
    ).toMatchObject({
      capability: "live_translation.translate_text",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("lets a runtime provider pass active doc visible translation context directly to the collector", async () => {
    const codex = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-visible-context-collector",
        capability_lane_call: {
          capability:
            "workstation_tool_reference.collect_visible_translation_targets",
          active_doc_visible_translation_context: {
            schema: "helix.ask.active_doc_visible_translation_context.v1",
            panel_id: "docs-viewer",
            doc_path: "docs/research/visible.md",
            source_hash: "sha256:visible-doc",
            account_locale: "es-US",
            target_language: "es",
            projection_target: "docs_chunk",
            raw_content_included: false,
            assistant_answer: false,
            terminal_eligible: false,
            reentry_required: true,
            chunks: [
              {
                source_kind: "docs_viewer",
                panel_id: "docs-viewer",
                doc_path: "docs/research/visible.md",
                source_id: "document_markdown:docs/research/visible.md#u0001",
                source_hash: "sha256:visible-doc",
                source_text_hash: "sha256:visible-title",
                source_text_char_count: 15,
                visible_text: "# Visible title",
                chunk_id: "u0001",
                chunk_index: 1,
                dedupe_key:
                  "document_markdown:docs/research/visible.md::sha256:visible-title::u0001::es-US::es",
                region_id: "docs-viewer:u0001",
                projection_target: "docs_chunk",
                account_locale: "es-US",
                target_language: "es",
                assistant_answer: false,
                terminal_eligible: false,
                raw_content_included: false,
                reentry_required: true,
              },
            ],
          },
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(codex).toMatchObject({
      requested: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.call_results).toHaveLength(1);
    expect(codex.call_results[0]).toMatchObject({
      ok: true,
      capability:
        "workstation_tool_reference.collect_visible_translation_targets",
      selected_runtime_agent_provider: "codex",
      target_count: 1,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      observation: {
        target_batch: {
          target_count: 1,
          raw_content_included: false,
          terminal_eligible: false,
          assistant_answer: false,
          answer_authority: false,
          targets: [
            expect.objectContaining({
              doc_path: "docs/research/visible.md",
              source_id: "document_markdown:docs/research/visible.md#u0001",
              source_hash: "sha256:visible-doc",
              source_text_hash: "sha256:visible-title",
              source_text_char_count: 15,
              visible_text: "# Visible title",
              chunk_id: "u0001",
              chunk_index: 1,
              projection_target: "docs_chunk",
              account_locale: "es-US",
              target_language: "es",
              terminal_eligible: false,
              assistant_answer: false,
              answer_authority: false,
              raw_content_included: false,
              reentry_required: true,
            }),
          ],
        },
      },
    });
    expect(codex.observation_packets[0]).toMatchObject({
      capability_key:
        "workstation_tool_reference.collect_visible_translation_targets",
      state_delta: {
        visible_translation_target_batch: expect.objectContaining({
          target_count: 1,
          raw_content_included: false,
          terminal_eligible: false,
          assistant_answer: false,
          answer_authority: false,
        }),
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("executes the provider-neutral visible text collector alias", async () => {
    const codex = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-visible-text-collector-alias",
        capability_lane_call: {
          capability: "workstation.visible_text.collect_translation_targets",
          active_panel_id: "docs-viewer",
          doc_path: "docs/research/visible.md",
          source_hash: "sha256:visible-doc",
          projection_target: "docs_chunk",
          account_locale: "es-US",
          target_language: "es",
          visible_only: true,
          max_chunks: 1,
          visible_text_chunks: [
            {
              source_kind: "docs_viewer",
              visible_text: "# Visible title",
              chunk_id: "u0001",
              chunk_index: 1,
              region_id: "docs-viewer:u0001",
            },
          ],
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(codex).toMatchObject({
      requested: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.call_results).toHaveLength(1);
    expect(codex.call_results[0]).toMatchObject({
      ok: true,
      lane_id: "workstation_tool_reference",
      capability:
        "workstation_tool_reference.collect_visible_translation_targets",
      selected_runtime_agent_provider: "codex",
      target_count: 1,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      observation: {
        target_batch: {
          requested_collector_capability:
            "workstation.visible_text.collect_translation_targets",
          collector_capability:
            "workstation_tool_reference.collect_visible_translation_targets",
          translation_capability_required: "live_translation.translate_text",
          target_count: 1,
          targets: [
            expect.objectContaining({
              doc_path: "docs/research/visible.md",
              visible_text: "# Visible title",
              chunk_id: "u0001",
              projection_target: "docs_chunk",
              account_locale: "es-US",
              target_language: "es",
              terminal_eligible: false,
              assistant_answer: false,
              answer_authority: false,
              raw_content_included: false,
              reentry_required: true,
            }),
          ],
          terminal_eligible: false,
          assistant_answer: false,
          answer_authority: false,
          raw_content_included: false,
        },
      },
    });
    expect(codex.observation_packets[0]).toMatchObject({
      capability_key:
        "workstation_tool_reference.collect_visible_translation_targets",
      state_delta: {
        visible_translation_target_batch: expect.objectContaining({
          requested_collector_capability:
            "workstation.visible_text.collect_translation_targets",
          collector_capability:
            "workstation_tool_reference.collect_visible_translation_targets",
          terminal_eligible: false,
          assistant_answer: false,
          answer_authority: false,
        }),
      },
      typed_handoff_contract: expect.objectContaining({
        consumer_capability: "live_translation.translate_text",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("forwards selected text through the provider-neutral visible text collector alias", async () => {
    const codex = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-visible-text-selection-collector",
        capability_lane_call: {
          capability: "workstation.visible_text.collect_translation_targets",
          active_panel_id: "docs-viewer",
          doc_path: "docs/research/visible.md",
          source_hash: "sha256:visible-doc",
          account_locale: "es-US",
          target_language: "es",
          visible_only: true,
          max_chunks: 1,
          selected_text: "Selected text from the current document.",
          selection_ref: "docs-viewer:selection:u0042",
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(codex).toMatchObject({
      requested: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.call_results).toHaveLength(1);
    expect(codex.call_results[0]).toMatchObject({
      ok: true,
      lane_id: "workstation_tool_reference",
      capability:
        "workstation_tool_reference.collect_visible_translation_targets",
      target_count: 1,
      observation: {
        target_batch: {
          target_count: 1,
          targets: [
            expect.objectContaining({
              source_kind: "selection",
              doc_path: "docs/research/visible.md",
              source_id:
                "document_markdown:docs/research/visible.md#docs-viewer:selection:u0042",
              visible_text: "Selected text from the current document.",
              chunk_id: "docs-viewer:selection:u0042",
              region_id: "docs-viewer:selection:u0042",
              projection_target: "docs_selection",
              account_locale: "es-US",
              target_language: "es",
              terminal_eligible: false,
              assistant_answer: false,
              answer_authority: false,
              raw_content_included: false,
              reentry_required: true,
            }),
          ],
          terminal_eligible: false,
          assistant_answer: false,
          answer_authority: false,
          raw_content_included: false,
        },
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("forwards hovered text through the provider-neutral visible text collector alias", async () => {
    const codex = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-visible-text-hover-collector",
        capability_lane_call: {
          capability: "workstation.visible_text.collect_translation_targets",
          active_panel_id: "docs-viewer",
          doc_path: "docs/research/visible.md",
          source_hash: "sha256:visible-doc",
          account_locale: "es-US",
          target_language: "es",
          visible_only: true,
          max_chunks: 1,
          hover_text: "Hovered text from the current document.",
          hover_ref: "docs-viewer:hover:u0043",
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(codex).toMatchObject({
      requested: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.call_results).toHaveLength(1);
    expect(codex.call_results[0]).toMatchObject({
      ok: true,
      lane_id: "workstation_tool_reference",
      capability:
        "workstation_tool_reference.collect_visible_translation_targets",
      target_count: 1,
      observation: {
        target_batch: {
          target_count: 1,
          targets: [
            expect.objectContaining({
              source_kind: "hover_region",
              doc_path: "docs/research/visible.md",
              source_id:
                "document_markdown:docs/research/visible.md#docs-viewer:hover:u0043",
              visible_text: "Hovered text from the current document.",
              chunk_id: "docs-viewer:hover:u0043",
              region_id: "docs-viewer:hover:u0043",
              projection_target: "docs_hover",
              account_locale: "es-US",
              target_language: "es",
              terminal_eligible: false,
              assistant_answer: false,
              answer_authority: false,
              raw_content_included: false,
              reentry_required: true,
            }),
          ],
          terminal_eligible: false,
          assistant_answer: false,
          answer_authority: false,
          raw_content_included: false,
        },
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("forwards visible UI text regions through the provider-neutral collector alias", async () => {
    const codex = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-visible-ui-region-collector",
        capability_lane_call: {
          capability: "workstation.visible_text.collect_translation_targets",
          active_panel_id: "workstation-shell",
          source_hash: "sha256:visible-ui",
          account_locale: "es-US",
          target_language: "es",
          visible_only: true,
          max_chunks: 2,
          ui_text_regions: [
            {
              source_kind: "panel_text",
              panel_id: "workstation-notes",
              visible_text: "Workstation notes",
              region_id: "workstation-notes:title",
            },
            {
              source_kind: "button_label",
              panel_id: "docs-viewer",
              label: "Translate selection",
              id: "docs-viewer:translate-selection",
            },
          ],
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(codex).toMatchObject({
      requested: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.call_results).toHaveLength(1);
    expect(codex.call_results[0]).toMatchObject({
      ok: true,
      lane_id: "workstation_tool_reference",
      capability:
        "workstation_tool_reference.collect_visible_translation_targets",
      target_count: 2,
      observation: {
        target_batch: {
          target_count: 2,
          targets: [
            expect.objectContaining({
              source_kind: "panel_text",
              panel_id: "workstation-notes",
              source_id: "workstation-shell#workstation-notes:title",
              visible_text: "Workstation notes",
              projection_target: "account_language",
              account_locale: "es-US",
              target_language: "es",
              terminal_eligible: false,
              assistant_answer: false,
              answer_authority: false,
              raw_content_included: false,
              reentry_required: true,
            }),
            expect.objectContaining({
              source_kind: "button_label",
              panel_id: "docs-viewer",
              source_id: "workstation-shell#docs-viewer:translate-selection",
              visible_text: "Translate selection",
              projection_target: "account_language",
              terminal_eligible: false,
              assistant_answer: false,
              answer_authority: false,
              raw_content_included: false,
              reentry_required: true,
            }),
          ],
          terminal_eligible: false,
          assistant_answer: false,
          answer_authority: false,
          raw_content_included: false,
        },
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("lets Helix and Codex request the same utility text lane through the same body contract", async () => {
    const utilityBody = {
      turn_id: "turn-provider-neutral-utility",
      capability_lane_call: {
        capability: "utility_text.normalize_text",
        text: "  Hello    WORKSTATION  ",
        normalization_mode: "lowercase",
        requested_backend_provider: "utility_text.openai_compatible",
      },
    };
    const helix = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("helix"),
      body: utilityBody,
      env: {} as NodeJS.ProcessEnv,
    });
    const codex = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: utilityBody,
      env: {} as NodeJS.ProcessEnv,
    });

    expect(helix.call_results).toHaveLength(1);
    expect(codex.call_results).toHaveLength(1);
    expect(helix.call_results[0]).toMatchObject({
      schema: "helix.utility_text.normalize_result.v1",
      ok: true,
      lane_id: "utility_text",
      capability: "utility_text.normalize_text",
      selected_runtime_agent_provider: "helix",
      normalized_text: "hello workstation",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.call_results[0]).toMatchObject({
      schema: "helix.utility_text.normalize_result.v1",
      ok: true,
      selected_runtime_agent_provider: "codex",
      normalized_text: "hello workstation",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(helix.resolve_traces[0]).toMatchObject({
      requested_lane: "utility_text",
      requested_backend_provider: "utility_text.openai_compatible",
      selected_backend_provider: "utility_text.local_runtime",
      selection_reason:
        "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.resolve_traces[0]).toMatchObject({
      requested_lane: "utility_text",
      requested_backend_provider: "utility_text.openai_compatible",
      selected_backend_provider: "utility_text.local_runtime",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
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
  });

  it("lets Helix and Codex inspect the same workstation tool catalog through the lane contract", async () => {
    const catalogBody = {
      turn_id: "turn-provider-neutral-workstation-catalog",
      capability_lane_call: {
        capability: "workstation_tool_reference.list_capabilities",
        mode: "act",
      },
    };
    const helix = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("helix"),
      body: catalogBody,
      env: {} as NodeJS.ProcessEnv,
    });
    const codex = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: catalogBody,
      env: {} as NodeJS.ProcessEnv,
    });

    expect(helix.call_results).toHaveLength(1);
    expect(codex.call_results).toHaveLength(1);
    expect(helix.call_results[0]).toMatchObject({
      schema: "helix.workstation_tool_reference.list_result.v1",
      ok: true,
      lane_id: "workstation_tool_reference",
      capability: "workstation_tool_reference.list_capabilities",
      selected_runtime_agent_provider: "helix",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.call_results[0]).toMatchObject({
      schema: "helix.workstation_tool_reference.list_result.v1",
      ok: true,
      selected_runtime_agent_provider: "codex",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(helix.resolve_traces[0]).toMatchObject({
      requested_lane: "workstation_tool_reference",
      selected_backend_provider:
        "workstation_tool_reference.helix_workstation_gateway",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.resolve_traces[0]).toMatchObject({
      requested_lane: "workstation_tool_reference",
      selected_backend_provider:
        "workstation_tool_reference.helix_workstation_gateway",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(helix.observation_packets[0]).toMatchObject({
      capability_key: "workstation_tool_reference.list_capabilities",
      status: "succeeded",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.observation_packets[0]).toMatchObject({
      capability_key: "workstation_tool_reference.list_capabilities",
      status: "succeeded",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("lets Helix and Codex request Image Lens region inspection as non-terminal crop evidence", async () => {
    const imageRegionBody = {
      turn_id: "turn-provider-neutral-image-lens-region",
      capability_lane_call: {
        capability: "visual_analysis.inspect_image_region",
        source_id: "image-lens-source:test",
        frame_id: "frame:test",
        source_attachment_id: "attachment:image:test",
        source_kind: "image_lens_source",
        source_image_ref: "ephemeral://image/source",
        bbox_px: { x: 4, y: 8, width: 120, height: 64 },
        question: "What equation is in this crop?",
        reason_for_crop: "The equation is small in the full image.",
        detail: "high",
        region_kind: "equation",
        text_candidate: "T00 = rho",
        latex_candidate: "T_{00}=\\rho",
        visual_layout_candidate: {
          displayed_line_count: 2,
          displayed_lines: ["T00 =", "rho"],
          horizontal_alignment: "aligned_at_relation",
          structure: "aligned_block",
          equation_bbox_px: { x: 8, y: 10, width: 96, height: 42 },
          notes: ["relation symbols share a vertical alignment column"],
        },
        extraction_status: "extracted",
        uncertainty: ["OCR is candidate-only"],
        requested_backend_provider: "openai_compatible",
      },
    };
    const env = { OPENAI_API_KEY: "test-openai" } as NodeJS.ProcessEnv;
    const helix = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("helix"),
      body: imageRegionBody,
      env,
    });
    const codex = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: imageRegionBody,
      env,
    });

    expect(helix.call_results).toHaveLength(1);
    expect(codex.call_results).toHaveLength(1);
    expect(codex.call_results[0]).toMatchObject({
      schema: "helix.image_lens_region_inspection_result.v1",
      ok: true,
      lane_id: "visual_analysis",
      capability: "visual_analysis.inspect_image_region",
      selected_runtime_agent_provider: "codex",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      receipt: {
        schema: "image_lens_region_inspection_receipt/v1",
        capability: "visual_analysis.inspect_image_region",
        bbox_px: { x: 4, y: 8, width: 120, height: 64 },
        text_candidate: "T00 = rho",
        latex_candidate: "T_{00}=\\rho",
        visual_layout_candidate: {
          displayed_line_count: 2,
          horizontal_alignment: "aligned_at_relation",
          structure: "aligned_block",
          equation_bbox_px: { x: 8, y: 10, width: 96, height: 42 },
        },
        extraction_status: "extracted",
        scientific_evidence_packet: {
          schema: "helix.scientific_evidence_packet.v1",
          primary_domain: "adm_gr",
          extraction_status: "extracted",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        claim_boundary: {
          cropObservationOnly: true,
          ocrCandidateOnly: true,
          notProofAuthority: true,
        },
        document_region_receipt: {
          sourceKind: "image_lens_source",
          classification: {
            kind: "equation",
          },
          extraction: {
            textCandidate: "T00 = rho",
            latexCandidate: "T_{00}=\\rho",
            status: "candidate",
          },
          claimBoundary: {
            ocrCandidateOnly: true,
            notProofAuthority: true,
          },
        },
      },
    });
    expect(codex.resolve_traces[0]).toMatchObject({
      requested_lane: "visual_analysis",
      requested_backend_provider: "openai_compatible",
      selected_backend_provider: "visual_analysis.openai_compatible",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.observation_packets[0]).toMatchObject({
      capability_key: "visual_analysis.inspect_image_region",
      panel_id: "image_lens",
      status: "succeeded",
      state_delta: {
        visual_analysis_region_inspection: {
          source_id: "image-lens-source:test",
          frame_id: "frame:test",
          source_attachment_id: "attachment:image:test",
          page_number: null,
          crop_bbox_px: { x: 4, y: 8, width: 120, height: 64 },
          crop_image_ref: "ephemeral://image/source#crop=4,8,120,64",
          text_candidate: "T00 = rho",
          latex_candidate: "T_{00}=\\rho",
          visual_layout_candidate: expect.objectContaining({
            displayed_line_count: 2,
            horizontal_alignment: "aligned_at_relation",
            structure: "aligned_block",
          }),
          extraction_status: "extracted",
          uncertainty: ["OCR is candidate-only"],
          scientific_evidence_packet: expect.objectContaining({
            schema: "helix.scientific_evidence_packet.v1",
            primary_domain: "adm_gr",
            source_image: expect.objectContaining({
              source_kind: "image_lens_source",
              page_number: null,
              raw_ref_included: false,
            }),
            crop_region: expect.objectContaining({
              region_id: expect.stringContaining("image_lens_region:"),
              bbox_px: { x: 4, y: 8, width: 120, height: 64 },
              source_ref_hash: expect.stringContaining("sha256:"),
            }),
            ocr_text_candidate: "T00 = rho",
            symbol_candidates: expect.arrayContaining(["T00", "rho"]),
            admissibility: expect.objectContaining({
              claim_boundary: "observation_only_not_proof",
            }),
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          }),
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.observation_packets[0]?.produced_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "image_lens_region_evidence",
          source_capability: "visual_analysis.inspect_image_region",
          status: "available",
          assistant_answer: false,
          raw_content_included: false,
        }),
        expect.objectContaining({
          kind: "scientific_evidence",
          source_capability: "visual_analysis.inspect_image_region",
          status: "available",
          assistant_answer: false,
          raw_content_included: false,
        }),
      ]),
    );
    expect(codex.observation_packets[0]?.typed_handoff_contract).toMatchObject({
      produced_affordance_kinds: expect.arrayContaining([
        "image_lens_region_evidence",
        "scientific_evidence",
      ]),
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(codex.debug_events.map((event) => event.stage)).toEqual([
      "lane_requested",
      "lane_backend_selected",
      "lane_observation",
      "lane_reentered",
    ]);
    expect(helix.observation_packets[0]?.state_delta).toMatchObject({
      visual_analysis_region_inspection: {
        source_id: "image-lens-source:test",
        extraction_status: "extracted",
      },
    });
  });

  it("mounts a rendered PDF page source without running OCR or creating a scientific sidecar", async () => {
    const sourceImageRef =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-render-only-page-mount",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "pdf-page-render:page-8",
          source_kind: "pdf_page_render",
          source_image_ref: sourceImageRef,
          page_image_ref: sourceImageRef,
          page_number: 8,
          page_count: 17,
          source_dimensions_px: { width: 1224, height: 1584 },
          source_mount_only: true,
          bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
          question:
            "Mount page 8 as the active Image Lens source without OCR or crop analysis.",
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]).toMatchObject({
      ok: true,
      lane_resolve_trace: {
        admission_status: "admitted_shadow_only",
        lane_status: "dry_run",
        selected_backend_provider: "visual_analysis.local_pdf_page_mount",
        selection_reason:
          "source_mount_only_local_pdf_renderer_selected_without_external_visual_backend",
        permission_status: "admitted",
        privacy_class: "local_only",
        resolved_backend_provider: "none",
        resolved_model_or_service: "local_pdf_page_mount",
        blocked_reason: null,
        execution_status: "executed_observation_only",
      },
      receipt: {
        source_mount_only: true,
        source_kind: "pdf_page_render",
        page_number: 8,
        source_dimensions_px: { width: 1224, height: 1584 },
        extraction_status: "not_run",
        summary:
          "Rendered scholarly PDF page 8 mounted in Image Lens without OCR or visual analysis.",
      },
    });
    const receipt = (result.call_results[0] as any).receipt;
    expect(receipt).not.toHaveProperty("scientific_evidence_packet");
    expect(receipt).not.toHaveProperty("scientific_evidence_sidecar");
  });

  it("requests exact full-text recovery when PDF page inspection has no renderable cache", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-pdf-page-inspection-cache-recovery",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "pdf-page-render:arxiv-1902.10712:page-2",
          source_kind: "pdf_page_render",
          page_image_ref: "artifact://scholarly-pdf/missing-paper.pdf/page/2",
          scholarly_source_pdf_ref:
            "artifact://scholarly-pdf/missing-paper.pdf",
          page_number: 2,
          source_mount_only: false,
          bbox_px: { x: 0, y: 0, width: 1600, height: 2200 },
          question: "Inspect page 2 of the exact selected paper.",
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]).toMatchObject({
      ok: false,
      error: "scholarly_pdf_cache_unavailable",
      observation_packet: {
        status: "missing_input",
        missing_requirements: [
          {
            code: "scholarly_pdf_cache_unavailable",
            repair_action: "fetch_full_text_before_pdf_page_navigation",
          },
        ],
      },
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("does not bypass an unconfigured visual backend for OCR or inspection", async () => {
    const sourceImageRef =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-unconfigured-page-inspection",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "pdf-page-render:page-8",
          source_kind: "pdf_page_render",
          source_image_ref: sourceImageRef,
          page_image_ref: sourceImageRef,
          page_number: 8,
          source_mount_only: false,
          bbox_px: { x: 0, y: 0, width: 1, height: 1 },
          question: "Inspect and OCR PDF page 8 in Image Lens.",
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]).toMatchObject({
      ok: false,
      lane_resolve_trace: {
        admission_status: "blocked",
        lane_status: "unconfigured",
        blocked_reason: "backend_provider_key_or_endpoint_not_configured",
        execution_status: "not_executed_shadow_only",
      },
      receipt: null,
      error: "backend_provider_key_or_endpoint_not_configured",
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("does not bypass an explicitly disabled visual lane for a local page mount", async () => {
    const sourceImageRef =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-disabled-page-mount",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "pdf-page-render:page-8",
          source_kind: "pdf_page_render",
          source_image_ref: sourceImageRef,
          page_image_ref: sourceImageRef,
          page_number: 8,
          source_mount_only: true,
          bbox_px: { x: 0, y: 0, width: 1, height: 1 },
          question: "Mount PDF page 8 in Image Lens as a source only.",
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
      env: {
        HELIX_CAPABILITY_LANE_VISUAL_ANALYSIS_ENABLED: "0",
      } as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]).toMatchObject({
      ok: false,
      lane_resolve_trace: {
        admission_status: "blocked",
        lane_status: "disabled",
        blocked_reason: "capability_lane_disabled_by_policy",
        execution_status: "not_executed_shadow_only",
      },
      receipt: null,
      error: "capability_lane_disabled_by_policy",
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("propagates exact equation block promotion through the Image Lens receipt and observation", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-image-lens-exact-equation-block",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "scholarly-pdf:2401.12345:page-8",
          source_kind: "pdf_page_render",
          source_image_ref: "artifact://scholarly-pdf/example.pdf#page=8&image",
          page_number: 8,
          bbox_px: { x: 80, y: 120, width: 1060, height: 300 },
          source_width_px: 1224,
          source_height_px: 1584,
          question:
            "Inspect and capture the complete multi-line displayed equation block labeled (47), including every displayed line and label, excluding equation (48).",
          reason_for_crop:
            "Capture equation block (47) and exclude equation (48).",
          region_label: "equation_47_block",
          region_kind: "equation",
          text_candidate: [
            "max_R",
            "Tr[-R_xs^H R_x^-1 R_xs + R_s]",
            "s.t.",
            "Tr[R + Rhat - 2(Rhat^1/2 R Rhat^1/2)^1/2] <= epsilon_0^2 (47)",
            "R >= 0, R_x > 0 (47)",
            "",
            "The first constraint quantifies covariance uncertainty.",
          ].join("\n"),
          latex_candidate: [
            "\\begin{aligned}",
            "\\max_R\\quad &\\operatorname{Tr}[-R_{xs}^{H}R_x^{-1}R_{xs}+R_s]\\\\",
            "\\text{s.t.}\\quad &\\operatorname{Tr}[R+\\hat R-2(\\hat R^{1/2}R\\hat R^{1/2})^{1/2}]\\le\\epsilon_0^2 \\tag{47}\\\\",
            "&R\\succeq0,\\quad R_x>0.",
            "\\end{aligned}",
          ].join("\n"),
          visual_layout_candidate: {
            displayed_line_count: 5,
            displayed_lines: [],
            horizontal_alignment: "aligned_at_relation",
            structure: "aligned_block",
            equation_bbox_px: { x: 20, y: 18, width: 1010, height: 250 },
            notes: [],
          },
          extraction_status: "extracted",
          uncertainty: [],
          requested_backend_provider: "openai_compatible",
        },
      },
      env: { OPENAI_API_KEY: "test-openai" } as NodeJS.ProcessEnv,
    });

    expect(result.call_results).toHaveLength(1);
    expect(result.call_results[0]?.receipt).toMatchObject({
      requested_equation_label: "47",
      equation_capture_mode: "exact_block",
      label_match_status: "matched",
      visual_layout_candidate: expect.objectContaining({
        displayed_line_count: 5,
        displayed_lines: [
          "max_R",
          "Tr[-R_xs^H R_x^-1 R_xs + R_s]",
          "s.t.",
          "Tr[R + Rhat - 2(Rhat^1/2 R Rhat^1/2)^1/2] <= epsilon_0^2 (47)",
          "R >= 0, R_x > 0 (47)",
        ],
        notes: expect.arrayContaining([
          "displayed_lines_recovered_from_bounded_ocr_block",
        ]),
      }),
      exact_equation_admissibility: "admissible_for_exact_equation",
      exact_row_promotion: expect.objectContaining({
        status: "not_applicable",
      }),
      exact_block_promotion: expect.objectContaining({
        status: "promoted",
        reasons: expect.arrayContaining(["complete_multi_line_equation_block"]),
      }),
      scientific_evidence_packet: expect.objectContaining({
        equation_capture_mode: "exact_block",
        exact_block_promotion: expect.objectContaining({ status: "promoted" }),
        block_quality_diagnostics: expect.objectContaining({
          complete_block_candidate: true,
        }),
      }),
    });
    expect(result.observation_packets[0]).toMatchObject({
      capability_key: "visual_analysis.inspect_image_region",
      status: "succeeded",
      state_delta: {
        visual_analysis_region_inspection: expect.objectContaining({
          equation_capture_mode: "exact_block",
          exact_block_promotion: expect.objectContaining({
            status: "promoted",
          }),
        }),
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("keeps an inferred exact-block label but does not recover mismatched displayed lines", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-image-lens-exact-equation-block-mismatch",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "scholarly-pdf:2401.12345:page-8",
          source_kind: "pdf_page_render",
          source_image_ref: "artifact://scholarly-pdf/example.pdf#page=8&image",
          page_number: 8,
          bbox_px: { x: 80, y: 120, width: 1060, height: 300 },
          question:
            "Capture the complete equation block labeled (47), excluding equation (48).",
          reason_for_crop: "The bounded crop must exclude (48).",
          region_kind: "equation",
          text_candidate: [
            "max_R",
            "objective",
            "s.t.",
            "constraint",
            "(47)",
            "",
            "Problem (47) follows.",
          ].join("\n"),
          latex_candidate: "\\max_R objective \\\\ s.t. constraint \\tag{47}",
          visual_layout_candidate: {
            displayed_line_count: 6,
            displayed_lines: [],
            horizontal_alignment: "left",
            structure: "multi_line",
            equation_bbox_px: { x: 20, y: 18, width: 1010, height: 250 },
            notes: [],
          },
          extraction_status: "extracted",
          uncertainty: [],
        },
      },
      env: { OPENAI_API_KEY: "test-openai" } as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]?.receipt).toMatchObject({
      requested_equation_label: "47",
      equation_capture_mode: "exact_block",
      label_match_status: "matched",
      visual_layout_candidate: expect.objectContaining({
        displayed_line_count: 6,
        displayed_lines: [],
      }),
      exact_block_promotion: expect.objectContaining({
        status: "partial",
        reasons: expect.arrayContaining(["displayed_lines_incomplete"]),
      }),
    });
  });

  it("recovers context comparison rows from bounded flattened LaTeX without promoting exact-block authority", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-image-lens-context-equation-comparison",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "scholarly-pdf:2401.12345:page-8",
          source_kind: "pdf_page_render",
          source_image_ref: "artifact://scholarly-pdf/example.pdf#page=8&image",
          page_number: 8,
          bbox_px: { x: 120, y: 205, width: 500, height: 120 },
          source_width_px: 1224,
          source_height_px: 1584,
          question:
            "Compare the OCR symbols row by row. Do not promote exact-block evidence unless all rows and label (47) agree.",
          reason_for_crop:
            "Compare the bounded equation context with saved page text.",
          region_label: "scholarly_pdf_page_8_equation_pass",
          region_kind: "equation",
          equation_capture_mode: "context",
          text_candidate:
            "max R Tr [− R^h_s R^−1_x R_xs + R_s] s.t. Tr [R + Rhat − 2(Rhat^1/2 R Rhat^1/2)^1/2] <= epsilon^2_0 (47) R >= 0, R_x > 0.",
          latex_candidate:
            "max R \\ Tr [-R_h R_x^{-1} R_{xs} + R_s] \\ \\mathrm{s.t.} \\ Tr [R + \\hat{R} - 2(\\hat{R}^{1/2} R \\hat{R}^{1/2})^{1/2}] \\leq \\epsilon_0^2 (47) \\ R \\succeq 0, R_x \\succ 0.",
          visual_layout_candidate: {
            displayed_line_count: 5,
            displayed_lines: [],
            horizontal_alignment: "left",
            structure: "multi_line",
            equation_bbox_px: { x: 0, y: 0, width: 500, height: 120 },
            notes: [],
          },
          extraction_status: "extracted",
          uncertainty: [],
        },
      },
      env: { OPENAI_API_KEY: "test-openai" } as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]?.receipt).toMatchObject({
      equation_capture_mode: "context",
      label_match_status: "not_applicable",
      visual_layout_candidate: expect.objectContaining({
        displayed_line_count: 5,
        displayed_lines: [
          "max R",
          "Tr [-R_h R_x^{-1} R_{xs} + R_s]",
          "\\mathrm{s.t.}",
          "Tr [R + \\hat{R} - 2(\\hat{R}^{1/2} R \\hat{R}^{1/2})^{1/2}] \\leq \\epsilon_0^2 (47)",
          "R \\succeq 0, R_x \\succ 0.",
        ],
        notes: expect.arrayContaining([
          "displayed_lines_recovered_from_bounded_latex_structure",
        ]),
      }),
      exact_block_promotion: expect.objectContaining({
        status: "not_applicable",
        reasons: expect.arrayContaining([
          "not_an_exact_equation_block_request",
        ]),
      }),
      evidence_role: "context_only",
    });
  });

  it("does not invent context comparison rows when the declared layout count disagrees", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-image-lens-context-equation-comparison-mismatch",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "scholarly-pdf:2401.12345:page-8",
          source_kind: "pdf_page_render",
          source_image_ref: "artifact://scholarly-pdf/example.pdf#page=8&image",
          page_number: 8,
          bbox_px: { x: 120, y: 205, width: 500, height: 120 },
          question: "Compare the bounded OCR context row by row.",
          region_kind: "equation",
          equation_capture_mode: "context",
          text_candidate: [
            "max R",
            "objective",
            "s.t.",
            "constraint (47)",
            "domain",
          ].join("\n"),
          latex_candidate: "max R \\ objective \\ constraint (47) \\ domain",
          visual_layout_candidate: {
            displayed_line_count: 4,
            displayed_lines: [],
            horizontal_alignment: "left",
            structure: "multi_line",
            equation_bbox_px: { x: 0, y: 0, width: 500, height: 120 },
            notes: [],
          },
          extraction_status: "extracted",
          uncertainty: [],
        },
      },
      env: { OPENAI_API_KEY: "test-openai" } as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]?.receipt).toMatchObject({
      equation_capture_mode: "context",
      visual_layout_candidate: expect.objectContaining({
        displayed_line_count: 4,
        displayed_lines: [],
        notes: [],
      }),
      exact_block_promotion: expect.objectContaining({
        status: "not_applicable",
      }),
      evidence_role: "context_only",
    });
  });

  it("implicitly runs Image Lens for natural scientific image sidecar prompts without bbox wording", async () => {
    const previousExtractionFixtures =
      process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      {
        region_label: "scientific_page",
        text_candidate:
          "Bianchi identities as field equations for the Weyl tensor.",
        latex_candidate: "\\nabla^{AA'}\\psi_{ABCD}=0",
        extraction_status: "extracted",
        uncertainty: ["fixture-backed OCR/math candidate"],
      },
      ...[
        "header_caption",
        "equation_block",
        "equation_3.51",
        "equation_3.52",
        "equation_3.53",
        "equation_3.54",
        "equation_3.55",
      ].map((region_label) => ({
        region_label,
        text_candidate: `${region_label} text`,
        latex_candidate: `${region_label} latex`,
        extraction_status: "partial",
        uncertainty: ["fixture-backed planned crop"],
      })),
    ]);
    try {
      const result = await runHelixCapabilityLaneOneShotRequests({
        provider: buildProvider("codex"),
        body: {
          turn_id: "turn-provider-neutral-scientific-image-implicit",
          question:
            "Here is a scientific document image. Extract the equations and compare them to the theory badge graph.",
          source_target_intent: {
            schema: "helix.ask_source_target_intent.v1",
            target_source: "scientific_image_evidence",
            target_kind: "scientific_image_evidence_sidecar",
            requested_outputs: [
              "image_lens_crop_observation",
              "scientific_evidence_packet",
              "scientific_evidence_sidecar",
              "theory_reflection",
              "calculator_payload_filter",
              "typed_failure",
            ],
          },
          mandatory_next_tool: {
            schema: "helix.mandatory_next_tool.v1",
            tool_name: "visual_analysis.inspect_image_region",
            missing_required_evidence: "scientific_evidence_sidecar",
            terminal_forbidden: true,
          },
          turn_input_items: [
            {
              type: "image",
              image_ref: "visual_evidence:scientific-page",
              image_base64: "test-image",
              mime_type: "image/png",
              evidence_id: "visual_evidence:scientific-page",
              source_kind: "image_lens_source",
              width_px: 346,
              height_px: 372,
              raw_image_included: false,
            },
          ],
        },
        env: {
          OPENAI_API_KEY: "test-openai",
          HELIX_IMAGE_LENS_EXTRACTION_FIXTURES:
            process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES,
        } as NodeJS.ProcessEnv,
      });

      expect(result.requested).toBe(true);
      expect(result.call_results).toHaveLength(8);
      const receipts = result.call_results.map(
        (entry) => entry.receipt as Record<string, unknown>,
      );
      expect(receipts.map((receipt) => receipt.region_label)).toEqual([
        "scientific_page",
        "header_caption",
        "equation_block",
        "equation_3.51",
        "equation_3.52",
        "equation_3.53",
        "equation_3.54",
        "equation_3.55",
      ]);
      expect(receipts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            region_label: "header_caption",
            bbox_px: { x: 0, y: 0, width: 346, height: 71 },
          }),
          expect.objectContaining({
            region_label: "equation_3.51",
            requested_equation_label: "3.51",
          }),
          expect.objectContaining({
            region_label: "equation_3.55",
            requested_equation_label: "3.55",
          }),
        ]),
      );
      expect(result.call_results[0]).toMatchObject({
        ok: true,
        capability: "visual_analysis.inspect_image_region",
        receipt: expect.objectContaining({
          source_kind: "image_lens_source",
          source_refs: expect.arrayContaining([
            "visual_evidence:scientific-page",
          ]),
          bbox_px: { x: 0, y: 0, width: 346, height: 372 },
          region_label: "scientific_page",
          text_candidate:
            "Bianchi identities as field equations for the Weyl tensor.",
          latex_candidate: "\\nabla^{AA'}\\psi_{ABCD}=0",
          extraction_status: "extracted",
          scientific_evidence_packet: expect.objectContaining({
            primary_domain: "weyl_bianchi",
            admissibility: expect.objectContaining({
              status: "admissible_observation",
            }),
          }),
          scientific_evidence_sidecar: expect.objectContaining({
            schema: "helix.scientific_image_evidence_sidecar.v1",
            sidecar_kind: "transient_scientific_image_evidence",
            admissibility: expect.objectContaining({
              status: "unverified_math_observation",
            }),
            exact_equation_summary: expect.objectContaining({
              promoted_row_count: 0,
            }),
          }),
        }),
      });
      expect(result.observation_packets).toHaveLength(8);
      expect(result.observation_packets[0]).toMatchObject({
        capability_key: "visual_analysis.inspect_image_region",
        status: "succeeded",
        state_delta: {
          visual_analysis_region_inspection: {
            source_id: "visual_evidence:scientific-page",
            crop_bbox_px: { x: 0, y: 0, width: 346, height: 372 },
            scientific_evidence_sidecar: expect.objectContaining({
              memory_classification: expect.objectContaining({
                memory_kind: "transient_scientific_image_evidence",
                retrieval_tags: expect.arrayContaining([
                  "scientific_image",
                  "image_lens",
                  "weyl_bianchi",
                ]),
              }),
            }),
          },
        },
      });
      expect(result.debug_projection.capability_lane_reentry_status).toBe(
        "observation_packet_required_for_provider_reentry",
      );
    } finally {
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES =
          previousExtractionFixtures;
      }
    }
  });

  it("adds planned scientific image companion crops when an explicit whole-page Image Lens call exists", async () => {
    const previousExtractionFixtures =
      process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      ...[
        "scientific_page",
        "header_caption",
        "equation_block",
        "equation_3.51",
        "equation_3.52",
        "equation_3.53",
        "equation_3.54",
        "equation_3.55",
      ].map((region_label) => ({
        region_label,
        text_candidate: `${region_label} text`,
        latex_candidate: `${region_label} latex`,
        extraction_status: "partial",
        uncertainty: ["fixture-backed planned crop"],
      })),
    ]);
    try {
      const result = await runHelixCapabilityLaneOneShotRequests({
        provider: buildProvider("codex"),
        body: {
          turn_id: "turn-provider-neutral-scientific-image-explicit-plus-plan",
          question:
            "Here is a scientific document image. Extract the visible equations as evidence only.",
          source_target_intent: {
            schema: "helix.ask_source_target_intent.v1",
            target_source: "scientific_image_evidence",
            target_kind: "scientific_image_evidence_sidecar",
            requested_outputs: ["scientific_evidence_sidecar"],
          },
          mandatory_next_tool: {
            schema: "helix.mandatory_next_tool.v1",
            tool_name: "visual_analysis.inspect_image_region",
            missing_required_evidence: "scientific_evidence_sidecar",
            terminal_forbidden: true,
          },
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: "visual_evidence:scientific-page",
            source_attachment_id: "visual_evidence:scientific-page",
            source_image_ref: "test-image",
            source_kind: "image_lens_source",
            bbox_px: { x: 0, y: 0, width: 346, height: 372 },
            region_label: "scientific_page",
            question: "Extract the whole page first.",
          },
          turn_input_items: [
            {
              type: "image",
              image_ref: "visual_evidence:scientific-page",
              image_base64: "test-image",
              mime_type: "image/png",
              evidence_id: "visual_evidence:scientific-page",
              source_kind: "image_lens_source",
              width_px: 346,
              height_px: 372,
            },
          ],
        },
        env: {
          OPENAI_API_KEY: "test-openai",
          HELIX_IMAGE_LENS_EXTRACTION_FIXTURES:
            process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES,
        } as NodeJS.ProcessEnv,
      });

      expect(result.call_results).toHaveLength(8);
      expect(
        result.call_results.map((entry) => entry.receipt?.region_label),
      ).toEqual([
        "scientific_page",
        "header_caption",
        "equation_block",
        "equation_3.51",
        "equation_3.52",
        "equation_3.53",
        "equation_3.54",
        "equation_3.55",
      ]);
      expect(result.observation_packets).toHaveLength(8);
      expect(result.call_results[1].receipt).toMatchObject({
        region_label: "header_caption",
        bbox_px: { x: 0, y: 0, width: 346, height: 71 },
      });
    } finally {
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES =
          previousExtractionFixtures;
      }
    }
  });

  it("classifies exact equation crop labels and local OCR quality risks", () => {
    const matched = buildScientificEvidencePacket({
      cropRegionId: "equation_3.53",
      sourceRefHash: "test-source",
      sourceKind: "image_lens_source",
      bboxPx: { x: 0, y: 187, width: 346, height: 59 },
      requestedEquationLabel: "3.53",
      regionLabel: "equation_3.53",
      textCandidate: "3(\\nabla_a \\Phi_b)D_c - S_c\\Phi_b = 0 (3.53)",
      latexCandidate: "3(\\nabla_a \\Phi_b)D_c - S_c\\Phi_b = 0 \\tag{3.53}",
      extractionStatus: "extracted",
      uncertainty: [],
    });
    expect(matched).toMatchObject({
      evidence_role: "exact_equation_candidate",
      requested_equation_label: "3.53",
      observed_equation_labels: expect.arrayContaining(["3.53"]),
      label_match_status: "matched",
      exact_equation_admissibility: "admissible_for_exact_equation",
      exact_row_promotion: expect.objectContaining({ status: "promoted" }),
      row_quality_diagnostics: expect.objectContaining({
        row_contains_requested_label: true,
        row_contains_multiple_equation_like_lines: false,
        needs_higher_resolution_source: false,
      }),
      quality_flags: [],
      retry_debug: expect.objectContaining({ retry_count: 0 }),
    });

    const unboundObservedLabel = buildScientificEvidencePacket({
      cropRegionId: "equation_row_search_5",
      sourceRefHash: "test-source",
      sourceKind: "image_lens_source",
      bboxPx: { x: 150, y: 258, width: 440, height: 36 },
      regionLabel: "equation_row_search_5",
      textCandidate:
        "s.t. Tr[R + R - 2(R^{1/2}RR^{1/2})^{1/2}] <= epsilon_0^2 (4)",
      latexCandidate:
        "\\mathrm{s.t.}\\;\\operatorname{Tr}[R + R - 2(R^{1/2}RR^{1/2})^{1/2}] \\leq \\epsilon_0^2 (4)",
      extractionStatus: "extracted",
      uncertainty: [],
    });
    expect(unboundObservedLabel).toMatchObject({
      requested_equation_label: null,
      observed_equation_labels: ["4"],
      label_match_status: "not_applicable",
      exact_equation_admissibility: "partial_candidate",
      exact_row_promotion: expect.objectContaining({
        status: "partial",
        reasons: expect.arrayContaining([
          "observed_equation_label_without_requested_binding",
        ]),
      }),
      quality_flags: expect.arrayContaining([
        "observed_equation_label_without_requested_binding",
      ]),
    });

    const mismatched = buildScientificEvidencePacket({
      cropRegionId: "equation_3.52",
      sourceRefHash: "test-source",
      sourceKind: "image_lens_source",
      bboxPx: { x: 0, y: 128, width: 346, height: 59 },
      requestedEquationLabel: "3.52",
      regionLabel: "equation_3.52",
      textCandidate:
        "As in Chapter 2 the invented formalism may be written: \\Delta\\psi = 0 (2.52)",
      latexCandidate: "\\Delta\\psi = 0 \\tag{2.52}",
      extractionStatus: "extracted",
      uncertainty: [],
    });
    expect(mismatched).toMatchObject({
      observed_equation_labels: expect.arrayContaining(["2.52"]),
      label_match_status: "mismatched",
      exact_equation_admissibility: "inadmissible_for_exact_equation",
      exact_row_promotion: expect.objectContaining({
        status: "rejected",
        reasons: expect.arrayContaining(["label_match_status:mismatched"]),
      }),
      admissibility: expect.objectContaining({
        status: "inadmissible_for_exact_mapping",
      }),
      quality_flags: expect.arrayContaining([
        "mismatched_equation_label",
        "row_crop_contains_page_prose_or_invented_formalism",
      ]),
      retry_debug: expect.objectContaining({ retry_count: 1 }),
    });
    expect(mismatched.uncertainty.join("\n")).toContain("local_quality_gate");

    const corrupted = buildScientificEvidencePacket({
      cropRegionId: "equation_3.54",
      sourceRefHash: "test-source",
      sourceKind: "image_lens_source",
      bboxPx: { x: 0, y: 246, width: 346, height: 59 },
      requestedEquationLabel: "3.54",
      regionLabel: "equation_3.54",
      textCandidate: "\\ abla_{\\mu} Î¨ ... (3.54)",
      latexCandidate: "\\ abla_{\\mu} \\Psi \\ldots \\tag{3.54}",
      extractionStatus: "extracted",
      uncertainty: [],
    });
    expect(corrupted).toMatchObject({
      label_match_status: "matched",
      exact_equation_admissibility: "partial_candidate",
      exact_row_promotion: expect.objectContaining({ status: "partial" }),
      quality_flags: expect.arrayContaining([
        "mojibake_or_corrupted_symbol_text",
        "ellipsized_or_truncated_equation",
        "malformed_latex_candidate",
      ]),
    });
    expect(corrupted.uncertainty.join("\n")).toContain("corrupted symbols");

    const multiLineMatched = buildScientificEvidencePacket({
      cropRegionId: "equation_3.52",
      sourceRefHash: "test-source",
      sourceKind: "image_lens_source",
      bboxPx: { x: 0, y: 128, width: 346, height: 59 },
      requestedEquationLabel: "3.52",
      regionLabel: "equation_3.52",
      textCandidate:
        "36 \\gamma_1 + 7\\phi_2 (3.52)\n3(\\delta\\phi_1 - \\delta\\phi_2) = 0",
      latexCandidate:
        "36 \\gamma_1 + 7\\phi_2 \\tag{3.52}\n3(\\delta\\phi_1 - \\delta\\phi_2) = 0",
      extractionStatus: "extracted",
      uncertainty: [],
    });
    expect(multiLineMatched).toMatchObject({
      label_match_status: "matched",
      exact_equation_admissibility: "partial_candidate",
      exact_row_promotion: expect.objectContaining({
        status: "partial",
        reasons: expect.arrayContaining([
          "row_crop_contains_multiple_equation_lines",
        ]),
      }),
      row_quality_diagnostics: expect.objectContaining({
        row_contains_multiple_equation_like_lines: true,
      }),
      admissibility: expect.objectContaining({
        status: "unverified_math_observation",
      }),
      quality_flags: expect.arrayContaining([
        "row_crop_contains_multiple_equation_lines",
      ]),
    });

    const textOnlyLabel = buildScientificEvidencePacket({
      cropRegionId: "equation_3.55",
      sourceRefHash: "test-source",
      sourceKind: "image_lens_source",
      bboxPx: { x: 0, y: 305, width: 346, height: 56 },
      requestedEquationLabel: "3.55",
      regionLabel: "equation_3.55",
      textCandidate: "-(\\phi^1\\gamma^1 - \\rho_{\\phi\\phi}) = 0 (3.55)",
      latexCandidate: "-(\\phi^1\\gamma^1 - \\rho_{\\phi\\phi}) = 0",
      extractionStatus: "extracted",
      uncertainty: [],
    });
    expect(textOnlyLabel).toMatchObject({
      label_match_status: "matched",
      exact_equation_admissibility: "partial_candidate",
      exact_row_promotion: expect.objectContaining({ status: "partial" }),
      quality_flags: expect.arrayContaining([
        "requested_label_missing_from_latex_candidate",
      ]),
    });

    const contextFormalism = buildScientificEvidencePacket({
      cropRegionId: "scientific_page",
      sourceRefHash: "test-source",
      sourceKind: "image_lens_source",
      bboxPx: { x: 0, y: 0, width: 346, height: 361 },
      regionLabel: "scientific_page",
      textCandidate: "In the Penrose-Walker formalism they may be written:",
      latexCandidate: "\\nabla^\\mu\\psi_\\nu=0",
      extractionStatus: "partial",
      uncertainty: [],
    });
    expect(contextFormalism).toMatchObject({
      evidence_role: "context_only",
      admissibility: expect.objectContaining({
        status: "unverified_math_observation",
      }),
      quality_flags: expect.arrayContaining([
        "context_crop_contains_unverified_formalism_prose",
        "partial_extraction_status",
      ]),
    });
  });

  it("derives planned scientific image crop dimensions from attached image bytes when width metadata is missing", async () => {
    const previousExtractionFixtures =
      process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
    const sourcePng = (
      await sharp({
        create: {
          width: 20,
          height: 100,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .png()
        .toBuffer()
    ).toString("base64");
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify([
      ...[
        "scientific_page",
        "header_caption",
        "equation_block",
        "equation_3.51",
        "equation_3.52",
        "equation_3.53",
        "equation_3.54",
        "equation_3.55",
      ].map((region_label) => ({
        region_label,
        text_candidate: `${region_label} text`,
        extraction_status: "partial",
        uncertainty: ["fixture-backed planned crop"],
      })),
    ]);
    try {
      const result = await runHelixCapabilityLaneOneShotRequests({
        provider: buildProvider("codex"),
        body: {
          turn_id: "turn-provider-neutral-scientific-image-byte-dimensions",
          question:
            "Here is a scientific document image. Extract the visible equations as evidence only.",
          source_target_intent: {
            schema: "helix.ask_source_target_intent.v1",
            target_source: "scientific_image_evidence",
            target_kind: "scientific_image_evidence_sidecar",
            requested_outputs: ["scientific_evidence_sidecar"],
          },
          mandatory_next_tool: {
            schema: "helix.mandatory_next_tool.v1",
            tool_name: "visual_analysis.inspect_image_region",
            missing_required_evidence: "scientific_evidence_sidecar",
            terminal_forbidden: true,
          },
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: "visual_evidence:scientific-page",
            source_attachment_id: "visual_evidence:scientific-page",
            source_image_ref: `data:image/png;base64,${sourcePng}`,
            source_kind: "image_lens_source",
            bbox_px: { x: 0, y: 0, width: 20, height: 100 },
            region_label: "scientific_page",
            question: "Extract the whole page first.",
          },
          turn_input_items: [
            {
              type: "image",
              image_ref: "visual_evidence:scientific-page",
              image_base64: sourcePng,
              mime_type: "image/png",
              evidence_id: "visual_evidence:scientific-page",
              source_kind: "image_lens_source",
            },
          ],
        },
        env: {
          OPENAI_API_KEY: "test-openai",
          HELIX_IMAGE_LENS_EXTRACTION_FIXTURES:
            process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES,
        } as NodeJS.ProcessEnv,
      });

      expect(result.call_results).toHaveLength(8);
      expect(result.call_results[1].receipt).toMatchObject({
        region_label: "header_caption",
        bbox_px: { x: 0, y: 0, width: 20, height: 40 },
      });
      expect(result.call_results[2].receipt).toMatchObject({
        region_label: "equation_block",
        bbox_px: { x: 0, y: 40, width: 20, height: 60 },
      });
    } finally {
      if (previousExtractionFixtures === undefined) {
        delete process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES;
      } else {
        process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES =
          previousExtractionFixtures;
      }
    }
  });

  it("marks Image Lens crops without extraction payload as failed observation evidence", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-neutral-image-lens-no-extraction",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "image-lens-source:no-extraction",
          source_image_ref: "ephemeral://image/no-extraction",
          bbox_px: { x: 2, y: 3, width: 40, height: 50 },
          question: "Read this crop.",
          reason_for_crop: "The prompt requested a focused visual observation.",
        },
      },
      env: { OPENAI_API_KEY: "test-openai" } as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]).toMatchObject({
      ok: true,
      receipt: {
        bbox_px: { x: 2, y: 3, width: 40, height: 50 },
        extraction_status: "failed",
        uncertainty: expect.arrayContaining([
          "No Image Lens OCR/math/layout extraction backend returned text_candidate, latex_candidate, or visual_layout_candidate for this crop.",
          expect.stringContaining("local_quality_gate"),
        ]),
        document_region_receipt: {
          extraction: {
            status: "rejected",
          },
        },
      },
      observation: {
        extraction_status: "failed",
        uncertainty: expect.arrayContaining([
          "No Image Lens OCR/math/layout extraction backend returned text_candidate, latex_candidate, or visual_layout_candidate for this crop.",
          expect.stringContaining("local_quality_gate"),
        ]),
      },
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(result.observation_packets[0]).toMatchObject({
      status: "succeeded",
      observation_summary: expect.stringContaining("extraction_status=failed"),
      state_delta: {
        visual_analysis_region_inspection: {
          extraction_status: "failed",
          text_candidate: null,
          latex_candidate: null,
        },
      },
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("fails Image Lens source materialization before filing a scientific sidecar", async () => {
    const previousVisionBase = process.env.VISION_HTTP_BASE;
    const previousVisionKey = process.env.VISION_HTTP_API_KEY;
    const previousVisionModel = process.env.VISION_HTTP_MODEL;
    process.env.VISION_HTTP_BASE = "https://vision-provider.test";
    process.env.VISION_HTTP_API_KEY = "test-vision-key";
    process.env.VISION_HTTP_MODEL = "gpt-4o-mini";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await runHelixCapabilityLaneOneShotRequests({
        provider: buildProvider("codex"),
        body: {
          turn_id:
            "turn-provider-neutral-image-lens-source-materialization-missing",
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: "image-lens-source:missing-bytes",
            source_image_ref: "ephemeral://image/missing-bytes",
            bbox_px: { x: 0, y: 0, width: 346, height: 361 },
            question: "Extract scientific document image evidence.",
            region_label: "scientific_page",
            reason_for_crop: "Scientific document image evidence extraction.",
          },
        },
        env: {
          OPENAI_API_KEY: "test-openai",
          HELIX_IMAGE_LENS_EXTRACTION_BACKEND: "vision_http",
        } as NodeJS.ProcessEnv,
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.call_results[0]).toMatchObject({
        ok: false,
        error: "image_lens_source_image_data_missing",
        receipt: null,
        observation: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(result.observation_packets[0]).toMatchObject({
        status: "missing_input",
        observation_summary: expect.stringContaining(
          "could not materialize source image data",
        ),
        missing_requirements: [
          expect.objectContaining({
            code: "missing_inline_crop_or_source_image_data",
            repair_action: "provide_inline_image_source_or_crop",
          }),
        ],
        state_delta: {},
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(JSON.stringify(result.observation_packets[0])).not.toContain(
        "scientific_image_sidecar",
      );
    } finally {
      vi.unstubAllGlobals();
      if (previousVisionBase === undefined) delete process.env.VISION_HTTP_BASE;
      else process.env.VISION_HTTP_BASE = previousVisionBase;
      if (previousVisionKey === undefined)
        delete process.env.VISION_HTTP_API_KEY;
      else process.env.VISION_HTTP_API_KEY = previousVisionKey;
      if (previousVisionModel === undefined)
        delete process.env.VISION_HTTP_MODEL;
      else process.env.VISION_HTTP_MODEL = previousVisionModel;
    }
  });

  it("runs configured Image Lens crops through the vision extraction backend", async () => {
    const previousVisionBase = process.env.VISION_HTTP_BASE;
    const previousVisionKey = process.env.VISION_HTTP_API_KEY;
    const previousVisionModel = process.env.VISION_HTTP_MODEL;
    const sourcePng =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR42mP8z8DwnwEJMDGgAcYBDAwAODsEBkXvxpUAAAAASUVORK5CYII=";
    process.env.VISION_HTTP_BASE = "https://vision-provider.test";
    process.env.VISION_HTTP_API_KEY = "test-vision-key";
    process.env.VISION_HTTP_MODEL = "gpt-4o-mini";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text_candidate: "delta psi minus nabla psi",
                  latex_candidate: "\\delta\\psi - \\nabla\\psi",
                  uncertainty: ["low source resolution"],
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await runHelixCapabilityLaneOneShotRequests({
        provider: buildProvider("codex"),
        body: {
          turn_id: "turn-provider-neutral-image-lens-vision-backend",
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: "image-lens-source:vision-backend",
            source_image_ref: `data:image/png;base64,${sourcePng}`,
            bbox_px: { x: 0, y: 0, width: 1, height: 1 },
            question: "Extract the visible equation.",
            region_label: "equation_3.51",
            requested_equation_label: "3.51",
          },
        },
        env: {
          OPENAI_API_KEY: "test-openai",
          HELIX_IMAGE_LENS_EXTRACTION_BACKEND: "vision_http",
        } as NodeJS.ProcessEnv,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const fetchBody = JSON.parse(
        String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"),
      );
      expect(fetchBody.messages[0].content[0].text).toContain(
        "requested_equation_label: 3.51",
      );
      expect(fetchBody.messages[0].content[0].text).toContain(
        "bbox_px: 0,0,2,2",
      );
      expect(fetchBody.messages[0].content[1].image_url.url).toContain(
        "data:image/png;base64,",
      );
      expect(result.call_results[0]).toMatchObject({
        ok: true,
        receipt: {
          bbox_px: { x: 0, y: 0, width: 2, height: 2 },
          text_candidate: "delta psi minus nabla psi",
          latex_candidate: "\\delta\\psi - \\nabla\\psi",
          extraction_status: "extracted",
          uncertainty: expect.arrayContaining([
            "low source resolution",
            expect.stringContaining("local_quality_gate"),
          ]),
          document_region_receipt: {
            extraction: {
              textCandidate: "delta psi minus nabla psi",
              latexCandidate: "\\delta\\psi - \\nabla\\psi",
              status: "candidate",
            },
          },
        },
        observation: {
          text_candidate: "delta psi minus nabla psi",
          latex_candidate: "\\delta\\psi - \\nabla\\psi",
          extraction_status: "extracted",
          uncertainty: expect.arrayContaining([
            "low source resolution",
            expect.stringContaining("local_quality_gate"),
          ]),
        },
      });
      expect(result.observation_packets[0]).toMatchObject({
        state_delta: {
          visual_analysis_region_inspection: {
            requested_equation_label: "3.51",
            crop_bbox_px: { x: 0, y: 0, width: 2, height: 2 },
            text_candidate: "delta psi minus nabla psi",
            latex_candidate: "\\delta\\psi - \\nabla\\psi",
            extraction_status: "extracted",
            uncertainty: expect.arrayContaining([
              "low source resolution",
              expect.stringContaining("local_quality_gate"),
            ]),
          },
        },
        terminal_eligible: false,
        assistant_answer: false,
      });
    } finally {
      vi.unstubAllGlobals();
      if (previousVisionBase === undefined) delete process.env.VISION_HTTP_BASE;
      else process.env.VISION_HTTP_BASE = previousVisionBase;
      if (previousVisionKey === undefined)
        delete process.env.VISION_HTTP_API_KEY;
      else process.env.VISION_HTTP_API_KEY = previousVisionKey;
      if (previousVisionModel === undefined)
        delete process.env.VISION_HTTP_MODEL;
      else process.env.VISION_HTTP_MODEL = previousVisionModel;
    }
  });

  it("expands degenerate Image Lens crop_image_ref data-url bboxes to the image dimensions", async () => {
    const sourcePng =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR42mP8z8DwnwEJMDGgAcYBDAwAODsEBkXvxpUAAAAASUVORK5CYII=";
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-neutral-image-lens-degenerate-crop-data-url",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "image-lens-source:crop-data-url",
          crop_image_ref: `data:image/png;base64,${sourcePng}`,
          bbox_px: { x: 0, y: 0, width: 1, height: 1 },
          region_label: "scientific_page",
        },
      },
      env: { OPENAI_API_KEY: "test-openai" } as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]).toMatchObject({
      ok: true,
      receipt: {
        bbox_px: { x: 0, y: 0, width: 2, height: 2 },
      },
    });
    expect(result.observation_packets[0]).toMatchObject({
      status: "succeeded",
      state_delta: {
        visual_analysis_region_inspection: {
          crop_bbox_px: { x: 0, y: 0, width: 2, height: 2 },
        },
      },
    });
  });

  it("recovers fenced malformed Image Lens JSON into structured text and LaTeX candidates", async () => {
    const previousVisionBase = process.env.VISION_HTTP_BASE;
    const previousVisionKey = process.env.VISION_HTTP_API_KEY;
    const previousVisionModel = process.env.VISION_HTTP_MODEL;
    const sourcePng =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR42mP8z8DwnwEJMDGgAcYBDAwAODsEBkXvxpUAAAAASUVORK5CYII=";
    process.env.VISION_HTTP_BASE = "https://vision-provider.test";
    process.env.VISION_HTTP_API_KEY = "test-vision-key";
    process.env.VISION_HTTP_MODEL = "gpt-4o-mini";
    const malformedExtraction = [
      "```json",
      "{",
      '  "text_candidate": "As in Chapter 2\\\\nfield equations",',
      '  "latex_candidate":',
      '    "\\\\( A = B \\\\) (3.51)\\\\n"',
      '    + "\\\\( C = D \\\\) (3.52)",',
      '  "uncertainty": ["low readability", "text alignment issues"]',
      "}",
      "```",
    ].join("\n");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: malformedExtraction,
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await runHelixCapabilityLaneOneShotRequests({
        provider: buildProvider("codex"),
        body: {
          turn_id: "turn-provider-neutral-image-lens-malformed-json",
          capability_lane_call: {
            capability: "visual_analysis.inspect_image_region",
            source_id: "image-lens-source:malformed-json",
            source_image_ref: `data:image/png;base64,${sourcePng}`,
            bbox_px: { x: 0, y: 0, width: 2, height: 2 },
            region_label: "equation_block",
          },
        },
        env: {
          OPENAI_API_KEY: "test-openai",
          HELIX_IMAGE_LENS_EXTRACTION_BACKEND: "vision_http",
        } as NodeJS.ProcessEnv,
      });

      expect(result.call_results[0]).toMatchObject({
        ok: true,
        receipt: {
          text_candidate: "As in Chapter 2\\nfield equations",
          latex_candidate: "\\( A = B \\) (3.51)\\n\\( C = D \\) (3.52)",
          extraction_status: "extracted",
          uncertainty: ["low readability", "text alignment issues"],
        },
      });
      expect(result.call_results[0].receipt).not.toMatchObject({
        text_candidate: expect.stringContaining("```json"),
      });
    } finally {
      vi.unstubAllGlobals();
      if (previousVisionBase === undefined) delete process.env.VISION_HTTP_BASE;
      else process.env.VISION_HTTP_BASE = previousVisionBase;
      if (previousVisionKey === undefined)
        delete process.env.VISION_HTTP_API_KEY;
      else process.env.VISION_HTTP_API_KEY = previousVisionKey;
      if (previousVisionModel === undefined)
        delete process.env.VISION_HTTP_MODEL;
      else process.env.VISION_HTTP_MODEL = previousVisionModel;
    }
  });

  it("reports missing Image Lens source as missing input without terminal authority", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-neutral-image-lens-missing-source",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          bbox_px: { x: 0, y: 0, width: 20, height: 20 },
        },
      },
      env: { OPENAI_API_KEY: "test-openai" } as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]).toMatchObject({
      ok: false,
      error: "missing_source_id",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packets[0]).toMatchObject({
      status: "missing_input",
      missing_requirements: [
        expect.objectContaining({
          code: "missing_source_id",
          repair_action: "provide_source_id",
        }),
      ],
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("normalizes invalid Image Lens bbox values into a stable positive crop", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-neutral-image-lens-bbox",
        capability_lane_call: {
          capability: "visual_analysis.inspect_image_region",
          source_id: "image-lens-source:bbox",
          source_image_ref: "ephemeral://image/bbox",
          bbox_px: { x: -4.8, y: 9.9, width: 0, height: -2 },
        },
      },
      env: { OPENAI_API_KEY: "test-openai" } as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]).toMatchObject({
      ok: true,
      receipt: {
        bbox_px: { x: 0, y: 9, width: 1, height: 1 },
        crop_image_ref: "ephemeral://image/bbox#crop=0,9,1,1",
      },
    });
    expect(result.observation_packets[0]).toMatchObject({
      status: "succeeded",
      state_delta: {
        visual_analysis_region_inspection: {
          crop_bbox_px: { x: 0, y: 9, width: 1, height: 1 },
        },
      },
    });
  });

  it("projects future lane calls and governed TTS receipts as non-terminal observations", async () => {
    const result = await withRuntimeMemoryGuardDisabled(() =>
      runHelixCapabilityLaneOneShotRequests({
        provider: buildProvider("codex"),
        body: {
          turn_id: "turn-provider-neutral-shadow-lanes",
          capability_lane_call: [
            {
              capability: "visual_analysis.inspect_frame",
              requested_backend_provider: "openai_compatible",
              frame_ref: "frame:test",
            },
            {
              capability: "text_to_speech.speak_text",
              requested_backend_provider: "elevenlabs",
              text: "checking now",
              voice: "dottie_default",
              locale: "en-US",
              source_observation_ref: "obs:test:voice-source",
            },
          ],
        },
        env: {
          OPENAI_API_KEY: "test-openai",
          ELEVENLABS_API_KEY: "test-eleven",
        } as NodeJS.ProcessEnv,
      }),
    );

    expect(result).toMatchObject({
      requested: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.call_results).toHaveLength(2);
    expect(result.call_results[0]).toMatchObject({
      schema: "helix.capability_lane.shadow_one_shot_result.v1",
      ok: false,
      lane_id: "visual_analysis",
      capability: "visual_analysis.inspect_frame",
      error: "capability_lane_shadow_only_not_executed",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.call_results[1]).toMatchObject({
      schema: "helix.text_to_speech.one_shot_result.v1",
      ok: true,
      lane_id: "text_to_speech",
      capability: "text_to_speech.speak_text",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      receipt: {
        schema: "helix.text_to_speech.receipt.v1",
        capability: "text_to_speech.speak_text",
        playback_status: "pending",
        provider_playback_status: "awaiting_client_playback",
        playback_request_ref: expect.any(String),
        client_playback_receipt_ref: null,
        source_text_hash: expect.any(String),
        audio_bytes_observed: false,
        voice_profile: "dottie_default",
        locale: "en-US",
        source_observation_ref: "obs:test:voice-source",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    });
    expect(result.resolve_traces[0]).toMatchObject({
      requested_lane: "visual_analysis",
      requested_backend_provider: "openai_compatible",
      selected_backend_provider: "visual_analysis.openai_compatible",
      execution_status: "not_executed_shadow_only",
      blocked_reason: "capability_lane_shadow_only_not_executed",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.resolve_traces[1]).toMatchObject({
      requested_lane: "text_to_speech",
      requested_backend_provider: "elevenlabs",
      requested_backend_provider_known: true,
      requested_backend_fallback_provider:
        "text_to_speech.existing_voice_service",
      selected_backend_provider: "text_to_speech.existing_voice_service",
      execution_status: "executed_observation_only",
      blocked_reason: null,
    });
    expect(result.observation_packets.map((packet) => packet.status)).toEqual([
      "blocked",
      "client_pending",
    ]);
    expect(result.observation_packets[0]?.state_delta).toMatchObject({
      capability_lane_shadow_execution: {
        lane_id: "visual_analysis",
        capability: "visual_analysis.inspect_frame",
        requested_backend_provider: "openai_compatible",
        selected_backend_provider: "visual_analysis.openai_compatible",
        selection_reason:
          "selected_requested_backend_provider_for_shadow_manifest",
        availability_status: "dry_run",
        permission_status: "admitted",
        cost_class: "standard",
        latency_class: "interactive",
        privacy_class: "external_provider",
        fallback_backend_provider: null,
        execution_status: "not_executed_shadow_only",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(
      result.observation_packets[0]?.backend_selection_decision,
    ).toMatchObject({
      outcome: "requested_selected",
      requested_backend_provider: "openai_compatible",
      selected_backend_provider: "visual_analysis.openai_compatible",
      selected_runtime_provider_remains_root: true,
      backend_provider_becomes_root_agent: false,
      dynamic_switching_executed: false,
      live_backend_execution_enabled: false,
      terminal_authority_owner: "helix",
    });
    expect(result.observation_packets[1]?.state_delta).toMatchObject({
      text_to_speech_receipt: {
        lane_id: "text_to_speech",
        capability: "text_to_speech.speak_text",
        requested_backend_provider: "elevenlabs",
        selected_backend_provider: "text_to_speech.existing_voice_service",
        playback_status: "pending",
        source_text_hash: expect.any(String),
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(result.observation_packets[1]?.produced_affordances).toEqual([
      expect.objectContaining({
        kind: "voice_playback_receipt",
        source_capability: "text_to_speech.speak_text",
        artifact_ref: result.call_results[1]?.receipt?.receipt_ref,
        status: "available",
        assistant_answer: false,
        raw_content_included: false,
      }),
    ]);
    expect(result.observation_packets[1]?.typed_handoff_contract).toMatchObject(
      {
        produced_affordance_kinds: ["voice_playback_receipt"],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    );
    expect(result.debug_events.map((event) => event.stage)).toEqual([
      "lane_requested",
      "lane_backend_selected",
      "lane_observation",
      "lane_reentered",
      "lane_requested",
      "lane_backend_selected",
      "lane_observation",
      "lane_reentered",
    ]);
    expect(result.debug_events[2]).toMatchObject({
      stage: "lane_observation",
      lane_id: "visual_analysis",
      capability: "visual_analysis.inspect_frame",
      status: "blocked",
      execution_status: "not_executed_shadow_only",
      terminal_authority_status: "pending_helix_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.debug_events[6]).toMatchObject({
      stage: "lane_observation",
      lane_id: "text_to_speech",
      capability: "text_to_speech.speak_text",
      status: "pending",
      execution_status: "executed_observation_only",
      terminal_authority_status: "pending_helix_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.debug_events[7]).toMatchObject({
      stage: "lane_reentered",
      lane_id: "text_to_speech",
      capability: "text_to_speech.speak_text",
      status: "pending",
      observation_ref: result.resolve_traces[1]?.observation_ref,
      receipt_ref: result.resolve_traces[1]?.receipt_ref,
      reentry_status: "observation_packet_required_for_provider_reentry",
      terminal_authority_status: "pending_helix_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.debug_projection.capability_lane_reentry_status).toBe(
      "observation_packet_required_for_provider_reentry",
    );
  });

  it("composes STT, translation, and TTS lane calls as re-entered non-terminal observations", async () => {
    const result = await withRuntimeMemoryGuardDisabled(() =>
      runHelixCapabilityLaneOneShotRequests({
        provider: buildProvider("codex"),
        body: {
          turn_id: "turn-provider-neutral-stt-compose",
          capability_lane_call: [
            {
              capability: "speech_to_text.transcribe_audio",
              audio_ref: "voice:audio:compose",
              audio_hash: "audio-hash-compose",
              transcript_text: "hello workstation",
              language: "en",
              source_id: "audio_transcript:helix-ask:desktop",
              thread_id: "helix-ask:desktop",
              capture_session_id: "capture:compose",
              chunk_index: 0,
            },
            {
              capability: "live_translation.translate_text",
              text: "hello workstation",
              source_language: "en",
              target_language: "es",
              source_id: "audio_transcript:helix-ask:desktop",
              projection_target: "audio_chunk",
            },
            {
              capability: "text_to_speech.speak_text",
              text: "hola estacion de trabajo",
              source_observation_ref:
                "turn-provider-neutral-stt-compose:translation",
            },
          ],
        },
        env: {
          OPENAI_API_KEY: "test-openai",
          HELIX_LIVE_TRANSLATION_EXTERNAL_BACKENDS_ENABLED: "0",
        } as NodeJS.ProcessEnv,
      }),
    );

    expect(result.call_results.map((entry) => entry.capability)).toEqual([
      "speech_to_text.transcribe_audio",
      "live_translation.translate_text",
      "text_to_speech.speak_text",
    ]);
    expect(result.observation_packets).toHaveLength(3);
    expect(
      result.observation_packets.map((packet) => packet.capability_key),
    ).toEqual([
      "speech_to_text.transcribe_audio",
      "live_translation.translate_text",
      "text_to_speech.speak_text",
    ]);
    expect(
      result.observation_packets.every(
        (packet) => packet.terminal_eligible === false,
      ),
    ).toBe(true);
    expect(
      result.observation_packets.every(
        (packet) => packet.assistant_answer === false,
      ),
    ).toBe(true);
    expect(result.observation_packets[0]).toMatchObject({
      status: "succeeded",
      state_delta: {
        speech_to_text_observation: expect.objectContaining({
          schema: "helix.speech_to_text.observation.v1",
          source_kind: "audio_transcript",
          stage_play_mail_id: expect.stringMatching(
            /^stage_play_live_source_mail:/,
          ),
          terminal_eligible: false,
          assistant_answer: false,
          raw_audio_included: false,
        }),
        speech_to_text_live_source_mail_item: expect.objectContaining({
          sourceKind: "audio_transcript",
          status: "unread",
          context_role: "tool_evidence",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      },
    });
    expect(result.observation_packets[1]).toMatchObject({
      status: "succeeded",
      state_delta: {
        live_translation_chunk: expect.objectContaining({
          projection_target: "audio_chunk",
          source_id: "audio_transcript:helix-ask:desktop",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      },
    });
    expect(result.observation_packets[2]).toMatchObject({
      status: "client_pending",
      state_delta: {
        text_to_speech_receipt: expect.objectContaining({
          capability: "text_to_speech.speak_text",
          playback_status: "pending",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      },
    });
    expect(
      result.debug_events
        .filter((event) => event.stage === "lane_observation")
        .map((event) => event.capability),
    ).toEqual([
      "speech_to_text.transcribe_audio",
      "live_translation.translate_text",
      "text_to_speech.speak_text",
    ]);
    expect(result.debug_projection.capability_lane_reentry_status).toBe(
      "observation_packet_required_for_provider_reentry",
    );
  });

  it("bridges scholarly recovery lane requests through the governed gateway", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-neutral-scholarly-missing-query",
        capability_lane_call: {
          capability: "scholarly-research.lookup_papers",
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.requested).toBe(true);
    expect(result.call_results).toHaveLength(1);
    expect(result.call_results[0]).toMatchObject({
      schema: "helix.workstation_tool_reference.gateway_bridge_result.v1",
      ok: false,
      lane_id: "workstation_tool_reference",
      capability: "scholarly-research.lookup_papers",
      delegated_capability_id: "scholarly-research.lookup_papers",
      delegation_status: "gateway_executed",
      selected_runtime_agent_provider: "codex",
      arguments: {},
      error: "missing_query",
      reentry_required: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      delegated_gateway_call_result: {
        schema: "helix.workstation_tool_gateway.call_result.v1",
        ok: false,
        capability_id: "scholarly-research.lookup_papers",
        error: "missing_query",
      },
    });
    expect(result.observation_packets[0]).toMatchObject({
      capability_key: "scholarly-research.lookup_papers",
      status: "blocked",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.resolve_traces[0]).toMatchObject({
      requested_lane: "workstation_tool_reference",
      execution_status: "executed_observation_only",
      blocked_reason: "missing_query",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("bridges calculator lane requests through the governed gateway for provider re-entry", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-neutral-calculator",
        capability_lane_call: {
          capability: "scientific-calculator.solve_expression",
          arguments: { expression: "8 * 9" },
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.requested).toBe(true);
    expect(result.call_results).toHaveLength(1);
    expect(result.call_results[0]).toMatchObject({
      schema: "helix.workstation_tool_reference.gateway_bridge_result.v1",
      ok: true,
      lane_id: "workstation_tool_reference",
      capability: "scientific-calculator.solve_expression",
      delegated_capability_id: "scientific-calculator.solve_expression",
      delegation_status: "gateway_executed",
      selected_runtime_agent_provider: "codex",
      arguments: { expression: "8 * 9" },
      reentry_required: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      delegated_gateway_call_result: {
        ok: true,
        capability_id: "scientific-calculator.solve_expression",
        observation: {
          schema: "helix.calculator_solve_observation.v1",
          expression: "8 * 9",
          result: "72",
        },
      },
    });
    expect(result.observation_packets[0]).toMatchObject({
      capability_key: "scientific-calculator.solve_expression",
      status: "succeeded",
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(result.resolve_traces[0]).toMatchObject({
      requested_lane: "workstation_tool_reference",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("bridges Codex docs.search requests through the governed gateway for provider re-entry", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-neutral-docs-search",
        capability_lane_call: {
          capability: "docs.search",
          arguments: { query: "Casimir Dp Quantum Foam Study" },
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.requested).toBe(true);
    expect(result.call_results).toHaveLength(1);
    expect(result.call_results[0]).toMatchObject({
      schema: "helix.workstation_tool_reference.gateway_bridge_result.v1",
      lane_id: "workstation_tool_reference",
      capability: "docs.search",
      delegated_capability_id: "docs.search",
      delegation_status: "gateway_executed",
      selected_runtime_agent_provider: "codex",
      arguments: { query: "Casimir Dp Quantum Foam Study" },
      reentry_required: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      delegated_gateway_call_result: {
        capability_id: "docs.search",
      },
    });
    expect(result.resolve_traces[0]).toMatchObject({
      requested_lane: "workstation_tool_reference",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(result.observation_packets[0].capability_key).toBe("docs.search");
    expect(result.observation_packets[0].post_tool_model_step_required).toBe(
      true,
    );
  });

  it("bridges any account-authorized gateway capability not covered by a specialized lane handler", async () => {
    const repoSearch = listWorkstationGatewayCapabilities({
      mode: "act",
    }).capabilities.find(
      (capability) => capability.capability_id === "repo.search",
    );
    expect(repoSearch).toBeDefined();

    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-neutral-governed-gateway",
        capability_lane_call: {
          capability: "repo.search",
          arguments: { query: "terminal authority" },
        },
      },
      authorizedGatewayCapabilities: repoSearch ? [repoSearch] : [],
      accountType: "user",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]).toMatchObject({
      schema: "helix.workstation_tool_reference.gateway_bridge_result.v1",
      lane_id: "workstation_tool_reference",
      capability: "repo.search",
      delegated_capability_id: "repo.search",
      delegation_status: "gateway_executed",
      arguments: { query: "terminal authority" },
      delegated_gateway_call_result: {
        capability_id: "repo.search",
      },
      reentry_required: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(result.resolve_traces[0]).toMatchObject({
      requested_lane: "workstation_tool_reference",
      execution_status: "executed_observation_only",
    });
  });

  it("normalizes a sole provider-native input envelope before governed gateway validation", async () => {
    const repoSearch = listWorkstationGatewayCapabilities({
      mode: "act",
    }).capabilities.find(
      (capability) => capability.capability_id === "repo.search",
    );
    expect(repoSearch).toBeDefined();
    const gatewayCaller = vi.fn(buildGatewayObservationStub);

    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-governed-gateway-input-envelope",
        capability_lane_call: {
          capability: "repo.search",
          arguments: {
            input: { query: "terminal authority" },
          },
        },
      },
      authorizedGatewayCapabilities: repoSearch ? [repoSearch] : [],
      gatewayCaller,
      accountType: "user",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(gatewayCaller).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: "repo.search",
        arguments: { query: "terminal authority" },
      }),
    );
    expect(result.call_results[0]).toMatchObject({
      arguments: { query: "terminal authority" },
    });
  });

  it("preserves input when it is a literal governed capability argument", async () => {
    const repoSearch = listWorkstationGatewayCapabilities({
      mode: "act",
    }).capabilities.find(
      (capability) => capability.capability_id === "repo.search",
    );
    expect(repoSearch).toBeDefined();
    const inputLiteralCapability = repoSearch
      ? {
          ...repoSearch,
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              input: { type: "object" },
            },
            required: ["input"],
          },
        }
      : null;
    const gatewayCaller = vi.fn(buildGatewayObservationStub);

    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-governed-gateway-literal-input",
        capability_lane_call: {
          capability: "repo.search",
          arguments: {
            input: { query: "terminal authority" },
          },
        },
      },
      authorizedGatewayCapabilities: inputLiteralCapability
        ? [inputLiteralCapability]
        : [],
      gatewayCaller,
      accountType: "user",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(gatewayCaller).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: {
          input: { query: "terminal authority" },
        },
      }),
    );
    expect(result.call_results[0]).toMatchObject({
      arguments: {
        input: { query: "terminal authority" },
      },
    });
  });

  it("does not unwrap an input object when provider arguments include siblings", async () => {
    const repoSearch = listWorkstationGatewayCapabilities({
      mode: "act",
    }).capabilities.find(
      (capability) => capability.capability_id === "repo.search",
    );
    expect(repoSearch).toBeDefined();
    const gatewayCaller = vi.fn(buildGatewayObservationStub);

    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-governed-gateway-ambiguous-input-envelope",
        capability_lane_call: {
          capability: "repo.search",
          arguments: {
            input: { query: "nested" },
            query: "direct",
          },
        },
      },
      authorizedGatewayCapabilities: repoSearch ? [repoSearch] : [],
      gatewayCaller,
      accountType: "user",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(gatewayCaller).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: {
          input: { query: "nested" },
          query: "direct",
        },
      }),
    );
    expect(result.call_results[0]).toMatchObject({
      arguments: {
        input: { query: "nested" },
        query: "direct",
      },
    });
  });

  it("forwards trusted account and conversation context through a governed lane", async () => {
    const workspaceStatus = listWorkstationGatewayCapabilities({
      mode: "act",
    }).capabilities.find(
      (capability) => capability.capability_id === "workspace_os.status",
    );
    expect(workspaceStatus).toBeDefined();
    const timestamp = "2026-07-29T00:00:00.000Z";
    const accountContext = {
      session_id: "account_session:capability-lane-context",
      profile_id: "profile:capability-lane-context",
      trusted_account_session: true,
      account_session: {
        schema: "helix.account_session.v1",
        session_id: "account_session:capability-lane-context",
        profile: {
          profile_id: "profile:capability-lane-context",
          display_name: "Room Operator",
          auth_mode: "guest",
          account_type: "user",
          provider: "guest",
          created_at: timestamp,
          updated_at: timestamp,
        },
        account_policy: HELIX_USER_ACCOUNT_POLICY,
        status: "active",
        memory_scope: "session_only",
        created_at: timestamp,
        updated_at: timestamp,
        expires_at: "2026-07-30T00:00:00.000Z",
      },
      account_policy: HELIX_USER_ACCOUNT_POLICY,
    } satisfies HelixWorkstationGatewayAccountContext;
    const gatewayCaller = vi.fn(
      async (
        input: Parameters<typeof callWorkstationGatewayCapability>[0],
      ) => callWorkstationGatewayCapability(input),
    );

    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "ask:test:trusted-gateway-context",
        capability_lane_call: {
          capability: "workspace_os.status",
          thread_id: "ask:test:model-supplied-turn",
        },
      },
      conversationThreadId: "helix-ask:test:visual-conversation",
      authorizedGatewayCapabilities: workspaceStatus ? [workspaceStatus] : [],
      accountType: "developer",
      accountContext,
      gatewayCaller,
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]).toMatchObject({
      schema: "helix.workstation_tool_reference.gateway_bridge_result.v1",
      capability: "workspace_os.status",
      delegated_gateway_call_result: {
        capability_id: "workspace_os.status",
      },
    });
    expect(gatewayCaller).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationThreadId: "helix-ask:test:visual-conversation",
        accountContext,
        providerExecutionId: expect.stringMatching(
          /^capability_lane_execution:[a-f0-9]{16}$/,
        ),
        toolCallId: expect.stringMatching(
          /^capability_lane_tool_call:[a-f0-9]{16}$/,
        ),
      }),
    );
  });

  it("does not execute a registered gateway capability when it is absent from the account-authorized manifest", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-neutral-unauthorized-gateway",
        capability_lane_call: {
          capability: "repo.search",
          arguments: { query: "terminal authority" },
        },
      },
      authorizedGatewayCapabilities: [],
      accountType: "user",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]).toMatchObject({
      schema: "helix.capability_lane.shadow_one_shot_result.v1",
      ok: false,
      capability: "repo.search",
      error: "unknown_capability_lane",
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(result.observation_packets[0]).toMatchObject({
      capability_key: "repo.search",
      status: "blocked",
    });
  });

  it("fails closed on unknown structured lane calls instead of dropping the request", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        turn_id: "turn-provider-neutral-unknown-lane",
        capability_lane_call: {
          capability: "random_provider.do_anything",
          requested_backend_provider: "random_provider.backend",
        },
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.requested).toBe(true);
    expect(result.call_results).toHaveLength(1);
    expect(result.call_results[0]).toMatchObject({
      schema: "helix.capability_lane.shadow_one_shot_result.v1",
      ok: false,
      lane_id: "random_provider",
      capability: "random_provider.do_anything",
      selected_runtime_agent_provider: "codex",
      error: "unknown_capability_lane",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.resolve_traces[0]).toMatchObject({
      requested_lane: "random_provider",
      lane_status: "unknown",
      admission_status: "blocked",
      requested_backend_provider: "random_provider.backend",
      requested_backend_provider_known: false,
      selected_backend_provider: null,
      execution_status: "not_executed_shadow_only",
      blocked_reason: "unknown_capability_lane",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packets[0]).toMatchObject({
      turn_id: "turn-provider-neutral-unknown-lane",
      capability_key: "random_provider.do_anything",
      status: "blocked",
      missing_requirements: [
        expect.objectContaining({
          code: "unknown_capability_lane",
          repair_action: "use_configured_lane_backend_or_supported_capability",
        }),
      ],
      state_delta: {
        capability_lane_shadow_execution: expect.objectContaining({
          lane_id: "random_provider",
          capability: "random_provider.do_anything",
          requested_backend_provider: "random_provider.backend",
          selected_backend_provider: null,
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
    expect(result.debug_events.map((event) => event.stage)).toEqual([
      "lane_requested",
      "lane_backend_selected",
      "lane_observation",
      "lane_reentered",
    ]);
    expect(result.debug_events[2]).toMatchObject({
      stage: "lane_observation",
      status: "blocked",
      lane_id: "random_provider",
      capability: "random_provider.do_anything",
      selected_backend_provider: null,
      execution_status: "not_executed_shadow_only",
      terminal_authority_status: "pending_helix_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.debug_projection.capability_lane_reentry_status).toBe(
      "observation_packet_required_for_provider_reentry",
    );
  });

  it("does not execute lane calls from prompt text alone", async () => {
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider("codex"),
      body: {
        question:
          "Please translate hello to Spanish, then inspect the crop in the image lens.",
      },
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.requested).toBe(false);
    expect(result.call_results).toEqual([]);
    expect(result.observation_packets).toEqual([]);
    expect(result.resolve_traces).toEqual([]);
    expect(result.debug_events).toEqual([]);
    expect(result.debug_projection.capability_lane_reentry_status).toBe(
      "not_requested",
    );
  });
});
