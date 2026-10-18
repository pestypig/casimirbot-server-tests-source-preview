import fs from "node:fs";
import path from "node:path";

import {
  buildWorkstationToolName,
  RETIRED_WORKSTATION_DYNAMIC_TOOL_ACTIONS,
  WORKSTATION_DYNAMIC_TOOL_ACTIONS,
} from "@shared/workstation-dynamic-tools";
import { describe, expect, it } from "vitest";

import { explicitCapabilityContractsForTests } from "../../explicit-capability-contract";
import {
  classifyDynamicWorkstationActionForProviderGateway,
  classifyProviderAgentCapability,
  PROVIDER_AGENT_CAPABILITY_CLASSIFICATIONS,
} from "../../provider-agent-capability-contract";
import { listWorkstationGatewayCapabilities } from "../registry";

const repoRoot = process.cwd();
const liveAgentStepPath = path.join(repoRoot, "shared", "helix-live-agent-step.ts");
const providerCapabilityContractDocPath = path.join(repoRoot, "docs", "helix-ask-provider-capability-contracts.md");
const workstationToolContractReadmePath = path.join(
  repoRoot,
  "docs",
  "helix-ask",
  "workstation-tool-contracts",
  "README.md",
);
const theoryExperimentProcedureReadmitContractPath = path.join(
  repoRoot,
  "docs",
  "helix-ask",
  "workstation-tool-contracts",
  "theory-experiment-procedure.readmit.md",
);
const sideEffectEvidenceProjectionContractPath = path.join(
  repoRoot,
  "docs",
  "helix-ask",
  "workstation-tool-contracts",
  "live_env.side_effect_evidence_projection.md",
);
const mutatingControlBoundariesContractPath = path.join(
  repoRoot,
  "docs",
  "helix-ask",
  "workstation-tool-contracts",
  "live_env.mutating_control_boundaries.md",
);
const workstationLoopControlsContractPath = path.join(
  repoRoot,
  "docs",
  "helix-ask",
  "workstation-tool-contracts",
  "live_env.workstation_loop_controls.md",
);
const explicitSideEffectBoundariesContractPath = path.join(
  repoRoot,
  "docs",
  "helix-ask",
  "workstation-tool-contracts",
  "workstation.explicit_side_effect_boundaries.md",
);
const workstationNotesSideEffectActionsContractPath = path.join(
  repoRoot,
  "docs",
  "helix-ask",
  "workstation-tool-contracts",
  "workstation-notes.side_effect_actions.md",
);
const clientReadAloudContractPath = path.join(
  repoRoot,
  "docs",
  "helix-ask",
  "workstation-tool-contracts",
  "client.read_aloud.md",
);
const dynamicPanelActionBoundariesContractPath = path.join(
  repoRoot,
  "docs",
  "helix-ask",
  "workstation-tool-contracts",
  "workstation.dynamic_panel_action_boundaries.md",
);
const explicitRouteAliasBoundariesContractPath = path.join(
  repoRoot,
  "docs",
  "helix-ask",
  "workstation-tool-contracts",
  "workstation.explicit_route_alias_boundaries.md",
);
const helixNativeProcedureBoundariesContractPath = path.join(
  repoRoot,
  "docs",
  "helix-ask",
  "workstation-tool-contracts",
  "live_env.helix_native_procedure_boundaries.md",
);

const readLiveEnvironmentToolNames = (): string[] => {
  const source = fs.readFileSync(liveAgentStepPath, "utf8");
  const typeBlock = source.match(/export type HelixLiveEnvironmentToolName\s*=([\s\S]*?);/)?.[1] ?? "";
  const names = [...typeBlock.matchAll(/\|\s*"([^"]+)"/g)].map((match) => match[1]).filter(Boolean);
  return [...new Set(names)].sort();
};

const reviewedSharedProviderGatewayCapabilityIds = [
  "workspace_os.status",
  "helix_ask.inspect_capability_catalog",
  "workstation.active_context",
  "theory-badge-graph.current_context",
  "workstation-notes.list_notes",
  "scientific-calculator.solve_expression",
  "scientific-calculator.solve_scalar_expression",
  "scientific-calculator.classify_expression",
  "scientific-calculator.bind_variables",
  "scientific-calculator.active_context",
  "workstation.readable_surface.observe",
  "docs-viewer.read_visible_surface",
  "docs-viewer.read_active_translation",
  "scientific-calculator.read_visible_result",
  "scientific-calculator.read_visible_theory_run_result",
  "scientific-calculator.open_panel",
  "scientific-calculator.focus_panel",
  "scientific-calculator.show_gateway_solve",
  "scientific-calculator.prefill_expression",
  "workstation.open_panel",
  "workstation.focus_panel",
  "account_session.set_interface_language",
  "docs-viewer.open_doc",
  "repo.search",
  "docs.search",
  "research-library.read_document",
  "research-library.apply_evidence_enrichment",
  "scholarly-research.lookup_papers",
  "scholarly-research.fetch_full_text",
  "scholarly-research.extract_numeric_parameters",
  "civilization-bounds.reflect_system_bounds",
  "helix_ask.reflect_theory_context",
  "theory-badge-graph.propose_frontier_conjectures",
  "theory-formal-verifier.inspect_artifact_family",
  "theory-formal-verifier.prepare_request",
  "theory-formal-verifier.plan",
  "theory-formal-verifier.start",
  "theory-formal-verifier.read_result",
  "theory-runtime-canary.inspect",
  "theory-runtime-canary.plan",
  "theory-runtime-canary.start",
  "theory-runtime-canary.read_result",
  "theory-artifact-producer.prepare_lanyon_request",
  "theory-artifact-producer.admit_lanyon_snapshot",
  "theory-semantic-admitter.normalize",
  "theory-independent-numerical-verifier.prepare_request",
  "theory-independent-numerical-verifier.plan",
  "theory-independent-numerical-verifier.start",
  "theory-independent-numerical-verifier.read_result",
  "theory-experiment-procedure.prepare",
  "theory-experiment-procedure.readmit",
  "theory-experiment-procedure.evaluate_closure",
  "scientific-evidence-closure.inspect_enrollment",
  "scientific-evidence-closure.prepare",
  "scientific-evidence-closure.evaluate",
  "moral-graph.reflect_context",
  "moral-graph.reflect_living_substrate_context",
  "text_to_speech.speak_text",
  "live_env.request_interim_voice_callout",
  "live_env.narrator_say",
  "live_env.query_visual_summaries",
  "live_env.query_audio_transcripts",
  "live_env.query_translation_segments",
  "live_env.query_microdeck_outputs",
  "live_env.query_live_answer_state",
  "live_env.query_source_health",
  "live_env.query_trace_memory",
  "live_env.query_narrator_events",
  "live_env.query_packet_traces",
  "live_env.query_route_evidence",
  "live_env.query_automation_policies",
  "live_env.query_live_source_loop_health",
  "live_env.query_live_source_quality",
  "live_env.query_workstation_goal_context",
  "live_env.summarize_live_source_current_state",
  "live_env.query_event_log",
  "live_env.query_world_events",
  "live_env.query_navigation_state",
  "live_env.query_stage_sources",
  "live_env.query_constructs",
  "live_env.query_job_evidence",
  "live_env.check_live_source_mail",
  "live_env.read_live_source_mail",
  "live_env.read_processed_live_source_mail",
  "live_env.reflect_live_source_mail_loop",
  "live_env.record_live_source_mail_decision",
  "live_env.compare_mail_to_interpreter_profile",
  "live_env.validate_live_source_prediction",
  "live_env.predict_live_source_immediate",
  "live_env.compare_live_source_prediction",
  "live_env.describe_stage_builder",
  "live_env.validate_stage_play_graph",
  "live_env.plan_stage_play_job",
  "live_env.query_micro_reasoner_presets",
  "live_env.query_micro_reasoner_prompts",
  "live_env.test_micro_reasoner_prompt",
  "live_env.query_visual_observer_profiles",
  "live_env.test_visual_observer_profile",
  "live_env.compare_visual_observer_profiles",
  "room.evidence.read_bound",
  "situation-room.live-source.set_rate",
  "realtime_texture_pack.inspect",
  "realtime_texture_pack.show_overlay",
  "realtime_texture_pack.reveal_original",
  "realtime_texture_pack.stop",
  "realtime_texture_pack.set_visual_direction_profile",
  "realtime_texture_pack.set_custom_visual_directive",
  "realtime_texture_pack.set_dynamic_cue_policy",
  "realtime_texture_pack.pin_current_direction",
  "realtime_texture_pack.resume_dynamic_direction",
  "realtime_texture_pack.clear_agent_visual_direction",
  "com.casimirbot.minecraft.actor.status.read",
  "com.casimirbot.minecraft.inventory.check",
  "com.casimirbot.minecraft.nearby_entities.list",
  "com.casimirbot.minecraft.hazards.scan",
  "com.casimirbot.minecraft.local_map.inspect",
  "com.casimirbot.minecraft.spatial_region.inspect",
  "com.casimirbot.minecraft.line_of_sight.check",
  "com.casimirbot.minecraft.crop_state.read",
  "com.casimirbot.minecraft.reachability.check",
  "com.casimirbot.minecraft.perception_snapshot.read",
  "com.casimirbot.minecraft.registry.fact.read",
  "com.casimirbot.minecraft.recipe.fact.read",
  "com.casimirbot.minecraft.command.catalog",
  "com.casimirbot.minecraft.command",
  "com.casimirbot.minecraft.player.navigate",
  "com.casimirbot.minecraft.player.look",
  "com.casimirbot.minecraft.player.camera.track",
  "com.casimirbot.minecraft.player.walk",
  "com.casimirbot.minecraft.player.jump",
  "com.casimirbot.minecraft.player.interact",
  "com.casimirbot.minecraft.player.combat.attack",
  "com.casimirbot.minecraft.player.combat.guard",
  "com.casimirbot.minecraft.player.hotbar.select",
  "com.casimirbot.minecraft.player.equipment.equip",
  "com.casimirbot.minecraft.player.follow",
  "com.casimirbot.minecraft.player.collect",
  "com.casimirbot.minecraft.player.mine",
  "com.casimirbot.minecraft.player.place",
  "com.casimirbot.minecraft.player.craft",
  "com.casimirbot.minecraft.player.consume",
  "com.casimirbot.minecraft.player.inventory.transfer",
  "com.casimirbot.minecraft.player.sequence.execute",
  "com.casimirbot.minecraft.player.guardian.execute",
  "com.casimirbot.minecraft.player.viability_guardian.arm",
  "com.casimirbot.minecraft.player.viability_guardian.disarm",
  "com.casimirbot.minecraft.player.workflow.status",
  "com.casimirbot.minecraft.player.workflow.resume",
  "com.casimirbot.minecraft.player.workflow.cancel",
  "com.casimirbot.minecraft.player.emergency_stop",
  "com.casimirbot.minecraft.situation_digest.read",
  "com.casimirbot.environment.durable_goal.create",
  "com.casimirbot.environment.durable_goal.inspect",
  "com.casimirbot.environment.durable_goal.append",
  "com.casimirbot.environment.reasoning_role.record",
  "com.casimirbot.environment.reasoning_role.inspect",
  "com.casimirbot.environment.reasoning_role.disposition",
  "com.casimirbot.environment.reasoning_role.arbitrate",
  "environment.brokerage.robinhood.read",
  "environment.minecraft.fabric_loopback.launch_and_join",
  "situation-room.describe_visual_capture",
  "room.list",
  "room.inspect",
  "room.create",
  "room.source.list",
  "room.source.create",
  "room.mission_result.read_selected",
] as const;

