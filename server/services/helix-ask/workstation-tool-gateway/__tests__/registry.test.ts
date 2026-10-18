import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HELIX_WORKSPACE_OS_STATUS_CAPABILITY } from "../../workspace-os-status-intent";
import { HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY } from "../../theory-congruence/capability-contract";
import {
  callWorkstationGatewayCapability,
  listWorkstationGatewayCapabilities,
} from "../registry";
import { runtimeMemoryGovernor } from "../../../runtime/runtime-memory-governor";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../../../situation-room/live-answer-environment-store";
import {
  recordLiveFieldEvaluation,
  resetLiveFieldEvaluationsForTest,
} from "../../../situation-room/live-field-evaluation-store";
import {
  ensureLiveSituationRunForEnvironment,
  resetLiveSituationRunsForTest,
} from "../../../situation-room/live-situation-run-store";
import {
  appendObservationJournalEntry,
  resetObservationJournalForTest,
} from "../../../situation-room/observation-journal-store";
import {
  appendInterpretationCard,
  resetInterpretationCardsForTest,
} from "../../../situation-room/interpretation-card-store";
import {
  buildScientificEvidencePacket,
  buildScientificImageEvidenceSidecar,
} from "@shared/scientific-evidence-adaptor";
import { SHARED_INTERFACE_LANGUAGE_CODES } from "@shared/interface-language-codes";
import { executeLiveEnvironmentTool } from "../../live-environment-tool-adapter";
import {
  enqueueStagePlayLiveSourceMailItem,
  resetStagePlayLiveSourceMailboxForTest,
} from "../../../stage-play/stage-play-live-source-mailbox-store";
import { resetStagePlayLiveSourceMailWakeStoreForTest } from "../../../stage-play/stage-play-live-source-mail-wake-store";
import { resetStagePlayProcessedMailPacketStoreForTest } from "../../../stage-play/stage-play-processed-mail-packet-store";

const WORKSTATION_ACTIVE_CONTEXT_CAPABILITY = "workstation.active_context";
const HELIX_ASK_CAPABILITY_CATALOG_CAPABILITY =
  "helix_ask.inspect_capability_catalog";
const THEORY_BADGE_GRAPH_CURRENT_CONTEXT_CAPABILITY =
  "theory-badge-graph.current_context";
const WORKSTATION_NOTES_LIST_NOTES_CAPABILITY = "workstation-notes.list_notes";
const CALCULATOR_SOLVE_EXPRESSION_CAPABILITY =
  "scientific-calculator.solve_expression";
const CALCULATOR_SOLVE_SCALAR_EXPRESSION_CAPABILITY =
  "scientific-calculator.solve_scalar_expression";
const CALCULATOR_CLASSIFY_EXPRESSION_CAPABILITY =
  "scientific-calculator.classify_expression";
const CALCULATOR_BIND_VARIABLES_CAPABILITY =
  "scientific-calculator.bind_variables";
const CALCULATOR_ACTIVE_CONTEXT_CAPABILITY =
  "scientific-calculator.active_context";
const READABLE_SURFACE_OBSERVE_CAPABILITY =
  "workstation.readable_surface.observe";
const DOCS_READ_VISIBLE_SURFACE_CAPABILITY = "docs-viewer.read_visible_surface";
const DOCS_READ_ACTIVE_TRANSLATION_CAPABILITY =
  "docs-viewer.read_active_translation";
const CALCULATOR_READ_VISIBLE_RESULT_CAPABILITY =
  "scientific-calculator.read_visible_result";
const CALCULATOR_OPEN_PANEL_CAPABILITY = "scientific-calculator.open_panel";
const CALCULATOR_PREFILL_EXPRESSION_CAPABILITY =
  "scientific-calculator.prefill_expression";
const CALCULATOR_SHOW_GATEWAY_SOLVE_CAPABILITY =
  "scientific-calculator.show_gateway_solve";
const WORKSTATION_OPEN_PANEL_CAPABILITY = "workstation.open_panel";
const WORKSTATION_FOCUS_PANEL_CAPABILITY = "workstation.focus_panel";
const ACCOUNT_SESSION_SET_INTERFACE_LANGUAGE_CAPABILITY =
  "account_session.set_interface_language";
const DOCS_OPEN_DOC_CAPABILITY = "docs-viewer.open_doc";
const REPO_SEARCH_CAPABILITY = "repo.search";
const DOCS_SEARCH_CAPABILITY = "docs.search";
const INTERNET_SEARCH_CAPABILITY = "internet-search.search_web";
const VISUAL_SITUATION_OBSERVATION_CAPABILITY =
  "situation-room.describe_visual_capture";
const SCHOLARLY_RESEARCH_SEARCH_CAPABILITY = "scholarly-research.lookup_papers";
const SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY =
  "scholarly-research.fetch_full_text";
const SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY =
  "scholarly-research.extract_numeric_parameters";
const CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY =
  "civilization-bounds.reflect_system_bounds";
const THEORY_CONTEXT_REFLECTION_CAPABILITY =
  HELIX_THEORY_CONTEXT_REFLECTION_CAPABILITY;
const MORAL_GRAPH_REFLECTION_CAPABILITY = "moral-graph.reflect_context";
const MORAL_LIVING_SUBSTRATE_REFLECTION_CAPABILITY =
  "moral-graph.reflect_living_substrate_context";
const THEORY_FRONTIER_CONJECTURE_CAPABILITY =
  "theory-badge-graph.propose_frontier_conjectures";
const TEXT_TO_SPEECH_SPEAK_TEXT_CAPABILITY = "text_to_speech.speak_text";
const VOICE_INTERIM_CALLOUT_CAPABILITY =
  "live_env.request_interim_voice_callout";
const VOICE_NARRATOR_SAY_CAPABILITY = "live_env.narrator_say";
const CONTEXT_FEED_QUERY_CAPABILITIES = [
  ["live_env.query_visual_summaries", "query_visual_summaries"],
  ["live_env.query_trace_memory", "query_trace_memory"],
  ["live_env.query_narrator_events", "query_narrator_events"],
  ["live_env.query_audio_transcripts", "query_audio_transcripts"],
  ["live_env.query_translation_segments", "query_translation_segments"],
  ["live_env.query_microdeck_outputs", "query_microdeck_outputs"],
  ["live_env.query_live_answer_state", "query_live_answer_state"],
  ["live_env.query_packet_traces", "query_packet_traces"],
  ["live_env.query_route_evidence", "query_route_evidence"],
  ["live_env.query_automation_policies", "query_automation_policies"],
  ["live_env.query_source_health", "query_source_health"],
] as const;
const LIVE_SOURCE_LOOP_HEALTH_CAPABILITY =
  "live_env.query_live_source_loop_health";
const LIVE_SOURCE_STATE_READ_CAPABILITIES = [
  ["live_env.query_live_source_quality", "query_live_source_quality"],
  ["live_env.query_workstation_goal_context", "query_workstation_goal_context"],
  [
    "live_env.summarize_live_source_current_state",
    "summarize_live_source_current_state",
  ],
] as const;
const SITUATION_STAGE_STATE_READ_CAPABILITIES = [
  ["live_env.query_event_log", "query_event_log"],
  ["live_env.query_world_events", "query_world_events"],
  ["live_env.query_navigation_state", "query_navigation_state"],
  ["live_env.query_stage_sources", "query_stage_sources"],
  ["live_env.query_constructs", "query_constructs"],
  ["live_env.query_job_evidence", "query_job_evidence"],
] as const;
const MICRO_REASONER_READ_CAPABILITIES = [
  ["live_env.query_micro_reasoner_presets", "query_micro_reasoner_presets"],
  ["live_env.query_micro_reasoner_prompts", "query_micro_reasoner_prompts"],
  ["live_env.test_micro_reasoner_prompt", "test_micro_reasoner_prompt"],
] as const;
const VISUAL_OBSERVER_READ_CAPABILITIES = [
  ["live_env.query_visual_observer_profiles", "query_visual_observer_profiles"],
  ["live_env.test_visual_observer_profile", "test_visual_observer_profile"],
  [
    "live_env.compare_visual_observer_profiles",
    "compare_visual_observer_profiles",
  ],
] as const;

