import { describe, expect, it } from "vitest";
import type { HelixAgentProvider } from "../../agent-providers/types";
import {
  listHelixCapabilityLanes,
  resolveHelixCapabilityLaneRequest,
} from "../registry";

const buildProvider = (input: {
  id: "helix" | "codex";
  workstationTools?: boolean;
}): HelixAgentProvider => ({
  id: input.id,
  label: input.id === "helix" ? "Helix Ask Native" : "Codex Workstation Mode",
  permissionProfile: {
    id: input.id === "helix" ? "helix-native" : "read-observe-act",
    label: input.id === "helix" ? "Helix native governed runtime" : "Read/observe plus non-mutating action",
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

describe("Helix capability lane registry", () => {
  it("exposes the same governed lane definitions to Helix and Codex", () => {
    const env = {
      OPENAI_API_KEY: "test-key",
      ELEVENLABS_API_KEY: "test-eleven",
      GOOGLE_GEMINI_API_KEY: "test-gemini",
    } as NodeJS.ProcessEnv;
    const helix = listHelixCapabilityLanes({
      provider: buildProvider({ id: "helix" }),
      env,
    });
    const codex = listHelixCapabilityLanes({
      provider: buildProvider({ id: "codex" }),
      env,
    });

    expect(helix.schema).toBe("helix.capability_lane_manifest.v1");
    expect(helix.policy_mode).toBe("shadow");
    expect(helix.backend_selection_policy).toMatchObject({
      owner: "helix",
      runtime_provider_may_request_preference: true,
      selected_runtime_provider_remains_root: true,
      dynamic_switching_enabled: false,
    });
    expect(codex.policy_mode).toBe("shadow");
    expect(helix.lane_ids).toEqual(codex.lane_ids);
    expect(helix.lane_ids).toEqual([
      "utility_text",
      "interactive_text",
      "deliberate_text",
      "code_text",
      "speech_to_text",
      "text_to_speech",
      "live_translation",
      "realtime_session",
      "visual_analysis",
      "workstation_tool_reference",
    ]);
    expect(helix.lanes.find((lane) => lane.lane_id === "interactive_text")).toMatchObject({
      status: "dry_run",
      backend_family: "openai_compatible",
      one_shot_call_contract: expect.objectContaining({
        supported: false,
        terminal_eligible: false,
        assistant_answer: false,
      }),
      capabilities: [
        expect.objectContaining({
          capability_id: "interactive_text.respond",
          one_shot_status: "shadow_only",
          session_status: "not_supported",
          backend_provider_required: true,
          model_visible_hint: expect.objectContaining({
            required_input_fields: ["input_text"],
            optional_input_fields: expect.arrayContaining([
              "response_goal",
              "context_refs",
              "requested_backend_provider",
            ]),
            when_not_to_use: expect.stringContaining("private replacement runtime"),
          }),
          result_authority: "observation_or_receipt_only",
          terminal_eligible: false,
          assistant_answer: false,
        }),
      ],
    });
    expect(helix.lanes.find((lane) => lane.lane_id === "deliberate_text")).toMatchObject({
      status: "dry_run",
      backend_family: "openai_compatible",
      one_shot_call_contract: expect.objectContaining({
        supported: false,
        terminal_eligible: false,
        assistant_answer: false,
      }),
      capabilities: [
        expect.objectContaining({
          capability_id: "deliberate_text.review",
          one_shot_status: "shadow_only",
          session_status: "not_supported",
          backend_provider_required: true,
          model_visible_hint: expect.objectContaining({
            required_input_fields: ["input_text"],
            optional_input_fields: expect.arrayContaining([
              "review_goal",
              "evidence_refs",
              "requested_backend_provider",
            ]),
            when_not_to_use: expect.stringContaining("hidden second answer path"),
          }),
          result_authority: "observation_or_receipt_only",
          terminal_eligible: false,
          assistant_answer: false,
        }),
      ],
    });
    expect(helix.lanes.find((lane) => lane.lane_id === "code_text")).toMatchObject({
      status: "dry_run",
      backend_family: "openai_compatible",
      one_shot_call_contract: expect.objectContaining({
        supported: false,
        terminal_eligible: false,
        assistant_answer: false,
      }),
      capabilities: [
        expect.objectContaining({
          capability_id: "code_text.review",
          one_shot_status: "shadow_only",
          session_status: "not_supported",
          backend_provider_required: true,
          model_visible_hint: expect.objectContaining({
            required_input_fields: ["code_or_diff"],
            optional_input_fields: expect.arrayContaining([
              "review_goal",
              "language",
              "source_ref",
              "requested_backend_provider",
            ]),
            when_not_to_use: expect.stringContaining("Do not use for shell execution"),
          }),
          result_authority: "observation_or_receipt_only",
          terminal_eligible: false,
          assistant_answer: false,
        }),
      ],
    });
    expect(helix.lanes.find((lane) => lane.lane_id === "live_translation")).toMatchObject({
      status: "dry_run",
      backend_family: "local_runtime",
      default_backend_provider: "live_translation.openai_compatible",
      backend_providers: [
        expect.objectContaining({
          provider_id: "live_translation.local_runtime",
          configuration_status: "not_required",
          required_env_vars: [],
          configured_env_vars: [],
          availability_status: "dry_run",
          permission_status: "admitted",
          cost_class: "free_local",
          latency_class: "interactive",
          privacy_class: "local_only",
          raw_secret_exposed: false,
        }),
        expect.objectContaining({
          provider_id: "live_translation.google_gemini",
          configuration_status: "configured",
          required_env_vars: ["GOOGLE_GEMINI_API_KEY", "GEMINI_API_KEY"],
          configured_env_vars: ["GOOGLE_GEMINI_API_KEY"],
          availability_status: "dry_run",
          permission_status: "admitted",
          cost_class: "standard",
          latency_class: "realtime",
          privacy_class: "external_provider",
          fallback_backend_provider: "live_translation.local_runtime",
          raw_secret_exposed: false,
        }),
        expect.objectContaining({
          provider_id: "live_translation.openai_compatible",
          configuration_status: "configured",
          required_env_vars: [
            "LIVE_TRANSLATION_OPENAI_API_KEY",
            "DOC_TRANSLATION_API_KEY",
            "OPENAI_API_KEY",
            "LLM_HTTP_API_KEY",
          ],
          configured_env_vars: ["OPENAI_API_KEY"],
          availability_status: "dry_run",
          permission_status: "admitted",
          cost_class: "standard",
          latency_class: "interactive",
          privacy_class: "account_provider",
          fallback_backend_provider: "live_translation.local_runtime",
          raw_secret_exposed: false,
        }),
      ],
      one_shot_call_contract: {
        schema: "helix.capability_lane.one_shot_call_contract.v1",
        supported: true,
        request_schema_ref: "helix.live_translation.one_shot_request.v1",
        response_schema_ref: "helix.live_translation.one_shot_response.v1",
        output_role: "observation_or_receipt",
        reentry_required: true,
        terminal_eligible: false,
        assistant_answer: false,
      },
      session_contract: expect.objectContaining({
        supported: true,
        requires_source_binding: true,
        emits_observations: true,
        terminal_eligible: false,
      }),
      goal_binding_contract: expect.objectContaining({
        supported: true,
        backend_provider_becomes_root_agent: false,
        final_reports_require_terminal_authority: true,
      }),
      observation_contract: expect.objectContaining({
        observation_schema_ref: "helix.live_translation.observation.v1",
        reentry_required: true,
        terminal_eligible: false,
        assistant_answer: false,
      }),
      receipt_contract: expect.objectContaining({
        receipt_schema_ref: "helix.live_translation.receipt.v1",
        reentry_required: true,
        terminal_eligible: false,
        assistant_answer: false,
      }),
      terminal_policy: {
        schema: "helix.capability_lane.terminal_policy.v1",
        lane_output_can_be_final_answer: false,
        terminal_authority_owner: "helix",
        requires_evidence_reentry: true,
        preserves_runtime_provider_root: true,
      },
      capabilities: [
        {
          schema: "helix.capability_lane.capability_descriptor.v1",
          capability_id: "live_translation.translate_text",
          label: "Translate text",
          lane_id: "live_translation",
          one_shot_status: "executable",
          session_status: "supported",
          backend_provider_required: true,
          model_visible_hint: expect.objectContaining({
            optional_input_fields: expect.arrayContaining([
              "source_id",
              "doc_path",
              "source_hash",
              "source_text_hash",
              "source_text_char_count",
              "source_event_id",
              "source_event_ms",
              "chunk_id",
              "chunk_index",
              "dedupe_key",
              "projection_target",
              "account_locale",
            ]),
            when_to_use: expect.stringContaining("Preserve collector provenance fields"),
            request_shape_hint: {
              capability_lane_call: expect.objectContaining({
                capability: "live_translation.translate_text",
                source_event_id: "<optional visible source event id>",
                source_event_ms: "<optional visible source event timestamp>",
              }),
            },
          }),
          result_authority: "observation_or_receipt_only",
          reentry_required: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      ],
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(helix.lanes.find((lane) => lane.lane_id === "utility_text")).toMatchObject({
      status: "dry_run",
      backend_family: "local_runtime",
      model_or_service_ref: "utility_text_deterministic_v1",
      default_backend_provider: "utility_text.local_runtime",
      backend_providers: [
        expect.objectContaining({
          provider_id: "utility_text.local_runtime",
          configuration_status: "not_required",
          required_env_vars: [],
          configured_env_vars: [],
          availability_status: "dry_run",
          permission_status: "admitted",
          cost_class: "free_local",
          latency_class: "interactive",
          privacy_class: "local_only",
          raw_secret_exposed: false,
        }),
        expect.objectContaining({
          provider_id: "utility_text.openai_compatible",
          configuration_status: "configured",
          required_env_vars: ["OPENAI_API_KEY", "LLM_HTTP_BASE", "LLM_HTTP_MODEL"],
          configured_env_vars: ["OPENAI_API_KEY"],
          availability_status: "dry_run",
          permission_status: "admitted",
          cost_class: "standard",
          latency_class: "interactive",
          privacy_class: "account_provider",
          fallback_backend_provider: "utility_text.local_runtime",
          raw_secret_exposed: false,
        }),
      ],
      one_shot_call_contract: expect.objectContaining({
        supported: true,
        terminal_eligible: false,
        assistant_answer: false,
      }),
      capabilities: [
        expect.objectContaining({
          capability_id: "utility_text.normalize_text",
          one_shot_status: "executable",
          session_status: "not_supported",
          backend_provider_required: true,
          model_visible_hint: expect.objectContaining({
            required_input_fields: ["text"],
            optional_input_fields: expect.arrayContaining([
              "normalization_mode",
              "requested_backend_provider",
            ]),
            when_not_to_use: expect.stringContaining("hidden text model"),
            request_shape_hint: {
              capability_lane_call: expect.objectContaining({
                capability: "utility_text.normalize_text",
                requested_backend_provider: "<optional backend preference; Helix selects the backend>",
              }),
            },
          }),
          result_authority: "observation_or_receipt_only",
        }),
      ],
    });
    expect(helix.lanes.find((lane) => lane.lane_id === "speech_to_text")).toMatchObject({
      backend_family: "openai_compatible",
      default_backend_provider: "speech_to_text.openai_compatible",
      one_shot_call_contract: expect.objectContaining({
        supported: true,
        terminal_eligible: false,
        assistant_answer: false,
      }),
      session_contract: expect.objectContaining({
        supported: true,
        terminal_eligible: false,
      }),
      goal_binding_contract: expect.objectContaining({
        supported: true,
        final_reports_require_terminal_authority: true,
        backend_provider_becomes_root_agent: false,
      }),
      capabilities: [
        expect.objectContaining({
          capability_id: "speech_to_text.transcribe_audio",
          one_shot_status: "executable",
          session_status: "supported",
          result_authority: "observation_or_receipt_only",
          reentry_required: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      ],
    });
    expect(helix.lanes.find((lane) => lane.lane_id === "text_to_speech")).toMatchObject({
      status: "dry_run",
      backend_family: "local_runtime",
      model_or_service_ref: "existing_voice_service",
      default_backend_provider: "text_to_speech.existing_voice_service",
      backend_providers: [
        expect.objectContaining({
          provider_id: "text_to_speech.existing_voice_service",
          configuration_status: "not_required",
          required_env_vars: [],
          configured_env_vars: [],
          availability_status: "dry_run",
          permission_status: "admitted",
          cost_class: "free_local",
          latency_class: "interactive",
          privacy_class: "local_only",
          raw_secret_exposed: false,
        }),
        expect.objectContaining({
          provider_id: "text_to_speech.elevenlabs",
          configuration_status: "configured",
          required_env_vars: ["ELEVENLABS_API_KEY"],
          configured_env_vars: ["ELEVENLABS_API_KEY"],
          availability_status: "dry_run",
          permission_status: "admitted",
          cost_class: "standard",
          latency_class: "interactive",
          privacy_class: "external_provider",
          fallback_backend_provider: "text_to_speech.existing_voice_service",
          raw_secret_exposed: false,
        }),
      ],
      one_shot_call_contract: expect.objectContaining({
        supported: true,
        terminal_eligible: false,
        assistant_answer: false,
      }),
      session_contract: expect.objectContaining({
        supported: true,
        terminal_eligible: false,
      }),
      goal_binding_contract: expect.objectContaining({
        supported: true,
        final_reports_require_terminal_authority: true,
        backend_provider_becomes_root_agent: false,
      }),
      receipt_contract: expect.objectContaining({
        reentry_required: true,
        terminal_eligible: false,
        assistant_answer: false,
      }),
      capabilities: [
        expect.objectContaining({
          capability_id: "text_to_speech.speak_text",
          one_shot_status: "executable",
          session_status: "supported",
          backend_provider_required: true,
          result_authority: "observation_or_receipt_only",
          reentry_required: true,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      ],
    });
    expect(codex.lanes.find((lane) => lane.lane_id === "workstation_tool_reference")).toMatchObject({
      status: "available",
      backend_family: "helix_workstation_gateway",
      result_authority: "observation_or_receipt_only",
      backend_providers: [
        expect.objectContaining({
          provider_id: "workstation_tool_reference.helix_workstation_gateway",
          cost_class: "free_local",
          latency_class: "local",
          privacy_class: "local_only",
        }),
      ],
      capabilities: [
        expect.objectContaining({
          capability_id: "research-library.apply_evidence_enrichment",
          one_shot_status: "executable",
          session_status: "not_supported",
          backend_provider_required: false,
          result_authority: "observation_or_receipt_only",
          reentry_required: true,
          terminal_eligible: false,
          assistant_answer: false,
          model_visible_hint: expect.objectContaining({
            required_input_fields: ["document_id", "proposal"],
            optional_input_fields: expect.arrayContaining([
              "source_target_intent",
              "requested_backend_provider",
            ]),
            when_to_use: expect.stringContaining("bounded Research Library sidecar observation"),
            when_not_to_use: expect.stringContaining("Do not choose a profile id"),
            request_shape_hint: {
              capability_lane_call: expect.objectContaining({
                capability: "research-library.apply_evidence_enrichment",
                document_id: "<from bounded Research Library sidecar observation>",
                proposal: expect.objectContaining({
                  schema: "helix.paper_evidence_enrichment_proposal.v1",
                  agent_authored: true,
                  assistant_answer: false,
                  terminal_eligible: false,
                }),
              }),
            },
          }),
        }),
        expect.objectContaining({
          capability_id: "helix_ask.reflect_theory_context",
          one_shot_status: "executable",
          backend_provider_required: false,
          result_authority: "observation_or_receipt_only",
          reentry_required: true,
          terminal_eligible: false,
          assistant_answer: false,
          model_visible_hint: expect.objectContaining({
            required_input_fields: ["prompt"],
            optional_input_fields: expect.arrayContaining([
              "conversation_context",
              "build_explanation_plan",
              "operation",
              "target_observable",
              "resolved_referent_text",
              "resolved_source_ref",
              "resolved_text_hash",
              "requested_backend_provider",
            ]),
            when_to_use: expect.stringContaining("resolved subject"),
            when_not_to_use: expect.stringContaining("observation-only"),
          }),
        }),
        expect.objectContaining({
          capability_id: "workstation_tool_reference.list_capabilities",
          one_shot_status: "executable",
          backend_provider_required: false,
          terminal_eligible: false,
          assistant_answer: false,
        }),
        expect.objectContaining({
          capability_id: "workstation_tool_reference.collect_visible_translation_targets",
          one_shot_status: "executable",
          backend_provider_required: false,
          terminal_eligible: false,
          assistant_answer: false,
          model_visible_hint: expect.objectContaining({
            optional_input_fields: expect.arrayContaining([
              "active_panel_id",
              "doc_path",
              "selected_text",
              "selection_ref",
              "hover_text",
              "hover_ref",
              "active_region_text",
              "active_region_ref",
              "visible_text_chunks",
              "ui_text_regions",
              "panel_text_regions",
              "visible_ui_text_regions",
              "active_doc_visible_translation_context",
              "workspace_context_snapshot",
              "target_language",
              "requested_backend_provider",
            ]),
            when_to_use: expect.stringContaining("visible UI"),
            when_not_to_use: expect.stringContaining("live_translation.translate_text"),
            request_shape_hint: {
              capability_lane_call: expect.objectContaining({
                capability: "workstation_tool_reference.collect_visible_translation_targets",
                visible_only: true,
                active_doc_visible_translation_context:
                  "workspace_context_snapshot.active_doc_visible_translation_context",
              }),
            },
          }),
        }),
        expect.objectContaining({
          capability_id: "workstation.visible_text.collect_translation_targets",
          one_shot_status: "executable",
          backend_provider_required: false,
          terminal_eligible: false,
          assistant_answer: false,
          model_visible_hint: expect.objectContaining({
            optional_input_fields: expect.arrayContaining([
              "active_panel_id",
              "doc_path",
              "selected_text",
              "selection_ref",
              "hover_text",
              "hover_ref",
              "active_region_text",
              "active_region_ref",
              "visible_text_chunks",
              "ui_text_regions",
              "panel_text_regions",
              "visible_ui_text_regions",
              "active_doc_visible_translation_context",
              "workspace_context_snapshot",
              "target_language",
              "requested_backend_provider",
            ]),
            when_to_use: expect.stringContaining("Provider-neutral alias"),
            when_not_to_use: expect.stringContaining("live_translation.translate_text"),
            request_shape_hint: {
              capability_lane_call: expect.objectContaining({
                capability: "workstation.visible_text.collect_translation_targets",
                visible_only: true,
                active_doc_visible_translation_context:
                  "workspace_context_snapshot.active_doc_visible_translation_context",
              }),
            },
          }),
        }),
      ],
      one_shot_call_contract: expect.objectContaining({
        supported: true,
        terminal_eligible: false,
        assistant_answer: false,
      }),
    });
    expect(helix.lanes.find((lane) => lane.lane_id === "visual_analysis")).toMatchObject({
      one_shot_call_contract: expect.objectContaining({
        supported: true,
        request_schema_ref: "helix.visual_analysis.one_shot_request.v1",
        response_schema_ref: "helix.visual_analysis.one_shot_response.v1",
        terminal_eligible: false,
        assistant_answer: false,
      }),
      capabilities: [
        expect.objectContaining({
          capability_id: "visual_analysis.inspect_image_region",
          one_shot_status: "executable",
          session_status: "not_supported",
          backend_provider_required: true,
          model_visible_hint: expect.objectContaining({
            required_input_fields: ["source_id", "bbox_px"],
            optional_input_fields: expect.arrayContaining([
              "frame_id",
              "source_attachment_id",
              "page_number",
              "question",
              "reason_for_crop",
              "latex_candidate",
              "requested_backend_provider",
            ]),
            when_to_use: expect.stringContaining("Image Lens source needs a focused crop inspection"),
            when_not_to_use: expect.stringContaining("Do not use for text-only prompts"),
            request_shape_hint: {
              capability_lane_call: expect.objectContaining({
                capability: "visual_analysis.inspect_image_region",
                source_id: "<admitted image, attachment, frame, PDF page render, or Image Lens source id>",
                bbox_px: { x: 0, y: 0, width: 320, height: 240 },
              }),
            },
          }),
          result_authority: "observation_or_receipt_only",
          terminal_eligible: false,
          assistant_answer: false,
        }),
      expect.objectContaining({
        capability_id: "visual_analysis.inspect_frame",
        one_shot_status: "shadow_only",
        session_status: "not_supported",
        backend_provider_required: true,
        model_visible_hint: expect.objectContaining({
          required_input_fields: ["frame_ref"],
          optional_input_fields: expect.arrayContaining([
            "question",
            "source_id",
            "source_kind",
            "requested_backend_provider",
          ]),
          when_to_use: expect.stringContaining("admitted image, screenshot, camera frame, or visual capture"),
          when_not_to_use: expect.stringContaining("do not treat visual analysis output as a final answer"),
          request_shape_hint: {
            capability_lane_call: expect.objectContaining({
              capability: "visual_analysis.inspect_frame",
              frame_ref: "<visual artifact/frame ref from admitted capture>",
            }),
          },
        }),
        result_authority: "observation_or_receipt_only",
      }),
      ],
    });
  });

  it("exposes backend key status without exposing raw secret values", () => {
    const secretValue = "do-not-leak-this-secret";
    const manifest = listHelixCapabilityLanes({
      provider: buildProvider({ id: "codex" }),
      env: {
        GOOGLE_GEMINI_API_KEY: secretValue,
      } as NodeJS.ProcessEnv,
    });
    const translation = manifest.lanes.find((lane) => lane.lane_id === "live_translation");
    const gemini = translation?.backend_providers.find(
      (provider) => provider.provider_id === "live_translation.google_gemini",
    );
    const openai = translation?.backend_providers.find(
      (provider) => provider.provider_id === "live_translation.openai_compatible",
    );

    expect(gemini).toMatchObject({
      provider_id: "live_translation.google_gemini",
      configuration_status: "configured",
      required_env_vars: ["GOOGLE_GEMINI_API_KEY", "GEMINI_API_KEY"],
      configured_env_vars: ["GOOGLE_GEMINI_API_KEY"],
      availability_status: "dry_run",
      raw_secret_exposed: false,
    });
    expect(openai).toMatchObject({
      provider_id: "live_translation.openai_compatible",
      configuration_status: "missing",
      required_env_vars: [
        "LIVE_TRANSLATION_OPENAI_API_KEY",
        "DOC_TRANSLATION_API_KEY",
        "OPENAI_API_KEY",
        "LLM_HTTP_API_KEY",
      ],
      configured_env_vars: [],
      availability_status: "unconfigured",
      permission_status: "configuration_missing",
      fallback_backend_provider: "live_translation.local_runtime",
      raw_secret_exposed: false,
    });
    expect(JSON.stringify(manifest)).not.toContain(secretValue);
  });

  it("keeps configured AI lanes in dry-run instead of executing them", () => {
    const trace = resolveHelixCapabilityLaneRequest({
      provider: buildProvider({ id: "codex" }),
      requestedLane: "interactive_text",
      requestedBackendProvider: "google_gemini",
      env: { OPENAI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
    });

    expect(trace).toMatchObject({
      schema: "helix.capability_lane_resolve_trace.v1",
      selected_runtime_agent_provider: "codex",
      requested_lane: "interactive_text",
      admission_status: "admitted_shadow_only",
      lane_status: "dry_run",
      requested_backend_provider: "google_gemini",
      requested_backend_provider_known: false,
      requested_backend_configuration_status: "unknown",
      requested_backend_availability_status: "unknown",
      requested_backend_permission_status: "unknown",
      requested_backend_cost_class: "unknown",
      requested_backend_latency_class: "unknown",
      requested_backend_privacy_class: "unknown",
      requested_backend_fallback_provider: null,
      selected_backend_provider: "interactive_text.openai_compatible",
      backend_selection_decision: {
        schema: "helix.capability_lane.backend_selection_decision.v1",
        owner: "helix",
        outcome: "fallback_selected",
        reason: "requested_backend_unknown_default_backend_selected_by_helix_policy",
        requested_backend_provider: "google_gemini",
        requested_backend_provider_known: false,
        selected_backend_provider: "interactive_text.openai_compatible",
        fallback_backend_provider: null,
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        dynamic_switching_executed: false,
        live_backend_execution_enabled: false,
        terminal_authority_owner: "helix",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      selection_reason: "requested_backend_unknown_default_backend_selected_by_helix_policy",
      availability_status: "dry_run",
      permission_status: "admitted",
      cost_class: "standard",
      latency_class: "interactive",
      privacy_class: "account_provider",
      fallback_backend_provider: null,
      resolved_backend_provider: "openai_compatible",
      resolved_model_or_service: "interactive_text_default",
      result_ref: null,
      observation_ref: null,
      receipt_ref: null,
      reentry_required: true,
      execution_status: "not_executed_shadow_only",
      blocked_reason: null,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(trace.terminal_policy).toMatchObject({
      terminal_authority_owner: "helix",
      lane_output_can_be_final_answer: false,
    });
  });

  it("records requested translation backend configuration while selecting the local deterministic fallback", () => {
    const unconfiguredGemini = resolveHelixCapabilityLaneRequest({
      provider: buildProvider({ id: "codex" }),
      requestedLane: "live_translation",
      requestedBackendProvider: "live_translation.google_gemini",
      env: {} as NodeJS.ProcessEnv,
    });
    const configuredGemini = resolveHelixCapabilityLaneRequest({
      provider: buildProvider({ id: "codex" }),
      requestedLane: "live_translation",
      requestedBackendProvider: "live_translation.google_gemini",
      env: { GOOGLE_GEMINI_API_KEY: "test-gemini" } as NodeJS.ProcessEnv,
    });

    expect(unconfiguredGemini).toMatchObject({
      requested_lane: "live_translation",
      admission_status: "admitted_shadow_only",
      requested_backend_provider: "live_translation.google_gemini",
      requested_backend_provider_known: true,
      requested_backend_configuration_status: "missing",
      requested_backend_availability_status: "unconfigured",
      requested_backend_permission_status: "configuration_missing",
      requested_backend_cost_class: "standard",
      requested_backend_latency_class: "realtime",
      requested_backend_privacy_class: "external_provider",
      requested_backend_fallback_provider: "live_translation.local_runtime",
      selected_backend_provider: "live_translation.local_runtime",
      backend_selection_decision: {
        schema: "helix.capability_lane.backend_selection_decision.v1",
        owner: "helix",
        outcome: "fallback_selected",
        reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
        requested_backend_provider: "live_translation.google_gemini",
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
      selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
      availability_status: "dry_run",
      permission_status: "admitted",
      cost_class: "free_local",
      latency_class: "interactive",
      privacy_class: "local_only",
      fallback_backend_provider: null,
      resolved_backend_provider: "local_runtime",
      resolved_model_or_service: "live_translation_deterministic_v1",
      execution_status: "not_executed_shadow_only",
    });
    expect(configuredGemini).toMatchObject({
      requested_lane: "live_translation",
      admission_status: "admitted_shadow_only",
      requested_backend_provider: "live_translation.google_gemini",
      requested_backend_provider_known: true,
      requested_backend_configuration_status: "configured",
      requested_backend_availability_status: "dry_run",
      requested_backend_permission_status: "admitted",
      requested_backend_cost_class: "standard",
      requested_backend_latency_class: "realtime",
      requested_backend_privacy_class: "external_provider",
      requested_backend_fallback_provider: "live_translation.local_runtime",
      selected_backend_provider: "live_translation.local_runtime",
      backend_selection_decision: {
        schema: "helix.capability_lane.backend_selection_decision.v1",
        owner: "helix",
        outcome: "requested_recorded_default_selected",
        reason: "requested_backend_recorded_but_default_backend_selected_by_helix_shadow_policy",
        requested_backend_provider: "live_translation.google_gemini",
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
      selection_reason: "requested_backend_recorded_but_default_backend_selected_by_helix_shadow_policy",
      availability_status: "dry_run",
      permission_status: "admitted",
      resolved_backend_provider: "local_runtime",
      resolved_model_or_service: "live_translation_deterministic_v1",
      execution_status: "not_executed_shadow_only",
    });
  });

  it("selects the OpenAI-compatible translation backend only when live external execution is enabled", () => {
    const env = {
      OPENAI_API_KEY: "test-key",
      HELIX_LIVE_TRANSLATION_EXTERNAL_BACKENDS_ENABLED: "1",
    } as NodeJS.ProcessEnv;
    const trace = resolveHelixCapabilityLaneRequest({
      provider: buildProvider({ id: "codex" }),
      requestedLane: "live_translation",
      requestedBackendProvider: "live_translation.openai_compatible",
      env,
    });

    expect(trace).toMatchObject({
      requested_lane: "live_translation",
      admission_status: "admitted_shadow_only",
      requested_backend_provider: "live_translation.openai_compatible",
      requested_backend_provider_known: true,
      requested_backend_configuration_status: "configured",
      selected_backend_provider: "live_translation.openai_compatible",
      backend_selection_decision: expect.objectContaining({
        outcome: "requested_selected",
        requested_backend_provider: "live_translation.openai_compatible",
        selected_backend_provider: "live_translation.openai_compatible",
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        dynamic_switching_executed: false,
        live_backend_execution_enabled: true,
        terminal_authority_owner: "helix",
      }),
      selection_reason: "selected_requested_backend_provider_for_shadow_manifest",
      availability_status: "dry_run",
      permission_status: "admitted",
      cost_class: "standard",
      latency_class: "interactive",
      privacy_class: "account_provider",
      fallback_backend_provider: "live_translation.local_runtime",
      resolved_backend_provider: "openai_compatible",
      resolved_model_or_service: "live_translation_openai_compatible_default",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("selects the configured OpenAI-compatible translation backend as the default when a provider key is available", () => {
    const env = {
      LLM_HTTP_API_KEY: "test-key",
    } as NodeJS.ProcessEnv;
    const trace = resolveHelixCapabilityLaneRequest({
      provider: buildProvider({ id: "codex" }),
      requestedLane: "live_translation",
      env,
    });

    expect(trace).toMatchObject({
      requested_lane: "live_translation",
      requested_backend_provider: null,
      requested_backend_provider_known: false,
      selected_backend_provider: "live_translation.openai_compatible",
      backend_selection_decision: expect.objectContaining({
        outcome: "default_selected",
        requested_backend_provider: null,
        selected_backend_provider: "live_translation.openai_compatible",
        live_backend_execution_enabled: true,
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        terminal_authority_owner: "helix",
      }),
      selection_reason: "selected_default_backend_provider_for_shadow_manifest",
      cost_class: "standard",
      latency_class: "interactive",
      privacy_class: "account_provider",
      fallback_backend_provider: "live_translation.local_runtime",
      resolved_backend_provider: "openai_compatible",
      resolved_model_or_service: "live_translation_openai_compatible_default",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("keeps external translation requests on local fallback when live execution is not enabled", () => {
    const env = {
      OPENAI_API_KEY: "test-key",
      HELIX_LIVE_TRANSLATION_EXTERNAL_BACKENDS_ENABLED: "0",
    } as NodeJS.ProcessEnv;
    const openai = resolveHelixCapabilityLaneRequest({
      provider: buildProvider({ id: "codex" }),
      requestedLane: "live_translation",
      requestedBackendProvider: "live_translation.openai_compatible",
      env,
    });
    const gemini = resolveHelixCapabilityLaneRequest({
      provider: buildProvider({ id: "codex" }),
      requestedLane: "live_translation",
      requestedBackendProvider: "live_translation.google_gemini",
      env: {
        GOOGLE_GEMINI_API_KEY: "test-gemini",
        HELIX_LIVE_TRANSLATION_EXTERNAL_BACKENDS_ENABLED: "1",
      } as NodeJS.ProcessEnv,
    });

    expect(openai).toMatchObject({
      selected_backend_provider: "live_translation.local_runtime",
      backend_selection_decision: expect.objectContaining({
        outcome: "requested_recorded_default_selected",
        requested_backend_provider: "live_translation.openai_compatible",
        selected_backend_provider: "live_translation.local_runtime",
        live_backend_execution_enabled: false,
      }),
      selection_reason: "requested_backend_recorded_but_default_backend_selected_by_helix_shadow_policy",
    });
    expect(gemini).toMatchObject({
      selected_backend_provider: "live_translation.local_runtime",
      backend_selection_decision: expect.objectContaining({
        outcome: "requested_recorded_default_selected",
        requested_backend_provider: "live_translation.google_gemini",
        selected_backend_provider: "live_translation.local_runtime",
        live_backend_execution_enabled: false,
      }),
    });
  });

  it("fails closed for unknown and unconfigured lanes", () => {
    const unknown = resolveHelixCapabilityLaneRequest({
      provider: buildProvider({ id: "helix" }),
      requestedLane: "random_model",
      env: {} as NodeJS.ProcessEnv,
    });
    const unconfigured = resolveHelixCapabilityLaneRequest({
      provider: buildProvider({ id: "helix" }),
      requestedLane: "speech_to_text",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(unknown).toMatchObject({
      admission_status: "blocked",
      lane_status: "unknown",
      resolved_backend_provider: null,
      resolved_model_or_service: null,
      blocked_reason: "unknown_capability_lane",
      execution_status: "not_executed_shadow_only",
    });
    expect(unconfigured).toMatchObject({
      admission_status: "blocked",
      lane_status: "unconfigured",
      resolved_backend_provider: null,
      resolved_model_or_service: null,
      blocked_reason: "backend_provider_key_or_endpoint_not_configured",
      execution_status: "not_executed_shadow_only",
    });
  });

  it("represents provider permission differences without changing lane definitions", () => {
    const enabled = listHelixCapabilityLanes({
      provider: buildProvider({ id: "codex", workstationTools: true }),
      env: {} as NodeJS.ProcessEnv,
    });
    const blocked = listHelixCapabilityLanes({
      provider: buildProvider({ id: "codex", workstationTools: false }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(enabled.lane_ids).toEqual(blocked.lane_ids);
    expect(enabled.lanes.find((lane) => lane.lane_id === "workstation_tool_reference")?.status).toBe("available");
    expect(blocked.lanes.find((lane) => lane.lane_id === "workstation_tool_reference")?.status).toBe("permission_blocked");
  });

  it("keeps the Realtime session lane disabled without a configured key and non-terminal", () => {
    const manifest = listHelixCapabilityLanes({
      provider: buildProvider({ id: "codex" }),
      env: {} as NodeJS.ProcessEnv,
    });
    const lane = manifest.lanes.find((entry) => entry.lane_id === "realtime_session");
    const provider = lane?.backend_providers.find(
      (entry) => entry.provider_id === "realtime_session.openai_realtime",
    );
    const trace = resolveHelixCapabilityLaneRequest({
      provider: buildProvider({ id: "codex" }),
      requestedLane: "realtime_session",
      requestedBackendProvider: "realtime_session.openai_realtime",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(lane).toMatchObject({
      family: "live_runtime_agent",
      status: "disabled",
      status_reason: "capability_lane_disabled_by_policy",
      backend_family: "openai_realtime",
      model_or_service_ref: "gpt-realtime-2.1",
      default_backend_provider: "realtime_session.openai_realtime",
      requestable_by_runtime_provider: false,
      one_shot_call_contract: expect.objectContaining({
        supported: false,
        terminal_eligible: false,
        assistant_answer: false,
      }),
      session_contract: expect.objectContaining({
        supported: true,
        emits_observations: true,
        terminal_eligible: false,
      }),
      goal_binding_contract: expect.objectContaining({
        supported: false,
        backend_provider_becomes_root_agent: false,
      }),
      terminal_policy: expect.objectContaining({
        lane_output_can_be_final_answer: false,
        terminal_authority_owner: "helix",
        requires_evidence_reentry: true,
      }),
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      safety_tags: expect.arrayContaining([
        "developer_only",
        "visible_user_start",
        "requires_visible_consent",
      ]),
    });
    expect(lane?.capabilities.map((capability) => capability.capability_id)).toEqual([
      "realtime_session.start",
      "realtime_session.record_tool_request",
      "realtime_session.record_client_receipt",
    ]);
    expect(provider).toMatchObject({
      configuration_status: "disabled",
      required_env_vars: ["OPENAI_API_KEY"],
      configured_env_vars: [],
      availability_status: "disabled",
      permission_status: "policy_disabled",
      raw_secret_exposed: false,
    });
    expect(trace).toMatchObject({
      admission_status: "blocked",
      lane_status: "disabled",
      requested_backend_provider_known: true,
      selected_backend_provider: null,
      backend_selection_decision: expect.objectContaining({
        outcome: "blocked",
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        live_backend_execution_enabled: false,
        terminal_authority_owner: "helix",
      }),
      resolved_backend_provider: null,
      resolved_model_or_service: null,
      blocked_reason: "capability_lane_disabled_by_policy",
      execution_status: "not_executed_shadow_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("admits the Realtime descriptor from the README OpenAI key without extra startup flags", () => {
    const trace = resolveHelixCapabilityLaneRequest({
      provider: buildProvider({ id: "codex" }),
      requestedLane: "realtime_session",
      env: {
        OPENAI_API_KEY: "test-realtime-key",
      } as NodeJS.ProcessEnv,
    });

    expect(trace).toMatchObject({
      admission_status: "admitted_shadow_only",
      lane_status: "dry_run",
      selected_backend_provider: "realtime_session.openai_realtime",
      resolved_backend_provider: "openai_realtime",
      resolved_model_or_service: "gpt-realtime-2.1",
      execution_status: "not_executed_shadow_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(trace.backend_selection_decision).toMatchObject({
      live_backend_execution_enabled: false,
      backend_provider_becomes_root_agent: false,
      terminal_authority_owner: "helix",
    });
  });

  it("supports the explicit Realtime descriptor flag without enabling adapter transport", () => {
    const trace = resolveHelixCapabilityLaneRequest({
      provider: buildProvider({ id: "codex" }),
      requestedLane: "realtime_session",
      env: {
        HELIX_REALTIME_SESSION_DESCRIPTOR_ENABLED: "1",
        OPENAI_API_KEY: "test-realtime-key",
      } as NodeJS.ProcessEnv,
    });

    expect(trace).toMatchObject({
      admission_status: "admitted_shadow_only",
      lane_status: "dry_run",
      selected_backend_provider: "realtime_session.openai_realtime",
      resolved_backend_provider: "openai_realtime",
      resolved_model_or_service: "gpt-realtime-2.1",
      execution_status: "not_executed_shadow_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(trace.backend_selection_decision).toMatchObject({
      live_backend_execution_enabled: false,
      backend_provider_becomes_root_agent: false,
      terminal_authority_owner: "helix",
    });
  });

  it("honors the explicit Realtime descriptor kill switch even when a key is configured", () => {
    const trace = resolveHelixCapabilityLaneRequest({
      provider: buildProvider({ id: "codex" }),
      requestedLane: "realtime_session",
      requestedBackendProvider: "realtime_session.openai_realtime",
      env: {
        HELIX_REALTIME_SESSION_DESCRIPTOR_ENABLED: "0",
        HELIX_REALTIME_SESSION_ADAPTER_ENABLED: "1",
        HELIX_REALTIME_SESSION_LIVE_TRANSPORT_ENABLED: "1",
        OPENAI_API_KEY: "test-realtime-key",
      } as NodeJS.ProcessEnv,
    });

    expect(trace).toMatchObject({
      admission_status: "blocked",
      lane_status: "disabled",
      selected_backend_provider: null,
      resolved_backend_provider: null,
      resolved_model_or_service: null,
      blocked_reason: "capability_lane_disabled_by_policy",
      execution_status: "not_executed_shadow_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(trace.backend_selection_decision).toMatchObject({
      outcome: "blocked",
      live_backend_execution_enabled: false,
      backend_provider_becomes_root_agent: false,
      terminal_authority_owner: "helix",
    });
  });

  it("keeps every provider-neutral lane model-visible and observation-only", () => {
    const manifest = listHelixCapabilityLanes({
      provider: buildProvider({ id: "codex" }),
      env: {
        OPENAI_API_KEY: "test-key",
        ELEVENLABS_API_KEY: "test-eleven",
        GOOGLE_GEMINI_API_KEY: "test-gemini",
      } as NodeJS.ProcessEnv,
    });

    expect(manifest.lanes.length).toBeGreaterThan(0);
    for (const lane of manifest.lanes) {
      expect(lane.result_authority).toBe("observation_or_receipt_only");
      expect(lane.reentry_required).toBe(true);
      expect(lane.terminal_eligible).toBe(false);
      expect(lane.assistant_answer).toBe(false);
      expect(lane.raw_content_included).toBe(false);
      expect(lane.terminal_policy).toMatchObject({
        lane_output_can_be_final_answer: false,
        terminal_authority_owner: "helix",
        requires_evidence_reentry: true,
        preserves_runtime_provider_root: true,
      });
      expect(lane.one_shot_call_contract).toMatchObject({
        output_role: "observation_or_receipt",
        reentry_required: true,
        terminal_eligible: false,
        assistant_answer: false,
      });

      expect(lane.capabilities.length).toBeGreaterThan(0);
      for (const capability of lane.capabilities) {
        expect(capability.lane_id).toBe(lane.lane_id);
        expect(capability.result_authority).toBe("observation_or_receipt_only");
        expect(capability.reentry_required).toBe(true);
        expect(capability.terminal_eligible).toBe(false);
        expect(capability.assistant_answer).toBe(false);
        expect(capability.raw_content_included).toBe(false);
        expect(capability.model_visible_hint.required_input_fields).toBeInstanceOf(Array);
        expect(capability.model_visible_hint.optional_input_fields).toContain("requested_backend_provider");
        expect(capability.model_visible_hint.when_to_use).toEqual(expect.any(String));
        expect(capability.model_visible_hint.when_to_use.trim().length).toBeGreaterThan(0);
        expect(capability.model_visible_hint.when_not_to_use).toEqual(expect.any(String));
        expect(capability.model_visible_hint.when_not_to_use?.trim().length).toBeGreaterThan(0);
        expect(capability.model_visible_hint.request_shape_hint).toMatchObject({
          capability_lane_call: expect.objectContaining({
            capability: capability.capability_id,
          }),
        });
      }
    }
  });
});
