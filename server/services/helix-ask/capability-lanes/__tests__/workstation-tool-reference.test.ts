import { describe, expect, it } from "vitest";
import {
  HELIX_WORKSTATION_TOOL_REFERENCE_LIST_REQUEST_SCHEMA,
  HELIX_WORKSTATION_TOOL_REFERENCE_VISIBLE_TRANSLATION_TARGETS_REQUEST_SCHEMA,
  type HelixWorkstationToolReferenceListRequest,
  type HelixWorkstationToolReferenceVisibleTranslationTargetsRequest,
} from "@shared/helix-workstation-tool-reference-lane";
import type { HelixAgentProvider } from "../../agent-providers/types";
import {
  runWorkstationToolReferenceCollectVisibleTranslationTargets,
  runWorkstationToolReferenceListCapabilities,
} from "../workstation-tool-reference";
import {
  HELIX_LIVE_TRANSLATION_ONE_SHOT_REQUEST_SCHEMA,
  type HelixLiveTranslationOneShotRequest,
} from "@shared/helix-live-translation-lane";
import { runLiveTranslationTranslateText } from "../live-translation";

const buildProvider = (input: {
  id: "helix" | "codex";
  workstationTools?: boolean;
}): HelixAgentProvider => ({
  id: input.id,
  label: input.id === "helix" ? "Helix Ask Native" : "Codex Workstation Mode",
  permissionProfile: {
    id: input.id === "helix" ? "helix-native" : "read-observe-act",
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
    streaming: input.id === "helix",
    workstationTools: input.workstationTools ?? true,
    capabilityLanes: true,
    capabilityLaneOneShot: true,
    capabilityLaneSessions: false,
    codeMutation: false,
  },
  runTurn: async () => ({
    ok: false,
    runtime: input.id,
    response_type: "test",
    final_status: "test",
  }),
});

const request = (
  input: Partial<HelixWorkstationToolReferenceListRequest> = {},
): HelixWorkstationToolReferenceListRequest => ({
  schema: HELIX_WORKSTATION_TOOL_REFERENCE_LIST_REQUEST_SCHEMA,
  capability: "workstation_tool_reference.list_capabilities",
  mode: "act",
  requested_backend_provider: null,
  turn_id: "turn-workstation-reference",
  assistant_answer: false,
  terminal_eligible: false,
  ...input,
});

const targetRequest = (
  input: Partial<HelixWorkstationToolReferenceVisibleTranslationTargetsRequest> = {},
): HelixWorkstationToolReferenceVisibleTranslationTargetsRequest => ({
  schema: HELIX_WORKSTATION_TOOL_REFERENCE_VISIBLE_TRANSLATION_TARGETS_REQUEST_SCHEMA,
  capability: "workstation_tool_reference.collect_visible_translation_targets",
  active_panel_id: "docs-viewer",
  doc_path: "docs/research/nhm2.md",
  source_hash: "sha256:full-document-hash",
  projection_target: "docs_chunk",
  account_locale: "es-US",
  target_language: "es",
  max_chunks: 12,
  visible_only: true,
  title_text: "NHM2 frontier status",
  body_text: "The campaign remains diagnostic, not certified.",
  requested_backend_provider: null,
  turn_id: "turn-visible-translation-targets",
  assistant_answer: false,
  terminal_eligible: false,
  ...input,
});