const reviewedSharedCapabilityLaneClassifications = [
  "live_translation.translate_text|shared_capability_lane_now|read_observe|capability_lane",
  "visual_analysis.inspect_frame|shared_capability_lane_now|read_observe|capability_lane",
  "visual_analysis.inspect_image_region|shared_capability_lane_now|read_observe|capability_lane",
] as const;

const reviewedNonSharedProviderCapabilityClassifications = [
  "client.read_aloud|client_projection_only|user_confirmed_side_effect|client_projection",
  "com.casimirbot.minecraft.container_contents.read|blocked_pending_contract|read_observe|explicit_contract",
  "debug.inspect_current_turn|safe_to_graduate_next|read_observe|explicit_contract",
  "docs-viewer.identify_current_doc|safe_to_graduate_next|read_observe|explicit_contract",
  "docs-viewer.validate_doc_candidates|safe_to_graduate_next|read_observe|explicit_contract",
  "helix.theory.frontierVectorFieldTrace|safe_to_graduate_next|read_observe|explicit_contract",
  "helix_ask.bridge_theory_ideology_context|safe_to_graduate_next|read_observe|explicit_contract",
  "helix_ask.build_civilization_scenario_frame|safe_to_graduate_next|read_observe|explicit_contract",
  "helix_ask.reflect_context_attachments|safe_to_graduate_next|read_observe|explicit_contract",
  "helix_ask.reflect_ideology_context|safe_to_graduate_next|read_observe|explicit_contract",
  "helix_ask.reflect_live_synthetic_data|safe_to_graduate_next|read_observe|explicit_contract",
  "helix_ask.reflect_workstation_tool_alignment|safe_to_graduate_next|read_observe|explicit_contract",
  "live_env.apply_micro_reasoner_preset|helix_native_only|ui_projection|live_environment",
  "live_env.apply_visual_observer_profile|helix_native_only|ui_projection|live_environment",
  "live_env.bind_workstation_source|blocked_pending_contract|mutating_control|live_environment",
  "live_env.change_workstation_preset|blocked_pending_contract|mutating_control|live_environment",
  "live_env.configure_interpreter_profile|blocked_pending_contract|mutating_control|live_environment",
  "live_env.configure_live_source_watch_job|blocked_pending_contract|mutating_control|live_environment",
  "live_env.configure_route_watch|blocked_pending_contract|mutating_control|live_environment",
  "live_env.configure_visual_observer_profile|helix_native_only|ui_projection|live_environment",
  "live_env.create_micro_reasoner_preset|helix_native_only|ui_projection|live_environment",
  "live_env.draft_micro_reasoner_preset|helix_native_only|ui_projection|live_environment",
  "live_env.draft_stage_play_graph|helix_native_only|ui_projection|live_environment",
  "live_env.evaluate_goal_satisfaction|requires_confirmation_contract|user_confirmed_side_effect|live_environment",
  "live_env.focus_process_graph|blocked_pending_contract|mutating_control|live_environment",
  "live_env.narrator_bind_stream|blocked_pending_contract|user_confirmed_side_effect|live_environment",
  "live_env.pause_workstation_loop|blocked_pending_contract|mutating_control|live_environment",
  "live_env.process_live_source_mail|helix_native_only|ui_projection|live_environment",
  "live_env.project_live_source_narrative|helix_native_only|ui_projection|live_environment",
  "live_env.read_card|requires_confirmation_contract|user_confirmed_side_effect|live_environment",
  "live_env.record_commentary|requires_confirmation_contract|user_confirmed_side_effect|live_environment",
  "live_env.record_voice_steering|requires_confirmation_contract|user_confirmed_side_effect|live_environment",
  "live_env.reflect_stage_play_context|requires_confirmation_contract|user_confirmed_side_effect|live_environment",
  "live_env.repair_loop|blocked_pending_contract|mutating_control|live_environment",
  "live_env.repair_workstation_source|blocked_pending_contract|mutating_control|live_environment",
  "live_env.request_probe|requires_confirmation_contract|user_confirmed_side_effect|live_environment",
  "live_env.request_stage_play_checkpoint|helix_native_only|ui_projection|live_environment",
  "live_env.request_visual_action_replay|helix_native_only|ui_projection|live_environment",
  "live_env.resume_workstation_loop|blocked_pending_contract|mutating_control|live_environment",
  "live_env.route_micro_reasoner_prompt|helix_native_only|ui_projection|live_environment",
  "live_env.set_audio_preset|blocked_pending_contract|mutating_control|live_environment",
  "live_env.set_visual_preset|blocked_pending_contract|mutating_control|live_environment",
  "live_env.set_workstation_loop_state|blocked_pending_contract|mutating_control|live_environment",
  "live_env.spawn_field_worker|blocked_pending_contract|mutating_control|live_environment",
  "live_env.start_agent_goal_session|blocked_pending_contract|mutating_control|live_environment",
  "live_env.unbind_workstation_source|blocked_pending_contract|mutating_control|live_environment",
  "live_env.update_live_answer_projection|blocked_pending_contract|mutating_control|live_environment",
  "live_env.update_live_source_immersion_state|helix_native_only|ui_projection|live_environment",
  "live_env.update_micro_reasoner_prompt|helix_native_only|ui_projection|live_environment",
  "live_pipeline|blocked_pending_contract|mutating_control|explicit_contract",
  "narrator.bind_stream|blocked_pending_contract|user_confirmed_side_effect|live_environment_alias",
  "narrator.say|requires_confirmation_contract|user_confirmed_side_effect|live_environment_alias",
  "narrator_bind_stream|blocked_pending_contract|user_confirmed_side_effect|live_environment_alias",
  "narrator_say|requires_confirmation_contract|user_confirmed_side_effect|live_environment_alias",
  "runtime_evidence|safe_to_graduate_next|read_observe|explicit_contract",
  "scientific-calculator.open|blocked_pending_contract|user_confirmed_side_effect|explicit_contract",
  "scientific-calculator.start_equation_live_source|blocked_pending_contract|user_confirmed_side_effect|explicit_contract",
  "workspace-directory.resolve|safe_to_graduate_next|read_observe|explicit_contract",
  "workstation-notes.append_to_note|blocked_pending_contract|user_confirmed_side_effect|explicit_contract",
  "workstation-notes.create_note|candidate_host_receipt_bridge|user_confirmed_side_effect|explicit_contract",
  "workstation-notes.create|blocked_pending_contract|user_confirmed_side_effect|explicit_contract",
  "workstation-notes.open|blocked_pending_contract|user_confirmed_side_effect|explicit_contract",
] as const;

