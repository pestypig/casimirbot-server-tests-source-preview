import { describe, expect, it } from "vitest";
import type { HelixAgentProvider } from "../types";
import { buildHelixAgentRuntimeAdapterContract } from "../runtime-adapter-contract";

const buildProvider = (input: {
  id: "helix" | "codex" | "future";
  permissionProfileId: "helix-native" | "read-observe" | "read-observe-act";
  act: boolean;
}): HelixAgentProvider => ({
  id: input.id,
  label:
    input.id === "helix"
      ? "Helix Ask Native"
      : input.id === "codex"
        ? "Codex Workstation Mode"
        : "Future Agent Wrapper",
  permissionProfile: {
    id: input.permissionProfileId,
    label: input.act ? "Read/observe plus non-mutating workstation action" : "Read/observe only",
    allows: {
      observe: true,
      read: true,
      act: input.act,
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
    capabilityLaneSessions: input.id === "future" ? false : true,
    codeMutation: false,
  },
  runTurn: async () => ({
    ok: false,
    runtime: input.id,
    response_type: "test",
    final_status: "test",
  }),
});

describe("agent runtime adapter contract", () => {
  it("centralizes the Codex provider edge contract for workstation capabilities", () => {
    const contract = buildHelixAgentRuntimeAdapterContract({
      route: "/ask/turn",
      requestedRuntime: "codex",
      provider: buildProvider({
        id: "codex",
        permissionProfileId: "read-observe-act",
        act: true,
      }),
      gatewayMode: "act",
    });

    expect(contract.schema).toBe("helix.agent_runtime_adapter_contract.v1");
    expect(contract.adapter_boundary).toBe("helix_agent_provider_edge");
    expect(contract.selected_runtime).toBe("codex");
    expect(contract.workstation_gateway_manifest.agent_runtime).toBe("codex");
    expect(contract.workstation_gateway_manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: "scientific-calculator.open_panel",
        panel_id: "scientific-calculator",
        action_id: "open_panel",
        permission_profile_required: "act",
      }),
    );
    expect(contract.workstation_gateway_admitted_capability_ids).toContain("scientific-calculator.solve_expression");
    expect(contract.workstation_gateway_admitted_capability_ids).toContain("scientific-calculator.open_panel");
    expect(contract.workstation_gateway_projection_receipt_capability_ids).toContain("scientific-calculator.open_panel");
    expect(contract.workstation_gateway_blocked_capability_ids).toEqual([]);
    expect(contract.capability_lane_manifest.schema).toBe("helix.capability_lane_manifest.v1");
    expect(contract.capability_lane_manifest.selected_runtime_agent_provider).toBe("codex");
    expect(contract.capability_lane_ids).toContain("utility_text");
    expect(contract.capability_lane_ids).toContain("speech_to_text");
    expect(contract.capability_lane_ids).toContain("live_translation");
    expect(contract.capability_lane_ids).toContain("workstation_tool_reference");
    expect(contract.capability_lane_statuses.workstation_tool_reference).toBe("available");
    expect(contract.model_visible_capability_lane_manifest).toMatchObject({
      schema: "helix.agent_model_visible_capability_lane_manifest.v1",
      selected_runtime_agent_provider: "codex",
      authority_rules: {
        helix_owns_backend_selection: true,
        selected_runtime_provider_remains_root: true,
        lane_outputs_are_observations_or_receipts: true,
        lane_outputs_require_reentry: true,
        lane_outputs_are_not_final_answers: true,
        terminal_authority_owner: "helix",
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    const modelVisibleLaneIds = contract.model_visible_capability_lane_manifest.lanes
      .map((lane) => lane.lane_id);
    expect(modelVisibleLaneIds).not.toContain("interactive_text");
    expect(modelVisibleLaneIds).not.toContain("deliberate_text");
    expect(modelVisibleLaneIds).not.toContain("code_text");
    expect(modelVisibleLaneIds).toContain("speech_to_text");
    expect(modelVisibleLaneIds).toContain("live_translation");
    const modelVisibleTranslation = contract.model_visible_capability_lane_manifest.lanes
      .flatMap((lane) => lane.capabilities)
      .find((capability) => capability.capability_id === "live_translation.translate_text");
    expect(modelVisibleTranslation).toMatchObject({
      required_input_fields: ["text", "target_language"],
      optional_input_fields: expect.arrayContaining(["source_language", "requested_backend_provider", "chunk_id", "source_id"]),
      result_authority: "observation_or_receipt_only",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(modelVisibleTranslation?.when_to_use).toContain("translate");
    expect(modelVisibleTranslation?.when_not_to_use).toContain("docs-viewer.read_active_translation");
    expect(JSON.stringify(modelVisibleTranslation?.request_shape_hint)).toContain("capability_lane_call");
    expect(JSON.stringify(modelVisibleTranslation?.request_shape_hint)).toContain("live_translation.translate_text");
    expect(JSON.stringify(modelVisibleTranslation?.session_call_shape_hint)).toContain("capability_lane_session_call");
    expect(JSON.stringify(modelVisibleTranslation?.session_call_shape_hint)).toContain("start | pause | resume | stop | record_observation | list");
    expect(JSON.stringify(modelVisibleTranslation?.session_call_shape_hint)).toContain("source_binding");
    expect(JSON.stringify(modelVisibleTranslation?.session_call_shape_hint)).toContain("source_text_hash");
    expect(JSON.stringify(modelVisibleTranslation?.session_call_shape_hint)).toContain("source_text_char_count");
    expect(JSON.stringify(modelVisibleTranslation?.session_call_shape_hint)).toContain("docs_hover");
    expect(JSON.stringify(modelVisibleTranslation?.goal_binding_call_shape_hint)).toContain("capability_lane_goal_binding_call");
    expect(JSON.stringify(modelVisibleTranslation?.goal_binding_call_shape_hint)).toContain("bind | update_attention | record_mail_loop | record_report | stop");
    expect(JSON.stringify(modelVisibleTranslation?.goal_binding_call_shape_hint)).toContain("terminal_authorized");
    const modelVisibleSpeechToText = contract.model_visible_capability_lane_manifest.lanes
      .flatMap((lane) => lane.capabilities)
      .find((capability) => capability.capability_id === "speech_to_text.transcribe_audio");
    expect(modelVisibleSpeechToText).toMatchObject({
      required_input_fields: ["audio_ref"],
      optional_input_fields: expect.arrayContaining(["transcript_text", "source_id", "thread_id"]),
      result_authority: "observation_or_receipt_only",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(modelVisibleSpeechToText?.when_to_use).toContain("microphone");
    expect(modelVisibleSpeechToText?.when_not_to_use).toContain("submitted prompt");
    expect(JSON.stringify(modelVisibleSpeechToText?.request_shape_hint)).toContain("speech_to_text.transcribe_audio");
    expect(JSON.stringify(modelVisibleSpeechToText?.session_call_shape_hint)).toContain("capability_lane_session_call");
    expect(JSON.stringify(modelVisibleSpeechToText?.session_call_shape_hint)).toContain("audio");
    expect(contract.capability_lane_resolve_trace_shape).toMatchObject({
      schema: "helix.capability_lane_resolve_trace.v1",
      selected_runtime_agent_provider: "codex",
      admission_status: "blocked",
      blocked_reason: "missing_capability_lane",
      execution_status: "not_executed_shadow_only",
    });
    expect(contract.adapter_invariants.helix_owns_tool_admission).toBe(true);
    expect(contract.adapter_invariants.helix_owns_capability_lane_admission).toBe(true);
    expect(contract.adapter_invariants.capability_lanes_are_not_root_agents).toBe(true);
    expect(contract.adapter_invariants.capability_lane_one_shot_execution_enabled).toBe(true);
    expect(contract.adapter_invariants.capability_lane_sessions_enabled).toBe(true);
    expect(contract.adapter_invariants.capability_lane_sessions_are_observation_only).toBe(true);
    expect(contract.supports.capabilityLanes).toBe(true);
    expect(contract.supports.capabilityLaneOneShot).toBe(true);
    expect(contract.supports.capabilityLaneSessions).toBe(true);
    expect(contract.adapter_invariants.helix_owns_observation_packets).toBe(true);
    expect(contract.adapter_invariants.helix_owns_terminal_authority).toBe(true);
    expect(contract.adapter_invariants.receipts_are_not_answers).toBe(true);
    expect(contract.adapter_invariants.non_mutating_ui_actions_are_receipts_only).toBe(true);
    expect(contract.adapter_invariants.helix_preserves_provider_answer_style).toBe(true);
    expect(contract.adapter_invariants.helix_style_rewrite_enabled).toBe(false);
    expect(contract.adapter_invariants.shell_access_enabled).toBe(false);
    expect(contract.adapter_invariants.file_mutation_enabled).toBe(false);
    expect(contract.adapter_invariants.code_mutation_enabled).toBe(false);
    expect(contract.prompt_policy_lines.join("\n")).toContain("Runtime-specific protocol glue stays inside");
    expect(contract.prompt_policy_lines.join("\n")).toContain("Capability lanes may execute only through Helix-governed one-shot lane calls");
    expect(contract.prompt_policy_lines.join("\n")).toContain("Lane sessions may start, pause, resume, stop, or list only through Helix-governed session calls");
    expect(contract.prompt_policy_lines.join("\n")).toContain("keeps the selected runtime agent provider unchanged");
    expect(contract.prompt_policy_lines.join("\n")).toContain("prefer live_translation.translate_text");
    expect(contract.prompt_policy_lines.join("\n")).toContain("Speech-to-text results are source observations");
    expect(contract.prompt_policy_lines.join("\n")).toContain("already-existing translated Docs surfaces");
    expect(contract.prompt_policy_lines.join("\n")).toContain("Do not claim an AI service lane ran unless a Helix lane observation or receipt is present");
    expect(contract.prompt_policy_lines.join("\n")).toContain("does not rewrite, shorten, bulletize");
  });

  it("exposes the same provider-neutral lane definitions for Helix Native and Codex", () => {
    const helix = buildHelixAgentRuntimeAdapterContract({
      route: "/ask/turn",
      requestedRuntime: "helix",
      provider: buildProvider({
        id: "helix",
        permissionProfileId: "helix-native",
        act: true,
      }),
      gatewayMode: "act",
    });
    const codex = buildHelixAgentRuntimeAdapterContract({
      route: "/ask/turn",
      requestedRuntime: "codex",
      provider: buildProvider({
        id: "codex",
        permissionProfileId: "read-observe-act",
        act: true,
      }),
      gatewayMode: "act",
    });

    expect(helix.capability_lane_ids).toEqual(codex.capability_lane_ids);
    expect(helix.capability_lane_manifest.lanes.map((lane) => lane.lane_id)).toEqual(
      codex.capability_lane_manifest.lanes.map((lane) => lane.lane_id),
    );
    expect(helix.selected_runtime).toBe("helix");
    expect(codex.selected_runtime).toBe("codex");
    expect(helix.capability_lane_manifest.lanes.every((lane) => lane.shadow_only)).toBe(true);
    expect(codex.capability_lane_manifest.lanes.every((lane) => lane.terminal_eligible === false)).toBe(true);
    expect(helix.adapter_invariants.capability_lane_one_shot_execution_enabled).toBe(true);
    expect(codex.adapter_invariants.capability_lane_one_shot_execution_enabled).toBe(true);
    expect(helix.adapter_invariants.capability_lane_sessions_enabled).toBe(true);
    expect(codex.adapter_invariants.capability_lane_sessions_enabled).toBe(true);
    expect(helix.supports.capabilityLaneSessions).toBe(true);
    expect(codex.supports.capabilityLaneSessions).toBe(true);
    expect(helix.adapter_invariants.capability_lanes_are_not_root_agents).toBe(true);
    expect(codex.adapter_invariants.capability_lanes_are_not_root_agents).toBe(true);
  });

  it("keeps observation-only providers on the same contract while blocking action capabilities", () => {
    const contract = buildHelixAgentRuntimeAdapterContract({
      route: "/ask/turn",
      requestedRuntime: "future",
      provider: buildProvider({
        id: "future",
        permissionProfileId: "read-observe",
        act: false,
      }),
      gatewayMode: "observe",
    });

    expect(contract.selected_runtime).toBe("future");
    expect(contract.workstation_gateway_admitted_capability_ids).toContain("workspace_os.status");
    expect(contract.workstation_gateway_admitted_capability_ids).toContain("scientific-calculator.solve_expression");
    expect(contract.workstation_gateway_admitted_capability_ids).not.toContain("scientific-calculator.open_panel");
    expect(contract.workstation_gateway_projection_receipt_capability_ids).toContain("scientific-calculator.open_panel");
    expect(contract.workstation_gateway_blocked_capability_ids).not.toContain("scientific-calculator.open_panel");
    expect(contract.adapter_invariants.receipts_are_not_answers).toBe(true);
    expect(contract.adapter_invariants.non_mutating_ui_actions_are_receipts_only).toBe(true);
    expect(contract.assistant_answer).toBe(false);
    expect(contract.terminal_eligible).toBe(false);
    expect(contract.raw_content_included).toBe(false);
  });

  it("does not admit action capabilities for read-observe providers even if an act gateway manifest is requested", () => {
    const contract = buildHelixAgentRuntimeAdapterContract({
      route: "/ask/turn",
      requestedRuntime: "future",
      provider: buildProvider({
        id: "future",
        permissionProfileId: "read-observe",
        act: false,
      }),
      gatewayMode: "act",
    });

    expect(contract.workstation_gateway_manifest.mode).toBe("act");
    expect(contract.selected_agent_provider.permission_profile.allows.act).toBe(false);
    expect(contract.workstation_gateway_admitted_capability_ids).toContain("scientific-calculator.solve_expression");
    expect(contract.workstation_gateway_admitted_capability_ids).not.toContain("scientific-calculator.open_panel");
    expect(contract.workstation_gateway_admitted_capability_ids).not.toContain("workstation.open_panel");
    expect(contract.workstation_gateway_projection_receipt_capability_ids).toContain("scientific-calculator.open_panel");
    expect(contract.workstation_gateway_projection_receipt_capability_ids).toContain("workstation.open_panel");
    expect(contract.workstation_gateway_blocked_capability_ids).not.toContain("scientific-calculator.open_panel");
    expect(contract.workstation_gateway_blocked_capability_ids).not.toContain("workstation.open_panel");
    expect(contract.adapter_invariants.shell_access_enabled).toBe(false);
    expect(contract.adapter_invariants.file_mutation_enabled).toBe(false);
    expect(contract.adapter_invariants.code_mutation_enabled).toBe(false);
  });
});