const translationRequest = (
  input: Partial<HelixLiveTranslationOneShotRequest>,
): HelixLiveTranslationOneShotRequest => ({
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

describe("workstation_tool_reference.list_capabilities lane", () => {
  it("returns the governed workstation gateway catalog as non-terminal observation evidence", () => {
    const result = runWorkstationToolReferenceListCapabilities({
      provider: buildProvider({ id: "codex" }),
      request: request(),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      schema: "helix.workstation_tool_reference.list_result.v1",
      ok: true,
      lane_id: "workstation_tool_reference",
      capability: "workstation_tool_reference.list_capabilities",
      selected_runtime_agent_provider: "codex",
      reentry_required: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.capability_count).toBeGreaterThan(0);
    expect(result.lane_resolve_trace).toMatchObject({
      requested_lane: "workstation_tool_reference",
      selected_backend_provider: "workstation_tool_reference.helix_workstation_gateway",
      selection_reason: "selected_default_backend_provider_for_shadow_manifest",
      availability_status: "available",
      permission_status: "admitted",
      cost_class: "free_local",
      latency_class: "local",
      privacy_class: "local_only",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation).toMatchObject({
      schema: "helix.workstation_tool_reference.list_observation.v1",
      gateway_mode: "act",
      backend_selection_decision: expect.objectContaining({
        outcome: "default_selected",
        selected_backend_provider: "workstation_tool_reference.helix_workstation_gateway",
        terminal_authority_owner: "helix",
      }),
      deterministic: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.capability_ids).toContain("docs.search");
    expect(result.observation?.capabilities[0]).toMatchObject({
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet).toMatchObject({
      capability_key: "workstation_tool_reference.list_capabilities",
      action: "list_capabilities",
      status: "succeeded",
      backend_selection_decision: expect.objectContaining({
        outcome: "default_selected",
        selected_backend_provider: "workstation_tool_reference.helix_workstation_gateway",
        live_backend_execution_enabled: false,
      }),
      terminal_eligible: false,
      answer_authority: false,
      assistant_answer: false,
      raw_content_included: false,
      typed_handoff_contract: expect.objectContaining({
        produced_affordance_kinds: ["system_status"],
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    });
  });

  it("fails closed when the selected runtime provider lacks workstation tool permission", () => {
    const result = runWorkstationToolReferenceListCapabilities({
      provider: buildProvider({ id: "codex", workstationTools: false }),
      request: request(),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "selected_runtime_provider_permission_does_not_allow_lane",
      observation: null,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet.status).toBe("blocked");
    expect(result.observation_packet.backend_selection_decision).toMatchObject({
      outcome: "blocked",
      selected_backend_provider: null,
      terminal_authority_owner: "helix",
    });
    expect(result.lane_resolve_trace).toMatchObject({
      requested_lane: "workstation_tool_reference",
      admission_status: "blocked",
      lane_status: "permission_blocked",
      execution_status: "not_executed_shadow_only",
      blocked_reason: "selected_runtime_provider_permission_does_not_allow_lane",
    });
  });
});

describe("workstation_tool_reference.collect_visible_translation_targets lane", () => {
  it("collects visible docs title/body chunks with stable source and chunk identities", () => {
    const result = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest(),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      schema: "helix.workstation_tool_reference.visible_translation_targets_result.v1",
      ok: true,
      lane_id: "workstation_tool_reference",
      capability: "workstation_tool_reference.collect_visible_translation_targets",
      selected_runtime_agent_provider: "codex",
      target_count: 2,
      reentry_required: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.lane_resolve_trace).toMatchObject({
      requested_lane: "workstation_tool_reference",
      selected_backend_provider: "workstation_tool_reference.helix_workstation_gateway",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation).toMatchObject({
      schema: "helix.workstation_tool_reference.visible_translation_targets_observation.v1",
      target_batch: {
        schema: "helix.visible_translation_target_batch.v1",
        target_count: 2,
        visible_only: true,
        collector_capability: "workstation_tool_reference.collect_visible_translation_targets",
        translation_capability_required: "live_translation.translate_text",
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      deterministic: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    const targets = result.observation?.target_batch.targets ?? [];
    expect(targets.map((target) => target.chunk_id)).toEqual(["visible-chunk-1", "visible-chunk-2"]);
    expect(targets).toEqual([
      expect.objectContaining({
        source_kind: "docs_viewer",
        panel_id: "docs-viewer",
        doc_path: "docs/research/nhm2.md",
        source_id: "document_markdown:docs/research/nhm2.md#visible-chunk-1",
        source_hash: "sha256:full-document-hash",
        source_text_hash: expect.stringMatching(/^sha256:/),
        source_text_char_count: "NHM2 frontier status".length,
        source_event_id: expect.stringContaining("visible-chunk-1"),
        visible_text: "NHM2 frontier status",
        chunk_index: 0,
        region_id: "title",
        projection_target: "docs_chunk",
        account_locale: "es-US",
        target_language: "es",
        existing_observation_ref: null,
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
        reentry_required: true,
      }),
      expect.objectContaining({
        source_kind: "docs_viewer",
        source_id: "document_markdown:docs/research/nhm2.md#visible-chunk-2",
        source_hash: "sha256:full-document-hash",
        source_text_hash: expect.stringMatching(/^sha256:/),
        source_text_char_count: "The campaign remains diagnostic, not certified.".length,
        source_event_id: expect.stringContaining("visible-chunk-2"),
        visible_text: "The campaign remains diagnostic, not certified.",
        chunk_index: 1,
        region_id: "body",
      }),
    ]);
    expect(targets[0]?.source_text_hash).not.toBe(targets[1]?.source_text_hash);
    expect(result.observation_packet).toMatchObject({
      capability_key: "workstation_tool_reference.collect_visible_translation_targets",
      action: "collect_visible_translation_targets",
      status: "succeeded",
      state_delta: {
        visible_translation_target_batch: expect.objectContaining({
          target_count: 2,
          answer_authority: false,
          targets: expect.arrayContaining([
            expect.objectContaining({
              chunk_id: "visible-chunk-1",
              source_event_id: expect.stringContaining("visible-chunk-1"),
              target_language: "es",
              answer_authority: false,
            }),
          ]),
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      },
      typed_handoff_contract: expect.objectContaining({
        producer_capability: "workstation_tool_reference.collect_visible_translation_targets",
        consumer_capability: "live_translation.translate_text",
        produced_affordance_kinds: ["visible_translation_targets"],
        answer_authority: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      terminal_eligible: false,
      answer_authority: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("derives missing target language from account locale for account-language projection", () => {
    const result = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        account_locale: "fr-CA",
        target_language: "",
        projection_target: "account_language",
        title_text: "Translate this title",
        body_text: "",
        visible_text_chunks: [],
      }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: true,
      target_count: 1,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.target_batch.targets[0]).toMatchObject({
      visible_text: "Translate this title",
      account_locale: "fr-CA",
      target_language: "fr",
      projection_target: "account_language",
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      reentry_required: true,
    });
  });

  it("accepts provider-neutral visible text collector requests while executing the canonical workstation collector", () => {
    const result = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        capability: "workstation.visible_text.collect_translation_targets",
        projection_target: "account_language",
        title_text: "Translate this title",
        body_text: "",
        visible_text_chunks: [],
      }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: true,
      capability: "workstation_tool_reference.collect_visible_translation_targets",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.target_batch).toMatchObject({
      requested_collector_capability: "workstation.visible_text.collect_translation_targets",
      collector_capability: "workstation_tool_reference.collect_visible_translation_targets",
      translation_capability_required: "live_translation.translate_text",
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet.state_delta.visible_translation_target_batch).toMatchObject({
      requested_collector_capability: "workstation.visible_text.collect_translation_targets",
      collector_capability: "workstation_tool_reference.collect_visible_translation_targets",
      targets: [
        expect.objectContaining({
          visible_text: "Translate this title",
          projection_target: "account_language",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          reentry_required: true,
        }),
      ],
    });
  });

  it("keeps batch refs distinct when visible target projection identity differs", () => {
    const base = {
      visible_text_chunks: [{
        visible_text: "Same visible source text",
        source_id: "document_markdown:docs/research/current.md#u0001",
        source_hash: "sha256:doc",
        source_text_hash: "sha256:same-text",
        source_text_char_count: "Same visible source text".length,
        chunk_id: "u0001",
        chunk_index: 0,
        dedupe_key: "docs-chunk-dedupe",
        projection_target: "docs_chunk",
      }],
      title_text: "",
      body_text: "",
      visible_text: "",
    } satisfies Partial<HelixWorkstationToolReferenceVisibleTranslationTargetsRequest>;

    const docsChunk = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest(base),
      env: {} as NodeJS.ProcessEnv,
    });
    const accountLanguage = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        ...base,
        visible_text_chunks: [{
          ...base.visible_text_chunks[0],
          dedupe_key: "account-language-dedupe",
          projection_target: "account_language",
        }],
      }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(docsChunk.observation?.target_batch.batch_ref).toMatch(
      /^turn-visible-translation-targets:capability_lane:workstation_tool_reference\.collect_visible_translation_targets:batch:/,
    );
    expect(accountLanguage.observation?.target_batch.batch_ref).toMatch(
      /^turn-visible-translation-targets:capability_lane:workstation_tool_reference\.collect_visible_translation_targets:batch:/,
    );
    expect(docsChunk.observation?.target_batch.batch_ref).not.toBe(
      accountLanguage.observation?.target_batch.batch_ref,
    );
    expect(docsChunk.observation?.target_batch.targets[0]).toMatchObject({
      projection_target: "docs_chunk",
      dedupe_key: "docs-chunk-dedupe",
      chunk_index: 0,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(accountLanguage.observation?.target_batch.targets[0]).toMatchObject({
      projection_target: "account_language",
      dedupe_key: "account-language-dedupe",
      chunk_index: 0,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("collects visible docs chunks from active document visible translation context", () => {
    const result = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        doc_path: null,
        source_hash: null,
        account_locale: null,
        target_language: null,
        title_text: "",
        body_text: "",
        visible_text: "",
        visible_text_chunks: [],
        active_doc_visible_translation_context: {
          schema: "helix.ask.active_doc_visible_translation_context.v1",
          source_kind: "docs_viewer",
          panel_id: "docs-viewer",
          doc_path: "docs/research/current.md",
          source_id: "document_markdown:docs/research/current.md",
          source_hash: "sha256:context-doc",
          account_locale: "es-US",
          target_language: "es",
          projection_target: "docs_chunk",
          chunks: [
            {
              source_kind: "docs_viewer",
              panel_id: "docs-viewer",
              doc_path: "docs/research/current.md",
              source_id: "document_markdown:docs/research/current.md#u0001",
              source_hash: "sha256:context-doc",
              source_text_hash: "sha256:context-text",
              source_text_char_count: 28,
              visible_text: "The visible document source.",
              chunk_id: "u0001",
              chunk_index: 1,
              dedupe_key: "context-dedupe",
              region_id: "docs-viewer:u0001",
              projection_target: "docs_chunk",
              existing_observation_ref: "ask:turn:visible:observation:1",
              existing_receipt_ref: "ask:turn:visible:receipt:1",
              existing_projection_status: "projected",
              existing_freshness_status: "fresh",
              existing_terminal_authority_status: "not_terminal_authority",
              existing_source_event_ms: 1782999999000,
              existing_observed_at_ms: 1782999999100,
              assistant_answer: false,
              terminal_eligible: false,
              answer_authority: false,
              reentry_required: true,
            },
          ],
        },
      }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: true,
      target_count: 1,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.target_batch.targets[0]).toMatchObject({
      doc_path: "docs/research/current.md",
      source_id: "document_markdown:docs/research/current.md#u0001",
      source_hash: "sha256:context-doc",
      source_text_hash: "sha256:context-text",
      visible_text: "The visible document source.",
      chunk_id: "u0001",
      chunk_index: 1,
      dedupe_key: "context-dedupe",
      projection_target: "docs_chunk",
      account_locale: "es-US",
      target_language: "es",
      existing_observation_ref: "ask:turn:visible:observation:1",
      existing_receipt_ref: "ask:turn:visible:receipt:1",
      existing_translation_receipt_ref: "ask:turn:visible:receipt:1",
      existing_projection_status: "projected",
      existing_freshness_status: "fresh",
      existing_terminal_authority_status: "not_terminal_authority",
      existing_source_event_ms: 1782999999000,
      existing_observed_at_ms: 1782999999100,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("collects visible docs chunks from workspace context snapshot active translation context", () => {
    const result = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        doc_path: null,
        source_hash: null,
        account_locale: null,
        target_language: null,
        title_text: "",
        body_text: "",
        visible_text: "",
        visible_text_chunks: [],
        workspace_context_snapshot: {
          schema: "helix.ask.workspace_context_snapshot.v1",
          active_doc_visible_translation_context: {
            schema: "helix.ask.active_doc_visible_translation_context.v1",
            source_kind: "docs_viewer",
            panelId: "docs-viewer",
            docPath: "docs/research/current.md",
            sourceId: "document_markdown:docs/research/current.md",
            sourceHash: "sha256:workspace-context-doc",
            accountLocale: "fr-FR",
            targetLanguage: "fr",
            projectionTarget: "docs_chunk",
            chunks: [
              {
                sourceKind: "docs_viewer",
                panelId: "docs-viewer",
                docPath: "docs/research/current.md",
                sourceId: "document_markdown:docs/research/current.md#workspace-u0001",
                sourceHash: "sha256:workspace-context-doc",
                sourceTextHash: "sha256:workspace-context-text",
                sourceTextCharCount: 37,
                sourceEventId: "source-event:workspace-u0001",
                sourceEventMs: 1783000000000,
                observedAtMs: 1783000001000,
                visibleText: "The visible workspace snapshot source.",
                chunkId: "workspace-u0001",
                chunkIndex: 2,
                dedupeKey: "workspace-context-dedupe",
                regionId: "docs-viewer:workspace-u0001",
                projectionTarget: "docs_chunk",
                existingObservationRef: "ask:turn:workspace:observation:1",
                existingReceiptRef: "ask:turn:workspace:receipt:1",
                existingProjectionStatus: "projected",
                existingFreshnessStatus: "fresh",
                existingTerminalAuthorityStatus: "not_terminal_authority",
                existingSourceEventMs: 1782999999000,
                existingObservedAtMs: 1782999999100,
                assistant_answer: false,
                terminal_eligible: false,
                answer_authority: false,
                reentry_required: true,
              },
            ],
          },
        },
      }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: true,
      target_count: 1,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.target_batch.targets[0]).toMatchObject({
      doc_path: "docs/research/current.md",
      source_id: "document_markdown:docs/research/current.md#workspace-u0001",
      source_hash: "sha256:workspace-context-doc",
      source_text_hash: "sha256:workspace-context-text",
      source_text_char_count: 37,
      source_event_id: "source-event:workspace-u0001",
      source_event_ms: 1783000000000,
      observed_at_ms: 1783000001000,
      visible_text: "The visible workspace snapshot source.",
      chunk_id: "workspace-u0001",
      chunk_index: 2,
      dedupe_key: "workspace-context-dedupe",
      region_id: "docs-viewer:workspace-u0001",
      projection_target: "docs_chunk",
      account_locale: "fr-FR",
      target_language: "fr",
      existing_observation_ref: "ask:turn:workspace:observation:1",
      existing_receipt_ref: "ask:turn:workspace:receipt:1",
      existing_translation_receipt_ref: "ask:turn:workspace:receipt:1",
      existing_projection_status: "projected",
      existing_freshness_status: "fresh",
      existing_terminal_authority_status: "not_terminal_authority",
      existing_source_event_ms: 1782999999000,
      existing_observed_at_ms: 1782999999100,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      reentry_required: true,
    });
  });

  it("ignores stale active document visible context when request doc path differs", () => {
    const result = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        doc_path: "docs/research/current.md",
        source_hash: "sha256:current-doc",
        title_text: "Current document title",
        body_text: "",
        visible_text: "",
        visible_text_chunks: [],
        active_doc_visible_translation_context: {
          schema: "helix.ask.active_doc_visible_translation_context.v1",
          panel_id: "docs-viewer",
          doc_path: "docs/research/old.md",
          source_id: "document_markdown:docs/research/old.md",
          source_hash: "sha256:old-doc",
          account_locale: "es-US",
          target_language: "es",
          chunks: [{
            doc_path: "docs/research/old.md",
            source_id: "document_markdown:docs/research/old.md#old",
            source_hash: "sha256:old-doc",
            visible_text: "Old document text must not be collected.",
            chunk_id: "old",
            chunk_index: 0,
            projection_target: "docs_chunk",
            assistant_answer: false,
            terminal_eligible: false,
            answer_authority: false,
            reentry_required: true,
          }],
          ui_text_regions: [{
            doc_path: "docs/research/old.md",
            source_id: "workstation-shell#docs-viewer:old-title",
            visible_text: "Old UI title",
            chunk_id: "old-title",
            projection_target: "account_language",
          }],
        },
      }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: true,
      target_count: 1,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.target_batch.targets).toEqual([
      expect.objectContaining({
        doc_path: "docs/research/current.md",
        source_id: "document_markdown:docs/research/current.md#visible-chunk-1",
        source_hash: "sha256:current-doc",
        visible_text: "Current document title",
        chunk_id: "visible-chunk-1",
        region_id: "title",
        projection_target: "docs_chunk",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
    ]);
    expect(JSON.stringify(result.observation?.target_batch.targets)).not.toContain("Old document text");
    expect(JSON.stringify(result.observation?.target_batch.targets)).not.toContain("Old UI title");
  });

  it("collects account-language UI regions from active visible translation context", () => {
    const result = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        doc_path: null,
        source_hash: null,
        title_text: "",
        body_text: "",
        visible_text: "",
        visible_text_chunks: [],
        active_doc_visible_translation_context: {
          schema: "helix.ask.active_doc_visible_translation_context.v1",
          source_kind: "docs_viewer",
          panel_id: "docs-viewer",
          doc_path: "docs/research/current.md",
          source_id: "document_markdown:docs/research/current.md",
          source_hash: "sha256:context-doc",
          account_locale: "es-US",
          target_language: "es",
          projection_target: "docs_chunk",
          chunks: [],
          ui_text_regions: [
            {
              source_kind: "panel_text",
              panel_id: "docs-viewer",
              doc_path: "docs/research/current.md",
              source_id: "workstation-shell#docs-viewer:title",
              source_hash: "sha256:context-doc",
              source_text_hash: "sha256:title",
              source_text_char_count: 14,
              source_event_id: "source-event:title",
              source_event_ms: 1783000002000,
              observed_at_ms: 1783000002100,
              visible_text: "Current Status",
              chunk_id: "docs-viewer:title",
              chunk_index: 0,
              dedupe_key: "title-dedupe",
              region_id: "docs-viewer:title",
              bbox: {
                x: 4,
                y: 8,
                width: 240,
                height: 36,
                source: "account-language-region",
              },
              projection_target: "account_language",
              existing_observation_ref: "ask:turn:translation:observation:title",
              existing_receipt_ref: "ask:turn:translation:receipt:title",
              existing_projection_status: "projected",
              existing_freshness_status: "fresh",
              existing_terminal_authority_status: "not_terminal_authority",
              existing_source_event_ms: 1782999999000,
              existing_observed_at_ms: 1782999999100,
              assistant_answer: false,
              terminal_eligible: false,
              answer_authority: false,
              reentry_required: true,
            },
            {
              source_kind: "button_label",
              panel_id: "docs-viewer",
              doc_path: "docs/research/current.md",
              source_id: "workstation-shell#docs-viewer:translate-button",
              source_hash: "sha256:context-doc",
              source_text_hash: "sha256:translate-button",
              source_text_char_count: 9,
              source_event_id: "source-event:translate-button",
              source_event_ms: 1783000002200,
              observed_at_ms: 1783000002300,
              visible_text: "Translate",
              chunk_id: "docs-viewer:translate-button",
              chunk_index: 0,
              dedupe_key: "translate-button-dedupe",
              region_id: "docs-viewer:translate-button",
              projection_target: "account_language",
              existing_observation_ref: "ask:turn:translation:observation:button",
              existing_receipt_ref: "ask:turn:translation:receipt:button",
              existing_projection_status: "projected",
              existing_freshness_status: "fresh",
              existing_terminal_authority_status: "terminal_authority_rejected",
              existing_source_event_ms: 1782999999200,
              existing_observed_at_ms: 1782999999300,
              assistant_answer: false,
              terminal_eligible: false,
              answer_authority: false,
              reentry_required: true,
            },
          ],
        },
      }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: true,
      target_count: 2,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.target_batch.targets[0]).toMatchObject({
      source_kind: "panel_text",
      panel_id: "docs-viewer",
      doc_path: "docs/research/current.md",
      source_id: "workstation-shell#docs-viewer:title",
      source_hash: "sha256:context-doc",
      source_text_hash: "sha256:title",
      source_text_char_count: 14,
      source_event_id: "source-event:title",
      source_event_ms: 1783000002000,
      observed_at_ms: 1783000002100,
      visible_text: "Current Status",
      chunk_id: "docs-viewer:title",
      chunk_index: 0,
      region_id: "docs-viewer:title",
      bbox: {
        x: 4,
        y: 8,
        width: 240,
        height: 36,
        source: "account-language-region",
      },
      dedupe_key: "title-dedupe",
      projection_target: "account_language",
      account_locale: "es-US",
      target_language: "es",
      existing_observation_ref: "ask:turn:translation:observation:title",
      existing_receipt_ref: "ask:turn:translation:receipt:title",
      existing_translation_receipt_ref: "ask:turn:translation:receipt:title",
      existing_projection_status: "projected",
      existing_freshness_status: "fresh",
      existing_terminal_authority_status: "not_terminal_authority",
      existing_source_event_ms: 1782999999000,
      existing_observed_at_ms: 1782999999100,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      reentry_required: true,
    });
    expect(result.observation?.target_batch.targets[1]).toMatchObject({
      source_kind: "button_label",
      panel_id: "docs-viewer",
      doc_path: "docs/research/current.md",
      source_id: "workstation-shell#docs-viewer:translate-button",
      source_hash: "sha256:context-doc",
      source_text_hash: "sha256:translate-button",
      source_text_char_count: 9,
      source_event_id: "source-event:translate-button",
      source_event_ms: 1783000002200,
      observed_at_ms: 1783000002300,
      visible_text: "Translate",
      chunk_id: "docs-viewer:translate-button",
      chunk_index: 0,
      region_id: "docs-viewer:translate-button",
      dedupe_key: "translate-button-dedupe",
      projection_target: "account_language",
      account_locale: "es-US",
      target_language: "es",
      existing_observation_ref: "ask:turn:translation:observation:button",
      existing_receipt_ref: "ask:turn:translation:receipt:button",
      existing_translation_receipt_ref: "ask:turn:translation:receipt:button",
      existing_projection_status: "projected",
      existing_freshness_status: "fresh",
      existing_terminal_authority_status: "terminal_authority_rejected",
      existing_source_event_ms: 1782999999200,
      existing_observed_at_ms: 1782999999300,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      reentry_required: true,
    });
    expect(result.observation_packet.state_delta.visible_translation_target_batch?.targets[0]).toMatchObject({
      projection_target: "account_language",
      source_event_id: "source-event:title",
      source_event_ms: 1783000002000,
      observed_at_ms: 1783000002100,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("collects selected visible text as a docs selection target without answer authority", () => {
    const result = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        title_text: "",
        body_text: "",
        visible_text: "",
        selected_text: "Selected sentence from the visible document.",
        selection_ref: "docs-viewer:selection:u0042",
      }),
      env: {} as NodeJS.ProcessEnv,
      nowMs: 1783000002400,
    });

    expect(result).toMatchObject({
      ok: true,
      target_count: 1,
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.target_batch).toMatchObject({
      target_count: 1,
      visible_only: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.target_batch.targets[0]).toMatchObject({
      source_kind: "selection",
      panel_id: "docs-viewer",
      doc_path: "docs/research/nhm2.md",
      source_id: "document_markdown:docs/research/nhm2.md#docs-viewer:selection:u0042",
      source_hash: "sha256:full-document-hash",
      visible_text: "Selected sentence from the visible document.",
      source_event_ms: 1783000002400,
      observed_at_ms: 1783000002400,
      chunk_id: "docs-viewer:selection:u0042",
      region_id: "docs-viewer:selection:u0042",
      projection_target: "docs_selection",
      account_locale: "es-US",
      target_language: "es",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      reentry_required: true,
    });
    expect(result.observation_packet).toMatchObject({
      capability_key: "workstation_tool_reference.collect_visible_translation_targets",
      state_delta: {
        visible_translation_target_batch: expect.objectContaining({
          targets: [
            expect.objectContaining({
              source_kind: "selection",
              source_event_ms: 1783000002400,
              observed_at_ms: 1783000002400,
              projection_target: "docs_selection",
              assistant_answer: false,
              terminal_eligible: false,
            }),
          ],
        }),
      },
      typed_handoff_contract: expect.objectContaining({
        consumer_capability: "live_translation.translate_text",
        produced_affordance_kinds: ["visible_translation_targets"],
        terminal_eligible: false,
      }),
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("collects context-carried selected text chunks as docs selection targets", () => {
    const result = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        doc_path: null,
        source_hash: null,
        title_text: "",
        body_text: "",
        visible_text: "",
        visible_text_chunks: [],
        active_doc_visible_translation_context: {
          schema: "helix.ask.active_doc_visible_translation_context.v1",
          source_kind: "docs_viewer",
          panel_id: "docs-viewer",
          doc_path: "docs/research/current.md",
          source_id: "document_markdown:docs/research/current.md",
          source_hash: "sha256:context-doc",
          account_locale: "es-US",
          target_language: "es",
          projection_target: "docs_chunk",
          chunks: [
            {
              source_kind: "selection",
              panel_id: "docs-viewer",
              doc_path: "docs/research/current.md",
              source_id: "document_markdown:docs/research/current.md#docs-viewer:selection:fnv1a32:selected",
              source_hash: "sha256:context-doc",
              source_text_hash: "fnv1a32:selected",
              source_text_char_count: 14,
              visible_text: "Selected text",
              chunk_id: "docs-viewer:selection:fnv1a32:selected",
              chunk_index: 0,
              dedupe_key: "selected-dedupe",
              region_id: "docs-viewer:selection:fnv1a32:selected",
              projection_target: "docs_selection",
              existing_observation_ref: "ask:turn:translation:observation:selected",
              existing_receipt_ref: "ask:turn:translation:receipt:selected",
              existing_projection_status: "projected",
              existing_freshness_status: "fresh",
              existing_terminal_authority_status: "not_terminal_authority",
              existing_source_event_ms: 1782999998000,
              existing_observed_at_ms: 1782999998100,
              assistant_answer: false,
              terminal_eligible: false,
              answer_authority: false,
              reentry_required: true,
            },
          ],
          ui_text_regions: [],
        },
      }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: true,
      target_count: 1,
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.target_batch.targets[0]).toMatchObject({
      source_kind: "selection",
      panel_id: "docs-viewer",
      doc_path: "docs/research/current.md",
      source_id: "document_markdown:docs/research/current.md#docs-viewer:selection:fnv1a32:selected",
      source_hash: "sha256:context-doc",
      source_text_hash: "fnv1a32:selected",
      source_text_char_count: 14,
      visible_text: "Selected text",
      chunk_id: "docs-viewer:selection:fnv1a32:selected",
      chunk_index: 0,
      region_id: "docs-viewer:selection:fnv1a32:selected",
      dedupe_key: "selected-dedupe",
      projection_target: "docs_selection",
      account_locale: "es-US",
      target_language: "es",
      existing_observation_ref: "ask:turn:translation:observation:selected",
      existing_receipt_ref: "ask:turn:translation:receipt:selected",
      existing_translation_receipt_ref: "ask:turn:translation:receipt:selected",
      existing_projection_status: "projected",
      existing_freshness_status: "fresh",
      existing_terminal_authority_status: "not_terminal_authority",
      existing_source_event_ms: 1782999998000,
      existing_observed_at_ms: 1782999998100,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      reentry_required: true,
    });
    expect(result.observation_packet.state_delta.visible_translation_target_batch?.targets[0]).toMatchObject({
      projection_target: "docs_selection",
      existing_observation_ref: "ask:turn:translation:observation:selected",
      existing_receipt_ref: "ask:turn:translation:receipt:selected",
      existing_projection_status: "projected",
      existing_freshness_status: "fresh",
      existing_terminal_authority_status: "not_terminal_authority",
      existing_source_event_ms: 1782999998000,
      existing_observed_at_ms: 1782999998100,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      reentry_required: true,
    });
  });

  it("collects hovered visible text as a docs hover target without answer authority", () => {
    const result = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        title_text: "",
        body_text: "",
        visible_text: "",
        hover_text: "Hovered sentence from the visible document.",
        hover_ref: "docs-viewer:hover:u0043",
      }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: true,
      target_count: 1,
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.target_batch).toMatchObject({
      target_count: 1,
      visible_only: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.target_batch.targets[0]).toMatchObject({
      source_kind: "hover_region",
      panel_id: "docs-viewer",
      doc_path: "docs/research/nhm2.md",
      source_id: "document_markdown:docs/research/nhm2.md#docs-viewer:hover:u0043",
      source_hash: "sha256:full-document-hash",
      visible_text: "Hovered sentence from the visible document.",
      chunk_id: "docs-viewer:hover:u0043",
      region_id: "docs-viewer:hover:u0043",
      projection_target: "docs_hover",
      account_locale: "es-US",
      target_language: "es",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      reentry_required: true,
    });
    expect(result.observation_packet).toMatchObject({
      capability_key: "workstation_tool_reference.collect_visible_translation_targets",
      state_delta: {
        visible_translation_target_batch: expect.objectContaining({
          targets: [
            expect.objectContaining({
              source_kind: "hover_region",
              projection_target: "docs_hover",
              assistant_answer: false,
              terminal_eligible: false,
            }),
          ],
        }),
      },
      typed_handoff_contract: expect.objectContaining({
        consumer_capability: "live_translation.translate_text",
        produced_affordance_kinds: ["visible_translation_targets"],
        terminal_eligible: false,
      }),
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("collects context-carried hovered text chunks as docs hover targets", () => {
    const result = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        doc_path: null,
        source_hash: null,
        title_text: "",
        body_text: "",
        visible_text: "",
        visible_text_chunks: [],
        active_doc_visible_translation_context: {
          schema: "helix.ask.active_doc_visible_translation_context.v1",
          source_kind: "docs_viewer",
          panel_id: "docs-viewer",
          doc_path: "docs/research/current.md",
          source_id: "document_markdown:docs/research/current.md",
          source_hash: "sha256:context-doc",
          account_locale: "es-US",
          target_language: "es",
          projection_target: "docs_chunk",
          chunks: [
            {
              source_kind: "hover_region",
              panel_id: "docs-viewer",
              doc_path: "docs/research/current.md",
              source_id: "document_markdown:docs/research/current.md#docs-viewer:hover:u0002",
              source_hash: "sha256:context-doc",
              source_text_hash: "fnv1a32:hovered",
              source_text_char_count: 12,
              visible_text: "Hovered text",
              chunk_id: "docs-viewer:hover:u0002",
              chunk_index: 0,
              dedupe_key: "hover-dedupe",
              region_id: "docs-viewer:hover:u0002",
              projection_target: "docs_hover",
              existing_observation_ref: "ask:turn:translation:observation:hover",
              existing_receipt_ref: "ask:turn:translation:receipt:hover",
              existing_projection_status: "projected",
              existing_freshness_status: "fresh",
              existing_terminal_authority_status: "terminal_authority_rejected",
              existing_source_event_ms: 1782999998200,
              existing_observed_at_ms: 1782999998300,
              assistant_answer: false,
              terminal_eligible: false,
              answer_authority: false,
              reentry_required: true,
            },
          ],
          ui_text_regions: [],
        },
      }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: true,
      target_count: 1,
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.target_batch.targets[0]).toMatchObject({
      source_kind: "hover_region",
      panel_id: "docs-viewer",
      doc_path: "docs/research/current.md",
      source_id: "document_markdown:docs/research/current.md#docs-viewer:hover:u0002",
      source_hash: "sha256:context-doc",
      source_text_hash: "fnv1a32:hovered",
      source_text_char_count: 12,
      visible_text: "Hovered text",
      chunk_id: "docs-viewer:hover:u0002",
      chunk_index: 0,
      region_id: "docs-viewer:hover:u0002",
      dedupe_key: "hover-dedupe",
      projection_target: "docs_hover",
      account_locale: "es-US",
      target_language: "es",
      existing_observation_ref: "ask:turn:translation:observation:hover",
      existing_receipt_ref: "ask:turn:translation:receipt:hover",
      existing_translation_receipt_ref: "ask:turn:translation:receipt:hover",
      existing_projection_status: "projected",
      existing_freshness_status: "fresh",
      existing_terminal_authority_status: "terminal_authority_rejected",
      existing_source_event_ms: 1782999998200,
      existing_observed_at_ms: 1782999998300,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      reentry_required: true,
    });
    expect(result.observation_packet.state_delta.visible_translation_target_batch?.targets[0]).toMatchObject({
      projection_target: "docs_hover",
      existing_observation_ref: "ask:turn:translation:observation:hover",
      existing_receipt_ref: "ask:turn:translation:receipt:hover",
      existing_projection_status: "projected",
      existing_freshness_status: "fresh",
      existing_terminal_authority_status: "terminal_authority_rejected",
      existing_source_event_ms: 1782999998200,
      existing_observed_at_ms: 1782999998300,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      reentry_required: true,
    });
  });

  it("collects visible UI text regions as account-language targets without answer authority", () => {
    const result = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        active_panel_id: "workstation-shell",
        doc_path: null,
        source_hash: "sha256:visible-ui",
        projection_target: "account_language",
        title_text: "",
        body_text: "",
        visible_text: "",
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
      }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: true,
      target_count: 2,
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation?.target_batch.targets).toEqual([
      expect.objectContaining({
        source_kind: "panel_text",
        panel_id: "workstation-notes",
        doc_path: null,
        source_id: "workstation-shell#workstation-notes:title",
        source_hash: "sha256:visible-ui",
        visible_text: "Workstation notes",
        chunk_id: "workstation-notes:title",
        region_id: "workstation-notes:title",
        projection_target: "account_language",
        account_locale: "es-US",
        target_language: "es",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
        reentry_required: true,
      }),
      expect.objectContaining({
        source_kind: "button_label",
        panel_id: "docs-viewer",
        doc_path: null,
        source_id: "workstation-shell#docs-viewer:translate-selection",
        visible_text: "Translate selection",
        chunk_id: "docs-viewer:translate-selection",
        region_id: "docs-viewer:translate-selection",
        projection_target: "account_language",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
        reentry_required: true,
      }),
    ]);
    expect(result.observation_packet).toMatchObject({
      capability_key: "workstation_tool_reference.collect_visible_translation_targets",
      state_delta: {
        visible_translation_target_batch: expect.objectContaining({
          target_count: 2,
          targets: expect.arrayContaining([
            expect.objectContaining({
              source_kind: "button_label",
              projection_target: "account_language",
              terminal_eligible: false,
              assistant_answer: false,
            }),
          ]),
        }),
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("feeds one collected visible doc target through live_translation.translate_text without answer authority", async () => {
    const collected = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        visible_text_chunks: [{
          visible_text: "hello",
          chunk_id: "title",
          chunk_index: 0,
          region_id: "title",
        }],
      }),
      env: {} as NodeJS.ProcessEnv,
    });
    const target = collected.observation?.target_batch.targets[0];
    expect(target).toBeTruthy();

    const translated = await runLiveTranslationTranslateText({
      provider: buildProvider({ id: "codex" }),
      request: translationRequest({
        text: target?.visible_text,
        target_language: target?.target_language,
        source_id: target?.source_id,
        doc_path: target?.doc_path,
        source_hash: target?.source_hash,
        source_kind: target?.source_kind,
        account_locale: target?.account_locale,
        chunk_id: target?.chunk_id,
        chunk_index: target?.chunk_index,
        dedupe_key: target?.dedupe_key,
        projection_target: target?.projection_target,
      }),
      turnId: "turn-visible-translation-targets-translate",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(translated).toMatchObject({
      ok: true,
      capability: "live_translation.translate_text",
      translated_text: "hola",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(translated.observation).toMatchObject({
      source_id: "document_markdown:docs/research/nhm2.md#title",
      doc_path: "docs/research/nhm2.md",
      source_hash: target?.source_hash,
      source_kind: "docs_viewer",
      account_locale: "es-US",
      chunk_id: "title",
      chunk_index: 0,
      dedupe_key: target?.dedupe_key,
      projection_target: "docs_chunk",
      terminal_authority_status: "pending_helix_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(translated.observation_packet.state_delta.live_translation_projection_receipt).toMatchObject({
      source_id: "document_markdown:docs/research/nhm2.md#title",
      doc_path: "docs/research/nhm2.md",
      source_hash: target?.source_hash,
      source_text_hash: translated.observation?.source_text_hash,
      chunk_id: "title",
      target_language: "es",
      observation_ref: translated.observation?.observation_ref,
      receipt_ref: expect.any(String),
      terminal_authority_status: "pending_helix_terminal_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("preserves private Research Library provenance from the collector target through the translation receipt", async () => {
    const documentRef = "private-research:acct-token:document-token";
    const docPath = `research-library/${documentRef}`;
    const collected = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        doc_path: docPath,
        source_hash: "sha256:private-research-document",
        title_text: "",
        body_text: "",
        visible_text: "",
        visible_text_chunks: [],
        active_doc_visible_translation_context: {
          schema: "helix.ask.active_doc_visible_translation_context.v1",
          source_kind: "docs_viewer",
          panel_id: "docs-viewer",
          doc_path: docPath,
          document_source_kind: "research_library",
          document_ref: documentRef,
          private_source: true,
          source_id: `document_markdown:${docPath}`,
          source_hash: "sha256:private-research-document",
          account_locale: "es-US",
          target_language: "es",
          projection_target: "docs_chunk",
          chunks: [{
            source_kind: "docs_viewer",
            panel_id: "docs-viewer",
            doc_path: docPath,
            source_id: `document_markdown:${docPath}#u0001`,
            source_hash: "sha256:private-research-document",
            source_text_hash: "sha256:private-research-title",
            source_text_char_count: 5,
            visible_text: "hello",
            chunk_id: "u0001",
            chunk_index: 0,
            dedupe_key: `document_markdown:${docPath}::sha256:private-research-title::u0001::es-US::es`,
            region_id: "docs-viewer:u0001",
            projection_target: "docs_chunk",
          }],
          ui_text_regions: [],
        },
      }),
      env: {} as NodeJS.ProcessEnv,
    });
    const target = collected.observation?.target_batch.targets[0];

    expect(target).toMatchObject({
      doc_path: docPath,
      document_source_kind: "research_library",
      document_ref: documentRef,
      private_source: true,
      source_id: `document_markdown:${docPath}#u0001`,
      visible_text: "hello",
    });
    expect(collected.observation_packet.state_delta.visible_translation_target_batch?.targets[0]).toMatchObject({
      document_source_kind: "research_library",
      document_ref: documentRef,
      private_source: true,
    });

    const laneRequest = translationRequest({
      text: target?.visible_text,
      target_language: target?.target_language,
      source_id: target?.source_id,
      panel_id: target?.panel_id,
      region_id: target?.region_id,
      doc_path: target?.doc_path,
      document_source_kind: target?.document_source_kind,
      document_ref: target?.document_ref,
      private_source: target?.private_source,
      source_hash: target?.source_hash,
      source_kind: target?.source_kind,
      source_text_hash: target?.source_text_hash,
      source_text_char_count: target?.source_text_char_count,
      account_locale: target?.account_locale,
      chunk_id: target?.chunk_id,
      chunk_index: target?.chunk_index,
      dedupe_key: target?.dedupe_key,
      source_event_id: target?.source_event_id,
      source_event_ms: target?.source_event_ms,
      projection_target: target?.projection_target,
    });
    expect(laneRequest).toMatchObject({
      document_source_kind: "research_library",
      document_ref: documentRef,
      private_source: true,
    });

    const translated = await runLiveTranslationTranslateText({
      provider: buildProvider({ id: "codex" }),
      request: laneRequest,
      turnId: "turn-private-research-visible-translation",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(translated.observation).toMatchObject({
      doc_path: docPath,
      document_source_kind: "research_library",
      document_ref: documentRef,
      private_source: true,
      source_id: `document_markdown:${docPath}#u0001`,
    });
    expect(translated.observation_packet.state_delta.live_translation_chunk).toMatchObject({
      doc_path: docPath,
      document_source_kind: "research_library",
      document_ref: documentRef,
      private_source: true,
      source_id: `document_markdown:${docPath}#u0001`,
    });
    expect(translated.observation_packet.state_delta.live_translation_projection_receipt).toMatchObject({
      schema: "helix.live_translation.projection_receipt.v1",
      doc_path: docPath,
      document_source_kind: "research_library",
      document_ref: documentRef,
      private_source: true,
      source_id: `document_markdown:${docPath}#u0001`,
      projection_status: "projected",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("fails closed when visible text targets are absent", () => {
    const result = runWorkstationToolReferenceCollectVisibleTranslationTargets({
      provider: buildProvider({ id: "codex" }),
      request: targetRequest({
        title_text: "",
        body_text: "",
        visible_text: "",
        visible_text_chunks: [],
      }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: false,
      observation: null,
      error: "visible_translation_targets_missing",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet).toMatchObject({
      status: "blocked",
      capability_key: "workstation_tool_reference.collect_visible_translation_targets",
      state_delta: {
        visible_translation_target_batch: expect.objectContaining({
          target_count: 0,
          targets: [],
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });
});