describe("provider-agent capability contract catalog", () => {
  it("classifies every Helix live-environment tool name for provider gateway graduation", () => {
    const missing = readLiveEnvironmentToolNames()
      .filter((toolName) => !classifyProviderAgentCapability(toolName));

    expect(missing).toEqual([]);
  });

  it("classifies every explicit live-environment capability contract", () => {
    const missing = explicitCapabilityContractsForTests
      .map((contract) => contract.capability)
      .filter((capability) => (
        capability.startsWith("live_env.") ||
        capability.startsWith("narrator.") ||
        capability.startsWith("narrator_")
      ))
      .filter((capability) => !classifyProviderAgentCapability(capability));

    expect(missing).toEqual([]);
  });

  it("classifies every explicit Helix Ask capability contract for provider gateway graduation", () => {
    const missing = explicitCapabilityContractsForTests
      .map((contract) => contract.capability)
      .filter((capability) => !classifyProviderAgentCapability(capability));

    expect(missing).toEqual([]);
  });

  it("classifies every explicit capability runtime surface and allowed substitution", () => {
    const surfaces = explicitCapabilityContractsForTests.flatMap((contract) => [
      contract.capability,
      contract.runtime_capability ?? "",
      ...contract.allowed_substitutions,
    ]).filter(Boolean);
    const missing = [...new Set(surfaces)]
      .sort()
      .filter((surface) => !classifyProviderAgentCapability(surface));

    expect(missing).toEqual([]);
  });

  it("keeps current workstation gateway capabilities shared across provider runtimes", () => {
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "observe",
    }).capabilities;

    expect(gatewayCapabilities.length).toBeGreaterThan(0);
    for (const capability of gatewayCapabilities) {
      expect(classifyProviderAgentCapability(capability.capability_id)).toMatchObject({
        capability_id: capability.capability_id,
        surface: "workstation_gateway",
        availability: "shared_gateway_now",
        provider_availability: {
          helix_native: true,
          codex_workstation: true,
          future_provider: true,
        },
      });
    }
  });

  it("matches the reviewed shared provider gateway catalog snapshot", () => {
    const manifests = [
      listWorkstationGatewayCapabilities({ agentRuntime: "helix", mode: "act" }),
      listWorkstationGatewayCapabilities({ agentRuntime: "codex", mode: "act" }),
      listWorkstationGatewayCapabilities({ agentRuntime: "future", mode: "act" }),
    ];

    for (const manifest of manifests) {
      expect(manifest.capabilities.map((capability) => capability.capability_id)).toEqual(
        reviewedSharedProviderGatewayCapabilityIds,
      );
    }
  });

  it("pins theory procedure readmission as an exact owner-scoped read-only continuation", () => {
    const manifests = [
      listWorkstationGatewayCapabilities({ agentRuntime: "helix", mode: "act" }),
      listWorkstationGatewayCapabilities({ agentRuntime: "codex", mode: "act" }),
      listWorkstationGatewayCapabilities({ agentRuntime: "future", mode: "act" }),
    ];
    for (const manifest of manifests) {
      const capability = manifest.capabilities.find(
        (candidate) =>
          candidate.capability_id === "theory-experiment-procedure.readmit",
      );
      expect(capability).toMatchObject({
        mode: "read",
        mutating: false,
        requires_confirmation: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "procedure_artifact_ref",
            "procedure_id",
            "procedure_sha256",
          ],
        },
        output_observation_schema:
          "casimir.theory_experiment_procedure.observation.v1",
      });
      expect(capability?.safety_tags).toEqual(
        expect.arrayContaining([
          "developer_only",
          "read_only_procedure_readmission",
          "server_retained_artifact",
          "session_scoped",
          "exact_procedure_hash_binding",
          "non_terminal",
        ]),
      );
    }

    const providerContract = fs.readFileSync(
      providerCapabilityContractDocPath,
      "utf8",
    );
    const contractIndex = fs.readFileSync(
      workstationToolContractReadmePath,
      "utf8",
    );
    const readmitContract = fs.readFileSync(
      theoryExperimentProcedureReadmitContractPath,
      "utf8",
    );
    expect(providerContract).toContain(
      "`procedure_artifact_ref`/`procedure_id`/`procedure_sha256`",
    );
    expect(providerContract).toContain("process-local for 24 hours");
    expect(contractIndex).toContain(
      "[theory-experiment-procedure.readmit.md](theory-experiment-procedure.readmit.md)",
    );
    expect(readmitContract).toContain(
      "scope: exact account type, profile id, and session id",
    );
    expect(readmitContract).toContain("terminal_eligible=false");
  });

  it("keeps explicitly classified non-manifest capabilities out of the shared gateway manifest", () => {
    const gatewayManifest = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    });
    const gatewayIds = new Set(
      gatewayManifest.capabilities.map((capability) => capability.capability_id),
    );
    const overlappingClassifications = PROVIDER_AGENT_CAPABILITY_CLASSIFICATIONS
      .map((classification) => classification.capability_id)
      .filter((capabilityId) => gatewayIds.has(capabilityId))
      .sort();

    expect(overlappingClassifications).toEqual([]);
  });

  it("matches the reviewed non-shared provider capability classification snapshot", () => {
    const current = PROVIDER_AGENT_CAPABILITY_CLASSIFICATIONS
      .filter((classification) => !["shared_gateway_now", "shared_capability_lane_now"].includes(classification.availability))
      .map((classification) => [
        classification.capability_id,
        classification.availability,
        classification.permission_class,
        classification.surface,
      ].join("|"))
      .sort();

    expect(current).toEqual(reviewedNonSharedProviderCapabilityClassifications);
  });

  it("matches the reviewed shared capability-lane classification snapshot", () => {
    const current = PROVIDER_AGENT_CAPABILITY_CLASSIFICATIONS
      .filter((classification) => classification.availability === "shared_capability_lane_now")
      .map((classification) => [
        classification.capability_id,
        classification.availability,
        classification.permission_class,
        classification.surface,
      ].join("|"))
      .sort();

    expect(current).toEqual(reviewedSharedCapabilityLaneClassifications);
    expect(classifyProviderAgentCapability("live_translation.translate_text")).toMatchObject({
      capability_id: "live_translation.translate_text",
      surface: "capability_lane",
      availability: "shared_capability_lane_now",
      permission_class: "read_observe",
      provider_availability: {
        helix_native: true,
        codex_workstation: true,
        future_provider: true,
      },
    });
  });

  it("keeps every shared provider gateway capability inside the bounded authority envelope", () => {
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    }).capabilities;

    expect(gatewayCapabilities.length).toBeGreaterThan(0);
    for (const capability of gatewayCapabilities) {
      const terminalEligible = capability.capability_id === "account_session.set_interface_language";
      expect(capability, capability.capability_id).toMatchObject({
        code_mutation: false,
        shell_access: false,
        terminal_eligible: terminalEligible,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(["observe", "read", "act"]).toContain(capability.permission_profile_required);
      expect(capability.permission_profile_required, capability.capability_id).not.toBe("write");
      expect(capability.permission_profile_required, capability.capability_id).not.toBe("danger");
      expect(capability.input_schema, capability.capability_id).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(capability.output_observation_schema, capability.capability_id).toEqual(expect.any(String));
      expect(capability.output_observation_schema.trim(), capability.capability_id).not.toBe("");
      if (terminalEligible) {
        expect(capability.safety_tags, capability.capability_id).toContain("workspace_action_receipt");
      } else {
        expect(capability.safety_tags, capability.capability_id).toContain("non_terminal");
      }
      expect(capability.safety_tags, capability.capability_id).toContain("no_shell");
      expect(capability.safety_tags, capability.capability_id).toContain("no_code_mutation");
    }
  });

  it("documents every shared and held-back provider capability classification", () => {
    const contractDoc = fs.readFileSync(providerCapabilityContractDocPath, "utf8");
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    }).capabilities.map((capability) => capability.capability_id);
    const classifiedCapabilities = PROVIDER_AGENT_CAPABILITY_CLASSIFICATIONS
      .map((classification) => classification.capability_id);
    const missing = [...new Set([...gatewayCapabilities, ...classifiedCapabilities])]
      .sort()
      .filter((capabilityId) => !contractDoc.includes(capabilityId));

    expect(missing).toEqual([]);
  });

  it("keeps the provider contract Shared Now list in exact sync with the shared gateway snapshot", () => {
    const contractDoc = fs.readFileSync(providerCapabilityContractDocPath, "utf8");
    const sharedNowBlock = contractDoc.match(/## Shared Now[\s\S]*?```txt\n([\s\S]*?)\n```/)?.[1] ?? "";
    const documentedSharedNow = sharedNowBlock
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(documentedSharedNow).toEqual(reviewedSharedProviderGatewayCapabilityIds);
  });

  it("documents every shared gateway observation or receipt schema", () => {
    const contractDoc = fs.readFileSync(providerCapabilityContractDocPath, "utf8");
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const gatewaySchemas = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    }).capabilities
      .map((capability) => capability.output_observation_schema)
      .filter(Boolean);
    const missing = [...new Set(gatewaySchemas)]
      .sort()
      .filter((schema) => !contractDoc.includes(schema) && !contractIndex.includes(schema));

    expect(missing).toEqual([]);
  });

  it("documents required input args for every shared gateway capability that requires args", () => {
    const contractDoc = fs.readFileSync(providerCapabilityContractDocPath, "utf8");
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    }).capabilities;
    const missing = gatewayCapabilities.flatMap((capability) => {
      const requiredArgs = Array.isArray(capability.input_schema.required)
        ? capability.input_schema.required.map((arg) => String(arg))
        : [];
      if (requiredArgs.length <= 0) return [];
      const rowPattern = new RegExp(
        `\\|\\s*\`${capability.capability_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\`\\s*\\|([^\\n]+)\\|`,
      );
      const capabilityRow = rowPattern.exec(contractDoc)?.[1] ?? "";
      return requiredArgs
        .filter((arg) => !capabilityRow.includes(`\`${arg}\``))
        .map((arg) => `${capability.capability_id}:${arg}`);
    }).sort();

    expect(missing).toEqual([]);
  });

  it("maps every non-gateway provider classification to a workstation contract or boundary", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const boundaryDocs = [
      sideEffectEvidenceProjectionContractPath,
      mutatingControlBoundariesContractPath,
      explicitSideEffectBoundariesContractPath,
      clientReadAloudContractPath,
      dynamicPanelActionBoundariesContractPath,
      explicitRouteAliasBoundariesContractPath,
      helixNativeProcedureBoundariesContractPath,
    ].map((contractPath) => fs.readFileSync(contractPath, "utf8"));
    const missing = PROVIDER_AGENT_CAPABILITY_CLASSIFICATIONS
      .filter((classification) => !["workstation_gateway", "capability_lane"].includes(classification.surface))
      .map((classification) => classification.capability_id)
      .filter((capabilityId) => (
        !contractIndex.includes(`\`${capabilityId}\``) &&
        !boundaryDocs.some((doc) => doc.includes(capabilityId))
      ))
      .sort();

    expect(missing).toEqual([]);
  });

  it("indexes every shared workstation gateway capability in the workstation tool contracts", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    }).capabilities.map((capability) => capability.capability_id);
    const missing = [...new Set(gatewayCapabilities)]
      .sort()
      .filter((capabilityId) => !contractIndex.includes(`\`${capabilityId}\``));

    expect(missing).toEqual([]);
  });

  it("documents held-back side-effect evidence tools without exposing them through the provider gateway", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const sideEffectContract = fs.readFileSync(sideEffectEvidenceProjectionContractPath, "utf8");
    const gatewayIds = new Set(
      listWorkstationGatewayCapabilities({
        agentRuntime: "codex",
        mode: "act",
      }).capabilities.map((capability) => capability.capability_id),
    );
    const heldBackSideEffectEvidenceTools = [
      "live_env.read_card",
      "live_env.reflect_stage_play_context",
      "live_env.request_probe",
      "live_env.record_commentary",
      "live_env.evaluate_goal_satisfaction",
    ];

    for (const capabilityId of heldBackSideEffectEvidenceTools) {
      expect(contractIndex).toContain(`\`${capabilityId}\``);
      expect(sideEffectContract).toContain(capabilityId);
      expect(gatewayIds.has(capabilityId)).toBe(false);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "requires_confirmation_contract",
        permission_class: "user_confirmed_side_effect",
        provider_availability: {
          codex_workstation: false,
          future_provider: false,
        },
      });
    }
  });

  it("documents held-back mutating controls without exposing them through the provider gateway", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const mutatingControlContract = fs.readFileSync(mutatingControlBoundariesContractPath, "utf8");
    const workstationLoopControlsContract = fs.readFileSync(workstationLoopControlsContractPath, "utf8");
    const gatewayIds = new Set(
      listWorkstationGatewayCapabilities({
        agentRuntime: "codex",
        mode: "act",
      }).capabilities.map((capability) => capability.capability_id),
    );
    const heldBackMutatingControls = [
      "live_env.start_agent_goal_session",
      "live_env.change_workstation_preset",
      "live_env.set_visual_preset",
      "live_env.set_audio_preset",
      "live_env.bind_workstation_source",
      "live_env.unbind_workstation_source",
      "live_env.pause_workstation_loop",
      "live_env.resume_workstation_loop",
      "live_env.set_workstation_loop_state",
      "live_env.repair_loop",
      "live_env.repair_workstation_source",
      "live_env.update_live_answer_projection",
      "live_env.focus_process_graph",
      "live_env.configure_route_watch",
      "live_env.configure_live_source_watch_job",
      "live_env.configure_interpreter_profile",
      "live_env.spawn_field_worker",
    ];

    for (const capabilityId of heldBackMutatingControls) {
      expect(contractIndex).toContain(`\`${capabilityId}\``);
      expect(mutatingControlContract).toContain(capabilityId);
      if (
        capabilityId === "live_env.pause_workstation_loop" ||
        capabilityId === "live_env.resume_workstation_loop" ||
        capabilityId === "live_env.set_workstation_loop_state"
      ) {
        expect(workstationLoopControlsContract).toContain(capabilityId);
      }
      expect(gatewayIds.has(capabilityId)).toBe(false);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "blocked_pending_contract",
        permission_class: "mutating_control",
        provider_availability: {
          codex_workstation: false,
          future_provider: false,
        },
      });
    }
    expect(workstationLoopControlsContract).toContain("Do not pause the workstation loop");
    expect(workstationLoopControlsContract).toContain("`live_env.pause_workstation_loop` appears in the logs");
    expect(workstationLoopControlsContract).toContain("Query loop health, but don't change the loop state");
  });

  it("documents held-back explicit workstation side effects without exposing them through the provider gateway", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const explicitSideEffectContract = fs.readFileSync(explicitSideEffectBoundariesContractPath, "utf8");
    const workstationNotesSideEffectContract = fs.readFileSync(workstationNotesSideEffectActionsContractPath, "utf8");
    const gatewayIds = new Set(
      listWorkstationGatewayCapabilities({
        agentRuntime: "codex",
        mode: "act",
      }).capabilities.map((capability) => capability.capability_id),
    );
    const heldBackExplicitSideEffects = [
      "scientific-calculator.open",
      "scientific-calculator.start_equation_live_source",
      "workstation-notes.append_to_note",
      "workstation-notes.create",
      "workstation-notes.open",
    ];

    for (const capabilityId of heldBackExplicitSideEffects) {
      expect(contractIndex).toContain(`\`${capabilityId}\``);
      expect(explicitSideEffectContract).toContain(capabilityId);
      if (capabilityId.startsWith("workstation-notes.")) {
        expect(workstationNotesSideEffectContract).toContain(capabilityId);
      }
      expect(gatewayIds.has(capabilityId)).toBe(false);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "blocked_pending_contract",
        permission_class: "user_confirmed_side_effect",
        provider_availability: {
          codex_workstation: false,
          future_provider: false,
        },
      });
    }
    expect(contractIndex).toContain("`workstation-notes.create_note`");
    expect(explicitSideEffectContract).toContain("workstation-notes.create_note");
    expect(workstationNotesSideEffectContract).toContain("workstation-notes.create_note");
    expect(gatewayIds.has("workstation-notes.create_note")).toBe(false);
    expect(classifyProviderAgentCapability("workstation-notes.create_note")).toMatchObject({
      availability: "candidate_host_receipt_bridge",
      permission_class: "user_confirmed_side_effect",
      provider_availability: {
        codex_workstation: true,
        future_provider: false,
      },
    });
    expect(workstationNotesSideEffectContract).toContain("workstation-notes.create -> workstation-notes.create_note");
    expect(workstationNotesSideEffectContract).toContain("Do not create a note");
    expect(workstationNotesSideEffectContract).toContain("`workstation-notes.append_to_note` appears in this document");
    expect(workstationNotesSideEffectContract).toContain("List my notes, but don't open or edit anything");
  });

  it("documents client read-aloud as client-only projection, not a provider voice tool", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const clientReadAloudContract = fs.readFileSync(clientReadAloudContractPath, "utf8");
    const gatewayIds = new Set(
      listWorkstationGatewayCapabilities({
        agentRuntime: "codex",
        mode: "act",
      }).capabilities.map((capability) => capability.capability_id),
    );

    expect(contractIndex).toContain("`client.read_aloud`");
    expect(clientReadAloudContract).toContain("client.read_aloud");
    expect(gatewayIds.has("client.read_aloud")).toBe(false);
    expect(classifyProviderAgentCapability("client.read_aloud")).toMatchObject({
      availability: "client_projection_only",
      permission_class: "user_confirmed_side_effect",
      provider_availability: {
        helix_native: false,
        codex_workstation: false,
        future_provider: false,
      },
    });
  });

  it("documents explicit route alias candidates without exposing them through the provider gateway", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const explicitRouteAliasContract = fs.readFileSync(explicitRouteAliasBoundariesContractPath, "utf8");
    const gatewayManifest = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    });
    const gatewayIds = new Set(
      gatewayManifest.capabilities.map((capability) => capability.capability_id),
    );
    const knownGatewayIds = new Set([
      ...gatewayIds,
      ...(gatewayManifest.unavailable_capabilities ?? [])
        .map((capability) => capability.capability_id),
    ]);
    const sharedExplicitRouteAliases = [
      "repo-code.search_concept",
      "internet_search.web_research",
      "theory-badge-graph.reflect_discussion_context",
      "helix_ask.reflect_civilization_bounds",
      "scientific-calculator.solve_with_steps",
      "scientific-calculator.solve",
      "docs-viewer.open",
      "docs-viewer.search_docs",
      "docs-viewer.open_doc_by_path",
      "docs-viewer.locate_in_doc",
      "docs-viewer.summarize_doc",
      "docs-viewer.doc_equation_context",
      "image_lens.inspect",
    ];
    const heldBackExplicitRouteAliasCandidates = [
      "helix_ask.reflect_workstation_tool_alignment",
      "workspace-directory.resolve",
      "helix.theory.frontierVectorFieldTrace",
      "helix_ask.reflect_live_synthetic_data",
      "helix_ask.reflect_context_attachments",
      "helix_ask.reflect_ideology_context",
      "helix_ask.bridge_theory_ideology_context",
      "helix_ask.build_civilization_scenario_frame",
      "docs-viewer.identify_current_doc",
      "docs-viewer.validate_doc_candidates",
    ];

    expect(contractIndex).toContain("`workstation.explicit_route_aliases`");
    for (const capabilityId of sharedExplicitRouteAliases) {
      const classification = classifyProviderAgentCapability(capabilityId);
      expect(explicitRouteAliasContract).toContain(capabilityId);
      expect(gatewayIds.has(capabilityId)).toBe(false);
      expect(classification).toMatchObject({
        availability: "shared_gateway_now",
        provider_availability: {
          codex_workstation: true,
          future_provider: true,
        },
      });
      expect(classification?.provider_gateway_alias_target, capabilityId).toEqual(expect.any(String));
      expect(classification?.provider_gateway_alias_target, capabilityId).not.toBe(capabilityId);
      expect(knownGatewayIds.has(classification?.provider_gateway_alias_target ?? ""), capabilityId).toBe(true);
      expect(explicitRouteAliasContract).toContain(classification?.provider_gateway_alias_target ?? "");
    }
    for (const capabilityId of heldBackExplicitRouteAliasCandidates) {
      expect(explicitRouteAliasContract).toContain(capabilityId);
      expect(gatewayIds.has(capabilityId)).toBe(false);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "safe_to_graduate_next",
        provider_availability: {
          codex_workstation: false,
          future_provider: false,
        },
      });
    }
  });

  it("documents Helix-native procedure boundaries without exposing them through the provider gateway", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const helixNativeProcedureContract = fs.readFileSync(helixNativeProcedureBoundariesContractPath, "utf8");
    const gatewayIds = new Set(
      listWorkstationGatewayCapabilities({
        agentRuntime: "codex",
        mode: "act",
      }).capabilities.map((capability) => capability.capability_id),
    );
    const helixNativeOnlyProcedures = [
      "live_env.process_live_source_mail",
      "live_env.draft_stage_play_graph",
      "live_env.request_stage_play_checkpoint",
      "live_env.draft_micro_reasoner_preset",
      "live_env.route_micro_reasoner_prompt",
      "live_env.apply_micro_reasoner_preset",
      "live_env.create_micro_reasoner_preset",
      "live_env.update_micro_reasoner_prompt",
      "live_env.configure_visual_observer_profile",
      "live_env.apply_visual_observer_profile",
      "live_env.request_visual_action_replay",
      "live_env.project_live_source_narrative",
      "live_env.update_live_source_immersion_state",
    ];
    const voiceProcedureBoundaries = [
      ["live_env.record_voice_steering", "requires_confirmation_contract"],
      ["live_env.narrator_bind_stream", "blocked_pending_contract"],
      ["narrator.say", "requires_confirmation_contract"],
      ["narrator.bind_stream", "blocked_pending_contract"],
      ["narrator_bind_stream", "blocked_pending_contract"],
    ] as const;

    expect(contractIndex).toContain("`live_env.helix_native_procedures`");
    for (const capabilityId of helixNativeOnlyProcedures) {
      expect(helixNativeProcedureContract).toContain(capabilityId);
      expect(gatewayIds.has(capabilityId)).toBe(false);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "helix_native_only",
        provider_availability: {
          codex_workstation: false,
          future_provider: false,
        },
      });
    }
    for (const [capabilityId, availability] of voiceProcedureBoundaries) {
      expect(helixNativeProcedureContract).toContain(capabilityId);
      expect(gatewayIds.has(capabilityId)).toBe(false);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability,
        permission_class: "user_confirmed_side_effect",
        provider_availability: {
          codex_workstation: false,
          future_provider: false,
        },
      });
    }
    expect(
      classifyProviderAgentCapability(
        "live_env.record_live_source_mail_decision",
      ),
    ).toMatchObject({
      availability: "shared_gateway_now",
      permission_class: "mutating_control",
      provider_availability: {
        codex_workstation: true,
        future_provider: true,
      },
    });
  });

  it("derives shared gateway permission classes from the gateway manifest shape", () => {
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    }).capabilities;

    for (const capability of gatewayCapabilities) {
      const expectedPermissionClass = capability.mutating
        ? "mutating_control"
        : capability.requires_confirmation
          ? "user_confirmed_side_effect"
          : capability.mode === "act"
            ? "ui_projection"
            : "read_observe";
      expect(classifyProviderAgentCapability(capability.capability_id)).toMatchObject({
        capability_id: capability.capability_id,
        availability: "shared_gateway_now",
        permission_class: expectedPermissionClass,
      });
    }

    expect(classifyProviderAgentCapability("live_env.request_interim_voice_callout")).toMatchObject({
      permission_class: "user_confirmed_side_effect",
    });
    expect(classifyProviderAgentCapability("live_env.narrator_say")).toMatchObject({
      permission_class: "user_confirmed_side_effect",
    });
    expect(classifyProviderAgentCapability("workstation.open_panel")).toMatchObject({
      permission_class: "ui_projection",
    });
    expect(classifyProviderAgentCapability("workspace_os.status")).toMatchObject({
      permission_class: "read_observe",
    });
  });

  it("keeps workstation tool contract index links resolvable", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const contractDir = path.dirname(workstationToolContractReadmePath);
    const links = [...contractIndex.matchAll(/\]\(([^)]+\.md)\)/g)]
      .map((match) => match[1])
      .filter((href) => !href.startsWith(".."));
    const missing = [...new Set(links)]
      .sort()
      .filter((href) => !fs.existsSync(path.join(contractDir, href)));

    expect(missing).toEqual([]);
  });

  it("keeps every local workstation tool contract reachable from the contract index", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const contractDir = path.dirname(workstationToolContractReadmePath);
    const indexedLinks = new Set(
      [...contractIndex.matchAll(/\]\(([^)]+\.md)\)/g)]
        .map((match) => match[1].replace(/\\/g, "/"))
        .filter((href) => !href.startsWith("..")),
    );
    const unindexed = fs.readdirSync(contractDir)
      .filter((fileName) => fileName.endsWith(".md") && fileName !== "README.md")
      .sort()
      .filter((fileName) => !indexedLinks.has(fileName));

    expect(unindexed).toEqual([]);
  });

  it("keeps every shared gateway capability represented in the workstation contract index", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const gatewayCapabilityIds = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    }).capabilities.map((capability) => capability.capability_id);
    const missing = gatewayCapabilityIds
      .filter((capabilityId) => !contractIndex.includes(`\`${capabilityId}\``))
      .sort();

    expect(missing).toEqual([]);
  });

  it("keeps workstation tool contracts on the shared lifecycle template", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const contractDir = path.dirname(workstationToolContractReadmePath);
    const links = [...contractIndex.matchAll(/\]\(([^)]+\.md)\)/g)]
      .map((match) => match[1])
      .filter((href) => !href.startsWith(".."));
    const requiredSections = [
      "## Purpose",
      "## Owner",
      "## Inputs",
      "## Observation",
      "## Host Projection",
      "## Visible Trace",
      "## Tests",
    ];
    const missing = [...new Set(links)].sort().flatMap((href) => {
      const text = fs.readFileSync(path.join(contractDir, href), "utf8");
      return requiredSections
        .filter((section) => !text.includes(section))
        .map((section) => `${href}:${section}`);
    });

    expect(missing).toEqual([]);
  });

  it("keeps every workstation tool contract explicit about non-answer authority flags", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const contractDir = path.dirname(workstationToolContractReadmePath);
    const links = [...contractIndex.matchAll(/\]\(([^)]+\.md)\)/g)]
      .map((match) => match[1])
      .filter((href) => !href.startsWith(".."));
    const requiredFlags = [
      "assistant_answer=false",
      "raw_content_included=false",
      "terminal_eligible=false",
    ];
    const missing = [...new Set(links)].sort().flatMap((href) => {
      const text = fs.readFileSync(path.join(contractDir, href), "utf8");
      return requiredFlags
        .filter((flag) => !text.includes(flag))
        .map((flag) => `${href}:${flag}`);
    });

    expect(missing).toEqual([]);
  });

  it("keeps every workstation tool contract explicit about negative admission", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const contractDir = path.dirname(workstationToolContractReadmePath);
    const links = [...contractIndex.matchAll(/\]\(([^)]+\.md)\)/g)]
      .map((match) => match[1])
      .filter((href) => !href.startsWith(".."));
    const negativeAdmissionPattern =
      /(?:##\s+Negative\s+(?:Admission|Cases)|Blocked:|Blocked\s+inputs|negative\s+admission\s+cases|must\s+not\s+(?:execute|admit)|non-admission)/i;
    const missing = [...new Set(links)].sort().filter((href) => {
      const text = fs.readFileSync(path.join(contractDir, href), "utf8");
      return !negativeAdmissionPattern.test(text);
    });

    expect(missing).toEqual([]);
  });

  it("exposes voice through the shared gateway only after receipt/confirmation contract graduation", () => {
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    }).capabilities;
    const gatewayIds = gatewayCapabilities.map((capability) => capability.capability_id);

    expect(gatewayIds).toContain("live_env.request_interim_voice_callout");
    expect(gatewayIds).toContain("live_env.narrator_say");
    expect(classifyProviderAgentCapability("live_env.request_interim_voice_callout")).toMatchObject({
      availability: "shared_gateway_now",
      provider_availability: {
        helix_native: true,
        codex_workstation: true,
        future_provider: true,
      },
    });
    expect(classifyProviderAgentCapability("live_env.narrator_say")).toMatchObject({
      availability: "shared_gateway_now",
    });
    expect(gatewayCapabilities.find((capability) => capability.capability_id === "live_env.request_interim_voice_callout"))
      .toMatchObject({
        requires_confirmation: true,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
        output_observation_schema: "helix.interim_voice_callout_tool_result.v1",
      });
    expect(gatewayCapabilities.find((capability) => capability.capability_id === "live_env.narrator_say"))
      .toMatchObject({
        requires_confirmation: true,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
        output_observation_schema: "helix.interim_voice_callout_tool_result.v1",
      });
  });

  it("exposes graduated read-only context feeds through the shared provider gateway", () => {
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "read",
    }).capabilities;
    const gatewayIds = gatewayCapabilities.map((capability) => capability.capability_id);
    const graduatedContextFeeds = [
      "live_env.query_visual_summaries",
      "live_env.query_trace_memory",
      "live_env.query_narrator_events",
      "live_env.query_audio_transcripts",
      "live_env.query_translation_segments",
      "live_env.query_microdeck_outputs",
      "live_env.query_live_answer_state",
      "live_env.query_packet_traces",
      "live_env.query_route_evidence",
      "live_env.query_automation_policies",
      "live_env.query_source_health",
    ];

    for (const capabilityId of graduatedContextFeeds) {
      expect(gatewayIds).toContain(capabilityId);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "shared_gateway_now",
        provider_availability: {
          helix_native: true,
          codex_workstation: true,
          future_provider: true,
        },
      });
      expect(gatewayCapabilities.find((capability) => capability.capability_id === capabilityId))
        .toMatchObject({
          mode: "read",
          requires_confirmation: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          output_observation_schema: "helix.live_environment_tool_observation.v1",
        });
    }
  });

  it("exposes source and loop health reads through the shared provider gateway", () => {
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "read",
    }).capabilities;

    for (const capabilityId of ["live_env.query_source_health", "live_env.query_live_source_loop_health"]) {
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "shared_gateway_now",
        provider_availability: {
          helix_native: true,
          codex_workstation: true,
          future_provider: true,
        },
      });
      expect(gatewayCapabilities.find((capability) => capability.capability_id === capabilityId))
        .toMatchObject({
          mode: "read",
          requires_confirmation: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          output_observation_schema: "helix.live_environment_tool_observation.v1",
        });
    }
  });

  it("exposes live-source state reads through the shared provider gateway", () => {
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "read",
    }).capabilities;

    for (const capabilityId of [
      "live_env.query_live_source_quality",
      "live_env.query_workstation_goal_context",
      "live_env.summarize_live_source_current_state",
    ]) {
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "shared_gateway_now",
        provider_availability: {
          helix_native: true,
          codex_workstation: true,
          future_provider: true,
        },
      });
      expect(gatewayCapabilities.find((capability) => capability.capability_id === capabilityId))
        .toMatchObject({
          mode: "read",
          requires_confirmation: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          output_observation_schema: "helix.live_environment_tool_observation.v1",
        });
    }
  });

  it("exposes live-source mailbox reads without exposing mailbox processing", () => {
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "read",
    }).capabilities;
    const gatewayIds = gatewayCapabilities.map((capability) => capability.capability_id);
    const sharedMailboxReads = [
      "live_env.check_live_source_mail",
      "live_env.read_live_source_mail",
      "live_env.read_processed_live_source_mail",
      "live_env.reflect_live_source_mail_loop",
    ];

    for (const capabilityId of sharedMailboxReads) {
      expect(gatewayIds).toContain(capabilityId);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "shared_gateway_now",
        provider_availability: {
          helix_native: true,
          codex_workstation: true,
          future_provider: true,
        },
      });
      expect(gatewayCapabilities.find((capability) => capability.capability_id === capabilityId))
        .toMatchObject({
          mode: "read",
          mutating: false,
          requires_confirmation: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          output_observation_schema: "helix.live_environment_tool_observation.v1",
        });
    }

    expect(gatewayIds).not.toContain("live_env.process_live_source_mail");
    expect(classifyProviderAgentCapability("live_env.process_live_source_mail")).toMatchObject({
      availability: "helix_native_only",
      provider_availability: {
        codex_workstation: false,
        future_provider: false,
      },
    });
  });

  it("exposes interpreter and prediction evidence reads without exposing projection or configuration controls", () => {
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "read",
    }).capabilities;
    const gatewayIds = gatewayCapabilities.map((capability) => capability.capability_id);
    const sharedInterpreterPredictionReads = [
      "live_env.compare_mail_to_interpreter_profile",
      "live_env.validate_live_source_prediction",
      "live_env.predict_live_source_immediate",
      "live_env.compare_live_source_prediction",
    ];

    for (const capabilityId of sharedInterpreterPredictionReads) {
      expect(gatewayIds).toContain(capabilityId);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "shared_gateway_now",
        provider_availability: {
          helix_native: true,
          codex_workstation: true,
          future_provider: true,
        },
      });
      expect(gatewayCapabilities.find((capability) => capability.capability_id === capabilityId))
        .toMatchObject({
          mode: "read",
          mutating: false,
          requires_confirmation: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          output_observation_schema: "helix.live_environment_tool_observation.v1",
        });
    }

    for (const heldBackCapability of [
      "live_env.project_live_source_narrative",
      "live_env.configure_route_watch",
      "live_env.configure_interpreter_profile",
    ]) {
      expect(gatewayIds).not.toContain(heldBackCapability);
      expect(classifyProviderAgentCapability(heldBackCapability)).toMatchObject({
        provider_availability: {
          codex_workstation: false,
          future_provider: false,
        },
      });
    }
  });

  it("exposes Stage Play builder read/evaluation tools without exposing projection or checkpoint controls", () => {
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "read",
    }).capabilities;
    const gatewayIds = gatewayCapabilities.map((capability) => capability.capability_id);
    const sharedStagePlayBuilderReads = [
      "live_env.describe_stage_builder",
      "live_env.validate_stage_play_graph",
      "live_env.plan_stage_play_job",
    ];

    for (const capabilityId of sharedStagePlayBuilderReads) {
      expect(gatewayIds).toContain(capabilityId);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "shared_gateway_now",
        provider_availability: {
          helix_native: true,
          codex_workstation: true,
          future_provider: true,
        },
      });
      expect(gatewayCapabilities.find((capability) => capability.capability_id === capabilityId))
        .toMatchObject({
          mode: "read",
          mutating: false,
          requires_confirmation: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          output_observation_schema: "helix.live_environment_tool_observation.v1",
        });
    }

    for (const heldBackCapability of [
      "live_env.read_card",
      "live_env.reflect_stage_play_context",
      "live_env.draft_stage_play_graph",
      "live_env.request_stage_play_checkpoint",
    ]) {
      expect(gatewayIds).not.toContain(heldBackCapability);
      expect(classifyProviderAgentCapability(heldBackCapability)).toMatchObject({
        provider_availability: {
          codex_workstation: false,
          future_provider: false,
        },
      });
    }
  });

  it("exposes situation/stage state reads through the shared provider gateway", () => {
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "read",
    }).capabilities;

    for (const capabilityId of [
      "live_env.query_event_log",
      "live_env.query_world_events",
      "live_env.query_navigation_state",
      "live_env.query_stage_sources",
      "live_env.query_constructs",
      "live_env.query_job_evidence",
    ]) {
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "shared_gateway_now",
        provider_availability: {
          helix_native: true,
          codex_workstation: true,
          future_provider: true,
        },
      });
      expect(gatewayCapabilities.find((capability) => capability.capability_id === capabilityId))
        .toMatchObject({
          mode: "read",
          requires_confirmation: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          output_observation_schema: "helix.live_environment_tool_observation.v1",
        });
    }
  });

  it("exposes only read and dry-run micro-reasoner tools through the shared gateway", () => {
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "read",
    }).capabilities;
    const gatewayIds = gatewayCapabilities.map((capability) => capability.capability_id);
    const sharedMicroReasonerCapabilities = [
      "live_env.query_micro_reasoner_presets",
      "live_env.query_micro_reasoner_prompts",
      "live_env.test_micro_reasoner_prompt",
    ];
    const heldBackMicroReasonerCapabilities = [
      "live_env.draft_micro_reasoner_preset",
      "live_env.route_micro_reasoner_prompt",
      "live_env.apply_micro_reasoner_preset",
      "live_env.create_micro_reasoner_preset",
      "live_env.update_micro_reasoner_prompt",
    ];

    for (const capabilityId of sharedMicroReasonerCapabilities) {
      expect(gatewayIds).toContain(capabilityId);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "shared_gateway_now",
        provider_availability: {
          helix_native: true,
          codex_workstation: true,
          future_provider: true,
        },
      });
      expect(gatewayCapabilities.find((capability) => capability.capability_id === capabilityId))
        .toMatchObject({
          mode: "read",
          requires_confirmation: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          output_observation_schema: "helix.live_environment_tool_observation.v1",
        });
    }

    for (const capabilityId of heldBackMicroReasonerCapabilities) {
      expect(gatewayIds).not.toContain(capabilityId);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        provider_availability: {
          codex_workstation: false,
          future_provider: false,
        },
      });
    }
  });

  it("exposes only visual observer read and dry-run tools through the shared gateway", () => {
    const gatewayCapabilities = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "read",
    }).capabilities;
    const gatewayIds = gatewayCapabilities.map((capability) => capability.capability_id);
    const sharedVisualObserverCapabilities = [
      "live_env.query_visual_observer_profiles",
      "live_env.test_visual_observer_profile",
      "live_env.compare_visual_observer_profiles",
    ];
    const heldBackVisualObserverCapabilities = [
      "live_env.configure_visual_observer_profile",
      "live_env.apply_visual_observer_profile",
      "live_env.request_visual_action_replay",
    ];

    for (const capabilityId of sharedVisualObserverCapabilities) {
      expect(gatewayIds).toContain(capabilityId);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability: "shared_gateway_now",
        provider_availability: {
          helix_native: true,
          codex_workstation: true,
          future_provider: true,
        },
      });
      expect(gatewayCapabilities.find((capability) => capability.capability_id === capabilityId))
        .toMatchObject({
          mode: "read",
          requires_confirmation: false,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
          output_observation_schema: "helix.live_environment_tool_observation.v1",
        });
    }

    for (const capabilityId of heldBackVisualObserverCapabilities) {
      expect(gatewayIds).not.toContain(capabilityId);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        provider_availability: {
          codex_workstation: false,
          future_provider: false,
        },
      });
    }
  });

  it("classifies dynamic panel actions without treating them as provider gateway tools", () => {
    const gatewayIds = new Set(
      listWorkstationGatewayCapabilities({
        agentRuntime: "codex",
        mode: "act",
      }).capabilities.map((capability) => capability.capability_id),
    );

    for (const action of WORKSTATION_DYNAMIC_TOOL_ACTIONS) {
      const classification = classifyDynamicWorkstationActionForProviderGateway(action);
      expect(classification.capability_id).toBe(buildWorkstationToolName(action.panel_id, action.action_id));
      if (
        classification.capability_id === "workstation-notes.list_notes" ||
        classification.capability_id === "account_session.set_interface_language"
      ) {
        const expectedPermissionClass = classification.capability_id === "workstation-notes.list_notes"
          ? "read_observe"
          : "mutating_control";
        expect(classification).toMatchObject({
          availability: "shared_gateway_now",
          permission_class: expectedPermissionClass,
          provider_availability: {
            codex_workstation: true,
          },
          required_contract_before_gateway: [],
        });
        expect(gatewayIds.has(classification.capability_id)).toBe(true);
        continue;
      }
      expect(classification.provider_availability.codex_workstation).toBe(false);
      expect(gatewayIds.has(classification.capability_id)).toBe(false);
      expect(classification.required_contract_before_gateway.length).toBeGreaterThan(0);
    }
    for (const action of RETIRED_WORKSTATION_DYNAMIC_TOOL_ACTIONS) {
      const classification = classifyDynamicWorkstationActionForProviderGateway(action, { retired: true });
      expect(classification.availability).toBe("legacy_dynamic_panel_only");
      expect(classification.provider_availability.codex_workstation).toBe(false);
    }
  });

  it("documents every dynamic panel action surface in the provider capability contract", () => {
    const contractDoc = fs.readFileSync(providerCapabilityContractDocPath, "utf8");
    const dynamicCapabilityIds = [...WORKSTATION_DYNAMIC_TOOL_ACTIONS, ...RETIRED_WORKSTATION_DYNAMIC_TOOL_ACTIONS]
      .map((action) => buildWorkstationToolName(action.panel_id, action.action_id));
    const missing = [...new Set(dynamicCapabilityIds)]
      .sort()
      .filter((capabilityId) => !contractDoc.includes(capabilityId));

    expect(missing).toEqual([]);
  });

  it("documents dynamic panel action provider boundaries without treating panel visibility as gateway access", () => {
    const contractIndex = fs.readFileSync(workstationToolContractReadmePath, "utf8");
    const dynamicPanelContract = fs.readFileSync(dynamicPanelActionBoundariesContractPath, "utf8");
    const gatewayIds = new Set(
      listWorkstationGatewayCapabilities({
        agentRuntime: "codex",
        mode: "act",
      }).capabilities.map((capability) => capability.capability_id),
    );

    expect(contractIndex).toContain("`workstation.dynamic_panel_actions`");
    expect(dynamicPanelContract).toContain("surface=dynamic_panel");
    expect(dynamicPanelContract).toContain("legacy_dynamic_panel_only");
    expect(dynamicPanelContract).toContain("workstation-notes.list_notes");
    expect(dynamicPanelContract).toContain("requires_confirmation_contract");
    expect(dynamicPanelContract).toContain("blocked_pending_contract");

    for (const action of [...WORKSTATION_DYNAMIC_TOOL_ACTIONS, ...RETIRED_WORKSTATION_DYNAMIC_TOOL_ACTIONS]) {
      const capabilityId = buildWorkstationToolName(action.panel_id, action.action_id);
      if (capabilityId === "workstation-notes.list_notes" || capabilityId === "account_session.set_interface_language") {
        expect(gatewayIds.has(capabilityId)).toBe(true);
        continue;
      }
      expect(gatewayIds.has(capabilityId)).toBe(false);
    }
  });

  it("keeps held-back side-effect and mutating capabilities out of the provider gateway", () => {
    const gatewayIds = new Set(
      listWorkstationGatewayCapabilities({
        agentRuntime: "codex",
        mode: "act",
      }).capabilities.map((capability) => capability.capability_id),
    );
    const heldBack = [
      ["live_env.narrator_bind_stream", "blocked_pending_contract", "user_confirmed_side_effect"],
      ["narrator.bind_stream", "blocked_pending_contract", "user_confirmed_side_effect"],
      ["live_env.record_voice_steering", "requires_confirmation_contract", "user_confirmed_side_effect"],
      ["live_env.read_card", "requires_confirmation_contract", "user_confirmed_side_effect"],
      ["live_env.reflect_stage_play_context", "requires_confirmation_contract", "user_confirmed_side_effect"],
      ["live_env.process_live_source_mail", "helix_native_only", "ui_projection"],
      ["live_env.apply_visual_observer_profile", "helix_native_only", "ui_projection"],
      ["live_env.request_probe", "requires_confirmation_contract", "user_confirmed_side_effect"],
      ["live_env.record_commentary", "requires_confirmation_contract", "user_confirmed_side_effect"],
      ["live_env.evaluate_goal_satisfaction", "requires_confirmation_contract", "user_confirmed_side_effect"],
      ["live_env.pause_workstation_loop", "blocked_pending_contract", "mutating_control"],
      ["live_env.configure_route_watch", "blocked_pending_contract", "mutating_control"],
      ["live_env.repair_workstation_source", "blocked_pending_contract", "mutating_control"],
    ] as const;

    for (const [capabilityId, availability, permissionClass] of heldBack) {
      expect(gatewayIds.has(capabilityId)).toBe(false);
      expect(classifyProviderAgentCapability(capabilityId)).toMatchObject({
        availability,
        permission_class: permissionClass,
        provider_availability: {
          codex_workstation: false,
          future_provider: false,
        },
      });
    }
  });

  it("keeps client read-aloud projection out of the provider gateway catalog", () => {
    const gatewayIds = new Set(
      listWorkstationGatewayCapabilities({
        agentRuntime: "codex",
        mode: "act",
      }).capabilities.map((capability) => capability.capability_id),
    );

    expect(gatewayIds.has("client.read_aloud")).toBe(false);
    expect(classifyProviderAgentCapability("client.read_aloud")).toMatchObject({
      capability_id: "client.read_aloud",
      surface: "client_projection",
      availability: "client_projection_only",
      permission_class: "user_confirmed_side_effect",
      provider_availability: {
        helix_native: false,
        codex_workstation: false,
        future_provider: false,
      },
    });
  });

  it("keeps classification records unique and non-terminal", () => {
    const ids = new Set<string>();
    for (const classification of PROVIDER_AGENT_CAPABILITY_CLASSIFICATIONS) {
      expect(ids.has(classification.capability_id)).toBe(false);
      ids.add(classification.capability_id);
      if (["shared_gateway_now", "shared_capability_lane_now"].includes(classification.availability)) {
        expect(classification.provider_availability.codex_workstation).toBe(true);
        expect(classification.required_contract_before_gateway).toEqual([]);
        if (classification.surface === "explicit_contract") {
          expect(classification.provider_gateway_alias_target, classification.capability_id).toEqual(expect.any(String));
        } else {
          expect(classification.provider_gateway_alias_target, classification.capability_id).toBeUndefined();
        }
      } else if (classification.availability === "candidate_host_receipt_bridge") {
        expect(classification.provider_availability.codex_workstation).toBe(true);
        expect(classification.provider_availability.future_provider).toBe(false);
        expect(classification.provider_gateway_alias_target, classification.capability_id).toBeUndefined();
        expect(classification.required_contract_before_gateway.length).toBeGreaterThan(0);
      } else {
        expect(classification.provider_availability.codex_workstation).toBe(false);
        expect(classification.provider_gateway_alias_target, classification.capability_id).toBeUndefined();
        expect(classification.required_contract_before_gateway.length).toBeGreaterThan(0);
      }
    }
  });
});