describe("Helix workstation tool gateway", () => {
  const originalEnv = {
    RG_BIN: process.env.RG_BIN,
    PATH: process.env.PATH,
    Path: process.env.Path,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    EXA_API_KEY: process.env.EXA_API_KEY,
    GOOGLE_CUSTOM_SEARCH_API_KEY: process.env.GOOGLE_CUSTOM_SEARCH_API_KEY,
    GOOGLE_CUSTOM_SEARCH_ENGINE_ID: process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID,
    GOOGLE_CSE_API_KEY: process.env.GOOGLE_CSE_API_KEY,
    GOOGLE_CSE_CX: process.env.GOOGLE_CSE_CX,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GOOGLE_SEARCH_ENGINE_ID: process.env.GOOGLE_SEARCH_ENGINE_ID,
  };
  const originalFetch = globalThis.fetch;
  const restoreEnvKey = (key: keyof typeof originalEnv): void => {
    const original = originalEnv[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  };

  beforeEach(() => {
    resetStagePlayLiveSourceMailboxForTest();
    resetStagePlayLiveSourceMailWakeStoreForTest();
    resetStagePlayProcessedMailPacketStoreForTest();
    restoreEnvKey("RG_BIN");
    restoreEnvKey("PATH");
    restoreEnvKey("Path");
    restoreEnvKey("TAVILY_API_KEY");
    restoreEnvKey("EXA_API_KEY");
    restoreEnvKey("GOOGLE_CUSTOM_SEARCH_API_KEY");
    restoreEnvKey("GOOGLE_CUSTOM_SEARCH_ENGINE_ID");
    restoreEnvKey("GOOGLE_CSE_API_KEY");
    restoreEnvKey("GOOGLE_CSE_CX");
    restoreEnvKey("GOOGLE_API_KEY");
    restoreEnvKey("GOOGLE_SEARCH_ENGINE_ID");
  });

  afterEach(() => {
    restoreEnvKey("RG_BIN");
    restoreEnvKey("PATH");
    restoreEnvKey("Path");
    restoreEnvKey("TAVILY_API_KEY");
    restoreEnvKey("EXA_API_KEY");
    restoreEnvKey("GOOGLE_CUSTOM_SEARCH_API_KEY");
    restoreEnvKey("GOOGLE_CUSTOM_SEARCH_ENGINE_ID");
    restoreEnvKey("GOOGLE_CSE_API_KEY");
    restoreEnvKey("GOOGLE_CSE_CX");
    restoreEnvKey("GOOGLE_API_KEY");
    restoreEnvKey("GOOGLE_SEARCH_ENGINE_ID");
    globalThis.fetch = originalFetch;
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests();
    resetLiveAnswerEnvironments();
    resetLiveSituationRunsForTest();
    resetObservationJournalForTest();
    resetLiveFieldEvaluationsForTest();
    resetInterpretationCardsForTest();
    vi.restoreAllMocks();
  });

  const admitVoiceRuntimeForTest = (): void => {
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
  };

  it("lists read-only non-terminal workstation capabilities", () => {
    process.env.TAVILY_API_KEY = "test-tavily-key";
    const manifest = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "observe",
    });

    expect(manifest).toMatchObject({
      schema: "helix.workstation_tool_gateway.v1",
      manifest_version: "read-observe-act.v1",
      agent_runtime: "codex",
      mode: "observe",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
        panel_id: "workspace-os",
        action_id: "status",
        mode: "observe",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        output_observation_schema: "helix.workspace_os_status_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: HELIX_ASK_CAPABILITY_CATALOG_CAPABILITY,
        panel_id: "agent-access",
        action_id: "inspect_capability_catalog",
        mode: "observe",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        permission_profile_required: "observe",
        output_observation_schema:
          "helix.capability_catalog_observation.v1",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: WORKSTATION_ACTIVE_CONTEXT_CAPABILITY,
        panel_id: "workstation",
        action_id: "active_context",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        permission_profile_required: "read",
        output_observation_schema:
          "helix.workstation_active_context_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: WORKSTATION_NOTES_LIST_NOTES_CAPABILITY,
        panel_id: "workstation-notes",
        action_id: "list_notes",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        requires_source: true,
        permission_profile_required: "read",
        output_observation_schema:
          "helix.workstation_notes_list_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
        panel_id: "scientific-calculator",
        action_id: "solve_expression",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        permission_profile_required: "read",
        output_observation_schema: "helix.calculator_solve_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: CALCULATOR_SOLVE_SCALAR_EXPRESSION_CAPABILITY,
        panel_id: "scientific-calculator",
        action_id: "solve_scalar_expression",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        requires_source: true,
        permission_profile_required: "read",
        output_observation_schema:
          "helix.calculator_scalar_solve_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: CALCULATOR_CLASSIFY_EXPRESSION_CAPABILITY,
        panel_id: "scientific-calculator",
        action_id: "classify_expression",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        permission_profile_required: "read",
        output_observation_schema:
          "helix.calculator_expression_classification_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: CALCULATOR_BIND_VARIABLES_CAPABILITY,
        panel_id: "scientific-calculator",
        action_id: "bind_variables",
        mode: "verify",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        permission_profile_required: "read",
        output_observation_schema:
          "helix.calculator_variable_binding_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: CALCULATOR_ACTIVE_CONTEXT_CAPABILITY,
        panel_id: "scientific-calculator",
        action_id: "active_context",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        permission_profile_required: "read",
        output_observation_schema:
          "helix.calculator_active_context_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    for (const [capabilityId, panelId, actionId] of [
      [READABLE_SURFACE_OBSERVE_CAPABILITY, null, "observe"],
      [
        DOCS_READ_VISIBLE_SURFACE_CAPABILITY,
        "docs-viewer",
        "read_visible_surface",
      ],
      [
        DOCS_READ_ACTIVE_TRANSLATION_CAPABILITY,
        "docs-viewer",
        "read_active_translation",
      ],
      [
        CALCULATOR_READ_VISIBLE_RESULT_CAPABILITY,
        "scientific-calculator",
        "read_visible_result",
      ],
    ] as const) {
      expect(manifest.capabilities).toContainEqual(
        expect.objectContaining({
          capability_id: capabilityId,
          panel_id: panelId,
          action_id: actionId,
          mode: "read",
          mutating: false,
          code_mutation: false,
          shell_access: false,
          requires_source: true,
          permission_profile_required: "read",
          output_observation_schema:
            "helix.workstation_readable_surface_observation.v1",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      );
    }
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: REPO_SEARCH_CAPABILITY,
        panel_id: "repo-evidence",
        action_id: "search",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        requires_source: true,
        permission_profile_required: "read",
        output_observation_schema: "helix.repo_search_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: CALCULATOR_OPEN_PANEL_CAPABILITY,
        panel_id: "scientific-calculator",
        action_id: "open_panel",
        mode: "act",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        permission_profile_required: "act",
        output_observation_schema: "helix.workstation_ui_action_receipt.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: CALCULATOR_SHOW_GATEWAY_SOLVE_CAPABILITY,
        panel_id: "scientific-calculator",
        action_id: "show_gateway_solve",
        mode: "act",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        requires_source: true,
        permission_profile_required: "act",
        output_observation_schema: "helix.workstation_ui_action_receipt.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: CALCULATOR_PREFILL_EXPRESSION_CAPABILITY,
        panel_id: "scientific-calculator",
        action_id: "prefill_expression",
        mode: "act",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        permission_profile_required: "act",
        output_observation_schema: "helix.workstation_ui_action_receipt.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: DOCS_OPEN_DOC_CAPABILITY,
        panel_id: "docs-viewer",
        action_id: "open_doc",
        mode: "act",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        requires_source: true,
        permission_profile_required: "act",
        output_observation_schema: "helix.workstation_ui_action_receipt.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: WORKSTATION_OPEN_PANEL_CAPABILITY,
        panel_id: null,
        action_id: "open_panel",
        dynamic_panel_id_arg: "panel_id",
        allowed_panel_ids: expect.arrayContaining([
          "docs-viewer",
          "scientific-calculator",
          "workstation-process-graph",
        ]),
        mode: "act",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        permission_profile_required: "act",
        output_observation_schema: "helix.workstation_ui_action_receipt.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: DOCS_SEARCH_CAPABILITY,
        panel_id: "docs-viewer",
        action_id: "search_docs",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        requires_source: true,
        permission_profile_required: "read",
        output_observation_schema: "helix.docs_search_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: INTERNET_SEARCH_CAPABILITY,
        panel_id: "internet-search",
        action_id: "search_web",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        requires_source: true,
        permission_profile_required: "read",
        output_observation_schema: "helix.internet_search_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
        panel_id: "scholarly-research",
        action_id: "lookup_papers",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        requires_source: true,
        permission_profile_required: "read",
        output_observation_schema: "helix.scholarly_research_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        panel_id: "scholarly-research",
        action_id: "fetch_full_text",
        mode: "read",
        permission_profile_required: "read",
        output_observation_schema: "helix.scholarly_full_text_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
        panel_id: "scholarly-research",
        action_id: "extract_numeric_parameters",
        mode: "read",
        permission_profile_required: "read",
        output_observation_schema:
          "helix.scholarly_numeric_parameter_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: THEORY_CONTEXT_REFLECTION_CAPABILITY,
        panel_id: "theory-badge-graph",
        action_id: "reflect_discussion_context",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        requires_source: true,
        permission_profile_required: "read",
        output_observation_schema:
          "helix.theory_context_reflection_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: MORAL_LIVING_SUBSTRATE_REFLECTION_CAPABILITY,
        panel_id: "moral-badge-graph",
        action_id: "reflect_living_substrate_context",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        requires_source: true,
        permission_profile_required: "read",
        output_observation_schema:
          "helix.moral_living_substrate_reflection_observation.v1",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: THEORY_FRONTIER_CONJECTURE_CAPABILITY,
        panel_id: "theory-badge-graph",
        action_id: "propose_frontier_conjectures",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        requires_source: true,
        permission_profile_required: "read",
        output_observation_schema:
          "helix.theory_frontier_conjecture_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        panel_id: "civilization-bounds-roadmap",
        action_id: "reflect_system_bounds",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        requires_source: true,
        permission_profile_required: "read",
        output_observation_schema:
          "helix.civilization_bounds_reflection_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    for (const [capabilityId, actionId] of CONTEXT_FEED_QUERY_CAPABILITIES) {
      expect(manifest.capabilities).toContainEqual(
        expect.objectContaining({
          capability_id: capabilityId,
          panel_id: "live-answer-environment",
          action_id: actionId,
          mode: "read",
          mutating: false,
          code_mutation: false,
          shell_access: false,
          requires_source: false,
          permission_profile_required: "read",
          output_observation_schema:
            "helix.live_environment_tool_observation.v1",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      );
    }
    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: LIVE_SOURCE_LOOP_HEALTH_CAPABILITY,
        panel_id: "live-answer-environment",
        action_id: "query_live_source_loop_health",
        mode: "read",
        mutating: false,
        code_mutation: false,
        shell_access: false,
        requires_source: false,
        permission_profile_required: "read",
        output_observation_schema: "helix.live_environment_tool_observation.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
    for (const [
      capabilityId,
      actionId,
    ] of LIVE_SOURCE_STATE_READ_CAPABILITIES) {
      expect(manifest.capabilities).toContainEqual(
        expect.objectContaining({
          capability_id: capabilityId,
          panel_id: "live-answer-environment",
          action_id: actionId,
          mode: "read",
          mutating: false,
          code_mutation: false,
          shell_access: false,
          requires_source: false,
          permission_profile_required: "read",
          output_observation_schema:
            "helix.live_environment_tool_observation.v1",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      );
    }
    for (const [
      capabilityId,
      actionId,
    ] of SITUATION_STAGE_STATE_READ_CAPABILITIES) {
      expect(manifest.capabilities).toContainEqual(
        expect.objectContaining({
          capability_id: capabilityId,
          panel_id: "live-answer-environment",
          action_id: actionId,
          mode: "read",
          mutating: false,
          code_mutation: false,
          shell_access: false,
          requires_source: false,
          permission_profile_required: "read",
          output_observation_schema:
            "helix.live_environment_tool_observation.v1",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      );
    }
    for (const [capabilityId, actionId] of MICRO_REASONER_READ_CAPABILITIES) {
      expect(manifest.capabilities).toContainEqual(
        expect.objectContaining({
          capability_id: capabilityId,
          panel_id: "live-answer-environment",
          action_id: actionId,
          mode: "read",
          mutating: false,
          code_mutation: false,
          shell_access: false,
          requires_source: false,
          permission_profile_required: "read",
          output_observation_schema:
            "helix.live_environment_tool_observation.v1",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      );
    }
    for (const [capabilityId, actionId] of VISUAL_OBSERVER_READ_CAPABILITIES) {
      expect(manifest.capabilities).toContainEqual(
        expect.objectContaining({
          capability_id: capabilityId,
          panel_id: "live-answer-environment",
          action_id: actionId,
          mode: "read",
          mutating: false,
          code_mutation: false,
          shell_access: false,
          requires_source: false,
          permission_profile_required: "read",
          output_observation_schema:
            "helix.live_environment_tool_observation.v1",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      );
    }
  });

  it("calls workspace_os.status as an observation packet, not an answer", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "observe",
      capabilityId: HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
      arguments: {
        thread_id: "helix-ask:test",
        capability_ids: ["runtime.memory"],
      },
      turnId: "ask:test:gateway",
      iteration: 1,
    });

    expect(result).toMatchObject({
      manifest_version: "read-observe-act.v1",
      ok: true,
      agent_runtime: "codex",
      capability_id: HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
      gateway_admission: {
        schema: "helix.workstation_tool_gateway.admission.v1",
        requested_capability: HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
        selected_agent_provider: "codex",
        permission_profile: "observe",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        turn_id: "ask:test:gateway",
        tool_family: "workstation_tool_gateway",
        requested_capability: HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
        admitted_capability: HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
        executed_capability: HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
        lifecycle_stage: "completed",
        status: "completed",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_followup_decision: {
        schema: "helix.tool_followup_decision.v1",
        turn_id: "ask:test:gateway",
        next_action: "continue_reasoning",
        terminal_blockers: [
          "post_tool_model_step_required",
          "terminal_authority_not_evaluated",
        ],
        required_surface_satisfied: true,
        evidence_reentered: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(result.observation_packet).toMatchObject({
      schema: "helix.agent_step_observation_packet.v1",
      turn_id: "ask:test:gateway",
      iteration: 1,
      capability_key: HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
      panel_id: "workspace-os",
      action: "status",
      status: "succeeded",
      state_delta: {
        workspace_os_status: {
          schema: "helix.workspace_os_status_observation.v1",
          capability_key: HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
        },
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation).toMatchObject({
      schema: "helix.workspace_os_status_observation.v1",
      capability_key: HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("uses the server-scoped conversation thread for processed live-mail reads", async () => {
    const roomThreadId = "helix-ask:room:shared_realtime_room:gateway-mailbox";
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "live_env.read_processed_live_source_mail",
      arguments: {
        thread_id: "ask:model-supplied-transient-turn",
        read_only: true,
      },
      conversationThreadId: roomThreadId,
      turnId: "ask:gateway-mailbox-turn",
      iteration: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: "live_env.read_processed_live_source_mail",
      observation: {
        thread_id: roomThreadId,
        observation: {
          mailboxThreadId: roomThreadId,
          mailboxThreadResolution: {
            requestedThreadId: roomThreadId,
            mailboxThreadId: roomThreadId,
          },
        },
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
    });
  });

  it("exposes mailbox decisions but rejects packet identities absent from current-turn evidence", async () => {
    const manifest = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    }).capabilities.find(
      (capability) =>
        capability.capability_id ===
        "live_env.record_live_source_mail_decision",
    );
    expect(manifest).toMatchObject({
      mode: "act",
      mutating: true,
      requires_confirmation: false,
      terminal_eligible: false,
      post_tool_model_step_required: true,
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: "live_env.record_live_source_mail_decision",
      arguments: {
        decision: "record_interpretation",
        processed_packet_ids: ["stage_play_processed_mail_packet:stale"],
        mail_ids: ["stage_play_live_source_mail:stale"],
      },
      conversationThreadId:
        "helix-ask:room:shared_realtime_room:gateway-mailbox",
      turnId: "ask:gateway-mailbox-decision-turn",
      iteration: 2,
      authoritativeEvidenceArtifacts: [],
    });
    expect(result).toMatchObject({
      ok: false,
      capability_id: "live_env.record_live_source_mail_decision",
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "current_turn_processed_mail_evidence_required",
      },
      error: "current_turn_processed_mail_evidence_required",
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
    });
  });

  it("records a mailbox decision only for the exact normalized current-turn packet", async () => {
    const roomId = "shared_realtime_room:gateway-mailbox-current";
    const roomThreadId = `helix-ask:room:${roomId}`;
    const sourceId = "source:room-ingress:gateway-mailbox-current";
    enqueueStagePlayLiveSourceMailItem({
      threadId: roomThreadId,
      roomId,
      environmentId: "room_source_binding:gateway-mailbox-current",
      sourceId,
      sourceKind: "minecraft_world_event",
      evidenceRef: "environment_situation_digest:gateway-mailbox-current",
      observationRef: "environment_situation_digest:gateway-mailbox-current",
      summaryText: JSON.stringify({
        schema: "helix.minecraft_semantic_wake_evidence.v1",
        changed_fields: ["hazards.on_fire"],
        answer_authority: false,
      }),
      summaryPreview: "Minecraft fire state changed and requires semantic replanning.",
      confidence: 1,
      analysisState: "analysis_ready",
      objectiveText: "Interpret the current Minecraft semantic change.",
      sourceFreshness: "fresh",
      evidenceRefs: ["environment_situation_digest:gateway-mailbox-current"],
    });
    const processed = executeLiveEnvironmentTool({
      tool_name: "live_env.process_live_source_mail",
      thread_id: roomThreadId,
      args: {
        room_id: roomId,
        source_id: sourceId,
        source_kind: "minecraft_world_event",
      },
    });
    const packet = (processed.observation as { packets?: Array<{
      packetId: string;
      mailIds: string[];
    }> }).packets?.[0];
    expect(packet).toBeDefined();
    const turnId = "ask:gateway-mailbox-decision-current-turn";

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: "live_env.record_live_source_mail_decision",
      arguments: {
        decision: "record_interpretation",
        processed_packet_ids: [packet!.packetId],
        mail_ids: packet!.mailIds,
        rationale: "The current fire-state change invalidates the prior next step.",
        next_loop_state: "armed_for_next_summary",
      },
      conversationThreadId: roomThreadId,
      turnId,
      iteration: 2,
      authoritativeEvidenceArtifacts: [
        {
          artifact_id: `${turnId}:codex_normalized:processed-mail-read`,
          kind: "live_environment_tool_observation",
          payload: {
            observation: {
              packets: [packet],
            },
          },
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: "live_env.record_live_source_mail_decision",
      gateway_admission: {
        admission_status: "admitted",
        admission_reason: "current_turn_processed_mail_decision_admitted",
      },
      observation: {
        ok: true,
        observation: {
          decision: "record_interpretation",
          processedPacketRefs: [packet!.packetId],
          mailIds: packet!.mailIds,
          rationalePreview:
            "The current fire-state change invalidates the prior next step.",
          nextLoopState: "armed_for_next_summary",
          post_tool_model_step_required: true,
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
    });
  });

  it("calls the reusable capability catalog as current-turn evidence, not an answer", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "observe",
      capabilityId: HELIX_ASK_CAPABILITY_CATALOG_CAPABILITY,
      arguments: {
        query: "What can this workstation do with scientific documents?",
        source_target_intent: {
          target_source: "capability_catalog",
          target_kind: "capability_catalog_runtime",
        },
      },
      accountType: "user",
      turnId: "ask:test:capability-catalog-gateway",
      iteration: 1,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: HELIX_ASK_CAPABILITY_CATALOG_CAPABILITY,
      gateway_admission: {
        admission_status: "admitted",
        admission_reason: "read_only_gateway_capability",
      },
      observation: {
        schema: "helix.capability_catalog_observation.v1",
        capability_key: HELIX_ASK_CAPABILITY_CATALOG_CAPABILITY,
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        turn_id: "ask:test:capability-catalog-gateway",
        capability_key: HELIX_ASK_CAPABILITY_CATALOG_CAPABILITY,
        panel_id: "agent-access",
        action: "inspect_capability_catalog",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    const observation = result.observation as Record<string, unknown>;
    expect(observation.available_capability_count).toBeGreaterThan(20);
    expect(observation.capability_families).toEqual(
      expect.arrayContaining([
        "docs-viewer",
        "scientific-calculator",
        "theory-badge-graph",
      ]),
    );
    expect(observation.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability_id: "docs-viewer.read_visible_surface",
        }),
        expect.objectContaining({
          capability_id: "scientific-calculator.solve_expression",
        }),
        expect.objectContaining({
          capability_id: HELIX_ASK_CAPABILITY_CATALOG_CAPABILITY,
        }),
      ]),
    );
    expect(result.produced_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "source_ref", role: "producer" }),
        expect.objectContaining({ kind: "text_evidence", role: "producer" }),
      ]),
    );
  });

  it("lists and calls account_session.set_interface_language as a governed preference action", async () => {
    const manifest = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    });

    expect(manifest.capabilities).toContainEqual(
      expect.objectContaining({
        capability_id: ACCOUNT_SESSION_SET_INTERFACE_LANGUAGE_CAPABILITY,
        panel_id: "account-session",
        action_id: "set_interface_language",
        mode: "act",
        mutating: true,
        code_mutation: false,
        shell_access: false,
        requires_confirmation: false,
        permission_profile_required: "act",
        terminal_eligible: true,
        output_observation_schema: "helix.workstation_ui_action_receipt.v1",
        input_schema: expect.objectContaining({
          required: ["language"],
          properties: expect.objectContaining({
            language: {
              type: "string",
              enum: [...SHARED_INTERFACE_LANGUAGE_CODES],
            },
          }),
        }),
        assistant_answer: false,
        raw_content_included: false,
      }),
    );

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: ACCOUNT_SESSION_SET_INTERFACE_LANGUAGE_CAPABILITY,
      arguments: { language: "haw" },
      turnId: "ask:test:gateway-interface-language",
      iteration: 1,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: ACCOUNT_SESSION_SET_INTERFACE_LANGUAGE_CAPABILITY,
      terminal_eligible: true,
      gateway_admission: {
        admission_status: "admitted",
        permission_profile: "act",
      },
      observation: {
        schema: "helix.workstation_ui_action_receipt.v1",
        status: "succeeded",
        dispatch_status: "admitted",
        panel_id: "account-session",
        action_id: "set_interface_language",
        preference_key: "interfaceLanguage",
        language: "haw",
        terminal_artifact_kind: "workspace_action_receipt",
        terminal_eligible: true,
        workstation_action: {
          schema_version: "helix.workstation.action/v1",
          action: "run_panel_action",
          panel_id: "account-session",
          action_id: "set_interface_language",
          args: { language: "haw" },
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_followup_decision: expect.objectContaining({
        next_action: "terminal_answer",
        terminal_blockers: [],
        assistant_answer: false,
        raw_content_included: false,
      }),
    });
  });

  it("rejects unsupported account_session.set_interface_language codes with a typed failure", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: ACCOUNT_SESSION_SET_INTERFACE_LANGUAGE_CAPABILITY,
      arguments: { language: "zz" },
      turnId: "ask:test:gateway-interface-language-unsupported",
      iteration: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: ACCOUNT_SESSION_SET_INTERFACE_LANGUAGE_CAPABILITY,
      error: "unsupported_interface_language",
      terminal_eligible: false,
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "unsupported_interface_language",
      },
      observation: {
        schema: "helix.workstation_ui_action_receipt.v1",
        status: "blocked",
        dispatch_status: "blocked",
        language: null,
        requested_language: "zz",
        workstation_action: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: expect.objectContaining({
        status: "blocked",
        terminal_eligible: false,
        missing_requirements: [
          expect.objectContaining({
            code: "unsupported_interface_language",
            rejected_expression: "zz",
            repair_action: "ask_user",
          }),
        ],
      }),
    });
  });

  it("calls workstation.active_context as bounded open-panel observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: WORKSTATION_ACTIVE_CONTEXT_CAPABILITY,
      arguments: {
        workspace_context: {
          activePanel: "docs-viewer",
          activeGroupId: "main",
          groupCount: 2,
          openPanels: [
            "docs-viewer",
            "scientific-calculator",
            "workstation-process-graph",
          ],
        },
      },
      turnId: "ask:test:gateway-workstation-active-context",
      iteration: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: WORKSTATION_ACTIVE_CONTEXT_CAPABILITY,
      gateway_admission: {
        requested_capability: WORKSTATION_ACTIVE_CONTEXT_CAPABILITY,
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: "ask:test:gateway-workstation-active-context",
        iteration: 2,
        capability_key: WORKSTATION_ACTIVE_CONTEXT_CAPABILITY,
        panel_id: "workstation",
        action: "active_context",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.workstation_active_context_observation.v1",
        capability_key: WORKSTATION_ACTIVE_CONTEXT_CAPABILITY,
        status: "succeeded",
        active_panel: "docs-viewer",
        active_group_id: "main",
        group_count: 2,
        open_panels: [
          "docs-viewer",
          "scientific-calculator",
          "workstation-process-graph",
        ],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("blocks workstation.active_context when no bounded panel state was supplied", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: WORKSTATION_ACTIVE_CONTEXT_CAPABILITY,
      arguments: {
        workspace_context: {},
      },
      turnId: "ask:test:gateway-workstation-active-context-missing",
      iteration: 3,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: WORKSTATION_ACTIVE_CONTEXT_CAPABILITY,
      error: "workstation_active_context_missing",
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "workstation_active_context_missing",
      },
      observation_packet: {
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
        missing_requirements: [
          expect.objectContaining({
            code: "workstation_active_context_missing",
            repair_action: "ask_user",
          }),
        ],
      },
      observation: {
        schema: "helix.workstation_active_context_observation.v1",
        status: "blocked",
        blocked_reason: "workstation_active_context_missing",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("reads the bounded current Theory Badge Graph selection as non-terminal evidence", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_BADGE_GRAPH_CURRENT_CONTEXT_CAPABILITY,
      arguments: {
        current_context: {
          schema: "helix.theory_badge_graph_current_context.v1",
          graph_id: "helix-theory-badge-graph/v1",
          active_badge_id: "physics.quantum.energy_frequency",
          selected_badge_ids: [
            "element.h.origin",
            "physics.quantum.energy_frequency",
          ],
          active_atlas_lens_id: "atomic_radiation_state",
          semantic_selections: [
            {
              domain: "solar_surface_spectrum",
              selection_kind: "observation_group",
              selection_id: "hydrogen_lines",
              object_binding_id: "solar-spectrum:hydrogen-lines",
            },
          ],
          combination_reader: {
            schema: "theory_badge_graph_combination_reader/v1",
            selectedBadges: [
              { id: "element.h.origin", title: "Hydrogen" },
              {
                id: "physics.quantum.energy_frequency",
                title: "Quantum Energy-Frequency Relation",
              },
            ],
            tracePathBadges: [
              { id: "element.h.origin", title: "Hydrogen" },
              {
                id: "physics.atomic.transition_gap_frequency_context",
                title: "Transition Gap",
              },
              {
                id: "physics.quantum.energy_frequency",
                title: "Quantum Energy-Frequency Relation",
              },
            ],
            intermediateBadges: [
              {
                id: "physics.atomic.transition_gap_frequency_context",
                title: "Transition Gap",
              },
            ],
            availableNextBadges: [
              { id: "physics.radiation.mode_context", title: "Radiation Mode" },
            ],
            boundaryContext: {
              notes: [
                "A graph path is compatibility context, not proof of a transition.",
              ],
            },
          },
          captured_at_ms: 1_750_000_000_000,
          active_panel: true,
          panel_open: true,
        },
      },
      turnId: "ask:test:theory-badge-current-context",
      iteration: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: THEORY_BADGE_GRAPH_CURRENT_CONTEXT_CAPABILITY,
      gateway_admission: { admission_status: "admitted" },
      observation_packet: {
        status: "succeeded",
        panel_id: "theory-badge-graph",
        action: "current_context",
        terminal_eligible: false,
        assistant_answer: false,
      },
      observation: {
        schema: "helix.theory_badge_graph_current_context_observation.v1",
        selected_badge_ids: [
          "element.h.origin",
          "physics.quantum.energy_frequency",
        ],
        active_atlas_lens_id: "atomic_radiation_state",
        context_role: "tool_evidence",
        answer_authority: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        combination_reader: {
          intermediate_badges: [
            expect.objectContaining({
              id: "physics.atomic.transition_gap_frequency_context",
            }),
          ],
          available_next_badges: [
            expect.objectContaining({ id: "physics.radiation.mode_context" }),
          ],
        },
      },
      tool_followup_decision: {
        next_action: "continue_reasoning",
        evidence_reentered: false,
      },
    });
  });

  it("blocks a current Theory Badge Graph observation when no badge is selected", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_BADGE_GRAPH_CURRENT_CONTEXT_CAPABILITY,
      arguments: {
        current_context: {
          schema: "helix.theory_badge_graph_current_context.v1",
          graph_id: "helix-theory-badge-graph/v1",
          selected_badge_ids: [],
          combination_reader: { selectedBadges: [] },
        },
      },
      turnId: "ask:test:theory-badge-current-context-empty",
      iteration: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: THEORY_BADGE_GRAPH_CURRENT_CONTEXT_CAPABILITY,
      error: "theory_badge_graph_selection_missing",
      gateway_admission: { admission_status: "blocked" },
      observation_packet: {
        status: "blocked",
        missing_requirements: [
          expect.objectContaining({
            code: "theory_badge_graph_selection_missing",
            repair_action: "ask_user",
          }),
        ],
      },
      observation: {
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
  });

  it("calls workstation-notes.list_notes as a body-redacted non-terminal observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: WORKSTATION_NOTES_LIST_NOTES_CAPABILITY,
      arguments: {
        notes: [
          {
            id: "note-1",
            title: "Fusion notes",
            body: "secret body must not pass through",
            content: "secret content must not pass through",
            updated_at: "2026-07-04T10:00:00.000Z",
            tags: ["physics", "draft"],
          },
        ],
        active_note_id: "note-1",
      },
      turnId: "ask:test:gateway-notes-list",
      iteration: 1,
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      capability_id: WORKSTATION_NOTES_LIST_NOTES_CAPABILITY,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      observation: {
        schema: "helix.workstation_notes_list_observation.v1",
        status: "succeeded",
        note_count: 1,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
        notes: [
          expect.objectContaining({
            id: "note-1",
            title: "Fusion notes",
            source_ref: "workstation-notes:note-1",
            raw_content_included: false,
            terminal_eligible: false,
          }),
        ],
      },
      observation_packet: expect.objectContaining({
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      tool_followup_decision: expect.objectContaining({
        next_action: "continue_reasoning",
        terminal_blockers: [
          "post_tool_model_step_required",
          "terminal_authority_not_evaluated",
        ],
        evidence_reentered: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
    });
    expect(JSON.stringify(result.observation)).not.toContain("secret body");
    expect(JSON.stringify(result.observation)).not.toContain("secret content");
  });

  it("reads bounded notes context from the canonical capability input envelope", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: WORKSTATION_NOTES_LIST_NOTES_CAPABILITY,
      arguments: {
        input: {
          workspace_context: {
            activePanel: "workstation-notes",
            notes_context: {
              notes: [],
            },
          },
        },
      },
      turnId: "ask:test:gateway-notes-list-envelope",
      iteration: 1,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: WORKSTATION_NOTES_LIST_NOTES_CAPABILITY,
      observation: {
        schema: "helix.workstation_notes_list_observation.v1",
        status: "succeeded",
        note_count: 0,
      },
      observation_packet: {
        status: "succeeded",
      },
    });
  });

  it("blocks workstation-notes.list_notes when no bounded notes context was supplied", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: WORKSTATION_NOTES_LIST_NOTES_CAPABILITY,
      arguments: {},
      turnId: "ask:test:gateway-notes-list-missing",
      iteration: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "workstation_notes_context_missing",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      gateway_admission: expect.objectContaining({
        admission_status: "blocked",
        blocked_reason: "workstation_notes_context_missing",
      }),
      observation: {
        schema: "helix.workstation_notes_list_observation.v1",
        status: "blocked",
        blocked_reason: "workstation_notes_context_missing",
        note_count: 0,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: expect.objectContaining({
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
        missing_requirements: [
          expect.objectContaining({
            code: "workstation_notes_context_missing",
            repair_action: "ask_user",
          }),
        ],
      }),
    });
  });

  it("calls read-only live environment context feeds as non-terminal gateway observations", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "live_env.query_visual_summaries",
      arguments: {
        thread_id: "helix-ask:test-context-feed",
        limit: 2,
      },
      turnId: "ask:test:gateway-context-feed",
      iteration: 4,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: "live_env.query_visual_summaries",
      gateway_admission: {
        requested_capability: "live_env.query_visual_summaries",
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: "ask:test:gateway-context-feed",
        iteration: 4,
        capability_key: "live_env.query_visual_summaries",
        panel_id: "live-answer-environment",
        action: "query_visual_summaries",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        produced_affordances: [],
        consumed_affordances: [],
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.live_environment_tool_observation.v1",
        thread_id: "helix-ask:test-context-feed",
        tool_name: "live_env.query_visual_summaries",
        ok: true,
        context_role: "tool_evidence",
        ask_context_policy: "evidence_only",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        observation: {
          schema: "stage_play_workstation_context_feed_query_result/v1",
          feedKind: "visual_summaries",
          status: "read",
          post_tool_model_step_required: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      tool_lifecycle_trace: {
        requested_capability: "live_env.query_visual_summaries",
        admitted_capability: "live_env.query_visual_summaries",
        executed_capability: "live_env.query_visual_summaries",
        lifecycle_stage: "completed",
        status: "completed",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_followup_decision: {
        next_action: "continue_reasoning",
        terminal_blockers: [
          "post_tool_model_step_required",
          "terminal_authority_not_evaluated",
        ],
        required_surface_satisfied: true,
        evidence_reentered: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("preserves scientific notation in exact calculator expressions", async () => {
    const expression = "2.26e18*164.8*1.602176634e-19";
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
      arguments: { expression },
      turnId: "ask:test:gateway-calculator-scientific-notation",
      iteration: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        expression,
        normalized_expression: expression,
        result: "59.672748298",
        status: "succeeded",
      },
      produced_affordances: expect.arrayContaining([
        expect.objectContaining({
          kind: "calculator_result",
          expression,
          result: "59.672748298",
        }),
      ]),
    });
  });

  it("calls source health as a read-only non-terminal gateway observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "live_env.query_source_health",
      arguments: {
        thread_id: "helix-ask:test-source-health",
      },
      turnId: "ask:test:gateway-source-health",
      iteration: 5,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: "live_env.query_source_health",
      gateway_admission: {
        admission_status: "admitted",
        permission_profile: "read",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        capability_key: "live_env.query_source_health",
        panel_id: "live-answer-environment",
        action: "query_source_health",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.live_environment_tool_observation.v1",
        thread_id: "helix-ask:test-source-health",
        tool_name: "live_env.query_source_health",
        ok: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        observation: {
          schema: "helix.situation_source_capability_read.v1",
          status: "read",
          requiredActuator: "query_source_health",
          post_tool_model_step_required: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      tool_followup_decision: {
        next_action: "continue_reasoning",
        terminal_blockers: [
          "post_tool_model_step_required",
          "terminal_authority_not_evaluated",
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("calls live-source loop health as a read-only non-terminal gateway observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "future",
      mode: "read",
      capabilityId: LIVE_SOURCE_LOOP_HEALTH_CAPABILITY,
      arguments: {
        thread_id: "helix-ask:test-loop-health",
        expected_cadence_ms: 1000,
      },
      turnId: "ask:test:gateway-loop-health",
      iteration: 6,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "future",
      capability_id: LIVE_SOURCE_LOOP_HEALTH_CAPABILITY,
      gateway_admission: {
        requested_capability: LIVE_SOURCE_LOOP_HEALTH_CAPABILITY,
        selected_agent_provider: "future",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        capability_key: LIVE_SOURCE_LOOP_HEALTH_CAPABILITY,
        panel_id: "live-answer-environment",
        action: "query_live_source_loop_health",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.live_environment_tool_observation.v1",
        thread_id: "helix-ask:test-loop-health",
        tool_name: LIVE_SOURCE_LOOP_HEALTH_CAPABILITY,
        ok: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        observation: {
          schema: "stage_play_live_source_loop_health/v1",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      tool_lifecycle_trace: {
        requested_capability: LIVE_SOURCE_LOOP_HEALTH_CAPABILITY,
        admitted_capability: LIVE_SOURCE_LOOP_HEALTH_CAPABILITY,
        executed_capability: LIVE_SOURCE_LOOP_HEALTH_CAPABILITY,
        lifecycle_stage: "completed",
        status: "completed",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("calls live-source state reads as read-only non-terminal gateway observations", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "live_env.query_live_source_quality",
      arguments: {
        thread_id: "helix-ask:test-live-source-quality",
        source_ref: "live-source:test-quality",
      },
      turnId: "ask:test:gateway-live-source-quality",
      iteration: 7,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: "live_env.query_live_source_quality",
      gateway_admission: {
        requested_capability: "live_env.query_live_source_quality",
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        capability_key: "live_env.query_live_source_quality",
        panel_id: "live-answer-environment",
        action: "query_live_source_quality",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.live_environment_tool_observation.v1",
        thread_id: "helix-ask:test-live-source-quality",
        tool_name: "live_env.query_live_source_quality",
        ok: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        observation: {
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      tool_lifecycle_trace: {
        requested_capability: "live_env.query_live_source_quality",
        admitted_capability: "live_env.query_live_source_quality",
        executed_capability: "live_env.query_live_source_quality",
        lifecycle_stage: "completed",
        status: "completed",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("calls situation/stage state reads as read-only non-terminal gateway observations", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "live_env.query_event_log",
      arguments: {
        thread_id: "helix-ask:test-event-log",
        source_ref: "live-env:event-log",
        limit: 2,
      },
      turnId: "ask:test:gateway-event-log",
      iteration: 8,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: "live_env.query_event_log",
      gateway_admission: {
        requested_capability: "live_env.query_event_log",
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        capability_key: "live_env.query_event_log",
        panel_id: "live-answer-environment",
        action: "query_event_log",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.live_environment_tool_observation.v1",
        thread_id: "helix-ask:test-event-log",
        tool_name: "live_env.query_event_log",
        ok: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      tool_lifecycle_trace: {
        requested_capability: "live_env.query_event_log",
        admitted_capability: "live_env.query_event_log",
        executed_capability: "live_env.query_event_log",
        lifecycle_stage: "completed",
        status: "completed",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("calls micro-reasoner preset query as a read-only non-terminal gateway observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "live_env.query_micro_reasoner_presets",
      arguments: {
        thread_id: "helix-ask:test-micro-presets",
        source_id: "workstation-source:microdeck-test",
      },
      turnId: "ask:test:gateway-micro-presets",
      iteration: 7,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: "live_env.query_micro_reasoner_presets",
      gateway_admission: {
        admission_status: "admitted",
        permission_profile: "read",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        capability_key: "live_env.query_micro_reasoner_presets",
        panel_id: "live-answer-environment",
        action: "query_micro_reasoner_presets",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.live_environment_tool_observation.v1",
        thread_id: "helix-ask:test-micro-presets",
        tool_name: "live_env.query_micro_reasoner_presets",
        ok: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        observation: {
          schema: "stage_play_micro_reasoner_prompt_preset_query_result/v1",
          post_tool_model_step_required: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      tool_followup_decision: {
        next_action: "continue_reasoning",
        terminal_blockers: [
          "post_tool_model_step_required",
          "terminal_authority_not_evaluated",
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("calls micro-reasoner prompt test as a dry-run non-terminal gateway observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "future",
      mode: "read",
      capabilityId: "live_env.test_micro_reasoner_prompt",
      arguments: {
        thread_id: "helix-ask:test-micro-prompt-test",
        source_id: "workstation-source:microdeck-test",
        role: "claim_extractor",
        limit: 1,
      },
      turnId: "ask:test:gateway-micro-prompt-test",
      iteration: 8,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "future",
      capability_id: "live_env.test_micro_reasoner_prompt",
      observation_packet: {
        capability_key: "live_env.test_micro_reasoner_prompt",
        panel_id: "live-answer-environment",
        action: "test_micro_reasoner_prompt",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.live_environment_tool_observation.v1",
        thread_id: "helix-ask:test-micro-prompt-test",
        tool_name: "live_env.test_micro_reasoner_prompt",
        ok: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        observation: {
          schema: "stage_play_micro_reasoner_prompt_test_result/v1",
          activated: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      tool_lifecycle_trace: {
        requested_capability: "live_env.test_micro_reasoner_prompt",
        admitted_capability: "live_env.test_micro_reasoner_prompt",
        executed_capability: "live_env.test_micro_reasoner_prompt",
        lifecycle_stage: "completed",
        status: "completed",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("calls visual observer profile query as a read-only non-terminal gateway observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "live_env.query_visual_observer_profiles",
      arguments: {
        thread_id: "helix-ask:test-visual-observer-query",
        source_id: "workstation-source:visual-observer-test",
        limit: 3,
      },
      turnId: "ask:test:gateway-visual-observer-query",
      iteration: 9,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: "live_env.query_visual_observer_profiles",
      gateway_admission: {
        admission_status: "admitted",
        permission_profile: "read",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        capability_key: "live_env.query_visual_observer_profiles",
        panel_id: "live-answer-environment",
        action: "query_visual_observer_profiles",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.live_environment_tool_observation.v1",
        thread_id: "helix-ask:test-visual-observer-query",
        tool_name: "live_env.query_visual_observer_profiles",
        ok: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        observation: {
          schema: "stage_play_visual_observer_profile_list_response/v1",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      tool_followup_decision: {
        next_action: "continue_reasoning",
        terminal_blockers: [
          "post_tool_model_step_required",
          "terminal_authority_not_evaluated",
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("calls visual observer profile test as a dry-run non-terminal gateway observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "future",
      mode: "read",
      capabilityId: "live_env.test_visual_observer_profile",
      arguments: {
        thread_id: "helix-ask:test-visual-observer-test",
        source_id: "workstation-source:visual-observer-test",
        profile_id: "stage_play_visual_observer_profile:generic:v1",
        generic_summary: '{"summary":"generic frame summary"}',
        profile_summary: '{"summary":"profile frame summary"}',
      },
      turnId: "ask:test:gateway-visual-observer-test",
      iteration: 10,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "future",
      capability_id: "live_env.test_visual_observer_profile",
      observation_packet: {
        capability_key: "live_env.test_visual_observer_profile",
        panel_id: "live-answer-environment",
        action: "test_visual_observer_profile",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.live_environment_tool_observation.v1",
        thread_id: "helix-ask:test-visual-observer-test",
        tool_name: "live_env.test_visual_observer_profile",
        ok: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        observation: {
          schema: "stage_play_visual_observer_profile_test_result/v1",
          enqueuedAsMail: false,
          enqueued_as_mail: false,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      tool_lifecycle_trace: {
        requested_capability: "live_env.test_visual_observer_profile",
        admitted_capability: "live_env.test_visual_observer_profile",
        executed_capability: "live_env.test_visual_observer_profile",
        lifecycle_stage: "completed",
        status: "completed",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("does not expose mutating visual observer controls through the provider gateway", async () => {
    const gatewayIds = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    }).capabilities.map((capability) => capability.capability_id);

    for (const capabilityId of [
      "live_env.configure_visual_observer_profile",
      "live_env.apply_visual_observer_profile",
      "live_env.request_visual_action_replay",
    ]) {
      expect(gatewayIds).not.toContain(capabilityId);
      const result = await callWorkstationGatewayCapability({
        agentRuntime: "codex",
        mode: "act",
        capabilityId,
        turnId: `ask:test:gateway-visual-observer-held-back:${capabilityId}`,
      });
      expect(result).toMatchObject({
        ok: false,
        capability_id: capabilityId,
        error: "capability_not_registered",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      });
    }
  });

  it("calls scientific-calculator.solve_expression as read-only non-terminal evidence", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
      arguments: {
        expression: "2 + 2 * 3",
      },
      turnId: "ask:test:gateway-calculator",
      iteration: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
      gateway_admission: {
        requested_capability: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: "ask:test:gateway-calculator",
        iteration: 2,
        capability_key: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
        panel_id: "scientific-calculator",
        action: "solve_expression",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.calculator_solve_observation.v1",
        expression: "2 + 2 * 3",
        result: "8",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("calls scientific-calculator.solve_expression for calculus expressions as read-only non-terminal evidence", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
      arguments: {
        expression: "integrate(x^2+3*x,x)",
      },
      turnId: "ask:test:gateway-calculator-integral",
      iteration: 1,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: "ask:test:gateway-calculator-integral",
        capability_key: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
        panel_id: "scientific-calculator",
        action: "solve_expression",
        status: "succeeded",
      },
      observation: {
        schema: "helix.calculator_solve_observation.v1",
        expression: "integrate(x^2+3*x,x)",
        normalized_expression: "integrate(x^2+3*x,x)",
        result: "0.3333333333333333*x^3+1.5*x^2",
        status: "succeeded",
      },
    });
  });

  it("normalizes Calc-style definite integrals before evaluating calculator expressions", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
      arguments: {
        expression: "integrate(t^2+3*t,t,0,5)",
      },
      turnId: "ask:test:gateway-calculator-definite-integral",
      iteration: 1,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        status: "succeeded",
      },
      observation: {
        schema: "helix.calculator_solve_observation.v1",
        expression: "integrate(t^2+3*t,t,0,5)",
        normalized_expression: "defint(t^2+3*t,0,5,t)",
        result: "79.166666666666666667",
        status: "succeeded",
      },
    });
  });

  it("evaluates nested Calc-style definite integrals as calculator expressions", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
      arguments: {
        expression: "integrate(integrate(x*y,y,0,2),x,0,3)",
      },
      turnId: "ask:test:gateway-calculator-nested-definite-integral",
      iteration: 1,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        status: "succeeded",
      },
      observation: {
        schema: "helix.calculator_solve_observation.v1",
        expression: "integrate(integrate(x*y,y,0,2),x,0,3)",
        normalized_expression: "defint(defint(x*y,0,2,y),0,3,x)",
        result: "9",
        status: "succeeded",
      },
    });
  });

  it("blocks symbolic scientific-calculator.solve_expression without producing numeric evidence", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
      arguments: {
        expression: "E = h * f",
      },
      turnId: "ask:test:gateway-calculator-symbolic-solve-blocked",
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
      error: "unsupported_expression_syntax",
      observation: {
        schema: "helix.calculator_solve_observation.v1",
        status: "blocked",
        result: null,
        blocked_reason: "unsupported_expression_syntax",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.produced_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "calculator_result",
          status: "blocked",
          result: null,
        }),
      ]),
    );
    expect(result.produced_affordances).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "numeric_value_evidence",
        }),
      ]),
    );
  });

  it("omits internet search and reports provider availability when no provider is configured", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.EXA_API_KEY;
    delete process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
    delete process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID;
    delete process.env.GOOGLE_CSE_API_KEY;
    delete process.env.GOOGLE_CSE_CX;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_SEARCH_ENGINE_ID;

    const manifest = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "observe",
    });

    expect(
      manifest.capabilities.map((capability) => capability.capability_id),
    ).not.toContain(INTERNET_SEARCH_CAPABILITY);
    expect(manifest.unavailable_capabilities).toContainEqual({
      capability_id: INTERNET_SEARCH_CAPABILITY,
      availability: "unavailable",
      reason: "provider_not_configured",
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "observe",
      capabilityId: INTERNET_SEARCH_CAPABILITY,
      turnId: "ask:test-internet-unconfigured",
      iteration: 0,
      arguments: { query: "current magnetar research" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: "provider_not_configured",
      gateway_admission: {
        blocked_reason: "provider_not_configured",
      },
      observation: {
        status: "blocked",
        blocked_reason: "provider_not_configured",
        providers_called: [],
      },
    });
  });

  it("solves fully numeric bound scalar expressions as the result-producing calculator lane", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CALCULATOR_SOLVE_SCALAR_EXPRESSION_CAPABILITY,
      arguments: {
        expression: "E = 6.62607015e-34 * 5e14",
        source_refs: ["paper:eq1", "paper:param:f"],
      },
      turnId: "ask:test:gateway-calculator-scalar-solve",
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: CALCULATOR_SOLVE_SCALAR_EXPRESSION_CAPABILITY,
      gateway_admission: {
        requested_capability: CALCULATOR_SOLVE_SCALAR_EXPRESSION_CAPABILITY,
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        capability_key: CALCULATOR_SOLVE_SCALAR_EXPRESSION_CAPABILITY,
        panel_id: "scientific-calculator",
        action: "solve_scalar_expression",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.calculator_scalar_solve_observation.v1",
        expression: "E = 6.62607015e-34 * 5e14",
        scalar_expression: "6.62607015e-34 * 5e14",
        result_symbol: "E",
        result: "3.313035e-19",
        source_refs: ["paper:eq1", "paper:param:f"],
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.produced_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "calculator_result",
          status: "available",
          expression: "E = 6.62607015e-34 * 5e14",
          result: "3.313035e-19",
        }),
        expect.objectContaining({
          kind: "numeric_value_evidence",
          status: "available",
          result: "3.313035e-19",
        }),
      ]),
    );
  });

  it("blocks scalar solving when bound expressions still contain symbols", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CALCULATOR_SOLVE_SCALAR_EXPRESSION_CAPABILITY,
      arguments: {
        expression: "E = h * 5e14",
        source_refs: ["paper:eq1"],
      },
      turnId: "ask:test:gateway-calculator-scalar-symbolic-blocked",
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: CALCULATOR_SOLVE_SCALAR_EXPRESSION_CAPABILITY,
      error: "unsupported_expression_syntax",
      observation: {
        schema: "helix.calculator_scalar_solve_observation.v1",
        status: "blocked",
        expression: "E = h * 5e14",
        scalar_expression: "h * 5e14",
        result: null,
        blocked_reason: "unsupported_expression_syntax",
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(result.produced_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "calculator_result",
          status: "blocked",
          result: null,
        }),
      ]),
    );
    expect(result.produced_affordances).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "numeric_value_evidence" }),
      ]),
    );
  });

  it("blocks scalar solving without source refs before producing numeric evidence", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CALCULATOR_SOLVE_SCALAR_EXPRESSION_CAPABILITY,
      arguments: {
        expression: "E = 6.62607015e-34 * 5e14",
      },
      turnId: "ask:test:gateway-calculator-scalar-missing-source",
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: CALCULATOR_SOLVE_SCALAR_EXPRESSION_CAPABILITY,
      error: "missing_source_refs",
      observation: {
        schema: "helix.calculator_scalar_solve_observation.v1",
        status: "blocked",
        result: null,
        blocked_reason: "missing_source_refs",
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(result.produced_affordances).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "numeric_value_evidence" }),
      ]),
    );
  });

  it("classifies symbolic calculator expressions without solving them", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CALCULATOR_CLASSIFY_EXPRESSION_CAPABILITY,
      arguments: {
        expression: "E = h * f",
      },
      turnId: "ask:test:gateway-calculator-classify-symbolic",
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: CALCULATOR_CLASSIFY_EXPRESSION_CAPABILITY,
      observation_packet: {
        capability_key: CALCULATOR_CLASSIFY_EXPRESSION_CAPABILITY,
        panel_id: "scientific-calculator",
        action: "classify_expression",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.calculator_expression_classification_observation.v1",
        status: "succeeded",
        expression: "E = h * f",
        calculation_type: "symbolic_equation",
        detected_symbols: ["f"],
        missing_variables: ["f"],
        possible_routes: expect.arrayContaining([
          "symbolic_solver",
          "paper_equation_binder",
        ]),
        blocked_reasons: ["missing_variable_bindings"],
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.produced_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "calculator_expression_template",
          expression: "E = h * f",
          missing_inputs: ["f"],
        }),
      ]),
    );
    expect(result.produced_affordances).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "calculator_result",
        }),
      ]),
    );
  });

  it("binds calculator variables only from numeric evidence with source refs", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "verify",
      capabilityId: CALCULATOR_BIND_VARIABLES_CAPABILITY,
      arguments: {
        expression: "E = h * f",
        numeric_evidence: [
          {
            symbol: "f",
            value: "5e14",
            unit: "Hz",
            dimension_signature: "T^-1",
            source_refs: ["paper:eq1"],
          },
        ],
        expected_units: { f: "Hz" },
        expected_dimensions: { f: "T^-1" },
      },
      turnId: "ask:test:gateway-calculator-bind-symbolic",
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: CALCULATOR_BIND_VARIABLES_CAPABILITY,
      observation_packet: {
        capability_key: CALCULATOR_BIND_VARIABLES_CAPABILITY,
        panel_id: "scientific-calculator",
        action: "bind_variables",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.calculator_variable_binding_observation.v1",
        status: "succeeded",
        expression: "E = h * f",
        bound_expression: "E = h * 5e14",
        required_symbols: ["f"],
        missing_variables: [],
        blocked_reasons: [],
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.produced_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "bound_calculator_expression",
          status: "available",
          normalized_expression: "E = h * 5e14",
        }),
      ]),
    );
    expect(result.produced_affordances).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "calculator_result" }),
        expect.objectContaining({ kind: "numeric_value_evidence" }),
      ]),
    );
  });

  it("blocks calculator variable binding when source refs are missing", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "verify",
      capabilityId: CALCULATOR_BIND_VARIABLES_CAPABILITY,
      arguments: {
        expression: "E = h * f",
        numeric_evidence: [
          {
            symbol: "f",
            value: "5e14",
            unit: "Hz",
          },
        ],
      },
      turnId: "ask:test:gateway-calculator-bind-missing-source",
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: CALCULATOR_BIND_VARIABLES_CAPABILITY,
      error: "missing_source_refs",
      observation: {
        schema: "helix.calculator_variable_binding_observation.v1",
        status: "blocked",
        bound_expression: null,
        missing_variables: ["f"],
        blocked_reasons: ["missing_source_refs"],
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(result.produced_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "bound_calculator_expression",
          status: "blocked",
          missing_inputs: ["f"],
        }),
      ]),
    );
  });

  it("does not bind calculator variables from expression-template affordances", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "verify",
      capabilityId: CALCULATOR_BIND_VARIABLES_CAPABILITY,
      arguments: {
        expression: "E = h * f",
        numeric_value_evidence: [
          {
            kind: "calculator_expression_template",
            symbol: "f",
            value: "h * f",
            expression: "E = h * f",
            source_refs: ["theory-badge:template"],
          },
        ],
      },
      turnId: "ask:test:gateway-calculator-bind-template-not-numeric",
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: CALCULATOR_BIND_VARIABLES_CAPABILITY,
      error: "missing_variables",
      observation_packet: {
        capability_key: CALCULATOR_BIND_VARIABLES_CAPABILITY,
        action: "bind_variables",
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
        missing_requirements: [
          expect.objectContaining({
            code: "missing_variables",
            required_affordance_kind: "numeric_value_evidence",
          }),
        ],
      },
      observation: {
        schema: "helix.calculator_variable_binding_observation.v1",
        status: "blocked",
        bound_expression: null,
        missing_variables: ["f"],
        blocked_reasons: ["missing_variables"],
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(result.consumed_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "numeric_value_evidence",
          status: "required",
        }),
      ]),
    );
    expect(result.produced_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "bound_calculator_expression",
          status: "blocked",
          missing_inputs: ["f"],
        }),
      ]),
    );
  });

  it("blocks calculator variable binding for incompatible units", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "verify",
      capabilityId: CALCULATOR_BIND_VARIABLES_CAPABILITY,
      arguments: {
        expression: "E = h * f",
        numeric_evidence: [
          {
            symbol: "f",
            value: "5e14",
            unit: "m",
            source_refs: ["paper:eq1"],
          },
        ],
        expected_units: { f: "Hz" },
      },
      turnId: "ask:test:gateway-calculator-bind-incompatible-units",
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: CALCULATOR_BIND_VARIABLES_CAPABILITY,
      error: "incompatible_dimensions",
      observation: {
        schema: "helix.calculator_variable_binding_observation.v1",
        status: "blocked",
        bound_expression: null,
        missing_variables: ["f"],
        blocked_reasons: ["incompatible_dimensions"],
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("prefills symbolic calculator expressions as UI projection receipts only", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: CALCULATOR_PREFILL_EXPRESSION_CAPABILITY,
      arguments: {
        expression: "E = h * f",
        source_refs: ["paper:eq1"],
      },
      turnId: "ask:test:gateway-calculator-prefill-symbolic",
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: CALCULATOR_PREFILL_EXPRESSION_CAPABILITY,
      observation_packet: {
        capability_key: CALCULATOR_PREFILL_EXPRESSION_CAPABILITY,
        panel_id: "scientific-calculator",
        action: "prefill_expression",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.workstation_ui_action_receipt.v1",
        action_id: "prefill_expression",
        expression: "E = h * f",
        produced_calculator_receipt: false,
        produced_numeric_value_evidence: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.produced_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "ui_projection_receipt",
          status: "available",
        }),
      ]),
    );
    expect(result.produced_affordances).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "calculator_result",
        }),
        expect.objectContaining({
          kind: "numeric_value_evidence",
        }),
      ]),
    );
  });

  it("normalizes percent-of calculator phrases before solving", async () => {
    const cases = [
      ["12.5% of 54176", "(12.5 / 100) * 54176"],
      ["12.5 percent of 54176", "(12.5 / 100) * 54176"],
      ["what is 12.5% of 54176?", "(12.5 / 100) * 54176"],
    ] as const;

    for (const [expression, normalizedExpression] of cases) {
      const result = await callWorkstationGatewayCapability({
        agentRuntime: "codex",
        mode: "read",
        capabilityId: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
        arguments: {
          expression,
        },
        turnId: "ask:test:gateway-calculator-percent-normalization",
        iteration: 4,
      });

      expect(result).toMatchObject({
        ok: true,
        capability_id: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
        gateway_admission: {
          admission_status: "admitted",
          blocked_reason: undefined,
        },
        observation: {
          schema: "helix.calculator_solve_observation.v1",
          expression,
          normalized_expression: normalizedExpression,
          result: "6772",
          status: "succeeded",
          assistant_answer: false,
          raw_content_included: false,
        },
      });
    }
  });

  it("calls scientific-calculator.active_context as bounded active-panel observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CALCULATOR_ACTIVE_CONTEXT_CAPABILITY,
      arguments: {
        active_context: {
          current_latex: "8 * 9",
          last_result_text: "72",
          last_normalized_expression: "8*9",
          last_ok: true,
          step_count: 1,
          recent_debug_events: [
            {
              action_id: "solve_expression",
              ok: true,
              input_latex: "8 * 9",
              result_text: "72",
              normalized_expression: "8*9",
              message: "solve_completed",
              ts: "2026-06-28T00:00:00.000Z",
            },
          ],
        },
      },
      turnId: "ask:test:gateway-calculator-active-context",
      iteration: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: CALCULATOR_ACTIVE_CONTEXT_CAPABILITY,
      gateway_admission: {
        requested_capability: CALCULATOR_ACTIVE_CONTEXT_CAPABILITY,
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: "ask:test:gateway-calculator-active-context",
        iteration: 3,
        capability_key: CALCULATOR_ACTIVE_CONTEXT_CAPABILITY,
        panel_id: "scientific-calculator",
        action: "active_context",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.calculator_active_context_observation.v1",
        capability_key: CALCULATOR_ACTIVE_CONTEXT_CAPABILITY,
        panel_id: "scientific-calculator",
        status: "succeeded",
        current_latex: "8 * 9",
        last_result_text: "72",
        last_normalized_expression: "8*9",
        last_ok: true,
        step_count: 1,
        recent_debug_events: [
          expect.objectContaining({
            action_id: "solve_expression",
            result_text: "72",
          }),
        ],
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("blocks scientific-calculator.active_context when no bounded calculator state was supplied", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CALCULATOR_ACTIVE_CONTEXT_CAPABILITY,
      arguments: {
        active_context: {},
      },
      turnId: "ask:test:gateway-calculator-active-context-missing",
      iteration: 4,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: CALCULATOR_ACTIVE_CONTEXT_CAPABILITY,
      error: "calculator_active_context_missing",
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "calculator_active_context_missing",
      },
      observation_packet: {
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
        missing_requirements: [
          expect.objectContaining({
            code: "calculator_active_context_missing",
            repair_action: "ask_user",
          }),
        ],
      },
      observation: {
        schema: "helix.calculator_active_context_observation.v1",
        status: "blocked",
        blocked_reason: "calculator_active_context_missing",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("blocks calculator panel UI actions without act permission", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CALCULATOR_OPEN_PANEL_CAPABILITY,
      turnId: "ask:test:gateway-calculator-open-blocked",
      iteration: 3,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: CALCULATOR_OPEN_PANEL_CAPABILITY,
      mode: "read",
      gateway_admission: {
        requested_capability: CALCULATOR_OPEN_PANEL_CAPABILITY,
        permission_profile: "act",
        admission_status: "blocked",
        admission_reason: "permission_profile_insufficient",
        blocked_reason: "permission_profile_read_does_not_allow_act",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      observation: {
        schema: "helix.workstation_tool_gateway.permission_blocked.v1",
        requested_mode: "read",
        required_permission_profile: "act",
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("admits calculator panel UI actions as non-terminal action receipts under act permission", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: CALCULATOR_OPEN_PANEL_CAPABILITY,
      turnId: "ask:test:gateway-calculator-open",
      iteration: 4,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: CALCULATOR_OPEN_PANEL_CAPABILITY,
      mode: "act",
      gateway_admission: {
        requested_capability: CALCULATOR_OPEN_PANEL_CAPABILITY,
        permission_profile: "act",
        admission_status: "admitted",
        admission_reason: "non_mutating_workstation_ui_action",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        capability_key: CALCULATOR_OPEN_PANEL_CAPABILITY,
        panel_id: "scientific-calculator",
        action: "open_panel",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.workstation_ui_action_receipt.v1",
        capability_key: CALCULATOR_OPEN_PANEL_CAPABILITY,
        action_kind: "open_panel",
        panel_id: "scientific-calculator",
        status: "succeeded",
        dispatch_status: "admitted",
        workstation_action: {
          schema_version: "helix.workstation.action/v1",
          action: "open_panel",
          panel_id: "scientific-calculator",
        },
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("admits calculator gateway solve panel projection only from an observed expression/result", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: CALCULATOR_SHOW_GATEWAY_SOLVE_CAPABILITY,
      arguments: {
        expression: "(18+6)*3",
        normalized_expression: "(18+6)*3",
        result: "72",
        source_capability: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
        observation_ref:
          "ask:test:calculator-projection:scientific-calculator.solve_expression",
      },
      turnId: "ask:test:gateway-calculator-projection",
      iteration: 6,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: CALCULATOR_SHOW_GATEWAY_SOLVE_CAPABILITY,
      mode: "act",
      gateway_admission: {
        requested_capability: CALCULATOR_SHOW_GATEWAY_SOLVE_CAPABILITY,
        permission_profile: "act",
        admission_status: "admitted",
        admission_reason: "non_mutating_workstation_ui_action",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        capability_key: CALCULATOR_SHOW_GATEWAY_SOLVE_CAPABILITY,
        panel_id: "scientific-calculator",
        action: "show_gateway_solve",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.workstation_ui_action_receipt.v1",
        capability_key: CALCULATOR_SHOW_GATEWAY_SOLVE_CAPABILITY,
        action_kind: "run_panel_action",
        panel_id: "scientific-calculator",
        action_id: "show_gateway_solve",
        status: "succeeded",
        dispatch_status: "admitted",
        workstation_action: {
          schema_version: "helix.workstation.action/v1",
          action: "run_panel_action",
          panel_id: "scientific-calculator",
          action_id: "show_gateway_solve",
          args: {
            expression: "(18+6)*3",
            normalized_expression: "(18+6)*3",
            result: "72",
            source_capability: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
            observation_ref:
              "ask:test:calculator-projection:scientific-calculator.solve_expression",
          },
        },
        source_capability: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("admits safe workstation panel open actions as non-terminal action receipts under act permission", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: WORKSTATION_OPEN_PANEL_CAPABILITY,
      arguments: {
        panel_id: "workstation-process-graph",
      },
      turnId: "ask:test:gateway-workstation-open-panel",
      iteration: 5,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: WORKSTATION_OPEN_PANEL_CAPABILITY,
      mode: "act",
      gateway_admission: {
        requested_capability: WORKSTATION_OPEN_PANEL_CAPABILITY,
        permission_profile: "act",
        admission_status: "admitted",
        admission_reason: "non_mutating_workstation_ui_action",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        capability_key: WORKSTATION_OPEN_PANEL_CAPABILITY,
        panel_id: "workstation-process-graph",
        action: "open_panel",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.workstation_ui_action_receipt.v1",
        capability_key: WORKSTATION_OPEN_PANEL_CAPABILITY,
        action_kind: "open_panel",
        panel_id: "workstation-process-graph",
        status: "succeeded",
        dispatch_status: "admitted",
        workstation_action: {
          schema_version: "helix.workstation.action/v1",
          action: "open_panel",
          panel_id: "workstation-process-graph",
        },
        allowed_panel_ids: expect.arrayContaining([
          "docs-viewer",
          "scientific-calculator",
          "workstation-process-graph",
        ]),
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("blocks workstation panel actions for mutation-adjacent panels outside the safe allowlist", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: WORKSTATION_FOCUS_PANEL_CAPABILITY,
      arguments: {
        panel_id: "workstation-clipboard-history",
      },
      turnId: "ask:test:gateway-workstation-focus-panel-blocked",
      iteration: 6,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: WORKSTATION_FOCUS_PANEL_CAPABILITY,
      error: "workstation_panel_not_in_safe_allowlist",
      gateway_admission: {
        requested_capability: WORKSTATION_FOCUS_PANEL_CAPABILITY,
        permission_profile: "act",
        admission_status: "blocked",
        blocked_reason: "workstation_panel_not_in_safe_allowlist",
      },
      observation_packet: {
        panel_id: "workstation",
        action: "focus_panel",
        status: "blocked",
        missing_requirements: [
          expect.objectContaining({
            code: "workstation_panel_not_in_safe_allowlist",
            repair_action: "ask_user",
          }),
        ],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.workstation_ui_action_receipt.v1",
        action_kind: "focus_panel",
        panel_id: null,
        status: "blocked",
        dispatch_status: "blocked",
        workstation_action: null,
        allowed_panel_ids: expect.not.arrayContaining([
          "workstation-clipboard-history",
          "workstation-notes",
        ]),
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("admits docs-viewer.open_doc as a non-terminal action receipt under act permission", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: DOCS_OPEN_DOC_CAPABILITY,
      arguments: {
        path: "docs/helix-ask-codex-loop-discipline.md",
        anchor: "Patch-Time Contract",
      },
      turnId: "ask:test:gateway-docs-open-doc",
      iteration: 5,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: DOCS_OPEN_DOC_CAPABILITY,
      mode: "act",
      gateway_admission: {
        requested_capability: DOCS_OPEN_DOC_CAPABILITY,
        permission_profile: "act",
        admission_status: "admitted",
        admission_reason: "non_mutating_workstation_ui_action",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        capability_key: DOCS_OPEN_DOC_CAPABILITY,
        panel_id: "docs-viewer",
        action: "open_doc",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.workstation_ui_action_receipt.v1",
        capability_key: DOCS_OPEN_DOC_CAPABILITY,
        action_kind: "open_doc",
        panel_id: "docs-viewer",
        status: "succeeded",
        dispatch_status: "admitted",
        path: "docs/helix-ask-codex-loop-discipline.md",
        anchor: "Patch-Time Contract",
        workstation_action: {
          schema_version: "helix.workstation.action/v1",
          action: "run_panel_action",
          panel_id: "docs-viewer",
          action_id: "open_doc",
          args: {
            path: "docs/helix-ask-codex-loop-discipline.md",
            anchor: "Patch-Time Contract",
          },
        },
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("blocks docs-viewer.open_doc when no safe docs path was supplied", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: DOCS_OPEN_DOC_CAPABILITY,
      arguments: {
        path: "../server/index.ts",
      },
      turnId: "ask:test:gateway-docs-open-doc-blocked",
      iteration: 6,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: DOCS_OPEN_DOC_CAPABILITY,
      error: "docs_open_doc_path_missing_or_unsafe",
      gateway_admission: {
        requested_capability: DOCS_OPEN_DOC_CAPABILITY,
        permission_profile: "act",
        admission_status: "blocked",
        blocked_reason: "docs_open_doc_path_missing_or_unsafe",
      },
      observation_packet: {
        panel_id: "docs-viewer",
        action: "open_doc",
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
        missing_requirements: [
          expect.objectContaining({
            code: "docs_open_doc_path_missing_or_unsafe",
            repair_action: "ask_user",
          }),
        ],
      },
      observation: {
        schema: "helix.workstation_ui_action_receipt.v1",
        action_kind: "open_doc",
        panel_id: "docs-viewer",
        status: "blocked",
        dispatch_status: "blocked",
        workstation_action: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("blocks unsupported calculator expressions as non-terminal observations", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      capabilityId: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
      arguments: {
        expression: "process.exit()",
      },
      turnId: "ask:test:gateway-calculator-blocked",
    });

    expect(result).toMatchObject({
      ok: false,
      error: "unsupported_expression_syntax",
      gateway_admission: {
        requested_capability: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
        admission_status: "blocked",
        blocked_reason: "unsupported_expression_syntax",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      observation_packet: {
        status: "blocked",
        missing_requirements: [
          expect.objectContaining({
            code: "unsupported_expression_syntax",
            rejected_expression: "process.exit()",
            normalized_expression: "process.exit()",
            required_affordance_kind: "bound_calculator_expression",
          }),
        ],
        produced_affordances: expect.arrayContaining([
          expect.objectContaining({
            kind: "calculator_result",
            status: "blocked",
          }),
        ]),
        consumed_affordances: expect.arrayContaining([
          expect.objectContaining({
            kind: "bound_calculator_expression",
            status: "missing",
            missing_inputs: ["bound_calculator_expression"],
          }),
        ]),
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        requested_capability: CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
        admitted_capability: null,
        executed_capability: null,
        lifecycle_stage: "blocked",
        status: "blocked",
        failure_reason: "unsupported_expression_syntax",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_followup_decision: {
        schema: "helix.tool_followup_decision.v1",
        next_action: "ask_user",
        terminal_blockers: [
          "post_tool_model_step_required",
          "terminal_authority_not_evaluated",
        ],
        required_surface_satisfied: false,
        evidence_reentered: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("calls repo.search as read-only repo evidence, not an answer", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: REPO_SEARCH_CAPABILITY,
      arguments: {
        query: "workspace_os.status",
        paths: ["server/services/helix-ask"],
        max_hits: 3,
      },
      turnId: "ask:test:gateway-repo-search",
      iteration: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: REPO_SEARCH_CAPABILITY,
      gateway_admission: {
        requested_capability: REPO_SEARCH_CAPABILITY,
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      observation_packet: {
        capability_key: REPO_SEARCH_CAPABILITY,
        panel_id: "repo-evidence",
        action: "search",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.repo_search_observation.v1",
        query: "workspace_os.status",
        query_quality: expect.objectContaining({
          status: "accepted",
          meaningful_terms: ["workspace_os.status"],
        }),
        repo_relevance_gate: expect.objectContaining({
          status: "passed",
          matched_terms: ["workspace_os.status"],
        }),
        evidence_state: "repo_evidence_usable",
        selected_for_answer: true,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(
      (result.observation as { hit_count?: number }).hit_count,
    ).toBeGreaterThan(0);
  });

  it("finds Theory Badge Graph locator code with a focused repo.search query", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: REPO_SEARCH_CAPABILITY,
      arguments: {
        query: "theory badge graph locator",
        query_terms: [
          "Theory Badge Graph reflection produced",
          "theory-badge-overlap-locator",
          "theory-context-reflection-tool",
          "runHelixTheoryContextReflectionTool",
          "reflect_discussion_context",
          "located_badge_ids",
        ],
        source_target_intent: {
          query_derivation: {
            schema: "helix.repo_search_query_derivation.v1",
            source: "test",
            derived_query: "theory badge graph locator",
            derived_terms: [
              "theory-badge-overlap-locator",
              "theory-context-reflection-tool",
              "runHelixTheoryContextReflectionTool",
            ],
            rejected_terms: ["how"],
          },
        },
        paths: ["shared/theory", "server/services/helix-ask", "docs"],
        max_hits: 8,
      },
      turnId: "ask:test:gateway-repo-search-theory-badge-locator",
      iteration: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      observation_packet: {
        status: "succeeded",
        state_delta: expect.objectContaining({
          repo_relevance_gate: expect.objectContaining({
            status: "passed",
          }),
          evidence_state: "repo_evidence_usable",
          selected_for_answer: true,
          query_derivation: expect.objectContaining({
            schema: "helix.repo_search_query_derivation.v1",
            derived_query: "theory badge graph locator",
            rejected_terms: ["how"],
          }),
          support_refs: expect.arrayContaining([
            expect.stringMatching(
              /shared\/theory\/theory-badge-overlap-locator\.ts:L\d+/,
            ),
            expect.stringMatching(
              /shared\/theory\/theory-context-reflection-tool\.ts:L\d+/,
            ),
          ]),
        }),
      },
      observation: {
        schema: "helix.repo_search_observation.v1",
        query: "theory badge graph locator",
        terms: expect.arrayContaining([
          "Theory Badge Graph reflection produced",
          "theory-badge-overlap-locator",
          "theory-context-reflection-tool",
          "runHelixTheoryContextReflectionTool",
          "reflect_discussion_context",
        ]),
        query_quality: expect.objectContaining({
          status: "accepted",
          meaningful_terms: expect.arrayContaining([
            "theory",
            "badge",
            "graph",
            "locator",
          ]),
        }),
        query_derivation: expect.objectContaining({
          schema: "helix.repo_search_query_derivation.v1",
          derived_query: "theory badge graph locator",
          rejected_terms: ["how"],
        }),
        repo_relevance_gate: expect.objectContaining({
          status: "passed",
          matched_terms: expect.arrayContaining(["theory", "badge"]),
          relevance_score: expect.any(Number),
        }),
        evidence_state: "repo_evidence_usable",
        selected_for_answer: true,
        repair_attempts: [],
        support_refs: expect.arrayContaining([
          expect.stringMatching(
            /shared\/theory\/theory-badge-overlap-locator\.ts:L\d+/,
          ),
          expect.stringMatching(
            /shared\/theory\/theory-context-reflection-tool\.ts:L\d+/,
          ),
        ]),
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    const filePaths =
      (result.observation as { file_paths?: string[] }).file_paths ?? [];
    expect(filePaths).toEqual(
      expect.arrayContaining([
        "shared/theory/theory-badge-overlap-locator.ts",
        "shared/theory/theory-context-reflection-tool.ts",
      ]),
    );
    const hits =
      (result.observation as { hits?: Array<{ text?: string }> }).hits ?? [];
    expect(hits.some((hit) => (hit.text ?? "").length > 180)).toBe(true);
  });

  it("falls back to bounded Node repo search when ripgrep is unavailable", async () => {
    process.env.RG_BIN = "__helix_missing_rg_binary__";
    process.env.PATH = "";
    process.env.Path = "";

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: REPO_SEARCH_CAPABILITY,
      arguments: {
        query: "workspace_os.status",
        paths: ["server/services/helix-ask"],
        max_hits: 3,
      },
      turnId: "ask:test:gateway-repo-search-node-fallback",
      iteration: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      error: undefined,
      observation_packet: {
        status: "succeeded",
      },
      observation: {
        schema: "helix.repo_search_observation.v1",
        query: "workspace_os.status",
        status: "succeeded",
        search_backend: "node_fallback",
        search_backend_bin: null,
        search_backend_reason: "ripgrep_not_found",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(
      (result.observation as { hit_count?: number }).hit_count,
    ).toBeGreaterThan(0);
  });

  it("falls back to bounded Node repo search when ripgrep execution fails", async () => {
    process.env.RG_BIN = process.execPath;

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: REPO_SEARCH_CAPABILITY,
      arguments: {
        query: "workspace_os.status",
        paths: ["server/services/helix-ask"],
        max_hits: 3,
      },
      turnId: "ask:test:gateway-repo-search-rg-failure-fallback",
      iteration: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      error: undefined,
      observation_packet: {
        status: "succeeded",
      },
      observation: {
        schema: "helix.repo_search_observation.v1",
        query: "workspace_os.status",
        status: "succeeded",
        search_backend: "node_fallback",
        search_backend_bin: null,
        search_backend_reason: "ripgrep_failed",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(
      (result.observation as { hit_count?: number }).hit_count,
    ).toBeGreaterThan(0);
  });

  it("blocks missing repo.search query as a non-terminal observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      capabilityId: REPO_SEARCH_CAPABILITY,
      arguments: {},
      turnId: "ask:test:gateway-repo-search-blocked",
    });

    expect(result).toMatchObject({
      ok: false,
      error: "missing_query",
      gateway_admission: {
        requested_capability: REPO_SEARCH_CAPABILITY,
        admission_status: "blocked",
        blocked_reason: "missing_query",
      },
      observation_packet: {
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("blocks generic repo.search stopword queries before they can satisfy evidence", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: REPO_SEARCH_CAPABILITY,
      arguments: {
        query: "how",
        max_hits: 3,
      },
      turnId: "ask:test:gateway-repo-search-generic-blocked",
      iteration: 3,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "query_too_broad",
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "query_too_broad",
      },
      observation_packet: {
        status: "blocked",
        state_delta: expect.objectContaining({
          query_quality: expect.objectContaining({
            status: "blocked",
            code: "query_too_broad",
            meaningful_terms: [],
          }),
          repo_relevance_gate: expect.objectContaining({
            status: "blocked",
            code: "query_too_broad",
          }),
          evidence_state: "repo_query_blocked",
          selected_for_answer: false,
        }),
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.repo_search_observation.v1",
        query: "how",
        status: "blocked",
        blocked_reason: "query_too_broad",
        query_quality: expect.objectContaining({
          status: "blocked",
          meaningful_terms: [],
        }),
        repo_relevance_gate: expect.objectContaining({
          status: "blocked",
          code: "query_too_broad",
        }),
        evidence_state: "repo_query_blocked",
        selected_for_answer: false,
        repair_attempts: [
          expect.objectContaining({
            status: "blocked",
            reason: "query_too_broad",
          }),
        ],
        support_refs: [],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("marks accepted repo.search queries with no relevant hits as repairable low-relevance evidence", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: REPO_SEARCH_CAPABILITY,
      arguments: {
        query: "zzznomatch raretoken",
        paths: ["server/services/helix-ask"],
        max_hits: 3,
      },
      turnId: "ask:test:gateway-repo-search-low-relevance",
      iteration: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      observation_packet: {
        status: "succeeded",
        missing_requirements: [
          expect.objectContaining({
            code: "no_repo_search_hits",
            repair_action: "repair",
          }),
        ],
        state_delta: expect.objectContaining({
          repo_relevance_gate: expect.objectContaining({
            status: "blocked",
            code: "no_repo_search_hits",
            relevance_score: 0,
          }),
          evidence_state: "repo_evidence_low_relevance",
          selected_for_answer: false,
          repair_attempts: [
            expect.objectContaining({
              status: "retry_recommended",
              reason: "no_repo_search_hits",
              repair_queries: ["zzznomatch raretoken"],
            }),
          ],
        }),
      },
      observation: {
        schema: "helix.repo_search_observation.v1",
        query: "zzznomatch raretoken",
        query_quality: expect.objectContaining({
          status: "accepted",
          meaningful_terms: ["zzznomatch", "raretoken"],
        }),
        repo_relevance_gate: expect.objectContaining({
          status: "blocked",
          code: "no_repo_search_hits",
        }),
        evidence_state: "repo_evidence_low_relevance",
        selected_for_answer: false,
        next_affordances: [
          expect.objectContaining({
            capability: REPO_SEARCH_CAPABILITY,
            reason: "no_repo_search_hits",
            repair_queries: ["zzznomatch raretoken"],
          }),
        ],
        support_refs: [],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("calls docs.search as read-only docs evidence, not an answer", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "Helix Ask remains the grounded reasoning surface",
        paths: ["docs"],
        max_hits: 3,
      },
      turnId: "ask:test:gateway-docs-search",
      iteration: 4,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: DOCS_SEARCH_CAPABILITY,
      gateway_admission: {
        requested_capability: DOCS_SEARCH_CAPABILITY,
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      observation_packet: {
        capability_key: DOCS_SEARCH_CAPABILITY,
        panel_id: "docs-viewer",
        action: "search_docs",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.docs_search_observation.v1",
        query: "Helix Ask remains the grounded reasoning surface",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(
      (result.observation as { hit_count?: number }).hit_count,
    ).toBeGreaterThan(0);
  });

  it("searches an adapter-admitted mechanics collection without requiring its document title", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query:
          "what current evidence is needed before saying an actor can use an inventory item",
        mechanics_collection_ids: ["mechanics.minecraft.java.v1"],
        adapter_profile_id: "game.minecraft.readonly.v1",
        max_hits: 4,
      },
      turnId: "ask:test:gateway-docs-mechanics-search",
      iteration: 4,
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        mechanics_scope: {
          adapter_profile_id: "game.minecraft.readonly.v1",
          document_paths: ["docs/game-mechanics/minecraft-java-v1.md"],
          content_role: "mechanics_reference_not_live_observation",
          assistant_answer: false,
          terminal_eligible: false,
        },
        paths: ["docs/game-mechanics/minecraft-java-v1.md"],
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
    const hits =
      (
        result.observation as {
          hits?: Array<{ filePath?: string }>;
        }
      ).hits ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(
      hits.every(
        (hit) => hit.filePath === "docs/game-mechanics/minecraft-java-v1.md",
      ),
    ).toBe(true);
  });

  it("exposes goal-shaped room mechanics retrieval and returns the exact cited command line", async () => {
    const manifest = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "act",
    }).capabilities.find(
      (capability) => capability.capability_id === DOCS_SEARCH_CAPABILITY,
    );
    expect(manifest?.input_schema).toMatchObject({
      additionalProperties: false,
      properties: {
        environment_scope: {
          enum: ["active_room_environment"],
        },
        environment_label: { type: "string" },
        mechanics_collection_ids: { type: "array" },
        adapter_profile_id: { type: "string" },
        exact_terms: { type: "array" },
        section_headings: { type: "array" },
        section_match_unit: {
          enum: ["line", "sentence", "paragraph"],
        },
      },
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query:
          "Can you make me glow for ten seconds in the connected Minecraft world?",
        mechanics_collection_ids: ["mechanics.minecraft.commands.v1"],
        adapter_profile_id: "game.minecraft.readonly.v1",
        max_hits: 4,
      },
      turnId: "ask:test:gateway-docs-mechanics-glow",
      iteration: 4,
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        active_document_observation: null,
        mechanics_scope: {
          content_role: "mechanics_reference_not_live_observation",
          assistant_answer: false,
          terminal_eligible: false,
        },
        hits: expect.arrayContaining([
          expect.objectContaining({
            filePath:
              "docs/game-mechanics/minecraft-command-playbook-v1.md",
            line: 78,
            text: expect.stringContaining(
              "effect give @s minecraft:glowing 10 0 true",
            ),
          }),
        ]),
        evidence_observations: expect.arrayContaining([
          expect.objectContaining({
            source_id:
              "docs/game-mechanics/minecraft-command-playbook-v1.md:78",
            lineStart: 78,
            lineEnd: 78,
            content_role: "evidence_not_assistant_answer",
          }),
        ]),
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
  });

  it("retrieves the exact-box rollback syntax from a title-free build goal", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query:
          "Before building an exact wall, how do I capture only its exact rollback footprint?",
        mechanics_collection_ids: ["mechanics.minecraft.commands.v1"],
        adapter_profile_id: "game.minecraft.readonly.v1",
        max_hits: 6,
      },
      turnId: "ask:test:gateway-docs-mechanics-exact-checkpoint",
      iteration: 4,
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        mechanics_scope: {
          content_role: "mechanics_reference_not_live_observation",
          assistant_answer: false,
          terminal_eligible: false,
        },
        evidence_passages: expect.arrayContaining([
          expect.objectContaining({
            path:
              "docs/game-mechanics/minecraft-command-playbook-v1.md",
            text_excerpt: expect.stringContaining(
              "helixgame checkpoint capture_box agency_build",
            ),
            citation_ref: expect.stringContaining(
              "workspace://docs/game-mechanics/minecraft-command-playbook-v1.md#line=",
            ),
          }),
        ]),
        evidence_observations: expect.arrayContaining([
          expect.objectContaining({
            content_role: "evidence_not_assistant_answer",
          }),
        ]),
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
  });

  it("fails closed when a mechanics collection does not match the named adapter profile", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "how does reachability work",
        mechanics_collection_ids: ["mechanics.synthetic_game.fixture.v1"],
        adapter_profile_id: "game.minecraft.readonly.v1",
      },
      turnId: "ask:test:gateway-docs-mechanics-cross-profile",
      iteration: 4,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "environment_mechanics_collection_unknown",
      gateway_admission: {
        admission_status: "blocked",
      },
      observation: {
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
  });

  it("finds the NHM2 current status whitepaper from a multi-word docs query", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "NHM2 white paper",
        paths: ["docs/research"],
        max_hits: 5,
      },
      turnId: "ask:test:gateway-docs-search-nhm2-whitepaper",
      iteration: 4,
    });

    const observation = result.observation as {
      hits?: Array<{ filePath?: string }>;
      document_candidates?: Array<{
        path?: string;
        matched_terms?: string[];
        doc_class?: string;
        bundle_kind?: string;
        canonical?: boolean;
        retrieval_status?: string;
        retrieval_admission_reason?: string;
        topic_id?: string;
        authority_rank?: number;
        sidecars?: string[];
        tool_hints?: Record<string, unknown>;
      }>;
      retrieval_policy?: {
        requested_scope?: string;
        suppressed_document_count?: number;
        suppressed_candidates?: Array<{
          path?: string;
          retrieval_status?: string;
          reason?: string;
          superseded_by?: string;
        }>;
      };
      unique_document_count?: number;
      terms?: string[];
    };
    const hits = observation.hits ?? [];
    const candidates = observation.document_candidates ?? [];
    expect(result.ok).toBe(true);
    expect(observation.terms).toContain("whitepaper");
    expect(
      (result.observation as { hit_count?: number }).hit_count,
    ).toBeGreaterThan(0);
    expect(
      hits.some(
        (hit) =>
          hit.filePath === "docs/research/nhm2-current-status-whitepaper.md",
      ),
    ).toBe(true);
    expect(observation.unique_document_count).toBeGreaterThan(0);
    expect(candidates[0]?.path).toBe(
      "docs/research/nhm2-current-status-whitepaper.md",
    );
    expect(candidates[0]?.matched_terms).toEqual(
      expect.arrayContaining(["nhm2", "whitepaper"]),
    );
    expect(candidates[0]).toMatchObject({
      doc_class: "canonical-research",
      bundle_kind: "equation-action-whitepaper",
      canonical: true,
      retrieval_status: "primary",
      retrieval_admission_reason: "default_primary",
      topic_id: "nhm2",
      authority_rank: 100,
      sidecars: [
        "docs/research/nhm2-current-status-whitepaper.equation-actions.json",
        "docs/research/nhm2-current-status-whitepaper.equation-actions.source.json",
      ],
      tool_hints: {
        calculatorReady: true,
        contentAuthority: "bounded_docs_observation_required",
      },
    });
    expect(observation.retrieval_policy).toMatchObject({
      requested_scope: "default",
    });
    expect(observation.retrieval_policy?.suppressed_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "docs/research/nhm2-current-status-whitepaper-2026-04-03.md",
          retrieval_status: "archive",
          reason: "archive_not_requested",
          superseded_by: "docs/research/nhm2-current-status-whitepaper.md",
        }),
      ]),
    );
  });

  it("retrieves one exact archived NHM2 paper without admitting sibling archives", async () => {
    const archivedPath =
      "docs/research/nhm2-current-status-whitepaper-2026-04-03.md";
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "NHM2 current status whitepaper 2026 04 03",
        paths: [archivedPath],
        max_hits: 5,
      },
      turnId: "ask:test:gateway-docs-search-exact-archived-nhm2-whitepaper",
      iteration: 4,
    });

    const observation = result.observation as {
      document_candidates?: Array<{
        path?: string;
        retrieval_status?: string;
        retrieval_admission_reason?: string;
        superseded_by?: string;
      }>;
      retrieval_policy?: {
        requested_scope?: string;
        admitted_document_count?: number;
        suppressed_document_count?: number;
      };
    };
    expect(result.ok).toBe(true);
    expect(observation.document_candidates?.[0]).toMatchObject({
      path: archivedPath,
      retrieval_status: "archive",
      retrieval_admission_reason: "exact_path_requested",
      superseded_by: "docs/research/nhm2-current-status-whitepaper.md",
    });
    expect(observation.retrieval_policy).toMatchObject({
      requested_scope: "default",
      admitted_document_count: 1,
      suppressed_document_count: 0,
    });
  });

  it("admits NHM2 archive generations only through an explicit archive scope", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "Compare historical NHM2 current status versions",
        paths: ["docs/research"],
        retrieval_scope: "archive_only",
        max_hits: 8,
      },
      turnId: "ask:test:gateway-docs-search-nhm2-archive-scope",
      iteration: 4,
    });

    const observation = result.observation as {
      document_candidates?: Array<{ retrieval_status?: string }>;
      retrieval_policy?: { requested_scope?: string };
    };
    expect(result.ok).toBe(true);
    expect(observation.retrieval_policy?.requested_scope).toBe("archive_only");
    expect(observation.document_candidates?.length).toBeGreaterThan(0);
    expect(
      observation.document_candidates?.every(
        (candidate) => candidate.retrieval_status === "archive",
      ),
    ).toBe(true);
  });

  it("returns every exact docs occurrence with its enclosing sentence and nearest heading", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "alpha = 0.7 alpha = 0.995",
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        exact_terms: ["alpha = 0.7", "alpha = 0.995"],
        max_hits: 40,
      },
      turnId: "ask:test:gateway-docs-exact-alpha-locators",
      iteration: 4,
    });

    const observation = result.observation as {
      exact_terms?: string[];
      exact_location_match_count?: number;
      exact_location_matches?: Array<{
        path?: string;
        term?: string;
        line?: number;
        heading?: string | null;
        sentence?: string;
      }>;
    };
    const matches = observation.exact_location_matches ?? [];
    expect(result.ok).toBe(true);
    expect(observation.exact_terms).toEqual(["alpha = 0.7", "alpha = 0.995"]);
    expect(observation.exact_location_match_count).toBe(matches.length);
    expect(matches).toHaveLength(3);
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "docs/research/nhm2-current-status-whitepaper.md",
          term: "alpha = 0.7",
          line: 5,
          heading: "Abstract",
          sentence: expect.stringContaining("`alpha = 0.7`"),
        }),
        expect.objectContaining({
          path: "docs/research/nhm2-current-status-whitepaper.md",
          term: "alpha = 0.995",
          line: 1053,
          heading: "6.7 Twin Paradox trip clocking interpretation",
          sentence: expect.stringContaining("For `alpha = 0.995`"),
        }),
      ]),
    );
    expect(
      matches.every(
        (match) => Boolean(match.heading) && Boolean(match.sentence),
      ),
    ).toBe(true);
  });

  it("materializes a grounded zero-result exact docs observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "alpha = 0.123456",
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        exact_terms: ["alpha = 0.123456"],
        max_hits: 40,
      },
      turnId: "ask:test:gateway-docs-zero-exact-alpha-locator",
      iteration: 4,
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        schema: "helix.docs_search_observation.v1",
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        exact_terms: ["alpha = 0.123456"],
        exact_location_matches: [],
        exact_location_match_count: 0,
        active_document_observation: expect.objectContaining({
          path: "docs/research/nhm2-current-status-whitepaper.md",
        }),
      },
    });
  });

  it("materializes the complete named section with original line metadata", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "6.7 Twin Paradox trip clocking interpretation",
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        section_heading: "6.7 Twin Paradox trip clocking interpretation",
        section_contains_terms: ["alpha"],
        max_hits: 40,
      },
      turnId: "ask:test:gateway-docs-named-section",
      iteration: 4,
    });

    const section = (result.observation as any).section_observation;
    expect(result.ok).toBe(true);
    expect(section).toMatchObject({
      schema: "helix.docs_section_observation.v1",
      path: "docs/research/nhm2-current-status-whitepaper.md",
      matched_heading: "6.7 Twin Paradox trip clocking interpretation",
      heading_line: 999,
      section_start_line: 999,
      section_end_line: 1074,
      contains_terms: ["alpha"],
      truncated: false,
    });
    expect(section.section_excerpt).toContain(
      "For `alpha = 0.995`, this gives about `0.099875`.",
    );
    expect(section.section_lines).toEqual(
      expect.arrayContaining([
        { line: 1053, text: expect.stringContaining("For `alpha = 0.995`") },
      ]),
    );
    expect(section.contains_matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          term: "alpha",
          line: 1053,
          sentence: "For `alpha = 0.995`, this gives about `0.099875`.",
        }),
      ]),
    );
  });

  it("keeps case-sensitive section terms and their line matches separate", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "6.7 Twin Paradox trip clocking interpretation",
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        section_heading: "6.7 Twin Paradox trip clocking interpretation",
        section_contains_terms: ["alpha", "Alpha"],
      },
      turnId: "ask:test:gateway-docs-case-sensitive-section-terms",
      iteration: 4,
    });

    const section = (result.observation as any).section_observation;
    expect(section.contains_terms).toEqual(["alpha", "Alpha"]);
    expect(
      section.contains_matches
        .filter((entry: any) => entry.term === "alpha")
        .map((entry: any) => entry.line),
    ).toEqual([1007, 1012, 1021, 1050, 1053]);
    expect(
      section.contains_matches
        .filter((entry: any) => entry.term === "Alpha")
        .map((entry: any) => entry.line),
    ).toEqual([1024, 1061, 1073]);
  });

  it("materializes a typed not-found lookup for an absent named section", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "99.9 Deliberately Missing Section",
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        section_heading: "99.9 Deliberately Missing Section",
        section_contains_terms: ["alpha"],
      },
      turnId: "ask:test:gateway-docs-missing-named-section",
      iteration: 4,
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        section_observation: null,
        section_lookup: {
          schema: "helix.docs_section_lookup.v1",
          path: "docs/research/nhm2-current-status-whitepaper.md",
          requested_heading: "99.9 Deliberately Missing Section",
          heading_found: false,
          status: "not_found",
          contains_terms: ["alpha"],
        },
      },
    });
  });

  it("returns the exact lowercase alpha line from section 6.8", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "6.8 Profile-scoped trip clocking index",
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        section_heading: "6.8 Profile-scoped trip clocking index",
        section_contains_terms: ["alpha"],
        section_match_unit: "line",
      },
      turnId: "ask:test:gateway-docs-section-6p8-alpha",
      iteration: 4,
    });

    expect((result.observation as any).section_observation).toMatchObject({
      matched_heading: "6.8 Profile-scoped trip clocking index",
      section_start_line: 1075,
      section_end_line: 1091,
      contains_terms: ["alpha"],
      match_unit: "line",
      contains_match_count: 3,
      contains_matches: [
        expect.objectContaining({ term: "alpha", line: 1087 }),
        expect.objectContaining({ term: "alpha", line: 1088 }),
        expect.objectContaining({ term: "alpha", line: 1090 }),
      ],
      truncated: false,
    });
  });

  it("materializes two independently bounded section observations", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query:
          "6.7 Twin Paradox trip clocking interpretation 6.8 Profile-scoped trip clocking index",
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        section_headings: [
          "6.7 Twin Paradox trip clocking interpretation",
          "6.8 Profile-scoped trip clocking index",
        ],
        section_contains_terms: ["alpha"],
        section_match_unit: "line",
      },
      turnId: "ask:test:gateway-docs-two-sections",
      iteration: 4,
    });

    const observation = result.observation as any;
    expect(observation.section_lookups).toEqual([
      expect.objectContaining({
        requested_heading: "6.7 Twin Paradox trip clocking interpretation",
        status: "found",
      }),
      expect.objectContaining({
        requested_heading: "6.8 Profile-scoped trip clocking index",
        status: "found",
      }),
    ]);
    expect(observation.section_observations).toEqual([
      expect.objectContaining({
        matched_heading: "6.7 Twin Paradox trip clocking interpretation",
        section_start_line: 999,
        section_end_line: 1074,
        contains_match_count: 5,
        truncated: false,
      }),
      expect.objectContaining({
        matched_heading: "6.8 Profile-scoped trip clocking index",
        section_start_line: 1075,
        section_end_line: 1091,
        contains_match_count: 3,
        truncated: false,
      }),
    ]);
  });

  it("materializes four independent section lookups with mixed found states", async () => {
    const headings = [
      "6.7 Twin Paradox trip clocking interpretation",
      "6.8 Profile-scoped trip clocking index",
      "98.8 Missing Section A",
      "99.9 Missing Section B",
    ];
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: headings.join(" "),
        paths: ["docs/research/nhm2-current-status-whitepaper.md"],
        section_headings: headings,
        section_contains_terms: ["alpha"],
        section_match_unit: "line",
      },
      turnId: "ask:test:gateway-docs-four-sections",
      iteration: 4,
    });

    const observation = result.observation as any;
    expect(
      observation.section_lookups.map((entry: any) => [
        entry.requested_heading,
        entry.status,
      ]),
    ).toEqual([
      [headings[0], "found"],
      [headings[1], "found"],
      [headings[2], "not_found"],
      [headings[3], "not_found"],
    ]);
    expect(
      observation.section_observations.map((entry: any) => [
        entry.matched_heading,
        entry.contains_match_count,
      ]),
    ).toEqual([
      [headings[0], 5],
      [headings[1], 3],
    ]);
  });

  it("reports unique docs candidates separately from repeated line hits", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "halobank paper definition congruence plan",
        paths: ["docs/architecture"],
        max_hits: 5,
      },
      turnId: "ask:test:gateway-docs-search-unique-candidates",
      iteration: 4,
    });

    const observation = result.observation as {
      hit_count?: number;
      document_candidates?: Array<{ path?: string; line_hit_count?: number }>;
      unique_document_count?: number;
    };
    expect(result.ok).toBe(true);
    expect(observation.hit_count).toBeGreaterThan(1);
    expect(observation.unique_document_count).toBeGreaterThan(0);
    expect(observation.document_candidates?.[0]).toMatchObject({
      path: "docs/architecture/halobank-paper-definition-congruence-plan.md",
    });
    expect(
      observation.document_candidates?.[0]?.line_hit_count,
    ).toBeGreaterThan(0);
  });

  it("ranks markdown documents ahead of sidecar docs search matches", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "nhm2 current status whitepaper equation actions",
        paths: ["docs/research"],
        max_hits: 20,
      },
      turnId: "ask:test:gateway-docs-search-sidecar-ranking",
      iteration: 4,
    });

    const candidates =
      (
        result.observation as {
          document_candidates?: Array<{ path?: string }>;
        }
      ).document_candidates ?? [];
    expect(result.ok).toBe(true);
    expect(candidates[0]?.path).toBe(
      "docs/research/nhm2-current-status-whitepaper.md",
    );
    const sidecarIndex = candidates.findIndex((candidate) =>
      candidate.path?.endsWith(".equation-actions.json"),
    );
    expect(sidecarIndex === -1 || sidecarIndex > 0).toBe(true);
  });

  it("falls back to bounded Node docs search when ripgrep is unavailable", async () => {
    process.env.RG_BIN = "__helix_missing_rg_binary__";
    process.env.PATH = "";
    process.env.Path = "";

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {
        query: "Helix Ask remains the grounded reasoning surface",
        paths: ["docs"],
        max_hits: 3,
      },
      turnId: "ask:test:gateway-docs-search-node-fallback",
      iteration: 4,
    });

    expect(result).toMatchObject({
      ok: true,
      error: undefined,
      observation_packet: {
        status: "succeeded",
      },
      observation: {
        schema: "helix.docs_search_observation.v1",
        query: "Helix Ask remains the grounded reasoning surface",
        status: "succeeded",
        search_backend: "node_fallback",
        search_backend_bin: null,
        search_backend_reason: "ripgrep_not_found",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(
      (result.observation as { hit_count?: number }).hit_count,
    ).toBeGreaterThan(0);
  });

  it("blocks missing docs.search query as a non-terminal observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      capabilityId: DOCS_SEARCH_CAPABILITY,
      arguments: {},
      turnId: "ask:test:gateway-docs-search-blocked",
    });

    expect(result).toMatchObject({
      ok: false,
      error: "missing_query",
      gateway_admission: {
        requested_capability: DOCS_SEARCH_CAPABILITY,
        admission_status: "blocked",
        blocked_reason: "missing_query",
      },
      observation_packet: {
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("calls internet-search.search_web as read-only web evidence, not an answer", async () => {
    process.env.TAVILY_API_KEY = "test-tavily-key";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "Quantum inequalities constrain warp metrics",
            url: "https://example.com/qei-warp",
            content:
              "Quantum inequality margins are diagnostic evidence, not physical validation.",
            published_date: "2026-06-01",
          },
        ],
      }),
    })) as typeof fetch;

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: INTERNET_SEARCH_CAPABILITY,
      arguments: {
        query: "QEI warp drive constraints",
        providers: ["tavily"],
        limit: 1,
      },
      turnId: "ask:test:gateway-internet-search",
      iteration: 5,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: INTERNET_SEARCH_CAPABILITY,
      gateway_admission: {
        requested_capability: INTERNET_SEARCH_CAPABILITY,
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        capability_key: INTERNET_SEARCH_CAPABILITY,
        panel_id: "internet-search",
        action: "search_web",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.internet_search_observation.v1",
        capability_key: INTERNET_SEARCH_CAPABILITY,
        query: "QEI warp drive constraints",
        providers_considered: ["tavily"],
        providers_called: ["tavily"],
        selected_for_answer: true,
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    const observation = result.observation as {
      results?: Array<{ title?: string; url?: string }>;
      evidence_refs?: Array<{ provider?: string; url?: string }>;
    };
    expect(observation.results?.[0]).toMatchObject({
      title: "Quantum inequalities constrain warp metrics",
      url: "https://example.com/qei-warp",
    });
    expect(observation.evidence_refs?.[0]).toMatchObject({
      provider: "tavily",
      url: "https://example.com/qei-warp",
    });
  });

  it("accepts internet.search as an explicit alias for the canonical internet gateway capability", async () => {
    process.env.TAVILY_API_KEY = "test-tavily-key";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "Current QEI discussion",
            url: "https://example.com/current-qei",
            content: "Current web source about QEI margins.",
          },
        ],
      }),
    })) as typeof fetch;

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "internet.search",
      arguments: {
        query: "current QEI warp constraints",
        providers: ["tavily"],
        limit: 1,
      },
      turnId: "ask:test:gateway-internet-search-alias",
      iteration: 5,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: INTERNET_SEARCH_CAPABILITY,
      observation: {
        schema: "helix.internet_search_observation.v1",
        capability_key: INTERNET_SEARCH_CAPABILITY,
        selected_for_answer: true,
      },
    });
  });

  it("calls scholarly-research.lookup_papers as read-only paper evidence, not an answer", async () => {
    const calledUrls: string[] = [];
    globalThis.fetch = vi.fn(async (url) => {
      const urlText = String(url);
      calledUrls.push(urlText);
      expect(urlText).toContain("export.arxiv.org/api/query");
      return {
        ok: true,
        status: 200,
        text: async () =>
          [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<feed xmlns="http://www.w3.org/2005/Atom">',
            "<entry>",
            "<id>https://arxiv.org/abs/2606.00001</id>",
            "<title>Quantum inequalities for warp constraints</title>",
            "<summary>Bounded abstract about quantum inequality margins and warp metrics.</summary>",
            "<published>2026-06-01T00:00:00Z</published>",
            "<author><name>A. Researcher</name></author>",
            "</entry>",
            "</feed>",
          ].join(""),
      };
    }) as typeof fetch;

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
      arguments: {
        query: "quantum inequalities warp constraints",
        providers: ["arxiv"],
        limit: 1,
      },
      turnId: "ask:test:gateway-scholarly-search",
      iteration: 6,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
      gateway_admission: {
        requested_capability: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        capability_key: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
        panel_id: "scholarly-research",
        action: "lookup_papers",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.scholarly_research_observation.v1",
        capability_key: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
        query: "quantum inequalities warp constraints",
        providers_considered: ["arxiv"],
        providers_called: ["arxiv"],
        provider_record_count: 1,
        unique_paper_count: 1,
        deduplication: {
          provider_record_count: 1,
          unique_paper_count: 1,
          duplicate_record_count: 0,
        },
        evidence_state: "lookup_usable",
        next_affordances: [],
        selected_for_answer: true,
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    const observation = result.observation as {
      papers?: Array<{
        title?: string;
        abstract?: string;
        identifiers?: { arxiv_id?: string };
      }>;
      evidence_refs?: Array<{ provider?: string; url?: string }>;
    };
    expect(observation.papers?.[0]).toMatchObject({
      title: "Quantum inequalities for warp constraints",
      identifiers: { arxiv_id: "2606.00001" },
    });
    expect(observation.papers?.[0]?.abstract).toContain(
      "quantum inequality margins",
    );
    expect(observation.evidence_refs?.[0]).toMatchObject({
      provider: "arxiv",
      url: "https://arxiv.org/abs/2606.00001",
    });
    expect(calledUrls).toHaveLength(1);
    expect(
      calledUrls.some((url) =>
        /internet-search|search_web|tavily|serpapi|google/i.test(url),
      ),
    ).toBe(false);
  });

  it("marks weak scholarly lookup results as recovery evidence instead of selected answer evidence", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00009</id>",
          "<title>SChuBERT: Scholarly Document Chunks with BERT-encoding boost Citation Count Prediction</title>",
          "<summary>This paper studies scholarly document quality and citation prediction with BERT.</summary>",
          "<published>2026-06-01T00:00:00Z</published>",
          "<author><name>A. Bibliometrics Researcher</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
      arguments: {
        query: "weyl curvature",
        providers: ["arxiv"],
        limit: 1,
      },
      turnId: "ask:test:gateway-scholarly-weak-lookup",
      iteration: 6,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
      observation_packet: {
        capability_key: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
        action: "lookup_papers",
        status: "failed",
        state_delta: {
          evidence_state: "lookup_weak_match",
          next_affordances: expect.arrayContaining([
            expect.objectContaining({
              capability: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
              reason: "lookup_weak_match",
            }),
          ]),
          scholarly_lookup_recovery_affordance: expect.objectContaining({
            schema: "helix.scholarly_lookup_recovery_affordance.v1",
            reason: "lookup_weak_match",
          }),
        },
        terminal_eligible: false,
        post_tool_model_step_required: true,
      },
      observation: {
        schema: "helix.scholarly_research_observation.v1",
        query: "weyl curvature",
        evidence_state: "lookup_weak_match",
        selected_for_answer: false,
        missing_requirements: ["lookup_weak_match"],
        lookup_relevance_gate: {
          schema: "helix.scholarly_lookup_relevance_gate.v1",
          status: "blocked",
          code: "lookup_weak_match",
        },
        scholarly_lookup_recovery_affordance: {
          schema: "helix.scholarly_lookup_recovery_affordance.v1",
          reason: "lookup_weak_match",
          recommended_next_capability: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
        },
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      error: "lookup_weak_match",
    });
    const observation = result.observation as {
      next_affordances?: Array<{
        capability?: string;
        query?: string;
        reason?: string;
      }>;
      scholarly_lookup_recovery_affordance?: { recovery_queries?: string[] };
    };
    expect(observation.next_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
          reason: "lookup_weak_match",
          query: expect.stringMatching(/Weyl tensor|weyl curvature/i),
        }),
      ]),
    );
    expect(
      observation.scholarly_lookup_recovery_affordance?.recovery_queries,
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Weyl tensor conformal curvature/i),
      ]),
    );
  });

  it("returns missing scholarly provider evidence as an observation, not proof", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "",
    })) as typeof fetch;

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
      arguments: {
        query: "quantum inequalities warp drive",
        providers: ["arxiv"],
        limit: 1,
      },
      turnId: "ask:test:gateway-scholarly-search-rate-limited",
      iteration: 7,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
      gateway_admission: {
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        capability_key: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
        panel_id: "scholarly-research",
        action: "lookup_papers",
        status: "failed",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
        missing_requirements: [
          expect.objectContaining({
            code: "arxiv_http_429",
            repair_action: "repair",
          }),
          expect.objectContaining({
            code: "no_scholarly_results_returned",
            repair_action: "repair",
          }),
        ],
      },
      observation: {
        schema: "helix.scholarly_research_observation.v1",
        capability_key: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
        query: "quantum inequalities warp drive",
        providers_considered: ["arxiv"],
        providers_called: ["arxiv"],
        papers: [],
        evidence_state: "lookup_blocked",
        next_affordances: expect.arrayContaining([
          expect.objectContaining({
            capability: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
            reason: "lookup_blocked",
          }),
        ]),
        missing_requirements: [
          "arxiv_http_429",
          "no_scholarly_results_returned",
        ],
        selected_for_answer: false,
        status: "failed",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      error: "arxiv_http_429",
    });
  });

  it("fetches accessible scholarly full text as bounded non-terminal text evidence", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "text/html" : null,
      },
      arrayBuffer: async () =>
        new TextEncoder().encode(
          [
            "<html><body>",
            "<h1>Tokamak beta evidence</h1>",
            "<p>Table 1 reports electron density n = 1.0e20 m^-3 [12] and electron temperature Te = 5000 eV [12].</p>",
            "<p>The toroidal magnetic field B = 5 T is listed in the experimental setup [12].</p>",
            "</body></html>",
          ].join(" "),
        ).buffer,
    })) as typeof fetch;

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      arguments: {
        query: "tokamak beta paper",
        source_url: "https://example.test/tokamak.html",
      },
      turnId: "ask:test:gateway-scholarly-full-text",
      iteration: 8,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      observation_packet: {
        capability_key: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        panel_id: "scholarly-research",
        action: "fetch_full_text",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.scholarly_full_text_observation.v1",
        capability_key: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        source_kind: "html",
        pages_parsed: 1,
        evidence_state: "full_text_usable",
        next_affordances: [],
        selected_for_answer: true,
        context_policy: "compact_context_pack_only",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    const observation = result.observation as {
      selected_chunks?: Array<{ text_excerpt?: string; citation_ref?: string }>;
    };
    expect(observation.selected_chunks?.[0]?.text_excerpt).toContain(
      "electron density",
    );
    expect(observation.selected_chunks?.[0]?.citation_ref).toBe("paper#page=1");
  });

  it("derives a canonical PDF URL from a bare old-style arXiv paper result id", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "text/html" : null,
        },
        arrayBuffer: async () =>
          new TextEncoder().encode(
            [
              "<html><body>",
              "<p>The magnetar analysis reports a bounded field-strength estimate and its observational assumptions.</p>",
              "</body></html>",
            ].join(" "),
          ).buffer,
      };
    }) as typeof fetch;

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      arguments: {
        query: "magnetar paper",
        paper_result_id: "astro-ph/0503030v1",
      },
      turnId: "ask:test:gateway-scholarly-old-style-arxiv-id",
      iteration: 8,
    });

    expect(requestedUrls).toContain(
      "https://arxiv.org/pdf/astro-ph/0503030v1.pdf",
    );
    expect(result).toMatchObject({
      ok: true,
      capability_id: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      observation: {
        source_url: "https://arxiv.org/pdf/astro-ph/0503030v1.pdf",
        evidence_state: "full_text_usable",
        selected_for_answer: true,
      },
    });
  });

  it("tries later scholarly full-text candidates when the first selected paper is blocked", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("blocked.example")) {
        return {
          ok: false,
          status: 403,
          headers: { get: () => "text/plain" },
          arrayBuffer: async () => new TextEncoder().encode("blocked").buffer,
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "text/html" : null,
        },
        arrayBuffer: async () =>
          new TextEncoder().encode(
            [
              "<html><body>",
              "<p>The Casimir effect between conducting plates has pressure P = - pi^2 hbar c / (240 a^4).</p>",
              "<p>The force between conducting plates is F = P A for plate area A.</p>",
              "</body></html>",
            ].join(" "),
          ).buffer,
      };
    }) as typeof fetch;

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      arguments: {
        query: "Casimir effect between conducting plates",
        paper_result_id: "openalex:blocked",
        paper: {
          result_id: "openalex:blocked",
          title: "Blocked publisher Casimir record",
          authors: [{ name: "O. Blocked" }],
          year: 2026,
          source_providers: ["openalex"],
          identifiers: {
            doi: "10.5555/blocked",
            full_text_url: "https://blocked.example/casimir",
          },
          confidence: "medium",
          is_open_access: true,
          evidence_refs: [],
        },
        papers: [
          {
            result_id: "openalex:blocked",
            title: "Blocked publisher Casimir record",
            authors: [{ name: "O. Blocked" }],
            year: 2026,
            source_providers: ["openalex"],
            identifiers: {
              doi: "10.5555/blocked",
              full_text_url: "https://blocked.example/casimir",
            },
            confidence: "medium",
            is_open_access: true,
            evidence_refs: [],
          },
          {
            result_id: "arxiv:2606.00011v1",
            title: "Accessible Casimir plate science",
            authors: [{ name: "A. Accessible" }],
            year: 2026,
            source_providers: ["arxiv"],
            identifiers: {
              arxiv_id: "2606.00011v1",
              url: "https://arxiv.org/abs/2606.00011v1",
            },
            confidence: "high",
            is_open_access: true,
            evidence_refs: [],
          },
        ],
      },
      turnId: "ask:test:gateway-scholarly-full-text-retry-candidates",
      iteration: 8,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      observation_packet: {
        capability_key: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        action: "fetch_full_text",
        status: "succeeded",
      },
      observation: {
        schema: "helix.scholarly_full_text_observation.v1",
        paper_result_id: "arxiv:2606.00011v1",
        source_url: "https://arxiv.org/pdf/2606.00011v1.pdf",
        source_kind: "html",
        evidence_state: "full_text_usable",
        selected_for_answer: true,
        missing_requirements: expect.arrayContaining(["full_text_http_403"]),
        full_text_fetch_attempts: [
          expect.objectContaining({
            paper_result_id: "openalex:blocked",
            evidence_state: "full_text_unavailable",
            missing_requirements: expect.arrayContaining([
              "full_text_http_403",
            ]),
          }),
          expect.objectContaining({
            paper_result_id: "arxiv:2606.00011v1",
            evidence_state: "full_text_usable",
          }),
        ],
      },
    });
  });

  it("runs open-access recovery lookup when the only scholarly full-text candidate is blocked", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("blocked.example")) {
        return {
          ok: false,
          status: 403,
          headers: { get: () => "text/plain" },
          arrayBuffer: async () => new TextEncoder().encode("blocked").buffer,
        };
      }
      if (url.includes("export.arxiv.org")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            [
              '<?xml version="1.0" encoding="UTF-8"?>',
              '<feed xmlns="http://www.w3.org/2005/Atom">',
              "<entry>",
              "<id>https://arxiv.org/abs/2606.00012</id>",
              "<title>Casimir effect parallel conducting plates open access evidence</title>",
              "<summary>This paper studies the Casimir effect between parallel conducting plates.</summary>",
              "<published>2026-06-12T00:00:00Z</published>",
              "<author><name>A. Recovery</name></author>",
              "</entry>",
              "</feed>",
            ].join(""),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "text/html" : null,
        },
        arrayBuffer: async () =>
          new TextEncoder().encode(
            [
              "<html><body>",
              "<p>The Casimir effect between parallel conducting plates has pressure P = - pi^2 hbar c / (240 a^4).</p>",
              "<p>The result is a bounded open-access recovery page for equation extraction.</p>",
              "</body></html>",
            ].join(" "),
          ).buffer,
      };
    }) as typeof fetch;

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      arguments: {
        query: "Casimir effect between conducting plates",
        paper_result_id: "openalex:blocked",
        paper: {
          result_id: "openalex:blocked",
          title: "Blocked publisher Casimir record",
          authors: [{ name: "O. Blocked" }],
          year: 2026,
          source_providers: ["openalex"],
          identifiers: {
            doi: "10.5555/blocked",
            full_text_url: "https://blocked.example/casimir",
          },
          confidence: "medium",
          is_open_access: true,
          evidence_refs: [],
        },
      },
      turnId: "ask:test:gateway-scholarly-full-text-open-access-recovery",
      iteration: 8,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      observation_packet: {
        capability_key: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        action: "fetch_full_text",
        status: "succeeded",
      },
      observation: {
        schema: "helix.scholarly_full_text_observation.v1",
        paper_result_id: expect.stringMatching(/^arxiv:/),
        source_url: "https://arxiv.org/pdf/2606.00012.pdf",
        evidence_state: "full_text_usable",
        selected_for_answer: true,
        full_text_fetch_attempts: [
          expect.objectContaining({
            paper_result_id: "openalex:blocked",
            evidence_state: "full_text_unavailable",
            missing_requirements: expect.arrayContaining([
              "full_text_http_403",
            ]),
          }),
          expect.objectContaining({
            paper_result_id: expect.stringMatching(/^arxiv:/),
            evidence_state: "full_text_usable",
          }),
        ],
      },
    });
  });

  it("runs open-access recovery lookup when an explicit scholarly source URL is blocked", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("blocked.example")) {
        return {
          ok: false,
          status: 403,
          headers: { get: () => "text/plain" },
          arrayBuffer: async () => new TextEncoder().encode("blocked").buffer,
        };
      }
      if (url.includes("export.arxiv.org")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            [
              '<?xml version="1.0" encoding="UTF-8"?>',
              '<feed xmlns="http://www.w3.org/2005/Atom">',
              "<entry>",
              "<id>https://arxiv.org/abs/2606.00013</id>",
              "<title>Casimir effect parallel plates source URL recovery</title>",
              "<summary>This paper studies the Casimir effect between parallel conducting plates.</summary>",
              "<published>2026-06-13T00:00:00Z</published>",
              "<author><name>A. Source Recovery</name></author>",
              "</entry>",
              "</feed>",
            ].join(""),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "text/html" : null,
        },
        arrayBuffer: async () =>
          new TextEncoder().encode(
            [
              "<html><body>",
              "<p>The Casimir pressure for parallel conducting plates is P = - pi^2 hbar c / (240 a^4).</p>",
              "<p>This recovery text is enough to become bounded full-text evidence.</p>",
              "</body></html>",
            ].join(" "),
          ).buffer,
      };
    }) as typeof fetch;

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      arguments: {
        query: "Casimir effect between conducting plates",
        source_url: "https://blocked.example/casimir",
      },
      turnId: "ask:test:gateway-scholarly-full-text-source-url-recovery",
      iteration: 8,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      observation: {
        schema: "helix.scholarly_full_text_observation.v1",
        paper_result_id: expect.stringMatching(/^arxiv:/),
        source_url: "https://arxiv.org/pdf/2606.00013.pdf",
        evidence_state: "full_text_usable",
        selected_for_answer: true,
        full_text_fetch_attempts: [
          expect.objectContaining({
            source_url: "https://blocked.example/casimir",
            evidence_state: "full_text_unavailable",
            missing_requirements: expect.arrayContaining([
              "full_text_http_403",
            ]),
          }),
          expect.objectContaining({
            paper_result_id: expect.stringMatching(/^arxiv:/),
            evidence_state: "full_text_usable",
          }),
        ],
      },
    });
  });

  it("classifies low-text page evidence as page-image parse required instead of usable full text", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "text/html" : null,
      },
      arrayBuffer: async () =>
        new TextEncoder().encode("<html><body>Fig. 1</body></html>").buffer,
    })) as typeof fetch;

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      arguments: {
        query: "equation figure page evidence",
        source_url: "https://example.test/scanned.pdf",
      },
      turnId: "ask:test:gateway-scholarly-full-text-image-required",
      iteration: 8,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      observation_packet: {
        capability_key: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        action: "fetch_full_text",
        status: "failed",
        state_delta: {
          evidence_state: "page_image_parse_required",
          next_affordances: expect.arrayContaining([
            expect.objectContaining({
              capability: "visual_analysis.inspect_image_region",
            }),
          ]),
        },
        terminal_eligible: false,
        post_tool_model_step_required: true,
      },
      observation: {
        schema: "helix.scholarly_full_text_observation.v1",
        source_kind: "html",
        evidence_state: "page_image_parse_required",
        selected_for_answer: false,
        missing_requirements: expect.arrayContaining([
          "page_image_parse_required",
        ]),
        visual_candidates: [
          expect.objectContaining({
            page: 1,
            reason: "low_text_pdf_page_needs_visual_or_ocr_pass",
          }),
        ],
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      error: expect.stringMatching(
        /no_relevant_full_text_chunks_selected|page_image_parse_required/,
      ),
    });
    const observation = result.observation as {
      next_affordances?: Array<{
        capability?: string;
        source_ref?: string;
        reason?: string;
      }>;
    };
    expect(observation.next_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "visual_analysis.inspect_image_region",
          reason: "low_text_pdf_page_needs_visual_or_ocr_pass",
          source_ref: expect.stringContaining("/page/1"),
        }),
      ]),
    );
  });

  it("blocks scholarly full-text fetch when the paper identity has no fetchable source", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      arguments: {
        query:
          "Correlation of the L-mode density limit with edge collisionality",
        source_ref:
          "Correlation of the L-mode density limit with edge collisionality",
        variable_source_plan: {
          schema: "helix.variable_source_plan.v1",
          formula_variables: ["n1_m3", "n2_m3", "sigma_m2", "v_m_s"],
          query_terms: [
            "fusion",
            "thermonuclear reaction rate",
            "fusion cross section",
            "sigma v",
          ],
        },
      },
      turnId: "ask:test:gateway-scholarly-full-text-missing-source",
      iteration: 9,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
      error: "fetchable_paper_identity_required",
      observation_packet: {
        capability_key: SCHOLARLY_FULL_TEXT_FETCH_CAPABILITY,
        action: "fetch_full_text",
        status: "blocked",
      },
      observation: {
        schema: "helix.scholarly_full_text_observation.v1",
        status: "blocked",
        blocked_reason: "fetchable_paper_identity_required",
        missing_requirements: ["fetchable_paper_identity_required"],
        scholarly_full_text_recovery_affordance: {
          schema: "helix.scholarly_full_text_recovery_affordance.v1",
          reason: "fetchable_paper_identity_required",
          recommended_next_capability: "scholarly-research.lookup_papers",
          terminal_eligible: false,
          assistant_answer: false,
        },
        selected_for_answer: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(result.observation_packet.state_delta).toMatchObject({
      scholarly_full_text_recovery_affordance: {
        schema: "helix.scholarly_full_text_recovery_affordance.v1",
        reason: "fetchable_paper_identity_required",
      },
    });
    expect(JSON.stringify(result.observation)).toMatch(
      /accessible pdf|full text|sigma v/i,
    );
  });

  it("extracts cited numeric parameters with units and rejects missing variables", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
      arguments: {
        requested_variables: ["n_m3", "T_eV", "B_T"],
        source_ref: "paper:tokamak#page=4",
        paper: {
          title: "Tokamak beta evidence",
          doi: "10.0000/example",
          url: "https://example.test/tokamak",
        },
        variable_source_plan: {
          schema: "helix.variable_source_plan.v1",
          entries: [
            {
              variable: "B_T",
              canonical_quantity: "toroidal magnetic field",
              expected_unit: "T",
              source_classes: ["tokamak operating parameter table"],
              search_terms: [
                "toroidal magnetic field",
                "magnetic field strength",
              ],
              extraction_aliases: [
                "B_T",
                "toroidal magnetic field",
                "magnetic field",
              ],
            },
          ],
          query_terms: ["tokamak plasma beta operating parameter table"],
        },
        text_evidence: [
          "Table 1 reports electron density n = 1.0e20 m^-3 [12].",
          "The electron temperature Te = 5 keV [12].",
          "A field value is discussed without the requested unit.",
        ].join(" "),
      },
      turnId: "ask:test:gateway-scholarly-numeric",
      iteration: 9,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
      observation_packet: {
        capability_key: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
        action: "extract_numeric_parameters",
        status: "failed",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.scholarly_numeric_parameter_observation.v1",
        capability_key: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
        requested_variables: ["n_m3", "T_eV", "B_T"],
        evidence_state: "numeric_evidence_missing",
        next_affordances: [
          expect.objectContaining({
            capability: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
            reason: "numeric_evidence_missing",
            variables: ["B_T"],
          }),
        ],
        missing_variables: ["B_T"],
        scholarly_numeric_recovery_affordance: {
          schema: "helix.scholarly_numeric_recovery_affordance.v1",
          reason: "missing_requested_numeric_variables",
          missing_variables: ["B_T"],
          expected_variables: [
            expect.objectContaining({
              variable: "B_T",
              canonical_quantity: "toroidal magnetic field",
              expected_unit: "T",
            }),
          ],
          expected_source_classes: ["tokamak operating parameter table"],
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
        },
        selected_for_answer: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      error: "missing_requested_numeric_variables",
    });
    const observation = result.observation as {
      parameters?: Array<{
        variable?: string;
        normalized_value?: number;
        normalized_unit?: string;
        evidence_ref?: string;
      }>;
      rejected_candidates?: Array<{ variable?: string; reason?: string }>;
      scholarly_numeric_recovery_affordance?: {
        recovery_queries?: string[];
        variable_source_plan?: Record<string, unknown>;
      };
    };
    expect(observation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variable: "n_m3",
          normalized_value: 1.0e20,
          normalized_unit: "m^-3",
          evidence_ref: expect.stringContaining("scholarly-numeric:"),
        }),
        expect.objectContaining({
          variable: "T_eV",
          normalized_value: 5000,
          normalized_unit: "eV",
        }),
      ]),
    );
    expect(observation.rejected_candidates ?? []).toEqual(expect.any(Array));
    expect(
      observation.scholarly_numeric_recovery_affordance?.recovery_queries,
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/B_T|toroidal magnetic field|cited values/i),
      ]),
    );
    expect(
      observation.scholarly_numeric_recovery_affordance?.variable_source_plan,
    ).toMatchObject({
      schema: "helix.variable_source_plan.v1",
    });
    expect(result.observation_packet.state_delta).toMatchObject({
      evidence_state: "numeric_evidence_missing",
      next_affordances: [
        expect.objectContaining({
          capability: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
          reason: "numeric_evidence_missing",
          variables: ["B_T"],
        }),
      ],
      scholarly_numeric_recovery_affordance: expect.objectContaining({
        schema: "helix.scholarly_numeric_recovery_affordance.v1",
        missing_variables: ["B_T"],
      }),
    });
    expect(result.observation_packet.suggested_next_steps).toEqual(
      expect.arrayContaining(["use_another_tool", "ask_user"]),
    );
  });

  it("extracts alias-matched numeric parameters from table-like scholarly evidence", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
      arguments: {
        requested_variables: ["n_m3", "T_eV", "B_T", "e_charge", "mu0"],
        source_ref: "paper:tokamak#page=7",
        paper: {
          title: "Tokamak parameter table",
          doi: "10.0000/table",
          url: "https://example.test/tokamak-table",
        },
        text_evidence: [
          "Table 2. Experimental parameters from Smith et al. (2024).",
          "| quantity | symbol | value | unit |",
          "| electron density | n_e | 1.2 | 10^20 m^-3 |",
          "| electron temperature | T_e | 4.5 | keV |",
          "| toroidal magnetic field | B_t | 2.1 | T |",
          "| elementary charge | e | 1.602176634 x 10^-19 | C |",
          "| vacuum permeability | mu_0 | 4 pi x 10^-7 | H/m |",
        ].join("\n"),
      },
      turnId: "ask:test:gateway-scholarly-numeric-table",
      iteration: 10,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
      observation_packet: {
        action: "extract_numeric_parameters",
        status: "succeeded",
        state_delta: {
          evidence_state: "numeric_evidence_usable",
        },
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.scholarly_numeric_parameter_observation.v1",
        evidence_state: "numeric_evidence_usable",
        next_affordances: [],
        missing_variables: [],
        selected_for_answer: true,
      },
    });
    const observation = result.observation as {
      parameters?: Array<{
        variable?: string;
        normalized_value?: number;
        normalized_unit?: string;
        source_snippet?: string;
        evidence_ref?: string;
        table?: string | null;
        confidence?: string;
      }>;
    };
    expect(observation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variable: "n_m3",
          normalized_value: 1.2e20,
          normalized_unit: "m^-3",
          evidence_ref: expect.stringContaining("scholarly-numeric:"),
          confidence: "medium",
        }),
        expect.objectContaining({
          variable: "T_eV",
          normalized_value: 4500,
          normalized_unit: "eV",
        }),
        expect.objectContaining({
          variable: "B_T",
          normalized_value: 2.1,
          normalized_unit: "T",
        }),
        expect.objectContaining({
          variable: "e_charge",
          normalized_value: 1.602176634e-19,
          normalized_unit: "C",
        }),
        expect.objectContaining({
          variable: "mu0",
          normalized_value: expect.closeTo(4 * Math.PI * 1e-7, 16),
          normalized_unit: "H/m",
        }),
      ]),
    );
    expect(
      observation.parameters?.every((parameter) =>
        Boolean(
          parameter.source_snippet && parameter.evidence_ref && parameter.table,
        ),
      ),
    ).toBe(true);
  });

  it("does not treat bare B in particle-physics prose as B_T magnetic-field evidence", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
      arguments: {
        requested_variables: ["B_T"],
        source_ref: "paper:b-physics#page=2",
        paper: {
          title: "B meson branching fraction evidence",
          url: "https://example.test/b-physics",
        },
        text_evidence:
          "Table 1 reports B = 2.1 T [8] for a branching-fraction fit label, not a magnetic field.",
      },
      turnId: "ask:test:gateway-scholarly-numeric-bare-b-not-field",
      iteration: 10,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
      observation: {
        requested_variables: ["B_T"],
        parameters: [],
        missing_variables: ["B_T"],
        selected_for_answer: false,
      },
      error: "missing_requested_numeric_variables",
    });
  });

  it("supports exploratory extraction of any cited supported numeric parameters", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
      arguments: {
        extraction_mode: "open_supported_parameters",
        source_ref: "paper:tokamak#page=3",
        paper: {
          title: "Tokamak exploratory operating point",
          url: "https://example.test/tokamak-open",
        },
        text_evidence: [
          "Table 1 reports electron density n_e = 2.0e19 m^-3 [3].",
          "The electron temperature T_e = 1.5 keV [3].",
        ].join(" "),
      },
      turnId: "ask:test:gateway-scholarly-numeric-open-extraction",
      iteration: 10,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
      observation_packet: {
        action: "extract_numeric_parameters",
        status: "succeeded",
      },
      observation: {
        requested_variables: [],
        missing_variables: [],
        extraction_mode: "open_supported_parameters",
        selected_for_answer: true,
      },
    });
    const observation = result.observation as {
      parameters?: Array<{
        variable?: string;
        normalized_value?: number;
        normalized_unit?: string;
      }>;
    };
    expect(observation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variable: "n_m3",
          normalized_value: 2.0e19,
          normalized_unit: "m^-3",
        }),
        expect.objectContaining({
          variable: "T_eV",
          normalized_value: 1500,
          normalized_unit: "eV",
        }),
      ]),
    );
  });

  it("fails closed for uncited, missing-unit, and unsupported numeric candidates", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
      arguments: {
        requested_variables: ["n_m3", "T_eV", "B_T"],
        text_evidence: [
          "The electron density n_e = 8.0e19 cm^-3 [4].",
          "The electron temperature T_e = 3500 [4].",
          "The toroidal magnetic field B_t = 2.7 T was used in the discharge.",
        ].join(" "),
      },
      turnId: "ask:test:gateway-scholarly-numeric-rejections",
      iteration: 11,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
      observation_packet: {
        action: "extract_numeric_parameters",
        status: "failed",
      },
      observation: {
        requested_variables: ["n_m3", "T_eV", "B_T"],
        parameters: [],
        missing_variables: ["n_m3", "T_eV", "B_T"],
        selected_for_answer: false,
        missing_requirements: [
          "text_evidence_required",
          "missing_requested_numeric_variables",
        ],
      },
      error: "text_evidence_required",
    });
  });

  it("reports typed numeric candidate rejection reasons when source evidence is present", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
      arguments: {
        requested_variables: ["n_m3", "T_eV", "B_T"],
        source_ref: "paper:tokamak",
        text_evidence: [
          "Table 3 reports electron density n_e = 8.0e19 cm^-3 [4].",
          "Table 3 reports electron temperature T_e = 3 T [4].",
          "This intervening sentence is deliberately long enough to keep the previous citation outside the bounded source snippet used for the field candidate. ".repeat(
            4,
          ),
          "The toroidal magnetic field B_t = 2.7 T was used in the discharge.",
        ].join(" "),
      },
      turnId: "ask:test:gateway-scholarly-numeric-typed-rejections",
      iteration: 12,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: SCHOLARLY_NUMERIC_PARAMETER_EXTRACT_CAPABILITY,
      observation_packet: {
        action: "extract_numeric_parameters",
        status: "failed",
      },
      observation: {
        requested_variables: ["n_m3", "T_eV", "B_T"],
        missing_variables: ["T_eV", "B_T"],
        selected_for_answer: false,
      },
      error: "missing_requested_numeric_variables",
    });
    const observation = result.observation as {
      parameters?: Array<{
        variable?: string;
        normalized_value?: number;
        normalized_unit?: string;
      }>;
      rejected_candidates?: Array<{
        variable?: string;
        reason?: string;
        text?: string;
      }>;
    };
    expect(observation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variable: "n_m3",
          normalized_value: 8.0e25,
          normalized_unit: "m^-3",
        }),
      ]),
    );
    expect(observation.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variable: "T_eV",
          reason: "unsupported_unit",
        }),
        expect.objectContaining({ variable: "B_T", reason: "uncited_value" }),
      ]),
    );
  });

  it("accepts research-papers.search as an explicit alias for the canonical scholarly gateway capability", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00002</id>",
          "<title>Paper evidence for QEI boundaries</title>",
          "<summary>Bounded abstract about QEI boundary evidence.</summary>",
          "<published>2026-06-02T00:00:00Z</published>",
          "<author><name>B. Researcher</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "research-papers.search",
      arguments: {
        query: "QEI boundary paper evidence",
        providers: ["arxiv"],
        limit: 1,
      },
      turnId: "ask:test:gateway-research-papers-search-alias",
      iteration: 6,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
      observation: {
        schema: "helix.scholarly_research_observation.v1",
        capability_key: SCHOLARLY_RESEARCH_SEARCH_CAPABILITY,
        selected_for_answer: true,
      },
    });
  });

  it("calls civilization-bounds reflection as read-only evidence, not an answer", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "Reflect planetary trade through civilization bounds with material inventory and governance review.",
        include_bridge_context: true,
        include_collaboration_bounds: true,
        include_falsification_hooks: true,
      },
      turnId: "ask:test:gateway-civilization-bounds",
      iteration: 5,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
      gateway_admission: {
        requested_capability: CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      observation_packet: {
        capability_key: CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        panel_id: "civilization-bounds-roadmap",
        action: "reflect_system_bounds",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.civilization_bounds_reflection_observation.v1",
        capability_key: CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        panel_id: "civilization-bounds-roadmap",
        action_id: "reflect_system_bounds",
        status: "succeeded",
        prompt:
          "Reflect planetary trade through civilization bounds with material inventory and governance review.",
        bridge_context_included: true,
        procedural_scaffold_id: "spore_civilization_stage_procedural_scaffold",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        authority: expect.objectContaining({
          assistant_answer: false,
          terminal_eligible: false,
          execution_permission: false,
        }),
      },
      tool_followup_decision: {
        next_action: "continue_reasoning",
        evidence_reentered: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(
      String((result.observation as { roadmap_id?: string }).roadmap_id ?? ""),
    ).toMatch(/^civilization-bounds:/);
    expect(
      (result.observation as { parameter_scope_kinds?: string[] })
        .parameter_scope_kinds,
    ).toEqual(
      expect.arrayContaining([
        "material_base",
        "governance_institutional_capacity",
      ]),
    );
    expect(
      (result.observation as { missing_evidence?: string[] }).missing_evidence,
    ).toContain("source_backed_capacity_measurements");
  });

  it("blocks civilization-bounds reflection without prompt as a missing observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
      arguments: {},
      turnId: "ask:test:gateway-civilization-bounds-blocked",
      iteration: 6,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
      error: "civilization_bounds_prompt_missing",
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "civilization_bounds_prompt_missing",
      },
      observation_packet: {
        status: "blocked",
        missing_requirements: [
          expect.objectContaining({
            code: "civilization_bounds_prompt_missing",
            repair_action: "ask_user",
          }),
        ],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.civilization_bounds_reflection_observation.v1",
        status: "blocked",
        blocked_reason: "civilization_bounds_prompt_missing",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("calls theory-badge reflection as read-only evidence, not an answer", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "Reflect QEI margin and source residual against the theory badge graph.",
        mentioned_symbols: ["QEI", "source residual"],
        mentioned_domains: ["warp metrics", "claim boundaries"],
        build_explanation_plan: true,
        limit: 4,
      },
      turnId: "ask:test:gateway-theory-reflection",
      iteration: 5,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      gateway_admission: {
        requested_capability: THEORY_CONTEXT_REFLECTION_CAPABILITY,
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      observation_packet: {
        capability_key: THEORY_CONTEXT_REFLECTION_CAPABILITY,
        panel_id: "theory-badge-graph",
        action: "reflect_discussion_context",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.theory_context_reflection_observation.v1",
        capability_key: THEORY_CONTEXT_REFLECTION_CAPABILITY,
        panel_id: "theory-badge-graph",
        action_id: "reflect_discussion_context",
        status: "succeeded",
        prompt:
          "Reflect QEI margin and source residual against the theory badge graph.",
        conversation_context_included: false,
        receipt_schema: "helix_theory_context_reflection_tool_receipt/v1",
        reflection_terminal_eligible: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        authority: expect.objectContaining({
          assistant_answer: false,
          terminal_eligible: false,
          deterministic_content_role: "observation_not_assistant_answer",
        }),
      },
      tool_followup_decision: {
        next_action: "continue_reasoning",
        evidence_reentered: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(
      String(
        (result.observation as { reflection_id?: string }).reflection_id ?? "",
      ),
    ).toMatch(/^theory-context-reflection:/);
    expect(
      String((result.observation as { summary?: string }).summary ?? ""),
    ).not.toHaveLength(0);
    expect(
      (result.observation as { claim_boundary_notes?: string[] })
        .claim_boundary_notes?.length ?? 0,
    ).toBeGreaterThan(0);
    expect(
      (result.observation as { recommended_actions_solve?: boolean })
        .recommended_actions_solve,
    ).toBe(false);
  });

  it("includes calculator payload expressions in theory badge reflection observations", async () => {
    const scientificEvidence = buildScientificEvidencePacket({
      cropRegionId: "image_lens_region:test-tokamak-calculator-payloads",
      sourceRefHash: "sha256:test-tokamak-calculator-payloads",
      bboxPx: { x: 0, y: 0, width: 300, height: 80 },
      requestedEquationLabel: "3.1",
      regionLabel: "equation_3.1",
      textCandidate:
        "Tokamak plasma thermal pressure p_Pa = n_m3*T_eV*e_charge and W_th = P_loss*tau_E. (3.1)",
      latexCandidate:
        "p_{Pa}=n_{m3}T_{eV}e,\\quad W_{th}=P_{loss}\\tau_E \\tag{3.1}",
      uncertainty: [],
      extractionStatus: "extracted",
    });
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "What equation from the theory badge graph can be solved in the calculator for tokamak thermal pressure and confinement time?",
        scientific_evidence_packet: scientificEvidence,
        mentioned_symbols: ["p_Pa", "n_m3", "T_eV", "W_th", "P_loss", "tau_E"],
        mentioned_domains: ["tokamak plasma"],
        limit: 8,
      },
      turnId: "ask:test:gateway-theory-reflection-calculator-payloads",
      iteration: 6,
    });
    const observation = result.observation as {
      calculator_payloads?: Array<Record<string, unknown>>;
      calculator_template_payloads?: Array<Record<string, unknown>>;
      calculator_template_admissibility?: Record<string, unknown>;
      claim_boundary_notes?: string[];
      recommended_actions_solve?: boolean;
      terminal_eligible?: boolean;
      assistant_answer?: boolean;
    };

    expect(result.ok).toBe(true);
    expect(observation.calculator_payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          badge_id: "tokamak.plasma.thermal_pressure_proxy",
          payload_id: "tokamak_thermal_pressure_payload",
          expression: "p_Pa = n_m3*T_eV*e_charge",
          target_variable: "p_Pa",
        }),
        expect.objectContaining({
          badge_id: "tokamak.energy.confinement_time_proxy",
          payload_id: "tokamak_confinement_energy_payload",
          expression: "W_th = P_loss*tau_E",
          target_variable: "W_th",
        }),
      ]),
    );
    expect(observation.calculator_template_payloads).toEqual(
      observation.calculator_payloads,
    );
    expect(observation.calculator_template_admissibility).toMatchObject({
      schema: "helix.calculator_template_admissibility.v1",
      status: "template_admissible",
      admitted_template_count: expect.any(Number),
      calculation_ready_count: 0,
      binding_status: "unbound_variables_units_assumptions",
      claim_boundary: "templates_only_not_calculator_solve_authority",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(observation.claim_boundary_notes).toEqual(
      expect.arrayContaining([
        "calculator_template_boundary=admitted calculator payloads are diagnostic templates unless variables, units, assumptions, and source refs are bound.",
        "final_answer_guard=OCR candidates, graph matches, calculator templates, calculation-ready handoffs, and proof/validation must remain separate.",
      ]),
    );
    expect(observation.recommended_actions_solve).toBe(false);
    expect(observation.terminal_eligible).toBe(false);
    expect(observation.assistant_answer).toBe(false);
    expect(result.observation_packet).toMatchObject({
      produced_affordances: expect.arrayContaining([
        expect.objectContaining({
          kind: "calculator_expression_template",
          expression: "p_Pa = n_m3*T_eV*e_charge",
          required_inputs: ["n_m3", "T_eV"],
          source_refs: expect.arrayContaining([
            "tokamak.plasma.thermal_pressure_proxy",
            "tokamak_thermal_pressure_payload",
          ]),
          status: "available",
        }),
        expect.objectContaining({
          kind: "claim_boundary",
          status: "available",
        }),
      ]),
      typed_handoff_contract: expect.objectContaining({
        produced_affordance_kinds: expect.arrayContaining([
          "theory_context",
          "scientific_evidence",
          "calculator_expression_template",
          "claim_boundary",
        ]),
        required_affordance_kinds: [],
      }),
    });
  });

  it("gates Image Lens Bianchi/Weyl evidence away from tokamak calculator payloads", async () => {
    const scientificEvidence = buildScientificEvidencePacket({
      cropRegionId: "image_lens_region:test-bianchi",
      sourceRefHash: "sha256:test-bianchi",
      bboxPx: { x: 0, y: 0, width: 346, height: 255 },
      textCandidate:
        "As in Chapter 2 we use the Bianchi identities as field equations for the Weyl tensor.",
      latexCandidate: "\\nabla^\\mu \\psi_\\nu - D_\\nu S_\\phi = 0",
      uncertainty: ["OCR symbols are uncertain; observation only."],
      extractionStatus: "partial",
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "Reflect these extracted equations for congruence to the theory badge graph and mention tokamak thermal pressure only if the evidence branch admits it.",
        scientific_evidence_packet: scientificEvidence,
        mentioned_symbols: ["p_Pa", "n_m3", "T_eV", "W_th", "P_loss", "tau_E"],
        mentioned_domains: ["tokamak plasma"],
        limit: 12,
      },
      turnId: "ask:test:gateway-theory-reflection-image-lens-branch-gate",
      iteration: 7,
    });
    const observation = result.observation as {
      calculator_payloads?: Array<Record<string, unknown>>;
      rejected_calculator_payload_ids?: string[];
      scientific_branch_gate?: Record<string, any>;
      scientific_evidence_packet?: Record<string, unknown>;
      scientific_run_trace?: Record<string, unknown>;
      claim_boundary_notes?: string[];
    };

    expect(result.ok).toBe(true);
    expect(observation.scientific_evidence_packet).toMatchObject({
      schema: "helix.scientific_evidence_packet.v1",
      primary_domain: "weyl_bianchi",
      source_image: expect.objectContaining({
        ref_hash: "sha256:test-bianchi",
        source_kind: "unknown",
        raw_ref_included: false,
      }),
      crop_region: expect.objectContaining({
        region_id: "image_lens_region:test-bianchi",
        bbox_px: { x: 0, y: 0, width: 346, height: 255 },
        source_ref_hash: "sha256:test-bianchi",
      }),
      ocr_text_candidate:
        "As in Chapter 2 we use the Bianchi identities as field equations for the Weyl tensor.",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(observation.scientific_branch_gate).toMatchObject({
      schema: "helix.scientific_branch_gate.v1",
      status: "blocked",
      primary_domain: "weyl_bianchi",
      rejected_calculator_payload_ids: expect.arrayContaining([
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ]),
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(observation.scientific_branch_gate?.congruence_assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_ref: "tokamak_thermal_pressure_payload",
          target_kind: "calculator_payload",
          grade: "insufficient_evidence",
          blocked_by_branch_hint: true,
        }),
        expect.objectContaining({
          target_ref: "tokamak_confinement_energy_payload",
          target_kind: "calculator_payload",
          grade: "insufficient_evidence",
          blocked_by_branch_hint: true,
        }),
      ]),
    );
    expect(observation.scientific_run_trace).toMatchObject({
      schema: "helix.scientific_run_trace.v1",
      primary_domain: "weyl_bianchi",
      branch_gate_status: "blocked",
      rejected_calculator_payload_ids: expect.arrayContaining([
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ]),
      final_answer_guard: expect.objectContaining({
        required_claim_boundary: "observation_ocr_graph_match_not_proof",
        must_disclose_rejections: true,
      }),
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(observation.claim_boundary_notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("scientific_branch_gate=blocked"),
        expect.stringContaining(
          "rejected_calculator_payloads=tokamak_thermal_pressure_payload",
        ),
      ]),
    );
    expect(observation.calculator_payloads ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload_id: "tokamak_thermal_pressure_payload",
        }),
        expect.objectContaining({
          payload_id: "tokamak_confinement_energy_payload",
        }),
      ]),
    );
    expect(result.observation_packet.produced_affordances ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "calculator_expression_template",
          expression: "p_Pa = n_m3*T_eV*e_charge",
        }),
      ]),
    );
    expect(result.observation_packet.produced_affordances ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "scientific_evidence",
          claim_boundary: expect.stringContaining(
            "scientific_branch_gate=blocked",
          ),
        }),
      ]),
    );
    expect(result.observation_packet.observation_summary).toContain(
      "Scientific branch gate: blocked",
    );
  });

  it("blocks calculator handoff when explicit Image Lens evidence failed exact mapping", async () => {
    const scientificEvidence = buildScientificEvidencePacket({
      cropRegionId: "image_lens_region:test-failed",
      sourceRefHash: "sha256:test-failed",
      bboxPx: { x: 10, y: 8, width: 326, height: 238 },
      textCandidate: null,
      latexCandidate: null,
      uncertainty: [
        "Image Lens OCR/math extraction backend returned no inline crop or source image data.",
      ],
      extractionStatus: "failed",
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "Reflect this failed equation crop, but do not substitute tokamak thermal pressure unless the crop evidence admits it.",
        scientific_evidence_packet: scientificEvidence,
        mentioned_symbols: ["p_Pa", "n_m3", "T_eV", "W_th", "P_loss", "tau_E"],
        mentioned_domains: ["tokamak plasma"],
        limit: 12,
      },
      turnId: "ask:test:gateway-theory-reflection-failed-image-lens-block",
      iteration: 9,
    });
    const observation = result.observation as {
      calculator_payloads?: Array<Record<string, unknown>>;
      rejected_calculator_payload_ids?: string[];
      scientific_branch_gate?: Record<string, any>;
      scientific_evidence_packet?: Record<string, unknown>;
      scientific_run_trace?: Record<string, any>;
      claim_boundary_notes?: string[];
    };

    expect(result.ok).toBe(true);
    expect(observation.scientific_evidence_packet).toMatchObject({
      schema: "helix.scientific_evidence_packet.v1",
      primary_domain: "unknown_math",
      extraction_status: "failed",
      admissibility: expect.objectContaining({
        status: "inadmissible_for_exact_mapping",
      }),
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(observation.scientific_branch_gate).toMatchObject({
      schema: "helix.scientific_branch_gate.v1",
      status: "blocked",
      primary_domain: "unknown_math",
      congruence_grade_floor: "insufficient_evidence",
      rejected_calculator_payload_ids: expect.arrayContaining([
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ]),
      notes: expect.arrayContaining([
        "Explicit Image Lens evidence was not replaced by prompt context.",
        "Calculator payloads were suppressed because exact mapping evidence is missing.",
      ]),
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(observation.scientific_branch_gate?.congruence_assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_ref: "tokamak_thermal_pressure_payload",
          target_kind: "calculator_payload",
          grade: "insufficient_evidence",
          blocked_by_branch_hint: true,
        }),
        expect.objectContaining({
          target_ref: "tokamak_confinement_energy_payload",
          target_kind: "calculator_payload",
          grade: "insufficient_evidence",
          blocked_by_branch_hint: true,
        }),
      ]),
    );
    expect(observation.scientific_run_trace).toMatchObject({
      schema: "helix.scientific_run_trace.v1",
      primary_domain: "unknown_math",
      branch_gate_status: "blocked",
      congruence_grade_floor: "insufficient_evidence",
      rejected_calculator_payload_ids: expect.arrayContaining([
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ]),
      final_answer_guard: expect.objectContaining({
        required_claim_boundary: "observation_ocr_graph_match_not_proof",
        must_disclose_uncertainty: true,
        must_disclose_rejections: true,
      }),
    });
    expect(observation.scientific_run_trace?.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "image_extraction",
          status: "observed",
        }),
        expect.objectContaining({
          stage: "scientific_evidence_sidecar",
          status: "blocked",
        }),
        expect.objectContaining({
          stage: "theory_reflection",
          status: "blocked",
        }),
        expect.objectContaining({
          stage: "calculator_payload_filter",
          status: "blocked",
        }),
      ]),
    );
    expect(observation.claim_boundary_notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("scientific_branch_gate=blocked"),
        expect.stringContaining(
          "rejected_calculator_payloads=tokamak_thermal_pressure_payload",
        ),
      ]),
    );
    expect(observation.calculator_payloads ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload_id: "tokamak_thermal_pressure_payload",
        }),
        expect.objectContaining({
          payload_id: "tokamak_confinement_energy_payload",
        }),
      ]),
    );
    expect(result.observation_packet.produced_affordances ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "calculator_expression_template",
          expression: "p_Pa = n_m3*T_eV*e_charge",
        }),
      ]),
    );
    expect(result.observation_packet.produced_affordances ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "scientific_evidence",
          status: "blocked",
          claim_boundary: expect.stringContaining(
            "scientific_branch_gate=blocked",
          ),
        }),
      ]),
    );
  });

  it("consumes scientific image sidecars for Theory Badge Graph branch gating", async () => {
    const scientificEvidence = buildScientificEvidencePacket({
      cropRegionId: "equation_3.51",
      sourceRefHash: "sha256:test-sidecar-bianchi",
      sourceKind: "image_attachment",
      bboxPx: { x: 0, y: 70, width: 346, height: 65 },
      requestedEquationLabel: "3.51",
      regionLabel: "equation_3.51",
      textCandidate:
        "Bianchi identities for the Weyl tensor: \\nabla^\\mu \\psi_\\nu - D_\\nu S_\\phi = 0 (3.51)",
      latexCandidate:
        "\\nabla^\\mu \\psi_\\nu - D_\\nu S_\\phi = 0 \\tag{3.51}",
      uncertainty: [],
      extractionStatus: "extracted",
    });
    const sidecar = buildScientificImageEvidenceSidecar({
      sidecarId: "scientific_image_sidecar:test-sidecar-bianchi",
      packets: [scientificEvidence],
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "Here is a scientific document image. Extract the equations and compare them to the theory graph without substituting tokamak formulas.",
        scientific_evidence_sidecar: sidecar,
        mentioned_symbols: ["p_Pa", "n_m3", "T_eV", "W_th", "P_loss", "tau_E"],
        mentioned_domains: ["tokamak plasma"],
        limit: 12,
      },
      turnId: "ask:test:gateway-theory-reflection-scientific-image-sidecar",
      iteration: 10,
    });
    const observation = result.observation as {
      scientific_evidence_source?: string;
      scientific_evidence_sidecar?: Record<string, unknown>;
      scientific_evidence_packet?: Record<string, unknown>;
      scientific_branch_gate?: Record<string, any>;
      scientific_evidence_graph_reflection?: Record<string, any>;
      calculator_payloads?: Array<Record<string, unknown>>;
      claim_boundary_notes?: string[];
    };

    expect(result.ok).toBe(true);
    expect(observation.scientific_evidence_source).toBe("sidecar");
    expect(observation.scientific_evidence_sidecar).toMatchObject({
      schema: "helix.scientific_image_evidence_sidecar.v1",
      sidecar_id: "scientific_image_sidecar:test-sidecar-bianchi",
      admissibility: expect.objectContaining({
        status: "admissible_observation",
      }),
    });
    expect(observation.scientific_evidence_packet).toMatchObject({
      crop_region_id: "equation_3.51",
      primary_domain: "weyl_bianchi",
      exact_equation_admissibility: "admissible_for_exact_equation",
    });
    expect(observation.scientific_branch_gate).toMatchObject({
      status: "restricted",
      primary_domain: "weyl_bianchi",
      rejected_calculator_payload_ids: expect.arrayContaining([
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ]),
    });
    expect(observation.scientific_evidence_graph_reflection).toMatchObject({
      schema: "helix.scientific_evidence_graph_reflection.v1",
      evidence_depth: "promoted_exact_equation_row",
      evidence_object_class: "page_ocr_math_candidate",
      branch_gate_status: "restricted",
      claim_boundary: expect.objectContaining({
        diagnostic_only: true,
        observation_not_proof: true,
        no_physical_validation: true,
        no_badge_promotion: true,
      }),
      blocked_authorities: expect.arrayContaining([
        expect.objectContaining({ authority: "proof" }),
        expect.objectContaining({ authority: "physical_validation" }),
        expect.objectContaining({ authority: "badge_promotion" }),
        expect.objectContaining({ authority: "calculator_payload" }),
      ]),
      normalized_scientific_features: expect.objectContaining({
        domain_hints: expect.arrayContaining(["weyl_bianchi"]),
        fields: expect.arrayContaining(["scalar_field_phi"]),
      }),
      upgrade_requirements: expect.arrayContaining([
        "Extract neighboring definitions, assumptions, and boundary conditions.",
        "Extract derived stress-energy, energy-density, force, or pressure equations if present.",
      ]),
      next_tool_affordances: expect.arrayContaining([
        expect.objectContaining({
          capability: "visual_analysis.inspect_image_region",
        }),
        expect.objectContaining({
          capability: "scientific-calculator.bind_variables",
        }),
      ]),
      provenance_refs: expect.arrayContaining([
        "scientific_image_sidecar:test-sidecar-bianchi",
      ]),
    });
    expect(observation.calculator_payloads ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload_id: "tokamak_thermal_pressure_payload",
        }),
      ]),
    );
    expect(observation.claim_boundary_notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "scientific_image_sidecar=scientific_image_sidecar:test-sidecar-bianchi",
        ),
        expect.stringContaining("evidence_source=sidecar"),
      ]),
    );
  });

  it("classifies promoted curved-spacetime action rows as structured scientific graph reflections", async () => {
    const scientificEvidence = buildScientificEvidencePacket({
      cropRegionId: "equation_row_search_1",
      sourceRefHash: "sha256:test-curved-action-row",
      sourceKind: "pdf_page_render",
      pageNumber: 2,
      bboxPx: { x: 73, y: 697, width: 1078, height: 87 },
      regionLabel: "equation_row_search_1",
      textCandidate:
        "S[phi, g] = - 1/2 int_M d^D x sqrt(-g) phi [Box + xi R] phi",
      latexCandidate:
        "S[\\varphi, g] = - \\frac{1}{2} \\int_{M} d^D x \\sqrt{-g} \\varphi [ \\square + \\xi R] \\varphi",
      uncertainty: [],
      extractionStatus: "extracted",
    });
    const broadPageContext = buildScientificEvidencePacket({
      cropRegionId: "page_2_context",
      sourceRefHash: "sha256:test-curved-action-page-context",
      sourceKind: "pdf_page_render",
      pageNumber: 2,
      bboxPx: { x: 0, y: 0, width: 1224, height: 1584 },
      regionLabel: "page_2_context",
      textCandidate:
        "S[phi, g] = - 1/2 int_M d^D x sqrt(-g) phi [Box + xi R] phi where R denotes surrounding explanatory context that must not enter the promoted row.",
      latexCandidate: null,
      uncertainty: ["context crop"],
      extractionStatus: "partial",
    });
    const sidecar = buildScientificImageEvidenceSidecar({
      sidecarId: "scientific_image_sidecar:test-curved-action-row",
      packets: [broadPageContext, scientificEvidence],
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "Reflect this promoted page 2 equation row to the Theory Badge Graph, preserving diagnostic-only boundaries.",
        scientific_evidence_sidecar: sidecar,
        mentioned_domains: [
          "curved spacetime",
          "scalar field",
          "curvature coupling",
        ],
        limit: 8,
      },
      turnId: "ask:test:gateway-theory-reflection-curved-action-row",
      iteration: 18,
    });
    const observation = result.observation as {
      scientific_evidence_graph_reflection?: Record<string, any>;
      selected_scientific_evidence_object?: Record<string, any> | null;
      promoted_equation_row_ref?: string | null;
      scientific_branch_gate?: Record<string, any>;
      calculator_payloads?: Array<Record<string, unknown>>;
      calculator_template_admissibility?: Record<string, unknown>;
    };

    expect(result.ok).toBe(true);
    expect(observation.scientific_evidence_graph_reflection).toMatchObject({
      schema: "helix.scientific_evidence_graph_reflection.v1",
      evidence_depth: "promoted_exact_equation_row",
      evidence_object_class: "curved_spacetime_field_action",
      normalized_scientific_features: expect.objectContaining({
        operators: expect.arrayContaining([
          "dAlembertian_or_wave_operator",
          "spacetime_volume_integral",
          "metric_determinant_density",
          "curvature_coupling_operator",
        ]),
        fields: expect.arrayContaining(["scalar_field_phi", "metric_field_g"]),
        geometry_terms: expect.arrayContaining([
          "metric_determinant",
          "ricci_scalar_R",
          "curved_spacetime_dimension_D",
          "spacetime_manifold_M",
        ]),
      }),
      upgrade_requirements: expect.arrayContaining([
        "Derive or extract the stress-energy tensor relation tied to this action.",
        "Bind curvature coupling, field, metric, and integration-domain definitions.",
      ]),
      blocked_authorities: expect.arrayContaining([
        expect.objectContaining({ authority: "proof" }),
        expect.objectContaining({ authority: "physical_validation" }),
        expect.objectContaining({ authority: "badge_promotion" }),
      ]),
      claim_boundary: expect.objectContaining({
        diagnostic_only: true,
        no_calculator_authority_without_bound_payload: true,
      }),
      selected_evidence_object: expect.objectContaining({
        schema: "helix.promoted_scientific_image_evidence.v1",
        page_number: 2,
        crop_ref: "sha256:test-curved-action-row#crop=73,697,1078,87",
        latex_candidate:
          "S[\\varphi, g] = - \\frac{1}{2} \\int_{M} d^D x \\sqrt{-g} \\varphi [ \\square + \\xi R] \\varphi",
        active_blockers: [],
      }),
      exact_evidence_latex:
        "S[\\varphi, g] = - \\frac{1}{2} \\int_{M} d^D x \\sqrt{-g} \\varphi [ \\square + \\xi R] \\varphi",
    });
    expect(
      observation.scientific_evidence_graph_reflection?.exact_evidence_latex,
    ).not.toContain("where R denotes");
    expect(
      observation.scientific_evidence_graph_reflection?.selected_evidence_object
        ?.latex_candidate,
    ).not.toContain("where R denotes");
    expect(observation.selected_scientific_evidence_object).toMatchObject({
      schema: "helix.promoted_scientific_image_evidence.v1",
      crop_ref: "sha256:test-curved-action-row#crop=73,697,1078,87",
    });
    expect(observation.promoted_equation_row_ref).toBe(
      "sha256:test-curved-action-row#crop=73,697,1078,87",
    );
    expect(observation.calculator_template_admissibility).toMatchObject({
      status: "no_template",
      calculation_ready_count: 0,
    });
    expect(observation.calculator_payloads ?? []).toEqual([]);
  });

  it("blocks exact theory reflection when a scientific image sidecar has no admissible exact equation row", async () => {
    const contextEvidence = buildScientificEvidencePacket({
      cropRegionId: "scientific_page",
      sourceRefHash: "sha256:test-sidecar-context-only",
      sourceKind: "image_attachment",
      bboxPx: { x: 0, y: 0, width: 346, height: 361 },
      regionLabel: "scientific_page",
      textCandidate:
        "As in Chapter 2 we use the Bianchi identities as field equations for the Weyl tensor.",
      latexCandidate: "\\nabla^\\mu \\psi_\\nu - D_\\nu S_\\phi = 0",
      uncertainty: [],
      extractionStatus: "extracted",
    });
    const mislabeledRow = buildScientificEvidencePacket({
      cropRegionId: "equation_3.52",
      sourceRefHash: "sha256:test-sidecar-context-only",
      sourceKind: "image_attachment",
      bboxPx: { x: 0, y: 128, width: 346, height: 59 },
      requestedEquationLabel: "3.52",
      regionLabel: "equation_3.52",
      textCandidate: "\\Delta\\psi_0 - D_\\phi = 0 (2.52)",
      latexCandidate: "\\Delta\\psi_0 - D_\\phi = 0 \\tag{2.52}",
      uncertainty: [],
      extractionStatus: "extracted",
    });
    const sidecar = buildScientificImageEvidenceSidecar({
      sidecarId: "scientific_image_sidecar:test-sidecar-context-only",
      packets: [contextEvidence, mislabeledRow],
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "Here is a scientific document image. Use the extracted equations for exact Theory Badge Graph congruence.",
        scientific_evidence_sidecar: sidecar,
        mentioned_symbols: ["Weyl", "\\nabla", "\\psi"],
        mentioned_domains: ["weyl bianchi"],
        limit: 8,
      },
      turnId:
        "ask:test:gateway-theory-reflection-scientific-image-sidecar-no-exact-row",
      iteration: 16,
    });
    const observation = result.observation as {
      scientific_evidence_sidecar?: Record<string, any>;
      scientific_branch_gate?: Record<string, any>;
      scientific_evidence_graph_reflection?: Record<string, any>;
      rejected_calculator_payload_ids?: string[];
      calculator_payloads?: Array<Record<string, unknown>>;
      claim_boundary_notes?: string[];
    };

    expect(result.ok).toBe(true);
    expect(observation.scientific_evidence_sidecar).toMatchObject({
      exact_equation_summary: expect.objectContaining({
        admissible_row_count: 0,
        rejected_row_count: 1,
        observed_labels: expect.arrayContaining(["2.52"]),
      }),
    });
    expect(observation.scientific_branch_gate).toMatchObject({
      status: "blocked",
      congruence_grade_floor: "insufficient_evidence",
      notes: expect.arrayContaining([
        expect.stringContaining("insufficient_exact_equation_evidence"),
      ]),
    });
    expect(observation.scientific_evidence_graph_reflection).toMatchObject({
      schema: "helix.scientific_evidence_graph_reflection.v1",
      evidence_depth: "page_grounded_ocr",
      branch_gate_status: "blocked",
      blocked_authorities: expect.arrayContaining([
        expect.objectContaining({ authority: "proof" }),
        expect.objectContaining({ authority: "calculator_payload" }),
      ]),
      upgrade_requirements: expect.arrayContaining([
        "Crop and promote exact equation rows before graph or calculator use.",
        expect.stringContaining("Scientific branch gate blocked"),
      ]),
      next_tool_affordances: expect.arrayContaining([
        expect.objectContaining({
          capability: "visual_analysis.inspect_image_region",
        }),
        expect.objectContaining({
          capability: "scientific-calculator.bind_variables",
        }),
      ]),
    });
    expect(observation.calculator_payloads ?? []).toEqual([]);
    expect(observation.claim_boundary_notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("exact_equation_rows=admissible:0"),
      ]),
    );
  });

  it("blocks graph and calculator handoff when scientific image sidecar evidence is failed", async () => {
    const failedEvidence = buildScientificEvidencePacket({
      cropRegionId: "image_lens_region:test-sidecar-failed",
      sourceRefHash: "sha256:test-sidecar-failed",
      sourceKind: "image_attachment",
      bboxPx: { x: 0, y: 0, width: 346, height: 72 },
      textCandidate: null,
      latexCandidate: null,
      uncertainty: [
        "Image Lens OCR/math extraction backend returned no payload.",
      ],
      extractionStatus: "failed",
    });
    const sidecar = buildScientificImageEvidenceSidecar({
      sidecarId: "scientific_image_sidecar:test-sidecar-failed",
      packets: [failedEvidence],
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "Here is a scientific document image. Extract the equations and compare them to the theory graph.",
        scientific_evidence_sidecar: sidecar,
        mentioned_symbols: ["p_Pa", "n_m3", "T_eV", "W_th", "P_loss", "tau_E"],
        mentioned_domains: ["tokamak plasma"],
        limit: 12,
      },
      turnId:
        "ask:test:gateway-theory-reflection-scientific-image-sidecar-failed",
      iteration: 11,
    });
    const observation = result.observation as {
      scientific_evidence_source?: string;
      scientific_evidence_sidecar?: Record<string, any>;
      scientific_branch_gate?: Record<string, any>;
      scientific_run_trace?: Record<string, any>;
      calculator_payloads?: Array<Record<string, unknown>>;
    };

    expect(result.ok).toBe(true);
    expect(observation.scientific_evidence_source).toBe("sidecar");
    expect(observation.scientific_evidence_sidecar).toMatchObject({
      admissibility: expect.objectContaining({
        status: "inadmissible_for_exact_mapping",
      }),
    });
    expect(observation.scientific_branch_gate).toMatchObject({
      status: "blocked",
      congruence_grade_floor: "insufficient_evidence",
      notes: expect.arrayContaining([
        "Strict scientific image sidecar gating requires admissible Image Lens evidence before graph or calculator handoff.",
      ]),
      rejected_calculator_payload_ids: expect.arrayContaining([
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ]),
    });
    expect(observation.scientific_run_trace?.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "theory_reflection",
          status: "blocked",
        }),
        expect.objectContaining({
          stage: "calculator_payload_filter",
          status: "blocked",
        }),
      ]),
    );
    expect(observation.calculator_payloads ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload_id: "tokamak_thermal_pressure_payload",
        }),
      ]),
    );
  });

  it("blocks graph and calculator handoff when scientific image sidecar evidence is low-confidence", async () => {
    const lowConfidenceEvidence = buildScientificEvidencePacket({
      cropRegionId: "image_lens_region:test-sidecar-low-confidence",
      sourceRefHash: "sha256:test-sidecar-low-confidence",
      sourceKind: "image_attachment",
      bboxPx: { x: 12, y: 88, width: 120, height: 30 },
      textCandidate: null,
      latexCandidate: "\\nabla",
      uncertainty: ["symbol-only crop; no equation body recovered"],
      extractionStatus: "partial",
    });
    const sidecar = buildScientificImageEvidenceSidecar({
      sidecarId: "scientific_image_sidecar:test-sidecar-low-confidence",
      packets: [lowConfidenceEvidence],
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "Here is a scientific document image. Extract the equations and compare them to the theory graph.",
        scientific_evidence_sidecar: sidecar,
        mentioned_symbols: ["p_Pa", "n_m3", "T_eV", "W_th", "P_loss", "tau_E"],
        mentioned_domains: ["tokamak plasma"],
        limit: 12,
      },
      turnId:
        "ask:test:gateway-theory-reflection-scientific-image-sidecar-low-confidence",
      iteration: 13,
    });
    const observation = result.observation as {
      scientific_evidence_source?: string;
      scientific_evidence_sidecar?: Record<string, any>;
      scientific_evidence_packet?: Record<string, any>;
      scientific_branch_gate?: Record<string, any>;
      scientific_run_trace?: Record<string, any>;
      calculator_payloads?: Array<Record<string, unknown>>;
    };

    expect(result.ok).toBe(true);
    expect(observation.scientific_evidence_source).toBe("sidecar");
    expect(observation.scientific_evidence_packet).toMatchObject({
      confidence: 0.47,
      quality_flags: expect.arrayContaining(["partial_extraction_status"]),
      admissibility: expect.objectContaining({
        status: "unverified_math_observation",
      }),
    });
    expect(observation.scientific_evidence_sidecar).toMatchObject({
      admissibility: expect.objectContaining({
        status: "unverified_math_observation",
      }),
    });
    expect(observation.scientific_branch_gate).toMatchObject({
      status: "blocked",
      congruence_grade_floor: "insufficient_evidence",
      notes: expect.arrayContaining([
        "Strict scientific image sidecar gating requires admissible Image Lens evidence before graph or calculator handoff.",
      ]),
      rejected_calculator_payload_ids: expect.arrayContaining([
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ]),
    });
    expect(observation.scientific_run_trace?.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "scientific_evidence_sidecar",
          status: "restricted",
        }),
        expect.objectContaining({
          stage: "theory_reflection",
          status: "blocked",
        }),
        expect.objectContaining({
          stage: "calculator_payload_filter",
          status: "blocked",
        }),
      ]),
    );
    expect(observation.calculator_payloads ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload_id: "tokamak_thermal_pressure_payload",
        }),
      ]),
    );
  });

  it("does not admit prompt-context scientific branches for source-targeted image prompts without sidecar evidence", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "Here is a scientific document image. Extract the equations and compare them to the theory graph. Mention tokamak plasma only if the image evidence admits it.",
        mentioned_symbols: ["p_Pa", "n_m3", "T_eV", "W_th", "P_loss", "tau_E"],
        mentioned_domains: ["tokamak plasma"],
        limit: 12,
      },
      turnId: "ask:test:gateway-theory-reflection-prompt-context-image-block",
      iteration: 12,
    });
    const observation = result.observation as {
      scientific_evidence_source?: string;
      scientific_evidence_sidecar?: Record<string, unknown> | null;
      scientific_evidence_packet?: Record<string, any>;
      scientific_branch_gate?: Record<string, any>;
      calculator_payloads?: Array<Record<string, unknown>>;
    };

    expect(result.ok).toBe(true);
    expect(observation.scientific_evidence_source).toBe("prompt_context");
    expect(observation.scientific_evidence_sidecar).toBeNull();
    expect(observation.scientific_evidence_packet).toMatchObject({
      source_image: expect.objectContaining({ source_kind: "prompt_context" }),
      crop_region_id: "theory_reflection_prompt_context",
    });
    expect(observation.scientific_branch_gate).toMatchObject({
      status: "blocked",
      notes: expect.arrayContaining([
        "Prompt-context fallback packets cannot admit graph or calculator branches for source-targeted image prompts.",
      ]),
      rejected_calculator_payload_ids: expect.arrayContaining([
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ]),
    });
    expect(observation.calculator_payloads ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload_id: "tokamak_thermal_pressure_payload",
        }),
      ]),
    );
  });

  it("keeps tokamak calculator payloads admitted when scientific evidence is tokamak-scoped", async () => {
    const scientificEvidence = buildScientificEvidencePacket({
      cropRegionId: "image_lens_region:test-tokamak",
      sourceRefHash: "sha256:test-tokamak",
      bboxPx: { x: 0, y: 0, width: 300, height: 80 },
      requestedEquationLabel: "3.1",
      regionLabel: "equation_3.1",
      textCandidate:
        "Tokamak plasma beta uses p_Pa = n_m3*T_eV*e_charge and W_th = P_loss*tau_E. (3.1)",
      latexCandidate:
        "p_{Pa}=n_{m3}T_{eV}e,\\quad W_{th}=P_{loss}\\tau_E \\tag{3.1}",
      uncertainty: [],
      extractionStatus: "extracted",
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "Reflect tokamak thermal pressure and confinement time formulas against the theory badge graph.",
        scientific_evidence_packet: scientificEvidence,
        mentioned_symbols: ["p_Pa", "n_m3", "T_eV", "W_th", "P_loss", "tau_E"],
        mentioned_domains: ["tokamak plasma"],
        limit: 8,
      },
      turnId: "ask:test:gateway-theory-reflection-tokamak-branch-gate",
      iteration: 8,
    });
    const observation = result.observation as {
      calculator_payloads?: Array<Record<string, unknown>>;
      rejected_calculator_payload_ids?: string[];
      scientific_branch_gate?: Record<string, any>;
      scientific_run_trace?: Record<string, unknown>;
    };

    expect(result.ok).toBe(true);
    expect(observation.scientific_branch_gate).toMatchObject({
      primary_domain: "tokamak_plasma",
      rejected_calculator_payload_ids: [],
    });
    expect(observation.scientific_branch_gate?.congruence_assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_ref: "tokamak_thermal_pressure_payload",
          target_kind: "calculator_payload",
          grade: "exact_symbol_match",
          blocked_by_branch_hint: false,
          matched_symbols: expect.arrayContaining(["p_Pa", "n_m3", "T_eV"]),
        }),
        expect.objectContaining({
          target_ref: "tokamak_confinement_energy_payload",
          target_kind: "calculator_payload",
          grade: "exact_symbol_match",
          blocked_by_branch_hint: false,
          matched_symbols: expect.arrayContaining(["W_th", "P_loss", "tau_E"]),
        }),
      ]),
    );
    expect(observation.scientific_run_trace).toMatchObject({
      branch_gate_status: "admitted",
      primary_domain: "tokamak_plasma",
      rejected_calculator_payload_ids: [],
    });
    expect(observation.calculator_payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload_id: "tokamak_thermal_pressure_payload",
        }),
        expect.objectContaining({
          payload_id: "tokamak_confinement_energy_payload",
        }),
      ]),
    );
  });

  it("blocks prompt-context branch admission for source-targeted Image Lens scientific evidence prompts", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "Using only the re-entered Image Lens scientific evidence packet, reflect the attached equation crop against the Theory Badge Graph. Do not substitute tokamak, plasma, or calculator formulas unless the crop evidence admits that branch.",
        mentioned_symbols: ["tokamak", "plasma", "Report"],
        mentioned_domains: ["tokamak plasma"],
        limit: 8,
      },
      turnId:
        "ask:test:gateway-theory-reflection-prompt-context-image-lens-block",
      iteration: 10,
    });
    const observation = result.observation as {
      calculator_payloads?: Array<Record<string, unknown>>;
      rejected_calculator_payload_ids?: string[];
      scientific_branch_gate?: Record<string, any>;
      scientific_evidence_packet?: Record<string, any>;
      scientific_run_trace?: Record<string, any>;
      claim_boundary_notes?: string[];
    };

    expect(result.ok).toBe(true);
    expect(observation.scientific_evidence_packet).toMatchObject({
      schema: "helix.scientific_evidence_packet.v1",
      source_image: expect.objectContaining({
        source_kind: "prompt_context",
      }),
      bbox_px: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(observation.scientific_branch_gate).toMatchObject({
      schema: "helix.scientific_branch_gate.v1",
      status: "blocked",
      congruence_grade_floor: "insufficient_evidence",
      rejected_calculator_payload_ids: expect.arrayContaining([
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ]),
      notes: expect.arrayContaining([
        "Prompt-context fallback packets cannot admit graph or calculator branches for source-targeted image prompts.",
        "Calculator payloads were suppressed because exact mapping evidence is missing.",
      ]),
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(observation.scientific_run_trace).toMatchObject({
      branch_gate_status: "blocked",
      congruence_grade_floor: "insufficient_evidence",
      rejected_calculator_payload_ids: expect.arrayContaining([
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ]),
    });
    expect(observation.scientific_run_trace?.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "theory_reflection",
          status: "blocked",
        }),
        expect.objectContaining({
          stage: "calculator_payload_filter",
          status: "blocked",
        }),
      ]),
    );
    expect(observation.calculator_payloads ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload_id: "tokamak_thermal_pressure_payload",
        }),
        expect.objectContaining({
          payload_id: "tokamak_confinement_energy_payload",
        }),
      ]),
    );
    expect(result.observation_packet.produced_affordances ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "calculator_expression_template",
          expression: "p_Pa = n_m3*T_eV*e_charge",
        }),
      ]),
    );
  });

  it("blocks theory-badge reflection without prompt as a missing observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      arguments: {},
      turnId: "ask:test:gateway-theory-reflection-blocked",
      iteration: 6,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: THEORY_CONTEXT_REFLECTION_CAPABILITY,
      error: "theory_reflection_prompt_missing",
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "theory_reflection_prompt_missing",
      },
      observation_packet: {
        status: "blocked",
        missing_requirements: [
          expect.objectContaining({
            code: "theory_reflection_prompt_missing",
            repair_action: "ask_user",
          }),
        ],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.theory_context_reflection_observation.v1",
        status: "blocked",
        blocked_reason: "theory_reflection_prompt_missing",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("calls general Moral Graph reflection as read-only evidence, not an answer", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      capabilityId: MORAL_GRAPH_REFLECTION_CAPABILITY,
      mode: "read",
      turnId: "turn-moral-graph-reflection",
      iteration: 1,
      arguments: {
        prompt:
          "Reflect inherited conditioning, purpose as inquiry, and recognition before transcendence through the Moral Graph.",
        source_target_intent: {
          target_source: "moral_graph",
          target_kind: "moral_graph_reflection",
        },
      },
    });
    const observation = result.observation as {
      schema?: string;
      exact_badge_ids?: string[];
      likely_badge_ids?: string[];
      inferred_badge_ids?: string[];
      located_badge_ids?: string[];
      procedural_classification?: Record<string, unknown>;
      fruition?: Record<string, unknown>;
      claim_boundary_notes?: string[];
      reflection_id?: string;
    };

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: MORAL_GRAPH_REFLECTION_CAPABILITY,
      gateway_admission: {
        requested_capability: MORAL_GRAPH_REFLECTION_CAPABILITY,
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      observation_packet: {
        capability_key: MORAL_GRAPH_REFLECTION_CAPABILITY,
        panel_id: "moral-graph",
        action: "reflect_context",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.moral_graph_reflection_observation.v1",
        capability_key: MORAL_GRAPH_REFLECTION_CAPABILITY,
        panel_id: "moral-graph",
        action_id: "reflect_context",
        status: "succeeded",
        reflection_terminal_eligible: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        authority: expect.objectContaining({
          assistant_answer: false,
          terminal_eligible: false,
        }),
      },
      tool_followup_decision: {
        next_action: "continue_reasoning",
        evidence_reentered: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(String(observation.reflection_id ?? "")).toMatch(
      /^ideology-context-reflection:/,
    );
    expect(observation.located_badge_ids?.length).toBeGreaterThan(0);
    expect(observation.claim_boundary_notes?.length).toBeGreaterThan(0);
    expect(observation.procedural_classification).toBeTruthy();
    expect(observation.fruition).toBeTruthy();
  });

  it("calls Moral Graph living substrate reflection as read-only evidence, not an answer", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: MORAL_LIVING_SUBSTRATE_REFLECTION_CAPABILITY,
      arguments: {
        prompt:
          "Derive moral relevance from organism boundary, sensing, homeostasis, entropy gradient pressure, and non-human living systems.",
        source_theory_badge_ids: ["biophysics.homeostatic_regulation"],
        requested_substrate_badge_ids: ["sensing-before-judgment"],
        include_theory_bridge: true,
        include_admissions: true,
      },
      turnId: "ask:test:gateway-moral-living-substrate-reflection",
      iteration: 6,
    });
    const observation = result.observation as {
      exact_substrate_badge_ids?: string[];
      likely_substrate_badge_ids?: string[];
      source_theory_badge_ids?: string[];
      source_ref_ids?: string[];
      source_references?: Array<{
        id?: string;
        title?: string;
        url?: string;
        note?: string;
      }>;
      claim_boundary_notes?: string[];
      procedural_derivation_ids?: string[];
      procedural_derivations?: Array<{
        derivation_id?: string;
        estimate?: Record<string, unknown>;
        obligation_hint?: string;
        forbidden_overclaim?: string;
      }>;
      procedural_chain?: Array<{
        from_badge_id?: string;
        to_badge_id?: string;
        transition_label?: string;
        procedural_claim?: string;
        evidence_strength?: string;
        missing_evidence?: string[];
        forbidden_overclaim?: string;
      }>;
      synthesis_path?: Array<{
        step_id?: string;
        output_kind?: string;
      }>;
      recommended_action_ids?: string[];
      recommended_actions_solve?: boolean;
      reflection_id?: string;
    };

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: MORAL_LIVING_SUBSTRATE_REFLECTION_CAPABILITY,
      gateway_admission: {
        requested_capability: MORAL_LIVING_SUBSTRATE_REFLECTION_CAPABILITY,
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      observation_packet: {
        capability_key: MORAL_LIVING_SUBSTRATE_REFLECTION_CAPABILITY,
        panel_id: "moral-badge-graph",
        action: "reflect_living_substrate_context",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.moral_living_substrate_reflection_observation.v1",
        capability_key: MORAL_LIVING_SUBSTRATE_REFLECTION_CAPABILITY,
        panel_id: "moral-badge-graph",
        action_id: "reflect_living_substrate_context",
        status: "succeeded",
        reflection_schema: "moral_living_substrate_reflection/v1",
        admissions_included: true,
        admission_reason_codes: expect.arrayContaining([
          "living_substrate_reflection_request",
        ]),
        admission_blocking_reason_codes: [],
        reflection_terminal_eligible: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        authority: expect.objectContaining({
          assistant_answer: false,
          terminal_eligible: false,
          deterministic_content_role: "observation_not_assistant_answer",
        }),
      },
      tool_followup_decision: {
        next_action: "continue_reasoning",
        evidence_reentered: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(String(observation.reflection_id ?? "")).toMatch(
      /^moral-living-substrate-reflection:/,
    );
    expect([
      ...(observation.exact_substrate_badge_ids ?? []),
      ...(observation.likely_substrate_badge_ids ?? []),
    ]).toEqual(
      expect.arrayContaining([
        "boundary-before-obligation",
        "sensing-before-judgment",
        "maintenance-before-optimization",
      ]),
    );
    expect(observation.source_theory_badge_ids).toEqual(
      expect.arrayContaining([
        "biophysics.organism_environment_boundary",
        "biophysics.homeostatic_regulation",
      ]),
    );
    expect(observation.source_ref_ids).toEqual(
      expect.arrayContaining([
        "von-stockar-liu-1999-microbial-negative-entropy",
      ]),
    );
    expect(observation.source_references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "von-stockar-liu-1999-microbial-negative-entropy",
          url: "https://www.sciencedirect.com/science/article/pii/S0005272899000651",
        }),
      ]),
    );
    expect(observation.claim_boundary_notes?.join("\n")).toContain(
      "not terminal answer authority",
    );
    expect(observation.procedural_derivation_ids).toEqual(
      expect.arrayContaining([
        "boundary-integrity",
        "maintenance-requirement",
        "sensing-and-error",
        "obligation-emergence",
      ]),
    );
    expect(observation.procedural_derivations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          derivation_id: "obligation-emergence",
          estimate: expect.objectContaining({
            vulnerability: "medium",
            dependency: "medium",
            agency: "medium",
          }),
          obligation_hint: expect.stringContaining(
            "provisional care constraints",
          ),
          forbidden_overclaim: expect.stringContaining("personhood"),
        }),
      ]),
    );
    const boundaryMaintenanceLink = observation.procedural_chain?.find(
      (step) =>
        step.from_badge_id === "boundary-before-obligation" &&
        step.to_badge_id === "maintenance-before-optimization",
    );
    expect(boundaryMaintenanceLink).toMatchObject({
      transition_label: "boundary to maintenance",
      procedural_claim: expect.stringContaining(
        "maintained before optional optimization",
      ),
      evidence_strength: "present",
      missing_evidence: [],
      forbidden_overclaim: expect.stringContaining("morally identical"),
    });
    const sensingValenceLink = observation.procedural_chain?.find(
      (step) =>
        step.from_badge_id === "sensing-before-judgment" &&
        step.to_badge_id === "valence-before-preference",
    );
    expect(sensingValenceLink).toMatchObject({
      transition_label: "sensing to valence",
      evidence_strength: "present",
      missing_evidence: [],
      forbidden_overclaim: expect.stringContaining("human-like preference"),
    });
    expect(observation.synthesis_path?.map((step) => step.output_kind)).toEqual(
      [
        "substrate_observation",
        "vulnerability_dependency_agency_estimate",
        "obligation_caution_forbidden_overclaim",
      ],
    );
    expect(observation.recommended_action_ids).toEqual(
      expect.arrayContaining([
        "moral-graph.inspect_living_substrate_badges",
        "theory-badge-graph.reflect_discussion_context",
      ]),
    );
    expect(observation.recommended_actions_solve).toBe(false);
  });

  it("blocks Moral Graph living substrate reflection without prompt as a missing observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: MORAL_LIVING_SUBSTRATE_REFLECTION_CAPABILITY,
      arguments: {},
      turnId: "ask:test:gateway-moral-living-substrate-reflection-blocked",
      iteration: 7,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: MORAL_LIVING_SUBSTRATE_REFLECTION_CAPABILITY,
      error: "moral_living_substrate_prompt_missing",
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "moral_living_substrate_prompt_missing",
      },
      observation_packet: {
        status: "blocked",
        missing_requirements: [
          expect.objectContaining({
            code: "moral_living_substrate_prompt_missing",
            repair_action: "ask_user",
          }),
        ],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.moral_living_substrate_reflection_observation.v1",
        status: "blocked",
        blocked_reason: "moral_living_substrate_prompt_missing",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("calls theory frontier conjecture workbench as non-terminal evidence", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_FRONTIER_CONJECTURE_CAPABILITY,
      arguments: {
        prompt:
          "Where might a useful missing badge or conjectural bridge live between QEI margin, source residual, and tensor authority?",
        mentioned_symbols: ["QEI", "source residual"],
        mentioned_domains: ["warp metrics", "claim boundaries"],
        frontier_search_seed: "gateway-frontier-conjecture-test",
        limit: 4,
      },
      turnId: "ask:test:gateway-theory-frontier-conjecture",
      iteration: 7,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: THEORY_FRONTIER_CONJECTURE_CAPABILITY,
      gateway_admission: {
        requested_capability: THEORY_FRONTIER_CONJECTURE_CAPABILITY,
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      observation_packet: {
        capability_key: THEORY_FRONTIER_CONJECTURE_CAPABILITY,
        panel_id: "theory-badge-graph",
        action: "propose_frontier_conjectures",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.theory_frontier_conjecture_observation.v1",
        capability_key: THEORY_FRONTIER_CONJECTURE_CAPABILITY,
        panel_id: "theory-badge-graph",
        action_id: "propose_frontier_conjectures",
        status: "succeeded",
        prompt:
          "Where might a useful missing badge or conjectural bridge live between QEI margin, source residual, and tensor authority?",
        conversation_context_included: false,
        receipt_schema: "helix_theory_context_reflection_tool_receipt/v1",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        authority: expect.objectContaining({
          assistant_answer: false,
          terminal_eligible: false,
          deterministic_content_role: "observation_not_assistant_answer",
        }),
      },
      tool_followup_decision: {
        next_action: "continue_reasoning",
        evidence_reentered: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    const observation = result.observation as {
      reflection_id?: string;
      search_id?: string;
      frontier_candidate_count?: number;
      candidates?: Array<Record<string, unknown>>;
      recommended_actions_solve?: boolean;
      scholarly_lookup_request_count?: number;
      exact_verification_result_count?: number;
    };
    expect(String(observation.reflection_id ?? "")).toMatch(
      /^theory-context-reflection:/,
    );
    expect(String(observation.search_id ?? "")).toMatch(
      /^(?:frontier_search|theory-frontier-search):/,
    );
    expect(observation.frontier_candidate_count ?? 0).toBeGreaterThan(0);
    expect(observation.scholarly_lookup_request_count ?? 0).toBeGreaterThan(0);
    expect(observation.exact_verification_result_count ?? 0).toBe(
      observation.frontier_candidate_count,
    );
    expect(observation.recommended_actions_solve).toBe(false);

    const firstCandidate = observation.candidates?.[0];
    expect(firstCandidate).toMatchObject({
      candidate_id: expect.any(String),
      candidate_kind: expect.stringMatching(
        /candidate_connection|missing_intermediate_badge|unresolved_semantic_region/,
      ),
      status: expect.stringMatching(
        /coarse_candidate|exact_verification_pending|needs_observable|needs_scholarly_evidence|blocked_by_boundary/,
      ),
      title: expect.any(String),
      summary: expect.any(String),
      nearby_badge_ids: expect.any(Array),
      proposed_relation_or_missing_badge: expect.any(String),
      biome_region: expect.any(Object),
      scale_bands: expect.any(Array),
      render_chunk_ids: expect.any(Array),
      semantic_chunk_ids: expect.any(Array),
      congruence_score: expect.any(Number),
      information_gain_bits: expect.any(Number),
      calculator_probe_available: expect.any(Boolean),
      recommended_next_actions: expect.any(Array),
      required_observables: expect.any(Array),
      required_artifacts: expect.any(Array),
      source_references: expect.any(Array),
      falsification_checks: expect.any(Array),
      claim_boundary_notes: expect.any(Array),
      promotion_allowed: false,
      terminal_eligible: false,
      assistant_answer: false,
      post_tool_model_step_required: true,
    });
  });

  it("blocks theory frontier conjecture workbench without prompt as a missing observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_FRONTIER_CONJECTURE_CAPABILITY,
      arguments: {},
      turnId: "ask:test:gateway-theory-frontier-conjecture-blocked",
      iteration: 8,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: THEORY_FRONTIER_CONJECTURE_CAPABILITY,
      error: "theory_frontier_conjecture_prompt_missing",
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "theory_frontier_conjecture_prompt_missing",
      },
      observation_packet: {
        status: "blocked",
        missing_requirements: [
          expect.objectContaining({
            code: "theory_frontier_conjecture_prompt_missing",
            repair_action: "ask_user",
          }),
        ],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.theory_frontier_conjecture_observation.v1",
        status: "blocked",
        blocked_reason: "theory_frontier_conjecture_prompt_missing",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("boundary-marks physical viability overclaims in frontier conjecture observations", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_FRONTIER_CONJECTURE_CAPABILITY,
      arguments: {
        prompt:
          "Use graph placement and calculator output to prove physical viability of the warp drive candidate.",
        frontier_search_seed: "gateway-frontier-conjecture-overclaim-test",
      },
      turnId: "ask:test:gateway-theory-frontier-conjecture-overclaim",
      iteration: 9,
    });

    expect(result.ok).toBe(true);
    const observation = result.observation as {
      forbidden_claim_scan_notes?: string[];
      candidate_status_counts?: Record<string, number>;
      candidates?: Array<{
        status?: string;
        promotion_allowed?: boolean;
        terminal_eligible?: boolean;
        assistant_answer?: boolean;
        claim_boundary_notes?: string[];
      }>;
    };
    expect(observation.forbidden_claim_scan_notes?.length ?? 0).toBeGreaterThan(
      0,
    );
    expect(observation.candidate_status_counts).toEqual({
      blocked_by_boundary: observation.candidates?.length ?? 0,
    });
    expect(observation.candidates?.length ?? 0).toBeGreaterThan(0);
    expect(
      observation.candidates?.every(
        (candidate) => candidate.status === "blocked_by_boundary",
      ),
    ).toBe(true);
    expect(
      observation.candidates?.every(
        (candidate) => candidate.promotion_allowed === false,
      ),
    ).toBe(true);
    expect(
      observation.candidates?.every(
        (candidate) => candidate.terminal_eligible === false,
      ),
    ).toBe(true);
    expect(
      observation.candidates?.every(
        (candidate) => candidate.assistant_answer === false,
      ),
    ).toBe(true);
    expect(observation.candidates?.[0]?.claim_boundary_notes).toEqual(
      expect.arrayContaining(observation.forbidden_claim_scan_notes ?? []),
    );
  });

  it("declares typed affordance handoff roles for every shared gateway capability", () => {
    const manifest = listWorkstationGatewayCapabilities({
      agentRuntime: "codex",
      mode: "read",
    });

    expect(manifest.capabilities.length).toBeGreaterThan(50);
    for (const capability of manifest.capabilities) {
      expect(capability.produces_affordances, capability.capability_id).toEqual(
        expect.any(Array),
      );
      expect(capability.consumes_affordances, capability.capability_id).toEqual(
        expect.any(Array),
      );
      expect(capability.typed_handoff_role, capability.capability_id).toMatch(
        /^(?:producer|consumer|producer_consumer|none)$/,
      );
      expect(
        (capability.produces_affordances?.length ?? 0) +
          (capability.consumes_affordances?.length ?? 0),
        capability.capability_id,
      ).toBeGreaterThan(0);
      if (capability.typed_handoff_role === "producer") {
        expect(
          capability.produces_affordances?.length ?? 0,
          capability.capability_id,
        ).toBeGreaterThan(0);
        expect(
          capability.consumes_affordances?.length ?? 0,
          capability.capability_id,
        ).toBe(0);
      }
      if (capability.typed_handoff_role === "consumer") {
        expect(
          capability.produces_affordances?.length ?? 0,
          capability.capability_id,
        ).toBe(0);
        expect(
          capability.consumes_affordances?.length ?? 0,
          capability.capability_id,
        ).toBeGreaterThan(0);
      }
      if (capability.typed_handoff_role === "producer_consumer") {
        expect(
          capability.produces_affordances?.length ?? 0,
          capability.capability_id,
        ).toBeGreaterThan(0);
        expect(
          capability.consumes_affordances?.length ?? 0,
          capability.capability_id,
        ).toBeGreaterThan(0);
      }
      if (capability.typed_handoff_role === "none") {
        expect(capability.capability_id, capability.capability_id).toBe(
          "__no_shared_gateway_capability_should_use_none__",
        );
      }
    }
    expect(
      manifest.capabilities.find(
        (capability) =>
          capability.capability_id === THEORY_CONTEXT_REFLECTION_CAPABILITY,
      ),
    ).toMatchObject({
      produces_affordances: expect.arrayContaining([
        "theory_context",
        "calculator_expression_template",
        "claim_boundary",
      ]),
      typed_handoff_role: "producer",
    });
    expect(
      manifest.capabilities.find(
        (capability) =>
          capability.capability_id === CALCULATOR_SOLVE_EXPRESSION_CAPABILITY,
      ),
    ).toMatchObject({
      consumes_affordances: expect.arrayContaining([
        "bound_calculator_expression",
        "calculator_expression_template",
        "numeric_value_evidence",
      ]),
      produces_affordances: expect.arrayContaining([
        "calculator_result",
        "numeric_value_evidence",
      ]),
      typed_handoff_role: "producer_consumer",
    });
    expect(
      manifest.capabilities.find(
        (capability) =>
          capability.capability_id ===
          CALCULATOR_SOLVE_SCALAR_EXPRESSION_CAPABILITY,
      ),
    ).toMatchObject({
      consumes_affordances: expect.arrayContaining([
        "bound_calculator_expression",
        "calculator_expression_template",
        "numeric_value_evidence",
      ]),
      produces_affordances: expect.arrayContaining([
        "calculator_result",
        "numeric_value_evidence",
      ]),
      typed_handoff_role: "producer_consumer",
    });
  });

  it("keeps ambiguous frontier conjecture prompts in broad uncertainty", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: THEORY_FRONTIER_CONJECTURE_CAPABILITY,
      arguments: {
        prompt:
          "Compare this idea with the other one and find possible bridge regions.",
        frontier_search_seed: "gateway-frontier-conjecture-ambiguous-test",
      },
      turnId: "ask:test:gateway-theory-frontier-conjecture-ambiguous",
      iteration: 10,
    });

    expect(result.ok).toBe(true);
    const observation = result.observation as {
      probability_terrain?: {
        uncertaintyMode?: string;
        interpretation?: string;
        placementCertainty?: number;
      };
      candidates?: Array<{
        terminal_eligible?: boolean;
        assistant_answer?: boolean;
      }>;
    };
    expect(observation.probability_terrain).toMatchObject({
      uncertaintyMode: "broad",
      interpretation: "placement_probability_not_truth_claim",
    });
    expect(
      observation.probability_terrain?.placementCertainty ?? 1,
    ).toBeLessThan(0.1);
    expect(observation.candidates?.length ?? 0).toBeGreaterThan(0);
    expect(
      observation.candidates?.every(
        (candidate) => candidate.terminal_eligible === false,
      ),
    ).toBe(true);
    expect(
      observation.candidates?.every(
        (candidate) => candidate.assistant_answer === false,
      ),
    ).toBe(true);
  });

  it("calls interim voice callout as a host-projected non-terminal receipt", async () => {
    admitVoiceRuntimeForTest();
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: VOICE_INTERIM_CALLOUT_CAPABILITY,
      arguments: {
        text: "checking now",
        thread_id: "helix-ask:test:voice",
        kind: "tool_progress",
        evidence_refs: ["ask:test:voice-positive"],
      },
      turnId: "ask:test:gateway-voice-callout",
      iteration: 8,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: VOICE_INTERIM_CALLOUT_CAPABILITY,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      gateway_admission: {
        requested_capability: VOICE_INTERIM_CALLOUT_CAPABILITY,
        selected_agent_provider: "codex",
        permission_profile: "act",
        admission_status: "admitted",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        capability_key: VOICE_INTERIM_CALLOUT_CAPABILITY,
        panel_id: "voice-delivery",
        action: "request_interim_voice_callout",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.interim_voice_callout_tool_result.v1",
        capability_key: VOICE_INTERIM_CALLOUT_CAPABILITY,
        status: "succeeded",
        request: {
          text: "checking now",
          authority: "provisional",
          requiresConfirmation: false,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        receipt: {
          status: "awaiting_client_playback",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        host_projection: {
          kind: "voice_playback_request",
          playback_status: "awaiting_client_playback",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        post_tool_model_step_required: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      tool_followup_decision: {
        next_action: "continue_reasoning",
        evidence_reentered: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    const observation = result.observation as {
      model_id?: string;
      selected_model_or_service?: string;
      host_projection?: { model_id?: string };
      request?: { requestId?: string };
      receipt?: { receiptId?: string; model_id?: string };
    };
    expect(observation.model_id).toBe("eleven_multilingual_v2");
    expect(observation.selected_model_or_service).toBe(
      "eleven_multilingual_v2",
    );
    expect(observation.receipt?.model_id).toBe("eleven_multilingual_v2");
    expect(observation.host_projection?.model_id).toBe(
      "eleven_multilingual_v2",
    );
    expect(observation.request?.requestId).toMatch(
      /^helix_interim_voice_callout_request:/,
    );
    expect(observation.receipt?.receiptId).toMatch(
      /^helix_interim_voice_callout_receipt:/,
    );
  });

  it("calls text_to_speech.speak_text as the canonical governed voice lane", async () => {
    admitVoiceRuntimeForTest();
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: TEXT_TO_SPEECH_SPEAK_TEXT_CAPABILITY,
      arguments: {
        text: "playback handoff only",
        thread_id: "helix-ask:test:tts",
        voice: "dottie_default",
        locale: "en-US",
        source_observation_ref: "ask:test:source-observation",
      },
      turnId: "ask:test:gateway-tts-speak-text",
      iteration: 10,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: TEXT_TO_SPEECH_SPEAK_TEXT_CAPABILITY,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      gateway_admission: {
        requested_capability: TEXT_TO_SPEECH_SPEAK_TEXT_CAPABILITY,
        admission_status: "admitted",
        permission_profile: "act",
      },
      observation_packet: {
        capability_key: TEXT_TO_SPEECH_SPEAK_TEXT_CAPABILITY,
        panel_id: "voice-delivery",
        action: "speak_text",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
      },
      observation: {
        schema: "helix.interim_voice_callout_tool_result.v1",
        capability_key: TEXT_TO_SPEECH_SPEAK_TEXT_CAPABILITY,
        capability: TEXT_TO_SPEECH_SPEAK_TEXT_CAPABILITY,
        status: "succeeded",
        request: {
          text: "playback handoff only",
          kind: "tool_result",
          voicePlaybackKind: "tool_receipt",
          evidenceRefs: ["ask:test:source-observation"],
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        receipt: {
          tool: TEXT_TO_SPEECH_SPEAK_TEXT_CAPABILITY,
          playback_status: "awaiting_client_receipt",
          audio_url: null,
          audio_bytes_observed: false,
          delivered_at_ms: null,
          source_text_hash: expect.any(String),
          backend_provider: "existing_voice_service",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        host_projection: {
          kind: "voice_playback_request",
          normalized_playback_status: "awaiting_client_receipt",
          audio_bytes_observed: false,
          source_text_hash: expect.any(String),
          source_observation_ref: "ask:test:source-observation",
          locale: "en-US",
          voice_profile: "dottie_default",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
    });
  });

  it("blocks interim voice callout when confirmation is required, without making a final answer", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "act",
      capabilityId: VOICE_INTERIM_CALLOUT_CAPABILITY,
      arguments: {
        text: "confirm before speaking",
        thread_id: "helix-ask:test:voice",
        requires_confirmation: true,
      },
      turnId: "ask:test:gateway-voice-confirmation-blocked",
      iteration: 9,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: VOICE_INTERIM_CALLOUT_CAPABILITY,
      error: "blocked_policy",
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "blocked_policy",
      },
      observation_packet: {
        status: "blocked",
        missing_requirements: [
          expect.objectContaining({
            code: "blocked_policy",
            repair_action: "repair",
          }),
        ],
      },
      observation: {
        schema: "helix.interim_voice_callout_tool_result.v1",
        status: "blocked",
        blocked_reason: "blocked_policy",
        request: {
          requiresConfirmation: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        receipt: {
          status: "blocked_policy",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
    });
  });

  it("observes active translated docs surface as bounded non-terminal evidence", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_READ_ACTIVE_TRANSLATION_CAPABILITY,
      arguments: {
        label: "visible translated section",
        source_doc_path: "docs/helix-ask-api-parity-matrix.md",
        translation_blocks: [
          {
            unit_id: "doc-unit:1",
            source_text: "Original sentence.",
            translated_text: "Translated sentence.",
            locale: "es",
            status: "ready",
          },
        ],
      },
      turnId: "ask:test:gateway-readable-translation",
      iteration: 11,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: DOCS_READ_ACTIVE_TRANSLATION_CAPABILITY,
      observation_packet: {
        capability_key: DOCS_READ_ACTIVE_TRANSLATION_CAPABILITY,
        panel_id: "docs-viewer",
        action: "read_active_translation",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.workstation_readable_surface_observation.v1",
        capability_key: DOCS_READ_ACTIVE_TRANSLATION_CAPABILITY,
        canonical_capability_key: READABLE_SURFACE_OBSERVE_CAPABILITY,
        panel_id: "docs-viewer",
        status: "succeeded",
        text: "Translated sentence.",
        source_doc_path: "docs/helix-ask-api-parity-matrix.md",
        translation: expect.objectContaining({
          locale: null,
          status: "ready",
          source_unit_ids: ["doc-unit:1"],
        }),
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("blocks missing readable surfaces before narrator delivery", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_READ_ACTIVE_TRANSLATION_CAPABILITY,
      arguments: {
        label: "visible translated section",
      },
      turnId: "ask:test:gateway-readable-translation-missing",
      iteration: 12,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: DOCS_READ_ACTIVE_TRANSLATION_CAPABILITY,
      error: "translation_surface_missing",
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "translation_surface_missing",
      },
      observation_packet: {
        status: "blocked",
        missing_requirements: [
          expect.objectContaining({
            code: "translation_surface_missing",
            repair_action: "ask_user",
          }),
        ],
      },
      observation: {
        schema: "helix.workstation_readable_surface_observation.v1",
        status: "blocked",
        blocked_reason: "translation_surface_missing",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("observes calculator visible result separately from draft input", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "future",
      mode: "read",
      capabilityId: CALCULATOR_READ_VISIBLE_RESULT_CAPABILITY,
      arguments: {
        active_context: {
          current_latex: "6*7",
          last_result_text: "42",
          last_normalized_expression: "6*7",
        },
      },
      turnId: "ask:test:gateway-readable-calculator",
      iteration: 13,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: CALCULATOR_READ_VISIBLE_RESULT_CAPABILITY,
      observation: {
        schema: "helix.workstation_readable_surface_observation.v1",
        text: "42",
        calculator: {
          expression: "6*7",
          result: "42",
          result_source: "visible_result_region",
          draft_input_distinguished: true,
        },
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("blocks selected readable docs surfaces without a registered surface ref", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_READ_VISIBLE_SURFACE_CAPABILITY,
      arguments: {
        label: "selected document paragraph",
        surface: "selected",
        selected_text: "Selected paragraph text.",
        selection_kind: "selected",
      },
      turnId: "ask:test:gateway-readable-selected-missing-ref",
      iteration: 14,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: DOCS_READ_VISIBLE_SURFACE_CAPABILITY,
      error: "registered_surface_ref_missing",
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "registered_surface_ref_missing",
      },
      observation_packet: {
        status: "blocked",
        missing_requirements: [
          expect.objectContaining({
            code: "registered_surface_ref_missing",
            repair_action: "ask_user",
          }),
        ],
      },
      observation: {
        schema: "helix.workstation_readable_surface_observation.v1",
        status: "blocked",
        blocked_reason: "registered_surface_ref_missing",
        text: "Selected paragraph text.",
        selection_ref: null,
        selection_kind: "selected",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("observes selected readable docs surfaces when a registered surface ref is present", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: DOCS_READ_VISIBLE_SURFACE_CAPABILITY,
      arguments: {
        label: "selected document paragraph",
        surface: "selected",
        selected_text: "Selected paragraph text.",
        selection_ref: "docs-viewer:selection:unit-42",
        selection_kind: "selected",
      },
      turnId: "ask:test:gateway-readable-selected-ref",
      iteration: 15,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: DOCS_READ_VISIBLE_SURFACE_CAPABILITY,
      observation_packet: {
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.workstation_readable_surface_observation.v1",
        status: "succeeded",
        text: "Selected paragraph text.",
        selection_ref: "docs-viewer:selection:unit-42",
        selection_kind: "selected",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("exposes readable surface observations through the Helix Native runtime lane", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "helix-native",
      mode: "read",
      capabilityId: DOCS_READ_VISIBLE_SURFACE_CAPABILITY,
      arguments: {
        label: "visible document section",
        surface: "visible_document",
        visible_text: "Helix Native visible surface text.",
        source_doc_path: "docs/helix-ask-flow.md",
      },
      turnId: "ask:test:gateway-readable-helix-native",
      iteration: 16,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "helix-native",
      capability_id: DOCS_READ_VISIBLE_SURFACE_CAPABILITY,
      gateway_admission: {
        selected_agent_provider: "helix-native",
        admission_status: "admitted",
      },
      observation: {
        schema: "helix.workstation_readable_surface_observation.v1",
        text: "Helix Native visible surface text.",
        source_doc_path: "docs/helix-ask-flow.md",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("calls narrator say through the same non-terminal voice receipt contract", async () => {
    admitVoiceRuntimeForTest();
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "future",
      mode: "act",
      capabilityId: VOICE_NARRATOR_SAY_CAPABILITY,
      arguments: {
        text: "Narrator check.",
        thread_id: "helix-ask:test:narrator",
      },
      turnId: "ask:test:gateway-narrator-say",
      iteration: 10,
    });

    expect(result).toMatchObject({
      ok: true,
      agent_runtime: "future",
      capability_id: VOICE_NARRATOR_SAY_CAPABILITY,
      observation_packet: {
        capability_key: VOICE_NARRATOR_SAY_CAPABILITY,
        panel_id: "voice-delivery",
        action: "narrator_say",
        status: "succeeded",
      },
      observation: {
        schema: "helix.interim_voice_callout_tool_result.v1",
        capability_key: VOICE_NARRATOR_SAY_CAPABILITY,
        request: {
          kind: "narrator_read",
          voicePlaybackKind: "narrator_read",
          text: "Narrator check.",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        receipt: {
          status: "awaiting_client_playback",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("keeps missing visual evidence as an admitted failed observation", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: VISUAL_SITUATION_OBSERVATION_CAPABILITY,
      arguments: {
        thread_id: "helix-ask:test:no-visual-evidence",
        prompt: "What is happening right now in the visual screen capture?",
        source_target_intent: {
          target_source: "visual_capture",
          target_kind: "visual_capture",
          strength: "hard",
        },
      },
      turnId: "ask:test:gateway-visual-evidence-unavailable",
      iteration: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      capability_id: VISUAL_SITUATION_OBSERVATION_CAPABILITY,
      error: "active_visual_situation_evidence_unavailable",
      gateway_admission: {
        admission_status: "admitted",
      },
      observation_packet: {
        status: "failed",
        missing_requirements: [
          expect.objectContaining({
            code: "active_visual_situation_evidence_unavailable",
            repair_action: "retry",
          }),
        ],
      },
      tool_lifecycle_trace: {
        requested_capability: VISUAL_SITUATION_OBSERVATION_CAPABILITY,
        admitted_capability: VISUAL_SITUATION_OBSERVATION_CAPABILITY,
        executed_capability: VISUAL_SITUATION_OBSERVATION_CAPABILITY,
        lifecycle_stage: "failed",
        failure_reason: "active_visual_situation_evidence_unavailable",
      },
      observation: {
        status: "unavailable",
        reentry_required: true,
        answer_authority: false,
        terminal_eligible: false,
      },
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("returns bounded active SituationRun evidence for runtime re-entry", async () => {
    const threadId = "helix-ask:test:visual-evidence";
    const sourceId = "visual_source:test:visual-evidence";
    const now = new Date().toISOString();
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "seed:test:visual-evidence",
      objective: "Describe the current visual scene.",
      preset: "custom",
      source_ids: [sourceId],
    });
    const initialRun = ensureLiveSituationRunForEnvironment({
      environment,
      advanceEpoch: false,
    });
    const observation = appendObservationJournalEntry({
      thread_id: threadId,
      observation_id: "observation:test:visual-evidence",
      role: "model_perception_observation",
      modality: "visual_frame",
      source_id: sourceId,
      source_binding_id: initialRun.source_binding_id,
      text: "A workstation panel shows a visible Start button and status controls.",
      evidence_refs: ["visual_evidence:test:visual-evidence"],
      model_invoked: true,
      confidence: 0.88,
      created_at: now,
      assistant_answer: false,
      raw_content_included: false,
    });
    const run = ensureLiveSituationRunForEnvironment({
      environment,
      observation,
      sourceBindingId: initialRun.source_binding_id,
      advanceEpoch: true,
    });
    recordLiveFieldEvaluation({
      schema: "helix.live_field_evaluation.v1",
      evaluation_id: "field_eval:test:visual-evidence:activity",
      worker_run_id: "field_worker_run:test:visual-evidence:activity",
      worker_id: "field_worker:test:visual-evidence",
      situation_run_id: run.situation_run_id,
      thread_id: threadId,
      environment_id: environment.environment_id,
      field_key: "activity",
      value: "Reviewing a workstation panel with a Start button.",
      status: "supported",
      confidence: 0.86,
      evidence_refs: [observation.observation_id],
      missing_evidence: [],
      corroboration_state: { visual: "present" },
      next_check: "Observe the next frame for state changes.",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: now,
      role: "ui_projection",
      assistant_answer: false,
      raw_content_included: false,
    });
    appendInterpretationCard({
      thread_id: threadId,
      title: "Current visual scene",
      summary:
        "The current frame shows a workstation panel with a Start button.",
      evidence_refs: [observation.observation_id],
      confidence: 0.86,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: VISUAL_SITUATION_OBSERVATION_CAPABILITY,
      arguments: {
        thread_id: "model-supplied-wrong-thread",
        prompt: "What is happening right now in the visual screen capture?",
        source_target_intent: {
          target_source: "visual_capture",
          target_kind: "visual_capture",
          strength: "hard",
        },
      },
      conversationThreadId: threadId,
      turnId: "ask:test:gateway-visual-evidence",
      iteration: 1,
    });

    expect(result).toMatchObject({
      ok: true,
      capability_id: VISUAL_SITUATION_OBSERVATION_CAPABILITY,
      gateway_admission: {
        admission_status: "admitted",
      },
      observation_packet: {
        status: "succeeded",
      },
      observation: {
        schema: "helix.visual_situation_observation.v1",
        status: "completed",
        thread_id: threadId,
        situation_run_id: run.situation_run_id,
        visual_frame_evidence: {
          answerable: true,
          assistant_answer: false,
          raw_content_included: false,
        },
        situation_context_pack: {
          schema: "helix.situation_context_pack.v1",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        observation_role: "evidence_not_assistant_answer",
        reentry_required: true,
        answer_authority: false,
        terminal_eligible: false,
        post_tool_model_step_required: true,
      },
      post_tool_model_step_required: true,
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("rejects unknown capabilities as non-terminal failed observations", async () => {
    const result = await callWorkstationGatewayCapability({
      capabilityId: "filesystem.write_file",
      turnId: "ask:test:gateway",
    });

    expect(result).toMatchObject({
      ok: false,
      error: "capability_not_registered",
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "capability_not_registered",
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        requested_capability: "filesystem.write_file",
        admitted_capability: null,
        executed_capability: "filesystem.write_file",
        lifecycle_stage: "failed",
        status: "failed",
        failure_reason: "capability_not_registered",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_followup_decision: {
        schema: "helix.tool_followup_decision.v1",
        next_action: "retry",
        terminal_blockers: [
          "post_tool_model_step_required",
          "terminal_authority_not_evaluated",
        ],
        required_surface_satisfied: false,
        evidence_reentered: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(result.observation_packet.status).toBe("failed");
  });
});
